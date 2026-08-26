// Node loader for the monorepo's TypeScript: Node's strip-only mode supports neither the
// NodeNext `.js`-in-imports convention nor parameter properties, so resolve maps .js -> .ts.
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
