import Foundation

/// A number with its value in the comparison period. Mirrors `Delta` in `shared/types.ts`.
public struct Delta: Decodable, Equatable, Sendable {
  public let value: Double
  public let previous: Double
  /// Relative change; nil when the previous value was 0.
  public let change: Double?

  public init(value: Double, previous: Double, change: Double?) {
    self.value = value
    self.previous = previous
    self.change = change
  }
}

/// The part of `GET /sites/:id/overview` the app shows. Other fields are ignored, so new server fields never break it.
public struct Overview: Decodable, Equatable, Sendable {
  public let visitors: Delta
  public let pageviews: Delta
  /// In minor units (cents) of `currency`.
  public let revenue: Delta
  public let currency: String
  public let online: Int
  /// Numbers the user may add to the headline; nil when the server doesn't send them.
  public let bounceRate: Delta?
  public let avgDurationMs: Delta?
  public let orders: Delta?
  public let conversionRate: Delta?

  public init(
    visitors: Delta, pageviews: Delta, revenue: Delta, currency: String, online: Int,
    bounceRate: Delta? = nil, avgDurationMs: Delta? = nil, orders: Delta? = nil, conversionRate: Delta? = nil
  ) {
    self.bounceRate = bounceRate
    self.avgDurationMs = avgDurationMs
    self.orders = orders
    self.conversionRate = conversionRate
    self.visitors = visitors
    self.pageviews = pageviews
    self.revenue = revenue
    self.currency = currency
    self.online = online
  }
}

/// The part of `GET /sites/:id/realtime` the app shows.
public struct Realtime: Decodable, Equatable, Sendable {
  public let online: Int
}

/// One row of `GET /sites/:id/breakdown?dimension=page`.
public struct PageRow: Decodable, Equatable, Sendable {
  public let key: String
  public let visitors: Int
  public let pageviews: Int

  public init(key: String, visitors: Int, pageviews: Int) {
    self.key = key
    self.visitors = visitors
    self.pageviews = pageviews
  }
}

public struct SiteInfo: Decodable, Equatable, Sendable {
  public let name: String
  public let timezone: String
}

/// One hour of today, from `GET /sites/:id/timeseries?interval=hour`.
public struct SeriesPoint: Decodable, Equatable, Sendable {
  public let ts: Double
  public let visitors: Double
  public let pageviews: Double
  /// In minor units, like the overview.
  public let revenue: Double

  public init(ts: Double, visitors: Double, pageviews: Double, revenue: Double) {
    self.ts = ts
    self.visitors = visitors
    self.pageviews = pageviews
    self.revenue = revenue
  }

  public var date: Date { Date(timeIntervalSince1970: ts / 1000) }

  public func value(_ metric: ChartMetric) -> Double {
    switch metric {
    case .visitors: visitors
    case .pageviews: pageviews
    case .revenue: revenue
    }
  }
}

struct SharedResponse: Decodable {
  let site: SiteInfo
}

/// Visitors (summed over the hours) in today so far and in the same elapsed time of yesterday.
public struct Pace: Equatable, Sendable {
  public let current: Double
  public let previous: Double

  public init(current: Double, previous: Double) {
    self.current = current
    self.previous = previous
  }
}

/// Everything the popover shows, taken at one moment.
public struct Snapshot: Equatable, Sendable {
  public let siteName: String
  /// The site's time zone, in which "today" and the hours of the chart are counted.
  public let timeZone: String
  public let overview: Overview
  /// Visitors online now, from the realtime route (fresher than the one in the overview).
  public let online: Int
  public let topPages: [PageRow]
  /// The chart's points (hours of today, or days); empty when the chart is off.
  public let series: [SeriesPoint]
  public let range: TimeRange
  public let fetchedAt: Date
  /// Visitors so far today against the same stretch of yesterday; only read when an alert needs it.
  public let pace: Pace?

  public init(
    siteName: String, timeZone: String = "UTC", overview: Overview, online: Int, topPages: [PageRow],
    series: [SeriesPoint] = [], range: TimeRange = .today, fetchedAt: Date, pace: Pace? = nil
  ) {
    self.pace = pace
    self.range = range
    self.siteName = siteName
    self.timeZone = timeZone
    self.overview = overview
    self.online = online
    self.topPages = topPages
    self.series = series
    self.fetchedAt = fetchedAt
  }
}

/// Why a refresh failed. The four states the user can tell apart.
public enum StatsError: Error, Equatable, Sendable {
  case notSetUp
  case offline
  case accessRefused
  case server(Int)
  case malformed
}

/// Where to read from and with what.
public struct Credentials: Equatable, Sendable {
  public let baseURL: URL
  public let siteId: String
  public let token: String

  public init(baseURL: URL, siteId: String, token: String) {
    self.baseURL = baseURL
    self.siteId = siteId
    self.token = token
  }
}
