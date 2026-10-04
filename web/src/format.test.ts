import { describe, expect, it } from "vitest";
import { collapsedText, projectName, relativeTimeText } from "./format";

describe("relativeTimeText", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it.each([
    ["2026-06-15T12:00:00.000Z", "0秒"],
    ["2026-06-15T11:59:15.000Z", "45秒"],
    ["2026-06-15T11:55:00.000Z", "5分"],
    ["2026-06-15T09:00:00.000Z", "3時間"],
    // 日付は実行する環境の時間帯で決まるため、その時間帯の正午で作り、どの時間帯でも同じ日付になるようにする。
    [new Date(2026, 5, 13, 12).toISOString(), "6月13日"],
    [new Date(2025, 5, 13, 12).toISOString(), "2025年6月13日"],
    // 端末の時計が遅れていて、投稿の日時が今より後になった時。
    ["2026-06-15T12:00:30.000Z", "0秒"],
  ])("%s は %s", (timestamp, expected) => {
    expect(relativeTimeText(timestamp, now)).toBe(expected);
  });
});

describe("collapsedText", () => {
  it("短い本文は省略しない", () => {
    expect(collapsedText("README に起動方法を書いて")).toBeNull();
  });

  it("280 文字を超える本文は先頭の 280 文字にする", () => {
    expect(collapsedText("あ".repeat(281))).toBe("あ".repeat(280));
  });

  it("文字数を絵文字も 1 文字として数え、絵文字を途中で切らない", () => {
    expect(collapsedText("😀".repeat(280))).toBeNull();
    expect(collapsedText("😀".repeat(281))).toBe("😀".repeat(280));
  });

  it("8 行を超える本文は先頭の 8 行にする", () => {
    const lines = Array.from({ length: 9 }, (_, lineIndex) => `${lineIndex + 1} 行目`);

    expect(collapsedText(lines.join("\n"))).toBe(lines.slice(0, 8).join("\n"));
  });

  it("省略した先頭の末尾の空行は落とす", () => {
    const lines = ["1 行目", "2 行目", "", "", "", "", "", "", "9 行目"];

    expect(collapsedText(lines.join("\n"))).toBe("1 行目\n2 行目");
  });
});

describe("projectName", () => {
  it("作業ディレクトリの最後の名前を返す", () => {
    expect(
      projectName({
        agent: "codex",
        sessionId: "session",
        projectDirectory: "/home/dev/acme-shop/",
        gitBranch: null,
      }),
    ).toBe("acme-shop");
  });
});
