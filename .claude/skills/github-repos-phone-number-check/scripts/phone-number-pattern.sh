#!/usr/bin/env bash
# 電話番号の正規化と、表記揺れを 1 つにまとめた ERE の生成を行う共有ライブラリ。
# check-phone-numbers.sh と check-diff-for-phone-numbers.sh の両方から source して使う
# (正規化・パターン生成ロジックの SSOT)。source 専用で、直接実行しても何もしない。
#
# 提供する関数:
#   phone_numbers_from_env             環境変数 PHONE_NUMBER_CHECK_NUMBERS (カンマまたは空白区切り) を
#                                      1 行 1 番号で出力する
#   phone_normalize_number <番号>      数字以外を除去し、+81 / 81 始まりを 0 始まりへ揃えた数字列を出力する。
#                                      9 桁未満になる入力は 1 を返す (短すぎる数字列での誤爆を防ぐため)
#   phone_core_regex <正規化番号>      数字の間に 0〜4 バイトの非英数字 (ハイフン・空白・括弧・ドット・
#                                      全角記号) を許し、+81 表記も 1 つにまとめた ERE を出力する
#   phone_match_regex <core ERE>       前後が数字 (先頭側は . も) でないことを要求する境界付きの検索用 ERE を出力する
#   phone_mask_text <core ERE> <文字列> マッチ部分を [PHONE] に置換した文字列を出力する。
#                                      置換後もマッチが残る場合は文字列全体を伏せる
#
# 提供する変数:
#   PHONE_GENERIC_PATTERNS             番号の実値なしで電話番号らしき文字列を拾う汎用パターンの配列。
#                                      形式は「ラベル|||境界を含まない ERE (core)」
#   PHONE_LANDLINE_SEPARATED_PATTERN   区切りありの国内固定電話 (合計 10 桁) を拾うパターン (同じ形式の 1 要素)。
#                                      区切り無しは連番・ID との誤検出が多いため、履歴走査 (check-phone-numbers.sh)
#                                      では使わず、差分点検と外部送信前の除外にだけ使う
#
# 生成した ERE と正規化後の数字列は、呼び出し側でも標準出力・標準エラー・レポートへ出力しない
# (電話番号の実値がログ・レポートに残らないようにするため)。

# 数字と数字の間に許す区切り。ハイフン・空白・括弧・ドットのほか、全角記号 (UTF-8 で複数バイト) も
# 通せるよう、非英数字を最大 4 バイトまで許す。
PHONE_SEPARATOR_ERE='[^0-9A-Za-z]{0,4}'

# 番号の実値なしで電話番号らしき文字列を拾う汎用パターンの SSOT。
# check-phone-numbers.sh の --pattern と check-diff-for-phone-numbers.sh の DIFF_PATTERNS が
# この定義を参照する (どちらか一方だけを直すと検出範囲がずれるため、変更はここで行う)。
# 形式: ラベル|||境界を含まない ERE (core)。実際の検索には phone_match_regex で前後が数字でない
# 境界を付け、マスクには core をそのまま使う。
# 汎用パターンの区切りはハイフン・空白・括弧の 0〜1 文字に絞る (ドットを許すと SVG のパスデータや
# バージョン番号のような数値列にまで当たるため、区切りにドットは含めない。これ以上広げると
# ID・タイムスタンプ・連番との誤検出が増える)。
# 国番号 (intl-81) は「先頭に + がある」か「81 の直後に区切りがある」もののみを電話番号らしき表記と
# みなす。区切りなしの 81 始まりの数字列まで拾うと、ハッシュ・hex・CRC テーブル・packed-refs の中の
# 「81 + 数字 9〜10 桁」に大量に当たるため。
PHONE_GENERIC_SEPARATOR_CHARS='[- ()]'
PHONE_GENERIC_SEPARATOR_ERE="${PHONE_GENERIC_SEPARATOR_CHARS}{0,1}"
PHONE_GENERIC_PATTERNS=(
  "mobile|||0[5789]0${PHONE_GENERIC_SEPARATOR_ERE}[0-9]{4}${PHONE_GENERIC_SEPARATOR_ERE}[0-9]{4}"
  "intl-81|||(\\+81${PHONE_GENERIC_SEPARATOR_ERE}|81${PHONE_GENERIC_SEPARATOR_CHARS})[1-9](${PHONE_GENERIC_SEPARATOR_ERE}[0-9]){8,9}"
)

# 区切りありの国内固定電話 (市外局番 1〜4 桁 + 市内局番 + 加入者番号 4 桁 = 合計 10 桁)。
# check-diff-for-phone-numbers.sh (差分点検) と daily-retrospective の triage-corrections.sh (外部送信前の除外)
# が使う。区切り無しの固定電話まで拾うと連番・ID との誤検出が多いため、区切りありに限る。
PHONE_LANDLINE_SEPARATED_PATTERN='landline|||0([0-9][- ][0-9]{4}|[0-9]{2}[- ][0-9]{3}|[0-9]{3}[- ][0-9]{2}|[0-9]{4}[- ][0-9])[- ][0-9]{4}'

phone_numbers_from_env() {
  printf '%s' "${PHONE_NUMBER_CHECK_NUMBERS-}" | tr ',' '\n' | tr ' \t' '\n\n' | grep -v '^$' || true
}

phone_normalize_number() {
  local raw="$1" digits rest
  digits="$(printf '%s' "$raw" | tr -cd '0-9')"
  case "$digits" in
    81*)
      rest="${digits#81}"
      rest="${rest#0}"
      digits="0${rest}"
      ;;
  esac
  if [ "${#digits}" -lt 9 ]; then
    return 1
  fi
  printf '%s' "$digits"
}

phone_core_regex() {
  local normalized="$1" head rest re i c
  if [ "${normalized#0}" != "$normalized" ]; then
    head='(\+?81'"$PHONE_SEPARATOR_ERE"'\(?0?\)?|0)'
    rest="${normalized#0}"
  else
    head="${normalized:0:1}"
    rest="${normalized:1}"
  fi
  re="$head"
  i=0
  while [ "$i" -lt "${#rest}" ]; do
    c="${rest:$i:1}"
    re="${re}${PHONE_SEPARATOR_ERE}${c}"
    i=$((i + 1))
  done
  printf '%s' "$re"
}

# 先頭境界は「数字と、直前が小数点になり得る . 」を除外する (178.08016705513 のような小数の
# 途中 (.080...) を携帯番号と誤検出しないため。行頭・記号・かな漢字の直後は許す)
phone_match_regex() {
  printf '%s' "(^|[^0-9.])$1([^0-9]|\$)"
}

phone_mask_text() {
  local core="$1" text="$2" masked
  masked="$(printf '%s' "$text" | sed -E "s/$core/[PHONE]/g")"
  if printf '%s' "$masked" | grep -qE "$core"; then
    printf '%s' '[電話番号を含む行 (マスクできないため非表示)]'
  else
    printf '%s' "$masked"
  fi
}
