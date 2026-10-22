// Port of compiler/rustc_const_eval/src/const_eval/valtrees.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-a; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type VariantIdx } from "../../rustc_abi/lib.ts";
import { CanAccessMutGlobal, type CompileTimeInterpCx } from "./machine.ts";
import { mk_eval_cx_to_read_const_val } from "./eval_queries.ts";
import { Immediate } from "../interpret/operand.ts";
import { MemPlaceMeta } from "../interpret/place.ts";
import { type EvalToValTreeResult, type GlobalId } from "../../rustc_middle/mir/interpret/mod.ts";
import { type ConstValue } from "../../rustc_middle/mir/mod.ts";
import { type ValTree, type Value } from "../../rustc_middle/ty/consts/valtree.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { unported } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { InterpResult, ValTreeCreationError_from_ErrorHandled } from "../../rustc_middle/mir/interpret/mod.ts";
import { key_MPlaceTy } from "../interpret/place.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:22 branches (lane ctfe-a)
export function branches(ecx: CompileTimeInterpCx, place: MPlaceTy, field_count: number, variant: VariantIdx | undefined, num_nodes: MutRef<number>, visited: KeyedSet<MPlaceTy>, settled: KeyedMap<MPlaceTy, EvalToValTreeResult>): EvalToValTreeResult {
  return unported("rustc_const_eval::const_eval::valtrees::branches");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:64 slice_branches (lane ctfe-a)
export function slice_branches(ecx: CompileTimeInterpCx, place: MPlaceTy, num_nodes: MutRef<number>, visited: KeyedSet<MPlaceTy>, settled: KeyedMap<MPlaceTy, EvalToValTreeResult>): EvalToValTreeResult {
  return unported("rustc_const_eval::const_eval::valtrees::slice_branches");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:84 const_to_valtree_inner (lane ctfe-a)
export function const_to_valtree_inner(ecx: CompileTimeInterpCx, place: MPlaceTy, num_nodes: MutRef<number>, visited: KeyedSet<MPlaceTy>, settled: KeyedMap<MPlaceTy, EvalToValTreeResult>): EvalToValTreeResult {
  return unported("rustc_const_eval::const_eval::valtrees::const_to_valtree_inner");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:221 reconstruct_place_meta (lane ctfe-a)
export function reconstruct_place_meta(layout: TyAndLayout, valtree: ValTree, tcx: TyCtxt): MemPlaceMeta {
  return unported("rustc_const_eval::const_eval::valtrees::reconstruct_place_meta");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:256 create_valtree_place (lane ctfe-a)
export function create_valtree_place(ecx: CompileTimeInterpCx, layout: TyAndLayout, valtree: ValTree): MPlaceTy {
  return unported("rustc_const_eval::const_eval::valtrees::create_valtree_place");
}

// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:266 eval_to_valtree
export function eval_to_valtree(tcx: TyCtxt, typing_env: TypingEnv, cid: GlobalId): EvalToValTreeResult {
  crate().assert_typing_mode(typing_env.typing_mode());
  const r = tcx.eval_to_allocation_raw(typing_env.as_query_input(cid));
  if (r.$ === "Err") return Err(ValTreeCreationError_from_ErrorHandled(r._0));
  const const_alloc = r._0;

  // FIXME Need to provide a span to `eval_to_valtree`
  const ecx = mk_eval_cx_to_read_const_val(
    tcx,
    DUMMY_SP,
    typing_env,
    // It is absolutely crucial for soundness that
    // we do not read from mutable memory.
    CanAccessMutGlobal.No,
  );
  const place = InterpResult.unwrap(ecx.raw_const_to_mplace(const_alloc));
  // debug!(?place);

  const num_nodes: MutRef<number> = { value: 0 };
  const visited = new KeyedSet<MPlaceTy>(key_MPlaceTy);
  const settled = new KeyedMap<MPlaceTy, EvalToValTreeResult>(key_MPlaceTy);
  return const_to_valtree_inner(ecx, place, num_nodes, visited, settled);
}

/** Lazy `crate::assert_typing_mode` (lib.ts imports this module). */
function crate(): typeof import("../lib.ts") {
  return require("../lib.ts") as typeof import("../lib.ts");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:296 valtree_to_const_value (lane ctfe-a)
export function valtree_to_const_value(tcx: TyCtxt, typing_env: TypingEnv, cv: Value): ConstValue {
  return unported("rustc_const_eval::const_eval::valtrees::valtree_to_const_value");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:390 valtree_to_ref (lane ctfe-a)
export function valtree_to_ref(ecx: CompileTimeInterpCx, valtree: ValTree, pointee_ty: Ty): Immediate {
  return unported("rustc_const_eval::const_eval::valtrees::valtree_to_ref");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:406 valtree_into_mplace (lane ctfe-a)
export function valtree_into_mplace(ecx: CompileTimeInterpCx, place: MPlaceTy, valtree: ValTree): void {
  return unported("rustc_const_eval::const_eval::valtrees::valtree_into_mplace");
}

// stub: compiler/rustc_const_eval/src/const_eval/valtrees.rs:484 dump_place (lane ctfe-a)
export function dump_place(ecx: CompileTimeInterpCx, place: MPlaceTy): void {
  return unported("rustc_const_eval::const_eval::valtrees::dump_place");
}
