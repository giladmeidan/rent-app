import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'src/api/schema.d.ts', 'playwright-report', 'test-results'] },
  tseslint.configs.strict,
  reactHooks.configs.flat.recommended,
);
