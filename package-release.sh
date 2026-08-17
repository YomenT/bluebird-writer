#!/bin/bash
set -e

# Version comes from tauri.conf.json so release tooling never drifts from the app.
VERSION="$(grep -oP '"version":\s*"\K[^"]+' src-tauri/tauri.conf.json)"
APPIMAGE="src-tauri/target/release/bundle/appimage/bluebird-writer_${VERSION}_amd64.AppImage"
ICON="src-tauri/icons/128x128.png"
OUT="bluebird-writer_${VERSION}_linux.tar.gz"

if [ ! -f "$APPIMAGE" ]; then
    echo "Error: AppImage not found. Run the build first:"
    echo "  source ~/.cargo/env && NO_STRIP=1 npm run tauri:build -- --bundles appimage"
    exit 1
fi

echo "Packaging $OUT..."

mkdir -p release-tmp
cp "$APPIMAGE" release-tmp/
cp "$ICON"     release-tmp/128x128.png
cp install.sh  release-tmp/
chmod +x release-tmp/install.sh

tar -czf "$OUT" -C release-tmp .
rm -rf release-tmp

echo "Done: $OUT"
