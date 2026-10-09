#!/usr/bin/env bash
# install-gh.sh - Claude Code のクラウドセッション (CLAUDE_CODE_REMOTE=true) で gh を入れ直し、PATH を CLAUDE_ENV_FILE に書く
#
# 配布先: <リポジトリ>/.claude/scripts/install-gh.sh。同じく配布する .claude/settings.json の SessionStart hook が呼ぶ
# (castle 側の実体は distribution/claude/。起票元: https://github.com/bannzai/castle/issues/1544 )。
#
# やること:
#   1. CLAUDE_CODE_REMOTE が "true" でなければ何もせず exit 0 (ローカルでは挙動を変えない)
#   2. 入れる版を決める: GH_INSTALL_VERSION (例 2.102.0) があればその版。無ければ
#      $GH_INSTALL_RELEASES_URL/latest のリダイレクト先 (.../tag/v<版>) から最新版を読み、それが通らなければ
#      $GH_INSTALL_GOPROXY_URL/github.com/cli/cli/v2/@latest の Version から読む
#      (api.github.com の releases API は使わない。クラウドの GitHub proxy は attach していないリポジトリ (cli/cli) への
#      要求を github.com・api.github.com とも 403 にする。実測: spikes/cloud-session-1544/RESULT.md)
#   3. $GH_INSTALL_DIR/gh が既にその版なら download しない (冪等)
#   4. $GH_INSTALL_RELEASES_URL/download/v<版>/gh_<版>_<os>_<arch>.tar.gz と gh_<版>_checksums.txt を取り、
#      sha256 を突き合わせてから bin/gh を $GH_INSTALL_DIR/gh に置く。download が通らず go があれば、
#      `go install github.com/cli/cli/v2/cmd/gh@v<版>` (GOBIN=$GH_INSTALL_DIR) でビルドして置く
#      (proxy.golang.org と sum.golang.org はクラウドの既定の許可ドメイン)
#   5. CLAUDE_ENV_FILE があれば `export PATH="$GH_INSTALL_DIR:$PATH"` を追記する (以降の Bash ツールの PATH に効く)
#      (既に同じ行があれば追記しない)
#
# 環境変数 (テストで差し替える):
#   GH_INSTALL_VERSION       入れる版 (v 無し)。未指定なら最新版
#   GH_INSTALL_DIR           置き場 (既定 $HOME/.local/bin)
#   GH_INSTALL_RELEASES_URL  release の URL の根 (既定 https://github.com/cli/cli/releases)。file:// も可 (その時は latest の解決をしない)
#   GH_INSTALL_GOPROXY_URL   Go module proxy の URL の根 (既定 https://proxy.golang.org)。最新版の解決の代替に使う
#   GH_INSTALL_OS / GH_INSTALL_ARCH  tarball 名の OS・CPU (既定は uname から linux と amd64 / arm64)
#
# 出力: stdout に 1 行 (SessionStart hook の stdout は会話のコンテキストに入るため短くする)。go でビルドした時は
#   行末に "(built with go)" を付ける。詳細は stderr
# exit code: 0 (何もしない / 入れ直した / 既に目的の版)。失敗は 1 (settings.json の hook は失敗しても
#   セッションの開始を止めない。SessionStart hook の exit 1 は非ブロッキング)
# 冪等性: 同じ版が入っていれば download も上書きもしない。CLAUDE_ENV_FILE への追記は同じ行が無い時だけ
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# 既定を $HOME/.local/bin にするのは、VM のユーザー (root) が sudo 無しで書け、/usr/local/bin の同梱の gh を壊さず、
# PATH の前に足すだけで差し替えられるため
GH_INSTALL_DIR="${GH_INSTALL_DIR:-$HOME/.local/bin}"
GH_INSTALL_RELEASES_URL="${GH_INSTALL_RELEASES_URL:-https://github.com/cli/cli/releases}"
GH_INSTALL_GOPROXY_URL="${GH_INSTALL_GOPROXY_URL:-https://proxy.golang.org}"

# 失敗の理由を stderr に出して exit 1 で終える
fail() {
  echo "install-gh: $*" >&2
  exit 1
}

for cmd in curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd がありません"
done

# ファイルの sha256 (16 進) を出す。Linux は sha256sum、macOS (テスト) は shasum
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "sha256sum も shasum もありません"
fi

os="${GH_INSTALL_OS:-}"
if [ -z "$os" ]; then
  case "$(uname -s)" in
    Linux) os=linux ;;
    *) fail "対応していない OS です: $(uname -s) (GH_INSTALL_OS で指定できます)" ;;
  esac
fi
arch="${GH_INSTALL_ARCH:-}"
if [ -z "$arch" ]; then
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "対応していない CPU です: $(uname -m) (GH_INSTALL_ARCH で指定できます)" ;;
  esac
fi

version="${GH_INSTALL_VERSION:-}"
if [ -z "$version" ]; then
  # /releases/latest は /releases/tag/v<版> へリダイレクトされる。最終 URL の末尾が版
  if final_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "$GH_INSTALL_RELEASES_URL/latest" 2>/dev/null)"; then
    version="${final_url##*/}"
    version="${version#v}"
  else
    echo "install-gh: $GH_INSTALL_RELEASES_URL/latest が読めないため Go module proxy で最新版を解決します" >&2
    # @latest は {"Version":"v2.102.0",...} を返す (jq に依存しないよう sed で読む)
    version="$(curl -fsSL "$GH_INSTALL_GOPROXY_URL/github.com/cli/cli/v2/@latest" 2>/dev/null | sed -n 's/.*"Version":"v\([0-9][0-9.]*\)".*/\1/p' | head -n 1)"
    [ -n "$version" ] || fail "最新版を解決できません: $GH_INSTALL_RELEASES_URL/latest と $GH_INSTALL_GOPROXY_URL/github.com/cli/cli/v2/@latest"
  fi
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "最新版の版を読めません: $version"
fi

installed_version=""
if [ -x "$GH_INSTALL_DIR/gh" ]; then
  # 壊れた・別 OS のバイナリで --version が失敗した時は空にして入れ直す
  installed_version="$({ "$GH_INSTALL_DIR/gh" --version 2>/dev/null || true; } | sed -n 's/^gh version \([0-9][0-9.]*\).*/\1/p' | head -n 1)"
fi

# 以降の Bash ツールで $GH_INSTALL_DIR/gh が /usr/local/bin/gh より先に見つかるようにする
persist_path() {
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    local line
    line="export PATH=\"$GH_INSTALL_DIR:\$PATH\""
    if ! { [ -f "$CLAUDE_ENV_FILE" ] && grep -qxF "$line" "$CLAUDE_ENV_FILE"; }; then
      printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
    fi
  fi
}

if [ "$installed_version" = "$version" ]; then
  persist_path
  echo "install-gh: already gh $version at $GH_INSTALL_DIR/gh"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$GH_INSTALL_DIR"

asset="gh_${version}_${os}_${arch}.tar.gz"
base="$GH_INSTALL_RELEASES_URL/download/v${version}"
how=""
if curl -fsSL -o "$work/$asset" "$base/$asset" 2>/dev/null; then
  curl -fsSL -o "$work/checksums.txt" "$base/gh_${version}_checksums.txt" || fail "download できません: $base/gh_${version}_checksums.txt"
  expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$work/checksums.txt")"
  [ -n "$expected" ] || fail "checksums.txt に $asset がありません"
  actual="$(sha256_of "$work/$asset")"
  [ "$actual" = "$expected" ] || fail "sha256 が一致しません ($asset): expected=$expected actual=$actual"

  tar -xzf "$work/$asset" -C "$work" || fail "展開できません: $asset"
  extracted="$work/gh_${version}_${os}_${arch}/bin/gh"
  [ -f "$extracted" ] || fail "tarball に bin/gh がありません: $asset"
  install -m 0755 "$extracted" "$GH_INSTALL_DIR/gh" || fail "配置できません: $GH_INSTALL_DIR/gh"
elif command -v go >/dev/null 2>&1; then
  # release の download が通らない環境 (クラウドの GitHub proxy は attach していないリポジトリを 403 にする) では
  # Go module proxy からソースを取ってビルドする。sum.golang.org の検証は既定のまま (GOSUMDB は変えない)
  echo "install-gh: $base/$asset が取れないため go install でビルドします" >&2
  GOBIN="$GH_INSTALL_DIR" go install "github.com/cli/cli/v2/cmd/gh@v${version}" >&2 || fail "go install に失敗しました: github.com/cli/cli/v2/cmd/gh@v${version}"
  [ -x "$GH_INSTALL_DIR/gh" ] || fail "go install の後に $GH_INSTALL_DIR/gh がありません"
  how=" (built with go)"
else
  fail "download できず go もありません: $base/$asset"
fi
persist_path

if [ -n "$installed_version" ]; then
  echo "install-gh: replaced gh $installed_version with $version at $GH_INSTALL_DIR/gh$how"
else
  echo "install-gh: installed gh $version at $GH_INSTALL_DIR/gh$how"
fi
