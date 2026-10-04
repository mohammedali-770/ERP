// The suppliers function (module 2, step 2): 0016's twelve routes over HTTP, every one
// signed in. The router is suppliers in ../_shared/suppliers.ts. verify_jwt is off in
// ../../config.toml: the token is the ERP's own, not a Supabase Auth JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { suppliers } from '../_shared/suppliers.ts';

serve(suppliers);
