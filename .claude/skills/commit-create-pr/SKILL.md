---
name: commit-create-pr
description: 今回の変更点を step-by-step でコミット → git push → gh pr create までを実行し、オープン状態の PR を新規作成する。引数 $ARGUMENTS でベースブランチを指定可能、空の場合は現在のブランチ状況に応じて新規ブランチを作る。ユーザーが新規 PR 作成までを依頼した時に使う。
---

ADR に残すべき意思決定が含まれるかを write-adr skill（~/.claude/skills/write-adr/SKILL.md）の「ADRを書くべき判断基準」で判断し、該当すればコミット前に /write-adr を実行する。基準外の作業記録・動作確認結果は PR 側に書く。

コミット・push・PR 操作の前に、公開する差分・コミットメッセージ・PR body に「漏らしてはいけない情報」が無いかを pre-publish-leak-check skill (`~/.claude/skills/pre-publish-leak-check/SKILL.md`。定義の SSOT は `assets/review-prompt.md`) で点検する。

- コミットの前: 点検は git のグローバル hook の commit-msg が行う。hook が検査しないリポジトリだけ、メッセージをファイルに書いて `bash ~/.claude/skills/pre-publish-leak-check/scripts/check-leaks.sh --staged --message-file <そのファイル>` を実行し、同じファイルで `git commit -F <そのファイル>` する (条件と hook に止められた時の扱いは `~/.claude/rules/no-personal-info-in-repositories.md`)
- push の前と `gh pr create` の前: PR body をファイルに書き、`bash ~/.claude/skills/pre-publish-leak-check/scripts/check-leaks.sh --base origin/<ベースブランチ> --pr-body <body ファイル>` と `bash ~/.claude/skills/pre-publish-leak-check/scripts/review-leaks.sh --base origin/<ベースブランチ> --pr-body <body ファイル>` を実行する（commit と body が変わらなければ push 前の 1 回でよい）
- 検出時の扱い（`review-leaks.sh` の exit 3 では push・PR 作成に進まない）は同 SKILL.md「Phase 3: 検出時の扱い」に従う。`jev(<規約 id>)` の候補は、実物と `~/.claude/rules/<規約>` で確認して直すか、直さない理由を PR body に書く（jev-check skill Phase 2）

QA.md（setup-qa）管理下のプロジェクトでは、push・PR 作成・PR コメント投稿の前に、実施済みの動作確認を run-qa skill で QA.md へ記録する（SSOT: `~/.claude/documents/rules/record-qa-before-commit.md`）。

Pull Request を新規作成する。

- やったことを step-by-step でコミットし、git push して、draft ではなくオープンの状態で `gh pr create` する。PR body にはやったことの詳細を書き、PR template（`.github/pull_request_template.md` 等）があれば使う
- commit・PR の body に claude が author であることは書かない
- `git add` と `git commit` は `&&` で繋がず別のコマンドで実行する
- このタスクの完了後は、指示がある時にだけ commit・push・gh pr create・gh pr comment をする
- ベースブランチは `$ARGUMENTS`（指定のブランチにいる場合も新しいブランチを作る）。空なら次で決める:
  1. 現在のブランチがデフォルトブランチなら、新しいブランチを作る
  2. `gh pr view --json state -q '.state'` が `OPEN` の時だけ「既存 PR あり」とする（CLOSED / MERGED / 未作成は「なし」）
  3. 既存 PR が無ければ、デフォルトブランチをベースにする
  4. 既存 PR があれば、その更新で済ませない。現在のブランチ名を記録して新しいブランチを作り、記録したブランチをベースに新規 PR を作る
- PR body に `## 人間が確認` セクションを入れる（「セッション再開」の直前。owner を問わない）。CI が検出する固定名で変えない（~/.claude/documents/adr/0031-human-verification-checklist-in-pr-body.md）
  - 項目にするのは人間にしかできない必須の操作だけ: Web UI でしか行えない操作（RevenueCat・App Store Connect・Google Play Console 等）、agent に権限が無い認証・登録、課金など後から直すと実害が大きい変更
  - 候補ごとに agent が自分のツール（コマンド・シミュレータ・デバッグメニュー・API 等）で確認・実行できるか自問し、できるものはその場で実行して結果を本文に書く。大半の PR は「なし」になり、それが正常。判別に迷う候補は jev-check skill の `check-human-verification.sh` で確かめられる
  - 次は項目にしない: 任意・条件付き（「(任意)」「必要なら」「〜する場合は」）／文言・ビジュアル・デフォルト値などの好みの承認／本番環境・実機でしか確認できない動作確認／実施済み・過去データで代替済みの検証の再実行依頼
  - 任意のフォローアップ、確認できた範囲と未検証の範囲、ブロックされた検証（何にブロックされたか・残りの手順）は本文に書き、実施の要否は会話でユーザーに仰ぐ
  - やむを得ずユーザーの操作が必要な場合は会話で依頼する。会話で依頼できない無人実行（auto-implement-issue Phase 4 の手順 6）と、skill が手順として定めている場合は、マージの前に済ませる必要がある操作に限り項目にする
  - 項目が無ければチェックボックスを置かず「なし」とだけ書く。チェックを入れるのは人間で、agent は全項目を未チェックで作成し `- [x]` にしない
  - 既存 PR の項目を扱う時も同じ: agent が検証できる項目は検証して結果を本文に記録し、body の編集で項目を消す
- owner が `bannzai` の場合（`gh repo view --json owner --jq '.owner.login'`）、PR 作成前に次を確認し、不足は今回のブランチの変更に含める。bannzai 以外のリポジトリでは PR template・workflow に手を付けない
  - PR template に `## 人間が確認` セクションが無ければ追記する
  - `.github/workflows/human-verification-check.yml` が無ければ、`~/.claude/skills/commit-create-pr/assets/human-verification-check.yml` をそのままコピーして追加する。required check 化は本 skill では変更しない
- PR body の末尾に、この PR を作成したセッションを再開するコマンドを記載する（`<...>` は実値に置換。Codex では `claude --resume` の行を `codex resume <セッションID>` にする）:

  ````markdown
  ## セッション再開

  ```sh
  cd <作業ディレクトリの絶対パス>
  claude --resume <セッションID>
  ```
  ````

  - セッション ID: Claude Code は環境変数 `CLAUDE_CODE_SESSION_ID`。Codex は環境変数が無いため、`payload.cwd` が現在の作業ディレクトリと一致する最新の rollout から取る:

    ```sh
    ls -t ~/.codex/sessions/*/*/*/rollout-*.jsonl | while read -r f; do
      sid=$(head -1 "$f" | jq -r --arg cwd "$PWD" 'select(.payload.cwd == $cwd) | .payload.session_id')
      [ -n "$sid" ] && { echo "$sid"; break; }
    done
    ```

  - 取得できない場合: Codex は `codex resume --last` を記載し、Claude Code はセクション自体を省略する（省略した旨は書かない）
- モバイルアプリ・Web・ゲーム (Godot 等) の画面に影響する変更では、動作確認スクリーンショット（画面録画があれば最終フレーム）を PR body に埋め込む。`gh pr create` の後に pr-attach-screenshots skill (`~/.claude/skills/pr-attach-screenshots/SKILL.md`) の `attach-screenshots.sh` で行い、`puts upload` を手で実行して Markdown を貼らない。撮影手段は `~/.claude/rules/ui-change-screenshot-verification.md` に従い、未実施ならユーザーに質問せず撮影まで済ませてから PR を作る。シミュレータ・ブラウザが用意できず検証できないと判断する時は、自分だけで決めず Fable に相談する（メインが Fable でなければ `model: fable` のサブエージェントに、試した手段と結果を渡す）。Fable も検証できないと判断した場合だけ、理由を添えて PR body に未検証と明記する
- PR を作った後、owner が bannzai のリポジトリでは `~/.claude/skills/auto-merge-pr/SKILL.md` の手順でスクリプトを実行する（auto-implement-issue 経由の PR は同 skill の Phase 6）。レビューが無く `NEXT=fix` になったら codex-code-review skill (`~/.claude/skills/codex-code-review/SKILL.md`) を実行してから再実行する

## 自動マージと未チェックのチェックリスト

PR body に未チェックのチェックリスト項目 (`- [ ]`。`## 人間が確認` 等) がある間はマージしない。チェックを入れるのは人間で、agent が `- [x]` に書き換えて通過させない。human-verification-check workflow が無いリポジトリでは `auto-merge-pr.sh` の検査だけが防御になる。

## 検証方法

1. `bash ~/.claude/skills/commit-create-pr/scripts/test/test-human-verification-check.sh` を実行し、全件 PASS を確認する
2. owner が bannzai のリポジトリで本 skill により PR を作成し、`## 人間が確認` セクションが入ることを確認する
3. 未チェック項目がある間は check が fail し、解消（チェックまたは「なし」）後に成功へ変わることを確認する
