// Port of compiler/rustc_mir_build/src/builder/mod.rs (lane builder-contract, plan-m4 wave 22): the `Builder` contract.
// The types of builder/* are generated with their derived Debug / Clone into `*.gen.ts` (tools/codegen/types.ts, set
// rustc_mir_build_builder); `Builder` (hand class, below) and `BlockAnd` (a tuple, below) are hand-written. Every fn of
// builder/* and check_tail_calls.rs is either ported (`// rustc:` marker) or declared as a stub (`// stub: <path>:<line>
// <name> (lane <lane>)` directly over its final signature, body `unported(..)` naming its module); the stubs per fill
// lane are the split table of docs/handoff/builder-contract.md, which also has "How to fill a stub".
//
// PORT (methods across files, PORTING §5): `impl Builder` is split over every file of builder/*. Each file mirrors its
// upstream file: it declares its methods in `declare module "<..>/mod.ts" { interface Builder { .. } }` and assigns them
// with `Builder.prototype.<name> = function (this: Builder, ..) { .. }`; the methods of mod.rs are in the class body.
// Methods of the other builder types (generated classes `CFG`, `Scopes`, `DropTree`, `PlaceBuilder`, `Candidate`, ...)
// are declared by augmenting their `.gen.ts` module (`interface X` / `namespace X` for associated fns, assigned as
// `(X as unknown as { f: typeof X.f }).f = ..`, `new` -> `new_` exported as `new`); methods of enums go on the
// companion (`<Enum>_methods`, PORTING §8: `BlockFrame.is_tail_expr(self)`).
//
// PORT (init order): this module imports only `*.gen.ts` modules of builder/ (and other crates), never an extension
// module (they import this one for `Builder`, and an import cycle through this module would leave `Builder` in its TDZ
// when they run). Every other builder module imports `Builder` from here, so it is evaluated after this one; free fns of
// other builder modules that this module calls (`custom::build_custom_mir`) are read lazily (`require`) inside the
// function that calls them. The crate root (lib.ts) imports this module first, then every extension module.
//
// PORT (conventions; docs/handoff/builder-contract.md "Conventions"):
// - `BlockAnd<T>` is the tuple `[BasicBlock, T]`; `unpack!(block = e)` is `[block, x] = e` (with `let x: T;`
//   declared first when the macro's value is bound by `let`), `e.into_block()` is `BlockAnd.into_block(e)`,
//   `block.and(v)` / `block.unit()` are `and(block, v)` / `unit(block)`. `()` as a type argument is `null` (codegen's
//   mapping: `BlockAnd<()>` is `BlockAnd<null>`, `PResult<()>` is `PResult<null>`).
// - `let this = self;` (LET_THIS_SELF) is `this`; the closures `|this| ..` / `|builder| ..` that methods hand the builder
//   to take it as their parameter (`(this_) => ..`, PORTING §4: `this` is reserved).
// - `&mut BasicBlock` / `&mut Option<BasicBlock>` out-parameters are `MutRef<..>` (PORTING §8).
// - Maps keyed by structs (`FxHashMap<LocalVarId, _>`, `FxHashMap<DropNodeKey, _>`, `FxIndexMap<TestBranch, _>`,
//   `FxIndexMap<Place, _>`, ...) are `KeyedMap`s (rust_ts/keyed.ts) with the key fns of their modules (`key_LocalVarId`
//   here); a `KeyedMap` is a `Map`, so the generated field types (`Map<K, V>`) hold them.
// - `SourceInfo`, `Place`, `region::Scope` are `Copy` classes: clone them (`clone_SourceInfo`, ...) where rustc copies one
//   into a place that is later mutated in place (PORTING §8), e.g. `LocalDecl.source_info`. Statements and terminators
//   are copied where they enter the MIR (`CFG::push` / `CFG::terminate`, cfg.ts header), so a `Place` / `SourceInfo`
//   given to them may be reused by the caller.
//! This module used to be named `build`, but that was causing GitHub's
//! "Go to file" feature to silently ignore all files in the module, probably
//! because it assumes that "build" is a build-output directory.
//! See <https://github.com/rust-lang/rust/pull/134365>.
//!
//! ## The `let this = self;` idiom (LET_THIS_SELF)
//!
//! Throughout MIR building there are several places where a `Builder` method
//! needs to borrow `self`, and then re-expose it to a closure as `|this|`.
//!
//! In complex builder methods, potentially with multiple levels of nesting, it
//! would thus become necessary to mentally keep track of whether the builder
//! is `self` (at the top level) or `this` (nested in a closure), or to replace
//! one with the other when moving code in or out of a closure.
//!
//! (The borrow checker will prevent incorrect usage, but having to go back and
//! satisfy the borrow checker still creates contributor friction.)
//!
//! To reduce that friction, some builder methods therefore start with
//! `let this = self;` or similar, allowing subsequent code to uniformly refer
//! to the builder as `this` (and never `self`), even when not nested.
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { FieldIdx } from "../../rustc_abi/lib.ts";
import { BindingMode, ByRef } from "../../rustc_ast/lib.ts";
import { type FloatTy } from "../../rustc_ast_ir/lib.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { SortedIndexMultiMap } from "../../rustc_data_structures/sorted_map/index_map.ts";
import { SortedIndexMultiMap as SortedIndexMultiMapC } from "../../rustc_data_structures/sorted_map/index_map.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { debug_OwnerId, type HirId, HirId_key, type ItemLocalId, type OwnerId, OwnerId_eq } from "../../rustc_hir_id/lib.ts";
import { GrowableBitSet } from "../../rustc_index/bit_set.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { type Scope as region_Scope, Scope as RegionScope, ScopeData, type ScopeTree } from "../../rustc_middle/middle/region.ts";
import {
  type BasicBlock,
  BasicBlockData,
  Body,
  ClearCrossCrate,
  type ConstValue,
  CoroutineInfo,
  Local,
  LocalDecl,
  type LocalInfo,
  MirSource,
  OUTERMOST_SOURCE_SCOPE,
  Place,
  Place_from_Local,
  type PlaceElem,
  ProjectionElem,
  SourceInfo,
  type SourceScope,
  SourceScopeData,
  type SourceScopeLocalData,
  START_BLOCK,
  Statement,
  type StatementKind,
  Terminator,
  TerminatorKind,
  type VarDebugInfo,
  clone_SourceInfo,
  Const,
  ConstOperand,
  type ConstOperand as ConstOperandT,
  type FakeReadCause,
  type Rvalue,
} from "../../rustc_middle/mir/mod.ts";
import type { UnrollAttr } from "../../rustc_attr_ir/lib.ts";
import { MirWriter } from "../../rustc_middle/mir/pretty.ts";
import type { CanonicalUserTypeAnnotations } from "../../rustc_middle/ty/typeck_results.ts";
import type { CoroutineKind } from "../../rustc_hir/hir.ts";
import { FnRetTy } from "../../rustc_hir/hir.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import type { BodyTy, ExprId, LocalVarId, Param, Thir } from "../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { HasAttrs_HirId, type ParamEnv, type Ty, Ty as TyC, type TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { CAPTURE_STRUCT_LOCAL } from "../../rustc_middle/ty/closure.ts";
import { type UpvarArgs, UpvarArgs as UpvarArgsC } from "../../rustc_middle/ty/sty.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { type Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { set_aliases_to_rigid } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs, CoroutineClosureSignature } from "../../rustc_type_ir/ty_kind/closure.ts";
import {
  type CoroutineClosureSignature as CoroutineClosureSignatureT,
  fold_with_CoroutineClosureSignature,
  try_fold_with_CoroutineClosureSignature,
  visit_with_CoroutineClosureSignature,
} from "../../rustc_type_ir/ty_kind/closure.gen.ts";
import { FnSig, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { display_f64, PLAIN } from "../../std/fmt.ts";
import { unwrap_result } from "../../std/result.ts";
import { debug_IoError } from "../../std/io.ts";
import { assert, assert_eq, panic, unported } from "../../std/panic.ts";
import { stdout } from "../../vendor/anstream/stream.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";
import { debug_ParseError } from "../../vendor/rustc_apfloat/lib.ts";
import * as gen from "./mod.gen.ts";
import { BlockContext, type Capture, type CaptureMap, CFG, type ForGuard, GuardFrameLocal, type GuardFrame } from "./mod.gen.ts";
import { CoverageInfoBuilder } from "./coverageinfo.gen.ts";
import { LintLevel, Scopes } from "./scope.gen.ts";
import type * as custom_mod from "./custom/mod.ts";

export * from "./mod.gen.ts";

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:47 closure_saved_names_of_captured_variables
export function closure_saved_names_of_captured_variables(tcx: TyCtxt, def_id: LocalDefId): Symbol[] {
  return tcx.closure_captures(def_id).map((captured_place) => {
    const name = captured_place.to_symbol();
    switch (captured_place.info.capture_kind.$) {
      case "ByValue":
      case "ByUse":
        return name;
      case "ByRef":
        return Symbol.intern(`_ref__${Symbol.as_str(name)}`);
    }
  });
}

/// Create the MIR for a given `DefId`, including unreachable code.
///
/// This is the implementation of hook `build_mir_inner_impl`, which should only
/// be called by the query `mir_built`.
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:67 build_mir_inner_impl
export function build_mir_inner_impl(tcx: TyCtxt, def: LocalDefId): Body {
  tcx.ensure_done().thir_abstract_const(def);
  const e = tcx.ensure_result().check_match(def);
  if (e.$ === "Err") {
    return construct_error(tcx, def, e._0);
  }

  const err = tcx.ensure_result().check_tail_calls(def);
  if (err.$ === "Err") {
    return construct_error(tcx, def, err._0);
  }

  let body: Body;
  // PORT: queries.gen.ts types `thir_body`'s value loosely (`[Steal<unknown>, unknown]`); it is `(&Steal<Thir>, ExprId)`.
  const r = tcx.thir_body(def) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: ErrorGuaranteed };
  switch (r.$) {
    case "Err": {
      const error_reported = r._0;
      body = construct_error(tcx, def, error_reported);
      break;
    }
    case "Ok": {
      const [thir, expr] = r._0;
      const build_mir = (thir: Thir): Body => {
        const body_type: BodyTy = thir.body_type;
        switch (body_type.$) {
          case "Fn":
            return construct_fn(tcx, def, thir, expr, body_type._0);
          case "Const":
          case "GlobalAsm":
            return construct_const(tcx, def, thir, expr, body_type._0);
        }
      };

      // Don't steal here, instead steal in unsafeck. This is so that
      // pattern inline constants can be evaluated as part of building the
      // THIR of the parent function without a cycle.
      body = build_mir(thir.borrow());
      break;
    }
  }

  // The borrow checker will replace all the regions here with its own
  // inference variables. There's no point having non-erased regions here.
  // The exception is `body.user_type_annotations`, which is used unmodified
  // by borrow checking.
  // debug_assert!(
  //     !(body.local_decls.has_free_regions()
  //         || body.basic_blocks.has_free_regions()
  //         || body.var_debug_info.has_free_regions()
  //         || body.yield_ty().has_free_regions()),
  //     "Unexpected free regions in MIR: {body:?}",
  // );

  return body;
}

///////////////////////////////////////////////////////////////////////////
// BuildMir -- walks a crate, looking for fn items and methods to build MIR from

export interface BlockFrame_methods {
  is_tail_expr(self: BlockFrame): boolean;
  is_statement(self: BlockFrame): boolean;
}
export type BlockFrame = gen.BlockFrame;
export const BlockFrame = gen.BlockFrame as typeof gen.BlockFrame & BlockFrame_methods;

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:139 is_tail_expr
BlockFrame.is_tail_expr = function (self: BlockFrame): boolean {
  switch (self.$) {
    case "TailExpr":
      return true;

    case "Statement":
    case "SubExpr":
      return false;
  }
};
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:146 is_statement
BlockFrame.is_statement = function (self: BlockFrame): boolean {
  switch (self.$) {
    case "Statement":
      return true;

    case "TailExpr":
    case "SubExpr":
      return false;
  }
};

/** `FxHashMap<LocalVarId, _>` key (`LocalVarId(HirId)`, derived `Hash` + `Eq`): a `KeyedMap` key fn. */
export function key_LocalVarId(id: LocalVarId): string | number {
  return HirId_key(id._0);
}

// rustc-type: compiler/rustc_mir_build/src/builder/mod.rs:158 Builder
export class Builder {
  constructor(
    public tcx: TyCtxt,
    // FIXME(@lcnr): Why does this use an `infcx`, there should be
    // no shared type inference going on here. I feel like it would
    // clearer to manually construct one where necessary or to provide
    // a nice API for non-type inference trait system checks.
    public infcx: InferCtxt,
    public region_scope_tree: ScopeTree,
    public param_env: ParamEnv,

    public thir: Thir,
    public cfg: CFG,

    public def_id: LocalDefId,
    public hir_id: HirId,
    public check_overflow: boolean,
    public fn_span: Span,
    public arg_count: number,
    public coroutine: CoroutineInfo | undefined,

    /// The current set of scopes, updated as we traverse;
    /// see the `scope` module for more details.
    public scopes: Scopes,

    /// The block-context: each time we build the code within an thir::Block,
    /// we push a frame here tracking whether we are building a statement or
    /// if we are pushing the tail expression of the block. This is used to
    /// embed information in generated temps about whether they were created
    /// for a block tail expression or not.
    ///
    /// It would be great if we could fold this into `self.scopes`
    /// somehow, but right now I think that is very tightly tied to
    /// the code generation in ways that we cannot (or should not)
    /// start just throwing new entries onto that vector in order to
    /// distinguish the context of EXPR1 from the context of EXPR2 in
    /// `{ STMTS; EXPR1 } + EXPR2`.
    public block_context: BlockContext,

    /// The vector of all scopes that we have created thus far;
    /// we track this for debuginfo later.
    public source_scopes: SourceScopeData[],
    public source_scope: SourceScope,

    /// The guard-context: each time we build the guard expression for
    /// a match arm, we push onto this stack, and then pop when we
    /// finish building it.
    public guard_context: GuardFrame[],

    /// Temporaries with fixed indexes. Used so that if-let guards on arms
    /// with an or-pattern are only created once.
    public fixed_temps: Map<ExprId, Local>,
    /// Scope of temporaries that should be deduplicated using [Self::fixed_temps].
    public fixed_temps_scope: region_Scope | undefined,

    /// Maps `HirId`s of variable bindings to the `Local`s created for them.
    /// (A match binding can have two locals; the 2nd is for the arm's guard.)
    // PORT: `FxHashMap<LocalVarId, LocalsForNode>`: a `KeyedMap` keyed by `key_LocalVarId`.
    public var_indices: KeyedMap<LocalVarId, LocalsForNode>,
    public local_decls: LocalDecl[],
    public canonical_user_type_annotations: CanonicalUserTypeAnnotations,
    public upvars: CaptureMap,
    public unit_temp: Place | undefined,

    public var_debug_info: VarDebugInfo[],

    // A cache for `maybe_lint_level_roots_bounded`. That function is called
    // repeatedly, and each time it effectively traces a path through a tree
    // structure from a node towards the root, doing an attribute check on each
    // node along the way. This cache records which nodes trace all the way to
    // the root (most of them do) and saves us from retracing many sub-paths
    // many times, and rechecking many nodes.
    public lint_level_roots_cache: GrowableBitSet<ItemLocalId>,

    /// Collects additional coverage information during MIR building.
    /// Only present if coverage is enabled and this function is eligible.
    public coverage_info: CoverageInfoBuilder | undefined,
  ) {}

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:245 typing_env
  typing_env(): TypingEnv {
    return this.infcx.typing_env(this.param_env);
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:249 is_bound_var_in_guard
  is_bound_var_in_guard(id: LocalVarId): boolean {
    return this.guard_context.some((frame) => frame.locals.some((local) => key_LocalVarId(local.id) === key_LocalVarId(id)));
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:253 var_local_id
  var_local_id(id: LocalVarId, for_guard: ForGuard): Local {
    const v = this.var_indices.get(id);
    if (v === undefined) return panic("key not found in `var_indices`");
    return LocalsForNode.local_id(v, for_guard);
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:762 new
  static new(
    thir: Thir,
    infcx: InferCtxt,
    def: LocalDefId,
    hir_id: HirId,
    span: Span,
    arg_count: number,
    return_ty: Ty,
    return_span: Span,
    coroutine: CoroutineInfo | undefined,
  ): Builder {
    const tcx = infcx.tcx;
    // Some functions always have overflow checks enabled,
    // however, they may not get codegen'd, depending on
    // the settings for the crate they are codegened in.
    let check_overflow = find_attr(tcx.hir_attrs(hir_id), (k) => (k.$ === "RustcInheritOverflowChecks" ? null : undefined)) !== undefined;
    // Respect -C overflow-checks.
    check_overflow ||= tcx.sess.overflow_checks();
    // Constants always need overflow checks.
    const owner_kind = tcx.hir_body_owner_kind(def);
    check_overflow ||= owner_kind.$ === "Const" || owner_kind.$ === "Static";

    const lint_level: LintLevel = { $: "Explicit", _0: hir_id };
    const param_env = tcx.param_env(LocalDefId.to_def_id(def)) as ParamEnv;
    const builder = new Builder(
      tcx,
      infcx,
      tcx.region_scope_tree(def),
      param_env,
      thir,
      new CFG([]),
      def,
      hir_id,
      check_overflow,
      span,
      arg_count,
      coroutine,
      Scopes.new(),
      BlockContext.new(),
      [],
      OUTERMOST_SOURCE_SCOPE,
      [],
      new Map(),
      undefined,
      new KeyedMap(key_LocalVarId),
      [LocalDecl.new(return_ty, return_span)],
      [],
      CaptureMap_new(),
      undefined,
      [],
      GrowableBitSet.new_empty(),
      CoverageInfoBuilder.new_if_enabled(tcx, def),
    );

    assert_eq(builder.cfg.start_new_block(), START_BLOCK, (bb) => `bb${bb}`);
    assert_eq(builder.new_source_scope(span, lint_level), OUTERMOST_SOURCE_SCOPE, (s) => `scope[${s}]`);
    builder.source_scopes[OUTERMOST_SOURCE_SCOPE]!.parent_scope = undefined;

    return builder;
  }

  // #[allow(dead_code)]
  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:826 dump_for_debugging
  dump_for_debugging(): void {
    // PORT: the `.clone()`s of the fields are the generated deep clones (a `Body` owns its parts).
    const body = Body.new(
      MirSource.item(LocalDefId.to_def_id(this.def_id)),
      this.cfg.basic_blocks.map(gen_clone().clone_BasicBlockData),
      this.source_scopes.map(gen_clone().clone_SourceScopeData),
      this.local_decls.map(gen_clone().clone_LocalDecl),
      this.canonical_user_type_annotations.map((a) => ({ user_ty: a.user_ty, span: a.span, inferred_ty: a.inferred_ty })),
      this.arg_count,
      this.var_debug_info.map(gen_clone().clone_VarDebugInfo),
      this.fn_span,
      this.coroutine === undefined ? undefined : gen_clone().clone_CoroutineInfo(this.coroutine),
      undefined,
    );
    body.coverage_early_info = this.coverage_info === undefined ? undefined : this.coverage_info.as_done();

    const writer = MirWriter.new(this.tcx);
    unwrap_result(writer.write_mir_fn(body, stdout()), debug_IoError);
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:845 finish
  finish(): Body {
    const body = Body.new(
      MirSource.item(LocalDefId.to_def_id(this.def_id)),
      this.cfg.basic_blocks,
      this.source_scopes,
      this.local_decls,
      this.canonical_user_type_annotations,
      this.arg_count,
      this.var_debug_info,
      this.fn_span,
      this.coroutine,
      undefined,
    );
    body.coverage_early_info = this.coverage_info === undefined ? undefined : this.coverage_info.into_done();

    const writer = MirWriter.new(this.tcx);
    let index = 0;
    for (const block of body.basic_blocks.deref()) {
      if (block.terminator === undefined) {
        unwrap_result(writer.write_mir_fn(body, stdout()), debug_IoError);
        span_bug(this.fn_span, `no terminator on block ${index}`);
      }
      index++;
    }

    return body;
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:871 insert_upvar_arg
  insert_upvar_arg(): void {
    // PORT: ty/closure.ts's `CAPTURE_STRUCT_LOCAL` carries a stand-in `Local` brand ("mir::Local"); it is `Local(1)`.
    const CAPTURE_STRUCT_LOCAL_ = CAPTURE_STRUCT_LOCAL as unknown as Local;
    const closure_arg = this.local_decls[CAPTURE_STRUCT_LOCAL_];
    if (closure_arg === undefined) return;

    let closure_ty = closure_arg.ty;
    const closure_env_projs: PlaceElem[] = [];
    const ref_kind = closure_ty.kind();
    if (ref_kind.$ === "Ref") {
      const ty = ref_kind._1;
      closure_env_projs.push(ProjectionElem.Deref);
      closure_ty = ty;
    }

    let upvar_args: UpvarArgs;
    const closure_kind = closure_ty.kind();
    switch (closure_kind.$) {
      case "Closure":
        upvar_args = { $: "Closure", _0: closure_kind._1 };
        break;
      case "Coroutine":
        upvar_args = { $: "Coroutine", _0: closure_kind._1 };
        break;
      case "CoroutineClosure":
        upvar_args = { $: "CoroutineClosure", _0: closure_kind._1 };
        break;
      default:
        return;
    }

    // In analyze_closure() in upvar.rs we gathered a list of upvars used by an
    // indexed closure and we stored in a map called closure_min_captures in TypeckResults
    // with the closure's DefId. Here, we run through that vec of UpvarIds for
    // the given closure and use the necessary information to create upvar
    // debuginfo and to fill `self.upvars`.
    const capture_tys = UpvarArgsC.upvar_tys(upvar_args);

    const tcx = this.tcx;
    let upvar_owner: OwnerId | undefined = undefined;
    const captures = tcx.closure_captures(this.def_id);
    // PORT: `.iter().zip_eq(capture_tys).enumerate().map(..).collect()`: the map runs element by element, and `zip_eq`
    // panics (itertools' message) when one side ends before the other.
    const entries: [ItemLocalId, Capture][] = [];
    for (let i = 0; ; i++) {
      if (i >= captures.length || i >= capture_tys.length) {
        if (captures.length !== capture_tys.length) panic("itertools: .zip_eq() reached end of one iterator before the other");
        break;
      }
      const captured_place = captures[i]!;
      const ty = capture_tys[i]!;
      const name = captured_place.to_symbol();

      const capture = captured_place.info.capture_kind;
      const base = captured_place.place.base;
      const var_id_ = base.$ === "Upvar" ? base._0.var_path.hir_id : bug("Expected an upvar");
      if (upvar_owner === undefined) upvar_owner = var_id_.owner;
      const upvar_base = upvar_owner;
      assert_eq(upvar_base, var_id_.owner, (o) => debug_OwnerId(o, PLAIN), OwnerId_eq);
      const var_id = var_id_.local_id;

      const mutability = captured_place.mutability;

      const projs = [...closure_env_projs];
      // `FieldIdx::new(i)` (`Idx::new`)
      projs.push({ $: "Field", _0: FieldIdx.from_usize(i), _1: ty });
      switch (capture.$) {
        case "ByValue":
        case "ByUse":
          break;
        case "ByRef":
          projs.push(ProjectionElem.Deref);
          break;
      }

      const use_place = new Place(CAPTURE_STRUCT_LOCAL_, tcx.mk_place_elems(projs));
      this.var_debug_info.push({
        name,
        source_info: SourceInfo.outermost(captured_place.var_ident.span),
        value: { $: "Place", _0: use_place },
        composite: undefined,
        argument_index: undefined,
      });

      const capture_: Capture = { captured_place, use_place, mutability };
      entries.push([var_id, capture_]);
    }
    this.upvars = SortedIndexMultiMapC.from_iter<number, ItemLocalId, Capture>(entries, (a, b) => a - b);
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:943 args_and_body
  args_and_body(block: BasicBlock, arguments_: readonly Param[], argument_scope: region_Scope, expr_id: ExprId): BlockAnd<null> {
    const expr_span = this.thir.index_ExprId(expr_id).span;
    // Allocate locals for the function arguments
    for (let argument_index = 0; argument_index < arguments_.length; argument_index++) {
      const param = arguments_[argument_index]!;
      const source_info = SourceInfo.outermost(param.pat === undefined ? this.fn_span : param.pat.span);
      // `IndexVec::push` returns the index of the new element.
      this.local_decls.push(LocalDecl.with_source_info(param.ty, source_info));
      const arg_local = Local.from_usize(this.local_decls.length - 1);

      // If this is a simple binding pattern, give debuginfo a nice name.
      const pat = param.pat;
      let name: Symbol | undefined;
      if (pat !== undefined && (name = pat.simple_ident()) !== undefined) {
        this.var_debug_info.push({
          name,
          // PORT: `SourceInfo` is `Copy`; the `LocalDecl` above holds `source_info` itself.
          source_info: clone_SourceInfo(source_info),
          value: { $: "Place", _0: Place_from_Local(arg_local) },
          composite: undefined,
          argument_index: argument_index + 1,
        });
      }
    }

    this.insert_upvar_arg();

    let scope: SourceScope | undefined = undefined;
    // Bind the argument patterns
    for (let index = 0; index < arguments_.length; index++) {
      const param = arguments_[index]!;
      // Function arguments always get the first Local indices after the return place
      const local = Local.arg(index);
      const place = Place_from_Local(local);

      // Make sure we drop (parts of) the argument even when not matched on.
      this.schedule_drop_value(param.pat === undefined ? expr_span : param.pat.span, argument_scope, local);

      const pat = param.pat;
      if (pat === undefined) {
        continue;
      }
      const original_source_scope = this.source_scope;
      const span = pat.span;
      if (param.hir_id !== undefined) {
        const arg_hir_id = param.hir_id;
        this.set_correct_source_scope_for_arg(arg_hir_id, original_source_scope, span);
      }
      const kind = pat.kind;
      if (kind.$ === "Binding" && kind.mode._0.$ === "No" && kind.subpattern === undefined) {
        // Don't introduce extra copies for simple bindings
        const { var: var_ } = kind;
        const mutability = kind.mode._1;
        this.local_decls[local]!.mutability = mutability;
        this.local_decls[local]!.source_info.scope = this.source_scope;
        let local_info: LocalInfo;
        if (param.self_kind !== undefined) {
          const kind = param.self_kind;
          local_info = { $: "User", _0: { $: "ImplicitSelf", _0: kind } };
        } else {
          const binding_mode = new BindingMode(ByRef.No, mutability);
          local_info = {
            $: "User",
            _0: {
              $: "Var",
              _0: {
                binding_mode,
                opt_ty_info: param.ty_span,
                opt_match_place: [undefined, span],
                pat_span: span,
                introductions: [{ span, is_shorthand: false }],
              },
            },
          };
        }
        // `**self.local_decls[local].local_info.as_mut().unwrap_crate_local() = ..`: replaces the boxed `LocalInfo` (a
        // `ClearCrossCrate::Clear` is a `bug!`).
        ClearCrossCrate.unwrap_crate_local(ClearCrossCrate.as_mut(this.local_decls[local]!.local_info));
        this.local_decls[local]!.local_info = { $: "Set", _0: local_info };
        this.var_indices.set(var_, { $: "One", _0: local });
      } else {
        scope = this.declare_bindings(scope, expr_span, pat, undefined, [place, span]);
        const place_builder = as_place().PlaceBuilder_from_Local(local);
        block = BlockAnd.into_block(this.place_into_pattern(block, pat, place_builder, false));
      }
      this.source_scope = original_source_scope;
    }

    // Enter the argument pattern bindings source scope, if it exists.
    if (scope !== undefined) {
      const source_scope = scope;
      this.source_scope = source_scope;
    }

    const intrinsic = this.tcx.intrinsic(LocalDefId.to_def_id(this.def_id));
    if ((intrinsic !== undefined && intrinsic.must_be_overridden) || this.tcx.is_sdylib_interface_build()) {
      const source_info = this.source_info(DUMMY_SP);
      this.cfg.terminate(block, source_info, TerminatorKind.Unreachable);
      return unit(this.cfg.start_new_block());
    } else {
      // Ensure we don't silently codegen functions with fake bodies.
      const node = this.tcx.hir_node(this.hir_id);
      if (node.$ === "Item" && node._0.kind.$ === "Fn" && !node._0.kind.has_body) {
        this.tcx.dcx().span_delayed_bug(expr_span, `fn item without body has reached MIR building: ${debug_LocalDefId_(this.def_id)}`);
      }
      return this.expr_into_dest(Place.return_place(), block, expr_id);
    }
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:1068 set_correct_source_scope_for_arg
  set_correct_source_scope_for_arg(arg_hir_id: HirId, original_source_scope: SourceScope, pattern_span: Span): void {
    const parent_id = ClearCrossCrate.unwrap_crate_local(ClearCrossCrate.as_ref(this.source_scopes[original_source_scope]!.local_data)).lint_root;
    this.maybe_new_source_scope(pattern_span, arg_hir_id, parent_id);
  }

  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:1082 get_unit_temp
  get_unit_temp(): Place {
    if (this.unit_temp !== undefined) {
      const tmp = this.unit_temp;
      return tmp;
    } else {
      const ty = this.tcx.types.unit;
      const fn_span = this.fn_span;
      const tmp = this.temp(ty, fn_span);
      this.unit_temp = tmp;
      return tmp;
    }
  }
}

/** The generated clones `dump_for_debugging` uses (read lazily: mir/mod.ts is loaded by then). */
function gen_clone(): typeof import("../../rustc_middle/mir/mod.ts") & typeof import("../../rustc_middle/ty/typeck_results.ts") {
  return {
    ...(require("../../rustc_middle/mir/mod.ts") as typeof import("../../rustc_middle/mir/mod.ts")),
    ...(require("../../rustc_middle/ty/typeck_results.ts") as typeof import("../../rustc_middle/ty/typeck_results.ts")),
  };
}

/** builder/expr/as_place.ts (an extension module: read lazily, see "init order" above). */
function as_place(): typeof import("./expr/as_place.ts") {
  return require("./expr/as_place.ts") as typeof import("./expr/as_place.ts");
}

/** `CaptureMap::new()` (`SortedIndexMultiMap<usize, ItemLocalId, Capture>`; `ItemLocalId: Ord` is the numeric order). */
export function CaptureMap_new(): CaptureMap {
  return SortedIndexMultiMapC.new<number, ItemLocalId, Capture>((a, b) => a - b);
}

declare module "./mod.gen.ts" {
  interface BlockContext {
    push(bf: BlockFrame): void;
    pop(): BlockFrame | undefined;
    currently_in_block_tail(): gen_BlockTailInfo | undefined;
    currently_ignores_tail_results(): boolean;
  }
  namespace BlockContext {
    function new_(): BlockContext;
    export { new_ as new };
  }
}
type gen_BlockTailInfo = import("../../rustc_middle/mir/mod.ts").BlockTailInfo;

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:259 new
(BlockContext as unknown as { new: typeof BlockContext.new }).new = function (): BlockContext {
  return new BlockContext([]);
};
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:262 push
BlockContext.prototype.push = function (this: BlockContext, bf: BlockFrame): void {
  this._0.push(bf);
};
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:265 pop
BlockContext.prototype.pop = function (this: BlockContext): BlockFrame | undefined {
  return this._0.pop();
};

/// Traverses the frames on the `BlockContext`, searching for either
/// the first block-tail expression frame with no intervening
/// statement frame.
///
/// Notably, this skips over `SubExpr` frames; this method is
/// meant to be used in the context of understanding the
/// relationship of a temp (created within some complicated
/// expression) with its containing expression, and whether the
/// value of that *containing expression* (not the temp!) is
/// ignored.
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:279 currently_in_block_tail
BlockContext.prototype.currently_in_block_tail = function (this: BlockContext): gen_BlockTailInfo | undefined {
  for (let i = this._0.length - 1; i >= 0; i--) {
    const bf = this._0[i]!;
    switch (bf.$) {
      case "SubExpr":
        continue;
      case "Statement":
        break;
      case "TailExpr":
        return bf.info;
    }
    break;
  }

  return undefined;
};

/// Looks at the topmost frame on the BlockContext and reports
/// whether its one that would discard a block tail result.
///
/// Unlike `currently_within_ignored_tail_expression`, this does
/// *not* skip over `SubExpr` frames: here, we want to know
/// whether the block result itself is discarded.
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:297 currently_ignores_tail_results
BlockContext.prototype.currently_ignores_tail_results = function (this: BlockContext): boolean {
  const last = this._0[this._0.length - 1];
  // no context: conservatively assume result is read
  if (last === undefined) return false;
  switch (last.$) {
    // sub-expression: block result feeds into some computation
    case "SubExpr":
      return false;

    // otherwise: use accumulated is_ignored state.
    case "TailExpr":
      return last.info.tail_result_is_ignored;
    case "Statement":
      return last.ignores_expr_result;
  }
};

declare module "./mod.gen.ts" {
  namespace GuardFrameLocal {
    function new_(id: LocalVarId): GuardFrameLocal;
    export { new_ as new };
  }
}
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:339 new
(GuardFrameLocal as unknown as { new: typeof GuardFrameLocal.new }).new = function (id: LocalVarId): GuardFrameLocal {
  return new GuardFrameLocal(id);
};

export interface LocalsForNode_methods {
  local_id(self: LocalsForNode, for_guard: ForGuard): Local;
}
export type LocalsForNode = gen.LocalsForNode;
export const LocalsForNode: LocalsForNode_methods = {} as LocalsForNode_methods;

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:371 local_id
LocalsForNode.local_id = function (self: LocalsForNode, for_guard: ForGuard): Local {
  if (self.$ === "One" && for_guard === "OutsideGuard") return self._0;
  if (self.$ === "ForGuard" && for_guard === "RefWithinGuard") return self.ref_for_guard;
  if (self.$ === "ForGuard" && for_guard === "OutsideGuard") return self.for_arm_body;

  // (&LocalsForNode::One(_), ForGuard::RefWithinGuard)
  return bug("anything with one local should never be within a guard.");
};

// rustc-type: compiler/rustc_mir_build/src/builder/mod.rs:414 BlockAnd
/// The `BlockAnd` "monad" packages up the new basic block along with a
/// produced value (sometimes just unit, of course). The `unpack!`
/// macro (and methods below) makes working with `BlockAnd` much more
/// convenient.
// #[must_use = "if you don't use one of these results, you're leaving a dangling edge"]
// PORT: `struct BlockAnd<T>(BasicBlock, T)` is the tuple `[BasicBlock, T]` (so that `unpack!` is a destructuring).
export type BlockAnd<T> = [BasicBlock, T];
export const BlockAnd = {
  /// Unpacks `BlockAnd<()>` into a [`BasicBlock`].
  // #[must_use]
  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:419 into_block
  into_block(self: BlockAnd<null>): BasicBlock {
    const [block] = self;
    return block;
  },
};

// PORT: `trait BlockAndExtension` (implemented for `BasicBlock` only): the impl's methods are the free fns `and` / `unit`.
export interface BlockAndExtension {
  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:426 and
  and<T>(self: BasicBlock, v: T): BlockAnd<T>;
  // rustc: compiler/rustc_mir_build/src/builder/mod.rs:427 unit
  unit(self: BasicBlock): BlockAnd<null>;
}

// impl BlockAndExtension for BasicBlock
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:431 and
export function and<T>(self: BasicBlock, v: T): BlockAnd<T> {
  return [self, v];
}

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:435 unit
export function unit(self: BasicBlock): BlockAnd<null> {
  return [self, null];
}

/// Update a block pointer and return the value.
/// Use it like `let x = unpack!(block = self.foo(block, foo))`.
// PORT: `macro_rules! unpack` is a destructuring of the `BlockAnd` tuple:
//   `let x = unpack!(block = self.foo(block, foo));`  ->  `let x: T; [block, x] = this.foo(block, foo);`
//   `unpack!(block = self.foo(block, foo));`          ->  `[block] = this.foo(block, foo);`

/// The main entry point for building MIR for a function.
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:451 construct_fn
// PORT: exported (private upstream) for builder/contract.test.ts, while `build_mir_inner_impl` stops before it (check_match).
export function construct_fn(tcx: TyCtxt, fn_def: LocalDefId, thir: Thir, expr: ExprId, fn_sig: FnSig): Body {
  const span = tcx.def_span(LocalDefId.to_def_id(fn_def));
  const fn_id = tcx.local_def_id_to_hir_id(fn_def);

  // Figure out what primary body this item has.
  const body = tcx.hir_body_owned_by(fn_def);
  const span_with_body = tcx.hir_span_with_body(fn_id);
  const fn_decl = tcx.hir_fn_decl_by_hir_id(fn_id);
  const return_ty_span = FnRetTy.span((fn_decl ?? span_bug(span, `can't build MIR for ${debug_LocalDefId_(fn_def)}`)).output);

  let abi = FnSig.abi(fn_sig);
  if (tcx.def_kind(LocalDefId.to_def_id(fn_def)).$ === "Closure") {
    // HACK(eddyb) Avoid having RustCall on closures,
    // as it adds unnecessary (and wrong) auto-tupling.
    abi = ExternAbi.Rust;
  }

  const arguments_ = thir.params;

  const return_ty = FnSig.output(fn_sig);

  const custom_mir = find_attr(HasAttrs_HirId.get_attrs(fn_id, tcx), (k) => (k.$ === "CustomMir" ? ([k._0, k._1] as const) : undefined));
  if (custom_mir !== undefined) {
    const [dialect, phase] = custom_mir;
    const custom = require("./custom/mod.ts") as typeof custom_mod;
    return custom.build_custom_mir(
      tcx,
      LocalDefId.to_def_id(fn_def),
      fn_id,
      thir,
      expr,
      arguments_,
      return_ty,
      return_ty_span,
      span_with_body,
      dialect === undefined ? undefined : dialect[0],
      phase === undefined ? undefined : phase[0],
    );
  }

  const typing_mode = tcx.use_typing_mode_post_typeck_until_borrowck()
    ? TypingMode.borrowck(as_interner(tcx), fn_def)
    : // FIXME(#132279): This should be able to reveal opaque
      // types defined during HIR typeck.
      TypingMode.non_body_analysis();

  const infcx = tcx.infer_ctxt().build(typing_mode);

  let defining_ty = Unnormalized.skip_normalization(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(fn_def)) as EarlyBinder<Ty>));
  defining_ty = infcx.next_trait_solver()
    ? // Closure types come from HIR typeck results, where they were already
      // normalized during writeback. Wrapping them in an `EarlyBinder`
      // conservatively makes aliases non-rigid, so restore their rigidness
      // instead of normalizing them again during MIR build.
      set_aliases_to_rigid(tcx, defining_ty, fold_Ty)
    : defining_ty;
  let coroutine: CoroutineInfo | undefined;
  const kind = defining_ty.kind();
  switch (kind.$) {
    case "Coroutine": {
      const args = kind._1;
      const coroutine_kind = tcx.coroutine_kind(LocalDefId.to_def_id(fn_def)) as CoroutineKind | undefined;
      if (coroutine_kind === undefined) return panic("called `Option::unwrap()` on a `None` value");
      coroutine = CoroutineInfo.initial(coroutine_kind, CoroutineArgs.yield_ty(args.as_coroutine()), CoroutineArgs.resume_ty(args.as_coroutine()));
      break;
    }
    case "Closure":
    case "CoroutineClosure":
    case "FnDef":
      coroutine = undefined;
      break;
    default:
      return span_bug(span_with_body, `unexpected type of body: ${debug_Ty_(defining_ty)}`);
  }

  const builder = Builder.new(thir, infcx, fn_def, fn_id, span_with_body, arguments_.length, return_ty, return_ty_span, coroutine);

  const call_site_scope = new RegionScope(body.id().hir_id.local_id, ScopeData.CallSite);
  const arg_scope = new RegionScope(body.id().hir_id.local_id, ScopeData.Arguments);
  const source_info = builder.source_info(span);
  const call_site_s: [region_Scope, SourceInfo] = [call_site_scope, source_info];
  const _: BlockAnd<null> = builder.in_scope(call_site_s, LintLevel.Inherited, (builder) => {
    const arg_scope_s: [region_Scope, SourceInfo] = [arg_scope, source_info];
    // Attribute epilogue to function's closing brace
    const fn_end = Span.shrink_to_hi(span_with_body);
    const return_block = BlockAnd.into_block(
      builder.in_breakable_scope(undefined, Place.return_place(), fn_end, (builder) => {
        return builder.in_scope(arg_scope_s, LintLevel.Inherited, (builder) => {
          return builder.args_and_body(START_BLOCK, arguments_, arg_scope, expr);
        });
      }),
    );
    // PORT: shadows the outer `source_info` (`source_info_`: a `const` of the same name would be in its TDZ above).
    const source_info_ = builder.source_info(fn_end);
    builder.push_coverage_point_for_fn_end(return_block, source_info_, fn_id);
    builder.cfg.terminate(return_block, source_info_, TerminatorKind.Return);
    builder.build_drop_trees();
    return unit(return_block);
  });

  const body_ = builder.finish();

  body_.spread_arg =
    abi.$ === "RustCall"
      ? // RustCall pseudo-ABI untuples the last argument.
        // FIXME(splat): splat can untuple any argument, set spread_arg here
        Local.new(arguments_.length)
      : undefined;

  return body_;
}

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:578 construct_const
function construct_const(tcx: TyCtxt, def: LocalDefId, thir: Thir, expr: ExprId, const_ty: Ty): Body {
  const hir_id = tcx.local_def_id_to_hir_id(def);

  // Figure out what primary body this item has.
  let span: Span;
  let const_ty_span: Span;
  const node = tcx.hir_node(hir_id);
  if (node.$ === "Item" && (node._0.kind.$ === "Static" || node._0.kind.$ === "Const")) {
    // hir::ItemKind::Static(_, _, ty, _) | hir::ItemKind::Const(_, _, ty, _)
    [span, const_ty_span] = [node._0.span, node._0.kind._2.span];
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Const") {
    [span, const_ty_span] = [node._0.span, node._0.kind._0.span];
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Const" && node._0.kind._1 !== undefined) {
    [span, const_ty_span] = [node._0.span, node._0.kind._0.span];
  } else if (node.$ === "AnonConst") {
    const ct = node._0;
    [span, const_ty_span] = [ct.span, ct.span];
  } else if (node.$ === "ConstBlock") {
    const span_ = tcx.def_span(LocalDefId.to_def_id(def));
    [span, const_ty_span] = [span_, span_];
  } else if (node.$ === "Item" && node._0.kind.$ === "GlobalAsm") {
    [span, const_ty_span] = [node._0.span, node._0.span];
  } else {
    return span_bug(tcx.def_span(LocalDefId.to_def_id(def)), `can't build MIR for ${debug_LocalDefId_(def)}`);
  }

  const typing_mode = tcx.use_typing_mode_post_typeck_until_borrowck()
    ? TypingMode.borrowck(as_interner(tcx), def)
    : // FIXME(#132279): This should be able to reveal opaque
      // types defined during HIR typeck.
      TypingMode.non_body_analysis();

  const infcx = tcx.infer_ctxt().build(typing_mode);
  const builder = Builder.new(thir, infcx, def, hir_id, span, 0, const_ty, const_ty_span, undefined);

  let block = START_BLOCK;
  block = BlockAnd.into_block(builder.expr_into_dest(Place.return_place(), block, expr));

  const source_info = builder.source_info(span);
  builder.cfg.terminate(block, source_info, TerminatorKind.Return);

  builder.build_drop_trees();
  return builder.finish();
}

/// Construct MIR for an item that has had errors in type checking.
///
/// This is required because we may still want to run MIR passes on an item
/// with type errors, but normal MIR construction can't handle that in general.
// rustc: compiler/rustc_mir_build/src/builder/mod.rs:635 construct_error
export function construct_error(tcx: TyCtxt, def_id: LocalDefId, guar: ErrorGuaranteed): Body {
  const span = tcx.def_span(LocalDefId.to_def_id(def_id));
  const hir_id = tcx.local_def_id_to_hir_id(def_id);

  let inputs: Ty[];
  let output: Ty;
  let coroutine: CoroutineInfo | undefined;
  const dk = tcx.def_kind(LocalDefId.to_def_id(def_id));
  switch (dk.$) {
    case "Const":
    case "AssocConst":
    case "AnonConst":
    case "Static":
    case "GlobalAsm":
      [inputs, output, coroutine] = [[], Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(def_id)) as EarlyBinder<Ty>)), undefined];
      break;
    case "Ctor":
    case "Fn":
    case "AssocFn": {
      const sig = tcx.liberate_late_bound_regions(
        LocalDefId.to_def_id(def_id),
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(LocalDefId.to_def_id(def_id)) as EarlyBinder<Binder<FnSig>>)),
        fold_FnSig,
      );
      [inputs, output, coroutine] = [[...FnSig.inputs(sig)], FnSig.output(sig), undefined];
      break;
    }
    case "Closure": {
      const closure_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(def_id)) as EarlyBinder<Ty>));
      const kind = closure_ty.kind();
      switch (kind.$) {
        case "Closure": {
          const args = kind._1.as_closure();
          const sig = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(def_id), ClosureArgs.sig(args), fold_FnSig);
          let self_ty: Ty;
          switch (ClosureArgs.kind(args)) {
            case "Fn":
              self_ty = TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, closure_ty);
              break;
            case "FnMut":
              self_ty = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, closure_ty);
              break;
            case "FnOnce":
              self_ty = closure_ty;
              break;
          }
          [inputs, output, coroutine] = [[self_ty, ...FnSig.inputs(sig)[0]!.tuple_fields()], FnSig.output(sig), undefined];
          break;
        }
        case "Coroutine": {
          const args = kind._1.as_coroutine();
          const resume_ty = CoroutineArgs.resume_ty(args);
          const yield_ty = CoroutineArgs.yield_ty(args);
          const return_ty = CoroutineArgs.return_ty(args);
          const coroutine_kind = tcx.coroutine_kind(LocalDefId.to_def_id(def_id)) as CoroutineKind | undefined;
          if (coroutine_kind === undefined) return panic("called `Option::unwrap()` on a `None` value");
          [inputs, output, coroutine] = [[closure_ty, resume_ty], return_ty, CoroutineInfo.initial(coroutine_kind, yield_ty, resume_ty)];
          break;
        }
        case "CoroutineClosure": {
          const did = kind._0;
          const args = kind._1.as_coroutine_closure();
          const sig = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(def_id), CoroutineClosureArgs.coroutine_closure_sig(args), fold_CoroutineClosureSignature);
          let self_ty: Ty;
          switch (CoroutineClosureArgs.kind(args)) {
            case "Fn":
              self_ty = TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, closure_ty);
              break;
            case "FnMut":
              self_ty = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, closure_ty);
              break;
            case "FnOnce":
              self_ty = closure_ty;
              break;
          }
          [inputs, output, coroutine] = [
            [self_ty, ...sig.tupled_inputs_ty.tuple_fields()],
            CoroutineClosureSignature.to_coroutine(
              sig,
              tcx,
              CoroutineClosureArgs.parent_args(args),
              CoroutineClosureArgs.kind_ty(args),
              tcx.coroutine_for_closure(did),
              TyC.new_error(tcx, guar),
            ),
            undefined,
          ];
          break;
        }
        case "Error":
          [inputs, output, coroutine] = [[closure_ty, closure_ty], closure_ty, undefined];
          break;
        default:
          return span_bug(span, `expected type of closure body to be a closure or coroutine, got ${debug_TyKind_(closure_ty)}`);
      }
      break;
    }
    default:
      return span_bug(span, `${debug_LocalDefId_(def_id)} is not a body: ${debug_DefKind_(dk)}`);
  }

  const source_info = new SourceInfo(span, OUTERMOST_SOURCE_SCOPE);
  // PORT: `LocalDecl::with_source_info(*ty, source_info)` copies the `Copy` `SourceInfo` into each decl.
  const local_decls = [output, ...inputs].map((ty) => LocalDecl.with_source_info(ty, clone_SourceInfo(source_info)));
  const cfg = new CFG([]);
  const source_scopes: SourceScopeData[] = [];

  cfg.start_new_block();
  const local_data: SourceScopeLocalData = { lint_root: hir_id };
  source_scopes.push(new SourceScopeData(span, undefined, undefined, undefined, { $: "Set", _0: local_data }));

  cfg.terminate(START_BLOCK, source_info, TerminatorKind.Unreachable);

  return Body.new(
    MirSource.item(LocalDefId.to_def_id(def_id)),
    cfg.basic_blocks,
    source_scopes,
    local_decls,
    [],
    inputs.length,
    [],
    span,
    coroutine,
    guar,
  );
}

/** PORT (D4): the `TypeFoldable` descriptor of `CoroutineClosureSignature` over its derived impls (closure.gen.ts), for
 *  `liberate_late_bound_regions` (precedent: rustc_hir_typeck callee.ts). */
const fold_CoroutineClosureSignature: TypeFoldable<CoroutineClosureSignatureT> = {
  visit_with: (self, visitor) => visit_with_CoroutineClosureSignature(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_CoroutineClosureSignature(self, folder),
  fold_with: (self, folder) => fold_with_CoroutineClosureSignature(self, folder),
};

/** `{:?}` of the values the `span_bug!`s above print (read lazily: printing modules load after this one). */
function debug_LocalDefId_(id: LocalDefId): string {
  const { debug_LocalDefId } = require("../../rustc_span/def_id.ts") as typeof import("../../rustc_span/def_id.ts");
  return debug_LocalDefId(id, PLAIN);
}
function debug_Ty_(ty: Ty): string {
  const { debug_Ty } = require("../../rustc_middle/ty/structural_impls.ts") as typeof import("../../rustc_middle/ty/structural_impls.ts");
  return debug_Ty(ty, PLAIN);
}
function debug_TyKind_(ty: Ty): string {
  // `{kind:?}` of a `TyKind` prints as the `Ty` does (`impl Debug for Ty` forwards to the kind).
  return debug_Ty_(ty);
}
function debug_DefKind_(dk: ReturnType<TyCtxt["def_kind"]>): string {
  const { debug_DefKind } = require("../../rustc_hir/def.ts") as typeof import("../../rustc_hir/def.ts");
  return debug_DefKind(dk, PLAIN);
}

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:1096 parse_float_into_constval
export function parse_float_into_constval(num: Symbol, float_ty: FloatTy, neg: boolean): ConstValue | undefined {
  const s = parse_float_into_scalar(num, float_ty, neg);
  return s === undefined ? undefined : { $: "Scalar", _0: { $: "Int", _0: s } };
}

// rustc: compiler/rustc_mir_build/src/builder/mod.rs:1100 parse_float_into_scalar
export function parse_float_into_scalar(num_: Symbol, float_ty: FloatTy, neg: boolean): ScalarInt | undefined {
  const num = Symbol.as_str(num_);
  switch (float_ty) {
    // FIXME(f16_f128): When available, compare to the library parser as with `f32` and `f64`
    case "F16": {
      const r = Half.from_str(num);
      if (r.$ === "Err") return undefined;
      let f = r._0;
      if (neg) {
        f = f.neg();
      }
      return ScalarInt.from_Half(f);
    }
    case "F32": {
      const rust_f = core_parse_float(num, 32);
      if (rust_f === undefined) return undefined;
      const r = Single.from_str(num);
      if (r.$ === "Err") return panic(`apfloat::ieee::Single failed to parse \`${num}\`: ${debug_ParseError(r._0, PLAIN)}`);
      let f = r._0;

      assert(
        rust_f === f.to_bits(),
        // PORT: the message's `{}` of the host `f32` (`core::fmt::Display for f32`) is not ported; this assert cannot
        // fail (both parsers round correctly, see `core_parse_float`).
        rust_f === f.to_bits() ? "" : unported("core::fmt::Display for f32 (parse_float_into_scalar's assert message)"),
      );

      if (neg) {
        f = f.neg();
      }

      return ScalarInt.from_Single(f);
    }
    case "F64": {
      const rust_f = core_parse_float(num, 64);
      if (rust_f === undefined) return undefined;
      const r = Double.from_str(num);
      if (r.$ === "Err") return panic(`apfloat::ieee::Double failed to parse \`${num}\`: ${debug_ParseError(r._0, PLAIN)}`);
      let f = r._0;

      assert(
        rust_f === f.to_bits(),
        rust_f === f.to_bits()
          ? ""
          : `apfloat::ieee::Double gave different result for \`${display_f64(f64_from_bits(rust_f))}\`: ${f.fmt()}(0x${f.to_bits().toString(16)}) vs Rust's ${Double.from_bits(rust_f).fmt()}(0x${rust_f.toString(16)})`,
      );

      if (neg) {
        f = f.neg();
      }

      return ScalarInt.from_Double(f);
    }
    // FIXME(f16_f128): When available, compare to the library parser as with `f32` and `f64`
    case "F128": {
      const r = Quad.from_str(num);
      if (r.$ === "Err") return undefined;
      let f = r._0;
      if (neg) {
        f = f.neg();
      }
      return ScalarInt.from_Quad(f);
    }
  }
}

/** `f64::from_bits` */
function f64_from_bits(bits: bigint): number {
  const v = new DataView(new ArrayBuffer(8));
  v.setBigUint64(0, bits);
  return v.getFloat64(0);
}

// PORT: moved here with `parse_float_into_scalar` from thir/constant.ts (its stand-in until this file was ported).
/**
 * PORT: `num.parse::<f32>()` / `num.parse::<f64>()` (core::num::dec2flt, `FromStr for f32 / f64`), as the bits of the
 * result (`undefined` = `Err`). Not a port of dec2flt's algorithm (Eisel-Lemire with a big-decimal fallback): it
 * accepts the same syntax (`[+-]`, then `inf` / `infinity` / `nan` in any case, or digits with an optional `.` and at
 * least one digit, then an optional `e`/`E`, sign and digits) and returns the same value, which dec2flt defines as the
 * nearest representable value, ties to even; here that rounding is done exactly with bigints.
 */
function core_parse_float(s: string, bits: 32 | 64): bigint | undefined {
  const P = bits === 32 ? 24 : 53; // precision (with the implicit bit)
  const EXP_BITS = bits === 32 ? 8 : 11;
  const BIAS = (1 << (EXP_BITS - 1)) - 1;
  const EMIN = 1 - BIAS;
  const EMAX = BIAS;
  const SIGN = 1n << BigInt(bits - 1);
  const INF = BigInt((1 << EXP_BITS) - 1) << BigInt(P - 1);
  const NAN = INF | (1n << BigInt(P - 2));

  let i = 0;
  let negative = false;
  if (s[0] === "+" || s[0] === "-") {
    negative = s[0] === "-";
    i = 1;
  }
  const sign = negative ? SIGN : 0n;
  const rest = s.slice(i).toLowerCase();
  if (rest === "inf" || rest === "infinity") return sign | INF;
  if (rest === "nan") return sign | NAN;

  const m = /^([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/.exec(s.slice(i));
  if (m === null) return undefined;
  const int_digits = m[1]!;
  const frac_digits = m[2] ?? "";
  if (int_digits.length + frac_digits.length === 0) return undefined;
  const digits = (int_digits + frac_digits).replace(/^0+/, "");
  if (digits.length === 0) return sign;
  // `exp` is clamped: beyond these bounds the value is certainly infinite / zero for both formats.
  const exp_raw = m[3] === undefined ? 0n : BigInt(m[3]);
  const e10_big = exp_raw - BigInt(frac_digits.length);
  const magnitude = e10_big + BigInt(digits.length); // value in [10^(magnitude-1), 10^magnitude)
  if (magnitude > 400n) return sign | INF;
  if (magnitude < -400n) return sign;
  const e10 = Number(e10_big);

  // value = num / den
  let num = BigInt(digits);
  let den = 1n;
  if (e10 >= 0) num *= 10n ** BigInt(e10);
  else den = 10n ** BigInt(-e10);

  // b = floor(log2(num / den))
  const bitlen = (x: bigint) => x.toString(2).length;
  let b = bitlen(num) - bitlen(den);
  const ge_pow2 = (k: number) => (k >= 0 ? num >= den << BigInt(k) : num << BigInt(-k) >= den);
  if (!ge_pow2(b)) b -= 1;

  let e = Math.max(b, EMIN);
  // q = num / den in units of 2^(e - (P - 1)), rounded to nearest, ties to even.
  const shift = P - 1 - e;
  const n2 = shift >= 0 ? num << BigInt(shift) : num;
  const d2 = shift >= 0 ? den : den << BigInt(-shift);
  let q = n2 / d2;
  const r2 = (n2 % d2) * 2n;
  if (r2 > d2 || (r2 === d2 && (q & 1n) === 1n)) q += 1n;
  if (q === 1n << BigInt(P)) {
    q >>= 1n;
    e += 1;
  }
  if (e > EMAX) return sign | INF;
  if (q < 1n << BigInt(P - 1)) {
    // Subnormal (or zero): biased exponent 0.
    return sign | q;
  }
  return sign | (BigInt(e + BIAS) << BigInt(P - 1)) | (q - (1n << BigInt(P - 1)));
}

///////////////////////////////////////////////////////////////////////////
// Builder methods are broken up into modules, depending on what kind
// of thing is being lowered. Note that they use the `unpack` macro
// above extensively.

// mod block;
// mod cfg;
// mod coverageinfo;
// mod custom;
// mod expr;
// mod matches;
// mod misc;
// mod scope;
// PORT: the submodules extend `Builder` / the generated classes when the crate root (lib.ts) imports them (see the
// header's init order); their free fns and types are imported from their own modules.
