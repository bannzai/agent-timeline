import { describe, expect, it } from "vitest";
import { checkoutOfDirectory, isCheckoutInFilter } from "./project.js";

describe("checkoutOfDirectory", () => {
  it.each([
    // worktree の置き方。worktree の中のディレクトリで動いたセッションも、worktree の一番上を指す。
    [
      "/home/dev/worktrees/dev/acme-shop/fix-tax-rounding",
      "acme-shop",
      "fix-tax-rounding",
      "/home/dev/worktrees/dev/acme-shop/fix-tax-rounding",
    ],
    [
      "/home/dev/worktrees/dev/acme-shop/fix-tax-rounding/tmp/run",
      "acme-shop",
      "fix-tax-rounding",
      "/home/dev/worktrees/dev/acme-shop/fix-tax-rounding",
    ],
    // ghq の本体の checkout。中のディレクトリで動いたセッションも、本体の checkout を指す。
    [
      "/home/dev/ghq/github.com/dev/acme-shop",
      "acme-shop",
      "acme-shop",
      "/home/dev/ghq/github.com/dev/acme-shop",
    ],
    [
      "/home/dev/ghq/github.com/dev/acme-shop/ios",
      "acme-shop",
      "acme-shop",
      "/home/dev/ghq/github.com/dev/acme-shop",
    ],
    // 置き方が分からない作業ディレクトリは、そのディレクトリを本体の checkout とみなす。
    ["/home/dev/acme-shop", "acme-shop", "acme-shop", "/home/dev/acme-shop"],
    ["/home/dev/acme-shop/", "acme-shop", "acme-shop", "/home/dev/acme-shop"],
    // worktree の名前まで無いパスは、worktree の置き方とみなさない。
    [
      "/home/dev/worktrees/dev/acme-shop",
      "acme-shop",
      "acme-shop",
      "/home/dev/worktrees/dev/acme-shop",
    ],
  ])("%s はプロジェクト %s の worktree %s", (directory, projectName, worktreeName, checkout) => {
    expect(checkoutOfDirectory(directory)).toEqual({
      projectName,
      worktreeName,
      directory: checkout,
    });
  });

  it("worktree と本体の checkout を同じプロジェクトにまとめる", () => {
    expect(
      checkoutOfDirectory("/home/dev/worktrees/dev/acme-shop/fix-tax-rounding")?.projectName,
    ).toBe(checkoutOfDirectory("/home/dev/ghq/github.com/dev/acme-shop")?.projectName);
  });

  it.each([null, "/"])("作業ディレクトリが %s の時は null を返す", (directory) => {
    expect(checkoutOfDirectory(directory)).toBeNull();
  });
});

describe("isCheckoutInFilter", () => {
  const checkout = checkoutOfDirectory("/home/dev/worktrees/dev/acme-shop/fix-tax-rounding");

  it("worktree を指定しない時は、プロジェクトの名前だけで決める", () => {
    expect(isCheckoutInFilter(checkout, { projectName: "acme-shop", worktreeName: null })).toBe(
      true,
    );
    expect(isCheckoutInFilter(checkout, { projectName: "notes-app", worktreeName: null })).toBe(
      false,
    );
  });

  it("worktree を指定した時は、worktree の名前も一致するものだけを含める", () => {
    expect(
      isCheckoutInFilter(checkout, { projectName: "acme-shop", worktreeName: "fix-tax-rounding" }),
    ).toBe(true);
    expect(
      isCheckoutInFilter(checkout, { projectName: "acme-shop", worktreeName: "acme-shop" }),
    ).toBe(false);
  });

  it("checkout が分からないセッションは含めない", () => {
    expect(isCheckoutInFilter(null, { projectName: "acme-shop", worktreeName: null })).toBe(false);
  });
});
