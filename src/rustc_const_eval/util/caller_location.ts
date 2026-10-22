// Port of compiler/rustc_const_eval/src/util/caller_location.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-util; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { CanAccessMutGlobal, type CompileTimeInterpCx } from "../const_eval/machine.ts";
import { mk_eval_cx_to_read_const_val } from "../const_eval/eval_queries.ts";
import { InternKind, intern_const_alloc_recursive } from "../interpret/intern.ts";
import { Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type ConstValue } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";

// stub: compiler/rustc_const_eval/src/util/caller_location.rs:12 alloc_caller_location (lane ctfe-util)
export function alloc_caller_location(ecx: CompileTimeInterpCx, filename: Symbol, line: number, col: number): MPlaceTy {
  return unported("rustc_const_eval::util::caller_location::alloc_caller_location");
}

// rustc: compiler/rustc_const_eval/src/util/caller_location.rs:56 const_caller_location_provider
export function const_caller_location_provider(tcx: TyCtxt, file: Symbol, line: number, col: number): ConstValue {
  // trace!("const_caller_location: {}:{}:{}", file, line, col);
  const ecx = mk_eval_cx_to_read_const_val(
    tcx,
    DUMMY_SP, // This interpreter cannot fail, so the span is irrelevant.
    TypingEnv.fully_monomorphized(),
    CanAccessMutGlobal.No,
  );

  const loc_place = alloc_caller_location(ecx, file, line, col);
  if (intern_const_alloc_recursive(ecx, InternKind.Constant, loc_place).$ === "Err") {
    bug("intern_const_alloc_recursive should not error in this case");
  }
  return { $: "Scalar", _0: Scalar.from_maybe_pointer(loc_place.ptr(), tcx) };
}
