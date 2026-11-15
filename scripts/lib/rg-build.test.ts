// The pure parts of the M7d ripgrep suites (scripts/lib/rg-build.ts) and pm-self's command line (scripts/pm-self-run.ts). What cargo and rg
// really do is measured by the suites: a unit test must stay cheap (plan-m7 §6, review F5).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactLines, buildExit, callKind, callLine, comparedBytes, corpusBytes, libtestResult, maskRgTimes, normaliseCargoStderr, notArtifact, rgtestSections, unportedLine, walkFiles } from "./rg-build.ts";
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
  test("a call's line", () => {
    expect(callLine({ kind: "compile", crate: "memchr", metadata: "ab", code: 0 }, new Uint8Array())).toBe(
      "  compile memchr ab: exit 0, stderr 0 bytes, sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
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
    // The oracle cargo's build-dir layout: a build script's run under `<package>/<hash>/run`; its `out` directory is not compared by bytes.
    expect(["build/serde/f8aa/run/output", "build/serde/f8aa/run/stderr", "build/serde/f8aa/run/root-output", "build/serde/f8aa/out/output", "build/serde/f8aa/out/x.d"].map(comparedBytes)).toEqual([true, true, true, false, true]);
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
