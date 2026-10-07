/**
 * What every screen is handed: the client, the reader's language, and who is signed in
 * where. Plain TypeScript so the screens' props are typechecked by both projects.
 */
import type { Api, Failure, ViewerData } from './api.ts';
import type { Lang } from './i18n.ts';
import type { Viewer } from './navigation.ts';
import type { Route } from './route.ts';

export interface Ctx {
  readonly api: Api;
  readonly lang: Lang;
  /** erp.viewer() for the session's person at `facilityId`. */
  readonly data: ViewerData;
  readonly viewer: Viewer;
  /** Where the person is working; null is the organisation as a whole. */
  readonly facilityId: string | null;
  /** Whether the items screens offer changes here (viewer.ts, itemsWritable). */
  readonly writable: boolean;
  /** Whether the supplier screens offer changes here (viewer.ts, suppliersWritable). */
  readonly suppliersWritable: boolean;
  /** Whether the person may read suppliers here: the item page then shows who sells it. */
  readonly seesSuppliers: boolean;
  /** Whether the transfer-price screens offer changes here (viewer.ts, transferPricesWritable). */
  readonly transferPricesWritable: boolean;
  /** Whether the person may read transfer prices here: the item page then links to its prices. */
  readonly seesTransferPrices: boolean;
  /** Whether the facility screens offer changes here (viewer.ts, facilitiesWritable). */
  readonly facilitiesWritable: boolean;
  /** Whether the person may read facilities here. */
  readonly seesFacilities: boolean;
  /** Whether the stock screens offer changes here: at a warehouse or a factory only (stock.ts, stockWritable). */
  readonly stockWritable: boolean;
  /** Whether the person may let stock go below zero here, with a reason (D1; stock.ts, holdsOverride). */
  readonly stockOverride: boolean;
  /** Whether the person may read stock here: the stock entry asks for read on items too. */
  readonly seesStock: boolean;
  /** Whether the stock-alert screens offer changes here: at a warehouse or a factory only, as stock's (stock.ts, stockWritable). */
  readonly stockAlertsWritable: boolean;
  /** Whether the person may read minimums here: the entry asks for read on stock and items too. */
  readonly seesStockAlerts: boolean;
  /** Whether the person has a bell here (notifications.ts, bellVisible). */
  readonly seesBell: boolean;
  /** Reads the bell's unread count again, after the person has marked something read. */
  readonly refreshBell: () => void;
  /** Changes when the person asks for the bell's page afresh: a click on the bell there, or coming back to the tab. */
  readonly bellPage: number;
  /**
   * Switches where the person is working to `facilityId`, then goes to `route`: how a
   * notification from another facility is opened, since a stock route reads only the
   * facility worked at. Asks first when a form holds unsaved lines, as the picker does;
   * false when the person chose to stay.
   */
  readonly workAt: (facilityId: string, route: Route) => boolean;
  /** A form with unsaved work registers what makes it dirty; every way out then asks first (leave.ts). Null clears it. */
  readonly setLeaveGuard: (dirty: (() => boolean) | null) => void;
  /** Goes to `route`, with a notice shown once on arrival (an `already_recorded` success). */
  readonly navigate: (route: Route, notice?: string) => void;
  /**
   * Every failed call passes through here first. A session that has ended signs the
   * person out; anything else is the screen's to show. Returns true when handled.
   */
  readonly onFailure: (f: Failure) => boolean;
}
