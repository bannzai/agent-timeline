#!/usr/bin/env bash
# graphql.sh - gh シム (同じディレクトリの gh) の `gh api graphql` の翻訳。gh が source して graphql_main を呼ぶ
#
# 翻訳する query / mutation (castle の auto-merge-pr.sh・check-pr-review-arrival.sh・check-gates.sh・fetch-review-comments.sh・
# fix-pr-reviews skill が投げるもの):
#   query: repository(owner, name) { pullRequest(number) { <下の対応フィールド> } }
#     対応フィールド: state body headRefOid baseRefName isDraft mergeable viewerDidAuthor
#       labels { nodes { name } }  files { nodes { path } }
#       commits(last: N) { nodes { commit { oid messageHeadline status { context(name: "X") { description } } } } }
#       reviews { nodes { author { login } body state submittedAt } }  comments { nodes { author { login } body updatedAt } }
#       reviewThreads { pageInfo { hasNextPage endCursor } nodes { id isResolved isOutdated
#         comments { nodes { id url author { login } createdAt path line body outdated } } } }
#     応答は要求されたフィールドの上位集合 (対応フィールド全部) を GraphQL と同じ形 {"data":{"repository":{"pullRequest":{...}}}} で返す。
#     jq で必要なキーだけ読む呼び出し側には同じに見える
#   mutation: resolveReviewThread(input: {threadId: $id}) → POST pulls/{n}/ccr/comments/{comment_id}/resolve
#             addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) → POST pulls/{n}/comments/{comment_id}/replies
#
# reviewThreads の元データは proxy の GET repos/{owner}/{repo}/pulls/{n}/ccr/review_threads
# ([{resolved, outdated, path, line, comment_ids}]。全スレッドを 1 回で返し、ページ送りは無い。実測: spikes/cloud-session-1544/RESULT.md)
# と REST の pulls/{n}/comments を comment_ids で突き合わせたもの。スレッドの id は GraphQL の PRRT_ の代わりに
# "PRRT-ccr:<owner>/<repo>#<n>:<先頭コメントの REST id>" にする (mutation はこの形だけ受け付け、resolve の ccr 経路に
# 渡す comment_id と PR 番号をここから取る)。
#
# query の識別子 (変数名・文字列・数値を除いた語) が対応の集合からはみ出す時は翻訳せず、本物の gh に渡す (403 がそのまま返る)。

graphql_supported_words="query mutation repository pullRequest owner name number after first last state body headRefOid baseRefName viewerDidAuthor isDraft mergeable labels nodes files path commits commit oid messageHeadline status context description reviews author login submittedAt comments updatedAt createdAt url line outdated id reviewThreads pageInfo hasNextPage endCursor isResolved isOutdated String Int ID Boolean input threadId thread resolveReviewThread addPullRequestReviewThreadReply pullRequestReviewThreadId comment"

# query の識別子が対応の集合に収まるか
graphql_query_supported() {
  local word
  for word in $(printf '%s' "$1" | sed -E 's/"[^"]*"//g; s/\$[A-Za-z_][A-Za-z0-9_]*//g; s/[^A-Za-z_]+/ /g'); do
    case " $graphql_supported_words " in
      *" $word "*) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# reviewThreads の nodes (ccr/review_threads と REST の review comments の突き合わせ)
graphql_review_threads() {
  local repo="$1" number="$2" threads_f comments_f
  threads_f="$(rest "repos/$repo/pulls/$number/ccr/review_threads" | to_file)" || die "ccr/review_threads を取得できません"
  comments_f="$(rest_all "repos/$repo/pulls/$number/comments?per_page=100" | to_file)" || die "レビューコメントを取得できません"
  jq -n --slurpfile threads "$threads_f" --slurpfile comments "$comments_f" --arg repo "$repo" --arg number "$number" "$jq_login"'
    ($comments[0] | map({key: (.id | tostring), value: .}) | from_entries) as $byId
    | {
        pageInfo: {hasNextPage: false, endCursor: null},
        nodes: ($threads[0] | map(. as $t | {
          id: ("PRRT-ccr:" + $repo + "#" + $number + ":" + ($t.comment_ids[0] | tostring)),
          isResolved: $t.resolved, isOutdated: $t.outdated,
          comments: {nodes: ($t.comment_ids | map($byId[tostring]) | map(select(. != null)) | map({
            id: .node_id, url: .html_url, author: (.user | if . == null then null else {login: login} end), createdAt: .created_at,
            path, line, body: (.body // ""), outdated: $t.outdated
          }))}
        }))
      }'
}

# query を翻訳する: 対応フィールドの上位集合を組み立てて GraphQL の形で出す
graphql_query() {
  local query="$1" owner="$2" name="$3" number="$4"
  [ -n "$owner" ] && [ -n "$name" ] && [ -n "$number" ] || die "graphql: owner / name / number の変数が足りません"
  local repo="$owner/$name" pr_f
  pr_f="$(rest "repos/$repo/pulls/$number" | to_file)" || die "PR #$number を取得できません"
  local head_sha
  head_sha="$(jq -r '.head.sha' "$pr_f")"
  local status_context="" status_description=null
  if [[ "$query" =~ context\(name:[[:space:]]*\"([^\"]+)\"\) ]]; then
    status_context="${BASH_REMATCH[1]}"
    # combined status の statuses は 1 ページ 30 件のためページ送りで全件を繋ぐ
    local statuses_f
    statuses_f="$(rest_all "repos/$repo/commits/$head_sha/status?per_page=100" statuses | to_file)" || die "commit status を取得できません"
    status_description="$(jq --arg ctx "$status_context" '[.[] | select(.context == $ctx)] | if length > 0 then {description: .[0].description} else null end' "$statuses_f")"
  fi
  # 大きい応答 (files・comments・reviews) は一時ファイルに受けて --slurpfile で渡す (--argjson の引数長の上限を避ける)
  local empty_f files_f commits_f reviews_f comments_f threads_f
  empty_f="$(printf '[]' | to_file)"
  files_f="$empty_f" commits_f="$empty_f" reviews_f="$empty_f" comments_f="$empty_f"
  threads_f="$(printf '{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}' | to_file)"
  case "$query" in *files*) files_f="$(rest_all "repos/$repo/pulls/$number/files?per_page=100" | to_file)" || die "files を取得できません" ;; esac
  # commits(last: N) の N。無指定の時は GraphQL の 1 ページの上限と同じ 100 件
  local last_n=100
  if [[ "$query" =~ commits\(last:[[:space:]]*([0-9]+)\) ]]; then last_n="${BASH_REMATCH[1]}"; fi
  case "$query" in *commits*)
    commits_f="$(rest_all "repos/$repo/pulls/$number/commits?per_page=100" | to_file)" || die "commits を取得できません"
    if [ "$(jq 'length' "$commits_f")" -ge 250 ]; then
      # REST の pulls/{n}/commits は 250 件で切れる (古い側の 250 件)。commits(last: N) は新しい側の N 件なので、
      # head から辿る commits?sha=<head> で N 件を取り (新しい順)、古い順に並べ直す
      commits_f="$(rest "repos/$repo/commits?sha=$head_sha&per_page=$last_n" | jq 'reverse' | to_file)" || die "head から辿る commits を取得できません"
    elif [ "$(jq -r '.[-1].sha // ""' "$commits_f")" != "$head_sha" ]; then
      # 一覧の末尾が head でない時 (取得の遅延等) は head の commit を取って末尾に足す
      local head_f
      head_f="$(rest "repos/$repo/commits/$head_sha" | to_file)" || die "head の commit を取得できません"
      commits_f="$(jq -n --slurpfile commits "$commits_f" --slurpfile head "$head_f" '$commits[0] + [$head[0]]' | to_file)"
    fi ;; esac
  case "$query" in *reviews*) reviews_f="$(rest_all "repos/$repo/pulls/$number/reviews?per_page=100" | to_file)" || die "reviews を取得できません" ;; esac
  case "$query" in *" comments"*|*$'\n'*comments*) comments_f="$(rest_all "repos/$repo/issues/$number/comments?per_page=100" | to_file)" || die "comments を取得できません" ;; esac
  case "$query" in *reviewThreads*) threads_f="$(graphql_review_threads "$repo" "$number" | to_file)" || exit 1 ;; esac
  # 認証ユーザーの取得の失敗を exit 1 にする (jq の引数の $( ) では失敗が伝わらず viewerDidAuthor が false になる)
  local login
  login="$(viewer)" || exit 1
  jq -n --slurpfile pr "$pr_f" --arg viewer "$login" --argjson status "$status_description" --slurpfile files "$files_f" \
    --slurpfile commits "$commits_f" --slurpfile reviews "$reviews_f" --slurpfile comments "$comments_f" --slurpfile threads "$threads_f" \
    --argjson last "$last_n" "$jq_pr_base $jq_login"'
    def login_or_null: if . == null then null else {login: login} end;
    $pr[0] as $p
    | {data: {repository: {pullRequest: (($p | pr_base) | {
      state, body, headRefOid, baseRefName, isDraft, mergeable,
      viewerDidAuthor: ($p.user.login == $viewer),
      labels: {nodes: (.labels | map({name}))},
      files: {nodes: ($files[0] | map({path: .filename}))},
      commits: {nodes: ($commits[0] | .[-$last:] | to_entries | map(.value as $c | {commit: {
        oid: $c.sha, messageHeadline: ($c.commit.message | split("\n")[0]),
        status: (if $c.sha == $p.head.sha then (if $status == null then null else {context: $status} end) else null end)}}))},
      reviews: {nodes: ($reviews[0] | map({author: (.user | login_or_null), body: (.body // ""), state, submittedAt: .submitted_at}))},
      comments: {nodes: ($comments[0] | map({author: (.user | login_or_null), body: (.body // ""), updatedAt: .updated_at}))},
      reviewThreads: $threads[0]
    })}}}'
}

# 本シムが付けたスレッド id を owner/repo・PR 番号・先頭コメントの id に分解する
graphql_parse_thread_id() {
  [[ "$1" =~ ^PRRT-ccr:([^#]+)#([0-9]+):([0-9]+)$ ]] || return 1
  thread_repo="${BASH_REMATCH[1]}"
  thread_pr="${BASH_REMATCH[2]}"
  thread_comment="${BASH_REMATCH[3]}"
}

# mutation を翻訳する。return 2 は翻訳できない (本物の gh に渡す)、exit 1 は REST の失敗
graphql_mutation() {
  local query="$1" id="$2" body="$3"
  local thread_repo thread_pr thread_comment
  case "$query" in
    *resolveReviewThread*)
      graphql_parse_thread_id "$id" || return 2
      rest -X POST "repos/$thread_repo/pulls/$thread_pr/ccr/comments/$thread_comment/resolve" >/dev/null || die "resolve に失敗しました"
      jq -n --arg id "$id" '{data: {resolveReviewThread: {thread: {id: $id}}}}'
      ;;
    *addPullRequestReviewThreadReply*)
      graphql_parse_thread_id "$id" || return 2
      rest -X POST "repos/$thread_repo/pulls/$thread_pr/comments/$thread_comment/replies" -f body="$body" \
        | jq '{data: {addPullRequestReviewThreadReply: {comment: {id: .node_id}}}}' || die "返信に失敗しました"
      ;;
    *) return 2 ;;
  esac
}

# gh api graphql の引数を読んで翻訳する。翻訳できなければ本物の gh に渡す
graphql_main() {
  local args=("$@") query="" var_owner="" var_name="" var_number="" var_id="" var_body="" other=false
  while [ $# -gt 0 ]; do
    case "$1" in
      -f|--raw-field|-F|--field)
        case "$2" in
          query=*) query="${2#query=}" ;;
          owner=*) var_owner="${2#owner=}" ;;
          name=*) var_name="${2#name=}" ;;
          number=*) var_number="${2#number=}" ;;
          id=*) var_id="${2#id=}" ;;
          body=*) var_body="${2#body=}" ;;
          after=*) ;;
          *) other=true ;;
        esac
        shift 2 ;;
      --jq|-q) graphql_jq="$2"; shift 2 ;;
      *) other=true; shift ;;
    esac
  done
  [ "$other" = false ] && [ -n "$query" ] && graphql_query_supported "$query" || passthrough api graphql "${args[@]}"
  local out
  case "$query" in
    *mutation*)
      # スレッド id が本シムの形でない時 (return 1) は本物に渡す。REST の失敗 (die、exit 1) はそのまま exit 1
      out="$(graphql_mutation "$query" "$var_id" "$var_body")" || { [ $? -eq 2 ] && passthrough api graphql "${args[@]}"; exit 1; } ;;
    *) out="$(graphql_query "$query" "$var_owner" "$var_name" "$var_number")" || exit 1 ;;
  esac
  if [ -n "${graphql_jq:-}" ]; then
    printf '%s\n' "$out" | jq -r "$graphql_jq"
  else
    printf '%s\n' "$out"
  fi
}
graphql_jq=""
