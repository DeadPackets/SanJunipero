import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**'] },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // 484 object types, 0 interfaces: the measured house style, not the plugin's default.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      // Invariant 6: the tuned prices, thresholds and tuning constants stay written where they are.
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Test scaffolding: stub callbacks, async fixtures without awaits, and `expect(obj.method)`.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // The project service only ever looks for tsconfig.json, and the scripts live in a sibling one.
    files: ['packages/{agents,arbiter,forge,narrator}/scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: [
          'packages/agents/tsconfig.scripts.json',
          'packages/arbiter/tsconfig.scripts.json',
          'packages/forge/tsconfig.scripts.json',
          'packages/narrator/tsconfig.scripts.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      '**/*.js',
      'vitest.config.ts',
      'packages/web/vite.config.ts',
      'packages/gateway/scripts/**/*.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
