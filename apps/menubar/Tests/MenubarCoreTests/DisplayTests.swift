import Foundation
import Testing

@testable import MenubarCore

struct DisplayTests {
  let us = Locale(identifier: "en_US")

  func overview(extra: Bool = true) -> Overview {
    Overview(
      visitors: Delta(value: 12_300, previous: 10_000, change: 0.23),
      pageviews: Delta(value: 400, previous: 0, change: nil),
      revenue: Delta(value: 12345, previous: 0, change: nil), currency: "USD", online: 1,
      bounceRate: extra ? Delta(value: 0.43, previous: 0.5, change: -0.14) : nil,
      avgDurationMs: extra ? Delta(value: 192_000, previous: 0, change: nil) : nil,
      orders: extra ? Delta(value: 3, previous: 2, change: 0.5) : nil,
      conversionRate: extra ? Delta(value: 0.024, previous: 0.01, change: 1.4) : nil)
  }

  @Test func headlineNumbersAreWrittenForTheirKind() {
    let o = overview()
    #expect(HeadlineMetric.visitors.text(o, compact: true, locale: us) == "12.3K")
    #expect(HeadlineMetric.visitors.text(o, compact: false, locale: us) == "12,300")
    #expect(HeadlineMetric.revenue.text(o, locale: us) == "$123.45")
    #expect(HeadlineMetric.bounceRate.text(o, locale: us) == "43%")
    #expect(HeadlineMetric.conversion.text(o, locale: us) == "2.4%")
    #expect(HeadlineMetric.duration.text(o, locale: us) == "3m 12s")
    #expect(HeadlineMetric.orders.text(o, locale: us) == "3")
  }

  @Test func aNumberTheServerDidntSendIsNil() {
    let o = overview(extra: false)
    for metric in [HeadlineMetric.bounceRate, .duration, .orders, .conversion] {
      #expect(metric.text(o, locale: us) == nil)
      #expect(metric.delta(o) == nil)
    }
    #expect(HeadlineMetric.visitors.text(o, locale: us) != nil)
  }

  @Test func onlyTheBounceRateIsBetterWhenItFalls() {
    #expect(HeadlineMetric.allCases.filter(\.lowerIsBetter) == [.bounceRate])
  }

  @Test func durationsAndShares() {
    #expect(Format.duration(milliseconds: 45_000) == "45s")
    #expect(Format.duration(milliseconds: 3_900_000) == "1h 5m")
    #expect(Format.percent(0.05, locale: us) == "5.0%")
    #expect(Format.percent(0.5, locale: us) == "50%")
  }

  @Test func rangesAreWindowsEndingToday() {
    #expect(TimeRange.allCases.map(\.days) == [1, 7, 30])
    #expect(TimeRange.today.interval == "hour")
    #expect(TimeRange.week.interval == "day")
    #expect(TimeRange.week.chartTitle == "Last 7 days by day")
    let at = Date(timeIntervalSince1970: 1_793_835_000)  // 2026-11-05 in Bratislava
    let week = StatsClient.dates(at, in: "Europe/Bratislava", days: 7)
    #expect(week.from == "2026-10-30")
    #expect(week.to == "2026-11-05")
    let today = StatsClient.dates(at, in: "Europe/Bratislava", days: 1)
    #expect(today.from == "2026-11-05" && today.to == "2026-11-05")
  }

  @Test func windowSizesGrowAndStayInOrder() {
    #expect(WindowWidth.allCases.map(\.points) == [360, 440, 540, 680])
    #expect(WindowHeight.allCases.map(\.points) == [520, 600, 720])
  }

  @Test func newSettingsSurviveARestartAndOldOnesLoad() {
    let defaults = UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!
    var settings = AppSettings()
    settings.windowWidth = .wide
    settings.windowHeight = .tall
    settings.density = .compact
    settings.chartStyle = .bars
    settings.range = .month
    settings.headline = [.visitors, .conversion]
    settings.compactNumbers = false
    settings.showChange = false
    settings.showMenuBarIcon = false
    settings.save(defaults)
    #expect(AppSettings.load(defaults) == settings)
    defaults.set(Data(#"{"refreshSeconds":30,"headline":[]}"#.utf8), forKey: "appSettings")
    let old = AppSettings.load(defaults)
    #expect(old.windowWidth == .compact)
    #expect(old.range == .today)
    #expect(old.headline == [.visitors])  // Never empty: the top of the popover would have nothing in it.
    #expect(old.showMenuBarIcon)
  }

  @Test func theOptionalOverviewNumbersAreDecodedWhenPresent() throws {
    let json = #"{"visitors":{"value":1,"previous":1,"change":0},"pageviews":{"value":1,"previous":1,"change":0},"revenue":{"value":0,"previous":0,"change":null},"currency":"EUR","online":0,"bounceRate":{"value":0.5,"previous":0.4,"change":0.25},"orders":{"value":2,"previous":1,"change":1}}"#
    let decoded = try JSONDecoder().decode(Overview.self, from: Data(json.utf8))
    #expect(decoded.bounceRate?.value == 0.5)
    #expect(decoded.orders?.value == 2)
    #expect(decoded.avgDurationMs == nil)
  }
}

struct DashboardLinkTests {
  @Test func aStoredDashboardAddressWins() {
    let connection = Connection(name: "n", serverURL: "https://api.test/api", siteId: "s", dashboardURL: "https://app.test/?site=s&share=t")
    #expect(connection.dashboard(token: "other")?.absoluteString == "https://app.test/?site=s&share=t")
  }

  @Test func withoutOneItFallsBackToTheServersOriginWithTheShareLink() {
    let connection = Connection(name: "n", serverURL: "http://localhost:5173/api", siteId: "demo")
    #expect(connection.dashboard(token: "tok")?.absoluteString == "http://localhost:5173/?site=demo&share=tok")
  }

  @Test func withoutTheShareTokenItOpensTheSiteAsWhoeverIsSignedIn() {
    let stored = Connection(name: "n", serverURL: "https://api.test/api", siteId: "s", dashboardURL: "https://app.test/?site=s&share=t")
    #expect(stored.dashboard(token: "t", withShare: false)?.absoluteString == "https://app.test/?site=s")
    let derived = Connection(name: "n", serverURL: "http://localhost:5173/api", siteId: "demo")
    #expect(derived.dashboard(token: "tok", withShare: false)?.absoluteString == "http://localhost:5173/?site=demo")
    let bare = Connection(name: "n", serverURL: "https://api.test", siteId: "s", dashboardURL: "https://app.test/")
    #expect(bare.dashboard(token: "t", withShare: false)?.absoluteString == "https://app.test/")
  }

  @Test func aBrokenStoredAddressFallsBack() {
    let connection = Connection(name: "n", serverURL: "https://a.test/api", siteId: "s", dashboardURL: "javascript:alert(1)")
    #expect(connection.dashboard(token: "t")?.absoluteString == "https://a.test/?site=s&share=t")
  }

  @Test func theMacAppLinkCarriesTheDashboardAddress() {
    let link = ConnectionLink.parse(
      "analytik://connect?server=https%3A%2F%2Fa.test%2Fapi&site=s&token=t&dashboard=https%3A%2F%2Fa.test%2F%3Fsite%3Ds%26share%3Dt")
    #expect(link?.dashboardURL == "https://a.test/?site=s&share=t")
    #expect(ConnectionLink.parse("analytik://connect?server=https%3A%2F%2Fa.test%2Fapi&site=s&token=t&dashboard=javascript%3A1")?.dashboardURL == nil)
  }

  @Test func aDashboardLinkIsItsOwnDashboardAddress() {
    #expect(ConnectionLink.parse("https://a.test/?site=s&share=t")?.dashboardURL == "https://a.test/?site=s&share=t")
  }

  @Test func theDashboardAddressSurvivesStorage() {
    let store = ConnectionStore(defaults: UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!, tokens: MemoryTokens())
    _ = store.add(Connection(name: "n", serverURL: "https://a.test/api", siteId: "s", dashboardURL: "https://a.test/?site=s&share=t"), token: "t")
    #expect(store.list().first?.dashboardURL == "https://a.test/?site=s&share=t")
  }
}
