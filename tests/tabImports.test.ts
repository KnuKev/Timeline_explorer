import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

test('lazy tabs resolve to a single component module on case-insensitive filesystems', async () => {
  const entry = new URL('../src/App.tsx', import.meta.url)
  const source = ts.createSourceFile('App.tsx', readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const imports: string[] = []
  function collectImports(node: ts.Node, inLoader = false) {
    const insideLazy = inLoader || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'lazy')
    if (insideLazy && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = node.arguments[0]
      if (target && ts.isStringLiteral(target) && target.text.startsWith('.')) imports.push(target.text)
    }
    ts.forEachChild(node, child => collectImports(child, insideLazy))
  }
  collectImports(source)
  assert.ok(imports.length, 'Check the dynamic imports used by the tab buttons')

  for (const specifier of imports) {
    const target = fileURLToPath(new URL(specifier, entry))
    const name = basename(target).toLowerCase()
    // An extensionless import must not match both a .ts analysis and a .tsx view.
    const candidates = readdirSync(dirname(target)).filter(file =>
      (extname(name) ? file : basename(file, extname(file))).toLowerCase() === name
      && /\.[cm]?[jt]sx?$/i.test(file))
    assert.equal(candidates.length, 1, `${specifier} resolves to: ${candidates.join(', ')}`)
    const module = await import(pathToFileURL(join(dirname(target), candidates[0]!)).href)
    assert.ok(module.default, `${specifier} must export a default tab component`)
  }
})
