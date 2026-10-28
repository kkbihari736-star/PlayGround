import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const dist = resolve(root, 'dist')
const started = performance.now()

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

let copied = 0
for (const file of ['index.html', 'styles.css', 'app.js', 'favicon.svg']) {
  const from = resolve(root, file)
  if (!existsSync(from)) continue
  cpSync(from, resolve(dist, file))
  copied += 1
}

if (!existsSync(resolve(dist, 'index.html'))) {
  throw new Error('Build failed: index.html missing from dist')
}

console.log(`Built ${copied} assets into ${dist} in ${((performance.now() - started) / 1000).toFixed(2)}s`)
