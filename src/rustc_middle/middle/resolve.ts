//! This module contains types that carry name resolution results from `rustc_resolve` to a
//! consumer in another crate (e.g. AST lowering, metadata, or a query).
// Port of compiler/rustc_middle/src/middle/resolve.rs.
//
// PORT: hand-written types (not tools/codegen/types.ts): `Visibility<Id = LocalModId>` and `Res<Id = HirId>`
// are used with their default type arguments, which the type-map templates cannot express.
// - Map keys: `NodeMap`/`LocalDefIdMap`/`UnordMap`/`FxIndexMap` keyed by handles are JS `Map`s (insertion
//   order = IndexMap order). `DocLinkResMap` is keyed by a `(Symbol, Namespace)` tuple, so its JS map key is
//   `DocLinkResMap_key(..)` and the entry keeps the tuple (`[key, value]`).
// - `#[derive(Debug)]` of the structs holding `UnordMap`/`UnordSet`/`NodeMap` (FxHashMap/FxHashSet iteration
//   order: not reproducible until hashbrown + FxHasher are ported) calls `unported`.
// - `#[derive(Default)]` field defaults (`= Default::default()`) are spelled out in `PerOwnerResolverData.new`.
import type { AssocItem, Crate, ForeignItem, Item } from "../../rustc_ast/lib.ts";
import { debug_Crate, debug_AssocItemKind, debug_ForeignItemKind, debug_Item, debug_ItemKind } from "../../rustc_ast/lib.ts";
import { debug_NodeId, type NodeId } from "../../rustc_ast/node_id.ts";
import type { StrippedCfgItem } from "../../rustc_attr_ir/data_structures.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import type { LintBuffer } from "../../rustc_errors/lib.ts";
import { debug_Res, type DefKind, type Namespace, type PerNS, Res } from "../../rustc_hir/def.ts";
import type { PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { type CrateNum, debug_DefId, debug_LocalDefId, type DefId, type LocalDefId, type LocalModId, type ModId, debug_ModId } from "../../rustc_span/def_id.ts";
import type { ExpnId } from "../../rustc_span/hygiene.ts";
import { debug_ErrorGuaranteed, debug_Span, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { debug_Ident, type Ident, type Symbol } from "../../rustc_span/symbol.ts";
import { type Debug, type Fmt, debug_bool, debug_int, debug_struct, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import type { EffectiveVisibilities } from "./privacy.ts";
import { debug_Visibility, type Visibility } from "../ty/mod.ts";

/// The result of resolving a path before lowering to HIR,
/// with "module" segments resolved and associated item
/// segments deferred to type checking.
/// `base_res` is the resolution of the resolved part of the
/// path, `unresolved_segments` is the number of unresolved
/// segments.
///
/// ```text
/// module::Type::AssocX::AssocY::MethodOrAssocType
/// ^~~~~~~~~~~~  ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
/// base_res      unresolved_segments = 3
///
/// <T as Trait>::AssocX::AssocY::MethodOrAssocType
///       ^~~~~~~~~~~~~~  ^~~~~~~~~~~~~~~~~~~~~~~~~
///       base_res        unresolved_segments = 2
/// ```
export class PartialRes {
  private constructor(
    private readonly base_res_: Res<NodeId>,
    private readonly unresolved_segments_: number,
  ) {}

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:46 new
  static new(base_res: Res<NodeId>): PartialRes {
    return new PartialRes(base_res, 0);
  }

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:51 with_unresolved_segments
  static with_unresolved_segments(base_res: Res<NodeId>, unresolved_segments: number): PartialRes {
    if (base_res.$ === "Err") {
      unresolved_segments = 0;
    }
    if (unresolved_segments > 0xffff_ffff) panic("Path had 2^32 unresolved segments");
    return new PartialRes(base_res, unresolved_segments);
  }

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:61 base_res
  base_res(): Res<NodeId> {
    return this.base_res_;
  }

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:66 unresolved_segments
  unresolved_segments(): number {
    return this.unresolved_segments_;
  }

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:71 full_res
  full_res(): Res<NodeId> | undefined {
    return this.unresolved_segments_ === 0 ? this.base_res_ : undefined;
  }

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:76 expect_full_res
  expect_full_res(): Res<NodeId> {
    const r = this.full_res();
    if (r === undefined) panic("unexpected unresolved segments");
    return r;
  }

  /** `#[derive(Debug)]` */
  static debug(v: PartialRes, f: Fmt): string {
    return debug_struct(f, "PartialRes", [
      ["base_res", debug_Res(v.base_res_, f, debug_NodeId)],
      ["unresolved_segments", debug_int(v.unresolved_segments_, f)],
    ]);
  }
}
export const debug_PartialRes: Debug<PartialRes> = PartialRes.debug;

/// Resolution for a lifetime appearing in a type.
export type LifetimeRes =
  /// Successfully linked the lifetime to a generic parameter.
  | {
      readonly $: "Param";
      /// Id of the generic parameter that introduced it.
      readonly param: LocalDefId;
      /// Id of the introducing place. That can be:
      /// - an item's id, for the item's generic parameters;
      /// - a TraitRef's ref_id, identifying the `for<...>` binder;
      /// - a FnPtr type's id.
      ///
      /// This information is used for impl-trait lifetime captures, to know when to or not to
      /// capture any given lifetime.
      readonly binder: NodeId;
    }
  /// Created a generic parameter for an anonymous lifetime.
  | {
      readonly $: "Fresh";
      /// Id of the generic parameter that introduced it.
      ///
      /// Creating the associated `LocalDefId` is the responsibility of lowering.
      readonly param: NodeId;
      /// Kind of elided lifetime
      /** PORT: `rustc_hir::MissingLifetimeKind` (hir.rs, M3) is not ported yet. */
      readonly kind: unknown;
    }
  /// This variant is used for anonymous lifetimes that we did not resolve during
  /// late resolution. Those lifetimes will be inferred by typechecking.
  | { readonly $: "Infer" }
  /// `'static` lifetime.
  | { readonly $: "Static" }
  /// Resolution failure.
  | { readonly $: "Error"; readonly _0: ErrorGuaranteed }
  /// HACK: This is used to recover the NodeId of an elided lifetime.
  | { readonly $: "ElidedAnchor"; readonly start: NodeId; readonly end: NodeId };

/** `#[derive(Debug)]` */
export const debug_LifetimeRes: Debug<LifetimeRes> = (v, f) => {
  switch (v.$) {
    case "Param":
      return debug_struct(f, "Param", [
        ["param", debug_LocalDefId(v.param, f)],
        ["binder", debug_NodeId(v.binder, f)],
      ]);
    case "Fresh":
      return unported("Debug of rustc_hir::MissingLifetimeKind (LifetimeRes::Fresh; hir.rs, M3)");
    case "Infer":
    case "Static":
      return v.$;
    case "Error":
      return debug_tuple(f, "Error", [debug_ErrorGuaranteed(v._0, f)]);
    case "ElidedAnchor":
      return debug_struct(f, "ElidedAnchor", [
        ["start", debug_NodeId(v.start, f)],
        ["end", debug_NodeId(v.end, f)],
      ]);
  }
};

/// A simplified version of `ImportKind` from resolve.
/// `DefId`s here correspond to `use` and `extern crate` items themselves, not their targets.
export type Reexport =
  | { readonly $: "Single"; readonly _0: DefId }
  | { readonly $: "Glob"; readonly _0: DefId }
  | { readonly $: "ExternCrate"; readonly _0: DefId }
  | { readonly $: "MacroUse" }
  | { readonly $: "MacroExport" };

export const Reexport = {
  MacroUse: Object.freeze({ $: "MacroUse" as const }),
  MacroExport: Object.freeze({ $: "MacroExport" as const }),

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:129 id
  id(self: Reexport): DefId | undefined {
    switch (self.$) {
      case "Single":
      case "Glob":
      case "ExternCrate":
        return self._0;
      case "MacroUse":
      case "MacroExport":
        return undefined;
    }
  },
};

/** `#[derive(Debug)]` */
export const debug_Reexport: Debug<Reexport> = (v, f) => {
  switch (v.$) {
    case "Single":
    case "Glob":
    case "ExternCrate":
      return debug_tuple(f, v.$, [debug_DefId(v._0, f)]);
    case "MacroUse":
    case "MacroExport":
      return v.$;
  }
};

/// This structure is supposed to keep enough data to re-create `Decl`s for other crates
/// during name resolution. Right now the bindings are not recreated entirely precisely so we may
/// need to add more data in the future to correctly support macros 2.0, for example.
/// Module child can be either a proper item or a reexport (including private imports).
/// In case of reexport all the fields describe the reexport item itself, not what it refers to.
export interface ModChild {
  /// Name of the item.
  ident: Ident;
  /// Resolution result corresponding to the item.
  /// Local variables cannot be exported, so this `Res` doesn't need the ID parameter.
  res: Res<never>;
  /// Visibility of the item.
  vis: Visibility<ModId>;
  /// Reexport chain linking this module child to its original reexported item.
  /// Empty if the module child is a proper item.
  reexport_chain: Reexport[];
}

/** `#[derive(Debug)]` */
export const debug_ModChild: Debug<ModChild> = (v, f) =>
  debug_struct(f, "ModChild", [
    ["ident", debug_Ident(v.ident, f)],
    ["res", debug_Res(v.res, f, (x: never) => x)],
    ["vis", debug_Visibility(v.vis, f, debug_ModId)],
    ["reexport_chain", debug_vec(v.reexport_chain, f, debug_Reexport)],
  ]);

/// Same as `ModChild`, however, it includes ambiguity error.
export interface AmbigModChild {
  main: ModChild;
  second: ModChild;
}

/** `#[derive(Debug)]` */
export const debug_AmbigModChild: Debug<AmbigModChild> = (v, f) =>
  debug_struct(f, "AmbigModChild", [
    ["main", debug_ModChild(v.main, f)],
    ["second", debug_ModChild(v.second, f)],
  ]);

export interface ResolverGlobalCtxt {
  visibilities_for_hashing: [LocalDefId, Visibility][];
  /// Item with a given `LocalDefId` was defined during macro expansion with ID `ExpnId`.
  expn_that_defined: Map<LocalDefId, ExpnId>;
  effective_visibilities: EffectiveVisibilities;
  // FIXME: This table contains ADTs reachable from macro 2.0.
  // Currently, reachability of a definition from a macro is determined by nominal visibility
  // (see `compute_effective_visibilities`). This is incorrect and leads to the necessity
  // of traversing ADT fields in `rustc_privacy`. Remove this workaround once the
  // correct reachability logic is implemented for macros.
  macro_reachable_adts: Map<LocalDefId, Set<LocalDefId>>;
  extern_crate_map: Map<LocalDefId, CrateNum>;
  maybe_unused_trait_imports: Set<LocalDefId>;
  module_children: Map<LocalDefId, ModChild[]>;
  ambig_module_children: Map<LocalDefId, AmbigModChild[]>;
  glob_map: Map<LocalDefId, Set<Symbol>>;
  main_def: MainDefinition | undefined;
  /** PORT: `FxIndexMap<DefId, Vec<LocalDefId>>`: keyed by `DefId_hash_key(def_id)` (query/caches.ts), entry keeps the `DefId`. */
  trait_impls: Map<number, [DefId, LocalDefId[]]>;
  /// A list of proc macro LocalDefIds, written out in the order in which
  /// they are declared in the static array generated by proc_macro_harness.
  proc_macros: LocalDefId[];
  /// Path spans where the ident matches an associated type for an enclosing trait. Used to
  /// improve certain error messages.
  paths_matching_assoc_types: Set<Span>;
  /// Mapping from ident span to path span for paths that don't exist as written, but that
  /// exist under `std`. For example, wrote `str::from_utf8` instead of `std::str::from_utf8`.
  confused_type_with_std_module: Map<Span, Span>;
  doc_link_resolutions: Map<LocalModId, DocLinkResMap>;
  doc_link_traits_in_scope: Map<LocalModId, DefId[]>;
  all_macro_rules: Set<Symbol>;
  stripped_cfg_items: StrippedCfgItem[];
  // Information about delegations which is used when handling recursive delegations
  // and ensures easy access to delegation-only `LocalDefId`s.
  delegation_infos: Map<LocalDefId, DelegationInfo>;
  /** PORT: inner `FxIndexMap<Ident, ..>` keyed by `Ident` (name + span context): the resolver lane picks the key. */
  delegation_inherent_fn_map: Map<LocalDefId, Map<unknown, DelegationInherentFnKind>>;
}

/** `#[derive(Debug)]`: PORT: the `UnordMap`/`UnordSet` fields print in FxHash order (module comment). */
export const debug_ResolverGlobalCtxt: Debug<ResolverGlobalCtxt> = () =>
  unported("Debug of rustc_middle::middle::resolve::ResolverGlobalCtxt (UnordMap/UnordSet iteration order)");

export class PerOwnerResolverData {
  constructor(
    public node_id_to_def_id: Map<NodeId, LocalDefId>,
    /// Whether lifetime elision was successful.
    public lifetime_elision_allowed: boolean,
    /// Resolutions for labels. Maps from NodeId of the break/continue expression to the NodeId of
    /// their corresponding blocks or loops.
    public label_res_map: Map<NodeId, NodeId>,
    /// Resolutions for lifetimes.
    public lifetimes_res_map: Map<NodeId, LifetimeRes>,

    /** PORT: `&'tcx [TraitCandidate<'tcx>]`: `rustc_hir::TraitCandidate` (hir.rs, M3) is not ported yet. */
    public trait_map: Map<NodeId, readonly unknown[]>,

    /// Resolutions for import nodes, which have multiple resolutions in different namespaces.
    public import_res: Map<NodeId, PerNS<Res<NodeId> | undefined>>,
    /// Lifetime parameters that lowering will have to introduce.
    /** PORT: `MissingLifetimeKind` (hir.rs, M3) is `unknown`. */
    public extra_lifetime_params_map: Map<NodeId, [Ident, NodeId, unknown][]>,

    /// The id of the owner
    public id: NodeId,
    /// The `DefId` of the owner, can't be found in `node_id_to_def_id`.
    public def_id: LocalDefId,
  ) {}

  // rustc: compiler/rustc_middle/src/middle/resolve.rs:228 new
  static new(id: NodeId, def_id: LocalDefId): PerOwnerResolverData {
    // `PerOwnerResolverData { id, def_id, .. }`: the other fields take their declared defaults.
    return new PerOwnerResolverData(new Map(), false, new Map(), new Map(), new Map(), new Map(), new Map(), id, def_id);
  }

  /// Obtains resolution for a label with the given `NodeId`.
  // rustc: compiler/rustc_middle/src/middle/resolve.rs:233 get_label_res
  get_label_res(id: NodeId): NodeId | undefined {
    return this.label_res_map.get(id);
  }

  /// Obtains resolution for a lifetime with the given `NodeId`.
  // rustc: compiler/rustc_middle/src/middle/resolve.rs:238 get_lifetime_res
  get_lifetime_res(id: NodeId): LifetimeRes | undefined {
    return this.lifetimes_res_map.get(id);
  }

  /// Obtain the list of lifetimes parameters to add to an item.
  ///
  /// Extra lifetime parameters should only be added in places that can appear
  /// as a `binder` in `LifetimeRes`.
  ///
  /// The extra lifetimes that appear from the parenthesized `Fn`-trait desugaring
  /// should appear at the enclosing `PolyTraitRef`.
  // rustc: compiler/rustc_middle/src/middle/resolve.rs:249 extra_lifetime_params
  extra_lifetime_params(id: NodeId): readonly [Ident, NodeId, unknown][] {
    return this.extra_lifetime_params_map.get(id) ?? [];
  }
}

/** `#[derive(Debug)]`: PORT: `NodeMap` fields print in FxHash order (module comment). */
export const debug_PerOwnerResolverData: Debug<PerOwnerResolverData> = () =>
  unported("Debug of rustc_middle::middle::resolve::PerOwnerResolverData (NodeMap iteration order)");

/// Resolutions that should only be used for lowering.
/// This struct is meant to be consumed by lowering.
export interface ResolverAstLowering {
  /// Resolutions for nodes that have a single resolution.
  partial_res_map: Map<NodeId, PartialRes>;

  next_node_id: NodeId;

  owners: Map<NodeId, PerOwnerResolverData>;

  /// Lints that were emitted by the resolver and early lints.
  lint_buffer: Steal<LintBuffer>;

  disambiguators: Map<LocalDefId, Steal<PerParentDisambiguatorState>>;
}

/** `#[derive(Debug)]`: PORT: `NodeMap`/`LocalDefIdMap` fields print in FxHash order (module comment). */
export const debug_ResolverAstLowering: Debug<ResolverAstLowering> = () =>
  unported("Debug of rustc_middle::middle::resolve::ResolverAstLowering (NodeMap iteration order)");

export type DelegationResolution =
  /// Corresponds to paths that are fully resolved by resolver (i.e., `reuse Trait::foo`).
  | { readonly $: "Full"; readonly _0: DefId /* Signature and call path resolutions are the same */ }

  /// We can encounter cases like delegation to inherent impl function from trait impl,
  /// in this case we will have resolved signature id, but the call-path itself will
  /// not be resolved, so we will need to use type-relative resolution routine during
  /// AST -> HIR lowering.
  | { readonly $: "PartialCall"; readonly _0: DefId /* Signature resolution, call path is unresolved */ }

  /// Corresponds to paths that are partially resolved by resolver (i.e., `reuse Struct::foo`).
  | { readonly $: "Partial" }
  | { readonly $: "Error"; readonly _0: ErrorGuaranteed };

/** `#[derive(Debug)]` */
export const debug_DelegationResolution: Debug<DelegationResolution> = (v, f) => {
  switch (v.$) {
    case "Full":
    case "PartialCall":
      return debug_tuple(f, v.$, [debug_DefId(v._0, f)]);
    case "Partial":
      return "Partial";
    case "Error":
      return debug_tuple(f, "Error", [debug_ErrorGuaranteed(v._0, f)]);
  }
};

export interface DelegationInfo {
  // `DefId` (either the resolution at delegation.id or item_id in case of a trait impl) for signature resolution,
  // for details see https://github.com/rust-lang/rust/issues/118212#issuecomment-2160686914
  /// Refers to the next element in a delegation resolution chain.
  /// Usually points to the final resolution, as most "chains" are just
  /// one step to a trait or an impl.
  resolution: DelegationResolution;
}

/** `#[derive(Debug)]` */
export const debug_DelegationInfo: Debug<DelegationInfo> = (v, f) => debug_struct(f, "DelegationInfo", [["resolution", debug_DelegationResolution(v.resolution, f)]]);

// FIXME(fn_delegation): replace with `Result<DefId, ErrorGuaranteed>`.
export type TypeRelativeDelegationRes =
  | { readonly $: "Ok"; readonly _0: DefId }
  | { readonly $: "Ambig"; readonly _0: ErrorGuaranteed }
  | { readonly $: "Error"; readonly _0: ErrorGuaranteed };

/** `#[derive(Debug)]` */
export const debug_TypeRelativeDelegationRes: Debug<TypeRelativeDelegationRes> = (v, f) =>
  v.$ === "Ok" ? debug_tuple(f, "Ok", [debug_DefId(v._0, f)]) : debug_tuple(f, v.$, [debug_ErrorGuaranteed(v._0, f)]);

export type DelegationInherentFnKind = { readonly $: "Single"; readonly _0: LocalDefId } | { readonly $: "Ambig" };

/** `#[derive(Debug)]` */
export const debug_DelegationInherentFnKind: Debug<DelegationInherentFnKind> = (v, f) =>
  v.$ === "Single" ? debug_tuple(f, "Single", [debug_LocalDefId(v._0, f)]) : "Ambig";

export interface MainDefinition {
  res: Res<NodeId>;
  is_import: boolean;
  span: Span;
}

export const MainDefinition = {
  // rustc: compiler/rustc_middle/src/middle/resolve.rs:320 opt_fn_def_id
  opt_fn_def_id(self: MainDefinition): DefId | undefined {
    const res = self.res;
    if (res.$ === "Def" && (res._0 as DefKind).$ === "Fn") {
      return res._1;
    } else {
      return undefined;
    }
  },
};

/** `#[derive(Debug)]` */
export const debug_MainDefinition: Debug<MainDefinition> = (v, f) =>
  debug_struct(f, "MainDefinition", [
    ["res", debug_Res(v.res, f, debug_NodeId)],
    ["is_import", debug_bool(v.is_import, f)],
    ["span", debug_Span(v.span, f)],
  ]);

// FxIndexMap is necessary because its data ends up in .rmeta files,
// so its iteration order must be consistent. See #159677 for context.
/** PORT: `FxIndexMap<(Symbol, Namespace), Option<Res<NodeId>>>`, keyed by `DocLinkResMap_key` (module comment). */
export type DocLinkResMap = Map<string, [[Symbol, Namespace], Res<NodeId> | undefined]>;
export function DocLinkResMap_key(key: readonly [Symbol, Namespace]): string {
  return `${key[0]}:${key[1]}`;
}
/** Debug of `FxIndexMap` (insertion order): `{(sym, ns): res, ..}` */
export const debug_DocLinkResMap: Debug<DocLinkResMap> = () =>
  unported("Debug of rustc_middle::middle::resolve::DocLinkResMap (pulldown-cmark doc links, wave 12)");

/// Fragment of the AST according to "HIR owner" semantics.
///
/// This is used to map each `LocalDefId` to its content's AST.
///
/// This type isn't produced by name resolution but it is paired with `ResolverAstLowering` so this
/// is as good a place as any for it.
export type AstOwner =
  | { readonly $: "Crate"; readonly _0: Crate }
  | { readonly $: "Item"; readonly _0: Item }
  | { readonly $: "TraitItem"; readonly _0: AssocItem }
  | { readonly $: "ImplItem"; readonly _0: AssocItem }
  | { readonly $: "ForeignItem"; readonly _0: ForeignItem };

/** `#[derive(Debug)]` */
export const debug_AstOwner: Debug<AstOwner> = (v, f) => {
  switch (v.$) {
    case "Crate":
      return debug_tuple(f, "Crate", [debug_Crate(v._0, f)]);
    case "Item":
      return debug_tuple(f, "Item", [debug_Item(v._0, f, debug_ItemKind)]);
    case "TraitItem":
    case "ImplItem":
      return debug_tuple(f, v.$, [debug_Item(v._0, f, debug_AssocItemKind)]);
    case "ForeignItem":
      return debug_tuple(f, "ForeignItem", [debug_Item(v._0, f, debug_ForeignItemKind)]);
  }
};

