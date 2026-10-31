// Unit tests of scripts/chain-run.ts (lane harness-m5c), with shell commands for the two compilers. chain-run.ts
// imports nothing from scripts/lib, so it is loaded directly (see rmeta-run.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chainRun, parseChainRunArgs } from "./chain-run.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-chain-run-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("parseChainRunArgs", () => {
  test("the first n words after `--` are the first command, the rest the second", () => {
    expect(parseChainRunArgs(["--fresh", "f", "--first", "2", "--", "a", "-o", "b", "--", "c"])).toEqual({ fresh: "f", first: ["a", "-o"], second: ["b", "--", "c"] });
  });
  test("malformed command lines throw", () => {
    expect(() => parseChainRunArgs(["--first", "1", "--", "a", "b"])).toThrow("usage");
    expect(() => parseChainRunArgs(["--fresh", "f", "--first", "1", "a", "b"])).toThrow("usage");
    expect(() => parseChainRunArgs(["--fresh", "f", "--first", "0", "--", "a", "b"])).toThrow("non-empty");
    expect(() => parseChainRunArgs(["--fresh", "f", "--first", "2", "--", "a", "b"])).toThrow("non-empty");
    expect(() => parseChainRunArgs(["--fresh", "f", "--first", "x", "--", "a", "b"])).toThrow("non-empty");
  });
});

describe("chainRun", () => {
  const sh = (script: string) => ["/bin/sh", "-c", script];
  test("the stale output is removed and its directory made before the first command; the second runs after it", async () => {
    const fresh = join(TMP, "a", "port-core", "libcore.rmeta");
    const log = join(TMP, "a.log");
    expect(await chainRun({ fresh, first: sh(`test -d ${resolve(fresh, "..")} && test ! -e ${fresh} && echo first >> ${log} && echo x > ${fresh}`), second: sh(`cat ${fresh} >> ${log}; exit 3`) })).toBe(3);
    expect(readFileSync(log, "utf8")).toBe("first\nx\n");
    // A stale file is gone before the first command runs.
    writeFileSync(fresh, "stale");
    expect(await chainRun({ fresh, first: sh(`test ! -e ${fresh}`), second: sh("exit 0") })).toBe(0);
  });
  test("a failing first command ends the run with its code; the second never runs", async () => {
    const fresh = join(TMP, "b", "libcore.rmeta");
    const marker = join(TMP, "b.second");
    expect(await chainRun({ fresh, first: sh("exit 70"), second: sh(`touch ${marker}`) })).toBe(70);
    expect(existsSync(marker)).toBe(false);
  });
});
