#!/usr/bin/env bash
set -uo pipefail

# push・PR 作成の前に、これから公開する内容を、差分を書いたセッションとは別の新しいコンテキストの claude -p に読ませ、
# 「漏らしてはいけない情報」(定義の SSOT は assets/review-prompt.md) の候補を JSON で返させる。check-leaks.sh (正規表現と
# Jev) が拾えないもの (キー名から secret と分からない値、接続 URL に埋め込んだパスワード、文脈で決まる個人情報) を読む層。
# Codex には出さない (~/.claude/documents/rules/codex-task-assignment.md 判定フロー 2: 秘匿情報の点検は Claude)。
# 決定: ADR 0076 (~/.claude/documents/adr/0076-two-layer-pre-publish-leak-gate-with-jev-and-fresh-context-llm.md)
# 冪等でない: LLM の呼び出しのため同じ入力でも結果が変わり得る。実行のたびに日時つきの実行ログを 1 つ足す。
#
# 対象 (check-leaks.sh と同じ 2 モード・同じ集め方):
#   --staged: ステージ済みの差分 (git diff --cached。文脈行つき) と --message-file のコミットメッセージ
#   --base:   <ref>..HEAD の各コミット (古い順) のメッセージ全文 (%B) と patch (文脈行つき。merge commit は patch を省く)、
#             --pr-body の本文
#   生成された lockfile (LOCKFILE_GLOBS) と、.gitattributes で linguist-generated を付けた生成物の patch はプロンプトに
#   入れず、パスだけを載せる。lockfile はパッケージ名・版・ハッシュが大半で、プロンプトの上限に当たりやすいため。
#   linguist-generated の生成物 (スクリプトが公開データから作る GeoJSON 等) は 1 ファイルで上限を超えることがあり、
#   commit を分けても点検できず push できなくなるため (実例: bannzai/machimiru の 4 MB の境界データ。
#   https://github.com/bannzai/machimiru/issues/4#issuecomment-5976989998 )。属性は公開する内容の .gitattributes から
#   読む (--staged はインデックス、--base は HEAD)。.gitattributes 自身は属性に関わらず patch として点検に入り、
#   省いたファイルも check-leaks.sh の機械点検は通る
#
# claude -p の起動 (claude 2.1.280 の --help と --debug-file のログで確認):
#   - 新しいコンテキスト: --safe-mode で CLAUDE.md・hooks・skill・plugin・MCP を読まない (debug ログに
#     "Hooks: Found 0 total hooks in registry" と "project memory is off")。user settings の UserPromptSubmit hook が
#     プロンプト (= 生の差分) を Jev へ送る経路と、tmux の表示・通知の hook もこれで止まる。公式が scripted な呼び出しに
#     推奨する --bare は OAuth を読まず API キーが要るため使わない
#   - ツールを使わせない: --tools "" (組み込みツールを外す。--allowedTools は許可の要否を決めるだけでツールを外さない)。
#     --json-schema の StructuredOutput は --tools "" でも動く。advisor (server tool) は settings の advisorModel で
#     --safe-mode でも付くため、環境変数 CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 で外す (差分を別モデルに読み直させない)
#   - 指示と点検対象を分ける: assets/review-prompt.md を --system-prompt-file (既定の system prompt を置き換える)、
#     点検対象を -p の直後の位置引数に入れる。stdin は </dev/null (claude -p は非 TTY の stdin をプロンプトの末尾へ
#     連結するため。.claude/skills/issue-triage-next-recent-repos/scripts/run-hourly-triage.sh の注記と同じ理由)
#   - --permission-mode は付けない。--no-session-persistence で点検対象を含むセッションをディスクに残さない
#   - 位置引数は ARG_MAX (macOS で 1MiB。環境変数を含む) に収める必要があるため、LEAK_REVIEW_MAX_PROMPT_BYTES を
#     超えたら送らずに exit 3 にする。既定値は macOS で確かめた値で、Linux は引数 1 つあたり 128KiB (MAX_ARG_STRLEN) の
#     上限が別にあるため、既定値のままでは claude を起動できずに exit 3 になり得る (その時は上限を 128KiB 未満に下げる)
#
# 出力の伏せ字 (標準出力と実行ログに生値を残さないため。モデルへの指示に加えてスクリプトでも行う):
#   - excerpt は、モデルが書いた抜粋の伏せ字記号 (… か *) より前の部分の先頭 4 文字に … を付けた形に切り詰める
#   - location は、scan-text-for-secrets.sh と check-diff-for-phone-numbers.sh の検出に当たれば (伏せた位置) に置き換える
#
# Usage:
#   review-leaks.sh --staged --message-file <path>
#   review-leaks.sh --base <ref> [--pr-body <path>]
# 環境変数:
#   CLAUDE_BIN                    claude のパス (既定 claude。テストでスタブに差し替える)
#   LEAK_REVIEW_MODEL             モデル (既定 claude-opus-5-5)
#   LEAK_REVIEW_MAX_PROMPT_BYTES  送るプロンプトの上限バイト数 (既定 800000)
# 出力 (標準出力。exit 0 / 1 の時): {"verdict": "clean" | "suspect", "findings": [...]}。findings の 1 件の形は
#   assets/findings.schema.json (伏せ字は上記)。モデルが verdict を clean にしても verdict が leak の候補があれば suspect
# 実行ログ: <リポジトリルート>/tmp/pre-publish-leak-check/<日時>-<pid>.json。モード・対象の件数・patch を省いた生成物・送った
#   プロンプトのバイト数・モデル・所要秒数・claude の exit code・exit code・verdict・伏せ字済みの findings・費用と
#   トークン数・exit 3 の理由。点検対象の本文と claude の応答の本文は含めない
# 標準エラー: 対象の要約、実行ログのパス、exit 3 の理由 (claude -p がエラーを返した時はその subtype と先頭 300 文字)
# 検出時の扱いは SKILL.md「Phase 3: 検出時の扱い」
# Exit: 0=clean 1=suspect (要目視) 2=引数・環境エラー 3=点検できなかった (claude -p の失敗・出力が JSON として読めない・
#   structured_output が無いか形が違う・プロンプトが上限を超えた)。3 は fail-closed で、呼び出し側は push・PR 作成に進まない

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_ROOT="$(cd "$SKILL_DIR/.." && pwd)"
SYSTEM_PROMPT="$SKILL_DIR/assets/review-prompt.md"
SCHEMA_JSON="$SKILL_DIR/assets/findings.schema.json"
PHONE_CHECK="$SKILLS_ROOT/github-repos-phone-number-check/scripts/check-diff-for-phone-numbers.sh"
SECRET_SCAN="$SKILLS_ROOT/pre-public-check/scripts/scan-text-for-secrets.sh"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
# 既定のモデルは、settings.json の model (opus = Opus 5.5。ADR 0074) と同じにする
MODEL="${LEAK_REVIEW_MODEL:-claude-opus-5-5}"
# 800000: ARG_MAX (macOS で 1048576 バイト) から、環境変数 (実測 約 21KB) と他の引数の分を引いても余白が残る値
MAX_PROMPT_BYTES="${LEAK_REVIEW_MAX_PROMPT_BYTES:-800000}"
# 生成された lockfile と minify 済みファイル (jev-check の personal-info.json の path_regex が外すものと、pubspec.lock・bun.lock)
LOCKFILE_GLOBS=(
  '**/package-lock.json' '**/yarn.lock' '**/pnpm-lock.yaml' '**/bun.lock' '**/Podfile.lock' '**/Package.resolved'
  '**/Cartfile.resolved' '**/Gemfile.lock' '**/go.sum' '**/Cargo.lock' '**/composer.lock' '**/pubspec.lock'
  '**/*.min.js' '**/*.min.css'
)

# -h / --help と引数エラーの時に見せる使い方 (ヘッダーコメントの Usage〜Exit を SSOT にするため、そこから切り出す)
usage() {
  sed -n '/^# Usage:/,/^# Exit:/p' "$0" | sed 's/^# \{0,1\}//'
}

# require_value <オプション名> <値>: 値の要るオプションに値が無ければ exit 2
require_value() {
  if [ -z "${2-}" ]; then
    echo "Error: $1 に値が必要" >&2
    exit 2
  fi
}

MODE=""
MESSAGE_FILE=""
BASE=""
PR_BODY=""
# set_mode <staged|base>: 2 つのモードが同時に指定されたら exit 2
set_mode() {
  if [ -n "$MODE" ] && [ "$MODE" != "$1" ]; then
    echo "Error: --staged と --base は同時に指定できない" >&2
    exit 2
  fi
  MODE="$1"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --staged) set_mode staged; shift ;;
    --base) require_value "$1" "${2-}"; set_mode base; BASE="$2"; shift 2 ;;
    --message-file) require_value "$1" "${2-}"; MESSAGE_FILE="$2"; shift 2 ;;
    --pr-body) require_value "$1" "${2-}"; PR_BODY="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: 不明なオプション: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$MODE" ] || { echo "Error: --staged か --base <ref> が必要" >&2; usage >&2; exit 2; }
if [ "$MODE" = staged ]; then
  [ -n "$MESSAGE_FILE" ] || { echo "Error: --staged には --message-file <コミットメッセージのファイル> が必要" >&2; exit 2; }
  [ -z "$PR_BODY" ] || { echo "Error: --pr-body は --base と併用する" >&2; exit 2; }
else
  [ -z "$MESSAGE_FILE" ] || { echo "Error: --message-file は --staged と併用する (--base はコミットメッセージを履歴から読む)" >&2; exit 2; }
fi
INTEGER_PATTERN='^[0-9]+$'
[[ "$MAX_PROMPT_BYTES" =~ $INTEGER_PATTERN ]] || { echo "Error: LEAK_REVIEW_MAX_PROMPT_BYTES は整数" >&2; exit 2; }
for cmd in git jq awk; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: $cmd が必要" >&2; exit 2; }
done
for f in "$SYSTEM_PROMPT" "$SCHEMA_JSON" "$PHONE_CHECK" "$SECRET_SCAN"; do
  [ -f "$f" ] || { echo "Error: 必要なファイルが無い: $f" >&2; exit 2; }
done
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Error: git リポジトリ内で実行する" >&2; exit 2; }

# 入力ファイルは呼び出し時のディレクトリ基準で絶対パスにしてからリポジトリルートへ移る (pathspec の "." と
# 実行ログの置き場所をリポジトリルートに揃えるため)
abspath() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$PWD" "$1" ;;
  esac
}
for f in "$MESSAGE_FILE" "$PR_BODY"; do
  [ -z "$f" ] || [ -r "$f" ] || { echo "Error: 読み取れないファイル: $f" >&2; exit 2; }
done
[ -z "$MESSAGE_FILE" ] || MESSAGE_FILE=$(abspath "$MESSAGE_FILE")
[ -z "$PR_BODY" ] || PR_BODY=$(abspath "$PR_BODY")
cd "$(git rev-parse --show-toplevel)" || exit 2
if [ "$MODE" = base ]; then
  git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || { echo "Error: --base が commit に解決できない: $BASE" >&2; exit 2; }
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# claude を呼ぶ前に exit 3 で終わる時も write_log が読めるよう空で作る (無いと jq が JSON を出しつつ exit 2 になり、
# 費用とトークン数の既定値と 2 つの JSON が --argjson に渡って実行ログを書けなかった)
: > "$WORK/claude.out"
LOG_DIR="$PWD/tmp/pre-publish-leak-check"
STARTED_AT=$(date +%Y-%m-%dT%H:%M:%S%z)
LOG_FILE="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-$$.json"

EXCLUDE_PATHSPECS=(.)
GENERATED_PATHSPECS=()
for g in "${LOCKFILE_GLOBS[@]}"; do
  EXCLUDE_PATHSPECS+=(":(exclude,glob)$g")
  GENERATED_PATHSPECS+=(":(glob)$g")
done
# 点検の範囲で変わったファイルのうち、linguist-generated が set か true のものも省く (理由はヘッダー「対象」)。
# 属性は公開する内容の .gitattributes だけから読む: --staged はインデックスの木、--base は HEAD の木 (未コミットの
# .gitattributes は公開しないのに点検の範囲を変えるため)。公開しない属性の設定 (core.attributesFile・info/attributes・
# システムの gitattributes) を読まないよう、空の bare リポジトリ (オブジェクトは元のリポジトリを alternates で参照) の
# 一時的なインデックスに木を読み、そこで check-attr する
ATTR_GIT_DIR="$WORK/attr-git"
git init -q --bare "$ATTR_GIT_DIR"
printf '%s\n' "$(git rev-parse --path-format=absolute --git-common-dir)/objects" > "$ATTR_GIT_DIR/objects/info/alternates"
if [ "$MODE" = staged ]; then
  ATTR_TREE=$(git write-tree)
else
  ATTR_TREE=$(git rev-parse "HEAD^{tree}")
fi
GIT_DIR="$ATTR_GIT_DIR" GIT_INDEX_FILE="$WORK/attr-index" git read-tree "$ATTR_TREE"
# check_generated_attr: 標準入力のパス (NUL 区切り) の linguist-generated を、公開する .gitattributes だけで判定して出す
check_generated_attr() {
  GIT_DIR="$ATTR_GIT_DIR" GIT_INDEX_FILE="$WORK/attr-index" GIT_ATTR_NOSYSTEM=1 \
    git -c core.attributesFile=/dev/null check-attr --cached -z --stdin linguist-generated
}
# git log の -z の出力はコミットの区切りに空の項目が入り、同じパスがコミットごとに出るため、空を除き重複を除いて
# check-attr に渡す (除外のパスは git diff の引数に並ぶため、重複が引数の長さを増やさないようにする)
if [ "$MODE" = staged ]; then
  git diff --cached --name-only -z --no-renames
else
  git log --format= --name-only -z --no-renames "$BASE..HEAD"
fi | while IFS= read -r -d '' changed_path; do
  [ -z "$changed_path" ] || printf '%s\0' "$changed_path"
done | sort -zu | check_generated_attr > "$WORK/generated-attr"
while IFS= read -r -d '' attr_path && IFS= read -r -d '' _ && IFS= read -r -d '' attr_value; do
  # 除外の範囲を決める .gitattributes 自身は、属性の値に関わらず patch を点検に入れる
  case "$attr_path" in
    .gitattributes|*/.gitattributes) continue ;;
  esac
  case "$attr_value" in
    set|true)
      EXCLUDE_PATHSPECS+=(":(exclude,literal)$attr_path")
      GENERATED_PATHSPECS+=(":(literal)$attr_path")
      ;;
  esac
done < "$WORK/generated-attr"

# --- 点検対象をプロンプトにまとめる (形は assets/review-prompt.md「入力の形」) ---
PROMPT_FILE="$WORK/prompt.txt"
EXCLUDED_FILE="$WORK/excluded.txt"
: > "$EXCLUDED_FILE"
COMMIT_COUNT=0
MERGE_COUNT=0
# 差分・コミットの一覧の取得に失敗した印 (除外のパスが多く引数の上限を超えた等)。失敗したまま送ると、空の patch を
# clean と判定させてしまうため、送る前に fail-closed にする
COLLECT_FAILED="$WORK/collect-failed"
# print_excluded <patch を省いた生成物 (lockfile と linguist-generated) のパス一覧>
print_excluded() {
  [ -n "$1" ] || return 0
  printf '<excluded_generated_files>\n%s\n</excluded_generated_files>\n' "$1"
  printf '%s\n' "$1" >> "$EXCLUDED_FILE"
}
{
  printf '<leak_review_input>\n'
  if [ "$MODE" = staged ]; then
    printf '<commit hash="staged">\n<message>\n'
    cat "$MESSAGE_FILE"
    printf '\n</message>\n<patch>\n'
    git diff --cached -M --no-color --no-ext-diff -- "${EXCLUDE_PATHSPECS[@]}" || : > "$COLLECT_FAILED"
    printf '</patch>\n'
    print_excluded "$(git diff --cached -M --name-only -- "${GENERATED_PATHSPECS[@]}")"
    printf '</commit>\n'
  else
    git log --reverse --format='%H %h %P' "$BASE..HEAD" > "$WORK/commits.txt" || : > "$COLLECT_FAILED"
    while read -r sha short parents; do
      [ -n "$sha" ] || continue
      COMMIT_COUNT=$((COMMIT_COUNT + 1))
      printf '<commit hash="%s">\n<message>\n' "$short"
      git log -1 --format=%B "$sha"
      printf '</message>\n'
      case "$parents" in
        *" "*) MERGE_COUNT=$((MERGE_COUNT + 1)) ;;
        *)
          printf '<patch>\n'
          git diff-tree -p -r --root -M --no-commit-id --no-color --no-ext-diff "$sha" -- "${EXCLUDE_PATHSPECS[@]}" || : > "$COLLECT_FAILED"
          printf '</patch>\n'
          print_excluded "$(git diff-tree -r --root -M --no-commit-id --name-only "$sha" -- "${GENERATED_PATHSPECS[@]}")"
          ;;
      esac
      printf '</commit>\n'
    done < "$WORK/commits.txt"
  fi
  if [ -n "$PR_BODY" ]; then
    printf '<pr_body>\n'
    cat "$PR_BODY"
    printf '\n</pr_body>\n'
  fi
  printf '</leak_review_input>\n'
} > "$PROMPT_FILE"
PROMPT_BYTES=$(wc -c < "$PROMPT_FILE" | tr -d ' ')

DURATION_SECONDS=0
CLAUDE_EXIT="null"
# write_log <exit code> <verdict (無ければ空)> <伏せ字済みの結果 {verdict, findings} の JSON ファイル (無ければ空)> <exit 3 の理由 (無ければ空)>
#   実行ログを 1 つ書き、そのパスを標準エラーに出す (書く項目はヘッダー「実行ログ」)
write_log() {
  mkdir -p "$LOG_DIR" || return 0
  # 費用とトークン数は claude -p の応答が JSON として読める時だけ入れる (読めない時と起動前は null)。入力トークン数は
  # prompt cache の作成・読み出しの分を足す (usage.input_tokens はキャッシュに載らなかった分だけで、実測で 2 になった)
  jq -n --arg started_at "$STARTED_AT" --arg mode "$MODE" --arg base "$BASE" \
    --argjson commits "$COMMIT_COUNT" --argjson merge_commits "$MERGE_COUNT" --argjson pr_body "$([ -n "$PR_BODY" ] && echo true || echo false)" \
    --rawfile excluded "$EXCLUDED_FILE" --arg model "$MODEL" --argjson prompt_bytes "$PROMPT_BYTES" \
    --argjson max_prompt_bytes "$MAX_PROMPT_BYTES" --argjson duration_seconds "$DURATION_SECONDS" \
    --argjson claude_exit "$CLAUDE_EXIT" --argjson exit_code "$1" --arg verdict "$2" \
    --argjson findings "$([ -n "$3" ] && jq -c '.findings' "$3" || echo null)" --arg error "$4" \
    --argjson usage "$(jq -cn '(try input catch {}) | {cost_usd: (.total_cost_usd? // null),
      input_tokens: (if (.usage? | type) == "object" then (.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.cache_read_input_tokens // 0) else null end),
      output_tokens: (.usage.output_tokens? // null)}' "$WORK/claude.out" 2>/dev/null || echo '{"cost_usd": null, "input_tokens": null, "output_tokens": null}')" '
    {started_at: $started_at, mode: $mode, base: (if $base == "" then null else $base end), commits: $commits,
     merge_commits: $merge_commits, pr_body: $pr_body, excluded_generated_files: ($excluded | split("\n") | map(select(length > 0))),
     model: $model, prompt_bytes: $prompt_bytes, max_prompt_bytes: $max_prompt_bytes, duration_seconds: $duration_seconds,
     claude_exit: $claude_exit, exit_code: $exit_code, verdict: (if $verdict == "" then null else $verdict end),
     findings: $findings, error: (if $error == "" then null else $error end)} + $usage' > "$LOG_FILE"
  echo "実行ログ: $LOG_FILE" >&2
}

# fail_closed <理由>: 点検できなかった理由を標準エラーと実行ログに残して exit 3
fail_closed() {
  echo "Error: ${1}。漏れの点検 (LLM) ができていないため push・PR 作成に進まない" >&2
  write_log 3 "" "" "$1"
  exit 3
}

scope="ステージ済みの差分とコミットメッセージ"
[ "$MODE" = base ] && scope="$BASE..HEAD の $COMMIT_COUNT コミット (merge $MERGE_COUNT 件は patch を省略)$([ -n "$PR_BODY" ] && echo "・PR body")"
echo "点検: ${scope}。プロンプト $PROMPT_BYTES バイト、モデル $MODEL" >&2

if [ "$MODE" = base ] && [ "$COMMIT_COUNT" -eq 0 ] && [ -z "$PR_BODY" ]; then
  echo "点検対象が無い ($BASE..HEAD が空で PR body も無い)" >&2
  printf '{"verdict":"clean","findings":[]}\n' > "$WORK/result.json"
  write_log 0 clean "$WORK/result.json" ""
  jq . "$WORK/result.json"
  exit 0
fi
if [ -e "$COLLECT_FAILED" ]; then
  fail_closed "点検対象の差分を取得できなかった (git の失敗。生成物のパスが多く引数の上限を超えた等)"
fi
if [ "$PROMPT_BYTES" -gt "$MAX_PROMPT_BYTES" ]; then
  fail_closed "プロンプトが上限を超えた ($PROMPT_BYTES バイト > $MAX_PROMPT_BYTES バイト。commit を分けて push するか、ユーザーに判断を仰ぐ)"
fi

# --- claude -p (起動の理由はヘッダーコメント) ---
: > "$WORK/claude.out"
START_SECONDS=$(date +%s)
CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 "$CLAUDE_BIN" -p "$(cat "$PROMPT_FILE")" \
  --model "$MODEL" \
  --output-format json \
  --json-schema "$(jq -c . "$SCHEMA_JSON")" \
  --system-prompt-file "$SYSTEM_PROMPT" \
  --tools "" \
  --safe-mode \
  --no-session-persistence \
  < /dev/null > "$WORK/claude.out" 2> "$WORK/claude.err"
CLAUDE_EXIT=$?
DURATION_SECONDS=$(( $(date +%s) - START_SECONDS ))

# claude -p がエラーを返した時の診断 (is_error の時の result は API・CLI のエラー文で、点検対象の本文ではない)
print_claude_error() {
  head -c 300 "$WORK/claude.err" >&2
  if jq -e '.is_error == true' "$WORK/claude.out" >/dev/null 2>&1; then
    jq -r '"subtype=\(.subtype // "") result=\((.result // "") | tostring | .[0:300])"' "$WORK/claude.out" >&2
  fi
}
if [ "$CLAUDE_EXIT" != 0 ]; then
  print_claude_error
  fail_closed "claude -p が exit $CLAUDE_EXIT で終了した"
fi
jq -e 'type == "object"' "$WORK/claude.out" >/dev/null 2>&1 || fail_closed "claude -p の出力が JSON として読めない"
if jq -e '.is_error == true' "$WORK/claude.out" >/dev/null 2>&1; then
  print_claude_error
  fail_closed "claude -p がエラーを返した"
fi
jq -e '
  .structured_output
  | type == "object"
    and (.verdict | IN("clean", "suspect"))
    and (.findings | type == "array")
    and all(.findings[];
      (.kind | IN("api_key", "token", "password", "private_key", "env_value", "personal_info", "internal_endpoint", "other"))
      and (.location | type == "string") and (.excerpt | type == "string")
      and (.confidence | type == "number") and (.verdict | IN("leak", "placeholder")))' "$WORK/claude.out" >/dev/null 2>&1 \
  || fail_closed "structured_output が無いか、形が assets/findings.schema.json と違う"

# --- 伏せ字 (ヘッダー「出力の伏せ字」)。location は 1 行 1 件のファイルにして既存の検出にかけ、当たった行番号を伏せる ---
jq -r '.structured_output.findings[] | .location | gsub("[\r\n\t]"; " ")' "$WORK/claude.out" > "$WORK/locations.txt"
: > "$WORK/hidden.txt"
if [ -s "$WORK/locations.txt" ]; then
  for check in "$SECRET_SCAN" "$PHONE_CHECK"; do
    if [ "$check" = "$PHONE_CHECK" ]; then
      bash "$check" --file "$WORK/locations.txt" > "$WORK/location-check.out" 2>/dev/null
    else
      bash "$check" "$WORK/locations.txt" > "$WORK/location-check.out" 2>/dev/null
    fi
    [ "$?" -le 1 ] || fail_closed "location の伏せ字 ($(basename "$check")) に失敗した"
    awk '{ if (match($0, /:[0-9]+: [A-Za-z0-9_-]+: /)) { s = substr($0, RSTART + 1); sub(/:.*/, "", s); print s } }' "$WORK/location-check.out" >> "$WORK/hidden.txt"
  done
fi
jq --slurpfile hidden <(jq -R 'tonumber' "$WORK/hidden.txt" | jq -sc .) '
  def mask_excerpt: tostring | (if test("[…*]") then .[0:(match("[…*]").offset)] else . end) | .[0:4] + "…";
  .structured_output
  | .findings = [.findings | to_entries[] | .value + {
      excerpt: (.value.excerpt | mask_excerpt),
      location: (if (.key + 1) | IN($hidden[0][]) then "(伏せた位置)" else (.value.location | gsub("[\r\n\t]"; " ") | .[0:200]) end)}]
  | .verdict = (if .verdict == "suspect" or any(.findings[]; .verdict == "leak") then "suspect" else "clean" end)
  | {verdict, findings}' "$WORK/claude.out" > "$WORK/result.json" || fail_closed "findings の伏せ字に失敗した"

if [ "$(jq -r '.verdict' "$WORK/result.json")" = suspect ]; then
  write_log 1 suspect "$WORK/result.json" ""
  jq . "$WORK/result.json"
  exit 1
fi
write_log 0 clean "$WORK/result.json" ""
jq . "$WORK/result.json"
exit 0
