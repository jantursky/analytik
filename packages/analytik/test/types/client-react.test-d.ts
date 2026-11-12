import { describe, expectTypeOf, it } from 'vitest'

import { createClient, type AnalytikClient, type AnalytikOptions } from '../../src/client'
import {
  AnalytikProvider,
  TrackClick,
  useAnalytik,
  useTrackPageviews,
  type AnalytikProviderProps,
} from '../../src/react'

describe('analytik/client', () => {
  it('creates a client from the options', () => {
    expectTypeOf(createClient).parameter(0).toEqualTypeOf<AnalytikOptions>()
    expectTypeOf(createClient).returns.toEqualTypeOf<AnalytikClient>()
  })

  it('has the tracking methods and destroy', () => {
    expectTypeOf<AnalytikClient['track']>().toBeFunction()
    expectTypeOf<AnalytikClient['revenue']>().toBeFunction()
    expectTypeOf<AnalytikClient['identify']>().toBeFunction()
    expectTypeOf<AnalytikClient['attribution']>().toBeFunction()
    expectTypeOf<AnalytikClient['destroy']>().toEqualTypeOf<() => void>()
  })

  it('needs a site', () => {
    expectTypeOf<AnalytikOptions>().toHaveProperty('site')
    expectTypeOf<AnalytikOptions['site']>().toEqualTypeOf<string>()
  })
})

describe('analytik/react', () => {
  it('exposes the provider, the hooks and the click wrapper', () => {
    expectTypeOf<AnalytikProviderProps>().toHaveProperty('children')
    expectTypeOf(AnalytikProvider).toBeFunction()
    expectTypeOf(TrackClick).toBeFunction()
    expectTypeOf(useTrackPageviews).toBeFunction()
    expectTypeOf(useAnalytik).returns.toHaveProperty('track')
  })
})
