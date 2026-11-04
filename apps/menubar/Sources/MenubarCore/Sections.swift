import Foundation

/// The tabs of the popover. Overview comes from the snapshot; each other tab lists breakdowns of one or more
/// dimensions, read when the tab is open.
public enum PanelSection: String, Codable, CaseIterable, Sendable, Identifiable {
  case overview, pages, sources, places, tech

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .overview: "Overview"
    case .pages: "Pages"
    case .sources: "Sources"
    case .places: "Places"
    case .tech: "Tech"
    }
  }

  public struct Block: Equatable, Sendable {
    public let title: String
    /// A dimension of `GET /sites/:id/breakdown`.
    public let dimension: String
  }

  public var blocks: [Block] {
    switch self {
    case .overview: []
    case .pages: [Block(title: "Pages", dimension: "page"), Block(title: "Entry pages", dimension: "entry"), Block(title: "Exit pages", dimension: "exit")]
    case .sources: [Block(title: "Channels", dimension: "channel"), Block(title: "Sources", dimension: "source"), Block(title: "Campaigns", dimension: "campaign")]
    case .places: [Block(title: "Countries", dimension: "country"), Block(title: "Cities", dimension: "city")]
    case .tech: [Block(title: "Browsers", dimension: "browser"), Block(title: "Systems", dimension: "os"), Block(title: "Devices", dimension: "device")]
    }
  }
}

extension Format {
  /// A row's name: an empty key is "(none)", a country code becomes the country's name.
  public static func rowLabel(_ key: String, dimension: String, locale: Locale = .current) -> String {
    if key.isEmpty { return "(none)" }
    if dimension == "country", let name = locale.localizedString(forRegionCode: key) { return name }
    return key
  }

  /// "13:00", the hour a chart point starts, in the chart's own time zone.
  public static func hour(_ date: Date, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
    date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, timeZone: timeZone))
  }
}

extension Format {
  /// "Nov 4", the day a chart point starts, in the chart's own time zone.
  public static func day(_ date: Date, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
    date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: timeZone))
  }
}
