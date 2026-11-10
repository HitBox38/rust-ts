// scripts/lib/subject-bin.ts: the mode, the source rewrites, the cache key, the builder (on a small fixture tree) and the source
// fallback. The real entries' builds are checked by the lane's evidence runs (docs/handoff/subject-bin.md), not here.
// Run by scripts/subject-bin.test.ts in a child `bun test` with RUST_TS_DATA at a temp dir: this file loads scripts/lib/common.ts,
// which reads RUST_TS_DATA once, at import, so in the runner unit-test process it must not load first (see scripts/lib/deps.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./lib/common.ts";
import {
  BINARY_ENTRIES,
  DEFAULT_SUBJECT_MODE,
  binaryModeRefusal,
  buildFiles,
  buildSpec,
  CONFIG_FILES,
  ensureSubjectBin,
  metaFnName,
  pruneSubjectBins,
  rewriteExportStar,
  rewriteImportMeta,
  rewriteModule,
  subjectBinKeyOf,
  subjectCmd,
  subjectModeOf,
  subjectRecord,
  usesBinary,
  VALIDATED_BUN,
} from "./lib/subject-bin.ts";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "subject-bin-test-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("mode", () => {
  test("unset is the default; binary and source are taken; anything else is an error", () => {
    expect(subjectModeOf({})).toEqual({ mode: DEFAULT_SUBJECT_MODE });
    expect(subjectModeOf({ RUST_TS_SUBJECT: "" })).toEqual({ mode: DEFAULT_SUBJECT_MODE });
    expect(subjectModeOf({ RUST_TS_SUBJECT: "binary" })).toEqual({ mode: "binary" });
    expect(subjectModeOf({ RUST_TS_SUBJECT: "source" })).toEqual({ mode: "source" });
    expect(subjectModeOf({ RUST_TS_SUBJECT: "bin" })).toHaveProperty("error");
  });

  test("binary mode refuses any BUN_JSC_ option in the environment", () => {
    const ok = VALIDATED_BUN[0]!;
    expect(binaryModeRefusal({ PATH: "/bin" }, ok)).toBeUndefined();
    expect(binaryModeRefusal({ BUN_JSC_useTailCalls: "0" }, ok)).toContain("BUN_JSC_useTailCalls");
  });

  test("binary mode refuses a Bun build not in VALIDATED_BUN (review F2)", () => {
    const ok = VALIDATED_BUN[0]!;
    expect(binaryModeRefusal({}, { version: "1.4.4", revision: ok.revision })).toContain("not a validated build");
    expect(binaryModeRefusal({}, { version: ok.version, revision: "0".repeat(40) })).toContain("not a validated build");
  });

  test("only the binary entries use a build, and only in binary mode", () => {
    expect(BINARY_ENTRIES).toContain("src/rust_ts/main.ts");
    expect(usesBinary("src/rust_ts/main.ts", "binary")).toBe(true);
    expect(usesBinary("src/rust_ts/main.ts", "source")).toBe(false);
    expect(usesBinary("src/rust_ts/tydump.ts", "binary")).toBe(false);
  });
});

describe("source fallback", () => {
  test("source mode gives the commands the harness ran before the lane", () => {
    expect(subjectCmd("src/rust_ts/main.ts", ["-x", "f.rs"], { mode: "source" })).toEqual([process.execPath, join(REPO, "src/rust_ts/main.ts"), "-x", "f.rs"]);
    expect(subjectCmd("src/miri/bin/miri.ts", ["a"], { mode: "source", preload: "src/rust_ts/miri_stack_first.ts" })).toEqual([
      process.execPath,
      "--preload",
      join(REPO, "src/rust_ts/miri_stack_first.ts"),
      join(REPO, "src/miri/bin/miri.ts"),
      "a",
    ]);
  });

  test("an entry with no build runs from source in binary mode too, with nothing built", () => {
    expect(subjectCmd("src/rust_ts/lexdump.ts", ["f"], { mode: "binary" })).toEqual([process.execPath, join(REPO, "src/rust_ts/lexdump.ts"), "f"]);
    expect(subjectRecord("source")).toEqual({ mode: "source", bins: {} });
  });
});

describe("rewrites keep every line and column", () => {
  const file = "/r/src/a/b.ts";
  test("each import.meta property becomes a same-length call to a hoisted function returning the source's value", () => {
    const text = 'const d = import.meta.dir; f(import.meta.path, 1);\nconst u = new URL("x", import.meta.url); g(import.meta.dirname, import.meta.filename, import.meta.file);';
    const out = rewriteImportMeta(text, file)!;
    const lines = out.split("\n");
    for (const [i, l] of text.split("\n").entries()) {
      expect(lines[i]!.length).toBe(l.length);
      // Everything but the replaced spans is unchanged, so every call keeps its column.
      expect(lines[i]!.indexOf("f(")).toBe(l.indexOf("f("));
    }
    for (const p of ["dir", "path", "url", "dirname", "filename", "file"] as const) expect(`${metaFnName(p)}()`.length).toBe(`import.meta.${p}`.length);
    const values = new Function(`${out.replace(/^const .*$/gm, "")}; return [${metaFnName("dir")}(), ${metaFnName("path")}(), ${metaFnName("url")}(), ${metaFnName("file")}(), ${metaFnName("dirname")}(), ${metaFnName("filename")}()];`.replace(/^f\(.*$|^g\(.*$/gm, ""))();
    expect(values).toEqual(["/r/src/a", file, "file:///r/src/a/b.ts", "b.ts", "/r/src/a", file]);
  });

  test("main, env and comments are left alone; other uses stop the build", () => {
    expect(rewriteImportMeta("if (import.meta.main) x(import.meta.env.A);", file)).toBe("if (import.meta.main) x(import.meta.env.A);");
    expect(rewriteImportMeta("// see import.meta.dir\nx();", file)).toBe("// see import.meta.dir\nx();");
    expect(rewriteImportMeta("x();", file)).toBeUndefined();
    expect(() => rewriteImportMeta("const m = import.meta;", file)).toThrow("not a use");
    expect(() => rewriteImportMeta("import.meta.resolve('x');", file)).toThrow("not a use");
    expect(() => rewriteImportMeta('const s = "import.meta.dir";', file)).toThrow("inside a string");
  });

  test("a star re-export gets a side-effect import of the same module before it, on its line", () => {
    const text = 'import { a } from "./a.ts";\nexport * from "./b.ts";\nexport * as c from \'./c.ts\';\nexport { d } from "./d.ts";';
    expect(rewriteExportStar(text, file)).toBe('import { a } from "./a.ts";\nimport "./b.ts"; export * from "./b.ts";\nimport \'./c.ts\'; export * as c from \'./c.ts\';\nexport { d } from "./d.ts";');
    expect(rewriteExportStar('export { d } from "./d.ts";', file)).toBeUndefined();
    expect(() => rewriteExportStar('export * from "./b.ts" // why', file)).toThrow("star re-export");
    expect(rewriteModule('export * from "./b.ts";\nf(import.meta.dir);', file)).toStartWith(`import "./b.ts"; export * from "./b.ts";\nf(${metaFnName("dir")}());`);
  });
});

describe("cache key", () => {
  const spec = buildSpec("scripts/subject-bin.cases.ts");
  const inputs = [
    { path: "src/a.ts", sha1: "1" },
    { path: "src/b.ts", sha1: "2" },
  ];
  const bun = { version: "1.4.3", revision: "abc" };
  const k = subjectBinKeyOf(spec, inputs, bun, "builder");
  test("the same inputs give the same key", () => {
    expect(subjectBinKeyOf(spec, inputs.map((i) => ({ ...i })), { ...bun }, "builder")).toBe(k);
  });
  test("a file's content or path, the Bun build, the builder, an option, the repo or the bun path changes it", () => {
    expect(subjectBinKeyOf(spec, [inputs[0]!, { path: "src/b.ts", sha1: "3" }], bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, [inputs[0]!, { path: "src/c.ts", sha1: "2" }], bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, [inputs[0]!], bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, { version: "1.4.4", revision: "abc" }, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, { version: "1.4.3", revision: "abd" }, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, bun, "builder2")).not.toBe(k);
    expect(subjectBinKeyOf({ ...spec, compile: { ...spec.compile, autoloadDotenv: false } }, inputs, bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf({ ...spec, repo: "/elsewhere" }, inputs, bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf({ ...spec, bunPath: "/other/bun" }, inputs, bun, "builder")).not.toBe(k);
  });
  test("each config file's content, or its absence, changes it (review F1)", () => {
    const config = CONFIG_FILES.map((p) => ({ path: p, sha1: "c" }));
    const kc = subjectBinKeyOf(spec, inputs, bun, "builder", config);
    for (let i = 0; i < config.length; i++) {
      const changed = config.map((c, j) => (j === i ? { ...c, sha1: "d" } : c));
      const absent = config.map((c, j) => (j === i ? { ...c, sha1: "absent" } : c));
      expect(subjectBinKeyOf(spec, inputs, bun, "builder", changed)).not.toBe(kc);
      expect(subjectBinKeyOf(spec, inputs, bun, "builder", absent)).not.toBe(kc);
    }
  });
});

describe("builder (fixture tree)", () => {
  const repo = join(tmp, "repo");
  const root = join(tmp, "cache");
  mkdirSync(join(repo, "src", "lib"), { recursive: true });
  // What the binary must report as `bun <entry>` does: import.meta of an imported module, argv[0..1], Bun.main, NODE_ENV read at
  // run time, and the order of a star re-export against a later named one.
  writeFileSync(join(repo, "src", "lib", "where.ts"), "globalThis.order = [...(globalThis.order ?? []), 'where'];\nexport const where = () => [import.meta.dir, import.meta.path, import.meta.url];\n");
  writeFileSync(join(repo, "src", "lib", "star.ts"), "globalThis.order = [...(globalThis.order ?? []), 'star'];\nexport const s = 1;\n");
  writeFileSync(join(repo, "src", "lib", "named.ts"), "globalThis.order = [...(globalThis.order ?? []), 'named'];\nexport const n = 2;\n");
  writeFileSync(join(repo, "src", "lib", "mod.ts"), 'export * from "./star.ts";\nexport { n } from "./named.ts";\n');
  writeFileSync(
    join(repo, "src", "entry.ts"),
    'import { where } from "./lib/where.ts";\nimport { s, n } from "./lib/mod.ts";\nconsole.log(JSON.stringify({ where: where(), argv: process.argv.slice(0, 3), main: Bun.main, node_env: process.env.NODE_ENV ?? null, order: globalThis.order, s, n }));\n',
  );
  const noSmoke = () => undefined;

  test("a build behaves as `bun <entry>`, is cached, and a second call finds it", async () => {
    const b = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
    expect(b.built).toBe(true);
    expect(b.inputs).toBe(5);
    expect(existsSync(join(root, b.hash, "meta.json"))).toBe(true);
    for (const env of [{}, { NODE_ENV: "test" }]) {
      const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: tmp, env: { ...process.env, ...env, NODE_ENV: undefined, ...env }, stdout: "pipe" }).stdout.toString();
      expect(run([b.path, "x"])).toBe(run([process.execPath, join(repo, "src", "entry.ts"), "x"]));
    }
    const again = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
    expect(again).toEqual({ ...b, built: false });
  });

  test("a changed input makes a new build; concurrent builds of one key end in one directory", async () => {
    writeFileSync(join(repo, "src", "lib", "named.ts"), "globalThis.order = [...(globalThis.order ?? []), 'named'];\nexport const n = 3;\n");
    // Two processes build the same key at once: both end with the one build that won the rename.
    const script = `import { ensureSubjectBin } from ${JSON.stringify(join(REPO, "scripts/lib/subject-bin.ts"))}; console.log(JSON.stringify(await ensureSubjectBin("src/entry.ts", { repo: ${JSON.stringify(repo)}, root: ${JSON.stringify(root)}, smoke: () => undefined })));`;
    const procs = [0, 1].map(() => Bun.spawn([process.execPath, "-e", script], { cwd: tmp, stdout: "pipe", stderr: "pipe" }));
    const [a, b] = await Promise.all(procs.map(async (p) => JSON.parse((await new Response(p.stdout).text()).trim()) as { hash: string; path: string; built: boolean }));
    expect(a!.hash).toBe(b!.hash);
    expect(a!.path).toBe(b!.path);
    expect(existsSync(a!.path)).toBe(true);
    expect(readdirSync(root).filter((n) => n.startsWith(".tmp-"))).toEqual([]);
    expect(readdirSync(root).filter((n) => !n.startsWith("."))).toHaveLength(2);
  });

  test("a failed check or a failed build leaves nothing in the cache and throws", async () => {
    writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 4;\n");
    const before = readdirSync(root).sort();
    await expect(ensureSubjectBin("src/entry.ts", { repo, root, smoke: () => "different" })).rejects.toThrow("fails its check: different");
    writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = ;\n");
    await expect(ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke })).rejects.toThrow("failed");
    expect(readdirSync(root).sort()).toEqual(before);
  });

  test("prune removes builds unused for the given time, never a kept one", () => {
    const names = readdirSync(root).filter((n) => !n.startsWith("."));
    const old = Date.now() / 1000 - 10 * 24 * 3600;
    for (const n of names) utimesSync(join(root, n, "meta.json"), old, old);
    const removed = pruneSubjectBins([join(root, names[0]!)], 3 * 24 * 3600 * 1000, root);
    expect(removed.sort()).toEqual(names.slice(1).sort());
    expect(readdirSync(root)).toEqual([names[0]!]);
  });

  test("a tsconfig.json edit makes a new build, though no bundled file changed (review F1)", async () => {
    writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 5;\n");
    const a = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
    writeFileSync(join(repo, "tsconfig.json"), JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }));
    const b = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
    expect(b.hash).not.toBe(a.hash);
    expect(b.built).toBe(true);
    expect(b.inputs).toBe(a.inputs);
  });

  test("a build keeps only the binary and meta.json, and its frames still name the source's file, line and column (w40g-audit N3)", async () => {
    // The frame comes from an imported module: the embedded map must resolve it with no `rts.map` beside the binary.
    writeFileSync(join(repo, "src", "lib", "frame_lib.ts"), "export function frame(): string {\n  return new Error().stack!.split('\\n').find((l) => l.includes('frame_lib'))!.trim();\n}\n");
    writeFileSync(join(repo, "src", "frame.ts"), 'import { frame } from "./lib/frame_lib.ts";\nconsole.log(frame());\n');
    const b = await ensureSubjectBin("src/frame.ts", { repo, root, smoke: noSmoke });
    expect(readdirSync(b.dir).sort()).toEqual(["meta.json", "rts"]);
    const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: tmp, stdout: "pipe" }).stdout.toString().trim();
    const fromSource = run([process.execPath, join(repo, "src", "frame.ts")]);
    expect(fromSource).toContain(`${join(repo, "src", "lib", "frame_lib.ts")}:2:`);
    // The build names the file relative to the repo (docs/handoff/subject-bin.md 4.1), at the same line and column.
    expect(run([b.path])).toBe(fromSource.replace(`${repo}/`, ""));
  });

  test("buildFiles deletes the stray map and refuses any other file", () => {
    const d = join(tmp, "build-files");
    mkdirSync(d);
    writeFileSync(join(d, "rts"), "");
    writeFileSync(join(d, "rts.map"), "{}");
    buildFiles(d);
    expect(readdirSync(d)).toEqual(["rts"]);
    buildFiles(d);
    writeFileSync(join(d, "rts.extra"), "");
    expect(() => buildFiles(d)).toThrow('a build left ["rts","rts.extra"], not just rts');
    rmSync(join(d, "rts"));
    rmSync(join(d, "rts.extra"));
    expect(() => buildFiles(d)).toThrow("a build left [], not just rts");
  });
});

describe("raw comparison (scripts/subject-bin-compare.ts)", async () => {
  const { compareRecords, normalizeCmd } = await import("./subject-bin-compare.ts");
  test("the source command of an entry and its build's compare equal, wrappers and preload included", () => {
    expect(normalizeCmd(["/b/bun", "<repo>/src/rust_ts/main.ts", "-x"])).toEqual(["<subject:src/rust_ts/main.ts>", "-x"]);
    expect(normalizeCmd(["/b/bun", "--preload", "<repo>/src/rust_ts/miri_stack_first.ts", "<repo>/src/miri/bin/miri.ts", "a"])).toEqual(["<subject:src/miri/bin/miri.ts>", "a"]);
    expect(normalizeCmd(["/b/bun", "<repo>/scripts/rmeta-run.ts", "--", "/b/bun", "<repo>/src/rust_ts/main.ts", "f"])).toEqual(["/b/bun", "<repo>/scripts/rmeta-run.ts", "--", "<subject:src/rust_ts/main.ts>", "f"]);
    expect(normalizeCmd(["/b/bun", "<repo>/src/rust_ts/tydump.ts"])).toEqual(["/b/bun", "<repo>/src/rust_ts/tydump.ts"]);
  });
  test("only a panic's thread id is masked; any other byte differs", () => {
    const rec = (o: Partial<{ cmd: string[]; code: number; stdout: string; stderr: string; timedOut: boolean }>) => ({ suite: "s", ids: ["a"], attempt: 0, ms: 1, cmd: ["/b/bun", "<repo>/src/rust_ts/main.ts"], code: 0, timedOut: false, stdout: "", stderr: "", ...o });
    const bin = (o: Parameters<typeof rec>[0]) => rec({ cmd: ["<subject:src/rust_ts/main.ts>"], ...o });
    expect(compareRecords(rec({ stdout: "x" }), bin({ stdout: "x" }))).toEqual({ kind: "same" });
    expect(compareRecords(rec({ stderr: "thread 'rustc' (12) panicked at" }), bin({ stderr: "thread 'rustc' (13) panicked at" }))).toEqual({ kind: "pid-masked" });
    expect(compareRecords(rec({ stderr: "pid 12" }), bin({ stderr: "pid 13" })).kind).toBe("differs");
    expect(compareRecords(rec({ code: 1 }), bin({ code: 101 })).kind).toBe("differs");
    expect(compareRecords(rec({ timedOut: true }), bin({})).kind).toBe("timed out");
  });
});

describe("timing tool (scripts/subject-bin-bench.ts)", async () => {
  const { maskPid, median, timeCounters, withBinary } = await import("./subject-bin-bench.ts");
  test("reads `/usr/bin/time -l` counters, takes medians, swaps the subject prefix and masks only a panic's thread id", () => {
    expect(timeCounters("  1.0 real\n  1087059093  instructions retired\n   674269595  cycles elapsed\n")).toEqual({ instructions: 1087059093, cycles: 674269595 });
    expect(timeCounters("  1.0 real\n")).toEqual({ instructions: undefined, cycles: undefined });
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(withBinary(["/b/bun", "--preload", "/r/src/rust_ts/miri_stack_first.ts", "/r/src/miri/bin/miri.ts", "-x"], "/c/rts")).toEqual(["/c/rts", "-x"]);
    expect(withBinary(["/b/bun", "/r/src/rust_ts/main.ts", "a.rs"], "/c/rts")).toEqual(["/c/rts", "a.rs"]);
    expect(() => withBinary(["/b/bun", "/r/src/rust_ts/tydump.ts"], "/c/rts")).toThrow("no subject entry");
    expect(maskPid("thread 'rustc' (123) panicked at x")).toBe("thread 'rustc' (PID) panicked at x");
    expect(maskPid("thread 'rustc' (123) said")).toBe("thread 'rustc' (123) said");
  });
});
