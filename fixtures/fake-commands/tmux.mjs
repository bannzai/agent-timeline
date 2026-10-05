#!/usr/bin/env node
// テストと CI で本物の tmux の代わりに使う偽の tmux。CI には tmux も動いているエージェントも無いため。
// - 受け取った引数を、呼ばれるたびに FAKE_TMUX_CALLS_FILE へ JSON の配列の 1 行として書く (指定がある時だけ)
// - list-panes は FAKE_TMUX_PANES_FILE の中身をそのまま出す
// - send-keys は、-t の pane が FAKE_TMUX_PANES_FILE に無ければ本物と同じく失敗する
// - FAKE_TMUX_PANES_FILE が無い時は、tmux のサーバーが動いていない時と同じく失敗する
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const callsFile = process.env.FAKE_TMUX_CALLS_FILE;
if (callsFile !== undefined) {
  mkdirSync(path.dirname(callsFile), { recursive: true });
  appendFileSync(callsFile, `${JSON.stringify(args)}\n`);
}

const panesFile = process.env.FAKE_TMUX_PANES_FILE;
if (panesFile === undefined) {
  process.stderr.write("no server running\n");
  process.exit(1);
}
const panesText = readFileSync(panesFile, "utf8");

if (args[0] === "list-panes") {
  process.stdout.write(panesText);
  process.exit(0);
}
if (args[0] === "send-keys") {
  const paneIds = panesText.split("\n").map((line) => line.split("\t")[0]);
  const targetPaneId = args[args.indexOf("-t") + 1];
  if (!paneIds.includes(targetPaneId)) {
    process.stderr.write(`can't find pane: ${targetPaneId}\n`);
    process.exit(1);
  }
  process.exit(0);
}
process.stderr.write(`unknown command: ${args[0]}\n`);
process.exit(1);
