#!/usr/bin/env python3
"""標準入力の各行から、引数で渡した正規表現 (core) の一致範囲を検出と同じ数字境界つきで求め、
重なりと隣接をまとめてから [PHONE] に置き換えて標準出力へ書く。

検出 (check-diff-for-phone-numbers.sh) は phone_match_regex の境界 (直前が数字と小数点でない・直後が
数字でない) つきで一致を探すのに、伏せ字が境界無しの core で置換すると、検出では除外される小数や長い
数値 ID の途中まで [PHONE] になる (実例: `const ratio = 178.08016705513;` は検出 0 件なのに
`const ratio = 178.[PHONE];` になっていた)。外部 API へ渡す判定材料が壊れ、検出行が無いので周辺文脈の
判定も走らない。境界を検出と揃え、一致した core の範囲だけを置き換える。

境界の定義と core (ERE) の SSOT は phone-number-pattern.sh で、このスクリプトは core を引数で受け取り、
`(^|[^0-9.])` と `([^0-9]|$)` に対応する先読み・後読みを自分で付ける (ERE には後読みが無く、sed では
core の内側の丸括弧のせいで後方参照の番号が定まらないため、境界つきの置換をここで行う)。
行ごとに処理し、入力の行数と各行の改行の有無を変えない。
冪等: 読み取り専用。同じ入力からは同じ出力になる。

Usage: mask-phone-spans.py <core ERE> [<core ERE>...]  (本文は標準入力、結果は標準出力)
Exit: 0=成功 2=引数エラー・正規表現が不正
"""

import re
import sys

# 伏せ字の印。check-diff-for-phone-numbers.sh の残存チェックと jev-check の送信本文の点検が
# この文字列を前提にするため、変えると呼び出し側と食い違う
MASK = "[PHONE]"
# phone_match_regex の境界に対応する先読み・後読み (行頭・行末でも成立する)
BOUNDARY_BEFORE = r"(?<![0-9.])"
BOUNDARY_AFTER = r"(?![0-9])"


def mask_line(line, patterns):
    """line の電話番号らしき文字列を伏せた文字列を返す。境界は検出と同じなので、小数や長い数値 ID は残る。"""
    spans = []
    for pattern in patterns:
        for m in pattern.finditer(line):
            if m.end() > m.start():
                spans.append((m.start(), m.end()))
    if not spans:
        return line
    spans.sort()
    out = []
    copied = 0
    start, end = spans[0]
    for s, e in spans[1:]:
        if s <= end:  # 重なり・隣接はひとつの範囲にまとめる
            end = max(end, e)
            continue
        out.append(line[copied:start])
        out.append(MASK)
        copied = end
        start, end = s, e
    out.append(line[copied:start])
    out.append(MASK)
    out.append(line[end:])
    return "".join(out)


def main(argv):
    if not argv:
        print("Error: core の正規表現を 1 つ以上渡す", file=sys.stderr)
        return 2
    patterns = []
    for core in argv:
        try:
            patterns.append(re.compile(f"{BOUNDARY_BEFORE}(?:{core}){BOUNDARY_AFTER}"))
        except re.error as err:
            print(f"Error: 正規表現として読めない: {core} ({err})", file=sys.stderr)
            return 2
    for line in sys.stdin:
        if line.endswith("\n"):
            sys.stdout.write(mask_line(line[:-1], patterns) + "\n")
        else:
            sys.stdout.write(mask_line(line, patterns))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
