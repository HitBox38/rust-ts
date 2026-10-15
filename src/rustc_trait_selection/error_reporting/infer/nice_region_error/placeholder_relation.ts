// Port of compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_relation.rs (lane errrep-nice-region).
//
// `impl NiceRegionError` methods are assigned onto `NiceRegionError.prototype` (declared in the crate decls.ts).
// Init order: top-level code here touches only ./mod.ts (`NiceRegionError`) and other crates; the crate's diagnostics
// module is read inside function bodies only.
import type { Diag } from "../../../../rustc_errors/lib.ts";
import type { Span } from "../../../../rustc_span/lib.ts";
import { bug } from "../../../../rustc_span/macros.ts";
import type { Symbol } from "../../../../rustc_span/symbol.ts";
import type { BoundRegionKind } from "../../../../rustc_type_ir/binder.ts";
import type { PlaceholderRelationLfNotSatisfied } from "../../../diagnostics.gen.ts";
import { NiceRegionError } from "./mod.ts";

/** The crate's diagnostics.gen.ts (read lazily, init order). */
function diagnostics_gen(): typeof import("../../../diagnostics.gen.ts") {
  return require("../../../diagnostics.gen.ts") as typeof import("../../../diagnostics.gen.ts");
}

// impl<'tcx> NiceRegionError<'_, 'tcx> {
/// Emitted wwhen given a `ConcreteFailure` when relating two placeholders.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/nice_region_error/placeholder_relation.rs:12 try_report_placeholder_relation
NiceRegionError.prototype.try_report_placeholder_relation = function (this: NiceRegionError): Diag | undefined {
  const e = this.error;
  let sub_k, sup_k;
  if (
    e !== undefined &&
    e.$ === "ConcreteFailure" &&
    e._0.$ === "RelateRegionParamBound" &&
    (sub_k = e._1.kind()).$ === "RePlaceholder" &&
    (sup_k = e._2.kind()).$ === "RePlaceholder"
  ) {
    const sub_name: BoundRegionKind = sub_k._0.bound.kind;
    const sup_name: BoundRegionKind = sup_k._0.bound.kind;
    const span = e._0._0;
    let sub_span: Span | undefined;
    let sub_symbol: Symbol | undefined;
    switch (sub_name.$) {
      case "Named": {
        const def_id = sub_name._0;
        [sub_span, sub_symbol] = [this.tcx().def_span(def_id), this.tcx().item_name(def_id)];
        break;
      }
      case "Anon":
      case "ClosureEnv":
        [sub_span, sub_symbol] = [undefined, undefined];
        break;
      case "NamedForPrinting":
        return bug("only used for pretty printing");
    }
    let sup_span: Span | undefined;
    let sup_symbol: Symbol | undefined;
    switch (sup_name.$) {
      case "Named": {
        const def_id = sup_name._0;
        [sup_span, sup_symbol] = [this.tcx().def_span(def_id), this.tcx().item_name(def_id)];
        break;
      }
      case "Anon":
      case "ClosureEnv":
        [sup_span, sup_symbol] = [undefined, undefined];
        break;
      case "NamedForPrinting":
        return bug("only used for pretty printing");
    }
    let diag: PlaceholderRelationLfNotSatisfied;
    if (sub_span !== undefined && sup_span !== undefined && sub_symbol !== undefined && sup_symbol !== undefined) {
      diag = { $: "HasBoth", span, sub_span, sup_span, sub_symbol, sup_symbol, note: null };
    } else if (sub_span !== undefined && sup_span !== undefined && sup_symbol !== undefined) {
      diag = { $: "HasSup", span, sub_span, sup_span, sup_symbol, note: null };
    } else if (sub_span !== undefined && sup_span !== undefined && sub_symbol !== undefined) {
      diag = { $: "HasSub", span, sub_span, sup_span, sub_symbol, note: null };
    } else if (sub_span !== undefined && sup_span !== undefined) {
      diag = { $: "HasNone", span, sub_span, sup_span, note: null };
    } else {
      diag = { $: "OnlyPrimarySpan", span, note: null };
    }
    return this.tcx().dcx().create_err(diagnostics_gen().PlaceholderRelationLfNotSatisfied_diagnostic(diag));
  }
  return undefined;
};
// }
