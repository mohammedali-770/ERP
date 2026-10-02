import { APP_NAME } from './index.ts';
import { shellTitle } from './shell.ts';
import { NAVIGATION, NO_VIEWER, visibleNavigation, type Viewer } from './navigation.ts';

/**
 * The shell. Navigation comes from capability state and permission
 * (navigation.ts); the screens arrive in Phase 4, module by module, each behind its
 * capability rather than wired in directly.
 *
 * There is no sign-in yet — nothing names what holds the erp_app credential
 * (open question Q-21) — so the viewer is NO_VIEWER and every capability resolves
 * hidden. That is the correct empty state rather than a placeholder: with nothing
 * recorded and nothing granted, there is nothing to show.
 */
export function App({ viewer = NO_VIEWER }: { viewer?: Viewer }): JSX.Element {
  const groups = visibleNavigation(NAVIGATION, viewer);
  return (
    <main>
      <h1>{shellTitle(APP_NAME)}</h1>
      {viewer.preview && <p role="status">Preview — read only</p>}
      {groups.length === 0 ? (
        <p>No capability is enabled yet.</p>
      ) : (
        <nav>
          {groups.map((group) => (
            <section key={group.labelKey}>
              <h2>{group.labelKey}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`}>{item.labelKey}</a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      )}
    </main>
  );
}
