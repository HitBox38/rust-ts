// Port of compiler/rustc_lint/src/traits.rs. The lint statics and the `declare_lint_pass!` expansion are generated
// (traits.lints.gen.ts).
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { GenericClauses } from "../rustc_middle/ty/generics.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { TraitRef } from "../rustc_type_ir/predicate.ts";
import type { LateContext } from "./context.ts";
import { DropGlue_diagnostic, DropTraitConstraintsDiag_diagnostic } from "./diagnostics.ts";
import type { LateLintPass } from "./passes.ts";
import { DROP_BOUNDS, DropTraitConstraints, DYN_DROP } from "./traits.lints.gen.ts";

export * from "./traits.lints.gen.ts";

declare module "./traits.lints.gen.ts" {
  interface DropTraitConstraints extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for DropTraitConstraints
// rustc: compiler/rustc_lint/src/traits.rs:90 check_item
DropTraitConstraints.prototype.check_item = function (this: DropTraitConstraints, cx: LateContext, item: hir.Item): void {
  const gen_clauses = cx.tcx.explicit_clauses_of(item.owner_id) as GenericClauses;
  for (const [clause, span] of gen_clauses.clauses) {
    const kind = Binder.skip_binder(clause.kind());
    if (kind.$ !== "Trait") {
      continue;
    }
    const trait_predicate = kind._0;
    const def_id = trait_predicate.trait_ref.def_id;
    if (cx.tcx.is_lang_item(def_id, LangItem.Drop)) {
      // Explicitly allow `impl Drop`, a drop-guards-as-unnameable-type pattern.
      if (TraitRef.self_ty(trait_predicate.trait_ref).is_opaque()) {
        continue;
      }
      const def_id = cx.tcx.get_diagnostic_item(sym.needs_drop);
      if (def_id === undefined) return;
      cx.emit_span_lint(DROP_BOUNDS, span, DropTraitConstraintsDiag_diagnostic({ clause, tcx: cx.tcx, def_id }));
    }
  }
};

// rustc: compiler/rustc_lint/src/traits.rs:114 check_ty
DropTraitConstraints.prototype.check_ty = function (this: DropTraitConstraints, cx: LateContext, ty: hir.Ty<hir.AmbigArg>): void {
  if (ty.kind.$ !== "TraitObject") {
    return;
  }
  const bounds = ty.kind._0;
  for (const bound of bounds) {
    const def_id = bound.trait_ref.trait_def_id();
    if (def_id !== undefined && cx.tcx.is_lang_item(def_id, LangItem.Drop)) {
      const def_id = cx.tcx.get_diagnostic_item(sym.needs_drop);
      if (def_id === undefined) return;
      cx.emit_span_lint(DYN_DROP, bound.span, DropGlue_diagnostic({ tcx: cx.tcx, def_id }));
    }
  }
};
