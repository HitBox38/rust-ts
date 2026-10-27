// Port of compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Contains utilities for generating suggestions for borrowck errors related to unsatisfied
//! outlives constraints.
// PORT: `#[derive(Default)] OutlivesSuggestionBuilder` is `new OutlivesSuggestionBuilder(new Map())` (the `BTreeMap` is a
// `Map` whose users keep key order, lib.ts header).
import type { Diag } from "../../rustc_errors/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unwrap } from "../../std/panic.ts";
import type { MirBorrowckCtxt } from "../lib.gen.ts";
import { OutlivesSuggestionBuilder, type SuggestedConstraint } from "./outlives_suggestion.gen.ts";
import type { ErrorConstraintInfo } from "./region_errors.gen.ts";
import type { RegionName } from "./region_name.gen.ts";
import { display_RegionName } from "./region_name.ts";

export * from "./outlives_suggestion.gen.ts";

declare module "./outlives_suggestion.gen.ts" {
  interface OutlivesSuggestionBuilder {
    // outlives_suggestion.rs:71
    region_vid_to_name(mbcx: MirBorrowckCtxt, region: RegionVid): RegionName | undefined;
    // outlives_suggestion.rs:80
    compile_all_suggestions(mbcx: MirBorrowckCtxt): SuggestedConstraint[];
    // outlives_suggestion.rs:142
    collect_constraint(fr: RegionVid, outlived_fr: RegionVid): void;
    // outlives_suggestion.rs:150
    intermediate_suggestion(mbcx: MirBorrowckCtxt, errci: ErrorConstraintInfo, diag: Diag): void;
    // outlives_suggestion.rs:171
    add_suggestion(mbcx: MirBorrowckCtxt): void;
  }
  namespace OutlivesSuggestionBuilder {
    // outlives_suggestion.rs:49
    function region_name_is_suggestable(name: RegionName): boolean;
  }
}

/// Returns `true` iff the `RegionNameSource` is a valid source for an outlives
/// suggestion.
// rustc: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:49 region_name_is_suggestable
(OutlivesSuggestionBuilder as unknown as { region_name_is_suggestable: typeof OutlivesSuggestionBuilder.region_name_is_suggestable }).region_name_is_suggestable =
  function (name: RegionName): boolean {
    switch (name.source.$) {
      case "NamedEarlyParamRegion":
      case "NamedLateParamRegion":
      case "Static":
        return true;

      // Don't give suggestions for upvars, closure return types, or other unnameable
      // regions.
      case "SynthesizedFreeEnvRegion":
      case "AnonRegionFromArgument":
      case "AnonRegionFromUpvar":
      case "AnonRegionFromOutput":
      case "AnonRegionFromYieldTy":
      case "AnonRegionFromAsyncFn":
      case "AnonRegionFromImplSignature": {
        // debug!("Region {:?} is NOT suggestable", name);
        return false;
      }
    }
  };

/// Returns a name for the region if it is suggestable. See `region_name_is_suggestable`.
// rustc: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:71 region_vid_to_name
OutlivesSuggestionBuilder.prototype.region_vid_to_name = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt, region: RegionVid): RegionName | undefined {
  const name = mbcx.give_region_a_name(region);
  return name !== undefined && OutlivesSuggestionBuilder.region_name_is_suggestable(name) ? name : undefined;
};

/// Compiles a list of all suggestions to be printed in the final big suggestion.
// rustc: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:80 compile_all_suggestions
OutlivesSuggestionBuilder.prototype.compile_all_suggestions = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt): SuggestedConstraint[] {
  const suggested: SuggestedConstraint[] = [];

  // Keep track of variables that we have already suggested unifying so that we don't print
  // out silly duplicate messages.
  const unified_already = new Set<RegionVid>();

  // PORT: `BTreeMap` iteration is in key order.
  for (const [fr, outlived_] of [...this.constraints_to_add].sort((a, b) => a[0] - b[0])) {
    const fr_name = this.region_vid_to_name(mbcx, fr);
    if (fr_name === undefined) {
      continue;
    }

    const outlived: [RegionVid, RegionName][] = [];
    for (const fr of outlived_) {
      // if there is a `None`, we will just omit that constraint
      const rname = this.region_vid_to_name(mbcx, fr);
      if (rname !== undefined) outlived.push([fr, rname]);
    }

    // No suggestable outlived lifetimes.
    if (outlived.length === 0) {
      continue;
    }

    // There are two types of suggestions we can make:
    // 1) Suggest replacing 'a with 'static. If any of `outlived` is `'static`, then we
    //    should just replace 'a with 'static.
    // 2) Suggest unifying 'a with 'b if we have both 'a: 'b and 'b: 'a

    if (outlived.some(([, outlived_name]) => outlived_name.source.$ === "Static")) {
      suggested.push({ $: "Static", _0: fr_name });
    } else {
      // We want to isolate out all lifetimes that should be unified and print out
      // separate messages for them.

      const unified = outlived.filter(
        // Do we have both 'fr: 'r and 'r: 'fr?
        ([r]) => {
          const r_outlived = this.constraints_to_add.get(r);
          return r_outlived !== undefined && r_outlived.includes(fr);
        },
      );

      for (const [r, bound] of unified) {
        if (!unified_already.has(fr)) {
          suggested.push({ $: "Equal", _0: fr_name, _1: bound });
          unified_already.add(r);
        }
      }
    }
  }

  return suggested;
};

/// Add the outlives constraint `fr: outlived_fr` to the set of constraints we need to suggest.
// rustc: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:142 collect_constraint
OutlivesSuggestionBuilder.prototype.collect_constraint = function (this: OutlivesSuggestionBuilder, fr: RegionVid, outlived_fr: RegionVid): void {
  // debug!("Collected {:?}: {:?}", fr, outlived_fr);

  // Add to set of constraints for final help note.
  let v = this.constraints_to_add.get(fr);
  if (v === undefined) {
    v = [];
    this.constraints_to_add.set(fr, v);
  }
  v.push(outlived_fr);
};

/// Emit an intermediate note on the given `Diag` if the involved regions are suggestable.
// rustc: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:150 intermediate_suggestion
OutlivesSuggestionBuilder.prototype.intermediate_suggestion = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt, errci: ErrorConstraintInfo, diag: Diag): void {
  // Emit an intermediate note.
  const fr_name = this.region_vid_to_name(mbcx, errci.fr);
  const outlived_fr_name = this.region_vid_to_name(mbcx, errci.outlived_fr);

  if (fr_name !== undefined && outlived_fr_name !== undefined && !(outlived_fr_name.source.$ === "Static")) {
    diag.help(`consider adding the following bound: \`${display_RegionName(fr_name)}: ${display_RegionName(outlived_fr_name)}\``);
  }
};

/// If there is a suggestion to emit, add a diagnostic to the buffer. This is the final
/// suggestion including all collected constraints.
// rustc: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:171 add_suggestion
OutlivesSuggestionBuilder.prototype.add_suggestion = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt): void {
  // No constraints to add? Done.
  if (this.constraints_to_add.size === 0) {
    // debug!("No constraints to suggest.");
    return;
  }

  // If there is only one constraint to suggest, then we already suggested it in the
  // intermediate suggestion above.
  if (this.constraints_to_add.size === 1 && unwrap([...this.constraints_to_add.values()][0]).length === 1) {
    // debug!("Only 1 suggestion. Skipping.");
    return;
  }

  // Get all suggestable constraints.
  const suggested = this.compile_all_suggestions(mbcx);

  // If there are no suggestable constraints...
  if (suggested.length === 0) {
    // debug!("Only 1 suggestable constraint. Skipping.");
    return;
  }

  // Emit an error with a list of one or more help suggestions. This is a weird error because
  // it's just there to provide somewhere to put the help suggestions that describe how to
  // fix the one or more borrow errors already reported within the item.
  const tcx = mbcx.infcx.tcx;
  const def_id = mbcx.mir_def_id();
  const span = tcx.def_ident_span(def_id) ?? tcx.def_span(def_id);
  const diag = tcx.dcx().struct_err("one or more lifetime errors were found in this item").with_span(span);

  // Add suggestions.
  for (const constraint of suggested) {
    switch (constraint.$) {
      case "Equal": {
        const [a, b] = [constraint._0, constraint._1];
        diag.help(`\`${display_RegionName(a)}\` and \`${display_RegionName(b)}\` must be the same: replace one with the other`);
        break;
      }
      case "Static": {
        const a = constraint._0;
        diag.help(`replace \`${display_RegionName(a)}\` with \`'static\``);
        break;
      }
    }
  }

  // We want this message to appear after other messages on the mir def.
  const mir_span = mbcx.body.span;

  // Buffer the diagnostic
  mbcx.buffer_error_with_sort_span(diag, Span.shrink_to_hi(mir_span));
};
