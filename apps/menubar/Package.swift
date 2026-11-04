// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "AnalytikMenuBar",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "AnalytikMenuBar", targets: ["AnalytikMenuBar"]),
    .library(name: "MenubarCore", targets: ["MenubarCore"]),
  ],
  targets: [
    // Everything that can be tested without a window: requests, decoding, formatting, refresh policy, Keychain.
    .target(name: "MenubarCore"),
    .executableTarget(name: "AnalytikMenuBar", dependencies: ["MenubarCore"]),
    .testTarget(name: "MenubarCoreTests", dependencies: ["MenubarCore"]),
  ]
)
