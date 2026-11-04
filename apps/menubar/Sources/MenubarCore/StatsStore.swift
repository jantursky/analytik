import Foundation
import Observation

/// What the UI shows.
public enum Status: Equatable, Sendable {
  case notSetUp
  case loading
  case ready(Snapshot)
  /// Numbers from an earlier refresh, shown because the latest one failed.
  case stale(Snapshot, StatsError)
  case failed(StatsError)
  /// A refresh is running on top of numbers already shown.
  case refreshing(Snapshot)
}

/// How often to refresh: every minute with the popover closed, every 10 seconds while it is open (the same lifetimes
/// the server gives shared answers), doubling after each failure up to ten minutes.
public struct RefreshPolicy: Equatable, Sendable {
  public var closed: TimeInterval = 60
  public var open: TimeInterval = 10
  public var ceiling: TimeInterval = 600

  public init() {}

  public func interval(isOpen: Bool, failures: Int) -> TimeInterval {
    let base = isOpen ? open : closed
    return min(ceiling, base * pow(2, Double(min(max(failures, 0), 6))))
  }
}

/// Keeps the numbers current. `fetch` and `sleep` are injected, so tests drive it without a network or a real clock.
@MainActor
@Observable
public final class StatsStore {
  public private(set) var status: Status = .notSetUp
  public private(set) var isOpen = false
  public private(set) var failures = 0

  public private(set) var policy: RefreshPolicy
  /// Called with the new status after every refresh, whether it worked or not.
  public var onUpdate: (@MainActor (Status) -> Void)?
  private let sleep: @Sendable (TimeInterval) async throws -> Void
  private var fetch: (@Sendable () async throws -> Snapshot)?
  private var loop: Task<Void, Never>?
  private var sleeping = false
  public private(set) var userPaused = false
  private var paused: Bool { sleeping || userPaused }

  public init(
    policy: RefreshPolicy = RefreshPolicy(),
    sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }
  ) {
    self.policy = policy
    self.sleep = sleep
  }

  /// Starts (or restarts) reading with `fetch`; nil means not set up.
  public func configure(fetch: (@Sendable () async throws -> Snapshot)?) {
    self.fetch = fetch
    failures = 0
    status = fetch == nil ? .notSetUp : .loading
    restart()
  }

  public func setOpen(_ open: Bool) {
    guard open != isOpen else { return }
    isOpen = open
    restart()  // Opening refreshes at once and speeds up; closing slows down.
  }

  /// The Mac is going to sleep: no point in asking the network.
  public func pause() {
    sleeping = true
    loop?.cancel()
    loop = nil
  }

  public func resume() {
    sleeping = false
    restart()
  }

  /// The user's own pause: nothing is requested until they resume.
  public func setUserPaused(_ value: Bool) {
    guard value != userPaused else { return }
    userPaused = value
    if value { loop?.cancel(); loop = nil } else { restart() }
  }

  public func setPolicy(_ policy: RefreshPolicy) {
    guard policy != self.policy else { return }
    self.policy = policy
    restart()
  }

  public func refreshNow() async {
    guard let fetch else { return }
    if case .ready(let snapshot) = status { status = .refreshing(snapshot) }
    if case .stale(let snapshot, _) = status { status = .refreshing(snapshot) }
    do {
      let snapshot = try await fetch()
      failures = 0
      status = .ready(snapshot)
    } catch is CancellationError {
      return
    } catch {
      failures += 1
      let reason = error as? StatsError ?? .malformed
      status = Self.after(failure: reason, from: status)
    }
    onUpdate?(status)
  }

  public var nextDelay: TimeInterval { policy.interval(isOpen: isOpen, failures: failures) }

  /// Numbers stay on screen through a lost connection or a server error; a refused link clears them, because
  /// whoever revoked it meant the access to end.
  static func after(failure: StatsError, from status: Status) -> Status {
    if failure == .accessRefused { return .failed(failure) }
    switch status {
    case .ready(let snapshot), .refreshing(let snapshot), .stale(let snapshot, _): return .stale(snapshot, failure)
    case .notSetUp, .loading, .failed: return .failed(failure)
    }
  }

  private func restart() {
    loop?.cancel()
    loop = nil
    guard fetch != nil, !paused else { return }
    loop = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await self.refreshNow()
        let delay = self.nextDelay
        do { try await self.sleep(delay) } catch { return }
      }
    }
  }
}
