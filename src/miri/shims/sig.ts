// Port of src/tools/miri/src/shims/sig.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-b` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into sig.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { ShimSig, type Varargs } from "./sig.gen.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { type CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./sig.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/sig.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/sig.rs:273
    check_shim_symbol_clash(this: MiriInterpCx, link_name: Symbol): InterpResult;
    // shims/sig.rs:294
    check_shim_sig_deprecated(this: MiriInterpCx, abi: FnAbi<Ty>, exp_abi: CanonAbi, link_name: Symbol, args: readonly OpTy[]): InterpResult<readonly OpTy[]>;
    // shims/sig.rs:327
    check_shim_sig(this: MiriInterpCx, shim_sig: Pending<"fn(&MiriInterpCx<'tcx>) -> ShimSig<'tcx, N>">, _1: [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<readonly OpTy[]>;
    // shims/sig.rs:353
    check_shim_sig_variadic(this: MiriInterpCx, shim_sig: Pending<"fn(&MiriInterpCx<'tcx>) -> ShimSig<'tcx, N>">, _1: [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<[readonly OpTy[], Varargs]>;
    // shims/sig.rs:379
    check_varargs(this: MiriInterpCx, tys: Pending<"fn(&MiriInterpCx<'tcx>) -> [Ty<'tcx>; N]">, varargs: Varargs, fn_name: string): InterpResult<[readonly OpTy[], Varargs]>;
    // shims/sig.rs:438
    check_shim_sig_llvm_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[]): InterpResult<readonly OpTy[]>;
  }
}

declare module "./sig.gen.ts" {
  interface ShimSig {
    // shims/sig.rs:189
    as_abi(ecx: MiriInterpCx): FnAbi<Ty>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// macro_rules! shim_sig (shims/sig.rs:30)
// macro_rules! shim_varargs (shims/sig.rs:46)
// macro_rules! shim_sig_args_sep (shims/sig.rs:69)
// macro_rules! shim_sig_arg (shims/sig.rs:106)
// fn check_shim_abi (shims/sig.rs:202)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::sig::EvalContextExt", "src/tools/miri/src/shims/sig.rs", "miri-shims-b", () => InterpCx.prototype, ["check_shim_symbol_clash", "check_shim_sig_deprecated", "check_shim_sig", "check_shim_sig_variadic", "check_varargs", "check_shim_sig_llvm_intrinsic"]);
stub_methods("miri::shims::sig::ShimSig", "src/tools/miri/src/shims/sig.rs", "miri-shims-b", () => ShimSig.prototype, ["as_abi"]);
