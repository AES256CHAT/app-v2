#!/usr/bin/env bash
# Usage: scripts/generate-checksums.sh <apk> [build-dir]
# Writes CHECKSUMS.txt with SHA-256 and SHA-512 for the APK and every file in the web build.
set -euo pipefail

apk="${1:?apk path required}"
build="${2:-build}"
out="CHECKSUMS.txt"

{
	echo "# AES256CHAT checksums — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo "# verify: sha256sum -c CHECKSUMS.txt  (or sha512sum -c)"
	echo
	echo "## SHA-256"
	sha256sum "$apk"
	(cd "$build" && find . -type f | sort | xargs sha256sum | sed "s|  \./|  $build/|")
	echo
	echo "## SHA-512"
	sha512sum "$apk"
	(cd "$build" && find . -type f | sort | xargs sha512sum | sed "s|  \./|  $build/|")
} > "$out"

echo "wrote $out ($(grep -c '^[0-9a-f]' "$out") entries)"
