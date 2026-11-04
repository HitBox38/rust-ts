// Oracle test for lane crateinfo-symbols: `LlvmCodegenBackend::init`'s `global_backend_features`
// (`llvm_util::global_llvm_features(sess, false)`), which the session carries as `Session::global_backend_features`.
//
// The oracle shows it in LLVM IR: `attributes.rs` `target_features_attr` writes `"target-features"` as the global
// features followed by the fn's own (`#[target_feature]`) ones, and omits the attribute when the joined list is empty.
// A `no_core` crate with one plain fn therefore gives exactly `global_backend_features.join(",")` per target.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { Target } from "../rustc_target/spec/mod.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { sym } from "../rustc_span/symbol.ts";
import { ORACLE_ACCEPTED_LLVM_ARGS, update_target_reliable_float_cfg } from "./codegen_backend.ts";
import { TARGET_CONFIGS } from "./target_config.gen.ts";

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

const WORK = join(DATA, "tmp", "global-backend-features-oracle", process.env.RUST_TS_AGENT ?? "default");
const SRC = `#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[no_mangle] pub extern "C" fn f() {}
`;

/**
 * The built-in targets rust-ts has ported (rustc_target spec/targets): with no spec features, with `+v8a,+outline-atomics`
 * (aarch64 Linux), and with x86's LLVM renames (`cmpxchg16b` -> `cx16`, `lahfsahf` -> `sahf`; windows-msvc).
 */
const TARGETS = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "wasm32-wasip2",
];

function sysroot(): string {
  const oracle = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  return oracle.oracleSysroot();
}

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new globalThis.Error("ERROR: no config");
  return config;
}

function oracle_features(target: string, src: string): string[] {
  const ll = join(WORK, `${target}.ll`);
  const r = Bun.spawnSync([...RUSTC, "--crate-type", "lib", "--emit=llvm-ir", "--target", target, "--crate-name", "gbf", src, "-o", ll], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new globalThis.Error(`ERROR: oracle build for ${target} failed: ${r.stderr.toString().slice(0, 2000)}`);
  const attrs = new Set([...readFileSync(ll, "utf8").matchAll(/"target-features"="([^"]*)"/g)].map((m) => m[1]!));
  expect(attrs.size).toBeLessThanOrEqual(1);
  const [only] = attrs;
  return only === undefined ? [] : only.split(",");
}

function port_features(target: string, src: string): string[] {
  let got: string[] | undefined;
  const args = ["--crate-type", "lib", "--target", target, "--crate-name", "gbf", "--sysroot", sysroot(), src];
  run_compiler(config_from_args(args), (compiler) => {
    got = [...compiler.sess.global_backend_features];
  });
  if (got === undefined) throw new globalThis.Error("ERROR: run_compiler did not run the callback");
  return got;
}

test.skipIf(SKIP)("global_backend_features: equal to the oracle's LLVM `target-features`", () => {
  mkdirSync(WORK, { recursive: true });
  const src = join(WORK, "gbf.rs");
  writeFileSync(src, SRC);
  const got: Record<string, string[]> = {};
  const want: Record<string, string[]> = {};
  for (const target of TARGETS) {
    want[target] = oracle_features(target, src);
    got[target] = port_features(target, src);
  }
  expect(got).toEqual(want);
  // Not vacuous: some targets carry spec features, including LLVM renames.
  expect(want["aarch64-unknown-linux-gnu"]!.length).toBeGreaterThan(0);
  expect(want["x86_64-pc-windows-msvc"]).toContain("+cx16");
}, 120_000);

// Source of `ORACLE_ACCEPTED_LLVM_ARGS`: LLVM's parser takes the value silently and nothing rustc prints changes.
test.skipIf(SKIP)("ORACLE_ACCEPTED_LLVM_ARGS: the oracle accepts each value with no output of its own", () => {
  const run = (args: string[]) => {
    const r = Bun.spawnSync([...RUSTC, "--print", "cfg", "--target", "x86_64-unknown-linux-gnu", ...args], { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };
  const base = run([]);
  expect(base.code).toBe(0);
  expect(ORACLE_ACCEPTED_LLVM_ARGS.size).toBeGreaterThan(0);
  for (const args of ORACLE_ACCEPTED_LLVM_ARGS) {
    expect(run([`-Cllvm-args=${args}`])).toEqual(base);
  }
  // Not vacuous: an unknown value is LLVM's error, which is why the set is exact.
  expect(run(["-Cllvm-args=-not-a-real-llvm-arg"]).code).toBe(1);
}, 60_000);

// `update_target_reliable_float_cfg` is what the table recorded for every target with the default flags.
test("update_target_reliable_float_cfg: equal to the oracle table for every target", () => {
  for (const [tuple, t] of TARGET_CONFIGS) {
    const features = new Set(t.internal_target_features);
    const cfg = {
      internal_target_features: features.has("vsx") ? new Set([sym.vsx]) : new Set<typeof sym.vsx>(),
      has_reliable_f16: true,
      has_reliable_f16_math: true,
      has_reliable_f16b: true,
      has_reliable_f128: true,
      has_reliable_f128_math: true,
    };
    update_target_reliable_float_cfg(Target.expect_builtin(TargetTuple.from_tuple(tuple)), cfg);
    const { internal_target_features: _, ...got } = cfg;
    const { internal_target_features: __, ...want } = t;
    expect({ tuple, ...got }).toEqual({ tuple, ...want });
  }
});

// `target_config` with what `-C target-feature` and `-Z sanitizer` change: `--print cfg` shows `internal_target_features`
// and the `target_has_reliable_*` flags, stderr shows `internal_target_features`' warnings and errors.
const REPO_MAIN = join(import.meta.dir, "main.ts");
for (const [target, flags] of [
  ["x86_64-unknown-linux-gnu", ["-Ctarget-feature=+avx2,-sse3"]],
  ["x86_64-unknown-linux-gnu", ["-Ctarget-feature=-crt-static"]],
  ["x86_64-unknown-linux-gnu", ["-Ctarget-feature=+crt-static"]],
  ["x86_64-unknown-linux-gnu", ["-Ctarget-feature=+bogus"]],
  ["x86_64-unknown-linux-gnu", ["-Ctarget-feature=bogus"]],
  ["x86_64-unknown-linux-gnu", ["-Ctarget-feature=+pclmul"]],
  ["x86_64-unknown-linux-gnu", ["-Zsanitizer=kcfi", "-Cpanic=abort"]],
  ["x86_64-unknown-linux-gnu", ["-Zsanitizer=cfi", "-Clto", "-Ccodegen-units=1"]],
  ["aarch64-unknown-linux-gnu", ["-Ctarget-feature=-neon"]],
  ["aarch64-unknown-linux-gnu", ["-Ctarget-feature=+paca"]],
  ["aarch64-apple-darwin", ["-Ctarget-feature=-fp16"]],
] as [string, string[]][]) {
  test.skipIf(SKIP)(`target_config: rustc --print cfg --target ${target} ${flags.join(" ")}`, () => {
    const args = ["--print", "cfg", "--target", target, ...flags];
    const run = (cmd: string[]) => {
      const r = Bun.spawnSync([...cmd, ...args], { stdout: "pipe", stderr: "pipe" });
      return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    };
    expect(run([process.execPath, REPO_MAIN])).toEqual(run(RUSTC));
  }, 120_000);
}
