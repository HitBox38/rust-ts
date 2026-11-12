// Tests of lane cg-intrinsic-a's port of intrinsic.rs (:1-2046) against the pinned rustc's IR, through the IR model.
//
// The oracle crate is intrinsic_oracle/intr.rs, a `#![no_core]` lib with one `#[no_mangle]` function per sampled intrinsic. Its
// IR is `rustc +nightly-2026-10-11 --crate-type lib --target <t> --emit=llvm-ir -Cno-prepopulate-passes` (`-Copt-level=0`;
// `x86_64-unknown-linux-gnu.O2.ll` is `-Copt-level=2`), kept as fixtures; with the pinned toolchain present they are re-made
// and must be unchanged.
//
// Each test runs the port's front end on intr.rs for the same target and flags, so the `TyCtxt`, the intrinsic `Instance`s and
// the layouts are real, then `ModuleLlvm::new` + `CodegenCx::new` (as context.test.ts). It defines each `f_*` in the model,
// calls the port's intrinsic code for its body (`codegen_intrinsic_call`, or the trait method the ssa crate calls), and finishes
// the body as rustc_codegen_ssa does around the call (the `_0` value names, `ret`, the `unreachable` after `abort`). The printed
// body must equal the oracle's (comment lines and `; preds` tails dropped, as plan-m7 §1b's normal form does), and so must each
// intrinsic's `declare` line, less what LLVM adds and the normal form drops: the attribute group (` #N`) and the parameter
// attributes of an intrinsic declaration (`immarg`, `noundef`; `Intrinsic::getAttributes`, IR model PORT, intrinsics.ts header).
//
// Test doubles: what these compiles reach in other lanes' typed stubs. Each is restored after its test.
// - Copies of upstream bodies: `llvm_util::{get_version, target_cpu, tune_cpu}` (cg-write), `back::write::to_llvm_code_model`
//   (cg-write), `Session::{needs_plt, must_emit_unwind_tables, branch_protection}` (rustc_session), as context.test.ts's.
//   (`base::wants_msvc_seh` is ssa-base's real port since integ-w54.)
// - Not copies: `back::write::{create_informational_target_machine, create_target_machine}` return an opaque target machine
//   carrying the oracle's data layout, which the model's stub `LLVMRustSetDataLayoutFromTargetMachine` sets (its effect);
//   `LLVMDisposeTargetMachine` is a no-op. `FnAbi::{llvm_type, llvm_cconv, apply_attrs_llfn}` (cg-abi-consts), reached by
//   `gen_fn`'s `declare_fn` for `__rust_try`: the fixture's values, read off the oracle's `define` line (`i1 (ptr, ptr, ptr)`,
//   the C convention); attributes are not compared, so `apply_attrs_llfn` adds none.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import "../rustc_session/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import { OverflowOp } from "../rustc_codegen_ssa/traits/builder.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { BranchProtection } from "../rustc_session/config.ts";
import type { Session } from "../rustc_session/session.ts";
import { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PanicStrategy, type Target } from "../rustc_target/spec/mod.ts";
import { FnAbi } from "../rustc_target/callconv/mod.ts";
import { FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { IntPredicate } from "../rustc_codegen_ssa/common.ts";
import { OperandRef } from "../rustc_codegen_ssa/mir/operand.ts";
import * as ffi from "../rust_ts/llvm/ffi.ts";
import { Instruction, type Module as IrModule } from "../rust_ts/llvm/ir.ts";
import { printModule } from "../rust_ts/llvm/printer.ts";
import { Unported } from "../std/panic.ts";
import "./lib.ts";
import * as attributes from "./attributes.ts";
import { ModuleLlvm } from "./back/llvm_backend.ts";
import { OwnedTargetMachine } from "./back/owned_target_machine.ts";
import * as back_write from "./back/write.ts";
import { Builder } from "./builder.ts";
import * as context from "./context.ts";
import { CodegenCx } from "./context.ts";
import * as llvm from "./llvm/mod.ts";
import type { Type, Value } from "./llvm/mod.ts";
import * as llvm_util from "./llvm_util.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "intrinsic_oracle");
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "";
const WORK = join(DATA, "tmp", "cg-intrinsic-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

/** The fixtures: `<target>.ll` at `-Copt-level=0`, `<target>.O2.ll` at `-Copt-level=2`. */
const FIXTURES: readonly { file: string; target: string; opt: string[] }[] = [
  { file: "x86_64-unknown-linux-gnu.ll", target: "x86_64-unknown-linux-gnu", opt: [] },
  { file: "x86_64-pc-windows-msvc.ll", target: "x86_64-pc-windows-msvc", opt: [] },
  { file: "x86_64-unknown-linux-gnu.O2.ll", target: "x86_64-unknown-linux-gnu", opt: ["-Copt-level=2"] },
];
const oracle = (file: string): string => readFileSync(join(ORACLE, file), "utf8");

// ---- the port's front end, for a real TyCtxt (as context.test.ts) ----
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

function with_tcx<R>(target: string, opt: string[], f: (tcx: TyCtxt) => R): R {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "intr.rs");
  writeFileSync(file, readFileSync(join(ORACLE, "intr.rs")));
  let out: R | undefined;
  run_compiler(config_from_args(["--crate-type", "lib", "--target", target, "--emit=llvm-ir", "-Cno-prepopulate-passes", ...opt, file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      out = f(tcx);
    });
  });
  return out as R;
}

// ---- test doubles (header) ----
function install_doubles(oracle_data_layout: string): () => void {
  const spies: { mockRestore(): void }[] = [];
  const fake_tm = (): OwnedTargetMachine => new OwnedTargetMachine({ data_layout: oracle_data_layout } as unknown as llvm.TargetMachine);
  // llvm_util.rs:469 get_version
  spies.push(
    spyOn(llvm_util, "get_version").mockImplementation(() => {
      const llvm_major = { value: 0 };
      const llvm_minor = { value: 0 };
      const llvm_patch = { value: 0 };
      ffi.LLVMGetVersion(llvm_major, llvm_minor, llvm_patch);
      return [llvm_major.value, llvm_minor.value, llvm_patch.value];
    }),
  );
  // llvm_util.rs:657 target_cpu (`handle_native` of "native" is the host's CPU, a stop here)
  spies.push(
    spyOn(llvm_util, "target_cpu").mockImplementation((sess) => {
      const cpu_name = sess.opts.cg.target_cpu ?? sess.target.cpu;
      if (cpu_name === "native") throw new Error("ERROR: -Ctarget-cpu=native in a test");
      return cpu_name;
    }),
  );
  // llvm_util.rs:800 tune_cpu
  spies.push(
    spyOn(llvm_util, "tune_cpu").mockImplementation((sess) => {
      const name = sess.opts.unstable_opts.tune_cpu;
      if (name === undefined) return undefined;
      if (name === "native") throw new Error("ERROR: -Ztune-cpu=native in a test");
      return name;
    }),
  );
  spies.push(spyOn(back_write, "create_informational_target_machine").mockImplementation(fake_tm));
  spies.push(spyOn(back_write, "create_target_machine").mockImplementation(fake_tm));
  // back/write.rs:160 to_llvm_code_model
  spies.push(spyOn(back_write, "to_llvm_code_model").mockImplementation((code_model) => (code_model === undefined ? "None" : code_model)));
  spies.push(spyOn(OwnedTargetMachine.prototype, "drop").mockImplementation(() => {}));
  // The model's stub: its effect, the target machine's data layout on the module.
  spies.push(
    spyOn(ffi, "LLVMRustSetDataLayoutFromTargetMachine").mockImplementation((m, tm) => {
      (m as unknown as IrModule).dataLayout = (tm as unknown as { data_layout: string }).data_layout;
    }),
  );
  // session.rs:863 needs_plt
  const needs_plt = (sess: Session): boolean => {
    const want_plt = sess.target.plt_by_default;
    const dbg_opts = sess.opts.unstable_opts;
    const relro_level = sess.opts.cg.relro_level ?? sess.target.relro_level;
    const full_relro = relro_level === "Full";
    return dbg_opts.plt ?? (want_plt || !full_relro);
  };
  // session.rs:1144 must_emit_unwind_tables
  const must_emit_unwind_tables = (sess: Session): boolean =>
    sess.target.requires_uwtable || (sess.opts.cg.force_unwind_tables ?? (PanicStrategy.unwinds(sess.panic_strategy()) || sess.target.default_uwtable));
  // session.rs:1125 branch_protection (no `-Zbranch-protection` here)
  const branch_protection = (sess: Session): BranchProtection | undefined => {
    if (sess.opts.unstable_opts.branch_protection !== undefined) throw new Error("ERROR: -Zbranch-protection in a test");
    return undefined;
  };
  // session.rs:1092 direct_access_external_data
  const direct_access_external_data = (sess: Session): boolean | undefined => sess.opts.unstable_opts.direct_access_external_data ?? sess.target.direct_access_external_data;
  // The same four, stubbed twice: in context.ts (cg-context) and in attributes.ts's `SESSION_STOPS` (cg-types-attrs).
  spies.push(spyOn(context, "Session_needs_plt").mockImplementation(needs_plt));
  spies.push(spyOn(context, "Session_must_emit_unwind_tables").mockImplementation(must_emit_unwind_tables));
  spies.push(spyOn(context, "Session_branch_protection").mockImplementation(branch_protection));
  spies.push(spyOn(attributes.SESSION_STOPS, "needs_plt").mockImplementation(needs_plt));
  spies.push(spyOn(attributes.SESSION_STOPS, "must_emit_unwind_tables").mockImplementation(must_emit_unwind_tables));
  spies.push(spyOn(attributes.SESSION_STOPS, "branch_protection").mockImplementation(branch_protection));
  spies.push(spyOn(attributes.SESSION_STOPS, "direct_access_external_data").mockImplementation(direct_access_external_data));
  // The model normalizes only the triples it has checked (core.ts `NORMAL_TRIPLES`); Windows targets are out of M7 (plan-m7
  // D18). For x86_64-pc-windows-msvc the double sets the triple as given; the module's triple line is not compared.
  const set_normalized_target = ffi.LLVMRustSetNormalizedTarget;
  spies.push(
    spyOn(ffi, "LLVMRustSetNormalizedTarget").mockImplementation((m, triple) => {
      if (triple === "x86_64-pc-windows-msvc") (m as unknown as IrModule).targetTriple = triple;
      else set_normalized_target(m, triple);
    }),
  );
  // abi.rs (cg-abi-consts), for `__rust_try` only (header).
  spies.push(
    spyOn(FnAbi.prototype, "llvm_type").mockImplementation(function (this: FnAbi<Ty>, cx: CodegenCx): Type {
      return cx.type_func([cx.type_ptr(), cx.type_ptr(), cx.type_ptr()], cx.type_i1());
    }),
  );
  spies.push(spyOn(FnAbi.prototype, "llvm_cconv").mockImplementation(() => llvm.CallConv.CCallConv));
  spies.push(spyOn(FnAbi.prototype, "apply_attrs_llfn").mockImplementation(() => {}));
  return () => {
    for (const s of spies.reverse()) s.mockRestore();
  };
}

// ---- the oracle's text ----
/** The body of `@name`: from the first label to the closing brace, without comment lines and `; preds` tails. */
function body(ir: string, name: string): string {
  const lines = ir.split("\n");
  const start = lines.findIndex((l) => l.startsWith("define ") && l.includes(`@${name}(`));
  if (start < 0) throw new Error(`no define of @${name}`);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "}"; i++) {
    const l = lines[i]!;
    if (l.trimStart().startsWith(";")) continue;
    out.push(l.replace(/\s+; preds = .*$/, ""));
  }
  return out.join("\n");
}
/** The `declare` line of `@name`, less ` #N` and an intrinsic declaration's parameter attributes (header). */
function declare(ir: string, name: string): string {
  const l = ir.split("\n").find((x) => x.startsWith("declare ") && x.includes(`@${name}(`));
  if (l === undefined) throw new Error(`no declare of @${name}`);
  return l.replace(/ #\d+$/, "").replace(/ (immarg|noundef)\b/g, "");
}

// ---- driving the port ----
interface Run {
  tcx: TyCtxt;
  cx: CodegenCx;
  /** The crate's items by name. */
  def: (name: string) => DefId;
}

/** `ModuleLlvm::new` + `CodegenCx::new` over the oracle's module name, then `f`; the printed module. */
function run(fixture: (typeof FIXTURES)[number], f: (r: Run) => void): string {
  const ir = oracle(fixture.file);
  const dl = /^target datalayout = "(.*)"$/m.exec(ir)![1]!;
  const mod_name = /^; ModuleID = '([^']*)'/.exec(ir)![1]!;
  const restore = install_doubles(dl);
  try {
    return with_tcx(fixture.target, fixture.opt, (tcx) => {
      const llvm_module = ModuleLlvm.new(tcx, mod_name);
      // The CGU is only read under `-Cdebuginfo` (context.test.ts).
      const cx = CodegenCx.new(tcx, undefined as never, llvm_module, false);
      const names = new Map<string, DefId>();
      for (const id of (tcx.hir_crate_items(null) as ModuleItems).owners()) {
        const d = LocalDefId.to_def_id(id.def_id);
        const n = tcx.opt_item_name(d);
        if (n !== undefined) names.set(Symbol.as_str(n), d);
      }
      const def = (name: string): DefId => names.get(name) ?? (() => { throw new Error(`no item ${name}`); })();
      f({ tcx, cx, def });
      return printModule(llvm_module.llmod() as unknown as IrModule);
    });
  } finally {
    restore();
  }
}

/** The erased signature of the crate's fn `name`: its inputs' and output's layouts. */
function sig_layouts(r: Run, name: string): { inputs: TyAndLayout[]; output: TyAndLayout } {
  // `tcx.fn_sig(def_id).instantiate_identity().skip_norm_wip()` (queries.gen.ts types the value `unknown`), bound regions erased.
  const poly = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(r.tcx.fn_sig(r.def(name)) as EarlyBinder<PolyFnSig>));
  const sig = r.tcx.instantiate_bound_regions_with_erased(poly, fold_FnSig);
  return { inputs: FnSig.inputs(sig).map((t) => r.cx.layout_of(t)), output: r.cx.layout_of(FnSig.output(sig)) };
}

/** `define <ret> @name(<params>)` in the cx's module with named parameters, and a builder at its `start` block. */
function define(r: Run, name: string, params: string[]): { bx: Builder; ps: Value[]; inputs: TyAndLayout[]; output: TyAndLayout } {
  const { inputs, output } = sig_layouts(r, name);
  const cx = r.cx;
  const ret =
    output.is_zst() || output.ty.is_never()
      ? cx.type_void()
      : output.backend_repr.$ === "ScalarPair"
        ? cx.type_struct([output.scalar_pair_element_llvm_type(cx, 0, true), output.scalar_pair_element_llvm_type(cx, 1, true)], false)
        : output.immediate_llvm_type(cx);
  const fty = cx.type_func(inputs.map((l) => l.immediate_llvm_type(cx)), ret);
  const f = llvm.LLVMAddFunction(cx.llmod(), name, fty);
  const ps = params.map((p, i) => {
    const v = llvm.get_param(f, i);
    llvm.set_value_name(v, new TextEncoder().encode(p));
    return v;
  });
  const bx = Builder.build_inherent(cx, Builder.append_block_inherent(cx, f, "start"));
  return { bx, ps, inputs, output };
}

/** The intrinsic's `Instance` as rustc_codegen_ssa resolves a call to it. */
function intrinsic(r: Run, name: string, targs: Ty[]): Instance {
  const args = r.tcx.mk_args(targs.map((t) => GenericArg.from_Ty(t)));
  return Instance.expect_resolve(r.tcx, TypingEnv.fully_monomorphized(), r.def(name), args, DUMMY_SP);
}

const named = (v: Value, name: string): Value => {
  if (v instanceof Instruction) llvm.set_value_name(v, new TextEncoder().encode(name));
  return v;
};

/** `f_<x>(params) { <intrinsic>::<targs>(params) }` through `codegen_intrinsic_call`, returned as the ssa crate does. */
function scalar_case(r: Run, f: string, params: string[], intr: string, targs: (tcx: TyCtxt) => Ty[]): void {
  const { bx, ps, inputs, output } = define(r, f, params);
  const args = ps.map((p, i) => new OperandRef<Value>({ $: "Immediate", _0: p }, inputs[i]!, undefined));
  const res = bx.codegen_intrinsic_call(intrinsic(r, intr, targs(r.tcx)), args, output, undefined, DUMMY_SP);
  if (res.$ !== "Operand") throw new Error(`${f}: ${res.$}`);
  const v = res._0;
  if (v.$ === "Immediate") {
    bx.ret(named(v._0, "_0"));
  } else if (v.$ === "Pair") {
    named(v._0, "_0.0");
    named(v._1, "_0.1");
    // The return type of a `ScalarPair` (rustc_codegen_ssa's `immediate_backend_type`): its two immediate element types.
    const sty = r.cx.type_struct([output.scalar_pair_element_llvm_type(r.cx, 0, true), output.scalar_pair_element_llvm_type(r.cx, 1, true)], false);
    bx.ret(bx.insert_value(bx.insert_value(bx.const_poison(sty), v._0, 0), v._1, 1));
  } else {
    throw new Error(`${f}: ${v.$}`);
  }
}

describe("codegen_intrinsic_call against the oracle (x86_64-unknown-linux-gnu, -Copt-level=0)", () => {
  const fx = FIXTURES[0]!;
  const ir = oracle(fx.file);
  const stops: string[] = [];
  const printed = run(fx, (r) => {
    const t = r.tcx.types;
    scalar_case(r, "f_ctpop", ["x"], "ctpop", () => [t.u32]);
    scalar_case(r, "f_ctlz", ["x"], "ctlz", () => [t.u64]);
    scalar_case(r, "f_cttz_nz", ["x"], "cttz_nonzero", () => [t.u16]);
    scalar_case(r, "f_bswap", ["x"], "bswap", () => [t.u32]);
    scalar_case(r, "f_bswap8", ["x"], "bswap", () => [t.u8]);
    scalar_case(r, "f_sqrt", ["x"], "sqrtf64", () => []);
    scalar_case(r, "f_fma", ["a", "b", "c"], "fmaf32", () => []);
    scalar_case(r, "f_powi", ["x", "n"], "powif32", () => []);
    scalar_case(r, "f_sat", ["a", "b"], "saturating_add", () => [t.i16]);
    scalar_case(r, "f_vload", ["p"], "volatile_load", () => [t.u32]);
    scalar_case(r, "f_vload_pair", ["p"], "volatile_load", () => [sig_layouts(r, "f_vload_pair").output.ty]);
    scalar_case(r, "f_ptrmask", ["p", "m"], "ptr_mask", () => [t.u8]);
    scalar_case(r, "f_cmpb", ["a", "b", "n"], "compare_bytes", () => []);
    // `catch_unwind::<u8>`: the gnu `__rust_try` shim.
    scalar_case(r, "f_try", ["f", "d", "c"], "catch_unwind", () => [t.u8]);
    // `abort_immediate` is rustc_codegen_ssa's (mir/intrinsic.rs: `bx.abort_immediate()`, then the `unreachable` terminator).
    {
      const { bx } = define(r, "f_abort", []);
      bx.abort_immediate();
      bx.unreachable();
    }
    // `add_with_overflow` is rustc_codegen_ssa's too (`bx.checked_binop`, builder.rs); the declaration comes from this lane's
    // IR-model intrinsic table.
    {
      const { bx, ps } = define(r, "f_addo", ["a", "b"]);
      const [v, o] = bx.checked_binop(OverflowOp.Add, t.i32, ps[0]!, ps[1]!);
      named(v, "_0.0");
      named(o, "_0.1");
      const sty = bx.type_struct([bx.type_i32(), bx.type_i1()], false);
      bx.ret(bx.insert_value(bx.insert_value(bx.const_poison(sty), v, 0), o, 1));
    }
    // `#[link_name = "llvm.*"]` foreign fns: `codegen_llvm_intrinsic_call`. `llvm.debugtrap` is not overloaded (`intrinsic_fn`'s
    // signature check, then `Intrinsic::get_declaration`); `llvm.ctpop.i64` is (`declare_raw_fn`, with its `unnamed_addr`).
    {
      const { bx } = define(r, "f_llvm_debugtrap", []);
      bx.codegen_llvm_intrinsic_call(intrinsic(r, "llvm_debugtrap", []), [], false);
      bx.ret_void();
    }
    {
      const { bx, ps, inputs } = define(r, "f_llvm_ctpop", ["x"]);
      const v = bx.codegen_llvm_intrinsic_call(intrinsic(r, "llvm_ctpop_i64", []), [new OperandRef<Value>({ $: "Immediate", _0: ps[0]! }, inputs[0]!, undefined)], false);
      bx.ret(named(v, "_0"));
    }
    // `black_box`: the store into the return place, then `crate::asm::inline_asm_call` (cg-asm's stub).
    {
      const { bx, ps, inputs, output } = define(r, "f_bb", ["x"]);
      const place = bx.alloca(output.size, output.align.abi);
      named(place, "_0");
      try {
        bx.codegen_intrinsic_call(intrinsic(r, "black_box", [t.u32]), [new OperandRef<Value>({ $: "Immediate", _0: ps[0]! }, inputs[0]!, undefined)], output, { llval: place, llextra: undefined, align: output.align.abi } as never, DUMMY_SP);
      } catch (e) {
        if (!(e instanceof Unported)) throw e;
        stops.push(e.what);
      }
    }
  });

  for (const f of ["f_ctpop", "f_ctlz", "f_cttz_nz", "f_bswap", "f_bswap8", "f_sqrt", "f_fma", "f_powi", "f_sat", "f_vload", "f_vload_pair", "f_ptrmask", "f_cmpb", "f_try", "f_abort", "f_addo", "f_llvm_debugtrap", "f_llvm_ctpop"]) {
    test(`${f}: body`, () => {
      expect(body(printed, f)).toBe(body(ir, f));
    });
  }
  test("intrinsic declarations", () => {
    for (const n of ["llvm.ctpop.i32", "llvm.ctlz.i64", "llvm.cttz.i16", "llvm.bswap.i32", "llvm.sqrt.f64", "llvm.fma.f32", "llvm.powi.f32.i32", "llvm.sadd.sat.i16", "llvm.ptrmask.p0.i64", "llvm.trap", "llvm.sadd.with.overflow.i32", "llvm.debugtrap", "llvm.ctpop.i64"]) {
      expect(declare(printed, n)).toBe(declare(ir, n));
    }
    // `memcmp` (declare_intrinsic's own arm) has the C function's attributes in the oracle; their group is dropped likewise.
    expect(declare(printed, "memcmp")).toBe(declare(ir, "memcmp"));
  });
  test("catch_unwind (gnu): the `__rust_try` shim and the personality", () => {
    expect(body(printed, "__rust_try")).toBe(body(ir, "__rust_try"));
    const def = (s: string): string => s.split("\n").find((l) => l.startsWith("define ") && l.includes("@__rust_try("))!;
    // The `define` line, less the return attribute abi.rs adds (`zeroext`; cg-abi-consts), the attribute group (` #N`: the normal
    // form renumbers groups, and the fn attributes come from other lanes) and the `!guid` LLVM attaches later.
    expect(def(printed).replace(/ #\d+/, "")).toBe(def(ir).replace(" zeroext", "").replace(/ #\d+/, "").replace(/ !guid !\d+/, ""));
    expect(declare(printed, "rust_eh_personality")).toBe(declare(ir, "rust_eh_personality"));
  });
  test("black_box: the store into the return place, then cg-asm's inline_asm_call", () => {
    expect(stops).toEqual(["cg-asm: compiler/rustc_codegen_llvm/src/asm.rs inline_asm_call"]);
    expect(body(printed, "f_bb").split("\n")).toEqual(body(ir, "f_bb").split("\n").slice(0, 3));
  });
});

describe("catch_unwind on x86_64-pc-windows-msvc: the SEH `__rust_try` shim", () => {
  const fx = FIXTURES[1]!;
  const ir = oracle(fx.file);
  const printed = run(fx, (r) => {
    scalar_case(r, "f_try", ["f", "d", "c"], "catch_unwind", () => [r.tcx.types.u8]);
  });
  test("f_try and __rust_try bodies", () => {
    expect(body(printed, "f_try")).toBe(body(ir, "f_try"));
    expect(body(printed, "__rust_try")).toBe(body(ir, "__rust_try"));
  });
  test("the type descriptor global, its comdat, and the personality", () => {
    const lines = (s: string, re: RegExp): string[] => s.split("\n").filter((l) => re.test(l)).map((l) => l.replace(/, !guid !\d+$/, ""));
    const globals = /^[@$].*(rust_panic_type_info|type_info@@)/;
    expect(lines(printed, globals)).toEqual(lines(ir, globals));
    expect(lines(ir, globals).length).toBe(3);
    expect(declare(printed, "__CxxFrameHandler3")).toBe(declare(ir, "__CxxFrameHandler3"));
  });
});

describe("-Copt-level=2: assume and expect emit their intrinsics", () => {
  const fx = FIXTURES[2]!;
  const ir = oracle(fx.file);
  const printed = run(fx, (r) => {
    const { bx, ps } = define(r, "f_assume", ["x"]);
    bx.assume(ps[0]!);
    bx.ret_void();
    // `expect` (not in the oracle crate): `llvm.expect.i1(cond, expected)` when optimizing (intrinsic.rs:1036).
    const g = define(r, "f_ctpop", ["x"]);
    const c = g.bx.icmp(IntPredicate.IntEQ, g.ps[0]!, g.bx.const_i32(0));
    g.bx.expect(c, true);
    g.bx.ret(g.ps[0]!);
  });
  test("f_assume: body and the llvm.assume declaration", () => {
    expect(body(printed, "f_assume")).toBe(body(ir, "f_assume"));
    expect(declare(printed, "llvm.assume")).toBe(declare(ir, "llvm.assume"));
  });
  test("expect: llvm.expect.i1", () => {
    expect(body(printed, "f_ctpop")).toContain("call i1 @llvm.expect.i1(i1 %0, i1 true)");
    expect(printed).toContain("declare i1 @llvm.expect.i1(i1, i1)");
  });
});

describe("at -Copt-level=0, assume and expect emit nothing", () => {
  test("assume / expect", () => {
    const fx = FIXTURES[0]!;
    const printed = run(fx, (r) => {
      const { bx, ps } = define(r, "f_assume", ["x"]);
      bx.assume(ps[0]!);
      expect(bx.expect(ps[0]!, false)).toBe(ps[0]!);
      bx.ret_void();
    });
    expect(body(printed, "f_assume")).toBe(body(oracle(fx.file), "f_assume"));
  });
});

describe.skipIf(!HAVE && !REQUIRE)("the oracle fixtures are current", () => {
  for (const fx of FIXTURES) {
    test(fx.file, () => {
      mkdirSync(WORK, { recursive: true });
      writeFileSync(join(WORK, "intr.rs"), readFileSync(join(ORACLE, "intr.rs")));
      const argv = ["--crate-type", "lib", "--target", fx.target, "--emit=llvm-ir", "-Cno-prepopulate-passes", ...fx.opt, "intr.rs", "-o", fx.file];
      const r = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), ...argv], { cwd: WORK, env: { ...process.env, RUSTC_ICE: "0" } });
      expect(r.exitCode).toBe(0);
      expect(readFileSync(join(WORK, fx.file), "utf8")).toBe(oracle(fx.file));
    });
  }
});

