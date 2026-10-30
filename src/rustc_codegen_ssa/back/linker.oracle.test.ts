// Oracle test for lane crateinfo-symbols: what `CrateInfo::new` (base.rs) computes for an rlib that is not
// codegen'd (`--emit=metadata`, plan-m5 D5): back/linker.rs `exported_symbols` / `linked_symbols`, back/lto.rs
// `exported_symbols_for_lto`, rustc_middle `metadata_symbol_name` and `Session::global_backend_features`.
//
// The metadata symbol name is checked against the oracle: a `dylib` of the same crate exports it, and rustc passes the
// export list to the linker as a version script (`-C linker` here is a script that copies it). The crate name and the
// `StableCrateId` inputs (name, not an executable, no `-C metadata`) are the same for both crate types.
//
// The port compiles a `#![no_core]` crate of the same name: with any extern crate (std, or core and compiler_builtins
// under `#![no_std]`), `CrateInfo::new` stops at `tcx.native_libraries(cnum)`, whose element decoder
// (`Decodable for rustc_crate_store::NativeLib`) is not generated yet. The source is not a `StableCrateId` input, so
// the oracle's name still applies.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { CrateInfo_new } from "../base.ts";
import type { CrateInfo } from "../lib.ts";

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

const WORK = join(DATA, "tmp", "crateinfo-symbols-oracle", process.env.RUST_TS_AGENT ?? "default");
const TUPLE = "x86_64-unknown-linux-gnu";
const NAME = "cislib";
const SRC = "pub fn add(a: u32, b: u32) -> u32 { a + b }\npub struct S;\n";
const SRC_NO_CORE = `#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
pub struct S;
`;

function sysroot(): string {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
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

function with_tcx(args: string[], f: (tcx: TyCtxt) => void): void {
  run_compiler(config_from_args(args), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      f(tcx);
    });
  });
}

/** The oracle's `rust_metadata_*` export of a dylib build of the crate (from the linker's version script). */
function oracle_metadata_symbol(src: string): string {
  const fake_ld = join(WORK, "fake-ld.sh");
  const list = join(WORK, "version-script.txt");
  writeFileSync(fake_ld, `#!/bin/sh\nfor a in "$@"; do case "$a" in *--version-script=*) cp "\${a#*--version-script=}" '${list}';; esac; done\nexit 0\n`);
  chmodSync(fake_ld, 0o755);
  const out = join(WORK, "dylib-out");
  mkdirSync(out, { recursive: true });
  const r = Bun.spawnSync(
    [...RUSTC, "--crate-type", "dylib", "--target", TUPLE, "--crate-name", NAME, "--out-dir", out, "-C", `linker=${fake_ld}`, src],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) throw new globalThis.Error(`ERROR: oracle dylib build failed: ${r.stderr.toString().slice(0, 2000)}`);
  const names = [...readFileSync(list, "utf8").matchAll(/\brust_metadata_\w+/g)].map((m) => m[0]);
  expect(names.length).toBe(1);
  return names[0]!;
}

test.skipIf(SKIP)("CrateInfo::new for a metadata-only rlib: empty symbol lists and the oracle's metadata symbol", () => {
  mkdirSync(WORK, { recursive: true });
  const src = join(WORK, `${NAME}.rs`);
  writeFileSync(src, SRC);
  const want_metadata_symbol = oracle_metadata_symbol(src);
  const src_no_core = join(WORK, "no_core", `${NAME}.rs`);
  mkdirSync(join(WORK, "no_core"), { recursive: true });
  writeFileSync(src_no_core, SRC_NO_CORE);

  let info: CrateInfo | undefined;
  const args = ["--crate-type", "lib", "--emit=metadata", "--target", TUPLE, "--sysroot", sysroot(), "--crate-name", NAME, src_no_core];
  with_tcx(args, (tcx) => {
    info = CrateInfo_new(tcx, "x86-64");
  });
  if (info === undefined) throw new globalThis.Error("ERROR: no CrateInfo");

  expect(info.metadata_symbol).toBe(want_metadata_symbol);
  expect([...info.exported_symbols]).toEqual([["Rlib", []]]);
  expect([...info.linked_symbols]).toEqual([["Rlib", []]]);
  expect(info.exported_symbols_for_lto).toEqual([]);
  // x86_64-unknown-linux-gnu has no spec features: no `"target-features"` in the oracle's LLVM IR (see
  // rust_ts/codegen_backend.oracle.test.ts).
  expect(info.target_features).toEqual([]);
  expect(info.target_cpu).toBe("x86-64");
}, 120_000);
