// Port of compiler/rustc_const_eval/src/interpret/visitor.rs (declared by lane interp-contract, filled by lane interp-ops).
//! Visitor for a run-time value with a given layout: Traverse enums, structs and other compound
//! types until we arrive at the leaves, with custom handling for primitive types.
import { FieldIdx, type VariantIdx } from "../../rustc_abi/lib.ts";
import type { InterpCx } from "./eval_context.ts";
import { type InterpResult, InterpErrorInfo_from_InterpErrorKind, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { Err } from "../../std/result.ts";
import type { MPlaceTy } from "./place.gen.ts";
import type { Projectable } from "./projection.ts";

/// How to traverse a value and what to do when we are at the leaves.
// pub trait ValueVisitor<'tcx, M: Machine<'tcx>>: Sized
// PORT: an interface over the associated type `V` (`V: Projectable + From<MPlaceTy>`); `V::from(mplace)` is the member
// `V_from_MPlaceTy`. The provided methods are the base class `ValueVisitor_provided` (PORTING §8), which implementors
// (validity.ts's `ValidityVisitor`) extend.
export interface ValueVisitor<V extends Projectable<V>> {
  /** `<Self::V as From<MPlaceTy>>::from` */
  V_from_MPlaceTy(mplace: MPlaceTy): V;

  /// The visitor must have an `InterpCx` in it.
  // PORT: `ecx()` is `ecx_()` (clash with the implementors' field `ecx`; precedent `tcx_()`).
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:21 ecx
  ecx_(): InterpCx;

  /// `read_discriminant` can be hooked for better error messages.
  read_discriminant(v: V): InterpResult<VariantIdx>; // (provided)

  // Recursive actions, ready to be overloaded.
  /// Visits the given value, dispatching as appropriate to more specialized visitors.
  visit_value(v: V): InterpResult; // (provided)
  /// Visits the given value as a union. No automatic recursion can happen here.
  visit_union(_v: V, _fields: number): InterpResult; // (provided)
  /// Visits the given value as the pointer of a `Box`. There is nothing to recurse into.
  /// The type of `v` will be a raw pointer to `T`, but this is a field of `Box<T>` and the
  /// pointee type is the actual `T`. `box_ty` provides the full type of the `Box` itself.
  visit_box(_box_ty: Ty, _v: V): InterpResult; // (provided)
  /// Visits the given type after it has been found to have no variants.
  visit_variantless(_v: V): InterpResult; // (provided)

  /// Called each time we recurse down to a field of a "product-like" aggregate
  /// (structs, tuples, arrays and the like, but not enums), passing in old (outer)
  /// and new (inner) value.
  /// This gives the visitor the chance to track the stack of nested fields that
  /// we are descending through.
  visit_field(_old_val: V, _field: number, new_val: V): InterpResult; // (provided)
  /// Called when recursing into an enum variant.
  /// This gives the visitor the chance to track the stack of nested fields that
  /// we are descending through.
  visit_variant(_old_val: V, _variant: VariantIdx, new_val: V): InterpResult; // (provided)

  /// Traversal logic; should not be overloaded.
  walk_value(v: V): InterpResult; // (provided)
}

/** PORT: the provided methods of `ValueVisitor` (PORTING §8): a base class of the implementors. */
export abstract class ValueVisitor_provided<V extends Projectable<V>> implements ValueVisitor<V> {
  abstract V_from_MPlaceTy(mplace: MPlaceTy): V;
  abstract ecx_(): InterpCx;

  /// `read_discriminant` can be hooked for better error messages.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:25 read_discriminant
  read_discriminant(v: V): InterpResult<VariantIdx> {
    const op = v.to_op(this.ecx_());
    if (op.$ === "Err") return op;
    return this.ecx_().read_discriminant(op._0);
  }

  // Recursive actions, ready to be overloaded.
  /// Visits the given value, dispatching as appropriate to more specialized visitors.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:32 visit_value
  visit_value(v: V): InterpResult {
    return this.walk_value(v);
  }
  /// Visits the given value as a union. No automatic recursion can happen here.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:37 visit_union
  visit_union(_v: V, _fields: number): InterpResult {
    return interp_ok(undefined);
  }
  /// Visits the given value as the pointer of a `Box`. There is nothing to recurse into.
  /// The type of `v` will be a raw pointer to `T`, but this is a field of `Box<T>` and the
  /// pointee type is the actual `T`. `box_ty` provides the full type of the `Box` itself.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:44 visit_box
  visit_box(_box_ty: Ty, _v: V): InterpResult {
    return interp_ok(undefined);
  }
  /// Visits the given type after it has been found to have no variants.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:49 visit_variantless
  visit_variantless(_v: V): InterpResult {
    return interp_ok(undefined);
  }

  /// Called each time we recurse down to a field of a "product-like" aggregate
  /// (structs, tuples, arrays and the like, but not enums), passing in old (outer)
  /// and new (inner) value.
  /// This gives the visitor the chance to track the stack of nested fields that
  /// we are descending through.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:59 visit_field
  visit_field(_old_val: V, _field: number, new_val: V): InterpResult {
    return this.visit_value(new_val);
  }
  /// Called when recursing into an enum variant.
  /// This gives the visitor the chance to track the stack of nested fields that
  /// we are descending through.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:71 visit_variant
  visit_variant(_old_val: V, _variant: VariantIdx, new_val: V): InterpResult {
    return this.visit_value(new_val);
  }

  /// Traversal logic; should not be overloaded.
  // rustc: compiler/rustc_const_eval/src/interpret/visitor.rs:81 walk_value
  walk_value(v: V): InterpResult {
    const ty = v.layout_().ty;
    // trace!("walk_value: type: {ty}");

    // Special treatment for special types, where the (static) layout is not sufficient.
    const kind = ty.kind();
    switch (kind.$) {
      // If it is a trait object, switch to the real type that was used to create it.
      case "Dynamic": {
        const data = kind._0;
        // Dyn types. This is unsized, and the actual dynamic type of the data is given by the
        // vtable stored in the place metadata.
        // unsized values are never immediate, so we can assert_mem_place
        const op = v.to_op(this.ecx_());
        if (op.$ === "Err") return op;
        const dest = op._0.assert_mem_place();
        const inner_mplace = this.ecx_().unpack_dyn_trait(dest, data);
        if (inner_mplace.$ === "Err") return inner_mplace;
        // trace!("walk_value: dyn object layout: {:#?}", inner_mplace.layout);
        // recurse with the inner type
        return this.visit_field(v, 0, this.V_from_MPlaceTy(inner_mplace._0));
      }
      // Slices do not need special handling here: they have `Array` field
      // placement with length 0, so we enter the `Array` case below which
      // indirectly uses the metadata to determine the actual length.

      // However, `Box`... let's talk about `Box`.
      case "Adt": {
        if (!kind._0.is_box()) break;
        // `Box` is a hybrid primitive-library-defined type that one the one hand is
        // a dereferenceable pointer, on the other hand has *basically arbitrary
        // user-defined layout* since the user controls the 'allocator' field. So it
        // cannot be treated like a normal pointer, since it does not fit into an
        // `Immediate`. Yeah, it is quite terrible. But many visitors want to do
        // something with "all boxed pointers", so we handle this mess for them.
        //
        // When we hit a `Box`, we do not do the usual field recursion; instead,
        // we (a) call `visit_box` on the pointer value, and (b) recurse on the
        // allocator field. We also assert tons of things to ensure we do not miss
        // any other fields.

        const r = this.ecx_().project_to_ptr_in_box(v);
        if (r.$ === "Err") return r;
        const [raw_ptr, alloc] = r._0;

        // Hand the actual pointer to the visitor.
        const b = this.visit_box(ty, raw_ptr);
        if (b.$ === "Err") return b;

        // The second `Box` field is the allocator, which we recursively check for validity
        // like in regular structs.
        const f = this.visit_field(v, 1, alloc);
        if (f.$ === "Err") return f;

        // We visited all parts of this one.
        return interp_ok(undefined);
      }

      // Non-normalized types should never show up here.
      case "Param":
      case "Alias":
      case "Bound":
      case "Placeholder":
      case "Infer":
      case "Error":
        // throw_inval!(TooGeneric)
        return Err(InterpErrorInfo_from_InterpErrorKind({ $: "InvalidProgram", _0: { $: "TooGeneric" } }));

      // The rest is handled below.
      default:
        break;
    }

    // Visit the fields of this value.
    const fields = v.layout_().fields;
    switch (fields.$) {
      case "Primitive":
        break;
      case "Union": {
        const r = this.visit_union(v, fields._0);
        if (r.$ === "Err") return r;
        break;
      }
      case "Arbitrary": {
        for (const idx of fields.in_memory_order) {
          const field = this.ecx_().project_field(v, idx);
          if (field.$ === "Err") return field;
          const r = this.visit_field(v, FieldIdx.as_usize(idx), field._0);
          if (r.$ === "Err") return r;
        }
        break;
      }
      case "Array": {
        const iter_r = this.ecx_().project_array_fields(v);
        if (iter_r.$ === "Err") return iter_r;
        const iter = iter_r._0;
        for (;;) {
          const next = iter.next(this.ecx_());
          if (next.$ === "Err") return next;
          if (next._0 === undefined) break;
          const [idx, field] = next._0;
          // `idx.try_into().unwrap()` (u64 -> usize)
          const r = this.visit_field(v, Number(idx), field);
          if (r.$ === "Err") return r;
        }
        break;
      }
    }

    const variants = v.layout_().variants;
    switch (variants.$) {
      // If this is a multi-variant layout, find the right variant and proceed
      // with *its* fields.
      case "Multiple": {
        const idx = this.read_discriminant(v);
        if (idx.$ === "Err") return idx;
        // There are 3 cases where downcasts can turn a Scalar/ScalarPair into a different ABI which
        // could be a problem for `ImmTy` (see layout_sanity_check):
        // - variant.size == Size::ZERO: works fine because `ImmTy::offset` has a special case for
        //   zero-sized layouts.
        // - variant.fields.count() == 0: works fine because `ImmTy::offset` has a special case for
        //   zero-field aggregates.
        // - variant.abi.is_uninhabited(): triggers UB in `read_discriminant` so we never get here.
        const inner = this.ecx_().project_downcast(v, idx._0);
        if (inner.$ === "Err") return inner;
        // trace!("walk_value: variant layout: {:#?}", inner.layout());
        // recurse with the inner type
        const r = this.visit_variant(v, idx._0, inner._0);
        if (r.$ === "Err") return r;
        break;
      }
      // For single-variant layouts, we already did everything there is to do.
      case "Single":
        break;
      // Non-variant layouts need special treatment by the visitor.
      case "Empty": {
        const r = this.visit_variantless(v);
        if (r.$ === "Err") return r;
        break;
      }
    }

    return interp_ok(undefined);
  }
}
