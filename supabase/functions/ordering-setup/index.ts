// The ordering-setup function (module 9, step 2): 0024's six write routes and six reads over
// HTTP, every one signed in. The router is orderingSetup in ../_shared/ordering-setup.ts.
// verify_jwt is off in ../../config.toml: the token is the ERP's own, not a Supabase Auth
// JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { orderingSetup } from '../_shared/ordering-setup.ts';

serve(orderingSetup);
