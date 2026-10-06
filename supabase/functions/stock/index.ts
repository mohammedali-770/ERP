// The stock function (module 5, step 2): 0020's six runtime routes over HTTP, every one
// signed in. The router is stock in ../_shared/stock.ts.
// verify_jwt is off in ../../config.toml: the token is the ERP's own, not a Supabase Auth
// JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { stock } from '../_shared/stock.ts';

serve(stock);
