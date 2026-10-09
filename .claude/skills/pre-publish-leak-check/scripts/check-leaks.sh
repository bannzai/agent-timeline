#!/usr/bin/env bash
set -uo pipefail

# commit・push・PR 作成の前に、これから公開する内容 (差分・コミットメッセージ・PR body) に「漏らしてはいけない情報」
# (定義の SSOT は assets/review-prompt.md) が無いかを機械的に点検する。検出パターンは持たず、既存の 3 つの検査を呼ぶ:
#   (a) 電話番号: github-repos-phone-number-check skill の check-diff-for-phone-numbers.sh (検出の範囲は同スクリプトの
#       ヘッダー)。差分は `-` で標準入力へ、コミットメッセージ・PR body は `--file` で渡す
#   (b) secret: pre-public-check skill の scan-text-for-secrets.sh の検出モード (検出の範囲は同スクリプトのヘッダー)。
#       差分は追加行だけを `<位置><TAB><本文>` にして `--locate-prefix` で渡す。`--mask-output` の時だけ使うキー名の判定
#       (secret-value) は使わない: プレースホルダ・型注釈・変数名にも当たり、要目視の件数が差分の大きさに比例して増えるため。
#       キー名から secret と分からない値・接続 URL に埋め込んだパスワードの判断は review-leaks.sh (LLM) が担う
#   (c) Jev: jev-check skill の check-rules-parallel.sh。差分は `--staged` / `--diff <merge-base>` / `--commit <sha>` で
#       渡す (規約と personal-info の両方。送る前の伏せ字と外部送信の範囲は同スクリプトのヘッダーと ADR 0073)。コミット
#       メッセージと PR body は 1 つのファイル (`messages.md`。personal-info.json の path_regex が拡張子で対象を選ぶため) に
#       まとめ、`--file` と `--rules <personal-info.json>` で個人情報の候補を出す。Jev が使えない時 (全リクエスト失敗は
#       同スクリプトが候補なしで通す。exit 2 / 3 は本スクリプトが標準エラーに 1 行出して省く) は fail-open で、exit code は
#       他の検出で決める
# commit 前に Jev が点検した差分の記録 (push 前に同じ差分を Jev へ送り直さないため。決定: ADR 0078):
#   - --staged で Jev の差分の点検が全リクエスト・全規約とも判定できた時だけ、ステージ済みの差分の本文の
#     hash (下の diff_id) を <git の共通ディレクトリ>/pre-publish-leak-check/jev-checked-diffs に 1 行足す。
#     Jev が使えない (fail-open)・一部が未判定・exit 2 の時は記録しない (push 前に点検し直させる)
#   - --base は各コミットの最初の親との差分の hash をこの記録と照らす。差分の無いコミットと記録にあるコミットは
#     Jev の差分の点検を省く。記録のあるコミットと無いコミットが混ざる時は、記録に無いコミットだけを
#     `--commit <sha>` で点検する。記録のあるコミットが 1 つも無く、記録に無い merge 以外のコミットがある時
#     (commit 系 skill を経由しない commit だけ。コミットごとに送ると同じファイルの窓をコミットの数だけ送るため) は、
#     従来どおり `--diff <merge-base>` で差分全体を点検する。記録に無い merge commit は下記「merge の取り込み分」の
#     とおりどちらの親にも無い行だけを点検し、差分全体には戻さない。電話番号・secret の正規表現とメッセージ・PR body
#     の Jev は記録に関わらず毎回行う
# merge の取り込み分を Jev に送らない (取り込んだ側は base で公開済みで、点検し直しても新しく見つかるものが無いため。
# 起票元: https://github.com/bannzai/castle/issues/1397 ):
#   - merge の判別: --staged は `MERGE_HEAD` があれば merge の途中 (親は HEAD と MERGE_HEAD)、--base は親が 2 つの
#     コミット (親は 1 番目と 2 番目)
#   - 「どちらの親にも無い行」は `git show --remerge-diff` と同じ考え方で取る: 2 つの親を `git merge-tree --write-tree`
#     で自動マージした tree (競合は競合マーカーつきで両方の側の行を含む。マーカーの形式は merge.conflictStyle=merge に
#     固定し、共通祖先の行を含めない。diff3 / zdiff3 は祖先の行も含み、競合の解消で祖先の行に戻した行が追加行に
#     ならないため) を最初の親、merge の結果の tree (--staged は
#     `git write-tree` で index から作る、--base は merge commit の tree) を内容にした、どの ref からも参照されない
#     コミットを `git commit-tree` で作り、check-rules-parallel.sh に `--commit <そのコミット>` で渡す。
#     check-rules-parallel.sh は最初の親との差分の追加行を点検するため、追加行は競合の解消や merge の中で足した行
#     だけになり、窓の本文は merge の結果から読む (位置は --staged では index、--base では merge commit と同じ)
#   - その差分に追加行が無ければ Jev を呼ばない。親が 3 つ以上・merge-tree が tree を返さない・index に未解決の
#     競合が残る時は切り分けられないため、従来どおり --staged はステージ済みの差分全体、--base は差分全体
#     (`--diff <merge-base>`) を点検する (標準エラーに 1 行出す)。電話番号・secret の正規表現の検査は merge でも
#     従来どおり行う (--staged はステージ済みの差分全体、--base は merge commit の patch を見ない)
# 決定: ADR 0076 (~/.claude/documents/adr/0076-two-layer-pre-publish-leak-gate-with-jev-and-fresh-context-llm.md)
# 冪等: 上記の記録 (同じ hash は 1 行だけ) と、merge-tree・write-tree・commit-tree が object database に書く参照されない
#   tree・commit object (commit-tree は作者・日時を固定し、同じ入力で同じ object になる) のほかは読み取り専用。
#   ref・index・作業ツリーを変えない (Jev の API には実行のたびに送る)。
#
# 対象:
#   --staged: ステージ済みの差分 (git diff --cached) の追加行と、--message-file のコミットメッセージ
#   --base:   <ref>..HEAD の各コミット (古い順) の patch の追加行と、各コミットメッセージ全文 (%B)、--pr-body の本文。
#             途中のコミットで足して後のコミットで消した値も足したコミットの patch として公開されるため、net diff ではなく
#             コミットごとに見る。merge commit は patch を見ずメッセージだけを見る (git log -p と同じ。取り込んだ側の
#             コミットは範囲に含まれていればそれぞれの patch で見る。競合の解消で足した行は見ない)。
#             Jev の差分の点検は上記の記録で絞る。差分全体を点検する時は check-rules-parallel.sh の `--diff` (作業ツリー
#             との net diff) を <ref> と HEAD の merge-base に対して行う (<ref> をそのまま渡すと、<ref> 側で進んだ変更の
#             逆向きが追加行として混ざるため)。作業ツリーに未コミットの変更があるとそれも含む (標準エラーに 1 行出す)
#
# Usage:
#   check-leaks.sh --staged --message-file <path>
#   check-leaks.sh --base <ref> [--pr-body <path>]
# 出力 (標準出力): 1 行 1 件。0 件なら何も出さない
#   <種別>: <位置>: <伏せた抜粋>
#   種別: phone(<パターン名>) / secret(<パターン名>) / jev(<規約 id>) / jev-phone(<パターン名>)
#     jev-phone は check-rules-parallel.sh が送信本文 (窓と文脈行) に電話番号らしき文字列を検出した位置 (同スクリプトの
#     exit 4)。変更していない文脈行の番号も含む
#   位置: 差分は <パス>:<行> (--base では先頭に commit の短い hash と空白)、コミットメッセージは commit-message:<行> (同)、
#     PR body は pr-body:<行>。jev・jev-phone の差分の候補は、`--commit` で点検したものはそのコミットの
#     `<短い hash> <パス>:<行>`、それ以外は作業ツリー (--staged では index) の <パス>:<行>
#   伏せた抜粋: phone / secret / jev-phone は各スクリプトの伏せ字出力のまま。jev は判定と確率 (本文は出さない)
# 標準エラー: 点検した範囲と検出件数の要約、Jev の差分の点検の範囲 (--base で記録により省いた・絞ったコミット)、
#   check-rules-parallel.sh の標準エラー (伏せ字の位置・電話番号の文脈判定の確率・失敗した規約・fail-open の 1 行・
#   差分の点検のリクエスト数の要約。行頭に [jev 差分] / [jev 差分 <短い hash>] / [jev メッセージ])、Jev を省いた時の 1 行
# 検出時の扱いは SKILL.md「Phase 3: 検出時の扱い」
# Exit: 0=検出なし 1=検出あり (要目視) 2=引数・環境エラー

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PHONE_CHECK="$SKILLS_ROOT/github-repos-phone-number-check/scripts/check-diff-for-phone-numbers.sh"
SECRET_SCAN="$SKILLS_ROOT/pre-public-check/scripts/scan-text-for-secrets.sh"
JEV_CHECK="$SKILLS_ROOT/jev-check/scripts/check-rules-parallel.sh"
# メッセージに当てる personal-info の定義は、check-rules-parallel.sh が差分に当てる既定のルール定義 2 と同じファイルにする
# (環境変数も同じ名前にし、テストで差し替えた時に差分とメッセージで同じ定義が使われるようにするため)
PERSONAL_INFO_JSON="${JEV_CHECK_PERSONAL_INFO_JSON:-$SKILLS_ROOT/jev-check/assets/rules/personal-info.json}"

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
for f in "$MESSAGE_FILE" "$PR_BODY"; do
  [ -z "$f" ] || [ -r "$f" ] || { echo "Error: 読み取れないファイル: $f" >&2; exit 2; }
done
for cmd in git jq awk; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: $cmd が必要" >&2; exit 2; }
done
for s in "$PHONE_CHECK" "$SECRET_SCAN"; do
  [ -f "$s" ] || { echo "Error: 呼び出すスクリプトが無い: $s" >&2; exit 2; }
done
# jev-check skill が無い環境 (castle の配布サブセットだけを置いたクラウドセッション等。 https://github.com/bannzai/castle/issues/1546 ) では
# Jev の点検を省き、電話番号・secret の正規表現だけで判定する (Jev が使えない時と同じ fail-open)
JEV_AVAILABLE=1
if [ ! -f "$JEV_CHECK" ] || [ ! -f "$PERSONAL_INFO_JSON" ]; then
  JEV_AVAILABLE=0
  echo "Jev が使えないため省略した (jev-check skill が無い: ${JEV_CHECK}。fail-open)" >&2
fi
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Error: git リポジトリ内で実行する" >&2; exit 2; }
if [ "$MODE" = base ]; then
  git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || { echo "Error: --base が commit に解決できない: $BASE" >&2; exit 2; }
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FINDINGS="$WORK/findings.txt"
: > "$FINDINGS"

# commit 前に Jev が点検した差分の hash の記録 (ヘッダー「commit 前に Jev が点検した差分の記録」)。worktree の間で
# 共有するため git の共通ディレクトリに置く (リポジトリの追跡対象にはならない)
JEV_CHECKED_RECORD="$(git rev-parse --path-format=absolute --git-common-dir)/pre-publish-leak-check/jev-checked-diffs"
# diff_id <git diff の引数...>: その差分の本文の hash (差分が無ければ空)。commit 前 (--cached) と push 前 (<親> <commit>) で
# 同じ差分が同じ値になるよう、出力の形に効く設定 (接頭辞・rename 検出・外部 diff・相対パス) を引数で固定する。
# `git patch-id` は空白の違いを無視し、点検した後に文字列の中の空白だけを変えた差分も同じ値になるため使わない。
# hash-object は -w を付けないので object を書かない
diff_id() {
  git diff --no-color --no-ext-diff --no-textconv --no-renames --no-relative --full-index --src-prefix=a/ --dst-prefix=b/ "$@" > "$WORK/diff-id.patch"
  [ -s "$WORK/diff-id.patch" ] || return 0
  git hash-object --stdin < "$WORK/diff-id.patch"
}

# to_findings <種別> <位置の前に付ける文字列> [<行番号 → 位置の対応表>]
#   標準入力の検査スクリプトの検出行を、本スクリプトの出力の 1 行 (ヘッダー「出力」) にする。対応表を渡した時は、位置の
#   行番号を対応表のその行 (messages.md の行 → commit-message:<行> 等) に置き換える。位置とパターン名の区切りを先頭から
#   最初の `:<行番号>: <パターン名>: ` にするのは、抜粋の中の `: ` に引きずられないため
to_findings() {
  awk -v kind="$1" -v prefix="$2" -v map="${3-}" '
    BEGIN { if (map != "") { n = 0; while ((getline l < map) > 0) loc[++n] = l } }
    {
      if (!match($0, /:[0-9]+: [A-Za-z0-9_-]+: /)) next
      head = substr($0, 1, RSTART - 1)
      rest = substr($0, RSTART + 1)
      split(rest, parts, ": ")
      lineno = parts[1]
      label = parts[2]
      excerpt = substr(rest, length(lineno) + length(label) + 5)
      where = (map != "") ? ((lineno + 0) in loc ? loc[lineno + 0] : "-") : prefix head ":" lineno
      printf "%s(%s): %s: %s\n", kind, label, where, excerpt
    }'
}

# run_check <出力先> <スクリプト> [引数...]: 検査スクリプトを実行し、exit 0 / 1 以外 (入力・環境エラー) なら exit 2 で止める
run_check() {
  local out="$1" rc
  shift
  bash "$@" > "$out" 2> "$WORK/check.err"
  rc=$?
  if [ "$rc" != 0 ] && [ "$rc" != 1 ]; then
    echo "Error: $(basename "$1") が exit $rc で失敗" >&2
    cat "$WORK/check.err" >&2
    exit 2
  fi
}

# 追加行を `<位置の前に付ける文字列><パス>:<行><TAB><本文>` にする。ファイルヘッダーの判定は
# check-diff-for-phone-numbers.sh と同じ (本文が "++ " で始まる追加行を取りこぼさないため、直前が "--- " 行で
# ハンクの外にある "+++ " だけをヘッダーとみなす)
added_lines_with_location() {
  awk -v prefix="$1" '
    BEGIN { in_header = 1; saw_minus_header = 0 }
    /^diff --git / { in_header = 1; saw_minus_header = 0; path = ""; next }
    /^--- / { if (in_header) { saw_minus_header = 1; next } }
    /^\+\+\+ / {
      if (in_header && saw_minus_header) {
        path = substr($0, 5)
        sub(/^[ab]\//, "", path)
        saw_minus_header = 0
        next
      }
    }
    /^@@ / {
      in_header = 0
      saw_minus_header = 0
      plus = $3
      sub(/^\+/, "", plus)
      sub(/,.*$/, "", plus)
      lineno = plus + 0
      next
    }
    /^\+/ { if (!in_header) { printf "%s%s:%d\t%s\n", prefix, path, lineno, substr($0, 2); lineno++ } next }
    /^ / { lineno++; next }
  ' "$2"
}

# scan_diff <位置の前に付ける文字列 (--base では "<短い hash> ")> <unified diff のファイル>: (a) と (b)
scan_diff() {
  run_check "$WORK/phone.out" "$PHONE_CHECK" - < "$2"
  to_findings phone "$1" < "$WORK/phone.out" >> "$FINDINGS"
  added_lines_with_location "$1" "$2" > "$WORK/added.tsv"
  if [ -s "$WORK/added.tsv" ]; then
    run_check "$WORK/secret.out" "$SECRET_SCAN" --locate-prefix "$WORK/added.tsv"
    # --locate-prefix の位置は `<前に付ける文字列><パス>:<行>` をそのまま返すため、前に付ける文字列は足さない
    to_findings secret "" < "$WORK/secret.out" >> "$FINDINGS"
  fi
}

# remerge_commit <最初の親> <2 番目の親> <merge の結果の tree>: ヘッダー「merge の取り込み分を Jev に送らない」の
#   参照されないコミットの sha を出す。どちらの親にも無い行が無ければ何も出さない。自動マージの tree を作れなければ 1
remerge_commit() {
  local auto parent
  # 競合がある時の merge-tree は exit 1 でも tree を出すため、exit code ではなく 1 行目が tree かで判定する
  auto=$(git -c merge.conflictStyle=merge merge-tree --write-tree "$1" "$2" 2>/dev/null | head -n 1)
  [ -n "$auto" ] && git rev-parse --verify --quiet "$auto^{tree}" >/dev/null || return 1
  # 追加行の有無はリポジトリ全体で見る (diff.relative・textconv の設定で行が落ちないよう引数で固定する)
  git diff --unified=0 --no-color --no-ext-diff --no-textconv --no-relative --find-renames "$auto" "$3" > "$WORK/remerge.diff"
  added_lines_with_location "" "$WORK/remerge.diff" > "$WORK/remerge-added.tsv"
  [ -s "$WORK/remerge-added.tsv" ] || return 0
  parent=$(fixed_commit_tree -m "check-leaks: auto merge of $1 $2" "$auto") || return 1
  fixed_commit_tree -m "check-leaks: lines in neither parent" -p "$parent" "$3" || return 1
}

# fixed_commit_tree <git commit-tree の引数...>: 作者・日時を固定した commit-tree (同じ入力で同じ object にするため)
fixed_commit_tree() {
  GIT_AUTHOR_NAME=check-leaks GIT_AUTHOR_EMAIL=check-leaks@localhost GIT_AUTHOR_DATE="@1000000000 +0000" \
  GIT_COMMITTER_NAME=check-leaks GIT_COMMITTER_EMAIL=check-leaks@localhost GIT_COMMITTER_DATE="@1000000000 +0000" \
    git commit-tree --no-gpg-sign "$@"
}

# --- コミットメッセージと PR body を 1 つのファイルにまとめる。messages.map は messages.md と同じ行数で、各行の位置
# (見出し・区切りの行は "-") を持つ。messages.tsv は scan-text-for-secrets.sh --locate-prefix に渡す `<位置><TAB><本文>` ---
MESSAGES_MD="$WORK/messages.md"
MESSAGES_MAP="$WORK/messages.map"
MESSAGES_TSV="$WORK/messages.tsv"
: > "$MESSAGES_MD"
: > "$MESSAGES_MAP"
: > "$MESSAGES_TSV"
MESSAGE_COUNT=0
# add_text <見出し> <位置 (行番号の前まで)> <本文のファイル>
add_text() {
  printf '# %s\n' "$1" >> "$MESSAGES_MD"
  printf -- '-\n' >> "$MESSAGES_MAP"
  awk -v loc="$2" -v md="$MESSAGES_MD" -v map="$MESSAGES_MAP" -v tsv="$MESSAGES_TSV" '
    { print >> md; print loc ":" NR >> map; print loc ":" NR "\t" $0 >> tsv }' "$3"
  printf '\n' >> "$MESSAGES_MD"
  printf -- '-\n' >> "$MESSAGES_MAP"
}

COMMIT_COUNT=0
MERGE_COUNT=0
# Jev の差分の点検の実行単位。1 行 = <ラベル>|<位置の前に付ける文字列>|<check-rules-parallel.sh のモード引数> (区切りを TAB にしないのは、空の欄が read で詰められるため)
JEV_DIFF_RUNS="$WORK/jev-diff-runs.txt"
: > "$JEV_DIFF_RUNS"
STAGED_DIFF_ID=""
if [ "$MODE" = staged ]; then
  git diff --cached --unified=0 --no-color --no-ext-diff -M > "$WORK/staged.diff"
  scan_diff "" "$WORK/staged.diff"
  add_text "これから commit するコミットメッセージ" "commit-message" "$MESSAGE_FILE"
  MESSAGE_COUNT=1
  STAGED_DIFF_ID=$(diff_id --cached)
  MERGE_HEAD_FILE=$(git rev-parse --git-path MERGE_HEAD)
  if [ ! -f "$MERGE_HEAD_FILE" ]; then
    printf '差分||--staged\n' >> "$JEV_DIFF_RUNS"
  elif [ "$(awk 'END { print NR }' "$MERGE_HEAD_FILE")" = 1 ] && head_sha=$(git rev-parse --verify --quiet HEAD) \
       && index_tree=$(git write-tree 2>/dev/null) \
       && remerge=$(remerge_commit "$head_sha" "$(git rev-parse --verify --quiet MERGE_HEAD)" "$index_tree"); then
    if [ -n "$remerge" ]; then
      echo "merge の途中のため、Jev の差分の点検はどちらの親にも無い行 (競合の解消・merge の中で足した行) だけに行う" >&2
      printf '差分||--commit %s\n' "$remerge" >> "$JEV_DIFF_RUNS"
    else
      echo "merge の途中で、どちらの親にも無い行が無いため Jev の差分の点検を省いた" >&2
    fi
  else
    echo "merge の途中だが取り込んだ側を切り分けられない (親が 3 つ以上・未解決の競合等) ため、Jev はステージ済みの差分全体を点検する" >&2
    printf '差分||--staged\n' >> "$JEV_DIFF_RUNS"
  fi
else
  MERGE_BASE=$(git merge-base "$BASE" HEAD 2>/dev/null) || MERGE_BASE="$BASE"
  git log --reverse --format='%H %h %P' "$BASE..HEAD" > "$WORK/commits.txt"
  # Jev の差分の点検が要るコミット。1 行 = <--commit に渡す sha> <短い hash>。commit 前の記録に無く差分のある merge 以外の
  # コミットはそのコミット、どちらの親にも無い行がある merge commit はその行だけを追加行にしたコミット (remerge_commit)
  UNCHECKED_COMMITS="$WORK/unchecked.txt"
  : > "$UNCHECKED_COMMITS"
  UNCHECKED_PLAIN=0
  # どちらの親にも無い行を切り分けられない merge commit の数 (差分全体の点検に戻す)
  UNCHECKED_MERGES=0
  RECORDED_COUNT=0
  while read -r sha short parents; do
    [ -n "$sha" ] || continue
    COMMIT_COUNT=$((COMMIT_COUNT + 1))
    case "$parents" in
      *" "*) MERGE_COUNT=$((MERGE_COUNT + 1)) ;;
      *)
        git diff-tree -p -r --root -M --unified=0 --no-commit-id --no-color --no-ext-diff "$sha" > "$WORK/commit.diff"
        scan_diff "$short " "$WORK/commit.diff"
        ;;
    esac
    git log -1 --format=%B "$sha" > "$WORK/commit.msg"
    add_text "commit $short のコミットメッセージ" "$short commit-message" "$WORK/commit.msg"
    MESSAGE_COUNT=$((MESSAGE_COUNT + 1))
    # root commit は空の tree と比べる (commit 前の git diff --cached も空の tree と比べるため同じ値になる)
    parent=$(git rev-parse --verify --quiet "$sha^1") || parent=$(git hash-object -t tree /dev/null)
    id=$(diff_id "$parent" "$sha")
    [ -n "$id" ] || continue
    if grep -qxF "$id" "$JEV_CHECKED_RECORD" 2>/dev/null; then
      RECORDED_COUNT=$((RECORDED_COUNT + 1))
    else
      case "$parents" in
        *" "*)
          # 取り込んだ側の行は送らず、どちらの親にも無い行だけを点検する (ヘッダー「merge の取り込み分を Jev に送らない」)
          set -- $parents
          if [ "$#" -eq 2 ] && remerge=$(remerge_commit "$1" "$2" "$(git rev-parse "$sha^{tree}")"); then
            [ -z "$remerge" ] || printf '%s %s\n' "$remerge" "$short" >> "$UNCHECKED_COMMITS"
            continue
          fi
          UNCHECKED_MERGES=$((UNCHECKED_MERGES + 1))
          ;;
        *) UNCHECKED_PLAIN=$((UNCHECKED_PLAIN + 1)) ;;
      esac
      printf '%s %s\n' "$sha" "$short" >> "$UNCHECKED_COMMITS"
    fi
  done < "$WORK/commits.txt"
  [ "$COMMIT_COUNT" -gt 0 ] || echo "点検するコミットが無い ($BASE..HEAD が空)" >&2
  unchecked_count=$(awk 'END { print NR }' "$UNCHECKED_COMMITS")
  if [ "$unchecked_count" -eq 0 ]; then
    # 点検するコミットが無い範囲は、push されない作業ツリーの変更を送らないよう差分の点検をしない
    [ "$COMMIT_COUNT" -eq 0 ] || echo "Jev の差分の点検を省いた ($COMMIT_COUNT コミットすべて commit 前に点検済みか差分が無い)" >&2
  elif [ "$UNCHECKED_MERGES" -gt 0 ] || { [ "$UNCHECKED_PLAIN" -gt 0 ] && [ "$RECORDED_COUNT" -eq 0 ]; }; then
    # 記録が 1 件も無い範囲をコミットごとに送ると、同じファイルを触った N コミットで同じ窓を N 回送るため差分全体にする
    # (merge commit のどちらの親にも無い行も差分全体に含まれるため、merge commit ごとには送らない)
    if [ "$UNCHECKED_MERGES" -gt 0 ]; then
      echo "どちらの親にも無い行を切り分けられない merge commit が $UNCHECKED_MERGES 件あるため、Jev は差分全体 (--diff $MERGE_BASE) を点検する" >&2
    else
      echo "commit 前の点検の記録があるコミットが無いため、Jev は差分全体 (--diff $MERGE_BASE) を点検する" >&2
    fi
    printf '差分||--diff %s\n' "$MERGE_BASE" >> "$JEV_DIFF_RUNS"
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      echo "作業ツリーに未コミットの変更がある。Jev の差分の点検 (--diff) はそれも含む (push される内容はコミットだけ)" >&2
    fi
  elif [ "$unchecked_count" -gt 0 ]; then
    echo "Jev の差分の点検は commit 前の点検の記録が無い $unchecked_count / $COMMIT_COUNT コミットだけに行う: $(awk '{ print $2 }' "$UNCHECKED_COMMITS" | tr '\n' ' ')" >&2
    [ "$UNCHECKED_PLAIN" -eq "$unchecked_count" ] \
      || echo "うち merge commit $((unchecked_count - UNCHECKED_PLAIN)) 件は、どちらの親にも無い行 (競合の解消・merge の中で足した行) だけを点検する" >&2
    while read -r sha short; do
      printf '差分 %s|%s |--commit %s\n' "$short" "$short" "$sha" >> "$JEV_DIFF_RUNS"
    done < "$UNCHECKED_COMMITS"
  fi
fi
if [ -n "$PR_BODY" ]; then
  add_text "PR body" "pr-body" "$PR_BODY"
fi

# (a)(b) のメッセージ・PR body 分 (messages.md の行番号を messages.map で位置に直す)
if [ -s "$MESSAGES_TSV" ]; then
  run_check "$WORK/phone.out" "$PHONE_CHECK" --file "$MESSAGES_MD"
  to_findings phone "" "$MESSAGES_MAP" < "$WORK/phone.out" >> "$FINDINGS"
  run_check "$WORK/secret.out" "$SECRET_SCAN" --locate-prefix "$MESSAGES_TSV"
  to_findings secret "" < "$WORK/secret.out" >> "$FINDINGS"
fi

# jev_findings <check-rules-parallel.sh の json 出力> [<行番号 → 位置の対応表>] [<位置の前に付ける文字列>]
#   Jev の候補を本スクリプトの出力の 1 行にする。行を特定できなかった候補 (line 0) の位置は、差分では <パス>:0、
#   メッセージでは "-" にする
jev_findings() {
  jq -r --rawfile map "${2:-/dev/null}" --arg prefix "${3-}" '
    def r2: . * 100 | round / 100;
    ($map | split("\n") | map(select(length > 0))) as $locs
    | .[]
    | (if ($locs | length) == 0 then "\($prefix)\(.path):\(.line)" elif .line >= 1 then ($locs[.line - 1] // "-") else "-" end) as $where
    | "jev(\(.rule)): \($where): "
      + (if has("verdict") then "\(.verdict) p_yes=\(.p_yes | r2) p_no=\(.p_no | r2)" else "p=\(.p | r2)" end)
      + " line_p=\(.line_p | r2) line_conf=\(.line_conf | r2)"' "$1"
}

# jev_phone_findings <標準エラー> [<位置の前に付ける文字列>]
#   送信本文の電話番号 (check-rules-parallel.sh の exit 4) の位置は、標準エラーの「[PHONE] に伏せて送った」の見出しに続く
#   字下げ行 (`  <パス>:<行>: <パターン名>: <伏せた抜粋>`) から取る
jev_phone_findings() {
  awk '
    /\[PHONE\] に伏せて送った/ { inblock = 1; next }
    inblock && /^  / { print substr($0, 3); next }
    { inblock = 0 }' "$1" | to_findings jev-phone "${2-}"
}

# jev_collect <ラベル> <exit code> <json 出力> <標準エラー> <差分か (1/0)> [<対応表>] [<位置の前に付ける文字列>]
jev_collect() {
  local label="$1" rc="$2" out="$3" err="$4" is_diff="$5" map="${6-}" prefix="${7-}" phone_lines
  sed "s/^/[jev $label] /" "$err" >&2
  case "$rc" in
    0|1|4)
      if jq -e 'type == "array"' "$out" >/dev/null 2>&1; then
        jev_findings "$out" "$map" "$prefix" >> "$FINDINGS"
      else
        echo "Jev ($label) の出力が読めないため省略した (check-rules-parallel.sh exit $rc)" >&2
      fi
      if [ "$rc" = 4 ] && [ "$is_diff" = 1 ]; then
        phone_lines=$(jev_phone_findings "$err" "$prefix")
        if [ -n "$phone_lines" ]; then
          printf '%s\n' "$phone_lines" >> "$FINDINGS"
        else
          echo "jev-phone(unknown): -: check-rules-parallel.sh が送信本文に電話番号らしき文字列を検出した (位置は標準エラー)" >> "$FINDINGS"
        fi
      fi
      ;;
    *)
      echo "Jev ($label) が使えないため省略した (check-rules-parallel.sh exit ${rc}。fail-open)" >&2
      ;;
  esac
}

# jev_fully_judged <標準エラー>: --verbose の要約で、全リクエストが成功し未判定の規約が無い (または送るものが無い) なら 0
jev_fully_judged() {
  grep -q '^リクエストなし' "$1" && return 0
  awk '/^requests=[0-9]+ ok=[0-9]+ failed=0 undetermined=0 / {
         split($1, r, "="); split($2, o, "=")
         if (r[2] == o[2]) found = 1
       }
       END { exit found ? 0 : 1 }' "$1"
}

# --- (c) Jev: メッセージは並行して走らせ、差分は実行単位ごとに順に走らせる (各実行が --jobs 本ずつ並列に送るため、
# 実行単位を同時に走らせると 429 に当たりやすい)。(a)(b) の exit 2 で止まった時に取り残さないよう、その後に起動する ---
JEV_RUN_MESSAGES=0
[ "$JEV_AVAILABLE" = 1 ] || : > "$JEV_DIFF_RUNS"
if [ "$JEV_AVAILABLE" = 1 ] && [ -s "$MESSAGES_TSV" ]; then
  JEV_RUN_MESSAGES=1
  bash "$JEV_CHECK" --file "$MESSAGES_MD" --rules "$PERSONAL_INFO_JSON" --format json > "$WORK/jev-messages.json" 2> "$WORK/jev-messages.err" &
  JEV_MESSAGES_PID=$!
fi

run_index=0
while IFS='|' read -r label prefix mode_args; do
  run_index=$((run_index + 1))
  # mode_args は "--staged" / "--diff <ref>" / "--commit <sha>" で、空白を含まないため単語分割で渡す
  bash "$JEV_CHECK" $mode_args --format json --verbose > "$WORK/jev-diff.$run_index.json" 2> "$WORK/jev-diff.$run_index.err" < /dev/null
  rc=$?
  jev_collect "$label" "$rc" "$WORK/jev-diff.$run_index.json" "$WORK/jev-diff.$run_index.err" 1 "" "$prefix"
  # commit 前の点検が全部判定できた差分だけを記録する (ヘッダー「commit 前に Jev が点検した差分の記録」)
  if [ "$MODE" = staged ] && [ -n "$STAGED_DIFF_ID" ] && { [ "$rc" = 0 ] || [ "$rc" = 1 ] || [ "$rc" = 4 ]; } \
     && jev_fully_judged "$WORK/jev-diff.$run_index.err"; then
    mkdir -p "$(dirname "$JEV_CHECKED_RECORD")"
    grep -qxF "$STAGED_DIFF_ID" "$JEV_CHECKED_RECORD" 2>/dev/null || printf '%s\n' "$STAGED_DIFF_ID" >> "$JEV_CHECKED_RECORD"
  fi
done < "$JEV_DIFF_RUNS"

if [ "$JEV_RUN_MESSAGES" = 1 ]; then
  wait "$JEV_MESSAGES_PID"
  # メッセージ・PR body の電話番号は (a) が全行を見ているため、jev-phone は差分の分だけ出す
  jev_collect "メッセージ" "$?" "$WORK/jev-messages.json" "$WORK/jev-messages.err" 0 "$MESSAGES_MAP"
fi

awk '!seen[$0]++' "$FINDINGS" > "$WORK/findings.uniq"
count=$(awk 'END { print NR }' "$WORK/findings.uniq")
if [ "$MODE" = staged ]; then
  scope="ステージ済みの差分とコミットメッセージ"
else
  scope="$BASE..HEAD の $COMMIT_COUNT コミット (merge $MERGE_COUNT 件は patch を省略) の patch とメッセージ"
  [ -n "$PR_BODY" ] && scope="${scope}・PR body"
fi
echo "点検: ${scope}。検出 $count 件" >&2
cat "$WORK/findings.uniq"
[ "$count" -eq 0 ] || exit 1
exit 0
