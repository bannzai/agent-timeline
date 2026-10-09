---
name: read-pr
description: GitHub Pull Request 番号 ($ARGUMENTS) の本文と差分を gh pr view / gh pr diff で取得して理解する。ユーザーが PR 内容把握を依頼した時や、PR を起点にレビュー・調査を始める時に使う。
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(gh pull-request view:*)
---

## Context
- Fetch github pull-request: !gh pr view $ARGUMENTS
- Understand github pull-request diff: !gh pr diff $ARGUMENTS 

## Task
Find and read pull-request with #$ARGUMENTS. Follow these steps: 

1. Understand the pull-request described in the github pull-request
