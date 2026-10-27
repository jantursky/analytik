import type { AnalytikClient, AnalytikGlobal } from './types'

type Command = (...args: unknown[]) => unknown

/** Wraps a client as `window.analytik`: a command function with the methods attached. */
export function toGlobal(client: AnalytikClient): AnalytikGlobal {
  const { destroy: _destroy, ...api } = client
  const methods = api as unknown as Record<string, Command | undefined>
  const fn = (command: string, ...args: unknown[]): unknown => methods[command]?.(...args)
  return Object.assign(fn, api)
}

/** Replays `analytik(...)` calls made before the script loaded. */
export function replay(global: AnalytikGlobal, queue: readonly ArrayLike<unknown>[]): void {
  for (const args of queue) (global as Command)(...Array.from(args))
}
