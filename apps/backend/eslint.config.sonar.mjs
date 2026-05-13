// @ts-check
// Sonar rules run separately (no --fix) to avoid sonarjs fixers mangling
// NestJS decorator-heavy files. See .husky/pre-push for usage.

import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15],
      // Allow underscore-prefixed params/vars to mark intentionally unused bindings
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      'sonarjs/no-duplicate-string': 'off',
    },
  },
  // Suppress globally — test fixtures use fake IPs, local dev uses http://, and
  // Math.random() in tests is fine.  slow-regex patterns are in the scraping
  // pipeline and need a dedicated security review before changes are made.
  {
    rules: {
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/slow-regex': 'off',
    },
  },
  // Fake HMAC test keys in spec files are not production secrets.
  {
    files: ['**/*.spec.ts'],
    rules: {
      'sonarjs/hardcoded-secret-signatures': 'off',
    },
  },
);
