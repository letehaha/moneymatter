#!/bin/sh
# Starts the frontend image and checks what search engines see: every sitemap
# URL answers 200 with a canonical pointing at itself, and the app shell is
# marked noindex.
# Usage: smoke-test.sh <image>
set -eu

IMAGE="$1"
PORT="${PORT:-8089}"
BASE="http://localhost:$PORT"

cid=$(docker run -d -p "$PORT:80" "$IMAGE")
trap 'docker rm -f "$cid" >/dev/null' EXIT

i=0
until curl -fs -o /dev/null "$BASE/version.json"; do
  i=$((i + 1))
  [ "$i" -lt 30 ] || { echo "container did not start" >&2; docker logs "$cid" >&2; exit 1; }
  sleep 1
done

locs() { curl -fsS "$BASE$1" | grep -o '<loc>[^<]*</loc>' | sed -e 's/<[^>]*>//g'; }
path_of() { printf '%s' "$1" | sed -e 's|^https\{0,1\}://[^/]*||'; }

fail=0
checked=0
for map in $(locs /sitemap-index.xml); do
  for url in $(locs "$(path_of "$map")"); do
    checked=$((checked + 1))
    # The sitemap lists the homepage without the slash its canonical carries.
    [ -n "$(path_of "$url")" ] || url="$url/"
    body=$(curl -sS -w '\n%{http_code}' "$BASE$(path_of "$url")")
    status=$(printf '%s' "$body" | tail -n 1)
    case "$status:$body" in
      200:*"<link rel=\"canonical\" href=\"$url\""*) echo "ok   $url" ;;
      200:*) echo "FAIL $url: canonical does not point at itself"; fail=1 ;;
      *) echo "FAIL $url: HTTP $status"; fail=1 ;;
    esac
  done
done
[ "$checked" -gt 0 ] || { echo "FAIL sitemap lists no URLs"; fail=1; }

robots_tag() { curl -sS -o /dev/null -D - "$BASE$1" | tr -d '\r' | grep -i '^x-robots-tag:' || true; }
[ -n "$(robots_tag /dashboard)" ] || { echo "FAIL /dashboard: app shell is not noindex"; fail=1; }
[ -z "$(robots_tag /sign-in)" ] || { echo "FAIL /sign-in: must stay indexable"; fail=1; }

exit "$fail"
