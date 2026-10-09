---
name: read-issue
description: GitHub Issue 番号 ($ARGUMENTS) の本文とコメントを gh issue view で取得して理解する。ユーザーが Issue の内容把握を依頼した時や、Issue を起点に実装・調査を始める時に使う。
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(gh issue view:*)
---

## Context
- Fetch GitHub issue: !gh issue view $ARGUMENTS 
- Read GitHub issue comments: gh issue view $ARGUMENTS --comments

## Task
Find and read issue with #$ARGUMENTS. Follow these steps: 

1. Understand the issue described in the github issue and issue comments.
