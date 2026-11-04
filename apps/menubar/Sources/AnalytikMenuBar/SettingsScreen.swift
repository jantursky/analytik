import AppKit
import MenubarCore
import ServiceManagement
import SwiftUI

struct SettingsScreen: View {
  let model: AppModel
  @Environment(\.palette) private var p
  @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
  @State private var launchError: String?
  @State private var confirming: String?
  @State private var backupNote: String?

  var body: some View {
    VStack(spacing: 0) {
      ScreenHeader(title: "Settings") { model.screen = .stats }
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          sites
          appearance
          window
          display
          menuBar
          updates
          general
          numbers
          backup
          about
        }
        .padding(16)
      }
    }
  }

  // MARK: Sites

  private var sites: some View {
    SettingsGroup(title: "Sites") {
      ForEach(model.list) { connection in
        siteRow(connection)
        RowDivider()
      }
      AddSiteRow { model.prefill = nil; model.screen = .connect }
    }
  }

  private func siteRow(_ connection: Connection) -> some View {
    HStack(spacing: 10) {
      Text(String(connection.name.prefix(1)).uppercased())
        .font(Typeface.ui(12, .bold))
        .foregroundStyle(p.accentText)
        .frame(width: 26, height: 26)
        .background(p.accentSoft, in: Circle())
      VStack(alignment: .leading, spacing: 1) {
        Text(connection.name).font(Typeface.ui(14, .medium))
        Text(URL(string: connection.serverURL)?.host() ?? connection.serverURL)
          .font(Typeface.ui(12)).foregroundStyle(p.textMuted)
      }
      Spacer(minLength: 8)
      // Two steps, so one stray click doesn't remove a site and its token.
      if confirming == connection.id {
        AppButton(title: "Confirm", variant: .danger, compact: true) {
          confirming = nil
          model.disconnect(connection)
        }
      } else {
        AppButton(title: "Disconnect", compact: true) { confirming = connection.id }
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .frame(minHeight: 46)
    .animation(Motion.hover, value: confirming)
    .onChange(of: confirming) { _, id in
      guard id == connection.id else { return }
      Task {
        try? await Task.sleep(for: .seconds(3))
        if confirming == connection.id { confirming = nil }
      }
    }
  }

  // MARK: Groups

  private var appearance: some View {
    SettingsGroup(title: "Appearance") {
      SegmentedControl(
        selection: Bindable(model).settings.appearance,
        options: [(.system, "System", "circle.lefthalf.filled"), (.light, "Light", "sun.max"), (.dark, "Dark", "moon")])
    }
  }

  private var window: some View {
    SettingsGroup(title: "Window", footer: "More tabs and rows scroll inside the window instead of making it bigger.") {
      labeledSegments("Width") {
        SegmentedControl(
          selection: Bindable(model).settings.windowWidth,
          options: WindowWidth.allCases.map { ($0, $0.label, nil) })
      }
      RowDivider()
      labeledSegments("Height") {
        SegmentedControl(
          selection: Bindable(model).settings.windowHeight,
          options: WindowHeight.allCases.map { ($0, $0.label, nil) })
      }
    }
  }

  private func labeledSegments<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title).font(Typeface.ui(14, .medium)).padding(.horizontal, 12).padding(.top, 10)
      content()
    }
  }

  private var display: some View {
    SettingsGroup(title: "Display") {
      SettingRow(symbol: "rectangle.compress.vertical", title: "Density") {
        MenuControl(selection: Bindable(model).settings.density, options: Density.allCases.map { ($0, $0.label) })
      }
      RowDivider()
      SettingRow(symbol: "textformat.123", title: "Short numbers", subtitle: "12.3K instead of 12,300") {
        SwitchControl(title: "Short numbers", isOn: Bindable(model).settings.compactNumbers)
      }
      RowDivider()
      SettingRow(symbol: "arrow.up.right", title: "Show the change", subtitle: "Against the period before") {
        SwitchControl(title: "Show the change", isOn: Bindable(model).settings.showChange)
      }
      RowDivider()
      SettingRow(symbol: "waveform.path.ecg", title: "Chart style", subtitle: "Revenue is always bars") {
        MenuControl(selection: Bindable(model).settings.chartStyle, options: ChartStyle.allCases.map { ($0, $0.label) })
      }
    }
  }

  private var menuBar: some View {
    SettingsGroup(title: "Menu bar", footer: model.list.count > 1 ? "Revenue is only added up when the sites share a currency." : nil) {
      SettingRow(symbol: "chart.bar.xaxis", title: "Show the icon") {
        SwitchControl(title: "Show the icon", isOn: Bindable(model).settings.showMenuBarIcon)
      }
      if model.list.count > 1 {
        RowDivider()
        SettingRow(symbol: "sum", title: "Add up all sites") {
          SwitchControl(title: "Add up all sites", isOn: Bindable(model).settings.menuBarAllSites)
        }
      }
    }
  }

  // MARK: Numbers, menu bar, tabs, chart, alerts

  private var numbers: some View {
    VStack(alignment: .leading, spacing: 20) {
      SettingsGroup(title: "Numbers") {
        SettingRow(symbol: "calendar", title: "Period") {
          MenuControl(selection: Bindable(model).settings.range, options: TimeRange.allCases.map { ($0, $0.label) })
        }
        RowDivider()
        labeledSegments("Numbers per row") {
          SegmentedControl(
            selection: Bindable(model).settings.headlinePerRow,
            options: [(0, "Auto", nil), (2, "2", nil), (3, "3", nil), (4, "4", nil)])
        }
      }
      headlineGroup
      SettingsGroup(title: "Menu bar") {
        SettingRow(symbol: "menubar.rectangle", title: "Show next to the icon") {
          MenuControl(
            selection: Bindable(model).settings.menuBarNumber,
            options: MenuBarNumber.allCases.map { ($0, $0.label) })
        }
        RowDivider()
        SettingRow(symbol: "circle.fill", title: "Dot when visitors fall", subtitle: "Below the same time yesterday") {
          SwitchControl(title: "Dot when visitors fall", isOn: Bindable(model).settings.menuBarDot)
        }
      }
      tabs
      SettingsGroup(title: "Chart") {
        SettingRow(symbol: "chart.xyaxis.line", title: "Show the chart") {
          SwitchControl(title: "Show the chart", isOn: Bindable(model).settings.showChart)
        }
        if model.settings.showChart {
          RowDivider()
          SettingRow(symbol: "chart.bar", title: "Plot") {
            MenuControl(
              selection: Bindable(model).settings.chartMetric,
              options: ChartMetric.allCases.map { ($0, $0.label) })
          }
        }
      }
      alerts
    }
  }

  /// The headline numbers in the order they show: the chosen ones first, dragged into place, then the rest.
  private var headlineGroup: some View {
    let chosen = model.settings.headline
    let ordered = chosen + HeadlineMetric.allCases.filter { !chosen.contains($0) }
    return SettingsGroup(title: "Headline numbers", footer: "Drag a number to put it in a different place.") {
      ForEach(Array(ordered.enumerated()), id: \.element) { index, metric in
        if index > 0 { RowDivider() }
        SettingRow(symbol: metric.symbol, title: metric.title) {
          HStack(spacing: 10) {
            SwitchControl(title: metric.title, isOn: headline(metric))
            Image(systemName: "line.3.horizontal")
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(chosen.contains(metric) ? p.textMuted : p.textFaint.opacity(0.4))
          }
        }
        .draggable(metric.rawValue)
        .dropDestination(for: String.self) { items, _ in
          guard let raw = items.first, let moved = HeadlineMetric(rawValue: raw) else { return false }
          moveHeadline(moved, to: metric)
          return true
        }
      }
    }
  }

  private func headline(_ metric: HeadlineMetric) -> Binding<Bool> {
    Binding(
      get: { model.settings.headline.contains(metric) },
      set: { on in
        var list = model.settings.headline
        if on { if !list.contains(metric) { list.append(metric) } } else if list.count > 1 { list.removeAll { $0 == metric } }
        model.settings.headline = list
      })
  }

  /// Puts `moved` where `target` is. Only the chosen numbers can be moved.
  private func moveHeadline(_ moved: HeadlineMetric, to target: HeadlineMetric) {
    var list = model.settings.headline
    guard moved != target, list.contains(moved), let to = list.firstIndex(of: target) else { return }
    list.removeAll { $0 == moved }
    list.insert(moved, at: min(to, list.count))
    withAnimation(Motion.ease) { model.settings.headline = list }
  }

  private var tabs: some View {
    SettingsGroup(title: "Tabs") {
      ForEach(PanelSection.allCases.filter { $0 != .overview }) { section in
        SettingRow(symbol: section.symbol, title: section.title) {
          SwitchControl(title: section.title, isOn: visible(section))
        }
        RowDivider()
      }
      SettingRow(symbol: "list.number", title: "Rows in lists") {
        MenuControl(
          selection: Bindable(model).settings.rows,
          options: AppSettings.rowChoices.map { ($0, "\($0)") })
      }
    }
  }

  private func visible(_ section: PanelSection) -> Binding<Bool> {
    Binding(
      get: { !model.settings.hiddenSections.contains(section) },
      set: { shown in
        var hidden = model.settings.hiddenSections
        hidden.removeAll { $0 == section }
        if !shown { hidden.append(section) }
        model.settings.hiddenSections = hidden
      })
  }

  private var alerts: some View {
    SettingsGroup(
      title: "Alerts",
      footer: "Notifications. Visitors are compared with the same time yesterday, and only once yesterday had at least 20. Each alert comes once until things are normal again."
    ) {
      SettingRow(symbol: "arrow.up.right.circle", title: "Traffic jumps by") {
        MenuControl(selection: alertBinding(\.jumpPercent), options: percentOptions)
      }
      RowDivider()
      SettingRow(symbol: "arrow.down.right.circle", title: "Traffic drops by") {
        MenuControl(selection: alertBinding(\.dropPercent), options: percentOptions)
      }
      RowDivider()
      SettingRow(symbol: "bolt.horizontal.circle", title: "Server silent for") {
        MenuControl(
          selection: alertBinding(\.downMinutes),
          options: [(nil, "Off")] + AlertRules.downChoices.map { (Optional($0), "\($0) minutes") })
      }
    }
  }

  private var percentOptions: [(value: Int?, label: String)] {
    [(nil, "Off")] + AlertRules.percentChoices.map { (Optional($0), "\($0)%") }
  }

  /// One alert threshold of the site on screen. Switching the first alert on asks macOS for permission to notify.
  private func alertBinding(_ rule: WritableKeyPath<AlertRules, Int?>) -> Binding<Int?> {
    Binding(
      get: { model.settings.alerts[keyPath: rule] },
      set: { new in
        var rules = model.settings.alerts
        let wasOn = rules.isOn
        rules[keyPath: rule] = new
        model.settings.alerts = rules
        if !wasOn && rules.isOn { Notifier.requestPermission() }
      })
  }

  private var updates: some View {
    SettingsGroup(title: "Updates", footer: "While the window is open it refreshes every 10 seconds.") {
      SettingRow(symbol: "arrow.triangle.2.circlepath", title: "Refresh every") {
        MenuControl(
          selection: Bindable(model).settings.refreshSeconds,
          options: AppSettings.refreshChoices.map { ($0.seconds, $0.label) })
      }
      RowDivider()
      SettingRow(symbol: "pause", title: "Pause updates", subtitle: "Nothing is requested until you resume") {
        SwitchControl(title: "Pause updates", isOn: Bindable(model).settings.paused)
      }
    }
  }

  private var general: some View {
    SettingsGroup(title: "General", footer: launchError) {
      SettingRow(symbol: "keyboard", title: "Open with a shortcut", subtitle: "Works in every app") {
        ShortcutRecorder(shortcut: Bindable(model).settings.shortcut)
      }
      RowDivider()
      SettingRow(symbol: "power", title: "Open at login") {
        SwitchControl(title: "Open at login", isOn: $launchAtLogin)
      }
      .onChange(of: launchAtLogin) { _, enabled in
        do {
          if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
          launchError = nil
        } catch {
          launchAtLogin = SMAppService.mainApp.status == .enabled
          launchError = "macOS didn't allow it. Move the app to Applications first."
        }
      }
    }
  }

  private var backup: some View {
    SettingsGroup(
      title: "Backup",
      footer: backupNote ?? "Sites move as text that holds their read-only tokens: keep it private. Settings move as a file."
    ) {
      SettingRow(symbol: "doc.on.doc", title: "Copy all sites", subtitle: "To add them in the app on another Mac") {
        AppButton(title: "Copy", compact: true) {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(model.sitesText(), forType: .string)
          backupNote = "Copied \(model.list.count) site\(model.list.count == 1 ? "" : "s"). Paste it into the link field of the app on the other Mac."
        }
        .disabled(model.list.isEmpty)
      }
      RowDivider()
      SettingRow(symbol: "square.and.arrow.down", title: "Add sites from the clipboard", subtitle: "Text copied with \"Copy all sites\"") {
        AppButton(title: "Add", compact: true) {
          let text = NSPasteboard.general.string(forType: .string) ?? ""
          if let count = model.importSites(text) {
            backupNote = count == 0 ? "The keychain refused the tokens." : "Added \(count) site\(count == 1 ? "" : "s")."
          } else {
            backupNote = "The clipboard holds no copied sites."
          }
        }
      }
      RowDivider()
      SettingRow(symbol: "square.and.arrow.up", title: "Export settings", subtitle: "To a file") {
        AppButton(title: "Export…", compact: true) { model.exportSettings() }
      }
      RowDivider()
      SettingRow(symbol: "square.and.arrow.down.on.square", title: "Import settings", subtitle: "From an exported file") {
        AppButton(title: "Import…", compact: true) {
          switch model.importSettings() {
          case .some(true): backupNote = "Settings imported."
          case .some(false): backupNote = "That file is not an Analytik Menu Bar settings file."
          case .none: break
          }
        }
      }
    }
  }

  private var about: some View {
    VStack(spacing: 12) {
      HStack(spacing: 8) {
        AppButton(title: "Open dashboard", symbol: "arrow.up.right.square") { model.openDashboard() }
        Spacer()
        AppButton(title: "Quit", symbol: "power") { NSApplication.shared.terminate(nil) }
      }
      Rectangle().fill(p.border).frame(height: 1)
      HStack {
        Text("Made by Jan Tursky")
        Spacer()
        Button {
          if let url = URL(string: "https://github.com/jantursky/analytik/issues/new/choose") { NSWorkspace.shared.open(url) }
        } label: {
          Label("Got an idea?", systemImage: "lightbulb").foregroundStyle(p.accentText)
        }
        .buttonStyle(.plain)
        .help("Suggest a feature or report a problem on GitHub")
        Spacer()
        Text("Version \(version)")
      }
      .font(Typeface.ui(12))
      .foregroundStyle(p.textFaint)
    }
    .padding(.top, 2)
  }

  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
  }
}

/// The last row of the site list: a plus and a link-coloured label.
private struct AddSiteRow: View {
  @Environment(\.palette) private var p
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Image(systemName: "plus").font(.system(size: 12, weight: .bold)).frame(width: 26, height: 26)
          .background(p.accentSoft, in: RoundedRectangle(cornerRadius: Layout.radiusRow))
        Text("Add a site").font(Typeface.ui(14, .medium))
        Spacer()
      }
      .foregroundStyle(p.accentText)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .frame(minHeight: 46)
      .contentShape(Rectangle())
      .hoverRow()
    }
    .buttonStyle(.plain)
  }
}

extension PanelSection {
  var symbol: String {
    switch self {
    case .overview: "square.grid.2x2"
    case .pages: "doc.text"
    case .sources: "arrow.triangle.branch"
    case .places: "globe"
    case .tech: "desktopcomputer"
    }
  }
}

extension HeadlineMetric {
  var symbol: String {
    switch self {
    case .visitors: "person.2"
    case .pageviews: "doc.text"
    case .revenue: "creditcard"
    case .bounceRate: "arrow.uturn.backward"
    case .duration: "clock"
    case .orders: "bag"
    case .conversion: "percent"
    }
  }
}
