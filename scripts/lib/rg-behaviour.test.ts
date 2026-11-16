// The pure parts of the M7d ripgrep behaviour suites (scripts/lib/rg-behaviour.ts) and pm-self's command line (scripts/pm-self-run.ts). The
// build parts are in scripts/lib/cargo-project-build.test.ts (lane harness-m8a-build split them). What cargo and rg really do is measured by
// the suites: a unit test must stay cheap (plan-m7 §6, review F5).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ancestorIgnoreFiles, corpusBytes, libtestResult, maskRgTimes, rgtestSections } from "./rg-behaviour.ts";
import { AUX_PLACEHOLDER, parsePmSelfArgs } from "../pm-self-run.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-rg-behaviour-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("rg-behaviour", () => {
  test("ignore files above the corpus are found up to the root (review N4)", () => {
    const top = join(TMP, "anc");
    mkdirSync(join(top, "a", "b", "corpus"), { recursive: true });
    expect(ancestorIgnoreFiles(join(top, "a", "b", "corpus")).filter((f) => f.startsWith(top))).toEqual([]);
    writeFileSync(join(top, "a", ".rgignore"), "*\n");
    writeFileSync(join(top, ".ignore"), "*\n");
    expect(ancestorIgnoreFiles(join(top, "a", "b", "corpus")).filter((f) => f.startsWith(top))).toEqual([join(top, "a", ".rgignore"), join(top, ".ignore")]);
  });
  test("only rg's times are masked: --json's elapsed objects in both field orders, --stats's seconds", () => {
    const end = '{"type":"end","data":{"stats":{"elapsed":{"secs":0,"nanos":155416,"human":"0.000155s"},"searches":1}}}';
    const summary = '{"data":{"elapsed_total":{"human":"0.002449s","nanos":2449208,"secs":0},"stats":{"elapsed":{"human":"0.0001s","nanos":100000,"secs":1}}}}';
    expect(maskRgTimes(end)).toBe('{"type":"end","data":{"stats":{"elapsed":"<time>","searches":1}}}');
    expect(maskRgTimes(summary)).toBe('{"data":{"elapsed_total":"<time>","stats":{"elapsed":"<time>"}}}');
    expect(maskRgTimes("0.000123 seconds spent searching\n0.001 seconds\n1 matches")).toBe("<time> seconds spent searching\n<time> seconds\n1 matches");
    // A match's own text is not a time.
    expect(maskRgTimes('{"lines":{"text":"elapsed 0.5 seconds"}}')).toBe('{"lines":{"text":"elapsed 0.5 seconds"}}');
  });
  test("corpus files: text as UTF-8, bytes from base64", () => {
    expect(corpusBytes("é")).toEqual(Buffer.from([0xc3, 0xa9]));
    expect(corpusBytes({ base64: Buffer.from([0, 0xe9]).toString("base64") })).toEqual(Buffer.from([0, 0xe9]));
  });
  test("libtest's results, one section per test, sorted", () => {
    expect(libtestResult("test feature::f1 ... ok")).toEqual({ name: "feature::f1", result: "ok" });
    expect(libtestResult("test a ... ignored, needs xz")).toEqual({ name: "a", result: "ignored, needs xz" });
    expect(libtestResult("test result: ok. 3 passed")).toBeUndefined();
    expect(rgtestSections("running 2 tests\ntest b ... FAILED\ntest a ... ok\n\nfailures:\n")).toEqual(["== a", "  ok", "== b", "  FAILED"]);
  });
});

describe("pm-self's command line", () => {
  const step = JSON.stringify({ file: "tests/ui/auxiliary/pm.rs", args: ["--out-dir", AUX_PLACEHOLDER], env: { PATH: "/usr/bin" } });
  test("options, steps in order, and the main argv after `--`", () => {
    const a = parsePmSelfArgs(["--side", "subject", "--dir", "/d", "--compiler", '["bun","main.ts"]', "--aux-key", "k", "--step", step, "--step", step, "--", "a.rs", "--edition=2021"]);
    expect(a).toEqual({ side: "subject", dir: "/d", auxKey: "k", compiler: ["bun", "main.ts"], steps: [JSON.parse(step), JSON.parse(step)], main: ["a.rs", "--edition=2021"] });
  });
  test("the gate's empty case parses with no main argv; malformed ones throw", () => {
    expect(parsePmSelfArgs(["--side", "oracle", "--dir", "/d", "--compiler", '["rustc","+nightly"]']).main).toEqual([]);
    const bad = (argv: string[]) => () => parsePmSelfArgs(argv);
    expect(bad(["--side", "x", "--dir", "/d", "--compiler", '["rustc"]'])).toThrow("--side");
    expect(bad(["--side", "oracle", "--dir", "/d", "--compiler", "[]"])).toThrow("--compiler");
    expect(bad(["--side", "oracle", "--dir", "/d", "--compiler", '["rustc"]', "--step", "{}"])).toThrow("--step");
    expect(bad(["--side", "oracle", "--compiler", '["rustc"]'])).toThrow("required");
    expect(bad(["--side", "oracle", "--dir", "/d", "--compiler", '["rustc"]', "--what", "x"])).toThrow("unknown option");
  });
});
