// Releases and deploys from the command line, the same steps CI runs.
//   node scripts/release.js check             verify the release is ready and run every check
//   node scripts/release.js tag               check, then tag the version and push: CI publishes to npm and creates the GitHub release
//   node scripts/release.js publish           check, then publish to npm from this machine (no provenance; needs `npm login`)
//   node scripts/release.js menubar <x.y.z>   tag the Mac app: CI builds it and creates its GitHub release
//   node scripts/release.js deploy [demo|docs|all]   deploy to Vercel production (`vercel login` first)
// Flags: --skip-checks (verify the state only), --dry-run (print what would be pushed, published or deployed).
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const [mode = 'check', target] = args.filter((a) => !a.startsWith('--'))
const dryRun = flags.has('--dry-run')

// The Vercel team and projects (identifiers, not secrets). Each project has its own root directory, so a deploy from
// this folder names the project through the environment and leaves no .vercel folder or .env file behind.
const VERCEL_TEAM = 'team_K9StkqZREJ9hVsKscavg7bgs'
const SITES = { demo: 'prj_Y5UdYxvubdHf7EejHAWkdj8TRFBU', docs: 'prj_FLtD8tqLJUTeKBMLd2zXehY6tW7o' }

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

function out(command, commandArgs, cwd = root) {
  return execFileSync(command, commandArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function run(command, commandArgs, cwd = root) {
  console.log(`\n$ ${[command, ...commandArgs].join(' ')}`)
  if (spawnSync(command, commandArgs, { cwd, stdio: 'inherit' }).status !== 0)
    fail(`"${command} ${commandArgs[0]}" failed`)
}

/** Runs a step that changes something outside this folder, or only prints it with --dry-run. */
function outward(command, commandArgs, cwd = root) {
  if (dryRun) console.log(`\n[dry run] $ ${[command, ...commandArgs].join(' ')}`)
  else run(command, commandArgs, cwd)
}

const version = JSON.parse(readFileSync(join(root, 'packages/analytik/package.json'), 'utf8')).version

function verify({ npm }) {
  if (out('git', ['status', '--porcelain'])) fail('the working tree has uncommitted changes')
  if (out('git', ['branch', '--show-current']) !== 'main') fail('release from the main branch')
  out('git', ['fetch', 'origin', 'main', '--tags'])
  if (out('git', ['rev-parse', 'HEAD']) !== out('git', ['rev-parse', 'origin/main'])) {
    fail('main is not the same as origin/main: pull or push first')
  }
  if (!readFileSync(join(root, 'packages/analytik/CHANGELOG.md'), 'utf8').includes(`## [${version}]`)) {
    fail(`CHANGELOG.md has no section for ${version}`)
  }
  if (npm) {
    if (out('git', ['tag', '--list', version])) fail(`the tag ${version} already exists`)
    let published = ''
    try {
      published = out('npm', ['view', `analytik@${version}`, 'version'])
    } catch {
      // not on npm: expected
    }
    if (published) fail(`analytik@${version} is already on npm`)
  }
  console.log(`Ready to release ${version}.`)
}

function checks() {
  // The same steps as the npm job in release.yml and the CI workflow.
  run('bun', ['run', 'build:lib'])
  run('bun', ['run', 'check'])
  run('bun', ['run', 'test:browser'])
  run('bun', ['run', 'build'])
  run('bun', ['run', 'lint:package'])
  run('bun', ['run', 'test:pack'])
  run('bun', ['run', 'test:e2e'])
}

function prepare() {
  verify({ npm: true })
  if (flags.has('--skip-checks')) console.log('Skipping the checks.')
  else checks()
}

switch (mode) {
  case 'check':
    prepare()
    break
  case 'tag':
    prepare()
    outward('git', ['tag', version])
    outward('git', ['push', 'origin', 'main', version])
    console.log(`Tag ${version} pushed. CI publishes it: gh run watch`)
    break
  case 'publish':
    prepare()
    // The checks above already ran; prepublishOnly would repeat them.
    outward('npm', ['publish', '--access', 'public', '--ignore-scripts'], join(root, 'packages/analytik'))
    console.log(
      `Published analytik@${version}. Add the tag so the GitHub release exists: git tag ${version} && git push origin ${version}`,
    )
    break
  case 'menubar': {
    if (!/^\d+\.\d+\.\d+$/.test(target ?? '')) fail('usage: release.js menubar <x.y.z>')
    verify({ npm: false })
    run('swift', ['test'], join(root, 'apps/menubar'))
    outward('git', ['tag', `menubar-v${target}`])
    outward('git', ['push', 'origin', `menubar-v${target}`])
    break
  }
  case 'deploy': {
    const names = target === undefined || target === 'all' ? Object.keys(SITES) : [target]
    for (const name of names) if (!SITES[name]) fail(`deploy demo, docs or all, not "${name}"`)
    for (const name of names) {
      process.env.VERCEL_ORG_ID = VERCEL_TEAM
      process.env.VERCEL_PROJECT_ID = SITES[name]
      console.log(`\nDeploying ${name}`)
      outward('vercel', ['deploy', '--prod', '--yes'])
    }
    break
  }
  default:
    fail(`unknown mode "${mode}" (check, tag, publish, menubar, deploy)`)
}
