import Foundation
import Testing

@testable import MenubarCore

// Shares the suite of the stats client tests: both use the one fake network, so they must not run side by side.
extension StatsClientTests {
  private func releaseJSON(_ tag: String, zip: String? = nil, draft: Bool = false) -> String {
    let url = zip ?? "https://github.com/jantursky/analytik/releases/download/\(tag)/App.zip"
    return """
      {"tag_name":"\(tag)","draft":\(draft),"html_url":"https://github.com/jantursky/analytik/releases/tag/\(tag)",
       "assets":[{"name":"App.zip","browser_download_url":"\(url)"}]}
      """
  }

  private func checkUpdate(_ releases: [String], current: String = "1.0.1") async -> AppUpdate? {
    FakeProtocol.reset { _ in (200, "[\(releases.joined(separator: ","))]") }
    return await UpdateChecker(session: FakeProtocol.session()).newest(than: current)
  }

  @Test func versionsAreOrderedByNumberNotText() {
    #expect(AppVersion("1.10.0")! > AppVersion("1.9.9")!)
    #expect(AppVersion("1.0.2")! > AppVersion("1.0.1")!)
    #expect(AppVersion("1.0.1")! == AppVersion("1.0.1")!)
    #expect(AppVersion("0.0.0-dev") == nil)
    #expect(AppVersion("1.0") == nil)
  }

  @Test func theNewestAppReleaseIsOfferedWhenNewer() async {
    let update = await checkUpdate([releaseJSON("1.17.0"), releaseJSON("menubar-v1.0.2"), releaseJSON("menubar-v1.0.3"), releaseJSON("menubar-v1.0.1")])
    #expect(update?.version == "1.0.3")
    #expect(update?.download.absoluteString == "https://github.com/jantursky/analytik/releases/download/menubar-v1.0.3/App.zip")
  }

  @Test func nothingIsOfferedWhenTheAppIsCurrentOrAhead() async {
    #expect(await checkUpdate([releaseJSON("menubar-v1.0.1")]) == nil)
    #expect(await checkUpdate([releaseJSON("menubar-v1.0.1")], current: "1.0.5") == nil)
  }

  @Test func draftsOtherProductsAndForeignDownloadsAreIgnored() async {
    #expect(await checkUpdate([releaseJSON("menubar-v2.0.0", draft: true)]) == nil)
    #expect(await checkUpdate([releaseJSON("1.99.0")]) == nil)
    #expect(await checkUpdate([releaseJSON("menubar-v2.0.0", zip: "https://evil.test/App.zip")]) == nil)
  }

  @Test func aDevelopmentBuildNeverAsks() async {
    FakeProtocol.reset { _ in (200, "[]") }
    #expect(await UpdateChecker(session: FakeProtocol.session()).newest(than: "0.0.0") == nil)
    #expect(FakeProtocol.seen.count == 1)
    FakeProtocol.seen = []
    #expect(await UpdateChecker(session: FakeProtocol.session()).newest(than: "dev") == nil)
    #expect(FakeProtocol.seen.isEmpty)
  }

  @Test func aFailedCheckIsJustNothing() async {
    FakeProtocol.reset { _ in (500, "") }
    #expect(await UpdateChecker(session: FakeProtocol.session()).newest(than: "1.0.1") == nil)
  }

  @Test func aCheckIsDueAfterSixHours() {
    let now = Date(timeIntervalSince1970: 1_000_000)
    #expect(UpdateChecker.isDue(last: nil, now: now))
    #expect(!UpdateChecker.isDue(last: now.addingTimeInterval(-3600), now: now))
    #expect(UpdateChecker.isDue(last: now.addingTimeInterval(-7 * 3600), now: now))
  }
}
