#!/usr/bin/env bash
# Build a store-ready zip locally (same layout the release workflow produces).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(jq -r .version manifest.json)
npm run build

rm -rf package
mkdir -p package/dist package/icons
cp manifest.json package/
cp dist/main.js package/dist/
cp icons/*.png package/icons/

ZIP="flappy-fake-$VERSION.zip"
rm -f "$ZIP"
(cd package && zip -r "../$ZIP" .)
echo "Wrote $ZIP"
