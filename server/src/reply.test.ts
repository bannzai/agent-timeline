import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { ReplyTarget } from "./post.js";
import { logRootsFromEnv } from "./timeline.js";
import { replyCommandsFromEnv } from "./tmux.js";

const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const claudeReadme = "8d4e2f6a-1c3b-4a5d-8e7f-9a0b1c2d3e4f";
const codexUnit = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const codexTax = "0199b2c3-d4e5-7f6a-9b0c-1d2e3f4a5b6c";

/** このアプリの画面のオリジン。ブラウザは、画面を開いた URL のオリジンを Origin に入れて API を呼ぶ。 */
const appOrigin = "http://127.0.0.1:7878";
/** 返信の本文の見本。 */
const replyText = "合計のテストも足して";

/** 一時ディレクトリを作る。偽のコマンドの表・呼び出しの記録と利用記録を、テストごとに分けて置く。 */
function makeTemporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "agent-timeline-reply-"));
}

/** テストの対象のアプリと、偽の tmux の呼び出しの記録の置き場。 */
interface ReplyTestContext {
  app: Hono;
  /** 偽の tmux が、呼ばれるたびに引数を 1 行ずつ書くファイル。 */
  tmuxCallsFile: string;
  usageLogDirectory: string;
  temporaryDirectory: string;
}

/**
 * 偽の tmux と ps を、fixtures/fake-commands/ の表 (E2E と同じ pane とプロセス) で答えるようにし、アプリを作る。
 * vitest.config.ts が、アプリの tmux と ps を偽のコマンドに向けている。
 */
async function prepareReplyTest(): Promise<ReplyTestContext> {
  const temporaryDirectory = await makeTemporaryDirectory();
  const tmuxCallsFile = path.join(temporaryDirectory, "tmux-calls.jsonl");
  const usageLogDirectory = path.join(temporaryDirectory, "usage");
  vi.stubEnv("FAKE_TMUX_PANES_FILE", "fixtures/fake-commands/panes.tsv");
  vi.stubEnv("FAKE_PS_FILE", "fixtures/fake-commands/processes.txt");
  vi.stubEnv("FAKE_TMUX_CALLS_FILE", tmuxCallsFile);
  return {
    app: createApp({
      logRoots: logRootsFromEnv(process.env),
      usageLogDirectory,
      replyCommands: replyCommandsFromEnv(process.env),
    }),
    tmuxCallsFile,
    usageLogDirectory,
    temporaryDirectory,
  };
}

/** 偽の tmux と ps が答える pane とプロセスの表を、テストの中で書いた表に替える。 */
async function replaceFakeTables(
  context: ReplyTestContext,
  { panes, processes }: { panes: string[]; processes: string[] },
): Promise<void> {
  const panesFile = path.join(context.temporaryDirectory, `panes-${Date.now()}.tsv`);
  const processesFile = path.join(context.temporaryDirectory, `processes-${Date.now()}.txt`);
  await writeFile(panesFile, panes.map((line) => `${line}\n`).join(""));
  await writeFile(processesFile, processes.map((line) => `${line}\n`).join(""));
  vi.stubEnv("FAKE_TMUX_PANES_FILE", panesFile);
  vi.stubEnv("FAKE_PS_FILE", processesFile);
}

/** 偽の tmux が受け取った引数の列のうち、send-keys (pane への入力) のものを呼ばれた順に返す。 */
async function readSendKeysCalls(tmuxCallsFile: string): Promise<string[][]> {
  const callsText = await readFile(tmuxCallsFile, "utf8").catch(() => "");
  return callsText
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[])
    .filter((args) => args[0] === "send-keys");
}

/** 利用記録の各行を JSON として読む。ファイルが無ければ空の配列を返す。 */
async function readUsageLogLines(usageLogDirectory: string): Promise<Record<string, unknown>[]> {
  const usageLogText = await readFile(path.join(usageLogDirectory, "usage.jsonl"), "utf8").catch(
    () => "",
  );
  return usageLogText
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** 返信の API へ、このアプリの画面と同じ Origin と Content-Type で本文を送る。 */
async function postReply(app: Hono, sessionPath: string, text: unknown): Promise<Response> {
  return app.request(`${appOrigin}/api/sessions/${sessionPath}/replies`, {
    method: "POST",
    headers: { Origin: appOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

/** スレッドの API を呼び、返信できるかを返す。 */
async function requestReplyTarget(app: Hono, sessionPath: string): Promise<ReplyTarget> {
  const response = await app.request(`${appOrigin}/api/sessions/${sessionPath}/posts`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { reply: ReplyTarget }).reply;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("スレッドの API の返信できるか", () => {
  it("作業ディレクトリに同じ種類の agent の pane が 1 つだけある時は、その pane を返す", async () => {
    const { app } = await prepareReplyTest();

    expect(await requestReplyTarget(app, `claude-code/${claudeCart}`)).toEqual({
      available: true,
      paneId: "%1",
    });
  });

  it("同じディレクトリに同じ種類の agent の pane が 2 つある時は、返信できない理由を返す", async () => {
    const { app } = await prepareReplyTest();

    expect(await requestReplyTarget(app, `codex/${codexUnit}`)).toEqual({
      available: false,
      reason: "同じディレクトリで同じ種類のエージェントが複数動いているため送り先を決められません",
    });
  });

  it("作業ディレクトリに agent の pane が無い時は、返信できない理由を返す", async () => {
    const { app } = await prepareReplyTest();

    // notes-app の pane ではシェルだけが動いている。acme-shop の pane で動いているのは Claude Code で、Codex ではない。
    for (const sessionPath of [`claude-code/${claudeReadme}`, `codex/${codexTax}`]) {
      expect(await requestReplyTarget(app, sessionPath)).toEqual({
        available: false,
        reason: "このセッションが動いている tmux の pane が見つかりません",
      });
    }
  });

  it("pane のシェルの直下のプロセスだけを見て、agent がツールとして起動した別の agent を pane の agent とみなさない", async () => {
    const context = await prepareReplyTest();
    // acme-shop の pane の Claude Code が、レビューのために codex を起動している。
    await replaceFakeTables(context, {
      panes: ["%1\t1001\t/home/dev/acme-shop"],
      processes: [
        " 1001     1 Ss   -zsh",
        " 1101  1001 S+   claude",
        " 1201  1101 S+   /bin/zsh -c codex exec review",
        " 1202  1201 S+   codex exec review",
      ],
    });

    expect((await requestReplyTarget(context.app, `claude-code/${claudeCart}`)).available).toBe(
      true,
    );
    expect((await requestReplyTarget(context.app, `codex/${codexTax}`)).available).toBe(false);
  });

  it.each([
    ["Ctrl+Z で止めた", " 1101  1001 T    claude"],
    ["裏で動かした", " 1101  1001 S    claude"],
  ])(
    "%s agent の pane は、キー入力を受け取るのがシェルのため送り先にしない",
    async (_, agentProcessLine) => {
      const context = await prepareReplyTest();
      await replaceFakeTables(context, {
        panes: ["%1\t1001\t/home/dev/acme-shop"],
        processes: [" 1001     1 Ss+  -zsh", agentProcessLine],
      });

      expect(await requestReplyTarget(context.app, `claude-code/${claudeCart}`)).toEqual({
        available: false,
        reason: "このセッションが動いている tmux の pane が見つかりません",
      });
    },
  );

  it.each([
    ["claude -p", "claude-code", claudeCart, "claude -p 合計を直して"],
    ["claude --print", "claude-code", claudeCart, "claude --model opus --print 合計を直して"],
    ["claude mcp", "claude-code", claudeCart, "claude mcp list"],
    ["codex exec", "codex", codexTax, "codex exec 端数を直して"],
    ["npm の codex exec", "codex", codexTax, "node /usr/local/bin/codex exec 端数を直して"],
    ["codex review", "codex", codexTax, "codex review"],
  ])(
    "対話でない起動 (%s) の agent の pane は、端末の入力を読まないため送り先にしない",
    async (_, agent, sessionId, agentArgs) => {
      const context = await prepareReplyTest();
      await replaceFakeTables(context, {
        panes: ["%1\t1001\t/home/dev/acme-shop"],
        processes: [" 1001     1 Ss   -zsh", ` 1101  1001 S+   ${agentArgs}`],
      });

      expect((await requestReplyTarget(context.app, `${agent}/${sessionId}`)).available).toBe(
        false,
      );
    },
  );

  it.each([
    ["claude", "claude-code", claudeCart, "claude"],
    ["claude --resume", "claude-code", claudeCart, "claude --resume 3f2a9c1e"],
    ["claude に指示を渡した起動", "claude-code", claudeCart, "claude 合計を直して"],
    ["codex resume", "codex", codexTax, "codex resume --last"],
    ["codex に指示を渡した起動", "codex", codexTax, "codex 端数を直して"],
  ])("対話の起動 (%s) の agent の pane は送り先にする", async (_, agent, sessionId, agentArgs) => {
    const context = await prepareReplyTest();
    await replaceFakeTables(context, {
      panes: ["%1\t1001\t/home/dev/acme-shop"],
      processes: [" 1001     1 Ss   -zsh", ` 1101  1001 S+   ${agentArgs}`],
    });

    expect(await requestReplyTarget(context.app, `${agent}/${sessionId}`)).toEqual({
      available: true,
      paneId: "%1",
    });
  });

  it("tmux のサーバーが動いていない時は、返信できない理由を返す", async () => {
    const { app } = await prepareReplyTest();
    vi.stubEnv("FAKE_TMUX_PANES_FILE", undefined);

    expect(await requestReplyTarget(app, `claude-code/${claudeCart}`)).toEqual({
      available: false,
      reason: "tmux が動いていないため返信できません",
    });
  });
});

describe("POST /api/sessions/:agent/:sessionId/replies", () => {
  it("本文を対応する pane への 1 つの引数の入力として渡し、続けて Enter を送る", async () => {
    const { app, tmuxCallsFile } = await prepareReplyTest();

    const response = await postReply(app, `claude-code/${claudeCart}`, replyText);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sent" });
    expect(await readSendKeysCalls(tmuxCallsFile)).toEqual([
      ["send-keys", "-t", "%1", "-l", "--", replyText],
      ["send-keys", "-t", "%1", "Enter"],
    ]);
  });

  it.each([
    ["; でつないだコマンド", "合計を直して; touch {dir}/semicolon"],
    ["$(...) のコマンド置換", "$(touch {dir}/substitution) を見て"],
    ["バッククォートのコマンド置換", "`touch {dir}/backquote` を見て"],
    ["- で始まる本文", "-t %2 Enter"],
    ["tmux のキーの名前", "C-c"],
    ["途中の \\;", "a\\;b を直して"],
  ])("%sを含む本文も、シェルに解釈させず本文そのままの 1 つの引数で渡す", async (_, template) => {
    const { app, tmuxCallsFile, temporaryDirectory } = await prepareReplyTest();
    const text = template.replace("{dir}", temporaryDirectory);

    expect((await postReply(app, `claude-code/${claudeCart}`, text)).status).toBe(200);

    expect((await readSendKeysCalls(tmuxCallsFile))[0]).toEqual([
      "send-keys",
      "-t",
      "%1",
      "-l",
      "--",
      text,
    ]);
    // 本文の中のコマンドが実行されていれば、一時ディレクトリにファイルができる。
    for (const fileName of ["semicolon", "substitution", "backquote"]) {
      await expect(access(path.join(temporaryDirectory, fileName))).rejects.toThrow();
    }
  });

  it.each([
    ["改行", "一行目\n二行目"],
    ["復帰", "一行目\r二行目"],
    ["タブ", "合計\tを直して"],
    ["エスケープシーケンス", "\u001b[2J合計を直して"],
    ["NUL", "合計\u0000を直して"],
    ["DEL", "合計\u007fを直して"],
    ["C1 制御文字", "合計\u009bを直して"],
  ])("%sを含む本文は 400 を返し、何も送らない", async (_, text) => {
    const { app, tmuxCallsFile } = await prepareReplyTest();

    const response = await postReply(app, `claude-code/${claudeCart}`, text);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "改行や制御文字を含む本文は送れません" });
    expect(await readSendKeysCalls(tmuxCallsFile)).toEqual([]);
  });

  it.each([
    ["空の本文", ""],
    ["空白だけの本文", "   "],
    ["文字列でない本文", 42],
    ["長すぎる本文", "あ".repeat(10_001)],
  ])("%sは 400 を返し、何も送らない", async (_, text) => {
    const { app, tmuxCallsFile } = await prepareReplyTest();

    expect((await postReply(app, `claude-code/${claudeCart}`, text)).status).toBe(400);
    expect(await readSendKeysCalls(tmuxCallsFile)).toEqual([]);
  });

  it.each([
    ["Origin が別のオリジン", `${appOrigin}/api`, { Origin: "https://attacker.example" }, 403],
    [
      "Origin が同じマシンの別のポート",
      `${appOrigin}/api`,
      { Origin: "http://127.0.0.1:3000" },
      403,
    ],
    ["Origin が無い", `${appOrigin}/api`, {}, 403],
    ["Origin が null", `${appOrigin}/api`, { Origin: "null" }, 403],
    [
      "Host が別のホスト名",
      "http://attacker.example:7878/api",
      { Origin: "http://attacker.example:7878" },
      403,
    ],
    [
      "Content-Type が application/x-www-form-urlencoded",
      `${appOrigin}/api`,
      { Origin: appOrigin, "Content-Type": "application/x-www-form-urlencoded" },
      415,
    ],
    [
      "Content-Type が text/plain",
      `${appOrigin}/api`,
      { Origin: appOrigin, "Content-Type": "text/plain" },
      415,
    ],
  ])("%sのリクエストは拒否し、何も送らない", async (_, apiUrl, headers, status) => {
    const { app, tmuxCallsFile } = await prepareReplyTest();

    const response = await app.request(`${apiUrl}/sessions/claude-code/${claudeCart}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ text: replyText }),
    });

    expect(response.status).toBe(status);
    expect(await readSendKeysCalls(tmuxCallsFile)).toEqual([]);
  });

  it("同じディレクトリに同じ種類の agent の pane が 2 つある時は 409 を返し、何も送らない", async () => {
    const { app, tmuxCallsFile } = await prepareReplyTest();

    const response = await postReply(app, `codex/${codexUnit}`, replyText);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "同じディレクトリで同じ種類のエージェントが複数動いているため送り先を決められません",
    });
    expect(await readSendKeysCalls(tmuxCallsFile)).toEqual([]);
  });

  it("スレッドを開いた後に pane の agent が終わっていれば、送る直前の対応付けで気づき 409 を返して何も送らない", async () => {
    const context = await prepareReplyTest();
    expect((await requestReplyTarget(context.app, `claude-code/${claudeCart}`)).available).toBe(
      true,
    );
    // Claude Code を終えて、同じ pane でエディタを開いた。
    await replaceFakeTables(context, {
      panes: ["%1\t1001\t/home/dev/acme-shop"],
      processes: [" 1001     1 Ss   -zsh", " 1301  1001 S+   vim src/cart.ts"],
    });

    expect((await postReply(context.app, `claude-code/${claudeCart}`, replyText)).status).toBe(409);
    expect(await readSendKeysCalls(context.tmuxCallsFile)).toEqual([]);
  });

  it("本文を入力している間に agent が止められたら、Enter を送らず、本文が入力欄に残ったことを 502 で返す", async () => {
    const context = await prepareReplyTest();

    const responsePromise = postReply(context.app, `claude-code/${claudeCart}`, replyText);
    // 本文の入力が偽の tmux に届いた後、Enter の前に Claude Code を Ctrl+Z で止めた。
    await expect.poll(() => readSendKeysCalls(context.tmuxCallsFile)).toHaveLength(1);
    await replaceFakeTables(context, {
      panes: ["%1\t1001\t/home/dev/acme-shop"],
      processes: [" 1001     1 Ss+  -zsh", " 1101  1001 T    claude"],
    });
    const response = await responsePromise;

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error:
        "送る途中で pane のエージェントが変わったため Enter を送っていません (本文は pane の入力欄に残っています)",
      textTyped: true,
    });
    expect(await readSendKeysCalls(context.tmuxCallsFile)).toEqual([
      ["send-keys", "-t", "%1", "-l", "--", replyText],
    ]);
  });

  it("同時に届いた返信は、本文と Enter の組を 1 つずつ順に送る", async () => {
    const { app, tmuxCallsFile } = await prepareReplyTest();

    const responses = await Promise.all([
      postReply(app, `claude-code/${claudeCart}`, "1 つ目の指示"),
      postReply(app, `claude-code/${claudeCart}`, "2 つ目の指示"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    // どちらが先に送られるかは決めないが、本文の次は必ずその本文の Enter になる。
    const sendKeysCalls = await readSendKeysCalls(tmuxCallsFile);
    const firstText = sendKeysCalls[0]?.[5] ?? "";
    expect(sendKeysCalls).toEqual([
      ["send-keys", "-t", "%1", "-l", "--", firstText],
      ["send-keys", "-t", "%1", "Enter"],
      [
        "send-keys",
        "-t",
        "%1",
        "-l",
        "--",
        firstText === "1 つ目の指示" ? "2 つ目の指示" : "1 つ目の指示",
      ],
      ["send-keys", "-t", "%1", "Enter"],
    ]);
    expect(firstText === "1 つ目の指示" || firstText === "2 つ目の指示").toBe(true);
  });

  it.each([
    ["末尾の ;", "合計を直して;", "合計を直して\\;"],
    ["末尾の \\;", "a\\;", "a\\\\;"],
    ["末尾の ;;", "x;;", "x;\\;"],
  ])(
    "%sは tmux にコマンドの区切りとして消されないよう、最後の ; の前に \\ を足して渡す",
    async (_, text, tmuxArgument) => {
      const { app, tmuxCallsFile } = await prepareReplyTest();

      expect((await postReply(app, `claude-code/${claudeCart}`, text)).status).toBe(200);

      expect((await readSendKeysCalls(tmuxCallsFile))[0]).toEqual([
        "send-keys",
        "-t",
        "%1",
        "-l",
        "--",
        tmuxArgument,
      ]);
    },
  );

  it("無いセッション・知らない agent は 404 を返し、何も送らない", async () => {
    const { app, tmuxCallsFile } = await prepareReplyTest();

    expect(
      (await postReply(app, "claude-code/00000000-0000-0000-0000-000000000000", replyText)).status,
    ).toBe(404);
    expect((await postReply(app, `gemini/${claudeCart}`, replyText)).status).toBe(404);
    expect(await readSendKeysCalls(tmuxCallsFile)).toEqual([]);
  });

  it("送信に成功すると利用記録に event が reply の行が 1 行増え、行は本文を含まない", async () => {
    const { app, usageLogDirectory } = await prepareReplyTest();
    // at は秒までのため、比較の下限を秒に切り下げる。
    const sentAfter = Math.floor(Date.now() / 1000) * 1000;

    expect((await postReply(app, `claude-code/${claudeCart}`, replyText)).status).toBe(200);

    const lines = await readUsageLogLines(usageLogDirectory);
    expect(lines).toHaveLength(1);
    const replyLine = lines[0];
    expect(Object.keys(replyLine ?? {}).sort()).toEqual(["at", "event"]);
    expect(replyLine?.event).toBe("reply");
    const sentAt = Date.parse(String(replyLine?.at));
    expect(sentAt).toBeGreaterThanOrEqual(sentAfter);
    expect(sentAt).toBeLessThanOrEqual(Date.now());
    expect(await readFile(path.join(usageLogDirectory, "usage.jsonl"), "utf8")).not.toContain(
      replyText,
    );
  });

  it("送れなかった返信は利用記録に書かない", async () => {
    const { app, usageLogDirectory } = await prepareReplyTest();

    expect((await postReply(app, `codex/${codexUnit}`, replyText)).status).toBe(409);
    expect((await postReply(app, `claude-code/${claudeCart}`, "一行目\n二行目")).status).toBe(400);

    expect(await readUsageLogLines(usageLogDirectory)).toEqual([]);
  });

  it("利用記録に書けない時も、届いた返信は成功を返す", async () => {
    const context = await prepareReplyTest();
    // 記録先のディレクトリの親をファイルにして、ディレクトリを作れなくする (実行するユーザーの権限によらず失敗する)。
    const blockingFile = path.join(context.temporaryDirectory, "not-a-directory");
    await writeFile(blockingFile, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createApp({
      logRoots: logRootsFromEnv(process.env),
      usageLogDirectory: path.join(blockingFile, "usage"),
      replyCommands: replyCommandsFromEnv(process.env),
    });

    expect((await postReply(app, `claude-code/${claudeCart}`, replyText)).status).toBe(200);
    expect(await readSendKeysCalls(context.tmuxCallsFile)).toHaveLength(2);
    expect(warn).toHaveBeenCalledOnce();
  });
});
