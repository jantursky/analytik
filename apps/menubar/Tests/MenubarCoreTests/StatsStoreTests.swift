import Foundation
import Testing

@testable import MenubarCore

/// Records the sleeps and then waits forever (until cancelled), so a test sees exactly how the loop paces itself.
actor FakeClock {
  private(set) var delays: [TimeInterval] = []
  func sleep(_ seconds: TimeInterval) async throws {
    delays.append(seconds)
    try await Task.sleep(for: .seconds(3600))
  }
}

actor Counter {
  private(set) var calls = 0
  func next() -> Int { calls += 1; return calls }
}

@MainActor func waitFor(_ what: String = "condition", _ condition: @MainActor () async -> Bool) async {
  for _ in 0..<500 {
    if await condition() { return }
    try? await Task.sleep(for: .milliseconds(10))
  }
  Issue.record("timed out waiting for \(what)")
}

struct RefreshPolicyTests {
  let policy = RefreshPolicy()

  @Test func closedIsAMinuteAndOpenIsTenSeconds() {
    #expect(policy.interval(isOpen: false, failures: 0) == 60)
    #expect(policy.interval(isOpen: true, failures: 0) == 10)
  }

  @Test func failuresDoubleTheWaitUpToTheCeiling() {
    #expect(policy.interval(isOpen: true, failures: 1) == 20)
    #expect(policy.interval(isOpen: true, failures: 3) == 80)
    #expect(policy.interval(isOpen: false, failures: 6) == 600)
    #expect(policy.interval(isOpen: false, failures: 50) == 600)
    #expect(policy.interval(isOpen: false, failures: -1) == 60)
  }
}

@MainActor struct StatsStoreTests {
  @Test func staysNotSetUpWithoutAFetcher() {
    let store = StatsStore()
    store.configure(fetch: nil)
    #expect(store.status == .notSetUp)
  }

  @Test func successShowsTheSnapshotAndClearsFailures() async {
    let store = StatsStore()
    store.configure(fetch: nil)
    store.configure(fetch: { Fixtures.snapshot })
    await store.refreshNow()
    #expect(store.status == .ready(Fixtures.snapshot))
    #expect(store.failures == 0)
    store.pause()
  }

  @Test func offlineKeepsTheLastNumbersMarkedStale() async {
    let calls = Counter()
    let store = StatsStore(sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
    store.configure(fetch: {
      if await calls.next() == 1 { return Fixtures.snapshot }
      throw StatsError.offline
    })
    await waitFor("first snapshot") { store.status == .ready(Fixtures.snapshot) }
    await store.refreshNow()
    #expect(store.status == .stale(Fixtures.snapshot, .offline))
    #expect(Format.menuBarTitle([store.status], number: .online) == "\u{2013}")
    #expect(store.failures == 1)
    store.pause()
  }

  @Test func aRefusedLinkClearsTheNumbers() async {
    let calls = Counter()
    let store = StatsStore(sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
    store.configure(fetch: {
      if await calls.next() == 1 { return Fixtures.snapshot }
      throw StatsError.accessRefused
    })
    await waitFor("first snapshot") { store.status == .ready(Fixtures.snapshot) }
    await store.refreshNow()
    #expect(store.status == .failed(.accessRefused))
    store.pause()
  }

  @Test func firstFailureWithNothingToShowIsFailed() async {
    let store = StatsStore(sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
    store.configure(fetch: { throw StatsError.server(500) })
    await waitFor("failure") { store.status == .failed(.server(500)) }
    store.pause()
  }

  @Test func loopPacesItselfByPopoverStateAndFailures() async {
    let clock = FakeClock()
    let store = StatsStore(sleep: { try await clock.sleep($0) })
    store.configure(fetch: { Fixtures.snapshot })
    await waitFor("closed pace") { await clock.delays == [60] }
    store.setOpen(true)  // Opening refreshes at once and then waits ten seconds.
    await waitFor("open pace") { await clock.delays == [60, 10] }
    store.setOpen(false)
    await waitFor("closed again") { await clock.delays == [60, 10, 60] }
    store.pause()
  }

  @Test func pauseStopsTheLoopAndResumeRefreshesAtOnce() async {
    let clock = FakeClock()
    let calls = Counter()
    let store = StatsStore(sleep: { try await clock.sleep($0) })
    store.configure(fetch: {
      _ = await calls.next()
      return Fixtures.snapshot
    })
    await waitFor("first refresh") { await calls.calls == 1 }
    store.pause()
    try? await Task.sleep(for: .milliseconds(50))
    #expect(await calls.calls == 1)
    store.resume()
    await waitFor("refresh after wake") { await calls.calls == 2 }
    store.pause()
  }

  @Test func settingOpenToTheSameValueDoesNothing() async {
    let calls = Counter()
    let store = StatsStore(sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
    store.configure(fetch: {
      _ = await calls.next()
      return Fixtures.snapshot
    })
    await waitFor("first refresh") { await calls.calls == 1 }
    store.setOpen(false)
    try? await Task.sleep(for: .milliseconds(50))
    #expect(await calls.calls == 1)
    store.pause()
  }

  @Test func userPauseStopsRequestsUntilResumed() async {
    let calls = Counter()
    let store = StatsStore(sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
    store.configure(fetch: {
      _ = await calls.next()
      return Fixtures.snapshot
    })
    await waitFor("first refresh") { await calls.calls == 1 }
    store.setUserPaused(true)
    store.setOpen(true)  // Opening the popover must not wake a paused store.
    try? await Task.sleep(for: .milliseconds(50))
    #expect(await calls.calls == 1)
    store.resume()  // Waking the Mac must not either.
    try? await Task.sleep(for: .milliseconds(50))
    #expect(await calls.calls == 1)
    store.setUserPaused(false)
    await waitFor("refresh after resume") { await calls.calls == 2 }
    store.pause()
  }

  @Test func aNewPolicyPacesTheNextWait() async {
    let clock = FakeClock()
    let store = StatsStore(sleep: { try await clock.sleep($0) })
    store.configure(fetch: { Fixtures.snapshot })
    await waitFor("default pace") { await clock.delays == [60] }
    var slower = RefreshPolicy()
    slower.closed = 300
    store.setPolicy(slower)
    await waitFor("new pace") { await clock.delays == [60, 300] }
    store.pause()
  }
}
