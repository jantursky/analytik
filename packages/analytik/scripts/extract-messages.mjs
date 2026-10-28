// Lists every English string the dashboard translates: the first argument of each `t('...')` and `msg('...')` call in
// src/dashboard. Run it to see what a catalog in src/dashboard/locales must hold; the locale test uses the same list.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CALL = /(?<![\w.$])(?:t|msg)\(\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'locales') yield* files(path)
    } else if (/\.tsx?$/.test(name) && name !== 'i18n.ts' && name !== 'flags-data.ts') yield path
  }
}

const unescape = (text) => text.replace(/\\([\s\S])/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c)

// Channel names come from shared/channels.ts and are translated where they are shown, so no call names them here.
const EXTRA = ['Direct', 'Organic Search', 'Organic Social', 'AI', 'Referral', 'Email', 'Paid']

/** Every translatable string with the files that use it, sorted. Strings with `${}` are skipped: they are not keys. */
export function extractMessages() {
  const found = new Map()
  for (const file of files(join(root, 'src/dashboard'))) {
    const source = readFileSync(file, 'utf8')
    for (const [, quote, raw] of source.matchAll(CALL)) {
      if (quote === '`' && raw.includes('${')) continue
      const key = unescape(raw)
      found.set(key, [...(found.get(key) ?? []), file.slice(root.length + 1)])
    }
  }
  for (const key of EXTRA) found.set(key, [...(found.get(key) ?? []), 'src/shared/channels.ts'])
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const messages = extractMessages()
  console.log(JSON.stringify(Object.fromEntries([...messages.keys()].map((key) => [key, ''])), null, 2))
  console.error(`${messages.size} strings`)
}
