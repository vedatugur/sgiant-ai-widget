#!/usr/bin/env bash
# What a consumer actually receives.
#
# Ported from sgiant-observability via sgiant-ai-agent-bridge, which learned it the expensive way: it was
# public for twelve hours naming four internal paths and a production incident,
# all of it arriving through COMMENTS. `files: ["dist"]` does not settle this —
# tsc compiles source comments into dist/*.js, and JSDoc on an export lands in
# dist/*.d.ts, where a consumer's editor shows it on hover.
#
# The checks are by SHAPE, not by a list of private names — a denylist would
# have to spell those names out in a public file to protect them, which is
# self-defeating, and it only ever catches what someone already thought of.
set -euo pipefail

fail() { echo "REFUSING: $*"; exit 1; }

# With no argument, pack THIS package and audit what npm would actually send.
#
# The packing lives here rather than in the npm script because of a real bug:
# `npm publish --dry-run` exports npm_config_dry_run=true, a nested `npm pack`
# INHERITS it, and packs nothing. The old one-liner then ran `tar` on a glob
# that matched no file and died with "tar: .audit/*.tgz: m: No such file or
# directory" — so the guard silently produced no tarball in the exact lifecycle
# it exists to protect. A check that cannot fail loudly is not a check.
if [ $# -eq 0 ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  # Explicitly off, so an inherited dry-run cannot make this a no-op.
  npm_config_dry_run=false npm pack --silent --pack-destination "$work" >/dev/null

  count=$(find "$work" -maxdepth 1 -name '*.tgz' | wc -l | tr -d ' ')
  test "$count" -eq 1 || fail "npm pack produced $count tarballs, expected exactly 1"

  tar xzf "$work"/*.tgz -C "$work"
  test -d "$work/package" || fail "the tarball did not extract to package/"
  set -- "$work/package"
fi

pkg="${1:?usage: audit-tarball.sh [extracted-package-dir]}"
test -d "$pkg" || fail "$pkg is not a directory"

# 1. Everything a package needs to be usable and lawful. A missing LICENSE is
#    not cosmetic: published code with no licence is all rights reserved, so
#    nobody who installs it has permission to use it.
for f in README.md LICENSE package.json dist/index.js dist/index.d.ts dist/sgiant-ai-widget.global.js; do
  test -f "$pkg/$f" || fail "$f is missing from the tarball"
done

# 2. Only these hosts may be named. An allowlist, so a link to anything private
#    fails by default rather than by having been predicted. *.example.com is on
#    it because IANA reserves it for documentation (RFC 2606) — it cannot
#    resolve to anyone's real infrastructure, which is the property this check
#    is actually protecting.
if grep -arhoE 'https?://[a-zA-Z0-9.-]+' "$pkg" \
   | sort -u \
   | grep -vE '^https?://(github\.com|registry\.npmjs\.org|json\.schemastore\.org|[a-z-]+\.example\.com|www\.w3\.org|vedatugur\.github\.io|unpkg\.com|www\.npmjs\.com)$' \
   | grep . ; then
  fail "the tarball links to a host that is not on the allowlist above"
fi

# 3. Shapes that only ever come from somewhere else's repo: a build-root
#    absolute path, or a source tree the consumer does not have.
#
#    ISSUE REFERENCES ARE DELIBERATELY NOT CHECKED, and that is a narrowing of
#    what this guard did in sgiant-observability. A bare `#320` leaks nothing —
#    no hostname, no path, no incident — and this package's comments cite the
#    tracker it was built in roughly a hundred times. Stripping them would
#    destroy the reasoning that makes the comments worth shipping; keeping them
#    and pretending the check passes would be worse. They are explained in the
#    README instead.
#
#    A SOURCE PATH IS DIFFERENT. `packages/ui/src/components/theme.tsx` points
#    at a file that does not exist in the repo the reader just cloned, so it is
#    misleading as well as leaky. Twelve of those were rewritten on 2026-09-02
#    to describe the thing rather than name a file only we can open.
if grep -arnE '/(repo|builds|home|Users)/|\b(apps|packages|infra|tests)/[a-z]' "$pkg"; then
  fail "the tarball names an absolute path or a source tree a consumer does not have"
fi

echo "clean — the tarball names nothing it should not"
find "$pkg" -type f | sed "s|$pkg/|  |"
