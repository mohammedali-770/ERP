import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build output goes to apps/console/dist, which .gitignore's `dist/` already
 * covers — and dep-policy's no-emitted-artifact-committed assertion exempts
 * apps/* precisely so this is allowed to exist.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
