// Oracle checks of rustc_metadata locator.rs (lane locator) against the pinned nightly rustc.
//
// Each case compiles a small file with `-Zunpretty=expanded --target x86_64-unknown-linux-gnu` through the real
// driver (src/rust_ts/main.ts) and through rustc, both run in the same work directory (so relative `--extern` /
// `-L` paths print the same), and compares:
//   - "full" cases: exit code, stdout and stderr byte for byte. They use a sysroot without the target's libraries
//     (an empty or a nonexistent directory), so no crate metadata is ever decoded: crate-not-found errors (E0463
//     with the target/sysroot notes), `--extern` path errors, `-L` staticlib/empty-rmeta candidates, ...
//   - "stop" cases: the locator finds a real candidate whose metadata must be read; ours stops at the named
//     `unported` (rmeta decoder / object reader, wave 11) and everything it printed before must be a prefix of the
//     oracle's stderr. When those lanes land, these cases turn into "full" ones (the test then fails: update it).
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

const WORK = join(DATA, "tmp", "locator-oracle", process.env.RUST_TS_AGENT ?? "default");
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
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: BASE_ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();

// Fixtures (relative to WORK).
const NO_CORE = "#![feature(no_core)]\n#![no_core]\n";
const SOURCES: Record<string, string> = {
  "std_crate.rs": "fn main() {}\n",
  "no_std.rs": "#![no_std]\n",
  "no_core.rs": NO_CORE,
  "extern_foo.rs": NO_CORE + "extern crate foo;\n",
  "extern_nonexistent.rs": NO_CORE + "extern crate nonexistent;\n",
  "extern_std.rs": NO_CORE + "extern crate std;\n",
  "extern_core.rs": NO_CORE + "extern crate core;\n",
  "extern_non_ascii.rs": NO_CORE + "extern crate föo;\n",
  "extern_rustc_foo.rs": NO_CORE + "extern crate rustc_foo;\n",
  "extern_two.rs": NO_CORE + "extern crate foo;\nextern crate bar;\n",
  "needs_panic_runtime.rs": "#![feature(no_core, needs_panic_runtime)]\n#![no_core]\n#![needs_panic_runtime]\n",
};
const EMPTY_FILES = ["d_static/libfoo.a", "d_two/libfoo-1.a", "d_two/libfoo-2.a", "d_empty/libfoo.rmeta", "notalib.txt", "libfoo.rmeta", "libfoo.so", "d_garbage/libfoo.rmeta"];
function setup(): void {
  for (const d of ["empty_sysroot", "adir", "d_static", "d_two", "d_empty", "d_garbage"]) mkdirSync(join(WORK, d), { recursive: true });
  for (const [f, src] of Object.entries(SOURCES)) writeFileSync(join(WORK, f), src);
  for (const f of EMPTY_FILES) writeFileSync(join(WORK, f), "");
  // A non-empty rmeta that is not metadata: the locator reads it, `MetadataBlob::new` decides.
  writeFileSync(join(WORK, "d_garbage/libfoo.rmeta"), "not metadata");
}

interface Case {
  name: string;
  args: string[];
  /** `undefined`: a sysroot without target libraries (`empty_sysroot`); "real": the oracle's sysroot; else a path. */
  sysroot?: "real" | string;
  /** For "stop" cases: the `unported` our run must stop at. */
  stop?: string;
  /** Text the oracle's stderr must contain (guards against cases that silently test nothing). */
  expect: string[];
}

// The first stop inside `CrateMetadata::new` (decoder.rs:1977): `incoherent_impls.decode((&cdata, tcx))`, lane
// rmeta-decoder-a's `MetaDecoder::decoder`.
const RMETA_DECODER = "rustc_metadata::rmeta::decoder::MetaDecoder::decoder for (&CrateMetadata, TyCtxt) (AllocDecodingState::new_decoding_session)";

const CASES: Case[] = [
  // A missing target sysroot (no std/core for the target).
  { name: "std crate, empty sysroot: can't find std (target not installed)", args: ["std_crate.rs"], expect: ["error[E0463]: can't find crate for `std`", "target may not be installed"] },
  { name: "std crate, nonexistent sysroot", args: ["std_crate.rs"], sysroot: "nonexistent_sysroot", expect: ["error[E0463]: can't find crate for `std`"] },
  { name: "std crate, -Cpanic=abort, empty sysroot", args: ["std_crate.rs", "-Cpanic=abort"], expect: ["error[E0463]: can't find crate for `std`"] },
  { name: "std crate, --crate-name, empty sysroot", args: ["std_crate.rs", "--crate-name", "xyz"], expect: ["error[E0463]: can't find crate for `std`"] },
  { name: "std crate, -Zui-testing, empty sysroot", args: ["std_crate.rs", "-Zui-testing"], expect: ["error[E0463]: can't find crate for `std`"] },
  { name: "no_std crate, empty sysroot: can't find core", args: ["no_std.rs"], expect: ["error[E0463]: can't find crate for `core`"] },
  { name: "explicit extern crate std (non-dummy span), empty sysroot", args: ["extern_std.rs"], expect: ["error[E0463]: can't find crate for `std`", "extern crate std;"] },
  { name: "explicit extern crate core, empty sysroot", args: ["extern_core.rs"], expect: ["error[E0463]: can't find crate for `core`"] },
  // extern crate of a crate that does not exist (core missing too: emit_fatal).
  { name: "extern crate nonexistent", args: ["extern_nonexistent.rs"], expect: ["error[E0463]: can't find crate for `nonexistent`", "can't find crate"] },
  { name: "two missing extern crates (fatal after the first)", args: ["extern_two.rs"], expect: ["error[E0463]: can't find crate for `foo`"] },
  { name: "extern crate rustc_*: rustc-dev help", args: ["extern_rustc_foo.rs"], expect: ["rustup component add rust-src rustc-dev llvm-tools-preview"] },
  { name: "extern crate with a non-ASCII name", args: ["extern_non_ascii.rs"], expect: ["föo"] },
  { name: "extern crate, -Zui-testing", args: ["extern_foo.rs", "-Zui-testing"], expect: ["error[E0463]: can't find crate for `foo`"] },
  // Injected runtimes that are not found.
  { name: "profiler runtime not found (-Cinstrument-coverage)", args: ["no_core.rs", "-Cinstrument-coverage"], expect: ["can't find crate for `profiler_builtins`"] },
  { name: "custom profiler runtime not found", args: ["no_core.rs", "-Cprofile-generate=/tmp/locator-pgo", "-Zprofiler-runtime=my_prof"], expect: ["can't find crate for `my_prof`"] },
  { name: "panic runtime not found", args: ["needs_panic_runtime.rs"], expect: ["can't find crate for `panic_unwind`"] },
  { name: "panic runtime not found, -Cpanic=abort", args: ["needs_panic_runtime.rs", "-Cpanic=abort"], expect: ["can't find crate for `panic_abort`"] },
  // --extern with bad paths.
  { name: "--extern path that does not exist", args: ["extern_foo.rs", "--extern", "foo=nope/libfoo.rlib"], expect: ["error: extern location for foo does not exist: nope/libfoo.rlib"] },
  { name: "--extern path that is a directory", args: ["extern_foo.rs", "--extern", "foo=adir"], expect: ["error: extern location for foo is not a file: adir"] },
  { name: "--extern path of an unknown type", args: ["extern_foo.rs", "--extern", "foo=notalib.txt"], expect: ["is of an unknown type: notalib.txt", "file name should be lib*.rlib or lib*.so"] },
  { name: "--extern path to a staticlib", args: ["extern_foo.rs", "--extern", "foo=d_static/libfoo.a"], expect: ["is of an unknown type: d_static/libfoo.a"] },
  { name: "--extern path to an empty rmeta (skipped, then not found)", args: ["extern_foo.rs", "--extern", "foo=libfoo.rmeta"], expect: ["error[E0463]: can't find crate for `foo`"] },
  { name: "--extern twice: empty rmeta + unknown type", args: ["extern_foo.rs", "--extern", "foo=libfoo.rmeta", "--extern", "foo=notalib.txt"], expect: ["is of an unknown type: notalib.txt"] },
  { name: "pathless --extern: searched like any crate", args: ["extern_foo.rs", "--extern", "foo"], expect: ["error[E0463]: can't find crate for `foo`"] },
  // -L paths.
  { name: "-L with a staticlib candidate (E0462)", args: ["extern_foo.rs", "-L", "d_static"], expect: ["error[E0462]: found staticlib `foo` instead of rlib or dylib", "crate `foo`: d_static/libfoo.a"] },
  { name: "-L with two staticlib candidates", args: ["extern_foo.rs", "-L", "d_two"], expect: ["d_two/libfoo-1.a", "d_two/libfoo-2.a"] },
  { name: "-L crate= with a staticlib candidate", args: ["extern_foo.rs", "-L", "crate=d_static"], expect: ["error[E0462]"] },
  { name: "-L dependency= is not searched for a direct dependency", args: ["extern_foo.rs", "-L", "dependency=d_static"], expect: ["error[E0463]: can't find crate for `foo`"] },
  { name: "-L native= is not searched for crates", args: ["extern_foo.rs", "-L", "native=d_static"], expect: ["error[E0463]: can't find crate for `foo`"] },
  { name: "-L with an empty rmeta (skipped)", args: ["extern_foo.rs", "-L", "d_empty"], expect: ["error[E0463]: can't find crate for `foo`"] },
  { name: "-L of a nonexistent directory", args: ["extern_foo.rs", "-L", "nonexistent_dir"], expect: ["error[E0463]: can't find crate for `foo`"] },
  // Stops: real metadata must be read.
  { name: "extern crate nonexistent, real sysroot (probes core: decoder)", args: ["extern_nonexistent.rs"], sysroot: "real", stop: RMETA_DECODER, expect: ["error[E0463]: can't find crate for `nonexistent`"] },
  { name: "std crate, real sysroot (decoder)", args: ["std_crate.rs"], sysroot: "real", stop: RMETA_DECODER, expect: [] },
  { name: "-L with a non-empty rmeta that is not metadata", args: ["extern_foo.rs", "-L", "d_garbage"], expect: ["error[E0786]: found invalid metadata files for crate `foo`"] },
  { name: "--extern path to a dylib (object reader)", args: ["extern_foo.rs", "--extern", "foo=libfoo.so"], expect: ["error[E0786]: found invalid metadata files for crate `foo`"] },
];

/** Our stderr up to the stop: without the `rust-ts: unported: ..` line. */
function before_stop(stderr: string): string {
  const u = stderr.lastIndexOf("rust-ts: unported: ");
  return u >= 0 ? stderr.slice(0, u) : stderr;
}

if (!SKIP) setup();
for (const c of CASES) {
  test.skipIf(SKIP)(`locator oracle: ${c.name}`, () => {
    const sr = c.sysroot === undefined ? join(WORK, "empty_sysroot") : c.sysroot === "real" ? sysroot() : join(WORK, c.sysroot);
    const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", sr, "--edition=2021", "-Zunpretty=expanded", ...c.args];

    const oracle = run([...RUSTC, ...args]);
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    const ours = run(["bun", join(REPO, "src", "rust_ts", "main.ts"), ...args]);
    expect(ours.stderr).not.toContain("internal compiler error");
    if (c.stop === undefined) {
      expect({ code: ours.code, stdout: ours.stdout, stderr: ours.stderr }).toEqual({ code: oracle.code, stdout: oracle.stdout, stderr: oracle.stderr });
    } else {
      expect(ours.code).toBe(70);
      expect(ours.stderr).toContain(`rust-ts: unported: ${c.stop}`);
      expect(oracle.stderr.startsWith(before_stop(ours.stderr))).toBe(true);
    }
  });
}
