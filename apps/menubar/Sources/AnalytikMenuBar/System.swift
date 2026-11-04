import AppKit
import Carbon.HIToolbox
import MenubarCore
import Network
import UserNotifications

/// Whether the Mac has a network at all, so a lost connection isn't counted as a server outage.
final class NetworkWatch: @unchecked Sendable {
  private let monitor = NWPathMonitor()
  private let lock = NSLock()
  private var online = true

  init() {
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      self.lock.lock()
      self.online = path.status == .satisfied
      self.lock.unlock()
    }
    monitor.start(queue: DispatchQueue(label: "analytik.network"))
  }

  var isOnline: Bool {
    lock.lock()
    defer { lock.unlock() }
    return online
  }
}

/// macOS notifications for alerts. The permission is asked for when the first alert is switched on, not before.
enum Notifier {
  static func requestPermission() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  static func send(_ event: AlertEvent) {
    let content = UNMutableNotificationContent()
    content.title = event.title
    content.body = event.body
    content.sound = .default
    let request = UNNotificationRequest(identifier: "analytik.\(event.kind.rawValue).\(UUID().uuidString)", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request)
  }
}

/// A shortcut that works in every app, through Carbon's hot key API, which needs no accessibility permission.
@MainActor
final class HotKey {
  static let shared = HotKey()
  private var reference: EventHotKeyRef?
  private var handler: EventHandlerRef?
  private var action: (@MainActor () -> Void)?

  func register(_ shortcut: Shortcut?, action: @escaping @MainActor () -> Void) {
    if let reference { UnregisterEventHotKey(reference) }
    reference = nil
    guard let shortcut, shortcut.isValid else { return }
    self.action = action
    if handler == nil {
      var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
      InstallEventHandler(
        GetApplicationEventTarget(),
        { _, _, _ in
          DispatchQueue.main.async { MainActor.assumeIsolated { HotKey.shared.action?() } }
          return noErr
        }, 1, &spec, nil, &handler)
    }
    let id = EventHotKeyID(signature: OSType(0x414E4C59), id: 1)  // "ANLY"
    RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, id, GetApplicationEventTarget(), 0, &reference)
  }
}

extension Shortcut {
  /// The shortcut as people write it: ⌥⌘A.
  var label: String {
    var text = ""
    if modifiers & Shortcut.control != 0 { text += "⌃" }
    if modifiers & Shortcut.option != 0 { text += "⌥" }
    if modifiers & Shortcut.shift != 0 { text += "⇧" }
    if modifiers & Shortcut.command != 0 { text += "⌘" }
    return text + Self.keyName(keyCode)
  }

  /// The Carbon modifier mask of a key event.
  static func carbon(_ flags: NSEvent.ModifierFlags) -> UInt32 {
    var mask: UInt32 = 0
    if flags.contains(.command) { mask |= command }
    if flags.contains(.option) { mask |= option }
    if flags.contains(.control) { mask |= control }
    if flags.contains(.shift) { mask |= shift }
    return mask
  }

  private static func keyName(_ code: UInt32) -> String {
    let names: [UInt32: String] = [
      36: "↩", 48: "⇥", 49: "Space", 51: "⌫", 53: "⎋", 123: "←", 124: "→", 125: "↓", 126: "↑",
      122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
    ]
    if let name = names[code] { return name }
    let letters: [UInt32: String] = [
      0: "A", 11: "B", 8: "C", 2: "D", 14: "E", 3: "F", 5: "G", 4: "H", 34: "I", 38: "J", 40: "K", 37: "L", 46: "M", 45: "N", 31: "O",
      35: "P", 12: "Q", 15: "R", 1: "S", 17: "T", 32: "U", 9: "V", 13: "W", 7: "X", 16: "Y", 6: "Z",
      18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6", 26: "7", 28: "8", 25: "9", 29: "0",
    ]
    return letters[code] ?? "Key \(code)"
  }
}
