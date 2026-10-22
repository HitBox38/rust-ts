// Promotion (promote_consts.rs + rustc_const_eval check_consts/{mod, qualifs}) against the oracle: the mirdump probe
// (tools/probes/mirdump) prints, per body, `mir_built` and then `mir_promoted` with its promoted fragments. The port
// side builds the same bodies in process and runs what `mir_built` / `mir_promoted` run that changes MIR here:
// - `mir_built`: `build_mir_inner_impl`, then the pass list. Its other passes are stubs (lane mt-built-lints) and leave
//   these bodies unchanged (no uninhabited types; the rest are lints), so only `SimplifyCfg::Initial` runs;
// - `mir_promoted`: `RequiredConstsVisitor::compute_required_consts`, `PromoteTemps`, `SimplifyCfg::PromoteConsts`
//   (the phase change to `Analysis(Initial)`); `InstrumentCoverage` is off without `-Cinstrument-coverage`.
//   `mir_const_qualif` (const items) is skipped: it only supplies `tainted_by_errors`, which is `None` here, and its
//   `Checker` is lane const-check's.
// The bodies are then printed with `MirWriter::write_mir_fn` in the probe's layout and compared with the probe's
// output byte for byte (trivial consts, the probe's one-liners, are left out on both sides).
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import "../rustc_session/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import { MirWriter } from "../rustc_middle/mir/pretty.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { debug_IoError } from "../std/io.ts";
import { unwrap_result } from "../std/result.ts";
import { VecU8 } from "../vendor/anstream/stream.ts";
import "../rustc_mir_build/lib.ts";
import { run_passes } from "./pass_manager.ts";
import { PromoteTemps } from "./promote_consts.ts";
import { RequiredConstsVisitor } from "./required_consts.ts";
import { SimplifyCfg } from "./simplify.ts";
import { trivial_const } from "./trivial_const.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WORK = join(DATA, "tmp", "mt-promote-test", process.env.RUST_TS_AGENT ?? "default");

function probe(): string | undefined {
  try {
    const { probeBinary } = require("../../scripts/probes.ts") as typeof import("../../scripts/probes.ts");
    const p = probeBinary("mirdump");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
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
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

// A no_core crate: `&5` (a literal), `&[1, 2]` (an array aggregate), a reborrow through a `let`, a struct (the `Freeze`
// obligation of `HasMutInterior`), `&mut []` (the only promotable `&mut`), nested borrows `&[&1, &2]` (three
// promoteds, the inner ones `PromotedOut`), integer division by a non-zero constant, a borrowed argument and a
// borrowed call in a fn (not promotable), a borrowed `UnsafeCell` (`HasMutInterior`: not promotable), and const-fn calls in a `const` and a `static` (promoted: `Call`
// terminators in the promoted, `unwind continue`, `required_consts`).
const SRC = [
  "#![feature(no_core, lang_items, auto_traits)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  '#[lang = "freeze"] pub unsafe auto trait Freeze {}',
  '#[lang = "sync"] pub unsafe trait Sync {}',
  "impl Copy for u8 {}",
  "impl Copy for i32 {}",
  "impl<T: ?Sized> Copy for &T {}",
  "unsafe impl Sync for i32 {}",
  "unsafe impl<T: ?Sized + Sync> Sync for &T {}",
  '#[lang = "div"] pub trait Div<Rhs = Self> { type Output; fn div(self, rhs: Rhs) -> Self::Output; }',
  "impl Div for i32 { type Output = i32; fn div(self, rhs: i32) -> i32 { self / rhs } }",
  '#[lang = "unsafe_cell"] #[repr(transparent)] pub struct UnsafeCell<T: ?Sized> { pub v: T }',
  "pub struct P { pub a: i32 }",
  "pub fn a() -> &'static i32 { &5 }",
  "pub fn b() -> &'static [u8; 2] { &[1, 2] }",
  "pub fn c() -> i32 { let r = &(3, 4); r.0 }",
  "pub fn p() -> &'static P { &P { a: 1 } }",
  "pub fn d() -> &'static mut [i32; 0] { &mut [] }",
  "pub fn g() -> &'static [&'static i32; 2] { &[&1, &2] }",
  "pub fn h() -> &'static i32 { &(10 / 2) }",
  "pub fn e(x: i32) -> i32 { let r = &k(x); *r }",
  "pub fn f(x: i32) -> i32 { let r = &x; *r }",
  "pub fn v() -> i32 { let r = &UnsafeCell { v: 1 }; r.v }",
  "pub fn u(x: UnsafeCell<i32>, n: i32) -> UnsafeCell<i32> { let y = x; let m = n; let _r = &m; y }",
  "pub const fn k(x: i32) -> i32 { x }",
  "pub const C: &i32 = &k(3);",
  "pub static S: &i32 = &k(4);",
].join("\n");

/** The probe's output without the trivial consts' one-line items. */
function drop_trivial(out: string): string {
  return out
    .split("\n\n")
    .filter((chunk) => !/^const [^\n]*;\n?$/.test(chunk))
    .join("\n\n");
}

test("promoted MIR (mir_promoted and its promoted fragments) equals the mirdump probe's", () => {
  const p = probe();
  if (p === undefined) {
    if (REQUIRE) throw new Error("ERROR: mirdump probe missing (bun scripts/probes.ts build mirdump)");
    return;
  }
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "promote.rs");
  writeFileSync(file, SRC);
  const flags = ["--crate-type", "lib", "--edition", "2024", "-Zunpretty=mir"];
  const o = Bun.spawnSync([p, "--crate-type", "lib", "--edition", "2024", file], {
    cwd: WORK,
    env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" },
  });
  if (o.exitCode !== 0) throw new Error(`ERROR: probe failed: ${o.stderr.toString()}`);
  const oracle = drop_trivial(o.stdout.toString());
  expect(oracle).toContain("const C::promoted[0]: &i32 = {");

  let port = "";
  run_compiler(config_from_args([...flags, file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const write = (body: Body): string => {
        const w = new VecU8();
        unwrap_result(MirWriter.new(tcx).write_mir_fn(body, w), debug_IoError);
        return new TextDecoder("utf-8", { fatal: true }).decode(w.bytes());
      };
      const items: string[] = [];
      for (const def of tcx.mir_keys(null)) {
        if (tcx.is_constructor(LocalDefId.to_def_id(def))) continue;
        const body = tcx.build_mir_inner_impl(def) as Body;
        if (trivial_const(tcx, def, () => body) !== undefined) continue;
        // mir_built
        run_passes(tcx, body, [SimplifyCfg.Initial], undefined);
        let w = "// mir_built\n" + write(body);
        // mir_promoted
        RequiredConstsVisitor.compute_required_consts(body);
        const promote_pass = new PromoteTemps([]);
        run_passes(tcx, body, [promote_pass, SimplifyCfg.PromoteConsts], { $: "Analysis", _0: "Initial" });
        w += "\n// mir_promoted\n" + write(body);
        for (const promoted of promote_pass.promoted_fragments) w += "\n" + write(promoted);
        items.push(w);
      }
      port = items.join("\n");
    });
  });
  if (process.env.MTP_DEBUG) writeFileSync(join(WORK, "port.txt"), port);
  expect(port.trimEnd()).toBe(oracle.trimEnd());
}, 240_000);

// check_consts/resolver.rs: `FlowSensitiveAnalysis` through the dataflow framework, on `u` (built MIR after
// `SimplifyCfg::Initial`): `HasMutInterior` holds for the `UnsafeCell` argument from the start block on and flows into
// `y` (not cleared on move) and the return place; `NeedsDrop` holds for nothing (no drop glue in this crate).
test("FlowSensitiveAnalysis propagates qualifs (HasMutInterior / NeedsDrop)", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "promote_flow.rs");
  writeFileSync(file, SRC);
  const { check_consts } = require("../rustc_const_eval/lib.ts") as typeof import("../rustc_const_eval/lib.ts");
  const { FlowSensitiveAnalysis, debug_State } = check_consts.resolver;
  const { HasMutInterior, NeedsDrop } = check_consts.qualifs;
  const { PLAIN } = require("../std/fmt.ts") as typeof import("../std/fmt.ts");
  let seen: string[] = [];
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      for (const def of tcx.mir_keys(null)) {
        if (tcx.def_path_str(LocalDefId.to_def_id(def)) !== "u") continue;
        const body = tcx.build_mir_inner_impl(def) as Body;
        run_passes(tcx, body, [SimplifyCfg.Initial], undefined);
        const ccx = check_consts.ConstCx.new(tcx, body);
        for (const Q of [HasMutInterior, NeedsDrop]) {
          const cursor = FlowSensitiveAnalysis.new(Q, ccx).iterate_to_fixpoint(tcx, body, undefined).into_results_cursor(body);
          const last = body.basic_blocks.deref().length - 1;
          cursor.seek_to_block_end(last as never);
          seen.push(`${Q.ANALYSIS_NAME}: ${debug_State(cursor.get(), PLAIN)}`);
        }
      }
    });
  });
  // _1 = x, _2 = n, _3 = y, ...: `y = move _1` qualifies _3 (and leaves _1 qualified), `_0 = move _3` qualifies the
  // return place, `StorageDead(_3)` clears _3; `&m` borrows a `Freeze` local (no qualif, no borrow).
  expect(seen).toEqual([
    "flow_has_mut_interior: State { qualif: [_0, _1], borrow: [] }",
    "flow_needs_drop: State { qualif: [], borrow: [] }",
  ]);
}, 240_000);
