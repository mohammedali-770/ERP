import { useEffect, useState } from 'react';
import type { Failure, ItemSupply } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor } from '../format.ts';
import { localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { supplyWarning } from '../suppliers.ts';
import { FailureNotice, Loading } from './ui.tsx';

/**
 * Who sells an item, on the item's page: erp.item_suppliers() (0016), the read a purchase
 * order form will use. Live supplies of live suppliers on live packs first, then the
 * preferred one. Shown only to someone who may read suppliers here (Ctx.seesSuppliers);
 * the route asks for both capabilities regardless.
 */
export function ItemSuppliers({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const { api, lang, data, facilityId, onFailure } = ctx;
  const [supplies, setSupplies] = useState<readonly ItemSupply[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    let live = true;
    setSupplies(null);
    setFailure(null);
    void api.itemSuppliers(facilityId, itemId).then((answer) => {
      if (!live) return;
      if (answer.ok) setSupplies(answer.value);
      else if (!onFailure(answer)) setFailure(answer);
    });
    return () => {
      live = false;
    };
  }, [api, onFailure, facilityId, itemId]);

  return (
    <>
      <h2>{t(lang, 'item_suppliers')}</h2>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {supplies === null && failure === null ? <Loading lang={lang} /> : null}
      {supplies !== null && supplies.length === 0 ? <p className="muted">{t(lang, 'item_suppliers_none')}</p> : null}
      {supplies !== null && supplies.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'supplier')}</th><th>{t(lang, 'pack')}</th><th>{t(lang, 'factor')}</th>
              <th>{t(lang, 'their_code')}</th><th>{t(lang, 'preferred')}</th><th>{t(lang, 'status')}</th>
            </tr>
          </thead>
          <tbody>
            {supplies.map((x) => {
              const usable = x.status === 'active' && x.supplier_status === 'active' && supplyWarning(x) === null;
              const warning = supplyWarning(x);
              return (
                <tr key={x.supplier_item_id} className={usable ? undefined : 'retired'}>
                  <td>
                    <a href={`#suppliers/${x.supplier_id}`} dir="ltr">{x.supplier_code}</a>{' '}
                    {localName(lang, { name_en: x.supplier_name_en, name_ar: x.supplier_name_ar })}
                  </td>
                  <td>{unitName(lang, data.units, x.unit_key)}</td>
                  <td><bdi dir="ltr">{formatFactor(x.factor)}</bdi></td>
                  <td><bdi dir="ltr">{x.their_code ?? ''}</bdi></td>
                  <td>{x.preferred ? t(lang, 'yes') : ''}</td>
                  <td>
                    {x.status === 'retired' ? t(lang, 'supply_retired')
                      : x.supplier_status === 'retired' ? t(lang, 'status_retired') : t(lang, 'status_active')}
                    {x.status === 'active' && warning ? <> · <em>{t(lang, warning === 'item_retired' ? 'item_retired_note' : 'pack_retired_note')}</em></> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
