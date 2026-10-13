// Oracle checks of rustc_metadata creader.rs (lane creader) against the pinned nightly rustc.
//
// The subject is src/rust_ts/creader_probe.ts: the ported driver up to the global context (real `CStore`), then
//   - "postprocess" cases: `CStore::postprocess` (the `inject_*` decisions, allocator checks, unused/future-incompat
//     deps) and `report_session_incompatibilities` on the parsed crate;
//   - "pipeline" cases: `resolver_for_lowering` (extern crates / injected `extern crate core|std`).
// The oracle compiles the same file with `-Zunpretty=expanded` (which runs resolution, hence `postprocess`).
// Compared:
//   1. the crates creader tries to load: the probe prints `resolving crate `x`` for every `maybe_resolve_crate`;
//      the oracle's `RUSTC_LOG=rustc_metadata::creader=info` prints the same line. Ours (which stops where the
//      first found crate's metadata must be decoded: the rmeta decoder stub, wave 11) must be a prefix of the
//      oracle's list; when ours completes, the lists must be equal.
//   2. diagnostics: our stderr, up to `rust-ts: unported` / the final `error: aborting` summary, must be a prefix
//      of the oracle's stderr and contain the expected text.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "creader-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const BASE_ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined) continue;
  if (["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) continue;
  if (k.startsWith("CARGO_PKG_VERSION_")) continue;
  BASE_ENV[k] = v;
}
interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
function run(cmd: string[], env: Record<string, string>): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: { ...BASE_ENV, ...env }, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();

const NO_CORE = "#![feature(no_core)]\n#![no_core]\n";

interface Case {
  name: string;
  mode: "postprocess" | "pipeline";
  src: string;
  flags?: string[];
  env?: Record<string, string>;
  /** The crates our probe must try to load (in order; it stops at the first one that is found, the decoder is a stub). */
  crates: string[];
  /** Text our stderr must contain. */
  expect?: string[];
}

const CASES: Case[] = [
  // inject_panic_runtime
  { name: "needs_panic_runtime, bin, -Cpanic=unwind (target default)", mode: "postprocess", src: "#![feature(no_core, needs_panic_runtime)]\n#![no_core]\n#![needs_panic_runtime]\n", crates: ["panic_unwind", "rustc_std_workspace_core", "core"] },
  { name: "needs_panic_runtime, -Cpanic=abort", mode: "postprocess", src: "#![feature(no_core, needs_panic_runtime)]\n#![no_core]\n#![needs_panic_runtime]\n", flags: ["-Cpanic=abort"], crates: ["panic_abort", "rustc_std_workspace_core", "core"] },
  { name: "needs_panic_runtime, rlib (is_std overrides only_rlib)", mode: "postprocess", src: "#![feature(no_core, needs_panic_runtime)]\n#![no_core]\n#![needs_panic_runtime]\n", flags: ["--crate-type=rlib"], crates: ["panic_unwind", "rustc_std_workspace_core", "core"] },
  { name: "needs_panic_runtime, -Cpanic=immediate-abort: no runtime", mode: "postprocess", src: "#![feature(no_core, needs_panic_runtime)]\n#![no_core]\n#![needs_panic_runtime]\n", flags: ["-Zunstable-options", "-Cpanic=immediate-abort"], crates: [] },
  { name: "no_core bin: no runtime needed", mode: "postprocess", src: NO_CORE, crates: [] },
  { name: "no_core bin, -Cpanic=abort: no runtime needed", mode: "postprocess", src: NO_CORE, flags: ["-Cpanic=abort"], crates: [] },
  { name: "no_core rlib", mode: "postprocess", src: NO_CORE, flags: ["--crate-type=rlib"], crates: [] },
  // inject_profiler_runtime
  { name: "-Cprofile-generate loads the profiler runtime", mode: "postprocess", src: NO_CORE, flags: ["-Cprofile-generate=/tmp/creader-pgo"], crates: ["profiler_builtins"] },
  { name: "-Cinstrument-coverage loads the profiler runtime", mode: "postprocess", src: NO_CORE, flags: ["-Cinstrument-coverage"], crates: ["profiler_builtins"] },
  { name: "-Zno-profiler-runtime", mode: "postprocess", src: NO_CORE, flags: ["-Cinstrument-coverage", "-Zno-profiler-runtime"], crates: [] },
  { name: "-Zprofiler-runtime=<name> (not found, then the missing_core probe)", mode: "postprocess", src: NO_CORE, flags: ["-Cprofile-generate=/tmp/creader-pgo", "-Zprofiler-runtime=my_profiler"], crates: ["my_profiler", "core"] },
  // inject_allocator_crate
  {
    name: "needs_allocator, bin, no global allocator",
    mode: "postprocess",
    src: "#![feature(no_core, allocator_internals)]\n#![no_core]\n#![needs_allocator]\n",
    crates: [],
    expect: ["error: no global memory allocator found but one is required"],
  },
  { name: "needs_allocator, rlib", mode: "postprocess", src: "#![feature(no_core, allocator_internals)]\n#![no_core]\n#![needs_allocator]\n", flags: ["--crate-type=rlib"], crates: [] },
  { name: "needs_allocator + default_lib_allocator", mode: "postprocess", src: "#![feature(no_core, allocator_internals)]\n#![no_core]\n#![needs_allocator]\n#![default_lib_allocator]\n", crates: [] },
  {
    name: "multiple global allocators / alloc error handlers (fn_spans)",
    mode: "postprocess",
    src: [
      "#![feature(no_core, rustc_attrs)]",
      "#![no_core]",
      "#[rustc_std_internal_symbol] fn __rust_alloc() {}",
      "mod m { #[rustc_std_internal_symbol] fn __rust_alloc() {} }",
      "mod p { fn __rust_alloc_error_handler() {} }",
      "#[rustc_std_internal_symbol] fn __rust_alloc_error_handler() {}",
      "mod n { #[rustc_std_internal_symbol] fn __rust_alloc_error_handler() {} mod o { #[rustc_std_internal_symbol] fn __rust_alloc_error_handler() {} } }",
      "",
    ].join("\n"),
    crates: [],
    expect: ["error: cannot define multiple global allocators", "error: cannot define multiple allocation error handlers"],
  },
  {
    name: "global allocator + needs_allocator: no error",
    mode: "postprocess",
    src: "#![feature(no_core, rustc_attrs, allocator_internals)]\n#![no_core]\n#![needs_allocator]\n#[rustc_std_internal_symbol] fn __rust_alloc() {}\n",
    crates: [],
  },
  // compiler_builtins: `#![no_core]` and `#![compiler_builtins]` skip the injection
  { name: "compiler_builtins crate", mode: "postprocess", src: "#![feature(no_core, compiler_builtins)]\n#![no_core]\n#![compiler_builtins]\n", crates: [] },
  // report_session_incompatibilities with no extern crates
  {
    name: "unknown -Cunsafe-allow-abi-mismatch flags",
    mode: "postprocess",
    src: NO_CORE,
    flags: ["-Cunsafe-allow-abi-mismatch=foo,regparm,bar"],
    crates: [],
    expect: ["error: unknown target modifier `foo`, requested by `-Cunsafe-allow-abi-mismatch=foo`", "`bar`"],
  },
  { name: "denied partial mitigations enabled, no crates", mode: "postprocess", src: NO_CORE, flags: ["-Zstack-protector=strong", "-Ccontrol-flow-guard", "-Zallow-partial-mitigations=control-flow-guard"], crates: [] },
  // report_future_incompatible_deps
  {
    name: "wasm_bindgen 0.2.87",
    mode: "postprocess",
    src: NO_CORE,
    flags: ["--crate-name", "wasm_bindgen"],
    env: { CARGO_PKG_VERSION_MAJOR: "0", CARGO_PKG_VERSION_MINOR: "2", CARGO_PKG_VERSION_PATCH: "87" },
    crates: [],
    expect: ["error: older versions of the `wasm-bindgen` crate are incompatible with current versions of Rust"],
  },
  { name: "wasm_bindgen 0.2.88", mode: "postprocess", src: NO_CORE, flags: ["--crate-name", "wasm_bindgen"], env: { CARGO_PKG_VERSION_MAJOR: "0", CARGO_PKG_VERSION_MINOR: "2", CARGO_PKG_VERSION_PATCH: "88" }, crates: [] },
  {
    name: "wasm_bindgen, only a major version (0)",
    mode: "postprocess",
    src: NO_CORE,
    flags: ["--crate-name", "wasm_bindgen"],
    env: { CARGO_PKG_VERSION_MAJOR: "+0" },
    crates: [],
    expect: ["error: older versions of the `wasm-bindgen` crate"],
  },
  { name: "wasm_bindgen without cargo", mode: "postprocess", src: NO_CORE, flags: ["--crate-name", "wasm_bindgen"], crates: [] },
  // report_unused_deps_in_crate: a pathless `--extern` is a sysroot reference and never reported (`--extern
  // name=path` needs `rustc_fs_util::try_canonicalize`, unported in rustc_session).
  { name: "unused pathless --extern", mode: "postprocess", src: NO_CORE, flags: ["--extern", "foo"], crates: [] },
  // process_extern_crate / the extern prelude through the real resolver
  { name: "no_std injects extern crate core", mode: "pipeline", src: "#![no_std]\n", crates: ["core"] },
  { name: "std crate injects extern crate std", mode: "pipeline", src: "", crates: ["std", "core"] },
  { name: "extern crate in a no_core crate (not found, then the missing_core probe)", mode: "pipeline", src: NO_CORE + "extern crate foo;\n", crates: ["foo", "core"] },
  { name: "extern crate with a non-ASCII name (NonAsciiName, then the missing_core probe)", mode: "pipeline", src: NO_CORE + "extern crate föo;\n", crates: ["föo", "core"] },
];

function crates_of(lines: string[], re: RegExp): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const m = re.exec(l);
    if (m) out.push(m[1]!);
  }
  return out;
}

/** Our stderr up to the stop: without `rust-ts: unported: ..` and the driver's final `error: aborting ..` summary. */
function diag_prefix(stderr: string): string {
  let s = stderr;
  const u = s.lastIndexOf("rust-ts: unported: ");
  if (u >= 0) s = s.slice(0, u);
  const a = s.lastIndexOf("error: aborting due to");
  if (a >= 0) s = s.slice(0, a);
  return s;
}

for (const c of CASES) {
  test.skipIf(SKIP)(`creader oracle: ${c.name}`, () => {
    const file = join(WORK, `${c.name.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60)}.rs`);
    writeFileSync(file, c.src);
    const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", sysroot(), "--edition=2021", ...(c.flags ?? []), file];
    const env = c.env ?? {};

    const ours = run(["bun", join(REPO, "src", "rust_ts", "creader_probe.ts"), ...args], { ...env, RUST_TS_CREADER_MODE: c.mode });
    expect(ours.stderr).not.toContain("internal compiler error");
    const our_crates = crates_of(ours.stdout.split("\n"), /^resolving crate `(.*)`$/);
    expect(our_crates).toEqual(c.crates);

    const oracle_log = run([...RUSTC, "-Zunpretty=expanded", ...args], { ...env, RUSTC_LOG: "rustc_metadata::creader=info" });
    const oracle_crates = crates_of(oracle_log.stderr.split("\n"), /^ INFO rustc_metadata::creader resolving crate `(.*)`$/);
    if (ours.code === 70) {
      expect(ours.stderr).toContain("rust-ts: unported: odht::HashTable::from_raw_bytes");
      expect(oracle_crates.slice(0, our_crates.length)).toEqual(our_crates);
    } else {
      expect(oracle_crates).toEqual(our_crates);
    }

    const oracle = run([...RUSTC, "-Zunpretty=expanded", ...args], env);
    const prefix = diag_prefix(ours.stderr);
    expect(oracle.stderr.startsWith(prefix)).toBe(true);
    for (const e of c.expect ?? []) expect(prefix).toContain(e);
    if ((c.expect ?? []).length === 0) expect(prefix).toBe("");
  });
}
