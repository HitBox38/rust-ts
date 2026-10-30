// Partial port of compiler/rustc_codegen_ssa/src/base.rs: what the metadata-only driver path reaches
// (`collect_eii_linkage`, `eii_linkage_needed`, `CrateInfo::new`, `provide`). Codegen proper (comparisons,
// unsizing, `codegen_instance`, entry wrappers, allocator shims, `codegen_crate`, `determine_cgu_reuse`, ...) is
// M7 and not ported.
import type { EiiDecl, EiiImpl } from "../rustc_attr_ir/data_structures.gen.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { CrateDepKind, CrateSource, NativeLib as cstore_NativeLib } from "../rustc_crate_store/cstore.gen.ts";
import { CrateDepKind as CrateDepKindC } from "../rustc_crate_store/cstore.ts";
import { required as lang_items_required } from "../rustc_middle/middle/lang_items.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { OptLevel } from "../rustc_session/config.ts";
import { type CrateNum, type DefId, DefIdMap, LOCAL_CRATE, lower_hex_StableCrateId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import { mangle_internal_symbol } from "../rustc_symbol_mangling/v0.ts";
import { PLAIN } from "../std/fmt.ts";
import { bug } from "../rustc_span/macros.ts";
import { unported } from "../std/panic.ts";
import { str_cmp } from "../rustc_session/options.ts";
import type { Dependencies } from "../rustc_middle/middle/dependency_format.ts";
import { are_upstream_rust_objects_already_included } from "./back/link.ts";
import {
  CodegenLintLevelSpecs,
  type CrateInfo,
  type EiiLinkageImplInfo,
  type EiiLinkageInfo,
  NativeLib_from,
  type SymbolExportKind,
} from "./lib.ts";

// rustc: compiler/rustc_codegen_ssa/src/base.rs:954 collect_eii_linkage
function collect_eii_linkage(tcx: TyCtxt): EiiLinkageInfo[] {
  // #[derive(Debug)]
  interface FoundImpl {
    imp: EiiImpl;
    impl_crate: CrateNum;
  }

  // #[derive(Debug)]
  interface FoundEii {
    decl: EiiDecl;
    impls: DefIdMap<FoundImpl>;
  }

  const eiis = new DefIdMap<FoundEii>();

  for (const cnum of [...tcx.crates(null), LOCAL_CRATE]) {
    for (const [did, [decl, impls]] of tcx.externally_implementable_items(cnum) as Map<DefId, [EiiDecl, Map<DefId, EiiImpl>]>) {
      let entry = eiis.get(did);
      if (entry === undefined) {
        entry = { decl, impls: new DefIdMap() };
        eiis.set(did, entry);
      }
      for (const [did, imp] of impls) {
        entry.impls.set(did, { imp, impl_crate: cnum });
      }
    }
  }

  const out: EiiLinkageInfo[] = [];
  for (const [, { decl, impls }] of eiis) {
    const explicit_impls: EiiLinkageImplInfo[] = [];
    let default_impl: EiiLinkageImplInfo | undefined = undefined;

    for (const [impl_did, { imp, impl_crate }] of impls) {
      const impl_info: EiiLinkageImplInfo = { span: tcx.def_span(impl_did), impl_crate };
      if (imp.is_default) {
        default_impl = impl_info;
      } else {
        explicit_impls.push(impl_info);
      }
    }

    // Link time check is only needed when there may be a default impl in a dylib.
    // Other cases emit an error in `rustc_passes` already.
    if (default_impl !== undefined) {
      out.push({
        name: decl.name.name,
        impls: explicit_impls,
        default_impl: default_impl,
      });
    }
  }
  return out;
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:1011 eii_linkage_needed
function eii_linkage_needed(dependency_formats: Dependencies): boolean {
  return [...dependency_formats.values()].some((formats) => formats.some((linkage) => linkage === "Dynamic" || linkage === "IncludedFromDylib"));
}

// PORT: `impl CrateInfo { pub fn new }` as a free fn (see `CrateInfo` in lib.ts).
// rustc: compiler/rustc_codegen_ssa/src/base.rs:1020 new
export function CrateInfo_new(tcx: TyCtxt, target_cpu: string): CrateInfo {
  const crate_types = [...tcx.crate_types()];
  const exported_symbols = new Map(crate_types.map((c) => [c, back_linker_exported_symbols(tcx, c)] as const));
  const linked_symbols = new Map(crate_types.map((c) => [c, back_linker_linked_symbols(tcx, c)] as const));
  const local_crate_name = tcx.crate_name(LOCAL_CRATE);
  const windows_subsystem = find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "WindowsSubsystem" ? k._0 : undefined));
  const dependency_formats = tcx.dependency_formats(null) as Dependencies;
  const eii_linkage = eii_linkage_needed(dependency_formats) ? collect_eii_linkage(tcx) : [];

  // This list is used when generating the command line to pass through to
  // system linker. The linker expects undefined symbols on the left of the
  // command line to be defined in libraries on the right, not the other way
  // around. For more info, see some comments in the add_used_library function
  // below.
  //
  // In order to get this left-to-right dependency ordering, we use the reverse
  // postorder of all crates putting the leaves at the rightmost positions.
  let compiler_builtins: CrateNum | undefined = undefined;
  const used_crates: CrateNum[] = [...tcx.postorder_cnums(null)].reverse().filter((cnum) => {
    const link = !CrateDepKindC.macros_only(tcx.crate_dep_kind(cnum) as CrateDepKind);
    if (link && tcx.is_compiler_builtins(cnum)) {
      compiler_builtins = cnum;
      return false;
    }
    return link;
  });
  // `compiler_builtins` are always placed last to ensure that they're linked correctly.
  if (compiler_builtins !== undefined) used_crates.push(compiler_builtins);

  const crates = tcx.crates(null);
  // let n_crates = crates.len();
  const info: CrateInfo = {
    target_cpu,
    target_features: [...tcx.sess.global_backend_features],
    crate_types,
    exported_symbols,
    linked_symbols,
    local_crate_name,
    compiler_builtins,
    profiler_runtime: undefined,
    is_no_builtins: new Set(),
    native_libraries: new Map(),
    used_libraries: (tcx.native_libraries(LOCAL_CRATE) as cstore_NativeLib[]).map(NativeLib_from),
    crate_name: new Map(),
    used_crates,
    used_crate_source: new Map(),
    dependency_formats,
    eii_linkage,
    windows_subsystem,
    natvis_debugger_visualizers: [],
    lint_level_specs: CodegenLintLevelSpecs.from_tcx(tcx),
    metadata_symbol: exported_symbols_metadata_symbol_name(tcx),
    symbol_rename_suffix: `.rs${lower_hex_StableCrateId(tcx.stable_crate_id(LOCAL_CRATE), PLAIN)}`,
    each_linked_rlib_file_for_lto: [],
    exported_symbols_for_lto: [],
  };

  // info.native_libraries.reserve(n_crates);

  for (const cnum of crates) {
    info.native_libraries.set(cnum, (tcx.native_libraries(cnum) as cstore_NativeLib[]).map(NativeLib_from));
    info.crate_name.set(cnum, tcx.crate_name(cnum));

    const used_crate_source = tcx.used_crate_source(cnum) as CrateSource;
    info.used_crate_source.set(cnum, used_crate_source);
    if (tcx.is_profiler_runtime(cnum)) {
      info.profiler_runtime = cnum;
    }
    if (tcx.is_no_builtins(cnum)) {
      info.is_no_builtins.add(cnum);
    }
  }

  // Handle circular dependencies in the standard library.
  // See comment before `add_linked_symbol_object` function for the details.
  // If global LTO is enabled then almost everything (*) is glued into a single object file,
  // so this logic is not necessary and can cause issues on some targets (due to weak lang
  // item symbols being "privatized" to that object file), so we disable it.
  // (*) Native libs, and `#[compiler_builtins]` and `#[no_builtins]` crates are not glued,
  // and we assume that they cannot define weak lang items. This is not currently enforced
  // by the compiler, but that's ok because all this stuff is unstable anyway.
  const target = tcx.sess.target;
  if (!are_upstream_rust_objects_already_included(tcx.sess)) {
    const add_prefix: (name: string, export_kind: SymbolExportKind) => string =
      target.is_like_windows && target.arch.$ === "X86"
        ? (name, _) => `_${name}`
        : target.is_like_windows && target.arch.$ === "Arm64EC"
          ? // Only functions are decorated for arm64ec.
            (name, export_kind) => (export_kind === "Text" ? `#${name}` : name)
          : (name, _) => name;
    // PORT: `FxIndexSet<(Symbol, SymbolExportKind)>`, keyed by the pair.
    const missing_weak_lang_items = new Map<string, [Symbol, SymbolExportKind]>();
    for (const cnum of info.used_crates) {
      for (const l of tcx.missing_lang_items(cnum)) {
        if (!LangItem.is_weak(l)) continue;
        const name = LangItem.link_name(l);
        if (name === undefined) continue;
        const t = LangItem.target(l);
        let export_kind: SymbolExportKind;
        if (t.$ === "ForeignFn" || t.$ === "Fn") {
          export_kind = "Text";
        } else if (t.$ === "Static") {
          export_kind = "Data";
        } else {
          return bug(`Don't know what the export kind is for lang item of kind ${t.$}`);
        }
        if (lang_items_required(tcx, l)) {
          const key = `${name}:${export_kind}`;
          if (!missing_weak_lang_items.has(key)) missing_weak_lang_items.set(key, [name, export_kind]);
        }
      }
    }

    // This loop only adds new items to values of the hash map, so the order in which we
    // iterate over the values is not important.
    // #[allow(rustc::potential_query_instability)]
    for (const [crate_type, linked_symbols] of info.linked_symbols) {
      if (crate_type === "Rlib" || crate_type === "StaticLib") continue;
      const symbols = [...missing_weak_lang_items.values()].map(
        ([item, export_kind]): [string, SymbolExportKind] => [add_prefix(mangle_internal_symbol(tcx, Symbol.as_str(item)), export_kind), export_kind],
      );
      symbols.sort((a, b) => str_cmp(a[0], b[0]));
      linked_symbols.push(...symbols);
    }
  }

  const each_linked_rlib_for_lto: CrateNum[] = [];
  const each_linked_rlib_file_for_lto: string[] = [];
  if (tcx.sess.lto() !== "No" && tcx.sess.lto() !== "ThinLocal") {
    // drop(crate::back::link::each_linked_rlib(&info, None, &mut |cnum, path| { .. }));
    void each_linked_rlib_for_lto;
    return unported("rustc_codegen_ssa::back::link::each_linked_rlib (CrateInfo::new with -C lto; M7)");
  }
  info.each_linked_rlib_file_for_lto = each_linked_rlib_file_for_lto;

  // FIXME move to -Zlink-only half such that each_linked_rlib_file_for_lto can be moved there too
  // Compute the set of symbols we need to retain when doing LTO (if we need to)
  info.exported_symbols_for_lto = back_lto_exported_symbols_for_lto(tcx, each_linked_rlib_for_lto);

  const embed_visualizers = tcx.crate_types().some((crate_type) => {
    switch (crate_type) {
      case "Executable":
      case "Dylib":
      case "Cdylib":
      case "Sdylib":
        // These are crate types for which we invoke the linker and can embed
        // NatVis visualizers.
        return true;
      case "ProcMacro":
        // We could embed NatVis for proc macro crates too (to improve the debugging
        // experience for them) but it does not seem like a good default, since
        // this is a rare use case and we don't want to slow down the common case.
        return false;
      case "StaticLib":
      case "Rlib":
        // We don't invoke the linker for these, so we don't need to collect the NatVis for
        // them.
        return false;
    }
  });

  if (target.is_like_msvc && embed_visualizers) {
    // info.natvis_debugger_visualizers =
    //     collect_debugger_visualizers_transitive(tcx, DebuggerVisualizerType::Natvis);
    return unported("rustc_codegen_ssa::base::collect_debugger_visualizers_transitive (MSVC natvis; M7)");
  }

  return info;
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:1221 provide
export function provide(providers: Providers): void {
  providers.backend_optimization_level = (tcx, cratenum) => {
    let for_speed: OptLevel;
    switch (tcx.sess.opts.optimize) {
      // If globally no optimisation is done, #[optimize] has no effect.
      //
      // This is done because if we ended up "upgrading" to `-O2` here, we’d populate the
      // pass manager and it is likely that some module-wide passes (such as inliner or
      // cross-function constant propagation) would ignore the `optnone` annotation we put
      // on the functions, thus necessarily involving these functions into optimisations.
      case "No":
        return "No";
      // If globally optimise-speed is already specified, just use that level.
      case "Less":
        return "Less";
      case "More":
        return "More";
      case "Aggressive":
        return "Aggressive";
      // If globally optimize-for-size has been requested, use -O2 instead (if optimize(size)
      // are present).
      case "Size":
        for_speed = "More";
        break;
      case "SizeMin":
        for_speed = "More";
        break;
    }

    // PORT: `MonoItemPartitions` (rustc_middle mono.rs) is not ported; its `all_mono_items` is a set of `DefId`s.
    const defids = (tcx.collect_and_partition_mono_items(cratenum) as { all_mono_items: Iterable<DefId> }).all_mono_items;

    const any_for_speed = [...defids].some((id) => {
      const { optimize } = tcx.codegen_fn_attrs(id) as CodegenFnAttrs;
      return optimize === "Speed";
    });

    if (any_for_speed) {
      return for_speed;
    }

    return tcx.sess.opts.optimize;
  };
}

// ---- Pending-file shims ------------------------------------------------------------------------------------
// Named and typed as upstream; each body calls `unported` with the upstream path. Replace by the import when the
// file is ported (handoff driver-m5).

/** `crate::back::linker::exported_symbols` (back/linker.rs:1669). PORT: back/linker.rs is not ported. */
function back_linker_exported_symbols(_tcx: TyCtxt, _crate_type: CrateType): never {
  return unported("rustc_codegen_ssa::back::linker::exported_symbols (CrateInfo::new)");
}

/** `crate::back::linker::linked_symbols` (back/linker.rs:1752). PORT: back/linker.rs is not ported. */
function back_linker_linked_symbols(_tcx: TyCtxt, _crate_type: CrateType): never {
  return unported("rustc_codegen_ssa::back::linker::linked_symbols (CrateInfo::new)");
}

/** `rustc_middle::middle::exported_symbols::metadata_symbol_name` (middle/exported_symbols.rs:86). PORT: not ported. */
function exported_symbols_metadata_symbol_name(_tcx: TyCtxt): never {
  return unported("rustc_middle::middle::exported_symbols::metadata_symbol_name (CrateInfo::new)");
}

/** `crate::back::lto::exported_symbols_for_lto` (back/lto.rs:89). PORT: back/lto.rs is not ported. */
function back_lto_exported_symbols_for_lto(_tcx: TyCtxt, _each_linked_rlib_for_lto: readonly CrateNum[]): never {
  return unported("rustc_codegen_ssa::back::lto::exported_symbols_for_lto (CrateInfo::new)");
}
