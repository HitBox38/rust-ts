// Port of compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Contains utilities for generating suggestions for borrowck errors related to unsatisfied
//! outlives constraints.
// PORT: `#[derive(Default)] OutlivesSuggestionBuilder` is `new OutlivesSuggestionBuilder(new Map())` (the `BTreeMap` is a
// `Map` whose users keep key order, lib.ts header).
import type { Diag } from "../../rustc_errors/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { unported } from "../../std/panic.ts";
import type { MirBorrowckCtxt } from "../lib.gen.ts";
import { OutlivesSuggestionBuilder, type SuggestedConstraint } from "./outlives_suggestion.gen.ts";
import type { ErrorConstraintInfo } from "./region_errors.gen.ts";
import type { RegionName } from "./region_name.gen.ts";

export * from "./outlives_suggestion.gen.ts";

declare module "./outlives_suggestion.gen.ts" {
  interface OutlivesSuggestionBuilder {
    // outlives_suggestion.rs:71 (lane bck-diag-f)
    region_vid_to_name(mbcx: MirBorrowckCtxt, region: RegionVid): RegionName | undefined;
    // outlives_suggestion.rs:80 (lane bck-diag-f)
    compile_all_suggestions(mbcx: MirBorrowckCtxt): SuggestedConstraint[];
    // outlives_suggestion.rs:142 (lane bck-diag-f)
    collect_constraint(fr: RegionVid, outlived_fr: RegionVid): void;
    // outlives_suggestion.rs:150 (lane bck-diag-f)
    intermediate_suggestion(mbcx: MirBorrowckCtxt, errci: ErrorConstraintInfo, diag: Diag): void;
    // outlives_suggestion.rs:171 (lane bck-diag-f)
    add_suggestion(mbcx: MirBorrowckCtxt): void;
  }
  namespace OutlivesSuggestionBuilder {
    // outlives_suggestion.rs:49 (lane bck-diag-f)
    function region_name_is_suggestable(name: RegionName): boolean;
  }
}

/// Returns `true` iff the `RegionNameSource` is a valid source for an outlives
/// suggestion.
// stub: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:49 region_name_is_suggestable (lane bck-diag-f)
(OutlivesSuggestionBuilder as unknown as { region_name_is_suggestable: typeof OutlivesSuggestionBuilder.region_name_is_suggestable }).region_name_is_suggestable =
  function (name: RegionName): boolean {
    return unported("rustc_borrowck::diagnostics::outlives_suggestion::OutlivesSuggestionBuilder::region_name_is_suggestable");
  };

/// Returns a name for the region if it is suggestable. See `region_name_is_suggestable`.
// stub: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:71 region_vid_to_name (lane bck-diag-f)
OutlivesSuggestionBuilder.prototype.region_vid_to_name = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt, region: RegionVid): RegionName | undefined {
  return unported("rustc_borrowck::diagnostics::outlives_suggestion::OutlivesSuggestionBuilder::region_vid_to_name");
};

/// Compiles a list of all suggestions to be printed in the final big suggestion.
// stub: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:80 compile_all_suggestions (lane bck-diag-f)
OutlivesSuggestionBuilder.prototype.compile_all_suggestions = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt): SuggestedConstraint[] {
  return unported("rustc_borrowck::diagnostics::outlives_suggestion::OutlivesSuggestionBuilder::compile_all_suggestions");
};

/// Add the outlives constraint `fr: outlived_fr` to the set of constraints we need to suggest.
// stub: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:142 collect_constraint (lane bck-diag-f)
OutlivesSuggestionBuilder.prototype.collect_constraint = function (this: OutlivesSuggestionBuilder, fr: RegionVid, outlived_fr: RegionVid): void {
  return unported("rustc_borrowck::diagnostics::outlives_suggestion::OutlivesSuggestionBuilder::collect_constraint");
};

/// Emit an intermediate note on the given `Diag` if the involved regions are suggestable.
// stub: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:150 intermediate_suggestion (lane bck-diag-f)
OutlivesSuggestionBuilder.prototype.intermediate_suggestion = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt, errci: ErrorConstraintInfo, diag: Diag): void {
  return unported("rustc_borrowck::diagnostics::outlives_suggestion::OutlivesSuggestionBuilder::intermediate_suggestion");
};

/// If there is a suggestion to emit, add a diagnostic to the buffer. This is the final
/// suggestion including all collected constraints.
// stub: compiler/rustc_borrowck/src/diagnostics/outlives_suggestion.rs:171 add_suggestion (lane bck-diag-f)
OutlivesSuggestionBuilder.prototype.add_suggestion = function (this: OutlivesSuggestionBuilder, mbcx: MirBorrowckCtxt): void {
  return unported("rustc_borrowck::diagnostics::outlives_suggestion::OutlivesSuggestionBuilder::add_suggestion");
};
