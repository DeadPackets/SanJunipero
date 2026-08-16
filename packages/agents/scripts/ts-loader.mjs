// Node loader for running the monorepo's TypeScript under plain `node`.
// The source tree uses the NodeNext `.js`-in-imports convention (a.ts imports
// './b.js' where only b.ts exists) and, in a few classes, TypeScript parameter
// properties — neither of which Node's built-in strip-only mode supports.
// The resolve hook maps `.js` -> `.ts`; the load hook transpiles `.ts` with the
// workspace's own TypeScript so parameter properties are lowered.
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const TS_EXT = /\.tsx?$/

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier, context)
      } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
          return nextResolve(`${specifier.slice(0, -3)}.ts`, context)
        }
        throw err
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && TS_EXT.test(url)) {
      const source = readFileSync(new URL(url), 'utf8')
      const { outputText } = ts.transpileModule(source, {
        fileName: url,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      })
      return { format: 'module', source: outputText, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
