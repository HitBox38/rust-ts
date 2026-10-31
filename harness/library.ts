// The library crates of the M5 suites (plan-m5 §1b, D1, D2; lane harness-m5c): their argv, and the oracle-built aux
// chain that alloc and std are checked against.
//
// - **Argv (D1)**: the minimal bootstrap-faithful one. `--crate-name <c> --edition=<e> <root> --crate-type lib --target
//   x86_64-unknown-linux-gnu -Zforce-unstable-if-unmarked --emit=metadata`, then the crate's `--cfg`s (cargo features
//   as `feature="…"` and its build script's `cargo:rustc-cfg`s), and for every crate but core `--sysroot <empty dir>`,
//   its `--extern`s (with cargo's `priv:` marks, which need `-Zunstable-options` and are encoded in the rmeta's
//   `CrateDep::is_private`) and one `-L dependency=<dir>` per transitive dependency (how rustc finds the deps of its
//   deps, as cargo passes them). Registry crates also get `--cap-lints allow`, as cargo always passes for them. No
//   other build-std / bootstrap flag (`--cap-lints` on path crates, `--force-warn=unused_crate_dependencies`,
//   `--check-cfg`, `-C debuginfo`, `-C metadata`, ...): D1 rejects them. core's argv is exactly the core suites'
//   (`libArgs("core")` equals harness/suites.ts `CORE_ARGS(["lib"])`, checked by harness/library.test.ts), so the aux
//   core rmeta is byte-identical to check-core's oracle file (and hence, today, to the port's).
// - **Source of each crate's argv**: `cargo +nightly-2026-10-11 check -Zbuild-std=std -v --target
//   x86_64-unknown-linux-gnu` against the pinned `library/` (plan-m5 §1a; `$RUST_TS_DATA/tmp/plan-m5/bs-std2.log`):
//   crate names, editions, roots, features and build-script cfgs, and the `--extern` lists, `priv:` included. std's
//   features are bootstrap's default `std_features` (`backtrace`, `panic-unwind`; plan-m5 §1a) with what they imply
//   (`addr2line`, `miniz_oxide`, `object`); its build script adds `--cfg backtrace_in_libstd` and the env
//   `STD_ENV_ARCH=x86_64` (library/std/build.rs; `env!("STD_ENV_ARCH")` in std/src/env.rs), which `libEnv` returns.
// - **Empty sysroot (D2)**: alloc with the oracle's sysroot fails with E0152 (the injected `extern crate
//   compiler_builtins` loads the sysroot's core next to `--extern core`), so every crate but core gets `--sysroot
//   $RUST_TS_DATA/aux/m5-empty-sysroot` and finds all of its deps through `--extern` / `-L dependency=`.
// - **Aux crates (D2, the M2 D5 pattern of harness/suites.ts `oracleAuxRmeta`)**: every dependency is built by the
//   oracle with its own `libArgs`, against the oracle-built rmetas of its own deps (core first), so each M5 case is
//   independent of the port's other cases. Built once into `$RUST_TS_DATA/aux/m5-<crate>-<key>/lib<crate>.rmeta`,
//   key = the oracle rustc build (`rustcDriverHash`), every file under the crate's `inputs`, its argv (which holds its
//   deps' rmeta paths, hence their keys) and env. A build goes to a temp dir renamed into place, so concurrent
//   processes never see half a crate. An oracle that fails throws one `ERROR:` line.
// - **Sources**: in-tree crates from the upstream checkout (`library/backtrace` is a git submodule, initialized by
//   `bun scripts/upstream.ts fetch` from UPSTREAM.json `submodules`); crates.io crates from the cargo registry at the
//   single version in library/Cargo.lock (`bun scripts/crate-src.ts <pkg> --version <v>`, which fetches if needed).
// - **Inputs**: the directories holding every file the crate's `--emit=dep-info` lists at the pin (checked by lane
//   harness-m5c; a crates.io crate's inputs are its whole package directory). They key the aux cache and are the
//   alloc/std suites' `inputDirs`.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, UPSTREAM, hash } from "../scripts/lib/common.ts";
import { caseEnv, mergeEnv } from "../scripts/lib/env.ts";
import { oracleRustcCmd, rustcDriverHash } from "../scripts/lib/oracle.ts";

export const M5_TARGET = "x86_64-unknown-linux-gnu";

/** One `--extern`: the name the crate sees, the `LIB_CRATES` crate it is, and cargo's `priv:` mark. */
interface LibDep {
  as: string;
  crate: string;
  priv?: boolean;
}

export interface LibCrate {
  /** `--crate-name`. */
  name: string;
  edition: string;
  /** In-tree crate: its root, relative to the upstream checkout. Registry crate: relative to the package directory. */
  root: string;
  /** Registry crate: the crates.io package (its version is the one in library/Cargo.lock). */
  pkg?: string;
  /** The directories every file the build reads lies under (see the header); relative like `root`. */
  inputs: string[];
  /** `--cfg` values: cargo features (`feature="…"`) and build-script cfgs. */
  cfgs: string[];
  deps: LibDep[];
  /** Build-script `cargo:rustc-env`s. */
  env?: Record<string, string>;
}

const feat = (...fs: string[]): string[] => fs.map((f) => `feature="${f}"`);
const CORE_INPUTS = ["library/core/src", "library/stdarch/crates/core_arch", "library/portable-simd/crates/core_simd"];
/** cargo's `rustc-dep-of-std` pattern: `core` (and `alloc`) are the workspace shims. */
const WS_CORE: LibDep = { as: "core", crate: "rustc_std_workspace_core" };
const WS_ALLOC: LibDep = { as: "alloc", crate: "rustc_std_workspace_alloc" };

/** The crates, in build-std's build order (every crate after its deps). */
export const LIB_CRATES: LibCrate[] = [
  { name: "core", edition: "2024", root: "library/core/src/lib.rs", inputs: CORE_INPUTS, cfgs: [], deps: [] },
  {
    name: "compiler_builtins",
    edition: "2024",
    root: "library/compiler-builtins/compiler-builtins/src/lib.rs",
    // src/math/mod.rs `#[path]`s into ../libm.
    inputs: ["library/compiler-builtins/compiler-builtins/src", "library/compiler-builtins/libm/src"],
    // Features: its `default` (`arch`) + alloc's `compiler-builtins` + `unmangled-names`; the rest from its build.rs.
    cfgs: [...feat("arch", "compiler-builtins", "default", "unmangled-names"), "intrinsics_enabled", "f16_enabled", "f128_enabled", "mem_unaligned"],
    deps: [{ as: "core", crate: "core" }],
  },
  {
    name: "alloc",
    edition: "2024",
    root: "library/alloc/src/lib.rs",
    inputs: ["library/alloc/src"],
    cfgs: [],
    deps: [
      { as: "compiler_builtins", crate: "compiler_builtins", priv: true },
      { as: "core", crate: "core" },
    ],
  },
  {
    name: "rustc_std_workspace_core",
    edition: "2024",
    root: "library/rustc-std-workspace-core/lib.rs",
    inputs: ["library/rustc-std-workspace-core"],
    cfgs: [],
    deps: [
      { as: "compiler_builtins", crate: "compiler_builtins", priv: true },
      { as: "core", crate: "core" },
    ],
  },
  // libc's build.rs: `freebsd12`.
  { name: "libc", edition: "2021", pkg: "libc", root: "src/lib.rs", inputs: ["."], cfgs: [...feat("align", "rustc-dep-of-std", "rustc-std-workspace-core"), "freebsd12"], deps: [{ as: "rustc_std_workspace_core", crate: "rustc_std_workspace_core" }] },
  { name: "memchr", edition: "2021", pkg: "memchr", root: "src/lib.rs", inputs: ["."], cfgs: feat("core", "rustc-dep-of-std"), deps: [WS_CORE] },
  { name: "adler2", edition: "2021", pkg: "adler2", root: "src/lib.rs", inputs: ["."], cfgs: feat("core", "rustc-dep-of-std"), deps: [WS_CORE] },
  { name: "rustc_demangle", edition: "2015", pkg: "rustc-demangle", root: "src/lib.rs", inputs: ["."], cfgs: feat("core", "rustc-dep-of-std"), deps: [WS_CORE] },
  { name: "cfg_if", edition: "2018", pkg: "cfg-if", root: "src/lib.rs", inputs: ["."], cfgs: feat("core", "rustc-dep-of-std"), deps: [WS_CORE] },
  {
    name: "unwind",
    edition: "2024",
    root: "library/unwind/src/lib.rs",
    inputs: ["library/unwind/src"],
    cfgs: [],
    deps: [{ as: "libc", crate: "libc" }, WS_CORE],
  },
  {
    name: "rustc_std_workspace_alloc",
    edition: "2024",
    root: "library/rustc-std-workspace-alloc/lib.rs",
    inputs: ["library/rustc-std-workspace-alloc"],
    cfgs: [],
    deps: [{ as: "alloc", crate: "alloc" }],
  },
  {
    name: "panic_abort",
    edition: "2024",
    root: "library/panic_abort/src/lib.rs",
    inputs: ["library/panic_abort/src"],
    cfgs: [],
    deps: [{ as: "alloc", crate: "alloc" }, WS_CORE],
  },
  {
    name: "panic_unwind",
    edition: "2024",
    root: "library/panic_unwind/src/lib.rs",
    inputs: ["library/panic_unwind/src"],
    cfgs: [],
    deps: [{ as: "alloc", crate: "alloc" }, { as: "libc", crate: "libc" }, WS_CORE, { as: "unwind", crate: "unwind" }],
  },
  { name: "gimli", edition: "2024", pkg: "gimli", root: "src/lib.rs", inputs: ["."], cfgs: feat("read", "read-core", "rustc-dep-of-std"), deps: [WS_ALLOC, WS_CORE] },
  {
    name: "object",
    edition: "2018",
    pkg: "object",
    root: "src/lib.rs",
    inputs: ["."],
    // object's build.rs: `core_error`.
    cfgs: [...feat("alloc", "archive", "coff", "core", "elf", "macho", "pe", "read_core", "rustc-dep-of-std", "unaligned", "xcoff"), "core_error"],
    deps: [{ as: "memchr", crate: "memchr" }, WS_ALLOC, WS_CORE],
  },
  { name: "hashbrown", edition: "2024", pkg: "hashbrown", root: "src/lib.rs", inputs: ["."], cfgs: feat("alloc", "core", "nightly", "rustc-dep-of-std", "rustc-internal-api"), deps: [WS_ALLOC, WS_CORE] },
  { name: "miniz_oxide", edition: "2021", pkg: "miniz_oxide", root: "src/lib.rs", inputs: ["."], cfgs: feat("alloc", "core", "rustc-dep-of-std"), deps: [{ as: "adler2", crate: "adler2" }, WS_ALLOC, WS_CORE] },
  {
    name: "std_detect",
    edition: "2024",
    root: "library/std_detect/src/lib.rs",
    inputs: ["library/std_detect/src"],
    cfgs: [],
    deps: [{ as: "libc", crate: "libc" }, WS_ALLOC, WS_CORE],
  },
  { name: "addr2line", edition: "2018", pkg: "addr2line", root: "src/lib.rs", inputs: ["."], cfgs: feat("alloc", "core", "rustc-dep-of-std"), deps: [{ as: "gimli", crate: "gimli" }, WS_ALLOC, WS_CORE] },
  {
    name: "std",
    edition: "2024",
    root: "library/std/src/lib.rs",
    // `#[path]`s into library/backtrace and portable-simd's std_float; `include!` / `include_str!` of core's docs.
    inputs: ["library/std/src", "library/backtrace/src", "library/portable-simd/crates/std_float", ...CORE_INPUTS],
    cfgs: [...feat("addr2line", "backtrace", "miniz_oxide", "object", "panic-unwind"), "backtrace_in_libstd"],
    deps: [
      { as: "addr2line", crate: "addr2line", priv: true },
      { as: "alloc", crate: "alloc" },
      { as: "cfg_if", crate: "cfg_if", priv: true },
      { as: "core", crate: "core" },
      { as: "hashbrown", crate: "hashbrown", priv: true },
      { as: "libc", crate: "libc" },
      { as: "miniz_oxide", crate: "miniz_oxide", priv: true },
      { as: "object", crate: "object", priv: true },
      { as: "panic_abort", crate: "panic_abort", priv: true },
      { as: "panic_unwind", crate: "panic_unwind", priv: true },
      { as: "rustc_demangle", crate: "rustc_demangle", priv: true },
      { as: "std_detect", crate: "std_detect" },
      { as: "unwind", crate: "unwind", priv: true },
    ],
    env: { STD_ENV_ARCH: "x86_64" },
  },
];

export function libCrate(name: string): LibCrate {
  const c = LIB_CRATES.find((c) => c.name === name);
  if (!c) throw new Error(`ERROR: unknown library crate '${name}'`);
  return c;
}

/** The single version of crates.io package `pkg` in the upstream checkout's library/Cargo.lock. */
export function libLockedVersion(pkg: string, lock: string = readFileSync(join(UPSTREAM, "library", "Cargo.lock"), "utf8")): string {
  const vs = [...lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "registry\+/g)].filter((m) => m[1] === pkg).map((m) => m[2]!);
  if (vs.length !== 1) throw new Error(`ERROR: library/Cargo.lock has ${vs.length} crates.io versions of ${pkg} (${vs.join(", ")})`);
  return vs[0]!;
}

const pkgDirMemo = new Map<string, string>();
/** The directory of a crate's sources: the upstream checkout for in-tree crates, the registry package otherwise. */
function baseDir(c: LibCrate): string {
  if (!c.pkg) return UPSTREAM;
  let d = pkgDirMemo.get(c.pkg);
  if (d === undefined) {
    const v = libLockedVersion(c.pkg);
    const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "scripts", "crate-src.ts"), c.pkg, "--version", v], { stdout: "pipe", stderr: "pipe" });
    d = r.stdout.toString().trim();
    if (r.exitCode !== 0 || !existsSync(join(d, c.root))) throw new Error(`ERROR: no source of ${c.pkg}-${v} (bun scripts/crate-src.ts ${c.pkg} --version ${v}): ${(r.stdout.toString() + r.stderr.toString()).trim()}`);
    pkgDirMemo.set(c.pkg, d);
  }
  return d;
}

/** The crate root as rustc gets it: relative to the upstream checkout (the cwd) in-tree, absolute in the registry (as cargo passes it). */
export const libRoot = (c: LibCrate): string => (c.pkg ? join(baseDir(c), c.root) : c.root);

/** Crate `name` and its transitive deps, each once, deps first (`LIB_CRATES` order). */
export function libClosure(name: string): LibCrate[] {
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n)) return;
    for (const d of libCrate(n).deps) visit(d.crate);
    seen.add(n);
  };
  visit(name);
  return LIB_CRATES.filter((c) => seen.has(c.name));
}

export const EMPTY_SYSROOT = join(DATA, "aux", "m5-empty-sysroot");

/**
 * D1's argv of crate `name` (see the header), with `rmeta(dep)` giving each dependency's file: the oracle-built aux
 * crates by default. Building those is a side effect of the default (`oracleLibRmeta`).
 */
export function libArgs(name: string, rmeta: (crate: string) => string = oracleLibRmeta): string[] {
  const c = libCrate(name);
  if (!c.pkg)
    for (const d of c.inputs)
      if (!existsSync(join(UPSTREAM, d))) throw new Error(`ERROR: ${d} (an input of ${name}) is not in the upstream checkout; run: bun scripts/upstream.ts fetch`);
  const args = ["--crate-name", c.name, `--edition=${c.edition}`, libRoot(c), "--crate-type", "lib", "--target", M5_TARGET, "-Zforce-unstable-if-unmarked", "--emit=metadata"];
  for (const cfg of c.cfgs) args.push("--cfg", cfg);
  if (c.deps.length === 0) return args;
  if (!existsSync(EMPTY_SYSROOT)) mkdirSync(EMPTY_SYSROOT, { recursive: true });
  if (readdirSync(EMPTY_SYSROOT).length > 0) throw new Error(`ERROR: the M5 empty sysroot ${EMPTY_SYSROOT} is not empty`);
  args.push("--sysroot", EMPTY_SYSROOT);
  if (c.deps.some((d) => d.priv)) args.push("-Zunstable-options");
  for (const d of c.deps) args.push("--extern", `${d.priv ? "priv:" : ""}${d.as}=${rmeta(d.crate)}`);
  for (const t of libClosure(name).slice(0, -1)) args.push("-L", `dependency=${join(rmeta(t.name), "..")}`);
  if (c.pkg) args.push("--cap-lints", "allow");
  return args;
}

/** Build-script env of crate `name` (`cargo:rustc-env`), `{}` if none. */
export const libEnv = (name: string): Record<string, string> => ({ ...libCrate(name).env });

/** Every file under `dirs` (relative to `base`): relative path and content hash, sorted (difftest's `inputDirs` hash). */
function dirsHash(base: string, dirs: string[]): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(base, d), { withFileTypes: true })) {
      const rel = d === "." ? e.name : `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  for (const d of dirs) walk(d);
  files.sort();
  return hash(files.map((f) => `${f}\0${hash(readFileSync(join(base, f)))}`).join("\n"));
}

const rmetaMemo = new Map<string, string>();
/** The oracle's `lib<name>.rmeta` of crate `name` (with `libArgs`), built on first use with its deps (see the header). */
export function oracleLibRmeta(name: string): string {
  const memo = rmetaMemo.get(name);
  if (memo) return memo;
  const c = libCrate(name);
  const args = libArgs(name);
  const env = { RUSTC_ICE: "0", RUST_BACKTRACE: "0", ...libEnv(name) };
  const key = hash([rustcDriverHash(), dirsHash(baseDir(c), c.inputs), ...args, JSON.stringify(env)].join("\0")).slice(0, 16);
  const dir = join(DATA, "aux", `m5-${name}-${key}`);
  const out = join(dir, `lib${name}.rmeta`);
  if (!existsSync(out)) {
    const tmp = `${dir}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const r = Bun.spawnSync(oracleRustcCmd([...args, "-o", join(tmp, `lib${name}.rmeta`)]), { cwd: UPSTREAM, env: mergeEnv(process.env, caseEnv(env)), stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0 || !existsSync(join(tmp, `lib${name}.rmeta`))) {
      rmSync(tmp, { recursive: true, force: true });
      throw new Error(`ERROR: oracle build of aux crate ${name} failed (exit ${r.exitCode}): ${r.stderr.toString().trim().split("\n").slice(0, 3).join(" | ")}`);
    }
    try {
      renameSync(tmp, dir);
    } catch {
      // Another process built it first.
      rmSync(tmp, { recursive: true, force: true });
      if (!existsSync(out)) throw new Error(`ERROR: could not move the oracle build of aux crate ${name} to ${dir}`);
    }
  }
  rmetaMemo.set(name, out);
  return out;
}
