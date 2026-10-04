import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { AgentKind, ReplyTarget } from "./post.js";

// tmux と ps の知識は、このファイルの中だけに置く。

const execFileAsync = promisify(execFile);

// tmux も ps も手元ですぐに返るコマンドで、5 秒を超えるのは固まっている時のため。スレッドと返信の API を待たせ続けない。
const commandTimeoutMs = 5_000;
// ps は全プロセスの引数を返し、エージェントを並列に動かすマシンでは既定の 1 MiB を超えうるため、余裕を持たせる。
const commandMaxBufferBytes = 16 * 1024 * 1024;
// 文字の入力の直後に Enter を送ると、エージェントの入力欄が文字を取り込む前に Enter が届き、送信されないことがあるため、間を置く。
// 300 ミリ秒は、取り込みを待っても指示を送った手応えが遅れない長さとして選んだ。
const enterDelayMs = 300;
// 対話の画面 (TUI) を開かないサブコマンド。対話の画面を開く `codex resume`・`codex fork` と、`claude` の引数の指示 (prompt) は含めない。
// 2026-10-05 に Claude Code 2.1.289 と codex-cli 0.156.0 の `--help` の Commands で確認した。
const claudeNonInteractiveCommands = new Set([
  "agents",
  "attach",
  "auth",
  "auto-mode",
  "doctor",
  "gateway",
  "import",
  "install",
  "logs",
  "mcp",
  "plugin",
  "plugins",
  "purge",
  "respawn",
  "rm",
  "setup-token",
  "stop",
  "kill",
  "ultrareview",
  "update",
  "upgrade",
]);
const codexNonInteractiveCommands = new Set([
  "agents",
  "exec",
  "e",
  "review",
  "login",
  "logout",
  "mcp",
  "plugin",
  "app-server",
  "remote-control",
  "app",
  "completion",
  "update",
  "doctor",
  "sandbox",
  "debug",
  "apply",
  "a",
  "queue",
  "archive",
  "delete",
  "migrate-rollouts",
  "unarchive",
  "cloud",
  "exec-server",
  "features",
  "help",
]);
// 次の引数を値に取るオプション。サブコマンドを探す時に、オプションの値をサブコマンドと取り違えないために読み飛ばす。
// 値を省略できるオプション (`claude --resume` など) は含めない。上と同じ `--help` の Options で確認した。
const claudeValueOptions = new Set([
  "--add-dir",
  "--agent",
  "--agents",
  "--allowedTools",
  "--allowed-tools",
  "--append-system-prompt",
  "--autocompact",
  "--betas",
  "--debug-file",
  "--disallowedTools",
  "--disallowed-tools",
  "--effort",
  "--environment",
  "--fallback-model",
  "--file",
  "--input-format",
  "--json-schema",
  "--max-budget-usd",
  "--mcp-config",
  "--model",
  "-n",
  "--name",
  "--output-format",
  "--permission-mode",
  "--permission-prompts",
  "--plugin-dir",
  "--plugin-url",
  "--remote-control-session-name-prefix",
  "--session-id",
  "--setting-sources",
  "--settings",
  "--system-prompt",
  "--system-prompt-snapshot",
  "--tools",
]);
const codexValueOptions = new Set([
  "-c",
  "--config",
  "--enable",
  "--disable",
  "--remote",
  "--remote-auth-token-env",
  "-i",
  "--image",
  "-m",
  "--model",
  "--local-provider",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "-C",
  "--cd",
  "--add-dir",
  "-a",
  "--ask-for-approval",
]);

/** 返信の送信に使う外部のコマンドの実行ファイル。テストと CI は偽のコマンドに差し替える。 */
export interface ReplyCommands {
  /** tmux の実行ファイル。 */
  tmux: string;
  /** pane で動いているプロセスを調べる ps の実行ファイル。 */
  ps: string;
}

/** tmux の 1 つの pane。 */
interface TmuxPane {
  /** pane の ID (`%1` など)。tmux のサーバーが動いている間、閉じた pane の ID は使い回されない。 */
  paneId: string;
  /** pane で最初に起動したプロセス (ふつうはシェル) の pid。 */
  panePid: number;
  /** pane がコピーモードなどのモードにいるか。モードの間は、送ったキーがモードの操作として使われ、agent に届かない。 */
  paneInMode: boolean;
  /** pane の手前で動いているプロセスの作業ディレクトリ。 */
  paneCurrentPath: string;
}

/** ps の 1 行が表す、動いている 1 つのプロセス。 */
interface RunningProcess {
  pid: number;
  parentPid: number;
  /** ps の stat (`S+` など)。`+` は、端末の手前のプロセスグループ (キー入力を受け取るもの) にいることを表す。 */
  stat: string;
  /** 実行ファイルと引数を空白でつないだもの。 */
  args: string;
}

/**
 * 返信の送信の結果。unavailable は送り先が無くて何も送らなかったこと、failed は送る途中で失敗したことを表す。
 * textTyped は、本文を pane に入力した後 (Enter の前後) に失敗し、本文が pane の入力欄に残りうること。
 * 同じ本文を送り直すと入力欄で 2 つがつながるため、画面は返信欄の本文を消す。
 */
export type ReplySendResult =
  | { status: "sent" }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string; textTyped: boolean };

/**
 * 環境変数から返信に使うコマンドを決める。テストと CI は、ここで偽のコマンドに差し替える。
 * 既定はコマンドの名前で、シェルで打った時と同じく PATH から探す。
 */
export function replyCommandsFromEnv(env: NodeJS.ProcessEnv): ReplyCommands {
  return { tmux: env.AGENT_TIMELINE_TMUX ?? "tmux", ps: env.AGENT_TIMELINE_PS ?? "ps" };
}

/** コマンドを、シェルを通さず引数の配列のまま実行し、標準出力を返す。失敗した時 (無い・exit 非 0・時間切れ) は null を返す。 */
async function runCommand(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: commandTimeoutMs,
      maxBuffer: commandMaxBufferBytes,
    });
    return stdout;
  } catch {
    return null;
  }
}

/** tmux の全 pane を返す。tmux が無い・サーバーが動いていない時は null を返す。 */
async function listTmuxPanes(tmux: string): Promise<TmuxPane[] | null> {
  const stdout = await runCommand(tmux, [
    "list-panes",
    "-a",
    "-F",
    "#{pane_id}\t#{pane_pid}\t#{pane_in_mode}\t#{pane_current_path}",
  ]);
  if (stdout === null) {
    return null;
  }
  return stdout.split("\n").flatMap((line) => {
    const [paneId, panePidText, paneInModeText, ...pathParts] = line.split("\t");
    const panePid = Number(panePidText);
    return paneId === undefined || !Number.isInteger(panePid) || pathParts.length === 0
      ? []
      : [
          {
            paneId,
            panePid,
            paneInMode: paneInModeText !== "0",
            paneCurrentPath: pathParts.join("\t"),
          },
        ];
  });
}

/** 動いている全プロセスを返す。ps を実行できない時は null を返す。 */
async function listRunningProcesses(ps: string): Promise<RunningProcess[] | null> {
  // -ww は、長い引数を端末の幅で切らずに全文を出す。
  const stdout = await runCommand(ps, ["-A", "-ww", "-o", "pid=,ppid=,stat=,args="]);
  if (stdout === null) {
    return null;
  }
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return match === null
      ? []
      : [
          {
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            stat: match[3] ?? "",
            args: match[4] ?? "",
          },
        ];
  });
}

/**
 * プロセスの引数から、そのプロセスが指示を受け取る対話の agent かを返し、どの agent かを返す。そうでなければ null を返す。
 * Claude Code は `claude`、Codex は `codex` の実行ファイルで動く。npm で入れたものは `node <パス>/claude`・`node <パス>/codex.js` の形で動く。
 * 対話でない起動 (`claude -p`・`codex exec` などのサブコマンド) は端末の入力を読まず、送った本文が終わった後のシェルに残って
 * コマンドとして実行されうるため、agent とみなさない。
 */
function processAgent(args: string): AgentKind | null {
  const tokens = args.split(/\s+/);
  const [program = "", script = ""] = tokens;
  const isNodeScript = path.basename(program) === "node";
  const name = path.basename(isNodeScript ? script : program).replace(/\.m?js$/, "");
  const agentArgs = tokens.slice(isNodeScript ? 2 : 1);
  if (name === "claude") {
    // `-p` は、ほかの 1 文字のオプションとまとめて書ける (`-cp`)。
    return agentArgs.some((arg) => arg === "--print" || /^-[a-zA-Z]*p[a-zA-Z]*$/.test(arg)) ||
      startsNonInteractiveCommand(agentArgs, claudeValueOptions, claudeNonInteractiveCommands)
      ? null
      : "claude-code";
  }
  if (name === "codex") {
    return startsNonInteractiveCommand(agentArgs, codexValueOptions, codexNonInteractiveCommands)
      ? null
      : "codex";
  }
  return null;
}

/**
 * agent の引数が、対話でないサブコマンドの起動か。ps は引数を空白でつないで出すため、空白を含むオプションの値
 * (`-c 'effort = "high"'`) があると引数の境目が分からない。値を取るオプションがある時は、後ろのどこかにサブコマンドの名前があれば
 * 対話でないとみなし、送り先にしない側に倒す (指示の語がサブコマンドの名前と重なる起動も送り先にならない)。
 */
function startsNonInteractiveCommand(
  agentArgs: string[],
  valueOptions: Set<string>,
  nonInteractiveCommands: Set<string>,
): boolean {
  if (nonInteractiveCommands.has(firstPositionalArg(agentArgs, valueOptions) ?? "")) {
    return true;
  }
  return (
    agentArgs.some((arg) => valueOptions.has(arg.split("=")[0] ?? "")) &&
    agentArgs.some((arg) => nonInteractiveCommands.has(arg))
  );
}

/**
 * 引数のうち、オプションでない最初のもの (サブコマンドか、指示の最初の語) を返す。無ければ undefined を返す。
 * valueOptions のオプションは次の引数を値に取るため、その値を読み飛ばす (`--model=x` の形は 1 つの引数で終わる)。
 */
function firstPositionalArg(agentArgs: string[], valueOptions: Set<string>): string | undefined {
  for (let argIndex = 0; argIndex < agentArgs.length; argIndex++) {
    const arg = agentArgs[argIndex] ?? "";
    if (arg === "--") {
      return agentArgs[argIndex + 1];
    }
    if (!arg.startsWith("-")) {
      return arg;
    }
    if (valueOptions.has(arg)) {
      argIndex++;
    }
  }
  return undefined;
}

/**
 * 作業ディレクトリで動いている agent のセッションの返信の送り先を求める。
 * 作業ディレクトリが同じで、同じ種類の agent が動いている pane がちょうど 1 つの時だけ送り先にする。
 */
export async function findReplyTarget(
  commands: ReplyCommands,
  agent: AgentKind,
  projectDirectory: string | null,
): Promise<ReplyTarget> {
  if (projectDirectory === null) {
    return { available: false, reason: "作業ディレクトリがログに無いため返信できません" };
  }
  const [panes, runningProcesses] = await Promise.all([
    listTmuxPanes(commands.tmux),
    listRunningProcesses(commands.ps),
  ]);
  if (panes === null) {
    return { available: false, reason: "tmux が動いていないため返信できません" };
  }
  if (runningProcesses === null) {
    return { available: false, reason: "プロセスの一覧を読めないため返信できません" };
  }
  const matchedPanes = panes.filter(
    (pane) =>
      path.resolve(pane.paneCurrentPath) === path.resolve(projectDirectory) &&
      // pane のシェルと、その直下のプロセスだけを見る。agent がツールとして起動した別の agent (Claude Code から実行した codex など) を、
      // pane で動いている agent と取り違えないため。
      // agent が手前にいる (キー入力を受け取る) ことも確かめる。止めた (Ctrl+Z) agent や裏で動かした agent の pane では、
      // 入力を受け取るのはシェルで、送った本文がコマンドとして実行されてしまうため。
      runningProcesses.some(
        (runningProcess) =>
          (runningProcess.pid === pane.panePid || runningProcess.parentPid === pane.panePid) &&
          runningProcess.stat.includes("+") &&
          !runningProcess.stat.startsWith("T") &&
          processAgent(runningProcess.args) === agent,
      ),
  );
  const [matchedPane] = matchedPanes;
  if (matchedPane === undefined) {
    return { available: false, reason: "このセッションが動いている tmux の pane が見つかりません" };
  }
  if (matchedPanes.length > 1) {
    return {
      available: false,
      reason: "同じディレクトリで同じ種類のエージェントが複数動いているため送り先を決められません",
    };
  }
  if (matchedPane.paneInMode) {
    return {
      available: false,
      reason: "pane がスクロール中 (コピーモード) のため返信できません",
    };
  }
  return { available: true, paneId: matchedPane.paneId };
}

/**
 * 本文を、tmux が文字のまま入力する 1 つの引数にする。tmux は引数の末尾の `;` をコマンドの区切りとして取り除き、
 * 末尾の `\;` を `;` にするため、末尾が `;` の本文だけ最後の `;` の前に `\` を足す (2026-10-05 に tmux 3.6a の send-keys -l で確認)。
 */
function tmuxLiteralArgument(text: string): string {
  return text.endsWith(";") ? `${text.slice(0, -1)}\\;` : text;
}

/**
 * セッションの送り先の pane を求め、本文を 1 行の文字として入力して Enter を送る。
 * 本文は引数の 1 つとして渡し、シェルにも tmux のキーの名前にも解釈させない (-l は文字のまま入力、-- は `-` で始まる本文を tmux のオプションにしない)。
 * 同時に呼ばない前提で、呼び出し側が 1 つずつ順に呼ぶ (2 つの本文と Enter が混ざらないため)。
 */
export async function sendReply(
  commands: ReplyCommands,
  agent: AgentKind,
  projectDirectory: string | null,
  text: string,
): Promise<ReplySendResult> {
  const replyTarget = await findReplyTarget(commands, agent, projectDirectory);
  if (!replyTarget.available) {
    return { status: "unavailable", reason: replyTarget.reason };
  }
  const { paneId } = replyTarget;
  if (
    (await runCommand(commands.tmux, [
      "send-keys",
      "-t",
      paneId,
      "-l",
      "--",
      tmuxLiteralArgument(text),
    ])) === null
  ) {
    return { status: "failed", reason: "tmux に送れませんでした", textTyped: false };
  }
  await delay(enterDelayMs);
  // 入力している間に agent が止められてシェルが手前に戻っていれば、Enter で本文がコマンドとして実行されるため、Enter の直前にも確かめる。
  const replyTargetBeforeEnter = await findReplyTarget(commands, agent, projectDirectory);
  if (!replyTargetBeforeEnter.available || replyTargetBeforeEnter.paneId !== paneId) {
    return {
      status: "failed",
      reason:
        "送る途中で pane のエージェントが変わったため Enter を送っていません (本文は pane の入力欄に残っています)",
      textTyped: true,
    };
  }
  if ((await runCommand(commands.tmux, ["send-keys", "-t", paneId, "Enter"])) === null) {
    return {
      status: "failed",
      reason: "Enter を tmux に送れませんでした (本文は pane の入力欄に残っています)",
      textTyped: true,
    };
  }
  return { status: "sent" };
}
