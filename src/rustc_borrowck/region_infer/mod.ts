// Port of compiler/rustc_borrowck/src/region_infer/mod.rs (lane borrowck-contract: declarations; filled by lane bck-regions-a, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `pub(crate) use region_context::*;` is not re-exported here: region_context.ts assigns prototypes of
// region_context.gen.ts's classes at load, and a re-export would let the generated modules that import this module
// (constraints / handle_placeholders / region_errors / type_check) evaluate it mid-cycle (init-order rule, lib.ts).
// Import `RegionInferenceContext` & co. from ./region_context.ts.
// PORT: `mod dump_mir; mod graphviz; pub(crate) mod opaque_types; mod region_context; mod reverse_sccs; pub(crate) mod
// values;` are loaded by the crate root (lib.ts), not imported here.
// PORT: `Representative` has no unit variant, so the generator emits no companion; its methods live on a hand
// companion `Representative` typed by `Representative_methods` (`new` is a property: `new(..)` in an interface would be a
// construct signature).
import type { BorrowckInferCtxt } from "../lib.gen.ts";
import type { OutlivesConstraint } from "../constraints/mod.gen.ts";
import { ConstraintSccIndex } from "../constraints/mod.ts";
import { RegionCtxt } from "../renumber.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { debug_GenericKind, type GenericKind, type VerifyBound } from "../../rustc_infer/infer/region_constraints/mod.ts";
import { debug_VerifyIfEq } from "../../rustc_infer/infer/region_constraints/mod.gen.ts";
import { ObligationCause, ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import { CRATE_DEF_ID } from "../../rustc_span/def_id.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { debug_Binder } from "../../rustc_type_ir/binder.ts";
import { debug_RegionVid, type RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { debug_Region } from "../../rustc_type_ir/sty/mod.ts";
import { type Debug, type Fmt, PLAIN } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import * as gen from "./mod.gen.ts";
import { BestBlame, type ConstraintSccs, type RegionDefinition, type TypeTest } from "./mod.gen.ts";

export * from "./mod.gen.ts";

export interface Representative_methods {
  // mod.rs:41
  rvid(self: Representative): RegionVid;
  // mod.rs:49
  new: (r: RegionVid, definition: RegionDefinition) => Representative;
}
export type Representative = gen.Representative;
export const Representative = {} as Representative_methods;

// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:41 rvid
Representative.rvid = function (self: Representative): RegionVid {
  switch (self.$) {
    case "FreeRegion":
    case "Placeholder":
    case "Existential": {
      const region_vid = self._0;
      return region_vid;
    }
  }
};

// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:49 new
Representative.new = function (r: RegionVid, definition: RegionDefinition): Representative {
  switch (definition.origin.$) {
    case "FreeRegion":
      return { $: "FreeRegion", _0: r };
    case "Placeholder":
      return { $: "Placeholder", _0: r };
    case "Existential":
      return { $: "Existential", _0: r };
  }
};

// impl fmt::Debug for TypeTest<'_>
// PORT: every `write!` formats its arguments with fresh `{:?}` specs (`PLAIN`), whatever `f`'s flags are.
// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:139 fmt
export const debug_TypeTest: Debug<TypeTest> = (v: TypeTest, f: Fmt): string => {
  let out = `TypeTest from ${debug_Span(v.span, PLAIN)}[`;
  out += fmt_bound(f, v.generic_kind, v.lower_bound, v.verify_bound);
  out += `] ⊢ ${debug_GenericKind(v.generic_kind, PLAIN)}: ${debug_RegionVid(v.lower_bound, PLAIN)}`;
  return out;
};

// PORT: fn-local to `<TypeTest as Debug>::fmt` (hoisted: a nested `fn` item); the `&mut Formatter` it writes to is
// returned as the text.
// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:140 fmt_bound
function fmt_bound(f: Fmt, generic_kind: GenericKind, lower: RegionVid, bound: VerifyBound): string {
  const fmt_bounds = (f: Fmt, bounds: readonly VerifyBound[]): string => {
    let out = "";
    for (let i = 0; i < bounds.length; i++) {
      const bound = bounds[i]!;
      out += fmt_bound(f, generic_kind, lower, bound);
      if (i + 1 < bounds.length) {
        out += ", ";
      }
    }
    return out;
  };
  switch (bound.$) {
    case "IfEq": {
      const binder = bound._0;
      return `${debug_GenericKind(generic_kind, PLAIN)} == ${debug_Binder(binder, PLAIN, debug_VerifyIfEq)}`;
    }
    case "OutlivedBy": {
      const region = bound._0;
      return `${debug_Region(region, PLAIN)}: ${debug_RegionVid(lower, PLAIN)}`;
    }
    case "AnyBound": {
      const verify_bounds = bound._0;
      let out = "Any[";
      out += fmt_bounds(f, verify_bounds);
      return out + "]";
    }
    case "AllBounds": {
      const verify_bounds = bound._0;
      let out = "All[";
      out += fmt_bounds(f, verify_bounds);
      return out + "]";
    }
    case "IsEmpty":
      return `Empty(${debug_RegionVid(lower, PLAIN)})`;
  }
}

// PORT: only called under `cfg!(debug_assertions)` (compiled out: rustc ships without debug assertions). The
// `enabled!(Level::DEBUG)` blocks and `debug!` calls are statically disabled (`max_level_info`) and stay comments.
// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:197 sccs_info
export function sccs_info(infcx: BorrowckInferCtxt, sccs: ConstraintSccs): void {
  // use crate::renumber::RegionCtxt;

  const var_to_origin = infcx.reg_var_to_origin;

  const var_to_origin_sorted = [...var_to_origin];
  var_to_origin_sorted.sort((a, b) => a[0] - b[0]);
  void var_to_origin_sorted;

  // if enabled!(Level::DEBUG) {
  //     let mut reg_vars_to_origins_str = "region variables to origins:\n".to_string();
  //     for (reg_var, origin) in var_to_origin_sorted.into_iter() {
  //         reg_vars_to_origins_str.push_str(&format!("{reg_var:?}: {origin:?}\n"));
  //     }
  //     debug!("{}", reg_vars_to_origins_str);
  // }

  const num_components = sccs.num_sccs();
  const components: KeyedSet<[RegionVid, RegionCtxt]>[] = [];
  for (let i = 0; i < num_components; i++) components.push(new KeyedSet<[RegionVid, RegionCtxt]>(intern_key));

  const scc_indices = sccs.scc_indices();
  for (let reg_var = 0 as RegionVid; reg_var < scc_indices.length; reg_var++) {
    const scc_idx = scc_indices[reg_var]!;
    const origin = var_to_origin.get(reg_var) ?? RegionCtxt.Unknown;
    components[ConstraintSccIndex.as_usize(scc_idx)]!.add([reg_var, origin]);
  }

  // if enabled!(Level::DEBUG) {
  //     let mut components_str = "strongly connected components:".to_string();
  //     for (scc_idx, reg_vars_origins) in components.iter().enumerate() {
  //         let regions_info = reg_vars_origins.clone().into_iter().collect::<Vec<_>>();
  //         components_str.push_str(&format!(
  //             "{:?}: {:?},\n)",
  //             ConstraintSccIndex::from_usize(scc_idx),
  //             regions_info,
  //         ))
  //     }
  //     debug!("{}", components_str);
  // }

  // calculate the best representative for each component
  const components_representatives = new Map<ConstraintSccIndex, RegionCtxt>();
  components.forEach((region_ctxts, scc_idx) => {
    // `Iterator::max_by` returns the last of several equal maxima.
    let repr: RegionCtxt | undefined = undefined;
    for (const reg_var_origin of region_ctxts) {
      const x = reg_var_origin[1];
      if (repr === undefined || RegionCtxt.preference_value(x) >= RegionCtxt.preference_value(repr)) {
        repr = x;
      }
    }
    components_representatives.set(ConstraintSccIndex.from_usize(scc_idx), unwrap(repr));
  });

  const scc_node_to_edges = new Map<[ConstraintSccIndex, RegionCtxt], RegionCtxt[]>();
  for (const [scc_idx, repr] of components_representatives) {
    const edge_representatives = sccs.successors(scc_idx).map((scc_idx) => unwrap(components_representatives.get(scc_idx), "IndexMap: key not found"));
    scc_node_to_edges.set([scc_idx, repr], edge_representatives);
  }

  // debug!("SCC edges {:#?}", scc_node_to_edges);
}

declare module "./mod.gen.ts" {
  interface BestBlame {
    // mod.rs:271
    to_obligation_cause(): ObligationCause;
    // mod.rs:292
    constraint(): OutlivesConstraint;
    // mod.rs:296; `path_`: the field `path` has the same name
    path_(): readonly OutlivesConstraint[];
  }
}

// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:271 to_obligation_cause
BestBlame.prototype.to_obligation_cause = function (this: BestBlame): ObligationCause {
  // FIXME - determine what we should do if we encounter multiple
  // `ConstraintCategory::Predicate` constraints. Currently, we just pick the first one.
  let cause_code: ObligationCauseCode | undefined = undefined;
  for (const constraint of this.path) {
    if (constraint.category.$ === "Predicate") {
      const predicate_span = constraint.category._0;
      const def_id = constraint.category._1;
      // We currently do not store the `DefId` in the `ConstraintCategory`
      // for performances reasons. The error reporting code used by NLL only
      // uses the span, so this doesn't cause any problems at the moment.
      cause_code = { $: "WhereClause", _0: def_id, _1: predicate_span };
      break;
    }
  }
  if (cause_code === undefined) cause_code = ObligationCauseCode.Misc;

  return ObligationCause.new(this.constraint().span, CRATE_DEF_ID, cause_code);
};

// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:292 constraint
BestBlame.prototype.constraint = function (this: BestBlame): OutlivesConstraint {
  return this.path[this.idx]!;
};

// rustc: compiler/rustc_borrowck/src/region_infer/mod.rs:296 path
BestBlame.prototype.path_ = function (this: BestBlame): readonly OutlivesConstraint[] {
  return this.path;
};
