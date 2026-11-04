import Foundation

/// How wide the popover is. The height is fixed too; content scrolls.
public enum WindowWidth: String, Codable, CaseIterable, Sendable {
  case compact, regular, wide, extraWide

  public var points: Double {
    switch self {
    case .compact: 360
    case .regular: 440
    case .wide: 540
    case .extraWide: 680
    }
  }

  public var label: String {
    switch self {
    case .compact: "Compact"
    case .regular: "Regular"
    case .wide: "Wide"
    case .extraWide: "Extra wide"
    }
  }
}

public enum WindowHeight: String, Codable, CaseIterable, Sendable {
  case short, regular, tall

  public var points: Double {
    switch self {
    case .short: 520
    case .regular: 600
    case .tall: 720
    }
  }

  public var label: String { rawValue.capitalized }
}

public enum Density: String, Codable, CaseIterable, Sendable {
  case comfortable, compact

  public var label: String { rawValue.capitalized }
}

public enum ChartStyle: String, Codable, CaseIterable, Sendable {
  case area, line, bars

  public var label: String { rawValue.capitalized }
}

/// The period the numbers cover. The change is always against the period of the same length before it.
public enum TimeRange: String, Codable, CaseIterable, Sendable {
  case today, week, month

  public var label: String {
    switch self {
    case .today: "Today"
    case .week: "Last 7 days"
    case .month: "Last 30 days"
    }
  }

  public var days: Int {
    switch self {
    case .today: 1
    case .week: 7
    case .month: 30
    }
  }

  /// The chart's bucket: hours for one day, days for more.
  public var interval: String { self == .today ? "hour" : "day" }

  public var chartTitle: String { self == .today ? "Today by hour" : "\(label) by day" }

  public var comparison: String {
    switch self {
    case .today: "yesterday"
    case .week: "the 7 days before"
    case .month: "the 30 days before"
    }
  }
}

/// The big numbers at the top of the popover. The user picks which.
public enum HeadlineMetric: String, Codable, CaseIterable, Sendable {
  case visitors, pageviews, revenue, bounceRate, duration, orders, conversion

  public var title: String {
    switch self {
    case .visitors: "Visitors"
    case .pageviews: "Pageviews"
    case .revenue: "Revenue"
    case .bounceRate: "Bounce rate"
    case .duration: "Visit duration"
    case .orders: "Orders"
    case .conversion: "Conversion"
    }
  }

  /// A fall in the bounce rate is good news.
  public var lowerIsBetter: Bool { self == .bounceRate }

  public func delta(_ overview: Overview) -> Delta? {
    switch self {
    case .visitors: overview.visitors
    case .pageviews: overview.pageviews
    case .revenue: overview.revenue
    case .bounceRate: overview.bounceRate
    case .duration: overview.avgDurationMs
    case .orders: overview.orders
    case .conversion: overview.conversionRate
    }
  }

  /// The value as text, or nil when the server didn't send this number.
  public func text(_ overview: Overview, compact: Bool = true, locale: Locale = .current) -> String? {
    guard let value = delta(overview)?.value else { return nil }
    switch self {
    case .visitors, .pageviews, .orders: return Format.number(value, compact: compact, locale: locale)
    case .revenue: return Format.money(minor: value, currency: overview.currency, locale: locale)
    case .bounceRate, .conversion: return Format.percent(value, locale: locale)
    case .duration: return Format.duration(milliseconds: value)
    }
  }
}

extension Format {
  /// A share from 0 to 1 as a percentage: whole above 10 %, one decimal below.
  public static func percent(_ share: Double, locale: Locale = .current) -> String {
    let percent = share * 100
    let text = percent.formatted(.number.precision(.fractionLength(percent >= 10 ? 0 : 1)).locale(locale))
    return "\(text)%"
  }

  /// "45s", "3m 12s", "1h 5m".
  public static func duration(milliseconds: Double) -> String {
    let seconds = Int((milliseconds / 1000).rounded())
    if seconds < 60 { return "\(seconds)s" }
    if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
    return "\(seconds / 3600)h \(seconds % 3600 / 60)m"
  }
}
