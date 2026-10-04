/**
 * Where the console keeps the session token between page loads: the tab's
 * sessionStorage, and nowhere else.
 *
 * sessionStorage, not localStorage: it dies with the tab, so a console closed on a
 * shared machine leaves no token for the next person to find, and it is never shared
 * with another tab (each tab signs in). Not a cookie: the edge takes the token in
 * `Authorization` and sends no cookie (ADR-0025), so there is nothing for a cross-site
 * request to ride on. The session also ends on the server — 12 hours, or 30 minutes
 * idle — whatever this file holds.
 *
 * Storage can be missing or throw (a private window, blocked site data), so every access
 * is guarded: a console without storage still works, and signs in again on reload.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

const KEY = 'erp.console.session';
const TOKEN = /^[0-9a-f]{64}$/;

export function tokenStore(storage: StorageLike | null): TokenStore {
  let memory: string | null = null;
  return {
    get() {
      if (memory !== null) return memory;
      try {
        const v = storage?.getItem(KEY) ?? null;
        // Only a token-shaped value is ever sent; anything else is cleared.
        if (v !== null && !TOKEN.test(v)) {
          storage?.removeItem(KEY);
          return null;
        }
        memory = v;
        return v;
      } catch {
        return null;
      }
    },
    set(token) {
      memory = token;
      try {
        storage?.setItem(KEY, token);
      } catch {
        // No storage: the token lives in memory until the page is reloaded.
      }
    },
    clear() {
      memory = null;
      try {
        storage?.removeItem(KEY);
      } catch {
        // Nothing stored to clear.
      }
    },
  };
}

/** The reader's language, a per-browser convenience: a failure to remember it costs nothing. */
export function storedLang(storage: StorageLike | null): 'en' | 'ar' {
  try {
    return storage?.getItem('erp.console.lang') === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function storeLang(storage: StorageLike | null, lang: 'en' | 'ar'): void {
  try {
    storage?.setItem('erp.console.lang', lang);
  } catch {
    // Remembered for this page only.
  }
}
