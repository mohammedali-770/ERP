// The purchase-orders function (module 8, step 2): 0023's nine runtime routes over HTTP,
// every one signed in. The router is purchaseOrders in ../_shared/purchase-orders.ts.
// verify_jwt is off in ../../config.toml: the token is the ERP's own, not a Supabase Auth
// JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { purchaseOrders } from '../_shared/purchase-orders.ts';

serve(purchaseOrders);
