// Port of compiler/rustc_const_eval/src/util/check_validity_requirement.rs (declared by lane interp-contract, ported by
// lane ctfe-util).
// PORT: `InterpResult<()>::discard_err().is_some()` is `InterpResult.disarm(..).$ === "Ok"`: `discard_err` returns
// `T | undefined`, which cannot tell `Some(())` from `None` (PORTING §5 `Option<undefined-able T>`).
import { Scalar } from "../../rustc_abi/lib.ts";
import { InterpResult, Scalar_from_ScalarInt } from "../../rustc_middle/mir/interpret/mod.ts";
import { debug_ScalarInt, type ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { LayoutCx, type LayoutError, type TyAndLayout, type ValidityRequirement } from "../../rustc_middle/ty/layout.ts";
import { type PseudoCanonicalInput, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Ok, type Result } from "../../std/result.ts";
import { CanAccessMutGlobal, CheckAlignment, CompileTimeMachine } from "../const_eval/machine.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { MemoryKind } from "../interpret/memory.ts";
import { PlaceTy_from_MPlaceTy } from "../interpret/place.ts";

/// Determines if this type permits "raw" initialization by just transmuting some memory into an
/// instance of `T`.
///
/// `init_kind` indicates if the memory is zero-initialized or left uninitialized. We assume
/// uninitialized memory is mitigated by filling it with 0x01, which reduces the chance of causing
/// LLVM UB.
///
/// By default we check whether that operation would cause *LLVM UB*, i.e., whether the LLVM IR we
/// generate has UB or not. This is a mitigation strategy, which is why we are okay with accepting
/// Rust UB as long as there is no risk of miscompilations. The `strict_init_checks` can be set to
/// do a full check against Rust UB instead (in which case we will also ignore the 0x01-filling and
/// to the full uninit check).
// rustc: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:25 check_validity_requirement
export function check_validity_requirement(tcx: TyCtxt, kind: ValidityRequirement, input: PseudoCanonicalInput<Ty>): Result<boolean, LayoutError> {
  const r = tcx.layout_of(input);
  if (r.$ === "Err") return r;
  const layout = r._0;

  // There is nothing strict or lax about inhabitedness.
  if (kind === "Inhabited") {
    return Ok(!layout.is_uninhabited());
  }

  const layout_cx = LayoutCx.new(tcx, input.typing_env);
  if (kind === "Uninit" || tcx.sess.opts.unstable_opts.strict_init_checks) {
    return Ok(check_validity_requirement_strict(layout, layout_cx, kind));
  } else {
    return check_validity_requirement_lax(layout, layout_cx, kind);
  }
}

/// Implements the 'strict' version of the [`check_validity_requirement`] checks; see that function
/// for details.
// rustc: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:47 check_validity_requirement_strict
export function check_validity_requirement_strict(ty: TyAndLayout, cx: LayoutCx, kind: ValidityRequirement): boolean {
  const machine = CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.Error);

  const cx_ = InterpCx.new(cx.tcx_(), DUMMY_SP, cx.typing_env, machine);

  // It doesn't really matter which `MemoryKind` we use here, `Stack` is the least wrong.
  const allocated = InterpResult.expect(cx_.allocate(ty, MemoryKind.Stack), "OOM: failed to allocate for uninit check");

  if (kind === "Zero") {
    InterpResult.expect(cx_.write_bytes_ptr(allocated.ptr(), repeat_n(0, ty.layout.size().bytes_usize())), "failed to write bytes for zero valid check");
  }

  // Assume that if it failed, it's a validation failure.
  // This does *not* actually check that references are dereferenceable, but since all types that
  // require dereferenceability also require non-null, we don't actually get any false negatives
  // due to this.
  // The value we are validating is temporary and discarded at the end of this function, so
  // there is no point in resetting provenance and padding.
  // This is pretty inefficient: we do the full path tracking and even format an error message
  // in case there is a problem, only to entirely throw that away again. For a nightly-only
  // option this is fine, but if this is ever meant to be stable we should probably add
  // a "fast mode" to validation.
  return with_no_trimmed_paths(
    () =>
      InterpResult.disarm(
        cx_.validate_place(
          PlaceTy_from_MPlaceTy(allocated),
          /*recursive*/ false,
          /*reset_provenance_and_padding*/ false,
        ),
      ).$ === "Ok",
  );
}

/** PORT: `std::iter::repeat_n(element, count)`. */
function* repeat_n(element: number, count: number): IterableIterator<number> {
  for (let i = 0; i < count; i++) yield element;
}

/// Implements the 'lax' (default) version of the [`check_validity_requirement`] checks; see that
/// function for details.
// rustc: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:91 check_validity_requirement_lax
export function check_validity_requirement_lax(this_: TyAndLayout, cx: LayoutCx, init_kind: ValidityRequirement): Result<boolean, LayoutError> {
  const scalar_allows_raw_init = (s: Scalar): boolean => {
    switch (init_kind) {
      case "Inhabited":
        return bug("ValidityRequirement::Inhabited should have been handled above");
      case "Zero":
        // The range must contain 0.
        return Scalar.valid_range(s, cx).contains(0n);
      case "UninitMitigated0x01Fill": {
        // The range must include an 0x01-filled buffer.
        let val = 0x01n;
        for (let _ = 1; _ < Scalar.size(s, cx).bytes(); _++) {
          // For sizes >1, repeat the 0x01.
          val = (val << 8n) | 0x01n;
        }
        return Scalar.valid_range(s, cx).contains(val);
      }
      case "Uninit":
        return bug("ValidityRequirement::Uninit should have been handled above");
    }
  };

  // Check the ABI.
  const valid =
    !this_.is_uninhabited() && // definitely UB if uninhabited
    ((): boolean => {
      const repr = this_.backend_repr;
      switch (repr.$) {
        case "Scalar":
          return scalar_allows_raw_init(repr._0);
        case "ScalarPair":
          return scalar_allows_raw_init(repr.a) && scalar_allows_raw_init(repr.b);
        case "SimdVector":
          return scalar_allows_raw_init(repr.element);
        case "Memory":
          return true; // Fields are checked below.
        case "SimdScalableVector":
          return scalar_allows_raw_init(repr.element);
      }
    })();

  if (!valid) {
    // This is definitely not okay.
    return Ok(false);
  }

  // Special magic check for references and boxes (i.e., special pointer types).
  const pointee_ = this_.ty.builtin_deref(false);
  if (pointee_ !== undefined) {
    const r = cx.layout_of(pointee_);
    if (r.$ === "Err") return r;
    const pointee = r._0;
    // We need to ensure that the LLVM attributes `aligned` and `dereferenceable(size)` are satisfied.
    if (pointee.align.abi.bytes() > 1) {
      // 0x01-filling is not aligned.
      return Ok(false);
    }
    if (pointee.size.bytes() > 0) {
      // A 'fake' integer pointer is not sufficiently dereferenceable.
      return Ok(false);
    }
  }

  // If we have not found an error yet, we need to recursively descend into fields.
  const fields = this_.fields;
  switch (fields.$) {
    case "Primitive":
    case "Union":
      break;
    case "Array":
      // Arrays never have scalar layout in LLVM, so if the array is not actually
      // accessed, there is no LLVM UB -- therefore we can skip this.
      break;
    case "Arbitrary": {
      const { offsets } = fields;
      for (let idx = 0; idx < offsets.length; idx++) {
        const r = check_validity_requirement_lax(this_.field(cx, idx), cx, init_kind);
        if (r.$ === "Err") return r;
        if (!r._0) {
          // We found a field that is unhappy with this kind of initialization.
          return Ok(false);
        }
      }
      break;
    }
  }

  switch (this_.variants.$) {
    case "Empty":
      return Ok(false);
    case "Single":
      // All fields of this single variant have already been checked above, there is nothing
      // else to do.
      break;
    case "Multiple":
      // We cannot tell LLVM anything about the details of this multi-variant layout, so
      // invalid values "hidden" inside the variant cannot cause LLVM trouble.
      break;
  }

  return Ok(true);
}

// rustc: compiler/rustc_const_eval/src/util/check_validity_requirement.rs:183 validate_scalar_in_layout
export function validate_scalar_in_layout(tcx: TyCtxt, scalar: ScalarInt, ty: Ty): boolean {
  const machine = CompileTimeMachine.new(CanAccessMutGlobal.No, CheckAlignment.Error);

  const typing_env = TypingEnv.fully_monomorphized();
  const cx = InterpCx.new(tcx, DUMMY_SP, typing_env, machine);

  const l = cx.layout_of(ty);
  if (l.$ !== "Ok") {
    return bug(`could not compute layout of ${debug_ScalarInt(scalar, PLAIN)}:${debug_Ty(ty, PLAIN)}`);
  }
  const layout = l._0;

  // It doesn't really matter which `MemoryKind` we use here, `Stack` is the least wrong.
  const allocated = InterpResult.expect(cx.allocate(layout, MemoryKind.Stack), "OOM: failed to allocate for uninit check");

  InterpResult.unwrap(cx.write_scalar(Scalar_from_ScalarInt(scalar), allocated));

  return (
    InterpResult.disarm(
      cx.validate_place(
        PlaceTy_from_MPlaceTy(allocated),
        /*recursive*/ false,
        /*reset_provenance_and_padding*/ false,
      ),
    ).$ === "Ok"
  );
}
