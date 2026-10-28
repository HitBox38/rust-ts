// Port of compiler/rustc_const_eval/src/interpret/validity.rs (lane interp-validity-intern; declared by interp-contract,
// plan-m4 wave 23b/23c). Validation error messages are UI output (`it is undefined behavior to use this value`): every
// `format!` is kept verbatim.
//
// PORT: the macros `err_validation_failure!` / `throw_validation_failure!` / `try_validation!` are the functions
// `err_validation_failure` (returns the `InterpErrorKind`), `throw_validation_failure` (`do yeet`: the `Err`) and
// `try_validation(r, where_, arms)` (`map_err_kind` with the arms as a function returning the message, or `undefined`
// for the fallthrough arm `e => e`; the caller does the `?`). The message is computed only on error, like the macro.
//! Check the validity invariant of a given value, and tell the user
//! where in the value it got violated.
//! In const context, this goes even further and tries to approximate const safety.
//! That's useful because it means other passes (e.g. promotion) can rely on `const`s
//! to be const-safe.
import { type Align, BackendRepr, type FieldsShape, Size, type VariantIdx, VariantIdx as VariantIdxC, type WrappingRange } from "../../rustc_abi/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { key_MPlaceTy, MemPlaceMeta, PlaceTy_from_MPlaceTy } from "./place.ts";
import { type ExpectedKind, Path, PathElem, PtrKind, type RangeSet } from "./validity.gen.ts";
import {
  alloc_range,
  type CtfeProvenance,
  GlobalAlloc,
  type InterpErrorKind,
  InterpErrorInfo_from_InterpErrorKind,
  interp_ok,
  InterpResult,
  lower_hex_Scalar,
  Pointer,
  PointerArithmetic_provided,
  Provenance_CtfeProvenance,
  Scalar,
  display_Pointer_Option,
  type AllocId,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { LayoutCx, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_List_PolyExistentialPredicate, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../../rustc_middle/ty/mod.ts";
import { bug } from "../../rustc_span/macros.ts";
import { display_Symbol, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { type Fmt, PLAIN } from "../../std/fmt.ts";
import { type MutRef } from "../../std/mut_ref.ts";
import { assert, assert_eq, Panic, panic, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { Immediate, type ImmTy } from "./operand.ts";
import { type MPlaceTy, type PlaceTy } from "./place.gen.ts";
import { ValueVisitor_provided } from "./visitor.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { RangeSet as ds_RangeSet, type RangeSetOps } from "../../rustc_data_structures/range_set.ts";
import * as gen from "./validity.gen.ts";
import { Scalar as ScalarAbi } from "../../rustc_abi/lib.ts";

export * from "./validity.gen.ts";

declare module "./validity.gen.ts" {
  namespace Path {
    // validity.rs:256
    function new_(ty: Ty): Path;
    export { new_ as new };
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // validity.rs:1597
    validate_place_internal(val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path> | undefined, ctfe_mode: CtfeValidationMode | undefined, reset_provenance_and_padding: boolean, start_in_may_dangle: boolean): InterpResult;
    // validity.rs:1654
    const_validate_place(val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path>, ctfe_mode: CtfeValidationMode): InterpResult;
    // validity.rs:1675
    validate_place(val: PlaceTy, recursive: boolean, reset_provenance_and_padding: boolean): InterpResult;
  }
}

export interface ValidationErrorKind_methods {
  // validity.rs:187
  to_string(self: ValidationErrorKind): string;
  // validity.rs:200
  ptr_bytes_warning(self: ValidationErrorKind): boolean;
}
export type ValidationErrorKind = gen.ValidationErrorKind;
export const ValidationErrorKind = gen.ValidationErrorKind as typeof gen.ValidationErrorKind & ValidationErrorKind_methods;

export interface CtfeValidationMode_methods {
  // validity.rs:276
  allow_immutable_unsafe_cell(self: CtfeValidationMode): boolean;
}
export type CtfeValidationMode = gen.CtfeValidationMode;
export const CtfeValidationMode = gen.CtfeValidationMode as typeof gen.CtfeValidationMode & CtfeValidationMode_methods;

// macro_rules! err_validation_failure
/** `err_validation_failure!($where, $msg)`: `$msg` is a `String` or a `ValidationErrorKind` (`ValidationErrorKind::from`). */
function err_validation_failure(where_: Path, msg_: ValidationErrorKind | string): InterpErrorKind {
  let path: string | undefined;
  if (where_.projs.length !== 0) {
    const out: MutRef<string> = { value: "" };
    write_path(out, where_.projs);
    path = out.value;
  } else {
    path = undefined;
  }

  const msg = typeof msg_ === "string" ? ValidationErrorKind_from_String(msg_) : msg_;
  // err_ub!(ValidationError { .. })
  return {
    $: "UndefinedBehavior",
    _0: {
      $: "ValidationError",
      orig_ty: where_.orig_ty,
      path,
      ptr_bytes_warning: ValidationErrorKind.ptr_bytes_warning(msg),
      msg: ValidationErrorKind.to_string(msg),
    },
  };
}

// macro_rules! throw_validation_failure
/** `throw_validation_failure!($where, $msg)` (`do yeet`). */
function throw_validation_failure<T>(where_: Path, msg: ValidationErrorKind | string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind(err_validation_failure(where_, msg)));
}

// macro_rules! try_validation
/// If $e throws an error matching the pattern, throw a validation failure.
/// Other errors are passed back to the caller, unchanged -- and if they reach the root of
/// the visitor, we make sure only validation errors and `InvalidProgram` errors are left.
/// This lets you use the patterns as a kind of validation list, asserting which errors
/// can possibly happen:
///
/// ```ignore(illustrative)
/// let v = try_validation!(some_fn(x), some_path, {
///     Foo | Bar | Baz => format!("some failure involving {x}"),
/// });
/// ```
///
/// The patterns must be of type `UndefinedBehaviorInfo`.
// PORT: `arms(e)` is the macro's match: the message of the first matching arm, `undefined` for the final `e => e`.
// The caller applies the `?`.
function try_validation<T>(e: InterpResult<T>, where_: Path, arms: (e: InterpErrorKind) => ValidationErrorKind | string | undefined): InterpResult<T> {
  return InterpResult.map_err_kind(e, (e) => {
    // We catch the error and turn it into a validation failure. We are okay with
    // allocation here as this can only slow down builds that fail anyway.
    const msg = arms(e);
    if (msg !== undefined) {
      return err_validation_failure(where_, msg);
    }
    return e;
  });
}

/** PORT: the `T: Copy + Ord + Default + Add + Sub` table of `RangeSet<Size>` (rustc_data_structures range_set.ts; the
 * same as rustc_abi layout/ty.ts's, which is not exported): `RangeSet::new()` is `new_RangeSet()`. */
const SIZE_RANGE_SET_OPS: RangeSetOps<Size> = {
  default_: () => Size.ZERO,
  cmp: (a, b) => (a.bytes() < b.bytes() ? -1 : a.bytes() > b.bytes() ? 1 : 0),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
};
function new_RangeSet(): RangeSet {
  return ds_RangeSet.new(SIZE_RANGE_SET_OPS);
}

/** `Size == Size` (derived `PartialEq`: the byte count). */
function size_eq(a: Size, b: Size): boolean {
  return a.bytes() === b.bytes();
}

/// State for tracking recursive validation of references
// rustc-type: compiler/rustc_const_eval/src/interpret/validity.rs:288 RefTracking
// PORT: `seen: FxHashSet<T>` hashes `T` by value: a `KeyedSet` over the key fn of `T` (`key_MPlaceTy` for the only
// instantiation, `MPlaceTy`), passed to the constructors (`T: Hash + Eq`).
export class RefTracking<T, PATH = null> {
  constructor(
    public seen: KeyedSet<T>,
    public todo: [T, PATH][],
  ) {}

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:294 empty
  static empty<T, PATH>(key_T: (t: T) => string | number): RefTracking<T, PATH> {
    return new RefTracking<T, PATH>(new KeyedSet<T>(key_T), []);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:297 next
  next(): [T, PATH] | undefined {
    return this.todo.pop();
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:301 track
  track(val: T, path: () => PATH): void {
    // `if self.seen.insert(val.clone())`
    if (!this.seen.has(val)) {
      this.seen.add(val);
      // trace!("Recursing below ptr {:#?}", val);
      const path_ = path();
      // Remember to come back to this later.
      this.todo.push([val, path_]);
    }
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:312 new
  static new<T>(val: T, ty: Ty, key_T: (t: T) => string | number): RefTracking<T, Path> {
    const ref_tracking_for_consts = new RefTracking<T, Path>(new KeyedSet<T>(key_T), [[val, Path.new(ty)]]);
    ref_tracking_for_consts.seen.add(val);
    return ref_tracking_for_consts;
  }
}

// rustc-type: compiler/rustc_const_eval/src/interpret/validity.rs:348 ValidityVisitor
// PORT: `impl ValueVisitor for ValidityVisitor` (`type V = PlaceTy`) is in the class body (base class
// `ValueVisitor_provided`); `ref_tracking: Option<&'rt mut RefTracking<..>>` is the shared object.
export class ValidityVisitor<M extends Machine = Machine> extends ValueVisitor_provided<PlaceTy> {
  constructor(
    /// The `path` may be pushed to, but the part that is present when a function
    /// starts must not be changed!  `with_elem` relies on this stack discipline.
    public path: Path,
    public ref_tracking: RefTracking<MPlaceTy, Path> | undefined,
    /// `None` indicates this is not validating for CTFE (but for runtime).
    public ctfe_mode: CtfeValidationMode | undefined,
    public ecx: InterpCx<M>,
    /// Whether provenance should be reset outside of pointers (emulating the effect of a typed
    /// copy).
    public reset_provenance_and_padding: boolean,
    /// This tracks which byte ranges in this value contain data; the remaining bytes are padding.
    /// The ideal representation here would be pointer-length pairs, but to keep things more compact
    /// we only store a (range) set of offsets -- the base pointer is the same throughout the entire
    /// visit, after all.
    /// If this is `Some`, then `reset_provenance_and_padding` must be true (but not vice versa:
    /// we might not track data vs padding bytes if the place isn't stored in memory anyway).
    public data_bytes: RangeSet | undefined,
    /// True if we are inside of `MaybeDangling`. This disables pointer access checks.
    public may_dangle: boolean,
  ) {
    super();
  }

  /** `<PlaceTy as From<MPlaceTy>>::from` (`type V = PlaceTy`). */
  V_from_MPlaceTy(mplace: MPlaceTy): PlaceTy {
    return PlaceTy_from_MPlaceTy(mplace);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:371 aggregate_field_path_elem
  aggregate_field_path_elem(layout: TyAndLayout, field: number, field_ty: Ty): PathElem {
    // First, check if we are projecting to a variant.
    const variants = layout.variants;
    switch (variants.$) {
      case "Multiple": {
        if (variants.tag_field === field) {
          const kind = layout.ty.kind();
          if (kind.$ === "Adt" && kind._0.is_enum()) return PathElem.EnumTag;
          if (kind.$ === "Coroutine") return PathElem.CoroutineTag;
          return bug(`non-variant type ${debug_Ty(layout.ty, PLAIN)}`);
        }
        break;
      }
      case "Single":
      case "Empty":
        break;
    }

    // Now we know we are projecting to a field, so figure out which one.
    const kind = layout.ty.kind();
    switch (kind.$) {
      // coroutines, closures, and coroutine-closures all have upvars that may be named.
      case "Closure":
      case "Coroutine":
      case "CoroutineClosure": {
        const def_id = kind._0;
        let name: Symbol | undefined = undefined;
        // FIXME this should be more descriptive i.e. CapturePlace instead of CapturedVar
        // https://github.com/rust-lang/project-rfc-2229/issues/46
        const local_def_id = def_id.as_local();
        if (local_def_id !== undefined) {
          const captures = this.ecx.tcx.deref().closure_captures(local_def_id);
          const captured_place = captures[field];
          if (captured_place !== undefined) {
            // Sometimes the index is beyond the number of upvars (seen
            // for a coroutine).
            const var_hir_id = captured_place.get_root_variable();
            const node = this.ecx.tcx.deref().hir_node(var_hir_id);
            if (node.$ === "Pat" && node._0.kind.$ === "Binding") {
              const ident = node._0.kind._2;
              name = ident.name;
            }
          }
        }

        return {
          $: "CapturedVar",
          _0: name ?? (
            // Fall back to showing the field index.
            sym.integer(field)
          ),
        };
      }

      // tuples
      case "Tuple":
        return { $: "TupleElem", _0: field };

      // enums / other ADTs
      case "Adt": {
        const def = kind._0;
        if (def.is_enum()) {
          // we might be projecting *to* a variant, or to a field *in* a variant.
          switch (variants.$) {
            case "Single":
              // Inside a variant
              return { $: "Field", _0: unwrap(def.variant(variants.index).fields[field]).name };
            case "Empty":
              return panic("there is no field in Variants::Empty types");
            case "Multiple":
              return bug("we handled variants above");
          }
        }
        // other ADTs
        return { $: "Field", _0: unwrap(def.non_enum_variant().fields[field]).name };
      }

      // arrays/slices
      case "Array":
      case "Slice":
        return { $: "ArrayElem", _0: field };

      // dyn traits
      case "Dynamic":
        assert_eq(field, 0, String);
        return { $: "DynDowncast", _0: field_ty };

      // nothing else has an aggregate layout
      default:
        return bug(`aggregate_field_path_elem: got non-aggregate type ${debug_Ty(layout.ty, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:454 with_elem
  with_elem<R>(elem: PathElem, f: (a0: ValidityVisitor<M>) => InterpResult<R>): InterpResult<R> {
    // Remember the old state
    const path_len = this.path.projs.length;
    // Record new element
    this.path.projs.push(elem);
    // Perform operation
    const r = f(this);
    if (r.$ === "Err") return r;
    // Undo changes
    this.path.projs.length = path_len;
    // Done
    return interp_ok(r._0);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:471 read_immediate
  read_immediate(val: PlaceTy, expected: ExpectedKind): InterpResult<ImmTy> {
    const r = try_validation(this.ecx.read_immediate(val), this.path, (e) => {
      if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidUninitBytes") return { $: "Uninit", expected };
      // The `Unsup` cases can only occur during CTFE
      if (e.$ === "Unsupported" && e._0.$ === "ReadPointerAsInt") return { $: "PointerAsInt", expected };
      if (e.$ === "Unsupported" && e._0.$ === "ReadPartialPointer") return ValidationErrorKind.PartialPointer;
      return undefined;
    });
    if (r.$ === "Err") return r;
    return interp_ok(r._0);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:489 read_scalar
  read_scalar(val: PlaceTy, expected: ExpectedKind): InterpResult<Scalar> {
    const r = this.read_immediate(val, expected);
    if (r.$ === "Err") return r;
    return interp_ok(Immediate.to_scalar(r._0.imm));
  }

  /// Given a place and a pointer loaded from that place, ensure that the place does
  /// not store any more provenance than the pointer does. IOW, if any provenance
  /// was discarded when loading the pointer, it will also get discarded in-memory.
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:500 reset_pointer_provenance
  reset_pointer_provenance(place: PlaceTy, ptr: ImmTy): InterpResult {
    if (ptr.layout.backend_repr.$ === "Scalar") {
      // A thin pointer. If it has provenance, we don't have to do anything.
      // If it does not, ensure we clear the provenance in memory.
      if (Immediate.to_scalar(ptr.imm).$ !== "Ptr") {
        // The loaded pointer has no provenance. Some bytes of its representation still
        // might have provenance, which we have to clear.
        const r = this.ecx.clear_provenance(place);
        if (r.$ === "Err") return r;
      }
    } else {
      // A wide pointer. This means we have to worry both about the pointer itself and the
      // metadata. We do the lazy thing and just write back the value we got. Just
      // clearing provenance in a targeted manner would be more efficient, but unless this
      // is a perf hotspot it's just not worth the effort.
      const r = this.ecx.write_immediate_no_validate(ptr.imm, place);
      if (r.$ === "Err") return r;
    }
    return interp_ok(undefined);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:523 check_wide_ptr_meta
  check_wide_ptr_meta(meta: MemPlaceMeta, pointee: TyAndLayout): InterpResult {
    const tail = this.ecx.tcx.deref().struct_tail_for_codegen(pointee.ty, this.ecx.typing_env);
    const kind = tail.kind();
    switch (kind.$) {
      case "Dynamic": {
        const data = kind._0;
        const vtable = Scalar.to_pointer(MemPlaceMeta.unwrap_meta(meta), this.ecx);
        // Make sure it is a genuine vtable pointer for the right trait.
        const r = try_validation(this.ecx.get_ptr_vtable_ty(vtable, data), this.path, (e) => {
          if (e.$ === "UndefinedBehavior" && (e._0.$ === "DanglingIntPointer" || e._0.$ === "InvalidVTablePointer")) {
            return `encountered ${display_Pointer_Option(vtable, PLAIN)}, but expected a vtable pointer`;
          }
          if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidVTableTrait") {
            const { vtable_dyn_type, expected_dyn_type } = e._0;
            return { $: "InvalidMetaWrongTrait", expected_dyn_type, vtable_dyn_type };
          }
          return undefined;
        });
        if (r.$ === "Err") return r;
        break;
      }
      case "Slice":
      case "Str": {
        const r = Scalar.to_target_usize(MemPlaceMeta.unwrap_meta(meta), this.ecx);
        if (r.$ === "Err") return r;
        // We do not check that `len * elem_size <= isize::MAX`:
        // that is only required for references, and there it falls out of the
        // "dereferenceable" check performed by Stacked Borrows.
        break;
      }
      case "Foreign":
        // Unsized, but not wide.
        break;
      default:
        return bug(`Unexpected unsized type tail: ${debug_Ty(tail, PLAIN)}`);
    }

    return interp_ok(undefined);
  }

  /// Check a reference or `Box`.
  ///
  /// `ty` is the actual type of `value`; for a Box, `value` will be just the inner raw pointer.
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:560 check_safe_pointer
  check_safe_pointer(value: PlaceTy, ty: Ty, ptr_kind: PtrKind): InterpResult {
    // Note that some of those checks (those that encode the basic validity invariant of
    // pointers) are duplicated in `place_deref`, so changes here might need updates there.
    const ptr_r = this.read_immediate(value, ExpectedKind_from_PtrKind(ptr_kind));
    if (ptr_r.$ === "Err") return ptr_r;
    const ptr = ptr_r._0;
    if (this.reset_provenance_and_padding) {
      // There's no padding in a pointer.
      this.add_data_range_place(value);
      // Resetting provenance is done below, together with retagging, to avoid
      // redundant writes.
    }
    const place_r = this.ecx.imm_ptr_to_mplace(ptr);
    if (place_r.$ === "Err") return place_r;
    const place = place_r._0;
    // Handle wide pointers.
    // Check metadata early, for better diagnostics
    if (place.layout.is_unsized()) {
      const r = this.check_wide_ptr_meta(place.meta(), place.layout);
      if (r.$ === "Err") return r;
    }

    // Determine size and alignment of pointee.
    const size_and_align_r = try_validation(this.ecx.size_and_align_of_val(place), this.path, (e) => {
      if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidMeta") {
        const msg = e._0._0;
        return `encountered invalid ${display_PtrKind(ptr_kind, PLAIN)} metadata: ${
          msg === "SliceTooBig"
            ? "slice is bigger than largest supported object"
            : "total size is bigger than largest supported object"
        }`;
      }
      return undefined;
    });
    if (size_and_align_r.$ === "Err") return size_and_align_r;
    const [size, align]: [Size, Align] = size_and_align_r._0 ??
      // for the purpose of validity, consider foreign types to have
      // alignment and size determined by the layout (size will be 0,
      // alignment should take attributes into account).
      [place.layout.size, place.layout.align.abi];

    // If we're not allow to dangle, make sure this is dereferenceable and retag it for
    // the aliasing model.
    let adjusted_ptr: ImmTy | undefined;
    if (!this.may_dangle) {
      const r = try_validation(
        this.ecx.check_ptr_access(
          place.ptr(),
          size,
          { $: "Dereferenceable", _0: "pointer" }, // will anyway be replaced by validity message
        ),
        this.path,
        (e) => {
          if (e.$ !== "UndefinedBehavior") return undefined;
          const ub = e._0;
          if (ub.$ === "DanglingIntPointer" && ub.addr === 0) {
            return `encountered a null ${display_PtrKind(ptr_kind, PLAIN)}`;
          }
          if (ub.$ === "DanglingIntPointer") {
            const i = ub.addr;
            const ptr = Pointer.without_provenance<AllocId>(BigInt(i));
            return `encountered a dangling ${display_PtrKind(ptr_kind, PLAIN)} (${display_Pointer_Option(ptr, PLAIN)} has no provenance)`;
          }
          if (ub.$ === "PointerOutOfBounds") {
            return `encountered a dangling ${display_PtrKind(ptr_kind, PLAIN)} (going beyond the bounds of its allocation)`;
          }
          if (ub.$ === "PointerUseAfterFree") {
            return `encountered a dangling ${display_PtrKind(ptr_kind, PLAIN)} (use-after-free)`;
          }
          return undefined;
        },
      );
      if (r.$ === "Err") return r;
      if (this.reset_provenance_and_padding) {
        const rr = InterpResult.map_err_kind(this.ecx.machine.retag_ptr_value(this.ecx, ptr, ty), (e) => {
          if (e.$ === "UndefinedBehavior" && e._0.$ === "WriteToReadOnly") {
            return err_validation_failure(
              this.path,
              `encountered ${ptr_kind.$ === "Box" ? "box" : "mutable reference"} pointing to read-only memory`,
            );
          }
          if (e.$ === "MachineStop") {
            const machine_err = e._0;
            // Enhance the aliasing model error with the current path.
            if (this.path.projs.length !== 0) {
              const path: MutRef<string> = { value: "" };
              write_path(path, this.path.projs);
              machine_err.with_validation_path(path.value);
            }
            return { $: "MachineStop", _0: machine_err };
          }
          return e;
        });
        if (rr.$ === "Err") return rr;
        adjusted_ptr = rr._0;
      } else {
        // We can't retag if we're not resetting provenance.
        adjusted_ptr = undefined;
      }
    } else {
      // We are not checking dereferenceability, but we still want to ensure that the pointer
      // *could* be dereferenceable in *some* memory: we have to be able to compute the
      // address at the end of this range without overflowing..
      const scalar = Scalar.from_maybe_pointer(place.ptr(), this.ecx);
      // Skip this if we don't know the absolute address (during CTFE).
      const int_r = Scalar.try_to_scalar_int(scalar);
      if (int_r.$ === "Ok") {
        // Try to compute the end address. Cannot use `Size` addition as that also applies
        // the "max obj size" bound.
        // PORT: `Size::from_bytes(x).bytes()` is the identity on a `u64`: kept as the `bigint` (a `Size` past 2^53
        // would be unported, recorded decision), and `checked_add` on `u64` is the sum checked against `u64::MAX`.
        const addr = int_r._0.to_target_usize(this.ecx.tcx.deref());
        const result = addr + BigInt(size.bytes());
        if (result > U64_MAX || result >= PointerArithmetic_provided.target_usize_max(this.ecx)) {
          return throw_validation_failure(
            this.path,
            `encountered a ${display_PtrKind(ptr_kind, PLAIN)} that is too close to the end of the address space for a pointee of ${size.bytes()} bytes`,
          );
        }
      }

      // Pointer remains unchanged.
      adjusted_ptr = undefined;
    }
    // If the pointer needs adjusting, write back adjusted pointer. This automatically
    // also clears any excess provenance. Otherwise, just clear the provenance.
    if (adjusted_ptr !== undefined) {
      const r = this.ecx.write_immediate_no_validate(adjusted_ptr.imm, value);
      if (r.$ === "Err") return r;
    } else if (this.reset_provenance_and_padding) {
      const r = this.reset_pointer_provenance(value, ptr);
      if (r.$ === "Err") return r;
    }

    // Make sure this is non-null. This is obviously needed when `may_dangle` is set,
    // but even if we did check dereferenceability above that would still allow null
    // pointers if `size` is zero.
    const scalar = Scalar.from_maybe_pointer(place.ptr(), this.ecx);
    const null_r = this.ecx.scalar_may_be_null(scalar);
    if (null_r.$ === "Err") return null_r;
    if (null_r._0) {
      const maybe = !Provenance_CtfeProvenance.OFFSET_IS_ADDR && scalar.$ === "Ptr";
      return throw_validation_failure(
        this.path,
        `encountered a ${maybe ? "maybe-" : ""}null ${display_PtrKind(ptr_kind, PLAIN)}`,
      );
    }

    // Do not allow references to uninhabited types.
    if (!place.layout.ty.is_opsem_inhabited(this.ecx.tcx.deref(), this.ecx.typing_env)) {
      const ty = place.layout.ty;
      return throw_validation_failure(
        this.path,
        `encountered a ${display_PtrKind(ptr_kind, PLAIN)} pointing to uninhabited type \`${display_Ty(ty)}\``,
      );
    }

    // Check alignment after dereferenceable (if both are violated, trigger the error above).
    const align_r = try_validation(
      this.ecx.check_ptr_align(
        place.ptr(),
        align,
      ),
      this.path,
      (e) => {
        if (e.$ === "UndefinedBehavior" && e._0.$ === "AlignmentCheckFailed") {
          const { required, has } = e._0._0;
          const required_bytes = required.bytes();
          const found_bytes = has.bytes();
          return `encountered an unaligned ${display_PtrKind(ptr_kind, PLAIN)} (required ${required_bytes} byte alignment but found ${found_bytes})`;
        }
        return undefined;
      },
    );
    if (align_r.$ === "Err") return align_r;

    // Recursive checking (but not inside `MaybeDangling` of course).
    const ref_tracking = this.ref_tracking;
    if (ref_tracking !== undefined && !this.may_dangle) {
      // Proceed recursively even for ZST, no reason to skip them!
      // `!` is a ZST and we want to validate it.
      const ctfe_mode = this.ctfe_mode;
      if (ctfe_mode !== undefined) {
        let skip_recursive_check = false;
        // CTFE imposes restrictions on what references can point to.
        const alloc_r = this.ecx.ptr_try_get_alloc_id(place.ptr(), 0n);
        if (alloc_r.$ === "Ok") {
          const [alloc_id, _offset, _prov] = alloc_r._0;
          // Everything should be already interned.
          const global_alloc = this.ecx.tcx.deref().try_get_global_alloc(alloc_id);
          if (global_alloc === undefined) {
            if (this.ecx.memory.alloc_map.contains_key(alloc_id)) {
              // This can happen when interning didn't complete due to, e.g.
              // missing `make_global`. This must mean other errors are already
              // being reported.
              this.ecx.tcx.deref().dcx().delayed_bug(
                "interning did not complete, there should be an error",
              );
              return interp_ok(undefined);
            }
            // We can't have *any* references to non-existing allocations in const-eval
            // as the rest of rustc isn't happy with them... so we throw an error, even
            // though for zero-sized references this isn't really UB.
            // A potential future alternative would be to resurrect this as a zero-sized allocation
            // (which codegen will then compile to an aligned dummy pointer anyway).
            return throw_validation_failure(
              this.path,
              `encountered a dangling ${display_PtrKind(ptr_kind, PLAIN)} (use-after-free)`,
            );
          }
          const [size, _align] = GlobalAlloc.size_and_align(global_alloc, this.ecx.tcx.deref(), this.ecx.typing_env);
          const alloc_actual_mutbl = GlobalAlloc.mutability(global_alloc, this.ecx.tcx.deref(), this.ecx.typing_env);

          if (global_alloc.$ === "Static") {
            const did = global_alloc._0;
            const def_kind = this.ecx.tcx.deref().def_kind(did);
            if (def_kind.$ !== "Static") {
              return bug();
            }
            const nested = def_kind.nested;
            assert(!this.ecx.tcx.deref().is_thread_local_static(did), "assertion failed: !self.ecx.tcx.is_thread_local_static(did)");
            assert(this.ecx.tcx.deref().is_static(did), "assertion failed: self.ecx.tcx.is_static(did)");
            switch (ctfe_mode.$) {
              case "Static":
              case "Promoted":
                // We skip recursively checking other statics. These statics must be sound by
                // themselves, and the only way to get broken statics here is by using
                // unsafe code.
                // The reasons we don't check other statics is twofold. For one, in all
                // sound cases, the static was already validated on its own, and second, we
                // trigger cycle errors if we try to compute the value of the other static
                // and that static refers back to us (potentially through a promoted).
                // This could miss some UB, but that's fine.
                // We still walk nested allocations, as they are fundamentally part of this validation run.
                // This means we will also recurse into nested statics of *other*
                // statics, even though we do not recurse into other statics directly.
                // That's somewhat inconsistent but harmless.
                skip_recursive_check = !nested;
                break;
              case "Const":
                // If this is mutable memory or an `extern static`, there's no point in checking it -- we'd
                // just get errors trying to read the value.
                if (alloc_actual_mutbl === "Mut" || this.ecx.tcx.deref().is_foreign_item(did)) {
                  skip_recursive_check = true;
                }
                break;
            }
          }

          // If this allocation has size zero, there is no actual mutability here.
          if (!size_eq(size, Size.ZERO)) {
            // Determine whether this pointer expects to be pointing to something mutable.
            const ptr_expected_mutbl =
              ptr_kind.$ === "Box"
                ? "Mut"
                : // We do not take into account interior mutability here since we cannot know if
                  // there really is an `UnsafeCell` inside `Option<UnsafeCell>` -- so we check
                  // that in the recursive descent behind this reference (controlled by
                  // `allow_immutable_unsafe_cell`).
                  ptr_kind._0;
            // Mutable pointer to immutable memory is no good.
            if (ptr_expected_mutbl === "Mut" && alloc_actual_mutbl === "Not") {
              // This can actually occur with transmutes.
              return throw_validation_failure(
                this.path,
                `encountered mutable reference or box pointing to read-only memory`,
              );
            }
          }
        }
        // Potentially skip recursive check.
        if (skip_recursive_check) {
          return interp_ok(undefined);
        }
      } else {
        // This is not CTFE, so it's Miri with recursive checking.
        // FIXME: should we skip `UnsafeCell` behind shared references? Currently that is
        // not needed since validation reads bypass Stacked Borrows and data race checks,
        // but is that really coherent?
      }
      const path = this.path;
      ref_tracking.track(place, () => {
        // We need to clone the path anyway, make sure it gets created
        // with enough space for the additional `Deref`.
        const new_projs: PathElem[] = [];
        new_projs.push(...path.projs);
        new_projs.push(PathElem.Deref);
        return new Path(path.orig_ty, new_projs);
      });
    }
    return interp_ok(undefined);
  }

  /// Check if this is a value of primitive type, and if yes check the validity of the value
  /// at that type. Return `true` if the type is indeed primitive.
  ///
  /// Note that not all of these have `FieldsShape::Primitive`, e.g. wide references.
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:851 try_visit_primitive
  try_visit_primitive(value: PlaceTy): InterpResult<boolean> {
    // Go over all the primitive types
    const ty = value.layout.ty;
    const kind = ty.kind();
    switch (kind.$) {
      case "Bool": {
        const scalar_r = this.read_scalar(value, "Bool");
        if (scalar_r.$ === "Err") return scalar_r;
        const scalar = scalar_r._0;
        const r = try_validation(Scalar.to_bool(scalar), this.path, (e) => {
          if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidBool") {
            return `encountered ${lower_hex_Scalar(scalar, PLAIN)}, but expected a boolean`;
          }
          return undefined;
        });
        if (r.$ === "Err") return r;
        if (this.reset_provenance_and_padding) {
          const r = this.ecx.clear_provenance(value);
          if (r.$ === "Err") return r;
          this.add_data_range_place(value);
        }
        return interp_ok(true);
      }
      case "Char": {
        const scalar_r = this.read_scalar(value, "Char");
        if (scalar_r.$ === "Err") return scalar_r;
        const scalar = scalar_r._0;
        const r = try_validation(Scalar.to_char(scalar), this.path, (e) => {
          if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidChar") {
            return `encountered ${lower_hex_Scalar(scalar, PLAIN)}, but expected a valid unicode scalar value (in \`0..=0x10FFFF\` but not in \`0xD800..=0xDFFF\`)`;
          }
          return undefined;
        });
        if (r.$ === "Err") return r;
        if (this.reset_provenance_and_padding) {
          const r = this.ecx.clear_provenance(value);
          if (r.$ === "Err") return r;
          this.add_data_range_place(value);
        }
        return interp_ok(true);
      }
      case "Float":
      case "Int":
      case "Uint": {
        // NOTE: Keep this in sync with the array optimization for int/float
        // types below!
        const r = this.read_scalar(
          value,
          kind.$ === "Float" ? "Float" : "Int",
        );
        if (r.$ === "Err") return r;
        if (this.reset_provenance_and_padding) {
          const r = this.ecx.clear_provenance(value);
          if (r.$ === "Err") return r;
          this.add_data_range_place(value);
        }
        return interp_ok(true);
      }
      case "RawPtr": {
        const pointee = kind._0;
        const ptr_r = this.read_immediate(value, "RawPtr");
        if (ptr_r.$ === "Err") return ptr_r;
        const ptr = ptr_r._0;
        if (this.reset_provenance_and_padding) {
          const r = this.reset_pointer_provenance(value, ptr);
          if (r.$ === "Err") return r;
          // There's no padding in a pointer.
          this.add_data_range_place(value);
        }

        if (!pointee.is_sized(this.ecx.tcx.deref(), this.ecx.typing_env)) {
          // Raw pointers to unsized types need to have their metadata checked.
          // We avoid creating this place for sized types to match codegen: those types
          // might actually be invalid (i.e., too big)!
          const place_r = this.ecx.imm_ptr_to_mplace(ptr);
          if (place_r.$ === "Err") return place_r;
          const place = place_r._0;
          assert(place.layout.is_unsized(), "assertion failed: place.layout.is_unsized()");
          const r = this.check_wide_ptr_meta(place.meta(), place.layout);
          if (r.$ === "Err") return r;
        }
        return interp_ok(true);
      }
      case "Ref": {
        const mutbl = kind._2;
        const r = this.check_safe_pointer(value, ty, { $: "Ref", _0: mutbl });
        if (r.$ === "Err") return r;
        return interp_ok(true);
      }
      case "FnPtr": {
        const scalar_r = this.read_scalar(value, "FnPtr");
        if (scalar_r.$ === "Err") return scalar_r;
        const scalar = scalar_r._0;

        // If we check references recursively, also check that this points to a function.
        if (this.ref_tracking !== undefined) {
          const ptr = Scalar.to_pointer(scalar, this.ecx);
          const _fn = try_validation(this.ecx.get_ptr_fn(ptr), this.path, (e) => {
            if (e.$ === "UndefinedBehavior" && (e._0.$ === "DanglingIntPointer" || e._0.$ === "InvalidFunctionPointer")) {
              return `encountered ${display_Pointer_Option(ptr, PLAIN)}, but expected a function pointer`;
            }
            return undefined;
          });
          if (_fn.$ === "Err") return _fn;
          // FIXME: Check if the signature matches
        } else {
          // Otherwise (for standalone Miri and for `-Zextra-const-ub-checks`),
          // we have to still check it to be non-null.
          const null_r = this.ecx.scalar_may_be_null(scalar);
          if (null_r.$ === "Err") return null_r;
          if (null_r._0) {
            const maybe = !Provenance_CtfeProvenance.OFFSET_IS_ADDR && scalar.$ === "Ptr";
            return throw_validation_failure(
              this.path,
              `encountered a ${maybe ? "maybe-" : ""}null function pointer`,
            );
          }
        }
        if (this.reset_provenance_and_padding) {
          // Make sure we do not preserve partial provenance. This matches the thin
          // pointer handling in `deref_pointer`.
          if (scalar.$ === "Int") {
            const r = this.ecx.clear_provenance(value);
            if (r.$ === "Err") return r;
          }
          this.add_data_range_place(value);
        }
        return interp_ok(true);
      }
      case "Never":
        return throw_validation_failure(
          this.path,
          `encountered a value of the never type \`!\``,
        );
      case "Foreign":
      case "FnDef":
        // Nothing to check.
        return interp_ok(true);
      case "UnsafeBinder":
        return panic("not implemented: FIXME(unsafe_binder)");
      // The above should be all the primitive types. The rest is compound, we
      // check them by visiting their fields/variants.
      case "Adt":
      case "Tuple":
      case "Array":
      case "Slice":
      case "Str":
      case "Dynamic":
      case "Closure":
      case "Pat":
      case "CoroutineClosure":
      case "Coroutine":
        return interp_ok(false);
      // Some types only occur during typechecking, they have no layout.
      // We should not see them here and we could not check them anyway.
      case "Error":
      case "Infer":
      case "Placeholder":
      case "Bound":
      case "Param":
      case "Alias":
      case "CoroutineWitness":
        return bug(`Encountered invalid type ${debug_Ty(ty, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:999 visit_scalar
  visit_scalar(scalar: Scalar, scalar_layout: ScalarAbi): InterpResult {
    const size = ScalarAbi.size(scalar_layout, this.ecx);
    const valid_range = ScalarAbi.valid_range(scalar_layout, this.ecx);
    const { start, end } = valid_range;
    const max_value = size.unsigned_int_max();
    assert(end <= max_value, "assertion failed: end <= max_value");
    let bits: bigint;
    const int_r = Scalar.try_to_scalar_int(scalar);
    if (int_r.$ === "Ok") {
      bits = int_r._0.to_bits(size);
    } else {
      // So this is a pointer then, and casting to an int failed.
      // Can only happen during CTFE.
      // We support 2 kinds of ranges here: full range, and excluding zero.
      if (start === 1n && end === max_value) {
        // Only null is the niche. So make sure the ptr is NOT null.
        const null_r = this.ecx.scalar_may_be_null(scalar);
        if (null_r.$ === "Err") return null_r;
        if (null_r._0) {
          return throw_validation_failure(
            this.path,
            `encountered a maybe-null pointer, but expected something that is definitely non-zero`,
          );
        } else {
          return interp_ok(undefined);
        }
      } else if (ScalarAbi.is_always_valid(scalar_layout, this.ecx)) {
        // Easy. (This is reachable if `enforce_number_validity` is set.)
        return interp_ok(undefined);
      } else {
        // Conservatively, we reject, because the pointer *could* have a bad value.
        return throw_validation_failure(
          this.path,
          `encountered a pointer with unknown absolute address, but expected something that is definitely ${fmt_range(valid_range, max_value)}`,
        );
      }
    }
    // Now compare.
    if (valid_range.contains(bits)) {
      return interp_ok(undefined);
    } else {
      return throw_validation_failure(
        this.path,
        `encountered ${bits}, but expected something ${fmt_range(valid_range, max_value)}`,
      );
    }
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1056 in_mutable_memory
  in_mutable_memory(val: PlaceTy): boolean {
    // debug_assert!(self.ctfe_mode.is_some());
    const e = val.as_mplace_or_local();
    if (e.$ === "Left") {
      const mplace = e._0;
      const p = mplace.ptr().provenance;
      const alloc_id = p !== undefined ? Provenance_CtfeProvenance.get_alloc_id(p) : undefined;
      if (alloc_id !== undefined) {
        const tcx = this.ecx.tcx.deref();
        // Everything must be already interned.
        const mutbl = GlobalAlloc.mutability(tcx.global_alloc(alloc_id), tcx, this.ecx.typing_env);
        const entry = this.ecx.memory.alloc_map.get(alloc_id);
        if (entry !== undefined) {
          const [_, alloc] = entry;
          assert_eq(alloc.mutability, mutbl, String);
        }
        return mutbl === "Mut";
      } else {
        // No memory at all.
        return false;
      }
    } else {
      // A local variable -- definitely mutable.
      return true;
    }
  }

  /// Add the given pointer-length pair to the "data" range of this visit.
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1078 add_data_range
  add_data_range(ptr: Pointer<CtfeProvenance | undefined>, size: Size): void {
    const data_bytes = this.data_bytes;
    if (data_bytes !== undefined) {
      // We only have to store the offset, the rest is the same for all pointers here.
      // The logic is agnostic to whether the offset is relative or absolute as long as
      // it is consistent.
      const [_prov, offset] = ptr.into_raw_parts();
      // Add this.
      data_bytes.add_range(offset, size);
    }
  }

  /// Add the entire given place to the "data" range of this visit.
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1090 add_data_range_place
  add_data_range_place(place: PlaceTy): void {
    // Only sized places can be added this way.
    // debug_assert!(place.layout.is_sized());
    const data_bytes = this.data_bytes;
    if (data_bytes !== undefined) {
      const offset = ValidityVisitor.data_range_offset(this.ecx, place);
      data_bytes.add_range(offset, place.layout.size);
    }
  }

  /// Convert a place into the offset it starts at, for the purpose of data_range tracking.
  /// Must only be called if `data_bytes` is `Some(_)`.
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1101 data_range_offset
  static data_range_offset(ecx: InterpCx, place: PlaceTy): Size {
    // The presence of `data_bytes` implies that our place is in memory.
    const e = InterpResult.expect(ecx.place_to_op(place), "place must be in memory").as_mplace_or_imm();
    if (e.$ !== "Left") panic("place must be in memory");
    const ptr = e._0.ptr();
    const [_prov, offset] = ptr.into_raw_parts();
    return offset;
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1113 reset_padding
  reset_padding(place: PlaceTy): InterpResult {
    const data_bytes = this.data_bytes;
    if (data_bytes === undefined) return interp_ok(undefined);
    // Our value must be in memory, otherwise we would not have set up `data_bytes`.
    const mplace_r = this.ecx.force_allocation(place);
    if (mplace_r.$ === "Err") return mplace_r;
    const mplace = mplace_r._0;
    // Determine starting offset and size.
    const [_prov, start_offset] = mplace.ptr().into_raw_parts();
    const sa_r = this.ecx.size_and_align_of_val(mplace);
    if (sa_r.$ === "Err") return sa_r;
    const [size, _align] = sa_r._0 ?? [mplace.layout.size, mplace.layout.align.abi];
    // If there is no padding at all, we can skip the rest: check for
    // a single data range covering the entire value.
    if (
      data_bytes._0.length === 1 &&
      size_eq(data_bytes._0[0]![0], start_offset) &&
      size_eq(data_bytes._0[0]![1], size)
    ) {
      return interp_ok(undefined);
    }
    // Get a handle for the allocation. Do this only once, to avoid looking up the same
    // allocation over and over again. (Though to be fair, iterating the value already does
    // exactly that.)
    const alloc_r = this.ecx.get_ptr_alloc_mut(mplace.ptr(), size);
    if (alloc_r.$ === "Err") return alloc_r;
    const alloc = alloc_r._0;
    if (alloc === undefined) {
      // A ZST, no padding to clear.
      return interp_ok(undefined);
    }
    // Add a "finalizer" data range at the end, so that the iteration below finds all gaps
    // between ranges.
    data_bytes._0.push([start_offset.add(size), Size.ZERO]);
    // Iterate, and reset gaps.
    let padding_cleared_until = start_offset;
    for (const [offset, size] of data_bytes._0) {
      assert(
        offset.bytes() >= padding_cleared_until.bytes(),
        () => `reset_padding on ${display_Ty(mplace.layout.ty)}: previous field ended at offset ${padding_cleared_until.sub(start_offset).bytes()}, next field starts at ${offset.sub(start_offset).bytes()} (and has a size of ${size.bytes()} bytes)`,
      );
      if (offset.bytes() > padding_cleared_until.bytes()) {
        // We found padding. Adjust the range to be relative to `alloc`, and make it uninit.
        const padding_start = padding_cleared_until.sub(start_offset);
        const padding_size = offset.sub(padding_cleared_until);
        const range = alloc_range(padding_start, padding_size);
        // trace!("reset_padding on {}: resetting padding range {range:?}", mplace.layout.ty);
        alloc.write_uninit(range);
      }
      padding_cleared_until = offset.add(size);
    }
    assert(size_eq(padding_cleared_until, start_offset.add(size)), "assertion failed: padding_cleared_until == start_offset + size");
    return interp_ok(undefined);
  }

  /// Computes the data range of this union type:
  /// which bytes are inside a field (i.e., not padding.)
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1165 union_data_range
  static union_data_range(ecx: InterpCx, layout: TyAndLayout): RangeSet {
    assert(layout.ty.is_union(), "assertion failed: layout.ty.is_union()");
    assert(layout.is_sized(), "there are no unsized unions");
    const layout_cx = LayoutCx.new(ecx.tcx.deref(), ecx.typing_env);
    return ecx.machine.cached_union_data_range(ecx, layout.ty, () => {
      const out = new_RangeSet();
      union_data_range_uncached(layout_cx, layout, Size.ZERO, out);
      return out;
    });

    /// Helper for recursive traversal: add data ranges of the given type to `out`.
    // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1179 union_data_range_uncached
    function union_data_range_uncached(cx: LayoutCx, layout: TyAndLayout, base_offset: Size, out: RangeSet): void {
      // If this is a ZST, we don't contain any data. In particular, this helps us to quickly
      // skip over huge arrays of ZST.
      if (layout.is_zst()) {
        return;
      }
      // Just recursively add all the fields of everything to the output.
      const fields: FieldsShape = layout.fields;
      switch (fields.$) {
        case "Primitive":
          out.add_range(base_offset, layout.size);
          break;
        case "Union":
          // Currently, all fields start at offset 0 (relative to `base_offset`).
          for (let field = 0; field < fields._0; field++) {
            const field_ = layout.field(cx, field);
            union_data_range_uncached(cx, field_, base_offset, out);
          }
          break;
        case "Array": {
          const { stride, count } = fields;
          const elem = layout.field(cx, 0);

          // Fast-path for large arrays of simple types that do not contain any padding.
          if (BackendRepr.is_scalar(elem.backend_repr)) {
            out.add_range(base_offset, elem.size.mul(count));
          } else {
            for (let idx = 0n; idx < count; idx++) {
              // This repeats the same computation for every array element... but the alternative
              // is to allocate temporary storage for a dedicated `out` set for the array element,
              // and replicating that N times. Is that better?
              union_data_range_uncached(cx, elem, base_offset.add(stride.mul(idx)), out);
            }
          }
          break;
        }
        case "Arbitrary": {
          const offsets = fields.offsets;
          for (let field = 0; field < offsets.length; field++) {
            const offset = offsets[field]!;
            const field_ = layout.field(cx, field);
            union_data_range_uncached(cx, field_, base_offset.add(offset), out);
          }
          break;
        }
      }
      // Don't forget potential other variants.
      const variants = layout.variants;
      switch (variants.$) {
        case "Single":
        case "Empty":
          // Fully handled above.
          break;
        case "Multiple":
          for (let variant = 0; variant < variants.variants.length; variant++) {
            const variant_ = layout.for_variant(cx, VariantIdxC.from_usize(variant));
            union_data_range_uncached(cx, variant_, base_offset, out);
          }
          break;
      }
    }
  }

  // ---- impl ValueVisitor for ValidityVisitor (type V = PlaceTy) ----

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1244 ecx
  ecx_(): InterpCx {
    return this.ecx;
  }

  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1248 read_discriminant
  override read_discriminant(val: PlaceTy): InterpResult<VariantIdx> {
    return this.with_elem(PathElem.EnumTag, (this_) => {
      const r = try_validation(this_.ecx.read_discriminant(val), this_.path, (e) => {
        if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidTag") {
          const val = e._0._0;
          return `encountered ${lower_hex_Scalar(val, PLAIN)}, but expected a valid enum tag`;
        }
        if (e.$ === "UndefinedBehavior" && e._0.$ === "UninhabitedEnumVariantRead") {
          return `encountered an uninhabited enum variant`;
        }
        // Uninit / bad provenance are not possible since the field was already previously
        // checked at its integer type.
        return undefined;
      });
      if (r.$ === "Err") return r;
      return interp_ok(r._0);
    });
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1267 visit_field
  override visit_field(old_val: PlaceTy, field: number, new_val: PlaceTy): InterpResult {
    const elem = this.aggregate_field_path_elem(old_val.layout, field, new_val.layout.ty);
    return this.with_elem(elem, (this_) => this_.visit_value(new_val));
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1278 visit_variant
  override visit_variant(old_val: PlaceTy, variant_id: VariantIdx, new_val: PlaceTy): InterpResult {
    const kind = old_val.layout.ty.kind();
    let name: PathElem;
    switch (kind.$) {
      case "Adt":
        name = { $: "Variant", _0: kind._0.variant(variant_id).name };
        break;
      // Coroutines also have variants
      case "Coroutine":
        name = { $: "CoroutineState", _0: variant_id };
        break;
      default:
        return bug(`Unexpected type with variant: ${debug_Ty(old_val.layout.ty, PLAIN)}`);
    }
    return this.with_elem(name, (this_) => this_.visit_value(new_val));
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1294 visit_union
  override visit_union(val: PlaceTy, _fields: number): InterpResult {
    // Special check for CTFE validation, preventing `UnsafeCell` inside unions in immutable memory.
    if (this.ctfe_mode !== undefined && !CtfeValidationMode.allow_immutable_unsafe_cell(this.ctfe_mode)) {
      // Unsized unions are currently not a thing, but let's keep this code consistent with
      // the check in `visit_value`.
      const sa_r = this.ecx.size_and_align_of_val(val);
      if (sa_r.$ === "Err") return sa_r;
      const zst = sa_r._0 !== undefined && sa_r._0[0].bytes() === 0;
      if (!zst && !val.layout.ty.is_freeze(this.ecx.tcx.deref(), this.ecx.typing_env)) {
        if (!this.in_mutable_memory(val)) {
          return throw_validation_failure(
            this.path,
            `encountered \`UnsafeCell\` in read-only memory`,
          );
        }
      }
    }
    const data_bytes = this.data_bytes;
    if (this.reset_provenance_and_padding && data_bytes !== undefined) {
      const base_offset = ValidityVisitor.data_range_offset(this.ecx, val);
      // Determine and add data range for this union.
      const union_data_range = ValidityVisitor.union_data_range(this.ecx, val.layout);
      for (const [offset, size] of union_data_range._0) {
        data_bytes.add_range(base_offset.add(offset), size);
      }
    }
    return interp_ok(undefined);
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1327 visit_box
  override visit_box(box_ty: Ty, val: PlaceTy): InterpResult {
    const r = this.check_safe_pointer(val, box_ty, PtrKind.Box);
    if (r.$ === "Err") return r;
    return interp_ok(undefined);
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1337 visit_variantless
  override visit_variantless(val: PlaceTy): InterpResult {
    const ty = val.layout.ty;
    assert(ty.is_enum(), () => `encountered non-enum variantless type \`${display_Ty(ty)}\``);
    return throw_validation_failure(
      this.path,
      `encountered a value of zero-variant enum \`${display_Ty(ty)}\``,
    );
  }

  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1347 visit_value
  override visit_value(val: PlaceTy): InterpResult {
    // trace!("visit_value: {:?}, {:?}", *val, val.layout);

    // Check primitive types -- the leaves of our recursive descent.
    // This is called even for enum discriminants (which are "fields" of their enum),
    // so for integer-typed discriminants the provenance reset will happen here.
    // We assume that the Scalar validity range does not restrict these values
    // any further than `try_visit_primitive` does!
    const prim_r = this.try_visit_primitive(val);
    if (prim_r.$ === "Err") return prim_r;
    if (prim_r._0) {
      return interp_ok(undefined);
    }

    // Special check preventing `UnsafeCell` in the inner part of constants
    if (this.ctfe_mode !== undefined && !CtfeValidationMode.allow_immutable_unsafe_cell(this.ctfe_mode)) {
      // Exclude ZST values. We need to compute the dynamic size/align to properly
      // handle slices and trait objects.
      const sa_r = this.ecx.size_and_align_of_val(val);
      if (sa_r.$ === "Err") return sa_r;
      const zst = sa_r._0 !== undefined && sa_r._0[0].bytes() === 0;
      const def = !zst ? val.layout.ty.ty_adt_def() : undefined;
      if (!zst && def !== undefined && def.is_unsafe_cell()) {
        if (!this.in_mutable_memory(val)) {
          return throw_validation_failure(
            this.path,
            `encountered \`UnsafeCell\` in read-only memory`,
          );
        }
      }
    }

    // Recursively walk the value at its type. Apply optimizations for some large types.
    const kind = val.layout.ty.kind();
    const tys = kind.$ === "Array" || kind.$ === "Slice" ? kind._0 : undefined;
    if (kind.$ === "Str") {
      const mplace = val.assert_mem_place(); // strings are unsized and hence never immediate
      const len_r = mplace.len(this.ecx);
      if (len_r.$ === "Err") return len_r;
      const len = len_r._0;
      const expected: ExpectedKind = "Str";
      const r = try_validation(
        this.ecx.read_bytes_ptr_strip_provenance(mplace.ptr(), Size.from_bytes(len)),
        this.path,
        (e) => {
          if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidUninitBytes") return { $: "Uninit", expected };
          if (e.$ === "Unsupported" && e._0.$ === "ReadPointerAsInt") return { $: "PointerAsInt", expected };
          return undefined;
        },
      );
      if (r.$ === "Err") return r;
    } else if (
      tys !== undefined &&
      // This optimization applies for types that can hold arbitrary non-provenance bytes (such as
      // integer and floating point types).
      // FIXME(wesleywiser) This logic could be extended further to arbitrary structs or
      // tuples made up of integer/floating point types or inhabited ZSTs with no padding.
      (tys.kind().$ === "Int" || tys.kind().$ === "Uint" || tys.kind().$ === "Float")
    ) {
      const expected: ExpectedKind = tys.is_integral() ? "Int" : "Float";
      // Optimized handling for arrays of integer/float type.

      // This is the length of the array/slice.
      const len_r = val.len(this.ecx);
      if (len_r.$ === "Err") return len_r;
      const len = len_r._0;
      // This is the element type size.
      const layout_r = this.ecx.layout_of(tys);
      if (layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout_r._0));
      const layout = layout_r._0;
      // This is the size in bytes of the whole array. (This checks for overflow.)
      const size = layout.size.mul(len);
      // If the size is 0, there is nothing to check.
      // (`size` can only be 0 if `len` is 0, and empty arrays are always valid.)
      if (size_eq(size, Size.ZERO)) {
        return interp_ok(undefined);
      }
      // Now that we definitely have a non-ZST array, we know it lives in memory -- except it may
      // be an uninitialized local variable, those are also "immediate".
      const op_r = val.to_op(this.ecx);
      if (op_r.$ === "Err") return op_r;
      const e = op_r._0.as_mplace_or_imm();
      let mplace: MPlaceTy;
      if (e.$ === "Left") {
        mplace = e._0;
      } else {
        const imm = e._0;
        switch (imm.imm.$) {
          case "Uninit":
            return throw_validation_failure(
              this.path,
              { $: "Uninit", expected },
            );
          case "Scalar":
          case "ScalarPair":
            return bug("arrays/slices can never have Scalar/ScalarPair layout");
        }
      }

      // Optimization: we just check the entire range at once.
      // NOTE: Keep this in sync with the handling of integer and float
      // types above, in `visit_primitive`.
      // No need for an alignment check here, this is not an actual memory access.
      const alloc_r = this.ecx.get_ptr_alloc(mplace.ptr(), size);
      if (alloc_r.$ === "Err") return alloc_r;
      const alloc = unwrap(alloc_r._0, "we already excluded size 0");

      const bytes_r = InterpResult.map_err_kind(alloc.get_bytes_strip_provenance(), (kind) => {
        // Some error happened, try to provide a more detailed description.
        // For some errors we might be able to provide extra information.
        // (This custom logic does not fit the `try_validation!` macro.)
        if (
          (kind.$ === "UndefinedBehavior" && kind._0.$ === "InvalidUninitBytes" && kind._0._0 !== undefined) ||
          (kind.$ === "Unsupported" && kind._0.$ === "ReadPointerAsInt" && kind._0._0 !== undefined)
        ) {
          const [_alloc_id, access] = kind._0._0!;
          // Some byte was uninitialized, determine which
          // element that byte belongs to so we can
          // provide an index.
          const i = Math.floor(access.bad.start.bytes() / layout.size.bytes());
          this.path.projs.push({ $: "ArrayElem", _0: i });

          if (kind.$ === "UndefinedBehavior" && kind._0.$ === "InvalidUninitBytes") {
            return err_validation_failure(this.path, { $: "Uninit", expected });
          } else {
            return err_validation_failure(this.path, { $: "PointerAsInt", expected });
          }
        }

        // Propagate upwards (that will also check for unexpected errors).
        return kind;
      });
      if (bytes_r.$ === "Err") return bytes_r;

      // Don't forget that these are all non-pointer types, and thus do not preserve
      // provenance.
      if (this.reset_provenance_and_padding) {
        // We can't share this with above as above, we might be looking at read-only memory.
        const alloc_mut_r = this.ecx.get_ptr_alloc_mut(mplace.ptr(), size);
        if (alloc_mut_r.$ === "Err") return alloc_mut_r;
        const alloc = unwrap(alloc_mut_r._0, "we already excluded size 0");
        alloc.clear_provenance();
        // Also, mark this as containing data, not padding.
        this.add_data_range(mplace.ptr(), size);
      }
    } else {
      // PORT: the arm `ty::Array(tys, ..) | ty::Slice(tys) if self.ecx.layout_of(*tys)?.is_zst()`: its guard (with the
      // `?`) runs only for arrays / slices that the arm above did not take.
      let zst_arm = false;
      if (tys !== undefined) {
        const r = this.ecx.layout_of(tys);
        if (r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(r._0));
        zst_arm = r._0.is_zst();
      }
      if (zst_arm) {
        // Fast path for arrays and slices of ZSTs. We only need to check a single ZST element
        // of an array and not all of them, because there's only a single value of a specific
        // ZST type, so either validation fails for all elements or none.
        // Validate just the first element (if any).
        const len_r = val.len(this.ecx);
        if (len_r.$ === "Err") return len_r;
        if (len_r._0 > 0n) {
          const elem_r = this.ecx.project_index(val, 0n);
          if (elem_r.$ === "Err") return elem_r;
          const r = this.visit_field(val, 0, elem_r._0);
          if (r.$ === "Err") return r;
        }
      } else if (kind.$ === "Pat") {
        const base = kind._0;
        const pat = kind._1;
        // First check that the base type is valid
        const base_layout_r = this.ecx.layout_of(base);
        if (base_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(base_layout_r._0));
        const t_r = val.transmute(base_layout_r._0, this.ecx);
        if (t_r.$ === "Err") return t_r;
        const r = this.visit_value(t_r._0);
        if (r.$ === "Err") return r;
        // When you extend this match, make sure to also add tests to
        // tests/ui/type/pattern_types/validity.rs
        switch (pat.internee.$) {
          // Range and non-null patterns are precisely reflected into `valid_range` and thus
          // handled fully by `visit_scalar` (called below).
          case "Range":
            break;
          case "NotNull":
            break;

          // FIXME(pattern_types): check that the value is covered by one of the variants.
          // For now, we rely on layout computation setting the scalar's `valid_range` to
          // match the pattern. However, this cannot always work; the layout may
          // pessimistically cover actually illegal ranges and Miri would miss that UB.
          // The consolation here is that codegen also will miss that UB, so at least
          // we won't see optimizations actually breaking such programs.
          case "Or":
            break;
        }
        // FIXME(pattern_types): handle everything based on the pattern, not on the layout.
        // it's ok to run scalar validation even if the pattern type is `u8 is 0..=255` and thus
        // allows uninit values, because that's rare and so not a perf issue.
        const repr = val.layout.backend_repr;
        switch (repr.$) {
          case "Scalar": {
            const scalar_layout = repr._0;
            if (!ScalarAbi.is_uninit_valid(scalar_layout)) {
              // There is something to check here.
              // We read directly via `ecx` since the read cannot fail -- we already read
              // this field above when recursing into the field.
              const scalar_r = this.ecx.read_scalar(val);
              if (scalar_r.$ === "Err") return scalar_r;
              const r = this.visit_scalar(scalar_r._0, scalar_layout);
              if (r.$ === "Err") return r;
            }
            break;
          }
          case "ScalarPair": {
            const a_layout = repr.a;
            const b_layout = repr.b;
            // We can only proceed if *both* scalars need to be initialized.
            // FIXME: find a way to also check ScalarPair when one side can be uninit but
            // the other must be init.
            if (!ScalarAbi.is_uninit_valid(a_layout) && !ScalarAbi.is_uninit_valid(b_layout)) {
              // We read directly via `ecx` since the read cannot fail -- we already read
              // this field above when recursing into the field.
              const imm_r = this.ecx.read_immediate(val);
              if (imm_r.$ === "Err") return imm_r;
              const [a, b] = Immediate.to_scalar_pair(imm_r._0.imm);
              const ra = this.visit_scalar(a, a_layout);
              if (ra.$ === "Err") return ra;
              const rb = this.visit_scalar(b, b_layout);
              if (rb.$ === "Err") return rb;
            }
            break;
          }
          case "SimdVector":
          case "SimdScalableVector":
            return panic("internal error: entered unreachable code");
          case "Memory":
            return panic("internal error: entered unreachable code");
        }
      } else {
        const old_may_dangle = this.may_dangle;
        this.may_dangle ||= val.layout.ty.is_like_maybe_dangling();

        // default handler
        const r = try_validation(
          this.walk_value(val),
          this.path,
          // It's not great to catch errors here, since we can't give a very good path,
          // but it's better than ICEing.
          (e) => {
            if (e.$ === "UndefinedBehavior" && e._0.$ === "InvalidVTableTrait") {
              const { vtable_dyn_type, expected_dyn_type } = e._0;
              return { $: "InvalidMetaWrongTrait", expected_dyn_type, vtable_dyn_type };
            }
            return undefined;
          },
        );
        if (r.$ === "Err") return r;

        this.may_dangle = old_may_dangle;
      }
    }

    // Assert that we checked everything there is to check about this type.
    // `is_opsem_inhabited` implies that the layout is inhabited (checked by layout invariants).
    // PORT: `assert!`'s message is only formatted on failure; building it eagerly would print a type path and trip
    // rustc's `trimmed_def_paths` delayed check at exit.
    if (!val.layout.ty.is_opsem_inhabited(this.ecx.tcx.deref(), this.ecx.typing_env)) {
      throw new Panic(`a value of type \`${display_Ty(val.layout.ty)}\` passed validation but that type is uninhabited`);
    }
    // PORT: the `if cfg!(debug_assertions) { .. }` re-check of the scalar ranges is skipped (rustc ships without
    // debug assertions; interpret/eval_context.ts header).

    return interp_ok(undefined);
  }
}

// impl fmt::Display for PtrKind
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:115 fmt
export function display_PtrKind(self: PtrKind, f: Fmt): string {
  void f;
  let str: string;
  switch (self.$) {
    case "Ref":
      str = "reference";
      break;
    case "Box":
      str = "box";
      break;
  }
  return `${str}`;
}

// impl fmt::Display for ExpectedKind
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:138 fmt
export function display_ExpectedKind(self: ExpectedKind, f: Fmt): string {
  void f;
  let str: string;
  switch (self) {
    case "Reference":
      str = "expected a reference";
      break;
    case "Box":
      str = "expected a box";
      break;
    case "RawPtr":
      str = "expected a raw pointer";
      break;
    case "Bool":
      str = "expected a boolean";
      break;
    case "Char":
      str = "expected a unicode scalar value";
      break;
    case "Float":
      str = "expected a floating point number";
      break;
    case "Int":
      str = "expected an integer";
      break;
    case "FnPtr":
      str = "expected a function pointer";
      break;
    case "Str":
      str = "expected a string";
      break;
  }
  return `${str}`;
}

// impl From<PtrKind> for ExpectedKind
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:155 from
export function ExpectedKind_from_PtrKind(x: PtrKind): ExpectedKind {
  switch (x.$) {
    case "Box":
      return "Box";
    case "Ref":
      return "Reference";
  }
}

// We don't do this via `fmt::Display` to so that we can do a move in the `GeneralError` case.
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:187 to_string
ValidationErrorKind.to_string = function (self: ValidationErrorKind): string {
  switch (self.$) {
    case "Uninit":
      return `encountered uninitialized memory, but ${display_ExpectedKind(self.expected, PLAIN)}`;
    case "PointerAsInt":
      return `encountered a pointer, but ${display_ExpectedKind(self.expected, PLAIN)}`;
    case "PartialPointer":
      return `encountered a partial pointer or a mix of pointers`;
    case "InvalidMetaWrongTrait": {
      const { vtable_dyn_type, expected_dyn_type } = self;
      return `wrong trait in wide pointer vtable: expected \`${display_List_PolyExistentialPredicate(expected_dyn_type)}\`, but encountered \`${display_List_PolyExistentialPredicate(vtable_dyn_type)}\``;
    }
    case "GeneralError":
      return self.msg;
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:200 ptr_bytes_warning
ValidationErrorKind.ptr_bytes_warning = function (self: ValidationErrorKind): boolean {
  return self.$ === "PointerAsInt" || self.$ === "PartialPointer";
};

// impl From<String> for ValidationErrorKind
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:207 from
export function ValidationErrorKind_from_String(msg: string): ValidationErrorKind {
  return { $: "GeneralError", msg };
}

// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:212 fmt_range
export function fmt_range(r: WrappingRange, max_hi: bigint): string {
  const { start: lo, end: hi } = r;
  assert(hi <= max_hi, "assertion failed: hi <= max_hi");
  if (lo > hi) {
    return `less or equal to ${hi}, or greater or equal to ${lo}`;
  } else if (lo === hi) {
    return `equal to ${lo}`;
  } else if (lo === 0n) {
    assert(hi < max_hi, "should not be printing if the range covers everything");
    return `less or equal to ${hi}`;
  } else if (hi === max_hi) {
    assert(lo > 0n, "should not be printing if the range covers everything");
    return `greater or equal to ${lo}`;
  } else {
    return `in the range ${lo}..=${hi}`;
  }
}

// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:256 new
(Path as unknown as { new: typeof Path.new }).new = function (ty: Ty): Path {
  return new Path(ty, []);
};

// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:276 allow_immutable_unsafe_cell
CtfeValidationMode.allow_immutable_unsafe_cell = function (self: CtfeValidationMode): boolean {
  switch (self.$) {
    case "Static":
      return false;
    case "Promoted":
      return false;
    case "Const":
      return self.allow_immutable_unsafe_cell;
  }
};

/// Format a path
// PORT: `out: &mut String` is a `MutRef<string>` (PORTING §8).
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:321 write_path
export function write_path(out: MutRef<string>, path: readonly PathElem[]): void {
  for (const elem of path) {
    switch (elem.$) {
      case "Field":
        out.value += `.${display_Symbol(elem._0)}`;
        break;
      case "EnumTag":
        out.value += `.<enum-tag>`;
        break;
      case "Variant":
        out.value += `.<enum-variant(${display_Symbol(elem._0)})>`;
        break;
      case "CoroutineTag":
        out.value += `.<coroutine-tag>`;
        break;
      case "CoroutineState":
        out.value += `.<coroutine-state(${VariantIdxC.index(elem._0)})>`;
        break;
      case "CapturedVar":
        out.value += `.<captured-var(${display_Symbol(elem._0)})>`;
        break;
      case "TupleElem":
        out.value += `.${elem._0}`;
        break;
      case "ArrayElem":
        out.value += `[${elem._0}]`;
        break;
      // `.<deref>` does not match Rust syntax, but it is more readable for long paths -- and
      // some of the other items here also are not Rust syntax. Actually we can't
      // even use the usual syntax because we are just showing the projections,
      // not the root.
      case "Deref":
        out.value += `.<deref>`;
        break;
      case "DynDowncast":
        out.value += `.<dyn-downcast(${display_Ty(elem._0)})>`;
        break;
      case "Vtable":
        out.value += `.<vtable>`;
        break;
    }
  }
}

// PORT: `union_data_range_uncached` (validity.rs:1179) is nested in `ValidityVisitor::union_data_range` (in the class).

// ---- impl<'tcx, M: Machine<'tcx>> InterpCx<'tcx, M> ----

/// The internal core entry point for all validation operations.
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1597 validate_place_internal
InterpCx.prototype.validate_place_internal = function (this: InterpCx, val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path> | undefined, ctfe_mode: CtfeValidationMode | undefined, reset_provenance_and_padding: boolean, start_in_may_dangle: boolean): InterpResult {
  // trace!("validate_place_internal: {:?}, {:?}", *val, val.layout.ty);

  // Run the visitor.
  return InterpResult.inspect_err_info(
    this.ghost_run_mut((ecx): InterpResult => {
      let reset_padding = false;
      if (reset_provenance_and_padding) {
        // Check if `val` is actually stored in memory. If not, padding is not even
        // represented and we need not reset it.
        const op_r = ecx.place_to_op(val);
        if (op_r.$ === "Err") return op_r;
        reset_padding = op_r._0.as_mplace_or_imm().$ === "Left";
      }
      const v = new ValidityVisitor(
        path,
        ref_tracking,
        ctfe_mode,
        ecx,
        reset_provenance_and_padding,
        reset_padding ? new_RangeSet() : undefined,
        start_in_may_dangle,
      );
      const r = v.visit_value(val);
      if (r.$ === "Err") return r;
      const rp = v.reset_padding(val);
      if (rp.$ === "Err") return rp;
      return interp_ok(undefined);
    }),
    (err) => {
      const kind = err.kind();
      if (
        !(
          (kind.$ === "UndefinedBehavior" && kind._0.$ === "ValidationError") ||
          kind.$ === "InvalidProgram" ||
          kind.$ === "Unsupported" ||
          // We have to also ignore machine-specific errors since we do retagging
          // during validation.
          kind.$ === "MachineStop"
        )
      ) {
        bug(`Unexpected error during validation: ${err.to_string()}`);
      }
    },
  );
};

/// This function checks the data at `val` to be const-valid.
/// `val` is assumed to cover valid memory.
/// It will error if the bits at the destination do not match the ones described by the layout.
///
/// `ref_tracking` is used to record references that we encounter so that they
/// can be checked recursively by an outside driving loop.
///
/// `constant` controls whether this must satisfy the rules for constants:
/// - no pointers to statics.
/// - no `UnsafeCell` or non-ZST `&mut`.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1654 const_validate_place
InterpCx.prototype.const_validate_place = function (this: InterpCx, val: PlaceTy, path: Path, ref_tracking: RefTracking<MPlaceTy, Path>, ctfe_mode: CtfeValidationMode): InterpResult {
  return this.validate_place_internal(
    val,
    path,
    ref_tracking,
    ctfe_mode,
    /*reset_provenance*/ false,
    /*start_in_may_dangle*/ false,
  );
};

/// This function checks the data at `val` to be runtime-valid.
/// `val` is assumed to cover valid memory.
/// It will error if the bits at the destination do not match the ones described by the layout.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/validity.rs:1675 validate_place
InterpCx.prototype.validate_place = function (this: InterpCx, val: PlaceTy, recursive: boolean, reset_provenance_and_padding: boolean): InterpResult {
  // let _trace = enter_trace_span!(M, "validate_place", recursive, reset_provenance_and_padding, ?val,);
  // Note that we *could* actually be in CTFE here with `-Zextra-const-ub-checks`, but it's
  // still correct to not use `ctfe_mode`: that mode is for validation of the final constant
  // value, it rules out things like `UnsafeCell` in awkward places.
  if (!recursive) {
    return this.validate_place_internal(
      val,
      Path.new(val.layout.ty),
      undefined,
      undefined,
      reset_provenance_and_padding,
      /*start_in_may_dangle*/ false,
    );
  }
  // Do a recursive check.
  const ref_tracking = RefTracking.empty<MPlaceTy, Path>(key_MPlaceTy);
  const r = this.validate_place_internal(
    val,
    Path.new(val.layout.ty),
    ref_tracking,
    undefined,
    reset_provenance_and_padding,
    /*start_in_may_dangle*/ false,
  );
  if (r.$ === "Err") return r;
  let next: [MPlaceTy, Path] | undefined;
  while ((next = ref_tracking.todo.pop()) !== undefined) {
    const [mplace, path] = next;
    // Things behind reference do *not* have the provenance reset. In fact
    // we treat the entire thing as being inside MaybeDangling, i.e., references
    // do not have to be dereferenceable.
    const r = this.validate_place_internal(
      PlaceTy_from_MPlaceTy(mplace),
      path,
      undefined, // no further recursion
      undefined,
      /*reset_provenance_and_padding*/ false,
      /*start_in_may_dangle*/ true,
    );
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

const U64_MAX = (1n << 64n) - 1n;
