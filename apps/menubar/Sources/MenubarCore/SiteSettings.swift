import Foundation

/// A key that opens the popover from any app, in Carbon's terms (a virtual key code and a modifier mask).
public struct Shortcut: Codable, Equatable, Sendable {
  public static let command: UInt32 = 256
  public static let shift: UInt32 = 512
  public static let option: UInt32 = 2048
  public static let control: UInt32 = 4096

  public var keyCode: UInt32
  public var modifiers: UInt32

  public init(keyCode: UInt32, modifiers: UInt32) {
    self.keyCode = keyCode
    self.modifiers = modifiers
  }

  /// A shortcut needs Command, Option or Control; Shift alone would swallow capital letters in every app.
  public var isValid: Bool { modifiers & (Self.command | Self.option | Self.control) != 0 }
}

/// When to send a notification. Each is off until a number is chosen.
public struct AlertRules: Codable, Equatable, Sendable {
  /// Visitors up by at least this many percent against the same time yesterday.
  public var jumpPercent: Int?
  /// Visitors down by at least this many percent against the same time yesterday.
  public var dropPercent: Int?
  /// The server hasn't answered for this many minutes.
  public var downMinutes: Int?

  public init(jumpPercent: Int? = nil, dropPercent: Int? = nil, downMinutes: Int? = nil) {
    self.jumpPercent = jumpPercent
    self.dropPercent = dropPercent
    self.downMinutes = downMinutes
  }

  public var isOn: Bool { jumpPercent != nil || dropPercent != nil || downMinutes != nil }

  public static let percentChoices = [25, 50, 100, 200]
  public static let downChoices = [5, 15, 30, 60]
}

public enum AlertKind: String, Sendable, CaseIterable {
  case jump, drop, serverDown
}

public struct AlertEvent: Equatable, Sendable {
  public let kind: AlertKind
  public let title: String
  public let body: String
}

/// Decides when an alert fires, with no clock and no network of its own. Each alert fires once, then stays quiet
/// until its condition has cleared.
public struct AlertEvaluator: Sendable {
  /// Below this many visitors in the same stretch of yesterday a percentage means nothing.
  public static let minimumVisitors = 20.0

  private var fired: Set<AlertKind> = []
  private var downSince: Date?

  public init() {}

  public mutating func evaluate(
    status: Status, rules: AlertRules, siteName: String, now: Date, macOnline: Bool
  ) -> [AlertEvent] {
    var events: [AlertEvent] = []
    var snapshot: Snapshot?
    var failed = false
    switch status {
    case .ready(let s), .refreshing(let s): snapshot = s
    case .stale(let s, let error): snapshot = s; failed = Self.noAnswer(error)
    case .failed(let error): failed = Self.noAnswer(error)
    case .notSetUp, .loading: break
    }

    // The server: counted from the first failure while the Mac was online.
    if !macOnline || !failed { downSince = nil } else if downSince == nil { downSince = now }
    if let minutes = rules.downMinutes, let since = downSince, now.timeIntervalSince(since) >= Double(minutes) * 60 {
      if fired.insert(.serverDown).inserted {
        events.append(AlertEvent(kind: .serverDown, title: "\(siteName) isn't answering", body: "No answer from the server for \(minutes) minutes."))
      }
    } else if downSince == nil {
      fired.remove(.serverDown)
    }

    // Traffic, from the pace; stale numbers are not fresh news.
    if !failed, let pace = snapshot?.pace {
      let enough = pace.previous >= Self.minimumVisitors
      let change = enough ? (pace.current - pace.previous) / pace.previous * 100 : 0
      if let limit = rules.jumpPercent, enough, change >= Double(limit) {
        if fired.insert(.jump).inserted {
          events.append(AlertEvent(kind: .jump, title: "\(siteName) traffic is up", body: "\(Int(pace.current)) visitors so far, \(Int(change.rounded()))% more than at this time yesterday."))
        }
      } else { fired.remove(.jump) }
      if let limit = rules.dropPercent, enough, -change >= Double(limit) {
        if fired.insert(.drop).inserted {
          events.append(AlertEvent(kind: .drop, title: "\(siteName) traffic is down", body: "\(Int(pace.current)) visitors so far, \(Int((-change).rounded()))% fewer than at this time yesterday."))
        }
      } else { fired.remove(.drop) }
    }
    return events
  }

  /// An unanswered request: no connection, a server error or a broken answer. A refused link is not an outage.
  private static func noAnswer(_ error: StatsError) -> Bool {
    switch error {
    case .offline, .server, .malformed: true
    case .accessRefused, .notSetUp: false
    }
  }
}
