import AppKit
import MenubarCore
import Observation
import SwiftUI

/// The building blocks of the settings, in the dashboard's card style: a heading, a white bordered card of rows, and
/// a muted note below.

struct SettingsGroup<Content: View>: View {
  @Environment(\.palette) private var p
  let title: String
  var footer: String?
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title.uppercased())
        .font(Typeface.ui(11.5, .semibold))
        .tracking(0.5)
        .foregroundStyle(p.textMuted)
        .padding(.horizontal, 4)
      VStack(spacing: 0) { content }
        .card()
        .clipShape(RoundedRectangle(cornerRadius: Layout.radiusCard))
      if let footer {
        Text(footer)
          .font(Typeface.ui(12))
          .foregroundStyle(p.textMuted)
          .padding(.horizontal, 4)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

/// A rule between two rows of a group, inset to line up with the labels.
struct RowDivider: View {
  @Environment(\.palette) private var p
  var body: some View { Rectangle().fill(p.border).frame(height: 1).padding(.leading, 48) }
}

/// A small soft-indigo square with an icon in it, the dashboard's icon treatment.
struct IconTile: View {
  @Environment(\.palette) private var p
  let symbol: String

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(p.accentText)
      .frame(width: 26, height: 26)
      .background(p.accentSoft, in: RoundedRectangle(cornerRadius: Layout.radiusRow))
  }
}

struct SettingRow<Control: View>: View {
  @Environment(\.palette) private var p
  let symbol: String
  let title: String
  var subtitle: String?
  @ViewBuilder let control: Control

  var body: some View {
    HStack(spacing: 10) {
      IconTile(symbol: symbol)
      VStack(alignment: .leading, spacing: 1) {
        Text(title).font(Typeface.ui(14, .medium))
        if let subtitle { Text(subtitle).font(Typeface.ui(12)).foregroundStyle(p.textMuted) }
      }
      Spacer(minLength: 8)
      control
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .frame(minHeight: 46)
  }
}

/// An on/off switch: the primary colour when on, a strong border grey when off.
struct SwitchControl: View {
  @Environment(\.palette) private var p
  let title: String
  @Binding var isOn: Bool

  var body: some View {
    Button { withAnimation(Motion.ease) { isOn.toggle() } } label: {
      Capsule()
        .fill(isOn ? p.primary : p.borderStrong)
        .frame(width: 38, height: 22)
        .overlay(alignment: isOn ? .trailing : .leading) {
          Circle().fill(isOn ? p.onPrimary : Color.white).shadow(color: .black.opacity(0.2), radius: 1, y: 1)
            .frame(width: 18, height: 18).padding(2)
        }
    }
    .buttonStyle(.plain)
    .accessibilityRepresentation { Toggle(title, isOn: $isOn) }
  }
}

/// The list that opens under a `MenuControl`. It is drawn by the popover itself, above everything, so no scroll view or
/// card clips it, and it looks like the site list rather than a system menu.
@MainActor
@Observable
final class DropdownHost {
  static let shared = DropdownHost()

  struct Item: Identifiable {
    let id: Int
    let label: String
    let selected: Bool
  }

  private(set) var items: [Item] = []
  private(set) var anchor: CGRect = .zero
  private var choose: ((Int) -> Void)?
  var isOpen: Bool { !items.isEmpty }

  func present(items: [Item], anchor: CGRect, choose: @escaping (Int) -> Void) {
    withAnimation(Motion.hover) {
      self.items = items
      self.anchor = anchor
      self.choose = choose
    }
  }

  func pick(_ id: Int) {
    choose?(id)
    close()
  }

  func close() {
    withAnimation(Motion.hover) {
      items = []
      choose = nil
    }
  }
}

/// A choice from a short list, shown as the current value with a chevron, like the dashboard's selects.
struct MenuControl<Value: Hashable>: View {
  @Environment(\.palette) private var p
  @Binding var selection: Value
  let options: [(value: Value, label: String)]
  @State private var hovering = false
  @State private var frame: CGRect = .zero

  var body: some View {
    Button {
      DropdownHost.shared.present(
        items: options.enumerated().map { .init(id: $0.offset, label: $0.element.label, selected: $0.element.value == selection) },
        anchor: frame
      ) { selection = options[$0].value }
    } label: {
      HStack(spacing: 6) {
        Text(options.first { $0.value == selection }?.label ?? "").font(Typeface.ui(13, .medium))
        Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .bold)).foregroundStyle(p.textFaint)
      }
      .foregroundStyle(p.text)
      .padding(.horizontal, 10)
      .frame(minHeight: 28)
      .background(hovering ? p.bgSubtle : p.surface, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
      .overlay(RoundedRectangle(cornerRadius: Layout.radiusControl).stroke(hovering ? p.borderStrong : p.border))
      .background {
        GeometryReader { proxy in
          Color.clear.onAppear { frame = proxy.frame(in: .named("popover")) }
            .onChange(of: proxy.frame(in: .named("popover"))) { _, new in frame = new }
        }
      }
    }
    .buttonStyle(.plain)
    .fixedSize()
    .onHover { hovering = $0 }
    .animation(Motion.hover, value: hovering)
  }
}

/// The open list of a `MenuControl`, under its button and lined up with its right edge.
struct DropdownLayer: View {
  @Environment(\.palette) private var p
  let host: DropdownHost
  let width: CGFloat

  var body: some View {
    if host.isOpen {
      ZStack(alignment: .topLeading) {
        Color.clear.contentShape(Rectangle()).onTapGesture { host.close() }
        let panelWidth = max(host.anchor.width, 170)
        let x = min(max(8, host.anchor.maxX - panelWidth), width - panelWidth - 8)
        VStack(spacing: 2) {
          ForEach(host.items) { item in
            DropdownOption(label: item.label, selected: item.selected) { host.pick(item.id) }
          }
        }
        .padding(6)
        .frame(width: panelWidth)
        .background(p.surface, in: RoundedRectangle(cornerRadius: Layout.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: Layout.radiusCard).stroke(p.border))
        .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
        .offset(x: x, y: host.anchor.maxY + 6)
        .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top)))
      }
    }
  }
}

private struct DropdownOption: View {
  @Environment(\.palette) private var p
  let label: String
  let selected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Text(label).font(Typeface.ui(14, selected ? .bold : .medium))
        Spacer(minLength: 8)
        if selected { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(p.accentText) }
      }
      .foregroundStyle(p.text)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
      .hoverRow()
    }
    .buttonStyle(.plain)
  }
}

/// A row of choices where one is selected: a muted track with the chosen one raised, filling the width.
struct SegmentedControl<Value: Hashable>: View {
  @Environment(\.palette) private var p
  @Binding var selection: Value
  let options: [(value: Value, label: String, symbol: String?)]
  @Namespace private var thumb

  var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.value) { option in
        let selected = option.value == selection
        Button { withAnimation(Motion.ease) { selection = option.value } } label: {
          HStack(spacing: 6) {
            if let symbol = option.symbol { Image(systemName: symbol).font(.system(size: 11, weight: .semibold)) }
            Text(option.label).font(Typeface.ui(13, .semibold))
          }
          .frame(maxWidth: .infinity, minHeight: 30)
          .foregroundStyle(selected ? p.text : p.textMuted)
          // The whole segment takes the click, not just its text.
          .contentShape(Rectangle())
          .background {
            if selected {
              RoundedRectangle(cornerRadius: Layout.radiusControl - 2)
                .fill(p.surface)
                .overlay(RoundedRectangle(cornerRadius: Layout.radiusControl - 2).stroke(p.border))
                .matchedGeometryEffect(id: "thumb", in: thumb)
            }
          }
        }
        .buttonStyle(.plain)
      }
    }
    .padding(3)
    .background(p.bgMuted, in: RoundedRectangle(cornerRadius: Layout.radiusControl))
    .padding(10)
  }
}

/// A button that records a shortcut: click it, press the keys. Esc cancels and Delete clears.
struct ShortcutRecorder: View {
  @Environment(\.palette) private var p
  @Binding var shortcut: Shortcut?
  @State private var recording = false
  @State private var monitor: Any?
  @State private var note: String?

  var body: some View {
    HStack(spacing: 8) {
      if let note { Text(note).font(Typeface.ui(11)).foregroundStyle(p.warning) }
      AppButton(title: recording ? "Press keys…" : (shortcut?.label ?? "Record"), compact: true) { toggle() }
      if shortcut != nil && !recording {
        IconButton(symbol: "xmark", help: "Remove the shortcut") { shortcut = nil }
      }
    }
    .onDisappear { stop() }
  }

  private func toggle() {
    if recording { stop(); return }
    recording = true
    note = nil
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      switch event.keyCode {
      case 53: stop()  // Esc
      case 51, 117: shortcut = nil; stop()  // Delete
      default:
        let candidate = Shortcut(keyCode: UInt32(event.keyCode), modifiers: Shortcut.carbon(event.modifierFlags))
        if candidate.isValid { shortcut = candidate; stop() } else { note = "Add ⌘, ⌥ or ⌃" }
      }
      return nil
    }
  }

  private func stop() {
    recording = false
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
  }
}
