# 引数なしの make で、ビルドしてサーバーを起動し、ブラウザで開く (人が手で動作確認するための入口)。
# 検査・テストは CI (.github/workflows/ci.yml) が行い、make には含めない。
.DEFAULT_GOAL := web

# ブラウザで開く URL をサーバーの待ち受けと一致させるため、server/src/index.ts の既定のポートと同じ値にする
# (7878 を選んだ理由はそちらのコメントに書き、ここでは繰り返さない)。環境変数 AGENT_TIMELINE_PORT で上書きできる。
AGENT_TIMELINE_PORT ?= 7878
export AGENT_TIMELINE_PORT

.PHONY: web build-web

# サーバーが前面で動くため、ブラウザは背面で少し待ってから開く。
web: build-web
	(sleep 1 && open http://127.0.0.1:$(AGENT_TIMELINE_PORT)) &
	node dist/server/index.js

build-web:
	npm run build
