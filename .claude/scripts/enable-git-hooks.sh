#!/usr/bin/env bash
# enable-git-hooks.sh - Claude Code のクラウドセッション (CLAUDE_CODE_REMOTE=true) で、配布した git hook (commit 前の
# 個人情報・secret の点検) をこのリポジトリの clone に有効にする
#
# 配布先: <リポジトリ>/.claude/scripts/enable-git-hooks.sh。同じく配布する .claude/settings.json の SessionStart hook が
# install-gh.sh・enable-gh-shim.sh と同じ 1 つの command の中で呼ぶ (起票元: https://github.com/bannzai/castle/issues/1546 )。
#
# ローカルでは ~/.gitconfig の core.hooksPath (= ~/.claude/hooks/git) が全リポジトリの commit を点検するが、クラウドの VM には
# ユーザーグローバルの設定が無い。配布した .claude/hooks/git (castle-git-hook と commit-msg の symlink) を clone の
# core.hooksPath に向け、hook が呼ぶ check-leaks.sh の場所を CASTLE_GIT_HOOK_CHECK_LEAKS として CLAUDE_ENV_FILE に書く
# (git は Bash ツールの環境を継承するため、hook からその変数が見える)。
#
# やること: CLAUDE_CODE_REMOTE が "true" の時だけ
#   1. `git config core.hooksPath <CLAUDE_PROJECT_DIR>/.claude/hooks/git` (clone のローカル設定。同じ値なら書き直しても結果は同じ)
#   2. `export CASTLE_GIT_HOOK_CHECK_LEAKS=<CLAUDE_PROJECT_DIR>/.claude/skills/pre-publish-leak-check/scripts/check-leaks.sh` を
#      CLAUDE_ENV_FILE に追記する (同じ行があれば追記しない)
# 出力: stdout に 1 行。exit code: 0 (何もしない / 有効にした / 有効済み)、1 (hook・check-leaks.sh・CLAUDE_ENV_FILE が無い)
# 冪等性: 同じ設定と同じ行を 2 回書いても結果は変わらない
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
hooks_dir="$project_dir/.claude/hooks/git"
check_leaks="$project_dir/.claude/skills/pre-publish-leak-check/scripts/check-leaks.sh"
[ -f "$hooks_dir/castle-git-hook" ] || { echo "enable-git-hooks: $hooks_dir/castle-git-hook がありません" >&2; exit 1; }
[ -f "$check_leaks" ] || { echo "enable-git-hooks: $check_leaks がありません" >&2; exit 1; }
if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
  echo "enable-git-hooks: CLAUDE_ENV_FILE が無いため CASTLE_GIT_HOOK_CHECK_LEAKS を書けません" >&2
  exit 1
fi

chmod +x "$hooks_dir/castle-git-hook" "$check_leaks" 2>/dev/null || true
(cd "$project_dir" && git config core.hooksPath "$hooks_dir")

line="export CASTLE_GIT_HOOK_CHECK_LEAKS=\"$check_leaks\""
if { [ -f "$CLAUDE_ENV_FILE" ] && grep -qxF "$line" "$CLAUDE_ENV_FILE"; }; then
  echo "enable-git-hooks: already enabled ($hooks_dir)"
else
  printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
  echo "enable-git-hooks: enabled ($hooks_dir)"
fi
