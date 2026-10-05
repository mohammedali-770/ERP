import { useRef, useState } from 'react';
import type { Answer, Failure } from '../api.ts';
import type { Ctx } from '../context.ts';
import { writeLifecycle, type Done, type WriteHooks } from '../write.ts';

/**
 * A detail page's sub-form write, with React state: write.ts's lifecycle, one per form,
 * kept for the form's life. `see` reads the record Start over looks at; `after` resets
 * the form for its next decision (new ids, closed).
 *
 * `locked` is what a form's fieldset and its other controls take: true while a request
 * is out, and while one is in doubt. Locked only in doubt, the fields stayed editable
 * while a request was out, and the in-doubt form then showed values its Retry would not
 * send (found in review).
 */
export function useWrite(ctx: Ctx, see: () => Promise<Answer<unknown>>, onDone: Done, after: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [inDoubt, setInDoubt] = useState(false);
  const hooks = useRef<WriteHooks>({ onFailure: ctx.onFailure, see, after, onDone });
  hooks.current = { onFailure: ctx.onFailure, see, after, onDone };
  const [life] = useState(() => writeLifecycle({ setBusy, setFailure, setInDoubt }, () => hooks.current));
  return {
    busy,
    failure,
    inDoubt,
    locked: busy || inDoubt,
    run: life.run,
    retry: life.retry,
    startOver: life.startOver,
    /** A failure found before sending (a malformed field): shown as the route's would be. */
    show: setFailure,
  };
}
