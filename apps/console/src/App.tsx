import { APP_NAME } from './index.ts';
import { shellTitle } from './shell.ts';

/**
 * The shell, and nothing else. No navigation, no data, no domain logic — an app is
 * a delivery surface (ADR-0001:28) and the modules it will host arrive in Phase 4,
 * each behind the capability registry rather than wired in directly.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>{shellTitle(APP_NAME)}</h1>
      <p>No capability is enabled yet.</p>
    </main>
  );
}
