import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.tsbuildinfo', 'apps/web/next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // 접근 범위 필터 우회(ADR-008)나 계약 위반이 any로 숨지 않도록 한다.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // process.env는 인덱스 접근으로만 읽는다 (noUncheckedIndexedAccess와 짝).
      'dot-notation': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // PIPE 이식 1단계 인수인계 묶음(#218·#219)의 스크립트는 PIPE 저장소로 그대로 옮겨 가는 전달물이고,
    // 그 묶음의 MANIFEST.json이 파일 바이트의 SHA-256을 고정한다. 파일을 고치지 않고 Node 전역 URL만 허용한다.
    files: ['handoff/pipe-search-port/**/*.mjs'],
    languageOptions: { globals: { URL: 'readonly' } },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
