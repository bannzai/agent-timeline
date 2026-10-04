import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localIsoTimestamp, usageLogDirectoryFromEnv } from "./usage-log.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("usageLogDirectoryFromEnv", () => {
  it("AGENT_TIMELINE_USAGE_DIR があればそのディレクトリを返す", () => {
    expect(usageLogDirectoryFromEnv({ AGENT_TIMELINE_USAGE_DIR: "/usage" })).toBe("/usage");
  });

  it("AGENT_TIMELINE_USAGE_DIR が無ければホームディレクトリの .agent-timeline を返す", () => {
    expect(usageLogDirectoryFromEnv({})).toBe(path.join(os.homedir(), ".agent-timeline"));
  });
});

describe("localIsoTimestamp", () => {
  // Node は実行中に変えた TZ をそのまま使うため、テストごとにタイムゾーンを切り替えられる。
  it.each([
    ["Asia/Tokyo", "2026-10-05T08:30:15+09:00"],
    ["America/Los_Angeles", "2026-10-04T16:30:15-07:00"],
    ["UTC", "2026-10-04T23:30:15+00:00"],
  ])("%s では、その地域の暦の日付と時差で書く", (timeZone, expected) => {
    vi.stubEnv("TZ", timeZone);

    expect(localIsoTimestamp(new Date("2026-10-04T23:30:15.678Z"))).toBe(expected);
  });
});
