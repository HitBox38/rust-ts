// Port of compiler/rustc_hir_analysis/src/outlives/dump.rs (lane variance-outlives): the `#[rustc_dump_inferred_outlives]`
// dump.
//
// PORT notes (file-wide):
// - `find_attr!(tcx, id, Pat)` is `find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), ..)` (as collect/dump.ts).
// - `p.to_string()` of an `OutlivesClause<Region>` / `OutlivesClause<Ty>` is rustc_type_ir ir_print.ts's
//   `display_OutlivesClause` over TyCtxt's `IrPrint` impl (`IrPrint_print` of rustc_middle ty/print/mod.ts) for
//   `print_OutlivesClause` (pretty.ts); `ir_print_OutlivesClause` builds that impl object.
// - `preds.sort()` sorts `String`s by bytes: `sort_strings` compares UTF-8 bytes, not UTF-16 code units.
// Init order: top-level code here touches only other crates.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { HasAttrs_LocalDefId } from "../../rustc_middle/ty/mod.ts";
import { IrPrint_print, IrPrint_print_debug, type Print, print_Region, print_Ty } from "../../rustc_middle/ty/print/mod.ts";
import type { FmtPrinter } from "../../rustc_middle/ty/print/pretty.ts";
import { print_OutlivesClause } from "../../rustc_middle/ty/print/pretty.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { debug_ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { display_OutlivesClause, type IrPrint } from "../../rustc_type_ir/ir_print.ts";
import type { OutlivesClause } from "../../rustc_type_ir/predicate.gen.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../../std/fmt.ts";

// rustc: compiler/rustc_hir_analysis/src/outlives/dump.rs:5 inferred_outlives
export function inferred_outlives(tcx: TyCtxt): void {
  for (const id of tcx.hir_free_items()) {
    if (!(find_attr(HasAttrs_LocalDefId.get_attrs(id.owner_id.def_id, tcx), (k) => (k.$ === "RustcDumpInferredOutlives" ? null : undefined)) !== undefined)) {
      continue;
    }

    const preds_ = tcx.inferred_outlives_of(id.owner_id) as readonly (readonly [Clause, Span])[];
    const preds: string[] = preds_.map(([pred, _]) => {
      const k = Binder.skip_binder(pred.kind());
      switch (k.$) {
        case "RegionOutlives":
          return display_OutlivesClause(k._0, ir_print_OutlivesClause<Region>(print_Region));
        case "TypeOutlives":
          return display_OutlivesClause(k._0, ir_print_OutlivesClause<Ty>(print_Ty));
        default:
          return bug(`unexpected clause ${debug_ClauseKind(k, PLAIN)}`);
      }
    });
    sort_strings(preds);

    const span = tcx.def_span(id.owner_id.def_id);
    const err = tcx.dcx().struct_span_err(span, Symbol.as_str(sym.rustc_dump_inferred_outlives));
    for (const pred of preds) {
      err.note(pred);
    }
    err.emit();
  }
}

/** PORT: `impl IrPrint<OutlivesClause<T>> for TyCtxt` (the blanket impl, rustc_middle ty/print/mod.rs:423) over `T`'s `Print`. */
function ir_print_OutlivesClause<T>(print_T: Print<T, FmtPrinter>): IrPrint<OutlivesClause<T>> {
  const print = (s: OutlivesClause<T>, p: FmtPrinter) => print_OutlivesClause(s, p, print_T);
  return {
    print: (t, fmt) => IrPrint_print(t, fmt, print),
    print_debug: (t, fmt) => IrPrint_print_debug(t, fmt, print),
  };
}

/** `<[String]>::sort` (byte-wise `Ord` of `str`). */
function sort_strings(v: string[]): void {
  const enc = new TextEncoder();
  const keyed = v.map((s) => [s, enc.encode(s)] as const);
  keyed.sort(([, a], [, b]) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
  });
  for (let i = 0; i < v.length; i++) v[i] = keyed[i]![0];
}
