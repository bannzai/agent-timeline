#!/usr/bin/env bash
set -euo pipefail

# テキスト中の secret らしき文字列 (既知サービスのトークン接頭辞・秘密鍵ブロック) を検出する。
# 検出値は先頭数文字だけを表示 (マスク) し、全文は出力しない。読み取り専用で冪等。
#
# Usage:
#   scan-text-for-secrets.sh [--locate-prefix] [--mask-output <path>] [file ...]
#     file 省略時は標準入力を読む。
#     --locate-prefix: 各行を "location<TAB>text" として解釈し、検出位置として location を表示する
#                      (pre-public-check.sh の PR/issue 走査用。TAB が無い行は行全体を text として扱う)
#     --mask-output <path>: 検出の表示に加えて、入力の全パターンの一致箇所を [SECRET] に置き換えた本文を
#                      <path> に書く (入力は 1 ファイルまたは標準入力に限る。検出が無ければ入力と同じ内容。
#                      行数は入力と同じに保つ)。外部 API へ本文を送る前の伏せ字に使う (jev-check skill の
#                      check-rules-parallel.sh)。private-key-block は BEGIN 行にしか一致しないため、伏せ字では
#                      BEGIN 行から END 行までのブロック全体を行ごと [SECRET] にする (END だけが見える入力は先頭から
#                      END まで、BEGIN だけが見える入力は BEGIN から末尾まで)。マーカーを含まない窓に鍵本体だけが
#                      切り出される場合に備え、Base64 の文字だけからなる 40〜80 文字の行 (インデントと行末の CR は
#                      除いて判定) が 3 行以上続く塊も鍵本体とみなして行ごと [SECRET] にする (検出の件数には数えない)。
#                      塊の直後にある 40 文字未満の Base64 だけの行も、鍵本体の最終行 (末尾のパディングで短くなる)
#                      とみなして塊に含める。
#                      パターンの一致範囲は原文の行の上で求め、重なりと隣接をまとめてから置き換える
#                      (mask-secret-spans.py。順に置換すると一致が分断されて秘密値の末尾が残る)。python3 が要る。
#                      このモードではさらに、secret らしいキーへの代入・キー値の形 (下記 SECRET_VALUE_RE) の値も
#                      [SECRET] に置き換え、secret-value として検出に数える。--mask-output の無い走査
#                      (pre-public-check.sh の PR / issue 本文の点検) では使わない: キー名だけで当てる
#                      ヒューリスティックはプレースホルダや変数名にも当たり、public 化の可否 (NG は「新規
#                      public repo を推奨」) を誤検知で決めることになるため
# Exit: 0=検出なし 1=検出あり 2=引数・入力エラー

usage() {
  sed -n '4,29p' "$0" | sed 's/^# \{0,1\}//'
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASK_SPANS="$SCRIPT_DIR/mask-secret-spans.py"

# 検出パターンの SSOT。形式: label|||ERE
# 単語境界 \b は BSD/GNU grep で挙動差があるため使わない (接頭辞が十分特徴的なパターンのみ採用)
PATTERNS=(
  'github-token|||gh[opsur]_[A-Za-z0-9]{36}'
  'github-fine-grained-pat|||github_pat_[A-Za-z0-9_]{22,}'
  'aws-access-key-id|||(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}'
  'google-api-key|||AIza[0-9A-Za-z_-]{35}'
  'slack-token|||xox[baprs]-[0-9A-Za-z-]{10,}'
  'stripe-live-key|||(sk|rk)_live_[0-9a-zA-Z]{10,}'
  'openai-anthropic-key|||sk-(proj|ant)-[A-Za-z0-9_-]{20,}'
  'openai-legacy-key|||sk-[A-Za-z0-9]{40,}'
  'npm-token|||npm_[A-Za-z0-9]{36}'
  'sendgrid-api-key|||SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}'
  'tailscale-key|||tskey-[A-Za-z0-9-]{16,}'
  'private-key-block|||-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----'
  'jwt|||eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
)

# --mask-output の時だけ使う、secret らしいキー (SECRET_KEY_WORDS を含む識別子。大文字小文字を問わない) への代入・
# キー値の形 (環境変数・YAML・JSON・Go の := を含む代入)。値だけを伏せ、キー名・演算子・引用符は残す。
#   引用符で囲まれた値は空白を含めて閉じ引用符まで (バックスラッシュのエスケープを越えて) 伏せる。閉じ引用符が
#   同じ行に無い値は、もう一方の種類の引用符を含んでいても行末まで伏せる。引用符で始まらない値は空白か値の区切り
#   (, ; } )) まで (途中の引用符では切らない)。区切りで止めるのは、空白を入れない JSON
#   ({"maxTokens":4096,"email":"..."}) で後続のフィールドごと消さないため。消すと後続の個人情報が Jev の判定から
#   外れ、secret の後に行う電話番号の検出も効かなくなる
#   伏せない値 (判定材料として残す): 空値 (password = "")、`$` で始まる参照 (KEY=${OTHER}、KEY="${OTHER}"、
#   KEY=$(cmd))、`=` で始まるもの (token == "x" のような比較を代入と読まない)。それ以外のプレースホルダ
#   (<your-token>、xxx、changeme) は伏せる。判定に影響せず、区別する分岐を持たない方が単純なため
#   キー名だけで当てるため、maxTokens = 4096 や token: string (型注釈)・tokenizer = new Tokenizer() のように
#   secret でない値も伏せる。伏せた行は secret-value として検出に出るので、実物を見る手がかりは残る
ci() {
  # 大文字小文字を問わない照合を文字クラスで書くのは、BSD sed に大文字小文字を無視するフラグが無く、grep -i では
  # 大文字小文字を区別する他のパターンと同じ 1 本の ERE にできないため。
  # 大文字化は語ごとに tr を 1 回だけ呼ぶ (1 文字ずつ呼ぶと 1 回の実行で 100 を超えるプロセスを起動し、窓ごとに
  # 伏せ字を走らせる jev-check で効いてくる。${s^^} は bash 4 以降で、3.2 が既定の環境で動かないため使わない)
  local s="$1" upper i out=""
  upper="$(printf '%s' "$s" | tr '[:lower:]' '[:upper:]')"
  for ((i = 0; i < ${#s}; i++)); do
    out="${out}[${upper:i:1}${s:i:1}]"
  done
  printf '%s' "$out"
}
SECRET_KEY_WORDS="$(ci secret)|$(ci token)|$(ci password)|$(ci passwd)|$(ci api)[_-]?$(ci key)|$(ci private)[_-]?$(ci key)|$(ci credential)"
SECRET_VALUE_KEY_RE="([A-Za-z0-9_.-]*(${SECRET_KEY_WORDS})[A-Za-z0-9_.-]*[\"']?[[:space:]]*(:=|[=:])[[:space:]]*)"
SECRET_VALUE_DQ_RE="([^\"\\\\\$]|\\\\.)([^\"\\\\]|\\\\.)*"
SECRET_VALUE_SQ_RE="([^'\\\\\$]|\\\\.)([^'\\\\]|\\\\.)*"
SECRET_VALUE_OPEN_DQ_RE="([^\"\\\\\$=]|\\\\.)([^\"\\\\]|\\\\.)*\$"
SECRET_VALUE_OPEN_SQ_RE="([^'\\\\\$=]|\\\\.)([^'\\\\]|\\\\.)*\$"
# 値の区切りに ] は入れない (統合が先に入れた [SECRET] の閉じ括弧で値が切れ、その後ろの秘密値が残るため)
SECRET_VALUE_BARE_RE="[^[:space:]}),;\"'\$=][^[:space:]}),;]*"
SECRET_VALUE_RE="${SECRET_VALUE_KEY_RE}(\"(${SECRET_VALUE_DQ_RE})\"|'(${SECRET_VALUE_SQ_RE})'|\"${SECRET_VALUE_OPEN_DQ_RE}|'${SECRET_VALUE_OPEN_SQ_RE}|${SECRET_VALUE_BARE_RE})"
SECRET_VALUE_SED_EXPRESSIONS=(
  "s/${SECRET_VALUE_KEY_RE}\"(${SECRET_VALUE_DQ_RE})\"/\\1\"[SECRET]\"/g"
  "s/${SECRET_VALUE_KEY_RE}'(${SECRET_VALUE_SQ_RE})'/\\1'[SECRET]'/g"
  "s/${SECRET_VALUE_KEY_RE}\"${SECRET_VALUE_OPEN_DQ_RE}/\\1\"[SECRET]/g"
  "s/${SECRET_VALUE_KEY_RE}'${SECRET_VALUE_OPEN_SQ_RE}/\\1'[SECRET]/g"
  "s/${SECRET_VALUE_KEY_RE}${SECRET_VALUE_BARE_RE}/\\1[SECRET]/g"
)
SECRET_VALUE_LABEL='secret-value'

mask_secret() {
  local s="$1"
  printf '%s...(%d文字)' "${s:0:6}" "${#s}"
}

LOCATE_PREFIX=0
MASK_OUTPUT=""
FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --locate-prefix) LOCATE_PREFIX=1; shift ;;
    --mask-output)
      [[ -n "${2-}" ]] || { echo "Error: --mask-output に出力先が必要" >&2; exit 2; }
      MASK_OUTPUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Error: 不明なオプション: $1" >&2; usage >&2; exit 2 ;;
    *) FILES+=("$1"); shift ;;
  esac
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  STDIN_TMP="$(mktemp "${TMPDIR:-/tmp}/scan-text-for-secrets.XXXXXX")"
  trap 'rm -f "$STDIN_TMP"' EXIT
  cat > "$STDIN_TMP"
  FILES=("$STDIN_TMP")
fi
if [[ -n "$MASK_OUTPUT" && ${#FILES[@]} -ne 1 ]]; then
  echo "Error: --mask-output は入力が 1 ファイル (または標準入力) の時だけ使える" >&2
  exit 2
fi

TAB="$(printf '\t')"
findings=0

SCAN_PATTERNS=("${PATTERNS[@]}")
if [[ -n "$MASK_OUTPUT" ]]; then
  SCAN_PATTERNS+=("${SECRET_VALUE_LABEL}|||${SECRET_VALUE_RE}")
fi

for f in "${FILES[@]}"; do
  if [[ ! -r "$f" ]]; then
    echo "Error: 読み取れないファイル: $f" >&2
    exit 2
  fi
  for entry in "${SCAN_PATTERNS[@]}"; do
    label="${entry%%|||*}"
    re="${entry#*|||}"
    while IFS= read -r hit; do
      [[ -n "$hit" ]] || continue
      lineno="${hit%%:*}"
      line="${hit#*:}"
      if [[ "$LOCATE_PREFIX" -eq 1 && "$line" == *"$TAB"* ]]; then
        loc="${line%%"$TAB"*}"
        text="${line#*"$TAB"}"
      else
        loc="$f:$lineno"
        text="$line"
      fi
      while IFS= read -r m; do
        [[ -n "$m" ]] || continue
        printf '%s: %s: %s\n' "$loc" "$label" "$(mask_secret "$m")"
        findings=$((findings + 1))
      done < <(grep -Eo -e "$re" <<<"$text" || true)
    done < <(grep -En -e "$re" -- "$f" || true)
  done
done

# 伏せ字の本文: 秘密鍵のブロック (BEGIN〜END、片方しか無ければ先頭または末尾まで) と Base64 だけの行の塊
# (鍵本体がマーカー無しで切り出された窓) を行ごと [SECRET] にしてから、全パターンの一致範囲を原文の行の上で
# 求めて統合し [SECRET] に置き換え、最後に secret らしいキーの値を伏せる (検出の有無に関わらず書く。検出が
# 無ければ入力と同じ内容。行数は変えない)。
# キーの値だけは統合の後に置き換える: キー名・演算子・引用符を残すため、一致範囲ごと [SECRET] にする統合には
# 載せられない。統合が残した [SECRET] ごと値の区切り (空白・閉じ引用符・行末) まで広げて 1 つにまとめるので、
# 順に置換した時の「一致が分断されて秘密値の末尾が残る」問題は起きない
if [[ -n "$MASK_OUTPUT" ]]; then
  mask_res=()
  for entry in "${PATTERNS[@]}"; do
    mask_res+=("${entry#*|||}")
  done
  sed_args=()
  for expr in "${SECRET_VALUE_SED_EXPRESSIONS[@]}"; do
    sed_args+=(-e "$expr")
  done
  if ! command -v python3 > /dev/null 2>&1; then
    echo "Error: --mask-output には python3 が要る (一致範囲の統合に mask-secret-spans.py を使う)" >&2
    exit 2
  fi
  # ブロックの判定は原文に対して行う (先に置き換えを通すと BEGIN 行が [SECRET] になりマーカーを見失う)
  if ! awk '
    # 区間指定 {40,80} は awk の実装差 (BWK awk の旧版) があるため、文字クラスと length で書く
    BEGIN { begin_re = "-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----"; end_re = "-----END [A-Z ]*PRIVATE KEY( BLOCK)?-----"; b64_re = "^[A-Za-z0-9+/=]+$" }
    { lines[NR] = $0 }
    END {
      # BEGIN が無いのに END がある入力は先頭から END まで、BEGIN の後に END が無ければ末尾までを鍵ブロックとみなす
      inkey = 0
      first_end = 0
      for (i = 1; i <= NR; i++) { if (lines[i] ~ end_re) { first_end = i; break } }
      first_begin = 0
      for (i = 1; i <= NR; i++) { if (lines[i] ~ begin_re) { first_begin = i; break } }
      if (first_end > 0 && (first_begin == 0 || first_end < first_begin)) inkey = 1
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ begin_re) inkey = 1
        hide[i] = inkey
        if (lines[i] ~ end_re) inkey = 0
      }
      # Base64 だけの行が 3 行以上続く塊。判定はインデント (YAML 等) と行末の CR (CRLF) を除いた文字列で行う。
      # 塊の直後にある 40 文字未満の Base64 だけの行は、鍵本体の最終行 (末尾のパディングで短くなる) とみなして
      # 塊に含める (含めないと BEGIN / END の無い窓で最後の秘密値だけが残る)
      run = 0
      for (i = 1; i <= NR + 1; i++) {
        if (i <= NR) { s = lines[i]; sub(/^[ \t]+/, "", s); sub(/[ \t\r]+$/, "", s) }
        if (i <= NR && s ~ b64_re && length(s) >= 40 && length(s) <= 80) { run++; continue }
        if (run >= 3) {
          for (j = i - run; j < i; j++) hide[j] = 1
          if (i <= NR && s ~ b64_re && length(s) > 0 && length(s) < 40) hide[i] = 1
        }
        run = 0
      }
      for (i = 1; i <= NR; i++) print (hide[i] ? "[SECRET]" : lines[i])
    }' "${FILES[0]}" | python3 "$MASK_SPANS" "${mask_res[@]}" | sed -E "${sed_args[@]}" > "$MASK_OUTPUT"; then
    echo "Error: --mask-output へ書けない: $MASK_OUTPUT" >&2
    exit 2
  fi
fi

echo "検出: $findings 件"
if [[ "$findings" -gt 0 ]]; then
  exit 1
fi
exit 0
