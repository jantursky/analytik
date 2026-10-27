import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CreateOptions {
  /** Where the project is written; must be missing or empty. */
  dir: string
  /** The Worker and database name. Defaults to the folder's name. */
  name?: string
  /** The analytik version the project depends on. */
  version: string
  /** Install, create the database, deploy and set the secrets. Off, only the files are written. */
  deploy: boolean
  /** The dashboard password; a random one is made when missing. */
  password?: string
}

export interface CreateResult {
  dir: string
  name: string
  password: string
  /** The Worker's address, when it was deployed and wrangler printed it. */
  url?: string
}

export interface CreateIo {
  /** Runs a command in `cwd`. `capture` returns its output instead of showing it; the output is still echoed to `log`. */
  run: (
    command: string,
    args: string[],
    options: { cwd: string; capture?: boolean },
  ) => { status: number; output: string }
  log: (message: string) => void
  /** Random bytes as hex. */
  random: (bytes: number) => string
}

export const realIo: CreateIo = {
  run: () => ({ status: 1, output: '' }),
  log: (message) => console.log(message),
  random: (bytes) => randomBytes(bytes).toString('hex'),
}

/** The project files ship in the package, next to `dist`; from source they sit two folders up. */
function templateDir(): string {
  for (const relative of ['../templates/cloudflare', '../../templates/cloudflare']) {
    const path = fileURLToPath(new URL(relative, import.meta.url))
    if (existsSync(path)) return path
  }
  throw new Error('the Cloudflare project template is missing from this installation')
}

/** A Worker name Cloudflare accepts: lowercase letters, digits and dashes. */
export function workerName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return name.slice(0, 54) || 'analytik'
}

function rewrite(path: string, change: (text: string) => string): void {
  writeFileSync(path, change(readFileSync(path, 'utf8')))
}

/** Writes the project: the template with the name and version filled in, local secrets in `.dev.vars`, a `.gitignore`. */
export function scaffold(
  options: CreateOptions,
  io: CreateIo,
): { name: string; password: string; sessionSecret: string } {
  const dir = resolve(options.dir)
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${options.dir} exists and is not empty`)
  const name = workerName(options.name ?? basename(dir))
  cpSync(templateDir(), dir, { recursive: true })
  rewrite(join(dir, 'wrangler.jsonc'), (text) =>
    text
      .replace('"name": "analytik"', `"name": "${name}"`)
      .replace('"database_name": "analytik"', `"database_name": "${name}"`),
  )
  rewrite(join(dir, 'package.json'), (text) =>
    text
      .replace('"name": "analytik-worker"', `"name": "${name}"`)
      .replace('"analytik": "^1.1.0"', `"analytik": "^${options.version}"`),
  )
  const password = options.password ?? io.random(10)
  const sessionSecret = io.random(32)
  writeFileSync(join(dir, '.dev.vars'), `ADMIN_PASSWORD=${password}\nSESSION_SECRET=${sessionSecret}\n`)
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.wrangler\n.dev.vars\n')
  return { name, password, sessionSecret }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

/**
 * Makes a Cloudflare project that serves the dashboard, and by default puts it online: installs the packages, signs
 * in to Cloudflare when needed, creates the D1 database, deploys the Worker and sets the two secrets.
 */
export function createProject(options: CreateOptions, io: CreateIo): CreateResult {
  const { name, password, sessionSecret } = scaffold(options, io)
  const dir = resolve(options.dir)
  const result: CreateResult = { dir, name, password }
  io.log(`Created ${options.dir}`)
  if (!options.deploy) return result

  const step = (label: string, command: string, args: string[], capture = false): string => {
    io.log(`\n${label}`)
    const { status, output } = io.run(command, args, { cwd: dir, capture })
    if (capture && output) io.log(output.trim())
    if (status !== 0) {
      throw new Error(
        `${label} failed. The project is in ${options.dir}; fix the problem, then run the rest by hand (see its README).`,
      )
    }
    return output
  }
  const wrangler = (label: string, args: string[], capture = false) =>
    step(label, 'npx', ['--no-install', 'wrangler', ...args], capture)

  step('Installing packages', 'npm', ['install', '--no-audit', '--no-fund'])
  const who = io.run('npx', ['--no-install', 'wrangler', 'whoami'], { cwd: dir, capture: true })
  if (who.status !== 0 || /not authenticated|not logged in/i.test(who.output))
    wrangler('Signing in to Cloudflare', ['login'])

  const created = io.run('npx', ['--no-install', 'wrangler', 'd1', 'create', name], { cwd: dir, capture: true })
  io.log(`\nCreating the database "${name}"\n${created.output.trim()}`)
  let id = UUID.exec(created.output)?.[0]
  if (!id) {
    // Already there from an earlier run: ask for its id.
    const info = io.run('npx', ['--no-install', 'wrangler', 'd1', 'info', name, '--json'], { cwd: dir, capture: true })
    id = UUID.exec(info.output)?.[0]
  }
  if (!id)
    throw new Error(
      `Creating the database failed. The project is in ${options.dir}; run \`npx wrangler d1 create ${name}\` and put the id in wrangler.jsonc.`,
    )
  rewrite(join(dir, 'wrangler.jsonc'), (text) =>
    text.replace(/("database_name": "[^"]+")/, `$1,\n      "database_id": "${id}"`),
  )

  const deployed = wrangler('Deploying the Worker', ['deploy'], true)
  result.url = /https:\/\/[\w.-]+\.workers\.dev/.exec(deployed)?.[0]

  const secrets = join(dir, '.secrets.tmp.json')
  writeFileSync(secrets, JSON.stringify({ ADMIN_PASSWORD: password, SESSION_SECRET: sessionSecret }))
  try {
    wrangler('Setting the secrets', ['secret', 'bulk', secrets])
  } finally {
    rmSync(secrets, { force: true })
  }
  return result
}
