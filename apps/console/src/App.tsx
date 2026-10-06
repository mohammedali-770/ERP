import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApi, sessionEnded, type Api, type Failure, type SessionData } from './api.ts';
import type { Ctx } from './context.ts';
import { dir, label, localName, t, type Lang } from './i18n.ts';
import { failureMessage } from './messages.ts';
import { NAVIGATION, itemIsVisible, itemIsWritable, visibleNavigation, type NavItem } from './navigation.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from './route.ts';
import { storeLang, storedLang, tokenStore, type StorageLike } from './session.ts';
import { defaultFacility, facilitiesWritable, itemsWritable, suppliersWritable, toViewer, transferPricesWritable } from './viewer.ts';
import { FacilitiesList } from './screens/FacilitiesList.tsx';
import { FacilityDetail } from './screens/FacilityDetail.tsx';
import { FacilityCreate, FacilityEdit } from './screens/FacilityForm.tsx';
import { ItemDetail } from './screens/ItemDetail.tsx';
import { ItemCreate, ItemEdit } from './screens/ItemForm.tsx';
import { ItemImport } from './screens/ItemImport.tsx';
import { ItemPrices } from './screens/ItemPrices.tsx';
import { ItemsList } from './screens/ItemsList.tsx';
import { SignIn } from './screens/SignIn.tsx';
import { SupplierContact } from './screens/SupplierContact.tsx';
import { SupplierDetail } from './screens/SupplierDetail.tsx';
import { SupplierCreate, SupplierEdit } from './screens/SupplierForm.tsx';
import { SupplierImport } from './screens/SupplierImport.tsx';
import { SuppliersList } from './screens/SuppliersList.tsx';
import { TransferPricesList } from './screens/TransferPricesList.tsx';
import { StockList } from './screens/StockList.tsx';
import { StockItem } from './screens/StockItem.tsx';
import { StockDecisionPage } from './screens/StockDecision.tsx';
import { StockAdjust, StockCount } from './screens/StockEntry.tsx';
import { holdsOverride, stockWritable, workingFacility } from './stock.ts';
import { FailureNotice, Loading, Notice } from './screens/ui.tsx';

/**
 * The console: sign-in, then the shell — menu, facility, language — around the screen
 * the URL hash names.
 *
 * The menu comes from the session's viewer (erp.viewer(), 0015): capability state and
 * permission at the facility being worked at (navigation.ts). It is NOT A CONTROL. Every
 * route the screens call asks erp.assert_permitted() itself (CAP-P04).
 */

const ITEMS: NavItem = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'items')!;
const SUPPLIERS: NavItem = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'suppliers')!;
const TRANSFER_PRICES: NavItem = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'transfer_prices')!;
const FACILITIES: NavItem = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'facilities')!;
const STOCK: NavItem = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'current_stock')!;

function storage(kind: 'sessionStorage' | 'localStorage'): StorageLike | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

const FUNCTIONS_URL: string = import.meta.env.VITE_ERP_FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1';

export function App() {
  const tokens = useMemo(() => tokenStore(storage('sessionStorage')), []);
  const prefs = useMemo(() => storage('localStorage'), []);
  const api: Api = useMemo(() => createApi({ base: FUNCTIONS_URL, fetch: (u, i) => window.fetch(u, i), token: tokens.get }), [tokens]);

  const [lang, setLang] = useState<Lang>(() => storedLang(prefs));
  const [token, setToken] = useState<string | null>(() => tokens.get());
  const [session, setSession] = useState<SessionData | null>(null);
  /** undefined until the person's default is known; null is the organisation as a whole. */
  const [facilityId, setFacilityId] = useState<string | null | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  /** A notice for the screen it was addressed to, shown there once. */
  const [arrival, setArrival] = useState<{ hash: string; text: string } | null>(null);
  // Read through a ref so onFailure stays one function: depending on the language made
  // every toggle reload the item page and discard any open form (found in review).
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir(lang);
    document.title = t(lang, 'app_title');
    storeLang(prefs, lang);
  }, [lang, prefs]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // A notice lives on the screen it was addressed to; leaving that screen ends it.
  useEffect(() => {
    setArrival((a) => (a !== null && a.hash !== formatRoute(route) ? null : a));
  }, [route]);

  const signedOut = useCallback((why: string | null) => {
    tokens.clear();
    setToken(null);
    setSession(null);
    setFacilityId(undefined);
    setNotice(why);
  }, [tokens]);

  /** A session that has ended signs the person out, with the reason; nothing else is handled. */
  const onFailure = useCallback((f: Failure): boolean => {
    if (!sessionEnded(f)) return false;
    signedOut(failureMessage(langRef.current, f).text);
    return true;
  }, [signedOut]);

  // The viewer, for the session's person at the facility worked at. The first call, made
  // before the facility is known, answers where they may work; the default is then
  // chosen from it.
  useEffect(() => {
    if (token === null) return;
    let live = true;
    void api.session(facilityId ?? null).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        if (!onFailure(answer)) setFailure(answer);
        return;
      }
      setFailure(null);
      if (facilityId === undefined) {
        const chosen = defaultFacility(answer.value.viewer);
        if (chosen !== null) {
          setFacilityId(chosen);
          return;
        }
        setFacilityId(null);
      }
      setSession(answer.value);
    });
    return () => {
      live = false;
    };
  }, [api, token, facilityId, onFailure]);

  const toggleLang = () => setLang((l) => (l === 'ar' ? 'en' : 'ar'));

  /**
   * Forgets the token first, then tells the server. Waiting for the server first left a
   * shared machine signed in for as long as a hung connection lasted (found in review).
   * If the request is lost the session still ends on the server, at 30 minutes idle.
   */
  function signOut() {
    const token = tokens.get();
    signedOut(null);
    window.location.hash = '';
    if (token !== null) void api.signOut(token);
  }

  if (token === null) {
    return (
      <SignIn
        api={api}
        lang={lang}
        notice={notice}
        onToggleLang={toggleLang}
        onSignedIn={(tk) => {
          tokens.set(tk);
          setNotice(null);
          setToken(tk);
        }}
      />
    );
  }

  if (session === null || facilityId === undefined || session.viewer.facility_id !== facilityId) {
    return (
      <main className="centered">
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
        {failure ? <button type="button" onClick={() => signOut()}>{t(lang, 'sign_out')}</button> : null}
      </main>
    );
  }

  const data = session.viewer;
  const viewer = toViewer(data);
  const ctx: Ctx = {
    api,
    lang,
    data,
    viewer,
    facilityId,
    writable: itemsWritable(viewer, facilityId, (v) => itemIsWritable(ITEMS, v)),
    suppliersWritable: suppliersWritable(viewer, facilityId, (v) => itemIsWritable(SUPPLIERS, v)),
    seesSuppliers: itemIsVisible(SUPPLIERS, viewer),
    transferPricesWritable: transferPricesWritable(viewer, facilityId, (v) => itemIsWritable(TRANSFER_PRICES, v)),
    // The entry asks for read on items as well (navigation.ts, alsoReads), as 0018's reads do.
    seesTransferPrices: itemIsVisible(TRANSFER_PRICES, viewer),
    facilitiesWritable: facilitiesWritable(viewer, facilityId, (v) => itemIsWritable(FACILITIES, v)),
    seesFacilities: itemIsVisible(FACILITIES, viewer),
    // The masters' inverse: stock changes only AT a warehouse or a factory, where 0020 asks.
    stockWritable: stockWritable(workingFacility(data.facilities, facilityId), viewer, (v) => itemIsWritable(STOCK, v)),
    stockOverride: holdsOverride(viewer),
    seesStock: itemIsVisible(STOCK, viewer),
    navigate: (r, notice) => {
      setArrival(notice === undefined ? null : { hash: formatRoute(r), text: notice });
      window.location.hash = formatRoute(r);
    },
    onFailure,
  };
  const groups = visibleNavigation(NAVIGATION, viewer);
  const current = navIdOf(route);
  const person = localName(lang, { name_en: data.person.full_name_en, name_ar: data.person.full_name_ar })
    || data.person.employee_number;

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">{t(lang, 'app_title')}</strong>
        <label className="facility">
          <span>{t(lang, 'facility')}</span>
          <select
            value={facilityId ?? ''}
            onChange={(e) => {
              setSession(null);
              setFacilityId(e.target.value === '' ? null : e.target.value);
            }}
          >
            {data.org_wide ? <option value="">{t(lang, 'org_wide')}</option> : null}
            {data.facilities.map((f) => (
              <option key={f.facility_id} value={f.facility_id}>{f.code} — {localName(lang, f)}</option>
            ))}
          </select>
        </label>
        <span className="person">{person}</span>
        <button type="button" className="link" onClick={toggleLang}>{t(lang, 'language')}</button>
        <button type="button" onClick={() => signOut()}>{t(lang, 'sign_out')}</button>
      </header>
      <div className="body">
        <nav className="menu" aria-label="menu">
          {groups.map((group) => (
            <section key={group.labelKey}>
              <h2>{label(lang, group.labelKey)}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} aria-current={current === item.id ? 'page' : undefined}>{label(lang, item.labelKey)}</a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <main className="content">
          {viewer.preview ? <p role="status">{t(lang, 'preview_read_only')}</p> : null}
          {arrival !== null && arrival.hash === formatRoute(route) ? <Notice tone="info" text={arrival.text} /> : null}
          <Screen ctx={ctx} route={route} itemsVisible={itemIsVisible(ITEMS, viewer)} anyVisible={groups.length > 0} />
        </main>
      </div>
    </div>
  );
}

function Screen({ ctx, route, itemsVisible, anyVisible }: { ctx: Ctx; route: Route; itemsVisible: boolean; anyVisible: boolean }) {
  const { lang } = ctx;
  if (route.screen === 'unknown' && NAVIGATION.some((g) => g.items.some((i) => i.id === route.id))) {
    // A menu entry whose module has not reached its screens yet (navigation.ts).
    return <Notice tone="info" text={t(lang, 'not_built_yet')} />;
  }
  if (route.screen === 'home' || route.screen === 'unknown') {
    return anyVisible ? <h1>{t(lang, 'signin_welcome')}</h1> : <Notice tone="info" text={t(lang, 'nothing_enabled')} />;
  }
  // The menu hides what the database would refuse; a typed URL meets the same answer.
  if (navIdOf(route) === 'suppliers') {
    if (!ctx.seesSuppliers) return <Notice tone="info" text={t(lang, 'refusal_forbidden')} />;
    switch (route.screen) {
      case 'suppliers': return <SuppliersList ctx={ctx} />;
      case 'supplier_new': return <SupplierCreate ctx={ctx} />;
      case 'supplier_import': return <SupplierImport ctx={ctx} />;
      case 'supplier': return <SupplierDetail ctx={ctx} supplierId={route.supplierId} />;
      case 'supplier_edit': return <SupplierEdit ctx={ctx} supplierId={route.supplierId} />;
      case 'supplier_contact': return <SupplierContact ctx={ctx} supplierId={route.supplierId} />;
    }
  }
  if (navIdOf(route) === 'transfer_prices') {
    if (!ctx.seesTransferPrices) return <Notice tone="info" text={t(lang, 'refusal_forbidden')} />;
    switch (route.screen) {
      case 'transfer_prices': return <TransferPricesList ctx={ctx} />;
      case 'item_prices': return <ItemPrices ctx={ctx} itemId={route.itemId} />;
    }
  }
  if (navIdOf(route) === 'facilities') {
    if (!ctx.seesFacilities) return <Notice tone="info" text={t(lang, 'refusal_forbidden')} />;
    switch (route.screen) {
      case 'facilities': return <FacilitiesList ctx={ctx} />;
      case 'facility_new': return <FacilityCreate ctx={ctx} />;
      case 'facility': return <FacilityDetail ctx={ctx} targetId={route.targetId} />;
      case 'facility_edit': return <FacilityEdit ctx={ctx} targetId={route.targetId} />;
    }
  }
  if (navIdOf(route) === 'current_stock') {
    if (!ctx.seesStock) return <Notice tone="info" text={t(lang, 'refusal_forbidden')} />;
    switch (route.screen) {
      case 'current_stock': return <StockList ctx={ctx} />;
      case 'stock_item': return <StockItem ctx={ctx} itemId={route.itemId} />;
      case 'stock_decision': return <StockDecisionPage ctx={ctx} decisionId={route.decisionId} />;
      case 'stock_adjust': return <StockAdjust ctx={ctx} />;
      case 'stock_count': return <StockCount ctx={ctx} />;
    }
  }
  if (!itemsVisible) return <Notice tone="info" text={t(lang, 'refusal_forbidden')} />;
  switch (route.screen) {
    case 'items': return <ItemsList ctx={ctx} />;
    case 'item_new': return <ItemCreate ctx={ctx} />;
    case 'item_import': return <ItemImport ctx={ctx} />;
    case 'item': return <ItemDetail ctx={ctx} itemId={route.itemId} />;
    case 'item_edit': return <ItemEdit ctx={ctx} itemId={route.itemId} />;
  }
}
