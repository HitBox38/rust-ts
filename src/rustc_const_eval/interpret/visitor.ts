// Port of compiler/rustc_const_eval/src/interpret/visitor.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-ops; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type VariantIdx } from "../../rustc_abi/lib.ts";
import type { InterpCx } from "./eval_context.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { unported } from "../../std/panic.ts";
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

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:25 read_discriminant (lane interp-ops)
  read_discriminant(v: V): InterpResult<VariantIdx> {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::read_discriminant");
  }

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:32 visit_value (lane interp-ops)
  visit_value(v: V): InterpResult {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::visit_value");
  }

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:37 visit_union (lane interp-ops)
  visit_union(_v: V, _fields: number): InterpResult {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::visit_union");
  }

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:44 visit_box (lane interp-ops)
  visit_box(_box_ty: Ty, _v: V): InterpResult {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::visit_box");
  }

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:49 visit_variantless (lane interp-ops)
  visit_variantless(_v: V): InterpResult {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::visit_variantless");
  }

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:59 visit_field (lane interp-ops)
  visit_field(_old_val: V, _field: number, new_val: V): InterpResult {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::visit_field");
  }

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:71 visit_variant (lane interp-ops)
  visit_variant(_old_val: V, _variant: VariantIdx, new_val: V): InterpResult {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::visit_variant");
  }

  // stub: compiler/rustc_const_eval/src/interpret/visitor.rs:81 walk_value (lane interp-ops)
  walk_value(v: V): InterpResult {
    return unported("rustc_const_eval::interpret::visitor::ValueVisitor::walk_value");
  }
}
