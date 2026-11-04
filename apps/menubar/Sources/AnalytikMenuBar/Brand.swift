import AppKit
import SwiftUI

/// The analytik mark: a blue triangle with a yellow face, cut by a diagonal gap (the same drawing as the dashboard's
/// `BrandMark`, on a 256 point grid). With `mono` it is one colour, the face a little lighter, for the menu bar.
@MainActor struct BrandMark: View {
  var mono = false
  var tint: (body: Color, face: Color) = (Color(hex: 0x3a8dff), Color(hex: 0xffc232))

  var body: some View {
    Canvas { context, size in
      let scale = min(size.width, size.height) / 256
      let transform = CGAffineTransform(scaleX: scale, y: scale)
      let body = Path { p in
        p.move(to: CGPoint(x: 128, y: 30)); p.addLine(to: CGPoint(x: 232, y: 224))
        p.addLine(to: CGPoint(x: 24, y: 224)); p.closeSubpath()
      }.applying(transform)
      let face = Path { p in
        p.move(to: CGPoint(x: 128, y: 30)); p.addLine(to: CGPoint(x: 172.5, y: 112.9))
        p.addLine(to: CGPoint(x: 35.3, y: 196.5)); p.closeSubpath()
      }.applying(transform)
      let cut = Path { p in
        p.move(to: CGPoint(x: 0, y: 218)); p.addLine(to: CGPoint(x: 256, y: 62))
      }.applying(transform)
      let join = StrokeStyle(lineWidth: 12 * scale, lineJoin: .round)
      context.drawLayer { layer in
        let blue = mono ? Color.black : tint.body
        let yellow = mono ? Color.black.opacity(0.5) : tint.face
        layer.fill(body, with: .color(blue))
        layer.stroke(body, with: .color(blue), style: join)
        if mono {
          // Lighten the face by clearing it first, then painting it at half strength.
          layer.blendMode = .destinationOut
          layer.fill(face, with: .color(.black.opacity(0.5)))
          layer.blendMode = .normal
        } else {
          layer.fill(face, with: .color(yellow))
          layer.stroke(face, with: .color(yellow), style: join)
        }
        layer.blendMode = .destinationOut
        layer.stroke(cut, with: .color(.black), style: StrokeStyle(lineWidth: 16 * scale))
      }
    }
  }

  /// The mark as a template image, so the menu bar tints it for light and dark.
  @MainActor static let menuBarImage: NSImage = {
    let renderer = ImageRenderer(content: BrandMark(mono: true).frame(width: 18, height: 18))
    renderer.scale = 3
    let image = renderer.nsImage ?? NSImage(systemSymbolName: "chart.bar.xaxis", accessibilityDescription: nil) ?? NSImage()
    image.isTemplate = true
    return image
  }()

  /// The menu bar image, with an orange dot in its corner when `dot` is set. The dot is coloured, so the image can't
  /// be a template; it is drawn in the label colour of the menu bar's own appearance instead.
  @MainActor static func menuBarImage(dot: Bool) -> NSImage {
    guard dot else { return menuBarImage }
    nonisolated(unsafe) let base = menuBarImage
    return NSImage(size: base.size, flipped: false) { rect in
      base.draw(in: rect)
      NSColor.labelColor.setFill()
      rect.fill(using: .sourceIn)
      NSColor.systemOrange.setFill()
      NSBezierPath(ovalIn: NSRect(x: rect.maxX - 7, y: rect.maxY - 7, width: 7, height: 7)).fill()
      return true
    }
  }
}

/// Names the dashboard reports that are drawn with another name's mark.
private let logoAliases: [String: String] = [
  "Mobile Safari": "Safari", "Opera Mini": "Opera", "Firefox Focus": "Firefox", "Chromium": "Chrome",
  "Android Browser": "Android", "Chrome WebView": "Chrome", "Chrome OS": "Chrome", "Mac OS": "Apple", "macOS": "Apple",
  "iOS": "Apple", "iPadOS": "Apple", "Windows Phone": "Windows", "Android TV": "Android", "Fire OS": "Android",
]

/// Brand marks cut from the dashboard's own set, drawn once per name and theme.
@MainActor private enum LogoCache {
  static var images: [String: NSImage?] = [:]

  static func image(_ name: String, text: Color, dark: Bool) -> NSImage? {
    let key = "\(name)|\(dark)"
    if let cached = images[key] { return cached }
    let resolved = logoAliases[name] ?? name
    var image: NSImage?
    if var svg = LogoData.marks[resolved] {
      // Bare 24x24 paths (Apple) are drawn in the text colour.
      if !svg.hasPrefix("<svg") {
        let hex = dark ? "#e7e9f1" : "#1b1f2a"
        svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"\(hex)\" d=\"\(svg)\"/></svg>"
      }
      image = svg.data(using: .utf8).flatMap { NSImage(data: $0) }
    }
    images[key] = image
    return image
  }
}

/// The small icon in front of a ranked row: a flag for a country, a brand mark for a browser or system, a symbol for
/// a device; nothing for other dimensions.
struct RowIcon: View {
  @Environment(\.palette) private var p
  @Environment(\.colorScheme) private var scheme
  let dimension: String
  let key: String

  /// Whether rows of this dimension carry an icon, so the names of all rows start at the same place.
  static func applies(_ dimension: String) -> Bool { ["country", "browser", "os", "device"].contains(dimension) }

  var body: some View {
    Group {
      switch dimension {
      case "country":
        Text(Self.flag(key) ?? "🌐").font(.system(size: 13))
      case "device":
        Image(systemName: Self.deviceSymbol(key)).font(.system(size: 11)).foregroundStyle(p.textMuted)
      default:
        if let image = LogoCache.image(key, text: p.text, dark: scheme == .dark) {
          Image(nsImage: image).resizable().scaledToFit()
        } else {
          Image(systemName: dimension == "os" ? "desktopcomputer" : "globe").font(.system(size: 11)).foregroundStyle(p.textMuted)
        }
      }
    }
    .frame(width: 16, height: 16)
  }

  static func flag(_ code: String) -> String? {
    guard code.count == 2, code.unicodeScalars.allSatisfy({ ("A"..."Z").contains($0) }) else { return nil }
    return String(String.UnicodeScalarView(code.unicodeScalars.compactMap { UnicodeScalar(127397 + $0.value) }))
  }

  static func deviceSymbol(_ key: String) -> String {
    switch key {
    case "Mobile": "iphone"
    case "Tablet": "ipad"
    case "Desktop": "desktopcomputer"
    default: "display"
    }
  }
}

/// A site's square in the site list: its own icon, or the analytik mark in a colour that depends on the site, so the
/// sites tell apart at a glance.
struct SiteTile: View {
  @Environment(\.palette) private var p
  let id: String
  /// The site's favicon as the server or the site sent it; nil, or data that is not an image, shows the mark.
  var icon: Data?
  var size: CGFloat = 34

  private static let tints: [(body: Color, face: Color)] = [
    (Color(hex: 0x3a8dff), Color(hex: 0xffc232)), (Color(hex: 0xf08a3c), Color(hex: 0xffc232)),
    (Color(hex: 0xd8334f), Color(hex: 0xffc232)), (Color(hex: 0xe0527f), Color(hex: 0xf9c9b6)),
    (Color(hex: 0x3aa0e8), Color(hex: 0xf0c4e6)),
  ]

  var body: some View {
    // A stable pick: the sum of the id's bytes, not `hashValue`, which changes with every launch.
    let index = id.utf8.reduce(0) { $0 &+ Int($1) } % Self.tints.count
    Group {
      if let icon, let image = NSImage(data: icon) {
        Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
      } else {
        BrandMark(tint: Self.tints[index])
      }
    }
      .padding(size * 0.2)
      .frame(width: size, height: size)
      .background(p.bgSubtle, in: RoundedRectangle(cornerRadius: Layout.radiusControl + 2))
      .overlay(RoundedRectangle(cornerRadius: Layout.radiusControl + 2).stroke(p.border))
  }
}
