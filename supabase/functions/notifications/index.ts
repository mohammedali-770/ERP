// The notifications function (module 6, step 2): 0021's three runtime routes over HTTP,
// every one signed in. The router is notifications in ../_shared/notifications.ts.
// verify_jwt is off in ../../config.toml: the token is the ERP's own, not a Supabase Auth
// JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { notifications } from '../_shared/notifications.ts';

serve(notifications);
