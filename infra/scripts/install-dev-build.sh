#!/bin/bash
# Download latest EAS development build and install on connected Android device via ADB
set -e

APK_PATH="/tmp/surewaka-dev.apk"

echo "📦 Fetching latest Android build URL..."
BUILD_URL=$(eas build:list --platform android --status finished --limit 1 --json --non-interactive 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
  console.log(data[0]?.artifacts?.buildUrl || '');
")

if [ -z "$BUILD_URL" ]; then
  echo "❌ No finished Android build found."
  exit 1
fi

echo "⬇️  Downloading APK..."
curl -# -L -o "$APK_PATH" "$BUILD_URL"

echo "📱 Installing on device..."
adb install -r "$APK_PATH"

echo "✅ Done! Launch the app on your device."
