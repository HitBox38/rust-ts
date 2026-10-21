// Port of compiler/rustc_lint/src/multiple_supertrait_upcastable.rs. The lint static and the `declare_lint_pass!`
// expansion are generated (multiple_supertrait_upcastable.lints.gen.ts).
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { Clause } from "../rustc_middle/ty/decls.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyTraitClause } from "../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { LateContext } from "./context.ts";
import { MultipleSupertraitUpcastable_diagnostic } from "./diagnostics.gen.ts";
import { MULTIPLE_SUPERTRAIT_UPCASTABLE, MultipleSupertraitUpcastable } from "./multiple_supertrait_upcastable.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./multiple_supertrait_upcastable.lints.gen.ts";

declare module "./multiple_supertrait_upcastable.lints.gen.ts" {
  interface MultipleSupertraitUpcastable extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for MultipleSupertraitUpcastable
// rustc: compiler/rustc_lint/src/multiple_supertrait_upcastable.rs:40 check_item
MultipleSupertraitUpcastable.prototype.check_item = function (this: MultipleSupertraitUpcastable, cx: LateContext, item: hir.Item): void {
  const def_id = LocalDefId.to_def_id(item.owner_id.def_id);
  // NOTE(nbdd0121): use `dyn_compatibility_violations` instead of `is_dyn_compatible` because
  // the latter will report `where_clause_object_safety` lint.
  if (item.kind.$ === "Trait" && cx.tcx.is_dyn_compatible(def_id)) {
    const ident = item.kind.ident;
    // PORT: the lazy iterator chain is consumed by `count()` right away; its steps run in the same order here.
    let count = 0;
    for (const u of EarlyBinder.iter_identity_copied(cx.tcx.explicit_super_clauses_of(def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>)) {
      const [clause] = Unnormalized.skip_norm_wip(u);
      const pred = clause.as_trait_clause();
      if (pred === undefined) continue;
      if (cx.tcx.is_lang_item(PolyTraitClause.def_id(pred), LangItem.MetaSized)) continue;
      if (cx.tcx.is_default_trait(PolyTraitClause.def_id(pred))) continue;
      count += 1;
    }
    if (count > 1) {
      cx.emit_span_lint(MULTIPLE_SUPERTRAIT_UPCASTABLE, cx.tcx.def_span(def_id), MultipleSupertraitUpcastable_diagnostic({ ident }));
    }
  }
};
