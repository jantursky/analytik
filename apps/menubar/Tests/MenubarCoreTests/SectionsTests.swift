import Foundation
import Testing

@testable import MenubarCore

struct SectionsTests {
  @Test func overviewComesFromTheSnapshotAndTheRestListDimensions() {
    #expect(PanelSection.overview.blocks.isEmpty)
    for section in PanelSection.allCases where section != .overview {
      #expect(!section.blocks.isEmpty)
    }
    #expect(PanelSection.places.blocks.map(\.dimension) == ["country", "city"])
    #expect(PanelSection.tech.blocks.map(\.dimension) == ["browser", "os", "device"])
  }

  @Test func everyDimensionIsOneTheServerKnows() {
    // Copied from `DIMENSIONS` in `shared/dimensions.ts`; a typo here would be a 400 from the server.
    let known: Set<String> = [
      "channel", "source", "referrer", "campaign", "medium", "term", "content", "ref", "page", "entry", "exit",
      "country", "region", "city", "browser", "os", "device", "event", "outbound", "goal",
    ]
    for section in PanelSection.allCases { for block in section.blocks { #expect(known.contains(block.dimension)) } }
  }

  @Test func emptyKeysAndCountryCodesAreReadable() {
    let us = Locale(identifier: "en_US")
    #expect(Format.rowLabel("", dimension: "source", locale: us) == "(none)")
    #expect(Format.rowLabel("SK", dimension: "country", locale: us) == "Slovakia")
    #expect(Format.rowLabel("SK", dimension: "city", locale: us) == "SK")
    #expect(Format.rowLabel("/pricing", dimension: "page", locale: us) == "/pricing")
  }

  @Test func hourIsShownInTheGivenZone() {
    let at = Date(timeIntervalSince1970: 1_793_836_800)  // 2026-11-05 00:00 UTC
    let us = Locale(identifier: "en_US")
    #expect(Format.hour(at, timeZone: TimeZone(identifier: "UTC")!, locale: us).hasPrefix("12:00"))
    #expect(Format.hour(at, timeZone: TimeZone(identifier: "Europe/Bratislava")!, locale: us).hasPrefix("1:00"))
  }

  @Test func settingsHideTabsButNeverOverview() {
    var settings = AppSettings()
    #expect(settings.visibleSections == PanelSection.allCases)
    settings.hiddenSections = [.tech, .overview, .places]
    #expect(settings.visibleSections == [.overview, .pages, .sources])
  }

  @Test func newSettingsSurviveARestartAndOldOnesLoad() {
    let defaults = UserDefaults(suiteName: "menubar-test-\(UUID().uuidString)")!
    var settings = AppSettings()
    settings.appearance = .light
    settings.hiddenSections = [.tech]
    settings.rows = 8
    settings.save(defaults)
    #expect(AppSettings.load(defaults) == settings)
    defaults.set(Data(#"{"refreshSeconds":30,"rows":500}"#.utf8), forKey: "appSettings")
    let old = AppSettings.load(defaults)
    #expect(old.appearance == .system)
    #expect(old.rows == 20)  // Clamped, so a damaged value can't ask the server for thousands of rows.
  }
}
