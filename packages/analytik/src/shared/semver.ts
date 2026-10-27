const parts = (version: string): number[] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version.trim())
  // A pre-release (1.2.0-rc.1) is never offered as an update.
  return match && !match[4] ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Whether `latest` is a newer release than `current`; false when either is not a plain x.y.z version. */
export function isNewer(latest: string, current: string): boolean {
  const next = parts(latest)
  const now = parts(current.replace(/-.+$/, ''))
  if (!next || !now) return false
  for (let i = 0; i < 3; i++) {
    const a = next[i] ?? 0
    const b = now[i] ?? 0
    if (a !== b) return a > b
  }
  return false
}
