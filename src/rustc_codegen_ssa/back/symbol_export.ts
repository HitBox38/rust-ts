// Port of compiler/rustc_codegen_ssa/src/back/symbol_export.rs.
// PORT: `debug!` calls are comments (driver-m2 decision 8). `UnordMap::to_sorted(hcx, true)` over `DefId` keys sorts
// by the keys' stable hash key, the `DefPathHash` (`to_sorted_by_def_path_hash`, as in rustc_hir_typeck writeback.ts).
// `sort_by_cached_key` is a stable sort on keys computed once, in order (its index tie-break makes Rust's unstable sort
// stable); `SymbolName`'s derived `Ord` compares the `&str`s (`str_cmp`).
import { CanonAbi, type X86Call } from "../../rustc_abi/canon_abi.ts";
import { global_fn_name, NO_ALLOC_SHIM_IS_UNSTABLE } from "../../rustc_ast/expand/allocator.ts";
import type { AllocatorKind } from "../../rustc_ast/expand/allocator.gen.ts";
import type { Linkage } from "../../rustc_attr_ir/data_structures.ts";
import type { ForeignModule, NativeLib } from "../../rustc_crate_store/cstore.gen.ts";
import "../../rustc_crate_store/lib.ts"; // `NativeLib::wasm_import_module`
import type { CrateDepKind } from "../../rustc_crate_store/cstore.gen.ts";
import type { Constness } from "../../rustc_hir/hir.ts";
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs, type Visibility } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { ExportedSymbol, type SymbolExportInfo, SymbolExportKind, SymbolExportLevel } from "../../rustc_middle/middle/exported_symbols.ts";
import { MonoItem } from "../../rustc_middle/mono.ts";
import type { Providers } from "../../rustc_middle/util/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { debug_Instance, Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { display_SymbolName, SymbolName, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { Options_impl } from "../../rustc_session/config.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { type CrateNum, type DefId, DefIdMap, DefIdSet, debug_CrateNum, LOCAL_CRATE, type LocalDefId, LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { Span } from "../../rustc_span/span_encoding.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { NativeLibKind } from "../../rustc_structures/native_lib_kind.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import * as rustc_symbol_mangling from "../../rustc_symbol_mangling/lib.ts";
import { is_offload_kernel, mangle_internal_symbol } from "../../rustc_symbol_mangling/lib.ts";
import type { ArgAbi } from "../../rustc_target/callconv/mod.ts";
import { Arch, BinaryFormat } from "../../rustc_target/spec/mod.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { EarlyBinder as EarlyBinderC } from "../../rustc_type_ir/binder.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, unreachable } from "../../std/panic.ts";
import { allocator_shim_contents } from "../base.ts";
import { SymbolExport } from "../lib.ts";

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
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:64 reachable_non_generics_helper
export function reachable_non_generics_helper(tcx: TyCtxt): DefIdMap<SymbolExportInfo> {
  const is_compiler_builtins = tcx.is_compiler_builtins(LOCAL_CRATE);

  // PORT: `reachable_set(()).items()` is an unordered iteration collected into an `UnordMap`; every reader goes
  // through `get` / `to_sorted`, so the `Set`'s insertion order is never observed.
  const reachable_non_generics = new DefIdMap<SymbolExportInfo>();
  for (const reachable_def_id of tcx.reachable_set(null) as Set<LocalDefId>) {
    // .filter_map(|&def_id| { .. })
    const def_id = ((def_id: LocalDefId): LocalDefId | undefined => {
      // We want to ignore some FFI functions that are not exposed from
      // this crate. Reachable FFI functions can be lumped into two
      // categories:
      //
      // 1. Those that are included statically via a static library
      // 2. Those included otherwise (e.g., dynamically or via a framework)
      //
      // Although our LLVM module is not literally emitting code for the
      // statically included symbols, it's an export of our library which
      // needs to be passed on to the linker and encoded in the metadata.
      //
      // As a result, if this id is an FFI item (foreign item) then we only
      // let it through if it's included statically.
      const parent_id = tcx.opt_local_parent(def_id);
      if (parent_id !== undefined && tcx.def_kind(parent_id).$ === "ForeignMod") {
        const library = tcx.native_library(def_id) as NativeLib | undefined;
        if (library === undefined) return undefined;
        return NativeLibKind.is_statically_included(library.kind) ? def_id : undefined;
      }

      // Only consider nodes that actually have exported symbols.
      const def_kind = tcx.def_kind(def_id);
      if ((def_kind.$ === "Fn" || def_kind.$ === "AssocFn") && is_const_always(tcx.constness(def_id) as Constness)) {
        return undefined;
      } else if (def_kind.$ === "Fn" || def_kind.$ === "Static") {
        // {}
      } else if (def_kind.$ === "AssocFn" && tcx.impl_of_assoc(LocalDefIdC.to_def_id(def_id)) !== undefined) {
        // {}
      } else {
        return undefined;
      }

      const generics = tcx.generics_of(def_id) as Generics;
      if (generics.requires_monomorphization(tcx)) {
        return undefined;
      }

      if (InstanceKind.requires_inline(Instance.mono(tcx, LocalDefIdC.to_def_id(def_id)).def, tcx)) {
        return undefined;
      }

      return tcx.cross_crate_inlinable(def_id) ? undefined : def_id;
    })(reachable_def_id);
    if (def_id === undefined) continue;
    // .map(|def_id| { .. })
    const export_level = is_compiler_builtins
      ? // We don't want to export compiler-builtins symbols from any
        // dylibs, even rust dylibs. Unlike all other crates it gets
        // duplicated in every linker invocation and it may otherwise
        // unintentionally override definitions of these symbols by
        // libgcc or compiler-rt for C code.
        SymbolExportLevel.Rust
      : symbol_export_level(tcx, LocalDefIdC.to_def_id(def_id));
    const codegen_attrs = tcx.codegen_fn_attrs(LocalDefIdC.to_def_id(def_id)) as CodegenFnAttrs;
    // debug!(
    //     "EXPORTED SYMBOL (local): {} ({:?})",
    //     tcx.symbol_name(Instance::mono(tcx, def_id.to_def_id())),
    //     export_level
    // );
    const info: SymbolExportInfo = {
      level: export_level,
      kind: tcx.is_static(LocalDefIdC.to_def_id(def_id))
        ? CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.THREAD_LOCAL)
          ? SymbolExportKind.Tls
          : SymbolExportKind.Data
        : SymbolExportKind.Text,
      used:
        CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.USED_COMPILER) ||
        CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.USED_LINKER),
      rustc_std_internal_symbol:
        CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL) ||
        CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM),
    };
    reachable_non_generics.set(LocalDefIdC.to_def_id(def_id), info);
  }

  const id = tcx.proc_macro_decls_static(null) as LocalDefId | undefined;
  if (id !== undefined) {
    reachable_non_generics.set(LocalDefIdC.to_def_id(id), {
      level: SymbolExportLevel.C,
      kind: SymbolExportKind.Data,
      used: false,
      rustc_std_internal_symbol: false,
    });
  }

  return reachable_non_generics;
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
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:196 exported_non_generic_symbols_helper
export function exported_non_generic_symbols_helper(tcx: TyCtxt): readonly [ExportedSymbol, SymbolExportInfo][] {
  // FIXME: Sorting this is unnecessary since we are sorting later anyway.
  //        Can we skip the later sorting?
  const sorted = tcx.with_stable_hashing_context((_hcx) => {
    return to_sorted_by_def_path_hash(tcx, tcx.reachable_non_generics(LOCAL_CRATE) as DefIdMap<SymbolExportInfo>);
  });

  const symbols: [ExportedSymbol, SymbolExportInfo][] = sorted.map(([def_id, info]) => [{ $: "NonGeneric", _0: def_id }, info]);

  // Export TLS shims
  if (!tcx.sess.target.dll_tls_export) {
    for (const [def_id, info] of sorted) {
      if (tcx.needs_thread_local_shim(def_id)) {
        symbols.push([
          { $: "ThreadLocalShim", _0: def_id },
          {
            level: info.level,
            kind: SymbolExportKind.Text,
            used: info.used,
            rustc_std_internal_symbol: info.rustc_std_internal_symbol,
          },
        ]);
      }
    }
  }

  for (const [def_id, info] of sorted) {
    for (const [foreign_item, _linkage, _visibility] of (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).foreign_item_symbol_aliases) {
      symbols.push([{ $: "NonGeneric", _0: foreign_item }, info]);
    }
  }

  if (tcx.entry_fn(null) !== undefined) {
    const exported_symbol: ExportedSymbol = { $: "NoDefId", _0: SymbolName.new(tcx, tcx.sess.target.entry_name) };

    symbols.push([
      exported_symbol,
      {
        level: SymbolExportLevel.C,
        kind: SymbolExportKind.Text,
        used: false,
        rustc_std_internal_symbol: false,
      },
    ]);
  }

  const is_device_offload = tcx.sess.opts.unstable_opts.offload.some((o) => o.$ === "Device");
  if (is_device_offload) {
    const crate_items = tcx.hir_crate_items(null) as ModuleItems;
    const seen = new DefIdSet(
      symbols.flatMap(([s]) => {
        switch (s.$) {
          case "NonGeneric":
            return [s._0];
          default:
            return [];
        }
      }),
    );

    const try_emit_offload_kernel = (def_id: DefId, seen: DefIdSet): void => {
      const def_kind = tcx.def_kind(def_id);
      if (!(def_kind.$ === "Fn" || def_kind.$ === "AssocFn")) {
        return;
      }
      if (
        !(tcx.generics_of(def_id) as Generics).requires_monomorphization(tcx) &&
        is_offload_kernel(tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs) &&
        set_insert(seen, def_id)
      ) {
        symbols.push([
          { $: "NonGeneric", _0: def_id },
          {
            level: SymbolExportLevel.C,
            kind: SymbolExportKind.Text,
            used: false,
            rustc_std_internal_symbol: false,
          },
        ]);
      }
    };

    for (const id of crate_items.free_items()) {
      try_emit_offload_kernel(id.owner_id.to_def_id(), seen);
    }
    for (const id of crate_items.impl_items()) {
      try_emit_offload_kernel(id.owner_id.to_def_id(), seen);
    }
  }

  // Sort so we get a stable incr. comp. hash.
  sort_by_cached_symbol_name(tcx, symbols);

  return symbols;
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:299 exported_generic_symbols_provider_local
function exported_generic_symbols_provider_local(tcx: TyCtxt, _: unknown): readonly [ExportedSymbol, SymbolExportInfo][] {
  if (!tcx.sess.opts.output_types.should_codegen() && !tcx.is_sdylib_interface_build()) {
    return [];
  }

  const symbols: [ExportedSymbol, SymbolExportInfo][] = [];

  const export_generics = tcx.local_crate_exports_generics();
  const is_device_offload = tcx.sess.opts.unstable_opts.offload.some((o) => o.$ === "Device");

  if (export_generics || is_device_offload) {
    // use rustc_attr_ir::{InlineAttr, Linkage};
    // use rustc_middle::mono::{MonoItem, Visibility};
    // use rustc_middle::ty::InstanceKind;

    // Normally, we require that shared monomorphizations are not hidden,
    // because if we want to re-use a monomorphization from a Rust dylib, it
    // needs to be exported.
    // However, on platforms that don't allow for Rust dylibs, having
    // external linkage is enough for monomorphization to be linked to.
    const need_visibility = tcx.sess.target.dynamic_linking && !tcx.sess.target.only_cdylib;

    // PORT: `MonoItemPartitions` / `CodegenUnit` (rustc_middle mono.rs) are not ported (the query's value is `unknown`,
    // its provider is rustc_monomorphize's, M7); this is the shape read here: `codegen_units`, `CodegenUnit::items`
    // (an `FxIndexMap<MonoItem, MonoItemData>`) and `MonoItemData`'s `linkage` / `visibility`.
    const cgus = (
      tcx.collect_and_partition_mono_items(null) as {
        codegen_units: readonly { items(): ReadonlyMap<MonoItem, { linkage: Linkage; visibility: Visibility }> }[];
      }
    ).codegen_units;

    // Do not export symbols that cannot be instantiated by downstream crates.
    const reachable_set = tcx.reachable_set(null) as Set<LocalDefId>;
    const is_local_to_current_crate = (ty: Ty): boolean => {
      const no_refs = ty.peel_refs();
      let root_def_id: DefId;
      const kind = no_refs.kind();
      switch (kind.$) {
        case "Closure":
        case "FnDef":
        case "Coroutine":
        case "CoroutineClosure":
        case "CoroutineWitness":
          root_def_id = kind._0;
          break;
        default:
          return false;
      }
      const local_root_def_id = root_def_id.as_local();
      if (local_root_def_id === undefined) {
        return false;
      }

      const is_local = !reachable_set.has(local_root_def_id);
      return is_local;
    };

    const is_instantiable_downstream = (did: DefId | undefined, generic_args: GenericArgs): boolean => {
      return [
        ...generic_args.types(),
        ...(did === undefined ? [] : [EarlyBinderC.skip_binder(tcx.type_of(did) as EarlyBinder<Ty>)]),
      ].every((arg) => {
        return [...arg.walk()].every((ty) => {
          const t = GenericArg.as_type(ty);
          return t === undefined || !is_local_to_current_crate(t);
        });
      });
    };

    const is_offload_instance = (mono_item: MonoItem): boolean => {
      if (mono_item.$ === "Fn") {
        const instance = mono_item._0;
        return is_offload_kernel(tcx.codegen_fn_attrs(Instance.def_id(instance)) as CodegenFnAttrs);
      } else {
        return false;
      }
    };

    // The symbols created in this loop are sorted below it
    // #[allow(rustc::potential_query_instability)]
    for (const cgu of cgus) {
      for (const [mono_item, data] of cgu.items()) {
        if (data.linkage !== "External") {
          // We can only re-use things with external linkage, otherwise
          // we'll get a linker error
          continue;
        }

        if (need_visibility && data.visibility === "Hidden") {
          // If we potentially share things from Rust dylibs, they must
          // not be hidden
          continue;
        }

        const item_is_offload = is_offload_instance(mono_item);

        if (!item_is_offload && !Options_impl.share_generics(tcx.sess.opts)) {
          if ((tcx.codegen_fn_attrs(MonoItem.def_id(mono_item)) as CodegenFnAttrs).inline.$ === "Never") {
            // this is OK, we explicitly allow sharing inline(never) across crates even
            // without share-generics.
          } else {
            continue;
          }
        }

        // Note: These all set rustc_std_internal_symbol to false as generic functions must not
        // be marked with this attribute and we are only handling generic functions here.
        if (mono_item.$ === "Fn" && mono_item._0.def.$ === "Item") {
          const def = mono_item._0.def._0;
          const args = mono_item._0.args;
          const has_generics = iter_next(args.non_erasable_generics()) !== undefined;

          const should_export = item_is_offload ? has_generics : has_generics && is_instantiable_downstream(def, args);

          if (should_export) {
            const symbol: ExportedSymbol = { $: "Generic", _0: def, _1: args };
            symbols.push([
              symbol,
              {
                level: item_is_offload ? SymbolExportLevel.C : SymbolExportLevel.Rust,
                kind: SymbolExportKind.Text,
                used: false,
                rustc_std_internal_symbol: false,
              },
            ]);
          }
        } else if (
          mono_item.$ === "Fn" &&
          mono_item._0.def.$ === "Shim" &&
          mono_item._0.def._0.$ === "DropGlue" &&
          mono_item._0.def._0._1 !== undefined
        ) {
          const ty = mono_item._0.def._0._1;
          const args = mono_item._0.args;
          // A little sanity-check
          assert_first_non_erasable_is_type(args, ty);

          // Drop glue did is always going to be non-local outside of libcore, thus we don't need to check it's locality (which includes invoking `type_of` query).
          const kind = ty.kind();
          let should_export: boolean;
          switch (kind.$) {
            case "Adt":
              should_export = is_instantiable_downstream(undefined, kind._1);
              break;
            case "Closure":
              should_export = is_instantiable_downstream(undefined, kind._1);
              break;
            default:
              should_export = true;
          }

          if (should_export) {
            symbols.push([
              { $: "DropGlue", _0: ty },
              {
                level: SymbolExportLevel.Rust,
                kind: SymbolExportKind.Text,
                used: false,
                rustc_std_internal_symbol: false,
              },
            ]);
          }
        } else if (mono_item.$ === "Fn" && mono_item._0.def.$ === "Shim" && mono_item._0.def._0.$ === "AsyncDropGlueCtor") {
          const ty = mono_item._0.def._0._1;
          const args = mono_item._0.args;
          // A little sanity-check
          assert_first_non_erasable_is_type(args, ty);
          symbols.push([
            { $: "AsyncDropGlueCtorShim", _0: ty },
            {
              level: SymbolExportLevel.Rust,
              kind: SymbolExportKind.Text,
              used: false,
              rustc_std_internal_symbol: false,
            },
          ]);
        } else if (mono_item.$ === "Fn" && mono_item._0.def.$ === "Shim" && mono_item._0.def._0.$ === "AsyncDropGlue") {
          const def = mono_item._0.def._0._0;
          const ty = mono_item._0.def._0._1;
          symbols.push([
            { $: "AsyncDropGlue", _0: def, _1: ty },
            {
              level: SymbolExportLevel.Rust,
              kind: SymbolExportKind.Text,
              used: false,
              rustc_std_internal_symbol: false,
            },
          ]);
        } else {
          // Any other symbols don't qualify for sharing
        }
      }
    }
  }

  // Sort so we get a stable incr. comp. hash.
  sort_by_cached_symbol_name(tcx, symbols);

  return symbols;
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

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:603 allocator_shim_symbols
export function allocator_shim_symbols(tcx: TyCtxt, kind: AllocatorKind): [string, SymbolExportKind][] {
  return [
    ...allocator_shim_contents(tcx, kind).map((method) => mangle_internal_symbol(tcx, global_fn_name(method.name))),
    mangle_internal_symbol(tcx, NO_ALLOC_SHIM_IS_UNSTABLE),
  ].map((symbol_name): [string, SymbolExportKind] => {
    const exported_symbol: ExportedSymbol = { $: "NoDefId", _0: SymbolName.new(tcx, symbol_name) };

    return [exporting_symbol_name_for_instance_in_crate(tcx, exported_symbol, LOCAL_CRATE), SymbolExportKind.Text];
  });
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:625 symbol_export_level
function symbol_export_level(tcx: TyCtxt, sym_def_id: DefId): SymbolExportLevel {
  // We export anything that's not mangled at the "C" layer as it probably has
  // to do with ABI concerns. We do not, however, apply such treatment to
  // special symbols in the standard library for various plumbing between
  // core/std/allocators/etc. For example symbols used to hook up allocation
  // are not considered for export
  const codegen_fn_attrs = tcx.codegen_fn_attrs(sym_def_id) as CodegenFnAttrs;
  const is_extern = CodegenFnAttrs.contains_extern_indicator(codegen_fn_attrs);
  const std_internal = CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL);
  const eii = CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM);

  if (is_extern && !std_internal && !eii) {
    const target = tcx.sess.target.llvm_target;
    // WebAssembly cannot export data symbols, so reduce their export level
    // FIXME(jdonszelmann) don't do a substring match here.
    if (target.includes("emscripten")) {
      if (tcx.def_kind(sym_def_id).$ === "Static") {
        return SymbolExportLevel.Rust;
      }
    }

    return SymbolExportLevel.C;
  } else {
    return SymbolExportLevel.Rust;
  }
}

/// This is the symbol name of the given instance instantiated in a specific crate.
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:654 symbol_name_for_instance_in_crate
export function symbol_name_for_instance_in_crate(tcx: TyCtxt, symbol: ExportedSymbol, instantiating_crate: CrateNum): string {
  // If this is something instantiated in the local crate then we might
  // already have cached the name as a query result.
  if (instantiating_crate === LOCAL_CRATE) {
    return display_SymbolName(ExportedSymbol.symbol_name_for_local_instance(symbol, tcx));
  }

  // This is something instantiated in an upstream crate, so we have to use
  // the slower (because uncached) version of computing the symbol name.
  switch (symbol.$) {
    case "NonGeneric":
      return rustc_symbol_mangling.symbol_name_for_instance_in_crate(tcx, Instance.mono(tcx, symbol._0), instantiating_crate);
    case "Generic":
      return rustc_symbol_mangling.symbol_name_for_instance_in_crate(tcx, Instance.new_raw(symbol._0, symbol._1), instantiating_crate);
    case "ThreadLocalShim":
      return rustc_symbol_mangling.symbol_name_for_instance_in_crate(
        tcx,
        {
          def: { $: "Shim", _0: { $: "ThreadLocal", _0: symbol._0 } },
          args: RawList.empty(),
        },
        instantiating_crate,
      );
    case "DropGlue":
      return rustc_symbol_mangling.symbol_name_for_instance_in_crate(tcx, Instance.resolve_drop_glue(tcx, symbol._0), instantiating_crate);
    case "AsyncDropGlueCtorShim":
      return rustc_symbol_mangling.symbol_name_for_instance_in_crate(tcx, Instance.resolve_async_drop_in_place(tcx, symbol._0), instantiating_crate);
    case "AsyncDropGlue":
      return rustc_symbol_mangling.symbol_name_for_instance_in_crate(
        tcx,
        Instance.resolve_async_drop_in_place_poll(tcx, symbol._0, symbol._1),
        instantiating_crate,
      );
    case "NoDefId":
      return display_SymbolName(symbol._0);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:715 calling_convention_for_symbol
function calling_convention_for_symbol(tcx: TyCtxt, symbol: ExportedSymbol): [CanonAbi, readonly ArgAbi<Ty>[]] {
  let instance: Instance | undefined;
  if ((symbol.$ === "NonGeneric" || symbol.$ === "Generic") && tcx.is_static(symbol._0)) {
    instance = undefined;
  } else {
    switch (symbol.$) {
      case "NonGeneric":
        instance = Instance.mono(tcx, symbol._0);
        break;
      case "Generic":
        instance = Instance.new_raw(symbol._0, symbol._1);
        break;
      // DropGlue always use the Rust calling convention and thus follow the target's default
      // symbol decoration scheme.
      case "DropGlue":
        instance = undefined;
        break;
      // AsyncDropGlueCtorShim always use the Rust calling convention and thus follow the
      // target's default symbol decoration scheme.
      case "AsyncDropGlueCtorShim":
        instance = undefined;
        break;
      case "AsyncDropGlue":
        instance = undefined;
        break;
      // NoDefId always follow the target's default symbol decoration scheme.
      case "NoDefId":
        instance = undefined;
        break;
      // ThreadLocalShim always follow the target's default symbol decoration scheme.
      case "ThreadLocalShim":
        instance = undefined;
        break;
    }
  }

  if (instance === undefined) {
    // FIXME(workingjubilee): why don't we know the convention here?
    return [{ $: "Rust" }, []];
  }
  const i = instance;
  const r = tcx.fn_abi_of_instance(TypingEnv.fully_monomorphized().as_query_input([i, RawList.empty<Ty>()]));
  const fnabi = r.$ === "Ok" ? r._0 : bug(`fn_abi_of_instance(${debug_Instance(i, PLAIN)}) failed`);
  return [fnabi.conv, fnabi.args];
}

/// This is the symbol name of the given instance as seen by the linker.
///
/// On 32-bit Windows symbols are decorated according to their calling conventions.
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:755 linking_symbol_name_for_instance_in_crate
export function linking_symbol_name_for_instance_in_crate(
  tcx: TyCtxt,
  symbol: ExportedSymbol,
  export_kind: SymbolExportKind,
  instantiating_crate: CrateNum,
): string {
  let undecorated = symbol_name_for_instance_in_crate(tcx, symbol, instantiating_crate);

  // thread local will not be a function call,
  // so it is safe to return before windows symbol decoration check.
  const name = maybe_emutls_symbol_name(tcx, symbol, undecorated);
  if (name !== undefined) {
    return name;
  }

  const target = tcx.sess.target;
  if (!target.is_like_windows) {
    // Mach-O has a global "_" suffix and `object` crate will handle it.
    // ELF does not have any symbol decorations.
    return undecorated;
  }

  let prefix: string | undefined;
  if (target.arch.$ === "X86") {
    prefix = "_";
  } else if (target.arch.$ === "X86_64") {
    prefix = undefined;
  } else if (target.arch.$ === "Arm64EC" && export_kind === SymbolExportKind.Text) {
    // Only functions are decorated for arm64ec.
    prefix = "#";
  } else {
    // Only x86/64 and arm64ec use symbol decorations.
    return undecorated;
  }

  const [callconv, args] = calling_convention_for_symbol(tcx, symbol);

  // Decorate symbols with prefixes, suffixes and total number of bytes of arguments.
  // Reference: https://docs.microsoft.com/en-us/cpp/build/reference/decorated-names?view=msvc-170
  let decoration: [string, string];
  const x86_call: X86Call | undefined = callconv.$ === "X86" ? callconv._0 : undefined;
  if (x86_call === "Fastcall") {
    decoration = ["@", "@"];
  } else if (x86_call === "Stdcall") {
    decoration = ["_", "@"];
  } else if (x86_call === "Vectorcall") {
    decoration = ["", "@@"];
  } else {
    if (prefix !== undefined) {
      undecorated = prefix + undecorated;
    }
    return undecorated;
  }
  const [prefix_, suffix] = decoration;

  // PORT: `u64` byte counts of argument layouts stay far below 2^53.
  const align = target.pointer_width / 8;
  const args_in_bytes = args.map((abi) => next_multiple_of(abi.layout.size.bytes(), align)).reduce((a, b) => a + b, 0);
  return `${prefix_}${undecorated}${suffix}${args_in_bytes}`;
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:808 exporting_symbol_name_for_instance_in_crate
export function exporting_symbol_name_for_instance_in_crate(tcx: TyCtxt, symbol: ExportedSymbol, cnum: CrateNum): string {
  const undecorated = symbol_name_for_instance_in_crate(tcx, symbol, cnum);
  return maybe_emutls_symbol_name(tcx, symbol, undecorated) ?? undecorated;
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:817 strip_numeric_suffix
function strip_numeric_suffix(base: string, suffix: string, fallback: string): string {
  return parse_u32_is_ok(suffix) ? base : fallback;
}

/// COFF `IMAGE_FILE_MACHINE_*` for an arch with decorated symbols, or `None`.
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:822 coff_machine_for_arch
export function coff_machine_for_arch(arch: Arch): number | undefined {
  switch (arch.$) {
    case "X86":
      return pe.IMAGE_FILE_MACHINE_I386;
    case "X86_64":
      return pe.IMAGE_FILE_MACHINE_AMD64;
    case "Arm64EC":
      return pe.IMAGE_FILE_MACHINE_ARM64EC;
    default:
      return undefined;
  }
}

/// Undecorated counterpart of [`linking_symbol_name_for_instance_in_crate`].
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:832 undecorate_coff_symbol
export function undecorate_coff_symbol(name: string, machine: number, kind: SymbolExportKind): string {
  // MSVC C++ mangled names start with '?' and use a completely different
  // decorating scheme that includes '@@' as structural delimiters.
  // They must not be subjected to C calling-convention undecoration.
  if (name.startsWith("?")) {
    return name;
  }
  if (machine === pe.IMAGE_FILE_MACHINE_I386) {
    if (name.startsWith("@")) {
      const rest = name.slice(1);
      // fastcall: @foo@N -> foo
      const split = rsplit_once(rest, "@");
      return split !== undefined ? strip_numeric_suffix(split[0], split[1], name) : name;
    } else if (name.startsWith("_")) {
      const stripped = name.slice(1);
      const split = rsplit_once(stripped, "@");
      if (split !== undefined) {
        const [base, suffix] = split;
        // stdcall: _foo@N -> foo
        return strip_numeric_suffix(base, suffix, stripped);
      } else {
        // cdecl: _foo -> foo
        return stripped;
      }
    } else {
      // vectorcall: foo@@N -> foo
      const split = rsplit_once(name, "@@");
      return split !== undefined ? strip_numeric_suffix(split[0], split[1], name) : name;
    }
  } else if (machine === pe.IMAGE_FILE_MACHINE_AMD64) {
    // vectorcall: foo@@N -> foo
    const split = rsplit_once(name, "@@");
    return split !== undefined ? strip_numeric_suffix(split[0], split[1], name) : name;
  } else if (machine === pe.IMAGE_FILE_MACHINE_ARM64EC && kind === SymbolExportKind.Text) {
    // `#` prefix distinguishes ARM64EC text symbols from x64 thunks.
    return name.startsWith("#") ? name.slice(1) : name;
  } else {
    return name;
  }
}

/// On amdhsa, `gpu-kernel` functions have an associated metadata object with a `.kd` suffix.
/// Add it to the symbols list for all kernel functions, so that it is exported in the linked
/// object.
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:882 extend_exported_symbols
export function extend_exported_symbols(symbols: SymbolExport[], tcx: TyCtxt, symbol: ExportedSymbol, instantiating_crate: CrateNum): void {
  const [callconv] = calling_convention_for_symbol(tcx, symbol);

  if (callconv.$ !== "GpuKernel" || tcx.sess.target.os.$ !== "AmdHsa") {
    return;
  }

  const undecorated = symbol_name_for_instance_in_crate(tcx, symbol, instantiating_crate);

  // Add the symbol for the kernel descriptor (with .kd suffix)
  // Per https://llvm.org/docs/AMDGPUUsage.html#symbols these will always be `STT_OBJECT` so
  // export as data.
  symbols.push(SymbolExport.new(`${undecorated}.kd`, SymbolExportKind.Data));
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:902 maybe_emutls_symbol_name
function maybe_emutls_symbol_name(tcx: TyCtxt, symbol: ExportedSymbol, undecorated: string): string | undefined {
  // PORT: `Session` derefs to `EarlySession`, whose `tls_model` session.ts does not forward.
  if (tcx.sess.early_sess.tls_model() === "Emulated" && symbol.$ === "NonGeneric" && tcx.is_thread_local_static(symbol._0)) {
    // When using emutls, LLVM will add the `__emutls_v.` prefix to thread local symbols,
    // and exported symbol name need to match this.
    return `__emutls_v.${undecorated}`;
  } else {
    return undefined;
  }
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

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_export.rs:943 escape_symbol_name
export function escape_symbol_name(tcx: TyCtxt, symbol: string, span: Span): string {
  // https://github.com/llvm/llvm-project/blob/a55fbab0cffc9b4af497b9e4f187b61143743e06/llvm/lib/MC/MCSymbol.cpp
  // use rustc_target::spec::{Arch, BinaryFormat};
  if (symbol.length !== 0 && /^[0-9A-Za-z_$.]*$/.test(symbol)) {
    return symbol;
  }
  if (tcx.sess.target.binary_format === BinaryFormat.Xcoff) {
    tcx.sess
      .dcx()
      .span_fatal(span, `symbol escaping is not supported for the binary format ${BinaryFormat.display(tcx.sess.target.binary_format)}`);
  }
  if (tcx.sess.target.arch.$ === "Nvptx64") {
    tcx.sess.dcx().span_fatal(span, `symbol escaping is not supported for the architecture ${Arch.display(tcx.sess.target.arch)}`);
  }
  let escaped_symbol = "";
  escaped_symbol += '"';
  for (const c of symbol) {
    switch (c) {
      case "\n":
        escaped_symbol += "\\\n";
        break;
      case '"':
        escaped_symbol += '\\"';
        break;
      case "\\":
        escaped_symbol += "\\\\";
        break;
      default:
        escaped_symbol += c;
    }
  }
  escaped_symbol += '"';
  return escaped_symbol;
}

// ---- local helpers (not upstream fns) --------------------------------------------------------------------------

/** `matches!(c, hir::Constness::Const { always: true })` */
function is_const_always(c: Constness): boolean {
  return c.$ === "Const" && c.always === true;
}

/** `UnordMap<DefId, V>::to_sorted(hcx, true)`: the entries sorted by the keys' stable hash key, the `DefPathHash`. */
function to_sorted_by_def_path_hash<V>(tcx: TyCtxt, map: DefIdMap<V>): [DefId, V][] {
  const keyed = [...map].map(([def_id, v]) => [tcx.def_path_hash(def_id), def_id, v] as const);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return keyed.map(([, def_id, v]) => [def_id, v]);
}

/** `symbols.sort_by_cached_key(|s| s.0.symbol_name_for_local_instance(tcx))` */
function sort_by_cached_symbol_name(tcx: TyCtxt, symbols: [ExportedSymbol, SymbolExportInfo][]): void {
  const keyed = symbols.map((s) => [display_SymbolName(ExportedSymbol.symbol_name_for_local_instance(s[0], tcx)), s] as const);
  keyed.sort((a, b) => str_cmp(a[0], b[0]));
  for (let i = 0; i < keyed.length; i++) symbols[i] = keyed[i]![1];
}

/** `FxHashSet::insert`: `true` when the value was not present. */
function set_insert(set: DefIdSet, def_id: DefId): boolean {
  if (set.has(def_id)) return false;
  set.add(def_id);
  return true;
}

/** `assert_eq!(args.non_erasable_generics().next(), Some(GenericArgKind::Type(ty)))`. PORT: `Option<GenericArgKind>` has no Debug helper here; the panic message omits the left/right values. */
function assert_first_non_erasable_is_type(args: GenericArgs, ty: Ty): void {
  const first = iter_next(args.non_erasable_generics());
  assert(first !== undefined && first.$ === "Type" && first._0 === ty, "assertion `left == right` failed");
}

/** `Iterator::next` on a fresh iterator. */
function iter_next<T>(it: Iterable<T>): T | undefined {
  const r = it[globalThis.Symbol.iterator]().next();
  return r.done === true ? undefined : r.value;
}

/** `u64::next_multiple_of` */
function next_multiple_of(x: number, rhs: number): number {
  const r = x % rhs;
  return r === 0 ? x : x + (rhs - r);
}

/** `str::parse::<u32>().is_ok()`: an optional `+`, then one or more ASCII digits, value at most `u32::MAX`. */
function parse_u32_is_ok(s: string): boolean {
  const digits = s.startsWith("+") ? s.slice(1) : s;
  if (!/^[0-9]+$/.test(digits)) return false;
  return BigInt(digits) <= 0xffff_ffffn;
}

/** `str::rsplit_once(delimiter)` */
function rsplit_once(s: string, delimiter: string): [string, string] | undefined {
  const i = s.lastIndexOf(delimiter);
  if (i < 0) return undefined;
  return [s.slice(0, i), s.slice(i + delimiter.length)];
}

// PORT: `object::pe` (object-0.39.1 src/pe.rs:310, :359, :365); the `object` crate is not vendored.
const pe = {
  IMAGE_FILE_MACHINE_I386: 0x014c,
  IMAGE_FILE_MACHINE_AMD64: 0x8664,
  IMAGE_FILE_MACHINE_ARM64EC: 0xa641,
} as const;
