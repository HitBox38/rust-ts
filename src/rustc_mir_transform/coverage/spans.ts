// Port of compiler/rustc_mir_transform/src/coverage/spans.rs (lane mt-coverage).
//
// PORT: `Vec::dedup_by(|b, a| ..)` (`b` is the later element, `a` the previously retained one; `b` is removed when the
// closure returns true) and `dedup_by_key` are the local `dedup_by` helper; `retain` / `retain_mut` filter in place.
// `Ordering` results are `-1 | 0 | 1`; the sorts use the stable `Array.prototype.sort` (the comparators are consistent
// total preorders). `#[instrument]` / `debug_assert!` are dropped (comments). `#[derive(Debug)]` on `Covspan` / `Hole`
// is only reached by tracing and is not ported.
import { type Mapping, START_BCB } from "../../rustc_middle/mir/coverage.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import type { SourceMap } from "../../rustc_span/source_map.ts";
import type { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { ch } from "../../std/char.ts";
import { Ok } from "../../std/result.ts";
import type { ExpnTree } from "./expansion.ts";
import type { BasicCoverageBlock, CoverageGraph } from "./graph.ts";
import type { ExtractedHirInfo } from "./hir_info.ts";


/** PORT: `Vec::dedup_by(same_bucket)`: `same_bucket(later, prev_retained)`; `later` is removed when it returns true. */
function dedup_by<T>(v: T[], same_bucket: (later: T, prev: T) => boolean): void {
  if (v.length <= 1) return;
  let w = 1;
  for (let r = 1; r < v.length; r++) {
    if (!same_bucket(v[r]!, v[w - 1]!)) {
      v[w] = v[r]!;
      w++;
    }
  }
  v.length = w;
}

// rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:11 extract_refined_covspans
export function extract_refined_covspans(tcx: TyCtxt, hir_info: ExtractedHirInfo, graph: CoverageGraph, expn_tree: ExpnTree, mappings: Mapping[]): void {
  if (hir_info.is_async_fn) {
    // An async function desugars into a function that returns a future,
    // with the user code wrapped in a closure. Any spans in the desugared
    // outer function will be unhelpful, so just keep the signature span
    // and ignore all of the spans in the MIR body.
    const span = hir_info.fn_sig_span;
    if (span !== undefined) {
      mappings.push({ span, kind: { $: "Code", bcb: START_BCB } });
    }
    return;
  }

  // If there somehow isn't an expansion tree node corresponding to the
  // body span, return now and don't create any mappings.
  const node = expn_tree.get(Span.ctxt(hir_info.body_span));
  if (node === undefined) return;

  let covspans: Covspan[] = [];

  for (const { span, bcb } of node.spans) {
    covspans.push(new Covspan(span, bcb));
  }

  // For each expansion with its call-site in the body span, try to
  // distill a corresponding covspan.
  for (const child_context of node.child_contexts) {
    const covspan = single_covspan_for_child_context(tcx, expn_tree, child_context);
    if (covspan !== undefined) {
      covspans.push(covspan);
    }
  }

  const body_span = node.body_span;
  if (body_span !== undefined) {
    covspans = covspans.filter((covspan: Covspan) => {
      const covspan_span = covspan.span;
      // Discard any spans not contained within the function body span.
      // Also discard any spans that fill the entire body, because they tend
      // to represent compiler-inserted code, e.g. implicitly returning `()`.
      const [blo, bhi] = Span.lo_hi(body_span);
      const [clo, chi] = Span.lo_hi(covspan_span);
      if (!Span.contains(body_span, covspan_span) || (blo === clo && bhi === chi)) {
        return false;
      }

      // Each pushed covspan should have the same context as the body span.
      // If it somehow doesn't, discard the covspan.
      if (!Span.eq_ctxt(body_span, covspan_span)) {
        // There is currently no known way for this to happen, but if it
        // does happen then dropping the offending span is better than
        // having tricky macro expansions trigger an ICE.
        return false;
      }

      return true;
    });
  }

  // Only proceed if we found at least one usable span.
  if (covspans.length === 0) {
    return;
  }

  // Also add the function signature span, if available.
  // Otherwise, add a fake span at the start of the body, to avoid an ugly
  // gap between the start of the body and the first real span.
  // FIXME: Find a more principled way to solve this problem.
  const span = node.fn_sig_span ?? (node.body_span === undefined ? undefined : Span.shrink_to_lo(node.body_span));
  if (span !== undefined) {
    covspans.push(new Covspan(span, START_BCB));
  }

  const compare_covspans = (a: Covspan, b: Covspan): number => {
    const o = compare_spans(a.span, b.span);
    // After deduplication, we want to keep only the most-dominated BCB.
    return o !== 0 ? o : -graph.cmp_in_dominator_order(a.bcb, b.bcb);
  };
  covspans.sort(compare_covspans);

  // Among covspans with the same span, keep only one,
  // preferring the one with the most-dominated BCB.
  // (Ideally we should try to preserve _all_ non-dominating BCBs, but that
  // requires a lot more complexity in the span refiner, for little benefit.)
  dedup_by(covspans, (a, b) => {
    const [alo, ahi] = Span.lo_hi(a.span);
    const [blo, bhi] = Span.lo_hi(b.span);
    return alo === blo && ahi === bhi;
  });

  // Sort the holes, and merge overlapping/adjacent holes.
  const holes = node.hole_spans.map((span) => new Hole(span));

  holes.sort((a, b) => compare_spans(a.span, b.span));
  dedup_by(holes, (b, a) => a.merge_if_overlapping_or_adjacent(b));

  // Discard any span that overlaps with a hole.
  covspans = discard_spans_overlapping_holes(covspans, holes);

  // Discard spans that overlap in unwanted ways.
  covspans = remove_unwanted_overlapping_spans(covspans);

  // For all empty spans, either enlarge them to be non-empty, or discard them.
  const source_map = tcx.sess.source_map();
  covspans = covspans.filter((covspan) => {
    const span = ensure_non_empty_span(source_map, covspan.span);
    if (span === undefined) return false;
    covspan.span = span;
    return true;
  });

  // Merge covspans that can be merged.
  dedup_by(covspans, (b, a) => a.merge_if_eligible(b));

  for (const { span, bcb } of covspans) {
    // Each span produced by the refiner represents an ordinary code region.
    mappings.push({ span, kind: { $: "Code", bcb } });
  }
}

/// For a single child expansion, try to distill it into a single span+BCB mapping.
// rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:126 single_covspan_for_child_context
function single_covspan_for_child_context(tcx: TyCtxt, expn_tree: ExpnTree, child_context: SyntaxContext): Covspan | undefined {
  const node = expn_tree.get(child_context);
  if (node === undefined) return undefined;
  const minmax_bcbs = node.minmax_bcbs;
  if (minmax_bcbs === undefined) return undefined;

  let bcb: BasicCoverageBlock;
  const k = node.expn_kind;
  if ((k.$ === "Macro" && k._0 === "Bang") || (k.$ === "Desugaring" && k._0.$ === "Await")) {
    // For bang-macros (e.g. `assert!`, `trace!`) and for `await`, taking
    // the "first" BCB in dominator order seems to give good results.
    bcb = minmax_bcbs.min;
  } else {
    // For other kinds of expansion, taking the "last" (most-dominated) BCB
    // seems to give good results.
    bcb = minmax_bcbs.max;
  }

  // For bang-macro expansions, limit the call-site span to just the macro
  // name plus `!`, excluding the macro arguments.
  let span = node.call_site;
  if (span === undefined) return undefined;
  if (node.expn_kind.$ === "Macro" && node.expn_kind._0 === "Bang") {
    span = tcx.sess.source_map().span_through_char(span, ch("!"));
  }

  return new Covspan(span, bcb);
}

/// Discard all covspans that overlap a hole.
///
/// The lists of covspans and holes must be sorted, and any holes that overlap
/// with each other must have already been merged.
// PORT: `covspans: &mut Vec<Covspan>` is returned filtered.
// rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:159 discard_spans_overlapping_holes
function discard_spans_overlapping_holes(covspans: Covspan[], holes: readonly Hole[]): Covspan[] {
  // debug_assert!(covspans.is_sorted_by(|a, b| compare_spans(a.span, b.span).is_le()));
  // debug_assert!(holes.is_sorted_by(|a, b| compare_spans(a.span, b.span).is_le()));
  // debug_assert!(holes.array_windows().all(|[a, b]| !a.span.overlaps_or_adjacent(b.span)));

  let curr_hole = 0;
  const overlaps_hole = (covspan: Covspan): boolean => {
    let hole: Hole | undefined;
    while ((hole = holes[curr_hole]) !== undefined) {
      // Both lists are sorted, so we can permanently skip any holes that
      // end before the start of the current span.
      if (Span.hi(hole.span) <= Span.lo(covspan.span)) {
        curr_hole += 1;
        continue;
      }

      return Span.overlaps(hole.span, covspan.span);
    }

    // No holes left, so this covspan doesn't overlap with any holes.
    return false;
  };

  return covspans.filter((covspan) => !overlaps_hole(covspan));
}

/// Takes a list of sorted spans extracted from MIR, and "refines"
/// those spans by removing spans that overlap in unwanted ways.
// #[instrument(level = "debug")]
// rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:187 remove_unwanted_overlapping_spans
function remove_unwanted_overlapping_spans(sorted_spans: Covspan[]): Covspan[] {
  // debug_assert!(sorted_spans.is_sorted_by(|a, b| compare_spans(a.span, b.span).is_le()));

  // Holds spans that have been read from the input vector, but haven't yet
  // been committed to the output vector.
  let pending: Covspan[] = [];
  const refined: Covspan[] = [];

  for (const curr of sorted_spans) {
    pending = pending.filter((prev: Covspan) => {
      if (Span.hi(prev.span) <= Span.lo(curr.span)) {
        // There's no overlap between the previous/current covspans,
        // so move the previous one into the refined list.
        refined.push(prev.clone());
        return false;
      } else {
        // Otherwise, retain the previous covspan only if it has the
        // same BCB. This tends to discard long outer spans that enclose
        // smaller inner spans with different control flow.
        return prev.bcb === curr.bcb;
      }
    });
    pending.push(curr);
  }

  // Drain the rest of the pending list into the refined list.
  refined.push(...pending);
  return refined;
}

// rustc-type: compiler/rustc_mir_transform/src/coverage/spans.rs:218 Covspan
// #[derive(Clone)]
class Covspan {
  constructor(
    public span: Span,
    public bcb: BasicCoverageBlock,
  ) {}

  clone(): Covspan {
    return new Covspan(this.span, this.bcb);
  }

  /// If `self` and `other` can be merged, mutates `self.span` to also
  /// include `other.span` and returns true.
  ///
  /// Two covspans can be merged if they have the same BCB, and they are
  /// overlapping or adjacent.
  // rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:229 merge_if_eligible
  merge_if_eligible(other: Covspan): boolean {
    const eligible_for_merge = (a: Covspan, b: Covspan): boolean => a.bcb === b.bcb && Span.overlaps_or_adjacent(a.span, b.span);

    if (eligible_for_merge(this, other)) {
      this.span = Span.to(this.span, other.span);
      return true;
    } else {
      return false;
    }
  }
}

/// Compares two spans in (lo ascending, hi descending) order.
// rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:243 compare_spans
function compare_spans(a: Span, b: Span): -1 | 0 | 1 {
  // First sort by span start.
  const alo = Span.lo(a);
  const blo = Span.lo(b);
  if (alo !== blo) return alo < blo ? -1 : 1;
  // If span starts are the same, sort by span end in reverse order.
  // This ensures that if spans A and B are adjacent in the list,
  // and they overlap but are not equal, then either:
  // - Span A extends further left, or
  // - Both have the same start and span A extends further right
  const ahi = Span.hi(a);
  const bhi = Span.hi(b);
  return ahi === bhi ? 0 : ahi < bhi ? 1 : -1;
}

// rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:254 ensure_non_empty_span
function ensure_non_empty_span(source_map: SourceMap, span: Span): Span | undefined {
  if (!Span.is_empty(span)) {
    return span;
  }

  // The span is empty, so try to enlarge it to cover an adjacent '{' or '}'.
  const r = source_map.span_to_source(span, (src, start, end) => {
    // Adjusting span endpoints by `BytePos(1)` is normally a bug,
    // but in this case we have specifically checked that the character
    // we're skipping over is one of two specific ASCII characters, so
    // adjusting by exactly 1 byte is correct.
    if (end < src.len() && src.byte(end) === ch("{")) {
      return Ok(Span.with_hi(span, BytePos(Span.hi(span) + 1)));
    } else if (start > 0 && src.byte(start - 1) === ch("}")) {
      return Ok(Span.with_lo(span, BytePos(Span.lo(span) - 1)));
    } else {
      return Ok(undefined);
    }
  });
  return r.$ === "Ok" ? r._0 : undefined;
}

// rustc-type: compiler/rustc_mir_transform/src/coverage/spans.rs:278 Hole
class Hole {
  constructor(public span: Span) {}

  // rustc: compiler/rustc_mir_transform/src/coverage/spans.rs:283 merge_if_overlapping_or_adjacent
  merge_if_overlapping_or_adjacent(other: Hole): boolean {
    if (!Span.overlaps_or_adjacent(this.span, other.span)) {
      return false;
    }

    this.span = Span.to(this.span, other.span);
    return true;
  }
}
