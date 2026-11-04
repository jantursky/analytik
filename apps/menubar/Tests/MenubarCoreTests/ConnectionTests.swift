import Foundation
import Testing

@testable import MenubarCore

final class MemoryTokens: TokenStore, @unchecked Sendable {
  var tokens: [String: String] = [:]
  func read(account: String) -> String? { tokens[account] }
  func save(_ token: String, account: String) -> Bool { tokens[account] = token; return true }
  func delete(account: String) { tokens[account] = nil }
}

struct ConnectionTests {
  func store(_ tokens: MemoryTokens = MemoryTokens(), suite: String = UUID().uuidString) -> ConnectionStore {
    ConnectionStore(defaults: UserDefaults(suiteName: "menubar-test-\(suite)")!, tokens: tokens)
  }

  func connection(_ site: String = "demo", server: String = "https://a.test/api") -> Connection {
    Connection(name: site, serverURL: server, siteId: site)
  }

  @Test func needsAllThreeValues() {
    #expect(Connection.credentials(serverURL: "https://a.test/api", siteId: "s", token: "t") != nil)
    #expect(Connection.credentials(serverURL: "", siteId: "s", token: "t") == nil)
    #expect(Connection.credentials(serverURL: "https://a.test", siteId: " ", token: "t") == nil)
    #expect(Connection.credentials(serverURL: "https://a.test", siteId: "s", token: "") == nil)
  }

  @Test func onlyHTTPAddressesAreAccepted() {
    #expect(Connection.credentials(serverURL: "ftp://a.test", siteId: "s", token: "t") == nil)
    #expect(Connection.credentials(serverURL: "not a url", siteId: "s", token: "t") == nil)
    #expect(Connection.credentials(serverURL: "http://localhost:8787", siteId: "s", token: "t") != nil)
  }

  @Test func valuesAreTrimmed() {
    let credentials = Connection.credentials(serverURL: " https://a.test/api \n", siteId: " s ", token: " t\n")
    #expect(credentials?.siteId == "s")
    #expect(credentials?.token == "t")
    #expect(credentials?.baseURL.absoluteString == "https://a.test/api")
  }

  @Test func holdsSeveralSitesWithTheirOwnTokens() {
    let tokens = MemoryTokens()
    let connections = store(tokens)
    let one = connection("one"), two = connection("two", server: "https://b.test/api")
    #expect(connections.add(one, token: "token-one"))
    #expect(connections.add(two, token: "token-two"))
    #expect(connections.list().map(\.siteId) == ["one", "two"])
    #expect(connections.token(for: one) == "token-one")
    #expect(connections.token(for: two) == "token-two")
  }

  @Test func tokensNeverGoToDefaults() {
    let defaults = UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!
    let connections = ConnectionStore(defaults: defaults, tokens: MemoryTokens())
    _ = connections.add(connection(), token: "secret-token-value")
    let stored = String(data: defaults.data(forKey: "connections") ?? Data(), encoding: .utf8) ?? ""
    #expect(!stored.contains("secret-token-value"))
  }

  @Test func addingTheSameSiteTwiceReplacesIt() {
    let connections = store()
    _ = connections.add(connection(), token: "old")
    var renamed = connection()
    renamed.name = "New name"
    _ = connections.add(renamed, token: "new")
    #expect(connections.list().count == 1)
    #expect(connections.list().first?.name == "New name")
    #expect(connections.token(for: connections.list()[0]) == "new")
  }

  @Test func disconnectingDeletesTheToken() {
    let tokens = MemoryTokens()
    let connections = store(tokens)
    let one = connection("one"), two = connection("two", server: "https://b.test/api")
    _ = connections.add(one, token: "a")
    _ = connections.add(two, token: "b")
    connections.remove(one)
    #expect(connections.list().map(\.siteId) == ["two"])
    #expect(tokens.read(account: one.id) == nil)
    #expect(tokens.read(account: two.id) == "b")
  }

  @Test func aConnectionWithoutATokenIsDropped() {
    let tokens = MemoryTokens()
    let connections = store(tokens)
    let one = connection()
    _ = connections.add(one, token: "a")
    tokens.delete(account: one.id)
    #expect(connections.list().isEmpty)
  }

  @Test func aDamagedListReadsAsEmpty() {
    let defaults = UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!
    defaults.set(Data("not json".utf8), forKey: "connections")
    #expect(ConnectionStore(defaults: defaults, tokens: MemoryTokens()).list().isEmpty)
  }
}

struct ConnectionLinkTests {
  let token = "GcQx22NC3TwmqAvdamk71Lmoos-JILxBnyvqPbndwOk"

  @Test func readsTheMacAppLink() {
    let text = "analytik://connect?server=http%3A%2F%2Flocalhost%3A5173%2Fapi&site=demo&token=\(token)&name=My%20shop"
    let link = ConnectionLink.parse(text)
    #expect(link?.serverURL == "http://localhost:5173/api")
    #expect(link?.siteId == "demo")
    #expect(link?.token == token)
    #expect(link?.name == "My shop")
    #expect(link?.serverIsGuess == false)
  }

  @Test func ignoresSurroundingWhitespaceAndTrailingText() {
    let link = ConnectionLink.parse("  analytik://connect?server=https%3A%2F%2Fa.test%2Fapi&site=s&token=t  \n and more")
    #expect(link?.siteId == "s")
  }

  @Test func aDashboardLinkGuessesTheServer() {
    let link = ConnectionLink.parse("http://localhost:5173/?site=demo&share=\(token)")
    #expect(link?.serverURL == "http://localhost:5173/api")
    #expect(link?.serverIsGuess == true)
    #expect(link?.siteId == "demo")
    #expect(link?.token == token)
    let other = ConnectionLink.parse("https://stats.example.com/dashboard?site=s&share=t#x")
    #expect(other?.serverURL == "https://stats.example.com/api")
  }

  @Test(arguments: [
    "", "hello", "https://example.com", "https://example.com/?site=demo", "https://example.com/?share=abc",
    "analytik://connect?site=demo&token=abc", "analytik://other?server=https%3A%2F%2Fa.test&site=s&token=t",
    "analytik://connect?server=ftp%3A%2F%2Fa.test&site=s&token=t", "ftp://a.test/?site=s&share=t",
  ]) func ignoresAnythingElse(text: String) {
    #expect(ConnectionLink.parse(text) == nil)
  }
}

struct AppSettingsTests {
  @Test func defaultsAreSensible() {
    let settings = AppSettings()
    #expect(settings.refreshSeconds == 60)
    #expect(settings.menuBarNumber == .online)
    #expect(settings.showChart)
    #expect(!settings.paused)
  }

  @Test func survivesARestart() {
    let defaults = UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!
    var settings = AppSettings()
    settings.refreshSeconds = 300
    settings.menuBarNumber = .revenue
    settings.chartMetric = .pageviews
    settings.paused = true
    settings.selectedId = "abc"
    settings.save(defaults)
    #expect(AppSettings.load(defaults) == settings)
  }

  @Test func readsSettingsFromAnOlderVersion() {
    let defaults = UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!
    defaults.set(Data(#"{"refreshSeconds":30}"#.utf8), forKey: "appSettings")
    let loaded = AppSettings.load(defaults)
    #expect(loaded.refreshSeconds == 30)
    #expect(loaded.showChart)
  }

  @Test func damagedSettingsFallBackToDefaults() {
    let defaults = UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!
    defaults.set(Data("nope".utf8), forKey: "appSettings")
    #expect(AppSettings.load(defaults) == AppSettings())
  }

  @Test func theIntervalSettingSetsTheClosedPaceWithAFloor() {
    var settings = AppSettings()
    settings.refreshSeconds = 300
    #expect(settings.policy.closed == 300)
    #expect(settings.policy.open == 10)
    settings.refreshSeconds = 1
    #expect(settings.policy.closed == 10)
  }
}

struct KeychainTests {
  @Test func storesReadsReplacesAndDeletesPerAccount() {
    let store = KeychainTokenStore(service: "com.apptiary.analytik.menubar.test.\(UUID().uuidString)")
    defer { store.delete(account: "a"); store.delete(account: "b") }
    #expect(store.read(account: "a") == nil)
    #expect(store.save("one", account: "a"))
    #expect(store.save("other", account: "b"))
    #expect(store.read(account: "a") == "one")
    #expect(store.save("two", account: "a"))
    #expect(store.read(account: "a") == "two")
    #expect(store.read(account: "b") == "other")
    store.delete(account: "a")
    #expect(store.read(account: "a") == nil)
    #expect(store.read(account: "b") == "other")
  }
}
