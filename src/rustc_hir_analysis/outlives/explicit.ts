// Port of compiler/rustc_hir_analysis/src/outlives/explicit.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `FxIndexMap<DefId, _>` is a `DefIdMap` (rustc_span def_id.ts: a `KeyedMap`, insertion-ordered as `IndexMap`).
// - `self.map.entry(def_id).or_insert_with(|| ..)` is a `get`, then the closure body and a `set` when absent.
// - `#[derive(Debug)]` on `ExplicitClausesMap` is only read by tracing; it is not ported.
// Init order: top-level code here touches only other crates.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { type DefId, DefIdMap } from "../../rustc_span/def_id.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { insert_outlives_clause, new_RequiredClauses, type RequiredClauses } from "./utils.ts";

// #[derive(Debug)]
// rustc-type: compiler/rustc_hir_analysis/src/outlives/explicit.rs:8 ExplicitClausesMap
export class ExplicitClausesMap {
  constructor(public map: DefIdMap<EarlyBinder<RequiredClauses>>) {}

  // rustc: compiler/rustc_hir_analysis/src/outlives/explicit.rs:13 new
  static new(): ExplicitClausesMap {
    return new ExplicitClausesMap(new DefIdMap());
  }

  // rustc: compiler/rustc_hir_analysis/src/outlives/explicit.rs:17 explicit_clauses_of
  explicit_clauses_of(tcx: TyCtxt, def_id: DefId): EarlyBinder<RequiredClauses> {
    const existing = this.map.get(def_id);
    if (existing !== undefined) return existing;
    let gen_clauses: GenericClauses;
    if (def_id.is_local()) {
      gen_clauses = tcx.explicit_clauses_of(def_id) as GenericClauses;
    } else {
      gen_clauses = tcx.clauses_of(def_id) as GenericClauses;
    }
    const required_clauses = new_RequiredClauses();

    // Process clauses and convert to `RequiredClauses` entry, see below.
    for (const [clause, span] of gen_clauses.clauses) {
      const k = Binder.skip_binder(clause.kind());
      switch (k.$) {
        case "TypeOutlives": {
          const [ty, reg] = [k._0._0, k._0._1];
          insert_outlives_clause(tcx, GenericArg.from_Ty(ty), reg, span, required_clauses);
          break;
        }

        case "RegionOutlives": {
          const [reg1, reg2] = [k._0._0, k._0._1];
          insert_outlives_clause(tcx, GenericArg.from_Region(reg1), reg2, span, required_clauses);
          break;
        }
        case "Trait":
        case "Projection":
        case "ConstArgHasType":
        case "WellFormed":
        case "ConstEvaluatable":
        case "UnstableFeature":
        case "HostEffect":
          break;
      }
    }

    const value = EarlyBinder.bind_iter(required_clauses);
    this.map.set(def_id, value);
    return value;
  }
}
