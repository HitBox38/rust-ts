// Port of compiler/rustc_resolve/src/lib.rs
//! This crate is responsible for the part of name resolution that doesn't require type checker.
//!
//! Module structure of the crate is built here.
//! Paths in macros, imports, expressions, types, patterns are resolved here.
//! Label and lifetime names are resolved here as well.
//!
//! Type-relative name resolution (methods, fields, associated items) happens in `rustc_hir_analysis`.
//
// Types and derived Debug/Clone impls of this file are generated into lib.gen.ts (tools/codegen/types.ts,
// set `rustc_resolve`); the `Resolver`, `DefCollector` and `LateResolutionVisitor` classes and every
// method declaration of the crate live in decls.ts (the contract, docs/handoff/res-lib.md).
//
// Init order: this module is the crate root. It imports decls.ts first (the classes), then the
// generated module, then every extension file for its side effects (they assign methods onto the
// prototypes), and only then runs its own top-level code. Its top-level code touches only decls.ts,
// lib.gen.ts and other crates, never an extension module's exports (TDZ in an ESM cycle).
//
// PORT (representation, recorded in the handoff):
// - Arena-interned values (`Module<'ra>`, `LocalModule`, `ExternModule` = `Interned<ModuleData>`,
//   `Decl` = `Interned<DeclData>`, `Import` = `Interned<ImportData>`, `NameResolutionRef` =
//   `Interned<CmRefCell<NameResolution>>`) are the allocated object itself; equality is identity
//   (`===`). The three module newtypes are aliases of `ModuleData`; their `Deref` is the identity.
// - `ResolverArenas` keeps no storage (D3: arenas erased); its `alloc_*` fns return their argument.
// - `CmResolver` (`RefOrMut<Resolver>`) is the `Resolver` itself; see `mod ref_mut` below.
// - `Macros20NormalizedSyntaxContext` is the branded `SyntaxContext` number.
// - Struct-keyed maps/sets are `KeyedMap`/`KeyedSet` (src/rust_ts/keyed.ts) with the key fns below.
import "./decls.ts";
import "./lib.gen.ts";
import "./build_reduced_graph.ts";
import "./check_unused.ts";
import "./def_collector.ts";
import "./diagnostics/mod.ts";
import "./diagnostics/impls.ts";
import "./effective_visibilities.ts";
import "./ident.ts";
import "./imports.ts";
import "./late.ts";
import "./late/diagnostics.ts";
import "./macros.ts";
import "./rustdoc.ts";

import { ast, attr, type Attribute, CRATE_NODE_ID, type Crate, DUMMY_NODE_ID, type Expr, type Path, type PathSegment, type Visibility as AstVisibility, clone_Path } from "../rustc_ast/lib.ts";
import { debug_NodeId, NodeId } from "../rustc_ast/node_id.ts";
import { type Attribute as HirAttribute, type AttributeKind, find_attr, StrippedCfgItem } from "../rustc_attr_ir/lib.ts";
import { ControlFlow } from "../rustc_ast_ir/visit.ts";
import { FloatTy, IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import { type LintBuffer, LintBuffer_default } from "../rustc_errors/lib.ts";
import { SyntaxExtension } from "../rustc_expand/base.ts";
import { BUILTIN_ATTRIBUTES } from "../rustc_feature/builtin_attrs.gen.ts";
import { DefKind, debug_DefKind, debug_Res, type MacroKinds, type Namespace, type PrimTy, Res as def_Res } from "../rustc_hir/def.ts";
import { debug_DefKey, type PerParentDisambiguatorState, PerParentDisambiguatorsMap } from "../rustc_hir_id/definitions.ts";
import { PRIVATE_MACRO_USE } from "../rustc_lint_defs/builtin.gen.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.ts";
import { EffectiveVisibilities } from "../rustc_middle/middle/privacy.ts";
import { DefId_hash_key } from "../rustc_middle/query/caches.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import {
  debug_PartialRes,
  type MainDefinition,
  type PartialRes,
  PerOwnerResolverData,
  type Reexport,
  type ResolverAstLowering,
  type ResolverGlobalCtxt,
} from "../rustc_middle/middle/resolve.ts";
import type { TyCtxt, TyCtxtFeed } from "../rustc_middle/ty/context.ts";
import { Visibility } from "../rustc_middle/ty/mod.ts";
import { CRATE_DEF_ID, CrateNum, type DefId, debug_LocalDefId, LOCAL_CRATE, LocalDefId, type LocalModId, ModId, ModId_eq } from "../rustc_span/def_id.ts";
import { debug_SyntaxContext, ExpnId, ExpnId_eq, LocalExpnId, type MacroKind, SyntaxContext } from "../rustc_span/hygiene.ts";
import { FatalError } from "../rustc_span/fatal_error.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { debug_Symbol, display_Ident, Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_struct, debug_tuple, type Fmt, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import { DefCollector, LateResolutionVisitor, Resolver } from "./decls.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import { OnUnknownData } from "./diagnostics/impls.ts";
import { EffectiveVisibilitiesVisitor } from "./effective_visibilities.ts";
import { creader } from "../rustc_metadata/lib.ts";
import * as gen from "./lib.gen.ts";
import {
  type AmbiguityError,
  type BindingKey as BindingKeyT,
  type Decl,
  DeclData,
  type Finalize as FinalizeT,
  type IdentKey as IdentKeyT,
  type ModuleOrUniformRoot,
  type ParentScope as ParentScopeT,
  type ResolutionTable,
  type ResolverOutputs,
  type Segment as SegmentT,
  type Stage,
  type Used,
  Used_discriminant,
  type VisResolutionError,
  debug_ParentScope,
  debug_PathResult,
  debug_VisResolutionError,
} from "./lib.gen.ts";
import type { Suggestion } from "./diagnostics/impls.ts";
import { type Import, type ImportData, NameResolution, type NameResolutionRef, PendingDecl } from "./imports.ts";
import { type MacroRulesDecl, type MacroRulesScope, type MacroRulesScopeRef, registered_attr_tools, registered_lint_tools } from "./macros.ts";

export * from "./lib.gen.ts";
export { DefCollector, LateResolutionVisitor, Resolver };
export type { MutRef };
// `pub use macros::registered_lint_tools_ast;`
export { registered_lint_tools_ast } from "./macros.ts";
// `pub mod rustdoc;`
export * as rustdoc from "./rustdoc.ts";

// ---- stand-ins for types of crates that are not ported yet ---------------------------------------

/** `rustc_metadata::creader::CStore` (src/rustc_metadata/creader.ts, lane creader). */
export type CStore = creader.CStore;
export const CStore = creader.CStore;

/** `rustc_index::bit_set::DenseBitSet<T>` (src/rustc_index/bit_set.ts, ported by lane res-macros). */
export { DenseBitSet } from "../rustc_index/bit_set.ts";

/**
 * PORT: stand-in for `rustc_hir::TraitCandidate<'tcx>` (hir.rs, M3). `import_ids` is the arena slice
 * (`&'tcx [LocalDefId]`).
 */
export interface TraitCandidate {
  def_id: DefId;
  import_ids: readonly LocalDefId[];
  lint_ambiguous: boolean;
}

/** PORT: stand-in for `rustc_middle::middle::resolve_bound_vars::Set1<T>` (not ported). */
export type Set1<T> = { readonly $: "Empty" } | { readonly $: "One"; readonly _0: T } | { readonly $: "Many" };

/** `std::ops::Range<T>`. */
export interface Range<T> {
  start: T;
  end: T;
}

/** `R: AsRef<Resolver>` (the resolver, `LateResolutionVisitor`, `DefCollector`, ...). */
export interface AsRefResolver {
  as_ref(): Resolver;
}
/** `R: AsMut<Resolver>`. */
export interface AsMutResolver {
  as_mut(): Resolver;
}

/**
 * PORT: `hir::PrimTy::ALL` and `PrimTy::name` (rustc_hir/src/hir.rs:3331/3368; hir.rs is M3). Faithful
 * copies, without markers (they belong to hir.rs); replace with rustc_hir's when it is ported.
 */
export const PrimTy_ALL: readonly PrimTy[] = [
  { $: "Int", _0: "I8" },
  { $: "Int", _0: "I16" },
  { $: "Int", _0: "I32" },
  { $: "Int", _0: "I64" },
  { $: "Int", _0: "I128" },
  { $: "Int", _0: "Isize" },
  { $: "Uint", _0: "U8" },
  { $: "Uint", _0: "U16" },
  { $: "Uint", _0: "U32" },
  { $: "Uint", _0: "U64" },
  { $: "Uint", _0: "U128" },
  { $: "Uint", _0: "Usize" },
  { $: "Float", _0: "F16" },
  { $: "Float", _0: "F32" },
  { $: "Float", _0: "F64" },
  { $: "Float", _0: "F128" },
  { $: "Bool" },
  { $: "Char" },
  { $: "Str" },
];
export function PrimTy_name(self: PrimTy): Symbol {
  switch (self.$) {
    case "Int":
      return IntTy.name(self._0);
    case "Uint":
      return UintTy.name(self._0);
    case "Float":
      return FloatTy.name(self._0);
    case "Str":
      return sym.str;
    case "Bool":
      return sym.bool;
    case "Char":
      return sym.char;
  }
}

/**
 * PORT: `impl HasAttrs for DefId` (rustc_middle/src/ty/mod.rs:2349, not ported): the attribute list
 * `find_attr!(tcx, def_id, ..)` searches.
 */
export function DefId_get_attrs(self: DefId, tcx: TyCtxt): readonly HirAttribute[] {
  if (self.as_local() !== undefined) return unported("tcx.hir_attrs(tcx.local_def_id_to_hir_id(did)) (HIR, M3)");
  return tcx.attrs_for_def(self) as readonly HirAttribute[];
}

/**
 * Debug of `rustc_data_structures::sync::RwLock<T>` (`#[derive(Debug)] struct RwLock<T>(parking_lot::RwLock<T>)`,
 * sync.rs:172; lock_api's Debug prints `RwLock { data: .. }`). PORT: the lock is the `MutRef` box it is
 * written through (macros.rs `MacroRulesScopeRef`).
 */
export function debug_RwLock<T>(v: MutRef<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_tuple(f, "RwLock", [debug_struct(f, "RwLock", [["data", debug_T(v.value, f)]])]);
}

// ---- key fns of the struct-keyed maps (`KeyedMap` / `KeyedSet`) ------------------------------------

/** `DefId`'s `Eq`: (krate, index). */
export const DefId_key = DefId_hash_key;
/** `Ident`'s `Eq`/`Hash`: the name and the span's `SyntaxContext` (`Span::eq_ctxt`). */
export function Ident_key(ident: Ident): string {
  return `${ident.name}:${Span.ctxt(ident.span)}`;
}
/** `IdentKey`'s derived `Eq`. */
export function IdentKey_key(k: IdentKeyT): string {
  return `${k.name}:${k.ctxt}`;
}
/** `BindingKey`'s derived `Eq`. */
export function BindingKey_key(k: BindingKeyT): string {
  return `${k.ident.name}:${k.ident.ctxt}:${k.ns}:${k.disambiguator}`;
}
/** `(OrdSpan, OrdSpan)`'s `Eq`. */
export function OrdSpan_pair_key(k: [Span, Span]): string {
  return `${k[0]}:${k[1]}`;
}
/** `IdentKey == IdentKey` (derived `PartialEq`). */
export function IdentKey_eq(a: IdentKeyT, b: IdentKeyT): boolean {
  return a.name === b.name && a.ctxt === b.ctxt;
}
/** `BindingKey == BindingKey` (derived `PartialEq`). */
export function BindingKey_eq(a: BindingKeyT, b: BindingKeyT): boolean {
  return IdentKey_eq(a.ident, b.ident) && a.ns === b.ns && a.disambiguator === b.disambiguator;
}

/** `map[&key]` (`impl Index for HashMap`): panics when the key is absent. */
function index_map<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) return panic("key not found");
  return v as V;
}

// ---- lib.rs ---------------------------------------------------------------------------------------

export type Res = def_Res<NodeId>;

// Determinacy (lib.gen.ts)
export type Determinacy = gen.Determinacy;
export const Determinacy = {
  ...gen.Determinacy,

  // rustc: compiler/rustc_resolve/src/lib.rs:103 determined
  determined(determined: boolean): Determinacy {
    return determined ? "Determined" : "Undetermined";
  },
};

/// Everything you need to know about a name's location to resolve it.
/// Serves as a starting point for the scope visitor.
/// This struct is currently used only for early resolution (imports and macros),
/// but not for late resolution yet.
export type ParentScope = ParentScopeT;
export const ParentScope = gen.ParentScope as typeof gen.ParentScope & {
  module: (module: LocalModule, arenas: ResolverArenas) => ParentScope;
};

/// Creates a parent scope with the passed argument used as the module scope component,
/// and other scope components set to default empty values.
// rustc: compiler/rustc_resolve/src/lib.rs:174 module
ParentScope.module = function (module: LocalModule, arenas: ResolverArenas): ParentScope {
  return new gen.ParentScope(module.to_module(), LocalExpnId.ROOT, arenas.alloc_macro_rules_scope({ $: "Empty" }), []);
};

export type InvocationParent = gen.InvocationParent;
export const InvocationParent = {
  ROOT: Object.freeze<InvocationParent>({
    parent_def: CRATE_DEF_ID,
    impl_trait_context: "Existential",
    in_attr: false,
    owner: CRATE_NODE_ID,
  }),
};

/// A minimal representation of a path segment. We use this in resolve because we synthesize 'path
/// segments' which don't have the rest of an AST or HIR `PathSegment`.
export type Segment = SegmentT;
export const Segment = gen.Segment as typeof gen.Segment & {
  from_path: (path: Path) => Segment[];
  from_ident: (ident: Ident) => Segment;
  names_to_string: (segments: readonly Segment[]) => string;
  from: (seg: PathSegment) => Segment;
};

// rustc: compiler/rustc_resolve/src/lib.rs:375 from_path
Segment.from_path = function (path: Path): Segment[] {
  return path.segments.map((s) => Segment.from(s));
};

// rustc: compiler/rustc_resolve/src/lib.rs:379 from_ident
Segment.from_ident = function (ident: Ident): Segment {
  return new gen.Segment(ident, undefined, false, false, DUMMY_SP);
};

// rustc: compiler/rustc_resolve/src/lib.rs:389 names_to_string
Segment.names_to_string = function (segments: readonly Segment[]): string {
  return names_to_string(segments.map((seg) => seg.ident.name));
};

// impl<'a> From<&'a ast::PathSegment> for Segment
// rustc: compiler/rustc_resolve/src/lib.rs:395 from
Segment.from = function (seg: PathSegment): Segment {
  const has_generic_args = seg.args !== undefined;
  let args_span: Span;
  let has_lifetime_args: boolean;
  if (seg.args !== undefined) {
    const args = seg.args;
    switch (args.$) {
      case "AngleBracketed": {
        const found_lifetimes = args._0.args.some((arg) => arg.$ === "Arg" && arg._0.$ === "Lifetime");
        [args_span, has_lifetime_args] = [args._0.span, found_lifetimes];
        break;
      }
      case "Parenthesized":
        [args_span, has_lifetime_args] = [args._0.span, true];
        break;
      case "ParenthesizedElided":
        [args_span, has_lifetime_args] = [args._0, true];
        break;
    }
  } else {
    [args_span, has_lifetime_args] = [DUMMY_SP, false];
  }
  return new gen.Segment(seg.ident, seg.id, has_generic_args, has_lifetime_args, args_span);
};

/// Name declaration used during late resolution.
export type LateDecl = gen.LateDecl;
export const LateDecl = {
  // rustc: compiler/rustc_resolve/src/lib.rs:433 res
  res(self: LateDecl): Res {
    switch (self.$) {
      case "Decl":
        return self._0.res();
      case "RibDef":
        return self._0;
    }
  },
};

export type PathResult = gen.PathResult;
export const PathResult = {
  ...gen.PathResult,

  // rustc: compiler/rustc_resolve/src/lib.rs:500 failed
  failed(
    ident: Ident,
    is_error_from_last_segment: boolean,
    finalize: boolean,
    error_implied_by_parse_error: boolean,
    module: ModuleOrUniformRoot | undefined,
    label_and_suggestion_and_note: () => [string, string, Suggestion | undefined, string | undefined, string | undefined],
  ): PathResult {
    const [message, label, suggestion, note, help] = finalize
      ? label_and_suggestion_and_note()
      : // FIXME: this output isn't actually present in the test suite.
        [`cannot find \`${display_Ident(ident)}\` in this scope`, "", undefined, undefined, undefined];
    return {
      $: "Failed",
      span: ident.span,
      segment: ident,
      label,
      suggestion,
      help,
      is_error_from_last_segment,
      module,
      error_implied_by_parse_error,
      message,
      note,
    };
  },
};

export type ModuleKind = gen.ModuleKind;
export const ModuleKind = {
  ...gen.ModuleKind,

  // rustc: compiler/rustc_resolve/src/lib.rs:563 opt_def_id
  opt_def_id(self: ModuleKind): DefId | undefined {
    switch (self.$) {
      case "Def":
        return self._1;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_resolve/src/lib.rs:570 def_id
  def_id(self: ModuleKind): DefId {
    const d = ModuleKind.opt_def_id(self);
    if (d === undefined) panic("`Module::def_id` is called on a block module");
    return d;
  },

  // rustc: compiler/rustc_resolve/src/lib.rs:574 is_local
  is_local(self: ModuleKind): boolean {
    switch (self.$) {
      case "Def":
        return self._1.is_local();
      case "Block":
        return true;
    }
  },
};

/// Combination of a symbol and its macros 2.0 normalized hygiene context.
/// Used as a key in various kinds of name containers, including modules (as a part of slightly
/// larger `BindingKey`) and preludes.
export type IdentKey = IdentKeyT;
export const IdentKey = gen.IdentKey as typeof gen.IdentKey & {
  new: (ident: Ident) => IdentKey;
  new_adjusted: (ident: Ident, expn_id: ExpnId) => [IdentKey, ExpnId | undefined];
  with_root_ctxt: (name: Symbol) => IdentKey;
};

// #[inline]
// rustc: compiler/rustc_resolve/src/lib.rs:600 new
IdentKey.new = function (ident: Ident): IdentKey {
  return new gen.IdentKey(ident.name, Macros20NormalizedSyntaxContext.new(Span.ctxt(ident.span)));
};

// rustc: compiler/rustc_resolve/src/lib.rs:605 new_adjusted
IdentKey.new_adjusted = function (ident: Ident, expn_id: ExpnId): [IdentKey, ExpnId | undefined] {
  const [ctxt, def] = Macros20NormalizedSyntaxContext.new_adjusted(Span.ctxt(ident.span), expn_id);
  return [new gen.IdentKey(ident.name, ctxt), def];
};

// rustc: compiler/rustc_resolve/src/lib.rs:611 with_root_ctxt
IdentKey.with_root_ctxt = function (name: Symbol): IdentKey {
  const ctxt = Macros20NormalizedSyntaxContext.new_unchecked(SyntaxContext.root());
  return new gen.IdentKey(name, ctxt);
};

// rustc: compiler/rustc_resolve/src/lib.rs:617 orig
gen.IdentKey.prototype.orig = function (this: IdentKey, orig_ident_span: Span): Ident {
  return Ident.new(this.name, orig_ident_span);
};

/// A key that identifies a binding in a given `Module`.
///
/// Multiple bindings in the same module can have the same key (in a valid
/// program) if all but one of them come from glob imports.
export type BindingKey = BindingKeyT;
export const BindingKey = gen.BindingKey as typeof gen.BindingKey & {
  new: (ident: IdentKey, ns: Namespace) => BindingKey;
  new_disambiguated: (ident: IdentKey, ns: Namespace, disambiguator: () => number) => BindingKey;
};

// rustc: compiler/rustc_resolve/src/lib.rs:641 new
BindingKey.new = function (ident: IdentKey, ns: Namespace): BindingKey {
  return new gen.BindingKey(ident, ns, 0);
};

// rustc: compiler/rustc_resolve/src/lib.rs:645 new_disambiguated
BindingKey.new_disambiguated = function (ident: IdentKey, ns: Namespace, disambiguator: () => number): BindingKey {
  const d = ident.name === kw.Underscore ? disambiguator() : 0;
  return new gen.BindingKey(ident, ns, d);
};

/** A new, empty `ResolutionTable` (`FxIndexMap<BindingKey, ..>`). */
export function new_ResolutionTable(): ResolutionTable {
  return new KeyedMap<BindingKey, NameResolutionRef>(BindingKey_key);
}

export type Resolutions = gen.Resolutions;
export const Resolutions = {
  // rustc: compiler/rustc_resolve/src/lib.rs:663 new
  new(local: boolean): Resolutions {
    if (local) {
      return { $: "Local", _0: CmRefCell.new(new_ResolutionTable()) };
    } else {
      // `OnceLock::default()`: not initialized yet.
      return { $: "Extern", _0: undefined };
    }
  },
};

/// One node in the tree of modules.
///
/// Note that a "module" in resolve is broader than a `mod` that you declare in Rust code. It may be one of these:
///
/// * `mod`
/// * crate root (aka, top-level anonymous module)
/// * `enum`
/// * `trait`
/// * curly-braced block with statements
///
/// You can use [`ModuleData::kind`] to determine the kind of module this is.
export type ModuleData = gen.ModuleData;
export const ModuleData = gen.ModuleData as typeof gen.ModuleData & {
  new: (
    parent: Module | undefined,
    kind: ModuleKind,
    expansion: ExpnId,
    span: Span,
    no_implicit_prelude: boolean,
    vis: Visibility<ModId>,
    arenas: ResolverArenas,
  ) => ModuleData;
};

/// `Interned` is used because values of this type have "identity" and compare as unequal even if
/// they have the same contents.
// PORT: `struct Module<'ra>(Interned<'ra, ModuleData<'ra>>)` is the `ModuleData` object itself.
export type Module = gen.ModuleData;
/// Same as `Module`, but is guaranteed to be from the current crate.
export type LocalModule = gen.ModuleData;
/// Same as `Module`, but is guaranteed to be from an external crate.
export type ExternModule = gen.ModuleData;

// rustc: compiler/rustc_resolve/src/lib.rs:736 new
ModuleData.new = function (
  parent: Module | undefined,
  kind: ModuleKind,
  expansion: ExpnId,
  span: Span,
  no_implicit_prelude: boolean,
  vis: Visibility<ModId>,
  arenas: ResolverArenas,
): ModuleData {
  const lazy_resolutions = Resolutions.new(ModuleKind.is_local(kind));
  let self_decl: Decl | undefined;
  switch (kind.$) {
    case "Def": {
      const [def_kind, def_id] = [kind._0, kind._1];
      const expn_id = expansion.as_local() ?? LocalExpnId.ROOT;
      self_decl = arenas.new_def_decl({ $: "Def", _0: def_kind, _1: def_id }, vis, span, expn_id, parent);
      break;
    }
    case "Block":
      self_decl = undefined;
      break;
  }
  return new gen.ModuleData(
    parent,
    kind,
    lazy_resolutions,
    CmCell.new(0),
    CmRefCell.new(new Set()),
    no_implicit_prelude,
    CmRefCell.new([]),
    CmRefCell.new([]),
    CmRefCell.new(undefined),
    span,
    expansion,
    self_decl,
  );
};

/// Get name of the module.
// rustc: compiler/rustc_resolve/src/lib.rs:770 name
gen.ModuleData.prototype.name = function (this: ModuleData): Symbol | undefined {
  switch (this.kind.$) {
    case "Block":
      return undefined;
    case "Def":
      return this.kind._3;
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:777 opt_def_id
gen.ModuleData.prototype.opt_def_id = function (this: ModuleData): DefId | undefined {
  return ModuleKind.opt_def_id(this.kind);
};

// rustc: compiler/rustc_resolve/src/lib.rs:781 def_id
gen.ModuleData.prototype.def_id = function (this: ModuleData): DefId {
  return ModuleKind.def_id(this.kind);
};

// rustc: compiler/rustc_resolve/src/lib.rs:785 is_local
gen.ModuleData.prototype.is_local = function (this: ModuleData): boolean {
  return ModuleKind.is_local(this.kind);
};

// rustc: compiler/rustc_resolve/src/lib.rs:789 has_unexpanded_invocations
gen.ModuleData.prototype.has_unexpanded_invocations = function (this: ModuleData, r: Resolver): boolean {
  return this.unexpanded_invocations.borrow_checked(r).size !== 0;
};

// rustc: compiler/rustc_resolve/src/lib.rs:793 res
gen.ModuleData.prototype.res = function (this: ModuleData): Res | undefined {
  switch (this.kind.$) {
    case "Def":
      return { $: "Def", _0: this.kind._0, _1: this.kind._1 };
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:800 def_kind
gen.ModuleData.prototype.def_kind = function (this: ModuleData): DefKind | undefined {
  switch (this.kind.$) {
    case "Def":
      return this.kind._0;
    case "Block":
      return undefined;
  }
};

// impl<'ra> Module<'ra>

// rustc: compiler/rustc_resolve/src/lib.rs:809 for_each_child
gen.ModuleData.prototype.for_each_child = function <R extends AsRefResolver>(
  this: Module,
  resolver: R,
  f: (_0: R, _1: IdentKey, _2: Span, _3: Namespace, _4: Decl) => void,
): void {
  for (const [key, name_resolution_ref] of resolver.as_ref().resolutions(this)) {
    const name_resolution = name_resolution_ref.borrow_checked(resolver.as_ref());
    const decl = name_resolution.best_decl();
    if (decl !== undefined) {
      f(resolver, key.ident, name_resolution.orig_ident_span, key.ns, decl);
    }
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:822 for_each_child_mut
gen.ModuleData.prototype.for_each_child_mut = function <R extends AsMutResolver>(
  this: Module,
  resolver: R,
  f: (_0: R, _1: IdentKey, _2: Span, _3: Namespace, _4: Decl) => void,
): void {
  for (const [key, name_resolution_ref] of resolver.as_mut().resolutions(this)) {
    const name_resolution = name_resolution_ref.borrow(resolver.as_mut());
    const decl = name_resolution.best_decl();
    if (decl !== undefined) {
      f(resolver, key.ident, name_resolution.orig_ident_span, key.ns, decl);
    }
  }
};

/// This modifies `self` in place. The traits will be stored in `self.traits`.
// rustc: compiler/rustc_resolve/src/lib.rs:836 ensure_traits
gen.ModuleData.prototype.ensure_traits = function (this: Module, resolver: Resolver): void {
  const traits = this.traits.borrow_mut_checked(resolver);
  if (traits.value === undefined) {
    const collected_traits: [Symbol, Decl, Module | undefined, boolean][] = [];
    this.for_each_child(resolver, (r, ident, _, ns, decl) => {
      if (ns !== "TypeNS") {
        return;
      }

      const ambiguous = decl.is_ambiguity_recursive();
      const try_record_trait = (decl: Decl): boolean => {
        const res = decl.res();
        if (res.$ === "Def" && (res._0.$ === "Trait" || res._0.$ === "TraitAlias")) {
          const def_id = res._1;
          collected_traits.push([ident.name, decl, r.as_ref().get_module(def_id), ambiguous]);
          return true;
        } else {
          return false;
        }
      };
      // Try to record at least one trait if the decl is ambiguous, such that we can
      // report the `ambiguous_glob_imported_traits` lint. Otherwise we would report an
      // error that the trait is not found.
      while (!try_record_trait(decl)) {
        const ambig = decl.descent_to_ambiguity();
        if (ambig === undefined) break;
        decl = ambig[1];
      }
    });
    traits.value = collected_traits;
  }
};

// `self` resolves to the first module ancestor that `is_normal`.
// rustc: compiler/rustc_resolve/src/lib.rs:873 is_normal
gen.ModuleData.prototype.is_normal = function (this: Module): boolean {
  return this.def_kind()?.$ === "Mod";
};

// rustc: compiler/rustc_resolve/src/lib.rs:877 is_trait
gen.ModuleData.prototype.is_trait = function (this: Module): boolean {
  return this.def_kind()?.$ === "Trait";
};

// rustc: compiler/rustc_resolve/src/lib.rs:881 nearest_item_scope
gen.ModuleData.prototype.nearest_item_scope = function (this: Module): Module {
  const k = this.def_kind();
  if (k !== undefined && (k.$ === "Enum" || k.$ === "Trait")) {
    if (this.parent === undefined) panic("enum or trait module without a parent");
    return this.parent;
  }
  return this;
};

/// The [`ModId`] of the nearest `mod` item ancestor (which may be this module).
/// This may be the crate root.
// rustc: compiler/rustc_resolve/src/lib.rs:892 nearest_parent_mod
gen.ModuleData.prototype.nearest_parent_mod = function (this: Module): ModId {
  if (this.kind.$ === "Def" && this.kind._0.$ === "Mod") {
    return ModId.new_unchecked(this.kind._1);
  }
  if (this.parent === undefined) panic("non-root module without parent");
  return this.parent.nearest_parent_mod();
};

/// The [`NodeId`] of the nearest `mod` item ancestor (which may be this module).
/// This may be the crate root.
// rustc: compiler/rustc_resolve/src/lib.rs:901 nearest_parent_mod_node_id
gen.ModuleData.prototype.nearest_parent_mod_node_id = function (this: Module): NodeId {
  if (this.kind.$ === "Def" && this.kind._0.$ === "Mod") {
    return this.kind._2;
  }
  if (this.parent === undefined) panic("non-root module without parent");
  return this.parent.nearest_parent_mod_node_id();
};

// rustc: compiler/rustc_resolve/src/lib.rs:908 is_ancestor_of
gen.ModuleData.prototype.is_ancestor_of = function (this: Module, other: Module): boolean {
  while (this !== other) {
    if (other.parent !== undefined) {
      other = other.parent;
    } else {
      return false;
    }
  }
  return true;
};

// #[track_caller]
// rustc: compiler/rustc_resolve/src/lib.rs:920 expect_local
gen.ModuleData.prototype.expect_local = function (this: Module): LocalModule {
  if (this.kind.$ === "Def" && !this.kind._1.is_local()) {
    span_bug(this.span, `unexpected extern module: ${debug_Module(this, PLAIN)}`);
  }
  return this;
};

// #[track_caller]
// rustc: compiler/rustc_resolve/src/lib.rs:930 expect_extern
gen.ModuleData.prototype.expect_extern = function (this: Module): ExternModule {
  if (this.kind.$ === "Def" && !this.kind._1.is_local()) {
    return this;
  }
  return span_bug(this.span, `unexpected local module: ${debug_Module(this, PLAIN)}`);
};

export const LocalModule = {
  // rustc: compiler/rustc_resolve/src/lib.rs:941 new
  new(
    parent: LocalModule | undefined,
    kind: ModuleKind,
    vis: Visibility<ModId>,
    expn_id: ExpnId,
    span: Span,
    no_implicit_prelude: boolean,
    arenas: ResolverArenas,
  ): LocalModule {
    assert(ModuleKind.is_local(kind), "assertion failed: kind.is_local()");
    const parent_ = parent?.to_module();
    const data = ModuleData.new(parent_, kind, expn_id, span, no_implicit_prelude, vis, arenas);
    // SAFETY: `Interned` is valid because values of this type have "identity".
    return arenas.modules_alloc(data);
  },

  // impl<'ra> std::ops::Deref for LocalModule<'ra>
  // rustc: compiler/rustc_resolve/src/lib.rs:995 deref
  deref(self: LocalModule): ModuleData {
    return self;
  },
};

// PORT: `LocalModule::to_module` and `ExternModule::to_module` are one method of the shared object
// (`Module(self.0)` is the same pointer).
// rustc: compiler/rustc_resolve/src/lib.rs:957 to_module
// rustc: compiler/rustc_resolve/src/lib.rs:979 to_module
gen.ModuleData.prototype.to_module = function (this: ModuleData): Module {
  return this;
};

export const ExternModule = {
  // rustc: compiler/rustc_resolve/src/lib.rs:963 new
  new(
    parent: ExternModule | undefined,
    kind: ModuleKind,
    vis: Visibility<ModId>,
    expn_id: ExpnId,
    span: Span,
    no_implicit_prelude: boolean,
    arenas: ResolverArenas,
  ): ExternModule {
    assert(!ModuleKind.is_local(kind), "assertion failed: !kind.is_local()");
    const parent_ = parent?.to_module();
    const data = ModuleData.new(parent_, kind, expn_id, span, no_implicit_prelude, vis, arenas);
    // SAFETY: `Interned` is valid because values of this type have "identity".
    return arenas.modules_alloc(data);
  },

  // impl<'ra> std::ops::Deref for ExternModule<'ra>
  // rustc: compiler/rustc_resolve/src/lib.rs:1003 deref
  deref(self: ExternModule): ModuleData {
    return self;
  },
};

export const Module = {
  // impl<'ra> std::ops::Deref for Module<'ra>
  // rustc: compiler/rustc_resolve/src/lib.rs:987 deref
  deref(self: Module): ModuleData {
    return self;
  },
};

// impl<'ra> fmt::Debug for Module<'ra>
// rustc: compiler/rustc_resolve/src/lib.rs:1009 fmt
export const debug_Module: Debug<Module> = (v, f) => {
  const res = v.res();
  if (res === undefined) return "block";
  return debug_Res(res, f, debug_NodeId);
};

// impl<'ra> fmt::Debug for LocalModule<'ra>
// rustc: compiler/rustc_resolve/src/lib.rs:1018 fmt
export const debug_LocalModule: Debug<LocalModule> = (v, f) => debug_Module(v.to_module(), f);
export const debug_ExternModule: Debug<ExternModule> = debug_Module;
/** `#[derive(Clone, Copy)]`: the pointer. */
export function clone_Module(v: Module): Module {
  return v;
}
export const clone_LocalModule = clone_Module;
export const clone_ExternModule = clone_Module;

/// Data associated with any name declaration.
export type { Decl };
export { DeclData };

/// Name declaration kind.
export type DeclKind = gen.DeclKind;
export const DeclKind = {
  /// Is this an import declaration?
  // rustc: compiler/rustc_resolve/src/lib.rs:1058 is_import
  is_import(self: DeclKind): boolean {
    return self.$ === "Import";
  },
};

// skipped by codegen (types.sets.json): its `vis: ast::Visibility` clashes with `ty::Visibility`
// rustc-type: compiler/rustc_resolve/src/lib.rs:1094 DelayedVisResolutionError
export interface DelayedVisResolutionError {
  vis: AstVisibility;
  parent_scope: ParentScope;
  error: VisResolutionError;
}
/** `#[derive(Debug)]` */
export const debug_DelayedVisResolutionError: Debug<DelayedVisResolutionError> = (v, f) =>
  debug_struct(f, "DelayedVisResolutionError", [
    // the ast `Visibility` Debug, through the rustc_ast namespace (the name clashes with `ty::Visibility`)
    ["vis", ast.debug_Visibility(v.vis, f)],
    ["parent_scope", debug_ParentScope(v.parent_scope, f)],
    ["error", debug_VisResolutionError(v.error, f)],
  ]);

export type AmbiguityKind = gen.AmbiguityKind;
export const AmbiguityKind = {
  ...gen.AmbiguityKind,

  // rustc: compiler/rustc_resolve/src/lib.rs:1112 descr
  descr(self: AmbiguityKind): string {
    switch (self) {
      case "BuiltinAttr":
        return "a name conflict with a builtin attribute";
      case "DeriveHelper":
        return "a name conflict with a derive helper attribute";
      case "MacroRulesVsModularized":
        return "a conflict between a `macro_rules` name and a non-`macro_rules` name from another module";
      case "GlobVsOuter":
        return "a conflict between a name from a glob import and an outer scope during import or macro resolution";
      case "GlobVsGlob":
        return "multiple glob imports of a name in the same module";
      case "GlobVsExpanded":
        return "a conflict between a name from a glob import and a macro-expanded name in the same module during import or macro resolution";
      case "MoreExpandedVsOuter":
        return "a conflict between a macro-expanded name and a less macro-expanded name from outer scope during import or macro resolution";
    }
  },
};

// impl<'ra> DeclData<'ra>

// rustc: compiler/rustc_resolve/src/lib.rs:1151 vis
DeclData.prototype.vis = function (this: DeclData): Visibility<ModId> {
  // Select the maximum visibility if there are multiple ambiguous glob imports.
  const d = this.ambiguity_vis_max.get();
  return d !== undefined ? d.vis() : this.initial_vis;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1156 min_vis
DeclData.prototype.min_vis = function (this: DeclData): Visibility<ModId> {
  // Select the minimum visibility if there are multiple ambiguous glob imports.
  const d = this.ambiguity_vis_min.get();
  return d !== undefined ? d.vis() : this.initial_vis;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1161 res
DeclData.prototype.res = function (this: DeclData): Res {
  switch (this.kind.$) {
    case "Def":
      return this.kind._0;
    case "Import":
      return this.kind.source_decl.res();
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1168 import_source
DeclData.prototype.import_source = function (this: DeclData): Decl {
  switch (this.kind.$) {
    case "Import":
      return this.kind.source_decl;
    default:
      return unreachable();
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1175 descent_to_ambiguity
DeclData.prototype.descent_to_ambiguity = function (this: Decl): [Decl, Decl] | undefined {
  const a = this.ambiguity.get();
  if (a !== undefined) {
    const [ambig_binding, _] = a;
    return [this, ambig_binding];
  }
  switch (this.kind.$) {
    case "Import":
      return this.kind.source_decl.descent_to_ambiguity();
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1185 is_ambiguity_recursive
DeclData.prototype.is_ambiguity_recursive = function (this: DeclData): boolean {
  return (
    this.ambiguity.get() !== undefined ||
    (() => {
      switch (this.kind.$) {
        case "Import":
          return this.kind.source_decl.is_ambiguity_recursive();
        default:
          return false;
      }
    })()
  );
};

// rustc: compiler/rustc_resolve/src/lib.rs:1193 is_possibly_imported_variant
DeclData.prototype.is_possibly_imported_variant = function (this: DeclData): boolean {
  switch (this.kind.$) {
    case "Import":
      return this.kind.source_decl.is_possibly_imported_variant();
    case "Def": {
      const res = this.kind._0;
      if (res.$ === "Def" && (res._0.$ === "Variant" || (res._0.$ === "Ctor" && res._0._0 === "Variant"))) return true;
      return false;
    }
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1204 is_extern_crate
DeclData.prototype.is_extern_crate = function (this: DeclData): boolean {
  switch (this.kind.$) {
    case "Import":
      return this.kind.import.kind.$ === "ExternCrate";
    case "Def": {
      const res = this.kind._0;
      if (res.$ === "Def") return res._1.is_crate_root();
      return false;
    }
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1214 is_import
DeclData.prototype.is_import = function (this: DeclData): boolean {
  return this.kind.$ === "Import";
};

/// The binding introduced by `#[macro_export] macro_rules` is a public import, but it might
/// not be perceived as such by users, so treat it as a non-import in some diagnostics.
// rustc: compiler/rustc_resolve/src/lib.rs:1220 is_import_user_facing
DeclData.prototype.is_import_user_facing = function (this: DeclData): boolean {
  return this.kind.$ === "Import" && this.kind.import.kind.$ !== "MacroExport";
};

// rustc: compiler/rustc_resolve/src/lib.rs:1225 is_glob_import
DeclData.prototype.is_glob_import = function (this: DeclData): boolean {
  switch (this.kind.$) {
    case "Import":
      return this.kind.import.is_glob();
    default:
      return false;
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1232 is_assoc_item
DeclData.prototype.is_assoc_item = function (this: DeclData): boolean {
  const res = this.res();
  return res.$ === "Def" && (res._0.$ === "AssocConst" || res._0.$ === "AssocFn" || res._0.$ === "AssocTy");
};

// rustc: compiler/rustc_resolve/src/lib.rs:1236 macro_kinds
DeclData.prototype.macro_kinds = function (this: DeclData): MacroKinds | undefined {
  return def_Res.macro_kinds(this.res());
};

// rustc: compiler/rustc_resolve/src/lib.rs:1240 reexport_chain
DeclData.prototype.reexport_chain = function (this: Decl): Reexport[] {
  const full_reexport_chain: Reexport[] = [];
  let next_binding: Decl = this;
  for (;;) {
    const kind = next_binding.kind;
    if (kind.$ === "Import") {
      full_reexport_chain.push(kind.import.simplify());
      next_binding = kind.source_decl;
    } else {
      full_reexport_chain.push(...kind._1);
      break;
    }
  }
  return full_reexport_chain;
};

// Suppose that we resolved macro invocation with `invoc_parent_expansion` to binding `binding`
// at some expansion round `max(invoc, binding)` when they both emerged from macros.
// Then this function returns `true` if `self` may emerge from a macro *after* that
// in some later round and screw up our previously found resolution.
// See more detailed explanation in
// https://github.com/rust-lang/rust/pull/53778#issuecomment-419224049
// rustc: compiler/rustc_resolve/src/lib.rs:1264 may_appear_after
DeclData.prototype.may_appear_after = function (this: DeclData, invoc_parent_expansion: LocalExpnId, decl: Decl): boolean {
  // self > max(invoc, decl) => !(self <= invoc || self <= decl)
  // Expansions are partially ordered, so "may appear after" is an inversion of
  // "certainly appears before or simultaneously" and includes unordered cases.
  const self_parent_expansion = this.expansion;
  const other_parent_expansion = decl.expansion;
  const certainly_before_other_or_simultaneously = LocalExpnId.is_descendant_of(other_parent_expansion, self_parent_expansion);
  const certainly_before_invoc_or_simultaneously = LocalExpnId.is_descendant_of(invoc_parent_expansion, self_parent_expansion);
  return !(certainly_before_other_or_simultaneously || certainly_before_invoc_or_simultaneously);
};

/// Returns whether this declaration may be shadowed or overwritten by something else later.
/// FIXME: this function considers `unexpanded_invocations`, but not `single_imports`, so
/// the declaration may not be as "determined" as we think.
/// FIXME: relationship between this function and similar `NameResolution::determined_decl`
/// is unclear.
// rustc: compiler/rustc_resolve/src/lib.rs:1282 determined
DeclData.prototype.determined = function (this: DeclData, r: Resolver): boolean {
  const kind = this.kind;
  if (kind.$ === "Import" && kind.import.is_glob()) {
    return !kind.import.parent_scope.module.has_unexpanded_invocations(r) && kind.source_decl.determined(r);
  }
  return true;
};

export type ExternPreludeEntry = gen.ExternPreludeEntry;
export const ExternPreludeEntry = gen.ExternPreludeEntry as typeof gen.ExternPreludeEntry & {
  flag: () => ExternPreludeEntry;
  open_flag: () => ExternPreludeEntry;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1310 introduced_by_item
gen.ExternPreludeEntry.prototype.introduced_by_item = function (this: ExternPreludeEntry): boolean {
  return this.item_decl !== undefined && this.item_decl[2];
};

// rustc: compiler/rustc_resolve/src/lib.rs:1314 flag
ExternPreludeEntry.flag = function (): ExternPreludeEntry {
  return new gen.ExternPreludeEntry(undefined, [PendingDecl.Pending, false, false]);
};

// rustc: compiler/rustc_resolve/src/lib.rs:1321 open_flag
ExternPreludeEntry.open_flag = function (): ExternPreludeEntry {
  return new gen.ExternPreludeEntry(undefined, [PendingDecl.Pending, false, true]);
};

// rustc: compiler/rustc_resolve/src/lib.rs:1328 span
gen.ExternPreludeEntry.prototype.span = function (this: ExternPreludeEntry): Span {
  if (this.item_decl !== undefined) {
    const [_, span] = this.item_decl;
    return span;
  }
  return DUMMY_SP;
};

/// This provides memory for the rest of the crate. The `'ra` lifetime that is
/// used by many types in this crate is an abbreviation of `ResolverArenas`.
// rustc-type: compiler/rustc_resolve/src/lib.rs:1589 ResolverArenas
// PORT: arenas are erased (D3): `modules`, `imports`, `name_resolutions`, `ast_paths`, `macros` and
// `dropless` keep nothing; every `alloc` returns the allocated value itself (its identity is the
// `Interned` pointer). `#[derive(Default)]` is `new ResolverArenas()`.
export class ResolverArenas {
  /** `self.modules.alloc(data)` (used by `LocalModule::new` / `ExternModule::new`). */
  modules_alloc(data: ModuleData): ModuleData {
    return data;
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:1599 new_def_decl
  new_def_decl(res: Res, vis: Visibility<ModId>, span: Span, expansion: LocalExpnId, parent_module: Module | undefined): Decl {
    return this.alloc_decl(
      new DeclData({ $: "Def", _0: res, _1: [] }, CmCell.new(undefined), expansion, span, vis, CmCell.new(undefined), CmCell.new(undefined), parent_module),
    );
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:1619 new_pub_def_decl
  new_pub_def_decl(res: Res, span: Span, expn_id: LocalExpnId): Decl {
    return this.new_def_decl(res, Visibility.Public, span, expn_id, undefined);
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:1623 alloc_decl
  alloc_decl(data: DeclData): Decl {
    // SAFETY: `Interned` is valid because values of this type have "identity".
    return data;
  }
  // rustc: compiler/rustc_resolve/src/lib.rs:1627 alloc_import
  alloc_import(import_: ImportData): Import {
    // SAFETY: `Interned` is valid because values of this type have "identity".
    return import_;
  }
  // rustc: compiler/rustc_resolve/src/lib.rs:1631 alloc_name_resolution
  alloc_name_resolution(resolution: NameResolution): NameResolutionRef {
    // SAFETY: `Interned` is valid because values of this type have "identity".
    return CmRefCell.new(resolution);
  }
  // rustc: compiler/rustc_resolve/src/lib.rs:1635 alloc_macro_rules_scope
  alloc_macro_rules_scope(scope: MacroRulesScope): MacroRulesScopeRef {
    // `RwLock::new(scope)`: the box the scope is overwritten through (macros.ts `MacroRulesScopeRef`).
    return { value: scope };
  }
  // rustc: compiler/rustc_resolve/src/lib.rs:1638 alloc_macro_rules_decl
  alloc_macro_rules_decl(decl: MacroRulesDecl): MacroRulesDecl {
    return decl;
  }
  // rustc: compiler/rustc_resolve/src/lib.rs:1641 alloc_ast_paths
  alloc_ast_paths(paths: readonly Path[]): readonly Path[] {
    return paths.map(clone_Path);
  }
  // rustc: compiler/rustc_resolve/src/lib.rs:1644 alloc_macro
  alloc_macro(ext: SyntaxExtension): SyntaxExtension {
    // `Arc::new(ext)`
    return ext;
  }
  // rustc: compiler/rustc_resolve/src/lib.rs:1647 alloc_pattern_spans
  alloc_pattern_spans(spans: Iterable<Span>): readonly Span[] {
    return [...spans];
  }
}

// impl<'ra, 'tcx> AsMut<Resolver<'ra, 'tcx>> for Resolver<'ra, 'tcx>
// rustc: compiler/rustc_resolve/src/lib.rs:1653 as_mut
Resolver.prototype.as_mut = function (this: Resolver): Resolver {
  return this;
};

// impl<'ra, 'tcx> AsRef<Resolver<'ra, 'tcx>> for Resolver<'ra, 'tcx>
// rustc: compiler/rustc_resolve/src/lib.rs:1659 as_ref
Resolver.prototype.as_ref = function (this: Resolver): Resolver {
  return this;
};

// impl<'tcx> Resolver<'_, 'tcx>

/// Only call this in analyses after the resolver has finished.
/// Panics if the node id is currently not in the owner storage,
/// e.g. because it's further up in the current visitor stack.
// rustc: compiler/rustc_resolve/src/lib.rs:1668 owner_def_id
Resolver.prototype.owner_def_id = function (this: Resolver, owner: NodeId): LocalDefId {
  return index_map(this.owners, owner).def_id;
};

/// Only call this in analyses after the resolver has finished.
/// Panics if the node id is currently not in the owner storage,
/// e.g. because it's further up in the current visitor stack.
// rustc: compiler/rustc_resolve/src/lib.rs:1675 child_def_id
Resolver.prototype.child_def_id = function (this: Resolver, owner: NodeId, id: NodeId): LocalDefId {
  return index_map(index_map(this.owners, owner).node_id_to_def_id, id);
};

/// Get the `DefId` of a child of the current owner
// rustc: compiler/rustc_resolve/src/lib.rs:1680 opt_local_def_id
Resolver.prototype.opt_local_def_id = function (this: Resolver, node: NodeId): LocalDefId | undefined {
  return this.current_owner.node_id_to_def_id.get(node);
};

/// Get the `DefId` of a child of the current owner
// rustc: compiler/rustc_resolve/src/lib.rs:1685 local_def_id
Resolver.prototype.local_def_id = function (this: Resolver, node: NodeId): LocalDefId {
  const d = this.opt_local_def_id(node);
  if (d !== undefined) return d;
  // PORT: `{:#?}` of the `UnordMap` prints in FxHash order (not reproducible yet).
  return panic(
    `no entry for node id \`${debug_NodeId(node, PLAIN)}\` in owner ${debug_LocalDefId(this.current_owner.def_id, PLAIN)}, available: ${unported("Debug of UnordMap<NodeId, LocalDefId> (FxHash iteration order)")}`,
  );
};

/// Adds a definition with a parent definition.
// rustc: compiler/rustc_resolve/src/lib.rs:1695 create_def
Resolver.prototype.create_def = function (
  this: Resolver,
  parent: LocalDefId,
  node_id: NodeId,
  name: Symbol | undefined,
  def_kind: DefKind,
  expn_id: ExpnId,
  span: Span,
  is_owner: boolean,
): TyCtxtFeed<LocalDefId> {
  if (this.current_owner.node_id_to_def_id.has(node_id)) {
    panic(
      `adding a def for node-id ${debug_NodeId(node_id, PLAIN)}, name ${debug_option(name, PLAIN, debug_Symbol)}, data ${debug_DefKind(def_kind, PLAIN)} but a previous def exists: ${debug_DefKey(
        this.tcx_.definitions_untracked().def_key(index_map(this.current_owner.node_id_to_def_id, node_id)),
        PLAIN,
      )}`,
    );
  }

  const disambiguator = PerParentDisambiguatorsMap.get_or_create(this.disambiguators, parent);

  // FIXME: remove `def_span` body, pass in the right spans here and call `tcx.at().create_def()`
  const feed = this.tcx_.create_def(parent, name, def_kind, undefined, disambiguator);
  const def_id = feed.def_id();

  // Create the definition.
  if (!ExpnId_eq(expn_id, ExpnId.root())) {
    this.expn_that_defined.set(def_id, expn_id);
  }

  // A relative span's parent must be an absolute span.
  // debug_assert_eq!(span.data_untracked().parent, None);
  this.tcx_.untracked().source_span.push(span);
  // debug_assert_eq!(_id, def_id);

  // Some things for which we allocate `LocalDefId`s don't correspond to
  // anything in the AST, so they don't have a `NodeId`. For these cases
  // we don't need a mapping from `NodeId` to `LocalDefId`.
  if (node_id !== DUMMY_NODE_ID && !is_owner) {
    // debug!("create_def: def_id_to_node_id[{:?}] <-> {:?}", def_id, node_id);
    this.current_owner.node_id_to_def_id.set(node_id, def_id);
  }

  return feed;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1743 item_generics_num_lifetimes
Resolver.prototype.item_generics_num_lifetimes = function (this: Resolver, def_id: DefId): number {
  const local = def_id.as_local();
  if (local !== undefined) {
    return index_map(this.item_generics_num_lifetimes_, local);
  } else {
    return unported("tcx.generics_of(def_id).own_counts().lifetimes (rustc_middle ty::Generics, M3)");
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1751 item_required_generic_args_suggestion
Resolver.prototype.item_required_generic_args_suggestion = function (this: Resolver, def_id: DefId): string {
  const local = def_id.as_local();
  if (local !== undefined) {
    return this.item_required_generic_args_suggestions.get(local) ?? "";
  } else {
    // `self.tcx.generics_of(def_id).own_params ...`: `ty::Generics` / `GenericParamDefKind` (M3).
    return unported("tcx.generics_of(def_id).own_params (rustc_middle ty::Generics, M3)");
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:1777 tcx
Resolver.prototype.tcx = function (this: Resolver): TyCtxt {
  return this.tcx_;
};

/// This function is very slow, as it iterates over the entire
/// [PerOwnerResolverData::node_id_to_def_id] map for all [Resolver::owners]
/// just to find the [NodeId]
/// that corresponds to the given [LocalDefId]. Only use this in
/// diagnostics code paths. Do not use this during macro expansion,
/// as it will not find any node ids within your current expansion's stack.
// rustc: compiler/rustc_resolve/src/lib.rs:1787 def_id_to_node_id
Resolver.prototype.def_id_to_node_id = function (this: Resolver, def_id: LocalDefId): NodeId {
  // `UnordItems::get_only`: the only item, or `None` if there are zero or several.
  const found: NodeId[] = [];
  for (const [_, data] of this.owners) {
    for (const [k, v] of data.node_id_to_def_id) if (v === def_id) found.push(k);
    if (data.def_id === def_id) found.push(data.id);
  }
  return unwrap(found.length === 1 ? found[0] : undefined);
};

// impl<'ra, 'tcx> Resolver<'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/lib.rs:1803 new
Resolver.new = function (
  tcx: TyCtxt,
  attrs: readonly Attribute[],
  crate_span: Span,
  current_crate_outer_attr_insert_span: Span,
  arenas: ResolverArenas,
): Resolver {
  const root_def_id = LocalDefId.to_def_id(CRATE_DEF_ID);
  const graph_root = LocalModule.new(
    undefined,
    { $: "Def", _0: DefKind.Mod, _1: root_def_id, _2: CRATE_NODE_ID, _3: undefined },
    Visibility.Public,
    ExpnId.root(),
    crate_span,
    attr.contains_name(attrs, sym.no_implicit_prelude),
    arenas,
  );
  const local_modules = [graph_root];
  const local_module_map = new Map<LocalDefId, LocalModule>([[CRATE_DEF_ID, graph_root]]);
  const empty_module = LocalModule.new(
    undefined,
    { $: "Def", _0: DefKind.Mod, _1: root_def_id, _2: CRATE_NODE_ID, _3: undefined },
    Visibility.Public,
    ExpnId.root(),
    DUMMY_SP,
    true,
    arenas,
  );

  const owner_data = PerOwnerResolverData.new(CRATE_NODE_ID, CRATE_DEF_ID);
  const crate_feed = tcx.create_local_crate_def_id(crate_span);

  crate_feed.def_kind(DefKind.Mod);
  const owners = new Map<NodeId, PerOwnerResolverData>();
  owners.set(CRATE_NODE_ID, owner_data);

  const invocation_parents = new Map<LocalExpnId, InvocationParent>();
  invocation_parents.set(LocalExpnId.ROOT, InvocationParent.ROOT);

  const extern_prelude = build_extern_prelude(tcx, attrs);
  const registered_attr_tools = tcx.registered_attr_tools(null) as RegisteredTools;
  const registered_lint_tools = tcx.registered_lint_tools(null) as RegisteredTools;
  const edition = tcx.sess.edition();

  const resolver = new Resolver(
    tcx,
    new Map(), // expn_that_defined
    // The outermost module has def ID 0; this is not reflected in the
    // AST.
    graph_root,
    // Only set/cleared in Resolver::resolve_imports for now
    SpeculativeFlag.default(),
    undefined, // prelude
    extern_prelude,
    new Map(), // field_names
    new Map(), // field_defaults
    new KeyedMap(DefId_key), // field_visibility_spans
    [], // determined_imports
    [], // indeterminate_imports
    new Map(), // pat_span_map
    new Map(), // partial_res_map
    new Map(), // import_use_map
    new Map(), // extern_crate_map
    new Map(), // module_children
    new Map(), // ambig_module_children
    new Map(), // block_map
    empty_module,
    local_modules,
    local_module_map,
    new KeyedMap(DefId_key), // extern_module_map
    new Map(), // glob_map
    undefined, // glob_error
    [], // visibilities_for_hashing
    new Set(), // used_imports
    new Set(), // maybe_unused_trait_imports
    [], // privacy_errors
    [], // ambiguity_errors
    false, // issue_145575_hack_applied
    [], // delayed_vis_resolution_errors
    new KeyedSet(OrdSpan_pair_key), // macro_expanded_macro_export_errors
    arenas,
    arenas.new_pub_def_decl({ $: "Err" }, DUMMY_SP, LocalExpnId.ROOT),
    new Map(
      PrimTy_ALL.map((prim_ty) => {
        const res: Res = { $: "PrimTy", _0: prim_ty };
        const decl = arenas.new_pub_def_decl(res, DUMMY_SP, LocalExpnId.ROOT);
        return [PrimTy_name(prim_ty), decl];
      }),
    ),
    new Map(
      BUILTIN_ATTRIBUTES.map((builtin_attr) => {
        const res: Res = { $: "NonMacroAttr", _0: { $: "Builtin", _0: builtin_attr } };
        const decl = arenas.new_pub_def_decl(res, DUMMY_SP, LocalExpnId.ROOT);
        return [builtin_attr, decl];
      }),
    ),
    new KeyedMap(
      IdentKey_key,
      [...registered_attr_tools].map((ident) => {
        const res: Res = { $: "ToolMod" };
        const decl = arenas.new_pub_def_decl(res, ident.span, LocalExpnId.ROOT);
        return [IdentKey.new(ident), decl] as const;
      }),
    ),
    new KeyedSet(IdentKey_key), // macro_names
    new Map(), // builtin_macros
    registered_attr_tools,
    registered_lint_tools,
    new Map(), // macro_use_prelude
    new Map(), // local_macro_map
    new KeyedMap(DefId_key), // extern_macro_map
    arenas.alloc_macro(SyntaxExtension.dummy_bang(edition)),
    arenas.alloc_macro(SyntaxExtension.dummy_derive(edition)),
    arenas.alloc_macro(SyntaxExtension.non_macro_attr(edition)),
    new Map(), // local_macro_def_scopes
    new Map(), // ast_transform_scopes
    new Map(), // unused_macros
    new Map(), // unused_macro_rules
    new Set(), // proc_macro_stubs
    CmRefCell.new([]), // single_segment_macro_resolutions
    CmRefCell.new([]), // multi_segment_macro_resolutions
    [], // builtin_attrs
    new Set(), // containers_deriving_copy
    new Set(), // containers_deriving_ord
    new Map(), // invocation_parent_scopes
    new Map(), // output_macro_rules_scopes
    new Map(), // macro_rules_scopes
    new Map(), // helper_attrs
    new Map(), // derive_data
    new Map(), // name_already_seen
    [], // potentially_unused_imports
    [], // potentially_unnecessary_qualifications
    new Map(), // struct_ctors
    new Map(), // struct_generics
    LintBuffer_default(),
    CRATE_NODE_ID, // next_node_id
    owners,
    PerOwnerResolverData.new(DUMMY_NODE_ID, CRATE_DEF_ID),
    new Map(), // disambiguators
    new Map(), // placeholder_field_indices
    invocation_parents,
    new Map(), // item_generics_num_lifetimes
    new Map(), // item_required_generic_args_suggestions
    new Map(), // delegation_fn_sigs
    new Map(), // delegation_infos
    new Map(), // delegation_inherent_fn_map
    undefined, // main_def
    new KeyedMap(DefId_key), // trait_impls
    [], // proc_macros
    new Set(), // paths_matching_assoc_types
    new Map(), // confused_type_with_std_module
    [], // stripped_cfg_items
    EffectiveVisibilities.default(), // effective_visibilities
    new Map(), // macro_reachable_adts
    new Map(), // doc_link_resolutions
    new Map(), // doc_link_traits_in_scope
    new Set(), // all_macro_rules
    new Set(), // glob_delegation_invoc_ids
    new Map(), // impl_unexpanded_invocations
    new Map(), // impl_binding_keys
    current_crate_outer_attr_insert_span,
    new KeyedSet(DefId_key), // mods_with_parse_errors
    false, // all_crate_macros_already_registered
    new Map(), // impl_trait_names
    false, // raise_fatal_after_resolve
    new Map(), // on_unknown_data
    tcx.features(),
  );

  const directive = OnUnknownData.from_attrs(resolver, attrs);
  if (directive !== undefined) {
    resolver.on_unknown_data_.set(CRATE_DEF_ID, directive);
  }

  const root_parent_scope = ParentScope.module(graph_root, resolver.arenas);
  resolver.invocation_parent_scopes.set(LocalExpnId.ROOT, root_parent_scope);
  resolver.feed_visibility(crate_feed, Visibility.Public);

  return resolver;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1917 new_local_module
Resolver.prototype.new_local_module = function (
  this: Resolver,
  parent: LocalModule | undefined,
  kind: ModuleKind,
  expn_id: ExpnId,
  span: Span,
  no_implicit_prelude: boolean,
): LocalModule {
  const def_id = ModuleKind.opt_def_id(kind);
  const vis = def_id === undefined ? Visibility.Public : (this.tcx_.visibility(def_id) as Visibility<ModId>);
  const module = LocalModule.new(parent, kind, vis, expn_id, span, no_implicit_prelude, this.arenas);
  this.local_modules.push(module);
  const mdef_id = module.opt_def_id();
  if (mdef_id !== undefined) {
    this.local_module_map.set(mdef_id.expect_local(), module);
  }
  return module;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1936 next_node_id
Resolver.prototype.next_node_id = function (this: Resolver): NodeId {
  const start = this.next_node_id_;
  const next = NodeId.as_u32(start) + 1;
  if (next > 0xffff_ffff) panic("input too large; ran out of NodeIds");
  this.next_node_id_ = NodeId.from_u32(next);
  return start;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1943 next_node_ids
Resolver.prototype.next_node_ids = function (this: Resolver, count: number): Range<NodeId> {
  const start = this.next_node_id_;
  const end = NodeId.as_usize(start) + count;
  if (end > Number.MAX_SAFE_INTEGER) panic("input too large; ran out of NodeIds");
  this.next_node_id_ = NodeId.from_usize(end);
  return { start, end: this.next_node_id_ };
};

// rustc: compiler/rustc_resolve/src/lib.rs:1950 lint_buffer
Resolver.prototype.lint_buffer = function (this: Resolver): LintBuffer {
  return this.lint_buffer_;
};

// rustc: compiler/rustc_resolve/src/lib.rs:1954 arenas
Resolver.arenas = function (): ResolverArenas {
  return new ResolverArenas();
};

// rustc: compiler/rustc_resolve/src/lib.rs:1958 feed_visibility
Resolver.prototype.feed_visibility = function (this: Resolver, feed: TyCtxtFeed<LocalDefId>, vis: Visibility): void {
  feed.visibility(Visibility.to_mod_id(vis));
  this.visibilities_for_hashing.push([feed.def_id(), vis]);
};

// rustc: compiler/rustc_resolve/src/lib.rs:1963 into_outputs
Resolver.prototype.into_outputs = function (this: Resolver): ResolverOutputs {
  const proc_macros = this.proc_macros;
  const expn_that_defined = this.expn_that_defined;
  const extern_crate_map = this.extern_crate_map;
  const maybe_unused_trait_imports = this.maybe_unused_trait_imports;
  const glob_map = this.glob_map;
  const main_def = this.main_def;
  const confused_type_with_std_module = this.confused_type_with_std_module;
  const paths_matching_assoc_types = this.paths_matching_assoc_types;
  const effective_visibilities = this.effective_visibilities;

  const stripped_cfg_items: StrippedCfgItem[] = [];
  for (const item of this.stripped_cfg_items) {
    const owner = this.owners.get(item.parent_scope);
    if (owner === undefined) continue;
    const parent_scope = LocalDefId.to_def_id(owner.def_id);
    stripped_cfg_items.push(new StrippedCfgItem(parent_scope, item.ident, item.cfg));
  }
  const disambiguators = new Map<LocalDefId, Steal<PerParentDisambiguatorState>>();
  for (const [def_id, disamb] of this.disambiguators) {
    disambiguators.set(def_id, Steal.new(disamb, "rustc_hir_id::definitions::PerParentDisambiguatorState"));
  }

  const global_ctxt: ResolverGlobalCtxt = {
    expn_that_defined,
    visibilities_for_hashing: this.visibilities_for_hashing,
    effective_visibilities,
    macro_reachable_adts: this.macro_reachable_adts,
    extern_crate_map,
    module_children: this.module_children,
    ambig_module_children: this.ambig_module_children,
    glob_map,
    maybe_unused_trait_imports,
    main_def,
    // PORT: rustc_middle's `trait_impls` is keyed by `DefId_hash_key` with the `DefId` kept in the entry.
    trait_impls: new Map([...this.trait_impls].map(([def_id, impls]) => [DefId_hash_key(def_id), [def_id, impls]] as const)),
    proc_macros,
    confused_type_with_std_module,
    paths_matching_assoc_types,
    doc_link_resolutions: this.doc_link_resolutions,
    doc_link_traits_in_scope: this.doc_link_traits_in_scope,
    all_macro_rules: this.all_macro_rules,
    stripped_cfg_items,
    delegation_infos: this.delegation_infos,
    delegation_inherent_fn_map: this.delegation_inherent_fn_map,
  };
  const ast_lowering: ResolverAstLowering = {
    partial_res_map: this.partial_res_map,
    next_node_id: this.next_node_id_,
    owners: this.owners,
    lint_buffer: Steal.new(this.lint_buffer_, "rustc_errors::decorate_diag::LintBuffer"),
    disambiguators,
  };
  return { global_ctxt, ast_lowering };
};

// rustc: compiler/rustc_resolve/src/lib.rs:2020 cstore
Resolver.prototype.cstore = function (this: Resolver): CStore {
  return CStore.from_tcx(this.tcx_);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2024 cstore_mut
Resolver.prototype.cstore_mut = function (this: Resolver): CStore {
  return CStore.from_tcx_mut(this.tcx_);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2028 dummy_ext
Resolver.prototype.dummy_ext = function (this: Resolver, macro_kind: MacroKind): SyntaxExtension {
  switch (macro_kind) {
    case "Bang":
      return this.dummy_ext_bang;
    case "Derive":
      return this.dummy_ext_derive;
    case "Attr":
      return this.non_macro_attr;
  }
};

/// Returns a conditionally mutable resolver that cannot be mutated.
// rustc: compiler/rustc_resolve/src/lib.rs:2037 cm
Resolver.prototype.cm = function (this: Resolver): CmResolver {
  // `CmResolver::Ref(self)` (PORT: `RefOrMut` is erased, see `mod ref_mut`)
  return this;
};

/// Returns a conditionally mutable resolver that can be mutated.
/// Will panic if the `assert_speculative` field is true.
// rustc: compiler/rustc_resolve/src/lib.rs:2043 cm_mut
Resolver.prototype.cm_mut = function (this: Resolver): CmResolver {
  assert(!this.speculative_flag.is_speculative(), "can't mutably borrow speculative resolver");
  // `CmResolver::Mut(self)`
  return this;
};

/// Runs the function on each namespace.
// rustc: compiler/rustc_resolve/src/lib.rs:2052 per_ns
Resolver.prototype.per_ns = function (this: Resolver, f: (this_: Resolver, _1: Namespace) => void): void {
  f(this, "TypeNS");
  f(this, "ValueNS");
  f(this, "MacroNS");
};

// rustc: compiler/rustc_resolve/src/lib.rs:2058 per_ns_mut
Resolver.prototype.per_ns_mut = function (this: Resolver, f: (this_: Resolver, _1: Namespace) => void): void {
  f(this, "TypeNS");
  f(this, "ValueNS");
  f(this, "MacroNS");
};

// rustc: compiler/rustc_resolve/src/lib.rs:2064 is_builtin_macro
Resolver.prototype.is_builtin_macro = function (this: Resolver, res: Res): boolean {
  const ext = this.get_macro(res);
  return ext !== undefined && ext.builtin_name !== undefined;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2068 is_specific_builtin_macro
Resolver.prototype.is_specific_builtin_macro = function (this: Resolver, res: Res, symbol: Symbol): boolean {
  const ext = this.get_macro(res);
  return ext !== undefined && ext.builtin_name === symbol;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2072 macro_def
Resolver.prototype.macro_def = function (this: Resolver, ctxt_: SyntaxContext): DefId {
  const ctxt: MutRef<SyntaxContext> = { value: ctxt_ };
  for (;;) {
    const macro_def_id = SyntaxContext.outer_expn_data(ctxt.value).macro_def_id;
    if (macro_def_id !== undefined) {
      return macro_def_id;
    } else {
      SyntaxContext.remove_mark(ctxt);
    }
  }
};

/// Entry point to crate resolution.
// rustc: compiler/rustc_resolve/src/lib.rs:2082 resolve_crate
Resolver.prototype.resolve_crate = function (this: Resolver, krate: Crate): void {
  this.tcx_.sess.time("resolve_crate", () => {
    this.tcx_.sess.time("finalize_imports", () => this.finalize_imports());
    const exported_ambiguities = this.tcx_.sess.time("compute_effective_visibilities", () =>
      EffectiveVisibilitiesVisitor.compute_effective_visibilities(this, krate),
    );
    this.tcx_.sess.time("lint_reexports", () => this.lint_reexports(exported_ambiguities));
    this.tcx_.sess.time("finalize_macro_resolutions", () => this.finalize_macro_resolutions(krate));
    const [use_items, use_injections] = this.tcx_.sess.time("late_resolve_crate", () => this.late_resolve_crate(krate));
    this.tcx_.sess.time("resolve_main", () => this.resolve_main());
    this.tcx_.sess.time("resolve_check_unused", () => this.check_unused(use_items));
    this.tcx_.sess.time("resolve_report_errors", () => this.report_errors(krate, use_injections));
    this.tcx_.sess.time("resolve_postprocess", () => this.cstore_mut().postprocess(this.tcx_, krate));
  });

  // Don't mutate the cstore or stable crate id map from here on.
  this.tcx_.untracked().freeze_cstore();
  if (this.raise_fatal_after_resolve) {
    new FatalError().raise();
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:2111 traits_in_scope
Resolver.prototype.traits_in_scope = function (
  this: Resolver,
  current_trait: Module | undefined,
  parent_scope: ParentScope,
  sp: Span,
  assoc_item: [Symbol, Namespace] | undefined,
): readonly TraitCandidate[] {
  const found_traits: TraitCandidate[] = [];

  if (current_trait !== undefined) {
    const module = current_trait;
    if (this.trait_may_have_item(module, assoc_item)) {
      const def_id = module.def_id();
      found_traits.push({
        def_id,
        import_ids: [],
        lint_ambiguous: false,
      });
    }
  }

  const scope_set: gen.ScopeSet = { $: "All", _0: "TypeNS" };
  const ctxt = Macros20NormalizedSyntaxContext.new(Span.ctxt(sp));
  const cmr = this.cm_mut();
  cmr.visit_scopes(scope_set, parent_scope, ctxt, sp, undefined, (this_, scope, _2, _3) => {
    switch (scope.$) {
      case "ModuleNonGlobs":
        RefOrMut.get_mut(this_).traits_in_module(scope._0, assoc_item, found_traits);
        break;
      case "ModuleGlobs":
        // Already handled in `ModuleNonGlobs` (but see #144993).
        break;
      case "StdLibPrelude":
        if (this_.prelude !== undefined) {
          RefOrMut.get_mut(this_).traits_in_module(this_.prelude, assoc_item, found_traits);
        }
        break;
      case "ExternPreludeItems":
      case "ExternPreludeFlags":
      case "ToolAttributePrelude":
      case "BuiltinTypes":
        break;
      default:
        unreachable();
    }
    return ControlFlow.CONTINUE as ControlFlow<null>;
  });

  // `self.tcx.hir_arena.alloc_slice(&found_traits)` (arenas erased)
  return found_traits;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2159 traits_in_module
Resolver.prototype.traits_in_module = function (
  this: Resolver,
  module: Module,
  assoc_item: [Symbol, Namespace] | undefined,
  found_traits: TraitCandidate[],
): void {
  module.ensure_traits(this);
  const traits = module.traits.borrow(this);
  for (const [trait_name, trait_binding, trait_module, lint_ambiguous] of unwrap(traits)) {
    if (this.trait_may_have_item(trait_module, assoc_item)) {
      const def_id = def_Res.def_id(trait_binding.res(), debug_NodeId);
      const import_ids = this.find_transitive_imports(trait_binding.kind, trait_name);
      found_traits.push({ def_id, import_ids, lint_ambiguous });
    }
  }
};

// List of traits in scope is pruned on best effort basis. We reject traits not having an
// associated item with the given name and namespace (if specified). This is a conservative
// optimization, proper hygienic type-based resolution of associated items is done in typeck.
// We don't reject trait aliases (`trait_module == None`) because we don't have access to their
// associated items.
// rustc: compiler/rustc_resolve/src/lib.rs:2183 trait_may_have_item
Resolver.prototype.trait_may_have_item = function (
  this: Resolver,
  trait_module: Module | undefined,
  assoc_item: [Symbol, Namespace] | undefined,
): boolean {
  if (trait_module !== undefined && assoc_item !== undefined) {
    const [name, ns] = assoc_item;
    for (const [key, _name_resolution] of this.resolutions(trait_module)) {
      if (key.ns === ns && key.ident.name === name) return true;
    }
    return false;
  }
  return true;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2197 find_transitive_imports
Resolver.prototype.find_transitive_imports = function (this: Resolver, kind: DeclKind, trait_name: Symbol): readonly LocalDefId[] {
  const import_ids: LocalDefId[] = [];
  while (kind.$ === "Import") {
    const { import: import_, source_decl } = kind;
    const def_id = import_.def_id();
    if (def_id !== undefined) {
      this.maybe_unused_trait_imports.add(def_id);
      import_ids.push(def_id);
    }
    this.add_to_glob_map(import_, trait_name);
    kind = source_decl.kind;
  }

  // `self.tcx.hir_arena.alloc_slice(&import_ids)` (arenas erased)
  return import_ids;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2215 resolutions
Resolver.prototype.resolutions = function (this: Resolver, module: Module): ResolutionTable {
  const lazy = module.lazy_resolutions;
  switch (lazy.$) {
    case "Local":
      return lazy._0.borrow_checked(this);
    case "Extern":
      // It is fine to return a `CmRef::Untracked`, we never give out a `&mut`
      // to an external table.
      // As long as 1 thread is building this external table, all other threads will wait.
      // `extern_res.get_or_init(|| ..)`
      if (lazy._0 === undefined) {
        lazy._0 = this.build_reduced_graph_external(module.expect_extern());
      }
      return lazy._0;
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:2230 resolutions_mut
Resolver.prototype.resolutions_mut = function (this: Resolver, module: Module): ResolutionTable {
  const lazy = module.lazy_resolutions;
  switch (lazy.$) {
    case "Local":
      return lazy._0.borrow_mut(this).value;
    case "Extern":
      // We do not allow in place mutations of the external resolution table. In fact,
      // we never attempt it.
      return unreachable("Attempted to mutably borrow an extenral resolution table");
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:2241 resolution
Resolver.prototype.resolution = function (this: Resolver, module: Module, key: BindingKey): NameResolution | undefined {
  return this.resolutions(module).get(key)?.borrow_checked(this);
};

// #[track_caller]
// rustc: compiler/rustc_resolve/src/lib.rs:2250 resolution_or_default
Resolver.prototype.resolution_or_default = function (this: Resolver, module: Module, key: BindingKey, orig_ident_span: Span): NameResolutionRef {
  const table = this.resolutions_mut(module);
  let r = table.get(key);
  if (r === undefined) {
    r = this.arenas.alloc_name_resolution(NameResolution.new(orig_ident_span));
    table.set(key, r);
  }
  return r;
};

/// Test if AmbiguityError ambi is any identical to any one inside ambiguity_errors
// rustc: compiler/rustc_resolve/src/lib.rs:2262 matches_previous_ambiguity_error
Resolver.prototype.matches_previous_ambiguity_error = function (this: Resolver, ambi: AmbiguityError): boolean {
  for (const ambiguity_error of this.ambiguity_errors) {
    // if the span location and ident as well as its span are the same
    if (
      ambiguity_error.kind === ambi.kind &&
      ambiguity_error.ident.eq(ambi.ident) &&
      ambiguity_error.ident.span === ambi.ident.span &&
      ambiguity_error.b1.span === ambi.b1.span &&
      ambiguity_error.b2.span === ambi.b2.span
    ) {
      return true;
    }
  }
  return false;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2277 record_use
Resolver.prototype.record_use = function (this: Resolver, ident: Ident, used_decl: Decl, used: Used): void {
  const amb = used_decl.ambiguity.get();
  if (amb !== undefined) {
    const [b2, warning] = amb;
    const ambiguity_error: AmbiguityError = {
      kind: "GlobVsGlob",
      ambig_vis: undefined,
      ident,
      b1: used_decl,
      b2,
      scope1: { $: "ModuleGlobs", _0: unwrap(used_decl.parent_module), _1: undefined },
      scope2: { $: "ModuleGlobs", _0: unwrap(b2.parent_module), _1: undefined },
      warning: warning ? "GlobImport" : undefined,
    };
    if (!this.matches_previous_ambiguity_error(ambiguity_error)) {
      // avoid duplicated span information to be emit out
      this.ambiguity_errors.push(ambiguity_error);
    }
  }
  if (used_decl.kind.$ === "Import") {
    const { import: import_, source_decl } = used_decl.kind;
    if (import_.kind.$ === "MacroUse" && import_.kind.warn_private === true) {
      // Do not report the lint if the macro name resolves in stdlib prelude
      // even without the problematic `macro_use` import.
      const found_in_stdlib_prelude =
        this.prelude !== undefined &&
        ((prelude: Module) => {
          const empty_module = this.empty_module;
          const arenas = this.arenas;
          return (
            this.cm().maybe_resolve_ident_in_module(
              { $: "Module", _0: prelude },
              ident,
              "MacroNS",
              ParentScope.module(empty_module, arenas),
              undefined,
            ).$ === "Ok"
          );
        })(this.prelude);
      if (!found_in_stdlib_prelude) {
        this.lint_buffer().buffer_lint(PRIVATE_MACRO_USE, import_.root_id, ident.span, diagnostics.MacroIsPrivate_diagnostic({ ident }));
      }
    }
    // Avoid marking `extern crate` items that refer to a name from extern prelude,
    // but not introduce it, as used if they are accessed from lexical scope.
    if (used === "Scope") {
      const entry = this.extern_prelude.get(IdentKey.new(ident));
      if (entry !== undefined && entry.item_decl !== undefined) {
        const [item_decl, _, introduced] = entry.item_decl;
        if (!introduced && item_decl === used_decl) {
          return;
        }
      }
    }
    let old_used = this.import_use_map.get(import_);
    if (old_used === undefined) {
      old_used = used;
      this.import_use_map.set(import_, used);
    }
    if (Used_discriminant[old_used] < Used_discriminant[used]) {
      this.import_use_map.set(import_, used);
    }
    const id = import_.id();
    if (id !== undefined) {
      this.used_imports.add(id);
    }
    this.add_to_glob_map(import_, ident.name);
    this.record_use(ident, source_decl, "Other");
  }
};

// #[inline]
// rustc: compiler/rustc_resolve/src/lib.rs:2342 add_to_glob_map
Resolver.prototype.add_to_glob_map = function (this: Resolver, import_: Import, name: Symbol): void {
  if (import_.kind.$ === "Glob") {
    const def_id = import_.kind.def_id;
    let set = this.glob_map.get(def_id);
    if (set === undefined) {
      set = new Set();
      this.glob_map.set(def_id, set);
    }
    set.add(name);
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:2348 resolve_crate_root
Resolver.prototype.resolve_crate_root = function (this: Resolver, ident: Ident): Module {
  // debug!("resolve_crate_root({:?})", ident);
  const ctxt: MutRef<SyntaxContext> = { value: Span.ctxt(ident.span) };
  let mark: ExpnId | undefined;
  if (ident.name === kw.DollarCrate) {
    // When resolving `$crate` from a `macro_rules!` invoked in a `macro`,
    // we don't want to pretend that the `macro_rules!` definition is in the `macro`
    // as described in `SyntaxContext::apply_mark`, so we ignore prepended opaque marks.
    // FIXME: This is only a guess and it doesn't work correctly for `macro_rules!`
    // definitions actually produced by `macro` and `macro` definitions produced by
    // `macro_rules!`, but at least such configurations are not stable yet.
    ctxt.value = SyntaxContext.normalize_to_macro_rules(ctxt.value);
    // debug!("resolve_crate_root: marks={:?}", ..);
    const iter = SyntaxContext.marks(ctxt.value).reverse();
    let i = 0;
    let result: ExpnId | undefined;
    // Find the last opaque mark from the end if it exists.
    while (i < iter.length) {
      const [mark, transparency] = iter[i]!;
      if (transparency === "Opaque") {
        result = mark;
        i++;
      } else {
        break;
      }
    }
    // debug!("resolve_crate_root: found opaque mark {:?} {:?}", ..);
    // Then find the last semi-opaque mark from the end if it exists.
    for (; i < iter.length; i++) {
      const [mark, transparency] = iter[i]!;
      if (transparency === "SemiOpaque") {
        result = mark;
      } else {
        break;
      }
    }
    // debug!("resolve_crate_root: found semi-opaque mark {:?} {:?}", ..);
    mark = result;
  } else {
    // debug!("resolve_crate_root: not DollarCrate");
    ctxt.value = SyntaxContext.normalize_to_macros_2_0(ctxt.value);
    mark = SyntaxContext.adjust(ctxt, ExpnId.root());
  }
  let module: Module;
  if (mark !== undefined) {
    module = this.expn_def_scope(mark);
  } else {
    // debug!("resolve_crate_root({:?}): found no mark (ident.span = {:?})", ..);
    return this.graph_root.to_module();
  }
  const opt_def_id = module.opt_def_id();
  module = this.expect_module(CrateNum.as_def_id(opt_def_id === undefined ? LOCAL_CRATE : opt_def_id.krate));
  // debug!("resolve_crate_root({:?}): got module {:?} ({:?}) (ident.span = {:?})", ..);
  return module;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2421 resolve_self
Resolver.prototype.resolve_self = function (this: Resolver, ctxt: MutRef<SyntaxContext>, module: Module): Module {
  module = this.expect_module(module.nearest_parent_mod().to_def_id());
  while (SyntaxContext.normalize_to_macros_2_0(Span.ctxt(module.span)) !== ctxt.value) {
    const parent = module.parent ?? this.expn_def_scope(SyntaxContext.remove_mark(ctxt));
    module = this.expect_module(parent.nearest_parent_mod().to_def_id());
  }
  return module;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2430 record_partial_res
Resolver.prototype.record_partial_res = function (this: Resolver, node_id: NodeId, resolution: PartialRes): void {
  // debug!("(recording res) recording {:?} for {}", resolution, node_id);
  const prev_res = this.partial_res_map.get(node_id);
  this.partial_res_map.set(node_id, resolution);
  if (prev_res !== undefined) {
    panic(`path resolved multiple times (${debug_PartialRes(prev_res, PLAIN)} before, ${debug_PartialRes(resolution, PLAIN)} now)`);
  }
};

// rustc: compiler/rustc_resolve/src/lib.rs:2437 record_pat_span
Resolver.prototype.record_pat_span = function (this: Resolver, node: NodeId, span: Span): void {
  // debug!("(recording pat) recording {:?} for {:?}", node, span);
  this.pat_span_map.set(node, span);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2442 is_accessible_from
Resolver.prototype.is_accessible_from = function (this: Resolver, vis: Visibility<LocalModId | ModId>, module: Module): boolean {
  return Visibility.is_accessible_from(vis, module.nearest_parent_mod(), this.tcx_);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2446 disambiguate_macro_rules_vs_modularized
Resolver.prototype.disambiguate_macro_rules_vs_modularized = function (this: Resolver, macro_rules_: Decl, modularized_: Decl): boolean {
  // Some non-controversial subset of ambiguities "modularized macro name" vs "macro_rules"
  // is disambiguated to mitigate regressions from macro modularization.
  // Scoping for `macro_rules` behaves like scoping for `let` at module level, in general.
  //
  // Panic on unwrap should be impossible, the only name_bindings passed in should be from
  // `resolve_ident_in_scope_set` which will always refer to a local binding from an
  // import or macro definition.
  const macro_rules = unwrap(macro_rules_.parent_module);
  const modularized = unwrap(modularized_.parent_module);
  return ModId_eq(macro_rules.nearest_parent_mod(), modularized.nearest_parent_mod()) && modularized.is_ancestor_of(macro_rules);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2464 extern_prelude_get_item
Resolver.prototype.extern_prelude_get_item = function (this: CmResolver, ident: IdentKey, orig_ident_span: Span, finalize: boolean): Decl | undefined {
  const entry = this.extern_prelude.get(ident);
  if (entry === undefined || entry.item_decl === undefined) return undefined;
  const [decl] = entry.item_decl;
  if (finalize) {
    RefOrMut.get_mut(this).record_use(ident.orig(orig_ident_span), decl, "Scope");
  }
  return decl;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2479 extern_prelude_get_flag
Resolver.prototype.extern_prelude_get_flag = function (this: Resolver, ident: IdentKey, orig_ident_span: Span, finalize: boolean): Decl | undefined {
  const entry = this.extern_prelude.get(ident);
  if (entry === undefined || entry.flag_decl === undefined) return undefined;
  // `let mut flag_decl = flag_decl.lock();` // Lock for this entire process
  const [pending_decl, finalized, is_open] = entry.flag_decl;
  let decl: Decl | undefined;
  switch (pending_decl.$) {
    case "Ready":
      decl = pending_decl._0;
      if (finalize && !finalized && !is_open) {
        this.cstore_mut().process_path_extern(this.tcx_, ident.name, orig_ident_span);
      }
      break;
    case "Pending": {
      // debug_assert!(!finalized);
      if (is_open) {
        const res: Res = { $: "OpenMod", _0: ident.name };
        decl = this.arenas.new_pub_def_decl(res, DUMMY_SP, LocalExpnId.ROOT);
      } else {
        const crate_id = finalize
          ? this.cstore_mut().process_path_extern(this.tcx_, ident.name, orig_ident_span)
          : this.cstore_mut().maybe_process_path_extern(this.tcx_, ident.name);
        if (crate_id !== undefined) {
          const def_id = CrateNum.as_def_id(crate_id);
          const res: Res = { $: "Def", _0: DefKind.Mod, _1: def_id };
          decl = this.arenas.new_pub_def_decl(res, DUMMY_SP, LocalExpnId.ROOT);
        } else {
          decl = undefined;
        }
      }
      break;
    }
  }
  entry.flag_decl = [{ $: "Ready", _0: decl }, finalize || finalized, is_open];
  return decl ?? (finalize ? this.dummy_decl : undefined);
};

/// Rustdoc uses this to resolve doc link paths in a recoverable way. `PathResult<'a>`
/// isn't something that can be returned because it can't be made to live that long,
/// and also it's a private type. Fortunately rustdoc doesn't need to know the error,
/// just that an error occurred.
// rustc: compiler/rustc_resolve/src/lib.rs:2532 resolve_rustdoc_path
Resolver.prototype.resolve_rustdoc_path = function (this: Resolver, path_str: string, ns: Namespace, parent_scope: ParentScope): Res | undefined {
  const segments: Segment[] = [];
  const parts = path_str.split("::");
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i]!;
    let sym_: Symbol;
    if (s.length === 0) {
      if (i === 0) {
        // For a path like `::a::b`, use `kw::PathRoot` as the leading segment.
        sym_ = kw.PathRoot;
      } else {
        return undefined; // occurs in cases like `String::`
      }
    } else {
      sym_ = Symbol.intern(s);
    }
    segments.push(Segment.from_ident(Ident.with_dummy_span(sym_)));
  }

  const path_result = this.cm().maybe_resolve_path(segments, ns, parent_scope, undefined);
  switch (path_result.$) {
    case "Module":
      if (path_result._0.$ === "Module") return unwrap(path_result._0._0.res());
      if (path_result._0.$ === "ExternPrelude") return undefined;
      return bug(`got invalid path_result: ${debug_PathResult(path_result, PLAIN)}`);
    case "NonModule": {
      const res = path_result._0.full_res();
      return res !== undefined && !(res.$ === "Def" && res._0.$ === "Ctor") ? res : undefined;
    }
    case "Failed":
      return undefined;
    case "Indeterminate":
      return bug(`got invalid path_result: ${debug_PathResult(path_result, PLAIN)}`);
  }
};

/// Retrieves definition span of the given `DefId`.
// rustc: compiler/rustc_resolve/src/lib.rs:2572 def_span
Resolver.prototype.def_span = function (this: Resolver, def_id: DefId): Span {
  const local = def_id.as_local();
  if (local !== undefined) return this.tcx_.source_span(local);
  // Query `def_span` is not used because hashing its result span is expensive.
  return this.cstore().def_span_untracked(this.tcx(), def_id);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2580 field_idents
Resolver.prototype.field_idents = function (this: Resolver, def_id: DefId): Ident[] | undefined {
  const local = def_id.as_local();
  if (local !== undefined) return this.field_names.get(local)?.slice();
  const k = this.tcx_.def_kind(def_id);
  if (k.$ === "Struct" || k.$ === "Union" || k.$ === "Variant") {
    return (this.tcx_.associated_item_def_ids(def_id) as readonly DefId[]).map((def_id) => Ident.new(this.tcx_.item_name(def_id), this.tcx_.def_span(def_id)));
  }
  return undefined;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2602 field_defaults
Resolver.prototype.field_defaults = function (this: Resolver, def_id: DefId): Symbol[] | undefined {
  const local = def_id.as_local();
  if (local !== undefined) return this.field_defaults_.get(local)?.slice();
  const k = this.tcx_.def_kind(def_id);
  if (k.$ === "Struct" || k.$ === "Union" || k.$ === "Variant") {
    const out: Symbol[] = [];
    for (const def_id_ of this.tcx_.associated_item_def_ids(def_id) as readonly DefId[]) {
      if (this.tcx_.default_field(def_id_) !== undefined) out.push(this.tcx_.item_name(def_id_));
    }
    return out;
  }
  return undefined;
};

/// Checks if an expression refers to a function marked with
/// `#[rustc_legacy_const_generics]` and returns the argument index list
/// from the attribute.
// rustc: compiler/rustc_resolve/src/lib.rs:2627 legacy_const_generic_args
Resolver.prototype.legacy_const_generic_args = function (this: Resolver, expr: Expr): number[] | undefined {
  if (expr.kind.$ !== "Path" || expr.kind._0 !== undefined) {
    return undefined;
  }
  const path = expr.kind._1;
  // Don't perform legacy const generics rewriting if the path already
  // has generic arguments.
  if (unwrap(path.segments.at(-1)).args !== undefined) {
    return undefined;
  }

  const partial = this.partial_res_map.get(expr.id);
  if (partial === undefined) return undefined;
  const full = partial.full_res();
  if (full === undefined) return undefined;
  const def_id = def_Res.opt_def_id(full);
  if (def_id === undefined) return undefined;

  // We only support cross-crate argument rewriting. Uses
  // within the same crate should be updated to use the new
  // const generics style.
  if (def_id.is_local()) {
    return undefined;
  }

  // we can use parsed attrs here since for other crates they're already available
  const fn_indexes = find_attr(DefId_get_attrs(def_id, this.tcx_), (k: AttributeKind) => (k.$ === "RustcLegacyConstGenerics" ? k.fn_indexes : undefined));
  return fn_indexes?.map(([num, _]) => num);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2654 resolve_main
Resolver.prototype.resolve_main = function (this: Resolver): void {
  const any_exe = this.tcx_.crate_types().includes("Executable");
  // Don't try to resolve main unless it's an executable
  if (!any_exe) {
    return;
  }

  const module = this.graph_root;
  const ident = Ident.with_dummy_span(sym.main);
  const parent_scope = ParentScope.module(module, this.arenas);

  const r = this.cm().maybe_resolve_ident_in_module({ $: "Module", _0: module.to_module() }, ident, "ValueNS", parent_scope, undefined);
  if (r.$ !== "Ok") {
    return;
  }
  const name_binding = r._0;

  const res = name_binding.res();
  const is_import = name_binding.is_import();
  const span = name_binding.span;
  if (res.$ === "Def" && res._0.$ === "Fn") {
    this.record_use(ident, name_binding, "Other");
  }
  this.main_def = { res, is_import, span } as MainDefinition;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2685 with_owner
export function with_owner<R extends AsMutResolver, T>(this_: R, owner: NodeId, work: (this_: R) => T): T {
  const owners = this_.as_mut().owners;
  const tables = unwrap(owners.get(owner));
  owners.delete(owner);
  return with_owner_tables(this_, owner, tables, work);
}

// #[instrument(level = "debug", skip(this, work))]
// rustc: compiler/rustc_resolve/src/lib.rs:2695 with_owner_tables
export function with_owner_tables<R extends AsMutResolver, T>(this_: R, owner: NodeId, tables: PerOwnerResolverData, work: (this_: R) => T): T {
  // debug_assert!(!this.as_mut().owners.contains_key(&owner));
  const resolver = this_.as_mut();
  const old_owner = resolver.current_owner;
  resolver.current_owner = tables;
  const ret = work(this_);
  const resolver2 = this_.as_mut();
  const overwritten = resolver2.owners.has(owner);
  resolver2.owners.set(owner, resolver2.current_owner);
  resolver2.current_owner = old_owner;
  assert(!overwritten, "assertion failed: overwritten.is_none()");
  return ret;
}

// rustc: compiler/rustc_resolve/src/lib.rs:2712 build_extern_prelude
function build_extern_prelude(tcx: TyCtxt, attrs: readonly Attribute[]): Map<IdentKey, ExternPreludeEntry> {
  const extern_prelude = new KeyedMap<IdentKey, ExternPreludeEntry>(IdentKey_key);
  for (const [name, entry] of tcx.sess.opts.externs.iter()) {
    // Make sure `self`, `super`, `_` etc do not get into extern prelude.
    // FIXME: reject `--extern self` and similar in option parsing instead.
    if (entry.add_prelude) {
      const sym_ = Symbol.intern(name);
      if (Symbol.can_be_raw(sym_)) {
        extern_prelude.set(IdentKey.with_root_ctxt(sym_), ExternPreludeEntry.flag());
      }
    }
  }

  // Add open base entries for namespaced crates whose base segment
  // is missing from the prelude (e.g. `foo::bar` without `foo`).
  // These are necessary in order to resolve the open modules, whereas
  // the namespaced names are necessary in `extern_prelude` for actually
  // resolving the namespaced crates.
  const missing_open_bases: IdentKey[] = [];
  for (const ident of extern_prelude.keys()) {
    const s = Symbol.as_str(ident.name);
    const at = s.indexOf("::");
    if (at < 0) continue;
    const base = s.slice(0, at);
    const base_sym = Symbol.intern(base);
    if (!Symbol.can_be_raw(base_sym)) continue;
    const base_ident = IdentKey.with_root_ctxt(base_sym);
    if (!extern_prelude.has(base_ident)) missing_open_bases.push(base_ident);
  }

  for (const ident of missing_open_bases) extern_prelude.set(ident, ExternPreludeEntry.open_flag());

  // Inject `core` / `std` unless suppressed by attributes.
  if (!attr.contains_name(attrs, sym.no_core)) {
    extern_prelude.set(IdentKey.with_root_ctxt(sym.core), ExternPreludeEntry.flag());

    if (!attr.contains_name(attrs, sym.no_std)) {
      extern_prelude.set(IdentKey.with_root_ctxt(sym.std), ExternPreludeEntry.flag());
    }
  }

  return extern_prelude;
}

// rustc: compiler/rustc_resolve/src/lib.rs:2766 names_to_string
export function names_to_string(names: Iterable<Symbol>): string {
  let result = "";
  let i = -1;
  for (const name of names) {
    i++;
    if (name === kw.PathRoot) continue;
    if (i > 0) {
      result += "::";
    }
    if (Ident.with_dummy_span(name).is_raw_guess()) {
      result += "r#";
    }
    result += Symbol.as_str(name);
  }
  return result;
}

// rustc: compiler/rustc_resolve/src/lib.rs:2780 path_names_to_string
export function path_names_to_string(path: Path): string {
  return names_to_string(path.segments.map((seg) => seg.ident.name));
}

/// A somewhat inefficient routine to obtain the name of a module.
// rustc: compiler/rustc_resolve/src/lib.rs:2785 module_to_string
export function module_to_string(module: Module): string | undefined {
  const names: Symbol[] = [];
  while (module.parent !== undefined) {
    const parent = module.parent;
    names.push(module.name() ?? sym.opaque_module_name_placeholder);
    module = parent;
  }
  if (names.length === 0) {
    return undefined;
  }
  return names_to_string(names.reverse());
}

/// Invariant: if `Finalize` is used, expansion and import resolution must be complete.
export type Finalize = FinalizeT;
export const Finalize = gen.Finalize as typeof gen.Finalize & {
  new: (node_id: NodeId, path_span: Span) => Finalize;
  with_root_span: (node_id: NodeId, path_span: Span, root_span: Span) => Finalize;
};

// rustc: compiler/rustc_resolve/src/lib.rs:2842 new
Finalize.new = function (node_id: NodeId, path_span: Span): Finalize {
  return Finalize.with_root_span(node_id, path_span, path_span);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2846 with_root_span
Finalize.with_root_span = function (node_id: NodeId, path_span: Span, root_span: Span): Finalize {
  // `Finalize { node_id, path_span, root_span, .. }`: the declared defaults.
  const report_private = true;
  const used: Used = "Other";
  const stage: Stage = "Early";
  return new gen.Finalize(node_id, path_span, root_span, report_private, used, stage, undefined);
};

// rustc: compiler/rustc_resolve/src/lib.rs:2851 provide
export function provide(providers: QueryProviders): void {
  providers.registered_attr_tools = registered_attr_tools;
  providers.registered_lint_tools = registered_lint_tools;
}

/// A wrapper around `&mut Resolver` that may be mutable or immutable, depending on a conditions.
///
/// `Cm` stands for "conditionally mutable".
///
/// Prefer constructing it through `Resolver::cm(_mut)` to ensure correctness.
// PORT: `RefOrMut<'r, Resolver>` is erased to the `Resolver` itself (see `mod ref_mut`).
export type CmResolver = RefOrMut<Resolver>;

// ---- mod ref_mut ----------------------------------------------------------------------------------
// PORT: `RefOrMut<'a, T>` (`Ref(&T)` / `Mut(&mut T)`) is erased to `T`: the two variants only differ in
// `get_mut`'s panic on `Ref`, a borrow-discipline check that correct code never reaches, and TS has no
// shared/unique references to tell apart. `Resolver::cm()` / `cm_mut()` return the resolver (cm_mut keeps
// its speculative-flag assertion). Methods with `self: CmResolver` are ordinary `Resolver` methods.
// Likewise `CmRef` (a `Ref` guard or a plain reference) is the value itself, and `RefCell`'s dynamic
// borrow tracking is erased (`try_borrow_mut*` always succeed); the speculative-flag assertions of
// `CmCell` / `CmRefCell` are kept.

/// A reference type that conditionally allows mutable access.
export type RefOrMut<T> = T;
export const RefOrMut = {
  // impl<'a, T> Deref for RefOrMut<'a, T>
  // rustc: compiler/rustc_resolve/src/lib.rs:2879 deref
  deref<T>(self: RefOrMut<T>): T {
    return self;
  },

  // impl<'a, T> AsRef<T> for RefOrMut<'a, T>
  // rustc: compiler/rustc_resolve/src/lib.rs:2888 as_ref
  as_ref<T>(self: RefOrMut<T>): T {
    return RefOrMut.deref(self);
  },

  /// This is needed because the type may allow mutable access and is therefore not `Copy`.
  // rustc: compiler/rustc_resolve/src/lib.rs:2895 reborrow
  reborrow<T>(self: RefOrMut<T>): RefOrMut<T> {
    return self;
  },

  /// Returns a mutable reference to the inner value if allowed.
  ///
  /// # Panics
  ///
  /// Panics if the wrapped reference is immutable.
  // #[track_caller]
  // rustc: compiler/rustc_resolve/src/lib.rs:2908 get_mut
  get_mut<T>(self: RefOrMut<T>): T {
    return self;
  },
};

/// A wrapper around a [`Cell`] that only allows mutation based on a condition in the resolver.
// rustc-type: compiler/rustc_resolve/src/lib.rs:2918 CmCell
// PORT: a class (the cell has identity: it is shared by reference); `#[derive(Default)]` needs `T`'s
// default, so it is `CmCell.new(<default>)` at the use site.
export class CmCell<T> {
  constructor(public value: T) {}

  // rustc: compiler/rustc_resolve/src/lib.rs:2933 get
  get(): T {
    return this.value;
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:2937 update
  update(r: Resolver, f: (_0: T) => T): void {
    const old = this.get();
    this.set(f(old), r);
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:2948 new
  static new<T>(value: T): CmCell<T> {
    return new CmCell(value);
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:2952 set
  set(val: T, _: Resolver): void {
    this.value = val;
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:2956 set_checked
  set_checked(val: T, r: Resolver): void {
    assert(!r.speculative_flag.is_speculative(), "Cannot mutate `CmCell` during speculative resolution");
    this.value = val;
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:2964 into_inner
  into_inner(): T {
    return this.value;
  }
}

// impl<T: Copy + fmt::Debug> fmt::Debug for CmCell<T>
// rustc: compiler/rustc_resolve/src/lib.rs:2921 fmt
export function debug_CmCell<T>(v: CmCell<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_tuple(f, "CmCell", [debug_T(v.get(), f)]);
}

// impl<T: Copy> Clone for CmCell<T>
// rustc: compiler/rustc_resolve/src/lib.rs:2927 clone
export function clone_CmCell<T>(v: CmCell<T>): CmCell<T> {
  return CmCell.new(v.get());
}

/// PORT: `CmRef<'b, T>` (`Tracked(Ref<T>)` / `Untracked(&T)`) is the value itself (see above).
// rustc-type: compiler/rustc_resolve/src/lib.rs:2969 CmRef
export type CmRef<T> = T;
export const CmRef = {
  // impl<'b, T> Deref for CmRef<'b, T>
  // rustc: compiler/rustc_resolve/src/lib.rs:2979 deref
  deref<T>(self: CmRef<T>): T {
    return self;
  },
};

// mod speculative
// rustc-type: compiler/rustc_resolve/src/lib.rs:2989 SpeculativeFlag
export class SpeculativeFlag {
  constructor(public _0: boolean) {}

  /** `#[derive(Default)]` */
  static default(): SpeculativeFlag {
    return new SpeculativeFlag(false);
  }

  /// # SAFETY
  ///
  /// All borrows created by `CmRefCell::borrow` must be dropped before changing
  /// the speculative flag:
  /// - `tracked` borrows before setting it to `true`.
  /// - `untracked` borrows before setting it to `false`.
  // rustc: compiler/rustc_resolve/src/lib.rs:2998 set
  set(value: boolean): void {
    this._0 = value;
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:3002 is_speculative
  is_speculative(): boolean {
    return this._0;
  }
}
/** `#[derive(Debug)]` */
export const debug_SpeculativeFlag: Debug<SpeculativeFlag> = (v, f) => debug_tuple(f, "SpeculativeFlag", [`${v._0}`]);
/** `#[derive(Clone, Copy)]` */
export function clone_SpeculativeFlag(v: SpeculativeFlag): SpeculativeFlag {
  return new SpeculativeFlag(v._0);
}

/// A wrapper around a [`RefCell`] that only allows writes (mutable borrows) based on a condition in the resolver.
// rustc-type: compiler/rustc_resolve/src/lib.rs:3010 CmRefCell
// PORT: a class (shared by reference). A `RefMut<T>` is the cell itself viewed as a `MutRef<T>`:
// `*guard = v` is `guard.value = v`; `guard.push(..)` is `guard.value.push(..)`.
export class CmRefCell<T> {
  constructor(public value: T) {}

  // rustc: compiler/rustc_resolve/src/lib.rs:3013 new
  static new<T>(value: T): CmRefCell<T> {
    return new CmRefCell(value);
  }

  // #[track_caller]
  // rustc: compiler/rustc_resolve/src/lib.rs:3018 borrow_mut
  borrow_mut(r: Resolver): MutRef<T> {
    return unwrap_borrow(this.try_borrow_mut(r));
  }

  // #[track_caller]
  // rustc: compiler/rustc_resolve/src/lib.rs:3023 borrow_mut_checked
  borrow_mut_checked(r: Resolver): MutRef<T> {
    return unwrap_borrow(this.try_borrow_mut_checked(r));
  }

  // #[track_caller]
  // rustc: compiler/rustc_resolve/src/lib.rs:3031 try_borrow_mut_checked
  try_borrow_mut_checked(r: Resolver): Result<MutRef<T>, BorrowMutError> {
    assert(!r.speculative_flag.is_speculative(), "Cannot mutate `CmRefCell` state/value during speculative resolution");
    return Ok(this);
  }

  // #[track_caller]
  // rustc: compiler/rustc_resolve/src/lib.rs:3043 try_borrow_mut
  try_borrow_mut(_: Resolver): Result<MutRef<T>, BorrowMutError> {
    return Ok(this);
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:3050 borrow
  borrow(_: Resolver): T {
    return this.value;
  }

  // rustc: compiler/rustc_resolve/src/lib.rs:3054 borrow_checked
  borrow_checked(r: Resolver): CmRef<T> {
    if (r.speculative_flag.is_speculative()) {
      // `try_borrow_unguarded` is unsafe because it returns a `&T` instead
      // of `Ref<'_, T>`. It does provides an extra check to make sure no live
      // `RefMut`s are still alive, but the other way can not be checked, so:
      //
      // SAFETY: This is only safe because we know that every `Untracked` borrow
      // is only created during the import resolutions phase:
      //
      // ```rust
      // // tracked borrows
      // unsafe { resolver.speculative_flag.set_true() };
      // import_resolution(); // untracked borrows
      // unsafe { resolver.speculative_flag.set_true() };
      // // tracked borrows
      // ```
      //
      // `speculative::Flag` requires all of the borrows that happened during a
      // particular phase are dropped before being set to true/false.
      return this.value; // `CmRef::Untracked`
    } else {
      return this.value; // `CmRef::Tracked`
    }
  }

  // impl<T: Default> CmRefCell<T>
  // PORT: `T: Default` -> the default as a parameter.
  // rustc: compiler/rustc_resolve/src/lib.rs:3081 take
  take(r: Resolver, T_default: () => T): T {
    if (r.speculative_flag.is_speculative()) {
      panic("not allowed to mutate a CmRefCell during speculative resolution");
    }
    const v = this.value;
    this.value = T_default();
    return v;
  }
}

/** `std::cell::BorrowMutError` (never produced: borrow tracking is erased). */
export type BorrowMutError = { readonly $: "BorrowMutError" };
function unwrap_borrow<T>(r: Result<T, BorrowMutError>): T {
  if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value: BorrowMutError");
  return r._0;
}

// ---- mod hygiene ----------------------------------------------------------------------------------

/// A newtype around `SyntaxContext` that can only keep contexts produced by
/// [SyntaxContext::normalize_to_macros_2_0].
// rustc-type: compiler/rustc_resolve/src/lib.rs:3096 Macros20NormalizedSyntaxContext
// PORT: the branded `SyntaxContext` number (its `Deref` is the identity).
export type Macros20NormalizedSyntaxContext = SyntaxContext & { readonly __normalized: "macros_2_0" };
export const Macros20NormalizedSyntaxContext = {
  // #[inline]
  // rustc: compiler/rustc_resolve/src/lib.rs:3100 new
  new(ctxt: SyntaxContext): Macros20NormalizedSyntaxContext {
    return SyntaxContext.normalize_to_macros_2_0(ctxt) as Macros20NormalizedSyntaxContext;
  },

  // #[inline]
  // rustc: compiler/rustc_resolve/src/lib.rs:3105 new_adjusted
  new_adjusted(ctxt_: SyntaxContext, expn_id: ExpnId): [Macros20NormalizedSyntaxContext, ExpnId | undefined] {
    const ctxt: MutRef<SyntaxContext> = { value: ctxt_ };
    const def = SyntaxContext.normalize_to_macros_2_0_and_adjust(ctxt, expn_id);
    return [ctxt.value as Macros20NormalizedSyntaxContext, def];
  },

  // #[inline]
  // rustc: compiler/rustc_resolve/src/lib.rs:3114 new_unchecked
  new_unchecked(ctxt: SyntaxContext): Macros20NormalizedSyntaxContext {
    // debug_assert_eq!(ctxt, ctxt.normalize_to_macros_2_0());
    return ctxt as Macros20NormalizedSyntaxContext;
  },

  /// The passed closure must preserve the context's normalized-ness.
  // #[inline]
  // rustc: compiler/rustc_resolve/src/lib.rs:3121 update_unchecked
  update_unchecked<R>(self: MutRef<Macros20NormalizedSyntaxContext>, f: (ctxt: MutRef<SyntaxContext>) => R): R {
    const ret = f(self as MutRef<SyntaxContext>);
    // debug_assert_eq!(self.0, self.0.normalize_to_macros_2_0());
    return ret;
  },

  // impl std::ops::Deref for Macros20NormalizedSyntaxContext
  // rustc: compiler/rustc_resolve/src/lib.rs:3130 deref
  deref(self: Macros20NormalizedSyntaxContext): SyntaxContext {
    return self;
  },
};
/** `#[derive(Debug)]` */
export const debug_Macros20NormalizedSyntaxContext: Debug<Macros20NormalizedSyntaxContext> = (v, f) =>
  debug_tuple(f, "Macros20NormalizedSyntaxContext", [debug_SyntaxContext(v, f)]);
/** `#[derive(Clone, Copy)]` */
export function clone_Macros20NormalizedSyntaxContext(v: Macros20NormalizedSyntaxContext): Macros20NormalizedSyntaxContext {
  return v;
}
