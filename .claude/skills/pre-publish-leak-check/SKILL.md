---
name: pre-publish-leak-check
description: |
  commit・push・PR 作成の前に、これから公開する差分 (コミットごとの patch)・コミットメッセージ・PR body に
  API キー・トークン・パスワード・秘密鍵・環境変数の実値・個人情報・内部 URL が無いかを、正規表現と Jev の機械点検と
  新しいコンテキストの LLM (claude -p) の点検の 2 層で確かめるスキル。commit / commit-create-pr skill の手順から呼ぶ。
  「push の前に機密情報が漏れていないか確認して」「PR を出す前に秘匿情報を点検して」のような依頼で使用する。
  使用例: "check-leaks.sh --base origin/main --pr-body ./tmp/pr-body.md"
allowed-tools:
  - Read
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/check-leaks.sh:*)
  - Bash(bash ~/.agents/skills/pre-publish-leak-check/scripts/check-leaks.sh:*)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/review-leaks.sh:*)
  - Bash(bash ~/.agents/skills/pre-publish-leak-check/scripts/review-leaks.sh:*)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/test/test-check-leaks.sh:*)
  - Bash(bash ~/.agents/skills/pre-publish-leak-check/scripts/test/test-check-leaks.sh:*)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/test/test-review-leaks.sh:*)
  - Bash(bash ~/.agents/skills/pre-publish-leak-check/scripts/test/test-review-leaks.sh:*)
disable-model-invocation: true
---

# pre-publish-leak-check

公開リポジトリへ push・PR 作成する前に、これから公開する内容に「漏らしてはいけない情報」が無いかを 2 層で点検する。何が漏れに当たり、何が当たらないか (境界) の定義は `assets/review-prompt.md` が SSOT。2 層にした理由・fail-open と fail-closed の分け方・採らなかった案は [ADR 0076](~/.claude/documents/adr/0076-two-layer-pre-publish-leak-gate-with-jev-and-fresh-context-llm.md)。

- 機械点検 `scripts/check-leaks.sh`: 電話番号 (github-repos-phone-number-check skill)・secret (pre-public-check skill) の正規表現と、Jev (jev-check skill の規約と personal-info) を呼ぶ。Jev だけは使えない時に省く (fail-open)
- LLM 点検 `scripts/review-leaks.sh`: 差分を書いたセッションとは別の新しいコンテキストの `claude -p` に読ませる。点検できなかった時は push・PR 作成に進ませない (fail-closed)
- 対象は両方とも同じ: commit の前はステージ済みの差分とコミットメッセージ、push・PR 作成の前は未送信の各コミットの patch (net diff ではなくコミットごと)・各コミットメッセージ・PR body
- 例外として、LLM 点検は生成物 (lockfile と、`.gitattributes` で `linguist-generated` を付けたファイル) の patch を送らずパスだけを載せる (機械点検は通る。理由は review-leaks.sh のヘッダー「対象」)
- 例外として、Jev の差分の点検だけは commit 前に全部判定できた差分をローカルに記録し、push 前はその差分を Jev に送り直さない (記録の置き場所・照らし方・記録しない場合は check-leaks.sh のヘッダー「commit 前に Jev が点検した差分の記録」、決定は [ADR 0078](~/.claude/documents/adr/0078-bundle-jev-rule-questions-per-window-and-skip-rechecking-committed-diffs.md))

## 前提

- git・jq・python3 (Jev に送る前の伏せ字で jev-check skill の check-rules-parallel.sh が使う)
- Jev の層: 環境変数 `TYPESAFE_API_KEY`。無ければ Jev の層だけが省かれる
- LLM の層: ログインした `claude` CLI (OAuth で動く)。Codex で commit 系 skill を実行する時も review-leaks.sh は claude を呼ぶ (秘匿情報の点検は Claude: `~/.claude/documents/rules/codex-task-assignment.md` 判定フロー 2)
- 外部送信: Jev (TypeSafe) には電話番号と secret を伏せた差分・コミットメッセージ・PR body を送る (範囲は ADR 0073 と ADR 0076)。LLM (Anthropic) には差分・コミットメッセージ・PR body をそのまま送る

## ファイル構成

各スクリプトのオプション・対象・出力・exit code はヘッダーコメントが SSOT で、`--help` で表示できる。

- `scripts/check-leaks.sh` — 機械点検。検出を 1 行 1 件 (`<種別>: <位置>: <伏せた抜粋>`) で出す
- `scripts/review-leaks.sh` — LLM 点検。`claude -p` の起動方法とその理由・出力の伏せ字・実行ログ (`<リポジトリルート>/tmp/pre-publish-leak-check/<日時>-<pid>.json`) はヘッダーコメント
- `assets/review-prompt.md` — review-leaks.sh が system prompt として渡す点検の指示。「漏らしてはいけない情報」と境界の定義の SSOT (commit / commit-create-pr skill と `~/.claude/rules/no-personal-info-in-repositories.md` が参照する)
- `assets/findings.schema.json` — review-leaks.sh が `--json-schema` で渡す findings の形
- `scripts/test/test-check-leaks.sh` — jev-ask のスタブと一時 git リポジトリで check-leaks.sh を検証する (ネットワーク不要)
- `scripts/test/test-review-leaks.sh` — claude のスタブと一時 git リポジトリで review-leaks.sh を検証する (ネットワーク不要)

## ワークフロー

### Phase 1: commit の前

git のグローバル hook (`~/.claude/hooks/git/castle-git-hook`) の commit-msg が、commit のたびに下の `--staged` をコミットされる差分とメッセージで実行する (merge コミットも同じ。検出時に止めることと確認済みの値 `CASTLE_LEAK_CHECK_ACK` で進める方法は同スクリプトのヘッダー)。hook が全部判定した差分も記録されるため、Phase 2 で Jev の差分の点検が省かれる。手で実行するのは、hook が検査しないリポジトリ (条件は `~/.claude/rules/no-personal-info-in-repositories.md`) だけにする。

手で実行する時は、コミットメッセージをファイル (`./tmp/commit-message.txt` 等) に書いてから点検し、同じファイルで `git commit -F` する (点検したメッセージと commit するメッセージを揃えるため)。点検の後にステージを変えたら点検し直す (点検した差分と commit する差分が揃っている時だけ、Phase 2 で Jev の差分の点検が省かれる)。

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/check-leaks.sh --staged --message-file ./tmp/commit-message.txt
```

例外: merge コミット (公開済みブランチの取り込み) を手で点検する時は `--staged` を使わない (hook は merge コミットでも `--staged` を実行し、取り込んだ公開済みの内容だけの検出で止まった時は、目視で公開済みの内容と確かめてから確認済みの値で進める)。merge 中のステージ済み差分は HEAD 比のため取り込んだ公開済み変更を全部含み、電話番号・secret の正規表現の検査がその公開済みの内容まで検出する (Jev にはどちらの親にも無い行だけを送る。範囲の決め方は `scripts/check-leaks.sh` のヘッダー)。競合解消ファイルの目視と、コミット後の Phase 2 (`--base <取り込んだ公開済みブランチ>`) で点検する (手順の SSOT は `~/.claude/skills/fix-merge-conflicts/SKILL.md` Phase 4)。

### Phase 2: push・PR 作成の前

PR body (`/commit --comment` では投稿する PR コメントの本文) をファイルに書いてから、2 つを実行する。`<base>` は PR のベースブランチ。PR を作らず upstream へ push するだけなら `--base @{upstream}` (upstream が無ければ `--base origin/HEAD`) にし、`--pr-body` は省く。作業ブランチに公開済みのブランチ (origin/main 等) を merge で取り込んだ後は、指示・PR 設定上のベースが古いブランチでも `--base` は取り込んだ公開済みブランチにする。merge 前の派生元を指定すると、取り込んだ公開済みコミットまで点検範囲に入り review-leaks.sh がプロンプト上限超過 (exit 3) になる (実例: 2026-09-25、origin/main の merge 後に `--base origin/issue-510` で実行して公開済み 82 コミットが範囲に入り 1,584,130 バイト > 上限 800,000 バイトで exit 3。`--base origin/main` で clean)。

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/check-leaks.sh --base origin/<base> --pr-body ./tmp/pr-body.md
bash ${CLAUDE_SKILL_DIR}/scripts/review-leaks.sh --base origin/<base> --pr-body ./tmp/pr-body.md
```

- 2 つは独立しているので並べて実行してよい。review-leaks.sh は `claude -p` の 1 回分の待ち時間がかかる (実行ログの `duration_seconds`)
- check-leaks.sh の標準エラーに、Jev の差分の点検の範囲 (「Jev の差分の点検を省いた」「… コミットだけに行う」「差分全体を点検する」のどれか) と、点検した時は送ったリクエスト数 (`[jev 差分 …] requests=…`) が出る
- push と `gh pr create` の間で commit と PR body が変わらなければ、push 前の 1 回で両方の前の点検を満たす。PR body を書き直したら `gh pr create` の前にもう一度実行する

### Phase 3: 検出時の扱い

- check-leaks.sh の exit 1 の各行と、review-leaks.sh の exit 1 (`suspect`) の findings は、該当箇所を目視する起点にする。位置 (commit の hash とパス:行、`commit-message`、`pr-body`) の実物を読み、次のどちらかに分ける
  - 本物の疑いがある: 取り除いてから点検をやり直す。取り除けない・判断できない時は、伏せた抜粋 (出力の形のまま) を報告する。その後 commit・push・PR 作成に進むかは `~/.claude/rules/no-personal-info-in-repositories.md` と `~/.claude/CLAUDE.md`「自律性と確認の境界」に従う
  - プレースホルダ・ダミー値・境界に当たる (`assets/review-prompt.md`「漏れに当たらないもの」): 進めてよい。その判断を PR body に 1 行で書く (PR を作らない commit だけの時はコミットメッセージ、push 前の点検でだけ見つかった時は完了報告に書く)
- 途中のコミットで足して後のコミットで消した値 (check-leaks.sh が足したコミットの `<hash> <パス>:<行>` で出す) は、後のコミットで消しても履歴として公開される。取り除くには未送信のコミットの書き換え (rebase 等) が要るため、push の前に扱いを決める (書き換えの可否は `~/.claude/documents/rules/no-rebase-without-explicit-permission.md`)
- check-leaks.sh の `jev(<規約 id>)` のうち、personal-info (`personal-address` / `personal-email` / `personal-name` / `phone-number-in-context`) 以外は漏れではなく規約違反の候補。扱いは呼び出し元の commit 系 skill (直すか、直さない理由を書く) と jev-check skill (`~/.claude/skills/jev-check/SKILL.md`) Phase 2 に従う
- review-leaks.sh の exit 3 は、LLM の点検ができていない状態。push・PR 作成に進まず、標準エラーの理由と実行ログのパスを報告する (fail-closed にした理由は ADR 0076)
- 検出が無いこと (exit 0) を、差分・メッセージ・PR body を自分で読む確認を省く根拠にしない (Jev と LLM の「無い」は「ある」より弱い。ADR 0065)

## エラーハンドリング

- exit 2 (両スクリプト共通): 引数の組み合わせ (`--staged` には `--message-file` が必須、`--pr-body` は `--base` とだけ併用)、commit に解決できない ref、git リポジトリの外、読めないファイル。メッセージの示す原因を直して再実行する
- check-leaks.sh の標準エラーに「Jev が使えないため規約チェックを省略した」「Jev (…) が使えないため省略した」: Jev の層を省いた (fail-open)。`TYPESAFE_API_KEY` を確認し、他の検出と目視で進める
- review-leaks.sh の exit 3:
  - 「プロンプトが上限を超えた」: まず `--base` が公開済みコミットを範囲に含めていないかを確認する (Phase 2 の `--base` の選び方。公開済みブランチの merge 後に古い派生元を指定すると起きる)。範囲が正しいのに超える時は、スクリプトが生成した大きなファイル (データ・コード生成の出力) が範囲にあれば、`.gitattributes` に `linguist-generated` を付ける commit を足して patch を省く。それ以外は、一度に push するコミットを分けて範囲を小さくするか、ユーザーに判断を仰ぐ (上限は `LEAK_REVIEW_MAX_PROMPT_BYTES`。位置引数の上限 ARG_MAX に収めるための値で、上げすぎると claude を起動できない)
  - 「claude -p が exit N で終了した」「claude -p がエラーを返した」: 標準エラーの subtype と result (ログイン切れ・レート制限・モデル名の誤り等) を見て直してから再実行する
  - 「structured_output が無いか、形が…と違う」「JSON として読めない」: 再実行する。続く時は実行ログのパスを添えて報告する

## 検証方法

1. `bash ${CLAUDE_SKILL_DIR}/scripts/test/test-check-leaks.sh` を実行し、`--base` で途中のコミットで足して後のコミットで消した secret を足したコミットの位置で検出すること、コミットメッセージの電話番号・secret と PR body の個人情報の候補 (Jev) を位置つきで出すこと、personal-info.json の 4 本が `--file` モードで 1 リクエストに束ねられ否定側の問いつき・伏せ字済みで送られること、merge commit はメッセージだけを見ること、Jev の規約違反の候補と送信本文の電話番号 (`jev-phone`) を出すこと、Jev が使えない時の fail-open、生の番号・トークンを出さないこと、冪等性、exit code (0 / 1 / 2)、commit 前に点検した差分の記録 (`--staged` で全部判定できた時だけ記録し、commit → `--base` の 1 サイクルで差分のリクエストが 0 件になる、fail-open・一部が未判定の時は記録せずそのコミットだけを `--commit` で点検する、点検の後に空白だけを変えた差分は記録と一致しない、記録のあるコミットが無い範囲は差分全体を 1 回点検する、手で足した行の無い merge commit は点検しない)、merge の取り込み分を Jev に送らないこと (merge の途中の `--staged` と記録の無い merge commit の `--base` は競合の解消で足した行だけを渡し、そういう行が無ければ Jev を呼ばない、`--base` は記録の無い merge commit があっても差分全体に戻らない、merge 以外のコミットの扱いは変わらない、未解決の競合が残る時は差分全体に戻る、取り込んだ側の電話番号・secret は正規表現で検出する) がすべて PASS になることを確認する
2. `bash ${CLAUDE_SKILL_DIR}/scripts/test/test-review-leaks.sh` を実行し、clean / suspect / モデルが clean でも leak がある / 壊れた JSON / 起動失敗 / is_error / structured_output の欠落・形の誤り / 上限を超えたプロンプト → exit 0 / 1 / 1 / 3 / 3 / 3 / 3 / 3、プロンプトに全コミットのメッセージと patch と PR body が入ること (lockfile・linguist-generated のファイル・merge commit の patch は省く)、claude を呼ぶ前の exit 3 でも実行ログを書くこと、`claude -p` に渡す引数 (`-p` の直後のプロンプト、`--tools ""`、`--safe-mode`、`--no-session-persistence`、`--system-prompt-file`、`--json-schema`、`--permission-mode` を付けない) と `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`、stdin が /dev/null であること、excerpt と location の伏せ字、実行ログの内容 (生値と本文を含まない)、exit 2 がすべて PASS になることを確認する
3. 実際のブランチで `bash ${CLAUDE_SKILL_DIR}/scripts/check-leaks.sh --base origin/main` を実行し、標準エラーの要約 (点検したコミット数) と、検出があればその位置の実物を確認する
4. 実際のブランチで `bash ${CLAUDE_SKILL_DIR}/scripts/review-leaks.sh --base origin/main` を 1 回実行し (実 claude を呼ぶため費用がかかる)、verdict と実行ログの `duration_seconds`・`prompt_bytes`・`cost_usd` を確認する
5. `bash ~/.agents/skills/bannzai-skill-creator/scripts/validate-skill.sh ${CLAUDE_SKILL_DIR}` を実行し、総合評価 A になることを確認する
