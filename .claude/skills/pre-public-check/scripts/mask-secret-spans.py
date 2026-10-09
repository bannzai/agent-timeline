#!/usr/bin/env python3
"""標準入力の各行について、引数で渡した正規表現すべての一致範囲を原文の上で求め、重なりと隣接をまとめてから
[SECRET] に置き換えて標準出力へ書く。

パターンを 1 つずつ順に置換すると、あるパターンの一致が別のパターンの一致を分断し、後続の置換が末尾を消せずに
秘密値の一部が生のまま残る (実例: openai のトークンの内側に aws のアクセスキーの形が現れると、先に aws を
[SECRET] にした時点で openai のパターンがトークンの途中までしか一致せず、末尾が残る)。一致範囲を原文の上で
求めてから統合することでこれを断つ。

正規表現 (ERE) の SSOT は scan-text-for-secrets.sh の PATTERNS で、このスクリプトは引数で受け取るだけ。
行ごとに処理し、入力の行数と各行の改行の有無を変えない (呼び出し側が窓の行数で行を対応づけるため)。
冪等: 読み取り専用。同じ入力からは同じ出力になる。

Usage: mask-secret-spans.py <ERE> [<ERE>...]  (本文は標準入力、結果は標準出力)
Exit: 0=成功 2=引数エラー・正規表現が不正
"""

import re
import sys

# 伏せ字の印。jev-check の check-rules-parallel.sh が送信本文の点検に、各 skill のテストが期待値の照合に
# この文字列を使うため、変えると呼び出し側と食い違う
MASK = "[SECRET]"


def mask_line(line, patterns):
    """line の秘密値を伏せた文字列を返す。一致範囲は原文の上で求めるため、重なるパターンでも末尾が残らない。"""
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
        print("Error: 正規表現を 1 つ以上渡す", file=sys.stderr)
        return 2
    patterns = []
    for source in argv:
        try:
            patterns.append(re.compile(source))
        except re.error as err:
            print(f"Error: 正規表現として読めない: {source} ({err})", file=sys.stderr)
            return 2
    for line in sys.stdin:
        if line.endswith("\n"):
            sys.stdout.write(mask_line(line[:-1], patterns) + "\n")
        else:
            sys.stdout.write(mask_line(line, patterns))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
