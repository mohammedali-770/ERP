// POST with Authorization: Bearer <token> → that session ends (ADR-0025). The handler is
// signOut in ../_shared/handlers.ts. verify_jwt is off in ../../config.toml: the token is
// the ERP's own, not a Supabase Auth JWT (ADR-0022).
import { serve } from '../_deno/serve.ts';
import { signOut } from '../_shared/handlers.ts';

serve(signOut);
