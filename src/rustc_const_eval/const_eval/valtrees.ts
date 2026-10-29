// Port of compiler/rustc_const_eval/src/const_eval/valtrees.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-a; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { BackendRepr, FieldIdx, VariantIdx } from "../../rustc_abi/lib.ts";
import { VALTREE_MAX_NODES } from "./mod.ts";
import { CanAccessMutGlobal, type CompileTimeInterpCx } from "./machine.ts";
import { mk_eval_cx_to_read_const_val, op_to_const } from "./eval_queries.ts";
import { Immediate, OpTy_from_ImmTy, OpTy_from_MPlaceTy } from "../interpret/operand.ts";
import { ImmTy } from "../interpret/operand.gen.ts";
import { debug_MPlaceTy, MemPlaceMeta } from "../interpret/place.ts";
import { MemoryKind } from "../interpret/memory.ts";
import { debug_InternError, InternKind } from "../interpret/intern.gen.ts";
import { intern_const_alloc_recursive } from "../interpret/intern.ts";
import {
  debug_InterpErrorKind,
  type EvalToValTreeResult,
  type GlobalId,
  InterpResult,
  Scalar,
  Scalar_from_ScalarInt,
  ValTreeCreationError,
  ValTreeCreationError_from_ErrorHandled,
  ValTreeCreationError_from_InterpErrorInfo,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { ConstValue } from "../../rustc_middle/mir/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { ValTree, Value } from "../../rustc_middle/ty/consts/valtree.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_LayoutError, debug_TyAndLayout_Ty, LayoutCx, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { ValTreeKind } from "../../rustc_type_ir/const_kind.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_TyKind } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { bug } from "../../rustc_span/macros.ts";
import { format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import { Err, Ok, unwrap_result } from "../../std/result.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { key_MPlaceTy } from "../interpret/place.ts";
import { clone_MPlaceTy, MPlaceTy } from "../interpret/place.gen.ts";

// #[instrument(skip(ecx, visited, settled), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:22 branches
export function branches(ecx: CompileTimeInterpCx, place: MPlaceTy, field_count: number, variant: VariantIdx | undefined, num_nodes: MutRef<number>, visited: KeyedSet<MPlaceTy>, settled: KeyedMap<MPlaceTy, EvalToValTreeResult>): EvalToValTreeResult {
  let place_: MPlaceTy;
  if (variant !== undefined) {
    place_ = InterpResult.unwrap(ecx.project_downcast(place, variant));
  } else {
    place_ = clone_MPlaceTy(place);
  }
  // debug!(?place);

  const branches: Const[] = [];

  // For enums, we prepend their variant index before the variant's fields so we can figure out
  // the variant again when just seeing a valtree.
  if (variant !== undefined) {
    branches.push(Const.new_value(ecx.tcx.tcx, ValTree.from_scalar_int(ecx.tcx.tcx, ScalarInt.from_u32(VariantIdx.as_u32(variant))), ecx.tcx.tcx.types.u32));
  }

  for (let i = 0; i < field_count; i++) {
    const field = InterpResult.unwrap(ecx.project_field(place_, FieldIdx.from_usize(i)));
    const valtree = const_to_valtree_inner(ecx, field, num_nodes, visited, settled);
    if (valtree.$ === "Err") return valtree;
    branches.push(Const.new_value(ecx.tcx.tcx, valtree._0, field.layout.ty));
  }

  // Have to account for ZSTs here
  if (branches.length === 0) {
    num_nodes.value += 1;
  }

  return Ok(ValTree.from_branches(ecx.tcx.tcx, branches));
}

// #[instrument(skip(ecx, visited, settled), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:64 slice_branches
export function slice_branches(ecx: CompileTimeInterpCx, place: MPlaceTy, num_nodes: MutRef<number>, visited: KeyedSet<MPlaceTy>, settled: KeyedMap<MPlaceTy, EvalToValTreeResult>): EvalToValTreeResult {
  const n = InterpResult.unwrap_or_else(place.len(ecx), (_) => panic(`expected to use len of place ${debug_MPlaceTy(place, PLAIN)}`));

  const elems: Const[] = [];
  for (let i = 0n; i < n; i++) {
    const place_elem = InterpResult.unwrap(ecx.project_index(place, i));
    const valtree = const_to_valtree_inner(ecx, place_elem, num_nodes, visited, settled);
    if (valtree.$ === "Err") return valtree;
    elems.push(Const.new_value(ecx.tcx.tcx, valtree._0, place_elem.layout.ty));
  }

  return Ok(ValTree.from_branches(ecx.tcx.tcx, elems));
}

// #[instrument(skip(ecx, visited, settled), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:84 const_to_valtree_inner
export function const_to_valtree_inner(ecx: CompileTimeInterpCx, place: MPlaceTy, num_nodes: MutRef<number>, visited: KeyedSet<MPlaceTy>, settled: KeyedMap<MPlaceTy, EvalToValTreeResult>): EvalToValTreeResult {
  const tcx = ecx.tcx.tcx;
  const ty = place.layout.ty;
  // debug!("ty kind: {:?}", ty.kind());

  const s = settled.get(place);
  if (s !== undefined) {
    return s;
  }

  if (visited.has(place)) {
    return Err(ValTreeCreationError.CyclicConst);
  }

  if (num_nodes.value >= VALTREE_MAX_NODES) {
    return Err(ValTreeCreationError.NodesOverflow);
  }

  visited.add(clone_MPlaceTy(place));

  let result: EvalToValTreeResult;
  const k = ty.kind();
  switch (k.$) {
    case "FnDef": {
      num_nodes.value += 1;
      result = Ok(ValTree.zst(tcx));
      break;
    }
    case "Bool":
    case "Int":
    case "Uint":
    case "Float":
    case "Char": {
      const r = InterpResult.report_err(ecx.read_immediate(place));
      if (r.$ === "Err") return Err(ValTreeCreationError_from_InterpErrorInfo(r._0));
      const val = InterpResult.unwrap(r._0.to_scalar_int());
      num_nodes.value += 1;

      result = Ok(ValTree.from_scalar_int(tcx, val));
      break;
    }

    case "Pat": {
      const base = k._0;
      // The valtree of the base type is the same as the valtree of the pattern type.
      // Since the returned valtree does not contain the type or layout, we can just
      // switch to the base type.
      const place_ = new MPlaceTy(clone_MPlaceTy(place).mplace, unwrap_result(ecx.layout_of(base), debug_InterpErrorKind));
      result = const_to_valtree_inner(ecx, place_, num_nodes, visited, settled);
      break;
    }

    case "RawPtr": {
      // Not all raw pointers are allowed, as we cannot properly test them for
      // equality at compile-time (see `ptr_guaranteed_cmp`).
      // However we allow those that are just integers in disguise.
      // First, get the pointer. Remember it might be wide!
      const r = InterpResult.report_err(ecx.read_immediate(place));
      if (r.$ === "Err") return Err(ValTreeCreationError_from_InterpErrorInfo(r._0));
      const val = r._0;
      // We could allow wide raw pointers where both sides are integers in the future,
      // but for now we reject them.
      if (val.layout.backend_repr.$ === "ScalarPair") {
        result = Err({ $: "NonSupportedType", _0: ty });
      } else {
        const val_ = Immediate.to_scalar(val.imm);
        // We are in the CTFE machine, so ptr-to-int casts will fail.
        // This can only be `Ok` if `val` already is an integer.
        const i = Scalar.try_to_scalar_int(val_);
        switch (i.$) {
          case "Ok":
            result = Ok(ValTree.from_scalar_int(tcx, i._0));
            break;
          case "Err":
            result = Err({ $: "NonSupportedType", _0: ty });
            break;
        }
      }
      break;
    }

    // Technically we could allow function pointers (represented as `ty::Instance`), but this is not guaranteed to
    // agree with runtime equality tests.
    case "FnPtr":
      result = Err({ $: "NonSupportedType", _0: ty });
      break;

    case "Ref": {
      const r = InterpResult.report_err(ecx.deref_pointer(place));
      if (r.$ === "Err") return Err(ValTreeCreationError_from_InterpErrorInfo(r._0));
      const derefd_place = r._0;
      result = const_to_valtree_inner(ecx, derefd_place, num_nodes, visited, settled);
      break;
    }

    case "Str":
    case "Slice":
    case "Array": {
      result = slice_branches(ecx, place, num_nodes, visited, settled);
      break;
    }
    // Trait objects are not allowed in type level constants, as we have no concept for
    // resolving their backing type, even if we can do that at const eval time. We may
    // hypothetically be able to allow `dyn StructuralPartialEq` trait objects in the future,
    // but it is unclear if this is useful.
    case "Dynamic":
      result = Err({ $: "NonSupportedType", _0: ty });
      break;

    case "Tuple": {
      const elem_tys = k._0;
      result = branches(ecx, place, elem_tys.length, undefined, num_nodes, visited, settled);
      break;
    }

    case "Adt": {
      const def = k._0;
      if (def.is_union()) {
        result = Err({ $: "NonSupportedType", _0: ty });
      } else if (def.variants().length === 0) {
        return bug("uninhabited types should have errored and never gotten converted to valtree");
      } else {
        const r = InterpResult.report_err(ecx.read_discriminant(place));
        if (r.$ === "Err") return Err(ValTreeCreationError_from_InterpErrorInfo(r._0));
        const variant = r._0;
        result = branches(ecx, place, def.variant(variant).fields.length, def.is_enum() ? variant : undefined, num_nodes, visited, settled);
      }
      break;
    }

    // FIXME(oli-obk): we could look behind opaque types
    case "Alias":
      result = Err({ $: "NonSupportedType", _0: ty });
      break;

    // FIXME(oli-obk): we can probably encode closures just like structs
    case "Closure":
      result = Err({ $: "NonSupportedType", _0: ty });
      break;

    case "Never":
    case "Error":
    case "Foreign":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Infer":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "UnsafeBinder":
      result = Err({ $: "NonSupportedType", _0: ty });
      break;
  }

  visited.delete(place);
  settled.set(clone_MPlaceTy(place), result);
  return result;
}

/// Valtrees don't store the `MemPlaceMeta` that all dynamically sized values have in the interpreter.
/// This function reconstructs it.
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:221 reconstruct_place_meta
export function reconstruct_place_meta(layout: TyAndLayout, valtree: ValTree, tcx: TyCtxt): MemPlaceMeta {
  if (layout.is_sized()) {
    return MemPlaceMeta.None;
  }

  let last_valtree = valtree;
  // Traverse the type, and update `last_valtree` as we go.
  //
  // FIXME(#155345): Missing normalization call
  const tail = tcx.struct_tail_raw(
    layout.ty,
    ObligationCause.dummy(),
    (ty) => Unnormalized.skip_norm_wip(ty),
    () => {
      const branches = ValTreeKind.to_branch(last_valtree.kind()) as unknown as readonly Const[];
      last_valtree = unwrap(branches[branches.length - 1]).to_value().valtree;
      // debug!(?branches, ?last_valtree);
    },
  );
  // Sanity-check that we got a tail we support.
  const tk = tail.kind();
  if (!(tk.$ === "Slice" || tk.$ === "Str")) {
    return bug("unsized tail of a valtree must be Slice or Str");
  }

  // Get the number of elements in the unsized field.
  const num_elems = (ValTreeKind.to_branch(last_valtree.kind()) as unknown as readonly Const[]).length;
  return { $: "Meta", _0: Scalar.from_target_usize(BigInt(num_elems), tcx) };
}

// #[instrument(skip(ecx), level = "debug", ret)]
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:256 create_valtree_place
export function create_valtree_place(ecx: CompileTimeInterpCx, layout: TyAndLayout, valtree: ValTree): MPlaceTy {
  const meta = reconstruct_place_meta(layout, valtree, ecx.tcx.tcx);
  return InterpResult.unwrap(ecx.allocate_dyn(layout, MemoryKind.Stack, meta));
}

/// Evaluates a constant and turns it into a type-level constant value.
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
  return (crate_cache ??= require("../lib.ts") as typeof import("../lib.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var crate_cache: typeof import("../lib.ts") | undefined;

/// Converts a `ValTree` to a `ConstValue`, which is needed after mir
/// construction has finished.
// FIXME(valtrees): Merge `valtree_to_const_value` and `valtree_into_mplace` into one function
// #[instrument(skip(tcx), level = "debug", ret)]
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:296 valtree_to_const_value
export function valtree_to_const_value(tcx: TyCtxt, typing_env: TypingEnv, cv: Value): ConstValue {
  // Basic idea: We directly construct `Scalar` values from trivial `ValTree`s
  // (those for constants with type bool, int, uint, float or char).
  // For all other types we create an `MPlace` and fill that by walking
  // the `ValTree` and using `place_projection` and `place_field` to
  // create inner `MPlace`s which are filled recursively.
  // FIXME: Does this need an example?
  const k = cv.ty.kind();
  switch (k.$) {
    case "FnDef": {
      assert(cv.valtree.is_zst(), "assertion failed: cv.valtree.is_zst()");
      return ConstValue.ZeroSized;
    }
    case "Bool":
    case "Int":
    case "Uint":
    case "Float":
    case "Char":
    case "RawPtr": {
      return { $: "Scalar", _0: { $: "Int", _0: Value.to_leaf(cv) } };
    }
    case "Pat": {
      const ty = k._0;
      const cv_: Value = { valtree: cv.valtree, ty };
      return valtree_to_const_value(tcx, typing_env, cv_);
    }
    case "Ref": {
      const inner_ty = k._1;
      const ecx = mk_eval_cx_to_read_const_val(tcx, DUMMY_SP, typing_env, CanAccessMutGlobal.No);
      const imm = valtree_to_ref(ecx, cv.valtree, inner_ty);
      const imm_ = ImmTy.from_immediate(imm, unwrap_result(tcx.layout_of(typing_env.as_query_input(cv.ty)), debug_LayoutError));
      return op_to_const(ecx, OpTy_from_ImmTy(imm_), /* for diagnostics */ false);
    }
    case "Tuple":
    case "Array":
    case "Adt": {
      const layout = unwrap_result(tcx.layout_of(typing_env.as_query_input(cv.ty)), debug_LayoutError);
      if (layout.is_zst()) {
        // Fast path to avoid some allocations.
        return ConstValue.ZeroSized;
      }
      const ck = cv.ty.kind();
      if (BackendRepr.is_scalar(layout.backend_repr) && (ck.$ === "Tuple" || (ck.$ === "Adt" && ck._0.is_struct()))) {
        // A Scalar tuple/struct; we can avoid creating an allocation.
        const branches = Value.to_branch(cv);
        // Find the non-ZST field. (There can be aligned ZST!)
        for (let i = 0; i < branches.length; i++) {
          const inner_valtree = branches[i]!;
          const field = layout.field(LayoutCx.new(tcx, typing_env), i);
          if (!field.is_zst()) {
            const cv_: Value = { valtree: inner_valtree.to_value().valtree, ty: field.ty };
            return valtree_to_const_value(tcx, typing_env, cv_);
          }
        }
        return bug(`could not find non-ZST field during in ${format_debug(layout, debug_TyAndLayout_Ty, PRETTY)}`);
      }

      const ecx = mk_eval_cx_to_read_const_val(tcx, DUMMY_SP, typing_env, CanAccessMutGlobal.No);

      // Need to create a place for this valtree.
      const place = create_valtree_place(ecx, layout, cv.valtree);

      valtree_into_mplace(ecx, place, cv.valtree);
      dump_place(ecx, place);
      unwrap_result(intern_const_alloc_recursive(ecx, InternKind.Constant, place), debug_InternError);

      return op_to_const(ecx, OpTy_from_MPlaceTy(place), /* for diagnostics */ false);
    }
    case "Never":
    case "Error":
    case "Foreign":
    case "Alias":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Infer":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "FnPtr":
    case "Str":
    case "Slice":
    case "Dynamic":
    case "UnsafeBinder": {
      return bug(`no ValTree should have been created for type ${debug_TyKind(cv.ty.kind(), PLAIN)}`);
    }
  }
}

/// Put a valtree into memory and return a reference to that.
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:390 valtree_to_ref
export function valtree_to_ref(ecx: CompileTimeInterpCx, valtree: ValTree, pointee_ty: Ty): Immediate {
  const pointee_place = create_valtree_place(ecx, unwrap_result(ecx.layout_of(pointee_ty), debug_InterpErrorKind), valtree);
  // debug!(?pointee_place);

  valtree_into_mplace(ecx, pointee_place, valtree);
  dump_place(ecx, pointee_place);
  unwrap_result(intern_const_alloc_recursive(ecx, InternKind.Constant, pointee_place), debug_InternError);

  return pointee_place.to_ref(ecx.tcx);
}

// #[instrument(skip(ecx), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:406 valtree_into_mplace
export function valtree_into_mplace(ecx: CompileTimeInterpCx, place: MPlaceTy, valtree: ValTree): void {
  // This will match on valtree and write the value(s) corresponding to the ValTree
  // inside the place recursively.

  const ty = place.layout.ty;

  const k = ty.kind();
  switch (k.$) {
    case "FnDef": {
      // Zero-sized type, nothing to do.
      break;
    }
    case "Bool":
    case "Int":
    case "Uint":
    case "Float":
    case "Char":
    case "RawPtr": {
      const scalar_int = ValTreeKind.to_leaf(valtree.kind()) as unknown as ScalarInt;
      // debug!("writing trivial valtree {:?} to place {:?}", scalar_int, place);
      InterpResult.unwrap(ecx.write_immediate({ $: "Scalar", _0: Scalar_from_ScalarInt(scalar_int) }, place));
      break;
    }
    case "Ref": {
      const inner_ty = k._1;
      const imm = valtree_to_ref(ecx, valtree, inner_ty);
      // debug!(?imm);
      InterpResult.unwrap(ecx.write_immediate(imm, place));
      break;
    }
    case "Adt":
    case "Tuple":
    case "Array":
    case "Str":
    case "Slice": {
      const branches = ValTreeKind.to_branch(valtree.kind()) as unknown as readonly Const[];

      // Need to downcast place for enums
      let place_adjusted: MPlaceTy;
      let branches_: readonly Const[];
      let variant_idx: VariantIdx | undefined;
      if (k.$ === "Adt" && k._0.is_enum()) {
        const def = k._0;
        // First element of valtree corresponds to variant
        const scalar_int = branches[0]!.to_leaf();
        const variant_idx_ = VariantIdx.from_u32(scalar_int.to_u32());
        const _variant = def.variant(variant_idx_);
        // debug!(?variant);

        place_adjusted = InterpResult.unwrap(ecx.project_downcast(place, variant_idx_));
        branches_ = branches.slice(1);
        variant_idx = variant_idx_;
      } else {
        place_adjusted = clone_MPlaceTy(place);
        branches_ = branches;
        variant_idx = undefined;
      }
      // debug!(?place_adjusted, ?branches);

      // Create the places (by indexing into `place`) for the fields and fill
      // them recursively
      for (let i = 0; i < branches_.length; i++) {
        const inner_valtree = branches_[i]!;
        // debug!(?i, ?inner_valtree);

        let place_inner: MPlaceTy;
        if (k.$ === "Str" || k.$ === "Slice" || k.$ === "Array") {
          place_inner = InterpResult.unwrap(ecx.project_index(place, BigInt(i)));
        } else {
          place_inner = InterpResult.unwrap(ecx.project_field(place_adjusted, FieldIdx.from_usize(i)));
        }

        // debug!(?place_inner);
        valtree_into_mplace(ecx, place_inner, inner_valtree.to_value().valtree);
        dump_place(ecx, place_inner);
      }

      // debug!("dump of place_adjusted:");
      dump_place(ecx, place_adjusted);

      if (variant_idx !== undefined) {
        // don't forget filling the place with the discriminant of the enum
        InterpResult.unwrap(ecx.write_discriminant(variant_idx, place));
      }

      // debug!("dump of place after writing discriminant:");
      dump_place(ecx, place);
      break;
    }
    default:
      return bug(`shouldn't have created a ValTree for ${debug_Ty(ty, PLAIN)}`);
  }
}

// rustc: compiler/rustc_const_eval/src/const_eval/valtrees.rs:484 dump_place
export function dump_place(ecx: CompileTimeInterpCx, place: MPlaceTy): void {
  // trace!("{:?}", ecx.dump_place(&PlaceTy::from(place.clone())));
  // PORT: `trace!` is a comment (tracing filtered by the default WARN filter), so its argument is not evaluated.
  void ecx;
  void place;
}
