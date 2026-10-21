// Port of compiler/rustc_lint/src/unqualified_local_imports.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (unqualified_local_imports.lints.gen.ts).
import { Node } from "../rustc_hir/hir.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { kw } from "../rustc_span/symbol.ts";
import type { LateContext } from "./context.ts";
import { UnqualifiedLocalImportsDiag_diagnostic } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { UNQUALIFIED_LOCAL_IMPORTS, UnqualifiedLocalImports } from "./unqualified_local_imports.lints.gen.ts";

export * from "./unqualified_local_imports.lints.gen.ts";

declare module "./unqualified_local_imports.lints.gen.ts" {
  interface UnqualifiedLocalImports extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for UnqualifiedLocalImports
// rustc: compiler/rustc_lint/src/unqualified_local_imports.rs:47 check_item
UnqualifiedLocalImports.prototype.check_item = function (this: UnqualifiedLocalImports, cx: LateContext, item: hir.Item): void {
  if (item.kind.$ !== "Use") return;
  const path = item.kind._0.prefix;
  // Check the type and value namespace resolutions for a local crate.
  const type_ns = path.res.type_ns;
  const value_ns = path.res.value_ns;
  const is_local_import =
    (type_ns !== undefined && type_ns.$ === "Def" && type_ns._1.is_local()) || (value_ns !== undefined && value_ns.$ === "Def" && value_ns._1.is_local());
  if (!is_local_import) {
    return;
  }
  // So this does refer to something local. Let's check whether it starts with `self`,
  // `super`, or `crate`. If the path is empty, that means we have a `use *`, which is
  // equivalent to `use crate::*` so we don't fire the lint in that case.
  const first_seg = path.segments[0];
  if (first_seg === undefined) return;
  if (first_seg.ident.name === kw.SelfLower || first_seg.ident.name === kw.Super || first_seg.ident.name === kw.Crate) {
    return;
  }

  const encl_item_id = cx.tcx.hir_get_parent_item(item.hir_id());
  const encl_item = cx.tcx.hir_node_by_def_id(encl_item_id.def_id);
  if (Node.fn_kind(encl_item) !== undefined) {
    // `use` in a method -- don't lint, that leads to too many undesirable lints
    // when a function imports all variants of an enum.
    return;
  }

  // This `use` qualifies for our lint!
  cx.emit_span_lint(UNQUALIFIED_LOCAL_IMPORTS, first_seg.ident.span, UnqualifiedLocalImportsDiag_diagnostic({}));
};
