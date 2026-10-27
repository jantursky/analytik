import { createContext, type ReactNode, useEffect, useState } from 'react'

import { createClient } from '../client/index'
import { noopEngine } from '../tracker/engine'
import type { Analytik, AnalytikOptions } from '../tracker/types'
import { createDeferred } from './deferred'

export const AnalytikContext = createContext<Analytik>(noopEngine)

export type AnalytikProviderProps = { children?: ReactNode } & (
  | { /** A client you created with `createClient()`; the provider does not destroy it. */ client: Analytik }
  | (AnalytikOptions & { client?: undefined })
)

/** Provides a client to `useAnalytik()`: the one passed in, or one created from the options (in an effect). */
export function AnalytikProvider({ children, client, ...options }: AnalytikProviderProps) {
  const [deferred] = useState(createDeferred)
  // Options are plain data, so a serialized key recreates the client only when they really change.
  const optionsKey = client ? '' : JSON.stringify(options)

  useEffect(() => {
    if (optionsKey) return deferred.attach(createClient(JSON.parse(optionsKey) as AnalytikOptions))
  }, [deferred, optionsKey])

  return <AnalytikContext value={client ?? deferred}>{children}</AnalytikContext>
}
