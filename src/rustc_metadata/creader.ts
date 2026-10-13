//! Validates all used crates and extern libraries and loads their metadata
//
// Port of compiler/rustc_metadata/src/creader.rs.
//
// PORT: the `impl CStore` methods of rmeta/decoder/cstore_impl.rs (`set_used_recursively`, `update_extern_crate`,
// the `*_untracked` accessors) and `impl CrateStore for CStore` are attached to `CStore.prototype` by
// rmeta/decoder/cstore_impl.ts (PORTING section 5, "Methods defined in another file"); this module must not
// import it. Consumers import `src/rustc_metadata/lib.ts`, which loads both.
//
// PORT: `struct CStore` is declared after `CrateOrigin` (upstream: line 57, before `LoadedMacro`) so that the
// `impl CStore` methods in its class body (PORTING section 8) follow the `impl Debug for CStore` (line 111) and
// `impl CrateOrigin` (line 160) fns in file order.
//
// PORT: crate loading (`register_crate` and below) reaches the locator / rmeta decoder stubs (wave 11), which
// call `unported`. `#![no_core]` crates without `extern crate` load nothing (docs/plan-m2.md, finding A).
import type { Edition } from "../rustc_span/edition.ts";
import { attr, expand, visit, CRATE_NODE_ID, ItemKind, type Crate, type Item, type MacroDef } from "../rustc_ast/lib.ts";
import type { Attribute as AttrIrAttribute } from "../rustc_attr_ir/lib.ts";
import {
  type CrateDepKind,
  CrateDepKind_discriminant,
  type CrateSource,
  type CrateStore,
  clone_CrateSource,
  debug_CrateDepKind,
  ExternCrate,
  ExternCrateSource,
} from "../rustc_crate_store/lib.ts";
import type { SyntaxExtension } from "../rustc_expand/base.ts";
import { CRATE_HIR_ID } from "../rustc_hir_id/lib.ts";
import type { Definitions } from "../rustc_hir_id/definitions.ts";
import { PARTIAL_STACK_PROTECTOR, UNUSED_CRATE_DEPENDENCIES } from "../rustc_lint_defs/builtin.gen.ts";
import "../rustc_middle/lint.ts";
import type { TyCtxt, TyCtxtFeed } from "../rustc_middle/ty/context.ts";
// PORT: rustc_session modules are reached through its lib.ts (load order: options.ts before config.ts and
// options/mitigation_coverage.ts); type-only imports name the modules directly.
import { config, options, type Session } from "../rustc_session/lib.ts";
import type { Externs } from "../rustc_session/config.ts";
import type { ExtendedTargetModifierInfo, TargetModifier } from "../rustc_session/options.ts";
import type { DeniedPartialMitigation, DeniedPartialMitigationKind, DeniedPartialMitigationLevel } from "../rustc_session/options/mitigation_coverage.ts";
import { validate_crate_name } from "../rustc_session/output.ts";
import type { PathKind } from "../rustc_session/search_paths.ts";
import { type CrateNum, type DefId, LOCAL_CRATE, type LocalDefId, LocalDefId as LocalDefId_, type StableCrateId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { display_Symbol, type Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import type { StackProtector } from "../rustc_target/spec/mod.ts";
import type { PanicStrategy, Target } from "../rustc_target/spec/mod.ts";
import type { CrateType } from "../rustc_structures/lib.ts";
import { type Debug, debug_bool, type Fmt } from "../std/fmt.ts";
import { assert, panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";
import { CrateError_from_DylibError, dlsym_proc_macros, type ProcMacroClient } from "./host_dylib.ts";
import { CrateError, CrateLocator, CratePaths, CrateRejections } from "./locator.ts";
import { CrateMetadata, type CrateNumMap, type MetadataBlob, type Svh, type TargetModifiers } from "./rmeta/decoder.ts";
import type { CrateDep, CrateRoot } from "./rmeta/mod.ts";

const { ALLOC_ERROR_HANDLER, global_fn_name } = expand.allocator;
type AllocatorKind = expand.allocator.AllocatorKind;

/// The backend's way to give the crate store access to the metadata in a library.
/// Note that it returns the raw metadata bytes stored in the library file, whether
/// it is compressed, uncompressed, some weird mix, etc.
/// rmeta files are backend independent and not handled here.
// PORT: `OwnedSlice` -> `Uint8Array`; `&Path` -> `string`.
export interface MetadataLoader {
  // rustc: compiler/rustc_metadata/src/creader.rs:52 get_rlib_metadata
  get_rlib_metadata(target: Target, filename: string): Result<Uint8Array, string>;
  // rustc: compiler/rustc_metadata/src/creader.rs:53 get_dylib_metadata
  get_dylib_metadata(target: Target, filename: string): Result<Uint8Array, string>;
}

// pub type MetadataLoaderDyn = dyn MetadataLoader + Send + Sync + sync::DynSend + sync::DynSync;
export type MetadataLoaderDyn = MetadataLoader;

export type LoadedMacro =
  | { readonly $: "MacroDef"; def: MacroDef; ident: Ident; attrs: AttrIrAttribute[]; span: Span; edition: Edition }
  | { readonly $: "ProcMacro"; _0: SyntaxExtension };

export interface Library {
  source: CrateSource;
  metadata: MetadataBlob;
}

type LoadResult = { readonly $: "Previous"; readonly _0: CrateNum } | { readonly $: "Loaded"; readonly _0: Library };

/** `impl std::fmt::Debug for CStore` */
// rustc: compiler/rustc_metadata/src/creader.rs:111 fmt
export const debug_CStore: Debug<CStore> = (self, f) => {
  let fmt = "";
  fmt += "resolved crates:\n";
  for (const [cnum, data] of self.iter_crate_data()) {
    fmt += `  name: ${display_Symbol(data.name())}\n`;
    fmt += `  cnum: ${String(cnum)}\n`;
    // PORT: `Svh`'s Display is the stand-in's text (rmeta/decoder.ts).
    fmt += `  hash: ${data.hash()}\n`;
    fmt += `  reqd: ${debug_CrateDepKind(data.dep_kind(), f)}\n`;
    fmt += `  priv: ${debug_bool(data.is_private_dep(), f)}\n`;
    const { dylib, rlib, rmeta, sdylib_interface } = data.source();
    if (dylib !== undefined) {
      fmt += `  dylib: ${dylib}\n`;
    }
    if (rlib !== undefined) {
      fmt += `   rlib: ${rlib}\n`;
    }
    if (rmeta !== undefined) {
      fmt += `   rmeta: ${rmeta}\n`;
    }
    if (sdylib_interface !== undefined) {
      fmt += `   sdylib interface: ${sdylib_interface}\n`;
    }
  }
  return fmt;
};

/// Reason that a crate is being sourced as a dependency.
// #[derive(Clone, Copy)]
type CrateOrigin =
  /// This crate was a dependency of another crate.
  | {
      readonly $: "IndirectDependency";
      /// Where this dependency was included from. Should only be used in error messages.
      readonly dep_root_for_errors: CratePaths;
      /// True if the parent is private, meaning the dependent should also be private.
      readonly parent_private: boolean;
      /// Dependency info about this crate.
      readonly dep: CrateDep;
      /// The dependency's `-C extra-filename`, used to narrow the search for it on disk. Stored
      /// separately from `dep` because it is encoded outside the hashed crate root; see
      /// `CrateRootUnhashed::dep_extra_filenames`.
      readonly dep_extra_filename: string;
    }
  /// Injected by `rustc`.
  | { readonly $: "Injected" }
  /// Provided by `extern crate foo` or as part of the extern prelude.
  | { readonly $: "Extern" };

const CrateOrigin = {
  Injected: Object.freeze({ $: "Injected" }) as CrateOrigin,
  Extern: Object.freeze({ $: "Extern" }) as CrateOrigin,

  /// Return the dependency root, if any.
  // rustc: compiler/rustc_metadata/src/creader.rs:161 dep_root_for_errors
  dep_root_for_errors(self: CrateOrigin): CratePaths | undefined {
    switch (self.$) {
      case "IndirectDependency": {
        return self.dep_root_for_errors;
      }
      default:
        return undefined;
    }
  },

  /// Return dependency information, if any.
  // rustc: compiler/rustc_metadata/src/creader.rs:171 dep
  dep(self: CrateOrigin): CrateDep | undefined {
    switch (self.$) {
      case "IndirectDependency":
        return self.dep;
      default:
        return undefined;
    }
  },

  /// Return the dependency's `-C extra-filename`, if any.
  // rustc: compiler/rustc_metadata/src/creader.rs:179 dep_extra_filename
  dep_extra_filename(self: CrateOrigin): string | undefined {
    switch (self.$) {
      case "IndirectDependency":
        return self.dep_extra_filename;
      default:
        return undefined;
    }
  },

  /// `Some(true)` if the dependency is private or its parent is private, `Some(false)` if the
  /// dependency is not private, `None` if it could not be determined.
  // rustc: compiler/rustc_metadata/src/creader.rs:188 private_dep
  private_dep(self: CrateOrigin): boolean | undefined {
    switch (self.$) {
      case "IndirectDependency": {
        return self.dep.is_private || self.parent_private;
      }
      case "Injected":
        return true;
      default:
        return undefined;
    }
  },
} as const;

// PORT: fields whose name is also a method get a trailing `_` (`injected_panic_runtime_`, `allocator_kind_`,
// `alloc_error_handler_kind_`, `has_global_allocator_`, `has_alloc_error_handler_`), as in rustc_resolve.
// `IndexVec<CrateNum, Option<Box<CrateMetadata>>>` -> `(CrateMetadata | undefined)[]`; `UnordMap` -> `Map`
// (`Svh` keys are the stand-in's text); `FxHashSet` -> `Set`.
export class CStore {
  constructor(
    public metadata_loader: MetadataLoaderDyn,

    public metas: (CrateMetadata | undefined)[],
    public injected_panic_runtime_: CrateNum | undefined,
    /// This crate needs an allocator and either provides it itself, or finds it in a dependency.
    /// If the above is true, then this field denotes the kind of the found allocator.
    public allocator_kind_: AllocatorKind | undefined,
    /// This crate needs an allocation error handler and either provides it itself, or finds it in a dependency.
    /// If the above is true, then this field denotes the kind of the found allocator.
    public alloc_error_handler_kind_: AllocatorKind | undefined,
    /// This crate has a `#[global_allocator]` item.
    public has_global_allocator_: boolean,
    /// This crate has a `#[alloc_error_handler]` item.
    public has_alloc_error_handler_: boolean,

    /// Cached map from hash to CrateNum, to avoid scanning metas during crate resolution.
    public hash_to_cnum: Map<Svh, CrateNum>,

    /// Names that were used to load the crates via `extern crate` or paths.
    public resolved_externs: Map<Symbol, CrateNum>,

    /// Unused externs of the crate
    public unused_externs: Symbol[],

    public used_extern_options: Set<Symbol>,
    /// Whether there was a failure in resolving crate,
    /// it's used to suppress some diagnostics that would otherwise too noisey.
    public has_crate_resolve_with_fail: boolean,
  ) {}

  /** PORT: `trait CrateStore: std::fmt::Debug` (the interface's `debug` member) is `debug_CStore`. */
  debug(v: CrateStore, f: Fmt): string {
    return debug_CStore(v as CStore, f);
  }

  // PORT: `FreezeReadGuard::map(tcx.untracked().cstore.read(), |cstore| ..)`: the `FreezeLock` is its value
  // (PORTING section 5); `as_any().downcast_ref::<CStore>()` is an `instanceof` check.
  // rustc: compiler/rustc_metadata/src/creader.rs:200 from_tcx
  static from_tcx(tcx: TyCtxt): CStore {
    const cstore = tcx.untracked().cstore.as_any();
    if (!(cstore instanceof CStore)) return panic("`tcx.cstore` is not a `CStore`");
    return cstore;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:206 from_tcx_mut
  static from_tcx_mut(tcx: TyCtxt): CStore {
    const cstore = tcx.untracked().cstore.untracked_as_any();
    if (!(cstore instanceof CStore)) return panic("`tcx.cstore` is not a `CStore`");
    return cstore;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:212 intern_stable_crate_id
  intern_stable_crate_id(tcx: TyCtxt, root: CrateRoot): Result<TyCtxtFeed<CrateNum>, CrateError> {
    const left = this.metas.length;
    const right = tcx.untracked().stable_crate_ids.size;
    assert(left === right, `assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
    const r = tcx.create_crate_num(root.stable_crate_id());
    let num: TyCtxtFeed<CrateNum>;
    if (r.$ === "Err") {
      const existing = r._0;
      // Check for (potential) conflicts with the local crate
      if (existing === LOCAL_CRATE) {
        return Err({ $: "SymbolConflictsCurrent", _0: root.name() });
      } else {
        const data = this.metas[existing];
        const crate_name1 = data === undefined ? undefined : data.name();
        if (crate_name1 !== undefined) {
          const crate_name0 = root.name();
          return Err({ $: "StableCrateIdCollision", _0: crate_name0, _1: crate_name1 });
        } else {
          return Err({ $: "NotFound", _0: root.name() });
        }
      }
    } else {
      num = r._0;
    }

    this.metas.push(undefined);
    return Ok(num);
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:235 has_crate_data
  has_crate_data(cnum: CrateNum): boolean {
    return this.metas[cnum] !== undefined;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:239 get_crate_data
  get_crate_data(cnum: CrateNum): CrateMetadata {
    const data = this.metas[cnum];
    if (data === undefined) return panic(`Failed to get crate data for ${String(cnum)}`);
    return data;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:243 get_crate_data_mut
  get_crate_data_mut(cnum: CrateNum): CrateMetadata {
    const data = this.metas[cnum];
    if (data === undefined) return panic(`Failed to get crate data for ${String(cnum)}`);
    return data;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:247 set_crate_data
  set_crate_data(cnum: CrateNum, data: CrateMetadata): void {
    assert(this.metas[cnum] === undefined, "Overwriting crate metadata entry");
    this.hash_to_cnum.set(data.hash(), cnum);
    this.metas[cnum] = data;
  }

  /// Save the name used to resolve the extern crate in the local crate
  ///
  /// The name isn't always the crate's own name, because `sess.opts.externs` can assign it another name.
  /// It's also not always the same as the `DefId`'s symbol due to renames `extern crate resolved_name as defid_name`.
  // rustc: compiler/rustc_metadata/src/creader.rs:257 set_resolved_extern_crate_name
  set_resolved_extern_crate_name(name: Symbol, extern_crate: CrateNum): void {
    this.resolved_externs.set(name, extern_crate);
  }

  /// Crate resolved and loaded via the given extern name
  /// (corresponds to names in `sess.opts.externs`)
  ///
  /// May be `None` if the crate wasn't used
  // rustc: compiler/rustc_metadata/src/creader.rs:265 resolved_extern_crate
  resolved_extern_crate(externs_name: Symbol): CrateNum | undefined {
    return this.resolved_externs.get(externs_name);
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:269 iter_crate_data
  iter_crate_data(): [CrateNum, CrateMetadata][] {
    const out: [CrateNum, CrateMetadata][] = [];
    this.metas.forEach((data, cnum) => {
      if (data !== undefined) out.push([cnum as CrateNum, data]);
    });
    return out;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:275 all_proc_macro_def_ids
  all_proc_macro_def_ids(tcx: TyCtxt): DefId[] {
    return this.iter_crate_data().flatMap(([krate, data]) => [...data.proc_macros_for_crate(tcx, krate)]);
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:279 push_dependencies_in_postorder
  push_dependencies_in_postorder(deps: Set<CrateNum>, cnum: CrateNum): void {
    if (!deps.has(cnum)) {
      const cdata = this.get_crate_data(cnum);
      for (const dep of cdata.dependencies()) {
        if (dep !== cnum) {
          this.push_dependencies_in_postorder(deps, dep);
        }
      }

      deps.add(cnum);
    }
  }

  // PORT: `IndexSet<CrateNum>` -> `Set` (insertion-ordered).
  // rustc: compiler/rustc_metadata/src/creader.rs:292 crate_dependencies_in_postorder
  crate_dependencies_in_postorder(cnum: CrateNum): Set<CrateNum> {
    const deps = new Set<CrateNum>();
    if (cnum === LOCAL_CRATE) {
      for (const [cnum, _] of this.iter_crate_data()) {
        this.push_dependencies_in_postorder(deps, cnum);
      }
    } else {
      this.push_dependencies_in_postorder(deps, cnum);
    }
    return deps;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:304 injected_panic_runtime
  injected_panic_runtime(): CrateNum | undefined {
    return this.injected_panic_runtime_;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:308 allocator_kind
  allocator_kind(): AllocatorKind | undefined {
    return this.allocator_kind_;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:312 alloc_error_handler_kind
  alloc_error_handler_kind(): AllocatorKind | undefined {
    return this.alloc_error_handler_kind_;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:316 has_global_allocator
  has_global_allocator(): boolean {
    return this.has_global_allocator_;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:320 has_alloc_error_handler
  has_alloc_error_handler(): boolean {
    return this.has_alloc_error_handler_;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:324 had_extern_crate_load_failure
  had_extern_crate_load_failure(): boolean {
    return this.has_crate_resolve_with_fail;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:328 report_unused_deps
  report_unused_deps(tcx: TyCtxt): void {
    const json_unused_externs = tcx.sess.opts.json_unused_externs;

    // We put the check for the option before the lint_level_at_node call
    // because the call mutates internal state and introducing it
    // leads to some ui tests failing.
    if (!config.JsonUnusedExterns.is_enabled(json_unused_externs)) {
      return;
    }
    const level = tcx.lint_level_spec_at_node(UNUSED_CRATE_DEPENDENCIES, CRATE_HIR_ID).level_();
    if (level !== "Allow") {
      const unused_externs = this.unused_externs.map((ident) => Symbol.to_ident_string(ident));
      tcx.dcx().emit_unused_externs(level, config.JsonUnusedExterns.is_loud(json_unused_externs), unused_externs);
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:347 report_target_modifiers_extended
  static report_target_modifiers_extended(tcx: TyCtxt, mods: TargetModifiers, dep_mods: TargetModifiers, data: CrateMetadata): void {
    const allowed_flag_mismatches = tcx.sess.opts.cg.unsafe_allow_abi_mismatch;
    const local_crate = tcx.crate_name(LOCAL_CRATE);
    const tmod_extender = (tmod: TargetModifier): [ExtendedTargetModifierInfo, TargetModifier] => [tmod.extend(), new options.TargetModifier(tmod.opt, tmod.value_name)];
    const report_diff = (prefix: string, opt_name: string, flag_local_value: string | undefined, flag_extern_value: string | undefined): void => {
      if (allowed_flag_mismatches.includes(opt_name)) {
        return;
      }
      const extern_crate = data.name();
      const flag_name = opt_name;
      const flag_name_prefixed = `-${prefix}${opt_name}`;

      if (flag_local_value !== undefined && flag_extern_value !== undefined) {
        const local_value = flag_local_value;
        const extern_value = flag_extern_value;
        tcx.dcx().emit_err(
          diagnostics.IncompatibleTargetModifiers_diagnostic({
            extern_crate,
            local_crate,
            flag_name,
            flag_name_prefixed,
            local_value: local_value,
            extern_value: extern_value,
          }),
        );
      } else if (flag_local_value === undefined && flag_extern_value !== undefined) {
        const extern_value = flag_extern_value;
        tcx.dcx().emit_err(
          diagnostics.IncompatibleTargetModifiersLMissed_diagnostic({
            extern_crate,
            local_crate,
            flag_name,
            flag_name_prefixed,
            extern_value: extern_value,
            has_extern_value: extern_value.length !== 0,
          }),
        );
      } else if (flag_local_value !== undefined && flag_extern_value === undefined) {
        const local_value = flag_local_value;
        tcx.dcx().emit_err(
          diagnostics.IncompatibleTargetModifiersRMissed_diagnostic({
            extern_crate,
            local_crate,
            flag_name,
            flag_name_prefixed,
            local_value: local_value,
            has_local_value: local_value.length !== 0,
          }),
        );
      } else {
        panic("Incorrect target modifiers report_diff(None, None)");
      }
    };
    // PORT: `mods.iter().map(tmod_extender)` is lazy; `next1`/`next2` pull one element at a time.
    let i1 = 0;
    let i2 = 0;
    const next1 = (): [ExtendedTargetModifierInfo, TargetModifier] | undefined => (i1 < mods.length ? tmod_extender(mods[i1++]!) : undefined);
    const next2 = (): [ExtendedTargetModifierInfo, TargetModifier] | undefined => (i2 < dep_mods.length ? tmod_extender(dep_mods[i2++]!) : undefined);
    let left_name_val: [ExtendedTargetModifierInfo, TargetModifier] | undefined = undefined;
    let right_name_val: [ExtendedTargetModifierInfo, TargetModifier] | undefined = undefined;
    for (;;) {
      left_name_val = left_name_val ?? next1();
      right_name_val = right_name_val ?? next2();
      const l = left_name_val;
      const r = right_name_val;
      if (l !== undefined && r !== undefined) {
        const c = options.OptionsTargetModifiers_cmp(l[1].opt, r[1].opt);
        if (c === 0) {
          if (!l[1].consistent(tcx.sess, r[1])) {
            report_diff(l[0].prefix, l[0].name, l[1].value_name, r[1].value_name);
          }
          left_name_val = undefined;
          right_name_val = undefined;
        } else if (c > 0) {
          if (!r[1].consistent(tcx.sess, undefined)) {
            report_diff(r[0].prefix, r[0].name, undefined, r[1].value_name);
          }
          right_name_val = undefined;
        } else {
          if (!l[1].consistent(tcx.sess, undefined)) {
            report_diff(l[0].prefix, l[0].name, l[1].value_name, undefined);
          }
          left_name_val = undefined;
        }
      } else if (l !== undefined && r === undefined) {
        if (!l[1].consistent(tcx.sess, undefined)) {
          report_diff(l[0].prefix, l[0].name, l[1].value_name, undefined);
        }
        left_name_val = undefined;
      } else if (l === undefined && r !== undefined) {
        if (!r[1].consistent(tcx.sess, undefined)) {
          report_diff(r[0].prefix, r[0].name, undefined, r[1].value_name);
        }
        right_name_val = undefined;
      } else {
        break;
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:452 report_session_incompatibilities
  report_session_incompatibilities(tcx: TyCtxt, krate: Crate): void {
    this.report_incompatible_target_modifiers(tcx);
    this.report_incompatible_partial_mitigations(tcx);
    this.report_incompatible_async_drop_feature(tcx, krate);
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:458 report_incompatible_target_modifiers
  report_incompatible_target_modifiers(tcx: TyCtxt): void {
    for (const flag_name of tcx.sess.opts.cg.unsafe_allow_abi_mismatch) {
      if (!options.OptionsTargetModifiers.is_target_modifier(flag_name)) {
        tcx.dcx().emit_err(
          diagnostics.UnknownTargetModifierUnsafeAllowed_diagnostic({
            flag_name: flag_name,
          }),
        );
      }
    }
    const mods = tcx.sess.opts.gather_target_modifiers();
    for (const [_cnum, data] of this.iter_crate_data()) {
      if (data.is_proc_macro_crate()) {
        continue;
      }
      const dep_mods = data.target_modifiers();
      // `mods != dep_mods`: derived `PartialEq` of `Vec<TargetModifier>`.
      if (!options.vec_eq(mods, dep_mods, (a, b) => options.TargetModifier_cmp(a, b) === 0)) {
        CStore.report_target_modifiers_extended(tcx, mods, dep_mods, data);
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:478 report_incompatible_partial_mitigations
  report_incompatible_partial_mitigations(tcx: TyCtxt): void {
    // PORT: `Session::gather_enabled_denied_partial_mitigations` is the generated free fn
    // (options/mitigation_coverage.gen.ts).
    const my_mitigations_ = options.mitigation_coverage.gather_enabled_denied_partial_mitigations(tcx.sess);
    // PORT: `BTreeMap<DeniedPartialMitigationKind, &DeniedPartialMitigation>` -> `Map`, read in key order
    // (`btree_values`).
    const my_mitigations = new Map<DeniedPartialMitigationKind, DeniedPartialMitigation>(my_mitigations_.map((mitigation) => [mitigation.kind, mitigation]));
    for (const skipped_mitigation of tcx.sess.opts.allowed_partial_mitigations(tcx.sess.edition())) {
      my_mitigations.delete(skipped_mitigation);
    }
    const MAX_ERRORS_PER_MITIGATION = 5;
    const errors_per_mitigation = new Map<DeniedPartialMitigationKind, number>();
    for (const [_cnum, data] of this.iter_crate_data()) {
      if (data.is_proc_macro_crate()) {
        continue;
      }
      const their_mitigations = data.enabled_denied_partial_mitigations();
      for (const my_mitigation of btree_values(my_mitigations)) {
        const found = their_mitigations.find((mitigation) => mitigation.kind === my_mitigation.kind);
        const their_mitigation: DeniedPartialMitigationLevel = found === undefined ? { $: "Enabled", _0: false } : found.level;
        if (DeniedPartialMitigationLevel_cmp(their_mitigation, my_mitigation.level) < 0) {
          const errors = errors_per_mitigation.get(my_mitigation.kind) ?? 0;
          errors_per_mitigation.set(my_mitigation.kind, errors);
          if (errors >= MAX_ERRORS_PER_MITIGATION) {
            continue;
          }
          errors_per_mitigation.set(my_mitigation.kind, errors + 1);

          const diagnostic: diagnostics.MitigationLessStrictInDependency = {
            mitigation_name: options.mitigation_coverage.display_DeniedPartialMitigationKind(my_mitigation.kind),
            mitigation_level: options.mitigation_coverage.DeniedPartialMitigationLevel.level_str(my_mitigation.level),
            extern_crate: data.name(),
          };
          if (my_mitigation.kind === "StackProtector") {
            // make stack-protector only a forward-compat warning since it was
            // pretty widely used
            tcx.sess.psess.buffer_crate_lint(PARTIAL_STACK_PROTECTOR, diagnostics.MitigationLessStrictInDependency_diagnostic(diagnostic));
          } else {
            tcx.dcx().emit_err(diagnostics.MitigationLessStrictInDependency_diagnostic(diagnostic));
          }
        }
      }
    }
  }

  // Report about async drop types in dependency if async drop feature is disabled
  // rustc: compiler/rustc_metadata/src/creader.rs:522 report_incompatible_async_drop_feature
  report_incompatible_async_drop_feature(tcx: TyCtxt, krate: Crate): void {
    if (tcx.features().async_drop()) {
      return;
    }
    for (const [_cnum, data] of this.iter_crate_data()) {
      if (data.is_proc_macro_crate()) {
        continue;
      }
      if (data.has_async_drops()) {
        const extern_crate = data.name();
        const local_crate = tcx.crate_name(LOCAL_CRATE);
        tcx.dcx().emit_warn(
          diagnostics.AsyncDropTypesInDependency_diagnostic({
            span: Span.shrink_to_lo(krate.spans.inner_span),
            extern_crate,
            local_crate,
          }),
        );
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:542 new
  static new(metadata_loader: MetadataLoaderDyn): CStore {
    return new CStore(
      metadata_loader,
      // We add an empty entry for LOCAL_CRATE (which maps to zero) in
      // order to make array indices in `metas` match with the
      // corresponding `CrateNum`. This first entry will always remain
      // `None`.
      [undefined],
      undefined,
      undefined,
      undefined,
      false,
      false,
      new Map(),
      new Map(),
      [],
      new Set(),
      false,
    );
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:563 existing_match
  existing_match(name: Symbol, hash: Svh | undefined): CrateNum | undefined {
    if (hash === undefined) return undefined;
    const cnum = this.hash_to_cnum.get(hash);
    if (cnum === undefined) return undefined;
    // debug_assert_eq!(self.get_crate_data(cnum).name(), name);
    void name;
    return cnum;
  }

  /// Determine whether a dependency should be considered private.
  ///
  /// Dependencies are private if they get extern option specified, e.g. `--extern priv:mycrate`.
  /// This is stored in metadata, so `private_dep`  can be correctly set during load. A `Some`
  /// value for `private_dep` indicates that the crate is known to be private or public (note
  /// that any `None` or `Some(false)` use of the same crate will make it public).
  ///
  /// Sometimes the directly dependent crate is not specified by `--extern`, in this case,
  /// `private-dep` is none during loading. This is equivalent to the scenario where the
  /// command parameter is set to `public-dependency`
  // rustc: compiler/rustc_metadata/src/creader.rs:580 is_private_dep
  is_private_dep(externs: Externs, name: Symbol, private_dep: boolean | undefined): boolean {
    const extern_private = externs.get(Symbol.as_str(name))?.is_private_dep;
    // Explicit non-private via `--extern`, explicit non-private from metadata, or
    // unspecified with default to public.
    if (extern_private === false || private_dep === false || (extern_private === undefined && private_dep === undefined)) {
      return false;
    }
    // Marked private via `--extern priv:mycrate` or in metadata.
    return true;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:591 register_crate
  register_crate(
    tcx: TyCtxt,
    host_lib: Library | undefined,
    origin: CrateOrigin,
    lib: Library,
    dep_kind: CrateDepKind,
    name: Symbol,
    private_dep_: boolean | undefined,
  ): Result<CrateNum, CrateError> {
    // PORT: `generic_activity_with_arg` -> `generic_activity`: the profiler stand-in records nothing
    // (driver-m2 decision 8).
    const _prof_timer = tcx.sess.prof.generic_activity("metadata_register_crate");
    void _prof_timer;

    const { source, metadata } = lib;
    const crate_root = metadata.get_root();
    const unhashed = metadata.get_root_unhashed();
    const host_hash = host_lib === undefined ? undefined : host_lib.metadata.get_crate_hash();
    const private_dep = this.is_private_dep(tcx.sess.opts.externs, name, private_dep_);

    // Claim this crate number and cache it
    const feed = this.intern_stable_crate_id(tcx, crate_root);
    if (feed.$ === "Err") return feed;
    const cnum = feed._0.key();

    // info!("register crate `{}` (cnum = {}. private_dep = {})", crate_root.name(), cnum, private_dep);

    // Maintain a reference to the top most crate.
    // Stash paths for top-most crate locally if necessary.
    let crate_paths: CratePaths;
    let dep_root_for_errors: CratePaths;
    const dep_root_for_errors_ = CrateOrigin.dep_root_for_errors(origin);
    if (dep_root_for_errors_ !== undefined) {
      dep_root_for_errors = dep_root_for_errors_;
    } else {
      crate_paths = CratePaths.new(crate_root.name(), clone_CrateSource(source));
      dep_root_for_errors = crate_paths;
    }

    const cnum_map = this.resolve_crate_deps(tcx, dep_root_for_errors, crate_root, metadata, cnum, dep_kind, private_dep);
    if (cnum_map.$ === "Err") return cnum_map;

    let raw_proc_macros: readonly ProcMacroClient[] | undefined;
    if (crate_root.is_proc_macro_crate()) {
      let temp_root: CrateRoot;
      let dlsym_source: CrateSource;
      let dlsym_root: CrateRoot;
      if (host_lib !== undefined) {
        dlsym_source = host_lib.source;
        temp_root = host_lib.metadata.get_root();
        dlsym_root = temp_root;
      } else {
        dlsym_source = source;
        dlsym_root = crate_root;
      }
      const dlsym_dylib = dlsym_source.dylib;
      if (dlsym_dylib === undefined) return panic("no dylib for a proc-macro crate");
      const r = this.dlsym_proc_macros(dlsym_dylib, dlsym_root.stable_crate_id());
      if (r.$ === "Err") return r;
      raw_proc_macros = r._0;
    } else {
      raw_proc_macros = undefined;
    }

    const crate_metadata = CrateMetadata.new(tcx, metadata, crate_root, unhashed, raw_proc_macros, cnum, cnum_map._0, dep_kind, source, private_dep, host_hash);

    this.set_crate_data(cnum, crate_metadata);

    return Ok(cnum);
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:675 load_proc_macro
  load_proc_macro(
    sess: Session,
    locator: CrateLocator,
    crate_rejections: CrateRejections,
    path_kind: PathKind,
    host_hash: Svh | undefined,
  ): Result<[LoadResult, Library | undefined] | undefined, CrateError> {
    if (sess.opts.unstable_opts.dual_proc_macros) {
      // Use a new crate locator and crate rejections so trying to load a proc macro doesn't
      // affect the error message we emit
      const proc_macro_locator = locator.clone();

      // Try to load a proc macro
      proc_macro_locator.for_target_proc_macro(sess, path_kind);

      // Load the proc macro crate for the target
      let target_result: LoadResult | undefined;
      const loaded = this.load(proc_macro_locator, CrateRejections.default());
      if (loaded.$ === "Err") return loaded;
      const res = loaded._0;
      if (res !== undefined && res.$ === "Previous") {
        const cnum = res._0;
        return Ok([{ $: "Previous", _0: cnum }, undefined]);
      } else if (res !== undefined && res.$ === "Loaded") {
        const library = res._0;
        target_result = { $: "Loaded", _0: library };
      } else {
        return Ok(undefined);
      }

      // Use the existing crate_rejections as we want the error message to be affected by
      // loading the host proc macro.
      // PORT: `*crate_rejections = CrateRejections::default();` overwrites the caller's value in place.
      Object.assign(crate_rejections, CrateRejections.default());

      // Load the proc macro crate for the host
      locator.for_proc_macro(sess, path_kind);

      locator.hash = host_hash;

      const loaded_host = this.load(locator, crate_rejections);
      if (loaded_host.$ === "Err") return loaded_host;
      const host_result_ = loaded_host._0;
      if (host_result_ === undefined) {
        return Ok(undefined);
      }

      let host_result: Library;
      switch (host_result_.$) {
        case "Previous":
          return panic("host and target proc macros must be loaded in lock-step");
        case "Loaded": {
          const library = host_result_._0;
          host_result = library;
          break;
        }
      }
      if (target_result === undefined) return panic("called `Option::unwrap()` on a `None` value");
      return Ok([target_result, host_result]);
    } else {
      // Use a new crate locator and crate rejections so trying to load a proc macro doesn't
      // affect the error message we emit
      const proc_macro_locator = locator.clone();

      // Load the proc macro crate for the host
      proc_macro_locator.for_proc_macro(sess, path_kind);

      const loaded = this.load(proc_macro_locator, CrateRejections.default());
      if (loaded.$ === "Err") return loaded;
      const host_result = loaded._0;
      if (host_result !== undefined) {
        return Ok([host_result, undefined]);
      } else if (sess.opts.unstable_opts.wasm_proc_macros) {
        // Load the proc macro crate for wasm
        proc_macro_locator.for_wasm_proc_macro(sess, path_kind);

        const loaded_wasm = this.load(proc_macro_locator, CrateRejections.default());
        if (loaded_wasm.$ === "Err") return loaded_wasm;
        const host_result = loaded_wasm._0;
        if (host_result !== undefined) {
          return Ok([host_result, undefined]);
        } else {
          return Ok(undefined);
        }
      } else {
        return Ok(undefined);
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:750 resolve_crate
  resolve_crate(tcx: TyCtxt, name: Symbol, span: Span, dep_kind: CrateDepKind, origin: CrateOrigin): CrateNum | undefined {
    this.used_extern_options.add(name);
    const r = this.maybe_resolve_crate(tcx, name, dep_kind, origin);
    switch (r.$) {
      case "Ok": {
        const cnum = r._0;
        this.set_used_recursively(cnum);
        return cnum;
      }
      case "Err": {
        const err = r._0;
        // debug!("failed to resolve crate {} {:?}", name, dep_kind);
        // crate maybe injrected with `standard_library_imports::inject`, their span is dummy.
        // we ignore compiler-injected prelude/sysroot loads here so they don't suppress
        // unrelated diagnostics, such as `unsupported targets for std library` etc,
        // these maybe helpful for users to resolve crate loading failure.
        if (!(tcx.sess.dcx().has_errors() !== undefined) && !Span.is_dummy(span)) {
          this.has_crate_resolve_with_fail = true;
        }
        const missing_core = this.maybe_resolve_crate(tcx, sym.core, "Unconditional", CrateOrigin.Extern).$ === "Err";
        CrateError.report(err, tcx.sess, span, missing_core);
        return undefined;
      }
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:787 maybe_resolve_crate
  maybe_resolve_crate(tcx: TyCtxt, name: Symbol, dep_kind: CrateDepKind, origin: CrateOrigin): Result<CrateNum, CrateError> {
    // info!("resolving crate `{}`", name);
    if (!is_ascii(Symbol.as_str(name))) {
      return Err({ $: "NonAsciiName", _0: name });
    }

    const dep_root_for_errors = CrateOrigin.dep_root_for_errors(origin);
    const dep = CrateOrigin.dep(origin);
    const hash = dep === undefined ? undefined : dep.hash;
    const host_hash = dep === undefined ? undefined : dep.host_hash;
    const extra_filename = CrateOrigin.dep_extra_filename(origin);
    const path_kind: PathKind = dep !== undefined ? "Dependency" : "Crate";
    const private_dep = CrateOrigin.private_dep(origin);

    let result: [LoadResult, Library | undefined];
    const cnum_ = this.existing_match(name, hash);
    if (cnum_ !== undefined) {
      result = [{ $: "Previous", _0: cnum_ }, undefined];
    } else {
      // info!("falling back to a load");
      const locator = CrateLocator.new(
        tcx.sess,
        this.metadata_loader,
        name,
        // The all loop is because `--crate-type=rlib --crate-type=rlib` is
        // legal and produces both inside this type.
        tcx.crate_types().every((c: CrateType) => c === "Rlib"),
        hash,
        extra_filename,
        path_kind,
      );
      const crate_rejections = CrateRejections.default();

      const loaded = this.load(locator, crate_rejections);
      if (loaded.$ === "Err") return loaded;
      const res = loaded._0;
      if (res !== undefined) {
        result = [res, undefined];
      } else {
        // info!("falling back to loading proc_macro");
        dep_kind = "MacrosOnly";
        const pm = this.load_proc_macro(tcx.sess, locator, crate_rejections, path_kind, host_hash);
        if (pm.$ === "Err") return pm;
        const res = pm._0;
        if (res !== undefined) {
          result = res;
        } else {
          const dep_root = dep_root_for_errors === undefined ? undefined : new CratePaths(dep_root_for_errors.name, clone_CrateSource(dep_root_for_errors.source));
          return Err(locator.into_error(crate_rejections, dep_root));
        }
      }
    }

    const [load_result, host_library] = result;
    if (load_result.$ === "Previous" && host_library === undefined) {
      const cnum = load_result._0;
      // info!("library for `{}` was loaded previously, cnum {cnum}", name);
      // When `private_dep` is none, it indicates the directly dependent crate. If it is
      // not specified by `--extern` on command line parameters, it may be
      // `private-dependency` when `register_crate` is called for the first time. Then it must be updated to
      // `public-dependency` here.
      const private_dep_ = this.is_private_dep(tcx.sess.opts.externs, name, private_dep);
      const cdata = this.get_crate_data_mut(cnum);
      if (cdata.is_proc_macro_crate()) {
        dep_kind = "MacrosOnly";
      }
      cdata.set_dep_kind(CrateDepKind_max(cdata.dep_kind(), dep_kind));
      cdata.update_and_private_dep(private_dep_);
      return Ok(cnum);
    } else if (load_result.$ === "Loaded") {
      const library = load_result._0;
      // info!("register newly loaded library for `{}`", name);
      return this.register_crate(tcx, host_library, origin, library, dep_kind, name, private_dep);
    } else {
      return panic();
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:871 load
  load(locator: CrateLocator, crate_rejections: CrateRejections): Result<LoadResult | undefined, CrateError> {
    const loaded = locator.maybe_load_library_crate(crate_rejections);
    if (loaded.$ === "Err") return loaded;
    const library = loaded._0;
    if (library === undefined) {
      return Ok(undefined);
    }

    // In the case that we're loading a crate, but not matching
    // against a hash, we could load a crate which has the same hash
    // as an already loaded crate. If this is the case prevent
    // duplicates by just using the first crate.
    const root_name = library.metadata.get_root().name();
    const root_hash = library.metadata.get_crate_hash();
    let result: LoadResult = { $: "Loaded", _0: library };
    for (const [cnum, data] of this.iter_crate_data()) {
      if (data.name() === root_name && data.hash() === root_hash) {
        assert(locator.hash === undefined, "assertion failed: locator.hash.is_none()");
        // info!("load success, going to previous cnum: {}", cnum);
        result = { $: "Previous", _0: cnum };
        break;
      }
    }
    return Ok(result);
  }

  /// Go through the crate metadata and load any crates that it references.
  // rustc: compiler/rustc_metadata/src/creader.rs:899 resolve_crate_deps
  resolve_crate_deps(
    tcx: TyCtxt,
    dep_root_for_errors: CratePaths,
    crate_root: CrateRoot,
    metadata: MetadataBlob,
    krate: CrateNum,
    dep_kind: CrateDepKind,
    parent_is_private: boolean,
  ): Result<CrateNumMap, CrateError> {
    // debug!("resolving deps of external crate `{}` with dep root `{}`", crate_root.name(), dep_root_for_errors.name);
    if (crate_root.is_proc_macro_crate()) {
      return Ok([]);
    }

    // The map from crate numbers in the crate we're resolving to local crate numbers.
    // We map 0 and all other holes in the map to our parent crate. The "additional"
    // self-dependencies should be harmless.
    const deps = crate_root.decode_crate_deps(metadata);
    // Encoded outside the hashed crate root; see `CrateRootUnhashed::dep_extra_filenames`.
    // Holds one entry per dep after the unused `LOCAL_CRATE` slot, so it lines up with `deps`
    // once that slot is skipped.
    const dep_extra_filenames = metadata.get_dep_extra_filenames();
    const left = dep_extra_filenames.length;
    const right = deps.length + 1;
    assert(
      left === right,
      `assertion \`left == right\` failed: expected one dep_extra_filename per crate dep, plus the unused LOCAL_CRATE slot\n  left: ${left}\n right: ${right}`,
    );
    const crate_num_map: CrateNumMap = [];
    crate_num_map.push(krate);
    // `deps.zip(dep_extra_filenames.iter().skip(1).map(String::as_str))`
    const n = Math.min(deps.length, dep_extra_filenames.length - 1);
    for (let i = 0; i < n; i++) {
      const dep = deps[i]!;
      const dep_extra_filename = dep_extra_filenames[i + 1]!;
      // info!("resolving dep `{}`->`{}` hash: `{}` extra filename: `{}` private {}", ..);
      const dep_kind_: CrateDepKind = dep_kind === "MacrosOnly" ? "MacrosOnly" : dep.kind;
      const cnum = this.maybe_resolve_crate(tcx, dep.name, dep_kind_, {
        $: "IndirectDependency",
        dep_root_for_errors,
        parent_private: parent_is_private,
        dep: dep,
        dep_extra_filename,
      });
      if (cnum.$ === "Err") return cnum;
      crate_num_map.push(cnum._0);
    }

    // debug!("resolve_crate_deps: cnum_map for {:?} is {:?}", krate, crate_num_map);
    return Ok(crate_num_map);
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:966 dlsym_proc_macros
  dlsym_proc_macros(path: string, stable_crate_id: StableCrateId): Result<readonly ProcMacroClient[], CrateError> {
    const r = dlsym_proc_macros(path, stable_crate_id);
    if (r.$ === "Err") return Err(CrateError_from_DylibError(r._0));
    return Ok(r._0);
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:974 inject_panic_runtime
  inject_panic_runtime(tcx: TyCtxt, krate: Crate): void {
    const is_std = attr.contains_name(krate.attrs, sym.needs_panic_runtime);
    // If we're only compiling an rlib, then there's no need to select a
    // panic runtime, so we just skip this section entirely.
    const only_rlib = tcx.crate_types().every((ct: CrateType) => ct === "Rlib");
    if (only_rlib && !is_std) {
      // info!("panic runtime injection skipped, only generating rlib");
      return;
    }

    const desired_strategy = tcx.sess.panic_strategy();
    let name: Symbol;
    switch (desired_strategy) {
      case "Unwind":
        name = sym.panic_unwind;
        break;
      case "Abort":
        name = sym.panic_abort;
        break;
      case "ImmediateAbort": {
        // Immediate-aborting panics don't use a runtime.
        return;
      }
    }

    // If we need a panic runtime, we try to find an existing one here. At
    // the same time we perform some general validation of the DAG we've got
    // going such as ensuring everything has a compatible panic strategy.
    let found_panic_runtime: CrateNum | undefined = undefined;
    let needs_panic_runtime = is_std;
    for (const [cnum, data] of this.iter_crate_data()) {
      needs_panic_runtime = needs_panic_runtime || data.needs_panic_runtime();

      if (data.is_panic_runtime() && data.name() === name) {
        found_panic_runtime = cnum;
      }
    }

    // If we just don't need a panic runtime at all, then we're done here
    // and there's nothing else to do.
    if (!needs_panic_runtime) {
      return;
    }

    // The panic runtime may already be resolved as a `std` dependency via `resolve_crate_deps`.
    //
    // For `build-std=always`, we avoid injecting it again as a direct dependency, because
    // Cargo relies on loading panic runtimes via the `-Ldependency` search paths.
    // We know that the panic runtime injected during the `std` build is the correct one
    // since Cargo passes the same `-Cpanic=` option to all crates.
    //
    // For prebuilt `std` it doesn't matter whether the runtime is injected directly or indirectly.
    if (found_panic_runtime !== undefined) {
      this.injected_panic_runtime_ = found_panic_runtime;
      return;
    }

    // info!("panic runtime not found -- loading {}", name);

    // By this point we know that we need a panic runtime. Here we just load
    // an appropriate default runtime for our panic strategy.
    //
    // We may resolve to an already loaded crate (as the crate may not have
    // been explicitly linked prior to this), but this is fine.
    //
    // Also note that we have yet to perform validation of the crate graph
    // in terms of everyone has a compatible panic runtime format, that's
    // performed later as part of the `dependency_format` module.
    //
    // This has to be conditional as both panic_unwind and panic_abort may be present in the
    // crate graph at the same time. One of them will later be activated in dependency_formats.
    const cnum = this.resolve_crate(tcx, name, DUMMY_SP, "Conditional", CrateOrigin.Injected);
    if (cnum === undefined) {
      return;
    }
    const cdata = this.get_crate_data(cnum);

    // Sanity check the loaded crate to ensure it is indeed a panic runtime.
    if (!cdata.is_panic_runtime()) {
      tcx.dcx().emit_err(diagnostics.CrateNotPanicRuntime_diagnostic({ crate_name: name }));
    }
    // Check the `panic_abort` was compiled with `-Cpanic=abort`.
    if (desired_strategy === "Abort" && cdata.required_panic_strategy() !== "Abort") {
      tcx.dcx().emit_err(
        diagnostics.NoPanicStrategy_diagnostic({
          crate_name: name,
          strategy: desired_strategy,
        }),
      );
    }

    this.injected_panic_runtime_ = cnum;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1068 inject_profiler_runtime
  inject_profiler_runtime(tcx: TyCtxt): void {
    const needs_profiler_runtime = tcx.sess.instrument_coverage() || config.SwitchWithOptPath.enabled(tcx.sess.opts.cg.profile_generate);
    if (!needs_profiler_runtime || tcx.sess.opts.unstable_opts.no_profiler_runtime) {
      return;
    }

    // info!("loading profiler");

    // HACK: This uses conditional despite actually being unconditional to ensure that
    // there is no error emitted when two dylibs independently depend on profiler_builtins.
    // This is fine as profiler_builtins is always statically linked into the dylib just
    // like compiler_builtins. Unlike compiler_builtins however there is no guaranteed
    // common dylib that the duplicate crate check believes the crate to be included in.
    // add_upstream_rust_crates has a corresponding check that forces profiler_builtins
    // to be statically linked in even when marked as NotLinked.
    const name = Symbol.intern(tcx.sess.opts.unstable_opts.profiler_runtime);
    const cnum = this.resolve_crate(tcx, name, DUMMY_SP, "Conditional", CrateOrigin.Injected);
    if (cnum === undefined) {
      return;
    }
    const cdata = this.get_crate_data(cnum);

    // Sanity check the loaded crate to ensure it is indeed a profiler runtime
    if (!cdata.is_profiler_runtime()) {
      tcx.dcx().emit_err(diagnostics.NotProfilerRuntime_diagnostic({ crate_name: name }));
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1102 inject_allocator_crate
  inject_allocator_crate(tcx: TyCtxt, krate: Crate): void {
    {
      const spans = fn_spans(krate, Symbol.intern(global_fn_name(sym.alloc)));
      if (spans.length >= 2) {
        const span1 = spans[0]!;
        const span2 = spans[1]!;
        tcx.dcx().emit_err(
          diagnostics.NoMultipleGlobalAlloc_diagnostic({
            span2: span2,
            span1: span1,
          }),
        );
        this.has_global_allocator_ = true;
      } else {
        this.has_global_allocator_ = spans.length !== 0;
      }
    }
    const alloc_error_handler_ = Symbol.intern(global_fn_name(ALLOC_ERROR_HANDLER));
    {
      const spans = fn_spans(krate, alloc_error_handler_);
      if (spans.length >= 2) {
        const span1 = spans[0]!;
        const span2 = spans[1]!;
        tcx.dcx().emit_err(
          diagnostics.NoMultipleAllocErrorHandler_diagnostic({
            span2: span2,
            span1: span1,
          }),
        );
        this.has_alloc_error_handler_ = true;
      } else {
        this.has_alloc_error_handler_ = spans.length !== 0;
      }
    }

    // Check to see if we actually need an allocator. This desire comes
    // about through the `#![needs_allocator]` attribute and is typically
    // written down in liballoc.
    if (!attr.contains_name(krate.attrs, sym.needs_allocator) && !this.iter_crate_data().some(([_, data]) => data.needs_allocator())) {
      return;
    }

    // At this point we've determined that we need an allocator. Let's see
    // if our compilation session actually needs an allocator based on what
    // we're emitting.
    const all_rlib = tcx.crate_types().every((ct: CrateType) => ct === "Rlib");
    if (all_rlib) {
      return;
    }

    // Ok, we need an allocator. Not only that but we're actually going to
    // create an artifact that needs one linked in. Let's go find the one
    // that we're going to link in.
    //
    // First up we check for global allocators. Look at the crate graph here
    // and see what's a global allocator, including if we ourselves are a
    // global allocator.
    // #[allow(rustc::symbol_intern_string_literal)]
    const this_crate = Symbol.intern("this crate");

    let global_allocator: Symbol | undefined = this.has_global_allocator_ ? this_crate : undefined;
    for (const [_, data] of this.iter_crate_data()) {
      if (data.has_global_allocator()) {
        if (global_allocator !== undefined) {
          const other_crate = global_allocator;
          tcx.dcx().emit_err(
            diagnostics.ConflictingGlobalAlloc_diagnostic({
              crate_name: data.name(),
              other_crate_name: other_crate,
            }),
          );
        } else {
          global_allocator = data.name();
        }
      }
    }
    let alloc_error_handler: Symbol | undefined = this.has_alloc_error_handler_ ? this_crate : undefined;
    for (const [_, data] of this.iter_crate_data()) {
      if (data.has_alloc_error_handler()) {
        if (alloc_error_handler !== undefined) {
          const other_crate = alloc_error_handler;
          tcx.dcx().emit_err(
            diagnostics.ConflictingAllocErrorHandler_diagnostic({
              crate_name: data.name(),
              other_crate_name: other_crate,
            }),
          );
        } else {
          alloc_error_handler = data.name();
        }
      }
    }

    if (global_allocator !== undefined) {
      this.allocator_kind_ = "Global";
    } else {
      // Ok we haven't found a global allocator but we still need an
      // allocator. At this point our allocator request is typically fulfilled
      // by the standard library, denoted by the `#![default_lib_allocator]`
      // attribute.
      if (!attr.contains_name(krate.attrs, sym.default_lib_allocator) && !this.iter_crate_data().some(([_, data]) => data.has_default_lib_allocator())) {
        tcx.dcx().emit_err(diagnostics.GlobalAllocRequired_diagnostic({}));
      }
      this.allocator_kind_ = "Default";
    }

    if (alloc_error_handler !== undefined) {
      this.alloc_error_handler_kind_ = "Global";
    } else {
      // The alloc crate provides a default allocation error handler if
      // one isn't specified.
      this.alloc_error_handler_kind_ = "Default";
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1206 inject_forced_externs
  inject_forced_externs(tcx: TyCtxt): void {
    for (const [name, entry] of tcx.sess.opts.externs.iter()) {
      if (entry.force) {
        const name_interned = Symbol.intern(name);
        if (!this.used_extern_options.has(name_interned)) {
          this.resolve_crate(tcx, name_interned, DUMMY_SP, "Unconditional", CrateOrigin.Extern);
        }
      }
    }
  }

  /// Inject the `compiler_builtins` crate if it is not already in the graph.
  // rustc: compiler/rustc_metadata/src/creader.rs:1224 inject_compiler_builtins
  inject_compiler_builtins(tcx: TyCtxt, krate: Crate): void {
    // `compiler_builtins` does not get extern builtins, nor do `#![no_core]` crates
    if (attr.contains_name(krate.attrs, sym.compiler_builtins) || attr.contains_name(krate.attrs, sym.no_core)) {
      // info!("`compiler_builtins` unneeded");
      return;
    }

    // If a `#![compiler_builtins]` crate already exists, avoid injecting it twice. This is
    // the common case since usually it appears as a dependency of `std` or `alloc`.
    for (const [_cnum, cmeta] of this.iter_crate_data()) {
      if (cmeta.is_compiler_builtins()) {
        // info!("`compiler_builtins` already exists (cnum = {cnum}); skipping injection");
        return;
      }
    }

    // `compiler_builtins` is not yet in the graph; inject it. Error on resolution failure.
    const cnum = this.resolve_crate(tcx, sym.compiler_builtins, Span.shrink_to_lo(krate.spans.inner_span), "Unconditional", CrateOrigin.Injected);
    if (cnum === undefined) {
      // info!("`compiler_builtins` not resolved");
      return;
    }

    // Sanity check that the loaded crate is `#![compiler_builtins]`
    const cdata = this.get_crate_data(cnum);
    if (!cdata.is_compiler_builtins()) {
      tcx.dcx().emit_err(diagnostics.CrateNotCompilerBuiltins_diagnostic({ crate_name: cdata.name() }));
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1261 report_unused_deps_in_crate
  report_unused_deps_in_crate(tcx: TyCtxt, krate: Crate): void {
    // Make a point span rather than covering the whole file
    const span = Span.shrink_to_lo(krate.spans.inner_span);
    // Complain about anything left over
    for (const [name, entry] of tcx.sess.opts.externs.iter()) {
      if (entry.location.$ === "FoundInLibrarySearchDirectories") {
        // Don't worry about pathless `--extern foo` sysroot references
        continue;
      }
      if (entry.nounused_dep || entry.force) {
        // We're not worried about this one
        continue;
      }
      const name_interned = Symbol.intern(name);
      if (this.used_extern_options.has(name_interned)) {
        continue;
      }

      // Got a real unused --extern
      if (config.JsonUnusedExterns.is_enabled(tcx.sess.opts.json_unused_externs)) {
        this.unused_externs.push(name_interned);
        continue;
      }

      tcx.sess.psess.buffer_lint(
        UNUSED_CRATE_DEPENDENCIES,
        span,
        CRATE_NODE_ID,
        diagnostics.UnusedCrateDependency_diagnostic({
          extern_crate: name_interned,
          local_crate: tcx.crate_name(LOCAL_CRATE),
        }),
      );
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1297 report_future_incompatible_deps
  report_future_incompatible_deps(tcx: TyCtxt, krate: Crate): void {
    const name = tcx.crate_name(LOCAL_CRATE);

    if (Symbol.as_str(name) === "wasm_bindgen") {
      const major = env_var_u64("CARGO_PKG_VERSION_MAJOR");
      const minor = env_var_u64("CARGO_PKG_VERSION_MINOR");
      const patch = env_var_u64("CARGO_PKG_VERSION_PATCH");

      // v1 or bigger is valid.
      if (major !== undefined && major >= 1n) return;
      // v0.3 or bigger is valid.
      if (major === 0n && minor !== undefined && minor >= 3n) return;
      // v0.2.88 or bigger is valid.
      if (major === 0n && minor === 2n && patch !== undefined && patch >= 88n) return;
      // Not using Cargo.
      if (major === undefined && minor === undefined && patch === undefined) return;

      // Make a point span rather than covering the whole file
      const span = Span.shrink_to_lo(krate.spans.inner_span);

      tcx.sess.dcx().emit_err(diagnostics.WasmCAbi_diagnostic({ span }));
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1330 postprocess
  postprocess(tcx: TyCtxt, krate: Crate): void {
    this.inject_compiler_builtins(tcx, krate);
    this.inject_forced_externs(tcx);
    this.inject_profiler_runtime(tcx);
    this.inject_allocator_crate(tcx, krate);
    this.inject_panic_runtime(tcx, krate);

    this.report_unused_deps_in_crate(tcx, krate);
    this.report_future_incompatible_deps(tcx, krate);

    // info!("{:?}", self);
  }

  /// Process an `extern crate foo` AST node.
  // rustc: compiler/rustc_metadata/src/creader.rs:1344 process_extern_crate
  process_extern_crate(tcx: TyCtxt, item: Item, def_id: LocalDefId, definitions: Definitions): CrateNum | undefined {
    const kind = item.kind;
    switch (kind.$) {
      case "ExternCrate": {
        const orig_name = kind._0;
        const ident = kind._1;
        // debug!("resolving extern crate stmt. ident: {} orig_name: {:?}", ident, orig_name);
        let name: Symbol;
        if (orig_name !== undefined) {
          validate_crate_name(tcx.sess, orig_name, item.span);
          name = orig_name;
        } else {
          name = ident.name;
        }
        const dep_kind: CrateDepKind = attr.contains_name(item.attrs, sym.no_link) ? "MacrosOnly" : "Unconditional";

        const cnum = this.resolve_crate(tcx, name, item.span, dep_kind, CrateOrigin.Extern);
        if (cnum === undefined) return undefined;

        const def_path = definitions.def_path(def_id);
        // An extern crate is only globally nameable if every segment in its path
        // is in the type namespace (i.e., it is purely nested inside modules).
        // If any segment is in the value namespace (e.g. inside a fn or const),
        // it is unnameable from outside that block.
        const is_unnameable = def_path.data.some((d) => !(d.data.$ === "TypeNs"));
        this.update_extern_crate(
          cnum,
          name,
          new ExternCrate(
            is_unnameable ? ExternCrateSource.Path : { $: "Extern", _0: LocalDefId_.to_def_id(def_id) },
            item.span,
            // PORT: `usize::MAX` is `Number.MAX_SAFE_INTEGER` (the repo's sentinel; see rustc_crate_store `rank`).
            is_unnameable ? Number.MAX_SAFE_INTEGER : def_path.data.length,
            LOCAL_CRATE,
          ),
        );
        return cnum;
      }
      default:
        return bug();
    }
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1397 process_path_extern
  process_path_extern(tcx: TyCtxt, name: Symbol, span: Span): CrateNum | undefined {
    const cnum = this.resolve_crate(tcx, name, span, "Unconditional", CrateOrigin.Extern);
    if (cnum === undefined) return undefined;

    this.update_extern_crate(
      cnum,
      name,
      new ExternCrate(
        ExternCrateSource.Path,
        span,
        // to have the least priority in `update_extern_crate`
        Number.MAX_SAFE_INTEGER,
        LOCAL_CRATE,
      ),
    );

    return cnum;
  }

  // rustc: compiler/rustc_metadata/src/creader.rs:1421 maybe_process_path_extern
  maybe_process_path_extern(tcx: TyCtxt, name: Symbol): CrateNum | undefined {
    const r = this.maybe_resolve_crate(tcx, name, "Unconditional", CrateOrigin.Extern);
    return r.$ === "Ok" ? r._0 : undefined;
  }
}

// rustc: compiler/rustc_metadata/src/creader.rs:1426 fn_spans
function fn_spans(krate: Crate, name: Symbol): Span[] {
  class Finder extends visit.Visitor {
    constructor(
      public name: Symbol,
      public spans: Span[],
    ) {
      super();
    }

    // rustc: compiler/rustc_metadata/src/creader.rs:1432 visit_item
    override visit_item(item: Item): undefined {
      const ident = ItemKind.ident(item.kind);
      if (ident !== undefined && ident.name === this.name && attr.contains_name(item.attrs, sym.rustc_std_internal_symbol)) {
        this.spans.push(item.span);
      }
      visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
      return undefined;
    }
  }

  const f = new Finder(name, []);
  visit.walk_crate(f, krate);
  return f.spans;
}

// ---- local helpers (no upstream fn) ----------------------------------------------------------------------

/** `str::is_ascii`. */
function is_ascii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/** `cmp::max` of the derived `Ord` of `CrateDepKind` (returns the second argument when they are equal). */
function CrateDepKind_max(a: CrateDepKind, b: CrateDepKind): CrateDepKind {
  return CrateDepKind_discriminant[b] >= CrateDepKind_discriminant[a] ? b : a;
}

/** `BTreeMap::values` of a `Map` keyed by `DeniedPartialMitigationKind`: in key order (derived `Ord`). */
function btree_values<V>(map: Map<DeniedPartialMitigationKind, V>): V[] {
  return [...map.entries()].sort(([a], [b]) => options.mitigation_coverage.DeniedPartialMitigationKind_discriminant[a] - options.mitigation_coverage.DeniedPartialMitigationKind_discriminant[b]).map(([, v]) => v);
}

/** `StackProtector`'s derived `Ord` (`target_spec_enum!`): declaration order. */
const StackProtector_discriminant: Record<StackProtector, number> = { None: 0, Basic: 1, Strong: 2, All: 3 };

/**
 * Derived `PartialOrd`/`Ord` of `DeniedPartialMitigationLevel` (`Enabled(bool)` < `StackProtector(..)`, then the
 * payload). PORT: local until rustc_session's mitigation_coverage.ts has it.
 */
function DeniedPartialMitigationLevel_cmp(a: DeniedPartialMitigationLevel, b: DeniedPartialMitigationLevel): number {
  if (a.$ !== b.$) return a.$ === "Enabled" ? -1 : 1;
  if (a.$ === "Enabled" && b.$ === "Enabled") return Number(a._0) - Number(b._0);
  if (a.$ === "StackProtector" && b.$ === "StackProtector") return StackProtector_discriminant[a._0] - StackProtector_discriminant[b._0];
  return 0;
}

/**
 * `env::var(key).ok().and_then(|v| u64::from_str(&v).ok())`. PORT: `u64` as `bigint`; `from_str` accepts an
 * optional `+` and ASCII digits, and fails on overflow.
 */
function env_var_u64(key: string): bigint | undefined {
  const v = process.env[key];
  if (v === undefined) return undefined;
  if (!/^\+?[0-9]+$/.test(v)) return undefined;
  const n = BigInt(v);
  return n <= 0xffff_ffff_ffff_ffffn ? n : undefined;
}
