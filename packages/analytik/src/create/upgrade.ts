import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { CreateIo } from './index'

export interface UpgradeOptions {
  /** The project folder. */
  dir: string
  /** Deploy after updating (Cloudflare projects; others are told how). */
  deploy: boolean
}

type Manager = 'bun' | 'pnpm' | 'yarn' | 'npm'

const COMMANDS: Record<Manager, [string, string[]]> = {
  bun: ['bun', ['add', 'analytik@latest']],
  pnpm: ['pnpm', ['add', 'analytik@latest']],
  yarn: ['yarn', ['add', 'analytik@latest']],
  npm: ['npm', ['install', 'analytik@latest', '--no-audit', '--no-fund']],
}

function detectManager(dir: string): Manager {
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun'
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

const installed = (dir: string): string | null => {
  try {
    return (
      JSON.parse(readFileSync(join(dir, 'node_modules', 'analytik', 'package.json'), 'utf8')) as { version: string }
    ).version
  } catch {
    return null
  }
}

/**
 * Moves a project to the newest Analytik: installs `analytik@latest` with the package manager the project uses and,
 * for a Cloudflare project, deploys it. The database schema updates itself on the first request after that.
 */
export function upgradeProject(options: UpgradeOptions, io: CreateIo): { from: string | null; to: string | null } {
  const dir = resolve(options.dir)
  const manifest = join(dir, 'package.json')
  if (
    !existsSync(manifest) ||
    !('analytik' in ((JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: object }).dependencies ?? {}))
  ) {
    throw new Error(`${options.dir} is not an Analytik project: its package.json has no analytik dependency`)
  }
  const from = installed(dir)
  const [command, args] = COMMANDS[detectManager(dir)]
  io.log(`Updating Analytik with ${command}`)
  if (io.run(command, args, { cwd: dir }).status !== 0) throw new Error('Installing the new version failed.')
  const to = installed(dir)
  io.log(from && to && from !== to ? `Analytik ${from} to ${to}` : `Analytik ${to ?? 'is'} up to date`)

  if (!options.deploy) return { from, to }
  if (existsSync(join(dir, 'wrangler.jsonc')) || existsSync(join(dir, 'wrangler.toml'))) {
    io.log('\nDeploying the Worker')
    if (io.run('npx', ['--no-install', 'wrangler', 'deploy'], { cwd: dir }).status !== 0) {
      throw new Error('Deploying failed. Run `npx wrangler deploy` yourself once the problem is fixed.')
    }
  } else if (existsSync(join(dir, 'vercel.json'))) {
    io.log('\nDeploy it with `npx vercel --prod`, or push to the repository the Vercel project is connected to.')
  } else {
    io.log('\nDeploy it the way you usually do.')
  }
  return { from, to }
}
