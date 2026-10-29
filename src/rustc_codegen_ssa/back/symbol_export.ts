// Partial port of compiler/rustc_codegen_ssa/src/back/symbol_export.rs: the export thresholds, the query
// providers and `provide`. With `!should_codegen()` (D5: `--emit=metadata`) the local providers return empty sets
// before reaching their codegen helpers; those helpers (`reachable_non_generics_helper` :64,
// `exported_non_generic_symbols_helper` :196, the body of `exported_generic_symbols_provider_local` after its early
// exit) and the symbol naming/decoration functions (`allocator_shim_symbols` .. `escape_symbol_name`) are M7 and
// call `unported`.
import { assert, assert_eq, unported, unreachable } from "../../std/panic.ts";
import type { ForeignModule, NativeLib } from "../../rustc_crate_store/cstore.gen.ts";
import "../../rustc_crate_store/lib.ts"; // `NativeLib::wasm_import_module`
import type { CrateDepKind } from "../../rustc_crate_store/cstore.gen.ts";
import type { Providers } from "../../rustc_middle/util/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { type CrateNum, type DefId, DefIdMap, debug_CrateNum, LOCAL_CRATE, type LocalDefId, LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { SymbolExportKind } from "../lib.ts";

// PORT: `rustc_middle::middle::exported_symbols` (middle/exported_symbols.rs) is not ported; the types this file
// matches on are declared here as upstream defines them.

/// The SymbolExportLevel of a symbols specifies from which kinds of crates
/// the symbol will be exported. `C` symbols will be exported from any
/// kind of crate, including cdylibs which export very few things.
/// `Rust` will only be exported if the crate produced is a Rust
/// dylib.
export type SymbolExportLevel = "C" | "Rust";
export const SymbolExportLevel = {
  C: "C",
  Rust: "Rust",
  // rustc: compiler/rustc_middle/src/middle/exported_symbols.rs:18 is_below_threshold
  is_below_threshold(self: SymbolExportLevel, threshold: SymbolExportLevel): boolean {
    return (
      threshold === "Rust" || // export everything from Rust dylibs
      self === "C"
    );
  },
} as const;

/// The `SymbolExportInfo` of a symbols specifies symbol-related information
/// that is relevant to code generation and linking.
export interface SymbolExportInfo {
  level: SymbolExportLevel;
  kind: SymbolExportKind;
  /// Was the symbol marked as `#[used(compiler)]` or `#[used(linker)]`?
  used: boolean;
  /// Was the symbol marked as `#[rustc_std_internal_symbol]`?
  /// We also use this for externally implementable items.
  rustc_std_internal_symbol: boolean;
}

export type ExportedSymbol =
  | { readonly $: "NonGeneric"; readonly _0: DefId }
  | { readonly $: "Generic"; readonly _0: DefId; readonly _1: GenericArgs }
  | { readonly $: "DropGlue"; readonly _0: Ty }
  | { readonly $: "AsyncDropGlueCtorShim"; readonly _0: Ty }
  | { readonly $: "AsyncDropGlue"; readonly _0: DefId; readonly _1: Ty }
  | { readonly $: "ThreadLocalShim"; readonly _0: DefId }
  | { readonly $: "NoDefId"; readonly _0: unknown /* ty::SymbolName<'tcx> */ };

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:31 threshold
function threshold(tcx: TyCtxt): SymbolExportLevel {
  return crates_export_threshold(tcx.crate_types());
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:35 crate_export_threshold
function crate_export_threshold(crate_type: CrateType): SymbolExportLevel {
  switch (crate_type) {
    case "Executable":
    case "StaticLib":
    case "ProcMacro":
    case "Cdylib":
      return "C";
    case "Rlib":
    case "Dylib":
    case "Sdylib":
      return "Rust";
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:44 crates_export_threshold
export function crates_export_threshold(crate_types: readonly CrateType[]): SymbolExportLevel {
  if (crate_types.some((crate_type) => crate_export_threshold(crate_type) === "Rust")) {
    return "Rust";
  } else {
    return "C";
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:55 reachable_non_generics_provider
function reachable_non_generics_provider(tcx: TyCtxt, _: unknown): DefIdMap<SymbolExportInfo> {
  if (!tcx.sess.opts.output_types.should_codegen() && !tcx.is_sdylib_interface_build()) {
    return new DefIdMap();
  }

  return reachable_non_generics_helper(tcx);
}

/// Exposed separately *without* the "should codegen" check so Miri can access it.
/** `reachable_non_generics_helper` (symbol_export.rs:64). PORT: not ported (codegen, M7). */
function reachable_non_generics_helper(_tcx: TyCtxt): never {
  return unported("rustc_codegen_ssa::back::symbol_export::reachable_non_generics_helper (codegen; M7)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:170 is_reachable_non_generic_provider_local
function is_reachable_non_generic_provider_local(tcx: TyCtxt, def_id: LocalDefId): boolean {
  const export_threshold = threshold(tcx);

  const info = (tcx.reachable_non_generics(LOCAL_CRATE) as DefIdMap<SymbolExportInfo>).get(LocalDefIdC.to_def_id(def_id));
  if (info !== undefined) {
    return SymbolExportLevel.is_below_threshold(info.level, export_threshold);
  } else {
    return false;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:180 is_reachable_non_generic_provider_extern
function is_reachable_non_generic_provider_extern(tcx: TyCtxt, def_id: DefId): boolean {
  return tcx.reachable_non_generics(def_id.krate).has(def_id);
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:184 exported_non_generic_symbols_provider_local
function exported_non_generic_symbols_provider_local(tcx: TyCtxt, _: unknown): readonly [ExportedSymbol, SymbolExportInfo][] {
  if (!tcx.sess.opts.output_types.should_codegen() && !tcx.is_sdylib_interface_build()) {
    return [];
  }

  return exported_non_generic_symbols_helper(tcx);
}

/// Exposed separately *without* the "should codegen" check so Miri can access it.
/** `exported_non_generic_symbols_helper` (symbol_export.rs:196). PORT: not ported (codegen, M7). */
function exported_non_generic_symbols_helper(_tcx: TyCtxt): never {
  return unported("rustc_codegen_ssa::back::symbol_export::exported_non_generic_symbols_helper (codegen; M7)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:299 exported_generic_symbols_provider_local
function exported_generic_symbols_provider_local(tcx: TyCtxt, _: unknown): readonly [ExportedSymbol, SymbolExportInfo][] {
  if (!tcx.sess.opts.output_types.should_codegen() && !tcx.is_sdylib_interface_build()) {
    return [];
  }

  // let mut symbols: Vec<_> = vec![]; `local_crate_exports_generics`, device offload, the mono items of
  // `collect_and_partition_mono_items`, sorting by `symbol_name_for_local_instance`.
  return unported("rustc_codegen_ssa::back::symbol_export::exported_generic_symbols_provider_local (codegen; M7)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:495 upstream_monomorphizations_provider
function upstream_monomorphizations_provider(tcx: TyCtxt, _: null): DefIdMap<Map<GenericArgs, CrateNum>> {
  const cnums = tcx.crates(null);

  const instances = new DefIdMap<Map<GenericArgs, CrateNum>>();

  const drop_glue_fn_def_id = tcx.lang_items().drop_glue_fn();
  const async_drop_in_place_fn_def_id = tcx.lang_items().async_drop_in_place_fn();

  for (const cnum of cnums) {
    // It should be possible to compile to build a crate against a conditional dependency then
    // later link that crate without the conditional dependency, so we cannot use exported
    // generics from conditional dependencies.
    // https://github.com/rust-lang/rust/issues/159682
    if ((tcx.crate_dep_kind(cnum) as CrateDepKind) === "Conditional") {
      continue;
    }

    for (const [exported_symbol] of tcx.exported_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]) {
      let def_id: DefId;
      let args: GenericArgs;
      switch (exported_symbol.$) {
        case "Generic":
          def_id = exported_symbol._0;
          args = exported_symbol._1;
          break;
        case "DropGlue":
          if (drop_glue_fn_def_id !== undefined) {
            def_id = drop_glue_fn_def_id;
            args = tcx.mk_args([exported_symbol._0]);
            break;
          } else {
            // `drop_glue` does not exist, don't try to use it.
            continue;
          }
        case "AsyncDropGlueCtorShim":
          if (async_drop_in_place_fn_def_id !== undefined) {
            def_id = async_drop_in_place_fn_def_id;
            args = tcx.mk_args([exported_symbol._0]);
            break;
          } else {
            continue;
          }
        case "AsyncDropGlue":
          def_id = exported_symbol._0;
          args = tcx.mk_args([exported_symbol._1]);
          break;
        case "NonGeneric":
        case "ThreadLocalShim":
        case "NoDefId":
          // PORT: `{exported_symbol:?}`: `ExportedSymbol`'s Debug is not ported; the variant name stands in.
          return unreachable(`internal error: entered unreachable code: ${exported_symbol.$}`);
      }

      let args_map = instances.get(def_id);
      if (args_map === undefined) {
        args_map = new Map();
        instances.set(def_id, args_map);
      }

      const e = args_map.get(args);
      if (e !== undefined) {
        // If there are multiple monomorphizations available,
        // we select one deterministically.
        const other_cnum = e;
        if (tcx.stable_crate_id(other_cnum) > tcx.stable_crate_id(cnum)) {
          args_map.set(args, cnum);
        }
      } else {
        args_map.set(args, cnum);
      }
    }
  }

  return instances;
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:560 upstream_monomorphizations_for_provider
function upstream_monomorphizations_for_provider(tcx: TyCtxt, def_id: DefId): Map<GenericArgs, CrateNum> | undefined {
  assert(!def_id.is_local(), "assertion failed: !def_id.is_local()");
  return (tcx.upstream_monomorphizations(null) as DefIdMap<Map<GenericArgs, CrateNum>>).get(def_id);
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:568 upstream_drop_glue_for_provider
function upstream_drop_glue_for_provider(tcx: TyCtxt, args: GenericArgs): CrateNum | undefined {
  const def_id = tcx.lang_items().drop_glue_fn();
  if (def_id === undefined) return undefined;
  return (tcx.upstream_monomorphizations_for(def_id) as Map<GenericArgs, CrateNum> | undefined)?.get(args);
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:576 upstream_async_drop_glue_for_provider
function upstream_async_drop_glue_for_provider(tcx: TyCtxt, args: GenericArgs): CrateNum | undefined {
  const def_id = tcx.lang_items().async_drop_in_place_fn();
  if (def_id === undefined) return undefined;
  return (tcx.upstream_monomorphizations_for(def_id) as Map<GenericArgs, CrateNum> | undefined)?.get(args);
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:584 is_unreachable_local_definition_provider
function is_unreachable_local_definition_provider(tcx: TyCtxt, def_id: LocalDefId): boolean {
  return !(tcx.reachable_set(null) as Set<LocalDefId>).has(def_id);
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:588 provide
export function provide(providers: Providers): void {
  providers.queries.reachable_non_generics = reachable_non_generics_provider;
  providers.queries.is_reachable_non_generic = is_reachable_non_generic_provider_local;
  providers.queries.exported_non_generic_symbols = exported_non_generic_symbols_provider_local;
  providers.queries.exported_generic_symbols = exported_generic_symbols_provider_local;
  providers.queries.upstream_monomorphizations = upstream_monomorphizations_provider;
  providers.queries.is_unreachable_local_definition = is_unreachable_local_definition_provider;
  providers.queries.upstream_drop_glue_for = upstream_drop_glue_for_provider as never;
  providers.queries.upstream_async_drop_glue_for = upstream_async_drop_glue_for_provider as never;
  providers.queries.wasm_import_module_map = wasm_import_module_map;
  providers.extern_queries.is_reachable_non_generic = is_reachable_non_generic_provider_extern;
  providers.extern_queries.upstream_monomorphizations_for = upstream_monomorphizations_for_provider;
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:919 wasm_import_module_map
function wasm_import_module_map(tcx: TyCtxt, cnum: CrateNum): DefIdMap<string> {
  // Build up a map from DefId to a `NativeLib` structure, where
  // `NativeLib` internally contains information about
  // `#[link(wasm_import_module = "...")]` for example.
  const native_libs = tcx.native_libraries(cnum) as NativeLib[];

  const def_id_to_native_lib = new DefIdMap<NativeLib>();
  for (const lib of native_libs) {
    if (lib.foreign_module !== undefined) def_id_to_native_lib.set(lib.foreign_module, lib);
  }

  const ret = new DefIdMap<string>();
  for (const [def_id, lib] of tcx.foreign_modules(cnum) as Map<DefId, ForeignModule>) {
    const module = def_id_to_native_lib.get(def_id)?.wasm_import_module();
    if (module === undefined) continue;
    for (const id of lib.foreign_items) {
      assert_eq(id.krate, cnum, (c) => debug_CrateNum(c, PLAIN));
      ret.set(id, Symbol.as_str(module));
    }
  }

  return ret;
}
