// Port of src/tools/miri/src/eval.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-eval` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into eval.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type GenmcCtx } from "./concurrency/genmc/dummy.ts";
import { type MiriConfig, type MiriEntryFnType } from "./eval.gen.ts";
import { type ImmTy } from "./lib.ts";
import { type MiriInterpCx } from "./machine.ts";
import { type InterpResult } from "../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { type DefId } from "../rustc_span/def_id.ts";
import { type Pending } from "../rustc_type_ir/decls.ts";
import { unported } from "../std/panic.ts";
import { type Result } from "../std/result.ts";
export * from "./eval.gen.ts";

// eval.rs:40 (pub)
export function entry_fn(tcx: TyCtxt): [DefId, MiriEntryFnType] {
  return unported("miri::eval::entry_fn (src/tools/miri/src/eval.rs:40; lane miri-eval)");
}
// eval.rs:330 (pub)
export function create_ecx(tcx: TyCtxt, entry_id: DefId, entry_type: MiriEntryFnType, config: MiriConfig, genmc_ctx: GenmcCtx | undefined): InterpResult<MiriInterpCx> {
  return unported("miri::eval::create_ecx (src/tools/miri/src/eval.rs:330; lane miri-eval)");
}
// eval.rs:519 (pub)
export function eval_entry(tcx: TyCtxt, entry_id: DefId, entry_type: MiriEntryFnType, config: MiriConfig, genmc_ctx: GenmcCtx | undefined): Result<null, Pending<"NonZeroI32">> {
  return unported("miri::eval::eval_entry (src/tools/miri/src/eval.rs:519; lane miri-eval)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Default for MiriConfig (eval.rs:177): default (:178)
// impl MainThreadState<'tcx> (eval.rs:242) [MainThreadState is not a generated class: companion fns / hand type, lane decides]: on_main_stack_empty (:243)
// #[cfg(test)] mod tests (eval.rs:679): unit tests (port into a `.test.ts` next to this file)
// fn call_main (eval.rs:445)
// fn args_to_utf16_command_string (eval.rs:605)
