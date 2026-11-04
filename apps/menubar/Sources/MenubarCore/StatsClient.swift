import Foundation

/// Reads the stats of one site with a read-only share link. Only GET requests, and the token travels in the
/// `x-analytik-share` header, so it is never part of an address.
public actor StatsClient {
  private let credentials: Credentials
  private let session: URLSession
  private let now: @Sendable () -> Date
  private var site: SiteInfo?

  public init(
    credentials: Credentials,
    session: URLSession = .shared,
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.credentials = credentials
    self.session = session
    self.now = now
  }

  /// The request for a route below `/sites/:id`, with the share header.
  nonisolated func request(_ route: String, _ query: [URLQueryItem] = []) -> URLRequest {
    var url = credentials.baseURL
    for part in ["sites", credentials.siteId] + route.split(separator: "/").map(String.init) {
      url.append(path: part)
    }
    var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    if !query.isEmpty { components?.queryItems = query }
    var request = URLRequest(url: components?.url ?? url)
    request.httpMethod = "GET"
    request.timeoutInterval = 15
    request.setValue(credentials.token, forHTTPHeaderField: "x-analytik-share")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    return request
  }

  /// Today against yesterday, who is online now, and the top pages of today.
  public func fetch(range: TimeRange = .today, includeSeries: Bool = false, rows: Int = 5, pace: Bool = false) async throws -> Snapshot {
    let info = try await siteInfo()
    let dates = Self.dates(now(), in: info.timezone, days: range.days)
    let window = [URLQueryItem(name: "from", value: dates.from), URLQueryItem(name: "to", value: dates.to)]
    async let overview: Overview = get(
      "overview", window + [URLQueryItem(name: "compare", value: "previous")])
    async let realtime: Realtime = get("realtime")
    async let pages: [PageRow] = get(
      "breakdown",
      window + [URLQueryItem(name: "dimension", value: "page"), URLQueryItem(name: "limit", value: String(rows))])
    async let series: [SeriesPoint] =
      includeSeries ? get("timeseries", window + [URLQueryItem(name: "interval", value: range.interval)]) : []
    let (overviewResult, realtimeResult, pagesResult, seriesResult) = try await (overview, realtime, pages, series)
    let paceResult = pace ? try await self.pace(info.timezone) : nil
    return Snapshot(
      siteName: info.name,
      timeZone: info.timezone,
      overview: overviewResult,
      online: realtimeResult.online,
      topPages: pagesResult,
      series: seriesResult,
      range: range,
      fetchedAt: now(),
      pace: paceResult
    )
  }

  /// Visitors by hour for today and yesterday, cut at the same time of day, so a quiet morning isn't a drop.
  private func pace(_ timeZone: String) async throws -> Pace {
    let moment = now()
    let today = Self.dates(moment, in: timeZone, days: 1).to
    let yesterday = Self.dates(moment.addingTimeInterval(-86_400), in: timeZone, days: 1).to
    func hours(_ day: String) async throws -> [SeriesPoint] {
      try await get("timeseries", [
        URLQueryItem(name: "from", value: day), URLQueryItem(name: "to", value: day), URLQueryItem(name: "interval", value: "hour"),
      ])
    }
    async let todays = hours(today)
    async let yesterdays = hours(yesterday)
    let (now, before) = try await (todays, yesterdays)
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
    let elapsed = moment.timeIntervalSince(calendar.startOfDay(for: moment))
    let yesterdayStart = (before.map(\.ts).min() ?? 0) / 1000
    let current = now.reduce(0) { $0 + $1.visitors }
    let previous = before.filter { $0.ts / 1000 - yesterdayStart < elapsed }.reduce(0) { $0 + $1.visitors }
    return Pace(current: current, previous: previous)
  }

  /// The top rows of one dimension for today, such as `country` or `browser`.
  public func breakdown(_ dimension: String, limit: Int = 8, range: TimeRange = .today) async throws -> [PageRow] {
    let info = try await siteInfo()
    let dates = Self.dates(now(), in: info.timezone, days: range.days)
    return try await get(
      "breakdown",
      [
        URLQueryItem(name: "from", value: dates.from), URLQueryItem(name: "to", value: dates.to),
        URLQueryItem(name: "dimension", value: dimension), URLQueryItem(name: "limit", value: String(limit)),
      ])
  }

  /// The site's host name and icon, for the site list. The icon comes from the server's favicon route when the share
  /// link may read it, otherwise from the site's own `/favicon.ico` (a plain request that carries no token). A missing
  /// icon is just nil: the list then shows the analytik mark.
  public func identity() async -> SiteIdentity? {
    guard let info = try? await siteInfo() else { return nil }
    let domain = info.domain?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    var viaServer = request("favicon")
    viaServer.setValue("image/*", forHTTPHeaderField: "accept")
    var icon = await image(viaServer)
    if icon == nil, let host = domain, Self.isPublicHost(host), let url = URL(string: "https://\(host)/favicon.ico") {
      var plain = URLRequest(url: url)
      plain.timeoutInterval = 10
      icon = await image(plain)
    }
    return SiteIdentity(domain: domain, icon: icon)
  }

  private func image(_ request: URLRequest) async -> Data? {
    guard let (data, response) = try? await session.data(for: request), let http = response as? HTTPURLResponse,
      http.statusCode == 200, !data.isEmpty, data.count <= 512_000
    else { return nil }
    return data
  }

  /// A public host name, not localhost or an IP address.
  static func isPublicHost(_ host: String) -> Bool {
    host.range(of: #"^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$"#, options: .regularExpression) != nil
  }

  /// The site's name and time zone; asked once, because "today" depends on the zone.
  private func siteInfo() async throws -> SiteInfo {
    if let site { return site }
    let response: SharedResponse = try await get("shared")
    site = response.site
    return response.site
  }

  private func get<T: Decodable>(_ route: String, _ query: [URLQueryItem] = []) async throws -> T {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request(route, query))
    } catch let error as URLError {
      throw Self.map(error)
    }
    guard let http = response as? HTTPURLResponse else { throw StatsError.malformed }
    switch http.statusCode {
    case 200..<300: break
    case 401, 403, 404: throw StatsError.accessRefused
    default: throw StatsError.server(http.statusCode)
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw StatsError.malformed
    }
  }

  /// Every transport failure (no network, timeout, DNS, refused connection) reads as offline.
  static func map(_ error: URLError) -> StatsError { .offline }

  /// The first and last day of a window ending today: the last `days` days, today included.
  static func dates(_ date: Date, in timeZone: String, days: Int) -> (from: String, to: String) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
    let start = calendar.date(byAdding: .day, value: -(max(1, days) - 1), to: date) ?? date
    return (day(start, in: timeZone), day(date, in: timeZone))
  }

  /// The calendar day of `date` in `timeZone`, as `YYYY-MM-DD`.
  static func day(_ date: Date, in timeZone: String) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
  }
}
