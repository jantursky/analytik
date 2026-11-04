import AppKit
import MenubarCore
import ServiceManagement
import SwiftUI

@main
struct AnalytikMenuBarApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = AppModel.shared

  var body: some Scene {
    MenuBarExtra {
      PopoverView(model: model)
    } label: {
      HStack(spacing: 4) {
        let title = model.menuBarTitle
        if model.settings.showMenuBarIcon || title.isEmpty || model.settings.paused {
          if model.settings.paused { Image(systemName: "pause.circle") } else { Image(nsImage: BrandMark.menuBarImage(dot: model.menuBarDeclining)) }
        }
        if !title.isEmpty && !model.settings.paused { Text(title).monospacedDigit() }
      }
    }
    .menuBarExtraStyle(.window)
  }
}

/// Receives `analytik://connect?...` addresses, which the Mac app link in the dashboard opens.
final class AppDelegate: NSObject, NSApplicationDelegate {
  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls {
      if let link = ConnectionLink.parse(url.absoluteString) {
        Task { @MainActor in AppModel.shared.receive(link) }
        return
      }
    }
  }
}

enum Screen: Equatable {
  case stats, settings, connect
}

/// Holds the connections, one store per site, the settings and what the popover shows.
@MainActor
@Observable
final class AppModel {
  static let shared = AppModel()

  let connections = ConnectionStore()
  private(set) var list: [Connection] = []
  private(set) var stores: [String: StatsStore] = [:]
  private var clients: [String: StatsClient] = [:]
  /// Each site's host name and icon, read once per connection for the site list.
  private(set) var identities: [String: SiteIdentity] = [:]
  var tab: PanelSection = .overview
  /// The last rows read for each site and dimension, so a tab keeps its numbers while it refreshes.
  private(set) var breakdowns: [String: [PageRow]] = [:]
  /// The lists asked for at least once, whether or not they came back.
  private var attempted: Set<String> = []
  var screen: Screen = .stats
  /// A link that arrived (clipboard, paste or address) and fills the connect form.
  var prefill: ConnectionLink?
  var settings: AppSettings = AppSettings.load() {
    didSet {
      guard settings != oldValue else { return }
      settings.save()
      settingsChanged(from: oldValue)
    }
  }
  private var evaluators: [String: AlertEvaluator] = [:]
  private let network = NetworkWatch()
  private var popoverOpen = false
  private var observers: [NSObjectProtocol] = []

  init() {
    reload()
    screen = list.isEmpty ? .connect : .stats
    if let shortcut = settings.shortcut { HotKey.shared.register(shortcut) { StatusItem.open() } }
    let center = NSWorkspace.shared.notificationCenter
    observers.append(
      center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.stores.values.forEach { $0.pause() } }
      })
    observers.append(
      center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.stores.values.forEach { $0.resume() } }
      })
  }

  /// Where the site lives: its own host name, else the host of its dashboard or of its server.
  func address(_ connection: Connection) -> String {
    if let domain = identities[connection.id]?.domain, !domain.isEmpty { return domain }
    let url = URL(string: connection.dashboardURL ?? "") ?? URL(string: connection.serverURL)
    return url?.host() ?? connection.serverURL
  }

  var selected: Connection? { list.first { $0.id == settings.selectedId } ?? list.first }

  /// Whether the number in the menu bar is below the previous period, for the dot on the icon.
  var menuBarDeclining: Bool {
    guard settings.menuBarDot, let store = selectedStore else { return false }
    switch store.status {
    case .ready(let snapshot), .refreshing(let snapshot), .stale(let snapshot, _):
      if snapshot.range == .today, let pace = snapshot.pace { return pace.previous > 0 && pace.current < pace.previous }
      return snapshot.overview.visitors.value < snapshot.overview.visitors.previous
    default: return false
    }
  }
  var selectedStore: StatsStore? { selected.flatMap { stores[$0.id] } }

  var menuBarTitle: String {
    let sources = settings.menuBarAllSites ? Array(stores.values) : [selectedStore].compactMap { $0 }
    return Format.menuBarTitle(sources.map(\.status), number: settings.menuBarNumber, paused: settings.paused)
  }

  /// Reads the connection list and starts a store for each site, keeping the ones already running.
  func reload() {
    list = connections.list()
    var next: [String: StatsStore] = [:]
    var nextClients: [String: StatsClient] = [:]
    for connection in list {
      if let existing = stores[connection.id] {
        next[connection.id] = existing
        nextClients[connection.id] = clients[connection.id]
        continue
      }
      let store = StatsStore(policy: settings.policy)
      if let credentials = connection.credentials(token: connections.token(for: connection)) {
        let client = StatsClient(credentials: credentials)
        nextClients[connection.id] = client
        let id = connection.id
        Task { if let identity = await client.identity() { identities[id] = identity } }
        let options: @MainActor @Sendable () -> (range: TimeRange, chart: Bool, rows: Int, pace: Bool) = { [weak self] in
          let own = self?.settings ?? AppSettings()
          return (own.range, own.showChart, own.rows, own.alerts.isOn || own.menuBarDot)
        }
        store.configure(fetch: {
          let current = await options()
          return try await client.fetch(range: current.range, includeSeries: current.chart, rows: current.rows, pace: current.pace)
        })
        store.onUpdate = { [weak self] status in self?.evaluateAlerts(id: id, name: connection.name, status: status) }
      }
      store.setUserPaused(settings.paused)
      next[connection.id] = store
    }
    for (id, store) in stores where next[id] == nil { store.pause() }
    stores = next
    clients = nextClients
    updateOpenness()
  }

  func select(_ connection: Connection) {
    settings.selectedId = connection.id
    updateOpenness()
  }

  func add(_ connection: Connection, token: String) -> Bool {
    guard connections.add(connection, token: token) else { return false }
    reload()
    if let added = list.first(where: { $0.serverURL == connection.serverURL && $0.siteId == connection.siteId }) {
      select(added)
    }
    screen = .stats
    return true
  }

  func disconnect(_ connection: Connection) {
    connections.remove(connection)
    reload()
    if list.isEmpty { screen = .connect }
  }

  /// Runs after every refresh of one site and sends what the site's alert rules call for.
  private func evaluateAlerts(id: String, name: String, status: Status) {
    let rules = settings.alerts
    var evaluator = evaluators[id] ?? AlertEvaluator()
    let events = evaluator.evaluate(status: status, rules: rules, siteName: name, now: Date(), macOnline: network.isOnline)
    evaluators[id] = evaluator
    for event in events { Notifier.send(event) }
  }

  func setPopoverOpen(_ open: Bool) {
    popoverOpen = open
    updateOpenness()
  }

  /// A link arrived: show the connect form with it, and try to open the popover so the user sees it.
  func receive(_ link: ConnectionLink) {
    prefill = link
    screen = .connect
    StatusItem.open()
  }

  /// Reads the lists of the open tab for the selected site. Called when the tab opens and after each refresh.
  func loadTab() async {
    guard let connection = selected, let client = clients[connection.id], !settings.paused else { return }
    for block in tab.blocks {
      let key = "\(connection.id)|\(block.dimension)"
      if let rows = try? await client.breakdown(block.dimension, limit: settings.rows, range: settings.range) {
        breakdowns[key] = rows
      }
      attempted.insert(key)
    }
  }

  /// Whether a list has been asked for yet, so a tab can show that it is loading instead of "Nothing yet".
  func isLoading(_ dimension: String) -> Bool {
    guard let connection = selected else { return false }
    return !attempted.contains("\(connection.id)|\(dimension)")
  }

  func rows(for dimension: String) -> [PageRow] {
    guard let connection = selected else { return [] }
    return breakdowns["\(connection.id)|\(dimension)"] ?? []
  }

  /// Every connected site with its token as one piece of text for another Mac.
  func sitesText() -> String { SiteBundle.encode(list.map { ($0, connections.token(for: $0)) }) }

  /// Adds the sites of a bundle; one already connected is updated. Returns how many were added, nil when the text isn't a bundle.
  @discardableResult
  func importSites(_ text: String) -> Int? {
    guard let entries = SiteBundle.decode(text) else { return nil }
    var added = 0
    for entry in entries {
      let connection = Connection(name: entry.name, serverURL: entry.serverURL, siteId: entry.siteId, dashboardURL: entry.dashboardURL)
      if connections.add(connection, token: entry.token) { added += 1 }
    }
    reload()
    if let first = list.first, selected == nil { select(first) }
    if added > 0 { screen = .stats }
    return added
  }

  /// Saves the settings to a file the user picks.
  func exportSettings() {
    NSApp.activate(ignoringOtherApps: true)
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "Analytik Menu Bar settings.json"
    panel.allowedContentTypes = [.json]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    try? settings.exported().write(to: url)
  }

  /// Reads settings from a file the user picks. Returns false when the file isn't a settings file.
  func importSettings() -> Bool? {
    NSApp.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    guard panel.runModal() == .OK, let url = panel.url else { return nil }
    guard let data = try? Data(contentsOf: url), var imported = AppSettings.imported(from: data) else { return false }
    imported.selectedId = settings.selectedId
    settings = imported
    return true
  }

  /// Opens the dashboard of a site in the browser: the plain address of the site, or with the read-only link when the
  /// setting asks for it.
  func openDashboard(_ connection: Connection? = nil) {
    guard let connection = connection ?? selected,
      let url = connection.dashboard(token: connections.token(for: connection), withShare: settings.dashboardWithShareLink)
    else { return }
    NSWorkspace.shared.open(url)
  }

  func refreshNow() {
    Task { for store in stores.values { await store.refreshNow() } }
  }

  private func updateOpenness() {
    for (id, store) in stores { store.setOpen(popoverOpen && id == selected?.id) }
  }

  private func settingsChanged(from old: AppSettings) {
    for store in stores.values {
      store.setPolicy(settings.policy)
      store.setUserPaused(settings.paused)
    }
    if settings.showChart && !old.showChart || settings.rows != old.rows || settings.range != old.range || settings.alerts != old.alerts
      || settings.menuBarDot != old.menuBarDot
    { refreshNow() }
    if !settings.visibleSections.contains(tab) { tab = .overview }
    if settings.shortcut != old.shortcut { HotKey.shared.register(settings.shortcut) { StatusItem.open() } }
    if settings.selectedId != old.selectedId { updateOpenness() }
  }
}

/// Opens the popover by pressing the app's own status item, the only way SwiftUI's `MenuBarExtra` allows.
enum StatusItem {
  @MainActor static func open() {
    for window in NSApp.windows where String(describing: type(of: window)).contains("StatusBarWindow") {
      if let button = find(window.contentView) { button.performClick(nil) }
    }
  }

  @MainActor private static func find(_ view: NSView?) -> NSStatusBarButton? {
    guard let view else { return nil }
    if let button = view as? NSStatusBarButton { return button }
    for child in view.subviews { if let found = find(child) { return found } }
    return nil
  }
}
