// Contract stub for compiler/rustc_middle/src/ty/context/impl_interner.rs (lane ty-contract; the file belongs to lane ty-ctxt).
//
// The methods this file defines upstream on `TyCtxt` are declared in ty/decls.ts (`// ty/context/impl_interner.rs:<line>`
// lines). Until they are ported, the calls below install `unported(..)` placeholders for them. To fill one:
// assign `<Class>.prototype.<name> = function (this: <Class>, ..) { .. }` (a static: `<Class>.<name> = function ..`)
// with the `// rustc:` marker above it, in upstream order, and delete the name from its list (the call when the list
// is empty). The free fns, types and other impls of the upstream file are not stubbed: port them here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code may touch only the classes it imports, never another extension module.
import { TyCtxt } from "../context.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import type { BoundRegion, BoundVar, DebruijnIndex, RegionVid } from "../../../rustc_type_ir/decls.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";

// PORT: `impl Interner for TyCtxt`: the methods are `TyCtxt.prototype` methods (declared in ty/decls.ts); the
// six pre-interned-region helpers below are ported (lane ty-contract) so `Region::new_*` can be built on them.
// PORT: `RegionVid::as_usize` / `DebruijnIndex::as_usize` / `BoundVar::as_usize` are the identity on the branded
// numbers; `slice.get(i)` is `arr[i]` (`undefined` = `None`).

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:686 get_anon_re_bounds_lifetime
TyCtxt.prototype.get_anon_re_bounds_lifetime = function (this: TyCtxt, idx: number, var_idx: number): Region | undefined {
  const inner = this.lifetimes.anon_re_bounds[idx];
  if (inner !== undefined) {
    return inner[var_idx];
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:694 get_anon_re_canonical_bounds_lifetime
TyCtxt.prototype.get_anon_re_canonical_bounds_lifetime = function (this: TyCtxt, idx: number): Region | undefined {
  return this.lifetimes.anon_re_canonical_bounds[idx];
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:698 get_re_static_lifetime
TyCtxt.prototype.get_re_static_lifetime = function (this: TyCtxt): Region {
  return this.lifetimes.re_static;
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:702 intern_re_var
TyCtxt.prototype.intern_re_var = function (this: TyCtxt, rv: RegionVid): Region {
  // Use a pre-interned one when possible.
  return this.lifetimes.re_vars[rv] ?? this.intern_region({ $: "ReVar", _0: rv });
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:715 intern_bound_region
TyCtxt.prototype.intern_bound_region = function (this: TyCtxt, debruijn: DebruijnIndex, bound_region: BoundRegion): Region {
  // Use a pre-interned one when possible.
  if (bound_region.kind.$ === "Anon") {
    const inner = this.lifetimes.anon_re_bounds[debruijn];
    const re = inner === undefined ? undefined : inner[bound_region.var];
    if (re !== undefined) return re;
  }
  return this.intern_region({ $: "ReBound", _0: { $: "Bound", _0: debruijn }, _1: bound_region });
};

// rustc: compiler/rustc_middle/src/ty/context/impl_interner.rs:731 intern_canonical_bound
TyCtxt.prototype.intern_canonical_bound = function (this: TyCtxt, var_: BoundVar): Region {
  // Use a pre-interned one when possible.
  const re = this.lifetimes.anon_re_canonical_bounds[var_];
  if (re !== undefined) {
    return re;
  } else {
    return this.intern_region({ $: "ReBound", _0: { $: "Canonical" }, _1: { var: var_, kind: { $: "Anon" } } });
  }
};


unported_methods(TyCtxt.prototype, "rustc_middle::ty::context::impl_interner::TyCtxt", [
  "with_cached_task",
  "mk_tracked",
  "get_tracked",
  "with_global_cache",
  "with_canonical_param_env_cache",
  "assert_evaluation_is_concurrent",
  "ir_is_direct_const",
  "ir_const_of_item",
  "trait_ref_and_own_args_for_alias",
  "debug_assert_existential_args_compatible",
  "projection_parent",
  "impl_or_trait_assoc_term_parent",
  "inherent_alias_term_parent",
  "ir_recursion_limit",
  "ir_clauses_of",
  "own_clauses_of",
  "supertrait_def_ids",
  "impl_is_const",
  "fn_is_const",
  "closure_is_const",
  "alias_has_const_conditions",
  "ir_const_conditions",
  "ir_explicit_implied_const_bounds",
  "has_target_features",
  "require_projection_lang_item",
  "require_trait_lang_item",
  "require_adt_lang_item",
  "is_projection_lang_item",
  "is_trait_lang_item",
  "is_adt_lang_item",
  "as_projection_lang_item",
  "as_trait_lang_item",
  "as_adt_lang_item",
  "associated_type_def_ids",
  "ir_for_each_relevant_impl",
  "for_each_blanket_impl",
  "has_item_definition",
  "impl_specializes",
  "impl_is_default",
  "is_fully_generic_for_reflection",
  "trait_is_marker",
  "trait_is_dyn_compatible",
  "trait_is_fundamental",
  "trait_is_unsafe",
  "delay_bug",
  "span_delayed_bug",
  "opaque_types_and_coroutines_defined_by",
  "mk_probe",
  "mk_canonical_input",
  "ir_evaluate_root_goal_for_proof_tree_raw",
]);
