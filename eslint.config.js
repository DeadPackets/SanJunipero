import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // perf/ is a standalone benchmark harness run by hand, outside every package's tsconfig.
  { ignores: ['**/dist/**', 'perf/**'] },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // The omit-a-key idiom `const { [id]: _, ...rest } = obj` is how the fold keeps key order.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_' },
      ],
      // 484 object types, 0 interfaces: the measured house style, not the plugin's default.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      // The tuned prices, thresholds and tuning constants stay written where they are used.
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
    // P16: layers.ts owns the town's depth sort and interiorScene.ts a separate scene graph.
    // A zIndex written anywhere else is a magic depth number the sort cannot see.
    files: ['packages/web/src/**/*.{ts,tsx}'],
    ignores: ['packages/web/src/render/layers.ts', 'packages/web/src/render/interiorScene.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AssignmentExpression[left.property.name="zIndex"]',
          message: 'Only render/layers.ts and render/interiorScene.ts may write a zIndex.',
        },
      ],
    },
  },
  {
    // The project service only ever looks for tsconfig.json, and the scripts live in a sibling one.
    files: ['packages/{agents,arbiter,forge,gateway,narrator,town}/scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: [
          'packages/agents/tsconfig.scripts.json',
          'packages/arbiter/tsconfig.scripts.json',
          'packages/forge/tsconfig.scripts.json',
          'packages/gateway/tsconfig.scripts.json',
          'packages/narrator/tsconfig.scripts.json',
          'packages/town/tsconfig.scripts.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // This one test composes the town that loads it, so it is checked by a project of its own —
    // the src project may not reference `@sj/town` without a reference cycle.
    files: ['packages/live/src/liveWorld.test.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['packages/live/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', 'vitest.config.ts', 'packages/web/vite.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
