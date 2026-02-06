// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      /**
       * Enforce consistent environment detection
       *
       * Direct usage of process.env.NODE_ENV leads to inconsistent behavior.
       * Use the centralized helpers from src/config/environment.config.ts instead:
       * - isProduction()
       * - isDevelopment()
       * - isTest()
       *
       * @see https://github.com/OpusPopuli/opuspopuli/issues/206
       */
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='NODE_ENV']",
          message:
            "Use isProduction(), isDevelopment(), or isTest() from 'src/config/environment.config' instead of process.env.NODE_ENV directly. See issue #206.",
        },
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='ENV']",
          message:
            "Use isProduction(), isDevelopment(), or isTest() from 'src/config/environment.config' instead of process.env.ENV directly. See issue #206.",
        },
      ],
    },
  },
  {
    // Ignore environment config file itself and test files that need to mock NODE_ENV
    files: ['**/environment.config.ts', '**/*.spec.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);