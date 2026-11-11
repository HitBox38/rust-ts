// scripts/lib/subject-bin.ts: the mode, the source rewrites, the cache key, the builder (on a small fixture tree) and the source
// fallback. The real entries' builds are checked by the lane's evidence runs (docs/handoff/subject-bin.md), not here.
// Run by scripts/subject-bin.test.ts in a child `bun test` with RUST_TS_DATA at a temp dir: this file loads scripts/lib/common.ts,
// which reads RUST_TS_DATA once, at import, so in the runner unit-test process it must not load first (see scripts/lib/deps.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { REPO } from "./lib/common.ts";
import {
  BINARY_ENTRIES,
  DEFAULT_SUBJECT_MODE,
  binaryModeRefusal,
  buildFiles,
  buildSpec,
  CONFIG_FILES,
  ensureSubjectBin,
  metaCodeUses,
  metaFnName,
  pruneSubjectBins,
  rewriteExportStar,
  rewriteImportMeta,
  rewriteModule,
  RUNTIME_C_FILES,
  staleConfigs,
  subjectBinKeyOf,
  subjectCmd,
  subjectModeOf,
  subjectRecord,
  usesBinary,
  VALIDATED_BUN,
} from "./lib/subject-bin.ts";
import { GATE_BUN, sameBun } from "./lib/bun-pin.ts";

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

  test("the gate's Bun (scripts/lib/bun-pin.ts GATE_BUN) is a validated build: gates run with RUST_TS_SUBJECT=binary", () => {
    expect(VALIDATED_BUN.some((v) => sameBun(v, GATE_BUN))).toBe(true);
    expect(binaryModeRefusal({}, GATE_BUN)).toBeUndefined();
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

  test("a match the line-by-line judgment gets wrong stops the build, checked against Bun's parse (review subject-bin N2)", () => {
    // On a continuation line of a multi-line template, and in a block comment whose lines do not start with `*`.
    expect(() => rewriteImportMeta("const s = `a\nimport.meta.dir b`;\nconst d = import.meta.dir;", file)).toThrow("2 `import.meta.dir` replaced, but Bun parses 1 in code");
    expect(() => rewriteImportMeta("/* note:\n   import.meta.url is the page */\nx();", file)).toThrow("1 `import.meta.url` replaced, but Bun parses 0 in code");
    // A code line the rewrite takes for a comment (it starts with `*`): the use is left, and Bun sees it.
    expect(() => rewriteImportMeta("const n = 2\n* import.meta.dir.length;", file)).toThrow("0 `import.meta.dir` replaced, but Bun parses 1 in code");
    // Both at once, so the counts agree: the use left in code is still found.
    expect(() => rewriteImportMeta("const n = 2\n* import.meta.dir.length;\nconst s = `a\nimport.meta.dir b`;", file)).toThrow("a code use of `import.meta.dir` was not replaced");
    // Real uses on any line and a block comment line starting with `*` pass.
    const ok = "/**\n * import.meta.dir here is a comment\n */\nconst t = join(import.meta.dir, \"x\");\nconst p =\n  import.meta.path;";
    expect(rewriteImportMeta(ok, file)!.split("\n").slice(0, 6).join("\n")).toBe(ok.replace("join(import.meta.dir", `join(${metaFnName("dir")}()`).replace("  import.meta.path", `  ${metaFnName("path")}()`));
    expect([...metaCodeUses(ok, file)].filter(([, n]) => n > 0)).toEqual([["path", 1], ["dir", 1]]);
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
  test("a file's content or path, the Bun build or its file's content, the builder, an option or the repo changes it; the bun path does not", () => {
    expect(subjectBinKeyOf(spec, [inputs[0]!, { path: "src/b.ts", sha1: "3" }], bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, [inputs[0]!, { path: "src/c.ts", sha1: "2" }], bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, [inputs[0]!], bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, { version: "1.4.4", revision: "abc" }, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, { version: "1.4.3", revision: "abd" }, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, bun, "builder2")).not.toBe(k);
    expect(subjectBinKeyOf({ ...spec, compile: { ...spec.compile, autoloadDotenv: false } }, inputs, bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf({ ...spec, repo: "/elsewhere" }, inputs, bun, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, { ...bun, sha1: "f".repeat(40) }, "builder")).not.toBe(k);
    expect(subjectBinKeyOf(spec, inputs, { ...bun, sha1: "e".repeat(40) }, "builder")).not.toBe(subjectBinKeyOf(spec, inputs, { ...bun, sha1: "f".repeat(40) }, "builder"));
    // The Bun is keyed by content, not path (review bun-144-recheck2 N7): a gate's private copy reuses a lane's build.
    expect(subjectBinKeyOf(buildSpec("scripts/subject-bin.cases.ts", spec.repo, "/other/bun"), inputs, bun, "builder")).toBe(k);
    expect(buildSpec("scripts/subject-bin.cases.ts", spec.repo, "/other/bun").banner).toContain('process.argv[0] = "/other/bun";');
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
  test("each run-time C source's content, or its absence, changes it (review w40i-audit N1)", () => {
    const config = CONFIG_FILES.map((p) => ({ path: p, sha1: "c" }));
    const runtimeC = RUNTIME_C_FILES.map((p) => ({ path: p, sha1: "c" }));
    const kc = subjectBinKeyOf(spec, inputs, bun, "builder", config, runtimeC);
    expect(subjectBinKeyOf(spec, inputs, bun, "builder", config, runtimeC.map((c) => ({ ...c })))).toBe(kc);
    for (let i = 0; i < runtimeC.length; i++) {
      const changed = runtimeC.map((c, j) => (j === i ? { ...c, sha1: "d" } : c));
      const absent = runtimeC.map((c, j) => (j === i ? { ...c, sha1: "absent" } : c));
      expect(subjectBinKeyOf(spec, inputs, bun, "builder", config, changed)).not.toBe(kc);
      expect(subjectBinKeyOf(spec, inputs, bun, "builder", config, absent)).not.toBe(kc);
    }
  });
});

describe("run-time C sources (review w40i-audit N1)", () => {
  // Every tracked TypeScript file but tests: the subject's modules, and anything a later entry might bundle.
  const tracked = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO, stdout: "pipe" }).stdout.toString().split("\0").filter(Boolean);
  const isTest = (f: string) => /\.(test|cases)\.ts$/.test(f);
  /**
   * The repo-relative `.c` files a module compiles with bun:ffi's `cc`, directly or through
   * `cc_or_unported("<what>", { source: ... })` (src/rust_ts/tinycc.ts), or why its calls cannot be read. tinycc.ts's own
   * `cc(options)` forwards its caller's options, so it is the one call allowed without a literal source.
   */
  const TINYCC = "src/rust_ts/tinycc.ts";
  const ccSources = (file: string, raw: string): string[] | string => {
    if (!raw.includes("bun:ffi") && !raw.includes("cc_or_unported")) return [];
    // Calls only: a comment that names `cc(...)` is not one.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (file === TINYCC) {
      const fwd = [...text.matchAll(/\bcc\s*\(/g)].length;
      return fwd === 1 && /\breturn cc\(options\);/.test(text) ? [] : `${file}: expected exactly one forwarding \`return cc(options);\`, found ${fwd} \`cc(\` call(s)`;
    }
    const calls = [...text.matchAll(/\b(?:cc|cc_or_unported)\s*\(/g)].length - [...text.matchAll(/\bfunction\s+cc_or_unported\s*\(/g)].length;
    const sources = [
      ...text.matchAll(/\b(?:cc\s*\(|cc_or_unported\s*\(\s*"[^"]*",)\s*\{\s*source:\s*join\(import\.meta\.dir,\s*"([^"]+)"\)/g),
    ].map((m) => join(file, "..", m[1]!));
    if (sources.length !== calls) return `${file}: ${calls} \`cc(\`/\`cc_or_unported(\` call(s), ${sources.length} read with a literal \`source: join(import.meta.dir, "<file>")\``;
    return sources;
  };
  test("RUNTIME_C_FILES is exactly the files non-test modules compile with `cc`, and each exists", () => {
    const found = new Set<string>();
    const unreadable: string[] = [];
    for (const f of tracked.filter((f) => f.endsWith(".ts") && !isTest(f))) {
      const r = ccSources(f, readFileSync(join(REPO, f), "utf8"));
      if (typeof r === "string") unreadable.push(r);
      else for (const c of r) found.add(c);
    }
    expect(unreadable).toEqual([]);
    expect([...found].sort()).toEqual([...RUNTIME_C_FILES].sort());
    for (const c of RUNTIME_C_FILES) expect(existsSync(join(REPO, c))).toBe(true);
  });
  test("the reading of `cc` calls: a call it cannot read is an error, not an empty list", () => {
    const ok = 'import { cc } from "bun:ffi";\nconst lib = cc({\n  source: join(import.meta.dir, "x.c"),\n});\n';
    expect(ccSources("src/a/m.ts", ok)).toEqual(["src/a/x.c"]);
    expect(ccSources("src/a/m.ts", 'import { cc } from "bun:ffi";\nconst lib = cc({ source: SRC });\n')).toContain("1 `cc(`/`cc_or_unported(` call(s), 0 read");
    expect(ccSources("src/a/m.ts", 'import { cc } from "bun:ffi";\n// cc({ source: join(import.meta.dir, "c.c") })\n')).toEqual([]);
    expect(ccSources("src/a/m.ts", "const lib = cc({ source: SRC });\n")).toEqual([]);
    const wrapped = 'import { cc_or_unported } from "../rust_ts/tinycc.ts";\nconst lib = cc_or_unported("x (compiling x.c)", {\n  source: join(import.meta.dir, "x.c"),\n});\n';
    expect(ccSources("src/a/m.ts", wrapped)).toEqual(["src/a/x.c"]);
    expect(ccSources("src/a/m.ts", 'import { cc_or_unported } from "./t.ts";\nconst lib = cc_or_unported("x", { source: SRC });\n')).toContain("1 `cc(`/`cc_or_unported(` call(s), 0 read");
    expect(ccSources(TINYCC, 'import { cc } from "bun:ffi";\nexport function cc_or_unported(w, options) {\n  return cc(options);\n}\n')).toEqual([]);
    expect(ccSources(TINYCC, 'import { cc } from "bun:ffi";\nexport function cc_or_unported(w, options) {\n  cc({ source: "y.c" });\n  return cc(options);\n}\n')).toContain("exactly one forwarding");
  });
  test("every other tracked .c under src/ is compiled by tests only, and a keyed file includes no local header", () => {
    for (const c of tracked.filter((f) => f.startsWith("src/") && /\.[ch]$/.test(f) && !(RUNTIME_C_FILES as readonly string[]).includes(f))) {
      const users = tracked.filter((f) => f.endsWith(".ts") && readFileSync(join(REPO, f), "utf8").includes(basename(c)));
      expect({ c, nonTest: users.filter((f) => !isTest(f)) }).toEqual({ c, nonTest: [] });
    }
    for (const c of RUNTIME_C_FILES) expect(readFileSync(join(REPO, c), "utf8")).not.toMatch(/^\s*#\s*include\s*"/m);
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

  test("prune keeps a build a run resolves between prune's look and its removal (review subject-bin N1)", async () => {
    writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 6;\n");
    const b = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
    const old = Date.now() / 1000 - 10 * 24 * 3600;
    utimesSync(join(b.dir, "meta.json"), old, old);
    const DAYS3 = 3 * 24 * 3600 * 1000;
    // A run resolves it right after prune found it old (what `finished` does first: it marks meta.json used): it stays, under its
    // own name, with nothing left in the trash, and the next resolve finds it.
    const removed = pruneSubjectBins([], DAYS3, root, Date.now, (dir) => {
      if (dir === b.dir) utimesSync(join(dir, "meta.json"), new Date(), new Date());
    });
    expect(await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke })).toEqual({ ...b, built: false });
    expect(removed).not.toContain(basename(b.dir));
    expect(existsSync(b.path)).toBe(true);
    expect(readdirSync(root).filter((n) => n.startsWith(".trash-"))).toEqual([]);
    // Not resolved: removed, through the trash, which is left empty.
    utimesSync(join(b.dir, "meta.json"), old, old);
    expect(pruneSubjectBins([], DAYS3, root)).toContain(basename(b.dir));
    expect(existsSync(b.dir)).toBe(false);
    expect(readdirSync(root).filter((n) => n.startsWith(".trash-"))).toEqual([]);
    // A resolver that comes after the move finds nothing and builds again.
    const c = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
    expect(c).toEqual({ ...b, built: true });
  });

  test("CONFIG_FILES is the four files Bun reads besides the bundled ones (review root-w46-check N2)", () => {
    expect([...CONFIG_FILES]).toEqual(["tsconfig.json", "package.json", "bunfig.toml", "bun.lock"]);
  });

  test("a config or input edit during the build stops it, and leaves nothing in the cache (review root-w46-check N2)", async () => {
    writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 7;\n");
    const before = readdirSync(root).sort();
    const tsconfig = join(repo, "tsconfig.json");
    const had = existsSync(tsconfig) ? readFileSync(tsconfig, "utf8") : undefined;
    const restore = () => (had === undefined ? rmSync(tsconfig, { force: true }) : writeFileSync(tsconfig, had));
    try {
      await expect(ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke, afterBuild: () => writeFileSync(tsconfig, '{"compilerOptions":{}}') })).rejects.toThrow("tsconfig.json changed while src/entry.ts was being built");
    } finally {
      restore();
    }
    await expect(ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke, afterBuild: () => writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 8;\n") })).rejects.toThrow("src/lib/named.ts changed while src/entry.ts was being built");
    expect(readdirSync(root).sort()).toEqual(before);
  });

  test("a run-time C edit makes a new build, and one during the build stops it (review w40i-audit N1)", async () => {
    writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 9;\n");
    const c = join(repo, RUNTIME_C_FILES[0]);
    mkdirSync(join(c, ".."), { recursive: true });
    writeFileSync(c, "int f(void) { return 1; }\n");
    try {
      const a = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
      const meta = JSON.parse(readFileSync(join(a.dir, "meta.json"), "utf8")) as { runtimeC: { path: string; sha1: string }[] };
      expect(meta.runtimeC.map((r) => [r.path, r.sha1 === "absent"])).toEqual(RUNTIME_C_FILES.map((p, i) => [p, i !== 0]));
      const before = readdirSync(root).sort();
      // A changed input, so that this resolve builds (an unchanged tree would find `a`).
      writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 10;\n");
      await expect(ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke, afterBuild: () => writeFileSync(c, "int f(void) { return 2; }\n") })).rejects.toThrow(
        `${RUNTIME_C_FILES[0]} changed while src/entry.ts was being built`,
      );
      expect(readdirSync(root).sort()).toEqual(before);
      // Back to `a`'s bundled files; the C edit stays: the next resolve keys the new C, so it builds anew.
      writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 9;\n");
      const b = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
      expect(b.hash).not.toBe(a.hash);
      expect(b.built).toBe(true);
    } finally {
      rmSync(c, { force: true });
    }
  });

  test("a tsconfig.json edit makes a new build, though no bundled file changed (review F1), only from a new process (review root-w46-check N1)", async () => {
    writeFileSync(join(repo, "src", "lib", "named.ts"), "export const n = 5;\n");
    const a = await ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke });
    writeFileSync(join(repo, "tsconfig.json"), JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }));
    // Bun read the old tsconfig in this process and keeps it: a build here would be keyed by the new one and made with the old.
    await expect(ensureSubjectBin("src/entry.ts", { repo, root, smoke: noSmoke })).rejects.toThrow("tsconfig.json changed after this process first read it, and Bun keeps the first copy");
    const script = `import { ensureSubjectBin } from ${JSON.stringify(join(REPO, "scripts/lib/subject-bin.ts"))}; console.log(JSON.stringify(await ensureSubjectBin("src/entry.ts", { repo: ${JSON.stringify(repo)}, root: ${JSON.stringify(root)}, smoke: () => undefined })));`;
    const p = Bun.spawnSync([process.execPath, "-e", script], { cwd: tmp, stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode, p.stderr.toString()).toBe(0);
    const b = JSON.parse(p.stdout.toString().trim()) as { hash: string; built: boolean; inputs: number };
    expect(b.hash).not.toBe(a.hash);
    expect(b.built).toBe(true);
    expect(b.inputs).toBe(a.inputs);
    // Back to the config this process first read, so its later builds may run.
    rmSync(join(repo, "tsconfig.json"));
  });

  test("staleConfigs: in this module's own repo, a config file modified since the process started is stale (review root-w46-check N1)", () => {
    const dir = join(tmp, "own");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(join(dir, "bun.lock"), "x");
    const start = Date.now();
    utimesSync(join(dir, "tsconfig.json"), (start - 60_000) / 1000, (start - 60_000) / 1000);
    utimesSync(join(dir, "bun.lock"), (start + 1_000) / 1000, (start + 1_000) / 1000);
    expect(staleConfigs(dir, undefined, start)).toEqual(["bun.lock"]);
    utimesSync(join(dir, "bun.lock"), (start - 1_000) / 1000, (start - 1_000) / 1000);
    expect(staleConfigs(dir, undefined, start)).toEqual([]);
    // With a first-seen record, the contents decide (a missing file is `absent`).
    const seen = CONFIG_FILES.map((path) => ({ path, sha1: "absent" }));
    expect(staleConfigs(dir, seen, start)).toEqual(["tsconfig.json", "bun.lock"]);
    // The real repo's config predates this process (no one edits it during the unit step).
    expect(staleConfigs(REPO, undefined)).toEqual([]);
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
  const { compareRecords, normalizeCmd, shownFindings } = await import("./subject-bin-compare.ts");
  test("prints at most 5 errors and 5 notes, each list with its own count of the rest (review harness-w49 N3)", () => {
    const n = (k: string, c: number) => Array.from({ length: c }, (_, i) => `${k}${i}`);
    expect(shownFindings(n("E", 7), [], undefined)).toEqual([...n("E", 5), "... 2 more"]);
    expect(shownFindings(n("E", 5), n("N", 6), "/o.txt")).toEqual([...n("E", 5), ...n("N", 5), "... 1 more in /o.txt"]);
    expect(shownFindings(n("E", 6), n("N", 7), undefined)).toEqual([...n("E", 5), "... 1 more", ...n("N", 5), "... 2 more"]);
    expect(shownFindings(n("E", 5), n("N", 5), undefined)).toEqual([...n("E", 5), ...n("N", 5)]);
  });
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
    expect(compareRecords(rec({ timedOut: true }), bin({ timedOut: true })).kind).toBe("timed out");
  });
  test("a timeout on one side only is its own count, with a note naming the side (review subject-bin N6)", () => {
    const rec = (o: Partial<{ cmd: string[]; code: number; stdout: string; stderr: string; timedOut: boolean; ms: number }>) => ({ suite: "s", ids: ["a"], attempt: 0, ms: 1, cmd: ["/b/bun", "<repo>/src/rust_ts/main.ts"], code: 0, timedOut: false, stdout: "", stderr: "", ...o });
    const bin = (o: Parameters<typeof rec>[0]) => rec({ cmd: ["<subject:src/rust_ts/main.ts>"], ...o });
    expect(compareRecords(rec({ timedOut: true, ms: 60000 }), bin({ ms: 41000 }))).toEqual({ kind: "one side timed out", why: "only the source side timed out (source 60000 ms, binary 41000 ms)" });
    expect(compareRecords(rec({ ms: 41000 }), bin({ timedOut: true, ms: 60000 }))).toEqual({ kind: "one side timed out", why: "only the binary side timed out (source 41000 ms, binary 60000 ms)" });
    // The CLI counts each kind apart; a one-sided timeout is a note, not an error.
    const dirs = ["src", "bin"].map((d) => join(tmp, `compare-${d}`));
    for (const d of dirs) mkdirSync(d, { recursive: true });
    const put = (f: string, s: object, b: object) => {
      writeFileSync(join(dirs[0]!, f), JSON.stringify(rec(s)));
      writeFileSync(join(dirs[1]!, f), JSON.stringify(bin(b)));
    };
    put("1.json", {}, {});
    put("2.json", { timedOut: true, ms: 60000 }, { timedOut: true, ms: 60000 });
    put("3.json", { ms: 41000 }, { timedOut: true, ms: 60000 });
    const p = Bun.spawnSync([process.execPath, join(REPO, "scripts/subject-bin-compare.ts"), ...dirs], { stdout: "pipe", stderr: "pipe" });
    const out = p.stdout.toString().trim().split("\n");
    expect(p.exitCode, p.stderr.toString()).toBe(0);
    expect(out[0]).toBe("note: s a (attempt 0): only the binary side timed out (source 41000 ms, binary 60000 ms)");
    expect(out.at(-1)).toStartWith("processes=3/3 same=1 pid-masked=0 timed-out=1 one-side-timed-out=1 differs=0 missing=0 ");
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

describe("timing tool refusals (review perf-subject-bin N4)", async () => {
  const { benchRefusal, GATE_RUNNING } = await import("./subject-bin-bench.ts");
  const ac = { source: "AC Power", onBattery: false, percent: 100 };
  const batt = { source: "Battery Power", onBattery: true, percent: 41 };
  const none = { allowBattery: false, allowGate: false };
  test("refuses on battery and while a gate runs, each unless allowed; no pmset (null) is no refusal", () => {
    expect(benchRefusal(ac, false, none)).toBeUndefined();
    expect(benchRefusal(null, false, none)).toBeUndefined();
    expect(benchRefusal({ source: "UPS Power", onBattery: false, percent: null }, false, none)).toBeUndefined();
    expect(benchRefusal(batt, false, none)).toBe("this host is on battery at 41%: a bench on battery runs up to 3.5x slower and its numbers look valid (docs/reviews/perf-near-limit.md); plug it in, or pass --allow-battery");
    expect(benchRefusal(batt, false, { allowBattery: true, allowGate: false })).toBeUndefined();
    expect(benchRefusal(ac, true, none)).toBe(`a gate is running (${GATE_RUNNING} exists): a bench now disturbs the gate's timing and its own numbers; wait for the gate, or pass --allow-gate`);
    expect(benchRefusal(ac, true, { allowBattery: false, allowGate: true })).toBeUndefined();
    expect(benchRefusal(batt, true, { allowBattery: true, allowGate: false })).toContain("a gate is running");
    expect(GATE_RUNNING.endsWith("/tmp/GATE_RUNNING")).toBe(true);
  });
});

describe("order tool arguments (scripts/subject-bin-order.ts, review perf-subject-bin N1)", async () => {
  const { orderArgs } = await import("./subject-bin-order.ts");
  const argv = (...w: string[]) => ["/bun", "/r/scripts/subject-bin-order.ts", ...w];
  test("every word before `--` must be an option of the tool, so a subject argument never silently disappears", () => {
    // `bun x.ts -- --version a`: Bun drops the leading `--`.
    expect(orderArgs(argv("--version", "a"))).toEqual({ error: "`--version` is not an option of this tool (no `--` before it: Bun drops a `--` that comes first, so pass an option first, e.g. `--entry src/rust_ts/main.ts -- <args>`)" });
    // The review's two holes: `-- --keep --version` (Bun drops the `--`), and a forgotten `--` after `--entry`.
    expect(orderArgs(argv("--keep", "--version"))).toHaveProperty("error");
    expect((orderArgs(argv("--keep", "--version")) as { error: string }).error).toStartWith("`--version` is not an option of this tool");
    expect((orderArgs(argv("--entry", "src/miri/bin/miri.ts", "--version")) as { error: string }).error).toStartWith("`--version` is not an option of this tool");
    // A positional, a flag with a value, a missing value, a repeated single option, a malformed --env.
    expect((orderArgs(argv("a.rs", "--", "x")) as { error: string }).error).toBe("`a.rs` is not an option of this tool");
    expect((orderArgs(argv("--keep=1", "--", "x")) as { error: string }).error).toBe("`--keep=1` is not an option of this tool");
    expect((orderArgs(argv("--cwd", "--", "x")) as { error: string }).error).toBe("`--cwd` needs a value");
    expect((orderArgs(argv("--entry", "a.ts", "--entry=b.ts", "--", "x")) as { error: string }).error).toBe("`--entry` given twice");
    expect((orderArgs(argv("--env", "X", "--", "x")) as { error: string }).error).toBe("`--env X` is not K=V");
  });
  test("options, a repeated --env, and the subject's arguments after `--` (which may look like the tool's options)", () => {
    expect(orderArgs(argv("--entry", "src/miri/bin/miri.ts", "--cwd=/w", "--env", "A=1", "--env=B=x=y", "--keep", "--", "--keep", "--version"))).toEqual({
      entry: "src/miri/bin/miri.ts",
      cwd: "/w",
      env: { RUSTC_ICE: "0", A: "1", B: "x=y" },
      keep: true,
      verbose: false,
      args: ["--keep", "--version"],
    });
    expect(orderArgs(argv("--verbose", "--", "a.rs"))).toEqual({ entry: "src/rust_ts/main.ts", cwd: undefined, env: { RUSTC_ICE: "0" }, keep: false, verbose: true, args: ["a.rs"] });
    expect(orderArgs(argv("--env", "RUSTC_ICE=1", "--", "a.rs"))).toMatchObject({ env: { RUSTC_ICE: "1" } });
    expect(orderArgs(argv())).toMatchObject({ args: [] });
  });
});
