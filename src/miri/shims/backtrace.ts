// Port of src/tools/miri/src/shims/backtrace.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-b` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Loc } from "../../rustc_span/lib.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/backtrace.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/backtrace.rs:10
    handle_miri_backtrace_size(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult;
    // shims/backtrace.rs:31
    handle_miri_get_backtrace(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[]): InterpResult;
    // shims/backtrace.rs:86
    resolve_frame_pointer(this: MiriInterpCx, ptr: OpTy): InterpResult<[Instance, Loc, string, string]>;
    // shims/backtrace.rs:111
    handle_miri_resolve_frame(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult;
    // shims/backtrace.rs:188
    handle_miri_resolve_frame_names(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[]): InterpResult;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::backtrace::EvalContextExt", "src/tools/miri/src/shims/backtrace.rs", "miri-shims-b", () => InterpCx.prototype, ["handle_miri_backtrace_size", "handle_miri_get_backtrace", "resolve_frame_pointer", "handle_miri_resolve_frame", "handle_miri_resolve_frame_names"]);
