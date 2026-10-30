// Oracle test for lane symbol-export-metadata: back/symbol_export.rs `exported_non_generic_symbols` (through
// `reachable_non_generics`, `symbol_export_level`, `exported_non_generic_symbols_helper`) and
// `exporting_symbol_name_for_instance_in_crate`, on a crate that is codegen'd (no `--emit=metadata`).
//
// The oracle's export list is the version script it passes to the linker for a `dylib` (export threshold `Rust`)
// and a `cdylib` (threshold `C`); `-C linker` here is a script that copies it. For this `#![no_core]` crate the list
// is the non-generic exports plus the metadata symbol (`dylib` only): nothing generic is codegen'd. The port runs in
// process on the same file and arguments, through `analysis`, and computes the same names, filtered by the threshold
// as linker.rs `for_each_exported_symbols_include_dep` does. The version script is sorted; so are the port's names
// here.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { type ExportedSymbol, type SymbolExportInfo, SymbolExportLevel } from "../../rustc_middle/middle/exported_symbols.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { exporting_symbol_name_for_instance_in_crate } from "./symbol_export.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync(oracle.oracleRustcCmd(["-vV"])).exitCode === 0;
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log("SKIP: pinned rustc unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = join(DATA, "tmp", "symbol-export-oracle", process.env.RUST_TS_AGENT ?? "default");
const TUPLE = "x86_64-unknown-linux-gnu";
const NAME = "sxlib";
const SRC = `#![feature(no_core, lang_items)]
#![allow(internal_features, dead_code)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "sync"] pub unsafe trait Sync {}
unsafe impl Sync for u32 {}
#[lang = "drop_glue"] unsafe fn drop_glue<T: PointeeSized>(_: &mut T) {}
pub struct S;
pub trait Tr { fn f() -> u8; fn g() -> u32 { 7 } }
impl Tr for S { fn f() -> u8 { 0 } }
impl S { pub fn inherent() -> u32 { 3 } fn private_inherent() {} }
pub fn plain() -> u32 { 1 }
fn private() -> u32 { 2 }
pub fn calls_private() -> u32 { private() }
#[inline] pub fn inl() -> u32 { 4 }
pub fn generic<T>(t: T) -> T { t }
pub const fn cfn() -> u32 { 5 }
#[unsafe(no_mangle)] pub extern "C" fn c_fn() -> u32 { 6 }
#[unsafe(no_mangle)] pub static C_STATIC: u32 = 8;
pub static RUST_STATIC: u32 = 9;
pub mod m { pub fn nested() -> u32 { 10 } }
`;

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
      tcx.analysis(null);
      f(tcx);
    });
  });
}

/** The `global:` names of the oracle's version script for `crate_type`. */
function oracle_exports(src: string, crate_type: string): string[] {
  const fake_ld = join(WORK, "fake-ld.sh");
  const list = join(WORK, `version-script-${crate_type}.txt`);
  rmSync(list, { force: true });
  writeFileSync(fake_ld, `#!/bin/sh\nfor a in "$@"; do case "$a" in *--version-script=*) cp "\${a#*--version-script=}" "$VS_OUT";; esac; done\nexit 0\n`);
  chmodSync(fake_ld, 0o755);
  const out = join(WORK, `${crate_type}-out`);
  mkdirSync(out, { recursive: true });
  const r = Bun.spawnSync(
    oracle.oracleRustcCmd(["--crate-type", crate_type, "--target", TUPLE, "-C", "panic=abort", "--out-dir", out, "-C", `linker=${fake_ld}`, src]),
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, VS_OUT: list } },
  );
  if (r.exitCode !== 0 || !existsSync(list)) throw new globalThis.Error(`ERROR: oracle ${crate_type} build failed: ${r.stderr.toString().slice(0, 2000)}`);
  const script = readFileSync(list, "utf8");
  const global = script.slice(script.indexOf("global:") + "global:".length, script.indexOf("local:"));
  return [...global.matchAll(/([^\s;]+);/g)].map((m) => m[1]!);
}

/** The port's names of `exported_non_generic_symbols(LOCAL_CRATE)` at or below `threshold`, sorted. */
function port_exports(src: string, crate_type: string, threshold: SymbolExportLevel): string[] {
  let names: string[] | undefined;
  const args = ["--crate-type", crate_type, "--target", TUPLE, "-C", "panic=abort", "--sysroot", oracle.oracleSysroot(), src];
  with_tcx(args, (tcx) => {
    const symbols = tcx.exported_non_generic_symbols(LOCAL_CRATE) as readonly [ExportedSymbol, SymbolExportInfo][];
    names = symbols
      .filter(([, info]) => SymbolExportLevel.is_below_threshold(info.level, threshold))
      .map(([symbol]) => exporting_symbol_name_for_instance_in_crate(tcx, symbol, LOCAL_CRATE));
  });
  if (names === undefined) throw new globalThis.Error("ERROR: no symbols");
  return names.sort();
}

test.skipIf(SKIP)("exported_non_generic_symbols equal the oracle's dylib and cdylib export lists", () => {
  mkdirSync(WORK, { recursive: true });
  const src = join(WORK, `${NAME}.rs`);
  writeFileSync(src, SRC);

  const want_dylib = oracle_exports(src, "dylib").filter((n) => !n.startsWith("rust_metadata_"));
  // a guard against a list that tests nothing: the Rust-level fns and statics, an impl method, and the C exports
  expect(want_dylib.length).toBe(9);
  expect(port_exports(src, "dylib", "Rust")).toEqual(want_dylib);

  const want_cdylib = oracle_exports(src, "cdylib");
  expect(want_cdylib).toEqual(["C_STATIC", "c_fn"]);
  expect(port_exports(src, "cdylib", "C")).toEqual(want_cdylib);
}, 120_000);
