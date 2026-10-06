# 引数なしの make で動作確認 (verify) を実行する
.DEFAULT_GOAL := verify

.PHONY: verify
verify:
	npm run lint
	npm run format:check
	npm run typecheck
	npm run build
	npm test
	npm run test:e2e
