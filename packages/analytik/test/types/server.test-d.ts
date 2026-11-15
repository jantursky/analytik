import { describe, expectTypeOf, it } from 'vitest'

import {
  createAnalytik,
  type Analytik,
  type AnalytikHooks,
  type CreateAnalytikOptions,
  type Storage,
} from '../../src/server'
import { d1Storage, type D1Like } from '../../src/storage/d1'
import { memoryStorage } from '../../src/storage/memory'

describe('analytik/server', () => {
  it('takes storage and returns the app', () => {
    expectTypeOf(createAnalytik).parameter(0).toEqualTypeOf<CreateAnalytikOptions>()
    expectTypeOf(createAnalytik).returns.toEqualTypeOf<Analytik>()
    expectTypeOf<CreateAnalytikOptions['storage']>().toEqualTypeOf<Storage>()
  })

  it('keeps everything but the storage optional', () => {
    expectTypeOf<{ storage: Storage }>().toExtend<CreateAnalytikOptions>()
  })

  it('types the hooks', () => {
    expectTypeOf<CreateAnalytikOptions['hooks']>().toEqualTypeOf<AnalytikHooks | undefined>()
    expectTypeOf<AnalytikHooks['onEvent']>().toBeNullable()
    expectTypeOf<NonNullable<AnalytikHooks['beforeIngest']>>().parameter(0).toHaveProperty('type')
    expectTypeOf<NonNullable<AnalytikHooks['beforeIngest']>>().returns.toExtend<unknown>()
    expectTypeOf<NonNullable<AnalytikHooks['onPayment']>>().parameter(0).toHaveProperty('amount')
  })

  it('rejects a hook of the wrong shape', () => {
    // @ts-expect-error a hook is a function
    const bad: AnalytikHooks = { onEvent: 'log' }
    expectTypeOf(bad).toEqualTypeOf<AnalytikHooks>()
  })

  it('has storages that return the same type', () => {
    expectTypeOf(memoryStorage).returns.toEqualTypeOf<Storage>()
    expectTypeOf(d1Storage).parameter(0).toEqualTypeOf<D1Like>()
    expectTypeOf(d1Storage).returns.toEqualTypeOf<Storage>()
  })
})
