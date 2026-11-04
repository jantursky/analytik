import Foundation

/// Text for the numbers the app shows. Pure functions, so they are tested without a window.
public enum Format {
  /// Whole numbers below 10,000 (1,234), compact above (12.3K); `compact: false` always writes every digit.
  public static func number(_ value: Double, compact: Bool = true, locale: Locale = .current) -> String {
    if !compact || abs(value) < 10_000 {
      return value.formatted(.number.grouping(.automatic).precision(.fractionLength(0)).locale(locale))
    }
    return value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)).locale(locale))
  }

  /// An amount in minor units (cents) of `currency`: 12345 USD is $123.45, 500 JPY is ¥500.
  public static func money(minor: Double, currency: String, locale: Locale = .current) -> String {
    let formatter = NumberFormatter()
    formatter.locale = locale
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    let digits = formatter.maximumFractionDigits
    if minor.truncatingRemainder(dividingBy: pow(10, Double(digits))) == 0 { formatter.minimumFractionDigits = 0 }
    return formatter.string(from: NSNumber(value: minor / pow(10, Double(digits)))) ?? "\(minor) \(currency)"
  }

  public enum Trend: Equatable, Sendable {
    case up, down, flat, none
  }

  /// "+12%" / "−3%" / "0%" against the comparison period; nil when there is nothing to compare with.
  public static func change(_ delta: Delta) -> (text: String, trend: Trend)? {
    guard let change = delta.change else { return nil }
    let percent = Int((change * 100).rounded())
    if percent > 0 { return ("+\(percent)%", .up) }
    if percent < 0 { return ("\u{2212}\(abs(percent))%", .down) }
    return ("0%", .flat)
  }

  /// "just now", "2 min ago", "3 h ago": how old the shown numbers are.
  public static func age(of date: Date, now: Date) -> String {
    let seconds = max(0, now.timeIntervalSince(date))
    if seconds < 90 { return "just now" }
    if seconds < 3600 { return "\(Int(seconds / 60)) min ago" }
    return "\(Int(seconds / 3600)) h ago"
  }

  /// What the menu bar shows next to the icon. `statuses` are the sites in play (the selected one, or all of them).
  /// Only sites with real numbers count; with none, a dash, because a stale count would be a false one.
  public static func menuBarTitle(
    _ statuses: [Status], number: MenuBarNumber, paused: Bool = false, locale: Locale = .current
  ) -> String {
    if paused { return "\u{23F8}" }
    if number == .none { return "" }
    let snapshots: [Snapshot] = statuses.compactMap {
      switch $0 {
      case .ready(let snapshot), .refreshing(let snapshot): snapshot
      default: nil
      }
    }
    guard !snapshots.isEmpty else { return "\u{2013}" }
    let online = snapshots.reduce(0) { $0 + $1.online }
    switch number {
    case .online, .none:
      return String(online)
    case .visitors:
      return Format.number(snapshots.reduce(0) { $0 + $1.overview.visitors.value }, locale: locale)
    case .revenue:
      let currencies = Set(snapshots.map(\.overview.currency))
      // Amounts in different currencies can't be added; show the online count instead of a wrong total.
      guard currencies.count == 1, let currency = currencies.first else { return String(online) }
      return Format.money(minor: snapshots.reduce(0) { $0 + $1.overview.revenue.value }, currency: currency, locale: locale)
    }
  }

  /// One sentence for each way a refresh can fail.
  public static func message(_ error: StatsError) -> String {
    switch error {
    case .notSetUp: return "Add your server, site and share link to start."
    case .offline: return "Can't reach the server. Showing the last numbers."
    case .accessRefused: return "The server refused this share link. It may be revoked, expired or for another site."
    case .server(let code): return "The server answered with an error (\(code))."
    case .malformed: return "The server's answer wasn't what the app expects. Is the server URL right?"
    }
  }
}
