#!/usr/bin/env bash
# Builds the menu bar app and installs it in ~/Applications, replacing and relaunching a running copy.
# Usage: scripts/install-app.sh [version]
set -euo pipefail

cd "$(dirname "$0")/.."
NAME="Analytik Menu Bar"
TARGET="$HOME/Applications"

scripts/build-app.sh "${1:-0.0.0-dev}"

if pgrep -x AnalytikMenuBar >/dev/null; then
  echo "Quitting the running app"
  osascript -e 'tell application id "com.apptiary.analytik.menubar" to quit' >/dev/null 2>&1 || true
  for _ in {1..20}; do pgrep -x AnalytikMenuBar >/dev/null || break; sleep 0.25; done
  pkill -x AnalytikMenuBar 2>/dev/null || true
fi

mkdir -p "$TARGET"
rm -rf "$TARGET/$NAME.app"
ditto "dist/$NAME.app" "$TARGET/$NAME.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$TARGET/$NAME.app" >/dev/null 2>&1 || true
open "$TARGET/$NAME.app"
echo "Installed $TARGET/$NAME.app"
