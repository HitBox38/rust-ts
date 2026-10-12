// Build oracle probes: tiny Rust programs linked against crates from the pinned
// upstream checkout, used to dump internal compiler state (token streams, tables)
// that the rustc CLI does not expose.
//
//   bun scripts/probes.ts build [name...]   build probes (default: all)
//   bun scripts/probes.ts path <name>       print the probe binary path
//
// Each probe is `tools/probes/<name>/Cargo.toml.in` (+ sources). The template's `@UPSTREAM@`,
// `@SRC@` and `@RELEASE@` are substituted, and its `[package.metadata.rust-ts]` table may set:
//   env = { KEY = "value", ... }   extra build environment (e.g. RUSTC_BOOTSTRAP / CFG_RELEASE for
//                                  probes linking rustc_* crates, which bootstrap would provide)
//   lockfile = "upstream"          copy upstream's Cargo.lock next to the manifest before every
//                                  build, so registry deps resolve to exactly upstream's versions
//   rustc_dev = true               a rustc-dev probe: links the oracle toolchain's own compiler
//                                  crates (`#![feature(rustc_private)]` + `extern crate rustc_*`,
//                                  from the rustc-dev component in the sysroot). It may have no
//                                  dependencies (a path dep would link a second copy of the
//                                  rustc_* crates), the component must be installed, and it is
//                                  built with RUSTC_BOOTSTRAP=1 plus, on unix, an rpath to
//                                  `<sysroot>/lib` (librustc_driver, libLLVM). Its oracle cache key
//                                  also covers the sysroot (difftest: rustcDriverHash).
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, ensureDir, parseArgs, requireUpstream, run } from "./lib/common.ts";
import { oracleHost, oracleSysroot } from "./lib/oracle.ts";

const PROBES_SRC = join(REPO, "tools", "probes");
const PROBES_OUT = join(DATA, "probes");
const TARGET = join(DATA, "target", "probes");
const EXE = process.platform === "win32" ? ".exe" : "";

/** Binary path of a probe, whether or not it is built. */
export function probeBinary(name: string): string {
  return join(TARGET, "release", name + EXE);
}

export function probePath(name: string): string {
  const p = probeBinary(name);
  if (!existsSync(p)) die(`probe '${name}' not built; run: bun scripts/probes.ts build ${name}`);
  return p;
}

/** Every probe under tools/probes (a directory with a Cargo.toml.in). */
export function probeNames(): string[] {
  return readdirSync(PROBES_SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PROBES_SRC, e.name, "Cargo.toml.in")))
    .map((e) => e.name)
    .sort();
}

interface ProbeMeta {
  env: Record<string, string>;
  lockfile?: "upstream";
  /** Links the oracle toolchain's rustc-dev crates (see the header). */
  rustcDev: boolean;
}

/** Dependency tables a rustc-dev probe may not have (top level or under `[target.*]`). */
const DEP_TABLES = ["dependencies", "dev-dependencies", "build-dependencies"];

/** The substituted manifest of a probe. */
function manifest(name: string): string {
  const src = join(PROBES_SRC, name);
  const fwd = (p: string) => p.replaceAll("\\", "/");
  return readFileSync(join(src, "Cargo.toml.in"), "utf8")
    .replaceAll("@UPSTREAM@", fwd(UPSTREAM))
    .replaceAll("@SRC@", fwd(src))
    .replaceAll("@RELEASE@", PIN.release);
}

/** `[package.metadata.rust-ts]` build settings of a probe (exported for tests/review). */
export function probeMeta(name: string): ProbeMeta {
  const toml = Bun.TOML.parse(manifest(name)) as {
    package?: { metadata?: { "rust-ts"?: Record<string, unknown> } };
    target?: Record<string, Record<string, unknown>>;
    [table: string]: unknown;
  };
  const meta = toml.package?.metadata?.["rust-ts"] ?? {};
  const env: Record<string, string> = {};
  if (meta.env !== undefined) {
    if (typeof meta.env !== "object" || meta.env === null) die(`probe ${name}: metadata env must be a table`);
    for (const [k, v] of Object.entries(meta.env)) {
      if (typeof v !== "string") die(`probe ${name}: metadata env.${k} must be a string`);
      env[k] = v;
    }
  }
  if (meta.lockfile !== undefined && meta.lockfile !== "upstream") die(`probe ${name}: metadata lockfile must be "upstream"`);
  if (meta.rustc_dev !== undefined && typeof meta.rustc_dev !== "boolean") die(`probe ${name}: metadata rustc_dev must be a boolean`);
  const rustcDev = meta.rustc_dev === true;
  if (rustcDev) {
    const deps = [
      ...DEP_TABLES.filter((t) => toml[t] !== undefined),
      ...Object.entries(toml.target ?? {}).flatMap(([cfg, t]) => DEP_TABLES.filter((d) => t[d] !== undefined).map((d) => `target.${cfg}.${d}`)),
    ];
    if (deps.length) die(`probe ${name}: a rustc_dev probe may not have dependencies ([${deps.join("], [")}])`);
    if (meta.lockfile !== undefined) die(`probe ${name}: a rustc_dev probe has no dependencies to lock`);
    if ("RUSTFLAGS" in env || "CARGO_ENCODED_RUSTFLAGS" in env) die(`probe ${name}: a rustc_dev probe may not set RUSTFLAGS`);
  }
  return { env, lockfile: meta.lockfile as ProbeMeta["lockfile"], rustcDev };
}

/** Is a probe a rustc-dev probe (`rustc_dev = true`)? `false` for unknown names. */
export function isRustcDevProbe(name: string): boolean {
  return existsSync(join(PROBES_SRC, name, "Cargo.toml.in")) && probeMeta(name).rustcDev;
}

/**
 * Build environment of a rustc-dev probe. The crates come from the oracle sysroot: rustc finds
 * them in `<sysroot>/lib/rustlib/<host>/lib`, its default search path, once the rustc-dev
 * component is installed; check that first so a missing component is one clear ERROR.
 */
function rustcDevEnv(name: string): Record<string, string> {
  const sysroot = oracleSysroot();
  const rustlib = join(sysroot, "lib", "rustlib", oracleHost(), "lib");
  let names: string[] = [];
  try {
    names = readdirSync(rustlib);
  } catch {}
  if (!names.some((n) => /^librustc_driver-[0-9a-f]+\.(rlib|rmeta)$/.test(n))) {
    die(`probe ${name} needs the rustc-dev component (no rustc_driver .rmeta/.rlib in ${rustlib}); run: rustup component add rustc-dev llvm-tools --toolchain ${PIN.toolchain}`);
  }
  const env: Record<string, string> = { RUSTC_BOOTSTRAP: "1" };
  // librustc_driver and libLLVM are dylibs in <sysroot>/lib; without an rpath the probe would only
  // run with DYLD_LIBRARY_PATH / LD_LIBRARY_PATH set. (Windows has no rpath: <sysroot>/bin must be
  // on PATH when the probe runs.)
  if (process.platform !== "win32") env.RUSTFLAGS = `-C link-arg=-Wl,-rpath,${join(sysroot, "lib")}`;
  return env;
}

async function build(name: string): Promise<void> {
  requireUpstream();
  const text = manifest(name);
  const meta = probeMeta(name);
  const dir = ensureDir(join(PROBES_OUT, name));
  writeFileSync(join(dir, "Cargo.toml"), text);
  if (meta.lockfile === "upstream") copyFileSync(join(UPSTREAM, "Cargo.lock"), join(dir, "Cargo.lock"));
  const r = await run(["cargo", `+${PIN.toolchain}`, "build", "--release", "--quiet", "--manifest-path", join(dir, "Cargo.toml")], {
    env: { CARGO_TARGET_DIR: TARGET, ...meta.env, ...(meta.rustcDev ? rustcDevEnv(name) : {}) },
  });
  if (r.code !== 0) die(`probe ${name} failed to build:\n${r.stderr}`);
  console.log(`built ${name}: ${probePath(name)}`);
}

/**
 * Probes the oracle unit tests (`*.test.ts` under src/ and tools/) read: every test that builds a
 * probe path does it as `join(DATA, "target", "probes", "release", "<name>" ...)` or
 * `probePath("<name>")`.
 */
export function oracleTestProbes(): string[] {
  const names = new Set<string>();
  const re = /"probes",\s*"release",\s*"([\w-]+)"|probe(?:Path|Binary)\("([\w-]+)"\)/g;
  const rec = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") rec(p);
      } else if (e.name.endsWith(".test.ts")) {
        for (const m of readFileSync(p, "utf8").matchAll(re)) names.add((m[1] ?? m[2])!);
      }
    }
  };
  for (const d of ["src", "tools"]) rec(join(REPO, d));
  return [...names].sort();
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...names] = args._;
  if (cmd === "build") {
    for (const n of names.length ? names : probeNames()) await build(n);
  } else if (cmd === "path" && names[0]) {
    console.log(probePath(names[0]));
  } else {
    console.log("usage: bun scripts/probes.ts build [name...] | path <name>");
  }
}
