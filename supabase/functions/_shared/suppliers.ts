/**
 * The suppliers function: 0016's twelve routes over HTTP (module 2, step 2).
 *
 *   GET   /suppliers                                  erp.list_suppliers()
 *   GET   /suppliers/{supplier_id}                    erp.get_supplier()
 *   GET   /suppliers/{supplier_id}/history            erp.supplier_history()
 *   GET   /suppliers/items/{item_id}                  erp.item_suppliers()
 *   POST  /suppliers                                  erp.create_supplier()
 *   POST  /suppliers/{supplier_id}/amend              erp.amend_supplier()
 *   POST  /suppliers/{supplier_id}/status             erp.change_supplier_status()
 *   POST  /suppliers/{supplier_id}/contact            erp.set_supplier_contact()
 *   POST  /suppliers/{supplier_id}/supplies           erp.add_supplier_item()
 *   POST  /suppliers/supplies/{supplier_item_id}/amend   erp.amend_supplier_item()
 *   POST  /suppliers/supplies/{supplier_item_id}/retire  erp.retire_supplier_item()
 *   POST  /suppliers/import                           erp.import_suppliers()
 *
 * As ./items.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor.
 *
 *   SHAPE ONLY is checked here (./fields.ts). Payment terms are an integer and a supply's
 *   preference is a boolean; that terms run 0–365, that a VAT number has fifteen digits,
 *   that a retired supplier admits no new supply — every rule is 0016's, and its refusal
 *   comes back through ./refusal.ts.
 *
 *   THE FACILITY is a read's query parameter, checked by erp.assert_permitted() at that
 *   facility. The supplier master is organisation data; what a supplier sells is limited
 *   to the facility's brand (ADR-0026 §4). Writes take none: 0016 gates them
 *   organisation-wide.
 *
 *   THE DECISION IDS are minted by the console (I-1). A retried write is answered 409
 *   already_recorded, and the console confirms it through the supplier's history.
 *
 * TWO DIFFERENCES, both 0016's:
 *
 *   A CONTACT CHANGE TAKES NO REASON. The route records a fixed one, because the reason a
 *   person would type names the person and the log keeps it for good (ADR-0026 §2). A
 *   body that carries a `reason` is refused 400, rather than dropped, so a console that
 *   asks for one learns it is never kept instead of believing it was.
 *
 *   A FIELD THAT A WRITE OVERWRITES MUST BE STATED. An amend puts the whole business
 *   record in force, and a contact change the whole contact, so an absent VAT number or
 *   phone would clear it. Each such field must be present, as text or null: a console
 *   that forgets one is told so, instead of erasing it.
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import {
  facilityOf, form, importRows, IMPORT_LIMIT, listLimit, listStatus, Malformed, noSuchRoute, ok, optionalText,
  routeOf, shaped, status, text, uuid, type Source,
} from './fields.ts';
import type { SupplierFields } from './suppliers-db.ts';

/** A field a write overwrites: present, as text of at most `max` characters or null. */
function stated(source: Source, field: string, max: number): string | null {
  if (!Object.hasOwn(source, field)) throw new Malformed(field);
  return optionalText(source, field, max);
}

/**
 * An integer, as a JSON number: 30, not "30" or 30.5. The column is an integer, so a
 * value past its range would only fail later as a numeric error; the 0–365 rule is
 * supplier_payment_terms_are_days, in the database.
 */
function paymentTerms(source: Source): number {
  const v = source['payment_terms_days'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
    throw new Malformed('payment_terms_days');
  }
  return v;
}

function preferred(source: Source): boolean {
  const v = source['preferred'];
  if (typeof v !== 'boolean') throw new Malformed('preferred');
  return v;
}

/** The business record of a create (optional numbers) or an amend (stated numbers). */
function business(source: Source, numbers: typeof optionalText): SupplierFields {
  return {
    nameEn: text(source, 'name_en', 200),
    nameAr: text(source, 'name_ar', 200),
    vatNumber: numbers(source, 'vat_number', 64),
    crNumber: numbers(source, 'cr_number', 64),
    paymentTermsDays: paymentTerms(source),
    reason: text(source, 'reason', 500),
  };
}

async function list(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const suppliers = await deps.db.listSuppliers(s.personId, {
    facilityId: facilityOf(request),
    status: listStatus(q),
    search: optionalText(q, 'search', 100),
    afterCode: optionalText(q, 'after', 64),
    limit,
  });
  // Keyset paging: a full page may have a next one, which starts after its last code.
  return ok({ suppliers, next_after: suppliers.length === limit ? suppliers[suppliers.length - 1]!.code : null });
}

/** Words a path may begin with that are never a supplier id. */
const RESERVED: readonly string[] = ['items', 'import', 'supplies'];

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'suppliers');
  const actor = s.personId;
  // A path beginning with a reserved word is its route or no route, never a malformed id.
  const named = path.length > 0 && !RESERVED.includes(path[0]!);

  if (request.method === 'GET') {
    if (path.length === 0) return list(request, s, deps);
    if (path.length === 2 && path[0] === 'items') {
      const itemId = uuid({ item_id: path[1] }, 'item_id');
      return ok({ supplies: await deps.db.itemSuppliers(actor, facilityOf(request), itemId) });
    }
    if (path.length === 1 && named) {
      const supplierId = uuid({ supplier_id: path[0] }, 'supplier_id');
      return ok({ supplier: await deps.db.getSupplier(actor, facilityOf(request), supplierId) });
    }
    if (path.length === 2 && named && path[1] === 'history') {
      const supplierId = uuid({ supplier_id: path[0] }, 'supplier_id');
      return ok({ decisions: await deps.db.supplierHistory(actor, facilityOf(request), supplierId) });
    }
    return noSuchRoute;
  }

  // POST
  if (path.length === 0) {
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.createSupplier(actor, {
      decisionId,
      supplierId: uuid(b, 'supplier_id'),
      code: text(b, 'code', 64),
      ...business(b, optionalText),
    });
    return ok({ decision_id: decisionId });
  }
  if (path.length === 1 && path[0] === 'import') {
    const b = await form(request, IMPORT_LIMIT);
    const rows = importRows(b);
    const { created, amended, unchanged } = await deps.db.importSuppliers(actor, text(b, 'reason', 500), rows);
    return ok({ created, amended, unchanged });
  }
  // The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 3 && path[0] === 'supplies' && (path[2] === 'amend' || path[2] === 'retire')) {
    const supplierItemId = uuid({ supplier_item_id: path[1] }, 'supplier_item_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    if (path[2] === 'amend') {
      await deps.db.amendSupplierItem(actor, {
        decisionId,
        supplierItemId,
        expectedDecisionId: uuid(b, 'expected_decision_id'),
        supplierCode: stated(b, 'supplier_code', 200),
        preferred: preferred(b),
        reason: text(b, 'reason', 500),
      });
    } else {
      await deps.db.retireSupplierItem(actor, { decisionId, supplierItemId, reason: text(b, 'reason', 500) });
    }
    return ok({ decision_id: decisionId });
  }
  if (path.length === 2 && named && ['amend', 'status', 'contact', 'supplies'].includes(path[1]!)) {
    const supplierId = uuid({ supplier_id: path[0] }, 'supplier_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    switch (path[1]) {
      case 'amend':
        await deps.db.amendSupplier(actor, {
          decisionId,
          supplierId,
          expectedDecisionId: uuid(b, 'expected_decision_id'),
          ...business(b, stated),
        });
        return ok({ decision_id: decisionId });
      case 'status':
        await deps.db.changeSupplierStatus(actor, {
          decisionId,
          supplierId,
          expectedDecisionId: uuid(b, 'expected_decision_id'),
          status: status(b),
          reason: text(b, 'reason', 500),
        });
        return ok({ decision_id: decisionId });
      case 'contact':
        if (Object.hasOwn(b, 'reason')) throw new Malformed('reason');
        await deps.db.setSupplierContact(actor, {
          decisionId,
          supplierId,
          expectedDecisionId: uuid(b, 'expected_decision_id'),
          contactPerson: stated(b, 'contact_person', 200),
          phone: stated(b, 'phone', 64),
          email: stated(b, 'email', 320),
          address: stated(b, 'address', 1000),
        });
        return ok({ decision_id: decisionId });
      case 'supplies':
        await deps.db.addSupplierItem(actor, {
          decisionId,
          supplierItemId: uuid(b, 'supplier_item_id'),
          supplierId,
          itemUnitId: uuid(b, 'item_unit_id'),
          supplierCode: optionalText(b, 'supplier_code', 200),
          preferred: preferred(b),
          reason: text(b, 'reason', 500),
        });
        return ok({ decision_id: decisionId });
    }
  }
  return noSuchRoute;
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const suppliers = endpoint(['GET', 'POST'], shaped(dispatch));
