// POST { employee_number, pin } → a session token (ADR-0025). The handler is signIn in
// ../_shared/handlers.ts. verify_jwt is off for this function in ../../config.toml: the
// ERP signs people in itself and does not use Supabase Auth (ADR-0022).
import { serve } from '../_deno/serve.ts';
import { signIn } from '../_shared/handlers.ts';

serve(signIn);
