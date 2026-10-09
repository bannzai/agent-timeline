#!/usr/bin/env bash
set -euo pipefail

# diff にも UTF-8 として不正なバイト列が入り得るため、grep / awk が落ちないようバイト単位で扱う
export LC_ALL=C

# commit / push 前の差分に電話番号らしき文字列が入っていないかを点検する。番号の実値が無くても動く
# (日本の携帯・国番号 +81・区切りありの固定電話のパターンで検出する)。環境変数
# PHONE_NUMBER_CHECK_NUMBERS が設定されていれば、その番号の表記揺れも併せて検査する。
# 検出行はマッチ部分を [PHONE] にマスクして出力する。
#
# パターンベースの検出のため、ISBN・タイムスタンプ・連番などが誤検出になり得る。検出された行が
# 本物の個人の電話番号かどうかは、agent またはユーザーが実物を見て判断する (このスクリプトは
# 判定材料を出すだけで、ファイルの修正は行わない)。
#
# Usage:
#   check-diff-for-phone-numbers.sh [--staged | --unpushed | --range <rev-range> | --file <path> [--mask-output <path>] | -]
#     --staged           ステージ済みの差分を点検する (既定。git diff --cached --unified=0)
#     --unpushed         未 push のコミットの差分を点検する (@{upstream}..HEAD。upstream が無ければ
#                        origin/HEAD..HEAD。どちらも無ければ exit 2)。ステージ済みの差分は見ない
#     --range <range>    指定した rev-range の差分を点検する (git diff <range>)
#     --file <path>      ファイル全体を点検する (差分ではなく全行が対象)
#     --mask-output <path>  --file と併用し、検出の表示に加えて、ファイル全体の一致箇所を [PHONE] に置き換えた
#                        本文を <path> に書く (検出が無ければ入力と同じ内容。置換後も一致が残る行は行ごと伏せる)。
#                        置き換えるのは検出と同じ数字境界で一致した範囲だけで、小数や長い数値 ID の途中は
#                        伏せない (mask-phone-spans.py。python3 が要る)。
#                        外部 API へ本文を送る前の伏せ字に使う (jev-check skill の check-rules-parallel.sh)
#     -                  標準入力を diff として読む
#   差分入力では追加行だけを対象にする (ファイルヘッダーの +++ 行は、直前が --- 行でハンクの外にある
#   場合だけヘッダーとして扱う。本文が "++ " で始まる追加行を取りこぼさないため)。
#   --unpushed / --range が見るのは範囲の net diff のため、途中の commit で足して後の commit で
#   消した番号は出ない。履歴に残る混入の点検は check-phone-numbers.sh (履歴走査) で行う。
# 出力:
#   標準出力           <ファイル>:<行>: <パターン名>: <マスク済みの抜粋>
#                      抜粋は検出したパターンだけでなく全パターンでマスクするため、1 行に複数種類の
#                      番号があっても生の数字列は出力に残らない
# Exit: 0=検出なし 1=検出あり 2=引数・入力エラー

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./phone-number-pattern.sh
. "$SCRIPT_DIR/phone-number-pattern.sh"

usage() {
  sed -n '/^# Usage:/,/^# Exit:/p' "$0" | sed 's/^# \{0,1\}//'
}

# 検出パターン。形式: ラベル|||境界を含まない ERE (core)。
# 実際の検索には前後が数字でないことを要求する境界を付ける。標準出力の抜粋は境界無しの core で広めに伏せ
# (表示は伏せすぎる側に倒す)、--mask-output の本文は検出と同じ境界で伏せる (判定材料を壊さないため)。
# 携帯 (mobile) と国番号 (intl-81) は phone-number-pattern.sh の PHONE_GENERIC_PATTERNS を
# そのまま使う (check-phone-numbers.sh --pattern と同じ定義。SSOT はそちら)。
# 固定電話 (landline) は同ライブラリの PHONE_LANDLINE_SEPARATED_PATTERN (区切りありかつ合計 10 桁。
# 履歴走査では使わない) を使う。
DIFF_PATTERNS=(
  "${PHONE_GENERIC_PATTERNS[@]}"
  "$PHONE_LANDLINE_SEPARATED_PATTERN"
)

MODE="staged"
RANGE=""
FILE=""
MASK_OUTPUT=""

require_value() {
  if [ -z "${2-}" ]; then
    echo "Error: $1 に値が必要" >&2
    exit 2
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --staged) MODE="staged"; shift ;;
    --unpushed) MODE="unpushed"; shift ;;
    --range) require_value --range "${2-}"; MODE="range"; RANGE="$2"; shift 2 ;;
    --file) require_value --file "${2-}"; MODE="file"; FILE="$2"; shift 2 ;;
    --mask-output) require_value --mask-output "${2-}"; MASK_OUTPUT="$2"; shift 2 ;;
    -) MODE="stdin"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: 不明な引数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -n "$MASK_OUTPUT" ] && [ "$MODE" != "file" ]; then
  echo "Error: --mask-output は --file と併用する (差分入力では追加行しか持たないため本文を書き出せない)" >&2
  exit 2
fi

# 環境変数で実値が渡されていれば、その番号の表記揺れも検査対象に加える
if [ -n "${PHONE_NUMBER_CHECK_NUMBERS-}" ]; then
  while IFS= read -r raw; do
    [ -n "$raw" ] || continue
    if ! normalized="$(phone_normalize_number "$raw")"; then
      echo "Error: PHONE_NUMBER_CHECK_NUMBERS に数字が 9 桁未満の指定がある" >&2
      exit 2
    fi
    DIFF_PATTERNS[${#DIFF_PATTERNS[@]}]="known-number|||$(phone_core_regex "$normalized")"
  done <<INPUT
$(phone_numbers_from_env)
INPUT
fi

# 出力前のマスクに使う、全パターンの和集合。1 行に複数種類の番号があっても、検出したパターン以外の
# 番号が生のまま標準出力へ出ないようにする。
MASK_CORES=""
for entry in "${DIFF_PATTERNS[@]}"; do
  core="${entry#*|||}"
  if [ -z "$MASK_CORES" ]; then MASK_CORES="$core"; else MASK_CORES="${MASK_CORES}|${core}"; fi
done
MASK_RE="(${MASK_CORES})"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/check-diff-for-phone-numbers.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

INPUT_FILE="$TMP/input"

case "$MODE" in
  staged)
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
      echo "Error: git リポジトリの中で実行する (--file / - なら repo の外でも点検できる)" >&2
      exit 2
    fi
    git diff --cached --unified=0 > "$INPUT_FILE"
    ;;
  unpushed)
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
      echo "Error: git リポジトリの中で実行する" >&2
      exit 2
    fi
    upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    if [ -n "$upstream" ]; then
      RANGE="${upstream}..HEAD"
    elif git rev-parse --verify --quiet origin/HEAD >/dev/null 2>&1; then
      RANGE="origin/HEAD..HEAD"
    else
      echo "Error: upstream も origin/HEAD も無く、未 push の範囲を決められない (--range で範囲を指定する)" >&2
      exit 2
    fi
    if ! git diff --unified=0 "$RANGE" > "$INPUT_FILE" 2>"$TMP/err"; then
      echo "Error: git diff に失敗:" >&2
      cat "$TMP/err" >&2
      exit 2
    fi
    ;;
  range)
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
      echo "Error: git リポジトリの中で実行する" >&2
      exit 2
    fi
    if ! git diff "$RANGE" > "$INPUT_FILE" 2>"$TMP/err"; then
      echo "Error: git diff に失敗:" >&2
      cat "$TMP/err" >&2
      exit 2
    fi
    ;;
  file)
    if [ ! -r "$FILE" ]; then
      echo "Error: 読み取れないファイル: $FILE" >&2
      exit 2
    fi
    cat "$FILE" > "$INPUT_FILE"
    ;;
  stdin)
    cat > "$INPUT_FILE"
    ;;
esac

# 点検対象を、位置 (ファイル:行) と本文の 2 ファイルに行単位で対応付けて正規化する。
# 本文にタブが含まれても壊れないよう、位置と本文を同じ行番号の別ファイルに分けて持つ。
SCAN_META="$TMP/scan-meta.txt"
SCAN_TEXT="$TMP/scan-text.txt"
if [ "$MODE" = "file" ]; then
  awk -v path="$FILE" '{ print path ":" NR }' "$INPUT_FILE" > "$SCAN_META"
  cat "$INPUT_FILE" > "$SCAN_TEXT"
else
  # in_header はハンクの外 (ファイルヘッダーの領域) にいることを表す。本文が "++ " で始まる追加行は
  # diff 上 "+++ " になるため、直前が "--- " 行でハンクの外にある +++ だけをファイルヘッダーとみなす。
  awk -v meta="$SCAN_META" -v body="$SCAN_TEXT" '
    BEGIN { in_header = 1; saw_minus_header = 0 }
    /^diff --git / { in_header = 1; saw_minus_header = 0; next }
    /^--- / {
      if (in_header) { saw_minus_header = 1; next }
    }
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
    /^\+/ {
      print (path == "" ? "(unknown)" : path) ":" lineno > meta
      print substr($0, 2) > body
      lineno++
      next
    }
    /^-/ { next }
    /^ / { lineno++; next }
  ' "$INPUT_FILE"
  touch "$SCAN_META" "$SCAN_TEXT"
fi

findings=0

for entry in "${DIFF_PATTERNS[@]}"; do
  label="${entry%%|||*}"
  core="${entry#*|||}"
  match_re="$(phone_match_regex "$core")"
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    rowno="${hit%%:*}"
    text="${hit#*:}"
    location="$(sed -n "${rowno}p" "$SCAN_META")"
    printf '%s: %s: %s\n' "$location" "$label" "$(phone_mask_text "$MASK_RE" "$text")"
    findings=$((findings + 1))
  done < <(grep -nE -e "$match_re" -- "$SCAN_TEXT" || true)
done

# 伏せ字の本文 (--file と --mask-output): 全行の一致箇所を、検出と同じ数字境界つきで [PHONE] に置き換え、
# 置換後も検索用 ERE に一致が残る行 (phone_mask_text と同じ基準) は行ごと伏せる。検出の有無に関わらず書く
# (検出が無ければ入力と同じ内容)。標準出力の抜粋 (phone_mask_text) が境界無しの core で広めに伏せるのと違い、
# ここは外部 API へ渡す判定材料なので、検出が除外する小数・長い数値 ID を壊さないよう境界を揃える
if [ -n "$MASK_OUTPUT" ]; then
  if ! command -v python3 > /dev/null 2>&1; then
    echo "Error: --mask-output には python3 が要る (境界つきの置換に mask-phone-spans.py を使う)" >&2
    exit 2
  fi
  mask_cores=()
  for entry in "${DIFF_PATTERNS[@]}"; do
    mask_cores+=("${entry#*|||}")
  done
  python3 "$SCRIPT_DIR/mask-phone-spans.py" "${mask_cores[@]}" < "$SCAN_TEXT" > "$TMP/masked" \
    || { echo "Error: マスク処理に失敗" >&2; exit 2; }
  residual_rows=""
  for entry in "${DIFF_PATTERNS[@]}"; do
    rows="$(grep -nE -e "$(phone_match_regex "${entry#*|||}")" -- "$TMP/masked" | cut -d: -f1 || true)"
    [ -n "$rows" ] && residual_rows="$residual_rows $rows"
  done
  if [ -n "$residual_rows" ]; then
    awk -v rows="$residual_rows" 'BEGIN { n = split(rows, a, " "); for (i = 1; i <= n; i++) if (a[i] != "") hide[a[i]] = 1 }
      { if (NR in hide) print "[電話番号を含む行 (マスクできないため非表示)]"; else print }' "$TMP/masked" > "$MASK_OUTPUT"
  else
    cat "$TMP/masked" > "$MASK_OUTPUT"
  fi
fi

echo "検出: $findings 件"
if [ "$findings" -gt 0 ]; then
  echo "誤検出 (ISBN・タイムスタンプ・連番等) があり得るため、本物の個人の電話番号かどうかは検出行の実物を見て判断する。"
  exit 1
fi
exit 0
