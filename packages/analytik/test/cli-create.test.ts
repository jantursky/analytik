import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CreateIo, createProject, workerName } from '../src/create'
import { upgradeProject } from '../src/create/upgrade'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const temp = (name: string) => join(mkdtempSync(join(tmpdir(), 'analytik-create-')), name)
const DB_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

interface Call {
  command: string
  args: string[]
}

/** A stand-in for npm and wrangler that records what was run and answers like they do. */
function fakeIo(answers: Record<string, { status?: number; output?: string }> = {}) {
  const calls: Call[] = []
  const logs: string[] = []
  let secrets = ''
  let counter = 0
  const io: CreateIo = {
    run: (command, args, { cwd }) => {
      calls.push({ command, args })
      const key = args
        .filter((arg) => arg !== '--no-install' && arg !== 'wrangler')
        .slice(0, 2)
        .join(' ')
      if (key === 'secret bulk') secrets = readFileSync(join(cwd, '.secrets.tmp.json'), 'utf8')
      const answer = answers[key]
      if (answer) return { status: answer.status ?? 0, output: answer.output ?? '' }
      if (key === 'whoami') return { status: 0, output: 'You are logged in with an OAuth Token' }
      if (key === 'd1 create') return { status: 0, output: `"database_id": "${DB_ID}"` }
      if (key === 'deploy') return { status: 0, output: 'Published analytik\n  https://shop-stats.jan.workers.dev' }
      return { status: 0, output: '' }
    },
    log: (message) => logs.push(message),
    random: (bytes) => String(++counter).padStart(bytes * 2, '0'),
  }
  return { io, calls, logs, secrets: () => secrets }
}

describe('naming', () => {
  it('turns a folder name into a Worker name', () => {
    expect(workerName('My Shop Stats!')).toBe('my-shop-stats')
    expect(workerName('---')).toBe('analytik')
    expect(workerName('a'.repeat(80))).toHaveLength(54)
  })
})

describe('creating a project', () => {
  it('writes the files with the name, version and local secrets, and stops there without deploy', () => {
    const dir = temp('shop-stats')
    const { io, calls } = fakeIo()
    const result = createProject({ dir, version: '1.4.2', deploy: false }, io)
    expect(calls).toEqual([])
    expect(result).toMatchObject({ name: 'shop-stats', password: '00000000000000000001' })
    const wrangler = readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')
    expect(wrangler).toContain('"name": "shop-stats"')
    expect(wrangler).toContain('"database_name": "shop-stats"')
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
    }
    expect(pkg.name).toBe('shop-stats')
    expect(pkg.dependencies.analytik).toBe('^1.4.2')
    expect(readFileSync(join(dir, '.dev.vars'), 'utf8')).toMatch(/^ADMIN_PASSWORD=0+1\nSESSION_SECRET=0+2\n$/)
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.dev.vars')
    expect(readFileSync(join(dir, 'src/worker.ts'), 'utf8')).toContain('withDashboard')
  })

  it('refuses a folder that already has files, and uses the password it is given', () => {
    const dir = temp('taken')
    createProject({ dir, version: '1.0.0', deploy: false, password: 'my-own' }, fakeIo().io)
    expect(readFileSync(join(dir, '.dev.vars'), 'utf8')).toContain('ADMIN_PASSWORD=my-own\n')
    expect(() => createProject({ dir, version: '1.0.0', deploy: false }, fakeIo().io)).toThrow('is not empty')
  })

  it('installs, creates the database, deploys, then sets the secrets and removes the temporary file', () => {
    const dir = temp('shop-stats')
    const { io, calls, secrets } = fakeIo()
    const result = createProject({ dir, version: '1.0.0', deploy: true, password: 'pw' }, io)
    expect(
      calls.map((call) => [call.command, ...call.args.filter((arg) => arg !== '--no-install')].slice(0, 4).join(' ')),
    ).toEqual([
      'npm install --no-audit --no-fund',
      'npx wrangler whoami',
      'npx wrangler d1 create',
      'npx wrangler deploy',
      'npx wrangler secret bulk',
    ])
    expect(result.url).toBe('https://shop-stats.jan.workers.dev')
    expect(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')).toContain(`"database_id": "${DB_ID}"`)
    expect(JSON.parse(secrets())).toEqual({
      ADMIN_PASSWORD: 'pw',
      SESSION_SECRET: `${'0'.repeat(63)}1`,
    })
    expect(existsSync(join(dir, '.secrets.tmp.json'))).toBe(false)
  })

  it('signs in first when wrangler is not logged in, and reuses a database that already exists', () => {
    const dir = temp('again')
    const { io, calls } = fakeIo({
      whoami: { output: 'You are not authenticated. Please run `wrangler login`.' },
      'd1 create': { status: 1, output: 'A database with that name already exists' },
      'd1 info': { output: `{"uuid": "${DB_ID}"}` },
    })
    createProject({ dir, version: '1.0.0', deploy: true }, io)
    const used = calls.map((call) =>
      call.args
        .filter((arg) => arg !== '--no-install' && arg !== 'wrangler')
        .slice(0, 2)
        .join(' '),
    )
    expect(used).toContain('login')
    expect(used).toContain('d1 info')
    expect(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')).toContain(DB_ID)
  })

  it('names the step that failed and keeps the project', () => {
    const dir = temp('broken')
    const { io } = fakeIo({ deploy: { status: 1, output: 'boom' } })
    expect(() => createProject({ dir, version: '1.0.0', deploy: true }, io)).toThrow(/Deploying the Worker failed/)
    expect(existsSync(join(dir, 'wrangler.jsonc'))).toBe(true)
    const noDatabase = fakeIo({ 'd1 create': { status: 1, output: 'denied' }, 'd1 info': { status: 1 } })
    expect(() => createProject({ dir: temp('nodb'), version: '1.0.0', deploy: true }, noDatabase.io)).toThrow(
      /Creating the database failed/,
    )
  })
})

describe('upgrading a project', () => {
  /** Installs "the newest version" by writing it where the package manager would. */
  function installer(version: string) {
    const { io, calls, logs } = fakeIo()
    const run: CreateIo['run'] = (command, args, options) => {
      calls.push({ command, args })
      if (args.includes('analytik@latest')) {
        mkdirSync(join(options.cwd, 'node_modules/analytik'), { recursive: true })
        writeFileSync(join(options.cwd, 'node_modules/analytik/package.json'), JSON.stringify({ version }))
      }
      return { status: args.includes('fail') ? 1 : 0, output: '' }
    }
    return { io: { ...io, run }, calls, logs }
  }

  it("installs the newest version with the project's package manager, then deploys a Worker", () => {
    const dir = temp('stats')
    createProject({ dir, version: '1.1.0', deploy: false }, fakeIo().io)
    writeFileSync(join(dir, 'bun.lock'), '')
    const { io, calls } = installer('1.2.0')
    expect(upgradeProject({ dir, deploy: true }, io)).toEqual({ from: null, to: '1.2.0' })
    expect(calls).toEqual([
      { command: 'bun', args: ['add', 'analytik@latest'] },
      { command: 'npx', args: ['--no-install', 'wrangler', 'deploy'] },
    ])
  })

  it('picks pnpm, yarn or npm by lockfile, and can skip the deploy', () => {
    for (const [lock, command] of [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm'],
    ] as const) {
      const dir = temp(command)
      createProject({ dir, version: '1.1.0', deploy: false }, fakeIo().io)
      writeFileSync(join(dir, lock), '')
      const { io, calls } = installer('1.2.0')
      upgradeProject({ dir, deploy: false }, io)
      expect(calls.map((call) => call.command)).toEqual([command])
    }
  })

  it('tells a Vercel project how to deploy, reports no change, and names what failed', () => {
    const dir = temp('vercel')
    createProject({ dir, target: 'vercel', version: '1.1.0', deploy: false }, fakeIo().io)
    const { io, logs } = installer('1.1.0')
    mkdirSync(join(dir, 'node_modules/analytik'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/analytik/package.json'), JSON.stringify({ version: '1.1.0' }))
    expect(upgradeProject({ dir, deploy: true }, io)).toEqual({ from: '1.1.0', to: '1.1.0' })
    expect(logs.join('\n')).toContain('npx vercel --prod')
    expect(() => upgradeProject({ dir: temp('empty'), deploy: false }, io)).toThrow('is not an Analytik project')
    const failing: CreateIo = { ...io, run: () => ({ status: 1, output: '' }) }
    expect(() => upgradeProject({ dir, deploy: false }, failing)).toThrow('Installing the new version failed')
    const worker = temp('worker')
    createProject({ dir: worker, version: '1.1.0', deploy: false }, fakeIo().io)
    const deployFails: CreateIo = {
      ...io,
      run: (_command, args) => ({ status: args.includes('deploy') ? 1 : 0, output: '' }),
    }
    expect(() => upgradeProject({ dir: worker, deploy: true }, deployFails)).toThrow('Deploying failed')
  })

  it('ships a Dependabot config so a deploy button copy hears about new versions', () => {
    const dir = temp('bot')
    createProject({ dir, version: '1.1.0', deploy: false }, fakeIo().io)
    expect(readFileSync(join(dir, '.github/dependabot.yml'), 'utf8')).toContain('dependency-name: analytik')
  })
})

describe('the Vercel project', () => {
  it('writes the function, the rewrite and the secrets, and never runs anything', () => {
    const dir = temp('shop-stats')
    const { io, calls } = fakeIo()
    const result = createProject({ dir, target: 'vercel', version: '1.2.0', deploy: true, password: 'pw' }, io)
    expect(calls).toEqual([])
    expect(result.name).toBe('shop-stats')
    expect(readFileSync(join(dir, 'api/index.ts'), 'utf8')).toContain('withDashboard(app)')
    expect(readFileSync(join(dir, 'vercel.json'), 'utf8')).toContain('"destination": "/api"')
    expect(readFileSync(join(dir, '.env'), 'utf8')).toMatch(
      /^ADMIN_PASSWORD=pw\nSESSION_SECRET=0+1\n.*\nDATABASE_URL=\n$/s,
    )
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.env')
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
    }
    expect(pkg).toMatchObject({ name: 'shop-stats', dependencies: { analytik: '^1.2.0' } })
    expect(existsSync(join(dir, 'wrangler.jsonc'))).toBe(false)
  })
})

describe('the create command', () => {
  it('writes a project from the command line', async () => {
    const dir = temp('from-cli')
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        'bun',
        ['src/cli.ts', 'create', dir, '--no-deploy', '--password', 'hunter22'],
        { cwd: packageDir },
        (error, stdout, stderr) => (error ? reject(new Error(stderr)) : resolve(stdout)),
      )
    })
    expect(output).toContain('Sign in with the password: hunter22')
    expect(existsSync(join(dir, 'src/worker.ts'))).toBe(true)
  })

  it('takes a target, and refuses an unknown one', async () => {
    const run = (...args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        execFile('bun', ['src/cli.ts', 'create', ...args], { cwd: packageDir }, (error, stdout, stderr) =>
          resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
        )
      })
    const vercel = temp('vercel-cli')
    const made = await run(vercel, '--target', 'vercel')
    expect(made.code).toBe(0)
    expect(made.stdout).toContain('npx vercel')
    expect(existsSync(join(vercel, 'api/index.ts'))).toBe(true)
    const refused = await run(temp('nope'), '--target', 'heroku')
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('--target must be one of cloudflare, vercel')
  })
})
