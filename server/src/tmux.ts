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
  /** pane の手前で動いているプロセスの作業ディレクトリ。 */
  paneCurrentPath: string;
}

/** ps の 1 行が表す、動いている 1 つのプロセス。 */
interface RunningProcess {
  pid: number;
  parentPid: number;
  /** 実行ファイルと引数を空白でつないだもの。 */
  args: string;
}

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
    "#{pane_id}\t#{pane_pid}\t#{pane_current_path}",
  ]);
  if (stdout === null) {
    return null;
  }
  return stdout.split("\n").flatMap((line) => {
    const [paneId, panePidText, ...pathParts] = line.split("\t");
    const panePid = Number(panePidText);
    return paneId === undefined || !Number.isInteger(panePid) || pathParts.length === 0
      ? []
      : [{ paneId, panePid, paneCurrentPath: pathParts.join("\t") }];
  });
}

/** 動いている全プロセスを返す。ps を実行できない時は null を返す。 */
async function listRunningProcesses(ps: string): Promise<RunningProcess[] | null> {
  // -ww は、長い引数を端末の幅で切らずに全文を出す。
  const stdout = await runCommand(ps, ["-A", "-ww", "-o", "pid=,ppid=,args="]);
  if (stdout === null) {
    return null;
  }
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match === null
      ? []
      : [{ pid: Number(match[1]), parentPid: Number(match[2]), args: match[3] ?? "" }];
  });
}

/**
 * プロセスの引数から、そのプロセスがどの agent かを返す。agent でなければ null を返す。
 * Claude Code は `claude`、Codex は `codex` の実行ファイルで動く。npm で入れたものは `node <パス>/claude` の形で動く。
 */
function processAgent(args: string): AgentKind | null {
  const [program = "", script = ""] = args.split(/\s+/);
  const name = path.basename(program) === "node" ? path.basename(script) : path.basename(program);
  return name === "claude" ? "claude-code" : name === "codex" ? "codex" : null;
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
      runningProcesses.some(
        (runningProcess) =>
          (runningProcess.pid === pane.panePid || runningProcess.parentPid === pane.panePid) &&
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
  return { available: true, paneId: matchedPane.paneId };
}

/**
 * pane へ本文を 1 行の文字として入力し、Enter を送る。送れた時は true、tmux が失敗した時は false を返す。
 * 本文は引数の 1 つとしてそのまま渡し、シェルにも tmux のキーの名前にも解釈させない (-l は文字のまま入力、-- は `-` で始まる本文を tmux のオプションにしない)。
 */
export async function sendReplyToPane(
  commands: ReplyCommands,
  paneId: string,
  text: string,
): Promise<boolean> {
  if ((await runCommand(commands.tmux, ["send-keys", "-t", paneId, "-l", "--", text])) === null) {
    return false;
  }
  await delay(enterDelayMs);
  return (await runCommand(commands.tmux, ["send-keys", "-t", paneId, "Enter"])) !== null;
}
