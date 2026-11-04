#!/usr/bin/env bash
# Builds "Analytik Menu Bar.app" and a zip of it into apps/menubar/dist.
# Usage: scripts/build-app.sh [version]   (version defaults to 0.0.0-dev)
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="${1:-0.0.0-dev}"
NAME="Analytik Menu Bar"
APP="dist/$NAME.app"

swift build -c release --arch arm64 --arch x86_64 --scratch-path .build-release
BIN="$(swift build -c release --arch arm64 --arch x86_64 --scratch-path .build-release --show-bin-path)/AnalytikMenuBar"

rm -rf dist
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/AnalytikMenuBar"
mkdir -p "$APP/Contents/Resources"
cp icon/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.apptiary.analytik.menubar</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleExecutable</key><string>AnalytikMenuBar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION%%-*}</string>
  <key>CFBundleVersion</key><string>${VERSION%%-*}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>com.apptiary.analytik.menubar</string>
      <key>CFBundleURLSchemes</key><array><string>analytik</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

# A stable identity keeps the app's identity the same from build to build, so the Keychain doesn't ask again for the
# tokens after each install. CODESIGN_IDENTITY picks one; otherwise the first valid "Apple Development" certificate is
# used, and without one the signature is ad-hoc (enough to run after a right-click Open; the Keychain asks per build).
IDENTITY="${CODESIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ] && [ -z "${CI:-}" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk '/Apple Development/ {print $2; exit}')"
fi
if [ -n "$IDENTITY" ]; then
  echo "Signing with identity $IDENTITY"
  codesign --force --deep --sign "$IDENTITY" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi

(cd dist && ditto -c -k --keepParent "$NAME.app" "Analytik-Menu-Bar-$VERSION.zip")
echo "Built dist/Analytik-Menu-Bar-$VERSION.zip"
