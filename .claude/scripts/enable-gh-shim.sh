#!/usr/bin/env bash
# enable-gh-shim.sh - Claude Code のクラウドセッション (CLAUDE_CODE_REMOTE=true) で gh シムのディレクトリを PATH の先頭に足す
#
# 配布先: <リポジトリ>/.claude/scripts/enable-gh-shim.sh。同じく配布する .claude/settings.json の SessionStart hook が、
# 1 つの command の中で install-gh.sh の後に呼ぶ (hook の handler は並列に実行されるため、別の handler にすると順が保証されない。
# https://code.claude.com/docs/en/hooks 。起票元: https://github.com/bannzai/castle/issues/1544 )。
#
# やること: CLAUDE_CODE_REMOTE が "true" で CLAUDE_ENV_FILE がある時だけ、
#   `export PATH="<このファイルの隣の gh-shim>:$PATH"` を CLAUDE_ENV_FILE に追記する (同じ行があれば追記しない)。
#   install-gh.sh の `export PATH="~/.local/bin:$PATH"` より後の行になるため、Bash ツールの PATH ではシムが入れ直した gh より
#   先に見つかり、シムが本物として入れ直した gh を使う
# 出力: stdout に 1 行。exit code: 0 (何もしない / 追記した / 追記済み)
# 冪等性: 同じ行が無い時だけ追記する
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

shim_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gh-shim"
[ -x "$shim_dir/gh" ] || { echo "enable-gh-shim: $shim_dir/gh がありません" >&2; exit 1; }
chmod +x "$shim_dir/gh" 2>/dev/null || true

if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
  echo "enable-gh-shim: CLAUDE_ENV_FILE が無いため PATH を書けません" >&2
  exit 1
fi
line="export PATH=\"$shim_dir:\$PATH\""
if { [ -f "$CLAUDE_ENV_FILE" ] && grep -qxF "$line" "$CLAUDE_ENV_FILE"; }; then
  echo "enable-gh-shim: already on PATH ($shim_dir)"
else
  printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
  echo "enable-gh-shim: added to PATH ($shim_dir)"
fi
