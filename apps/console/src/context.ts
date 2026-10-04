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
  readonly navigate: (route: Route) => void;
  /**
   * Every failed call passes through here first. A session that has ended signs the
   * person out; anything else is the screen's to show. Returns true when handled.
   */
  readonly onFailure: (f: Failure) => boolean;
}
