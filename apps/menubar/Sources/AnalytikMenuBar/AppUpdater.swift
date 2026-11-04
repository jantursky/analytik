import AppKit
import MenubarCore
import SwiftUI

/// Looks for a newer release now and then, and replaces the running app with it when asked: downloads the zip, checks
/// that it is signed by the same Apple team, swaps the bundle and opens the new one.
@MainActor
@Observable
final class AppUpdater {
  enum Phase: Equatable {
    case idle, downloading
    case failed(String)
  }

  private(set) var available: AppUpdate?
  private(set) var phase: Phase = .idle
  private(set) var checking = false
  private(set) var lastChecked: Date? = UserDefaults.standard.object(forKey: AppUpdater.checkedKey) as? Date

  private static let checkedKey = "updateLastChecked"

  static var currentVersion: String {
    Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
  }

  /// Checks when the last check is old enough; the interval keeps GitHub requests to a few a day.
  func checkIfDue(enabled: Bool) async {
    guard enabled, !checking, UpdateChecker.isDue(last: lastChecked, now: Date()) else { return }
    await check()
  }

  func check() async {
    guard !checking else { return }
    checking = true
    let found = await UpdateChecker().newest(than: Self.currentVersion)
    checking = false
    let now = Date()
    lastChecked = now
    UserDefaults.standard.set(now, forKey: Self.checkedKey)
    available = found
  }

  func install() async {
    guard let update = available, phase != .downloading else { return }
    phase = .downloading
    do {
      try await Self.replaceApp(with: update)
    } catch let error as UpdateFailure {
      phase = .failed(error.message)
    } catch {
      phase = .failed("The update didn't work.")
    }
  }

  struct UpdateFailure: Error { let message: String }

  /// The app comes from this repository's GitHub release over https and must carry our team's signature and the
  /// version the release promised; only then does it take the place of the running one.
  private static func replaceApp(with update: AppUpdate) async throws {
    let fail = { (text: String) in UpdateFailure(message: text) }
    let destination = Bundle.main.bundleURL
    guard FileManager.default.isWritableFile(atPath: destination.deletingLastPathComponent().path) else {
      throw fail("The app can't replace itself here. Open the release page and install it by hand.")
    }
    let work = FileManager.default.temporaryDirectory.appending(path: "analytik-update-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)

    let (file, response) = try await URLSession.shared.download(from: update.download)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw fail("The download didn't work.") }
    let zip = work.appending(path: "app.zip")
    try FileManager.default.moveItem(at: file, to: zip)
    let unpacked = work.appending(path: "unpacked")
    guard await run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path]).status == 0,
      let app = try FileManager.default.contentsOfDirectory(at: unpacked, includingPropertiesForKeys: nil).first(where: { $0.pathExtension == "app" })
    else { throw fail("The download isn't an app.") }

    guard await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path]).status == 0,
      await run("/usr/bin/codesign", ["-dv", "--verbose=4", app.path]).output.contains("TeamIdentifier=\(UpdateChecker.teamID)")
    else { throw fail("The download isn't signed by Apptiary, so it was not installed.") }
    let info = NSDictionary(contentsOf: app.appending(path: "Contents/Info.plist"))
    guard info?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
      info?["CFBundleShortVersionString"] as? String == update.version
    else { throw fail("The download isn't the version it was announced as.") }

    // The swap happens after this process ends, by a shell that waits for it: the running bundle can't replace itself.
    let script = """
      while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
      rm -rf "$3.old"; mv "$3" "$3.old" && { mv "$2" "$3" || mv "$3.old" "$3"; }
      rm -rf "$3.old"; open "$3"
      """
    let helper = Process()
    helper.executableURL = URL(filePath: "/bin/sh")
    helper.arguments = ["-c", script, "sh", String(ProcessInfo.processInfo.processIdentifier), app.path, destination.path]
    try helper.run()
    NSApplication.shared.terminate(nil)
  }

  private static func run(_ path: String, _ arguments: [String]) async -> (status: Int32, output: String) {
    await Task.detached {
      let process = Process()
      process.executableURL = URL(filePath: path)
      process.arguments = arguments
      let pipe = Pipe()
      process.standardOutput = pipe
      process.standardError = pipe
      guard (try? process.run()) != nil else { return (-1, "") }
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }.value
  }
}
