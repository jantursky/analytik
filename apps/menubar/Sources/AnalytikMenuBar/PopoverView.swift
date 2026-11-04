import AppKit
import Charts
import MenubarCore
import SwiftUI

struct PopoverView: View {
  let model: AppModel
  @Environment(\.colorScheme) private var system

  private var scheme: ColorScheme {
    switch model.settings.appearance {
    case .system: system
    case .light: .light
    case .dark: .dark
    }
  }

  /// The chosen height, kept inside the screen so a tall window never hangs off a small display.
  private var windowHeight: Double {
    min(model.settings.windowHeight.points, Double((NSScreen.main?.visibleFrame.height ?? 900) - 40))
  }

  private static let screenChange = AnyTransition.opacity.combined(with: .scale(scale: 0.98))

  var body: some View {
    let palette = scheme == .dark ? Palette.dark : Palette.light
    ZStack {
      // Each screen fades in and out as the one before it leaves.
      switch model.screen {
      case .stats: StatsScreen(model: model).transition(Self.screenChange)
      case .settings: SettingsScreen(model: model).transition(Self.screenChange)
      case .connect: ConnectScreen(model: model).transition(Self.screenChange)
      }
    }
    .animation(Motion.ease, value: model.screen)
    .frame(width: model.settings.windowWidth.points, height: windowHeight)
    .coordinateSpace(name: "popover")
    .overlay(alignment: .topLeading) { DropdownLayer(host: DropdownHost.shared, width: model.settings.windowWidth.points) }
    .onChange(of: model.screen) { _, _ in DropdownHost.shared.close() }
    .background(palette.bg)
    .environment(\.compact, model.settings.density == .compact)
    .environment(\.palette, palette)
    .environment(\.colorScheme, scheme)
    .preferredColorScheme(model.settings.appearance == .system ? nil : scheme)
    .background(WindowObserver(size: CGSize(width: model.settings.windowWidth.points, height: windowHeight)) { model.setPopoverOpen($0) })
  }
}

// MARK: - Stats

private struct StatsScreen: View {
  let model: AppModel
  @Environment(\.palette) private var p
  @Namespace private var indicator
  @State private var siteOpen = false

  var body: some View {
    let status = model.selectedStore?.status ?? .notSetUp
    VStack(spacing: 0) {
      if let update = model.pendingUpdate { UpdateBanner(model: model, update: update) }
      header(status)
      if model.settings.visibleSections.count > 1 { tabs }
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          switch status {
          case .ready(let snapshot), .refreshing(let snapshot):
            tabContent(snapshot)
          case .stale(let snapshot, let error):
            notice(Format.message(error))
            tabContent(snapshot)
          case .failed(let error):
            notice(Format.message(error))
          case .loading:
            ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 120)
          case .notSetUp:
            notice(Format.message(.notSetUp))
          }
        }
        .padding(16)
      }
      footer(status)
    }
    .task(id: loadKey(status)) { await model.loadTab() }
    .overlay {
      if siteOpen {
        // A click anywhere else closes the list.
        Color.clear.contentShape(Rectangle()).onTapGesture { close() }
      }
    }
    .overlay(alignment: .topLeading) {
      if siteOpen { siteDropdown }
    }
  }

  /// A new key whenever the open tab, the site or the numbers change, so the tab's lists are read again.
  private func loadKey(_ status: Status) -> String {
    let stamp: Date? = snapshot(of: status)?.fetchedAt
    return "\(model.selected?.id ?? "")|\(model.tab.rawValue)|\(stamp?.timeIntervalSince1970 ?? 0)"
  }

  // MARK: Header

  private func header(_ status: Status) -> some View {
    let snapshot = snapshot(of: status)
    return VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 8) {
        siteMenu
        Spacer()
        rangeMenu
        if let snapshot { livePill(snapshot.online) }
      }
      headlineGrid(snapshot)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(p.surface)
    .overlay(alignment: .bottom) { Rectangle().fill(p.border).frame(height: 1) }
  }

  private var siteMenu: some View {
    Button {
      withAnimation(Motion.hover) { siteOpen.toggle() }
    } label: {
      HStack(spacing: 5) {
        Text(model.selected?.name ?? "Analytik").font(Typeface.ui(16, .bold)).lineLimit(1)
        Image(systemName: "chevron.down")
          .font(.system(size: 9, weight: .bold)).foregroundStyle(p.textFaint)
          .rotationEffect(.degrees(siteOpen ? 180 : 0))
      }
      .foregroundStyle(p.text)
      // A bigger area to hit around the name and the arrow; the negative padding gives the layout its old size back.
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .contentShape(Rectangle())
      .padding(.horizontal, -12)
      .padding(.vertical, -10)
    }
    .buttonStyle(.plain)
  }

  /// The list of sites that opens under the name, like the dashboard's site switcher: each with its mark and address,
  /// the open one ticked, then the actions.
  private var siteDropdown: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(spacing: 2) {
          ForEach(model.list) { connection in
            DropdownRow(selected: connection.id == model.selected?.id) {
              model.select(connection)
              close()
            } content: {
              SiteTile(id: connection.id, icon: model.identities[connection.id]?.icon)
              VStack(alignment: .leading, spacing: 1) {
                Text(connection.name).font(Typeface.ui(14, connection.id == model.selected?.id ? .bold : .medium)).lineLimit(1)
                Text(model.address(connection)).font(Typeface.ui(12)).foregroundStyle(p.textMuted).lineLimit(1)
              }
            }
          }
        }
        .padding(6)
      }
      .frame(maxHeight: 300)
      Rectangle().fill(p.border).frame(height: 1)
      VStack(spacing: 2) {
        DropdownRow(selected: false) {
          close()
          model.openDashboard()
        } content: {
          Image(systemName: "arrow.up.right.square").font(.system(size: 13)).foregroundStyle(p.textMuted).frame(width: 34)
          Text("Open dashboard in browser").font(Typeface.ui(14, .medium))
        }
        DropdownRow(selected: false) {
          close()
          model.prefill = nil
          model.screen = .connect
        } content: {
          Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).foregroundStyle(p.accentText).frame(width: 34)
          Text("Add site…").font(Typeface.ui(14, .medium)).foregroundStyle(p.accentText)
        }
      }
      .padding(6)
    }
    .frame(width: min(300, model.settings.windowWidth.points - 32))
    .background(p.surface, in: RoundedRectangle(cornerRadius: Layout.radiusCard))
    .overlay(RoundedRectangle(cornerRadius: Layout.radiusCard).stroke(p.border))
    .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
    .padding(.leading, 16)
    .padding(.top, 52)
    .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .topLeading)))
  }

  private func close() { withAnimation(Motion.hover) { siteOpen = false } }

  /// The period every number covers.
  private var rangeMenu: some View {
    MenuControl(selection: Bindable(model).settings.range, options: TimeRange.allCases.map { ($0, $0.label) })
  }

  /// Visitors online now, in the dashboard's success colours.
  private func livePill(_ online: Int) -> some View {
    HStack(spacing: 6) {
      Circle().fill(p.success).frame(width: 7, height: 7)
      Text("\(online) online").font(Typeface.ui(12, .semibold)).monospacedDigit()
    }
    .padding(.horizontal, 10)
    .frame(height: 24)
    .background(p.successSoft, in: Capsule())
    .foregroundStyle(p.successText)
  }

  /// The chosen numbers, three or four to a row depending on the width, divided by rules.
  private func headlineGrid(_ snapshot: Snapshot?) -> some View {
    let perRow = model.settings.headlinePerRow > 0 ? model.settings.headlinePerRow : (model.settings.windowWidth.points >= 540 ? 4 : 3)
    let metrics = model.settings.headline
    let rows = stride(from: 0, to: metrics.count, by: perRow).map { Array(metrics[$0..<min($0 + perRow, metrics.count)]) }
    return VStack(alignment: .leading, spacing: 14) {
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        HStack(alignment: .top, spacing: 0) {
          ForEach(Array(row.enumerated()), id: \.element) { index, metric in
            stat(metric, snapshot, first: index == 0)
          }
          // A short last row keeps its columns the same width as the rows above.
          ForEach(0..<(perRow - row.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
        }
      }
    }
  }

  /// One summary number: a muted label, a bold value, the change against the period before.
  private func stat(_ metric: HeadlineMetric, _ snapshot: Snapshot?, first: Bool) -> some View {
    let value = snapshot.flatMap { metric.text($0.overview, compact: model.settings.compactNumbers) }
    let delta = snapshot.flatMap { metric.delta($0.overview) }
    return HStack(spacing: 0) {
      if !first { Rectangle().fill(p.border).frame(width: 1).padding(.trailing, 12) }
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 5) {
          Circle().fill(dot(metric)).frame(width: 6, height: 6)
          Text(metric.title).font(Typeface.ui(12.5, .medium)).foregroundStyle(p.textMuted).lineLimit(1)
        }
        Text(value ?? "–")
          .font(Typeface.ui(22, .bold))
          .tracking(-0.4)
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        if model.settings.showChange, let delta {
          deltaLabel(delta, lowerIsBetter: metric.lowerIsBetter, since: snapshot?.range ?? model.settings.range)
        } else {
          Text(" ").font(Typeface.ui(12))
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxWidth: .infinity)
  }

  /// The dot before a number's name, one of the series colours like the dashboard's.
  private func dot(_ metric: HeadlineMetric) -> Color {
    switch metric {
    case .visitors: p.series1
    case .revenue: p.series2
    case .pageviews: p.series3
    default: p.series4
    }
  }

  /// Up is the success colour, down the warning colour (not red), like `.analytik-delta`; for a number where less is
  /// better the two swap.
  private func deltaLabel(_ delta: Delta, lowerIsBetter: Bool, since range: TimeRange) -> some View {
    Group {
      if let change = Format.change(delta) {
        let good = lowerIsBetter ? Format.Trend.down : Format.Trend.up
        let color = change.trend == .flat ? p.textFaint : (change.trend == good ? p.successText : p.warning)
        HStack(spacing: 2) {
          Image(systemName: change.trend == .up ? "arrow.up.right" : change.trend == .down ? "arrow.down.right" : "minus")
            .font(.system(size: 9, weight: .bold))
          Text(change.text.trimmingCharacters(in: CharacterSet(charactersIn: "+\u{2212}")))
        }
        .foregroundStyle(color)
      } else {
        Text("new").foregroundStyle(p.textFaint)
      }
    }
    .font(Typeface.ui(12, .semibold))
    .help("Against \(range.comparison)")
  }

  // MARK: Tabs

  /// Underlined tabs: the selected one is full text colour with a 2 pt primary line that slides to the next.
  private var tabs: some View {
    HStack(spacing: 4) {
      ForEach(model.settings.visibleSections) { section in
        TabButton(title: section.title, selected: model.tab == section, indicator: indicator) {
          withAnimation(Motion.ease) { model.tab = section }
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .background(p.surface)
    .overlay(alignment: .bottom) { Rectangle().fill(p.border).frame(height: 1) }
  }

  @ViewBuilder private func tabContent(_ snapshot: Snapshot) -> some View {
    if model.tab == .overview {
      if model.settings.showChart { ChartCard(model: model, snapshot: snapshot) }
      RankedList(title: "Top pages", dimension: "page", rows: snapshot.topPages, compactNumbers: model.settings.compactNumbers)
    } else {
      ForEach(model.tab.blocks, id: \.dimension) { block in
        RankedList(
          title: block.title, dimension: block.dimension, rows: model.rows(for: block.dimension),
          compactNumbers: model.settings.compactNumbers, loading: model.isLoading(block.dimension))
      }
    }
  }

  private func notice(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(p.caution)
      Text(text).font(Typeface.ui(13)).foregroundStyle(p.text).fixedSize(horizontal: false, vertical: true)
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(p.cautionSoft, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
  }

  private func footer(_ status: Status) -> some View {
    HStack(spacing: 6) {
      IconButton(symbol: "arrow.clockwise", help: "Refresh now") { model.refreshNow() }
      IconButton(
        symbol: model.settings.paused ? "play.fill" : "pause.fill",
        help: model.settings.paused ? "Resume updates" : "Pause updates", active: model.settings.paused
      ) { model.settings.paused.toggle() }
      IconButton(symbol: "gearshape", help: model.pendingUpdate == nil ? "Settings" : "Settings: an update is available") {
        model.screen = .settings
      }
      .overlay(alignment: .topTrailing) {
        if model.pendingUpdate != nil { Circle().fill(p.primary).frame(width: 7, height: 7).offset(x: -3, y: 3) }
      }
      IconButton(symbol: "arrow.up.right.square", help: "Open the dashboard in the browser") { model.openDashboard() }
      Spacer()
      if model.settings.paused {
        Text("Paused").font(Typeface.ui(12, .medium)).foregroundStyle(p.caution)
      } else if let snapshot = snapshot(of: status) {
        TimelineView(.periodic(from: .now, by: 15)) { context in
          Text("Updated \(Format.age(of: snapshot.fetchedAt, now: context.date))")
            .font(Typeface.ui(12)).foregroundStyle(p.textFaint)
        }
      }
      IconButton(symbol: "power", help: "Quit") { NSApplication.shared.terminate(nil) }
    }
    .padding(.horizontal, 12)
    .frame(height: 46)
    .background(p.surface)
    .overlay(alignment: .top) { Rectangle().fill(p.border).frame(height: 1) }
  }

  private func snapshot(of status: Status) -> Snapshot? {
    switch status {
    case .ready(let s), .refreshing(let s), .stale(let s, _): s
    default: nil
    }
  }
}

/// A row of the site list: soft hover, a tick when it is the open one.
private struct DropdownRow<Content: View>: View {
  @Environment(\.palette) private var p
  let selected: Bool
  let action: () -> Void
  @ViewBuilder let content: Content

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        content
        Spacer(minLength: 8)
        if selected { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(p.accentText) }
      }
      .foregroundStyle(p.text)
      .padding(.horizontal, 8)
      .padding(.vertical, 6)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
      .hoverRow()
    }
    .buttonStyle(.plain)
  }
}

private struct TabButton: View {
  @Environment(\.palette) private var p
  let title: String
  let selected: Bool
  let indicator: Namespace.ID
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      Text(title)
        .font(Typeface.ui(13, .medium))
        .foregroundStyle(selected || hovering ? p.text : p.textFaint)
        .padding(.horizontal, 8)
        .padding(.top, 9)
        .padding(.bottom, 10)
        // The whole tab, not just its letters, takes the click.
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
          if selected {
            RoundedRectangle(cornerRadius: 2).fill(p.primary).frame(height: 2).matchedGeometryEffect(id: "tab", in: indicator)
          }
        }
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.hover, value: hovering)
  }
}

// MARK: - Ranked list

/// A card with rows; each has a soft bar behind it sized against the biggest. The hover background is its own layer
/// (see `HoverRow`), so the bar stays put when the pointer moves over it; only a change of the number moves the bar.
private struct RankedList: View {
  @Environment(\.palette) private var p
  @Environment(\.compact) private var compact
  let title: String
  let dimension: String
  let rows: [PageRow]
  var compactNumbers = true
  /// The list hasn't been read yet: a spinner instead of "Nothing yet".
  var loading = false

  var body: some View {
    let top = Double(rows.map(\.visitors).max() ?? 1)
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(title).font(Typeface.ui(14, .bold))
        Spacer()
        Text("Visitors").font(Typeface.ui(12, .medium)).foregroundStyle(p.textMuted)
      }
      .padding(.bottom, 2)
      if rows.isEmpty && loading {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 60)
      } else if rows.isEmpty {
        Text("Nothing yet").font(Typeface.ui(13)).foregroundStyle(p.textMuted).padding(.vertical, 4)
      }
      VStack(spacing: 2) {
        ForEach(rows, id: \.key) { row in
          HStack(spacing: 8) {
            if RowIcon.applies(dimension) && !row.key.isEmpty { RowIcon(dimension: dimension, key: row.key) }
            else if RowIcon.applies(dimension) { Color.clear.frame(width: 16, height: 16) }
            Text(Format.rowLabel(row.key, dimension: dimension)).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 12)
            Text(Format.number(Double(row.visitors), compact: compactNumbers)).monospacedDigit().foregroundStyle(p.textMuted)
          }
          .font(Typeface.ui(13))
          .padding(.horizontal, 8)
          .frame(minHeight: compact ? 24 : 30)
          .background(alignment: .leading) {
            GeometryReader { proxy in
              RoundedRectangle(cornerRadius: Layout.radiusRow)
                .fill(p.accentSoft)
                .frame(width: max(6, proxy.size.width * Double(row.visitors) / max(top, 1)))
                .animation(Motion.ease, value: row.visitors)
            }
          }
          .hoverRow()
        }
      }
    }
    .card(padding: compact ? 10 : 14)
  }
}

// MARK: - Chart

/// The period by hour or day in the metric's series colour. Hover shows the hour's value; a click pins it, and another click on
/// the same hour lets go.
private struct ChartCard: View {
  let model: AppModel
  let snapshot: Snapshot
  @Environment(\.palette) private var p
  @Environment(\.compact) private var compact
  @State private var hovered: SeriesPoint?
  @State private var pinned: SeriesPoint?

  private var metric: ChartMetric { model.settings.chartMetric }
  private var zone: TimeZone { TimeZone(identifier: snapshot.timeZone) ?? .current }
  private var shown: SeriesPoint? { hovered ?? pinned }
  private var unit: Calendar.Component { snapshot.range == .today ? .hour : .day }
  /// Revenue is always bars; the others follow the chart style setting.
  private var style: ChartStyle { metric == .revenue ? .bars : model.settings.chartStyle }
  private func color(_ metric: ChartMetric) -> Color { p.series(Self.kind(metric)) }
  private var tint: Color { color(metric) }

  static func kind(_ metric: ChartMetric) -> ChartMetricColor {
    switch metric {
    case .visitors: .visitors
    case .pageviews: .pageviews
    case .revenue: .revenue
    }
  }

  private func text(_ value: Double) -> String {
    metric == .revenue
      ? Format.money(minor: value, currency: snapshot.overview.currency)
      : Format.number(value, compact: model.settings.compactNumbers)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 4) {
        Text(snapshot.range.chartTitle).font(Typeface.ui(14, .bold))
        Spacer()
        ForEach(ChartMetric.allCases, id: \.self) { option in
          MetricChip(label: option.label, tint: color(option), selected: metric == option) {
            model.settings.chartMetric = option
            hovered = nil
            pinned = nil
          }
        }
      }
      if snapshot.series.count > 1 { chart } else {
        Text("The chart needs a little more data.").font(Typeface.ui(13)).foregroundStyle(p.textMuted)
          .frame(maxWidth: .infinity, minHeight: 80)
      }
    }
    .card(padding: compact ? 10 : 14)
  }

  private var chart: some View {
    Chart {
      ForEach(snapshot.series, id: \.ts) { point in
        switch style {
        case .bars:
          BarMark(x: .value("Time", point.date, unit: unit), y: .value(metric.label, point.value(metric)))
            .foregroundStyle(tint.opacity(shown == nil || shown?.ts == point.ts ? 1 : 0.45))
            .cornerRadius(2)
        case .area, .line:
          if style == .area {
            AreaMark(x: .value("Time", point.date), y: .value(metric.label, point.value(metric)))
              .interpolationMethod(.catmullRom)
              .foregroundStyle(LinearGradient(colors: [tint.opacity(0.28), tint.opacity(0.02)], startPoint: .top, endPoint: .bottom))
          }
          LineMark(x: .value("Time", point.date), y: .value(metric.label, point.value(metric)))
            .interpolationMethod(.catmullRom)
            .foregroundStyle(tint)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
      }
      if let shown {
        RuleMark(x: .value("Time", shown.date))
          .foregroundStyle(p.borderStrong)
          .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
          .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
            tooltip(shown)
          }
        if style != .bars {
          PointMark(x: .value("Time", shown.date), y: .value(metric.label, shown.value(metric)))
            .foregroundStyle(p.surface)
            .symbolSize(70)
          PointMark(x: .value("Time", shown.date), y: .value(metric.label, shown.value(metric)))
            .foregroundStyle(tint)
            .symbolSize(28)
        }
      }
    }
    .chartXAxis {
      AxisMarks(values: .stride(by: unit, count: snapshot.range == .today ? 6 : (snapshot.range == .week ? 1 : 7))) {
        AxisGridLine().foregroundStyle(p.border)
        AxisValueLabel(
          format: snapshot.range == .today
            ? Date.FormatStyle(timeZone: zone).hour() : Date.FormatStyle(timeZone: zone).month(.abbreviated).day()
        )
        .font(Typeface.ui(11)).foregroundStyle(p.textFaint)
      }
    }
    .chartYAxis { AxisMarks { AxisGridLine().foregroundStyle(p.border) } }
    .chartOverlay { proxy in
      GeometryReader { geometry in
        Rectangle().fill(Color.clear).contentShape(Rectangle())
          .onContinuousHover { phase in
            switch phase {
            case .active(let location): hovered = nearest(location.x, proxy, geometry)
            case .ended: hovered = nil
            }
          }
          .onTapGesture { location in
            let tapped = nearest(location.x, proxy, geometry)
            withAnimation(Motion.hover) { pinned = pinned?.ts == tapped?.ts ? nil : tapped }
          }
      }
    }
    .frame(height: compact ? 110 : 140)
  }

  /// The tooltip: the value in the mono font, the hour below it.
  private func tooltip(_ point: SeriesPoint) -> some View {
    VStack(spacing: 1) {
      Text(text(point.value(metric))).font(Typeface.mono(12, .semibold))
      Text(snapshot.range == .today ? Format.hour(point.date, timeZone: zone) : Format.day(point.date, timeZone: zone)).font(Typeface.ui(11)).foregroundStyle(p.textMuted)
    }
    .foregroundStyle(p.text)
    .padding(.horizontal, 9)
    .padding(.vertical, 5)
    .background(p.surface, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
    .overlay(RoundedRectangle(cornerRadius: Layout.radiusControl).stroke(p.border))
    .shadow(color: .black.opacity(p.isDark ? 0.5 : 0.12), radius: 8, y: 3)
  }

  /// The hour closest to a horizontal position in the chart.
  private func nearest(_ x: CGFloat, _ proxy: ChartProxy, _ geometry: GeometryProxy) -> SeriesPoint? {
    guard let frame = proxy.plotFrame else { return nil }
    let origin = geometry[frame].origin.x
    guard let date: Date = proxy.value(atX: x - origin) else { return nil }
    return snapshot.series.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }
  }
}

/// A metric choice above the chart: its series colour as a dot, soft indigo when selected, subtle on hover.
private struct MetricChip: View {
  @Environment(\.palette) private var p
  let label: String
  let tint: Color
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 5) {
        Circle().fill(tint).frame(width: 6, height: 6)
        Text(label).font(Typeface.ui(12, .semibold))
      }
      .padding(.horizontal, 8)
      .frame(height: 24)
      .foregroundStyle(selected ? p.accentText : p.textMuted)
      .background(selected ? p.accentSoft : (hovering ? p.bgSubtle : Color.clear), in: RoundedRectangle(cornerRadius: Layout.radiusRow))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.hover, value: hovering)
  }
}

// MARK: - Window

/// Tells the model when the popover's window is on screen and in front, so only then does it refresh faster.
struct WindowObserver: NSViewRepresentable {
  /// The size the content wants. The menu bar window doesn't follow a change of it while it is open, so the window is
  /// resized here, keeping its top edge and its centre where they are.
  let size: CGSize
  let onChange: @MainActor (Bool) -> Void

  func makeNSView(context: Context) -> NSView {
    let view = ObservingView()
    view.onChange = onChange
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {
    guard let window = view.window else { return }
    let current = window.contentRect(forFrameRect: window.frame).size
    guard abs(current.width - size.width) > 0.5 || abs(current.height - size.height) > 0.5 else { return }
    var frame = window.frame
    let chrome = frame.size.width - current.width
    let chromeHeight = frame.size.height - current.height
    let center = frame.midX, top = frame.maxY
    frame.size = CGSize(width: size.width + chrome, height: size.height + chromeHeight)
    frame.origin = CGPoint(x: center - frame.width / 2, y: top - frame.height)
    window.setFrame(frame, display: true, animate: false)
  }

  final class ObservingView: NSView {
    var onChange: (@MainActor (Bool) -> Void)?
    private var tokens: [NSObjectProtocol] = []

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      tokens.forEach(NotificationCenter.default.removeObserver)
      tokens = []
      guard let window else { return }
      for (name, open) in [(NSWindow.didBecomeKeyNotification, true), (NSWindow.didResignKeyNotification, false)] {
        tokens.append(
          NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.onChange?(open) }
          })
      }
      let visible = window.isKeyWindow
      Task { @MainActor in onChange?(visible) }
    }
  }
}

// MARK: - Updates

/// A strip above the header when a newer version of the app exists: update now, or leave this version alone.
private struct UpdateBanner: View {
  let model: AppModel
  let update: AppUpdate
  @Environment(\.palette) private var p

  var body: some View {
    let updater = model.updater
    HStack(spacing: 10) {
      Image(systemName: "arrow.down.circle.fill").foregroundStyle(p.accentText)
      VStack(alignment: .leading, spacing: 1) {
        Text("Version \(update.version) is available").font(Typeface.ui(13, .semibold))
        if case .failed(let message) = updater.phase {
          Text(message).font(Typeface.ui(12)).foregroundStyle(p.caution).fixedSize(horizontal: false, vertical: true)
        } else if updater.phase == .downloading {
          Text("Updating, the app opens again in a moment").font(Typeface.ui(12)).foregroundStyle(p.textMuted)
        }
      }
      Spacer(minLength: 8)
      if updater.phase == .downloading {
        ProgressView().controlSize(.small)
      } else {
        if case .failed = updater.phase {
          AppButton(title: "Release page", compact: true) { NSWorkspace.shared.open(update.page) }
        } else {
          AppButton(title: "Update", variant: .primary, compact: true) { Task { await updater.install() } }
        }
        IconButton(symbol: "xmark", help: "Skip this version") { model.settings.skippedVersion = update.version }
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 9)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(p.accentSoft)
    .overlay(alignment: .bottom) { Rectangle().fill(p.border).frame(height: 1) }
    .transition(.opacity)
  }
}
