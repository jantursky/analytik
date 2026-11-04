import Foundation
import Testing

@testable import MenubarCore

struct FormatTests {
  let us = Locale(identifier: "en_US")

  @Test func numbersAreExactBelowTenThousandAndCompactAbove() {
    #expect(Format.number(1234, locale: us) == "1,234")
    #expect(Format.number(9999, locale: us) == "9,999")
    #expect(Format.number(12_300, locale: us) == "12.3K")
    #expect(Format.number(1_000_000, locale: us) == "1M")
  }

  @Test func moneyIsGivenInMinorUnits() {
    #expect(Format.money(minor: 12345, currency: "USD", locale: us) == "$123.45")
    #expect(Format.money(minor: 12300, currency: "USD", locale: us) == "$123")
    #expect(Format.money(minor: 500, currency: "JPY", locale: us) == "¥500")
    #expect(Format.money(minor: 0, currency: "USD", locale: us) == "$0")
  }

  @Test func changeShowsDirectionAndRounds() {
    #expect(Format.change(Delta(value: 12, previous: 10, change: 0.2))?.text == "+20%")
    #expect(Format.change(Delta(value: 12, previous: 10, change: 0.2))?.trend == .up)
    #expect(Format.change(Delta(value: 7, previous: 10, change: -0.3))?.text == "\u{2212}30%")
    #expect(Format.change(Delta(value: 7, previous: 10, change: -0.3))?.trend == .down)
    #expect(Format.change(Delta(value: 10, previous: 10, change: 0.001))?.trend == .flat)
    #expect(Format.change(Delta(value: 5, previous: 0, change: nil)) == nil)
  }

  @Test func ageIsReadable() {
    let now = Date(timeIntervalSince1970: 100_000)
    #expect(Format.age(of: now.addingTimeInterval(-30), now: now) == "just now")
    #expect(Format.age(of: now.addingTimeInterval(-300), now: now) == "5 min ago")
    #expect(Format.age(of: now.addingTimeInterval(-7300), now: now) == "2 h ago")
  }

  func snapshot(online: Int, visitors: Double, revenue: Double, currency: String = "EUR") -> Snapshot {
    Snapshot(
      siteName: "S",
      overview: Overview(
        visitors: Delta(value: visitors, previous: 0, change: nil), pageviews: Delta(value: 0, previous: 0, change: nil),
        revenue: Delta(value: revenue, previous: 0, change: nil), currency: currency, online: online),
      online: online, topPages: [], fetchedAt: Date(timeIntervalSince1970: 0))
  }

  @Test func menuBarShowsTheChosenNumber() {
    let ready = [Status.ready(snapshot(online: 3, visitors: 120, revenue: 12345))]
    #expect(Format.menuBarTitle(ready, number: .online, locale: us) == "3")
    #expect(Format.menuBarTitle(ready, number: .visitors, locale: us) == "120")
    #expect(Format.menuBarTitle(ready, number: .revenue, locale: us) == "€123.45")
    #expect(Format.menuBarTitle(ready, number: .none, locale: us) == "")
    #expect(Format.menuBarTitle([.refreshing(snapshot(online: 2, visitors: 1, revenue: 0))], number: .online) == "2")
  }

  @Test func menuBarShowsADashWhenThereIsNoTrueNumber() {
    for status in [Status.stale(Fixtures.snapshot, .offline), .failed(.accessRefused), .notSetUp, .loading] {
      #expect(Format.menuBarTitle([status], number: .online) == "\u{2013}")
    }
    #expect(Format.menuBarTitle([], number: .online) == "\u{2013}")
  }

  @Test func menuBarAddsUpSitesThatHaveNumbers() {
    let sites = [
      Status.ready(snapshot(online: 3, visitors: 100, revenue: 1000)),
      .ready(snapshot(online: 4, visitors: 50, revenue: 500)),
      .failed(.offline),
    ]
    #expect(Format.menuBarTitle(sites, number: .online, locale: us) == "7")
    #expect(Format.menuBarTitle(sites, number: .visitors, locale: us) == "150")
    #expect(Format.menuBarTitle(sites, number: .revenue, locale: us) == "€15")
  }

  @Test func differentCurrenciesAreNotAddedUp() {
    let sites = [
      Status.ready(snapshot(online: 3, visitors: 1, revenue: 1000, currency: "EUR")),
      .ready(snapshot(online: 4, visitors: 1, revenue: 500, currency: "USD")),
    ]
    #expect(Format.menuBarTitle(sites, number: .revenue, locale: us) == "7")
  }

  @Test func pausedShowsAPauseMarkWhateverElse() {
    let ready = [Status.ready(snapshot(online: 3, visitors: 1, revenue: 0))]
    #expect(Format.menuBarTitle(ready, number: .online, paused: true) == "\u{23F8}")
  }

  @Test func everyFailureHasItsOwnSentence() {
    let errors: [StatsError] = [.notSetUp, .offline, .accessRefused, .server(500), .malformed]
    #expect(Set(errors.map(Format.message)).count == errors.count)
  }
}
