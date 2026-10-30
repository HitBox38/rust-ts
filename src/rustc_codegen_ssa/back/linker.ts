// Partial port of compiler/rustc_codegen_ssa/src/back/linker.rs: the exported/linked symbol lists that
// `CrateInfo::new` computes (`for_each_exported_symbols_include_dep` .. `linked_symbols`, linker.rs:1625 to the end of `linked_symbols`).
// The linker command builders (`get_linker`, the `Linker` trait and its per-flavor impls, `disable_localization`,
// the arg helpers) are linking (M7) and not ported.
import type { Dependencies } from "../../rustc_middle/middle/dependency_format.ts";
import {
  type ExportedSymbol,
  type SymbolExportInfo,
  SymbolExportKind,
  SymbolExportLevel,
  metadata_symbol_name as exported_symbols_metadata_symbol_name,
} from "../../rustc_middle/middle/exported_symbols.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { SymbolName } from "../../rustc_middle/ty/mod.ts";
import { generate_proc_macro_decls_symbol } from "../../rustc_session/session.ts";
import { type CrateNum, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import type { AllocatorKind } from "../../rustc_ast/expand/allocator.gen.ts";
import { panic } from "../../std/panic.ts";
import { needs_allocator_shim_for_linking } from "../base.ts";
import { SymbolExport } from "../lib.ts";
import * as symbol_export from "./symbol_export.ts";
import { allocator_shim_symbols } from "./symbol_export.ts";

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1625 for_each_exported_symbols_include_dep
function for_each_exported_symbols_include_dep(
  tcx: TyCtxt,
  crate_type: CrateType,
  callback: (symbol: ExportedSymbol, info: SymbolExportInfo, cnum: CrateNum) => void,
): void {
  const formats = tcx.dependency_formats(null) as Dependencies;
  const deps = formats.get(crate_type);
  if (deps === undefined) return panic("IndexMap: key not found");

  for (let i = 0; i < deps.length; i++) {
    const cnum = i as CrateNum;
    const dep_format = deps[i];
    // For each dependency that we are linking to statically ...
    if (dep_format === "Static") {
      for (const [symbol, info] of tcx.exported_non_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]) {
        callback(symbol, info, cnum);
      }
      for (const [symbol, info] of tcx.exported_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]) {
        callback(symbol, info, cnum);
      }
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1646 symbol_export_from_exported_symbol
function symbol_export_from_exported_symbol(tcx: TyCtxt, symbol: ExportedSymbol, kind: SymbolExportKind, cnum: CrateNum): SymbolExport {
  const name = symbol_export.exporting_symbol_name_for_instance_in_crate(tcx, symbol, cnum);
  const link_name = symbol_export.linking_symbol_name_for_instance_in_crate(tcx, symbol, kind, cnum);
  return SymbolExport.with_link_name(name, kind, link_name);
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1658 symbol_export_from_raw_name
function symbol_export_from_raw_name(tcx: TyCtxt, name: string, kind: SymbolExportKind): SymbolExport {
  const symbol: ExportedSymbol = { $: "NoDefId", _0: SymbolName.new(tcx, name) };
  const link_name = symbol_export.linking_symbol_name_for_instance_in_crate(tcx, symbol, kind, LOCAL_CRATE);
  return SymbolExport.with_link_name(name, kind, link_name);
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1669 exported_symbols
export function exported_symbols(tcx: TyCtxt, crate_type: CrateType): SymbolExport[] {
  const exports = tcx.sess.target.override_export_symbols;
  if (exports !== undefined) {
    return exports.map((name) =>
      symbol_export_from_raw_name(
        tcx,
        name,
        // FIXME use the correct export kind for this symbol. override_export_symbols
        // can't directly specify the SymbolExportKind as it is defined in rustc_middle
        // which rustc_target can't depend on.
        SymbolExportKind.Text,
      ),
    );
  }

  const symbols = crate_type === "ProcMacro" ? exported_symbols_for_proc_macro_crate(tcx) : exported_symbols_for_non_proc_macro(tcx, crate_type);

  // Preserve the metadata symbol to ensure the metadata section doesn't get removed by the
  // linker. On wasm however the metadata is put in a custom section, to which symbols can't
  // refer, so there is no metadata symbol there. Luckily custom sections are always preserved by
  // the linker.
  if ((crate_type === "Dylib" || crate_type === "ProcMacro") && !tcx.sess.target.is_like_wasm) {
    const metadata_symbol_name = exported_symbols_metadata_symbol_name(tcx);
    symbols.push(symbol_export_from_raw_name(tcx, metadata_symbol_name, SymbolExportKind.Data));
  }

  return symbols;
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1710 exported_symbols_for_non_proc_macro
function exported_symbols_for_non_proc_macro(tcx: TyCtxt, crate_type: CrateType): SymbolExport[] {
  const symbols: SymbolExport[] = [];
  const export_threshold = symbol_export.crates_export_threshold([crate_type]);
  for_each_exported_symbols_include_dep(tcx, crate_type, (symbol, info, cnum) => {
    // Do not export mangled symbols from cdylibs and don't attempt to export compiler-builtins
    // from any dylib. The latter doesn't work anyway as we use hidden visibility for
    // compiler-builtins. Most linkers silently ignore it, but ld64 gives a warning.
    if (SymbolExportLevel.is_below_threshold(info.level, export_threshold) && !tcx.is_compiler_builtins(cnum)) {
      symbols.push(symbol_export_from_exported_symbol(tcx, symbol, info.kind, cnum));
      symbol_export.extend_exported_symbols(symbols, tcx, symbol, cnum);
    }
  });

  // Mark allocator shim symbols as exported only if they were generated.
  let kind: AllocatorKind | undefined;
  if (
    export_threshold === "Rust" &&
    needs_allocator_shim_for_linking(tcx.dependency_formats(null) as Dependencies, crate_type) &&
    (kind = tcx.allocator_kind(null) as AllocatorKind | undefined) !== undefined
  ) {
    for (const [name, kind_] of allocator_shim_symbols(tcx, kind)) {
      symbols.push(symbol_export_from_raw_name(tcx, name, kind_));
    }
  }

  return symbols;
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1740 exported_symbols_for_proc_macro_crate
function exported_symbols_for_proc_macro_crate(tcx: TyCtxt): SymbolExport[] {
  // `exported_symbols` will be empty when !should_codegen.
  if (!tcx.sess.opts.output_types.should_codegen()) {
    return [];
  }

  const stable_crate_id = tcx.stable_crate_id(LOCAL_CRATE);
  const proc_macro_decls_name = generate_proc_macro_decls_symbol(stable_crate_id);

  return [symbol_export_from_raw_name(tcx, proc_macro_decls_name, SymbolExportKind.Data)];
}

// rustc: compiler/rustc_codegen_ssa/src/back/linker.rs:1752 linked_symbols
export function linked_symbols(tcx: TyCtxt, crate_type: CrateType): [string, SymbolExportKind][] {
  switch (crate_type) {
    case "Executable":
    case "ProcMacro":
    case "Cdylib":
    case "Dylib":
    case "Sdylib":
      break;
    case "StaticLib":
    case "Rlib":
      // These are not linked, so no need to generate symbols.o for them.
      return [];
  }

  switch (tcx.sess.lto()) {
    case "No":
    case "ThinLocal":
      break;
    case "Thin":
    case "Fat":
      // We really only need symbols from upstream rlibs to end up in the linked symbols list.
      // The rest are in separate object files which the linker will always link in and
      // doesn't have rules around the order in which they need to appear.
      // When doing LTO, some of the symbols in the linked symbols list happen to be
      // internalized by LTO, which then prevents referencing them from symbols.o. When doing
      // LTO, all object files that get linked in will be local object files rather than
      // pulled in from rlibs, so an empty linked symbols list works fine to avoid referencing
      // all those internalized symbols from symbols.o.
      return [];
  }

  const symbols: [string, SymbolExportKind][] = [];

  const export_threshold = symbol_export.crates_export_threshold([crate_type]);
  for_each_exported_symbols_include_dep(tcx, crate_type, (symbol, info, cnum) => {
    if ((SymbolExportLevel.is_below_threshold(info.level, export_threshold) && !tcx.is_compiler_builtins(cnum)) || info.used || info.rustc_std_internal_symbol) {
      symbols.push([symbol_export.linking_symbol_name_for_instance_in_crate(tcx, symbol, info.kind, cnum), info.kind]);
    }
  });

  return symbols;
}
