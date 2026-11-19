#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
output="$root/.build"

xcodebuild -quiet \
  -project "$root/Kioku.xcodeproj" \
  -scheme Kioku \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$output" \
  CODE_SIGNING_ALLOWED=NO \
  build

app="$output/Build/Products/Debug-iphonesimulator/Kioku.app"
test -x "$app/Kioku"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")" = Kioku
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$app/Info.plist")" = iPhoneSimulator
printf 'Kioku.app: compilada para el simulador de iOS.\n'
