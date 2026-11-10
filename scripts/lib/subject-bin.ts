// The subject as a compiled bytecode binary (lane subject-bin): `bun build --compile --bytecode` of a subject entry point of
// the tree under test, so a subject process does not load ~2,100 modules from source (0.48 s for `main.ts --version`, against
// 0.05 s). The harness runs it where it would run `bun <entry>`: harness/suites.ts `bunCmd` and `miriSubjectOf`,
// scripts/phase-diff.ts. `RUST_TS_SUBJECT=source` runs every subject from source, as before; `binary` runs the entries in
// `BINARY_ENTRIES` from their build. The default is `DEFAULT_SUBJECT_MODE`.
//
// Build and cache: a build is keyed by a content hash of everything that goes into it (`subjectBinKey`): every file the bundle
// includes (the bundler's own list of its inputs, with each file's content), the Bun build (`Bun.version`, `Bun.revision`), the
// entry, the repo path and the bun path the binary stands in for (both are baked into it, see below), every build option, and
// this file's own source (the plugin). It lives in `$RUST_TS_DATA/subject-bin/<hash>/` (`rts` and `meta.json`), built in a
// temp dir that is then renamed into place, so a concurrent run either finds the finished build or builds its own and drops it.
// A build that fails, or whose binary does not answer `--version` exactly as the source does, is one `ERROR:` line and ends the
// run: nothing falls back to the source path silently.
//
// What a bundle changes, and what this file does about it (docs/handoff/subject-bin.md has the whole audit):
// - `import.meta.dir|dirname|path|file|filename|url` would be the bundle's virtual path (`/$bunfs/root`). The plugin replaces
//   each with a call of the same length to a function declared at the end of the module that returns the source file's
//   value, so every line keeps its columns (the sourcemap maps stack frames to the source's own lines and columns). Any other
//   use of `import.meta` but `.main` and `.env` stops the build. `import.meta.main` the bundler already gives per module.
// - `process.argv` is `["bun", "/$bunfs/root/<name>", ...]`: the banner sets argv[0] and argv[1] to what `bun <entry>` has
//   (the bun path and the entry's path). The raw argv (`_NSGetArgv`, src/std/env.ts) is the binary's own; only its tail is
//   read as arguments, and src/rust_ts/stack.ts re-execs `process.execPath` (the binary) with it, which is right for a binary.
// - `Bun.main` is defined as the entry's source path (src/rust_ts/miri_stack_first.ts compares it).
// - `process.env.NODE_ENV` would be inlined as "development" (`--compile` defines it): it is defined to a global getter that
//   reads the environment at run time, as the source does (src/rustc_middle/ty/list.ts `FREEZE_LISTS`).
// - The bytecode optimizer is off (`BuildSpec.optimizeBytecode`): it makes frames larger, so the stack would hold less nesting. Even
//   off, a bundle's frames are not the source's: the build overflows about 1% sooner on deep nesting (handoff).
// - Stack frames name files relative to the directory the build ran in (the repo), not absolute paths, and the bundler renames
//   top-level names that collide across modules (`foo` -> `foo2`), which shows in `Function.name` and frame names. Neither can
//   be undone from here: see the handoff for what that means for src/rust_ts/track_caller.ts and for JS stacks in crash reports.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { DATA, REPO, hash } from "./common.ts";

export type SubjectMode = "binary" | "source";

/** The variable that picks the mode: `binary` or `source`. Unset: `DEFAULT_SUBJECT_MODE`. */
export const SUBJECT_MODE_VAR = "RUST_TS_SUBJECT";

/** The mode when `RUST_TS_SUBJECT` is unset. See the handoff (docs/handoff/subject-bin.md) before changing it. */
export const DEFAULT_SUBJECT_MODE: SubjectMode = "source";

/**
 * The entries a binary may stand for (repo-relative). Every other subject script (the dumps, the wrappers) runs from source in
 * both modes.
 */
export const BINARY_ENTRIES: readonly string[] = ["src/rust_ts/main.ts", "src/miri/bin/miri.ts"];

/** Where builds live: `<hash>/rts` and `<hash>/meta.json`. */
export const SUBJECT_BIN_DIR = join(DATA, "subject-bin");

/** The binary's file name in a build directory. */
const BIN_NAME = "rts";

/** A build left unused (no run resolved it) for this long is removed by `pruneSubjectBins` (each is ~160 MB). */
export const PRUNE_AFTER_MS = 3 * 24 * 3600 * 1000;

/** The global the `NODE_ENV` define reads (see the file comment). Not enumerable. */
export const NODE_ENV_GLOBAL = "__rts_subject_node_env";

/** The mode from the environment; an unknown value is an error (`undefined` + the message), never a guess. */
export function subjectModeOf(env: Record<string, string | undefined> = process.env): { mode: SubjectMode } | { error: string } {
  const v = env[SUBJECT_MODE_VAR];
  if (v === undefined || v === "") return { mode: DEFAULT_SUBJECT_MODE };
  if (v === "binary" || v === "source") return { mode: v };
  return { error: `${SUBJECT_MODE_VAR}=${v} is neither \`binary\` nor \`source\`` };
}

/**
 * Why binary mode cannot run in this environment, or `undefined`. A `BUN_JSC_*` option can change the bytecode a build holds
 * (`BUN_JSC_useTailCalls=0` keeps every frame from source, but a build made with tail calls keeps them in its bytecode whatever
 * the subject's environment says), and the key does not cover the environment: so neither the build nor its runs take one.
 */
export function binaryModeRefusal(env: Record<string, string | undefined> = process.env): string | undefined {
  const jsc = Object.keys(env).filter((k) => k.startsWith("BUN_JSC_") && env[k] !== undefined);
  if (jsc.length === 0) return undefined;
  return `${jsc.join(", ")} set: a subject binary's bytecode does not follow JSC options of its run (unset them, or run with ${SUBJECT_MODE_VAR}=source)`;
}

/** The mode from the environment; an unknown value prints one `ERROR:` line and exits. */
export function subjectMode(env: Record<string, string | undefined> = process.env): SubjectMode {
  const m = subjectModeOf(env);
  if ("error" in m) {
    console.log(`ERROR: ${m.error}`);
    process.exit(1);
  }
  return m.mode;
}

// ---- the build --------------------------------------------------------------------------------------------------------------

/** The `import.meta` properties the plugin replaces, longest first (so `dir` does not match the start of `dirname`). */
const META_PROPS = ["filename", "dirname", "path", "file", "dir", "url"] as const;
type MetaProp = (typeof META_PROPS)[number];
/** `import.meta` properties left to the bundler: `.main` (per module, as the source has it) and `.env` (`process.env`). */
const META_KEPT = ["main", "env"];

/** The value `import.meta.<prop>` has in `bun <file>` (`file` is a real path). */
export function metaValue(file: string, prop: MetaProp): string {
  switch (prop) {
    case "dir":
    case "dirname":
      return dirname(file);
    case "path":
    case "filename":
      return file;
    case "file":
      return basename(file);
    case "url":
      return pathToFileURL(file).href;
  }
}

/** The function that stands for `import.meta.<prop>`: its call `<name>()` is exactly as long as the text it replaces. */
export function metaFnName(prop: MetaProp): string {
  const want = `import.meta.${prop}`.length - 2;
  const base = `$rtsm_${prop}`;
  return base + "_".repeat(want - base.length);
}

/**
 * The module text with every `import.meta.<prop>` of `META_PROPS` replaced by a same-length call, and the functions appended
 * (hoisted declarations, so they work from the module's first statement). `undefined` when the text has no `import.meta`. Throws
 * on a use it cannot replace exactly: another property, `import.meta` as a value, or a match that may sit inside a string on
 * its line (an odd number of quotes before it).
 */
export function rewriteImportMeta(text: string, file: string): string | undefined {
  if (!text.includes("import.meta")) return undefined;
  const used = new Set<MetaProp>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("import.meta")) continue;
    const comment = line.trimStart().startsWith("//") || line.trimStart().startsWith("*") || line.trimStart().startsWith("/*");
    lines[i] = line.replace(/\bimport\.meta\b(\.([A-Za-z_$][\w$]*))?/g, (m, _dot: string | undefined, prop: string | undefined, at: number) => {
      if (comment) return m;
      if (prop !== undefined && META_KEPT.includes(prop)) return m;
      if (prop === undefined || !(META_PROPS as readonly string[]).includes(prop)) {
        throw new Error(`${file}:${i + 1}: \`${m}\` is not a use the subject binary can keep (only .${META_PROPS.join(", .")}, .${META_KEPT.join(", .")})`);
      }
      const before = line.slice(0, at);
      for (const q of ['"', "'", "`"]) {
        if ((before.split(q).length - 1) % 2 === 1) throw new Error(`${file}:${i + 1}: \`${m}\` may be inside a string; the subject binary would change its text`);
      }
      used.add(prop as MetaProp);
      const call = `${metaFnName(prop as MetaProp)}()`;
      if (call.length !== m.length) throw new Error(`internal: ${call} is not as long as ${m}`);
      return call;
    });
  }
  if (used.size === 0) return lines.join("\n");
  const decls = [...used].map((p) => `;function ${metaFnName(p)}() { return ${JSON.stringify(metaValue(file, p))}; }`);
  return `${lines.join("\n")}\n${decls.join("\n")}\n`;
}

/** A star re-export alone on its line: `export * from "x";` or `export * as ns from "x";`. */
const EXPORT_STAR = /^export \* (?:as [A-Za-z_$][\w$]* )?from ("[^"]+"|'[^']+');$/;

/**
 * The module text with `import "x"; ` put before each star re-export of "x" on its line, or `undefined` if it has none. ESM
 * evaluates a module's requests in source order, `export *` included, and `bun <entry>` does; Bun's bundler moves star re-exports
 * after every other request of the module (src/rustc_abi/lib.ts: `canon_abi.ts`, line 27, then evaluated after `callconv.ts`,
 * line 31), which `scripts/subject-bin-order.ts` showed on 2,080 modules. A side-effect import of the same module at the same
 * place keeps it in order. Only lines that are nothing but the re-export are touched, and they hold no call, so no stack frame's
 * column moves. A line that starts `export *` in any other form stops the build.
 */
export function rewriteExportStar(text: string, file: string): string | undefined {
  if (!/^export \*/m.test(text)) return undefined;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("export *")) continue;
    const m = EXPORT_STAR.exec(line);
    if (m === null) throw new Error(`${file}:${i + 1}: \`${line.slice(0, 80)}\` is not a star re-export the subject binary can keep in order`);
    lines[i] = `import ${m[1]}; ${line}`;
  }
  return lines.join("\n");
}

/** Both rewrites of a module (`rewriteExportStar`, then `rewriteImportMeta`), or `undefined` when neither applies. */
export function rewriteModule(text: string, file: string): string | undefined {
  const star = rewriteExportStar(text, file);
  const meta = rewriteImportMeta(star ?? text, file);
  return meta ?? star;
}

/** The Bun plugin that applies `rewriteModule` to every TypeScript module of the bundle; a refusal fails the build. */
export function importMetaPlugin(): import("bun").BunPlugin {
  return {
    name: "rust-ts-subject-modules",
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, (args) => {
        const text = readFileSync(args.path, "utf8");
        const out = rewriteModule(text, realpathSync(args.path));
        // Untouched modules load as Bun loads them by itself.
        return out === undefined ? (undefined as unknown as import("bun").OnLoadResult) : { contents: out, loader: "ts" };
      });
    },
  };
}

/** Everything about a build but its inputs: part of the key, and the options `Bun.build` gets. */
export interface BuildSpec {
  entry: string;
  /** The entry's real path: `process.argv[1]` and `Bun.main` of `bun <entry>`. */
  entryPath: string;
  /** The bun the binary stands in for: `process.argv[0]` of `bun <entry>`. */
  bunPath: string;
  repo: string;
  define: Record<string, string>;
  banner: string;
  format: "esm";
  target: "bun";
  bytecode: true;
  /**
   * Bun's build-time bytecode optimizer (`bun build --no-optimize-bytecode` turns it off; in `Bun.build` the undocumented
   * `optimize: { bytecode: false }`). Off: with it on, the compiler's JS frames are larger than from source, and a nesting the
   * source still compiles overflows the stack (parenthesised literal at -Zunpretty=normal: source to ~10,150 levels, optimized
   * build ~9,720, unoptimized ~10,060; see the handoff). Startup is the same either way.
   */
  optimizeBytecode: false;
  sourcemap: "inline";
  compile: { autoloadDotenv: boolean; autoloadBunfig: boolean; autoloadTsconfig: boolean; autoloadPackageJson: boolean };
}

/** The build of `entry` (repo-relative) of the tree at `repo`, standing in for `bunPath <entry>`. */
export function buildSpec(entry: string, repo: string = REPO, bunPath: string = process.execPath): BuildSpec {
  const entryPath = realpathSync(join(repo, entry));
  const banner = [
    `Object.defineProperty(globalThis, ${JSON.stringify(NODE_ENV_GLOBAL)}, { get() { return process.env["NODE_ENV"]; }, enumerable: false, configurable: false });`,
    `process.argv[0] = ${JSON.stringify(bunPath)};`,
    `process.argv[1] = ${JSON.stringify(entryPath)};`,
  ].join(" ");
  return {
    entry,
    entryPath,
    bunPath,
    repo,
    define: { "process.env.NODE_ENV": NODE_ENV_GLOBAL, "Bun.main": JSON.stringify(entryPath) },
    banner,
    format: "esm",
    target: "bun",
    bytecode: true,
    optimizeBytecode: false,
    sourcemap: "inline",
    // As `bun <entry>` does: it loads `.env*` and `bunfig.toml` from the cwd; the code is already transpiled.
    compile: { autoloadDotenv: true, autoloadBunfig: true, autoloadTsconfig: false, autoloadPackageJson: false },
  };
}

/** `Bun.build`'s options for a spec; `outfile` set: the compiled binary, else the bundle alone (for its list of inputs). */
function bunBuildConfig(spec: BuildSpec, outfile: string | undefined): Parameters<typeof Bun.build>[0] {
  const base = {
    entrypoints: [join(spec.repo, spec.entry)],
    target: spec.target,
    format: spec.format,
    sourcemap: spec.sourcemap,
    define: spec.define,
    banner: spec.banner,
    plugins: [importMetaPlugin()],
    metafile: true,
    throw: false,
  };
  if (outfile === undefined) return base as Parameters<typeof Bun.build>[0];
  return { ...base, bytecode: spec.bytecode, optimize: { bytecode: spec.optimizeBytecode }, compile: { ...spec.compile, outfile } } as Parameters<typeof Bun.build>[0];
}

/** The build failed: the messages, one line. */
function buildLogs(r: { logs: unknown[] }): string {
  return r.logs.map((l) => String(l).replace(/\s+/g, " ").trim()).join(" | ").slice(0, 2000);
}

/** The repo-relative paths of a build's inputs (its metafile). */
function metaInputs(r: unknown, repo: string): string[] {
  const inputs = (r as { metafile?: { inputs?: Record<string, unknown> } }).metafile?.inputs;
  if (inputs === undefined) throw new Error("the bundler returned no metafile");
  // Bun names inputs relative to the cwd, which `ensureSubjectBin` makes the repo.
  return Object.keys(inputs)
    .map((p) => relative(repo, join(process.cwd(), p)))
    .sort();
}

/** This file's source: the plugin and every option above are in it. */
const BUILDER_SOURCE = hash(readFileSync(import.meta.path));

/** A build's key: the hash of `spec`, the Bun build, this builder, and each input file's path and content. */
export function subjectBinKeyOf(spec: BuildSpec, inputs: { path: string; sha1: string }[], bun = { version: Bun.version, revision: Bun.revision }, builder = BUILDER_SOURCE): string {
  return hash(JSON.stringify({ v: 1, spec, bun, builder, inputs }));
}

export interface SubjectBin {
  entry: string;
  hash: string;
  /** The binary. */
  path: string;
  dir: string;
  /** Whether this call built it (else it was in the cache). */
  built: boolean;
  /** How many files went into it. */
  inputs: number;
}

/** The key of `spec`'s build of the tree as it is now, with its inputs. */
export async function subjectBinKey(spec: BuildSpec): Promise<{ hash: string; inputs: { path: string; sha1: string }[] }> {
  const r = await Bun.build(bunBuildConfig(spec, undefined));
  if (!r.success) throw new Error(`bundling ${spec.entry} failed: ${buildLogs(r)}`);
  const inputs = metaInputs(r, spec.repo).map((p) => ({ path: p, sha1: hash(readFileSync(join(spec.repo, p))) }));
  return { hash: subjectBinKeyOf(spec, inputs), inputs };
}

/** `meta.json` of a build. */
export interface SubjectBinMeta {
  hash: string;
  entry: string;
  spec: BuildSpec;
  bun: { version: string; revision: string };
  inputs: { path: string; sha1: string }[];
  builtAt: string;
  buildMs: number;
}

/** The finished build at `dir`, or `undefined` if there is none (a missing binary or meta.json). */
function finished(dir: string, key: string, entry: string): SubjectBin | undefined {
  const meta = join(dir, "meta.json");
  const bin = join(dir, BIN_NAME);
  if (!existsSync(meta) || !existsSync(bin)) return undefined;
  const m = JSON.parse(readFileSync(meta, "utf8")) as SubjectBinMeta;
  if (m.hash !== key || m.entry !== entry) throw new Error(`${meta} is not the build of ${entry} with key ${key}`);
  // Marks the build as used, for `pruneSubjectBins`.
  const now = new Date();
  utimesSync(meta, now, now);
  return { entry, hash: key, path: bin, dir, built: false, inputs: m.inputs.length };
}

/**
 * The checks a new build must pass before it goes into the cache: `<binary> --version` and `bun <entry> --version` give the
 * same stdout, stderr and exit code (both run with `RUST_TS_IMPL` and `RUST_TS_SUBJECT` unset, in `cwd`).
 */
export type Smoke = (bin: string, spec: BuildSpec) => string | undefined;

export const versionSmoke: Smoke = (bin, spec) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUST_TS_IMPL" && k !== SUBJECT_MODE_VAR) env[k] = v;
  const a = Bun.spawnSync([bin, "--version"], { env, cwd: spec.repo, stdout: "pipe", stderr: "pipe" });
  const b = Bun.spawnSync([spec.bunPath, spec.entryPath, "--version"], { env, cwd: spec.repo, stdout: "pipe", stderr: "pipe" });
  const show = (r: typeof a) => `exit ${r.exitCode}, stdout ${JSON.stringify(r.stdout.toString().slice(0, 200))}, stderr ${JSON.stringify(r.stderr.toString().slice(0, 200))}`;
  if (a.exitCode !== b.exitCode || !a.stdout.equals(b.stdout) || !a.stderr.equals(b.stderr)) {
    return `\`${spec.entry} --version\` differs: binary ${show(a)}; source ${show(b)}`;
  }
  return undefined;
};

/**
 * The build of `entry` for the tree at `repo`: from the cache, or built now. Throws (with one line) when the build or its smoke
 * check fails. `root`: the cache directory (tests use their own).
 */
export async function ensureSubjectBin(entry: string, opts: { repo?: string; root?: string; bunPath?: string; smoke?: Smoke } = {}): Promise<SubjectBin> {
  const repo = opts.repo ?? REPO;
  // The bundler names its inputs and the sourcemap's sources relative to the cwd: the repo, so that frames read `src/...`. The cwd
  // is the process's, so builds in one process take turns (concurrent runs are separate processes; the rename settles those).
  const turn = buildQueue.then(async () => {
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      return await ensureIn(entry, repo, opts.root ?? SUBJECT_BIN_DIR, opts);
    } finally {
      process.chdir(cwd);
    }
  });
  buildQueue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

let buildQueue: Promise<void> = Promise.resolve();

async function ensureIn(entry: string, repo: string, root: string, opts: { bunPath?: string; smoke?: Smoke }): Promise<SubjectBin> {
  const spec = buildSpec(entry, repo, opts.bunPath);
  const { hash: key, inputs } = await subjectBinKey(spec);
  const dir = join(root, key);
  const have = finished(dir, key, entry);
  if (have) return have;

  mkdirSync(root, { recursive: true });
  const tmp = join(root, `.tmp-${key.slice(0, 12)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp);
  try {
    const started = performance.now();
    const r = await Bun.build(bunBuildConfig(spec, join(tmp, BIN_NAME)));
    if (!r.success) throw new Error(`building ${entry} failed: ${buildLogs(r)}`);
    // The binary must hold exactly the files the key hashed (a file that changed between the two bundler passes would not).
    const built = metaInputs(r, repo);
    const keyed = inputs.map((i) => i.path);
    if (built.length !== keyed.length || built.some((p, i) => p !== keyed[i])) throw new Error(`the build of ${entry} read other files than its key (${built.length} vs ${keyed.length})`);
    for (const i of inputs) {
      if (hash(readFileSync(join(repo, i.path))) !== i.sha1) throw new Error(`${i.path} changed while ${entry} was being built`);
    }
    const why = (opts.smoke ?? versionSmoke)(join(tmp, BIN_NAME), spec);
    if (why !== undefined) throw new Error(`the build of ${entry} fails its check: ${why}`);
    const meta: SubjectBinMeta = { hash: key, entry, spec, bun: { version: Bun.version, revision: Bun.revision }, inputs, builtAt: new Date().toISOString(), buildMs: Math.round(performance.now() - started) };
    writeFileSync(join(tmp, "meta.json"), JSON.stringify(meta, null, 1));
    try {
      renameSync(tmp, dir);
    } catch (e) {
      // Another run finished the same build first: use it.
      const other = finished(dir, key, entry);
      if (other) return other;
      throw e;
    }
    return { entry, hash: key, path: join(dir, BIN_NAME), dir, built: true, inputs: inputs.length };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Removes builds (and abandoned temp dirs) no run has used for `maxAgeMs`, except `keep`. A build that a run resolved within
 * that time stays, so a long gate never loses its binary; a process already running keeps its file open regardless.
 */
export function pruneSubjectBins(keep: readonly string[], maxAgeMs: number = PRUNE_AFTER_MS, root: string = SUBJECT_BIN_DIR, now: number = Date.now()): string[] {
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (keep.includes(dir)) continue;
    const meta = join(dir, "meta.json");
    let used: number;
    try {
      used = statSync(existsSync(meta) ? meta : dir).mtimeMs;
    } catch {
      continue;
    }
    if (now - used < maxAgeMs) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

// ---- the subject command ----------------------------------------------------------------------------------------------------

/** The CLI that builds (scripts/subject-bin.ts). */
export const SUBJECT_BIN_CLI = join(REPO, "scripts", "subject-bin.ts");

const resolvedBins = new Map<string, SubjectBin>();

/**
 * The build of `entry` for this repo, made (or found) once per process by the CLI, synchronously: the suites' commands are made
 * synchronously. A failure prints one `ERROR:` line and exits.
 */
export function subjectBin(entry: string): SubjectBin {
  const have = resolvedBins.get(entry);
  if (have) return have;
  const refused = binaryModeRefusal();
  if (refused !== undefined) {
    console.log(`ERROR: ${refused}`);
    process.exit(1);
  }
  const r = Bun.spawnSync([process.execPath, SUBJECT_BIN_CLI, "build", "--entry", entry, "--json"], { cwd: REPO, stdout: "pipe", stderr: "pipe", env: process.env });
  const out = r.stdout.toString();
  const line = out.split("\n").find((l) => l.startsWith("{"));
  if (r.exitCode !== 0 || line === undefined) {
    const err = out.split("\n").find((l) => l.startsWith("ERROR:")) ?? `ERROR: building the subject binary of ${entry} failed (exit ${r.exitCode}): ${r.stderr.toString().trim().split("\n").slice(-3).join(" ")}`;
    console.log(err);
    process.exit(1);
  }
  const bin = JSON.parse(line) as SubjectBin;
  resolvedBins.set(entry, bin);
  return bin;
}

/** The builds this process resolved: `[entry, binary path]`. */
export const subjectBinPaths = (): [string, string][] => [...resolvedBins].map(([e, b]) => [e, b.path]);

/** Whether `entry` runs from its build in `mode`. */
export const usesBinary = (entry: string, mode: SubjectMode): boolean => mode === "binary" && BINARY_ENTRIES.includes(entry);

/**
 * The command that runs subject entry `entry` (repo-relative) with `args`: its build in binary mode (`BINARY_ENTRIES`), else
 * `bun <repo>/<entry>`. `preload`: a module `bun --preload` loads first in source mode; a build has it as the entry's own
 * first import instead (see harness/suites.ts `MIRI_STACK_PRELOAD`).
 */
export function subjectCmd(entry: string, args: readonly string[] = [], opts: { preload?: string; mode?: SubjectMode } = {}): string[] {
  const mode = opts.mode ?? subjectMode();
  if (usesBinary(entry, mode)) return [subjectBin(entry).path, ...args];
  return [process.execPath, ...(opts.preload ? ["--preload", join(REPO, opts.preload)] : []), join(REPO, entry), ...args];
}

/** What a run records about its subject: the mode, and the hash of each build it ran. */
export interface SubjectRecord {
  mode: SubjectMode;
  bins: Record<string, string>;
}

/** The record of this process's subject so far (`bins`: the builds resolved). */
export function subjectRecord(mode: SubjectMode = subjectMode()): SubjectRecord {
  return { mode, bins: Object.fromEntries([...resolvedBins].map(([e, b]) => [e, b.hash])) };
}

/** Resolves (builds if needed) every binary entry of binary mode up front, so a run fails before it starts a case. */
export function prepareSubject(mode: SubjectMode = subjectMode()): SubjectRecord {
  if (mode === "binary") for (const e of BINARY_ENTRIES) subjectBin(e);
  return subjectRecord(mode);
}
