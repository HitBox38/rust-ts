// Port of compiler/rustc_type_ir/src/predicate_kind.rs (lane tyir-misc, sub-lane predicate). The types with their
// derived TypeVisitable / TypeFoldable impls are generated into predicate_kind.gen.ts (set rustc_ty of
// tools/codegen/types.ts, lane codegen-tyir); this file holds the two manual Debug impls.
// PORT: `write!(f, "{:?}", x)` formats `x` with fresh options (`PLAIN`); `x.fmt(f)` keeps `f` (tyir-kind decision 5).
import { debug_Term, debug_Ty } from "../rustc_middle/ty/mod.ts";
import { debug_DefId } from "../rustc_span/def_id.ts";
import { debug_Symbol } from "../rustc_span/symbol.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import {
  debug_CoercePredicate,
  debug_HostEffectClause,
  debug_NormalizesTo,
  debug_OutlivesClause,
  debug_ProjectionClause,
  debug_SubtypePredicate,
  debug_TraitClause,
} from "./predicate.ts";
import type { ClauseKind, PredicateKind } from "./predicate_kind.gen.ts";
import { debug_Const } from "./sty/consts.ts";
import { debug_Region } from "./sty/mod.ts";
import { debug_AliasTermKind } from "./term_kind.ts";

export * from "./predicate_kind.gen.ts";

// rustc: compiler/rustc_type_ir/src/predicate_kind.rs:111 fmt
export const debug_ClauseKind: Debug<ClauseKind> = (self, f) => {
  switch (self.$) {
    case "ConstArgHasType": {
      const ct = self._0;
      const ty = self._1;
      return `ConstArgHasType(${debug_Const(ct, PLAIN)}, ${debug_Ty(ty, PLAIN)})`;
    }
    case "HostEffect":
      return debug_HostEffectClause(self._0, f);
    case "Trait":
      return debug_TraitClause(self._0, f);
    case "RegionOutlives":
      return debug_OutlivesClause(self._0, f, debug_Region);
    case "TypeOutlives":
      return debug_OutlivesClause(self._0, f, debug_Ty);
    case "Projection":
      return debug_ProjectionClause(self._0, f);
    case "WellFormed":
      return `WellFormed(${debug_Term(self._0, PLAIN)})`;
    case "ConstEvaluatable": {
      const ct = self._0;
      return `ConstEvaluatable(${debug_Const(ct, PLAIN)})`;
    }
    case "UnstableFeature": {
      const feature_name = self._0;
      return `UnstableFeature(${debug_Symbol(feature_name, PLAIN)})`;
    }
  }
};

// rustc: compiler/rustc_type_ir/src/predicate_kind.rs:131 fmt
export const debug_PredicateKind: Debug<PredicateKind> = (self, f) => {
  switch (self.$) {
    case "Clause":
      return debug_ClauseKind(self._0, f);
    case "Subtype":
      return debug_SubtypePredicate(self._0, f);
    case "Coerce":
      return debug_CoercePredicate(self._0, f);
    case "DynCompatible": {
      const trait_def_id = self._0;
      return `DynCompatible(${debug_DefId(trait_def_id, PLAIN)})`;
    }
    case "ConstEquate": {
      const c1 = self._0;
      const c2 = self._1;
      return `ConstEquate(${debug_Const(c1, PLAIN)}, ${debug_Const(c2, PLAIN)})`;
    }
    case "Ambiguous":
      return "Ambiguous";
    case "NormalizesTo":
      return debug_NormalizesTo(self._0, f, debug_AliasTermKind);
  }
};
