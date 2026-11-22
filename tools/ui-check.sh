#!/usr/bin/env bash
# 実際の画面をヘッドレスの Edge (WSL から Windows 側) で開き、確認用のスクリプトを流して結果を出す。
#   tools/ui-check.sh <index|settings|search> <確認用スクリプト.js> [待ち時間ms]
# 確認用スクリプトは、結果を <pre id="selftest"> に入れて body に追加する。その中身がここに出る。
# localStorage は毎回空から始まる。設定が要るときは、スクリプトの中で入れてから location.reload() する
# (sessionStorage に印を付けて 2 回目に本処理をする)。
set -euo pipefail
page="$1"; script="$2"; budget="${3:-60000}"
root="$(cd "$(dirname "$0")/.." && pwd)"
edge="/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
profile="$(mktemp -d)"
trap 'rm -f "$root/web/_t.js" "$root/web/_t-$page.html"; rm -rf "$profile"' EXIT
cp "$script" "$root/web/_t.js"
sed 's#</body>#<script src="_t.js"></script></body>#' "$root/web/$page.html" > "$root/web/_t-$page.html"
url="file:$(wslpath -m "$root/web/_t-$page.html" | sed 's#^//#////#')"
timeout 180 "$edge" --headless=new --disable-gpu --no-first-run --user-data-dir="$(wslpath -w "$profile")" \
  --virtual-time-budget="$budget" --dump-dom "$url" 2>/dev/null |
  python3 -c "import sys,re,html; d=sys.stdin.read(); m=re.search(r'<pre id=\"selftest\">(.*?)</pre>',d,re.S); print(html.unescape(m.group(1)) if m else 'NO RESULT (スクリプトが selftest を出す前に終わった)')"
