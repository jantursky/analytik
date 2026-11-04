import Foundation
import Testing

@testable import MenubarCore

struct SettingsShapeTests {
  @Test func settingsSavedByAnOlderVersionStillLoad() throws {
    let old = #"{"refreshSeconds":300,"rows":8,"headline":["visitors"]}"#
    let loaded = try JSONDecoder().decode(AppSettings.self, from: Data(old.utf8))
    #expect(loaded.refreshSeconds == 300)
    #expect(loaded.rows == 8)
    #expect(loaded.alerts == AlertRules())
    #expect(loaded.shortcut == nil)
    #expect(loaded.headlinePerRow == 0)
  }

  @Test func aShortcutNeedsACommandOptionOrControlKey() {
    #expect(Shortcut(keyCode: 0, modifiers: Shortcut.command).isValid)
    #expect(Shortcut(keyCode: 0, modifiers: Shortcut.option | Shortcut.shift).isValid)
    #expect(!Shortcut(keyCode: 0, modifiers: 0).isValid)
    #expect(!Shortcut(keyCode: 0, modifiers: Shortcut.shift).isValid)
  }
}

struct AlertTests {
  let start = Date(timeIntervalSince1970: 1_000_000)

  func overview() -> Overview {
    let zero = Delta(value: 0, previous: 0, change: nil)
    return Overview(visitors: zero, pageviews: zero, revenue: zero, currency: "USD", online: 0)
  }

  func snapshot(current: Double, previous: Double) -> Status {
    .ready(Snapshot(siteName: "Shop", overview: overview(), online: 0, topPages: [], fetchedAt: start, pace: Pace(current: current, previous: previous)))
  }

  func run(_ evaluator: inout AlertEvaluator, _ status: Status, _ rules: AlertRules, at offset: TimeInterval = 0, online: Bool = true) -> [AlertEvent] {
    evaluator.evaluate(status: status, rules: rules, siteName: "Shop", now: start.addingTimeInterval(offset), macOnline: online)
  }

  @Test func aJumpFiresOnceUntilItClears() {
    var evaluator = AlertEvaluator()
    let rules = AlertRules(jumpPercent: 50)
    #expect(run(&evaluator, snapshot(current: 160, previous: 100), rules).map(\.kind) == [.jump])
    #expect(run(&evaluator, snapshot(current: 170, previous: 100), rules).isEmpty)
    #expect(run(&evaluator, snapshot(current: 110, previous: 100), rules).isEmpty)
    #expect(run(&evaluator, snapshot(current: 160, previous: 100), rules).map(\.kind) == [.jump])
  }

  @Test func aDropFiresWhenTheSameStretchOfYesterdayWasBusier() {
    var evaluator = AlertEvaluator()
    #expect(run(&evaluator, snapshot(current: 40, previous: 100), AlertRules(dropPercent: 50)).map(\.kind) == [.drop])
  }

  @Test func aQuietYesterdayNeverTriggersAPercentage() {
    var evaluator = AlertEvaluator()
    let rules = AlertRules(jumpPercent: 25, dropPercent: 25)
    #expect(run(&evaluator, snapshot(current: 15, previous: 4), rules).isEmpty)
    #expect(run(&evaluator, snapshot(current: 0, previous: 10), rules).isEmpty)
  }

  @Test func offRulesNeverFire() {
    var evaluator = AlertEvaluator()
    #expect(run(&evaluator, snapshot(current: 1000, previous: 100), AlertRules()).isEmpty)
    #expect(run(&evaluator, .failed(.offline), AlertRules(), at: 9999).isEmpty)
  }

  @Test func aSilentServerFiresAfterTheChosenMinutesAndOnlyOnce() {
    var evaluator = AlertEvaluator()
    let rules = AlertRules(downMinutes: 5)
    #expect(run(&evaluator, .failed(.server(500)), rules, at: 0).isEmpty)
    #expect(run(&evaluator, .failed(.server(500)), rules, at: 240).isEmpty)
    #expect(run(&evaluator, .failed(.server(500)), rules, at: 301).map(\.kind) == [.serverDown])
    #expect(run(&evaluator, .failed(.server(500)), rules, at: 600).isEmpty)
    #expect(run(&evaluator, snapshot(current: 1, previous: 1), rules, at: 700).isEmpty)
    #expect(run(&evaluator, .failed(.server(500)), rules, at: 800).isEmpty)
    #expect(run(&evaluator, .failed(.server(500)), rules, at: 1200).map(\.kind) == [.serverDown])
  }

  @Test func timeWithoutANetworkIsNotCountedAgainstTheServer() {
    var evaluator = AlertEvaluator()
    let rules = AlertRules(downMinutes: 5)
    #expect(run(&evaluator, .failed(.offline), rules, at: 0, online: false).isEmpty)
    #expect(run(&evaluator, .failed(.offline), rules, at: 3600, online: false).isEmpty)
    // Back online: the count starts now.
    #expect(run(&evaluator, .failed(.offline), rules, at: 3700, online: true).isEmpty)
    #expect(run(&evaluator, .failed(.offline), rules, at: 4100, online: true).map(\.kind) == [.serverDown])
  }

  @Test func aRefusedLinkIsNotAnOutage() {
    var evaluator = AlertEvaluator()
    let rules = AlertRules(downMinutes: 5)
    #expect(run(&evaluator, .failed(.accessRefused), rules, at: 0).isEmpty)
    #expect(run(&evaluator, .failed(.accessRefused), rules, at: 4000).isEmpty)
  }
}
