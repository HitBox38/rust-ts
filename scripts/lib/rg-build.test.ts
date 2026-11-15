// The pure parts of the M7d ripgrep suites (scripts/lib/rg-build.ts) and pm-self's command line (scripts/pm-self-run.ts). What cargo and rg
// really do is measured by the suites: a unit test must stay cheap (plan-m7 §6, review F5).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NO_RESULT_MARK, ancestorIgnoreFiles, artifactLines, buildExit, callKind, callLine, comparedBytes, corpusBytes, libtestResult, maskRgTimes, noResultReason, normaliseCargoStderr, notArtifact, rgtestSections, unportedLine, walkFiles } from "./rg-build.ts";
import { AUX_PLACEHOLDER, parsePmSelfArgs } from "../pm-self-run.ts";

const TMP = mkdtempSync(join(tmpdir(), "rust-ts-rg-build-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("cargo's stderr", () => {
  test("paths named, the Finished time masked in every form, Compiling lines sorted and counted, the rest in order", () => {
    const text = [
      "   Compiling serde v1.0.228",
      "warning: a warning from /data/ripgrep/cargo/registry/src/x.rs",
      "   Compiling memchr v2.7.6",
      "    Finished `release` profile [optimized + debuginfo] target(s) in 1m 02s",
      "",
    ].join("\r\n");
    expect(normaliseCargoStderr(text, [["/data", "$DATA"], ["/data/ripgrep", "$RG_ROOT"]])).toEqual([
      "compiling: 2",
      "  Compiling memchr v2.7.6",
      "  Compiling serde v1.0.228",
      "the rest, in order:",
      "  warning: a warning from $RG_ROOT/cargo/registry/src/x.rs",
      "      Finished `release` profile [optimized + debuginfo] target(s) in <time>",
    ]);
    for (const t of ["42.13s", "7s", "1h 03m 04s"]) expect(normaliseCargoStderr(`    Finished x in ${t}`, []).at(-1)).toBe("      Finished x in <time>");
    // Only the Finished line's time: a compiler's message that ends the same way is compared as it is.
    expect(normaliseCargoStderr("note: took in 3s", []).at(-1)).toBe("  note: took in 3s");
  });
});

describe("calls and exit", () => {
  test("a call that asks the compiler about itself is a probe", () => {
    expect(callKind(["-vV"])).toBe("probe");
    expect(callKind(["--version"])).toBe("probe");
    expect(callKind(["-", "--print=cfg"])).toBe("probe");
    expect(callKind(["--crate-name", "build_script_build", "build.rs"])).toBe("compile");
  });
  test("a call's line: its stdout (a probe's answer to cargo, review N3) and its stderr", () => {
    const empty = "0 bytes, sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(callLine({ kind: "probe", crate: "-", metadata: "none", code: 0, stdout: "5 bytes, sha256 x" }, new Uint8Array())).toBe(`  probe - none: exit 0, stdout 5 bytes, sha256 x, stderr ${empty}`);
  });
  test("the no-result mark is found only at the start of a stderr line", () => {
    expect(noResultReason(`warning: x\n${NO_RESULT_MARK}the build was interrupted (SIGTERM)\n`)).toBe("detected: the ripgrep harness had no result: the build was interrupted (SIGTERM)");
    expect(noResultReason(`a ${NO_RESULT_MARK}x`)).toBeUndefined();
    expect(noResultReason("")).toBeUndefined();
  });
  test("the port's first unported stop is UNPORTED, a panic a crash, otherwise 0", () => {
    expect(unportedLine("a\nrust-ts: unported: rustc_codegen_llvm::x\nb")).toBe("rust-ts: unported: rustc_codegen_llvm::x");
    expect(buildExit([{ code: 0, stderrText: "" }, { code: 70, stderrText: "rust-ts: unported: a" }, { code: 70, stderrText: "rust-ts: unported: b" }])).toEqual({ code: 70, unported: "rust-ts: unported: a" });
    expect(buildExit([{ code: 101, stderrText: "error: internal compiler error" }])).toEqual({ code: 101 });
    expect(buildExit([{ code: 1, stderrText: "error[E0308]" }])).toEqual({ code: 0 });
  });
});

describe("artifacts", () => {
  test("bookkeeping is no artifact; dep-info and build-script outputs are compared by bytes, the rest by name", () => {
    expect([".fingerprint/x-1/lib", "incremental", ".cargo-lock", "deps/rg-1", "build/x-1/out/a.rs"].map(notArtifact)).toEqual([true, true, true, false, false]);
    expect(["deps/x-1.d", "rg.d", "build/x-1/output", "build/x-1/stderr", "build/x-1/root-output", "build/x-1/out/output", "deps/libx-1.rlib", "rg"].map(comparedBytes)).toEqual([true, true, true, true, true, false, false, false]);
    // The oracle cargo's build-dir layout (review F3): a build script's run under `<package>/<hash>/run`, its printed `cargo:` lines in
    // `stdout`, seen in every one of the oracle tree's 10 runs; its `out` directory is not compared by bytes, nor an `output` there.
    expect(["build/serde/f8aa/run/stdout", "build/serde/f8aa/run/stderr", "build/serde/f8aa/run/root-output", "build/serde/f8aa/run/invoked.timestamp", "build/serde/f8aa/out/stdout", "build/serde/f8aa/out/x.d", "build/serde/f8aa/run/output"].map(comparedBytes)).toEqual([true, true, true, false, false, true, false]);
    const p = join(TMP, "release");
    for (const d of [".fingerprint/a", "deps", "build/b-1/out"]) mkdirSync(join(p, d), { recursive: true });
    writeFileSync(join(p, ".fingerprint/a/x"), "1");
    writeFileSync(join(p, "deps/a-1.d"), "dep");
    writeFileSync(join(p, "deps/liba-1.rlib"), "rlib");
    writeFileSync(join(p, "build/b-1/output"), "cargo:rustc-cfg=x\n");
    writeFileSync(join(p, "rg"), "bin");
    expect(walkFiles(p)).toEqual([".fingerprint/a/x", "build/b-1/output", "deps/a-1.d", "deps/liba-1.rlib", "rg"]);
    const lines = artifactLines(p);
    expect(lines.slice(0, 5)).toEqual(["artifacts: 4 files", "  build/b-1/output", "  deps/a-1.d", "  deps/liba-1.rlib", "  rg"]);
    expect(lines.slice(5).map((l) => l.split(":")[0])).toEqual(["  bytes build/b-1/output", "  bytes deps/a-1.d"]);
    expect(artifactLines(join(TMP, "none"))).toEqual(["artifacts: 0 files"]);
  });
});

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

// scripts/rg-build.ts loads scripts/lib/common.ts, so these run in a child process (see scripts/lib/deps.test.ts for why).
test("kept keys: a recent one stays, an old one and a dead build's temp directory go, the current one never (review N2)", () => {
  const bin = join(TMP, "bin");
  for (const d of ["cur", "recent", "old", "x.tmp-999999", `y.tmp-${process.pid}`]) mkdirSync(join(bin, d), { recursive: true });
  const t = (Date.now() - 4 * 24 * 3_600_000) / 1000;
  utimesSync(join(bin, "old"), t, t);
  utimesSync(join(bin, "cur"), t, t);
  const code = `const { pruneKeys } = await import(${JSON.stringify(resolve(import.meta.dir, "..", "rg-build.ts"))}); console.log(JSON.stringify(pruneKeys(${JSON.stringify(bin)}, "cur").sort()));`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  expect(JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!)).toEqual(["old", "x.tmp-999999"]);
  for (const d of ["cur", "recent", `y.tmp-${process.pid}`]) expect(existsSync(join(bin, d))).toBe(true);
});

test("a build's leftover processes are found by their RGB_TREE and killed, and no other (review F2)", async () => {
  const tree = join(TMP, "tree-for-sweep");
  // A Bun process, as the port's compiler is: macOS's `ps -E` shows no environment for a platform binary such as /bin/sleep.
  const mark = (v: string) => Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { env: { ...process.env, RGB_TREE: v }, stdout: "ignore", stderr: "ignore" });
  const mine = mark(tree);
  const other = mark(`${tree}-other`);
  try {
    await Bun.sleep(300);
    const code = `const { killBuildProcesses } = await import(${JSON.stringify(resolve(import.meta.dir, "..", "rg-build.ts"))}); console.log(JSON.stringify(killBuildProcesses(${JSON.stringify(tree)})));`;
    const r = Bun.spawnSync([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!)).toEqual([mine.pid]);
    await mine.exited;
    expect(mine.signalCode).toBe("SIGKILL");
    expect(other.exitCode).toBeNull();
  } finally {
    other.kill("SIGKILL");
    mine.kill("SIGKILL");
  }
});
