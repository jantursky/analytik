import Foundation
import Testing

@testable import MenubarCore

struct BackupTests {
  let sites: [(connection: Connection, token: String)] = [
    (Connection(name: "Shop", serverURL: "https://a.test/api", siteId: "shop", dashboardURL: "https://a.test/?site=shop&share=k1"), "k1"),
    (Connection(name: "Blog", serverURL: "https://b.test/api", siteId: "blog"), "k+/2=="),
  ]

  @Test func bundleRoundTripsEverySite() {
    let text = SiteBundle.encode(sites)
    #expect(text.hasPrefix("analytik-sites:"))
    #expect(!text.contains("=") && !text.contains("+") && !text.contains("/"))
    let entries = SiteBundle.decode(text)
    #expect(entries?.map(\.siteId) == ["shop", "blog"])
    #expect(entries?.map(\.token) == ["k1", "k+/2=="])
    #expect(entries?.first?.dashboardURL == "https://a.test/?site=shop&share=k1")
  }

  @Test func bundleIgnoresSurroundingWhitespace() {
    #expect(SiteBundle.decode("  \(SiteBundle.encode(sites))\n")?.count == 2)
  }

  @Test func otherTextIsNotABundle() {
    #expect(SiteBundle.decode("hello") == nil)
    #expect(SiteBundle.decode("analytik-sites:!!!") == nil)
    #expect(SiteBundle.decode(SiteBundle.encode([])) == nil)
  }

  @Test func settingsExportAndImportKeepChoicesButNotTheSelectedSite() {
    var settings = AppSettings()
    settings.refreshSeconds = 300
    settings.selectedId = "abc"
    let back = AppSettings.imported(from: settings.exported())
    #expect(back?.refreshSeconds == 300)
    #expect(back?.selectedId == nil)
    #expect(AppSettings.imported(from: Data("nope".utf8)) == nil)
  }
}
