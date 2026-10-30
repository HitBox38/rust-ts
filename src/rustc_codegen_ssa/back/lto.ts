// Partial port of compiler/rustc_codegen_ssa/src/back/lto.rs: `exported_symbols_for_lto`, which `CrateInfo::new`
// calls. The LTO machinery (`ThinModule`, `ThinShared`, `SerializedModule`, `crate_type_allows_lto`,
// `check_lto_allowed`, ...) is codegen (M7) and not ported.
import type { AllocatorKind } from "../../rustc_ast/expand/allocator.gen.ts";
import { type ExportedSymbol, type SymbolExportInfo, SymbolExportLevel } from "../../rustc_middle/middle/exported_symbols.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type CrateNum, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { allocator_kind_for_codegen } from "../base.ts";
import * as symbol_export from "./symbol_export.ts";
import { allocator_shim_symbols, symbol_name_for_instance_in_crate } from "./symbol_export.ts";

// rustc: compiler/rustc_codegen_ssa/src/back/lto.rs:89 exported_symbols_for_lto
export function exported_symbols_for_lto(tcx: TyCtxt, each_linked_rlib_for_lto: readonly CrateNum[]): string[] {
  let export_threshold: SymbolExportLevel;
  switch (tcx.sess.lto()) {
    // We're just doing LTO for our one crate
    case "ThinLocal":
      export_threshold = "Rust";
      break;

    // We're doing LTO for the entire crate graph
    case "Fat":
    case "Thin":
      export_threshold = symbol_export.crates_export_threshold(tcx.crate_types());
      break;

    case "No":
      return [];
  }

  const copy_symbols = (cnum: CrateNum): string[] =>
    [
      ...(tcx.exported_non_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]),
      ...(tcx.exported_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]),
    ].flatMap(([s, info]) => {
      if (SymbolExportLevel.is_below_threshold(info.level, export_threshold) || info.used) {
        return [symbol_name_for_instance_in_crate(tcx, s, cnum)];
      } else {
        return [];
      }
    });
  // PORT: the `tcx.prof.generic_activity("lto_generate_symbols_below_threshold")` timers are dropped (the profiler
  // stand-in records nothing; driver-m2 decision 8).
  const symbols_below_threshold = copy_symbols(LOCAL_CRATE);
  // info!("{} symbols to preserve in this crate", symbols_below_threshold.len());

  // If we're performing LTO for the entire crate graph, then for each of our
  // upstream dependencies, include their exported symbols.
  for (const cnum of each_linked_rlib_for_lto) {
    symbols_below_threshold.push(...copy_symbols(cnum));
  }

  // Mark allocator shim symbols as exported only if they were generated.
  let kind: AllocatorKind | undefined;
  if (export_threshold === "Rust" && (kind = allocator_kind_for_codegen(tcx)) !== undefined) {
    for (const [name] of allocator_shim_symbols(tcx, kind)) symbols_below_threshold.push(name);
  }

  return symbols_below_threshold;
}
