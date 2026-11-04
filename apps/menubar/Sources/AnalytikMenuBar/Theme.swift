import AppKit
import SwiftUI

/// The analytik design tokens, as the dashboard defines them in `dashboard/styles.css` (`--analytik-*`): a cool grey
/// page, white cards with a 1px border and small radii, an indigo primary, and a fixed set of series colours.
/// Change a value here only when it changes there.
struct Palette {
  let bg, surface, bgSubtle, bgMuted, border, borderStrong: Color
  let text, textMuted, textFaint: Color
  let primary, onPrimary, accentText, accentSoft: Color
  let series1, series2, series3, series4: Color
  let success, successSoft, successText: Color
  let warning, warningSoft, danger, dangerSoft, onDanger: Color
  let caution, cautionSoft: Color
  let isDark: Bool

  static let light = Palette(
    bg: Color(hex: 0xf2f4f8), surface: Color(hex: 0xffffff), bgSubtle: Color(hex: 0xf7f8fb), bgMuted: Color(hex: 0xe9edf3),
    border: Color(hex: 0xe0e5ee), borderStrong: Color(hex: 0xc9d0dc),
    text: Color(hex: 0x101828), textMuted: Color(hex: 0x4a5568), textFaint: Color(hex: 0x5f6b7d),
    primary: Color(hex: 0x3a4fd8), onPrimary: Color(hex: 0xffffff), accentText: Color(hex: 0x3446c9),
    accentSoft: Color(hex: 0xe9ecfd),
    series1: Color(hex: 0x5b6cf0), series2: Color(hex: 0x19a97b), series3: Color(hex: 0xf0a03c), series4: Color(hex: 0xd65f9b),
    success: Color(hex: 0x13995a), successSoft: Color(hex: 0xdcf4e7), successText: Color(hex: 0x0f6e42),
    warning: Color(hex: 0xc9541f), warningSoft: Color(hex: 0xfde8dc), danger: Color(hex: 0xb42f2f),
    dangerSoft: Color(hex: 0xfdeaea), onDanger: Color(hex: 0xffffff),
    caution: Color(hex: 0x9a6700), cautionSoft: Color(hex: 0xfdf1d0), isDark: false)

  static let dark = Palette(
    bg: Color(hex: 0x0b1020), surface: Color(hex: 0x121a2c), bgSubtle: Color(hex: 0x161f33), bgMuted: Color(hex: 0x1d2740),
    border: Color(hex: 0x232e47), borderStrong: Color(hex: 0x34415f),
    text: Color(hex: 0xe9edf6), textMuted: Color(hex: 0xa8b2c7), textFaint: Color(hex: 0x8f9ab0),
    primary: Color(hex: 0x8a97ff), onPrimary: Color(hex: 0x0b1020), accentText: Color(hex: 0xa3adff),
    accentSoft: Color(hex: 0x1f2752),
    series1: Color(hex: 0x7c89ff), series2: Color(hex: 0x2fc796), series3: Color(hex: 0xf0a03c), series4: Color(hex: 0xd65f9b),
    success: Color(hex: 0x3ddc84), successSoft: Color(hex: 0x0f3024), successText: Color(hex: 0x7ee8ae),
    warning: Color(hex: 0xf2925f), warningSoft: Color(hex: 0x3a2116), danger: Color(hex: 0xff8a80),
    dangerSoft: Color(hex: 0x3a1a1c), onDanger: Color(hex: 0x0b1020),
    caution: Color(hex: 0xf5c04e), cautionSoft: Color(hex: 0x33270f), isDark: true)

  /// The series colour of a chart metric: visitors take the primary series, revenue the green one.
  func series(_ metric: ChartMetricColor) -> Color {
    switch metric {
    case .visitors: series1
    case .revenue: series2
    case .pageviews: series3
    }
  }
}

enum ChartMetricColor { case visitors, pageviews, revenue }

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255,
      opacity: 1)
  }
}

private struct CompactKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
  /// Tighter rows and cards, from the Density setting.
  var compact: Bool {
    get { self[CompactKey.self] }
    set { self[CompactKey.self] = newValue }
  }
}

private struct PaletteKey: EnvironmentKey { static let defaultValue = Palette.light }

extension EnvironmentValues {
  var palette: Palette {
    get { self[PaletteKey.self] }
    set { self[PaletteKey.self] = newValue }
  }
}

/// Figtree is the dashboard's UI font and Geist Mono its mono font. Neither is bundled (the web doesn't bundle them
/// either): they are used when installed, otherwise the system fonts stand in.
enum Typeface {
  private static let figtree = NSFont(name: "Figtree", size: 12) != nil
  private static let geistMono = NSFont(name: "Geist Mono", size: 12) != nil

  static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    figtree ? .custom("Figtree", size: size).weight(weight) : .system(size: size, weight: weight)
  }

  static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    geistMono ? .custom("Geist Mono", size: size).weight(weight) : .system(size: size, weight: weight, design: .monospaced)
  }
}

/// The dashboard's easing, `--analytik-ease`, and the durations it uses for hover (150 ms) and sliding (300 ms).
enum Motion {
  static let ease = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.3)
  static let hover = Animation.easeOut(duration: 0.15)
}

/// The popover is one size on every screen (the user picks it in the settings): a fixed width, and a fixed height whose content scrolls. Switching tabs
/// or opening the settings never resizes the window, so nothing jumps or gets clipped. More sections are more tabs
/// and more scrolling, never a wider window.
enum Layout {
  static let radiusControl: CGFloat = 8
  static let radiusRow: CGFloat = 6
  static let radiusCard: CGFloat = 12
}

// MARK: - Surfaces

/// A white card with a 1px border and the dashboard's card shadow.
struct CardStyle: ViewModifier {
  @Environment(\.palette) private var p
  var padding: CGFloat = 0

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .background(p.surface, in: RoundedRectangle(cornerRadius: Layout.radiusCard))
      .overlay(RoundedRectangle(cornerRadius: Layout.radiusCard).stroke(p.border))
      .shadow(color: p.isDark ? .clear : Color(hex: 0x101828).opacity(0.05), radius: 1, y: 1)
  }
}

extension View {
  func card(padding: CGFloat = 0) -> some View { modifier(CardStyle(padding: padding)) }
  func field(mono: Bool = false) -> some View { modifier(FieldStyle(mono: mono)) }
  /// A row that takes the subtle background while the pointer is over it.
  func hoverRow() -> some View { modifier(HoverRow()) }
}

/// The hover background sits in its own layer and only its opacity animates, so what is drawn on the row (a bar whose
/// width follows a number, say) never animates with it.
struct HoverRow: ViewModifier {
  @Environment(\.palette) private var p
  @State private var hovering = false

  func body(content: Content) -> some View {
    content
      .background {
        RoundedRectangle(cornerRadius: Layout.radiusRow)
          .fill(p.bgSubtle)
          .opacity(hovering ? 1 : 0)
          .animation(Motion.hover, value: hovering)
      }
      .onHover { hovering = $0 }
  }
}

/// A text field: 36 pt, a strong border that turns to the text colour on focus, like `.analytik-input`.
struct FieldStyle: ViewModifier {
  @Environment(\.palette) private var p
  var mono = false
  @FocusState private var focused: Bool

  func body(content: Content) -> some View {
    content
      .textFieldStyle(.plain)
      .font(mono ? Typeface.mono(12) : Typeface.ui(13))
      .focused($focused)
      .padding(.horizontal, 12)
      .frame(minHeight: 36)
      .background(p.surface, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
      .overlay(RoundedRectangle(cornerRadius: Layout.radiusControl).stroke(focused ? p.text : p.borderStrong))
      .animation(Motion.hover, value: focused)
  }
}

// MARK: - Buttons

enum ButtonVariant { case secondary, primary, danger }

/// `.analytik-button`: 600 weight, 8 pt radius, a border; hover darkens the border (secondary) or the fill (primary).
struct AppButton: View {
  @Environment(\.palette) private var p
  @Environment(\.isEnabled) private var enabled
  let title: String
  var symbol: String?
  var variant: ButtonVariant = .secondary
  var compact = false
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if let symbol { Image(systemName: symbol).font(.system(size: 11, weight: .semibold)) }
        Text(title).font(Typeface.ui(13, .semibold))
      }
      .padding(.horizontal, compact ? 12 : 16)
      .frame(minHeight: compact ? 28 : 34)
      .foregroundStyle(foreground)
      .background(background, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
      .overlay(RoundedRectangle(cornerRadius: Layout.radiusControl).stroke(border))
      .brightness(variant != .secondary && hovering && enabled ? -0.06 : 0)
      .opacity(enabled ? 1 : 0.55)
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.hover, value: hovering)
  }

  private var foreground: Color {
    switch variant {
    case .secondary: p.text
    case .primary: enabled ? p.onPrimary : p.textMuted
    case .danger: p.onDanger
    }
  }

  private var background: Color {
    switch variant {
    case .secondary: hovering && enabled ? p.bgSubtle : p.surface
    case .primary: enabled ? p.primary : p.bgMuted
    case .danger: p.danger
    }
  }

  private var border: Color {
    switch variant {
    case .secondary: hovering && enabled ? p.borderStrong : p.border
    case .primary: enabled ? p.primary : p.border
    case .danger: p.danger
    }
  }
}

struct IconButton: View {
  @Environment(\.palette) private var p
  let symbol: String
  let help: String
  var active = false
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 12, weight: .semibold))
        .frame(width: 28, height: 28)
        .foregroundStyle(active ? p.accentText : p.textMuted)
        .background(active ? p.accentSoft : (hovering ? p.bgSubtle : Color.clear), in: RoundedRectangle(cornerRadius: Layout.radiusControl))
        .overlay(RoundedRectangle(cornerRadius: Layout.radiusControl).stroke(hovering && !active ? p.border : Color.clear))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.hover, value: hovering)
    .help(help)
  }
}

// MARK: - Headers

/// A screen's top bar: a back button and a title (16 pt, 700, like a card heading), on the surface with a rule below.
struct ScreenHeader: View {
  @Environment(\.palette) private var p
  let title: String
  var back: (() -> Void)?

  var body: some View {
    HStack(spacing: 8) {
      if let back { IconButton(symbol: "chevron.left", help: "Back", action: back) }
      Text(title).font(Typeface.ui(16, .bold))
      Spacer()
    }
    .padding(.horizontal, 16)
    .frame(height: 52)
    .background(p.surface)
    .overlay(alignment: .bottom) { Rectangle().fill(p.border).frame(height: 1) }
  }
}
