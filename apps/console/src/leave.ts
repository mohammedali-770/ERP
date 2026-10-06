/**
 * Leaving a form with work typed in it. A count can run to hundreds of lines, and the
 * console is one page whose links only change the URL's hash: `beforeunload` fires only
 * when the tab itself unloads, so a click on Back, the menu, or another facility would
 * discard the lines without a word (found in review). Every way out of a screen asks this
 * guard first: a hash change, the facility picker, signing out, and closing the tab.
 *
 * Plain TypeScript so test/stock.test.ts drives it; App.tsx holds one for the session.
 */
export interface LeaveGuard {
  /** A form registers what makes it dirty, and clears it (null) when it unmounts. */
  set(dirty: (() => boolean) | null): void;
  /** True when there is nothing to lose. */
  clean(): boolean;
  /** True when leaving is allowed: nothing to lose, the person confirms, or a save is leaving. */
  allows(): boolean;
  /** The next leave is a form's own, after a save: it asks nothing. */
  bypassOnce(): void;
}

export function leaveGuard(confirm: () => boolean): LeaveGuard {
  let dirty: (() => boolean) | null = null;
  let bypass = false;
  const clean = () => dirty === null || !dirty();
  return {
    set: (d) => {
      dirty = d;
    },
    clean,
    allows: () => {
      if (bypass) {
        bypass = false;
        return true;
      }
      return clean() || confirm();
    },
    bypassOnce: () => {
      bypass = true;
    },
  };
}
