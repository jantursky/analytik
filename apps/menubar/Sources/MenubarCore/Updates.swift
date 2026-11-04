import Foundation

/// A release of the app that is newer than the one running.
public struct AppUpdate: Equatable, Sendable {
  public let version: String
  public let tag: String
  /// The zip with the app, always on this repository's GitHub releases.
  public let download: URL
  /// The release page, for the notes and as the fallback when the app can't replace itself.
  public let page: URL
}

/// Versions written `1.2.3`; anything else (a development build, `0.0.0-dev`) has no order.
public struct AppVersion: Comparable, Equatable, Sendable {
  public let parts: [Int]

  public init?(_ text: String) {
    let pieces = text.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
    guard pieces.count == 3, pieces.allSatisfy({ $0 != nil }) else { return nil }
    parts = pieces.compactMap { $0 }
  }

  public static func < (a: AppVersion, b: AppVersion) -> Bool { a.parts.lexicographicallyPrecedes(b.parts) }
}

/// Asks GitHub for the newest `menubar-v*` release. No token: a few requests a day stay far below the limit.
public struct UpdateChecker: Sendable {
  public static let repository = "jantursky/analytik"
  public static let tagPrefix = "menubar-v"
  /// The Apple team that signs every release; an update signed by anyone else is refused.
  public static let teamID = "WC32T3GA27"

  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  private struct Release: Decodable {
    struct Asset: Decodable {
      let name: String
      let browser_download_url: String
    }
    let tag_name: String
    let draft: Bool?
    let html_url: String
    let assets: [Asset]
  }

  /// The newest release when it is newer than `current`; nil when the app is up to date, `current` is a development
  /// build, or GitHub can't be reached (a missed check is not worth an error).
  public func newest(than current: String) async -> AppUpdate? {
    guard let running = AppVersion(current),
      let url = URL(string: "https://api.github.com/repos/\(Self.repository)/releases?per_page=30")
    else { return nil }
    var request = URLRequest(url: url)
    request.timeoutInterval = 15
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "accept")
    guard let (data, response) = try? await session.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200,
      let releases = try? JSONDecoder().decode([Release].self, from: data)
    else { return nil }
    return Self.pick(releases, newerThan: running)
  }

  private static func pick(_ releases: [Release], newerThan running: AppVersion) -> AppUpdate? {
    let downloads = "https://github.com/\(repository)/releases/download/"
    var best: (AppVersion, AppUpdate)?
    for release in releases where release.draft != true && release.tag_name.hasPrefix(tagPrefix) {
      let text = String(release.tag_name.dropFirst(tagPrefix.count))
      guard let version = AppVersion(text), version > running, version > (best?.0 ?? running),
        let asset = release.assets.first(where: { $0.name.hasSuffix(".zip") && $0.browser_download_url.hasPrefix(downloads) }),
        let download = URL(string: asset.browser_download_url), let page = URL(string: release.html_url)
      else { continue }
      best = (version, AppUpdate(version: text, tag: release.tag_name, download: download, page: page))
    }
    return best?.1
  }

  /// Whether a check is due: never done, or the last one is older than `interval`.
  public static func isDue(last: Date?, now: Date, interval: TimeInterval = 6 * 3600) -> Bool {
    guard let last else { return true }
    return now.timeIntervalSince(last) >= interval
  }
}
