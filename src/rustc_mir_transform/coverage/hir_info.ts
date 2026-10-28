// Port of compiler/rustc_mir_transform/src/coverage/hir_info.rs (lane mt-coverage).
//
// PORT: the fn-local visitors (`HolesVisitor`, `FindNodesToIgnoreVisitor`, `IgnoreAllSubexprsVisitor`) are module-level
// classes extending rustc_hir's intravisit `Visitor` (precedent rustc_hir_typeck/loops.ts), placed after the fn that
// declares them (marker order). `FxHashSet<HirId>` is a `HirIdSet`.
// PORT: `ExtractedHirInfo::function_source_hash: u64` holds the `bigint` of `Hash64::as_u64`. `CoverageMirInfo`'s
// generated type (rustc_middle/mir/coverage.gen.ts) declares the field `number`, so mod.ts casts it there (handoff:
// tools/codegen should map that `u64` to `bigint`). The value is not printed by any MIR dump.
// PORT: `tcx.typeck(def_id)` (typed `unknown` by queries.gen.ts) is cast to `TypeckResults`.
import type { ItemId } from "../../rustc_hir/hir.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { HirIdSet } from "../../rustc_hir_id/lib.ts";
import type { HirTyCtxt } from "../../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../rustc_middle/hir/nested_filter.ts";
import type { Body } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { Span } from "../../rustc_span/lib.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../../std/panic.ts";

/// Function information extracted from HIR by the coverage instrumentor.
// rustc-type: compiler/rustc_mir_transform/src/coverage/hir_info.rs:12 ExtractedHirInfo
export interface ExtractedHirInfo {
  function_source_hash: bigint;
  is_async_fn: boolean;
  /// The span of the function's signature, if available.
  /// Must have the same context and filename as the body span.
  fn_sig_span: Span | undefined;
  body_span: Span;
  /// "Holes" are regions within the function body (or its expansions) that
  /// should not be included in coverage spans for this function
  /// (e.g. closures and nested items).
  hole_spans: Span[];
  /// HIR nodes that should be ignored when extracting spans from marker
  /// statements in MIR.
  nodes_to_ignore: HirIdSet;
}

// rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:28 extract_hir_info
export function extract_hir_info(tcx: TyCtxt, mir_body: Body): ExtractedHirInfo {
  const def_id: LocalDefId = (() => {
    let def_id = mir_body.source.def_id().expect_local();

    // Synthetic by-move coroutine bodies don't have useful HIR of their own.
    // Use the original coroutine body instead. These synthetic bodies are
    // created with a coroutine type, so we can inspect that type as-is.
    if (tcx.is_synthetic_mir(def_id)) {
      const kind = Unnormalized.skip_normalization(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(def_id)) as EarlyBinder<Ty>)).kind();
      switch (kind.$) {
        case "Coroutine":
          def_id = kind._0.expect_local();
          break;
        default:
          def_id = tcx.local_parent(def_id);
          break;
      }
    }
    return def_id;
  })();

  const hir_node = tcx.hir_node_by_def_id(def_id);
  const fn_body_id = unwrap(hir.Node.body_id(hir_node), "HIR node is a function with body");
  const hir_body = tcx.hir_body(fn_body_id);

  const maybe_fn_sig = hir.Node.fn_sig(hir_node);
  const is_async_fn = maybe_fn_sig !== undefined && maybe_fn_sig.header.is_async();

  let body_span = hir_body.value.span;

  // Unexpand a closure's body span back to the context of its declaration.
  // This helps with closure bodies that consist of just a single bang-macro,
  // and also with closure bodies produced by async desugaring.
  if (hir_node.$ === "Expr" && hir_node._0.kind.$ === "Closure") {
    const closure = hir_node._0.kind._0;
    const effective_body_span = Span.find_ancestor_in_same_ctxt(body_span, closure.fn_decl_span);
    if (effective_body_span !== undefined) {
      body_span = effective_body_span;
    }
  }

  // The actual signature span is only used if it has the same context and
  // filename as the body, and precedes the body.
  let fn_sig_span: Span | undefined = maybe_fn_sig?.span;
  if (fn_sig_span !== undefined) {
    const source_map = tcx.sess.source_map();
    const file_idx = (span: Span): number => source_map.lookup_source_file_idx(Span.lo(span));

    const keep = Span.eq_ctxt(fn_sig_span, body_span) && Span.hi(fn_sig_span) <= Span.lo(body_span) && file_idx(fn_sig_span) === file_idx(body_span);
    if (!keep) fn_sig_span = undefined;
  }

  const function_source_hash = hash_mir_source(tcx, hir_body);

  const hole_spans = extract_hole_spans_from_hir(tcx, hir_body);
  const nodes_to_ignore = find_nodes_to_ignore(tcx, def_id, hir_body);

  return {
    function_source_hash,
    is_async_fn,
    fn_sig_span,
    body_span,
    hole_spans,
    nodes_to_ignore,
  };
}

// rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:93 hash_mir_source
function hash_mir_source(tcx: TyCtxt, hir_body: hir.Body): bigint {
  const owner = hir_body.id().hir_id.owner;
  return Hash64.as_u64(
    Fingerprint.to_smaller_hash(unwrap(tcx.hir_owner_nodes(owner).opt_hash, "hash should be present when coverage instrumentation is enabled")),
  );
}

// rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:102 extract_hole_spans_from_hir
function extract_hole_spans_from_hir(tcx: TyCtxt, hir_body: hir.Body): Span[] {
  const visitor = new HolesVisitor(tcx, []);

  visitor.visit_body(hir_body);
  return visitor.hole_spans;
}

// struct HolesVisitor<'tcx> (fn-local in extract_hole_spans_from_hir)
class HolesVisitor extends hir.intravisit.Visitor {
  /// We have special handling for nested items, but we still want to
  /// traverse into nested bodies of things that are not considered items,
  /// such as "anon consts" (e.g. array lengths).
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    public hole_spans: Span[],
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:114 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  /// We override `visit_nested_item` instead of `visit_item` because we
  /// only need the item's span, not the item itself.
  // rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:120 visit_nested_item
  override visit_nested_item(id: ItemId): undefined {
    const span = this.tcx.def_span(LocalDefId.to_def_id(id.owner_id.def_id));
    this.visit_hole_span(span);
    // Having visited this item, we don't care about its children,
    // so don't call `walk_item`.
    return undefined;
  }

  // We override `visit_expr` instead of the more specific expression
  // visitors, so that we have direct access to the expression span.
  // rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:129 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    switch (expr.kind.$) {
      case "Closure":
      case "ConstBlock": {
        this.visit_hole_span(expr.span);
        // Having visited this expression, we don't care about its
        // children, so don't call `walk_expr`.
        break;
      }

      // For other expressions, recursively visit as normal.
      default:
        hir.intravisit.walk_expr(this, expr);
        break;
    }
    return undefined;
  }

  // impl HolesVisitor<'_>
  // rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:143 visit_hole_span
  visit_hole_span(hole_span: Span): void {
    this.hole_spans.push(hole_span);
  }
}

/// Use heuristics to detect HIR expression nodes that should be ignored during
/// spans-from-MIR extraction.
// rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:156 find_nodes_to_ignore
function find_nodes_to_ignore(tcx: TyCtxt, def_id: LocalDefId, hir_body: hir.Body): HirIdSet {
  const visitor = new FindNodesToIgnoreVisitor(tcx, tcx.typeck(def_id) as TypeckResults, new HirIdSet());
  visitor.visit_body(hir_body);
  return visitor.nodes_to_ignore;
}

/// Top-level visitor used by [`find_nodes_to_ignore`].
// struct FindNodesToIgnoreVisitor<'tcx> (fn-local in find_nodes_to_ignore)
class FindNodesToIgnoreVisitor extends hir.intravisit.Visitor {
  constructor(
    public tcx: TyCtxt,
    public typeck_results: TypeckResults,
    public nodes_to_ignore: HirIdSet,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:173 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    // Look for call expressions with a return type of `!` produced by a bang-macro.
    // If we find one, ignore all subexpressions in the call's _arguments_.
    // This avoids big regressions in coverage-report quality for code with assertions.
    //
    // FIXME(Zalathar): We might be able to remove this by extending `#[coverage(off)]`
    // to support expressions, and using it the standard-library assert macros.
    if (expr.kind.$ === "Call") {
      const callee = expr.kind._0;
      const args = expr.kind._1;
      const callee_ty = this.typeck_results.node_type(callee.hir_id);
      if (callee_ty.is_fn()) {
        const output = Binder.no_bound_vars(PolyFnSig.output(callee_ty.fn_sig(this.tcx)), fold_Ty);
        if (output !== undefined && output.is_never()) {
          const kind = SyntaxContext.outer_expn_data(Span.ctxt(expr.span)).kind;
          if (kind.$ === "Macro" && kind._0 === "Bang") {
            for (const arg of args) {
              new IgnoreAllSubexprsVisitor(this).visit_expr(arg);
            }
          }
        }
      }
    }

    // Find and ignore block-expressions that are non-empty, as their subexpressions
    // will produce more precise coverage spans.
    if (expr.kind.$ === "Block") {
      const block = expr.kind._0;
      const is_empty = block.stmts.length === 0 && block.expr === undefined;
      if (!is_empty) {
        // Ignore the block itself, but not its subexpressions.
        this.nodes_to_ignore.add(expr.hir_id);
      }
    }

    hir.intravisit.walk_expr(this, expr);
    return undefined;
  }
}

/// Marks all expressions in a HIR subtree as ignored.
// struct IgnoreAllSubexprsVisitor<'a, 'tcx> (fn-local in find_nodes_to_ignore)
class IgnoreAllSubexprsVisitor extends hir.intravisit.Visitor {
  constructor(public inner: FindNodesToIgnoreVisitor) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/coverage/hir_info.rs:206 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    this.inner.nodes_to_ignore.add(expr.hir_id);
    hir.intravisit.walk_expr(this, expr);
    return undefined;
  }
}

