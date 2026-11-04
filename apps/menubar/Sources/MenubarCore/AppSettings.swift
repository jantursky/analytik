import Foundation

public enum MenuBarNumber: String, Codable, CaseIterable, Sendable {
  case online, visitors, revenue, none

  public var label: String {
    switch self {
    case .online: "Visitors online"
    case .visitors: "Visitors today"
    case .revenue: "Revenue today"
    case .none: "Icon only"
    }
  }
}

public enum ChartMetric: String, Codable, CaseIterable, Sendable {
  case visitors, pageviews, revenue

  public var label: String { rawValue.capitalized }
}

public enum Appearance: String, Codable, CaseIterable, Sendable {
  case system, light, dark

  public var label: String { rawValue.capitalized }
}

/// The choices the user makes in the app's settings.
public struct AppSettings: Codable, Equatable, Sendable {
  /// Seconds between refreshes while the popover is closed.
  public var refreshSeconds: Double = 60
  public var menuBarNumber: MenuBarNumber = .online
  /// Add up every connected site in the menu bar instead of showing the selected one.
  public var menuBarAllSites = false
  public var showChart = true
  public var chartMetric: ChartMetric = .visitors
  public var paused = false
  public var selectedId: String?
  public var appearance: Appearance = .system
  /// Tabs the user switched off in the settings. Overview can't be hidden.
  public var hiddenSections: [PanelSection] = []
  /// How many rows each list shows.
  public var rows = 5
  public var windowWidth: WindowWidth = .compact
  public var windowHeight: WindowHeight = .regular
  public var density: Density = .comfortable
  public var chartStyle: ChartStyle = .area
  public var range: TimeRange = .today
  /// Which numbers head the popover, in this order.
  public var headline: [HeadlineMetric] = [.visitors, .pageviews, .revenue]
  public var compactNumbers = true
  public var showChange = true
  public var showMenuBarIcon = true
  /// How many headline numbers sit in a row; 0 picks 3, or 4 in a wide window.
  public var headlinePerRow = 0
  /// A coloured dot on the menu bar icon while visitors are below the previous period.
  public var menuBarDot = false
  public var alerts = AlertRules()
  /// Opens the popover from any app.
  public var shortcut: Shortcut?

  public init() {}

  public var visibleSections: [PanelSection] { PanelSection.allCases.filter { $0 == .overview || !hiddenSections.contains($0) } }

  public static let rowChoices = [5, 8, 10]

  public static let refreshChoices: [(label: String, seconds: Double)] = [
    ("30 seconds", 30), ("1 minute", 60), ("5 minutes", 300), ("15 minutes", 900),
  ]

  /// The pacing this setting asks the store for.
  public var policy: RefreshPolicy {
    var policy = RefreshPolicy()
    policy.closed = max(10, refreshSeconds)
    return policy
  }

  private static let key = "appSettings"

  /// The saved settings; anything missing or damaged falls back to the defaults.
  public static func load(_ defaults: UserDefaults = .standard) -> AppSettings {
    guard let data = defaults.data(forKey: key), let saved = try? JSONDecoder().decode(AppSettings.self, from: data)
    else { return AppSettings() }
    return saved
  }

  /// The settings as a readable file, for backing up or moving to another Mac.
  public func exported() -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return (try? encoder.encode(self)) ?? Data()
  }

  /// Settings from an exported file, or nil when it isn't one. The site selection is dropped: it names a connection of
  /// the other Mac.
  public static func imported(from data: Data) -> AppSettings? {
    guard var settings = try? JSONDecoder().decode(AppSettings.self, from: data) else { return nil }
    settings.selectedId = nil
    return settings
  }

  public func save(_ defaults: UserDefaults = .standard) {
    if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
  }
}

extension AppSettings {
  /// Tolerates settings saved by an older version that lack newer keys.
  public init(from decoder: Decoder) throws {
    self.init()
    let values = try decoder.container(keyedBy: CodingKeys.self)
    refreshSeconds = try values.decodeIfPresent(Double.self, forKey: .refreshSeconds) ?? refreshSeconds
    menuBarNumber = try values.decodeIfPresent(MenuBarNumber.self, forKey: .menuBarNumber) ?? menuBarNumber
    menuBarAllSites = try values.decodeIfPresent(Bool.self, forKey: .menuBarAllSites) ?? menuBarAllSites
    showChart = try values.decodeIfPresent(Bool.self, forKey: .showChart) ?? showChart
    chartMetric = try values.decodeIfPresent(ChartMetric.self, forKey: .chartMetric) ?? chartMetric
    paused = try values.decodeIfPresent(Bool.self, forKey: .paused) ?? paused
    selectedId = try values.decodeIfPresent(String.self, forKey: .selectedId)
    appearance = try values.decodeIfPresent(Appearance.self, forKey: .appearance) ?? appearance
    hiddenSections = try values.decodeIfPresent([PanelSection].self, forKey: .hiddenSections) ?? hiddenSections
    rows = min(20, max(1, try values.decodeIfPresent(Int.self, forKey: .rows) ?? rows))
    windowWidth = try values.decodeIfPresent(WindowWidth.self, forKey: .windowWidth) ?? windowWidth
    windowHeight = try values.decodeIfPresent(WindowHeight.self, forKey: .windowHeight) ?? windowHeight
    density = try values.decodeIfPresent(Density.self, forKey: .density) ?? density
    chartStyle = try values.decodeIfPresent(ChartStyle.self, forKey: .chartStyle) ?? chartStyle
    range = try values.decodeIfPresent(TimeRange.self, forKey: .range) ?? range
    let picked = try values.decodeIfPresent([HeadlineMetric].self, forKey: .headline) ?? headline
    headline = picked.isEmpty ? [.visitors] : picked
    compactNumbers = try values.decodeIfPresent(Bool.self, forKey: .compactNumbers) ?? compactNumbers
    showChange = try values.decodeIfPresent(Bool.self, forKey: .showChange) ?? showChange
    showMenuBarIcon = try values.decodeIfPresent(Bool.self, forKey: .showMenuBarIcon) ?? showMenuBarIcon
    headlinePerRow = [0, 2, 3, 4].contains(try values.decodeIfPresent(Int.self, forKey: .headlinePerRow) ?? 0)
      ? (try values.decodeIfPresent(Int.self, forKey: .headlinePerRow) ?? 0) : 0
    menuBarDot = try values.decodeIfPresent(Bool.self, forKey: .menuBarDot) ?? menuBarDot
    alerts = try values.decodeIfPresent(AlertRules.self, forKey: .alerts) ?? alerts
    shortcut = try values.decodeIfPresent(Shortcut.self, forKey: .shortcut)
  }
}
