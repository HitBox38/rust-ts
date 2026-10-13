//! Type context book-keeping.
// Partial port of compiler/rustc_middle/src/ty/context.rs: `GlobalCtxt`, `TyCtxt`, `TyCtxtFeed`,
// `CurrentGcx` and the `TyCtxt` methods name resolution and expansion need (docs/plan-m2.md blocker G).
//
// PORT decisions (D3 and PORTING §5):
// - `TyCtxt` is a class wrapping the `GlobalCtxt` (`gcx`); `impl Deref for TyCtxt` is the getters below
//   (`sess`, `dep_graph`, `prof`, `hooks`, `query_system`). Private `GlobalCtxt` fields (`untracked`,
//   `crate_types`, `stable_crate_id`) are read through `this.gcx`.
// - Arenas are erased (`arena`, `hir_arena`); type interning (`CtxtInterners`, `CommonTypes`,
//   `CommonLifetimes`, `CommonConsts`), `GlobalCaches` and `alloc_map` are not ported (no `Ty` yet).
// - No dep graph (D3): `dep_graph` is the disabled graph (dep_graph/graph.ts).
// - `data_layout` (`sess.target.parse_data_layout()`) is computed on first read, pending rustc_target /
//   rustc_abi (lane target-cfg); upstream computes it eagerly in `create_global_ctxt` and can only fail
//   for custom target specs.
// - Query methods (`tcx.$query(..)`) are installed by query/query_api.ts and hook methods by hooks.ts.
import type { Crate } from "../../rustc_ast/ast.gen.ts";
import type { Untracked, CrateStoreDyn } from "../../rustc_crate_store/cstore.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type { Features } from "../../rustc_feature/unstable.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import type { DefKey, DefPath, DefPathData, Definitions, PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { OwnerId } from "../../rustc_hir_id/lib.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { SelfProfilerRef } from "../../rustc_session/stand_ins.ts";
import { CRATE_DEF_ID, type CrateNum, type DefId, type DefPathHash, LOCAL_CRATE, LocalDefId, LocalModId, type StableCrateId, debug_StableCrateId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import type { CrateType } from "../../rustc_structures/lib.ts";
import type { Limit } from "../../rustc_structures/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import type { DepGraph } from "../dep_graph/graph.ts";
import { DepNodeIndex } from "../dep_graph/graph.ts";
import { StableHashState } from "../ich.ts";
import type { Providers as HookProviders } from "../hooks.ts";
import type { ModChild, ResolverAstLowering } from "../middle/resolve.ts";
import type { QueryTypes } from "../queries.gen.ts";
import { type IntoQueryKey, into_query_key_DefId } from "../query/into_query_key.ts";
import type { QuerySystem } from "../query/system.ts";
import * as calls from "../query/calls.ts";
import type { TyCtxtAt, TyCtxtEnsureDone, TyCtxtEnsureOk, TyCtxtEnsureResult } from "../query/calls.ts";
import * as hir_mod from "../hir/mod.ts";
import * as ty_mod from "./mod.ts";
import { enter_context, ImplicitCtxt } from "./context/tls.ts";
import { Visibility } from "./mod.ts";
import type { Ordering } from "./mod.ts";

/**
 * PORT: `rustc_session::Limits` (session.rs:62; `#[derive(Copy, Clone, Debug, ..)]`) is not ported; this is its
 * shape, as returned by the `limits` query (rustc_interface/src/limits.rs, pending).
 */
export interface Limits {
  /// The maximum recursion limit for potentially infinitely recursive
  /// operations such as auto-dereference and monomorphization.
  recursion_limit: Limit;
  /// The size at which the `large_assignments` lint starts
  /// being emitted.
  move_size_limit: Limit;
  /// The maximum length of types during monomorphization.
  type_length_limit: Limit;
  /// The maximum pattern complexity allowed (internal only).
  pattern_complexity_limit: Limit;
}

/// This struct should only be created by `create_def`.
export class TyCtxtFeed<K> {
  constructor(
    public tcx: TyCtxt,
    // Do not allow direct access, as downstream code must not mutate this field.
    private readonly key_: K,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/context.rs:635 key
  key(): K {
    return this.key_;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:642 def_id
  def_id(this: TyCtxtFeed<LocalDefId>): LocalDefId {
    return this.key_;
  }

  // Caller must ensure that `self.key` ID is indeed an owner.
  // rustc: compiler/rustc_middle/src/ty/context.rs:647 feed_owner_id
  feed_owner_id(this: TyCtxtFeed<LocalDefId>): TyCtxtFeed<OwnerId> {
    return new TyCtxtFeed(this.tcx, new OwnerId(this.key_));
  }

  // Fills in all the important parts needed by HIR queries
  // rustc: compiler/rustc_middle/src/ty/context.rs:652 feed_hir
  feed_hir(this: TyCtxtFeed<LocalDefId>): void {
    // `self.hir_owner(ProjectedMaybeOwner::Owner(..))` + `hir_attr_map(hir::AttributeMap::EMPTY)`
    unported("rustc_middle::ty::context::TyCtxtFeed::feed_hir (HIR, M3)");
  }
}

/// The central data structure of the compiler. It stores references
/// to the various **arenas** and also houses the results of the
/// various **compiler queries** that have been performed. See the
/// [rustc dev guide] for more details.
///
/// [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/ty.html
///
/// An implementation detail: `TyCtxt` is a wrapper type for [GlobalCtxt],
/// which is the struct that actually holds all the data. `TyCtxt` derefs to
/// `GlobalCtxt`, and in practice `TyCtxt` is passed around everywhere, and all
/// operations are done via `TyCtxt`. A `TyCtxt` is obtained for a `GlobalCtxt`
/// by calling `enter` with a closure `f`. That function creates both the
/// `TyCtxt`, and an `ImplicitCtxt` around it that is put into TLS. Within `f`:
/// - The `ImplicitCtxt` is available implicitly via TLS.
/// - The `TyCtxt` is available explicitly via the `tcx` parameter, and also
///   implicitly within the `ImplicitCtxt`. Explicit access is preferred when
///   possible.
export class TyCtxt {
  constructor(readonly gcx: GlobalCtxt) {}

  // impl Deref for TyCtxt { type Target = &'tcx GlobalCtxt<'tcx>; }
  get sess(): Session {
    return this.gcx.sess;
  }
  get dep_graph(): DepGraph {
    return this.gcx.dep_graph;
  }
  get prof(): SelfProfilerRef {
    return this.gcx.prof;
  }
  get hooks(): HookProviders {
    return this.gcx.hooks;
  }
  get query_system(): QuerySystem {
    return this.gcx.query_system;
  }

  // ---- methods ported in other files (PORTING §8: declared here, bodies there) ----
  // query/calls.rs
  typeck(def_id: IntoQueryKey<LocalDefId>): unknown {
    return calls.TyCtxt_typeck(this, def_id);
  }
  at(span: Span): TyCtxtAt {
    return calls.TyCtxt_at(this, span);
  }
  ensure_ok(): TyCtxtEnsureOk {
    return calls.TyCtxt_ensure_ok(this);
  }
  ensure_result(): TyCtxtEnsureResult {
    return calls.TyCtxt_ensure_result(this);
  }
  ensure_done(): TyCtxtEnsureDone {
    return calls.TyCtxt_ensure_done(this);
  }
  // ty/mod.rs
  opt_parent(id: DefId): DefId | undefined {
    return ty_mod.TyCtxt_opt_parent(this, id);
  }
  parent(id: DefId): DefId {
    return ty_mod.TyCtxt_parent(this, id);
  }
  opt_local_parent(id: LocalDefId): LocalDefId | undefined {
    return ty_mod.TyCtxt_opt_local_parent(this, id);
  }
  local_parent(id: LocalDefId | LocalModId): LocalDefId {
    return ty_mod.TyCtxt_local_parent(this, id);
  }
  def_id_partial_cmp(lhs: DefId, rhs: DefId): Ordering | undefined {
    return ty_mod.TyCtxt_def_id_partial_cmp(this, lhs, rhs);
  }
  is_descendant_of(descendant: IntoQueryKey<DefId>, ancestor: IntoQueryKey<DefId>): boolean {
    return ty_mod.TyCtxt_is_descendant_of(this, descendant, ancestor);
  }
  opt_item_name(def_id: IntoQueryKey<DefId>): Symbol | undefined {
    return ty_mod.TyCtxt_opt_item_name(this, def_id);
  }
  item_name(id: IntoQueryKey<DefId>): Symbol {
    return ty_mod.TyCtxt_item_name(this, id);
  }
  // hir/mod.rs
  parent_module_from_def_id(id: LocalDefId): LocalModId {
    return hir_mod.TyCtxt_parent_module_from_def_id(this, id);
  }
  // ty/print/pretty.rs
  def_path_str(def_id: IntoQueryKey<DefId>): string {
    void def_id;
    return unported("rustc_middle::ty::print::pretty::TyCtxt::def_path_str (ty::print, M3)");
  }

  /// Can only be fed before queries are run, and is thus exempt from any
  /// incremental issues. Do not use except for the initial query feeding.
  // rustc: compiler/rustc_middle/src/ty/context.rs:593 feed_unit_query
  feed_unit_query(): TyCtxtFeed<null> {
    this.dep_graph.assert_ignored();
    return new TyCtxtFeed(this, null);
  }

  /// Only used in the resolver to register the `CRATE_DEF_ID` `DefId` and feed
  /// some queries for it. It will panic if used twice.
  // rustc: compiler/rustc_middle/src/ty/context.rs:600 create_local_crate_def_id
  create_local_crate_def_id(span: Span): TyCtxtFeed<LocalDefId> {
    // `AppendOnlyIndexVec::push` returns the new index.
    const source_span = this.untracked().source_span;
    source_span.push(span);
    const key = LocalDefId.new(source_span.length - 1);
    assert_eq(key, CRATE_DEF_ID, (v) => String(v));
    return new TyCtxtFeed(this, key);
  }

  /// In order to break cycles involving `AnonConst`, we need to set the expected type by side
  /// effect. However, we do not want this as a general capability, so this interface restricts
  /// to the only allowed case.
  // rustc: compiler/rustc_middle/src/ty/context.rs:609 feed_anon_const_type
  feed_anon_const_type(key: LocalDefId, value: QueryTypes["type_of"]["ProvidedValue"]): void {
    // debug_assert_eq!(self.def_kind(key), DefKind::AnonConst);
    // debug_assert!(self.anon_const_kind(key) != ty::AnonConstKind::NonTypeSystemInline);
    new TyCtxtFeed(this, key).type_of(value);
  }

  // Trait impl item visibility is inherited from its trait when not specified
  // explicitly. In that case we cannot determine it in early resolve,
  // but instead are feeding it in late resolve, where we don't have access to the
  // `TyCtxtFeed` anymore.
  // To avoid having to hash the `LocalDefId` multiple times for inserting and removing the
  // `TyCtxtFeed` from a hash table, we add this hack to feed the visibility.
  // Do not use outside of the resolver query.
  // rustc: compiler/rustc_middle/src/ty/context.rs:622 feed_visibility_for_trait_impl_item
  feed_visibility_for_trait_impl_item(key: LocalDefId, vis: Visibility<LocalModId>): void {
    // `if cfg!(debug_assertions) { .. }`: rustc ships without debug assertions.
    new TyCtxtFeed(this, key).visibility(Visibility.to_mod_id(vis));
  }

  /// Creates a type context. To use the context call `fn enter` which
  /// provides a `TyCtxt`.
  ///
  /// By only providing the `TyCtxt` inside of the closure we enforce that the type
  /// context and any interned value (types, args, etc.) can only be used while `ty::tls`
  /// has a valid reference to the context, to allow formatting values that need it.
  // rustc: compiler/rustc_middle/src/ty/context.rs:945 create_global_ctxt
  static create_global_ctxt<T>(
    gcx_cell: { value: GlobalCtxt | undefined },
    sess: Session,
    crate_types: CrateType[],
    stable_crate_id: StableCrateId,
    untracked: Untracked,
    incr_comp_session: undefined,
    dep_graph: DepGraph,
    query_system: QuerySystem,
    hooks: HookProviders,
    current_gcx: CurrentGcx,
    f: (tcx: TyCtxt) => T,
  ): T {
    // PORT: `let data_layout = sess.target.parse_data_layout().unwrap_or_else(..)` is deferred to the
    // first read of `gcx.data_layout` (module comment). `CtxtInterners::new(arena)`, `CommonTypes::new`,
    // `CommonLifetimes::new`, `CommonConsts::new`: not ported (no `Ty` yet).
    if (gcx_cell.value === undefined) {
      gcx_cell.value = new GlobalCtxt(sess, crate_types, stable_crate_id, incr_comp_session, dep_graph, sess.prof, hooks, untracked, query_system, current_gcx);
    }
    const gcx = gcx_cell.value;

    // This is a separate function to work around a crash with parallel rustc (#135870)
    return gcx.enter(f);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1089 features
  features(): Features {
    return this.features_query(null) as Features;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1093 def_key
  def_key(id: IntoQueryKey<DefId>): DefKey {
    const id_ = into_query_key_DefId(id);
    // Accessing the DefKey is ok, since it is part of DefPathHash.
    const local = id_.as_local();
    if (local !== undefined) {
      return this.definitions_untracked().def_key(local);
    } else {
      return this.cstore_untracked().def_key(id_);
    }
  }

  /// Converts a `DefId` into its fully expanded `DefPath` (every
  /// `DefId` is really just an interned `DefPath`).
  ///
  /// Note that if `id` is not local to this crate, the result will
  ///  be a non-local `DefPath`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1108 def_path
  def_path(id: DefId): DefPath {
    // Accessing the DefPath is ok, since it is part of DefPathHash.
    const local = id.as_local();
    if (local !== undefined) {
      return this.definitions_untracked().def_path(local);
    } else {
      return this.cstore_untracked().def_path(id);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1118 def_path_hash
  def_path_hash(def_id: DefId): DefPathHash {
    // Accessing the DefPathHash is ok, it is incr. comp. stable.
    const local = def_id.as_local();
    if (local !== undefined) {
      return this.definitions_untracked().def_path_hash(local);
    } else {
      return this.cstore_untracked().def_path_hash(def_id);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1128 crate_types
  crate_types(): readonly CrateType[] {
    return this.gcx.crate_types;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1132 needs_metadata
  needs_metadata(): boolean {
    return (
      this.crate_types().some((ty) => {
        switch (ty) {
          case "Executable":
          case "StaticLib":
          case "Cdylib":
          case "Sdylib":
            return false;
          case "Rlib":
          case "Dylib":
          case "ProcMacro":
            return true;
        }
      }) && !this.sess.opts.actually_rustdoc
    );
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1183 stable_crate_id
  stable_crate_id(crate_num: CrateNum): StableCrateId {
    if (crate_num === LOCAL_CRATE) {
      return this.gcx.stable_crate_id;
    } else {
      return this.cstore_untracked().stable_crate_id(crate_num);
    }
  }

  /// Maps a StableCrateId to the corresponding CrateNum. This method assumes
  /// that the crate in question has already been loaded by the CrateStore.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1194 stable_crate_id_to_crate_num
  stable_crate_id_to_crate_num(stable_crate_id: StableCrateId): CrateNum {
    if (stable_crate_id === this.stable_crate_id(LOCAL_CRATE)) {
      return LOCAL_CRATE;
    } else {
      const cnum = this.untracked().stable_crate_ids.get(stable_crate_id);
      if (cnum === undefined) panic(`uninterned StableCrateId: ${debug_StableCrateId(stable_crate_id, PLAIN)}`);
      return cnum;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1246 dcx
  dcx(): DiagCtxtHandle {
    return this.sess.dcx();
  }

  /// `tcx`-dependent operations performed for every created definition.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1320 create_def
  create_def(
    parent: LocalDefId,
    name: Symbol | undefined,
    def_kind: DefKind,
    override_def_path_data: DefPathData | undefined,
    disambiguator: PerParentDisambiguatorState,
  ): TyCtxtFeed<LocalDefId> {
    const data = override_def_path_data ?? DefKind.def_path_data(def_kind, name);
    // The following call has the side effect of modifying the tables inside `definitions`.
    // These very tables are relied on by the incr. comp. engine to decode DepNodes and to
    // decode the on-disk cache.
    //
    // Any LocalDefId which is used within queries, either as key or result, either:
    // - has been created before the construction of the TyCtxt;
    // - has been created by this call to `create_def`.
    // As a consequence, this LocalDefId is always re-created before it is needed by the incr.
    // comp. engine itself.
    const def_id = this.gcx.untracked.definitions.create_def(parent, data, disambiguator);

    // This function modifies `self.definitions` using a side-effect.
    // We need to ensure that these side effects are re-run by the incr. comp. engine.
    // Depending on the forever-red node will tell the graph that the calling query
    // needs to be re-evaluated.
    this.dep_graph.read_index(DepNodeIndex.FOREVER_RED_NODE);

    const feed = new TyCtxtFeed(this, def_id);
    feed.def_kind(def_kind);
    // Unique types created for closures participate in type privacy checking.
    // They have visibilities inherited from the module they are defined in.
    // Visibilities for opaque types are meaningless, but still provided
    // so that all items have visibilities.
    if (def_kind.$ === "Closure" || def_kind.$ === "OpaqueTy") {
      const parent_mod = this.parent_module_from_def_id(def_id);
      feed.visibility(Visibility.Restricted(LocalModId.to_mod_id(parent_mod)));
    }

    return feed;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1360 create_crate_num
  create_crate_num(stable_crate_id: StableCrateId): Result<TyCtxtFeed<CrateNum>, CrateNum> {
    const lock = this.untracked().stable_crate_ids;
    const existing = lock.get(stable_crate_id);
    if (existing !== undefined) {
      return Err(existing);
    }
    const num = lock.size as CrateNum; // `CrateNum::new(lock.len())`
    lock.set(stable_crate_id, num);
    return Ok(new TyCtxtFeed(this, num));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1394 definitions
  definitions(): Definitions {
    // Depend on the `analysis` query to ensure compilation if finished.
    this.ensure_ok().analysis(null);

    // Freeze definitions once we start iterating on them, to prevent adding new ones
    // while iterating. If some query needs to add definitions, it should be `ensure`d above.
    // PORT: `FreezeLock::freeze` is a no-op (PORTING §5: the lock is its inner value).
    return this.gcx.untracked.definitions;
  }

  /// Note that this is *untracked* and should only be used within the query
  /// system if the result is otherwise tracked through queries
  // rustc: compiler/rustc_middle/src/ty/context.rs:1415 cstore_untracked
  cstore_untracked(): CrateStoreDyn {
    return this.gcx.untracked.cstore;
  }

  /// Give out access to the untracked data without any sanity checks.
  // rustc: compiler/rustc_middle/src/ty/context.rs:1420 untracked
  untracked(): Untracked {
    return this.gcx.untracked;
  }

  /// Note that this is *untracked* and should only be used within the query
  /// system if the result is otherwise tracked through queries
  // rustc: compiler/rustc_middle/src/ty/context.rs:1426 definitions_untracked
  definitions_untracked(): Definitions {
    return this.gcx.untracked.definitions;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1431 with_stable_hashing_context
  with_stable_hashing_context<R>(f: (hcx: StableHashState) => R): R {
    return f(StableHashState.new(this.sess, this.gcx.untracked));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1436 local_crate_exports_generics
  local_crate_exports_generics(): boolean {
    // compiler-builtins has some special treatment in codegen, which can result in confusing
    // behavior if another crate ends up calling into its monomorphizations.
    // https://github.com/rust-lang/rust/issues/150173
    if (this.is_compiler_builtins(LOCAL_CRATE)) {
      return false;
    }
    return this.crate_types().some((crate_type) => {
      switch (crate_type) {
        case "Executable":
        case "StaticLib":
        case "ProcMacro":
        case "Cdylib":
        case "Sdylib":
          return false;

        // FIXME rust-lang/rust#64319, rust-lang/rust#64872:
        // We want to block export of generics from dylibs,
        // but we must fix rust-lang/rust#65890 before we can
        // do that robustly.
        case "Dylib":
          return true;

        case "Rlib":
          return true;
      }
    });
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1569 type_length_limit
  type_length_limit(): Limit {
    return this.limits(null).type_length_limit;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1573 recursion_limit
  recursion_limit(): Limit {
    return this.limits(null).recursion_limit;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1577 move_size_limit
  move_size_limit(): Limit {
    return this.limits(null).move_size_limit;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1581 pattern_complexity_limit
  pattern_complexity_limit(): Limit {
    return this.limits(null).pattern_complexity_limit;
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1603 local_visibility
  local_visibility(def_id: LocalDefId): Visibility<LocalModId> {
    return Visibility.expect_local(this.visibility(def_id));
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:1613 finish
  finish(): void {
    // We assume that no queries are run past here. If there are new queries
    // after this point, they'll show up as "<unknown>" in self-profiling data.
    this.alloc_self_profile_query_strings();

    this.save_dep_graph();
    this.verify_query_key_hashes();

    const r = this.dep_graph.finish_encoding();
    if (r.$ !== "Ok") {
      // self.sess.dcx().emit_fatal(crate::diagnostics::FailedWritingFile { path: &path, error });
      unported("rustc_middle::diagnostics::FailedWritingFile (dep graph encoding, D3)");
    }
  }

  /// In addition to regular items this list also includes struct and variant constructors, and
  /// items inside `extern {}` blocks because all of them introduce names into parent module.
  ///
  /// Module here is understood in name resolution sense - it can be a `mod` item,
  /// or a crate root, or an enum, or a trait.
  ///
  /// This is not a query, making it a query causes perf regressions
  /// (probably due to hashing spans in `ModChild`ren).
  // rustc: compiler/rustc_middle/src/ty/context.rs:2893 module_children_local
  module_children_local(def_id: LocalDefId): readonly ModChild[] {
    return this.resolutions(null).module_children.get(def_id) ?? [];
  }

  /// Return the crate imported by given use item.
  // rustc: compiler/rustc_middle/src/ty/context.rs:2898 extern_mod_stmt_cnum
  extern_mod_stmt_cnum(def_id: LocalDefId): CrateNum | undefined {
    return this.resolutions(null).extern_crate_map.get(def_id);
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:2902 resolver_for_lowering
  resolver_for_lowering(): [Steal<ResolverAstLowering>, Steal<Crate>] {
    const [resolver, krate] = this.resolver_for_lowering_raw(null);
    return [resolver, krate];
  }
}


/// Create a new definition within the incr. comp. engine.
// rustc: compiler/rustc_middle/src/ty/context.rs:1302 create_def
export function TyCtxtAt_create_def(
  self: TyCtxtAt,
  parent: LocalDefId,
  name: Symbol | undefined,
  def_kind: DefKind,
  override_def_path_data: DefPathData | undefined,
  disambiguator: PerParentDisambiguatorState,
): TyCtxtFeed<LocalDefId> {
  const feed = self.tcx.create_def(parent, name, def_kind, override_def_path_data, disambiguator);

  feed.def_span(self.span);
  return feed;
}

/// See [TyCtxt] for details about this type.
export class GlobalCtxt {
  private data_layout_: unknown = undefined;

  constructor(
    public sess: Session,
    public crate_types: CrateType[],
    /// The `stable_crate_id` is constructed out of the crate name and all the
    /// `-C metadata` arguments passed to the compiler. Its value forms a unique
    /// global identifier for the crate. It is used to allow multiple crates
    /// with the same name to coexist. See the
    /// `rustc_symbol_mangling` crate for more information.
    public stable_crate_id: StableCrateId,

    public incr_comp_session: undefined,
    public dep_graph: DepGraph,

    /// This duplicates `Session::prof` because this field is hot enough that accessing it via
    /// `self.sess.prof` is a measurable slowdown (see #161332).
    public prof: SelfProfilerRef,

    /// Hooks to be able to register functions in other crates that can then still
    /// be called from rustc_middle.
    public hooks: HookProviders,

    public untracked: Untracked,

    public query_system: QuerySystem,

    public current_gcx: CurrentGcx,
  ) {}

  /// Data layout specification for the current target.
  get data_layout(): unknown {
    if (this.data_layout_ === undefined) {
      this.data_layout_ = unported("rustc_target::spec::Target::parse_data_layout (GlobalCtxt::data_layout; pending target-cfg / rustc_abi)");
    }
    return this.data_layout_;
  }

  /// Installs `self` in a `TyCtxt` and `ImplicitCtxt` for the duration of
  /// `f`.
  // rustc: compiler/rustc_middle/src/ty/context.rs:792 enter
  enter<R>(f: (tcx: TyCtxt) => R): R {
    const icx = ImplicitCtxt.new(this);

    // Set this `GlobalCtxt` as the current one.
    {
      assert(this.current_gcx.value === undefined, "no `GlobalCtxt` is currently set");
      this.current_gcx.value = this;
    }

    // Reset `current_gcx` to `None` when we exit.
    try {
      return enter_context(icx, () => f(icx.tcx));
    } finally {
      this.current_gcx.value = undefined;
    }
  }
}

/// This is used to get a reference to a `GlobalCtxt` if one is available.
///
/// This is needed to allow the deadlock handler access to `GlobalCtxt` to look for query cycles.
/// It cannot use the `TLV` global because that's only guaranteed to be defined on the thread
/// creating the `GlobalCtxt`. Other threads have access to the `TLV` only inside Rayon jobs, but
/// the deadlock handler is not called inside such a job.
export class CurrentGcx {
  /// This stores a pointer to a `GlobalCtxt`. This is set to `Some` inside `GlobalCtxt::enter`
  /// and reset to `None` when that function returns or unwinds.
  /** PORT: `Arc<RwLock<Option<*const ()>>>` -> the `GlobalCtxt` itself (single-threaded). */
  value: GlobalCtxt | undefined = undefined;

  // rustc: compiler/rustc_middle/src/ty/context.rs:831 new
  static new(): CurrentGcx {
    return new CurrentGcx();
  }

  // rustc: compiler/rustc_middle/src/ty/context.rs:835 access
  access<R>(f: (gcx: GlobalCtxt) => R): R {
    const gcx = this.value;
    if (gcx === undefined) panic("called `Option::unwrap()` on a `None` value");
    // SAFETY: We hold the read lock for the `GlobalCtxt` pointer. That prevents
    // `GlobalCtxt::enter` from returning as it would first acquire the write lock.
    // This ensures the `GlobalCtxt` is live during `f`.
    return f(gcx);
  }
}

// rustc: compiler/rustc_middle/src/ty/context.rs:2951 provide
export function provide(providers: import("../queries.gen.ts").Providers): void {
  providers.is_panic_runtime = (_tcx, _local_crate) => unported("rustc_middle::ty::context::provide: is_panic_runtime (`find_attr!(tcx, crate, PanicRuntime)`, pending attribute parsing)");
  providers.is_compiler_builtins = (_tcx, _local_crate) => unported("rustc_middle::ty::context::provide: is_compiler_builtins (`find_attr!(tcx, crate, CompilerBuiltins)`, pending attribute parsing)");
  providers.has_panic_handler = (_tcx, _local_crate) => {
    // We want to check if the panic handler was defined in this crate
    return unported("rustc_middle::ty::context::provide: has_panic_handler (`tcx.lang_items().panic_impl()`, pending lang items)");
  };
  providers.source_span = (tcx, def_id) => tcx.untracked().source_span[LocalDefId.index(def_id)] ?? DUMMY_SP;
}

