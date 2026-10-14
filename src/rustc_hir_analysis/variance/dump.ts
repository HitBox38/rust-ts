// Port of compiler/rustc_hir_analysis/src/variance/dump.rs (lane variance-outlives): the `#[rustc_dump_variances]` and
// `#[rustc_dump_variances_of_opaques]` dumps.
//
// PORT notes (file-wide):
// - `find_attr!(tcx, id, Pat)` is `find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), ..)`, `find_attr!(tcx, crate, Pat)`
//   is `find_attr(tcx.hir_krate_attrs(), ..)` (as collect/dump.ts).
// - `String::with_capacity` + `push` / `write!` / `pop` build the same string with `+=` and `slice`.
// Init order: top-level code here touches only other crates.
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { debug_DefKind } from "../../rustc_hir/def.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { HasAttrs_LocalDefId } from "../../rustc_middle/ty/mod.ts";
import { display_GenericArg } from "../../rustc_middle/ty/print/pretty.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { debug_Variance, type Variance } from "../../rustc_type_ir/lib.ts";
import { PLAIN } from "../../std/fmt.ts";

// rustc: compiler/rustc_hir_analysis/src/variance/dump.rs:8 format_variances
function format_variances(tcx: TyCtxt, def_id: LocalDefId): string {
  const variances = tcx.variances_of(def_id) as readonly Variance[];
  const generics = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
  // 7 = 2-letter parameter + ": " + 1-letter variance + ", "
  let ret = "";
  ret += "[";
  const n = Math.min(generics.length, variances.length);
  for (let i = 0; i < n; i++) {
    const [arg, variance] = [generics[i]!, variances[i]!];
    ret += `${display_GenericArg(arg)}: ${debug_Variance(variance, PLAIN)}, `;
  }
  // Remove trailing `, `.
  if (variances.length !== 0) {
    ret = ret.slice(0, -1);
    ret = ret.slice(0, -1);
  }
  ret += "]";
  return ret;
}

// rustc: compiler/rustc_hir_analysis/src/variance/dump.rs:26 variances
export function variances(tcx: TyCtxt): void {
  const crate_items = tcx.hir_crate_items(null) as ModuleItems;

  if (find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "RustcDumpVariancesOfOpaques" ? null : undefined)) !== undefined) {
    for (const id of crate_items.opaques()) {
      tcx.dcx().span_err(tcx.def_span(id), format_variances(tcx, id));
    }
  }

  for (const id of crate_items.owners()) {
    if (!(find_attr(HasAttrs_LocalDefId.get_attrs(id.def_id, tcx), (k) => (k.$ === "RustcDumpVariances" ? null : undefined)) !== undefined)) {
      continue;
    }

    const kind = tcx.def_kind(id.def_id);
    switch (kind.$) {
      case "AssocFn":
      case "Fn":
      case "Enum":
      case "Struct":
      case "Union":
        tcx.dcx().span_err(tcx.def_span(id.def_id), format_variances(tcx, id.def_id));
        break;
      default: {
        const message = `attr parsing didn't report an error for \`#[${Symbol.as_str(sym.rustc_dump_variances)}]\` on ${debug_DefKind(kind, PLAIN)}`;
        tcx.dcx().span_delayed_bug(tcx.def_span(id.def_id), message);
      }
    }
  }
}
