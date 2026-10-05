// The facilities function (module 4, step 2): 0019's seven runtime routes over HTTP,
// every one signed in. The router is facilities in ../_shared/facilities.ts.
// verify_jwt is off in ../../config.toml: the token is the ERP's own, not a Supabase Auth
// JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { facilities } from '../_shared/facilities.ts';

serve(facilities);
