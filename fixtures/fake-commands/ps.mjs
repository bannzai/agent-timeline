#!/usr/bin/env node
// テストと CI で本物の ps の代わりに使う偽の ps。偽の tmux が返す pane の pid は実在しないため、pane で動いているプロセスもこれで返す。
// 引数を見ず、FAKE_PS_FILE の中身 (`ps -A -ww -o pid=,ppid=,args=` の出力の形) をそのまま出す。指定が無い時は何も出さない。
import { readFileSync } from "node:fs";

const processesFile = process.env.FAKE_PS_FILE;
if (processesFile !== undefined) {
  process.stdout.write(readFileSync(processesFile, "utf8"));
}
