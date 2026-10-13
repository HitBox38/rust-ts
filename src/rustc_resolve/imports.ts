// Port of compiler/rustc_resolve/src/imports.rs
//! A bunch of methods and structures more or less related to resolving imports.
//
// Types and derived Debug impls of this file are generated into imports.gen.ts; the `Resolver` methods
// of this file are declared in ./decls.ts (the contract, docs/handoff/res-lib.md) and assigned below.
// Init order: top-level code here touches only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_resolve module's exports are read inside function bodies only.
//
// PORT (iteration order): the maps this file iterates are all insertion-ordered upstream
// (`FxIndexMap` resolution tables, `Vec`s of modules / imports / glob importers), so JS `Map`/array order
// is exact. The `FxHashSet`s it builds (`seen_spans`, `exported_ambiguities`) are only queried.
// `FxIndexSet::swap_remove` (`single_imports`) is `index_set_swap_remove` below.
import { type NodeId, NodeId as NodeIdC, debug_NodeId } from "../rustc_ast/node_id.ts";
import { type BufferedEarlyLint, DecorateDiagCompat } from "../rustc_errors/decorate_diag.ts";
import { into_MultiSpan } from "../rustc_error_messages/lib.ts";
import { debug_PerNS, Namespace, PerNS, PerNS_default, Res as def_Res, Res_eq } from "../rustc_hir/def.ts";
import { LintId } from "../rustc_lint_defs/lib.ts";
import {
  AMBIGUOUS_GLOB_REEXPORTS,
  EXPORTED_PRIVATE_DEPENDENCIES,
  HIDDEN_GLOB_REEXPORTS,
  PUB_USE_OF_PRIVATE_EXTERN_CRATE,
  REDUNDANT_IMPORTS,
  UNUSED_IMPORTS,
} from "../rustc_lint_defs/builtin.ts";
import { type AmbigModChild, type ModChild, PartialRes, type Reexport } from "../rustc_middle/middle/resolve.ts";
import { debug_Visibility, type Ordering, Visibility, Visibility_eq } from "../rustc_middle/ty/mod.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import { LocalExpnId, SyntaxContext } from "../rustc_span/hygiene.ts";
import { debug_LocalDefId, debug_LocalModId, debug_ModId, LocalDefId, LocalModId, type ModId } from "../rustc_span/def_id.ts";
import { OrdSpan, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { debug_Ident, debug_Symbol, display_Ident, Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_option, debug_struct, type Fmt, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Resolver } from "./decls.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import { clone_OnUnknownData, type Suggestion } from "./diagnostics/impls.ts";
import * as gen from "./imports.gen.ts";
// PORT (init order): the bindings below are read inside function bodies only (ESM live bindings).
import {
  type AmbiguityError,
  BindingKey,
  BindingKey_eq,
  clone_BindingKey,
  clone_IdentKey,
  clone_Segment,
  CmCell,
  type CmRefCell,
  type Decl,
  DeclData,
  debug_CmCell,
  debug_DeclData,
  Finalize,
  IdentKey,
  type ImportSummary,
  type LocalModule,
  Macros20NormalizedSyntaxContext,
  type ModuleOrUniformRoot,
  module_to_string,
  names_to_string,
  type Res,
  Segment,
} from "./lib.ts";

export * from "./imports.gen.ts";
export type NameResolution = gen.NameResolution;
export type ImportData = gen.ImportData;
export const ImportData = gen.ImportData;
type Import = gen.Import;
type ImportResolution = gen.ImportResolution;
type ImportResolutionKind = gen.ImportResolutionKind;
type UnresolvedImportError = gen.UnresolvedImportError;

/// A potential import declaration in the process of being planted into a module.
/// Also used for lazily planting names from `--extern` flags to extern prelude.
export type PendingDecl = gen.PendingDecl;
export const PendingDecl = {
  ...gen.PendingDecl,
  // rustc: compiler/rustc_resolve/src/imports.rs:63 decl
  decl(self: PendingDecl): Decl | undefined {
    switch (self.$) {
      case "Ready":
        return self._0;
      case "Pending":
        return undefined;
    }
  },
};

/// Contains data for specific kinds of imports.
export type ImportKind = gen.ImportKind;
export const ImportKind = gen.ImportKind;

/// Manually implement `Debug` for `ImportKind` because the `source/target_bindings`
/// contain `Cell`s which can introduce infinite loops while printing.
// rustc: compiler/rustc_resolve/src/imports.rs:121 fmt
export const debug_ImportKind: Debug<ImportKind> = (v: ImportKind, f: Fmt): string => {
  switch (v.$) {
    case "Single": {
      const { source, target, decls, nested, id, def_id } = v;
      return debug_struct(f, "Single", [
        ["source", debug_Ident(source, f)],
        ["target", debug_Ident(target, f)],
        // Ignore the nested bindings to avoid an infinite loop while printing.
        [
          "decls",
          debug_PerNS(
            decls.map((b) => (PendingDecl.decl(b.into_inner()) === undefined ? undefined : "..")),
            f,
            (x, f) => debug_option(x, f, (s) => s),
          ),
        ],
        ["nested", debug_bool(nested, f)],
        ["id", debug_NodeId(id, f)],
        ["def_id", debug_LocalDefId(def_id, f)],
      ]);
    }
    case "Glob": {
      const { max_vis, id, def_id } = v;
      return debug_struct(f, "Glob", [
        ["max_vis", debug_CmCell(max_vis, f, (x, f) => debug_option(x, f, (y, f) => debug_Visibility(y, f, debug_LocalModId)))],
        ["id", debug_NodeId(id, f)],
        ["def_id", debug_LocalDefId(def_id, f)],
      ]);
    }
    case "ExternCrate": {
      const { source, target, id, def_id } = v;
      return debug_struct(f, "ExternCrate", [
        ["source", debug_option(source, f, debug_Symbol)],
        ["target", debug_Ident(target, f)],
        ["id", debug_NodeId(id, f)],
        ["def_id", debug_LocalDefId(def_id, f)],
      ]);
    }
    case "MacroUse":
      return debug_struct(f, "MacroUse", [["warn_private", debug_bool(v.warn_private, f)]]);
    case "MacroExport":
      return debug_struct(f, "MacroExport", []);
  }
};

// impl<'ra> ImportData<'ra>

// rustc: compiler/rustc_resolve/src/imports.rs:218 is_glob
ImportData.prototype.is_glob = function (this: ImportData): boolean {
  return this.kind.$ === "Glob";
};

// rustc: compiler/rustc_resolve/src/imports.rs:222 is_nested
ImportData.prototype.is_nested = function (this: ImportData): boolean {
  switch (this.kind.$) {
    case "Single":
      return this.kind.nested;
    default:
      return false;
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:229 id
ImportData.prototype.id = function (this: ImportData): NodeId | undefined {
  switch (this.kind.$) {
    case "Single":
    case "Glob":
    case "ExternCrate":
      return this.kind.id;
    case "MacroUse":
    case "MacroExport":
      return undefined;
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:238 def_id
ImportData.prototype.def_id = function (this: ImportData): LocalDefId | undefined {
  switch (this.kind.$) {
    case "Single":
    case "Glob":
    case "ExternCrate":
      return this.kind.def_id;
    case "MacroUse":
    case "MacroExport":
      return undefined;
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:247 simplify
ImportData.prototype.simplify = function (this: ImportData): Reexport {
  switch (this.kind.$) {
    case "Single":
      return { $: "Single", _0: LocalDefId.to_def_id(this.kind.def_id) };
    case "Glob":
      return { $: "Glob", _0: LocalDefId.to_def_id(this.kind.def_id) };
    case "ExternCrate":
      return { $: "ExternCrate", _0: LocalDefId.to_def_id(this.kind.def_id) };
    case "MacroUse":
      return { $: "MacroUse" };
    case "MacroExport":
      return { $: "MacroExport" };
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:257 summary
ImportData.prototype.summary = function (this: ImportData): ImportSummary {
  return {
    vis: this.vis,
    nearest_parent_mod: this.parent_scope.module.nearest_parent_mod().expect_local(),
    is_single: this.kind.$ === "Single",
    priv_macro_use: this.kind.$ === "MacroUse" && this.kind.warn_private === true,
    span: this.span,
  };
};

/// Records information about the resolution of a name in a namespace of a module.
export const NameResolution = gen.NameResolution as typeof gen.NameResolution & {
  new: (orig_ident_span: Span) => NameResolution;
};

// rustc: compiler/rustc_resolve/src/imports.rs:286 new
NameResolution.new = function (orig_ident_span: Span): NameResolution {
  // `NameResolution { single_imports: FxIndexSet::default(), orig_ident_span, .. }`
  return new gen.NameResolution(new Set(), undefined, undefined, orig_ident_span);
};

/// Returns the best declaration if it is not going to change, and `None` if the best
/// declaration may still change to something else.
/// FIXME: this function considers `single_imports`, but not `unexpanded_invocations`, so
/// the returned declaration may actually change after expanding macros in the same module,
/// because of this fact we have glob overwriting (`select_glob_decl`). Consider using
/// `unexpanded_invocations` here and avoiding glob overwriting entirely, if it doesn't cause
/// code breakage in practice.
/// FIXME: relationship between this function and similar `DeclData::determined` is unclear.
// rustc: compiler/rustc_resolve/src/imports.rs:298 determined_decl
NameResolution.prototype.determined_decl = function (this: NameResolution): Decl | undefined {
  if (this.non_glob_decl !== undefined) {
    return this.non_glob_decl;
  } else if (this.glob_decl !== undefined && this.single_imports.size === 0) {
    return this.glob_decl;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:308 best_decl
NameResolution.prototype.best_decl = function (this: NameResolution): Decl | undefined {
  return this.non_glob_decl ?? this.glob_decl;
};

// module to keep the TLS private and only accessible through the function `enter_cycle_detector`.
// pub(crate) mod cycle_detection

/// PORT: the key's `*const ()` is the module's arena address; here the `LocalModule` object itself
/// (compared by identity, like the pointer). The generated `ActiveResolutionGuard` maps the raw
/// pointer to `null` (typemap), so the guard is this local interface (handoff: typemap entry).
export interface ActiveResolutionGuard {
  key: [LocalModule, BindingKey];
}

/// During import resolution, recursive imports can form cycles.
/// This set stores the active resolution stack for the current thread.
/// By keeping track of the module and `BindingKey` pair that identifies
/// the specific resolution.
///
/// The pointer is the interned address of a `Interned<'ra, ModuleData>` allocated
/// in the `Resolver Arenas` (lifetime `'ra`), it is thus stable and allows casting
/// to a `*const ()` for comparison. This is done because we can't use lifetimes
/// other than `'static` in thread local storage.
const ACTIVE_RESOLUTIONS: [LocalModule, BindingKey][] = [];

/** `(*const (), BindingKey)` equality: pointer identity + derived `PartialEq` of `BindingKey`. */
function active_key_eq(a: [LocalModule, BindingKey], b: [LocalModule, BindingKey]): boolean {
  return a[0] === b[0] && BindingKey_eq(a[1], b[1]);
}

// impl Drop for ActiveResolutionGuard
// PORT: `Drop` -> callers call this where the guard goes out of scope.
// rustc: compiler/rustc_resolve/src/imports.rs:338 drop
export function ActiveResolutionGuard_drop(self: ActiveResolutionGuard): void {
  // ACTIVE_RESOLUTIONS.with_borrow_mut(|ar| ..)
  const ar = ACTIVE_RESOLUTIONS;
  // Only this guard is allowed to remove this key.
  const popped = ar.pop();
  assert(popped !== undefined && active_key_eq(self.key, popped), "This guard should be the only one removing this key");
}

/// Returns `Err(())` if a cycle is detected, otherwise this returns a
/// guard that will remove the resolution when dropped.
// rustc: compiler/rustc_resolve/src/imports.rs:351 enter_cycle_detector
export function enter_cycle_detector(module: LocalModule, binding_key: BindingKey): Result<ActiveResolutionGuard, null> {
  const module_key = module;
  const key: [LocalModule, BindingKey] = [module_key, binding_key];
  const ar = ACTIVE_RESOLUTIONS;
  if (ar.some((k) => active_key_eq(k, key))) {
    return Err(null);
  }
  ar.push(key);
  return Ok({ key });
}

// Reexports of the form `pub use foo as bar;` where `foo` is `extern crate foo;`
// are permitted for backward-compatibility under a deprecation lint.
// rustc: compiler/rustc_resolve/src/imports.rs:385 pub_use_of_private_extern_crate_hack
export function pub_use_of_private_extern_crate_hack(import_: ImportSummary, decl: Decl): LocalDefId | undefined {
  if (import_.is_single && decl.kind.$ === "Import") {
    const decl_import = decl.kind.import;
    if (decl_import.kind.$ === "ExternCrate" && Visibility.is_public(import_.vis)) {
      return decl_import.kind.def_id;
    }
  }
  return undefined;
}

/// Removes identical import layers from two declarations.
// rustc: compiler/rustc_resolve/src/imports.rs:401 remove_same_import
export function remove_same_import(d1: Decl, d2: Decl): [Decl, Decl] {
  if (d1.kind.$ === "Import" && d2.kind.$ === "Import" && d1.kind.import === d2.kind.import) {
    const d1_next = d1.kind.source_decl;
    const d2_next = d2.kind.source_decl;
    assert(d1.expansion === d2.expansion, "assertion `left == right` failed\n  left: d1.expansion\n right: d2.expansion");
    assert(d1.span === d2.span, "assertion `left == right` failed\n  left: d1.span\n right: d2.span");
    if (!ambiguity_eq(d1.ambiguity.get(), d2.ambiguity.get())) {
      assert(d1.ambiguity.get() !== undefined, "assertion failed: d1.ambiguity.get().is_some()");
    }
    // Visibility of the new import declaration may be different,
    // because it already incorporates the visibility of the source binding.
    return remove_same_import(d1_next, d2_next);
  } else {
    return [d1, d2];
  }
}

/** `Option<(Decl, bool)>` equality (`Decl` by identity). */
function ambiguity_eq(a: [Decl, boolean] | undefined, b: [Decl, boolean] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/** `Option<Visibility<ModId>>` equality. */
function opt_vis_eq(a: Visibility<ModId> | undefined, b: Visibility<ModId> | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Visibility_eq(a, b);
}

/** `#[derive(PartialEq)]` of `ModuleOrUniformRoot` (`Module` by identity). */
function ModuleOrUniformRoot_eq(a: ModuleOrUniformRoot, b: ModuleOrUniformRoot): boolean {
  switch (a.$) {
    case "Module":
      return b.$ === "Module" && a._0 === b._0;
    case "ModuleAndExternPrelude":
      return b.$ === "ModuleAndExternPrelude" && a._0 === b._0;
    case "OpenModule":
      return b.$ === "OpenModule" && a._0 === b._0;
    case "ExternPrelude":
    case "CurrentScope":
      return a.$ === b.$;
  }
}

/**
 * PORT: `FxIndexSet::swap_remove` on an insertion-ordered JS `Set` (elements compared by identity or as
 * numbers): the last element takes the removed element's position, as rustc_errors'
 * `index_map_swap_remove`. Returns whether the element was present.
 */
export function index_set_swap_remove<T>(set: Set<T>, value: T): boolean {
  if (!set.has(value)) return false;
  const items = [...set];
  const idx = items.indexOf(value);
  const last = items.pop() as T;
  if (idx < items.length) items[idx] = last;
  set.clear();
  for (const x of items) set.add(x);
  return true;
}

// impl<'ra, 'tcx> Resolver<'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/imports.rs:420 import_decl_vis
Resolver.prototype.import_decl_vis = function (this: Resolver, decl: Decl, import_: ImportSummary): Visibility {
  return this.import_decl_vis_ext(decl, import_, false);
};

// rustc: compiler/rustc_resolve/src/imports.rs:424 import_decl_vis_ext
Resolver.prototype.import_decl_vis_ext = function (this: Resolver, decl: Decl, import_: ImportSummary, min: boolean): Visibility {
  assert(Visibility.is_accessible_from(import_.vis, LocalModId.to_def_id(import_.nearest_parent_mod), this.tcx_), "assertion failed: import.vis.is_accessible_from(import.nearest_parent_mod, self.tcx)");
  const decl_vis = min ? decl.min_vis() : decl.vis();
  const ord: Ordering | undefined = Visibility.partial_cmp(decl_vis, import_.vis, this.tcx_);
  const extern_crate_hack = pub_use_of_private_extern_crate_hack(import_, decl) !== undefined;
  if (ord === "Less" && Visibility.is_accessible_from(decl_vis, LocalModId.to_def_id(import_.nearest_parent_mod), this.tcx_) && !extern_crate_hack) {
    // Imported declaration is less visible than the import, but is still visible
    // from the current module, use the declaration's visibility.
    return Visibility.expect_local(decl_vis);
  } else {
    // Good case - imported declaration is more visible than the import, or the same,
    // use the import's visibility.
    //
    // Bad case - imported declaration is too private for the current module.
    // It doesn't matter what visibility we choose here (except in the `PRIVATE_MACRO_USE`
    // and `PUB_USE_OF_PRIVATE_EXTERN_CRATE` cases), because an error will be reported.
    // Use import visibility to keep the all declaration visibilities in a module ordered.
    if (!min && (ord === undefined || ord === "Less") && !extern_crate_hack && !import_.priv_macro_use) {
      const msg = `cannot extend visibility from ${debug_Visibility(decl_vis, PLAIN, debug_ModId)} to ${debug_Visibility(import_.vis, PLAIN, debug_LocalModId)}`;
      this.dcx().span_delayed_bug(import_.span, msg);
    }
    return import_.vis;
  }
};

/// Given an import and the declaration that it points to,
/// create the corresponding import declaration.
// rustc: compiler/rustc_resolve/src/imports.rs:463 new_import_decl
Resolver.prototype.new_import_decl = function (this: Resolver, decl: Decl, import_: Import): Decl {
  const vis = this.import_decl_vis(decl, import_.summary());

  if (import_.kind.$ === "Glob") {
    const max_vis = import_.kind.max_vis;
    const cur = max_vis.get();
    if (Visibility_eq(vis, import_.vis) || cur === undefined || Visibility.greater_than(vis, cur, this.tcx_)) {
      // `set` can't fail because this can only happen during "write_import_resolutions"
      max_vis.set_checked(vis, this);
    }
  }

  return this.arenas.alloc_decl(
    new DeclData(
      { $: "Import", source_decl: decl, import: import_ },
      CmCell.new(undefined),
      import_.parent_scope.expansion,
      import_.span,
      Visibility.to_mod_id(vis),
      CmCell.new(undefined),
      CmCell.new(undefined),
      import_.parent_scope.module,
    ),
  );
};

// rustc: compiler/rustc_resolve/src/imports.rs:486 is_noise_0_7_0
Resolver.prototype.is_noise_0_7_0 = function (this: Resolver, old_glob_decl: Decl, glob_decl: Decl): boolean {
  if (glob_decl.kind.$ !== "Import") return unreachable();
  const i1 = glob_decl.kind.import;
  if (old_glob_decl.kind.$ !== "Import") return unreachable();
  const i2 = old_glob_decl.kind.import;
  if (i1.module_path.length !== 2) return false;
  let [seg1, seg2] = i1.module_path as [Segment, Segment];
  if (seg1.ident.name !== kw.SelfLower || Symbol.as_str(seg2.ident.name) !== "perlin_surflet") {
    return false;
  }
  if (i2.module_path.length !== 2) return false;
  [seg1, seg2] = i2.module_path as [Segment, Segment];
  if (seg1.ident.name !== kw.SelfLower || Symbol.as_str(seg2.ident.name) !== "perlin") {
    return false;
  }
  const def_id1 = def_Res.opt_def_id(glob_decl.res());
  if (def_id1 === undefined) return false;
  const def_id2 = def_Res.opt_def_id(old_glob_decl.res());
  if (def_id2 === undefined) return false;
  return (
    this.def_path_str(def_id1).endsWith("noise_fns::generators::perlin_surflet::Perlin") &&
    this.def_path_str(def_id2).endsWith("noise_fns::generators::perlin::Perlin")
  );
};

// rustc: compiler/rustc_resolve/src/imports.rs:503 is_rustybuzz_0_4_0
Resolver.prototype.is_rustybuzz_0_4_0 = function (this: Resolver, old_glob_decl: Decl, glob_decl: Decl): boolean {
  if (glob_decl.kind.$ !== "Import") return unreachable();
  const i1 = glob_decl.kind.import;
  if (old_glob_decl.kind.$ !== "Import") return unreachable();
  const i2 = old_glob_decl.kind.import;
  if (i1.module_path.length !== 2) return false;
  const [seg1, seg2] = i1.module_path as [Segment, Segment];
  if (seg1.ident.name !== kw.Super || Symbol.as_str(seg2.ident.name) !== "gsubgpos") {
    return false;
  }
  if (i2.module_path.length !== 1) return false;
  const [seg1_] = i2.module_path as [Segment];
  if (seg1_.ident.name !== kw.Super) {
    return false;
  }
  const def_id1 = def_Res.opt_def_id(glob_decl.res());
  if (def_id1 === undefined) return false;
  const def_id2 = def_Res.opt_def_id(old_glob_decl.res());
  if (def_id2 === undefined) return false;
  return this.def_path_str(def_id1).endsWith("tables::gsubgpos::Class") && this.def_path_str(def_id2).endsWith("ggg::Class");
};

// rustc: compiler/rustc_resolve/src/imports.rs:520 is_pdf_0_9_0
Resolver.prototype.is_pdf_0_9_0 = function (this: Resolver, old_glob_decl: Decl, glob_decl: Decl): boolean {
  if (glob_decl.kind.$ !== "Import") return unreachable();
  const i1 = glob_decl.kind.import;
  if (old_glob_decl.kind.$ !== "Import") return unreachable();
  const i2 = old_glob_decl.kind.import;
  if (i1.module_path.length !== 2) return false;
  let [seg1, seg2] = i1.module_path as [Segment, Segment];
  if (seg1.ident.name !== kw.Crate || Symbol.as_str(seg2.ident.name) !== "content") {
    return false;
  }
  if (i2.module_path.length !== 2) return false;
  [seg1, seg2] = i2.module_path as [Segment, Segment];
  if (seg1.ident.name !== kw.Crate || Symbol.as_str(seg2.ident.name) !== "object") {
    return false;
  }
  const def_id1 = def_Res.opt_def_id(glob_decl.res());
  if (def_id1 === undefined) return false;
  const def_id2 = def_Res.opt_def_id(old_glob_decl.res());
  if (def_id2 === undefined) return false;
  return this.def_path_str(def_id1).endsWith("crate::content::Rect") && this.def_path_str(def_id2).endsWith("crate::object::types::Rect");
};

// rustc: compiler/rustc_resolve/src/imports.rs:537 is_net2_0_2_39
Resolver.prototype.is_net2_0_2_39 = function (this: Resolver, old_glob_decl: Decl, glob_decl: Decl): boolean {
  if (glob_decl.kind.$ !== "Import") return unreachable();
  const i1 = glob_decl.kind.import;
  if (old_glob_decl.kind.$ !== "Import") return unreachable();
  const i2 = old_glob_decl.kind.import;
  if (i1.module_path.length !== 4) return false;
  let [seg1, seg2, seg3, seg4] = i1.module_path as [Segment, Segment, Segment, Segment];
  if (
    seg1.ident.name !== kw.PathRoot ||
    Symbol.as_str(seg2.ident.name) !== "winapi" ||
    Symbol.as_str(seg3.ident.name) !== "shared" ||
    Symbol.as_str(seg4.ident.name) !== "ws2def"
  ) {
    return false;
  }
  if (i2.module_path.length !== 4) return false;
  [seg1, seg2, seg3, seg4] = i2.module_path as [Segment, Segment, Segment, Segment];
  if (
    seg1.ident.name !== kw.PathRoot ||
    Symbol.as_str(seg2.ident.name) !== "winapi" ||
    Symbol.as_str(seg3.ident.name) !== "um" ||
    Symbol.as_str(seg4.ident.name) !== "winsock2"
  ) {
    return false;
  }
  const def_id1 = def_Res.opt_def_id(glob_decl.res());
  if (def_id1 === undefined) return false;
  const def_id2 = def_Res.opt_def_id(old_glob_decl.res());
  if (def_id2 === undefined) return false;
  return this.def_path_str(def_id1).startsWith("winapi::shared::ws2def::") && this.def_path_str(def_id2).startsWith("winapi::um::winsock2::");
};

/// If `glob_decl` attempts to overwrite `old_glob_decl` in a module,
/// decide which one to keep.
// rustc: compiler/rustc_resolve/src/imports.rs:564 select_glob_decl
Resolver.prototype.select_glob_decl = function (this: Resolver, old_glob_decl: Decl, glob_decl: Decl): Decl {
  assert(glob_decl.is_glob_import(), "assertion failed: glob_decl.is_glob_import()");
  assert(old_glob_decl.is_glob_import(), "assertion failed: old_glob_decl.is_glob_import()");
  assert(glob_decl !== old_glob_decl, "assertion `left != right` failed\n  left: glob_decl\n right: old_glob_decl");
  // `best_decl` with a given key in a module may be overwritten in a
  // number of cases (all of them can be seen below in the `match` in `try_define_local`),
  // all these overwrites will be re-fetched by glob imports importing
  // from that module without generating new ambiguities.
  // - A glob decl is overwritten by a non-glob decl arriving later.
  // - A glob decl is overwritten by a glob decl re-fetching an
  //   overwritten decl from other module (the recursive case).
  // Here we are detecting all such re-fetches and overwrite old decls
  // with the re-fetched decls.
  // This is probably incorrect in corner cases, and the outdated decls still get
  // propagated to other places and get stuck there, but that's what we have at the moment.
  const [old_deep_decl, deep_decl] = remove_same_import(old_glob_decl, glob_decl);
  if (deep_decl !== glob_decl) {
    // Some import layers have been removed, need to overwrite.
    assert(old_deep_decl !== old_glob_decl, "assertion `left != right` failed\n  left: old_deep_decl\n right: old_glob_decl");
    assert(!deep_decl.is_glob_import(), "assertion failed: !deep_decl.is_glob_import()");
    const old_ambig = old_glob_decl.ambiguity.get();
    if (old_ambig !== undefined && glob_decl.ambiguity.get() === undefined) {
      // Do not lose glob ambiguities when re-fetching the glob.
      glob_decl.ambiguity.set_checked([old_ambig[0], true], this);
    }
    return glob_decl;
  } else if (!Res_eq(glob_decl.res(), old_glob_decl.res())) {
    const warning =
      this.is_noise_0_7_0(old_glob_decl, glob_decl) ||
      this.is_rustybuzz_0_4_0(old_glob_decl, glob_decl) ||
      this.is_pdf_0_9_0(old_glob_decl, glob_decl) ||
      this.is_net2_0_2_39(old_glob_decl, glob_decl);
    old_glob_decl.ambiguity.set_checked([glob_decl, warning], this);
    return old_glob_decl;
  } else {
    const old_vis = old_glob_decl.vis();
    const vis = glob_decl.vis();
    if (!Visibility_eq(old_vis, vis)) {
      // We are glob-importing the same item but with a different visibility.
      // All visibilities here are ordered because all of them are ancestors of `module`.
      if (Visibility.greater_than(vis, old_vis, this.tcx_)) {
        old_glob_decl.ambiguity_vis_max.set_checked(glob_decl, this);
      } else {
        const old_min_vis = old_glob_decl.min_vis();
        if (!Visibility_eq(old_min_vis, vis) && Visibility.greater_than(old_min_vis, vis, this.tcx_)) {
          old_glob_decl.ambiguity_vis_min.set_checked(glob_decl, this);
        }
      }
      return old_glob_decl;
    } else if (glob_decl.is_ambiguity_recursive() && !old_glob_decl.is_ambiguity_recursive()) {
      // Overwriting a non-ambiguous glob import with an ambiguous glob import.
      old_glob_decl.ambiguity.set_checked([glob_decl, true], this);
      return old_glob_decl;
    } else {
      return old_glob_decl;
    }
  }
};

/// Attempt to put the declaration with the given name and namespace into the module,
/// and return existing declaration if there is a collision.
// rustc: compiler/rustc_resolve/src/imports.rs:624 try_plant_decl_into_local_module
Resolver.prototype.try_plant_decl_into_local_module = function (
  this: Resolver,
  ident: IdentKey,
  orig_ident_span: Span,
  ns: Namespace,
  decl: Decl,
): Result<undefined, Decl> {
  assert(decl.ambiguity.get() === undefined, "assertion failed: decl.ambiguity.get().is_none()");
  assert(decl.ambiguity_vis_max.get() === undefined, "assertion failed: decl.ambiguity_vis_max.get().is_none()");
  assert(decl.ambiguity_vis_min.get() === undefined, "assertion failed: decl.ambiguity_vis_min.get().is_none()");
  const module = unwrap(decl.parent_module).expect_local();
  assert(this.is_accessible_from(decl.vis(), module.to_module()), "assertion failed: self.is_accessible_from(decl.vis(), module.to_module())");
  const res = decl.res();
  this.check_reserved_macro_name(ident.name, orig_ident_span, res);
  // Even if underscore names cannot be looked up, we still need to add them to modules,
  // because they can be fetched by glob imports from those modules, and bring traits
  // into scope both directly and through glob imports.
  const key = BindingKey.new_disambiguated(ident, ns, () => {
    module.underscore_disambiguator.update(this, (d) => d + 1);
    return module.underscore_disambiguator.get();
  });
  return this.update_local_resolution(module, key, orig_ident_span, (this_, resolution): Result<undefined, Decl> => {
    if (res.$ === "Err") {
      const old_decl = resolution.best_decl();
      if (old_decl !== undefined && old_decl.res().$ !== "Err") {
        // Do not override real declarations with `Res::Err`s from error recovery.
        // FIXME: this special case shouldn't be necessary, but removing it triggers an ICE
        // due to some other issues (#157406, tests/ui/imports/dummy-import-ice.rs).
        return Ok(undefined);
      }
    }
    if (decl.is_glob_import()) {
      const old_decl = resolution.glob_decl;
      resolution.glob_decl = old_decl !== undefined ? this_.select_glob_decl(old_decl, decl) : decl;
    } else {
      const old_decl = resolution.non_glob_decl;
      if (old_decl !== undefined) return Err(old_decl);
      resolution.non_glob_decl = decl;
    }

    return Ok(undefined);
  });
};

// Use `f` to mutate the resolution of the name in the module.
// If the resolution becomes a success, define it in the module's glob importers.
// rustc: compiler/rustc_resolve/src/imports.rs:673 update_local_resolution
Resolver.prototype.update_local_resolution = function <T>(
  this: Resolver,
  module: LocalModule,
  key: BindingKey,
  orig_ident_span: Span,
  f: (this_: Resolver, _1: NameResolution) => T,
): T {
  // Ensure that `resolution` isn't borrowed when defining in the module's glob importers,
  // during which the resolution might end up getting re-defined via a glob cycle.
  let binding: Decl;
  let t: T;
  {
    const resolution = this.resolution_or_default(module.to_module(), key, orig_ident_span).borrow_mut(this).value;
    const old_decl = resolution.determined_decl();
    const old_vis = old_decl?.vis();

    t = f(this, resolution);

    const b = resolution.determined_decl();
    if (b !== undefined && (old_decl !== b || !opt_vis_eq(old_vis, b.vis()))) {
      binding = b;
    } else {
      return t;
    }
  }

  const cell = module.glob_importers;
  const r = cell.try_borrow_mut(this);
  if (r.$ === "Err" || GLOB_IMPORTERS_BORROWED.has(cell)) {
    return t;
  }
  const glob_importers = r._0.value;
  GLOB_IMPORTERS_BORROWED.add(cell);
  try {
    // Define or update `binding` in `module`s glob importers.
    for (const import_ of glob_importers) {
      // `let mut ident = key.ident;` (a copy)
      const ident = clone_IdentKey(key.ident);
      const ctxt: MutRef<Macros20NormalizedSyntaxContext> = { value: ident.ctxt };
      const adjusted = Macros20NormalizedSyntaxContext.update_unchecked(ctxt, (ctxt) =>
        SyntaxContext.reverse_glob_adjust(ctxt, module.expansion, import_.span),
      );
      ident.ctxt = ctxt.value;
      let scope;
      if (adjusted !== undefined && adjusted._0 !== undefined) {
        scope = this.expn_def_scope(adjusted._0);
      } else if (adjusted !== undefined) {
        scope = import_.parent_scope.module;
      } else {
        continue;
      }
      if (this.is_accessible_from(binding.vis(), scope)) {
        const import_decl = this.new_import_decl(binding, import_);
        const p = this.try_plant_decl_into_local_module(ident, orig_ident_span, key.ns, import_decl);
        if (p.$ === "Err") unwrap_failed("planting a glob cannot fail", p._0);
      }
    }
  } finally {
    // `glob_importers` (the `RefMut`) is dropped
    GLOB_IMPORTERS_BORROWED.delete(cell);
  }

  return t;
};

/**
 * PORT: `CmRefCell`'s `RefCell` borrow tracking is erased (lib.ts `mod ref_mut`). The one mutable borrow
 * whose failure upstream observes is `update_local_resolution`'s `glob_importers.try_borrow_mut`, held
 * while it plants into the glob importers: a re-entrant call for the same module (a glob cycle) gets
 * `Err` and stops there. The cells currently borrowed that way are tracked here.
 */
const GLOB_IMPORTERS_BORROWED = new Set<CmRefCell<Import[]>>();

/** `Result::expect` on an `Err`: panics with `"{msg}: {err:?}"`. */
function unwrap_failed(msg: string, err: Decl): never {
  return panic(`${msg}: ${debug_DeclData(err, PLAIN)}`);
}

// Define a dummy resolution containing a `Res::Err` as a placeholder for a failed
// or indeterminate resolution, also mark such failed imports as used to avoid duplicate diagnostics.
// rustc: compiler/rustc_resolve/src/imports.rs:731 import_dummy_binding
Resolver.prototype.import_dummy_binding = function (this: Resolver, import_: Import, is_indeterminate: boolean): void {
  if (import_.kind.$ === "Single") {
    const { target, decls } = import_.kind;
    if (!(is_indeterminate || decls.iter().every((d) => PendingDecl.decl(d.get()) === undefined))) {
      return; // Has resolution, do not create the dummy binding
    }
    let dummy_decl = this.dummy_decl;
    dummy_decl = this.new_import_decl(dummy_decl, import_);
    this.per_ns_mut((this_, ns) => {
      const ident = IdentKey.new(target);
      // This can fail, dummies are inserted only in non-occupied slots.
      this_.try_plant_decl_into_local_module(ident, target.span, ns, dummy_decl);
      // Don't remove underscores from `single_imports`, they were never added.
      if (target.name !== kw.Underscore) {
        const key = BindingKey.new(ident, ns);
        this_.update_local_resolution(import_.parent_scope.module.expect_local(), key, target.span, (_, resolution) => {
          index_set_swap_remove(resolution.single_imports, import_);
        });
      }
    });
    this.record_use(target, dummy_decl, "Other");
  } else if (import_.imported_module.get() === undefined) {
    this.import_use_map.set(import_, "Other");
    const id = import_.id();
    if (id !== undefined) {
      this.used_imports.add(id);
    }
  }
};

// Import resolution
//
// This is a batched fixed-point algorithm. Each import is resolved in
// isolation, with any resolutions collected for later.
// After a full pass over the current set of `indeterminate_imports`,
// the collected resolutions are committed together. The process
// repeats until either no imports remain or no further progress can
// be made.

/// Resolves all imports for the crate. This method performs the fixed-
/// point iteration.
// rustc: compiler/rustc_resolve/src/imports.rs:775 resolve_imports
Resolver.prototype.resolve_imports = function (this: Resolver): void {
  // PORT: `usize::MAX`
  let prev_indeterminate_count = Number.MAX_SAFE_INTEGER;
  let indeterminate_count = this.indeterminate_imports.length * 3;
  while (indeterminate_count < prev_indeterminate_count) {
    prev_indeterminate_count = indeterminate_count;
    indeterminate_count = 0;

    // `mem::take(&mut self.indeterminate_imports)`
    const imports_to_resolve = this.indeterminate_imports;
    this.indeterminate_imports = [];

    // SAFETY: This is a "top-level" function used by the macro expansion code, unless some
    // weird thing is done, all `tracked` borrows done in the previous call of
    // `resolve_imports` are dropped when that call ended.
    this.speculative_flag.set(true);
    // `rustc_data_structures::sync::par_for_each_slice` (sequential: the compiler is single-threaded)
    for (const entry of imports_to_resolve) {
      const [resolution, count] = this.resolve_import(entry[0]);
      entry[1] = resolution;
      entry[2] = count;
    }
    // SAFETY: All `untracked` borrows are dropped after the `par_for_each_slice` call,
    // as they cannot escape since they are tied to the `CmRefCell` they borrowed from.
    //
    // Note: Some `CmRefCell`s are arena allocated and thus have the `'ra` lifetime,
    // allowing these borrows to escape, but that does not and should not happen.
    this.speculative_flag.set(false);
    this.write_import_resolutions(imports_to_resolve);

    // `imports_to_resolve.extract_if(.., |(_, _, count)| { indeterminate_count += *count; *count > 0 }).collect()`
    const extracted: [Import, ImportResolution | undefined, number][] = [];
    const remaining: [Import, ImportResolution | undefined, number][] = [];
    for (const entry of imports_to_resolve) {
      indeterminate_count += entry[2];
      if (entry[2] > 0) {
        extracted.push(entry);
      } else {
        remaining.push(entry);
      }
    }
    this.indeterminate_imports = extracted;
    this.determined_imports.push(...remaining.map(([i, _, __]) => i));
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:813 write_import_resolutions
Resolver.prototype.write_import_resolutions = function (
  this: Resolver,
  import_resolutions: readonly [Import, ImportResolution | undefined, number][],
): void {
  for (const [import_, resolution, _] of import_resolutions) {
    if (resolution === undefined) {
      continue;
    }
    const { imported_module } = resolution;
    import_.imported_module.set(imported_module, this);

    if (imported_module.$ === "Module") {
      const module = imported_module._0;
      if (import_.is_glob() && import_.parent_scope.module !== module && module.is_local()) {
        module.glob_importers.borrow_mut(this).value.push(import_);
      }
    }
  }

  for (const [import_, resolution, _] of import_resolutions) {
    if (resolution === undefined) {
      continue;
    }
    const { imported_module, kind: resolution_kind } = resolution;

    if (import_.kind.$ === "Single" && resolution_kind.$ === "Single") {
      const { target, decls } = import_.kind;
      const import_decls = resolution_kind._0;
      this.per_ns_mut((this_, ns) => {
        const pd = import_decls.index(ns);
        switch (pd.$) {
          case "Ready": {
            const decl = pd._0;
            if (decl !== undefined) {
              // We need the `target`, `source` can be extracted.
              const import_decl = this_.new_import_decl(decl, import_);
              if (import_decl.is_assoc_item() && !this_.features.import_trait_associated_functions()) {
                feature_err(
                  this_.tcx_.sess,
                  sym.import_trait_associated_functions,
                  import_.span,
                  "`use` associated items of traits is unstable",
                ).emit();
              }
              this_.plant_decl_into_local_module(IdentKey.new(target), target.span, ns, import_decl);
              decls.index(ns).set({ $: "Ready", _0: import_decl }, this_);
            } else {
              // Don't remove underscores from `single_imports`, they were never added.
              if (target.name !== kw.Underscore) {
                const key = BindingKey.new(IdentKey.new(target), ns);
                this_.update_local_resolution(import_.parent_scope.module.expect_local(), key, target.span, (_, resolution) => {
                  index_set_swap_remove(resolution.single_imports, import_);
                });
              }
              decls.index(ns).set({ $: "Ready", _0: undefined }, this_);
            }
            break;
          }
          case "Pending":
            break;
        }
      });
    } else if (import_.kind.$ === "Glob" && resolution_kind.$ === "Glob") {
      const id = import_.kind.id;
      const imported_decls = resolution_kind._0;
      if (imported_module.$ !== "Module") {
        this.dcx().emit_err(diagnostics.CannotGlobImportAllCrates_diagnostic({ span: import_.span }));
        continue;
      }
      const module = imported_module._0;

      if (module.is_trait() && !this.features.import_trait_associated_functions()) {
        feature_err(this.tcx_.sess, sym.import_trait_associated_functions, import_.span, "`use` associated items of traits is unstable").emit();
      }

      for (const [binding, key, orig_ident_span] of imported_decls) {
        const import_decl = this.new_import_decl(binding, import_);
        const p = this.try_plant_decl_into_local_module(key.ident, orig_ident_span, key.ns, import_decl);
        if (p.$ === "Err") unwrap_failed("planting a glob cannot fail", p._0);
      }

      this.record_partial_res(id, PartialRes.new(unwrap(module.res())));
    } else {
      // Something weird happened, which shouldn't have happened.
      unreachable("mismatched import and resolution kind");
    }
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:923 finalize_imports
Resolver.prototype.finalize_imports = function (this: Resolver): void {
  const module_children = new Map<LocalDefId, ModChild[]>();
  const ambig_module_children = new Map<LocalDefId, AmbigModChild[]>();
  for (const module of this.local_modules) {
    this.finalize_resolutions_in(module, module_children, ambig_module_children);
  }
  this.module_children = module_children;
  this.ambig_module_children = ambig_module_children;

  const seen_spans = new Set<Span>();
  let errors: [Import, UnresolvedImportError][] = [];
  let prev_root_id: NodeId = NodeIdC.ZERO;
  const determined_imports = this.determined_imports;
  this.determined_imports = [];
  const indeterminate_imports = this.indeterminate_imports;
  this.indeterminate_imports = [];

  let glob_error = false;
  for (const [is_indeterminate, import_] of [
    ...determined_imports.map((i): [boolean, Import] => [false, i]),
    ...indeterminate_imports.map(([i, _, __]): [boolean, Import] => [true, i]),
  ]) {
    const unresolved_import_error = this.finalize_import(import_);
    // If this import is unresolved then create a dummy import
    // resolution for it so that later resolve stages won't complain.
    this.import_dummy_binding(import_, is_indeterminate);

    const err = unresolved_import_error;
    if (err === undefined) continue;

    glob_error ||= import_.is_glob();

    if (
      import_.kind.$ === "Single" &&
      import_.kind.source.name === kw.SelfLower &&
      // Silence `unresolved import` error if E0429 is already emitted
      (() => {
        const d = import_.kind.decls.value_ns.get();
        return d.$ === "Ready" && d._0 === undefined;
      })()
    ) {
      continue;
    }

    if (prev_root_id !== NodeIdC.ZERO && prev_root_id !== import_.root_id && errors.length !== 0) {
      // In the case of a new import line, throw a diagnostic message
      // for the previous line.
      this.throw_unresolved_import_error(errors, glob_error);
      errors = [];
    }
    if (!seen_spans.has(err.span)) {
      seen_spans.add(err.span);
      errors.push([import_, err]);
      prev_root_id = import_.root_id;
    }
  }

  if (this.cstore().had_extern_crate_load_failure()) {
    this.tcx_.sess.dcx().abort_if_errors();
  }

  if (errors.length !== 0) {
    this.throw_unresolved_import_error(errors, glob_error);
    return;
  }

  for (const [import_, _, __] of indeterminate_imports) {
    const path = import_path_to_string(
      import_.module_path.map((seg) => seg.ident),
      import_.kind,
      import_.span,
    );
    // FIXME: there should be a better way of doing this than
    // formatting this as a string then checking for `::`
    if (path.includes("::")) {
      const err: UnresolvedImportError = {
        span: import_.span,
        label: undefined,
        note: undefined,
        suggestion: undefined,
        help: undefined,
        candidates: undefined,
        segment: undefined,
        module: undefined,
        on_unknown_attr: import_.on_unknown_attr === undefined ? undefined : clone_OnUnknownData(import_.on_unknown_attr),
      };
      errors.push([import_, err]);
    }
  }

  if (errors.length !== 0) {
    this.throw_unresolved_import_error(errors, glob_error);
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:1012 lint_reexports
Resolver.prototype.lint_reexports = function (this: Resolver, exported_ambiguities: Set<Decl>): void {
  for (const module of this.local_modules) {
    for (const [key, resolution_] of this.resolutions(module.to_module())) {
      const resolution = resolution_.borrow_checked(this);
      const binding = resolution.best_decl();
      if (binding === undefined) continue;

      // Report "cannot reexport" errors for exotic cases involving macros 2.0
      // privacy bending or invariant-breaking code under deprecation lints.
      for (const decl of [resolution.non_glob_decl, resolution.glob_decl]) {
        if (
          decl !== undefined &&
          decl.kind.$ === "Import" &&
          // FIXME: Do not check visibility-ambiguous imports for now. To check them
          // properly we need to preserve all imports in ambiguous glob sets and
          // check them all individually.
          decl.ambiguity_vis_max.get() === undefined
        ) {
          const { source_decl, import: import_ } = decl.kind;
          // The source entity is too private to be reexported
          // with the given import declaration's visibility.
          const ord = Visibility.partial_cmp(source_decl.vis(), decl.vis(), this.tcx_);
          if (ord === undefined || ord === "Less") {
            const ident = import_.kind.$ === "Single" ? import_.kind.source : key.ident.orig(resolution.orig_ident_span);
            const lint = this.report_cannot_reexport(import_, source_decl, ident, key.ns);
            if (lint !== undefined) {
              this.lint_buffer_.add_early_lint(lint);
            }
          }
        }
      }

      if (binding.kind.$ === "Import") {
        const import_ = binding.kind.import;
        const amb = binding.ambiguity.get();
        if (amb !== undefined && binding.res().$ !== "Err" && exported_ambiguities.has(binding)) {
          const [amb_binding, _] = amb;
          this.lint_buffer_.buffer_lint(
            AMBIGUOUS_GLOB_REEXPORTS,
            import_.root_id,
            import_.root_span,
            diagnostics.AmbiguousGlobReexports_diagnostic({
              name: Symbol.as_str(key.ident.name),
              namespace: Namespace.descr(key.ns),
              first_reexport: import_.root_span,
              duplicate_reexport: amb_binding.span,
            }),
          );
        }
      }

      const glob_decl = resolution.glob_decl;
      if (glob_decl !== undefined && resolution.non_glob_decl !== undefined) {
        if (binding.res().$ !== "Err" && glob_decl.res().$ !== "Err" && glob_decl.kind.$ === "Import") {
          const glob_import = glob_decl.kind.import;
          const glob_import_def_id = glob_import.def_id();
          if (
            glob_import_def_id !== undefined &&
            this.effective_visibilities.is_exported(glob_import_def_id) &&
            Visibility.is_public(glob_decl.vis()) &&
            !Visibility.is_public(binding.vis())
          ) {
            let binding_id: NodeId | undefined;
            switch (binding.kind.$) {
              case "Def":
                binding_id = this.def_id_to_node_id(def_Res.def_id(binding.kind._0, debug_NodeId).expect_local());
                break;
              case "Import":
                binding_id = binding.kind.import.id();
                break;
            }
            if (binding_id !== undefined) {
              this.lint_buffer_.buffer_lint(
                HIDDEN_GLOB_REEXPORTS,
                binding_id,
                binding.span,
                diagnostics.HiddenGlobReexports_diagnostic({
                  name: Symbol.as_str(key.ident.name),
                  namespace: Namespace.descr(key.ns),
                  glob_reexport: glob_decl.span,
                  private_item: binding.span,
                }),
              );
            }
          }
        }
      }

      if (binding.kind.$ === "Import") {
        const import_ = binding.kind.import;
        const binding_id = import_.id();
        if (binding_id !== undefined) {
          const import_def_id = unwrap(import_.def_id());
          const res = binding.res();
          if (
            this.effective_visibilities.is_exported(import_def_id) &&
            res.$ === "Def" &&
            res._0.$ !== "Ctor" &&
            !res._1.is_local() &&
            this.tcx_.is_private_dep(res._1.krate)
          ) {
            const reexported_def_id = res._1;
            this.lint_buffer_.buffer_lint(
              EXPORTED_PRIVATE_DEPENDENCIES,
              binding_id,
              binding.span,
              diagnostics.ReexportPrivateDependency_diagnostic({
                name: key.ident.name,
                kind: def_Res.descr(binding.res()),
                krate: this.tcx_.crate_name(reexported_def_id.krate),
              }),
            );
          }
        }
      }
    }
  }
};

/// Attempts to resolve the given import, returning:
/// - `0` means its resolution is determined.
/// - Other values mean that indeterminate exists under certain namespaces.
///
/// Meanwhile, if resolution is successful, its result is returned.
// rustc: compiler/rustc_resolve/src/imports.rs:1125 resolve_import
Resolver.prototype.resolve_import = function (this: Resolver, import_: Import): [ImportResolution | undefined, number] {
  // debug!("(resolving import for module) resolving import `{}::{}` in `{}`", ..);
  let module: ModuleOrUniformRoot;
  const m = import_.imported_module.get();
  if (m !== undefined) {
    module = m;
  } else {
    const path_res = this.cm().maybe_resolve_path(import_.module_path, undefined, import_.parent_scope, import_);

    switch (path_res.$) {
      case "Module":
        module = path_res._0;
        break;
      case "Indeterminate":
        return [undefined, 3];
      case "NonModule":
      case "Failed":
        return [undefined, 0];
    }
  }

  let source: Ident;
  let bindings: PerNS<CmCell<PendingDecl>>;
  switch (import_.kind.$) {
    case "Single":
      source = import_.kind.source;
      bindings = import_.kind.decls;
      break;
    case "Glob": {
      const import_resolution: ImportResolution = {
        imported_module: module,
        kind: this.resolve_glob_import(import_, module),
      };
      return [import_resolution, 0];
    }
    default:
      return unreachable();
  }

  const decls: PerNS<PendingDecl> = PerNS_default((): PendingDecl => PendingDecl.Pending);
  let indeterminate_count = 0;
  this.per_ns((this_, ns) => {
    if (bindings.index(ns).get().$ !== "Pending") {
      return;
    }
    const binding_result = this_.cm().maybe_resolve_ident_in_module(module, source, ns, import_.parent_scope, import_);
    let pending_decl: PendingDecl;
    if (binding_result.$ === "Ok") {
      pending_decl = { $: "Ready", _0: binding_result._0 };
    } else if (binding_result._0 === "Determined") {
      pending_decl = { $: "Ready", _0: undefined };
    } else {
      indeterminate_count += 1;
      pending_decl = PendingDecl.Pending;
    }
    decls.index_mut(ns).value = pending_decl;
  });
  const import_resolution: ImportResolution = { imported_module: module, kind: { $: "Single", _0: decls } };

  return [import_resolution, indeterminate_count];
};

/// Performs final import resolution, consistency checks and error reporting.
///
/// Optionally returns an unresolved import error. This error is buffered and used to
/// consolidate multiple unresolved import errors into a single diagnostic.
// rustc: compiler/rustc_resolve/src/imports.rs:1194 finalize_import
Resolver.prototype.finalize_import = function (this: Resolver, import_: Import): UnresolvedImportError | undefined {
  const ignore_decl = import_.kind.$ === "Single" ? PendingDecl.decl(import_.kind.decls.type_ns.get()) : undefined;
  const ambiguity_errors_len = (errors: AmbiguityError[]): number => errors.filter((error) => error.warning === undefined).length;
  const prev_ambiguity_errors_len = ambiguity_errors_len(this.ambiguity_errors);
  const finalize = Finalize.with_root_span(import_.root_id, import_.span, import_.root_span);

  // We'll provide more context to the privacy errors later, up to `len`.
  const privacy_errors_len = this.privacy_errors.length;

  const path_res = this.cm_mut().resolve_path(import_.module_path, undefined, import_.parent_scope, finalize, ignore_decl, import_);

  const no_ambiguity = ambiguity_errors_len(this.ambiguity_errors) === prev_ambiguity_errors_len;

  let module: ModuleOrUniformRoot;
  switch (path_res.$) {
    case "Module": {
      module = path_res._0;
      // Consistency checks, analogous to `finalize_macro_resolutions`.
      const initial_module = import_.imported_module.get();
      if (initial_module !== undefined) {
        if (!ModuleOrUniformRoot_eq(module, initial_module) && no_ambiguity && !this.issue_145575_hack_applied) {
          span_bug(import_.span, "inconsistent resolution for an import");
        }
      } else if (this.privacy_errors.length === 0) {
        this.dcx().emit_err(diagnostics.CannotDetermineImportResolution_diagnostic({ span: import_.span }));
      }
      break;
    }
    case "Failed": {
      if (!path_res.is_error_from_last_segment) {
        const { span, segment, label, suggestion, help, module, message } = path_res;
        if (no_ambiguity) {
          if (!this.issue_145575_hack_applied) {
            assert(import_.imported_module.get() === undefined, "assertion failed: import.imported_module.get().is_none()");
          }
          this.report_error(span, {
            $: "FailedToResolve",
            segment: segment.name,
            label,
            suggestion,
            help,
            module,
            message,
          });
        }
        return undefined;
      } else {
        const { span, label, suggestion, help, module: module_, segment, note } = path_res;
        if (no_ambiguity) {
          if (!this.issue_145575_hack_applied) {
            assert(import_.imported_module.get() === undefined, "assertion failed: import.imported_module.get().is_none()");
          }
          const module = module_ !== undefined && module_.$ === "Module" ? module_._0.opt_def_id() : undefined;
          let err: UnresolvedImportError;
          const s = this.make_path_suggestion(import_.module_path.map(clone_Segment), import_.parent_scope);
          if (s !== undefined) {
            const [suggestion, note] = s;
            err = {
              span,
              label: undefined,
              note,
              suggestion: [[[span, Segment.names_to_string(suggestion)]], "a similar path exists", "MaybeIncorrect"],
              help: undefined,
              candidates: undefined,
              segment,
              module,
              on_unknown_attr: import_.on_unknown_attr === undefined ? undefined : clone_OnUnknownData(import_.on_unknown_attr),
            };
          } else {
            err = {
              span,
              label,
              note,
              suggestion,
              help,
              candidates: undefined,
              segment,
              module,
              on_unknown_attr: import_.on_unknown_attr === undefined ? undefined : clone_OnUnknownData(import_.on_unknown_attr),
            };
          }
          return err;
        }
        return undefined;
      }
    }
    case "NonModule": {
      const partial_res = path_res._0;
      const full = partial_res.full_res();
      if (no_ambiguity && !(full !== undefined && full.$ === "Err")) {
        // Check if there are no ambiguities and the result is not dummy.
        assert(import_.imported_module.get() === undefined, "assertion failed: import.imported_module.get().is_none()");
      }
      // The error was already reported earlier.
      return undefined;
    }
    case "Indeterminate":
      return unreachable();
  }

  let ident: Ident;
  let target: Ident;
  let bindings: PerNS<CmCell<PendingDecl>>;
  let import_id: NodeId;
  switch (import_.kind.$) {
    case "Single":
      ({ source: ident, target, decls: bindings, id: import_id } = import_.kind);
      break;
    case "Glob": {
      const { max_vis, id, def_id } = import_.kind;
      if (import_.module_path.length <= 1) {
        // HACK(eddyb) `lint_if_path_starts_with_module` needs at least
        // 2 segments, so the `resolve_path` above won't trigger it.
        const full_path = import_.module_path.map(clone_Segment);
        full_path.push(Segment.from_ident(Ident.dummy()));
        this.lint_if_path_starts_with_module(finalize, full_path, undefined);
      }

      if (module.$ === "Module" && module._0 === import_.parent_scope.module) {
        // Importing a module into itself is not allowed.
        return {
          span: import_.span,
          label: "cannot glob-import a module into itself",
          note: undefined,
          suggestion: undefined,
          help: undefined,
          candidates: undefined,
          segment: undefined,
          module: undefined,
          on_unknown_attr: undefined,
        };
      }
      const mv = max_vis.get();
      if (mv !== undefined && Visibility.greater_than(import_.vis, mv, this.tcx_)) {
        this.lint_buffer_.buffer_lint(
          UNUSED_IMPORTS,
          id,
          import_.span,
          diagnostics.RedundantImportVisibility_diagnostic({
            span: import_.span,
            help: null,
            max_vis: Visibility.to_string(mv, def_id, this.tcx_),
            import_vis: Visibility.to_string(import_.vis, def_id, this.tcx_),
          }),
        );
      }
      return undefined;
    }
    default:
      return unreachable();
  }

  if (this.privacy_errors.length !== privacy_errors_len) {
    // Get the Res for the last element, so that we can point to alternative ways of
    // importing it if available.
    const path = import_.module_path.map(clone_Segment);
    path.push(Segment.from_ident(ident));
    const r = this.cm_mut().resolve_path(path, undefined, import_.parent_scope, finalize, ignore_decl, undefined);
    if (r.$ === "Module" && r._0.$ === "Module") {
      const module = r._0._0;
      const mres = module.res();
      const res: [Res, Ident] | undefined = mres === undefined ? undefined : [mres, ident];
      for (const error of this.privacy_errors.slice(privacy_errors_len)) {
        error.outermost_res = res;
      }
    } else {
      // The final item is not a module (e.g., a struct, function, or macro).
      // Resolve it directly in the parent module to get its Res, so
      // `report_privacy_error()` can search for public re-export paths.
      for (const ns of ["TypeNS", "ValueNS", "MacroNS"] as const) {
        const b = this.cm().resolve_ident_in_module(module, ident, ns, import_.parent_scope, undefined, ignore_decl, undefined);
        if (b.$ === "Ok") {
          const res = b._0.res();
          for (const error of this.privacy_errors.slice(privacy_errors_len)) {
            error.outermost_res = [res, ident];
          }
          break;
        }
      }
    }
  }

  let all_ns_err = true;
  this.per_ns_mut((this_, ns) => {
    const binding = this_.cm_mut().resolve_ident_in_module(
      module,
      ident,
      ns,
      import_.parent_scope,
      new Finalize(finalize.node_id, finalize.path_span, finalize.root_span, false, finalize.used, finalize.stage, import_.summary()),
      PendingDecl.decl(bindings.index(ns).get()),
      import_,
    );

    if (binding.$ === "Ok") {
      const b = binding._0;
      // Consistency checks, analogous to `finalize_macro_resolutions`.
      const d = PendingDecl.decl(bindings.index(ns).get());
      let initial_res: Res | undefined;
      if (d !== undefined) {
        const initial_binding = d.import_source();
        all_ns_err = false;
        if (target.name === kw.Underscore && initial_binding.is_extern_crate() && !initial_binding.is_import()) {
          const used = import_.module_path.length === 0 ? "Scope" : "Other";
          // (the closure's `binding` is the import declaration `d`, shadowing the resolved one)
          this_.record_use(ident, d, used);
        }
        initial_res = initial_binding.res();
      }
      const res = b.res();
      const has_ambiguity_error = this_.ambiguity_errors.some((error) => error.warning === undefined);
      if (res.$ === "Err" || has_ambiguity_error) {
        this_.dcx().span_delayed_bug(import_.span, "some error happened for an import");
        return;
      }
      if (initial_res !== undefined) {
        if (!Res_eq(res, initial_res) && !this_.issue_145575_hack_applied) {
          span_bug(import_.span, "inconsistent resolution for an import");
        }
      } else if (this_.privacy_errors.length === 0) {
        this_.dcx().emit_err(diagnostics.CannotDetermineImportResolution_diagnostic({ span: import_.span }));
      }
    } else {
      // FIXME: This assert may fire if public glob is later shadowed by a private
      // single import (see test `issue-55884-2.rs`). In theory single imports should
      // always block globs, even if they are not yet resolved, so that this kind of
      // self-inconsistent resolution never happens.
      // Re-enable the assert when the issue is fixed.
      // assert!(result[ns].get().is_err());
    }
  });

  if (all_ns_err) {
    let all_ns_failed = true;
    this.per_ns_mut((this_, ns) => {
      const binding = this_.cm_mut().resolve_ident_in_module(module, ident, ns, import_.parent_scope, finalize, undefined, undefined);
      if (binding.$ === "Ok") {
        all_ns_failed = false;
      }
    });

    if (all_ns_failed) {
      let names: Symbol[];
      if (module.$ === "Module") {
        names = [];
        for (const [{ ident: i }, resolution_] of this.resolutions(module._0)) {
          const name = ((): Symbol | undefined => {
            if (i.name === ident.name) {
              return undefined;
            } // Never suggest the same name
            if (i.name === kw.Underscore) {
              return undefined;
            } // `use _` is never valid

            const resolution = resolution_.borrow(this);
            const name_binding = resolution.best_decl();
            if (name_binding !== undefined) {
              switch (name_binding.kind.$) {
                case "Import": {
                  const source_decl = name_binding.kind.source_decl;
                  // Never suggest names that previously could not
                  // be resolved.
                  if (source_decl.kind.$ === "Def" && source_decl.kind._0.$ === "Err") return undefined;
                  return i.name;
                }
                default:
                  return i.name;
              }
            } else if (resolution.single_imports.size === 0) {
              return undefined;
            } else {
              return i.name;
            }
          })();
          if (name !== undefined) names.push(name);
        }
      } else {
        names = [];
      }

      const best = find_best_match_for_name(names, ident.name, undefined);
      const lev_suggestion: Suggestion | undefined =
        best === undefined ? undefined : [[[ident.span, Symbol.as_str(best)]], "a similar name exists in the module", "MaybeIncorrect"];

      let suggestion: Suggestion | undefined;
      let note: string | undefined;
      const c = this.check_for_module_export_macro(import_, module, ident);
      if (c !== undefined) {
        const [s, n] = c;
        [suggestion, note] = [s ?? lev_suggestion, n];
      } else {
        [suggestion, note] = [lev_suggestion, undefined];
      }

      // If importing of trait asscoiated items is enabled, an also find an
      // `Enum`, then note that inherent associated items cannot be imported.
      if (this.features.import_trait_associated_functions() && path_res.$ === "Module" && path_res._0.$ === "Module") {
        const mres = path_res._0._0.res();
        if (mres !== undefined && mres.$ === "Def" && mres._0.$ === "Enum") {
          note = note ?? "cannot import inherent associated items, only trait associated items";
        }
      }

      let label: string;
      if (module.$ === "Module") {
        const module_str = module_to_string(module._0);
        if (module_str !== undefined) {
          label = `no \`${display_Ident(ident)}\` in \`${module_str}\``;
        } else {
          label = `no \`${display_Ident(ident)}\` in the root`;
        }
      } else {
        if (!ident.is_path_segment_keyword()) {
          label = `no external crate \`${display_Ident(ident)}\``;
        } else {
          // HACK(eddyb) this shows up for `self` & `super`, which
          // should work instead - for now keep the same error message.
          label = `no \`${display_Ident(ident)}\` in the root`;
        }
      }

      const parent_suggestion = this.lookup_import_candidates(ident, "TypeNS", import_.parent_scope, (_) => true);

      const im = import_.imported_module.get();
      return {
        span: import_.span,
        label,
        note,
        suggestion,
        help: undefined,
        candidates: parent_suggestion.length !== 0 ? parent_suggestion : undefined,
        module: im !== undefined && im.$ === "Module" ? im._0.opt_def_id() : undefined,
        segment: ident,
        on_unknown_attr: import_.on_unknown_attr === undefined ? undefined : clone_OnUnknownData(import_.on_unknown_attr),
      };
    } else {
      // `resolve_ident_in_module` reported a privacy error.
      return undefined;
    }
  }

  let reexport_error: [Namespace, Decl] | undefined;
  let any_successful_reexport = false;
  this.per_ns((this_, ns) => {
    const binding = PendingDecl.decl(bindings.index(ns).get());
    if (binding === undefined) {
      return;
    }

    if (Visibility.greater_than(import_.vis, binding.vis(), this_.tcx_)) {
      // In isolation, a declaration like this is not an error, but if *all* 1-3
      // declarations introduced by the import are more private than the import item's
      // nominal visibility, then it's an error.
      reexport_error = [ns, binding.import_source()];
    } else {
      any_successful_reexport = true;
    }
  });

  if (!any_successful_reexport) {
    const [ns, binding] = unwrap(reexport_error as [Namespace, Decl] | undefined);
    const lint = this.report_cannot_reexport(import_, binding, ident, ns);
    if (lint !== undefined) {
      this.lint_buffer_.add_early_lint(lint);
    }
  }

  if (import_.module_path.length <= 1) {
    // HACK(eddyb) `lint_if_path_starts_with_module` needs at least
    // 2 segments, so the `resolve_path` above won't trigger it.
    const full_path = import_.module_path.map(clone_Segment);
    full_path.push(Segment.from_ident(ident));
    this.per_ns_mut((this_, ns) => {
      const binding = PendingDecl.decl(bindings.index(ns).get())?.import_source();
      if (binding !== undefined) {
        this_.lint_if_path_starts_with_module(finalize, full_path, binding);
      }
    });
  }

  // Record what this import resolves to for later uses in documentation,
  // this may resolve to either a value or a type, but for documentation
  // purposes it's good enough to just favor one over the other.
  this.per_ns_mut((this_, ns) => {
    const binding = PendingDecl.decl(bindings.index(ns).get())?.import_source();
    if (binding !== undefined) {
      const owner = unwrap(this_.owners.get(import_.root_id));
      let per_ns = owner.import_res.get(import_id);
      if (per_ns === undefined) {
        per_ns = PerNS_default((): Res | undefined => undefined);
        owner.import_res.set(import_id, per_ns);
      }
      per_ns.index_mut(ns).value = binding.res();
    }
  });

  // debug!("(resolving single import) successfully resolved import");
  return undefined;
};

// rustc: compiler/rustc_resolve/src/imports.rs:1661 report_cannot_reexport
Resolver.prototype.report_cannot_reexport = function (
  this: Resolver,
  import_: Import,
  decl: Decl,
  ident: Ident,
  ns: Namespace,
): BufferedEarlyLint | undefined {
  const v = decl.vis();
  const crate_private_reexport = v.$ === "Restricted" && v._0.is_top_level_module();

  const extern_crate_id = pub_use_of_private_extern_crate_hack(import_.summary(), decl);
  if (extern_crate_id !== undefined) {
    if (import_.kind.$ !== "Single") return unreachable();
    const id = import_.kind.id;
    const sugg = this.tcx_.source_span(extern_crate_id);
    const diagnostic = diagnostics.PrivateExternCrateReexport_diagnostic({
      ident,
      sugg: Span.can_be_used_for_suggestions(sugg) ? Span.shrink_to_lo(sugg) : undefined,
    });
    return {
      lint_id: LintId.of(PUB_USE_OF_PRIVATE_EXTERN_CRATE),
      node_id: id,
      span: into_MultiSpan(import_.span),
      diagnostic: DecorateDiagCompat.from(diagnostic),
    };
  } else if (ns === "TypeNS") {
    if (crate_private_reexport) {
      this.dcx().emit_err(diagnostics.CannotBeReexportedCratePublicNS_diagnostic({ span: import_.span, ident }));
    } else {
      this.dcx().emit_err(diagnostics.CannotBeReexportedPrivateNS_diagnostic({ span: import_.span, ident }));
    }
  } else {
    const err = crate_private_reexport
      ? this.dcx().create_err(diagnostics.CannotBeReexportedCratePublic_diagnostic({ span: import_.span, ident }))
      : this.dcx().create_err(diagnostics.CannotBeReexportedPrivate_diagnostic({ span: import_.span, ident }));

    let excluded = false;
    // exclude decl_macro
    if (decl.kind.$ === "Def" && decl.kind._0.$ === "Def" && decl.kind._0._0.$ === "Macro") {
      const def_id = decl.kind._0._1;
      const kind = this.get_macro_by_def_id(def_id).kind;
      if (kind.$ === "MacroRules" && kind._0.is_macro_rules()) {
        excluded = true;
        err.subdiagnostic(diagnostics.ConsiderAddingMacroExport_subdiagnostic({ span: decl.span }));
        err.subdiagnostic(diagnostics.ConsiderMarkingAsPubCrate_subdiagnostic({ vis_span: import_.vis_span }));
      }
    }
    if (!excluded) {
      err.subdiagnostic(diagnostics.ConsiderMarkingAsPub_subdiagnostic({ span: import_.span, ident }));
    }
    err.emit();
  }

  return undefined;
};

// rustc: compiler/rustc_resolve/src/imports.rs:1720 check_for_redundant_imports
Resolver.prototype.check_for_redundant_imports = function (this: Resolver, import_: Import): boolean {
  // This function is only called for single imports.
  if (import_.kind.$ !== "Single") {
    return unreachable();
  }
  const { source, target, decls, id, def_id } = import_.kind;

  // Skip if the import is of the form `use source as target` and source != target.
  if (!source.eq(target)) {
    return false;
  }

  // Skip if the import was produced by a macro.
  if (import_.parent_scope.expansion !== LocalExpnId.ROOT) {
    return false;
  }

  // Skip if we are inside a named module (in contrast to an anonymous
  // module defined by a block).
  // Skip if the import is public or was used through non scope-based resolution,
  // e.g. through a module-relative path.
  if (this.import_use_map.get(import_) === "Other" || this.effective_visibilities.is_exported(def_id)) {
    return false;
  }

  let is_redundant = true;
  const redundant_span = new PerNS<[OrdSpan, boolean] | undefined>(undefined, undefined, undefined);
  this.per_ns((this_, ns) => {
    const binding = PendingDecl.decl(decls.index(ns).get())?.import_source();
    if (is_redundant && binding !== undefined) {
      if (binding.res().$ === "Err") {
        return;
      }

      const r = this_.cm().resolve_ident_in_scope_set(target, { $: "All", _0: ns }, import_.parent_scope, undefined, PendingDecl.decl(decls.index(ns).get()), undefined);
      if (r.$ === "Ok") {
        const other_binding = r._0;
        is_redundant = Res_eq(binding.res(), other_binding.res()) && !other_binding.is_ambiguity_recursive();
        if (is_redundant) {
          redundant_span.index_mut(ns).value = [new OrdSpan(other_binding.span), other_binding.is_import()];
        }
      } else {
        is_redundant = false;
      }
    }
  });

  if (is_redundant && !redundant_span.is_empty()) {
    const redundant_spans = redundant_span.present_items();
    // `redundant_spans.sort()`: `(OrdSpan, bool)` tuple order (stable sort).
    redundant_spans.sort((a, b) => a[0].cmp(b[0]) || (a[1] === b[1] ? 0 : a[1] ? 1 : -1));
    // `redundant_spans.dedup()`
    for (let i = redundant_spans.length - 1; i > 0; i--) {
      const [x, y] = [redundant_spans[i - 1]!, redundant_spans[i]!];
      if (x[0].eq(y[0]) && x[1] === y[1]) redundant_spans.splice(i, 1);
    }
    this.lint_buffer_.dyn_buffer_lint(REDUNDANT_IMPORTS, id, import_.span, (dcx, level) => {
      const ident = source;
      const subs: diagnostics.RedundantImportSub[] = redundant_spans.map(([{ _0: span }, is_imported]) => {
        const dummy = Span.is_dummy(span);
        if (!dummy && is_imported) {
          return { $: "ImportedHere", span, ident };
        } else if (!dummy && !is_imported) {
          return { $: "DefinedHere", span, ident };
        } else if (dummy && is_imported) {
          return { $: "ImportedPrelude", span, ident };
        } else {
          return { $: "DefinedPrelude", span, ident };
        }
      });
      return diagnostics.RedundantImport_into_diag({ subs, ident }, dcx, level);
    });
    return true;
  }

  return false;
};

// rustc: compiler/rustc_resolve/src/imports.rs:1812 resolve_glob_import
Resolver.prototype.resolve_glob_import = function (this: Resolver, import_: Import, imported_module: ModuleOrUniformRoot): ImportResolutionKind {
  let import_bindings: [Decl, BindingKey, Span][];
  if (imported_module.$ === "Module" && imported_module._0 !== import_.parent_scope.module) {
    const module = imported_module._0;
    import_bindings = [];
    for (const [key_, resolution] of this.resolutions(module)) {
      const res = resolution.borrow_checked(this);
      const decl = res.determined_decl();
      if (decl === undefined) continue;
      // `let mut key = *key;` (a copy)
      const key = clone_BindingKey(key_);
      const ctxt: MutRef<Macros20NormalizedSyntaxContext> = { value: key.ident.ctxt };
      const adjusted = Macros20NormalizedSyntaxContext.update_unchecked(ctxt, (ctxt) =>
        SyntaxContext.reverse_glob_adjust(ctxt, module.expansion, import_.span),
      );
      key.ident.ctxt = ctxt.value;
      let scope;
      if (adjusted !== undefined && adjusted._0 !== undefined) {
        scope = this.expn_def_scope(adjusted._0);
      } else if (adjusted !== undefined) {
        scope = import_.parent_scope.module;
      } else {
        continue;
      }
      if (this.is_accessible_from(decl.vis(), scope)) {
        import_bindings.push([decl, key, res.orig_ident_span]);
      }
    }
  } else {
    // Errors are reported in `write_imports_resolutions`
    import_bindings = [];
  }

  return { $: "Glob", _0: import_bindings };
};

// Hack for the `rust_embed` regression observed in the crater run of #145108.
// rustc: compiler/rustc_resolve/src/imports.rs:1848 rust_embed_hack
Resolver.prototype.rust_embed_hack = function (this: Resolver, module: LocalModule, decl: Decl): boolean {
  // We are looking for this pattern:
  // ```rust
  // #[macro_use]
  // extern crate rust_embed_impl;
  // pub use rust_embed_impl::*;
  //
  // pub use RustEmbed as Embed;
  // ```
  if (decl.kind.$ === "Import") {
    const { source_decl, import: import_ } = decl.kind;
    // Check that `decl` is the re-export: "pub use RustEmbed as Embed;"
    if (import_.kind.$ === "Single") {
      const source = import_.kind.source;
      if (
        source.name === sym.RustEmbed &&
        // make sure that the import points to the #[macro_use] import
        source_decl.kind.$ === "Import" &&
        source_decl.kind.import.kind.$ === "MacroUse" &&
        this.macro_use_prelude.has(source.name) // and that the name actually exists in the macro_use_prelude
      ) {
        // Then check that `RustEmbed` exists in the modules Macro namespace.
        const y_decl = this.resolution(module.to_module(), BindingKey.new(IdentKey.new(source), "MacroNS"))?.best_decl();
        // which comes from "pub use rust_embed_impl::*"
        if (y_decl !== undefined && y_decl.is_glob_import() && Visibility.is_public(y_decl.vis())) {
          return true;
        }
      }
    }
  }

  return false;
};

// Miscellaneous post-processing, including recording re-exports,
// reporting conflicts, and reporting unresolved imports.
// rustc: compiler/rustc_resolve/src/imports.rs:1881 finalize_resolutions_in
Resolver.prototype.finalize_resolutions_in = function (
  this: Resolver,
  module: LocalModule,
  module_children: Map<LocalDefId, ModChild[]>,
  ambig_module_children: Map<LocalDefId, AmbigModChild[]>,
): void {
  // Since import resolution is finished, globs will not define any more names.
  module.globs.borrow_mut_checked(this).value = [];

  const def_id = module.opt_def_id();
  if (def_id === undefined) return;

  const children: ModChild[] = [];
  const ambig_children: AmbigModChild[] = [];

  module.to_module().for_each_child(this, (this_, ident_, orig_ident_span, _, decl) => {
    const res = def_Res.expect_non_local<NodeId, never>(decl.res());
    if (res.$ !== "Err") {
      const vis = this_.rust_embed_hack(module, decl) ? Visibility.Public : decl.vis();
      const ident = ident_.orig(orig_ident_span);
      const child = (reexport_chain: Reexport[]): ModChild => ({ ident, res, vis, reexport_chain });
      const ambig = decl.descent_to_ambiguity();
      if (ambig !== undefined) {
        const [ambig_binding1, ambig_binding2] = ambig;
        const main = child(ambig_binding1.reexport_chain());
        const second: ModChild = {
          ident,
          res: def_Res.expect_non_local<NodeId, never>(ambig_binding2.res()),
          vis: ambig_binding2.vis(),
          reexport_chain: ambig_binding2.reexport_chain(),
        };
        ambig_children.push({ main, second });
      } else {
        children.push(child(decl.reexport_chain()));
      }
    }
  });

  if (children.length !== 0) {
    module_children.set(def_id.expect_local(), children);
  }
  if (ambig_children.length !== 0) {
    ambig_module_children.set(def_id.expect_local(), ambig_children);
  }
};

// rustc: compiler/rustc_resolve/src/imports.rs:1929 import_path_to_string
export function import_path_to_string(names: readonly Ident[], import_kind: ImportKind, span: Span): string {
  const pos_ = names.findIndex((p) => span === p.span && p.name !== kw.PathRoot);
  const pos = pos_ === -1 ? undefined : pos_;
  const global = names.length !== 0 && names[0]!.name === kw.PathRoot;
  if (pos !== undefined) {
    const names_ = global ? names.slice(1, pos + 1) : names.slice(0, pos + 1);
    return names_to_string(names_.map((ident) => ident.name));
  } else {
    const names_ = global ? names.slice(1) : names;
    if (names_.length === 0) {
      return import_kind_to_string(import_kind);
    } else {
      return `${names_to_string(names_.map((ident) => ident.name))}::${import_kind_to_string(import_kind)}`;
    }
  }
}

// rustc: compiler/rustc_resolve/src/imports.rs:1953 import_kind_to_string
export function import_kind_to_string(import_kind: ImportKind): string {
  switch (import_kind.$) {
    case "Single":
      return display_Ident(import_kind.source);
    case "Glob":
      return "*";
    case "ExternCrate":
      return "<extern crate>";
    case "MacroUse":
      return "#[macro_use]";
    case "MacroExport":
      return "#[macro_export]";
  }
}
