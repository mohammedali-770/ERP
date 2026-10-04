// The items function (module 1, step 2): 0012's nine routes over HTTP, every one signed
// in. The router is items in ../_shared/items.ts. verify_jwt is off in ../../config.toml:
// the token is the ERP's own, not a Supabase Auth JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { items } from '../_shared/items.ts';

serve(items);
