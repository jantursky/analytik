import Foundation
import Testing

@testable import MenubarCore

/// Answers requests from a closure instead of the network.
final class FakeProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, String))?
  nonisolated(unsafe) static var seen: [URLRequest] = []

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func stopLoading() {}

  override func startLoading() {
    Self.seen.append(request)
    do {
      let (status, body) = try Self.handler!(request)
      let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data(body.utf8))
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  static func session() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [FakeProtocol.self]
    return URLSession(configuration: configuration)
  }

  static func reset(_ handler: @escaping (URLRequest) throws -> (Int, String)) {
    seen = []
    self.handler = handler
  }
}

private func route(_ request: URLRequest) -> String { request.url!.path.split(separator: "/").last.map(String.init) ?? "" }

private func ok(_ request: URLRequest) -> (Int, String) {
  switch route(request) {
  case "shared": return (200, Fixtures.shared)
  case "overview": return (200, Fixtures.overview)
  case "realtime": return (200, Fixtures.realtime)
  default: return (200, Fixtures.breakdown)
  }
}

@Suite(.serialized) struct StatsClientTests {
  // 2026-11-04 23:30 UTC is already 2026-11-05 in Bratislava (UTC+1).
  let now = Date(timeIntervalSince1970: 1_793_835_000)

  func client() -> StatsClient {
    StatsClient(credentials: Fixtures.credentials, session: FakeProtocol.session(), now: { now })
  }

  @Test func readsTodayAgainstYesterdayInTheSitesTimeZone() async throws {
    FakeProtocol.reset(ok)
    let snapshot = try await client().fetch()
    #expect(snapshot.siteName == "Shop")
    #expect(snapshot.overview.visitors.value == 120)
    #expect(snapshot.overview.pageviews.change == nil)
    #expect(snapshot.overview.revenue.value == 12345)
    #expect(snapshot.online == 7)
    #expect(snapshot.topPages.map(\.key) == ["/", "/pricing"])
    let overview = FakeProtocol.seen.first { route($0) == "overview" }!
    let query = URLComponents(url: overview.url!, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(query.contains(URLQueryItem(name: "from", value: "2026-11-05")))
    #expect(query.contains(URLQueryItem(name: "to", value: "2026-11-05")))
    #expect(query.contains(URLQueryItem(name: "compare", value: "previous")))
  }

  @Test func theSiteListGetsTheDomainAndTheServersIcon() async throws {
    FakeProtocol.reset { request in route(request) == "favicon" ? (200, "icon-bytes") : ok(request) }
    let identity = await client().identity()
    #expect(identity == SiteIdentity(domain: "shop.test", icon: Data("icon-bytes".utf8)))
    let favicon = FakeProtocol.seen.first { route($0) == "favicon" }!
    #expect(favicon.value(forHTTPHeaderField: "x-analytik-share") == Fixtures.credentials.token)
  }

  @Test func withoutTheServersIconTheSitesOwnFaviconIsAskedWithoutTheToken() async throws {
    FakeProtocol.reset { request in
      switch request.url!.host() {
      case "shop.test": return (200, "own-icon")
      default: return route(request) == "favicon" ? (404, "") : ok(request)
      }
    }
    let identity = await client().identity()
    #expect(identity?.icon == Data("own-icon".utf8))
    let own = FakeProtocol.seen.first { $0.url!.host() == "shop.test" }!
    #expect(own.url!.path == "/favicon.ico")
    #expect(own.value(forHTTPHeaderField: "x-analytik-share") == nil)
  }

  @Test func aSiteWithoutAnIconStillGivesItsDomain() async throws {
    FakeProtocol.reset { request in route(request) == "shared" ? (200, Fixtures.shared) : (404, "") }
    let identity = await client().identity()
    #expect(identity == SiteIdentity(domain: "shop.test", icon: nil))
  }

  @Test func onlyPublicHostNamesAreAskedForAnIcon() {
    #expect(StatsClient.isPublicHost("shop.example.com"))
    #expect(!StatsClient.isPublicHost("localhost"))
    #expect(!StatsClient.isPublicHost("192.168.1.5"))
    #expect(!StatsClient.isPublicHost("a.test/../x"))
  }

  @Test func paceComparesTodayWithTheSameStretchOfYesterday() async throws {
    FakeProtocol.reset { request in
      guard route(request) == "timeseries" else { return ok(request) }
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      let from = query.first { $0.name == "from" }?.value
      func point(_ ts: Int, _ visitors: Int) -> String { #"{"ts":\#(ts),"visitors":\#(visitors),"pageviews":0,"revenue":0}"# }
      if from == "2026-11-05" { return (200, "[" + point(1_793_833_200_000, 10) + "]") }
      // Yesterday: the hours starting at 00:00, 01:00 and 02:00; only the first falls inside 30 minutes.
      let start = 1_793_746_800_000
      return (200, "[" + [point(start, 30), point(start + 3_600_000, 40), point(start + 7_200_000, 50)].joined(separator: ",") + "]")
    }
    let snapshot = try await client().fetch(pace: true)
    #expect(snapshot.pace == Pace(current: 10, previous: 30))
    FakeProtocol.reset(ok)
    #expect(try await client().fetch().pace == nil)
  }

  @Test func sendsTheTokenInAHeaderOnlyAndOnlyReads() async throws {
    FakeProtocol.reset(ok)
    _ = try await client().fetch()
    #expect(FakeProtocol.seen.count == 4)  // shared, overview, realtime, breakdown
    for request in FakeProtocol.seen {
      #expect(request.httpMethod == "GET")
      #expect(request.value(forHTTPHeaderField: "x-analytik-share") == Fixtures.credentials.token)
      #expect(!request.url!.absoluteString.contains(Fixtures.credentials.token))
      #expect(request.url!.path.hasPrefix("/api/analytik/sites/site_a/"))
    }
  }

  @Test func readsTodayByHourOnlyWhenAsked() async throws {
    let series = #"[{"ts":1793836800000,"visitors":5,"sessions":5,"pageviews":9,"revenue":100,"orders":1,"bounceRate":0}]"#
    FakeProtocol.reset { request in route(request) == "timeseries" ? (200, series) : ok(request) }
    let without = try await client().fetch()
    #expect(without.series.isEmpty)
    #expect(!FakeProtocol.seen.contains { route($0) == "timeseries" })
    let with = try await client().fetch(includeSeries: true)
    #expect(with.series.map(\.visitors) == [5])
    #expect(with.series.first?.value(.pageviews) == 9)
    let request = FakeProtocol.seen.first { route($0) == "timeseries" }!
    let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(query.contains(URLQueryItem(name: "interval", value: "hour")))
  }

  @Test func readsOneDimensionForToday() async throws {
    FakeProtocol.reset(ok)
    let rows = try await client().breakdown("country", limit: 3)
    #expect(rows.map(\.key) == ["/", "/pricing"])
    let request = FakeProtocol.seen.first { route($0) == "breakdown" }!
    let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(query.contains(URLQueryItem(name: "dimension", value: "country")))
    #expect(query.contains(URLQueryItem(name: "limit", value: "3")))
    #expect(query.contains(URLQueryItem(name: "from", value: "2026-11-05")))
    #expect(request.value(forHTTPHeaderField: "x-analytik-share") == Fixtures.credentials.token)
  }

  @Test func theRowsSettingSetsTheTopPagesLimitAndTheSnapshotKeepsTheZone() async throws {
    FakeProtocol.reset(ok)
    let snapshot = try await client().fetch(rows: 10)
    #expect(snapshot.timeZone == "Europe/Bratislava")
    let request = FakeProtocol.seen.first { route($0) == "breakdown" }!
    let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(query.contains(URLQueryItem(name: "limit", value: "10")))
  }

  @Test func theClientAsksForTheChosenRange() async throws {
    FakeProtocol.reset { request in route(request) == "timeseries" ? (200, "[]") : ok(request) }
    let client = StatsClient(
      credentials: Fixtures.credentials, session: FakeProtocol.session(), now: { Date(timeIntervalSince1970: 1_793_835_000) })
    let snapshot = try await client.fetch(range: .week, includeSeries: true)
    #expect(snapshot.range == .week)
    let overview = FakeProtocol.seen.first { route($0) == "overview" }!
    let query = URLComponents(url: overview.url!, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(query.contains(URLQueryItem(name: "from", value: "2026-10-30")))
    #expect(query.contains(URLQueryItem(name: "to", value: "2026-11-05")))
    let series = FakeProtocol.seen.first { route($0) == "timeseries" }!
    let seriesQuery = URLComponents(url: series.url!, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(seriesQuery.contains(URLQueryItem(name: "interval", value: "day")))
  }

  @Test func asksForTheSiteOnlyOnce() async throws {
    FakeProtocol.reset(ok)
    let client = client()
    _ = try await client.fetch()
    _ = try await client.fetch()
    #expect(FakeProtocol.seen.filter { route($0) == "shared" }.count == 1)
  }

  @Test(arguments: [401, 403, 404]) func refusedLinkIsAccessRefused(status: Int) async {
    FakeProtocol.reset { _ in (status, #"{"error":"unauthorized"}"#) }
    await #expect(throws: StatsError.accessRefused) { try await client().fetch() }
  }

  @Test func serverErrorKeepsItsCode() async {
    FakeProtocol.reset { _ in (503, "") }
    await #expect(throws: StatsError.server(503)) { try await client().fetch() }
  }

  @Test func noNetworkIsOffline() async {
    FakeProtocol.reset { _ in throw URLError(.notConnectedToInternet) }
    await #expect(throws: StatsError.offline) { try await client().fetch() }
  }

  @Test func timeoutIsOffline() async {
    FakeProtocol.reset { _ in throw URLError(.timedOut) }
    await #expect(throws: StatsError.offline) { try await client().fetch() }
  }

  @Test func answerThatIsNotJSONIsMalformed() async {
    FakeProtocol.reset { _ in (200, "<html>not the api</html>") }
    await #expect(throws: StatsError.malformed) { try await client().fetch() }
  }

  @Test func answerWithoutTheExpectedFieldsIsMalformed() async {
    FakeProtocol.reset { request in route(request) == "shared" ? (200, Fixtures.shared) : (200, "{}") }
    await #expect(throws: StatsError.malformed) { try await client().fetch() }
  }

  @Test func dayFollowsTheZone() {
    #expect(StatsClient.day(now, in: "UTC") == "2026-11-04")
    #expect(StatsClient.day(now, in: "Europe/Bratislava") == "2026-11-05")
    #expect(StatsClient.day(now, in: "America/Los_Angeles") == "2026-11-04")
  }
}
