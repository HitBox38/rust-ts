// Port of compiler/rustc_infer/src/infer/canonical/mod.rs (lane infer-canonical-outlives).
//
//! **Canonicalization** is the key to constructing a query in the
//! middle of type inference. Ordinarily, it is not possible to store
//! types from type inference in query keys, because they contain
//! references to inference variables whose lifetimes are too short
//! and so forth. Canonicalizing a value T1 using `canonicalize_query`
//! produces two things:
//!
//! - a value T2 where each unbound inference variable has been
//!   replaced with a **canonical variable**;
//! - a map M (of type `CanonicalVarValues`) from those canonical
//!   variables back to the original.
//!
//! We can then do queries using T2. These will give back constraints
//! on the canonical variables which can be translated, using the map
//! M, into constraints in our source context. This process of
//! translating the results back is done by the
//! `instantiate_query_result` method.
//!
//! For a more detailed look at what is happening here, check
//! out the [chapter in the rustc dev guide][c].
//!
//! [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html
//
// PORT: `pub use instantiate::CanonicalExt;` is the re-export of the two free fns; `pub use rustc_middle::infer::canonical::*`
// re-exports that module. `mod canonicalizer; mod instantiate;` are loaded by the crate root (lib.ts); `pub mod
// query_response` is re-exported as a namespace.
// PORT: `IndexVec<UniverseIndex, _>` is an array indexed by the universe's number. `CanonicalVarValues::instantiate` takes
// the `Interner` view of the `TyCtxt` (`as_interner`, as rustc_next_trait_solver).
import type { Canonical, CanonicalVarKind, CanonicalVarValues } from "../../../rustc_middle/infer/canonical.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../../../rustc_type_ir/binder.ts";
import { CanonicalVarValues as CanonicalVarValuesC } from "../../../rustc_type_ir/canonical.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { BoundVar, UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { as_interner } from "../../../rustc_type_ir/predicate.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { panic, unreachable } from "../../../std/panic.ts";
import { InferCtxt } from "../../decls.ts";
import { Canonical_instantiate } from "./instantiate.ts";

export { Canonical_instantiate, Canonical_instantiate_projected } from "./instantiate.ts";
export * from "../../../rustc_middle/infer/canonical.ts";
export * as query_response from "./query_response.ts";

/// Creates an instantiation S for the canonical value with fresh inference
/// variables and placeholders then applies it to the canonical value.
/// Returns both the instantiated result *and* the instantiation S.
///
/// This can be invoked as part of constructing an
/// inference context at the start of a query (see
/// `InferCtxtBuilder::build_with_canonical`). It basically
/// brings the canonical value "into scope" within your new infcx.
///
/// At the end of processing, the instantiation S (once
/// canonicalized) then represents the values that you computed
/// for each of the canonical inputs to your query.
// rustc: compiler/rustc_infer/src/infer/canonical/mod.rs:49 instantiate_canonical
InferCtxt.prototype.instantiate_canonical = function <T>(
  this: InferCtxt,
  span: Span,
  canonical: Canonical<T>,
  d_T: TypeFoldable<T>,
): [T, CanonicalVarValues] {
  // For each universe that is referred to in the incoming
  // query, create a universe in our local inference context. In
  // practice, as of this writing, all queries have no universes
  // in them, so this code has no effect, but it is looking
  // forward to the day when we *do* want to carry universes
  // through into queries.
  //
  // Instantiate the root-universe content into the current universe,
  // and create fresh universes for the higher universes.
  const universes: UniverseIndex[] = [this.universe()];
  for (let i = 1; i <= UniverseIndex.as_u32(canonical.max_universe); i++) {
    universes.push(this.create_next_universe());
  }

  const var_values = CanonicalVarValuesC.instantiate(as_interner(this.tcx), canonical.var_kinds, (var_values, info) =>
    this.instantiate_canonical_var(span, info, var_values, (ui) => universe_at(universes, ui)),
  );
  const result = Canonical_instantiate(canonical, this.tcx, var_values, d_T);
  return [result, var_values];
};

/** `universes[ui]` (`IndexVec` indexing: core's bounds-check panic). */
function universe_at(universes: readonly UniverseIndex[], ui: UniverseIndex): UniverseIndex {
  const i = UniverseIndex.as_usize(ui);
  if (i >= universes.length) {
    return panic(`index out of bounds: the len is ${universes.length} but the index is ${i}`);
  }
  return universes[i]!;
}

/// Given the "info" about a canonical variable, creates a fresh
/// variable for it. If this is an existentially quantified
/// variable, then you'll get a new inference variable; if it is a
/// universally quantified variable, you get a placeholder.
///
/// FIXME(-Znext-solver): This is public because it's used by the
/// new trait solver which has a different canonicalization routine.
/// We should somehow deduplicate all of this.
// rustc: compiler/rustc_infer/src/infer/canonical/mod.rs:86 instantiate_canonical_var
InferCtxt.prototype.instantiate_canonical_var = function (
  this: InferCtxt,
  span: Span,
  kind: CanonicalVarKind,
  previous_var_values: readonly GenericArg[],
  universe_map: (_1: UniverseIndex) => UniverseIndex,
): GenericArg {
  switch (kind.$) {
    case "Ty": {
      const { ui, sub_root } = kind;
      const vid = this.next_ty_vid_in_universe(span, universe_map(ui));
      // If this inference variable is related to an earlier variable
      // via subtyping, we need to add that info to the inference context.
      // PORT: `previous_var_values.get(sub_root.as_usize())`.
      const prev = previous_var_values[BoundVar.as_usize(sub_root)];
      if (prev !== undefined) {
        const pk = GenericArg.expect_ty(prev).kind();
        if (pk.$ === "Infer" && pk._0.$ === "TyVar") {
          const sub_root = pk._0._0;
          this.sub_unify_ty_vids_raw(vid, sub_root);
        } else {
          unreachable();
        }
      }
      return Ty.new_var(this.tcx, vid);
    }

    case "Int":
      return this.next_int_var();

    case "Float":
      // There is no HirId available to pass as a lint_id.
      return this.next_float_var(span, undefined);

    case "PlaceholderTy": {
      const { universe, bound } = kind._0;
      const universe_mapped = universe_map(universe);
      const placeholder_mapped = PlaceholderType.new(universe_mapped, bound);
      return Ty.new_placeholder(this.tcx, placeholder_mapped);
    }

    case "Region":
      return this.next_region_var_in_universe({ $: "Misc", _0: span }, universe_map(kind._0));

    case "PlaceholderRegion": {
      const { universe, bound } = kind._0;
      const universe_mapped = universe_map(universe);
      const placeholder_mapped = PlaceholderRegion.new(universe_mapped, bound);
      return Region.new_placeholder(this.tcx, placeholder_mapped);
    }

    case "Const":
      return this.next_const_var_in_universe(span, universe_map(kind._0));
    case "PlaceholderConst": {
      const { universe, bound } = kind._0;
      const universe_mapped = universe_map(universe);
      const placeholder_mapped = PlaceholderConst.new(universe_mapped, bound);
      return Const.new_placeholder(this.tcx, placeholder_mapped);
    }
  }
};
