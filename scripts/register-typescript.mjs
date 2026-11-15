import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Use the project's compiler so tests also work on Node builds without type stripping.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?url')) {
      const asset = nextResolve(specifier.slice(0, -4), context)
      return { ...asset, url: asset.url + '?url' }
    }
    // Match Vite's extensionless local TypeScript imports for component SSR tests.
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL)
      if (!extname(fileURLToPath(url))) {
        for (const extension of ['.ts', '.tsx']) {
          const candidate = new URL(url.href + extension)
          if (existsSync(candidate)) return nextResolve(candidate.href, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('?url')) return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url.slice(0, -4))}` }
    // CSS remains handled by Vite in the app; server-render tests inspect markup.
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }
    if (/\.tsx?$/.test(url)) {
      const source = readFileSync(new URL(url), 'utf8')
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true } }).outputText,
      }
    }
    return nextLoad(url, context)
  },
})
