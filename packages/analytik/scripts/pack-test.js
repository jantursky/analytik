// Installs the packed tarball into an empty project, the way a consumer gets it from npm, then runs the
// server on in-memory SQLite in plain Node, loads every subpath export and runs the CLI. Run after `bun run build`.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const packageDir = resolve(import.meta.dirname, '..')
const dir = mkdtempSync(join(tmpdir(), 'analytik-pack-'))
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' })

try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', dir], packageDir))
  const files = packed.files.map((file) => file.path).sort()
  const allowed =
    /^(dist\/[\w/-]+\.(js|js\.map|d\.ts)|dist\/(analytik\.js|dashboard\.css)|templates\/(cloudflare|vercel)\/[\w./-]+|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/
  const unexpected = files.filter((file) => !allowed.test(file))
  if (unexpected.length > 0) throw new Error(`Unexpected files in the tarball: ${unexpected.join(', ')}`)
  console.log(`tarball: ${packed.filename}, ${files.length} files, ${(packed.size / 1024).toFixed(1)} kB`)

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }))
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      `./${packed.filename}`,
      'hono@^4',
      'react@^19',
      'react-dom@^19',
      '@base-ui/react@^1.9.0',
      'motion@^14.6.0',
      'recharts@^3.10.1',
    ],
    dir,
  )

  writeFileSync(
    join(dir, 'consumer.js'),
    `import assert from 'node:assert/strict'
import { createAnalytik } from 'analytik/server'
import { memoryStorage } from 'analytik/storage/memory'
import { seedDemo } from 'analytik/migrate'

for (const path of ['analytik', 'analytik/storage/d1', 'analytik/storage/postgres', 'analytik/storage/sqlite',
  'analytik/adapters/stripe', 'analytik/adapters/dodo', 'analytik/adapters/lemonsqueezy', 'analytik/client',
  'analytik/react', 'analytik/dashboard', 'analytik/standalone']) {
  await import(path)
}

const storage = memoryStorage()
const analytik = createAnalytik({ storage, admin: { verify: () => true }, allowedOrigins: 'any' })
const health = await analytik.app.request('http://localhost/api/health')
assert.equal(health.status, 200)

const { siteId } = await seedDemo(storage, { siteId: 'demo', now: Date.UTC(2026, 2, 16, 12) })
const event = await analytik.app.request('http://localhost/api/event', {
  method: 'POST',
  headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/141.0 Safari/537.36' },
  body: JSON.stringify({ w: siteId, t: 'pageview', u: 'https://anywhere.example/pricing' }),
})
assert.equal(event.status, 202)
const overview = await analytik.stats.overview(siteId, { from: 0, to: Date.now() + 1 })
assert.ok(overview.visitors.value > 0)
console.log('consumer: server, storage, migrate and every subpath load and work')
`,
  )
  console.log(run('node', ['consumer.js'], dir).trim())
  // The projects the CLI scaffolds, written from the installed package.
  run('npx', ['--no-install', 'analytik', 'create', 'scaffold', '--no-deploy'], dir)
  run('npx', ['--no-install', 'analytik', 'create', 'scaffold-vercel', '--target', 'vercel'], dir)
  const worker = readFileSync(join(dir, 'scaffold', 'src', 'worker.ts'), 'utf8')
  if (!worker.includes('withDashboard')) throw new Error('the scaffolded Worker does not serve the dashboard')
  if (!readFileSync(join(dir, 'scaffold-vercel', 'api', 'index.ts'), 'utf8').includes('withDashboard')) {
    throw new Error('the scaffolded Vercel function does not serve the dashboard')
  }
  console.log(`cli: analytik ${run('npx', ['--no-install', 'analytik', '--version'], dir).trim()}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
