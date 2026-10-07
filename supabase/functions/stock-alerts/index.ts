// The stock-alerts function (module 7, step 2): 0022's four runtime routes over HTTP,
// every one signed in. The router is stockAlerts in ../_shared/stock-alerts.ts.
// verify_jwt is off in ../../config.toml: the token is the ERP's own, not a Supabase Auth
// JWT (ADR-0022, ADR-0025).
import { serve } from '../_deno/serve.ts';
import { stockAlerts } from '../_shared/stock-alerts.ts';

serve(stockAlerts);
