// Unit tests of scripts/rmeta-run.ts (lane probe-rmetadump), with a fake compiler and a fake probe (Bun scripts), and a
// check of tools/probes/rmetadump's table list against the pinned rustc_metadata (when the upstream checkout is there).
// rmeta-run.ts imports nothing from scripts/lib, so it is loaded directly. Neither does this file: scripts/lib/common.ts
// reads RUST_TS_DATA when first loaded, and other tests in the same `bun test` process point it at a temp dir first.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bytesLine, differsLine, firstDifference, parseRmetaRunArgs } from "./rmeta-run.ts";

const REPO = resolve(import.meta.dir, "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-rmeta-run-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("parseRmetaRunArgs", () => {
  test("options, then the compiler after the first `--` at an option's place", () => {
    const a = parseRmetaRunArgs(["--out", "d", "--side", "subject", "--bytes", "--dump", "p", "--dump-arg", "--content", "--dump-arg", "--", "--dump-arg", "--target", "--", "rustc", "--", "x"]);
    expect(a).toEqual({ out: "d", side: "subject", bytes: true, dump: "p", dumpPre: ["--content"], dumpPost: ["--target"], compiler: ["rustc", "--", "x"] });
  });
  test("dump args without `--` all follow the file", () => {
    expect(parseRmetaRunArgs(["--out", "d", "--side", "oracle", "--dump-arg", "a", "--", "c"])).toMatchObject({ bytes: false, dumpPre: [], dumpPost: ["a"] });
  });
  test("malformed command lines throw", () => {
    expect(() => parseRmetaRunArgs(["--out", "d", "--side", "oracle"])).toThrow("missing `--`");
    expect(() => parseRmetaRunArgs(["--out", "d", "--side", "oracle", "--"])).toThrow("no compiler");
    expect(() => parseRmetaRunArgs(["--side", "oracle", "--", "c"])).toThrow("required");
    expect(() => parseRmetaRunArgs(["--out", "d", "--side", "both", "--", "c"])).toThrow("--side");
    expect(() => parseRmetaRunArgs(["--out", "d", "--side", "oracle", "--frob", "--", "c"])).toThrow("unknown option");
    expect(() => parseRmetaRunArgs(["--out"])).toThrow("needs a value");
  });
});

describe("byte comparison", () => {
  const f = (name: string, bytes: number[]) => {
    const p = join(TMP, name);
    writeFileSync(p, Buffer.from(bytes));
    return p;
  };
  test("firstDifference", () => {
    const a = f("a", [1, 2, 3]);
    expect(firstDifference(a, f("b", [1, 2, 3]))).toBe(-1);
    expect(firstDifference(a, f("c", [1, 9, 3]))).toBe(1);
    expect(firstDifference(a, f("d", [1, 2]))).toBe(2);
    // Across the 1 MiB read buffer.
    const big = Array.from({ length: (1 << 20) + 10 }, (_, i) => i & 0xff);
    const big2 = [...big];
    big2[(1 << 20) + 3] = 0xaa;
    expect(firstDifference(f("e", big), f("f", big2))).toBe((1 << 20) + 3);
  });
  test("bytesLine and differsLine", () => {
    const a = f("g", [1, 2, 3]);
    expect(bytesLine(a)).toBe("rmeta: 3 bytes, sha256 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    expect(differsLine(a, join(TMP, "none"))).toBeUndefined();
    expect(differsLine(a, f("h", [1, 2, 3]))).toBeUndefined();
    expect(differsLine(a, f("i", [1, 2, 4]))).toMatch(/^rmeta: differs from oracle\.rmeta \(3 bytes, sha256 [0-9a-f]{64}\) first at byte 2$/);
  });
});

describe("rmetaRun (fake compiler and probe)", () => {
  // The fake compiler writes the file after `-o` (its contents: the argument before `-o`), prints to stderr, and exits
  // with $FAKE_EXIT; `nofile` as its argument writes nothing. The fake probe prints its argv (the file's name
  // replaced by FILE) and the file's contents, and exits with $FAKE_PROBE_EXIT.
  const compiler = join(TMP, "compiler.mjs");
  writeFileSync(
    compiler,
    `const a = process.argv.slice(2); const o = a[a.indexOf("-o") + 1];
if (a[0] !== "nofile") require("node:fs").writeFileSync(o, a[a.indexOf("-o") - 1]);
process.stderr.write("warning: compiled " + a[0] + "\\n"); process.exit(Number(process.env.FAKE_EXIT ?? 0));`,
  );
  const probe = join(TMP, "probe.mjs");
  writeFileSync(
    probe,
    `const fs = require("node:fs"); const a = process.argv.slice(2); const f = a.find((x) => x.endsWith(".rmeta"));
console.log("probe " + a.map((x) => (x === f ? "FILE" : x)).join(" ")); console.log("== contents " + fs.readFileSync(f, "utf8"));
process.exit(Number(process.env.FAKE_PROBE_EXIT ?? 0));`,
  );
  const wrapper = join(REPO, "scripts", "rmeta-run.ts");
  const go = (out: string, side: string, opts: string[], src: string, env: Record<string, string> = {}) => {
    const r = Bun.spawnSync([process.execPath, wrapper, "--out", out, "--side", side, ...opts, "--", process.execPath, compiler, src], { env: { ...process.env, ...env } });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), files: existsSync(out) ? readdirSync(out).sort() : [] };
  };
  const dump = ["--dump", process.execPath, "--dump-arg", probe, "--dump-arg", "--content", "--dump-arg", "--", "--dump-arg", "--target", "--dump-arg", "t"];

  test("bytes: the oracle's line; the subject's adds where it differs from the oracle's file", () => {
    const out = join(TMP, "bytes");
    const o = go(out, "oracle", ["--bytes"], "aaaa");
    expect(o).toEqual({ code: 0, stdout: `rmeta: 4 bytes, sha256 ${new Bun.CryptoHasher("sha256").update("aaaa").digest("hex")}\n`, stderr: "warning: compiled aaaa\n", files: ["oracle.rmeta"] });
    const same = go(out, "subject", ["--bytes"], "aaaa");
    expect(same.stdout).toBe(o.stdout);
    const s = go(out, "subject", ["--bytes"], "aaba");
    expect(s.stdout.split("\n")[1]).toMatch(/^rmeta: differs from oracle\.rmeta \(4 bytes, sha256 [0-9a-f]{64}\) first at byte 2$/);
    expect(s.files).toEqual(["oracle.rmeta", "subject.rmeta"]);
    expect(readFileSync(join(out, "subject.rmeta"), "utf8")).toBe("aaba");
  });

  test("dump: the probe's options before the file, its rustc arguments after; no byte line without --bytes", () => {
    const r = go(join(TMP, "dump"), "oracle", dump, "xyz");
    // (Bun runs the probe script, `--dump bun --dump-arg probe.mjs ...`, which prints the arguments after itself.)
    expect(r).toMatchObject({ code: 0, stdout: "probe --content FILE --target t\n== contents xyz\n", files: ["oracle.rmeta"] });
  });

  test("a failing compiler ends the run with its exit code and stderr; no file is kept", () => {
    const r = go(join(TMP, "fail"), "subject", ["--bytes", ...dump], "q", { FAKE_EXIT: "70" });
    expect(r).toEqual({ code: 70, stdout: "", stderr: "warning: compiled q\n", files: [] });
  });

  test("a compiler that writes no file: `rmeta: none`", () => {
    expect(go(join(TMP, "nofile"), "oracle", ["--bytes", ...dump], "nofile")).toMatchObject({ code: 0, stdout: "rmeta: none\n", files: [] });
  });

  test("a failing probe: its exit code, after its output; no file is kept", () => {
    const r = go(join(TMP, "probefail"), "subject", ["--bytes", ...dump], "abc", { FAKE_PROBE_EXIT: "101" });
    expect(r.code).toBe(101);
    expect(r.stdout).toMatch(/^rmeta: 3 bytes, sha256 [0-9a-f]{64}\nprobe --content FILE --target t\n== contents abc\n$/);
    expect(r.files).toEqual([]);
  });

  test("a usage error exits 2", () => {
    const r = Bun.spawnSync([process.execPath, wrapper, "--side", "oracle", "--", "x"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain("--out and --side are required");
  });
});

// tools/probes/rmetadump mirrors `define_tables!` (rmeta/mod.rs) and the `CrateRoot` fields' order: a list that drifts
// from the pinned source would misread every table after the drift.
/**
 * The pinned mod.rs: under RUST_TS_DATA, the repo's .env.local RUST_TS_DATA or .data (as scripts/lib/common.ts), the
 * first that has it (another test file in the same process may have pointed RUST_TS_DATA at a temp dir).
 */
const MOD_RS = ((): string => {
  const local = join(REPO, ".env.local");
  const fromLocal = existsSync(local) ? /^\s*RUST_TS_DATA\s*=\s*(.*?)\s*$/m.exec(readFileSync(local, "utf8"))?.[1] : undefined;
  const paths = [process.env.RUST_TS_DATA, fromLocal, join(REPO, ".data")].filter((d) => d !== undefined).map((d) => join(resolve(d), "rust", "compiler", "rustc_metadata", "src", "rmeta", "mod.rs"));
  return paths.find(existsSync) ?? paths[0]!;
})();
describe.skipIf(!existsSync(MOD_RS))("tools/probes/rmetadump against the pinned rmeta/mod.rs", () => {
  const mod = readFileSync(MOD_RS, "utf8");
  const probe = readFileSync(join(REPO, "tools", "probes", "rmetadump", "main.rs"), "utf8");
  const listOf = (name: string): string => {
    const m = new RegExp(`const ${name}: &\\[[^\\]]*\\] = &\\[([\\s\\S]*?)\\n\\];`).exec(probe);
    if (!m) throw new Error(`no ${name} in the probe`);
    return m[1]!;
  };

  test("TABLES: every table, in order; raw-printed ones are fixed-size", () => {
    const body = /define_tables! \{([\s\S]*?)\n\}/.exec(mod)![1]!;
    const upstream = [...body.matchAll(/^\s*(\w+): Table<(.*)>,$/gm)].map((m) => ({ name: m[1]!, lazy: /^(Option<)?Lazy(Value|Array)</.test(m[2]!) }));
    const ours = [...listOf("TABLES").matchAll(/\("(\w+)", (true|false)\)/g)].map((m) => ({ name: m[1]!, raw: m[2] === "true" }));
    expect(ours.map((t) => t.name)).toEqual(upstream.map((t) => t.name));
    // A fixed-size table is printed raw, except `def_kind` (printed through its query).
    for (const [i, t] of ours.entries()) expect([t.name, t.raw]).toEqual([t.name, !upstream[i]!.lazy && t.name !== "def_kind"]);
    const arrays = [...listOf("ARRAY_TABLES").matchAll(/"(\w+)"/g)].map((m) => m[1]!);
    const lazyArrays = [...body.matchAll(/^\s*(\w+): Table<LazyArray</gm)].map((m) => m[1]!);
    expect(arrays).toEqual(lazyArrays);
  });

  test("ROOT_ARRAYS: the CrateRoot's LazyArray fields up to proc_macro_data", () => {
    const root = /pub\(crate\) struct CrateRoot \{([\s\S]*?)\n\}/.exec(mod)![1]!;
    const fields = [...root.matchAll(/^\s*(\w+): (.*),$/gm)].map((m) => [m[1]!, m[2]!] as const);
    const upTo = fields.slice(0, fields.findIndex(([n]) => n === "proc_macro_data"));
    const arrays = upTo.filter(([, t]) => t.startsWith("LazyArray<")).map(([n]) => n);
    expect([...listOf("ROOT_ARRAYS").matchAll(/"(\w+)"/g)].map((m) => m[1]!)).toEqual(arrays);
    // The fields read_root decodes, in order (scalars, the arrays above, then the rest): every field is accounted for.
    expect(fields.map(([n]) => n)).toEqual([
      "header", "stable_crate_id", "required_panic_strategy", "panic_in_drop_strategy", "edition", "has_global_allocator",
      "has_alloc_error_handler", "has_panic_handler", "has_default_lib_allocator", ...arrays, "proc_macro_data", "tables",
      "debugger_visualizers", "exportable_items", "stable_order_of_exportable_impls", "exported_non_generic_symbols",
      "exported_generic_symbols", "syntax_contexts", "expn_data", "expn_hashes", "def_path_hash_map", "source_map",
      "target_modifiers", "denied_partial_mitigations", "compiler_builtins", "needs_allocator", "needs_panic_runtime",
      "no_builtins", "panic_runtime", "profiler_runtime", "symbol_mangling_version", "specialization_enabled_in",
    ]);
  });
});
