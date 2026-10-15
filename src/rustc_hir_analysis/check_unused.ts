// Port of compiler/rustc_hir_analysis/src/check_unused.rs (lane small-gaps-18).
//
// PORT: `UnusedImport<'tcx>` is a class implementing `Diagnostic` (its `impl Diagnostic` is the method);
// `UnordSet<LocalDefId>` is a `Set`; the `()` return is `null`. `debug!` / `debug_assert_eq!` stay as comments.
import { Diag, type DiagCtxtHandle, type Diagnostic, type Level } from "../rustc_errors/lib.ts";
import { UNUSED_IMPORTS } from "../rustc_lint_defs/builtin.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Visibility } from "../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";

// rustc-type: compiler/rustc_hir_analysis/src/check_unused.rs:10 UnusedImport
class UnusedImport implements Diagnostic {
  constructor(
    public tcx: TyCtxt,
    public span: Span,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/check_unused.rs:16 into_diag
  into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
    const { tcx, span } = this;
    const r = tcx.sess.source_map().span_to_snippet(span);
    if (r.$ === "Ok") {
      const snippet = r._0.toString();
      return Diag.new(dcx, level, `unused import: \`${snippet}\``);
    } else {
      return Diag.new(dcx, level, "unused import");
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/check_unused.rs:26 check_unused_traits
export function check_unused_traits(tcx: TyCtxt, _: null): null {
  const used_trait_imports = new Set<LocalDefId>();

  // FIXME: Use `tcx.hir_par_body_owners()` when we implement creating `DefId`s
  // for anon constants during their parents' typeck.
  // Doing so at current will produce queries cycle errors because it may typeck
  // on anon constants directly.
  for (const item_def_id of tcx.hir_body_owners()) {
    const imports = tcx.used_trait_imports(item_def_id);
    // debug!("GatherVisitor: item_def_id={:?} with imports {:#?}", item_def_id, imports);
    for (const id of imports) used_trait_imports.add(id);
  }

  for (const id of tcx.resolutions(null).maybe_unused_trait_imports) {
    // debug_assert_eq!(tcx.def_kind(id), DefKind::Use);
    if (Visibility.is_public(tcx.visibility(id))) {
      continue;
    }
    if (used_trait_imports.has(id)) {
      continue;
    }
    const span = tcx.def_span(id);
    if (Span.is_dummy(span)) {
      continue;
    }
    tcx.emit_node_span_lint(UNUSED_IMPORTS, tcx.local_def_id_to_hir_id(id), span, new UnusedImport(tcx, span));
  }
  return null;
}
