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
  /** Goes to `route`, with a notice shown once on arrival (an `already_recorded` success). */
  readonly navigate: (route: Route, notice?: string) => void;
  /**
   * Every failed call passes through here first. A session that has ended signs the
   * person out; anything else is the screen's to show. Returns true when handled.
   */
  readonly onFailure: (f: Failure) => boolean;
}
