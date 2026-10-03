// GET with Authorization: Bearer <token> → who the token names (ADR-0025). The handler
// is session in ../_shared/handlers.ts. verify_jwt is off in ../../config.toml: the token
// is the ERP's own, not a Supabase Auth JWT (ADR-0022).
import { serve } from '../_deno/serve.ts';
import { session } from '../_shared/handlers.ts';

serve(session);
