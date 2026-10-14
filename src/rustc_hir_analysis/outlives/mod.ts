// Port of compiler/rustc_hir_analysis/src/outlives/mod.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `tcx.arena.alloc_from_iter(..)` is the array itself.
// - `ty::ClauseKind::X(..).upcast(tcx)` is `Clause_upcast_from_ClauseKind(..)` (rustc_middle ty/predicate.ts header).
// - The `inferred_outlives_of` query value is `readonly [unknown, Span][]` in queries.gen.ts and `CrateClausesMap` holds
//   readonly tuples; the values are cast to `readonly [Clause, Span][]`.
// Init order: top-level code here touches only other crates.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { CrateClausesMap } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { DefIdMap, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { infer_clauses } from "./implicit_infer.ts";

// pub(crate) mod dump;
export * as dump from "./dump.ts";
// mod explicit;
export * as explicit from "./explicit.ts";
// mod implicit_infer;
export * as implicit_infer from "./implicit_infer.ts";
// mod utils;
export * as utils from "./utils.ts";

// rustc: compiler/rustc_hir_analysis/src/outlives/mod.rs:11 inferred_outlives_of
export function inferred_outlives_of(tcx: TyCtxt, item_def_id: LocalDefId): readonly [Clause, Span][] {
  const def_kind = tcx.def_kind(item_def_id);
  if (def_kind.$ === "Struct" || def_kind.$ === "Enum" || def_kind.$ === "Union") {
    const crate_map = tcx.inferred_outlives_crate(null) as CrateClausesMap;
    return (crate_map.clauses.get(LocalDefId.to_def_id(item_def_id)) ?? []) as readonly [Clause, Span][];
  } else if (def_kind.$ === "TyAlias" && tcx.type_alias_is_checked(item_def_id)) {
    const crate_map = tcx.inferred_outlives_crate(null) as CrateClausesMap;
    return (crate_map.clauses.get(LocalDefId.to_def_id(item_def_id)) ?? []) as readonly [Clause, Span][];
  } else if (def_kind.$ === "AnonConst" && tcx.features().generic_const_exprs()) {
    const id = tcx.local_def_id_to_hir_id(item_def_id);
    if (tcx.hir_opt_const_param_default_param_def_id(id) !== undefined) {
      // In `generics_of` we set the generics' parent to be our parent's parent which means that
      // we lose out on the clauses of our actual parent if we dont return those clauses here.
      // (See comment in `generics_of` for more information on why the parent shenanigans is necessary)
      //
      // struct Foo<'a, 'b, const N: usize = { ... }>(&'a &'b ());
      //        ^^^                          ^^^^^^^ the def id we are calling
      //        ^^^                                  inferred_outlives_of on
      //        parent item we dont have set as the
      //        parent of generics returned by `generics_of`
      //
      // In the above code we want the anon const to have clauses in its param env for `'b: 'a`
      const item_def_id = tcx.hir_get_parent_item(id);
      // In the above code example we would be calling `inferred_outlives_of(Foo)` here
      return tcx.inferred_outlives_of(item_def_id) as readonly [Clause, Span][];
    } else {
      return [];
    }
  } else {
    return [];
  }
}

// rustc: compiler/rustc_hir_analysis/src/outlives/mod.rs:49 inferred_outlives_crate
export function inferred_outlives_crate(tcx: TyCtxt, _: null): CrateClausesMap {
  // Compute a map from each ADT (struct/enum/union) and lazy type alias to
  // the **explicit** outlives clauses (`T: 'a`, `'a: 'b`) that the user wrote.
  // Typically there won't be many of these, except in older code where
  // they were mandatory. Nonetheless, we have to ensure that every such
  // clause is satisfied, so they form a kind of base set of requirements
  // for the type.

  // Compute the inferred clauses
  const global_inferred_outlives = infer_clauses(tcx);

  // Convert the inferred clauses into the "collected" form the
  // global data structure expects.
  //
  // FIXME -- consider correcting impedance mismatch in some way,
  // probably by updating the global data structure.
  const clauses = new DefIdMap<readonly (readonly [Clause, Span])[]>();
  for (const [def_id, set] of global_inferred_outlives) {
    const clauses_: (readonly [Clause, Span])[] = [];
    for (const [clause, span] of EarlyBinder.skip_binder(EarlyBinder.as_ref(set))) {
      const [arg1, region2] = [clause._0, clause._1];
      const k = GenericArg.kind(arg1);
      switch (k.$) {
        case "Type": {
          const ty1 = k._0;
          clauses_.push([Clause_upcast_from_ClauseKind({ $: "TypeOutlives", _0: { _0: ty1, _1: region2 } }, tcx), span]);
          break;
        }
        case "Lifetime": {
          const region1 = k._0;
          clauses_.push([Clause_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: region1, _1: region2 } }, tcx), span]);
          break;
        }
        case "Const":
          // Generic consts don't impose any constraints.
          break;
      }
    }
    clauses.set(def_id, clauses_);
  }

  return { clauses };
}
