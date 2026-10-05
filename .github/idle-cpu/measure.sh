#!/usr/bin/env bash
# 使い方: measure.sh <ラベル> <git の ref> <ポート>
# ref をビルドしてサーバーを起動し、アクセス無し・/api/events を 1 本つないだまま・切った後の 3 つの状態で、
# ps -o %cpu=,cputime= -p <PID> を 10 秒おきに 60 秒記録する。
set -euo pipefail

label=$1
ref=$2
port=$3
logs="$RUNNER_TEMP/logs"
checkout="$RUNNER_TEMP/checkout-$label"
events="$RUNNER_TEMP/events-$label.txt"

git worktree add --detach "$checkout" "$ref"
cd "$checkout"
echo "## $label: $(git rev-parse HEAD) ($(uname -s), node $(node --version))"
npm ci --no-audit --no-fund >/dev/null
npm run build >/dev/null

AGENT_TIMELINE_PORT=$port \
  AGENT_TIMELINE_CLAUDE_PROJECTS_DIR="$logs/claude" \
  AGENT_TIMELINE_CODEX_SESSIONS_DIR="$logs/codex" \
  AGENT_TIMELINE_USAGE_DIR="$RUNNER_TEMP/usage-$label" \
  node dist/server/index.js >"$RUNNER_TEMP/server-$label.log" 2>&1 &
server_pid=$!
until curl -sf "http://127.0.0.1:$port/api/health" >/dev/null; do sleep 0.5; done

# 状態の名前 $1 の見出しと、サーバーの %CPU と CPU 時間を 10 秒おきに 60 秒分出す。
record() {
  echo "### $label: $1 (PID $server_pid)"
  echo "経過秒 %CPU CPU時間"
  for elapsed in 0 10 20 30 40 50 60; do
    echo "$elapsed $(ps -o %cpu=,cputime= -p "$server_pid")"
    if [ "$elapsed" -lt 60 ]; then sleep 10; fi
  done
}

record "アクセス無し"

curl -sN "http://127.0.0.1:$port/api/events" >"$events" &
curl_pid=$!
until grep -q "event: ready" "$events"; do sleep 0.5; done
record "/api/events を 1 本つないだまま (ほかのリクエスト無し)"

echo "### $label: 大きなログのルートでの知らせの確認"
printf '{}\n' >>"$logs/claude/-home-dev-project-7/00000000-0000-4000-8000-000000000703.jsonl"
mkdir -p "$logs/codex/2026/12/31"
printf '{}\n' >"$logs/codex/2026/12/31/rollout-2026-12-31T00-00-00-$label-0000-7000-8000-000000000000.jsonl"
sleep 5
grep -A1 "event: sessions-changed" "$events" || echo "sessions-changed が届かなかった"
kill "$curl_pid"

sleep 2
record "/api/events を切った後"
kill "$server_pid"
