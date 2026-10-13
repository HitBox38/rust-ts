// The rustc_resolve contract: the classes whose `impl` blocks are spread over several upstream files
// (`Resolver`, `DefCollector`, `LateResolutionVisitor`), and one declaration of every method of every
// shared type, from all rustc_resolve files. Grouped by upstream file in upstream order; each method
// carries `// <file>:<line>` (the line of its `fn` keyword at the pin). The bodies are assigned onto
// the prototypes by the file that ports them (PORTING §5 "Methods defined in another file").
//
// Contract rules (see docs/handoff/res-lib.md):
// - Ownership: lane res-lib wrote this file; afterwards root owns it. A lane that needs a missing or
//   changed declaration writes it in its handoff (signature + reason); if it cannot type-check
//   without it, it may add a local `declare module "./decls.ts"` augmentation in its own file marked
//   `// PORT(decls): pending root`.
// - Signatures (PORTING §5): `&self`/`&mut self`/`self: CmResolver`/`self: Decl` -> `this`;
//   `&T`/`&mut T`/`Box`/`Interned`/`&'ra Arc<T>` -> `T`; `&[T]` -> `readonly T[]`; `Vec`/`ThinVec`/
//   `SmallVec` -> `T[]`; `Option<T>` -> `T | undefined`; `()` returns -> `void`; tuples -> arrays;
//   `&mut` of a value the callee overwrites as a whole (`&mut SyntaxContext`, `&mut String`,
//   `&mut Macros20NormalizedSyntaxContext`) -> `MutRef<T>`; closures -> `(this_: Owner, _1: A, ..) => R`
//   (`_n` = argument position); `R: AsRef<Resolver>` / `AsMut<Resolver>` -> `R extends AsRefResolver`
//   / `AsMutResolver`; `impl Iterator<Item = T>` -> `Iterable<T>`. Parameter names that are JS
//   reserved words get a trailing `_` (`import_`).
// - Associated fns without `self` are statics on the owning class's companion in the owning file's
//   hand module (`Resolver.new` / `Resolver.arenas` are declared here, assigned in lib.ts); they are
//   listed here as comments for completeness.
// - Trait impls on the classes: `Visitor` methods are inherited from rustc_ast's `Visitor` base class
//   and only listed as comments (`(Visitor<'ast>)`); the owning file overrides them on the prototype.
//   `AsRef`/`AsMut` are real methods. `Debug`/`Deref` impls are `debug_<T>` / companion fns.
// - Fields whose name is also a method name get a trailing `_` (`tcx_`, `next_node_id_`, ...;
//   see the Resolver class).
// - Maps keyed by a struct compared by value (`DefId`, `Ident`, `IdentKey`, `BindingKey`) are
//   `KeyedMap`/`KeyedSet` (src/rust_ts/keyed.ts) built with the key fns of lib.ts (`DefId_key`,
//   `Ident_key`, `IdentKey_key`, `BindingKey_key`); their declared type stays `Map`/`Set`.
//
// Init order (a TDZ ReferenceError at load otherwise): this module imports only types, the
// generated `.gen.ts` modules (type-only), and rustc_ast/lib.ts (for `Visitor`). It must never import a
// rustc_resolve hand module at runtime. lib.ts (the crate root) imports this file first, then every
// extension file, then attaches lib.rs's own methods.

import type {
  AnonConst,
  Arm,
  AssocItem,
  AssocItemKind,
  Attribute,
  BindingMode,
  Block,
  Crate,
  Delegation,
  EiiImpl,
  Expr,
  ExprField,
  FieldDef,
  FnDecl,
  FnRetTy,
  ForeignItem,
  GenericParam,
  Generics,
  Item,
  Label,
  Lifetime,
  Local,
  MacroDef,
  NodeId,
  Param,
  Pat,
  PatFieldsRest,
  Path,
  PathSegment,
  QSelf,
  RestrictionKind,
  TestBinderConstraints,
  TraitImplHeader,
  TraitRef,
  Ty,
  UseTree,
  UseTreeAndId,
  Variant,
  Visibility as AstVisibility,
} from "../rustc_ast/lib.ts";
import { visit } from "../rustc_ast/lib.ts";
import type { AssocCtxt, LifetimeCtxt } from "../rustc_ast/visit.ts";
import type { CfgEntry } from "../rustc_ast/attr/data_structures.ts";
import type { ControlFlow } from "../rustc_ast_ir/visit.ts";
import type { Directive } from "../rustc_attr_ir/diagnostic.ts";
import type { StrippedCfgItem } from "../rustc_attr_ir/data_structures.ts";
import type { Attribute as AttrIrAttribute } from "../rustc_attr_ir/lib.ts";
import type { Applicability, BufferedEarlyLint, Diag, DiagCtxtHandle, LintBuffer } from "../rustc_errors/lib.ts";
import type { DeriveResolution, Indeterminate, SyntaxExtension, SyntaxExtensionKind } from "../rustc_expand/base.ts";
import type { AstFragment, Invocation, SupportsMacroExpansion } from "../rustc_expand/expand.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import type { CtorKind, DefKind, MacroKinds, Namespace, PerNS } from "../rustc_hir/def.ts";
import type { PerParentDisambiguatorState } from "../rustc_hir_id/definitions.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.ts";
import type { EffectiveVisibilities, EffectiveVisibility } from "../rustc_middle/middle/privacy.ts";
import type {
  AmbigModChild,
  DelegationInfo,
  DelegationInherentFnKind,
  DocLinkResMap,
  LifetimeRes,
  MainDefinition,
  ModChild,
  PartialRes,
  PerOwnerResolverData,
  Reexport,
} from "../rustc_middle/middle/resolve.ts";
import type { TyCtxt, TyCtxtFeed } from "../rustc_middle/ty/context.ts";
import type { Visibility } from "../rustc_middle/ty/mod.ts";
import type { CrateNum, DefId, LocalDefId, LocalModId, ModId } from "../rustc_span/def_id.ts";
import type { Edition } from "../rustc_span/edition.ts";
import type { AstPass, ExpnId, LocalExpnId, MacroKind, SyntaxContext } from "../rustc_span/hygiene.ts";
import type { ErrorGuaranteed, PathBuf, Span, Spanned } from "../rustc_span/lib.ts";
import type { Ident, Symbol } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { Result } from "../std/result.ts";
import type { UnusedImportCheckVisitor } from "./check_unused.ts";
import type { UnusedImport } from "./check_unused.gen.ts";
import type { Ambiguity } from "./diagnostics/mod.gen.ts";
import type { BindingVisitor, UsePlacementFinder } from "./diagnostics/impls.ts";
import type { ImportSuggestion, LabelSuggestion, OnUnknownData, StructCtor, Suggestion, TypoSuggestion } from "./diagnostics/impls.gen.ts";
import type { EffectiveVisibilitiesVisitor } from "./effective_visibilities.ts";
import type { ParentId } from "./effective_visibilities.gen.ts";
import type { Shadowing, UsePrelude } from "./ident.gen.ts";
import type {
  Import,
  ImportData,
  ImportKind,
  ImportResolution,
  ImportResolutionKind,
  NameResolution,
  NameResolutionRef,
  UnresolvedImportError,
} from "./imports.gen.ts";
import type { ItemInfoCollector } from "./late.ts";
import type {
  AnonConstKind,
  BindingInfo,
  ConstantHasGenerics,
  ConstantItemKind,
  ConstantRequiresType,
  DiagMetadata,
  IsNeverPattern,
  IsRepeatExpr,
  LifetimeBinderKind,
  LifetimeRib,
  LifetimeRibKind,
  LifetimeUseSet,
  MaybeExported,
  NoConstantGenericsReason,
  PathSource,
  PatternBindings,
  PatternSource,
  RecordPartialRes,
  Rib,
  RibKind,
  UnnecessaryQualification,
} from "./late.gen.ts";
import type { LifetimeFinder, ParentPathVisitor, RefPrefixSpanFinder } from "./late/diagnostics.ts";
import type {
  AssocSuggestion,
  BaseError,
  ElisionFnParameter,
  LifetimeElisionCandidate,
  MissingLifetime,
  TypoCandidate,
} from "./late/diagnostics.gen.ts";
import type {
  AsMutResolver,
  AsRefResolver,
  CmRefCell,
  CmResolver,
  CStore,
  DelayedVisResolutionError,
  DenseBitSet,
  ExternModule,
  LocalModule,
  Macros20NormalizedSyntaxContext,
  Module,
  Range,
  Res,
  ResolverArenas,
  Set1,
  SpeculativeFlag,
  TraitCandidate,
} from "./lib.ts";
import type {
  AmbiguityError,
  BindingKey,
  Decl,
  DeclData,
  DeclKind,
  DelegationFnSig,
  DeriveData,
  Determinacy,
  ExternPreludeEntry,
  Finalize,
  IdentKey,
  ImplTraitContext,
  ImportSummary,
  InvocationParent,
  LateDecl,
  ModuleData,
  ModuleKind,
  ModuleOrUniformRoot,
  ParentScope,
  PathResult,
  PrivacyError,
  ResolutionError,
  ResolutionTable,
  ResolverOutputs,
  Scope,
  ScopeSet,
  Segment,
  UseError,
  Used,
  VisResolutionError,
} from "./lib.gen.ts";
import type { MacroRulesScopeRef } from "./macros.ts";

/** PORT: `rustc_hir::MissingLifetimeKind` (hir.rs, M3) is not ported (typemap.middle.json: `unknown`). */
type MissingLifetimeKind = unknown;


/// The main resolver class.
///
/// This is the visitor that walks the whole crate.
// rustc-type: compiler/rustc_resolve/src/lib.rs:1358 Resolver
// PORT: the struct's default field values (`= ..`) are written out in `Resolver.new` (lib.ts).
export class Resolver {
  constructor(
    // PORT: `tcx_` (also a method `tcx()`)
    public tcx_: TyCtxt,

    /// Item with a given `LocalDefId` was defined during macro expansion with ID `ExpnId`.
    public expn_that_defined: Map<LocalDefId, ExpnId>,

    public graph_root: LocalModule,

    /// Assert that we are in speculative resolution mode (unsafe field).
    public speculative_flag: SpeculativeFlag,

    public prelude: Module | undefined,
    /** `FxIndexMap<IdentKey, ..>`: a `KeyedMap` (IdentKey_key) */
    public extern_prelude: Map<IdentKey, ExternPreludeEntry>,

    /// N.B., this is used only for better diagnostics, not name resolution itself.
    public field_names: Map<LocalDefId, Ident[]>,
    // PORT: `field_defaults_` (also a method `field_defaults()`)
    public field_defaults_: Map<LocalDefId, Symbol[]>,

    /// Span of the privacy modifier in fields of an item `DefId` accessible with dot syntax.
    /// Used for hints during error reporting.
    /** `FxHashMap<DefId, ..>`: a `KeyedMap` (DefId_key) */
    public field_visibility_spans: Map<DefId, Span[]>,

    /// All imports known to succeed or fail.
    public determined_imports: Import[],

    /// All non-determined imports.
    public indeterminate_imports: [Import, ImportResolution | undefined, number][],

    // Spans for local variables found during pattern resolution.
    // Used for suggestions during error reporting.
    public pat_span_map: Map<NodeId, Span>,

    /// Resolutions for nodes that have a single resolution.
    public partial_res_map: Map<NodeId, PartialRes>,
    /// An import will be inserted into this map if it has been used.
    public import_use_map: Map<Import, Used>,

    /// `CrateNum` resolutions of `extern crate` items.
    public extern_crate_map: Map<LocalDefId, CrateNum>,
    public module_children: Map<LocalDefId, ModChild[]>,
    public ambig_module_children: Map<LocalDefId, AmbigModChild[]>,

    /// A map from nodes to anonymous modules.
    /// Anonymous modules are pseudo-modules that are implicitly created around items
    /// contained within blocks.
    ///
    /// For example, if we have this:
    ///
    ///  fn f() {
    ///      fn g() {
    ///          ...
    ///      }
    ///  }
    ///
    /// There will be an anonymous module created around `g` with the ID of the
    /// entry block for `f`.
    public block_map: Map<NodeId, LocalModule>,
    /// A fake module that contains no definition and no prelude. Used so that
    /// some AST passes can generate identifiers that only resolve to local or
    /// lang items.
    public empty_module: LocalModule,
    /// All local modules, including blocks.
    public local_modules: LocalModule[],
    /// Eagerly populated map of all local non-block modules.
    public local_module_map: Map<LocalDefId, LocalModule>,
    /// Lazily populated cache of modules loaded from external crates.
    /** `RwLock<FxIndexMap<DefId, ..>>`: a `KeyedMap` (DefId_key) */
    public extern_module_map: Map<DefId, ExternModule>,

    /// Maps glob imports to the names of items actually imported.
    public glob_map: Map<LocalDefId, Set<Symbol>>,
    public glob_error: ErrorGuaranteed | undefined,
    public visibilities_for_hashing: [LocalDefId, Visibility][],
    public used_imports: Set<NodeId>,
    public maybe_unused_trait_imports: Set<LocalDefId>,

    /// Privacy errors are delayed until the end in order to deduplicate them.
    public privacy_errors: PrivacyError[],
    /// Ambiguity errors are delayed for deduplication.
    public ambiguity_errors: AmbiguityError[],
    public issue_145575_hack_applied: boolean,
    /// Visibility path resolution failures are delayed until all modules are collected.
    public delayed_vis_resolution_errors: DelayedVisResolutionError[],
    /// Crate-local macro expanded `macro_export` referred to by a module-relative path.
    /** PORT: `BTreeSet<(OrdSpan, OrdSpan)>`: a `KeyedSet` (`${lo}:${hi}` pairs, OrdSpan_pair_key); its users iterate it sorted by `OrdSpan` order (BTreeSet order). */
    public macro_expanded_macro_export_errors: Set<[Span, Span]>,

    public arenas: ResolverArenas,
    public dummy_decl: Decl,
    public builtin_type_decls: Map<Symbol, Decl>,
    public builtin_attr_decls: Map<Symbol, Decl>,
    /** `FxHashMap<IdentKey, ..>`: a `KeyedMap` (IdentKey_key) */
    public registered_attr_tool_decls: Map<IdentKey, Decl>,
    /** `FxHashSet<IdentKey>`: a `KeyedSet` (IdentKey_key) */
    public macro_names: Set<IdentKey>,
    public builtin_macros: Map<Symbol, SyntaxExtensionKind>,
    // PORT: `registered_attr_tools_` / `registered_lint_tools_` (also ResolverExpand methods)
    public registered_attr_tools_: RegisteredTools,
    public registered_lint_tools_: RegisteredTools,
    public macro_use_prelude: Map<Symbol, Decl>,
    /// Eagerly populated map of all local macro definitions.
    public local_macro_map: Map<LocalDefId, SyntaxExtension>,
    /// Lazily populated cache of macro definitions loaded from external crates.
    /** `RwLock<FxHashMap<DefId, ..>>`: a `KeyedMap` (DefId_key) */
    public extern_macro_map: Map<DefId, SyntaxExtension>,
    public dummy_ext_bang: SyntaxExtension,
    public dummy_ext_derive: SyntaxExtension,
    public non_macro_attr: SyntaxExtension,
    public local_macro_def_scopes: Map<LocalDefId, LocalModule>,
    public ast_transform_scopes: Map<LocalExpnId, LocalModule>,
    public unused_macros: Map<LocalDefId, [NodeId, Ident]>,
    /// A map from the macro to all its potentially unused arms and the `LocalDefId` of the macro itself.
    public unused_macro_rules: Map<NodeId, [LocalDefId, DenseBitSet<number>]>,
    public proc_macro_stubs: Set<LocalDefId>,
    /// Traces collected during macro resolution and validated when it's complete.
    public single_segment_macro_resolutions: CmRefCell<[Ident, MacroKind, ParentScope, Decl | undefined, Span | undefined][]>,
    public multi_segment_macro_resolutions: CmRefCell<[Segment[], Span, MacroKind, ParentScope, Res | undefined, Namespace][]>,
    public builtin_attrs: [Ident, ParentScope][],
    /// `derive(Copy)` marks items they are applied to so they are treated specially later.
    /// Derive macros cannot modify the item themselves and have to store the markers in the global
    /// context, so they attach the markers to derive container IDs using this resolver table.
    public containers_deriving_copy: Set<LocalExpnId>,
    public containers_deriving_ord: Set<LocalExpnId>,
    /// Parent scopes in which the macros were invoked.
    /// FIXME: `derives` are missing in these parent scopes and need to be taken from elsewhere.
    public invocation_parent_scopes: Map<LocalExpnId, ParentScope>,
    /// `macro_rules` scopes *produced* by expanding the macro invocations,
    /// include all the `macro_rules` items and other invocations generated by them.
    public output_macro_rules_scopes: Map<LocalExpnId, MacroRulesScopeRef>,
    /// `macro_rules` scopes produced by `macro_rules` item definitions.
    public macro_rules_scopes: Map<LocalDefId, MacroRulesScopeRef>,
    /// Helper attributes that are in scope for the given expansion.
    public helper_attrs: Map<LocalExpnId, [IdentKey, Span, Decl][]>,
    /// Ready or in-progress results of resolving paths inside the `#[derive(...)]` attribute
    /// with the given `ExpnId`.
    public derive_data: Map<LocalExpnId, DeriveData>,

    /// Avoid duplicated errors for "name already defined".
    public name_already_seen: Map<Symbol, Span>,

    public potentially_unused_imports: Import[],

    public potentially_unnecessary_qualifications: UnnecessaryQualification[],

    /// Table for mapping struct IDs into struct constructor IDs,
    /// it's not used during normal resolution, only for better error reporting.
    /// Also includes of list of each fields visibility
    public struct_ctors: Map<LocalDefId, StructCtor>,

    /// for all the struct
    /// it's not used during normal resolution, only for better error reporting.
    public struct_generics: Map<LocalDefId, Generics>,

    // PORT: `lint_buffer_` (also a method `lint_buffer()`)
    public lint_buffer_: LintBuffer,

    // PORT: `next_node_id_` (also a method `next_node_id()`)
    public next_node_id_: NodeId,

    /// Preserves per owner data once the owner is finished resolving.
    public owners: Map<NodeId, PerOwnerResolverData>,

    /// An entry of `owners` that gets taken out and reinserted whenever an owner is handled.
    public current_owner: PerOwnerResolverData,

    public disambiguators: Map<LocalDefId, PerParentDisambiguatorState>,

    /// Indices of unnamed struct or variant fields with unresolved attributes.
    public placeholder_field_indices: Map<NodeId, number>,
    /// When collecting definitions from an AST fragment produced by a macro invocation `ExpnId`
    /// we know what parent node that fragment should be attached to thanks to this table,
    /// and how the `impl Trait` fragments were introduced.
    public invocation_parents: Map<LocalExpnId, InvocationParent>,

    /// Amount of lifetime parameters for each item in the crate.
    // PORT: `item_generics_num_lifetimes_` (also a method `item_generics_num_lifetimes()`)
    public item_generics_num_lifetimes_: Map<LocalDefId, number>,
    /// Generic args to suggest for required params (e.g. `<'_>`, `<_, _>`), if any.
    public item_required_generic_args_suggestions: Map<LocalDefId, string>,
    public delegation_fn_sigs: Map<LocalDefId, DelegationFnSig>,
    public delegation_infos: Map<LocalDefId, DelegationInfo>,
    /** inner `FxIndexMap<Ident, ..>`: a `KeyedMap` (Ident_key) */
    public delegation_inherent_fn_map: Map<LocalDefId, Map<Ident, DelegationInherentFnKind>>,

    public main_def: MainDefinition | undefined,
    /** `FxIndexMap<DefId, ..>`: a `KeyedMap` (DefId_key) */
    public trait_impls: Map<DefId, LocalDefId[]>,
    /// A list of proc macro LocalDefIds, written out in the order in which
    /// they are declared in the static array generated by proc_macro_harness.
    public proc_macros: LocalDefId[],
    public paths_matching_assoc_types: Set<Span>,
    public confused_type_with_std_module: Map<Span, Span>,

    /// Names of items that were stripped out via cfg with their corresponding cfg meta item.
    public stripped_cfg_items: StrippedCfgItem<NodeId>[],

    public effective_visibilities: EffectiveVisibilities,
    public macro_reachable_adts: Map<LocalDefId, Set<LocalDefId>>,

    public doc_link_resolutions: Map<LocalModId, DocLinkResMap>,
    public doc_link_traits_in_scope: Map<LocalModId, DefId[]>,
    public all_macro_rules: Set<Symbol>,

    /// Invocation ids of all glob delegations.
    public glob_delegation_invoc_ids: Set<LocalExpnId>,
    /// Analogue of module `unexpanded_invocations` but in trait impls, excluding glob delegations.
    /// Needed because glob delegations wait for all other neighboring macros to expand.
    public impl_unexpanded_invocations: Map<LocalDefId, Set<LocalExpnId>>,
    /// Simplified analogue of module `resolutions` but in trait impls, excluding glob delegations.
    /// Needed because glob delegations exclude explicitly defined names.
    /** inner `FxHashSet<BindingKey>`: a `KeyedSet` (BindingKey_key) */
    public impl_binding_keys: Map<LocalDefId, Set<BindingKey>>,

    /// This is the `Span` where an `extern crate foo;` suggestion would be inserted, if `foo`
    /// could be a crate that wasn't imported. For diagnostics use only.
    public current_crate_outer_attr_insert_span: Span,

    /** `FxHashSet<DefId>`: a `KeyedSet` (DefId_key) */
    public mods_with_parse_errors: Set<DefId>,

    /// Whether `Resolver::register_macros_for_all_crates` has been called once already, as we
    /// don't need to run it more than once.
    public all_crate_macros_already_registered: boolean,

    // Stores pre-expansion and pre-placeholder-fragment-insertion names for `impl Trait` types
    // that were encountered during resolution. These names are used to generate item names
    // for APITs, so we don't want to leak details of resolution into these names.
    public impl_trait_names: Map<NodeId, Symbol>,

    /// When enabled, after reporting every error we will `FatalError.raise()` to avoid advancing
    /// to the next compiler stage. Only used when encountering resolution errors that cause lots of
    /// unnecessary knock down errors.
    public raise_fatal_after_resolve: boolean,

    /// Stores `#[diagnostic::on_unknown]` attributes placed on module declarations.
    // PORT: `on_unknown_data_` (also a method `on_unknown_data()`)
    public on_unknown_data_: Map<LocalDefId, OnUnknownData>,
    public features: Features,
  ) {}

  // lib.rs:1803 new (assigned in lib.ts)
  declare static new: (
    tcx: TyCtxt,
    attrs: readonly Attribute[],
    crate_span: Span,
    current_crate_outer_attr_insert_span: Span,
    arenas: ResolverArenas,
  ) => Resolver;
  // lib.rs:1954 arenas (assigned in lib.ts)
  declare static arenas: () => ResolverArenas;
}

export interface Resolver {
  // ---- compiler/rustc_resolve/src/lib.rs ----
  // lib.rs:1653 (AsMut<Resolver<'ra,'tcx>>)
  as_mut(): Resolver;
  // lib.rs:1659 (AsRef<Resolver<'ra,'tcx>>)
  as_ref(): Resolver;
  // lib.rs:1668
  owner_def_id(owner: NodeId): LocalDefId;
  // lib.rs:1675
  child_def_id(owner: NodeId, id: NodeId): LocalDefId;
  // lib.rs:1680
  opt_local_def_id(node: NodeId): LocalDefId | undefined;
  // lib.rs:1685
  local_def_id(node: NodeId): LocalDefId;
  // lib.rs:1695
  create_def(parent: LocalDefId, node_id: NodeId, name: Symbol | undefined, def_kind: DefKind, expn_id: ExpnId, span: Span, is_owner: boolean): TyCtxtFeed<LocalDefId>;
  // lib.rs:1743
  item_generics_num_lifetimes(def_id: DefId): number;
  // lib.rs:1751
  item_required_generic_args_suggestion(def_id: DefId): string;
  // lib.rs:1777
  tcx(): TyCtxt;
  // lib.rs:1787
  def_id_to_node_id(def_id: LocalDefId): NodeId;
  // lib.rs:1803 (static: see the hand module)
  // new(tcx: TyCtxt, attrs: readonly Attribute[], crate_span: Span, current_crate_outer_attr_insert_span: Span, arenas: ResolverArenas): Resolver;
  // lib.rs:1917
  new_local_module(parent: LocalModule | undefined, kind: ModuleKind, expn_id: ExpnId, span: Span, no_implicit_prelude: boolean): LocalModule;
  // lib.rs:1936
  next_node_id(): NodeId;
  // lib.rs:1943
  next_node_ids(count: number): Range<NodeId>;
  // lib.rs:1950
  lint_buffer(): LintBuffer;
  // lib.rs:1954 (static: see the hand module)
  // arenas(): ResolverArenas;
  // lib.rs:1958
  feed_visibility(feed: TyCtxtFeed<LocalDefId>, vis: Visibility): void;
  // lib.rs:1963
  into_outputs(): ResolverOutputs;
  // lib.rs:2020
  cstore(): CStore;
  // lib.rs:2024
  cstore_mut(): CStore;
  // lib.rs:2028
  dummy_ext(macro_kind: MacroKind): SyntaxExtension;
  // lib.rs:2037
  cm(): CmResolver;
  // lib.rs:2043
  cm_mut(): CmResolver;
  // lib.rs:2052
  per_ns(f: ((this_: Resolver, _1: Namespace) => void)): void;
  // lib.rs:2058
  per_ns_mut(f: ((this_: Resolver, _1: Namespace) => void)): void;
  // lib.rs:2064
  is_builtin_macro(res: Res): boolean;
  // lib.rs:2068
  is_specific_builtin_macro(res: Res, symbol: Symbol): boolean;
  // lib.rs:2072
  macro_def(ctxt: SyntaxContext): DefId;
  // lib.rs:2082
  resolve_crate(krate: Crate): void;
  // lib.rs:2111
  traits_in_scope(current_trait: Module | undefined, parent_scope: ParentScope, sp: Span, assoc_item: [Symbol, Namespace] | undefined): readonly TraitCandidate[];
  // lib.rs:2159
  traits_in_module(module: Module, assoc_item: [Symbol, Namespace] | undefined, found_traits: TraitCandidate[]): void;
  // lib.rs:2183
  trait_may_have_item(trait_module: Module | undefined, assoc_item: [Symbol, Namespace] | undefined): boolean;
  // lib.rs:2197
  find_transitive_imports(kind: DeclKind, trait_name: Symbol): readonly LocalDefId[];
  // lib.rs:2215
  resolutions(module: Module): ResolutionTable;
  // lib.rs:2230
  resolutions_mut(module: Module): ResolutionTable;
  // lib.rs:2241
  resolution(module: Module, key: BindingKey): NameResolution | undefined;
  // lib.rs:2250
  resolution_or_default(module: Module, key: BindingKey, orig_ident_span: Span): NameResolutionRef;
  // lib.rs:2262
  matches_previous_ambiguity_error(ambi: AmbiguityError): boolean;
  // lib.rs:2277
  record_use(ident: Ident, used_decl: Decl, used: Used): void;
  // lib.rs:2342
  add_to_glob_map(import_: Import, name: Symbol): void;
  // lib.rs:2348
  resolve_crate_root(ident: Ident): Module;
  // lib.rs:2421
  resolve_self(ctxt: MutRef<SyntaxContext>, module: Module): Module;
  // lib.rs:2430
  record_partial_res(node_id: NodeId, resolution: PartialRes): void;
  // lib.rs:2437
  record_pat_span(node: NodeId, span: Span): void;
  // lib.rs:2442
  is_accessible_from(vis: Visibility<ModId>, module: Module): boolean;
  // lib.rs:2446
  disambiguate_macro_rules_vs_modularized(macro_rules: Decl, modularized: Decl): boolean;
  // lib.rs:2464
  extern_prelude_get_item(ident: IdentKey, orig_ident_span: Span, finalize: boolean): Decl | undefined;
  // lib.rs:2479
  extern_prelude_get_flag(ident: IdentKey, orig_ident_span: Span, finalize: boolean): Decl | undefined;
  // lib.rs:2532
  resolve_rustdoc_path(path_str: string, ns: Namespace, parent_scope: ParentScope): Res | undefined;
  // lib.rs:2572
  def_span(def_id: DefId): Span;
  // lib.rs:2580
  field_idents(def_id: DefId): Ident[] | undefined;
  // lib.rs:2602
  field_defaults(def_id: DefId): Symbol[] | undefined;
  // lib.rs:2627
  legacy_const_generic_args(expr: Expr): number[] | undefined;
  // lib.rs:2654
  resolve_main(): void;
  // ---- compiler/rustc_resolve/src/ident.rs ----
  // ident.rs:54
  visit_scopes<T>(scope_set: ScopeSet, parent_scope: ParentScope, ctxt: Macros20NormalizedSyntaxContext, orig_ident_span: Span, derive_fallback_lint_id: NodeId | undefined, visitor: ((this_: CmResolver, _1: Scope, _2: UsePrelude, _3: Macros20NormalizedSyntaxContext) => ControlFlow<T>)): T | undefined;
  // ident.rs:244
  hygienic_lexical_parent(module: Module, ctxt: MutRef<Macros20NormalizedSyntaxContext>, derive_fallback_lint_id: NodeId | undefined): [Module, NodeId | undefined] | undefined;
  // ident.rs:309
  resolve_ident_in_lexical_scope(ident: Ident, ns: Namespace, parent_scope: ParentScope, finalize: Finalize | undefined, ribs: readonly Rib[], ignore_decl: Decl | undefined, diag_metadata: DiagMetadata | undefined): LateDecl | undefined;
  // ident.rs:393
  resolve_ident_in_scope_set(orig_ident: Ident, scope_set: ScopeSet, parent_scope: ParentScope, finalize: Finalize | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined): Result<Decl, Determinacy>;
  // ident.rs:413
  resolve_ident_in_scope_set_inner(ident: IdentKey, orig_ident_span: Span, scope_set: ScopeSet, parent_scope: ParentScope, finalize: Finalize | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined): Result<Decl, Determinacy>;
  // ident.rs:545
  resolve_ident_in_scope(ident: IdentKey, orig_ident_span: Span, ns: Namespace, scope: Scope, use_prelude: UsePrelude, scope_set: ScopeSet, parent_scope: ParentScope, finalize: Finalize | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined): Result<Decl, ControlFlow<Determinacy, Determinacy>>;
  // ident.rs:805
  maybe_push_glob_vs_glob_vis_ambiguity(ident: IdentKey, orig_ident_span: Span, decl: Decl, import_: ImportSummary | undefined): void;
  // ident.rs:829
  maybe_push_ambiguity(ident: IdentKey, orig_ident_span: Span, ns: Namespace, scope_set: ScopeSet, parent_scope: ParentScope, decl: Decl, scope: Scope, innermost_results: readonly [Decl, Scope][], import_: ImportSummary | undefined): boolean;
  // ident.rs:966
  maybe_resolve_ident_in_module(module: ModuleOrUniformRoot, ident: Ident, ns: Namespace, parent_scope: ParentScope, ignore_import: Import | undefined): Result<Decl, Determinacy>;
  // ident.rs:977
  resolve_super_in_module(ident: Ident, module: Module | undefined, parent_scope: ParentScope): Module | undefined;
  // ident.rs:990
  path_root_is_crate_root(ident: Ident): boolean;
  // ident.rs:995
  resolve_ident_in_module(module: ModuleOrUniformRoot, ident: Ident, ns: Namespace, parent_scope: ParentScope, finalize: Finalize | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined): Result<Decl, Determinacy>;
  // ident.rs:1113
  resolve_ident_in_extern_module_non_globs_unadjusted(module: ExternModule, ident: IdentKey, orig_ident_span: Span, ns: Namespace, parent_scope: ParentScope, shadowing: Shadowing, finalize: Finalize | undefined, ignore_decl: Decl | undefined): Result<Decl, ControlFlow<Determinacy, Determinacy>>;
  // ident.rs:1152
  resolve_ident_in_local_module_non_globs_unadjusted(module: LocalModule, ident: IdentKey, orig_ident_span: Span, ns: Namespace, parent_scope: ParentScope, shadowing: Shadowing, finalize: Finalize | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined): Result<Decl, ControlFlow<Determinacy, Determinacy>>;
  // ident.rs:1220
  resolve_ident_in_module_globs_unadjusted(module: LocalModule, ident: IdentKey, orig_ident_span: Span, ns: Namespace, parent_scope: ParentScope, shadowing: Shadowing, finalize: Finalize | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined): Result<Decl, ControlFlow<Determinacy, Determinacy>>;
  // ident.rs:1359
  finalize_module_binding(ident: IdentKey, orig_ident_span: Span, binding: Decl | undefined, parent_scope: ParentScope, finalize: Finalize, shadowing: Shadowing): Result<Decl, ControlFlow<Determinacy, Determinacy>>;
  // ident.rs:1406
  single_import_can_define_name(resolution: NameResolution, binding: Decl | undefined, ns: Namespace, ignore_import: Import | undefined, ignore_decl: Decl | undefined, parent_scope: ParentScope): boolean;
  // ident.rs:1476
  validate_res_from_ribs(rib_index: number, rib_ident: Ident, res: Res, finalize: Span | undefined, original_rib_ident_def: Ident, all_ribs: readonly Rib[], diag_metadata: DiagMetadata | undefined): Res;
  // ident.rs:1815
  maybe_resolve_path(path: readonly Segment[], opt_ns: Namespace | undefined, parent_scope: ParentScope, ignore_import: Import | undefined): PathResult;
  // ident.rs:1835
  resolve_path(path: readonly Segment[], opt_ns: Namespace | undefined, parent_scope: ParentScope, finalize: Finalize | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined): PathResult;
  // ident.rs:1857
  resolve_path_with_ribs(path: readonly Segment[], opt_ns: Namespace | undefined, parent_scope: ParentScope, source: PathSource | undefined, finalize: Finalize | undefined, ribs: PerNS<Rib[]> | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined, diag_metadata: DiagMetadata | undefined): PathResult;
  // ---- compiler/rustc_resolve/src/imports.rs ----
  // imports.rs:420
  import_decl_vis(decl: Decl, import_: ImportSummary): Visibility;
  // imports.rs:424
  import_decl_vis_ext(decl: Decl, import_: ImportSummary, min: boolean): Visibility;
  // imports.rs:463
  new_import_decl(decl: Decl, import_: Import): Decl;
  // imports.rs:486
  is_noise_0_7_0(old_glob_decl: Decl, glob_decl: Decl): boolean;
  // imports.rs:503
  is_rustybuzz_0_4_0(old_glob_decl: Decl, glob_decl: Decl): boolean;
  // imports.rs:520
  is_pdf_0_9_0(old_glob_decl: Decl, glob_decl: Decl): boolean;
  // imports.rs:537
  is_net2_0_2_39(old_glob_decl: Decl, glob_decl: Decl): boolean;
  // imports.rs:564
  select_glob_decl(old_glob_decl: Decl, glob_decl: Decl): Decl;
  // imports.rs:624
  try_plant_decl_into_local_module(ident: IdentKey, orig_ident_span: Span, ns: Namespace, decl: Decl): Result<undefined, Decl>;
  // imports.rs:673
  update_local_resolution<T>(module: LocalModule, key: BindingKey, orig_ident_span: Span, f: ((this_: Resolver, _1: NameResolution) => T)): T;
  // imports.rs:731
  import_dummy_binding(import_: Import, is_indeterminate: boolean): void;
  // imports.rs:775
  resolve_imports(): void;
  // imports.rs:813
  write_import_resolutions(import_resolutions: readonly [Import, ImportResolution | undefined, number][]): void;
  // imports.rs:923
  finalize_imports(): void;
  // imports.rs:1012
  lint_reexports(exported_ambiguities: Set<Decl>): void;
  // imports.rs:1125
  resolve_import(import_: Import): [ImportResolution | undefined, number];
  // imports.rs:1194
  finalize_import(import_: Import): UnresolvedImportError | undefined;
  // imports.rs:1661
  report_cannot_reexport(import_: Import, decl: Decl, ident: Ident, ns: Namespace): BufferedEarlyLint | undefined;
  // imports.rs:1720
  check_for_redundant_imports(import_: Import): boolean;
  // imports.rs:1812
  resolve_glob_import(import_: Import, imported_module: ModuleOrUniformRoot): ImportResolutionKind;
  // imports.rs:1848
  rust_embed_hack(module: LocalModule, decl: Decl): boolean;
  // imports.rs:1881
  finalize_resolutions_in(module: LocalModule, module_children: Map<LocalDefId, ModChild[]>, ambig_module_children: Map<LocalDefId, AmbigModChild[]>): void;
  // ---- compiler/rustc_resolve/src/build_reduced_graph.rs ----
  // build_reduced_graph.rs:49
  plant_decl_into_local_module(ident: IdentKey, orig_ident_span: Span, ns: Namespace, decl: Decl): void;
  // build_reduced_graph.rs:64
  define_local(parent: LocalModule, orig_ident: Ident, ns: Namespace, res: Res, vis: Visibility, span: Span, expn_id: LocalExpnId): void;
  // build_reduced_graph.rs:96
  get_nearest_non_block_module(def_id: DefId): Module;
  // build_reduced_graph.rs:105
  expect_module(def_id: DefId): Module;
  // build_reduced_graph.rs:112
  get_module(def_id: DefId): Module | undefined;
  // build_reduced_graph.rs:133
  get_extern_module_with_lock(def_id: DefId, map_lock: Map<DefId, ExternModule>): ExternModule | undefined;
  // build_reduced_graph.rs:172
  expn_def_scope(expn_id: ExpnId): Module;
  // build_reduced_graph.rs:183
  macro_def_scope(def_id: DefId): Module;
  // build_reduced_graph.rs:192
  get_macro(res: Res): SyntaxExtension | undefined;
  // build_reduced_graph.rs:200
  get_macro_by_def_id(def_id: DefId): SyntaxExtension;
  // build_reduced_graph.rs:220
  register_macros_for_all_crates(): void;
  // build_reduced_graph.rs:229
  try_resolve_visibility(parent_scope: ParentScope, vis: AstVisibility, finalize: boolean): Result<Visibility, VisResolutionError>;
  // build_reduced_graph.rs:336
  build_reduced_graph_external(module: ExternModule): ResolutionTable;
  // build_reduced_graph.rs:367
  build_reduced_graph_for_external_crate_res(child: ModChild, parent: ExternModule, child_index: number, ambig_child: ModChild | undefined, resolutions: Map<BindingKey, NameResolutionRef>): void;
  // ---- compiler/rustc_resolve/src/macros.rs ----
  // macros.rs:173 (ResolverExpand)
  next_node_id(): NodeId;
  // macros.rs:177 (ResolverExpand)
  invocation_parent(id: LocalExpnId): LocalDefId;
  // macros.rs:181 (ResolverExpand)
  mark_scope_with_compile_error(id: NodeId): void;
  // macros.rs:189 (ResolverExpand)
  resolve_dollar_crates(): void;
  // macros.rs:196 (ResolverExpand)
  visit_ast_fragment_with_placeholders(expansion: LocalExpnId, fragment: AstFragment): void;
  // macros.rs:216 (ResolverExpand)
  register_builtin_macro(name: Symbol, ext: SyntaxExtensionKind): void;
  // macros.rs:224 (ResolverExpand)
  expansion_for_ast_pass(call_site: Span, pass: AstPass, features: readonly Symbol[], parent_module_id: NodeId | undefined): LocalExpnId;
  // macros.rs:255 (ResolverExpand)
  resolve_imports(): void;
  // macros.rs:259 (ResolverExpand)
  resolve_macro_invocation(invoc: Invocation, eager_expansion_root: LocalExpnId, force: boolean): Result<SyntaxExtension, Indeterminate>;
  // macros.rs:362 (ResolverExpand)
  record_macro_rule_usage(id: NodeId, rule_i: number): void;
  // macros.rs:368 (ResolverExpand)
  check_unused_macros(): void;
  // macros.rs:401 (ResolverExpand)
  has_derive_copy(expn_id: LocalExpnId): boolean;
  // macros.rs:405 (ResolverExpand)
  has_derive_ord(expn_id: LocalExpnId): boolean;
  // macros.rs:409 (ResolverExpand)
  resolve_derives(expn_id: LocalExpnId, force: boolean, derive_paths: (() => DeriveResolution[])): Result<undefined, Indeterminate>;
  // macros.rs:498 (ResolverExpand)
  take_derive_resolutions(expn_id: LocalExpnId): DeriveResolution[] | undefined;
  // macros.rs:506 (ResolverExpand)
  cfg_accessible(expn_id: LocalExpnId, path: Path): Result<boolean, Indeterminate>;
  // macros.rs:514 (ResolverExpand)
  macro_accessible(expn_id: LocalExpnId, path: Path): Result<boolean, Indeterminate>;
  // macros.rs:522 (ResolverExpand)
  get_proc_macro_quoted_span(krate: CrateNum, id: number): Span;
  // macros.rs:526 (ResolverExpand)
  declare_proc_macro(id: NodeId): void;
  // macros.rs:530 (ResolverExpand)
  append_stripped_cfg_item(parent_node: NodeId, ident: Ident, cfg: CfgEntry, cfg_span: Span): void;
  // macros.rs:544 (ResolverExpand)
  registered_attr_tools(): RegisteredTools;
  // macros.rs:548 (ResolverExpand)
  registered_lint_tools(): RegisteredTools;
  // macros.rs:552 (ResolverExpand)
  register_glob_delegation(invoc_id: LocalExpnId): void;
  // macros.rs:556 (ResolverExpand)
  glob_delegation_suffixes(trait_def_id: DefId, impl_def_id: LocalDefId, star_span: Span): Result<[Ident, Ident | undefined][], Indeterminate>;
  // macros.rs:592 (ResolverExpand)
  insert_impl_trait_name(id: NodeId, name: Symbol): void;
  // macros.rs:601
  smart_resolve_macro_path(path: Path, kind: MacroKind, supports_macro_expansion: SupportsMacroExpansion, inner_attr: boolean, parent_scope: ParentScope, node_id: NodeId, force: boolean, deleg_impl: [LocalDefId, Span] | undefined, invoc_in_mod_inert_attr: LocalDefId | undefined, suggestion_span: Span | undefined): Result<[SyntaxExtension, Res], Indeterminate>;
  // macros.rs:746
  resolve_derive_macro_path(path: Path, parent_scope: ParentScope, force: boolean, ignore_import: Import | undefined): Result<[SyntaxExtension | undefined, Res], Determinacy>;
  // macros.rs:765
  resolve_macro_or_delegation_path(ast_path: Path, kind: MacroKind, parent_scope: ParentScope, force: boolean, deleg_impl: [LocalDefId, Span] | undefined, invoc_in_mod_inert_attr: [LocalDefId, NodeId] | undefined, ignore_import: Import | undefined, suggestion_span: Span | undefined): Result<[SyntaxExtension | undefined, Res], Determinacy>;
  // macros.rs:873
  finalize_macro_resolutions(krate: Crate): void;
  // macros.rs:1079
  check_stability_and_deprecation(ext: SyntaxExtension, path: Path, node_id: NodeId): void;
  // macros.rs:1117
  prohibit_imported_non_macro_attrs(decl: Decl | undefined, res: Res | undefined, span: Span): void;
  // macros.rs:1135
  report_out_of_scope_macro_calls(path: Path, parent_scope: ParentScope, invoc_in_mod_inert_attr: [LocalDefId, NodeId] | undefined, decl: Decl | undefined): void;
  // macros.rs:1195
  check_reserved_macro_name(name: Symbol, span: Span, res: Res): void;
  // macros.rs:1210
  compile_macro(macro_def: MacroDef, ident: Ident, attrs: readonly AttrIrAttribute[], span: Span, node_id: NodeId, edition: Edition): SyntaxExtension;
  // macros.rs:1244
  path_accessible(expn_id: LocalExpnId, path: Path, namespaces: readonly Namespace[]): Result<boolean, Indeterminate>;
  // ---- compiler/rustc_resolve/src/check_unused.rs ----
  // check_unused.rs:425
  check_unused(use_items: Item[]): void;
  // ---- compiler/rustc_resolve/src/effective_visibilities.rs ----
  // effective_visibilities.rs:57
  private_vis_decl(decl: Decl): Visibility;
  // effective_visibilities.rs:63
  private_vis_def(def_id: LocalDefId): Visibility;
  // ---- compiler/rustc_resolve/src/diagnostics/impls.rs ----
  // diagnostics/impls.rs:145
  throw_unresolved_import_error(errors: [Import, UnresolvedImportError][], glob_error: boolean): void;
  // diagnostics/impls.rs:337
  dcx(): DiagCtxtHandle;
  // diagnostics/impls.rs:341
  report_errors(krate: Crate, use_injections: UseError[]): void;
  // diagnostics/impls.rs:386
  report_delayed_vis_resolution_errors(): void;
  // diagnostics/impls.rs:397
  report_with_use_injections(krate: Crate, use_injections: UseError[]): void;
  // diagnostics/impls.rs:433
  report_conflict(ident: IdentKey, ns: Namespace, old_binding: Decl, new_binding: Decl): void;
  // diagnostics/impls.rs:596
  add_suggestion_for_rename_of_use(err: Diag, name: Symbol, import_: Import, binding_span: Span): void;
  // diagnostics/impls.rs:662
  add_suggestion_for_duplicate_nested_use(err: Diag, import_: Import, binding_span: Span): void;
  // diagnostics/impls.rs:699
  lint_if_path_starts_with_module(finalize: Finalize, path: readonly Segment[], second_binding: Decl | undefined): void;
  // diagnostics/impls.rs:775
  add_module_candidates(module: Module, names: TypoSuggestion[], filter_fn: ((_0: Res) => boolean), ctxt: SyntaxContext | undefined): void;
  // diagnostics/impls.rs:794
  report_error(span: Span, resolution_error: ResolutionError): ErrorGuaranteed;
  // diagnostics/impls.rs:802
  into_struct_error(span: Span, resolution_error: ResolutionError): Diag;
  // diagnostics/impls.rs:1442
  report_vis_error(vis_resolution_error: VisResolutionError): ErrorGuaranteed;
  // diagnostics/impls.rs:1490
  def_path_str(def_id: DefId): string;
  // diagnostics/impls.rs:1523
  add_scope_set_candidates(suggestions: TypoSuggestion[], scope_set: ScopeSet, ps: ParentScope, sp: Span, filter_fn: ((_0: Res) => boolean)): void;
  // diagnostics/impls.rs:1624
  early_lookup_typo_candidate(scope_set: ScopeSet, parent_scope: ParentScope, ident: Ident, filter_fn: ((_0: Res) => boolean), suggestion_filter: ((_0: TypoSuggestion) => boolean)): TypoSuggestion | undefined;
  // diagnostics/impls.rs:1661
  lookup_import_candidates_from_module(lookup_ident: Ident, namespace: Namespace, parent_scope: ParentScope, start_module: Module, crate_path: PathSegment[], filter_fn: ((_0: Res) => boolean)): ImportSuggestion[];
  // diagnostics/impls.rs:1865
  is_stable(did: DefId, span: Span): boolean;
  // diagnostics/impls.rs:1898
  lookup_import_candidates(lookup_ident: Ident, namespace: Namespace, parent_scope: ParentScope, filter_fn: ((_0: Res) => boolean)): ImportSuggestion[];
  // diagnostics/impls.rs:1978
  unresolved_macro_suggestions(err: Diag, macro_kind: MacroKind, parent_scope: ParentScope, ident: Ident, krate: Crate, sugg_span: Span | undefined): void;
  // diagnostics/impls.rs:2177
  detect_derive_attribute(err: Diag, ident: Ident, parent_scope: ParentScope, sugg_span: Span | undefined): void;
  // diagnostics/impls.rs:2279
  add_typo_suggestion(err: Diag, suggestion: TypoSuggestion | undefined, span: Span, prefix: Ident | undefined): void;
  // diagnostics/impls.rs:2370
  decl_description(b: Decl, ident: Ident, scope: Scope): string;
  // diagnostics/impls.rs:2399
  ambiguity_diagnostic(ambiguity_error: AmbiguityError): Ambiguity;
  // diagnostics/impls.rs:2506
  ctor_fields_span(decl: Decl): Span | undefined;
  // diagnostics/impls.rs:2520
  module_path_names(module: Module): Symbol[] | undefined;
  // diagnostics/impls.rs:2537
  shorten_candidate_path(suggestion: ImportSuggestion, current_module: Module): void;
  // diagnostics/impls.rs:2548
  shorten_import_path(did: DefId | undefined, path: Path, current_module: Module): void;
  // diagnostics/impls.rs:2627
  report_privacy_error(privacy_error: PrivacyError): void;
  // diagnostics/impls.rs:2935
  mention_default_field_values(source: Expr | undefined, ident: Ident, err: Diag): void;
  // diagnostics/impls.rs:2995
  find_similarly_named_module_or_crate(ident: Symbol, current_module: Module): Symbol | undefined;
  // diagnostics/impls.rs:3030
  report_path_resolution_error(path: readonly Segment[], opt_ns: Namespace | undefined, parent_scope: ParentScope, ribs: PerNS<Rib[]> | undefined, ignore_decl: Decl | undefined, ignore_import: Import | undefined, module: ModuleOrUniformRoot | undefined, failed_segment_idx: number, ident: Ident, diag_metadata: DiagMetadata | undefined): [string, string, Suggestion | undefined, string | undefined];
  // diagnostics/impls.rs:3407
  undeclared_module_suggest_declare(ident: Ident, path: PathBuf): Suggestion | undefined;
  // diagnostics/impls.rs:3423
  undeclared_module_exists(ident: Ident): PathBuf | undefined;
  // diagnostics/impls.rs:3458
  make_path_suggestion(path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined;
  // diagnostics/impls.rs:3493
  make_missing_self_suggestion(path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined;
  // diagnostics/impls.rs:3513
  make_missing_crate_suggestion(path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined;
  // diagnostics/impls.rs:3545
  make_missing_super_suggestion(path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined;
  // diagnostics/impls.rs:3568
  make_external_crate_suggestion(path: Segment[], parent_scope: ParentScope): [Segment[], string | undefined] | undefined;
  // diagnostics/impls.rs:3609
  check_for_module_export_macro(import_: Import, module: ModuleOrUniformRoot, ident: Ident): [Suggestion | undefined, string | undefined] | undefined;
  // diagnostics/impls.rs:3750
  find_cfg_stripped(err: Diag, segment: Symbol, module: DefId): void;
  // diagnostics/impls.rs:3836
  struct_ctor(def_id: DefId): StructCtor | undefined;
  // diagnostics/impls.rs:3856
  on_unknown_data(def_id: DefId): Directive | undefined;
  // ---- compiler/rustc_resolve/src/late.rs ----
  // late.rs:5837
  late_resolve_crate(krate: Crate): [Item[], UseError[]];
}

/// Creates `DefId`s for nodes in the AST.
// rustc-type: compiler/rustc_resolve/src/def_collector.rs:39 DefCollector
// PORT: `impl` split over def_collector.rs and build_reduced_graph.rs; `impl Visitor` -> extends the
// rustc_ast `Visitor` base class (methods overridden on the prototype by def_collector.ts).
export class DefCollector extends visit.Visitor {
  constructor(
    public r: Resolver,
    public invocation_parent: InvocationParent,
    public parent_scope: ParentScope,
  ) {
    super();
  }
}
export interface DefCollector {
  // ---- compiler/rustc_resolve/src/build_reduced_graph.rs ----
  // build_reduced_graph.rs:481 (AsMut<Resolver<'ra,'tcx>>)
  as_mut(): Resolver;
  // build_reduced_graph.rs:487
  res(def_id: DefId): Res;
  // build_reduced_graph.rs:492
  resolve_visibility(vis: AstVisibility): Visibility;
  // build_reduced_graph.rs:506
  insert_field_idents(def_id: LocalDefId, fields: readonly FieldDef[]): void;
  // build_reduced_graph.rs:525
  insert_field_visibilities_local(def_id: DefId, fields: readonly FieldDef[]): void;
  // build_reduced_graph.rs:533
  block_needs_anonymous_module(block: Block): boolean;
  // build_reduced_graph.rs:542
  add_import(module_path: Segment[], kind: ImportKind, span: Span, item: Item, root_span: Span, root_id: NodeId, vis: Visibility): void;
  // build_reduced_graph.rs:592
  build_reduced_graph_for_use_tree(item: Item, use_tree: UseTree, id: NodeId, parent_prefix: readonly Segment[], nested: boolean, list_stem: boolean, vis: Visibility, root_span: Span, feed: TyCtxtFeed<LocalDefId>): void;
  // build_reduced_graph.rs:799
  build_reduced_graph_for_struct_variant(fields: readonly FieldDef[], ident: Ident, feed: TyCtxtFeed<LocalDefId>, adt_res: Res, adt_vis: Visibility, adt_span: Span): void;
  // build_reduced_graph.rs:823
  build_reduced_graph_for_item(item: Item, feed: TyCtxtFeed<LocalDefId>): void;
  // build_reduced_graph.rs:1000
  build_reduced_graph_for_extern_crate(orig_name: Symbol | undefined, item: Item, orig_ident: Ident, local_def_id: LocalDefId, vis: Visibility): void;
  // build_reduced_graph.rs:1100
  build_reduced_graph_for_foreign_item(item: ForeignItem, ident: Ident, feed: TyCtxtFeed<LocalDefId>): void;
  // build_reduced_graph.rs:1121
  build_reduced_graph_for_block(block: Block): void;
  // build_reduced_graph.rs:1137
  add_macro_use_decl(name: Symbol, decl: Decl, span: Span, allow_shadowing: boolean): void;
  // build_reduced_graph.rs:1150
  process_macro_use_imports(item: Item, module: Module): boolean;
  // build_reduced_graph.rs:1236
  contains_macro_use(attrs: readonly Attribute[]): boolean;
  // build_reduced_graph.rs:1257
  visit_invoc(id: NodeId): LocalExpnId;
  // build_reduced_graph.rs:1266
  visit_invoc_in_module(id: NodeId): MacroRulesScopeRef;
  // build_reduced_graph.rs:1273
  proc_macro_stub(item: Item, fn_ident: Ident): [MacroKind, Ident, Span] | undefined;
  // build_reduced_graph.rs:1295
  insert_unused_macro(ident: Ident, def_id: LocalDefId, node_id: NodeId): void;
  // build_reduced_graph.rs:1305
  define_macro(item: Item, feed: TyCtxtFeed<LocalDefId>): MacroRulesScopeRef;
  // build_reduced_graph.rs:1410
  brg_visit_item(item: Item, feed: TyCtxtFeed<LocalDefId>): void;
  // build_reduced_graph.rs:1444
  brg_visit_mac_call_in_module(id: NodeId): void;
  // build_reduced_graph.rs:1448
  brg_visit_block(block: Block): void;
  // build_reduced_graph.rs:1457
  brg_visit_assoc_item(item: AssocItem, ctxt: AssocCtxt, ident: Ident, ns: Namespace, feed: TyCtxtFeed<LocalDefId>): void;
  // build_reduced_graph.rs:1494
  visit_assoc_item_mac_call(item: Item<AssocItemKind>, ctxt: AssocCtxt): void;
  // build_reduced_graph.rs:1517
  brg_visit_field_def(sf: FieldDef, feed: TyCtxtFeed<LocalDefId>): void;
  // build_reduced_graph.rs:1529
  brg_visit_variant(variant: Variant, feed: TyCtxtFeed<LocalDefId>): void;
  // ---- compiler/rustc_resolve/src/def_collector.rs ----
  // def_collector.rs:45
  create_def(node_id: NodeId, name: Symbol | undefined, def_kind: DefKind, span: Span): TyCtxtFeed<LocalDefId>;
  // def_collector.rs:68
  with_parent(parent_def: LocalDefId, f: ((this_: DefCollector) => void)): void;
  // def_collector.rs:74
  with_owner(owner: NodeId, name: Symbol | undefined, def_kind: DefKind, span: Span, f: ((this_: DefCollector, _1: TyCtxtFeed<LocalDefId>) => void)): void;
  // def_collector.rs:105
  with_impl_trait(impl_trait_context: ImplTraitContext, f: ((this_: DefCollector) => void)): void;
  // def_collector.rs:116
  collect_field(field: FieldDef, index: number | undefined): void;
  // def_collector.rs:137
  visit_macro_invoc(id: NodeId): void;
  // def_collector.rs:147 (visit::Visitor<'a>)
  // visit_item(i: Item): void;
  // def_collector.rs:235 (visit::Visitor<'a>)
  // visit_block(block: Block): void;
  // def_collector.rs:239 (visit::Visitor<'a>)
  // visit_fn(fn_kind: FnKind, _0: AttrVec, span: Span, _0: NodeId): void;
  // def_collector.rs:301 (visit::Visitor<'a>)
  // visit_foreign_item(fi: ForeignItem): void;
  // def_collector.rs:336 (visit::Visitor<'a>)
  // visit_variant(v: Variant): void;
  // def_collector.rs:346 (visit::Visitor<'a>)
  // visit_where_predicate(pred: WherePredicate): void;
  // def_collector.rs:355 (visit::Visitor<'a>)
  // visit_variant_data(data: VariantData): void;
  // def_collector.rs:364 (visit::Visitor<'a>)
  // visit_generic_param(param: GenericParam): void;
  // def_collector.rs:388 (visit::Visitor<'a>)
  // visit_assoc_item(i: AssocItem, ctxt: AssocCtxt): void;
  // def_collector.rs:413 (visit::Visitor<'a>)
  // visit_pat(pat: Pat): void;
  // def_collector.rs:423 (visit::Visitor<'a>)
  // visit_anon_const(constant: AnonConst): void;
  // def_collector.rs:430 (visit::Visitor<'a>)
  // visit_expr(expr: Expr): void;
  // def_collector.rs:446 (visit::Visitor<'a>)
  // visit_ty(ty: Ty): void;
  // def_collector.rs:478 (visit::Visitor<'a>)
  // visit_stmt(stmt: Stmt): void;
  // def_collector.rs:495 (visit::Visitor<'a>)
  // visit_arm(arm: Arm): void;
  // def_collector.rs:504 (visit::Visitor<'a>)
  // visit_expr_field(f: ExprField): void;
  // def_collector.rs:513 (visit::Visitor<'a>)
  // visit_pat_field(fp: PatField): void;
  // def_collector.rs:522 (visit::Visitor<'a>)
  // visit_param(p: Param): void;
  // def_collector.rs:533 (visit::Visitor<'a>)
  // visit_field_def(field: FieldDef): void;
  // def_collector.rs:537 (visit::Visitor<'a>)
  // visit_crate(krate: Crate): void;
  // def_collector.rs:557 (visit::Visitor<'a>)
  // visit_attribute(attr: Attribute): void;
  // def_collector.rs:575 (visit::Visitor<'a>)
  // visit_inline_asm(asm: InlineAsm): void;
}

// rustc-type: compiler/rustc_resolve/src/late.rs:834 LateResolutionVisitor
// PORT: `impl` split over late.rs and late/diagnostics.rs; `impl Visitor` -> extends the rustc_ast
// `Visitor` base class (methods overridden on the prototype by late.ts).
export class LateResolutionVisitor extends visit.Visitor {
  constructor(
    public r: Resolver,

    /// The module that represents the current item scope.
    public parent_scope: ParentScope,

    /// The current set of local scopes for types and values.
    public ribs: PerNS<Rib[]>,

    /// Previous popped `rib`, only used for diagnostic.
    public last_block_rib: Rib | undefined,

    /// The current set of local scopes, for labels.
    public label_ribs: Rib<NodeId>[],

    /// The current set of local scopes for lifetimes.
    public lifetime_ribs: LifetimeRib[],

    /// We are looking for lifetimes in an elision context.
    /// The set contains all the resolutions that we encountered so far.
    /// They will be used to determine the correct lifetime for the fn return type.
    /// The `LifetimeElisionCandidate` is used for diagnostics, to suggest introducing named
    /// lifetimes.
    public lifetime_elision_candidates: [LifetimeRes, LifetimeElisionCandidate][] | undefined,

    /// The trait that the current context can refer to.
    public current_trait_ref: [Module, TraitRef] | undefined,

    /// Fields used to add information to diagnostic errors.
    public diag_metadata: DiagMetadata,

    /// State used to know whether to ignore resolution errors for function bodies.
    ///
    /// In particular, rustdoc uses this to avoid giving errors for `cfg()` items.
    /// In most cases this will be `None`, in which case errors will always be reported.
    /// If it is `true`, then it will be updated when entering a nested function or trait body.
    public in_func_body: boolean,

    /// Count the number of places a lifetime is used.
    public lifetime_uses: Map<LocalDefId, LifetimeUseSet>,

    /// `use` injections are delayed for better placement and deduplication.
    public use_injections: UseError[],

    /// All `use` and `extern crate` items, in the order in which they are visited.
    public use_items: Item[],
  ) {
    super();
  }
}
export interface LateResolutionVisitor {
  // ---- compiler/rustc_resolve/src/late.rs ----
  // late.rs:883 (AsRef<Resolver<'ra,'tcx>>)
  as_ref(): Resolver;
  // late.rs:888 (AsMut<Resolver<'ra,'tcx>>)
  as_mut(): Resolver;
  // late.rs:895 (Visitor<'ast>)
  // visit_attribute(_0: Attribute): void;
  // late.rs:899 (Visitor<'ast>)
  // visit_item(item: Item): void;
  // late.rs:909 (Visitor<'ast>)
  // visit_arm(arm: Arm): void;
  // late.rs:912 (Visitor<'ast>)
  // visit_block(block: Block): void;
  // late.rs:917 (Visitor<'ast>)
  // visit_anon_const(constant: AnonConst): void;
  // late.rs:920 (Visitor<'ast>)
  // visit_expr(expr: Expr): void;
  // late.rs:923 (Visitor<'ast>)
  // visit_pat(p: Pat): void;
  // late.rs:936 (Visitor<'ast>)
  // visit_local(local: Local): void;
  // late.rs:950 (Visitor<'ast>)
  // visit_ty(ty: Ty): void;
  // late.rs:1079 (Visitor<'ast>)
  // visit_ty_pat(t: TyPat): Result<undefined, FmtError>;
  // late.rs:1098 (Visitor<'ast>)
  // visit_poly_trait_ref(tref: PolyTraitRef): void;
  // late.rs:1118 (Visitor<'ast>)
  // visit_foreign_item(foreign_item: ForeignItem): void;
  // late.rs:1152 (Visitor<'ast>)
  // visit_fn(fn_kind: FnKind, _0: AttrVec, sp: Span, fn_id: NodeId): void;
  // late.rs:1269 (Visitor<'ast>)
  // visit_lifetime(lifetime: Lifetime, use_ctxt: LifetimeCtxt): void;
  // late.rs:1273 (Visitor<'ast>)
  // visit_precise_capturing_arg(arg: PreciseCapturingArg): void;
  // late.rs:1311 (Visitor<'ast>)
  // visit_generics(generics: Generics): void;
  // late.rs:1318 (Visitor<'ast>)
  // visit_closure_binder(b: ClosureBinder): void;
  // late.rs:1331 (Visitor<'ast>)
  // visit_generic_arg(arg: GenericArg): void;
  // late.rs:1368 (Visitor<'ast>)
  // visit_assoc_item_constraint(constraint: AssocItemConstraint): void;
  // late.rs:1393 (Visitor<'ast>)
  // visit_path_segment(path_segment: PathSegment): void;
  // late.rs:1440 (Visitor<'ast>)
  // visit_where_predicate(p: WherePredicate): void;
  // late.rs:1473 (Visitor<'ast>)
  // visit_inline_asm(asm: InlineAsm): void;
  // late.rs:1497 (Visitor<'ast>)
  // visit_inline_asm_sym(sym: InlineAsmSym): void;
  // late.rs:1509 (Visitor<'ast>)
  // visit_variant(v: Variant): void;
  // late.rs:1521 (Visitor<'ast>)
  // visit_field_def(f: FieldDef): void;
  // late.rs:1534 (Visitor<'ast>)
  // visit_test_binder_forall(forall: TestBinderForall): void;
  // late.rs:1554 (Visitor<'ast>)
  // visit_test_binder_exists(exists: TestBinderExists): void;
  // late.rs:1565 (Visitor<'ast>)
  // visit_test_binder_bound_type_constraint(bound_type: TestBinderBoundTypeConstraint): void;
  // late.rs:1581 (static: see the hand module)
  // new(resolver: Resolver): LateResolutionVisitor;
  // late.rs:1609
  maybe_resolve_ident_in_lexical_scope(ident: Ident, ns: Namespace): LateDecl | undefined;
  // late.rs:1625
  resolve_ident_in_lexical_scope(ident: Ident, ns: Namespace, finalize: Finalize | undefined, ignore_decl: Decl | undefined): LateDecl | undefined;
  // late.rs:1643
  resolve_path(path: readonly Segment[], opt_ns: Namespace | undefined, finalize: Finalize | undefined, source: PathSource): PathResult;
  // late.rs:1682
  with_rib<T>(ns: Namespace, kind: RibKind, work: ((this_: LateResolutionVisitor) => T)): T;
  // late.rs:1694
  visit_generic_params(params: readonly GenericParam[], add_self_upper: boolean): void;
  // late.rs:1821
  with_lifetime_rib<T>(kind: LifetimeRibKind, work: ((this_: LateResolutionVisitor) => T)): T;
  // late.rs:1835
  resolve_lifetime(lifetime: Lifetime, use_ctxt: LifetimeCtxt): void;
  // late.rs:1947
  resolve_anonymous_lifetime(lifetime: Lifetime, id_for_lint: NodeId, elided: boolean): void;
  // late.rs:2113
  point_at_impl_lifetimes(err: Diag, i: number, lifetime: Span): void;
  // late.rs:2203
  resolve_elided_lifetime(anchor_id: NodeId, span: Span): void;
  // late.rs:2216
  create_fresh_lifetime(ident: Ident, binder: NodeId, kind: MissingLifetimeKind): LifetimeRes;
  // late.rs:2241
  resolve_elided_lifetimes_in_path(partial_res: PartialRes, path: readonly Segment[], source: PathSource, path_span: Span): void;
  // late.rs:2465
  record_lifetime_use(id: NodeId, res: LifetimeRes, candidate: LifetimeElisionCandidate): void;
  // late.rs:2486
  record_lifetime_err(id: NodeId, guar: ErrorGuaranteed): void;
  // late.rs:2492
  record_lifetime_def(id: NodeId, res: LifetimeRes): void;
  // late.rs:2502
  resolve_fn_signature(fn_id: NodeId, has_self: boolean, inputs: Iterable<[Pat | undefined, Ty]>, output_ty: FnRetTy, report_elided_lifetimes_in_path: boolean): void;
  // late.rs:2555
  resolve_fn_params(has_self: boolean, inputs: Iterable<[Pat | undefined, Ty]>): Result<LifetimeRes, [MissingLifetime[], ElisionFnParameter[]]>;
  // late.rs:2675
  find_lifetime_for_self(ty: Ty): Set1<LifetimeRes>;
  // late.rs:2783
  resolve_label(label: Ident): Result<[NodeId, Span], ResolutionError>;
  // late.rs:2820
  is_label_valid_from_rib(rib_index: number): boolean;
  // late.rs:2825
  resolve_adt(item: Item, generics: Generics): void;
  // late.rs:2848
  future_proof_import(use_tree: UseTree): void;
  // late.rs:2891
  resolve_item(item: Item): void;
  // late.rs:3160
  with_generic_param_rib(params: readonly GenericParam[], kind: RibKind, binder: NodeId, generics_kind: LifetimeBinderKind, generics_span: Span, f: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:3348
  with_label_rib(kind: RibKind, f: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:3354
  with_static_rib(def_kind: DefKind, f: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:3368
  with_constant_rib(is_repeat: IsRepeatExpr, may_use_generics: ConstantHasGenerics, requires_type: ConstantRequiresType, item: [Ident, ConstantItemKind] | undefined, f: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:3406
  with_current_self_type<T>(self_type: Ty, f: ((this_: LateResolutionVisitor) => T)): T;
  // late.rs:3418
  with_current_self_item<T>(self_item: Item, f: ((this_: LateResolutionVisitor) => T)): T;
  // late.rs:3426
  resolve_trait_items(trait_items: readonly AssocItem[]): void;
  // late.rs:3437
  resolve_trait_item(item: Item<AssocItemKind>): void;
  // late.rs:3510
  with_optional_trait_ref<T>(opt_trait_ref: TraitRef | undefined, self_type: Ty, f: ((this_: LateResolutionVisitor, _1: DefId | undefined) => T)): T;
  // late.rs:3542
  with_self_rib_ns(ns: Namespace, self_res: Res, f: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:3552
  with_self_rib(self_res: Res, f: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:3556
  resolve_implementation(attrs: readonly Attribute[], generics: Generics, of_trait: TraitImplHeader | undefined, self_type: Ty, item_id: NodeId, impl_items: readonly AssocItem[]): void;
  // late.rs:3643
  resolve_test_binder_constraints(constraints: TestBinderConstraints, item_id: NodeId): void;
  // late.rs:3665
  resolve_impl_item(item: AssocItem, seen_trait_items: Map<DefId, Span>, trait_id: DefId | undefined, is_in_trait_impl: boolean, self_type_id: NodeId): void;
  // late.rs:3842
  fill_delegation_inherent_fn_map(self_type_id: NodeId, ident: Ident): void;
  // late.rs:3865
  check_trait_item(id: NodeId, ident: Ident, reported_ident: Ident, kind: AssocItemKind, ns: Namespace, span: Span, seen_trait_items: Map<DefId, Span>, err: ((_0: Ident, _1: string, _2: Symbol | undefined) => ResolutionError)): void;
  // late.rs:3991
  resolve_static_body(expr: Expr, item: [Ident, ConstantItemKind] | undefined): void;
  // late.rs:4003
  resolve_const_item_rhs(body: Expr | undefined, item: [Ident, ConstantItemKind] | undefined): void;
  // late.rs:4021
  resolve_delegation(delegation: Delegation, item_id: NodeId, is_in_trait_impl: boolean): void;
  // late.rs:4095
  resolve_params(params: readonly Param[]): void;
  // late.rs:4108
  resolve_local(local: Local): void;
  // late.rs:4145
  compute_and_check_binding_map(pat: Pat): Result<Map<Ident, BindingInfo>, IsNeverPattern>;
  // late.rs:4185
  is_base_res_local(nid: NodeId): boolean;
  // late.rs:4210
  compute_and_check_or_pat_binding_map(pats: readonly Pat[]): Result<Map<Ident, BindingInfo>, IsNeverPattern>;
  // late.rs:4289
  check_consistent_bindings(pat: Pat): void;
  // late.rs:4303
  resolve_arm(arm: Arm): void;
  // late.rs:4312
  resolve_pattern_top(pat: Pat, pat_src: PatternSource): void;
  // late.rs:4319
  apply_pattern_bindings(pat_bindings: PatternBindings): void;
  // late.rs:4336
  resolve_pattern(pat: Pat, pat_src: PatternSource, bindings: PatternBindings): void;
  // late.rs:4373
  resolve_pattern_inner(pat: Pat, pat_src: PatternSource, bindings: PatternBindings): void;
  // late.rs:4466
  record_patterns_with_skipped_bindings(pat: Pat, rest: PatFieldsRest): void;
  // late.rs:4497
  fresh_binding(ident: Ident, pat_id: NodeId, pat_src: PatternSource, bindings: PatternBindings): Res;
  // late.rs:4544
  innermost_rib_bindings(ns: Namespace): Map<Ident, Res>;
  // late.rs:4548
  try_resolve_as_non_binding(pat_src: PatternSource, ann: BindingMode, ident: Ident, has_sub: boolean): Res | undefined;
  // late.rs:4651
  resolve_restriction_path(restriction: RestrictionKind): void;
  // late.rs:4665
  smart_resolve_path(id: NodeId, qself: QSelf | undefined, path: Path, source: PathSource): void;
  // late.rs:4682
  smart_resolve_path_fragment(qself: QSelf | undefined, path: readonly Segment[], source: PathSource, finalize: Finalize, record_partial_res: RecordPartialRes, parent_qself: QSelf | undefined): PartialRes;
  // late.rs:4957
  self_type_is_available(): boolean;
  // late.rs:4963
  self_value_is_available(self_span: Span): boolean;
  // late.rs:4972
  report_error(span: Span, resolution_error: ResolutionError): void;
  // late.rs:4982
  should_report_errs(): boolean;
  // late.rs:4988
  resolve_qpath_anywhere(qself: QSelf | undefined, path: readonly Segment[], primary_ns: Namespace, defer_to_typeck: boolean, finalize: Finalize, source: PathSource): Result<PartialRes | undefined, Spanned<ResolutionError>>;
  // late.rs:5028
  resolve_qpath(qself: QSelf | undefined, path: readonly Segment[], ns: Namespace, finalize: Finalize, source: PathSource): Result<PartialRes | undefined, Spanned<ResolutionError>>;
  // late.rs:5185
  with_resolved_label(label: Label | undefined, id: NodeId, f: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:5205
  resolve_labeled_block(label: Label | undefined, id: NodeId, block: Block): void;
  // late.rs:5209
  resolve_block(block: Block): void;
  // late.rs:5252
  resolve_anon_const(constant: AnonConst, anon_const_kind: AnonConstKind): void;
  // late.rs:5270
  resolve_anon_const_manual(is_trivial_const_arg: boolean, anon_const_kind: AnonConstKind, resolve_expr: ((this_: LateResolutionVisitor) => void)): void;
  // late.rs:5313
  resolve_expr_field(f: ExprField, e: Expr): void;
  // late.rs:5319
  resolve_expr(expr: Expr, parent: Expr | undefined): void;
  // late.rs:5524
  record_candidate_traits_for_expr_if_necessary(expr: Expr): void;
  // late.rs:5543
  record_traits_in_scope(node_id: NodeId, ident: Ident): void;
  // late.rs:5553
  resolve_and_cache_rustdoc_path(path_str: string, ns: Namespace): Res | undefined;
  // late.rs:5578
  is_invalid_proc_macro_item_for_doc(did: DefId): boolean;
  // late.rs:5588
  resolve_doc_links(attrs: readonly Attribute[], maybe_exported: MaybeExported): void;
  // late.rs:5663
  lint_unused_qualifications(path: readonly Segment[], ns: Namespace, finalize: Finalize): void;
  // late.rs:5704
  resolve_define_opaques(define_opaque: [NodeId, Path][] | undefined): void;
  // late.rs:5712
  resolve_eii(eii_impl: EiiImpl | undefined): void;
  // ---- compiler/rustc_resolve/src/late/diagnostics.rs ----
  // late/diagnostics.rs:188
  trait_assoc_type_def_id_by_name(trait_def_id: DefId, assoc_name: Symbol): DefId | undefined;
  // late/diagnostics.rs:208
  suggest_assoc_type_from_bounds(err: Diag, source: PathSource, path: readonly Segment[], ident_span: Span): boolean;
  // late/diagnostics.rs:383
  make_base_error(path: readonly Segment[], span: Span, source: PathSource, res: Res | undefined, could_be_expr: boolean): BaseError;
  // late/diagnostics.rs:596
  could_be_expr(res: Res, span: Span): boolean;
  // late/diagnostics.rs:624
  smart_resolve_partial_mod_path_errors(prefix_path: readonly Segment[], following_seg: Segment | undefined): ImportSuggestion[];
  // late/diagnostics.rs:664
  smart_resolve_report_errors(path: readonly Segment[], following_seg: Segment | undefined, span: Span, source: PathSource, res: Res | undefined, qself: QSelf | undefined): [Diag, ImportSuggestion[]];
  // late/diagnostics.rs:831
  suggest_named_format_argument(err: Diag, source: PathSource, ident: Ident, expression: string, applicability: Applicability): boolean;
  // late/diagnostics.rs:901
  detect_rtn_with_fully_qualified_path(err: Diag, path: readonly Segment[], following_seg: Segment | undefined, span: Span, source: PathSource, res: Res | undefined, qself: QSelf | undefined): void;
  // late/diagnostics.rs:928
  detect_assoc_type_constraint_meant_as_path(err: Diag, base_error: BaseError): void;
  // late/diagnostics.rs:972
  suggest_self_or_self_ref(err: Diag, path: readonly Segment[], span: Span): void;
  // late/diagnostics.rs:1015
  try_lookup_name_relaxed(err: Diag, source: PathSource, path: readonly Segment[], following_seg: Segment | undefined, span: Span, res: Res | undefined, base_error: BaseError): [boolean, Set<string>, ImportSuggestion[]];
  // late/diagnostics.rs:1284
  lookup_doc_alias_name(path: readonly Segment[], ns: Namespace): [DefId, Ident] | undefined;
  // late/diagnostics.rs:1345
  suggest_trait_and_bounds(err: Diag, source: PathSource, res: Res | undefined, span: Span, base_error: BaseError): boolean;
  // late/diagnostics.rs:1420
  suggest_typo(err: Diag, source: PathSource, path: readonly Segment[], following_seg: Segment | undefined, span: Span, base_error: BaseError, suggested_candidates: Set<string>): boolean;
  // late/diagnostics.rs:1482
  suggest_shadowed(err: Diag, source: PathSource, path: readonly Segment[], following_seg: Segment | undefined, span: Span): boolean;
  // late/diagnostics.rs:1515
  err_code_special_cases(err: Diag, source: PathSource, path: readonly Segment[], span: Span): void;
  // late/diagnostics.rs:1561
  suggest_ident_hidden_by_hygiene(err: Diag, path: readonly Segment[], span: Span): void;
  // late/diagnostics.rs:1598
  suggest_self_ty(err: Diag, source: PathSource, path: readonly Segment[], span: Span): boolean;
  // late/diagnostics.rs:1621
  suggest_self_value(err: Diag, source: PathSource, path: readonly Segment[], span: Span): boolean;
  // late/diagnostics.rs:1714
  detect_missing_binding_available_from_pattern(err: Diag, path: readonly Segment[], following_seg: Segment | undefined): void;
  // late/diagnostics.rs:1770
  suggest_at_operator_in_slice_pat_with_range(err: Diag, path: readonly Segment[]): void;
  // late/diagnostics.rs:1802
  suggest_range_struct_destructuring(err: Diag, path: readonly Segment[], source: PathSource): void;
  // late/diagnostics.rs:1880
  suggest_swapping_misplaced_self_ty_and_trait(err: Diag, source: PathSource, res: Res | undefined, span: Span): void;
  // late/diagnostics.rs:1912
  detect_resolution_error_in_derive(err: Diag, span: Span): void;
  // late/diagnostics.rs:1928
  explain_functions_in_pattern(err: Diag, res: Res | undefined, source: PathSource): void;
  // late/diagnostics.rs:1940
  suggest_changing_type_to_const_param(err: Diag, res: Res | undefined, source: PathSource, path: readonly Segment[], following_seg: Segment | undefined, span: Span): void;
  // late/diagnostics.rs:2022
  suggest_pattern_match_with_let(err: Diag, source: PathSource, span: Span): boolean;
  // late/diagnostics.rs:2048
  get_single_associated_item(path: readonly Segment[], source: PathSource, filter_fn: ((_0: Res) => boolean)): TypoSuggestion | undefined;
  // late/diagnostics.rs:2083
  restrict_assoc_type_in_where_clause(span: Span, err: Diag): boolean;
  // late/diagnostics.rs:2157
  call_has_self_arg(source: PathSource): [Span, Span | undefined] | undefined;
  // late/diagnostics.rs:2191
  followed_by_brace(span: Span): [boolean, Span | undefined];
  // late/diagnostics.rs:2223
  update_err_for_private_tuple_struct_fields(err: Diag, source: PathSource, def_id: DefId): Span[] | undefined;
  // late/diagnostics.rs:2267
  smart_resolve_context_dependent_help(err: Diag, span: Span, source: PathSource, path: readonly Segment[], res: Res, path_str: string, fallback_label: string): boolean;
  // late/diagnostics.rs:2794
  suggest_alternative_construction_methods(def_id: DefId, err: Diag, path_span: Span, call_span: Span, args: readonly Expr[]): void;
  // late/diagnostics.rs:2919
  find_similarly_named_assoc_item(ident: Symbol, kind: AssocItemKind): Symbol | undefined;
  // late/diagnostics.rs:2951
  lookup_assoc_candidate(ident: Ident, ns: Namespace, filter_fn: ((_0: Res) => boolean), called: boolean): [AssocSuggestion, Span] | undefined;
  // late/diagnostics.rs:3065
  lookup_typo_candidate(path: readonly Segment[], following_seg: Segment | undefined, ns: Namespace, filter_fn: ((_0: Res) => boolean)): TypoCandidate;
  // late/diagnostics.rs:3174 (static: see the hand module)
  // likely_rust_type(path: readonly Segment[]): Symbol | undefined;
  // late/diagnostics.rs:3193
  let_binding_suggestion(err: Diag, ident_span: Span): boolean;
  // late/diagnostics.rs:3239
  find_module(def_id: DefId): [Module, ImportSuggestion] | undefined;
  // late/diagnostics.rs:3290
  collect_enum_ctors(def_id: DefId): [Path, DefId, CtorKind][] | undefined;
  // late/diagnostics.rs:3306
  suggest_using_enum_variant(err: Diag, source: PathSource, def_id: DefId, span: Span): void;
  // late/diagnostics.rs:3514
  detect_and_suggest_const_parameter_error(path: readonly Segment[], source: PathSource): Diag | undefined;
  // late/diagnostics.rs:3676
  suggest_adding_generic_parameter(path: readonly Segment[], source: PathSource): [[Span, string, string, Applicability] | undefined, Diag | undefined];
  // late/diagnostics.rs:3783
  suggestion_for_label_in_rib(rib_index: number, label: Ident): LabelSuggestion | undefined;
  // late/diagnostics.rs:3808
  maybe_report_lifetime_uses(generics_span: Span, params: readonly GenericParam[]): void;
  // late/diagnostics.rs:3927
  emit_undeclared_lifetime_error(lifetime_ref: Lifetime, outer_lifetime_ref: Ident | undefined): ErrorGuaranteed;
  // late/diagnostics.rs:3979
  suggest_introducing_lifetime(err: Diag, name: Ident | undefined, suggest: ((_0: Diag, _1: boolean, _2: Span, _3: string, _4: string, _5: [Span, string][]) => boolean)): void;
  // late/diagnostics.rs:3995
  suggest_introducing_lifetime_for_assoc_ty_binding(err: Diag, lifetime: Span): void;
  // late/diagnostics.rs:4022
  suggest_introducing_lifetime_filtered(err: Diag, name: Ident | undefined, consider: ((_0: LifetimeBinderKind) => boolean), suggest: ((_0: Diag, _1: boolean, _2: Span, _3: string, _4: string, _5: [Span, string][]) => boolean)): void;
  // late/diagnostics.rs:4174
  emit_non_static_lt_in_const_param_ty_error(lifetime_ref: Lifetime): ErrorGuaranteed;
  // late/diagnostics.rs:4187
  emit_forbidden_non_static_lifetime_error(cause: NoConstantGenericsReason, lifetime_ref: Lifetime): ErrorGuaranteed;
  // late/diagnostics.rs:4216
  report_missing_lifetime_specifiers(lifetime_refs: Iterable<MissingLifetime>, function_param_lifetimes: [MissingLifetime[], ElisionFnParameter[]] | undefined): ErrorGuaranteed;
  // late/diagnostics.rs:4239
  add_missing_lifetime_specifiers_label(err: Diag, lifetime_refs: Iterable<MissingLifetime>, function_param_lifetimes: [MissingLifetime[], ElisionFnParameter[]] | undefined): void;
  // late/diagnostics.rs:4682
  find_ref_prefix_span_for_owned_suggestion(lifetime: Span): Span | undefined;
}

declare module "./lib.gen.ts" {
  // `Module`, `LocalModule` and `ExternModule` are the `ModuleData` object itself (lib.ts), so the
  // methods of their `impl` blocks are methods of `ModuleData`.
  interface ModuleData {
    // ---- compiler/rustc_resolve/src/lib.rs ----
    // lib.rs:736 (static: see the hand module)
    // new(parent: Module | undefined, kind: ModuleKind, expansion: ExpnId, span: Span, no_implicit_prelude: boolean, vis: Visibility<ModId>, arenas: ResolverArenas): ModuleData;
    // lib.rs:770
    name(): Symbol | undefined;
    // lib.rs:777
    opt_def_id(): DefId | undefined;
    // lib.rs:781
    def_id(): DefId;
    // lib.rs:785
    is_local(): boolean;
    // lib.rs:789
    has_unexpanded_invocations(r: Resolver): boolean;
    // lib.rs:793
    res(): Res | undefined;
    // lib.rs:800
    def_kind(): DefKind | undefined;
    // lib.rs:809
    for_each_child<R extends AsRefResolver>(resolver: R, f: ((_0: R, _1: IdentKey, _2: Span, _3: Namespace, _4: Decl) => void)): void;
    // lib.rs:822
    for_each_child_mut<R extends AsMutResolver>(resolver: R, f: ((_0: R, _1: IdentKey, _2: Span, _3: Namespace, _4: Decl) => void)): void;
    // lib.rs:836
    ensure_traits(resolver: Resolver): void;
    // lib.rs:873
    is_normal(): boolean;
    // lib.rs:877
    is_trait(): boolean;
    // lib.rs:881
    nearest_item_scope(): Module;
    // lib.rs:892
    nearest_parent_mod(): ModId;
    // lib.rs:901
    nearest_parent_mod_node_id(): NodeId;
    // lib.rs:908
    is_ancestor_of(other: Module): boolean;
    // lib.rs:920
    expect_local(): LocalModule;
    // lib.rs:930
    expect_extern(): ExternModule;
    // lib.rs:941 (static: see the hand module)
    // new(parent: LocalModule | undefined, kind: ModuleKind, vis: Visibility<ModId>, expn_id: ExpnId, span: Span, no_implicit_prelude: boolean, arenas: ResolverArenas): LocalModule;
    // lib.rs:957
    to_module(): Module;
    // lib.rs:963 (static: see the hand module)
    // new(parent: ExternModule | undefined, kind: ModuleKind, vis: Visibility<ModId>, expn_id: ExpnId, span: Span, no_implicit_prelude: boolean, arenas: ResolverArenas): ExternModule;
    // lib.rs:979
    to_module(): Module;
    // lib.rs:987 (std::ops::Deref)
    // deref(): Target;
    // lib.rs:995 (std::ops::Deref)
    // deref(): Target;
    // lib.rs:1003 (std::ops::Deref)
    // deref(): Target;
    // lib.rs:1009 (fmt::Debug)
    // fmt(f: Formatter): Result<undefined, FmtError>;
    // lib.rs:1018 (fmt::Debug)
    // fmt(f: Formatter): Result<undefined, FmtError>;
  }
  interface DeclData {
    // ---- compiler/rustc_resolve/src/lib.rs ----
    // lib.rs:1151
    vis(): Visibility<ModId>;
    // lib.rs:1156
    min_vis(): Visibility<ModId>;
    // lib.rs:1161
    res(): Res;
    // lib.rs:1168
    import_source(): Decl;
    // lib.rs:1175
    descent_to_ambiguity(): [Decl, Decl] | undefined;
    // lib.rs:1185
    is_ambiguity_recursive(): boolean;
    // lib.rs:1193
    is_possibly_imported_variant(): boolean;
    // lib.rs:1204
    is_extern_crate(): boolean;
    // lib.rs:1214
    is_import(): boolean;
    // lib.rs:1220
    is_import_user_facing(): boolean;
    // lib.rs:1225
    is_glob_import(): boolean;
    // lib.rs:1232
    is_assoc_item(): boolean;
    // lib.rs:1236
    macro_kinds(): MacroKinds | undefined;
    // lib.rs:1240
    reexport_chain(): Reexport[];
    // lib.rs:1264
    may_appear_after(invoc_parent_expansion: LocalExpnId, decl: Decl): boolean;
    // lib.rs:1282
    determined(r: Resolver): boolean;
  }
  interface IdentKey {
    // ---- compiler/rustc_resolve/src/lib.rs ----
    // lib.rs:600 (static: see the hand module)
    // new(ident: Ident): IdentKey;
    // lib.rs:605 (static: see the hand module)
    // new_adjusted(ident: Ident, expn_id: ExpnId): [IdentKey, ExpnId | undefined];
    // lib.rs:611 (static: see the hand module)
    // with_root_ctxt(name: Symbol): IdentKey;
    // lib.rs:617
    orig(orig_ident_span: Span): Ident;
  }
  interface ExternPreludeEntry {
    // ---- compiler/rustc_resolve/src/lib.rs ----
    // lib.rs:1310
    introduced_by_item(): boolean;
    // lib.rs:1314 (static: see the hand module)
    // flag(): ExternPreludeEntry;
    // lib.rs:1321 (static: see the hand module)
    // open_flag(): ExternPreludeEntry;
    // lib.rs:1328
    span(): Span;
  }
}

declare module "./imports.gen.ts" {
  interface ImportData {
    // ---- compiler/rustc_resolve/src/imports.rs ----
    // imports.rs:218
    is_glob(): boolean;
    // imports.rs:222
    is_nested(): boolean;
    // imports.rs:229
    id(): NodeId | undefined;
    // imports.rs:238
    def_id(): LocalDefId | undefined;
    // imports.rs:247
    simplify(): Reexport;
    // imports.rs:257
    summary(): ImportSummary;
  }
  interface NameResolution {
    // ---- compiler/rustc_resolve/src/imports.rs ----
    // imports.rs:286 (static: see the hand module)
    // new(orig_ident_span: Span): NameResolution;
    // imports.rs:298
    determined_decl(): Decl | undefined;
    // imports.rs:308
    best_decl(): Decl | undefined;
  }
}

declare module "./check_unused.gen.ts" {
  interface UnusedImport {
    // ---- compiler/rustc_resolve/src/check_unused.rs ----
    // check_unused.rs:52
    add(id: NodeId): void;
  }
}

declare module "./check_unused.ts" {
  interface UnusedImportCheckVisitor {
    // ---- compiler/rustc_resolve/src/check_unused.rs ----
    // check_unused.rs:85
    check_import(id: NodeId, def_id: LocalDefId): void;
    // check_unused.rs:104
    check_use_tree(use_tree: UseTree, id: NodeId, def_id: LocalDefId): void;
    // check_unused.rs:120
    unused_import(): UnusedImport;
    // check_unused.rs:134
    check_import_as_underscore(item: UseTree, id: NodeId): void;
    // check_unused.rs:151
    check_imports_as_underscore(items: readonly UseTreeAndId[]): void;
    // check_unused.rs:157
    report_unused_extern_crate_items(maybe_unused_extern_crates: Map<NodeId, Span>): void;
    // check_unused.rs:247 (AsMut<Resolver<'ra,'tcx>>)
    as_mut(): Resolver;
    // check_unused.rs:258 (Visitor<'a>)
    // visit_attribute(_0: Attribute): void;
    // check_unused.rs:260 (Visitor<'a>)
    // visit_item(item: Item): void;
    // check_unused.rs:290 (Visitor<'a>)
    // visit_use_tree_and_id(tree: UseTreeAndId): void;
  }
}

declare module "./effective_visibilities.ts" {
  interface EffectiveVisibilitiesVisitor {
    // ---- compiler/rustc_resolve/src/effective_visibilities.rs ----
    // effective_visibilities.rs:81 (static: see the hand module)
    // compute_effective_visibilities(r: Resolver, krate: Crate): Set<Decl>;
    // effective_visibilities.rs:131
    set_bindings_effective_visibilities(module_id: LocalDefId): void;
    // effective_visibilities.rs:145
    update_decl_chain(decl: Decl, parent_id: ParentId, seen_most_visible: Set<Decl>): void;
    // effective_visibilities.rs:172
    effective_vis_or_private(parent_id: ParentId): EffectiveVisibility;
    // effective_visibilities.rs:190
    may_update(nominal_vis: Visibility, parent_id: ParentId, priv_vis: Visibility): boolean;
    // effective_visibilities.rs:203
    update_import(decl: Decl, parent_id: ParentId, priv_vis: Visibility): void;
    // effective_visibilities.rs:220
    update_def(def_id: LocalDefId, nominal_vis: Visibility, parent_id: ParentId, priv_vis: Visibility): void;
    // effective_visibilities.rs:242
    update_field(def_id: LocalDefId, parent_id: LocalDefId): void;
    // effective_visibilities.rs:247
    update_macro(def_id: LocalDefId, inherited_effective_vis: EffectiveVisibility): void;
    // effective_visibilities.rs:266
    update_reachability_from_macro(local_def_id: LocalDefId, md: MacroDef, attrs: readonly Attribute[]): void;
    // effective_visibilities.rs:308
    update_macro_reachable(module_def_id: LocalDefId, defining_mod: LocalDefId, macro_ev: EffectiveVisibility): void;
    // effective_visibilities.rs:333
    update_macro_reachable_def(def_id: LocalDefId, def_kind: DefKind, vis: Visibility, module: LocalDefId, macro_ev: EffectiveVisibility): void;
    // effective_visibilities.rs:358 (Visitor<'a>)
    // visit_item(item: Item): void;
  }
}

declare module "./diagnostics/impls.gen.ts" {
  interface StructCtor {
    // ---- compiler/rustc_resolve/src/diagnostics/impls.rs ----
    // diagnostics/impls.rs:78
    has_private_fields(m: Module, r: Resolver): boolean;
  }
  interface OnUnknownData {
    // ---- compiler/rustc_resolve/src/diagnostics/impls.rs ----
    // diagnostics/impls.rs:4397 (static: see the hand module)
    // from_attrs(r: Resolver, attrs: readonly Attribute[]): OnUnknownData | undefined;
  }
  interface TypoSuggestion {
    // ---- compiler/rustc_resolve/src/diagnostics/impls.rs ----
    // diagnostics/impls.rs:102 (static: see the hand module)
    // new(candidate: Symbol, span: Span, res: Res): TypoSuggestion;
    // diagnostics/impls.rs:105 (static: see the hand module)
    // typo_from_name(candidate: Symbol, res: Res): TypoSuggestion;
    // diagnostics/impls.rs:108 (static: see the hand module)
    // single_item(candidate: Symbol, span: Span, res: Res): TypoSuggestion;
  }
}

declare module "./diagnostics/impls.ts" {
  interface UsePlacementFinder {
    // ---- compiler/rustc_resolve/src/diagnostics/impls.rs ----
    // diagnostics/impls.rs:4312 (static: see the hand module)
    // check(krate: Crate, target_module: NodeId): [Span | undefined, FoundUse];
    // diagnostics/impls.rs:4325 (Visitor<'tcx>)
    // visit_crate(c: Crate): void;
    // diagnostics/impls.rs:4337 (Visitor<'tcx>)
    // visit_item(item: Item): void;
  }
  interface BindingVisitor {
    // ---- compiler/rustc_resolve/src/diagnostics/impls.rs ----
    // diagnostics/impls.rs:4359 (Visitor<'tcx>)
    // visit_pat(pat: Pat): void;
  }
}

declare module "./late.ts" {
  interface ItemInfoCollector {
    // ---- compiler/rustc_resolve/src/late.rs ----
    // late.rs:5734
    collect_fn_info(decl: FnDecl, id: NodeId): void;
    // late.rs:5768 (Visitor<'_>)
    // visit_item(item: Item): void;
    // late.rs:5820 (Visitor<'_>)
    // visit_assoc_item(item: AssocItem, ctxt: AssocCtxt): void;
  }
}

declare module "./late/diagnostics.ts" {
  interface ParentPathVisitor {
    // ---- compiler/rustc_resolve/src/late/diagnostics.rs ----
    // late/diagnostics.rs:4840 (static: see the hand module)
    // new(self_ty: Ty, target: Ident): ParentPathVisitor;
    // late/diagnostics.rs:4849 (Visitor<'a>)
    // visit_ty(ty: Ty): void;
  }
  interface LifetimeFinder {
    // ---- compiler/rustc_resolve/src/late/diagnostics.rs ----
    // late/diagnostics.rs:4787 (Visitor<'ast>)
    // visit_ty(t: Ty): void;
  }
  interface RefPrefixSpanFinder {
    // ---- compiler/rustc_resolve/src/late/diagnostics.rs ----
    // late/diagnostics.rs:4804 (Visitor<'ast>)
    // visit_ty(t: Ty): void;
  }
}
