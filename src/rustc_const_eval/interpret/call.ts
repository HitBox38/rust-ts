// Port of compiler/rustc_const_eval/src/interpret/call.rs (lane interp-step-call; declared by lane interp-contract,
// docs/handoff/interp-contract.md): calling a concrete function with argument passing, and returning the return value
// to the caller (interpret/eval_context.ts's header has the representation notes).
//! Manages calling a concrete function (with known MIR body) with argument passing,
//! and returning the return value to the caller.
import { type CanonAbi, display_CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { type AddressSpace, FieldIdx, FieldsShape, type Integer, Scalar as abi_Scalar, VariantIdx, debug_Variants } from "../../rustc_abi/lib.ts";
import { debug_Layout, TyAndLayout as abi_TyAndLayout } from "../../rustc_abi/layout/ty.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine, ReturnAction } from "./machine.ts";
import { RetagMode } from "./machine.gen.ts";
import { FnVal } from "./memory.ts";
import { Immediate_from_Scalar, OpTy_from_ImmTy, OpTy_from_MPlaceTy } from "./operand.ts";
import { MemPlaceMeta, PlaceTy_from_MPlaceTy } from "./place.ts";
import { type ReturnContinuation } from "./stack.ts";
import {
  InterpErrorInfo_from_InterpErrorKind,
  debug_InterpErrorInfo,
  type InterpResult,
  interp_ok,
  Pointer_Option_from_Pointer,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, type Body, debug_Location, Local, type Place as mir_Place, Place_from_Local, RETURN_PLACE, UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type AdtDef } from "../../rustc_middle/ty/adt.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { debug_Instance, debug_InstanceKind, Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { IntegerExt, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { HasAttrs_DefId, Ty, type VariantDef } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { as_interner, ExistentialTraitRef, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { ClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { UnsafeBinderInner } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { intern_key_eq } from "../../rust_ts/intern_key.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, assert_matches, panic, unported, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { OpTy, ImmTy } from "./operand.gen.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";
import * as gen from "./call.gen.ts";
import type { Pending1 } from "../../rustc_type_ir/decls.ts";

/** PORT: rustc_target `callconv::ArgAbi` is not ported yet (lane fn-abi; `FnAbi` is the same placeholder in ty/decls.ts). */
export type ArgAbi<T> = Pending1<"ArgAbi", T>;

// PORT: `FnAbi` / `ArgAbi` (rustc_target callconv/mod.rs) are `Pending1` placeholders until lane fn-abi. The interpreter
// reads these upstream fields / methods of them; each read goes through the accessors below, which stop with an exact
// `unported` until lane fn-abi gives the types their fields (then the accessors become the identity / the methods).
// No `FnAbi` value exists before that (the `fn_abi_of_*` queries have no provider yet).
/** The fields of `FnAbi<'tcx, Ty<'tcx>>` the interpreter reads. */
export interface FnAbiFields {
  args: ArgAbi<Ty>[];
  ret: ArgAbi<Ty>;
  c_variadic: boolean;
  fixed_count: number;
  conv: CanonAbi;
  can_unwind: boolean;
}
/** The fields of `ArgAbi<'tcx, Ty<'tcx>>` the interpreter reads (`layout` is written by the `Virtual` call patch-up). */
export interface ArgAbiFields {
  layout: TyAndLayout;
}
/** `fn_abi.<field>` (lane fn-abi). */
export function fn_abi_(fn_abi: FnAbi<Ty>): FnAbiFields {
  void fn_abi;
  return unported("rustc_target::callconv::FnAbi (lane fn-abi)");
}
/** `arg_abi.<field>` (lane fn-abi). */
function arg_abi_(arg_abi: ArgAbi<Ty>): ArgAbiFields {
  void arg_abi;
  return unported("rustc_target::callconv::ArgAbi (lane fn-abi)");
}
/** `ArgAbi::eq_abi` (rustc_target callconv/mod.rs, lane fn-abi). */
function ArgAbi_eq_abi(self: ArgAbi<Ty>, other: ArgAbi<Ty>): boolean {
  void self;
  void other;
  return unported("rustc_target::callconv::ArgAbi::eq_abi (lane fn-abi)");
}
/** `ArgAbi::is_ignore` (rustc_target callconv/mod.rs, lane fn-abi). */
function ArgAbi_is_ignore(self: ArgAbi<Ty>): boolean {
  void self;
  return unported("rustc_target::callconv::ArgAbi::is_ignore (lane fn-abi)");
}
/** `<FnAbi as Clone>::clone` (lane fn-abi). */
function clone_FnAbi(self: FnAbi<Ty>): FnAbi<Ty> {
  void self;
  return unported("rustc_target::callconv::FnAbi::clone (lane fn-abi)");
}

/** `Iterator::next` of the JS iterators that stand for upstream's `impl Iterator` arguments. */
function next<T>(it: Iterator<T>): T | undefined {
  const r = it.next();
  return r.done ? undefined : r.value;
}
/** `a.iter().zip(b.iter())` */
function* zip<A, B>(a: readonly A[], b: readonly B[]): Generator<[A, B]> {
  for (let i = 0; i < a.length && i < b.length; i++) yield [a[i]!, b[i]!];
}
/** `a.iter().enumerate()` */
function* enumerate<T>(a: readonly T[]): Generator<[number, T]> {
  for (let i = 0; i < a.length; i++) yield [i, a[i]!];
}
/** `(0..n).map(|_| 0u8)` */
function* zeros(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield 0;
}
/** `&s[n..]` (panics like the slice index). */
function slice_from<T>(s: readonly T[], n: number): T[] {
  if (n > s.length) panic(`range start index ${n} out of range for slice of length ${s.length}`);
  return s.slice(n);
}

export * from "./call.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // call.rs:58 (lane interp-step-call)
    copy_fn_args(args: readonly FnArg[]): OpTy[];
    // call.rs:63 (lane interp-step-call)
    fn_arg_project_field(arg: FnArg, field: FieldIdx): InterpResult<FnArg>;
    // call.rs:75 (lane interp-step-call)
    has_trivial_abi(layout: TyAndLayout): InterpResult<boolean>;
    // call.rs:123 (lane interp-step-call)
    unfold_transparent(layout: TyAndLayout, may_unfold: (a0: AdtDef) => boolean): InterpResult<TyAndLayout>;
    // call.rs:165 (lane interp-step-call)
    unfold_npo(layout: TyAndLayout): InterpResult<TyAndLayout>;
    // call.rs:234 (lane interp-step-call)
    identical_c_types(caller_type: Ty, callee_type: Ty): boolean;
    // call.rs:278 (lane interp-step-call)
    layout_compat(caller: TyAndLayout, callee: TyAndLayout): InterpResult<boolean>;
    // call.rs:365 (lane interp-step-call)
    check_argument_compat(caller_abi: ArgAbi<Ty>, callee_abi: ArgAbi<Ty>): InterpResult<boolean>;
    // call.rs:387 (lane interp-step-call)
    pass_argument(caller_args: Iterator<[FnArg, ArgAbi<Ty>]>, callee_args_abis: Iterator<[number, ArgAbi<Ty>]>, callee_arg: mir_Place, callee_ty: Ty, already_live: boolean): InterpResult;
    // call.rs:452 (lane interp-step-call)
    init_stack_frame(instance: Instance, body: Body, caller_fn_abi: FnAbi<Ty>, args: readonly FnArg[], with_caller_location: boolean, destination: PlaceTy, cont: ReturnContinuation): InterpResult;
    // call.rs:720 (lane interp-step-call)
    init_fn_call(fn_val: FnVal<never>, _1: [ExternAbi, FnAbi<Ty> | undefined], args: readonly FnArg[], with_caller_location: boolean, destination: PlaceTy, target: BasicBlock | undefined, unwind: UnwindAction): InterpResult;
    // call.rs:954 (lane interp-step-call)
    assert_virtual_instance_matches_concrete(dyn_ty: Ty, def_id: DefId, virtual_instance: Instance, concrete_instance: Instance): void;
    // call.rs:983 (lane interp-step-call)
    init_fn_tail_call(fn_val: FnVal<never>, _1: [ExternAbi, FnAbi<Ty> | undefined], args: readonly FnArg[], with_caller_location: boolean): InterpResult;
    // call.rs:1037 (lane interp-step-call)
    init_drop_in_place_call(place: PlaceTy, instance: Instance, target: BasicBlock, unwind: UnwindAction): InterpResult;
    // call.rs:1106 (lane interp-step-call)
    return_from_current_stack_frame(unwinding: boolean): InterpResult;
  }
}


export interface FnArg_methods {
  // call.rs:38 (lane interp-step-call)
  layout(self: FnArg): TyAndLayout;
  // call.rs:47 (lane interp-step-call)
  copy_fn_arg(self: FnArg): OpTy;
}
export type FnArg = gen.FnArg;
export const FnArg = {} as FnArg_methods;

// rustc: compiler/rustc_const_eval/src/interpret/call.rs:38 layout
FnArg.layout = function (self: FnArg): TyAndLayout {
  switch (self.$) {
    case "Copy":
      return self._0.layout;
    case "InPlace":
      return self._0.layout;
  }
};

/// Make a copy of the given fn_arg. Any `InPlace` are degenerated to copies, no protection of the
/// original memory occurs.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:47 copy_fn_arg
FnArg.copy_fn_arg = function (self: FnArg): OpTy {
  switch (self.$) {
    case "Copy":
      return self._0;
    case "InPlace":
      return OpTy_from_MPlaceTy(self._0);
  }
};

/// Make a copy of the given fn_args. Any `InPlace` are degenerated to copies, no protection of the
/// original memory occurs.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:58 copy_fn_args
InterpCx.prototype.copy_fn_args = function (this: InterpCx, args: readonly FnArg[]): OpTy[] {
  return args.map((fn_arg) => FnArg.copy_fn_arg(fn_arg));
};

/// Helper function for argument untupling.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:63 fn_arg_project_field
InterpCx.prototype.fn_arg_project_field = function (this: InterpCx, arg: FnArg, field: FieldIdx): InterpResult<FnArg> {
  switch (arg.$) {
    case "Copy": {
      const r = this.project_field(arg._0, field);
      if (r.$ === "Err") return r;
      return interp_ok<FnArg>({ $: "Copy", _0: r._0 });
    }
    case "InPlace": {
      const r = this.project_field(arg._0, field);
      if (r.$ === "Err") return r;
      return interp_ok<FnArg>({ $: "InPlace", _0: r._0 });
    }
  }
};

/** `self.layout_of(ty)?` in an `InterpResult` fn. */
function layout_of_(ecx: InterpCx, ty: Ty): InterpResult<TyAndLayout> {
  const r = ecx.layout_of(ty);
  return r.$ === "Err" ? Err(InterpErrorInfo_from_InterpErrorKind(r._0)) : r;
}

/// Returns whether the given type has trivial ABI.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:75 has_trivial_abi
InterpCx.prototype.has_trivial_abi = function (this: InterpCx, layout: TyAndLayout): InterpResult<boolean> {
  if (!layout.is_1zst()) {
    return interp_ok(false);
  }
  const kind = layout.ty.kind();
  switch (kind.$) {
    // Trivially trivial-ABI types (because Rust makes no promises about their ABI).
    case "Tuple":
    case "Never":
    case "FnDef":
    case "Closure":
    case "Coroutine":
    case "CoroutineClosure":
      return interp_ok(true);

    case "Array": {
      // 0-length arrays are in general *not* okay, but arrays of trivial-ABI types are.
      const l = layout_of_(this, kind._0);
      if (l.$ === "Err") return l;
      return this.has_trivial_abi(l._0);
    }
    case "Adt": {
      const adt_def = kind._0;
      if (adt_def.repr().transparent()) {
        // All fields must have trivial ABI.
        let acc = true;
        for (let idx = 0; idx < FieldsShape.count(layout.fields); idx++) {
          // `acc && self.has_trivial_abi(..)?` (short-circuits)
          if (acc) {
            const r = this.has_trivial_abi(layout.field(this, idx));
            if (r.$ === "Err") return r;
            acc = r._0;
          }
        }
        return interp_ok(acc);
      } else if (adt_def.repr().c()) {
        return interp_ok(false);
      } else {
        // Can't be SIMD or Scalable (since this is a 1-ZST); only Rust is left.
        assert(adt_def.repr().rust(), "assertion failed: adt_def.repr().rust()");
        return interp_ok(true);
      }
    }
    // Types that are considered transparent in `unfold_transparent` should also act
    // like transparent types here.
    case "Pat": {
      const l = layout_of_(this, kind._0);
      if (l.$ === "Err") return l;
      return this.has_trivial_abi(l._0);
    }
    case "UnsafeBinder": {
      const ty = this.tcx.deref().instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(kind._0), fold_Ty);
      const l = layout_of_(this, ty);
      if (l.$ === "Err") return l;
      return this.has_trivial_abi(l._0);
    }

    case "Alias":
      return panic("non-normalized type");
    default:
      return interp_ok(false);
  }
};

/// Find the wrapped inner type of a transparent wrapper by going for the unique
/// non-trivial-ABI field.
///
/// We work with `TyAndLayout` here since that makes it much easier to iterate over all fields.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:123 unfold_transparent
InterpCx.prototype.unfold_transparent = function (this: InterpCx, layout: TyAndLayout, may_unfold: (a0: AdtDef) => boolean): InterpResult<TyAndLayout> {
  const kind = layout.ty.kind();
  if (kind.$ === "Adt" && kind._0.repr().transparent() && may_unfold(kind._0)) {
    assert_matches(layout.variants, layout.variants.$ === "Single", "rustc_abi::Variants::Single { .. }", (v) => debug_Variants(v, PLAIN));
    // Look for non-trivial-ABI field(s).
    let found: TyAndLayout | undefined = undefined;
    for (let idx = 0; idx < FieldsShape.count(layout.fields); idx++) {
      const field = layout.field(this, idx);
      const r = this.has_trivial_abi(field);
      if (r.$ === "Err") return r;
      if (r._0) {
        continue;
      }
      // Found a non-trivial ABI field!
      if (found !== undefined) {
        // There is more than one such field.
        // FIXME: we should just panic here. But currently such repr(transparent)
        // types are still accepted. We just don't treat them as transparent.
        return interp_ok(layout);
      }
      found = field;
    }
    if (found === undefined) {
      // All fields have trivial ABI. That means this type is effectively `()`.
      return layout_of_(this, this.tcx.deref().types.unit);
    }
    const field = found;
    // Recurse.
    return this.unfold_transparent(field, may_unfold);
  }
  switch (kind.$) {
    case "Pat": {
      const l = layout_of_(this, kind._0);
      if (l.$ === "Err") return l;
      return this.unfold_transparent(l._0, may_unfold);
    }
    case "UnsafeBinder": {
      const ty = this.tcx.deref().instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(kind._0), fold_Ty);
      const l = layout_of_(this, ty);
      if (l.$ === "Err") return l;
      return this.unfold_transparent(l._0, may_unfold);
    }
    // Not a transparent type, no further unfolding.
    default:
      return interp_ok(layout);
  }
};

/// Unwrap types that are guaranteed a null-pointer-optimization
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:165 unfold_npo
InterpCx.prototype.unfold_npo = function (this: InterpCx, layout: TyAndLayout): InterpResult<TyAndLayout> {
  // Check if this is an option-like type wrapping some type.
  const kind = layout.ty.kind();
  if (kind.$ !== "Adt") {
    // Not an ADT, so definitely no NPO.
    return interp_ok(layout);
  }
  const def = kind._0;
  const args = kind._1;
  if (def.variants().length !== 2) {
    // Not a 2-variant enum, so no NPO.
    return interp_ok(layout);
  }
  assert(def.is_enum(), "assertion failed: def.is_enum()");

  const all_fields_1zst = (variant: VariantDef): InterpResult<boolean> => {
    for (const field of variant.fields) {
      const ty = Unnormalized.skip_norm_wip(field.ty(this.tcx.deref(), args));
      const layout = layout_of_(this, ty);
      if (layout.$ === "Err") return layout;
      if (!layout._0.is_1zst()) {
        return interp_ok(false);
      }
    }
    return interp_ok(true);
  };

  // If one variant consists entirely of 1-ZST, then the other variant
  // is the only "relevant" one for this check.
  const var0 = VariantIdx.from_u32(0);
  const var1 = VariantIdx.from_u32(1);
  let relevant_variant: VariantDef;
  const a0 = all_fields_1zst(def.variant(var0));
  if (a0.$ === "Err") return a0;
  if (a0._0) {
    relevant_variant = def.variant(var1);
  } else {
    const a1 = all_fields_1zst(def.variant(var1));
    if (a1.$ === "Err") return a1;
    if (a1._0) {
      relevant_variant = def.variant(var0);
    } else {
      // No variant is all-1-ZST, so no NPO.
      return interp_ok(layout);
    }
  }
  // The "relevant" variant must have exactly one field, and its type is the "inner" type.
  if (relevant_variant.fields.length !== 1) {
    return interp_ok(layout);
  }
  const inner_ty = Unnormalized.skip_norm_wip(unwrap(relevant_variant.fields[FieldIdx.from_u32(0)]).ty(this.tcx.deref(), args));
  const inner_r = layout_of_(this, inner_ty);
  if (inner_r.$ === "Err") return inner_r;

  // Check if the inner type is one of the NPO-guaranteed ones.
  // For that we first unpeel transparent *structs* (but not unions).
  const is_npo = (def: AdtDef): boolean =>
    find_attr(HasAttrs_DefId.get_attrs(def.did(), this.tcx.deref()), (k) => (k.$ === "RustcNonnullOptimizationGuaranteed" ? null : undefined)) !== undefined;
  const inner_u = this.unfold_transparent(inner_r._0, /* may_unfold */ (def) => {
    // Stop at NPO types so that we don't miss that attribute in the check below!
    return def.is_struct() && !is_npo(def);
  });
  if (inner_u.$ === "Err") return inner_u;
  const inner = inner_u._0;
  const inner_kind = inner.ty.kind();
  if (inner_kind.$ === "Ref" || inner_kind.$ === "FnPtr") {
    // Option<&T> behaves like &T, and same for fn()
    return interp_ok(inner);
  } else if (inner_kind.$ === "Adt" && is_npo(inner_kind._0)) {
    // Once we found a `nonnull_optimization_guaranteed` type, further strip off
    // newtype structs from it to find the underlying ABI type.
    return this.unfold_transparent(inner, /* may_unfold */ (def) => def.is_struct());
  } else {
    // Everything else we do not unfold.
    return interp_ok(layout);
  }
};

/// Determine whether the given types are identical types from the perspective of C.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:234 identical_c_types
InterpCx.prototype.identical_c_types = function (this: InterpCx, caller_type: Ty, callee_type: Ty): boolean {
  if (caller_type === callee_type) {
    return true;
  }

  // C considers two structs to be the same if they have the same name and the same
  // fields. We need a similar rules that that e.g. if caller and callee use the "same"
  // type from two different versions of the same crate, that call is accepted.
  const caller_kind = caller_type.kind();
  if (caller_kind.$ !== "Adt") return false;
  const caller_adt = caller_kind._0;
  const caller_args = caller_kind._1;
  const callee_kind = callee_type.kind();
  if (callee_kind.$ !== "Adt") return false;
  const callee_adt = callee_kind._0;
  const callee_args = callee_kind._1;

  if (
    !(
      // They must both be structs.
      (
        caller_adt.is_struct() &&
        callee_adt.is_struct() &&
        // They must have equal `repr`, and it must be `repr(C)`.
        caller_adt.repr().c() &&
        caller_adt.repr().equal_up_to_seed(callee_adt.repr()) &&
        // They must have the same name.
        this.tcx.deref().item_name(caller_adt.did()) === this.tcx.deref().item_name(callee_adt.did())
      )
    )
  ) {
    return false;
  }

  // All fields must have the same names and types as well, where "same type" recursively
  // uses this check.
  const caller_fields = caller_adt.non_enum_variant().fields;
  const callee_fields = callee_adt.non_enum_variant().fields;
  if (caller_fields.length !== callee_fields.length) return false;
  for (let i = 0; i < caller_fields.length; i++) {
    const caller_field = caller_fields[i]!;
    const callee_field = callee_fields[i]!;
    if (caller_field.name !== callee_field.name) {
      return false; // Bail on different name.
    }
    // Ensure the normalized type is the same.
    const normalized_field_ty = (field: typeof caller_field, args: typeof caller_args): Ty =>
      this.tcx.deref().normalize_erasing_regions(this.typing_env, field.ty(this.tcx.deref(), args), fold_Ty);
    const caller_ty = normalized_field_ty(caller_field, caller_args);
    const callee_ty = normalized_field_ty(callee_field, callee_args);
    if (!this.identical_c_types(caller_ty, callee_ty)) return false;
  }
  return true;
};

/// Check if these two layouts look like they are fn-ABI-compatible.
/// (We also compare the `PassMode`, so this doesn't have to check everything. But it turns out
/// that only checking the `PassMode` is insufficient.)
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:278 layout_compat
InterpCx.prototype.layout_compat = function (this: InterpCx, caller_: TyAndLayout, callee_: TyAndLayout): InterpResult<boolean> {
  // Fast path: equal types are definitely compatible.
  if (caller_.ty === callee_.ty) {
    return interp_ok(true);
  }
  // Handle trivial-ABI types.
  const t1 = this.has_trivial_abi(caller_);
  if (t1.$ === "Err") return t1;
  if (t1._0) {
    const t2 = this.has_trivial_abi(callee_);
    if (t2.$ === "Err") return t2;
    if (t2._0) {
      return interp_ok(true);
    }
  }
  // Unfold newtypes and NPO optimizations.
  const unfold = (layout: TyAndLayout): InterpResult<TyAndLayout> => {
    const r = this.unfold_transparent(layout, /* may_unfold */ (_def) => true);
    if (r.$ === "Err") return r;
    return this.unfold_npo(r._0);
  };
  const caller_r = unfold(caller_);
  if (caller_r.$ === "Err") return caller_r;
  const caller = caller_r._0;
  const callee_r = unfold(callee_);
  if (callee_r.$ === "Err") return callee_r;
  const callee = callee_r._0;
  // Not-quite-so-fast path: if the types are c-equal now, they are compatible.
  // FIXME: This is *not* currently guaranteed by our ABI compatibility docs, but it is needed
  // for Miri itself when it checks whether shims were called with the right arguments.
  // We should eventually put this into the docs as well.
  if (this.identical_c_types(caller.ty, callee.ty)) {
    return interp_ok(true);
  }
  // Now see if these inner types are compatible.

  // Compatible pointer types. For thin pointers, we have to accept even non-`repr(transparent)`
  // things as compatible due to `DispatchFromDyn`. For instance, `Rc<i32>` and `*mut i32`
  // must be compatible. So we just accept everything with Pointer ABI as compatible,
  // even if this will accept some code that is not stably guaranteed to work.
  // This also handles function pointers.
  const thin_pointer = (layout: TyAndLayout): AddressSpace | undefined => {
    const repr = layout.backend_repr;
    if (repr.$ !== "Scalar") return undefined;
    const p = abi_Scalar.primitive(repr._0);
    return p.$ === "Pointer" ? p._0 : undefined;
  };
  const caller_tp = thin_pointer(caller);
  const callee_tp = thin_pointer(callee);
  if (caller_tp !== undefined && callee_tp !== undefined) {
    return interp_ok(caller_tp === callee_tp);
  }
  // For wide pointers we have to get the pointee type.
  const pointee_ty = (ty: Ty): InterpResult<Ty | undefined> => {
    // We cannot use `builtin_deref` here since we need to reject `Box<T, MyAlloc>`.
    const k = ty.kind();
    if (k.$ === "Ref") return interp_ok<Ty | undefined>(k._1);
    if (k.$ === "RawPtr") return interp_ok<Ty | undefined>(k._0);
    // We only accept `Box` with the default allocator.
    if (ty.is_box_global(this.tcx.deref())) return interp_ok<Ty | undefined>(ty.expect_boxed_ty());
    return interp_ok(undefined);
  };
  const caller_pt = pointee_ty(caller.ty);
  if (caller_pt.$ === "Err") return caller_pt;
  const callee_pt = pointee_ty(callee.ty);
  if (callee_pt.$ === "Err") return callee_pt;
  if (caller_pt._0 !== undefined && callee_pt._0 !== undefined) {
    // This is okay if they have the same metadata type.
    const meta_ty = (ty: Ty): Ty => {
      // Even if `ty` is normalized, the search for the unsized tail will project
      // to fields, which can yield non-normalized types. So we need to provide a
      // normalization function.
      const normalize = (ty: Unnormalized<Ty>): Ty => this.tcx.deref().normalize_erasing_regions(this.typing_env, ty, fold_Ty);
      return ty.ptr_metadata_ty(this.tcx.deref(), normalize);
    };
    return interp_ok(meta_ty(caller_pt._0) === meta_ty(callee_pt._0));
  }

  // Compatible integer types (in particular, usize vs ptr-sized-u32/u64).
  // `char` counts as `u32.`
  const int_ty = (ty: Ty): [Integer, boolean] | undefined => {
    const k = ty.kind();
    switch (k.$) {
      case "Int":
        return [IntegerExt.from_int_ty(this.tcx, k._0), /* signed */ true];
      case "Uint":
        return [IntegerExt.from_uint_ty(this.tcx, k._0), /* signed */ false];
      case "Char":
        return ["I32", /* signed */ false];
      default:
        return undefined;
    }
  };
  const caller_it = int_ty(caller.ty);
  const callee_it = int_ty(callee.ty);
  if (caller_it !== undefined && callee_it !== undefined) {
    // This is okay if they are the same integer type.
    return interp_ok(caller_it[0] === callee_it[0] && caller_it[1] === callee_it[1]);
  }

  // The rest is incompatible.
  return interp_ok(false);
};

/// Returns a `bool` saying whether the two arguments are ABI-compatible.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:365 check_argument_compat
InterpCx.prototype.check_argument_compat = function (this: InterpCx, caller_abi: ArgAbi<Ty>, callee_abi: ArgAbi<Ty>): InterpResult<boolean> {
  // We do not want to accept things as ABI-compatible that just "happen to be" compatible on the current target,
  // so we implement a type-based check that reflects the guaranteed rules for ABI compatibility.
  const r = this.layout_compat(arg_abi_(caller_abi).layout, arg_abi_(callee_abi).layout);
  if (r.$ === "Err") return r;
  if (r._0) {
    // Ensure that our checks imply actual ABI compatibility for this concrete call.
    // (This can fail e.g. if `#[rustc_nonnull_optimization_guaranteed]` is used incorrectly.)
    assert(ArgAbi_eq_abi(caller_abi, callee_abi), "assertion failed: caller_abi.eq_abi(callee_abi)");
    return interp_ok(true);
  } else {
    // trace!(
    //     "check_argument_compat: incompatible ABIs:\ncaller: {:?}\ncallee: {:?}",
    //     caller_abi, callee_abi
    // );
    return interp_ok(false);
  }
};

/// Initialize a single callee argument, checking the types for compatibility.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:387 pass_argument
InterpCx.prototype.pass_argument = function (
  this: InterpCx,
  caller_args: Iterator<[FnArg, ArgAbi<Ty>]>,
  callee_args_abis: Iterator<[number, ArgAbi<Ty>]>,
  callee_arg: mir_Place,
  callee_ty: Ty,
  already_live: boolean,
): InterpResult {
  // Get next callee arg.
  const [callee_arg_idx, callee_abi] = unwrap(next(callee_args_abis));
  assert_eq(callee_ty, arg_abi_(callee_abi).layout.ty, (v) => debug_Ty(v, PLAIN));
  // Get next caller arg.
  const caller = next(caller_args);
  if (caller === undefined) {
    // throw_ub_format!("calling a function with fewer arguments than it requires")
    return Err(
      InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: "calling a function with fewer arguments than it requires" } }),
    );
  }
  const [caller_arg, caller_abi] = caller;
  assert_eq(FnArg.layout(caller_arg).layout, arg_abi_(caller_abi).layout.layout, (v) => debug_Layout(v, PLAIN));
  // Sadly we cannot assert that `caller_arg.layout().ty` and `caller_abi.layout.ty` are
  // equal; in closures the types sometimes differ. We just hope that `caller_abi` is the
  // right type to print to the user.

  // Check compatibility
  const compat = this.check_argument_compat(caller_abi, callee_abi);
  if (compat.$ === "Err") return compat;
  if (!compat._0) {
    // throw_ub!(AbiMismatchArgument { .. })
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "UndefinedBehavior",
        _0: { $: "AbiMismatchArgument", arg_idx: callee_arg_idx, caller_ty: arg_abi_(caller_abi).layout.ty, callee_ty: arg_abi_(callee_abi).layout.ty },
      }),
    );
  }
  // We work with a copy of the argument for now; if this is in-place argument passing, we
  // will later protect the source it comes from. This means the callee cannot observe if we
  // did in-place of by-copy argument passing, except for pointer equality tests.
  const caller_arg_copy = FnArg.copy_fn_arg(caller_arg);
  if (!already_live) {
    const local = unwrap(callee_arg.as_local());
    const meta = caller_arg_copy.meta();
    // `check_argument_compat` ensures that if metadata is needed, both have the same type,
    // so we know they will use the metadata the same way.
    assert(!MemPlaceMeta.has_meta(meta) || caller_arg_copy.layout.ty === callee_ty, "assertion failed: !meta.has_meta() || caller_arg_copy.layout.ty == callee_ty");

    const r = this.storage_live_dyn(local, meta);
    if (r.$ === "Err") return r;
  }
  // Now we can finally actually evaluate the callee place.
  const callee_place = this.eval_place(callee_arg, /* skip_validity_for_simple_deref */ false);
  if (callee_place.$ === "Err") return callee_place;
  // We allow some transmutes here.
  // FIXME: Depending on the PassMode, this should reset some padding to uninitialized. (This
  // is true for all `copy_op`, but there are a lot of special cases for argument passing
  // specifically.)
  const r = this.copy_op_allow_transmute(caller_arg_copy, callee_place._0);
  if (r.$ === "Err") return r;
  // If this was an in-place pass, protect the place it comes from for the duration of the call.
  if (caller_arg.$ === "InPlace") {
    const r = this.machine.protect_in_place_function_argument(this, caller_arg._0);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/// The main entry point for creating a new stack frame: performs ABI checks and initializes
/// arguments.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:452 init_stack_frame
InterpCx.prototype.init_stack_frame = function (
  this: InterpCx,
  instance: Instance,
  body: Body,
  caller_fn_abi: FnAbi<Ty>,
  args: readonly FnArg[],
  with_caller_location: boolean,
  destination: PlaceTy,
  cont: ReturnContinuation,
): InterpResult {
  // let _trace = enter_trace_span!(M, step::init_stack_frame, %instance, tracing_separate_thread = Empty);
  const def_id = Instance.def_id(instance);
  const tcx = this.tcx.deref();

  // The first order of business is to figure out the callee signature.
  // However, that requires the list of variadic arguments.
  // We use the *caller* information to determine where to split the list of arguments,
  // and then later check that the callee indeed has the same number of fixed arguments.
  let extra_tys;
  if (fn_abi_(caller_fn_abi).c_variadic) {
    const fixed_count = fn_abi_(caller_fn_abi).fixed_count; // usize::try_from(u32).unwrap()
    const extra_tys_ = slice_from(args, fixed_count).map((arg) => FnArg.layout(arg).ty);
    extra_tys = tcx.mk_type_list_from_iter(extra_tys_);
  } else {
    extra_tys = RawList.empty<Ty>();
  }
  const callee_fn_abi_r = this.fn_abi_of_instance_no_deduced_attrs(instance, extra_tys);
  if (callee_fn_abi_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(callee_fn_abi_r._0));
  const callee_fn_abi = callee_fn_abi_r._0;

  if (fn_abi_(caller_fn_abi).conv !== fn_abi_(callee_fn_abi).conv) {
    // throw_ub_format!(..)
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "UndefinedBehavior",
        _0: {
          $: "Ub",
          _0: `calling a function with calling convention "${display_CanonAbi(fn_abi_(callee_fn_abi).conv)}" using calling convention "${display_CanonAbi(fn_abi_(caller_fn_abi).conv)}"`,
        },
      }),
    );
  }

  if (fn_abi_(caller_fn_abi).c_variadic !== fn_abi_(callee_fn_abi).c_variadic) {
    // throw_ub!(CVariadicMismatch { .. })
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "UndefinedBehavior",
        _0: { $: "CVariadicMismatch", caller_is_c_variadic: fn_abi_(caller_fn_abi).c_variadic, callee_is_c_variadic: fn_abi_(callee_fn_abi).c_variadic },
      }),
    );
  }
  if (fn_abi_(caller_fn_abi).c_variadic && fn_abi_(caller_fn_abi).fixed_count !== fn_abi_(callee_fn_abi).fixed_count) {
    // throw_ub!(CVariadicFixedCountMismatch { .. })
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "UndefinedBehavior",
        _0: { $: "CVariadicFixedCountMismatch", caller: fn_abi_(caller_fn_abi).fixed_count, callee: fn_abi_(callee_fn_abi).fixed_count },
      }),
    );
  }

  // Check that all target features required by the callee (i.e., from
  // the attribute `#[target_feature(enable = ...)]`) are enabled at
  // compile time.
  const r_tf = this.machine.check_fn_target_features(this, instance);
  if (r_tf.$ === "Err") return r_tf;

  // If the signature says this cannot unwind, reflect this in the unwind destination so that
  // we don't have to check this later. (`init_fn_call` already did this for the caller so
  // here we only have to check the callee.)
  if (!fn_abi_(callee_fn_abi).can_unwind) {
    switch (cont.$) {
      case "Stop":
        break;
      case "Goto":
        cont = { $: "Goto", ret: cont.ret, unwind: UnwindAction.Unreachable };
        break;
    }
  }

  // *Before* pushing the new frame, determine whether the return destination is in memory.
  // Need to use `place_to_op` to be *sure* we get the mplace if there is one.
  const dest_op = this.place_to_op(destination);
  if (dest_op.$ === "Err") return dest_op;
  const dest_e = dest_op._0.as_mplace_or_imm();
  const destination_mplace = dest_e.$ === "Left" ? dest_e._0 : undefined;

  // Push the "raw" frame -- this leaves locals uninitialized.
  const r_push = this.push_stack_frame_raw(instance, body, destination, cont);
  if (r_push.$ === "Err") return r_push;
  const loc0 = this.frame().loc;
  if (loc0.$ === "Left") panic(`called \`Either::unwrap_right()\` on a \`Left\` value: ${debug_Location(loc0._0, PLAIN)}`);
  const preamble_span = loc0._0; // the span used for preamble errors

  // trace!("caller ABI: {:#?}, args: {:#?}", ..);
  // trace!("spread_arg: {:?}, locals: {:#?}", ..);

  // Determine whether there is a special VaList argument. This is always the
  // last argument, and since arguments start at index 1 that's `arg_count`.
  const va_list_arg = fn_abi_(callee_fn_abi).c_variadic ? Local.from_usize(body.arg_count) : undefined;
  // Determine whether this is a non-capturing closure. That's relevant as their first
  // argument can be skipped (and that's the only kind of argument skipping we allow).
  const is_non_capturing_closure =
    ((instance.def.$ === "Shim" && instance.def._0.$ === "ClosureOnce") || tcx.is_closure_like(def_id)) &&
    (() => {
      const arg = unwrap(fn_abi_(callee_fn_abi).args[0], "index out of bounds: the len is 0 but the index is 0");
      const k = arg_abi_(arg).layout.ty.kind();
      return k.$ === "Closure" && ClosureArgs.upvar_tys(k._1.as_closure()).length === 0;
    })();

  // In principle, we have two iterators: Where the arguments come from, and where
  // they go to.

  // The "where they come from" part is easy, we expect the caller to do any special handling
  // that might be required here (e.g. for untupling).
  // If `with_caller_location` is set we pretend there is an extra argument (that
  // we will not pass; our `caller_location` intrinsic implementation walks the stack instead).
  {
    const left = args.length + (with_caller_location ? 1 : 0);
    const right = fn_abi_(caller_fn_abi).args.length;
    if (left !== right) {
      panic(`assertion \`left == right\` failed: mismatch between caller ABI and caller arguments\n  left: ${left}\n right: ${right}`);
    }
  }
  const caller_args = zip(args, fn_abi_(caller_fn_abi).args);

  // Now we have to spread them out across the callee's locals,
  // taking into account the `spread_arg`. If we could write
  // this is a single iterator (that handles `spread_arg`), then
  // `pass_argument` would be the loop body.
  const callee_args_abis = enumerate(fn_abi_(callee_fn_abi).args);
  // During argument passing, we want retagging with protectors.
  const r_args = this.machine.with_retag_mode(this, RetagMode.FnEntry, (ecx): InterpResult => {
    for (const local of body.args_iter()) {
      // Update the span that we show in case of an error to point to this argument.
      ecx.frame_mut().loc = { $: "Right", _0: unwrap(body.local_decls[local]).source_info.span };
      // Construct the destination place for this argument. At this point all
      // locals are still dead, so we cannot construct a `PlaceTy`.
      const dest = Place_from_Local(local);
      // `layout_of_local` does more than just the instantiation we need to get the
      // type, but the result gets cached so this avoids calling the instantiation
      // query *again* the next time this local is accessed.
      const ty_r = ecx.layout_of_local(ecx.frame(), local, undefined);
      if (ty_r.$ === "Err") return ty_r;
      const ty = ty_r._0.ty;

      // Some arguments are special: the first (`self`) argument of a non-capturing
      // closure; the va_list argument; and the spread_arg.
      if (is_non_capturing_closure && local === Local.arg(0)) {
        assert(va_list_arg === undefined, "assertion failed: va_list_arg.is_none()");
        assert(local !== body.spread_arg, "assertion failed: Some(local) != body.spread_arg");
        // This argument might be missing on the caller side. So just initialize it in
        // the callee.
        const [callee_arg_idx, callee_abi] = unwrap(next(callee_args_abis));
        assert(arg_abi_(callee_abi).layout.is_1zst() && ArgAbi_is_ignore(callee_abi), "assertion failed: callee_abi.layout.is_1zst() && callee_abi.is_ignore()");
        const r = ecx.storage_live(local);
        if (r.$ === "Err") return r;
        // And skip it in the caller, if present. We can tell whether it is present by
        // comparing the number of arguments on the caller and callee side.
        if (fn_abi_(caller_fn_abi).args.length === fn_abi_(callee_fn_abi).args.length) {
          const [_caller_arg, caller_abi] = unwrap(next(caller_args));
          if (!arg_abi_(caller_abi).layout.is_1zst()) {
            // The caller gave us some other, non-ignorable argument.
            // throw_ub!(AbiMismatchArgument { .. })
            return Err(
              InterpErrorInfo_from_InterpErrorKind({
                $: "UndefinedBehavior",
                _0: { $: "AbiMismatchArgument", arg_idx: callee_arg_idx, caller_ty: arg_abi_(caller_abi).layout.ty, callee_ty: arg_abi_(callee_abi).layout.ty },
              }),
            );
          }
          assert(ArgAbi_is_ignore(caller_abi), "assertion failed: caller_abi.is_ignore()");
        }
      } else if (local === va_list_arg) {
        // This is the last callee-side argument of a variadic function.
        // This argument is a VaList holding the remaining caller-side arguments.
        const r = ecx.storage_live(local);
        if (r.$ === "Err") return r;

        const place = ecx.eval_place(dest, /* skip_validity_for_simple_deref */ false);
        if (place.$ === "Err") return place;
        const mplace_r = ecx.force_allocation(place._0);
        if (mplace_r.$ === "Err") return mplace_r;
        const mplace = mplace_r._0;

        // Consume the remaining arguments by putting them into the variable argument
        // list. We disable retagging to avoid creating protected tags. Protection should
        // only use callee-side information, and the varargs have no static callee-side type.
        const varargs_r = ecx.machine.with_retag_mode(ecx, RetagMode.None, (ecx) => ecx.allocate_varargs(caller_args, callee_args_abis));
        if (varargs_r.$ === "Err") return varargs_r;
        const varargs = varargs_r._0;

        // When the frame is dropped, these variable arguments are deallocated.
        ecx.frame_mut().va_list = varargs.slice();
        const key = ecx.va_list_ptr(varargs);

        // Zero the VaList, so it is fully initialized.
        const r2 = ecx.write_bytes_ptr(mplace.ptr(), zeros(mplace.layout.size.bytes()));
        if (r2.$ === "Err") return r2;

        // Store the "key" pointer in the right field.
        const key_mplace = ecx.va_list_key_field(mplace);
        if (key_mplace.$ === "Err") return key_mplace;
        // PORT: `va_list_key_field<P: Projectable>(&P) -> InterpResult<P>` (intrinsics.ts declares it over `unknown`).
        const r3 = ecx.write_pointer(Pointer_Option_from_Pointer(key), key_mplace._0 as MPlaceTy);
        if (r3.$ === "Err") return r3;
      } else if (local === body.spread_arg) {
        // Make the local live once, then fill in the value field by field.
        const r = ecx.storage_live(local);
        if (r.$ === "Err") return r;
        // Must be a tuple
        const k = ty.kind();
        if (k.$ !== "Tuple") {
          return span_bug(ecx.cur_span(), `non-tuple type for \`spread_arg\`: ${ty.toString()}`);
        }
        const fields = k._0;
        for (let i = 0; i < fields.length; i++) {
          const field_ty = fields[i]!;
          const dest_ = dest.project_deeper([{ $: "Field", _0: FieldIdx.from_usize(i), _1: field_ty }], ecx.tcx.deref());
          const r = ecx.pass_argument(caller_args, callee_args_abis, dest_, field_ty, /* already_live */ true);
          if (r.$ === "Err") return r;
        }
      } else {
        // Normal argument. Cannot mark it as live yet, it might be unsized!
        const r = ecx.pass_argument(caller_args, callee_args_abis, dest, ty, /* already_live */ false);
        if (r.$ === "Err") return r;
      }
    }
    return interp_ok(undefined);
  });
  if (r_args.$ === "Err") return r_args;

  // Don't forget to check the return type!
  this.frame_mut().loc = { $: "Right", _0: unwrap(body.local_decls[RETURN_PLACE]).source_info.span };
  const r_ret = this.check_argument_compat(fn_abi_(caller_fn_abi).ret, fn_abi_(callee_fn_abi).ret);
  if (r_ret.$ === "Err") return r_ret;
  if (!r_ret._0) {
    // throw_ub!(AbiMismatchReturn { .. })
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "UndefinedBehavior",
        _0: { $: "AbiMismatchReturn", caller_ty: arg_abi_(fn_abi_(caller_fn_abi).ret).layout.ty, callee_ty: arg_abi_(fn_abi_(callee_fn_abi).ret).layout.ty },
      }),
    );
  }
  // Protect return place for in-place return value passing.
  // We only need to protect anything if this is actually an in-memory place.
  if (destination_mplace !== undefined) {
    const r = this.machine.protect_in_place_function_argument(this, destination_mplace);
    if (r.$ === "Err") return r;
  }

  // For the final checks, use same span as preamble since it is unclear what else to do.
  this.frame_mut().loc = { $: "Right", _0: preamble_span };
  // If the callee needs a caller location, pretend we consume one more argument from the ABI.
  if (InstanceKind.requires_caller_location(instance.def, tcx)) {
    unwrap(next(callee_args_abis));
  }
  // Now we should have no more caller args or callee arg ABIs.
  assert(next(callee_args_abis) === undefined, "mismatch between callee ABI and callee body arguments");
  if (next(caller_args) !== undefined) {
    // throw_ub_format!("calling a function with more arguments than it expected")
    return Err(
      InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: "calling a function with more arguments than it expected" } }),
    );
  }

  // Done!
  return this.push_stack_frame_done();
};

/// Initiate a call to this function -- pushing the stack frame and initializing the arguments.
///
/// `caller_fn_abi` is used to determine if all the arguments are passed the proper way.
/// However, we also need `caller_abi` to determine if we need to do untupling of arguments.
///
/// `with_caller_location` indicates whether the caller passed a caller location. Miri
/// implements caller locations without argument passing, but to match `FnAbi` we need to know
/// when those arguments are present.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:720 init_fn_call
InterpCx.prototype.init_fn_call = function (
  this: InterpCx,
  fn_val: FnVal<never>,
  [caller_abi, caller_fn_abi]: [ExternAbi, FnAbi<Ty> | undefined],
  args: readonly FnArg[],
  with_caller_location: boolean,
  destination: PlaceTy,
  target: BasicBlock | undefined,
  unwind: UnwindAction,
): InterpResult {
  // let _trace =
  //     enter_trace_span!(M, step::init_fn_call, tracing_separate_thread = Empty, ?fn_val)
  //         .or_if_tracing_disabled(|| trace!("init_fn_call: {:#?}", fn_val));

  // If the signature says this cannot unwind, reflect this in the unwind destination
  // so that we don't have to check this later.
  if (caller_fn_abi !== undefined && !fn_abi_(caller_fn_abi).can_unwind) {
    unwind = UnwindAction.Unreachable;
  }

  let instance: Instance;
  switch (fn_val.$) {
    case "Instance":
      instance = fn_val._0;
      break;
    case "Other": {
      const extra = fn_val._0;
      const caller_fn_abi_ = unwrap(caller_fn_abi, "FnAbi should have been computed for this call");
      return this.machine.call_extra_fn(this, extra, caller_fn_abi_, args, destination, target, unwind);
    }
  }

  const tcx = this.tcx.deref();
  const def = instance.def;
  switch (def.$) {
    case "Intrinsic": {
      const def_id = def._0;
      assert(tcx.intrinsic(def_id) !== undefined, "assertion failed: self.tcx.intrinsic(def_id).is_some()");
      // FIXME: Should `InPlace` arguments be reset to uninit?
      const r = this.machine.call_intrinsic(this, instance, this.copy_fn_args(args), destination, target, unwind);
      if (r.$ === "Err") return r;
      const fallback = r._0;
      if (fallback !== undefined) {
        assert(!unwrap(tcx.intrinsic(Instance.def_id(fallback))).must_be_overridden, "assertion failed: !self.tcx.intrinsic(fallback.def_id()).unwrap().must_be_overridden");
        assert_matches(fallback.def, fallback.def.$ === "Item", "ty::InstanceKind::Item(_)", (v) => debug_InstanceKind(v, PLAIN));
        return this.init_fn_call({ $: "Instance", _0: fallback }, [caller_abi, caller_fn_abi], args, with_caller_location, destination, target, unwind);
      } else {
        return interp_ok(undefined);
      }
    }
    case "LlvmIntrinsic":
      // FIXME: Should `InPlace` arguments be reset to uninit?
      return this.machine.call_llvm_intrinsic(this, instance, this.copy_fn_args(args), destination, target);
    // `Shim` (all of its kinds: `VTable`, `Reify`, `ClosureOnce`, `ConstructCoroutineInClosure`, `FnPtr`, `DropGlue`,
    // `Clone`, `FnPtrAsPtr`, `FnPtrFromPtr`, `ThreadLocal`, `AsyncDropGlueCtor`, `AsyncDropGlue`, `FutureDropPoll`) | `Item`
    case "Shim":
    case "Item": {
      // We need MIR for this fn.
      // Note that this can be an intrinsic, if we are executing its fallback body.
      const caller_fn_abi_ = unwrap(caller_fn_abi, "FnAbi should have been computed for this call");
      const found = this.machine.find_mir_or_eval_fn(this, instance, caller_fn_abi_, args, destination, target, unwind);
      if (found.$ === "Err") return found;
      if (found._0 === undefined) {
        return interp_ok(undefined);
      }
      const [body, instance_] = found._0;

      // Special handling for the closure ABI: untuple the last argument.
      // FIXME(splat): un-tuple splatted arguments that were tupled in typecheck
      let args_: readonly FnArg[];
      if (ExternAbi.eq(caller_abi, ExternAbi.RustCall) && !(args.length === 0)) {
        // Untuple
        const untuple_arg = args[args.length - 1]!;
        const rest = args.slice(0, args.length - 1);
        const k = FnArg.layout(untuple_arg).ty.kind();
        if (k.$ !== "Tuple") {
          return span_bug(this.cur_span(), "untuple argument must be a tuple");
        }
        const untuple_fields = k._0;
        // trace!("init_fn_call: Will pass last argument by untupling");
        const collected: FnArg[] = [];
        // The regular arguments.
        for (const a of rest) collected.push(a);
        // The fields of the untupled argument.
        for (let i = 0; i < untuple_fields.length; i++) {
          const r = this.fn_arg_project_field(untuple_arg, FieldIdx.from_usize(i));
          if (r.$ === "Err") return r;
          collected.push(r._0);
        }
        args_ = collected;
      } else {
        // Plain arg passing
        args_ = args;
      }

      return this.init_stack_frame(instance_, body, caller_fn_abi_, args_, with_caller_location, destination, { $: "Goto", ret: target, unwind });
    }
    // `InstanceKind::Virtual` does not have callable MIR. Calls to `Virtual` instances must be
    // codegen'd / interpreted as virtual calls through the vtable.
    case "Virtual": {
      const def_id = def._0;
      const idx = def._1;
      const caller_fn_abi_ = unwrap(caller_fn_abi, "FnAbi should have been computed for this call");
      const args_ = args.slice();
      // We have to implement all "dyn-compatible receivers". So we have to go search for a
      // pointer or `dyn Trait` type, but it could be wrapped in newtypes. So recursively
      // unwrap those newtypes until we are there.
      // An `InPlace` does nothing here, we keep the original receiver intact. We can't
      // really pass the argument in-place anyway, and we are constructing a new
      // `Immediate` receiver.
      let receiver = FnArg.copy_fn_arg(unwrap(args_[0], "index out of bounds: the len is 0 but the index is 0"));
      let receiver_place: MPlaceTy;
      for (;;) {
        const k = receiver.layout.ty.kind();
        if (k.$ === "Ref" || k.$ === "RawPtr") {
          // We do *not* use `deref_pointer` here: we don't want to conceptually
          // create a place that must be dereferenceable, since the receiver might
          // be a raw pointer and (for `*const dyn Trait`) we don't need to
          // actually access memory to resolve this method.
          // Also see <https://github.com/rust-lang/miri/issues/2786>.
          const val = this.read_immediate(receiver);
          if (val.$ === "Err") return val;
          const p = this.imm_ptr_to_mplace(val._0);
          if (p.$ === "Err") return p;
          receiver_place = p._0;
          break;
        } else if (k.$ === "Dynamic") {
          receiver_place = receiver.assert_mem_place(); // no immediate unsized values
          break;
        } else {
          // Not there yet, search for the only non-ZST field.
          // (The rules for `DispatchFromDyn` ensure there's exactly one such field.)
          const [idx] = unwrap(receiver.layout.non_1zst_field(this), "not exactly one non-1-ZST field in a `DispatchFromDyn` type");
          const r = this.project_field(receiver, idx);
          if (r.$ === "Err") return r;
          receiver = r._0;
        }
      }

      // Obtain the underlying trait we are working on, and the adjusted receiver argument.
      // Doesn't have to be a `dyn Trait`, but the unsized tail must be `dyn Trait`.
      // (For that reason we also cannot use `unpack_dyn_trait`.)
      const receiver_tail = tcx.struct_tail_for_codegen(receiver_place.layout.ty, this.typing_env);
      const tail_kind = receiver_tail.kind();
      if (tail_kind.$ !== "Dynamic") {
        return span_bug(this.cur_span(), `dynamic call on non-\`dyn\` type ${receiver_tail.toString()}`);
      }
      const receiver_trait = tail_kind._0;
      assert(receiver_place.layout.is_unsized(), "assertion failed: receiver_place.layout.is_unsized()");

      // Get the required information from the vtable.
      const vptr = Scalar.to_pointer(MemPlaceMeta.unwrap_meta(receiver_place.meta()), this);
      const dyn_ty_r = this.get_ptr_vtable_ty(vptr, receiver_trait);
      if (dyn_ty_r.$ === "Err") return dyn_ty_r;
      const dyn_ty = dyn_ty_r._0;
      const adjusted_recv = receiver_place.ptr();

      // Now determine the actual method to call. Usually we use the easy way of just
      // looking up the method at index `idx`.
      const vtable_entries = this.vtable_entries(receiver_trait.principal(), dyn_ty);
      const entry = vtable_entries[idx];
      if (entry === undefined || entry.$ !== "Method") {
        // FIXME(fee1-dead) these could be variants of the UB info enum instead of this
        // throw_ub_format!("`dyn` call trying to call something that is not a method")
        return Err(
          InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: "`dyn` call trying to call something that is not a method" } }),
        );
      }
      const fn_inst = entry._0;
      // trace!("Virtual call dispatches to {fn_inst:#?}");
      // We can also do the lookup based on `def_id` and `dyn_ty`, and check that that
      // produces the same result.
      this.assert_virtual_instance_matches_concrete(dyn_ty, def_id, instance, fn_inst);

      // Adjust receiver argument. Layout can be any (thin) ptr.
      const receiver_ty = Ty.new_mut_ptr(this.tcx.tcx, dyn_ty);
      const receiver_layout = layout_of_(this, receiver_ty);
      if (receiver_layout.$ === "Err") return receiver_layout;
      args_[0] = {
        $: "Copy",
        _0: OpTy_from_ImmTy(ImmTy.from_immediate(Immediate_from_Scalar(Scalar.from_maybe_pointer(adjusted_recv, this)), receiver_layout._0)),
      };
      // trace!("Patched receiver operand to {:#?}", args[0]);
      // Need to also adjust the type in the ABI. Strangely, the layout there is actually
      // already fine! Just the type is bogus. This is due to what `force_thin_self_ptr`
      // does in `fn_abi_new_uncached`; supposedly, codegen relies on having the bogus
      // type, so we just patch this up locally.
      const caller_fn_abi_patched = clone_FnAbi(caller_fn_abi_);
      const arg0 = arg_abi_(unwrap(fn_abi_(caller_fn_abi_patched).args[0], "index out of bounds: the len is 0 but the index is 0"));
      arg0.layout = new abi_TyAndLayout(receiver_ty, arg0.layout.layout);

      // recurse with concrete function
      return this.init_fn_call({ $: "Instance", _0: fn_inst }, [caller_abi, caller_fn_abi_patched], args_, with_caller_location, destination, target, unwind);
    }
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/call.rs:954 assert_virtual_instance_matches_concrete
InterpCx.prototype.assert_virtual_instance_matches_concrete = function (this: InterpCx, dyn_ty: Ty, def_id: DefId, virtual_instance: Instance, concrete_instance: Instance): void {
  const tcx = this.tcx.deref();

  const trait_def_id = tcx.parent(def_id);
  const virtual_trait_ref = TraitRef.from_assoc(as_interner(tcx), trait_def_id, virtual_instance.args);
  const existential_trait_ref = ExistentialTraitRef.erase_self_ty(as_interner(tcx), virtual_trait_ref);
  const concrete_trait_ref = ExistentialTraitRef.with_self_ty(existential_trait_ref, as_interner(tcx), dyn_ty);

  // let _trace = enter_trace_span!(M, resolve::expect_resolve_for_vtable, ?def_id);
  const concrete_method = Instance.expect_resolve_for_vtable(
    tcx,
    this.typing_env,
    def_id,
    virtual_instance.args.rebase_onto(tcx, trait_def_id, concrete_trait_ref.args),
    this.cur_span(),
  );
  assert_eq(concrete_instance, concrete_method, (v) => debug_Instance(v, PLAIN), intern_key_eq);
};

/// Initiate a tail call to this function -- popping the current stack frame, pushing the new
/// stack frame and initializing the arguments.
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:983 init_fn_tail_call
InterpCx.prototype.init_fn_tail_call = function (
  this: InterpCx,
  fn_val: FnVal<never>,
  [caller_abi, caller_fn_abi]: [ExternAbi, FnAbi<Ty> | undefined],
  args: readonly FnArg[],
  with_caller_location: boolean,
): InterpResult {
  // trace!("init_fn_tail_call: {:#?}", fn_val);
  // This is the "canonical" implementation of tails calls,
  // a pop of the current stack frame, followed by a normal call
  // which pushes a new stack frame, with the return address from
  // the popped stack frame.
  //
  // Note that we cannot use `return_from_current_stack_frame`,
  // as that "executes" the goto to the return block, but we don't want to,
  // only the tail called function should return to the current return block.

  // The arguments need to all be copied since the current stack frame will be removed
  // before the callee even starts executing.
  // FIXME(explicit_tail_calls,#144855): does this match what codegen does?
  const args_ = args.map((fn_arg): FnArg => ({ $: "Copy", _0: FnArg.copy_fn_arg(fn_arg) }));
  // Remove the frame from the stack.
  const frame_r = this.pop_stack_frame_raw();
  if (frame_r.$ === "Err") return frame_r;
  const frame = frame_r._0;
  // Remember where this frame would have returned to.
  const return_cont = frame.return_cont_();
  if (return_cont.$ !== "Goto") {
    return bug("can't tailcall as root of the stack");
  }
  const { ret, unwind } = return_cont;
  // There's no return value to deal with! Instead, we forward the old return place
  // to the new function.
  // FIXME(explicit_tail_calls):
  //   we should check if both caller&callee can/n't unwind,
  //   see <https://github.com/rust-lang/rust/pull/113128#issuecomment-1614979803>

  // Now push the new stack frame.
  const r = this.init_fn_call(fn_val, [caller_abi, caller_fn_abi], args_, with_caller_location, frame.return_place_(), ret, unwind);
  if (r.$ === "Err") return r;

  // Finally, clear the local variables. Has to be done after pushing to support
  // non-scalar arguments.
  // FIXME(explicit_tail_calls,#144855): revisit this once codegen supports indirect
  // arguments, to ensure the semantics are compatible.
  const return_action = this.cleanup_stack_frame(/* unwinding */ false, frame);
  if (return_action.$ === "Err") return return_action;
  assert_eq(return_action._0, ReturnAction.Normal, (v) => v);

  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/call.rs:1037 init_drop_in_place_call
InterpCx.prototype.init_drop_in_place_call = function (this: InterpCx, place_: PlaceTy, instance_: Instance, target: BasicBlock, unwind: UnwindAction): InterpResult {
  // trace!("init_drop_in_place_call: {:?},\n  instance={:?}", place, instance);
  // We take the address of the object. This may well be unaligned, which is fine
  // for us here. However, unaligned accesses will probably make the actual drop
  // implementation fail -- a problem shared by rustc.
  const place_r = this.force_allocation(place_);
  if (place_r.$ === "Err") return place_r;

  // We behave a bit different from codegen here.
  // Codegen creates an `InstanceKind::Virtual` with index 0 (the slot of the drop method) and
  // then dispatches that to the normal call machinery. However, our call machinery currently
  // only supports calling `VtblEntry::Method`; it would choke on a `MetadataDropInPlace`. So
  // instead we do the virtual call stuff ourselves. It's easier here than in `eval_fn_call`
  // since we can just get a place of the underlying type and use `mplace_to_imm_ptr`.
  let place: MPlaceTy;
  const k = place_r._0.layout.ty.kind();
  if (k.$ === "Dynamic") {
    // Dropping a trait object. Need to find actual drop fn.
    const r = this.unpack_dyn_trait(place_r._0, k._0);
    if (r.$ === "Err") return r;
    place = r._0;
  } else {
    // debug_assert_eq!(
    //     instance,
    //     ty::Instance::resolve_drop_glue(*self.tcx, place.layout.ty)
    // );
    void instance_;
    place = place_r._0;
  }

  // let _trace = enter_trace_span!(M, resolve::resolve_drop_glue, ty = ?place.layout.ty);
  const instance = Instance.resolve_drop_glue(this.tcx.deref(), place.layout.ty);
  const fn_abi = this.fn_abi_of_instance_no_deduced_attrs(instance, RawList.empty<Ty>());
  if (fn_abi.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(fn_abi._0));

  const ref_ty = Ty.new_mut_ref(this.tcx.tcx, this.tcx.deref().lifetimes.re_erased, place.layout.ty);
  const arg = this.mplace_to_imm_ptr(place, ref_ty);
  if (arg.$ === "Err") return arg;

  const unit = layout_of_(this, this.tcx.deref().types.unit);
  if (unit.$ === "Err") return unit;
  const ret = MPlaceTy.fake_alloc_zst(unit._0);

  return this.init_fn_call(
    { $: "Instance", _0: instance },
    [ExternAbi.Rust, fn_abi._0],
    [{ $: "Copy", _0: OpTy_from_ImmTy(arg._0) }],
    false,
    PlaceTy_from_MPlaceTy(ret),
    target,
    unwind,
  );
};

/// Pops the current frame from the stack, copies the return value to the caller, deallocates
/// the memory for allocated locals, and jumps to an appropriate place.
///
/// If `unwinding` is `false`, then we are performing a normal return
/// from a function. In this case, we jump back into the frame of the caller,
/// and continue execution as normal.
///
/// If `unwinding` is `true`, then we are in the middle of a panic,
/// and need to unwind this frame. In this case, we jump to the
/// `cleanup` block for the function, which is responsible for running
/// `Drop` impls for any locals that have been initialized at this point.
/// The cleanup block ends with a special `Resume` terminator, which will
/// cause us to continue unwinding.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/call.rs:1106 return_from_current_stack_frame
InterpCx.prototype.return_from_current_stack_frame = function (this: InterpCx, unwinding: boolean): InterpResult {
  // info!(
  //     "popping stack frame ({})",
  //     if unwinding { "during unwinding" } else { "returning from function" }
  // );

  // Check `unwinding`.
  const loc = this.frame().loc;
  let is_cleanup: boolean;
  switch (loc.$) {
    case "Left":
      is_cleanup = unwrap(this.body().basic_blocks.deref()[loc._0.block]).is_cleanup;
      break;
    case "Right":
      is_cleanup = true;
      break;
  }
  assert_eq(unwinding, is_cleanup, (v) => `${v}`);
  if (unwinding && this.frame_idx() === 0) {
    // throw_ub_format!("unwinding past the topmost frame of the stack")
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: "unwinding past the topmost frame of the stack" } }));
  }

  // Get out the return value. Must happen *before* the frame is popped as we have to get the
  // local's value out.
  const return_op_r = this.local_to_op(RETURN_PLACE, undefined);
  if (return_op_r.$ === "Err") panic(`return place should always be live: ${debug_InterpErrorInfo(return_op_r._0, PLAIN)}`);
  const return_op = return_op_r._0;
  // Remove the frame from the stack.
  const frame_r = this.pop_stack_frame_raw();
  if (frame_r.$ === "Err") return frame_r;
  const frame = frame_r._0;
  // Copy the return value and remember the return continuation.
  if (!unwinding) {
    const r = this.copy_op_allow_transmute(return_op, frame.return_place_());
    if (r.$ === "Err") return r;
    // trace!("return value: {:?}", self.dump_place(frame.return_place()));
  }
  const return_cont = frame.return_cont_();
  // Finish popping the stack frame.
  const return_action_r = this.cleanup_stack_frame(unwinding, frame);
  if (return_action_r.$ === "Err") return return_action_r;
  // Jump to the next block.
  switch (return_action_r._0) {
    case "Normal":
      break;
    case "NoJump":
      // The hook already did everything.
      return interp_ok(undefined);
    case "NoCleanup":
      // If we are not doing cleanup, also skip everything else.
      assert(this.stack().length === 0, "only the topmost frame should ever be leaked");
      assert(!unwinding, "tried to skip cleanup during unwinding");
      // Don't jump anywhere.
      return interp_ok(undefined);
  }

  // Normal return, figure out where to jump.
  if (unwinding) {
    // Follow the unwind edge.
    switch (return_cont.$) {
      case "Goto":
        // This must be the very last thing that happens, since it can in fact push a new stack frame.
        return this.unwind_to_block(return_cont.unwind);
      case "Stop":
        return panic("encountered ReturnContinuation::Stop when unwinding!");
    }
  } else {
    // Follow the normal return edge.
    switch (return_cont.$) {
      case "Goto":
        return this.return_to_block(return_cont.ret);
      case "Stop":
        assert(this.stack().length === 0, "only the bottommost frame can have ReturnContinuation::Stop");
        return interp_ok(undefined);
    }
  }
};
