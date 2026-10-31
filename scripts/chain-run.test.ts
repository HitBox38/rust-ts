// Unit tests of scripts/chain-run.ts (lanes harness-m5c, harness-w35), with `bun -e` scripts for the two compilers (no
// shell, so they run on every host). chain-run.ts imports nothing from scripts/lib, so it is loaded directly (see
// rmeta-run.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chainRun, firstOutput, parseChainRunArgs } from "./chain-run.ts";

const CHAIN_RUN = join(import.meta.dir, "chain-run.ts");
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
  /** A child running JavaScript `code` (a `bun -e` script). */
  const js = (code: string) => [process.execPath, "-e", `const fs = require("node:fs"); ${code}`];
  const q = JSON.stringify;
  test("the stale output is removed and its directory made before the first command; the second runs after it", async () => {
    const fresh = join(TMP, "a", "port-core", "libcore.rmeta");
    const log = join(TMP, "a.log");
    const first = js(`if (!fs.statSync(${q(dirname(fresh))}).isDirectory() || fs.existsSync(${q(fresh)})) process.exit(9); fs.appendFileSync(${q(log)}, "first\\n"); fs.writeFileSync(${q(fresh)}, "x\\n");`);
    const second = js(`fs.appendFileSync(${q(log)}, fs.readFileSync(${q(fresh)})); process.exit(3);`);
    expect(await chainRun({ fresh, first, second })).toBe(3);
    expect(readFileSync(log, "utf8")).toBe("first\nx\n");
    // A stale file is gone before the first command runs.
    writeFileSync(fresh, "stale");
    expect(await chainRun({ fresh, first: js(`process.exit(fs.existsSync(${q(fresh)}) ? 1 : 0)`), second: js("") })).toBe(0);
  });
  test("a failing first command ends the run with its code; the second never runs", async () => {
    const fresh = join(TMP, "b", "libcore.rmeta");
    const marker = join(TMP, "b.second");
    expect(await chainRun({ fresh, first: js("process.exit(70)"), second: js(`fs.writeFileSync(${q(marker)}, "")`) })).toBe(70);
    expect(existsSync(marker)).toBe(false);
  });

  /** chain-run.ts as difftest runs it (a process of its own): its exit code, stdout and stderr. */
  const chain = (fresh: string, first: string[], second: string[]) => {
    const r = Bun.spawnSync([process.execPath, CHAIN_RUN, "--fresh", fresh, "--first", String(first.length), "--", ...first, ...second], { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };
  const both = (tag: string, code = 0) => js(`process.stdout.write(${q(`${tag} out\n`)}); process.stderr.write(${q(`${tag} err\n`)}); process.exit(${code});`);
  test("a successful first command's output is kept aside: only the second's is the run's output", () => {
    const fresh = join(TMP, "c", "libcore.rmeta");
    expect(chain(fresh, both("core"), both("alloc", 1))).toEqual({ code: 1, stdout: "alloc out\n", stderr: "alloc err\n" });
    const out = firstOutput(fresh);
    expect([readFileSync(out.stdout, "utf8"), readFileSync(out.stderr, "utf8")]).toEqual(["core out\n", "core err\n"]);
    // Each run starts the files afresh.
    expect(chain(fresh, js(""), both("alloc"))).toEqual({ code: 0, stdout: "alloc out\n", stderr: "alloc err\n" });
    expect([readFileSync(out.stdout, "utf8"), readFileSync(out.stderr, "utf8")]).toEqual(["", ""]);
  });
  test("a failing first command's output is the run's output, with its exit code", () => {
    const fresh = join(TMP, "d", "libcore.rmeta");
    expect(chain(fresh, both("core", 70), both("alloc"))).toEqual({ code: 70, stdout: "core out\n", stderr: "core err\n" });
  });
});
