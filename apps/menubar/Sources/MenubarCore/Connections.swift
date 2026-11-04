import Foundation
import Security

/// Where share tokens are kept, one per connection. The Keychain in the app, memory in tests.
public protocol TokenStore: Sendable {
  func read(account: String) -> String?
  func save(_ token: String, account: String) -> Bool
  func delete(account: String)
}

public struct KeychainTokenStore: TokenStore {
  private let service: String

  public init(service: String = "com.apptiary.analytik.menubar") {
    self.service = service
  }

  private func match(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  public func read(account: String) -> String? {
    var query = match(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  public func save(_ token: String, account: String) -> Bool {
    delete(account: account)
    var item = match(account)
    item[kSecValueData as String] = Data(token.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  public func delete(account: String) {
    SecItemDelete(match(account) as CFDictionary)
  }
}

/// One connected site. The token is not part of it: it lives in the Keychain under `id`.
public struct Connection: Codable, Identifiable, Equatable, Sendable, Hashable {
  public let id: String
  public var name: String
  public var serverURL: String
  public var siteId: String
  /// Where the dashboard of this site opens in the browser; nil falls back to the server's own address.
  public var dashboardURL: String?

  public init(id: String = UUID().uuidString, name: String, serverURL: String, siteId: String, dashboardURL: String? = nil) {
    self.id = id
    self.name = name
    self.serverURL = serverURL
    self.siteId = siteId
    self.dashboardURL = dashboardURL
  }

  /// The address that opens the dashboard read-only. A stored one wins; otherwise the server's origin with the site and
  /// token, which is where the dashboard is when it is served next to the API.
  /// With `withShare: false` the read-only token is left out, so the address opens the site as whoever is signed in to
  /// the dashboard in the browser, with the owner's full access.
  public func dashboard(token: String, withShare: Bool = true) -> URL? {
    var parts: URLComponents
    if let dashboardURL, let url = URL(string: dashboardURL), ["http", "https"].contains(url.scheme),
      let stored = URLComponents(url: url, resolvingAgainstBaseURL: false)
    {
      parts = stored
    } else {
      guard let origin = URLComponents(string: serverURL), origin.host != nil else { return nil }
      parts = origin
      parts.path = "/"
      parts.queryItems = [URLQueryItem(name: "site", value: siteId), URLQueryItem(name: "share", value: token)]
      parts.fragment = nil
    }
    if !withShare {
      let rest = (parts.queryItems ?? []).filter { $0.name != "share" }
      parts.queryItems = rest.isEmpty ? nil : rest
    }
    return parts.url
  }

  public func credentials(token: String) -> Credentials? {
    Connection.credentials(serverURL: serverURL, siteId: siteId, token: token)
  }

  /// Checks the three values a connection needs: an http(s) address, a site id and a token.
  public static func credentials(serverURL: String, siteId: String, token: String) -> Credentials? {
    let site = siteId.trimmingCharacters(in: .whitespacesAndNewlines)
    let secret = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !site.isEmpty, !secret.isEmpty,
      let url = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
      let scheme = url.scheme, scheme == "http" || scheme == "https", url.host() != nil
    else { return nil }
    return Credentials(baseURL: url, siteId: site, token: secret)
  }
}

/// The list of connections: addresses and ids in `UserDefaults` (as JSON), tokens in the token store.
public struct ConnectionStore: Sendable {
  private let defaults: UserDefaultsBox
  private let tokens: any TokenStore
  private let key = "connections"

  public init(defaults: UserDefaults = .standard, tokens: any TokenStore = KeychainTokenStore()) {
    self.defaults = UserDefaultsBox(defaults)
    self.tokens = tokens
  }

  /// Every connection that still has a token. A damaged list reads as empty rather than crashing the app.
  public func list() -> [Connection] {
    guard let data = defaults.value.data(forKey: key),
      let all = try? JSONDecoder().decode([Connection].self, from: data)
    else { return [] }
    return all.filter { tokens.read(account: $0.id) != nil }
  }

  public func token(for connection: Connection) -> String { tokens.read(account: connection.id) ?? "" }

  /// Adds a connection, or replaces the one for the same server and site. Returns false when the Keychain refused.
  @discardableResult
  public func add(_ connection: Connection, token: String) -> Bool {
    var all = list()
    var connection = connection
    if let same = all.first(where: { $0.serverURL == connection.serverURL && $0.siteId == connection.siteId }) {
      connection = Connection(
        id: same.id, name: connection.name, serverURL: connection.serverURL, siteId: connection.siteId,
        dashboardURL: connection.dashboardURL)
      all.removeAll { $0.id == same.id }
    }
    guard tokens.save(token, account: connection.id) else { return false }
    all.append(connection)
    persist(all)
    return true
  }

  /// Disconnects: the token is deleted along with the entry.
  public func remove(_ connection: Connection) {
    tokens.delete(account: connection.id)
    persist(list().filter { $0.id != connection.id })
  }

  private func persist(_ all: [Connection]) {
    if let data = try? JSONEncoder().encode(all) { defaults.value.set(data, forKey: key) }
  }
}

/// `UserDefaults` is thread-safe but not marked `Sendable`.
struct UserDefaultsBox: @unchecked Sendable {
  let value: UserDefaults
  init(_ value: UserDefaults) { self.value = value }
}

/// What a pasted or opened link holds. The Mac app link has all three parts; a plain dashboard link has no server.
public struct ConnectionLink: Equatable, Sendable {
  public var serverURL: String
  /// True when the server was worked out from a dashboard address and may be wrong.
  public var serverIsGuess: Bool
  public var siteId: String
  public var token: String
  public var name: String?
  /// The address that opens the dashboard in the browser, when the link carries it.
  public var dashboardURL: String?

  /// Reads `analytik://connect?server=&site=&token=&name=`, or a dashboard link `https://host/?site=&share=`.
  /// Returns nil for anything else, so a clipboard with other text is ignored.
  public static func parse(_ text: String) -> ConnectionLink? {
    let candidate = text.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
    guard let components = URLComponents(string: candidate), let scheme = components.scheme?.lowercased() else { return nil }
    let items = Dictionary((components.queryItems ?? []).compactMap { item in item.value.map { (item.name, $0) } }) { first, _ in first }
    if scheme == "analytik", components.host == "connect" {
      guard let server = items["server"], let site = items["site"], let token = items["token"],
        Connection.credentials(serverURL: server, siteId: site, token: token) != nil
      else { return nil }
      let dashboard = items["dashboard"].flatMap { URL(string: $0) }.flatMap { ["http", "https"].contains($0.scheme) ? $0.absoluteString : nil }
      return ConnectionLink(
        serverURL: server, serverIsGuess: false, siteId: site, token: token, name: items["name"], dashboardURL: dashboard)
    }
    if scheme == "http" || scheme == "https", let site = items["site"], let token = items["share"], !site.isEmpty, !token.isEmpty,
      let host = components.host
    {
      var origin = URLComponents()
      origin.scheme = scheme
      origin.host = host
      origin.port = components.port
      origin.path = "/api"
      return ConnectionLink(
        serverURL: origin.string ?? "", serverIsGuess: true, siteId: site, token: token, name: nil, dashboardURL: candidate)
    }
    return nil
  }
}

/// Every connected site, with its token, as one piece of text to carry to another Mac. It is the sites' JSON in
/// base64 behind a prefix: it hides nothing, so it is as private as the tokens themselves. The tokens only read.
public enum SiteBundle {
  public static let prefix = "analytik-sites:"

  public struct Entry: Codable, Equatable, Sendable {
    public var name: String
    public var serverURL: String
    public var siteId: String
    public var dashboardURL: String?
    public var token: String
  }

  public static func encode(_ sites: [(connection: Connection, token: String)]) -> String {
    let entries = sites.map {
      Entry(name: $0.connection.name, serverURL: $0.connection.serverURL, siteId: $0.connection.siteId, dashboardURL: $0.connection.dashboardURL, token: $0.token)
    }
    let data = (try? JSONEncoder().encode(entries)) ?? Data()
    let text = data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    return prefix + text
  }

  /// The sites in a bundle, or nil when the text isn't one. Entries without a usable address or token are dropped.
  public static func decode(_ text: String) -> [Entry]? {
    let candidate = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard candidate.hasPrefix(prefix) else { return nil }
    var body = String(candidate.dropFirst(prefix.count))
      .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while body.count % 4 != 0 { body += "=" }
    guard let data = Data(base64Encoded: body), let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return nil }
    let usable = entries.filter { Connection.credentials(serverURL: $0.serverURL, siteId: $0.siteId, token: $0.token) != nil }
    return usable.isEmpty ? nil : usable
  }
}
