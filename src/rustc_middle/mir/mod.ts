// Port of compiler/rustc_middle/src/mir/mod.rs (lane mir-contract, plan-m4 D3): the types of the file are generated with
// their derived Debug / Clone / TypeVisitable / TypeFoldable into mod.gen.ts (tools/codegen/types.ts, set
// rustc_middle_mir); `Body`, `LocalDecl`, `BasicBlockData`, `SourceScopeData`, ... are generated classes (constructor:
// every field in declaration order) whose methods are put on the prototype here. Every fn of the file is either ported
// (`// rustc:` marker) or declared as a stub (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature,
// body `unported(..)`); docs/handoff/mir-contract.md "How to fill a stub" has the conventions.
//
// PORT (init order; docs/handoff/mir-contract.md): mir/ is entered through this module, whose first import is
// syntax.ts; every other mir module starts with `import "./mod.ts"` (`"../mod.ts"`), so that syntax.gen.ts (whose
// types statement.ts / terminator.ts / pretty.ts / this module extend) is evaluated before any extension module. Outside
// mir/, import only this module, interpret/mod.ts, pretty.ts, visit.ts or traversal.ts. pretty.rs's re-exported items
// (`MirDumper`, `PassWhere`, `display_allocation`, `write_mir_pretty`) are not re-exported here: pretty.ts extends
// visit.ts's `Visitor` at load, so it is imported directly (`rustc_middle/mir/pretty.ts`).
// PORT (names): a method whose name is also a field of its class gets a trailing `_` (`Body::local_decls()` (the
// `HasLocalDecls` impl) / `required_consts()` / `mentioned_items()`, `LocalDecl::local_info()`,
// `BasicBlockData::terminator()` are `local_decls_()` / ... / `terminator_()`; precedent `HasTyCtxt::tcx_()`).
//! MIR datatypes and passes. See the [rustc dev guide] for more info.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/mir/index.html
export * from "./syntax.ts";
import { AnalysisPhase_discriminant, debug_Place, MirPhase, type Place, RuntimeChecks, type RuntimePhase, RuntimePhase_discriminant, StatementKind } from "./syntax.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { Dominators } from "../../rustc_data_structures/graph/dominators/mod.ts";
import type { CoroutineKind, HirId } from "../../rustc_hir/lib.ts";
import { decode_u8 } from "../../rustc_serialize/serialize.ts";
import { CRATE_DEF_ID, debug_DefId, type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span, type Spanned } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import type { TypeVisitable } from "../../rustc_type_ir/visit.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import { assert_eq, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { TyDecoder } from "../ty/codec.ts";
import type { Instance, Ty, TypingEnv } from "../ty/decls.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import type { ShimKind } from "../ty/instance.ts";
import type { ParamEnv } from "../ty/mod.ts";
import type { CanonicalUserTypeAnnotations } from "../ty/typeck_results.ts";
import { BasicBlocks } from "./basic_blocks.ts";
import { Const as mir_Const, fold_with_Const, try_fold_with_Const, visit_with_Const } from "./consts.ts";
import * as gen from "./mod.gen.ts";
import {
  BasicBlockData,
  Body,
  clone_SourceInfo,
  CoroutineInfo,
  debug_BasicBlock,
  type LocalDecls,
  LocalInfo,
  type LocalKind,
  LocalDecl,
  Location,
  MirSource,
  type MentionedItem,
  OUTERMOST_SOURCE_SCOPE,
  RETURN_PLACE,
  SourceInfo,
  type SourceScopeData,
  type UserTypeProjection,
  UserTypeProjections,
  type VarDebugInfo,
  type VarDebugInfoContents,
  visit_with_Body,
} from "./mod.gen.ts";
import type { CoroutineLayout } from "./query.ts";
import { type Statement, StmtDebugInfos } from "./statement.ts";
import type { ConstOperand, SwitchTargets } from "./syntax.ts";
import type { Successors, Terminator } from "./terminator.ts";
export * from "./mod.gen.ts";
export { BasicBlocks };
export type { Mutability } from "../../rustc_ast_ir/lib.ts";
export * from "./query.ts";
export * from "./consts.ts";
export * from "./statement.ts";
export * from "./terminator.ts";
// pub use self::generic_graph::graphviz_safe_def_name; pub use self::graphviz::write_mir_graphviz; (graphviz: not ported)
// pub use self::pretty::{MirDumper, PassWhere, display_allocation, write_mir_pretty}; (see the header: import pretty.ts)
export * as coverage from "./coverage.ts";
export * as interpret from "./interpret/mod.ts";
export * as traversal from "./traversal.ts";
export * as visit from "./visit.ts";

/** Either::Left / Either::Right (the `either` crate, PORTING §5 shape). */
export type Either<L, R> = { readonly $: "Left"; _0: L } | { readonly $: "Right"; _0: R };

/** pretty.ts (`impl Debug for VarDebugInfo` lives in pretty.rs), read lazily (init order). */
function mir_pretty(): typeof import("./pretty.ts") {
  return (mir_pretty__m ??= require("./pretty.ts") as typeof import("./pretty.ts"));
}
var mir_pretty__m: typeof import("./pretty.ts") | undefined;
/** `impl Debug for VarDebugInfo` (pretty.rs:557). */
export const debug_VarDebugInfo: Debug<VarDebugInfo> = (v, f) => mir_pretty().debug_VarDebugInfo(v, f);

// ---- companions of this file's enums / newtype indices (PORTING §8) ----
export interface Local_methods {
  // mod.rs:880 (lane mir-body-a)
  arg(i: number): Local;
}
export type Local = gen.Local;
export const Local = gen.Local as typeof gen.Local & Local_methods;
export interface ClearCrossCrate_methods {
  // mod.rs:779 (lane mir-body-a)
  as_ref<T>(self: ClearCrossCrate<T>): ClearCrossCrate<T>;
  // mod.rs:786 (lane mir-body-a)
  as_mut<T>(self: ClearCrossCrate<T>): ClearCrossCrate<T>;
  // mod.rs:793 (lane mir-body-a)
  unwrap_crate_local<T>(self: ClearCrossCrate<T>): T;
}
export type ClearCrossCrate<T> = gen.ClearCrossCrate<T>;
export const ClearCrossCrate = gen.ClearCrossCrate as typeof gen.ClearCrossCrate & ClearCrossCrate_methods;
export interface BasicBlock_methods {
  // mod.rs:1311 (lane mir-body-a)
  start_location(self: BasicBlock): Location;
}
export type BasicBlock = gen.BasicBlock;
export const BasicBlock = gen.BasicBlock as typeof gen.BasicBlock & BasicBlock_methods;
export interface SourceScope_methods {
  // mod.rs:1447 (lane mir-body-a)
  lint_root(self: SourceScope, source_scopes: readonly SourceScopeData[]): HirId | undefined;
  // mod.rs:1467 (lane mir-body-a)
  inlined_instance(self: SourceScope, source_scopes: readonly SourceScopeData[]): Instance | undefined;
}
export type SourceScope = gen.SourceScope;
export const SourceScope = gen.SourceScope as typeof gen.SourceScope & SourceScope_methods;
export interface DefLocation_methods {
  // mod.rs:1668 (lane mir-body-a)
  dominates(self: DefLocation, location: Location, dominators: Dominators<BasicBlock>): boolean;
}
export type DefLocation = gen.DefLocation;
export const DefLocation = gen.DefLocation as typeof gen.DefLocation & DefLocation_methods;

declare module "./mod.gen.ts" {
  namespace Location {
    // mod.rs:1599 `pub const START: Location`
    const START: Location;
  }
}
// impl Location { pub const START: Location = Location { block: START_BLOCK, statement_index: 0 }; } (mod.rs:1599)
(Location as unknown as { START: Location }).START = new Location(gen.START_BLOCK, 0);

declare module "./mod.gen.ts" {
  interface Body {
    // mod.rs:87 impl HasLocalDecls (PORT: `local_decls_`, the field `local_decls` holds the name)
    local_decls_(): LocalDecls;
    // mod.rs:411 (lane mir-body-a)
    basic_blocks_mut(): BasicBlockData[];
    // mod.rs:415 (lane mir-body-a)
    typing_env(tcx: TyCtxt): TypingEnv;
    // mod.rs:454 (lane mir-body-a)
    local_kind(local: Local): LocalKind;
    // mod.rs:472 (lane mir-body-a)
    mut_vars_iter(): IterableIterator<Local>;
    // mod.rs:482 (lane mir-body-a)
    mut_vars_and_args_iter(): IterableIterator<Local>;
    // mod.rs:498 (lane mir-body-a)
    args_iter(): readonly Local[];
    // mod.rs:505 (lane mir-body-a)
    vars_and_temps_iter(): readonly Local[];
    // mod.rs:512 (lane mir-body-a)
    drain_vars_and_temps(): IterableIterator<LocalDecl>;
    // mod.rs:517 (lane mir-body-a)
    source_info(location: Location): SourceInfo;
    // mod.rs:531 (lane mir-body-a)
    return_ty(): Ty;
    // mod.rs:537 (lane mir-body-a)
    bound_return_ty(tcx: TyCtxt): EarlyBinder<Ty>;
    // mod.rs:543 (lane mir-body-a)
    terminator_loc(bb: BasicBlock): Location;
    // mod.rs:547 (lane mir-body-a)
    stmt_at(location: Location): Either<Statement, Terminator>;
    // mod.rs:558 (lane mir-body-a)
    yield_ty(): Ty | undefined;
    // mod.rs:563 (lane mir-body-a)
    resume_ty(): Ty | undefined;
    // mod.rs:569 (lane mir-body-a)
    coroutine_layout_raw(): CoroutineLayout | undefined;
    // mod.rs:574 (lane mir-body-a)
    coroutine_drop(): Body | undefined;
    // mod.rs:579 (lane mir-body-a)
    coroutine_drop_async(): Body | undefined;
    // mod.rs:584 (lane mir-body-a)
    coroutine_requires_async_drop(): boolean;
    // mod.rs:589 (lane mir-body-a)
    future_drop_poll(): Body | undefined;
    // mod.rs:599 (lane mir-body-a)
    coroutine_kind(): CoroutineKind | undefined;
    // mod.rs:604 (lane mir-body-a)
    should_skip(): boolean;
    // mod.rs:612 (lane mir-body-a)
    is_custom_mir(): boolean;
    // mod.rs:691 (lane mir-body-a)
    caller_location_span<T>(source_info: SourceInfo, caller_location: T | undefined, tcx: TyCtxt, from_span: (a0: Span) => T): T;
    // mod.rs:722 (lane mir-body-a)
    set_required_consts(required_consts: ConstOperand[]): void;
    // mod.rs:731 (lane mir-body-a)
    required_consts_(): readonly ConstOperand[]; // PORT: the field `required_consts` holds the name
    // mod.rs:739 (lane mir-body-a)
    set_mentioned_items(mentioned_items: Spanned<MentionedItem>[]): void;
    // mod.rs:748 (lane mir-body-a)
    mentioned_items_(): readonly Spanned<MentionedItem>[]; // PORT: the field `mentioned_items` holds the name
    // mod.rs:760 (lane mir-body-a) impl Index<BasicBlock>
    index(index: BasicBlock): BasicBlockData;
    // mod.rs:767 (lane mir-body-a) impl IndexMut<BasicBlock>
    index_mut(index: BasicBlock): BasicBlockData;
  }
}

declare module "./syntax.ts" {
  interface MirPhase_methods {
    // mod.rs:93 (lane mir-body-a)
    name(self: MirPhase): string;
    // mod.rs:106 (lane mir-body-a)
    index(self: MirPhase): [number, number];
  }
}

declare module "./mod.gen.ts" {
  namespace MirSource {
    // mod.rs:126 (lane mir-body-a)
    export function item(def_id: DefId): MirSource;
    // mod.rs:130 (lane mir-body-a)
    export function from_shim(shim: ShimKind): MirSource;
  }
}

declare module "./mod.gen.ts" {
  interface MirSource {
    // mod.rs:135 (lane mir-body-a)
    def_id(): DefId;
  }
}

declare module "./mod.gen.ts" {
  namespace CoroutineInfo {
    // mod.rs:172 (lane mir-body-a)
    export function initial(coroutine_kind: CoroutineKind, yield_ty: Ty, resume_ty: Ty): CoroutineInfo;
  }
}

declare module "./mod.gen.ts" {
  namespace Body {
    // mod.rs:334 (lane mir-body-a)
    function new_(source: MirSource, basic_blocks: BasicBlockData[], source_scopes: SourceScopeData[], local_decls: LocalDecl[], user_type_annotations: CanonicalUserTypeAnnotations, arg_count: number, var_debug_info: VarDebugInfo[], span: Span, coroutine: CoroutineInfo | undefined, tainted_by_errors: ErrorGuaranteed | undefined): Body;
    export { new_ as new };
    // mod.rs:384 (lane mir-body-a)
    export function new_cfg_only(basic_blocks: BasicBlockData[]): Body;
    // mod.rs:619 (lane mir-body-a)
    export function try_const_mono_switchint(tcx: TyCtxt, instance: Instance, block: BasicBlockData): [bigint, SwitchTargets] | undefined;
  }
}

declare module "./mod.gen.ts" {
  namespace SourceInfo {
    // mod.rs:857 (lane mir-body-a)
    export function outermost(span: Span): SourceInfo;
  }
}

declare module "./mod.gen.ts" {
  interface LocalDecl {
    // mod.rs:1111 (lane mir-body-a)
    local_info_(): LocalInfo; // PORT: the field `local_info` holds the name
    // mod.rs:1121 (lane mir-body-a)
    can_be_made_mutable(): boolean;
    // mod.rs:1134 (lane mir-body-a)
    is_nonref_binding(): boolean;
    // mod.rs:1147 (lane mir-body-a)
    is_user_variable(): boolean;
    // mod.rs:1154 (lane mir-body-a)
    is_ref_for_guard(): boolean;
    // mod.rs:1160 (lane mir-body-a)
    is_ref_to_static(): boolean;
    // mod.rs:1166 (lane mir-body-a)
    is_ref_to_thread_local(): boolean;
    // mod.rs:1174 (lane mir-body-a)
    is_deref_temp(): boolean;
    // mod.rs:1184 (lane mir-body-a)
    from_compiler_desugaring(): boolean;
    // mod.rs:1208 (lane mir-body-a)
    immutable(): LocalDecl;
  }
}

declare module "./mod.gen.ts" {
  namespace LocalDecl {
    // mod.rs:1190 (lane mir-body-a)
    function new_(ty: Ty, span: Span): LocalDecl;
    export { new_ as new };
    // mod.rs:1196 (lane mir-body-a)
    export function with_source_info(ty: Ty, source_info: SourceInfo): LocalDecl;
  }
}

declare module "./mod.gen.ts" {
  namespace BasicBlockData {
    // mod.rs:1350 (lane mir-body-a)
    function new_(terminator: Terminator | undefined, is_cleanup: boolean): BasicBlockData;
    export { new_ as new };
    // mod.rs:1354 (lane mir-body-a)
    export function new_stmts(statements: Statement[], terminator: Terminator | undefined, is_cleanup: boolean): BasicBlockData;
  }
}

declare module "./mod.gen.ts" {
  interface BasicBlockData {
    // mod.rs:1372 (lane mir-body-a)
    terminator_(): Terminator; // PORT: the field `terminator` holds the name
    // mod.rs:1377 (lane mir-body-a)
    terminator_mut(): Terminator;
    // mod.rs:1383 (lane mir-body-a)
    is_empty_unreachable(): boolean;
    // mod.rs:1392 (lane mir-body-a)
    mono_successors(tcx: TyCtxt, instance: Instance): Successors;
    // mod.rs:1400 (lane mir-body-a)
    retain_statements(f: (s: Statement) => boolean): void;
    // mod.rs:1419 (lane mir-body-a)
    strip_nops(): void;
    // mod.rs:1423 (lane mir-body-a)
    drop_debuginfo(): void;
  }
}

declare module "./mod.gen.ts" {
  interface UserTypeProjections {
    // mod.rs:1546 (lane mir-body-a)
    projections(): readonly UserTypeProjection[];
  }
}

declare module "./mod.gen.ts" {
  interface Location {
    // mod.rs:1606 (lane mir-body-a)
    successor_within_block(): Location;
    // mod.rs:1611 (lane mir-body-a)
    is_predecessor_of(other: Location, body: Body): boolean;
    // mod.rs:1643 (lane mir-body-a)
    dominates(other: Location, dominators: Dominators<BasicBlock>): boolean;
    // mod.rs:1652 (lane mir-body-a)
    strictly_dominates(other: Location, dominators: Dominators<BasicBlock>): boolean;
  }
}

// rustc-trait: compiler/rustc_middle/src/mir/mod.rs:67 HasLocalDecls
/**
 * PORT: `D: HasLocalDecls<'tcx>` is this union: its implementors are `IndexVec<Local, LocalDecl>` / `LocalDecls` (both
 * `LocalDecl[]`) and `Body`. `HasLocalDecls.local_decls(d)` dispatches to their impls.
 */
export type HasLocalDecls = LocalDecls | Body;
export const HasLocalDecls = {
  // rustc: compiler/rustc_middle/src/mir/mod.rs:68 local_decls
  local_decls(self: HasLocalDecls): LocalDecls {
    return Array.isArray(self) ? LocalDecls_local_decls(self) : (self as Body).local_decls_();
  },
};

// impl HasLocalDecls for IndexVec<Local, LocalDecl>
// rustc: compiler/rustc_middle/src/mir/mod.rs:73 local_decls
export function IndexVec_local_decls(self: LocalDecl[]): LocalDecls {
  return self;
}

// impl HasLocalDecls for LocalDecls
// rustc: compiler/rustc_middle/src/mir/mod.rs:80 local_decls
export function LocalDecls_local_decls(self: LocalDecls): LocalDecls {
  return self;
}

// impl HasLocalDecls for Body
// rustc: compiler/rustc_middle/src/mir/mod.rs:87 local_decls
Body.prototype.local_decls_ = function (this: Body): LocalDecls {
  return this.local_decls;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:93 name
MirPhase.name = function (self: MirPhase): string {
  if (self.$ === "Built") return "built";
  else if (self.$ === "Analysis" && self._0 === "Initial") return "analysis";
  else if (self.$ === "Analysis" && self._0 === "PostCleanup") return "analysis-post-cleanup";
  else if (self.$ === "Runtime" && self._0 === "Initial") return "runtime";
  else if (self.$ === "Runtime" && self._0 === "PostCleanup") return "runtime-post-cleanup";
  else if (self.$ === "Runtime" && self._0 === "Optimized") return "runtime-optimized";
  return unreachable();
};

/// Gets the (dialect, phase) index of the current `MirPhase`. Both numbers
/// are 1-indexed.
// rustc: compiler/rustc_middle/src/mir/mod.rs:106 index
MirPhase.index = function (self: MirPhase): [number, number] {
  switch (self.$) {
    case "Built":
      return [1, 1];
    case "Analysis":
      return [2, 1 + AnalysisPhase_discriminant[self._0]];
    case "Runtime":
      return [3, 1 + RuntimePhase_discriminant[self._0]];
  }
};

/**
 * PORT: `#[derive(PartialOrd)]` of `MirPhase` (syntax.rs:43): variants in declaration order (`Built`, `Analysis`,
 * `Runtime`), then the phase's discriminant. `a > b`.
 */
function MirPhase_gt(a: MirPhase, b: MirPhase): boolean {
  const order = { Built: 0, Analysis: 1, Runtime: 2 } as const;
  if (order[a.$] !== order[b.$]) return order[a.$] > order[b.$];
  if (a.$ === "Analysis" && b.$ === "Analysis") return AnalysisPhase_discriminant[a._0] > AnalysisPhase_discriminant[b._0];
  if (a.$ === "Runtime" && b.$ === "Runtime") return RuntimePhase_discriminant[a._0] > RuntimePhase_discriminant[b._0];
  return false;
}

// rustc: compiler/rustc_middle/src/mir/mod.rs:126 item
(MirSource as unknown as { item: typeof MirSource.item }).item = function (def_id: DefId): MirSource {
  return new MirSource({ $: "Item", _0: def_id }, undefined);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:130 from_shim
(MirSource as unknown as { from_shim: typeof MirSource.from_shim }).from_shim = function (shim: ShimKind): MirSource {
  return new MirSource({ $: "Shim", _0: shim }, undefined);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:135 def_id
MirSource.prototype.def_id = function (this: MirSource): DefId {
  return ty_instance().InstanceKind.def_id(this.instance);
};

// Sets up `CoroutineInfo` for a pre-coroutine-transform MIR body.
// rustc: compiler/rustc_middle/src/mir/mod.rs:172 initial
(CoroutineInfo as unknown as { initial: typeof CoroutineInfo.initial }).initial = function (coroutine_kind: CoroutineKind, yield_ty: Ty, resume_ty: Ty): CoroutineInfo {
  return new CoroutineInfo(yield_ty, resume_ty, undefined, undefined, undefined, undefined, coroutine_kind);
};

/** `impl TypeVisitable for Body` (derived, mod.gen.ts) as a D4 descriptor. */
const Body_visitable: TypeVisitable<Body> = { visit_with: (self, visitor) => visit_with_Body(self, visitor) };

// rustc: compiler/rustc_middle/src/mir/mod.rs:334 new
(Body as unknown as { new: typeof Body.new }).new = function (source: MirSource, basic_blocks: BasicBlockData[], source_scopes: SourceScopeData[], local_decls: LocalDecl[], user_type_annotations: CanonicalUserTypeAnnotations, arg_count: number, var_debug_info: VarDebugInfo[], span: Span, coroutine: CoroutineInfo | undefined, tainted_by_errors: ErrorGuaranteed | undefined): Body {
  // We need `arg_count` locals, and one for the return place.
  if (!(local_decls.length > arg_count)) {
    panic(`expected at least ${arg_count + 1} locals, got ${local_decls.length}`);
  }

  const body = new Body(
    BasicBlocks.new(basic_blocks),
    MirPhase.Built,
    0,
    source,
    source_scopes,
    coroutine,
    local_decls,
    user_type_annotations,
    arg_count,
    undefined,
    var_debug_info,
    span,
    undefined,
    undefined,
    false,
    undefined,
    tainted_by_errors,
    undefined,
    undefined,
  );
  body.is_polymorphic = type_ir_visit().TypeVisitableExt.has_non_region_param(body, Body_visitable);
  return body;
};

/// Returns a partially initialized MIR body containing only a list of basic blocks.
///
/// The returned MIR contains no `LocalDecl`s (even for the return place) or source scopes. It
/// is only useful for testing but cannot be `#[cfg(test)]` because it is used in a different
/// crate.
// rustc: compiler/rustc_middle/src/mir/mod.rs:384 new_cfg_only
(Body as unknown as { new_cfg_only: typeof Body.new_cfg_only }).new_cfg_only = function (basic_blocks: BasicBlockData[]): Body {
  const body = new Body(
    BasicBlocks.new(basic_blocks),
    MirPhase.Built,
    0,
    MirSource.item(LocalDefId.to_def_id(CRATE_DEF_ID)),
    [],
    undefined,
    [],
    [],
    0,
    undefined,
    [],
    DUMMY_SP,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  body.is_polymorphic = type_ir_visit().TypeVisitableExt.has_non_region_param(body, Body_visitable);
  return body;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:411 basic_blocks_mut
Body.prototype.basic_blocks_mut = function (this: Body): BasicBlockData[] {
  return this.basic_blocks.as_mut();
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:415 typing_env
Body.prototype.typing_env = function (this: Body, tcx: TyCtxt): TypingEnv {
  const { TypingEnv } = ty_mod();
  const { TypingMode } = infer_ctxt();
  if (tcx.use_typing_mode_post_typeck_until_borrowck()) {
    const phase = this.phase;
    let def_id: LocalDefId | undefined;
    if ((phase.$ === "Built" || (phase.$ === "Analysis" && phase._0 === "Initial")) && (def_id = this.source.def_id().as_local()) !== undefined) {
      return TypingEnv.new(tcx.param_env(this.source.def_id()) as ParamEnv, TypingMode.borrowck(as_interner(tcx), def_id));
    } else if (phase.$ === "Analysis" && phase._0 === "PostCleanup" && (def_id = this.source.def_id().as_local()) !== undefined) {
      return TypingEnv.new(tcx.param_env(this.source.def_id()) as ParamEnv, TypingMode.post_borrowck_analysis(as_interner(tcx), def_id));
    } else if (phase.$ === "Built" || phase.$ === "Analysis") {
      // This branch happens for drop glue and fn ptr shims.
      // FIXME: why do we do any of this analysis on drop glue etc?
      // This should ideally all be skipped.
      return TypingEnv.post_analysis(tcx, this.source.def_id());
    } else {
      return TypingEnv.post_analysis(tcx, this.source.def_id());
    }
  } else {
    switch (this.phase.$) {
      case "Built":
      case "Analysis":
        return TypingEnv.new(tcx.param_env(this.source.def_id()) as ParamEnv, TypingMode.non_body_analysis());
      case "Runtime":
        return TypingEnv.post_analysis(tcx, this.source.def_id());
    }
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:454 local_kind
Body.prototype.local_kind = function (this: Body, local: Local): LocalKind {
  const index = Local.as_usize(local);
  if (index === 0) {
    // debug_assert!(
    //     self.local_decls[local].mutability == Mutability::Mut,
    //     "return place should be mutable"
    // );

    return "ReturnPointer";
  } else if (index < this.arg_count + 1) {
    return "Arg";
  } else {
    return "Temp";
  }
};

/// Returns an iterator over all user-declared mutable locals.
// rustc: compiler/rustc_middle/src/mir/mod.rs:472 mut_vars_iter
Body.prototype.mut_vars_iter = function* (this: Body): Generator<Local, undefined, unknown> {
  for (let index = this.arg_count + 1; index < this.local_decls.length; index++) {
    const local = Local.new(index);
    const decl = this.local_decls[local]!;
    if (decl.is_user_variable() && Mutability.is_mut(decl.mutability)) yield local;
  }
  return undefined;
};

/// Returns an iterator over all user-declared mutable arguments and locals.
// rustc: compiler/rustc_middle/src/mir/mod.rs:482 mut_vars_and_args_iter
Body.prototype.mut_vars_and_args_iter = function* (this: Body): Generator<Local, undefined, unknown> {
  for (let index = 1; index < this.local_decls.length; index++) {
    const local = Local.new(index);
    const decl = this.local_decls[local]!;
    if ((decl.is_user_variable() || index < this.arg_count + 1) && decl.mutability === Mutability.Mut) {
      yield local;
    }
  }
  return undefined;
};

/// Returns an iterator over all function arguments.
// rustc: compiler/rustc_middle/src/mir/mod.rs:498 args_iter
Body.prototype.args_iter = function (this: Body): readonly Local[] {
  const out: Local[] = [];
  for (let i = 1; i < this.arg_count + 1; i++) out.push(Local.new(i));
  return out;
};

/// Returns an iterator over all user-defined variables and compiler-generated temporaries (all
/// locals that are neither arguments nor the return place).
// rustc: compiler/rustc_middle/src/mir/mod.rs:505 vars_and_temps_iter
Body.prototype.vars_and_temps_iter = function (this: Body): readonly Local[] {
  const out: Local[] = [];
  for (let i = this.arg_count + 1; i < this.local_decls.length; i++) out.push(Local.new(i));
  return out;
};

// PORT: `Vec::drain(arg_count + 1..)` removes the range when the `Drain` is dropped; `splice` removes it now and the
// iterator walks the removed decls (same contents, same order).
// rustc: compiler/rustc_middle/src/mir/mod.rs:512 drain_vars_and_temps
Body.prototype.drain_vars_and_temps = function (this: Body): IterableIterator<LocalDecl> {
  return this.local_decls.splice(this.arg_count + 1)[Symbol.iterator]();
};

/// Returns the source info associated with `location`.
// rustc: compiler/rustc_middle/src/mir/mod.rs:517 source_info
Body.prototype.source_info = function (this: Body, location: Location): SourceInfo {
  const block = this.index(location.block);
  const stmts = block.statements;
  const idx = location.statement_index;
  if (idx < stmts.length) {
    return stmts[idx]!.source_info;
  } else {
    assert_eq(idx, stmts.length, String);
    return block.terminator_().source_info;
  }
};

/// Returns the return type; it always return first element from `local_decls` array.
// rustc: compiler/rustc_middle/src/mir/mod.rs:531 return_ty
Body.prototype.return_ty = function (this: Body): Ty {
  return this.local_decls[RETURN_PLACE]!.ty;
};

/// Returns the return type; it always return first element from `local_decls` array.
// rustc: compiler/rustc_middle/src/mir/mod.rs:537 bound_return_ty
Body.prototype.bound_return_ty = function (this: Body, tcx: TyCtxt): EarlyBinder<Ty> {
  return binder().EarlyBinder.bind(tcx, this.local_decls[RETURN_PLACE]!.ty, structural_impls().fold_Ty);
};

/// Gets the location of the terminator for the given block.
// rustc: compiler/rustc_middle/src/mir/mod.rs:543 terminator_loc
Body.prototype.terminator_loc = function (this: Body, bb: BasicBlock): Location {
  return new Location(bb, this.index(bb).statements.length);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:547 stmt_at
Body.prototype.stmt_at = function (this: Body, location: Location): Either<Statement, Terminator> {
  const { block, statement_index } = location;
  const block_data = this.basic_blocks.deref()[block]!;
  const stmt = block_data.statements[statement_index];
  return stmt !== undefined ? { $: "Left", _0: stmt } : { $: "Right", _0: block_data.terminator_() };
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:558 yield_ty
Body.prototype.yield_ty = function (this: Body): Ty | undefined {
  return this.coroutine === undefined ? undefined : this.coroutine.yield_ty;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:563 resume_ty
Body.prototype.resume_ty = function (this: Body): Ty | undefined {
  return this.coroutine === undefined ? undefined : this.coroutine.resume_ty;
};

/// Prefer going through [`TyCtxt::coroutine_layout`] rather than using this directly.
// rustc: compiler/rustc_middle/src/mir/mod.rs:569 coroutine_layout_raw
Body.prototype.coroutine_layout_raw = function (this: Body): CoroutineLayout | undefined {
  return this.coroutine === undefined ? undefined : this.coroutine.coroutine_layout;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:574 coroutine_drop
Body.prototype.coroutine_drop = function (this: Body): Body | undefined {
  return this.coroutine === undefined ? undefined : this.coroutine.coroutine_drop;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:579 coroutine_drop_async
Body.prototype.coroutine_drop_async = function (this: Body): Body | undefined {
  return this.coroutine === undefined ? undefined : this.coroutine.coroutine_drop_async;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:584 coroutine_requires_async_drop
Body.prototype.coroutine_requires_async_drop = function (this: Body): boolean {
  return this.coroutine_drop_async() !== undefined;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:589 future_drop_poll
Body.prototype.future_drop_poll = function (this: Body): Body | undefined {
  const coroutine = this.coroutine;
  if (coroutine === undefined) return undefined;
  return coroutine.coroutine_drop_async !== undefined ? coroutine.coroutine_drop_async : coroutine.coroutine_drop_proxy_async;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:599 coroutine_kind
Body.prototype.coroutine_kind = function (this: Body): CoroutineKind | undefined {
  return this.coroutine === undefined ? undefined : this.coroutine.coroutine_kind;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:604 should_skip
Body.prototype.should_skip = function (this: Body): boolean {
  const injection_phase = this.injection_phase;
  if (injection_phase === undefined) {
    return false;
  }
  return MirPhase_gt(injection_phase, this.phase);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:612 is_custom_mir
Body.prototype.is_custom_mir = function (this: Body): boolean {
  return this.injection_phase !== undefined;
};

/** `impl TypeFoldable for mir::Const` (derived, consts.gen.ts) as a D4 descriptor. */
const mir_Const_foldable: TypeFoldable<mir_Const> = {
  visit_with: (self, visitor) => visit_with_Const(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_Const(self, folder),
  fold_with: (self, folder) => fold_with_Const(self, folder),
};

/// If this basic block ends with a [`TerminatorKind::SwitchInt`] for which we can evaluate the
/// discriminant in monomorphization, we return the discriminant bits and the
/// [`SwitchTargets`], just so the caller doesn't also have to match on the terminator.
// rustc: compiler/rustc_middle/src/mir/mod.rs:619 try_const_mono_switchint
(Body as unknown as { try_const_mono_switchint: typeof Body.try_const_mono_switchint }).try_const_mono_switchint = function (tcx: TyCtxt, instance: Instance, block: BasicBlockData): [bigint, SwitchTargets] | undefined {
  // There are two places here we need to evaluate a constant.
  const eval_mono_const = (constant: ConstOperand): bigint | undefined => {
    // FIXME(#132279): what is this, why are we using an empty environment here.
    const typing_env = ty_mod().TypingEnv.fully_monomorphized();
    const mono_literal = ty_instance().Instance.instantiate_mir_and_normalize_erasing_regions(
      instance,
      tcx,
      typing_env,
      binder().EarlyBinder.bind(tcx, constant.const_, mir_Const_foldable),
      mir_Const_foldable,
    );
    return mir_Const.try_eval_bits(mono_literal, tcx, typing_env);
  };

  const kind = block.terminator_().kind;
  if (kind.$ !== "SwitchInt") {
    return undefined;
  }
  const { discr: discr_, targets } = kind;

  // If this is a SwitchInt(const _), then we can just evaluate the constant and return.
  let discr: Place;
  switch (discr_.$) {
    case "Constant": {
      const bits = eval_mono_const(discr_._0);
      if (bits === undefined) return undefined;
      return [bits, targets];
    }
    case "RuntimeChecks": {
      // PORT: `check.value(tcx.sess) as u128`: a bool as 0 / 1.
      const bits = RuntimeChecks.value(discr_._0, tcx.sess) ? 1n : 0n;
      return [bits, targets];
    }
    case "Move":
    case "Copy":
      discr = discr_._0;
      break;
  }

  // MIR for `if false` actually looks like this:
  // _1 = const _
  // SwitchInt(_1)
  //
  // And MIR for if intrinsics::ub_checks() looks like this:
  // _1 = UbChecks()
  // SwitchInt(_1)
  //
  // So we're going to try to recognize this pattern.
  //
  // If we have a SwitchInt on a non-const place, we find the most recent statement that
  // isn't a storage marker. If that statement is an assignment of a const to our
  // discriminant place, we evaluate and return the const, as if we've const-propagated it
  // into the SwitchInt.

  let last_stmt: Statement | undefined;
  for (let i = block.statements.length - 1; i >= 0; i--) {
    const stmt = block.statements[i]!;
    if (!(stmt.kind.$ === "StorageDead" || stmt.kind.$ === "StorageLive")) {
      last_stmt = stmt;
      break;
    }
  }
  if (last_stmt === undefined) return undefined;

  const assign = StatementKind.as_assign(last_stmt.kind);
  if (assign === undefined) return undefined;
  const [place, rvalue] = assign;

  // PORT: `Place: PartialEq` (derived): the local and the interned projection list (identity, PORTING §5).
  if (!(discr.local === place.local && discr.projection === place.projection)) {
    return undefined;
  }

  if (rvalue.$ === "Use" && rvalue._0.$ === "Constant") {
    const bits = eval_mono_const(rvalue._0._0);
    if (bits === undefined) return undefined;
    return [bits, targets];
  } else {
    return undefined;
  }
};

/// For a `Location` in this scope, determine what the "caller location" at that point is. This
/// is interesting because of inlining: the `#[track_caller]` attribute of inlined functions
/// must be honored. Falls back to the `tracked_caller` value for `#[track_caller]` functions,
/// or the function's scope.
// rustc: compiler/rustc_middle/src/mir/mod.rs:691 caller_location_span
Body.prototype.caller_location_span = function <T>(this: Body, source_info_: SourceInfo, caller_location: T | undefined, tcx: TyCtxt, from_span: (a0: Span) => T): T {
  // PORT: `mut source_info: SourceInfo` is a by-value copy (PORTING §8 clone rule).
  const source_info = clone_SourceInfo(source_info_);
  for (;;) {
    const scope_data = this.source_scopes[source_info.scope]!;

    if (scope_data.inlined !== undefined) {
      const [callee, callsite_span] = scope_data.inlined;
      // Stop inside the most nested non-`#[track_caller]` function,
      // before ever reaching its caller (which is irrelevant).
      if (!ty_instance().InstanceKind.requires_caller_location(callee.def, tcx)) {
        return from_span(source_info.span);
      }
      source_info.span = callsite_span;
    }

    // Skip past all of the parents with `inlined: None`.
    const parent = scope_data.inlined_parent_scope;
    if (parent !== undefined) {
      source_info.scope = parent;
    } else {
      break;
    }
  }

  // No inlined `SourceScope`s, or all of them were `#[track_caller]`.
  return caller_location !== undefined ? caller_location : from_span(source_info.span);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:722 set_required_consts
Body.prototype.set_required_consts = function (this: Body, required_consts: ConstOperand[]): void {
  if (!(this.required_consts === undefined)) {
    panic(`required_consts for ${debug_DefId(this.source.def_id(), PLAIN)} have already been set`);
  }
  this.required_consts = required_consts;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:731 required_consts
Body.prototype.required_consts_ = function (this: Body): readonly ConstOperand[] {
  const l = this.required_consts;
  if (l !== undefined) {
    return l;
  } else {
    return panic(`required_consts for ${debug_DefId(this.source.def_id(), PLAIN)} have not yet been set`);
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:739 set_mentioned_items
Body.prototype.set_mentioned_items = function (this: Body, mentioned_items: Spanned<MentionedItem>[]): void {
  if (!(this.mentioned_items === undefined)) {
    panic(`mentioned_items for ${debug_DefId(this.source.def_id(), PLAIN)} have already been set`);
  }
  this.mentioned_items = mentioned_items;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:748 mentioned_items
Body.prototype.mentioned_items_ = function (this: Body): readonly Spanned<MentionedItem>[] {
  const l = this.mentioned_items;
  if (l !== undefined) {
    return l;
  } else {
    return panic(`mentioned_items for ${debug_DefId(this.source.def_id(), PLAIN)} have not yet been set`);
  }
};

// impl Index<BasicBlock> for Body
// rustc: compiler/rustc_middle/src/mir/mod.rs:760 index
Body.prototype.index = function (this: Body, index: BasicBlock): BasicBlockData {
  return this.basic_blocks.deref()[index]!;
};

// impl IndexMut<BasicBlock> for Body
// rustc: compiler/rustc_middle/src/mir/mod.rs:767 index_mut
Body.prototype.index_mut = function (this: Body, index: BasicBlock): BasicBlockData {
  return this.basic_blocks.as_mut()[index]!;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:779 as_ref
ClearCrossCrate.as_ref = function <T>(self: ClearCrossCrate<T>): ClearCrossCrate<T> {
  switch (self.$) {
    case "Clear":
      return ClearCrossCrate.Clear;
    case "Set":
      return { $: "Set", _0: self._0 };
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:786 as_mut
ClearCrossCrate.as_mut = function <T>(self: ClearCrossCrate<T>): ClearCrossCrate<T> {
  switch (self.$) {
    case "Clear":
      return ClearCrossCrate.Clear;
    case "Set":
      return { $: "Set", _0: self._0 };
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:793 unwrap_crate_local
ClearCrossCrate.unwrap_crate_local = function <T>(self: ClearCrossCrate<T>): T {
  switch (self.$) {
    case "Clear":
      return bug("unwrapping cross-crate data");
    case "Set":
      return self._0;
  }
};

const TAG_CLEAR_CROSS_CRATE_CLEAR = 0;
const TAG_CLEAR_CROSS_CRATE_SET = 1;

// rustc-skip: compiler/rustc_middle/src/mir/mod.rs:806 encode Encodable (metadata encoding, M5)

/**
 * `D::CLEAR_CROSS_CRATE` (ty/codec.ts: each `TyDecoder` implementor exports `<Impl>_CLEAR_CROSS_CRATE`).
 * PORT: the only `TyDecoder` ported is rustc_metadata's `MetadataDecodeContext` (`true`), loaded lazily (rustc_middle
 * sits below rustc_metadata); the incremental `CacheDecoder` (`false`, M5) is not ported.
 */
function CLEAR_CROSS_CRATE(d: TyDecoder): boolean {
  const rmeta = rmeta_decoder();
  if (d instanceof rmeta.MetadataDecodeContext) return rmeta.MetadataDecodeContext_CLEAR_CROSS_CRATE;
  return unported("rustc_middle::query::on_disk_cache::CacheDecoder (TyDecoder::CLEAR_CROSS_CRATE)");
}

// impl<'tcx, D: TyDecoder<'tcx>, T: Decodable<D>> Decodable<D> for ClearCrossCrate<T>
// rustc: compiler/rustc_middle/src/mir/mod.rs:822 decode
export function decode_ClearCrossCrate<T>(d: TyDecoder, decode_T: (d: TyDecoder) => T): ClearCrossCrate<T> {
  if (CLEAR_CROSS_CRATE(d)) {
    return ClearCrossCrate.Clear;
  }

  const discr = decode_u8(d);

  switch (discr) {
    case TAG_CLEAR_CROSS_CRATE_CLEAR:
      return ClearCrossCrate.Clear;
    case TAG_CLEAR_CROSS_CRATE_SET: {
      const val = decode_T(d);
      return { $: "Set", _0: val };
    }
    default: {
      const tag = discr;
      return panic(`Invalid tag for ClearCrossCrate: ${tag}`);
    }
  }
}

// rustc: compiler/rustc_middle/src/mir/mod.rs:857 outermost
(SourceInfo as unknown as { outermost: typeof SourceInfo.outermost }).outermost = function (span: Span): SourceInfo {
  return new SourceInfo(span, OUTERMOST_SOURCE_SCOPE);
};

/// Makes a `Local` for the `i`-th argument to a function.
///
/// `Local(0)` is the [`RETURN_PLACE`], with the arguments after that,
/// so `arg(i)` will give `Local(i + 1)`.
// rustc: compiler/rustc_middle/src/mir/mod.rs:880 arg
Local.arg = function (i: number): Local {
  return Local.from_usize(i + 1);
};

// impl polonius_engine::Atom for Local (PORT: a free fn: `Local.index` is the `newtype_index!` one)
// rustc: compiler/rustc_middle/src/mir/mod.rs:886 index
export function Atom_index_Local(self: Local): number {
  return Local.index(self);
}

// rustc: compiler/rustc_middle/src/mir/mod.rs:1111 local_info
LocalDecl.prototype.local_info_ = function (this: LocalDecl): LocalInfo {
  return ClearCrossCrate.unwrap_crate_local(ClearCrossCrate.as_ref(this.local_info));
};

/// Returns `true` only if local is a binding that can itself be
/// made mutable via the addition of the `mut` keyword, namely
/// something like the occurrences of `x` in:
/// - `fn foo(x: Type) { ... }`,
/// - `let x = ...`,
/// - or `match ... { C(x) => ... }`
// rustc: compiler/rustc_middle/src/mir/mod.rs:1121 can_be_made_mutable
LocalDecl.prototype.can_be_made_mutable = function (this: LocalDecl): boolean {
  const info = this.local_info_();
  return (
    info.$ === "User" &&
    ((info._0.$ === "Var" && info._0._0.binding_mode._0.$ === "No") || (info._0.$ === "ImplicitSelf" && info._0._0 === "Imm"))
  );
};

/// Returns `true` if local is definitely not a `ref ident` or
/// `ref mut ident` binding. (Such bindings cannot be made into
/// mutable bindings, but the inverse does not necessarily hold).
// rustc: compiler/rustc_middle/src/mir/mod.rs:1134 is_nonref_binding
LocalDecl.prototype.is_nonref_binding = function (this: LocalDecl): boolean {
  const info = this.local_info_();
  return info.$ === "User" && ((info._0.$ === "Var" && info._0._0.binding_mode._0.$ === "No") || info._0.$ === "ImplicitSelf");
};

/// Returns `true` if this variable is a named variable or function
/// parameter declared by the user.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1147 is_user_variable
LocalDecl.prototype.is_user_variable = function (this: LocalDecl): boolean {
  return this.local_info_().$ === "User";
};

/// Returns `true` if this is a reference to a variable bound in a `match`
/// expression that is used to access said variable for the guard of the
/// match arm.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1154 is_ref_for_guard
LocalDecl.prototype.is_ref_for_guard = function (this: LocalDecl): boolean {
  const info = this.local_info_();
  return info.$ === "User" && info._0.$ === "RefForGuard";
};

/// Returns `Some` if this is a reference to a static item that is used to
/// access that static.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1160 is_ref_to_static
LocalDecl.prototype.is_ref_to_static = function (this: LocalDecl): boolean {
  return this.local_info_().$ === "StaticRef";
};

/// Returns `Some` if this is a reference to a thread-local static item that is used to
/// access that static.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1166 is_ref_to_thread_local
LocalDecl.prototype.is_ref_to_thread_local = function (this: LocalDecl): boolean {
  const info = this.local_info_();
  switch (info.$) {
    case "StaticRef":
      return info.is_thread_local;
    default:
      return false;
  }
};

/// Returns `true` if this is a DerefTemp
// rustc: compiler/rustc_middle/src/mir/mod.rs:1174 is_deref_temp
LocalDecl.prototype.is_deref_temp = function (this: LocalDecl): boolean {
  switch (this.local_info_().$) {
    case "DerefTemp":
      return true;
    default:
      return false;
  }
};

/// Returns `true` is the local is from a compiler desugaring, e.g.,
/// `__next` from a `for` loop.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1184 from_compiler_desugaring
LocalDecl.prototype.from_compiler_desugaring = function (this: LocalDecl): boolean {
  return Span.desugaring_kind(this.source_info.span) !== undefined;
};

/// Creates a new `LocalDecl` for a temporary, mutable.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1190 new
(LocalDecl as unknown as { new: typeof LocalDecl.new }).new = function (ty: Ty, span: Span): LocalDecl {
  return LocalDecl.with_source_info(ty, SourceInfo.outermost(span));
};

/// Like `LocalDecl::new`, but takes a `SourceInfo` instead of a `Span`.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1196 with_source_info
(LocalDecl as unknown as { with_source_info: typeof LocalDecl.with_source_info }).with_source_info = function (ty: Ty, source_info: SourceInfo): LocalDecl {
  return new LocalDecl(Mutability.Mut, { $: "Set", _0: LocalInfo.Boring }, ty, undefined, source_info);
};

/// Converts `self` into same `LocalDecl` except tagged as immutable.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1208 immutable
LocalDecl.prototype.immutable = function (this: LocalDecl): LocalDecl {
  this.mutability = Mutability.Not;
  return this;
};

// impl Debug for VarDebugInfoContents
// rustc: compiler/rustc_middle/src/mir/mod.rs:1222 fmt
export const debug_VarDebugInfoContents: Debug<VarDebugInfoContents> = (self, _fmt) => {
  switch (self.$) {
    // PORT: `write!(fmt, ..)` formats its arguments with fresh (non-alternate) flags.
    case "Const":
      return mir_pretty().display_ConstOperand(self._0);
    case "Place":
      return debug_Place(self._0, PLAIN);
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1311 start_location
BasicBlock.start_location = function (self: BasicBlock): Location {
  return new Location(self, 0);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1350 new
(BasicBlockData as unknown as { new: typeof BasicBlockData.new }).new = function (terminator: Terminator | undefined, is_cleanup: boolean): BasicBlockData {
  return BasicBlockData.new_stmts([], terminator, is_cleanup);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1354 new_stmts
(BasicBlockData as unknown as { new_stmts: typeof BasicBlockData.new_stmts }).new_stmts = function (statements: Statement[], terminator: Terminator | undefined, is_cleanup: boolean): BasicBlockData {
  // `StmtDebugInfos::default()` (derive(Default))
  return new BasicBlockData(statements, new StmtDebugInfos(undefined), terminator, is_cleanup);
};

/// Accessor for terminator.
///
/// Terminator may not be None after construction of the basic block is complete. This accessor
/// provides a convenient way to reach the terminator.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1372 terminator
BasicBlockData.prototype.terminator_ = function (this: BasicBlockData): Terminator {
  return unwrap(this.terminator, "invalid terminator state");
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1377 terminator_mut
BasicBlockData.prototype.terminator_mut = function (this: BasicBlockData): Terminator {
  return unwrap(this.terminator, "invalid terminator state");
};

/// Does the block have no statements and an unreachable terminator?
// rustc: compiler/rustc_middle/src/mir/mod.rs:1383 is_empty_unreachable
BasicBlockData.prototype.is_empty_unreachable = function (this: BasicBlockData): boolean {
  return this.statements.length === 0 && this.terminator_().kind.$ === "Unreachable";
};

/// Like [`Terminator::successors`] but tries to use information available from the [`Instance`]
/// to skip successors like the `false` side of an `if const {`.
///
/// This is used to implement [`traversal::mono_reachable`] and
/// [`traversal::mono_reachable_reverse_postorder`].
// rustc: compiler/rustc_middle/src/mir/mod.rs:1392 mono_successors
BasicBlockData.prototype.mono_successors = function (this: BasicBlockData, tcx: TyCtxt, instance: Instance): Successors {
  const r = Body.try_const_mono_switchint(tcx, instance, this);
  if (r !== undefined) {
    const [bits, targets] = r;
    return targets.successors_for_value(bits);
  } else {
    return this.terminator_().successors();
  }
};

// PORT: `Vec::retain_mut` filters `statements` in place (the array keeps its identity).
// rustc: compiler/rustc_middle/src/mir/mod.rs:1400 retain_statements
BasicBlockData.prototype.retain_statements = function (this: BasicBlockData, f: (s: Statement) => boolean): void {
  // Place debuginfos into the next retained statement,
  // this `debuginfos` variable is used to cache debuginfos between two retained statements.
  const debuginfos = new StmtDebugInfos(undefined);
  const statements = this.statements;
  let kept = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;
    const retain = f(stmt);
    if (retain) {
      stmt.debuginfos.prepend(debuginfos);
      statements[kept++] = stmt;
    } else {
      debuginfos.append(stmt.debuginfos);
    }
  }
  statements.length = kept;
  this.after_last_stmt_debuginfos.prepend(debuginfos);
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1419 strip_nops
BasicBlockData.prototype.strip_nops = function (this: BasicBlockData): void {
  this.retain_statements((stmt) => !(stmt.kind.$ === "Nop"));
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1423 drop_debuginfo
BasicBlockData.prototype.drop_debuginfo = function (this: BasicBlockData): void {
  this.after_last_stmt_debuginfos.drop_debuginfo();
  for (const stmt of this.statements) {
    stmt.debuginfos.drop_debuginfo();
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1447 lint_root
SourceScope.lint_root = function (self: SourceScope, source_scopes: readonly SourceScopeData[]): HirId | undefined {
  let data = source_scopes[self]!;
  // FIXME(oli-obk): we should be able to just walk the `inlined_parent_scope`, but it
  // does not work as I thought it would. Needs more investigation and documentation.
  while (data.inlined !== undefined) {
    // trace!(?data);
    data = source_scopes[unwrap(data.parent_scope)]!;
  }
  // trace!(?data);
  switch (data.local_data.$) {
    case "Set":
      return data.local_data._0.lint_root;
    case "Clear":
      return undefined;
  }
};

/// The instance this source scope was inlined from, if any.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1467 inlined_instance
SourceScope.inlined_instance = function (self: SourceScope, source_scopes: readonly SourceScopeData[]): Instance | undefined {
  const scope_data = source_scopes[self]!;
  if (scope_data.inlined !== undefined) {
    const [inlined_instance] = scope_data.inlined;
    return inlined_instance;
  } else if (scope_data.inlined_parent_scope !== undefined) {
    const inlined_scope = scope_data.inlined_parent_scope;
    return unwrap(source_scopes[inlined_scope]!.inlined)[0];
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1546 projections
UserTypeProjections.prototype.projections = function (this: UserTypeProjections): readonly UserTypeProjection[] {
  return this.contents;
};

// impl fmt::Debug for Location
// rustc: compiler/rustc_middle/src/mir/mod.rs:1593 fmt
export const debug_Location: Debug<Location> = (self, _fmt) => {
  return `${debug_BasicBlock(self.block, PLAIN)}[${self.statement_index}]`;
};

/// Returns the location immediately after this one within the enclosing block.
///
/// Note that if this location represents a terminator, then the
/// resulting location would be out of bounds and invalid.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1606 successor_within_block
Location.prototype.successor_within_block = function (this: Location): Location {
  return new Location(this.block, this.statement_index + 1);
};

/// Returns `true` if `other` is earlier in the control flow graph than `self`.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1611 is_predecessor_of
Location.prototype.is_predecessor_of = function (this: Location, other: Location, body: Body): boolean {
  // If we are in the same block as the other location and are an earlier statement
  // then we are a predecessor of `other`.
  if (this.block === other.block && this.statement_index < other.statement_index) {
    return true;
  }

  const predecessors = body.basic_blocks.predecessors();

  // If we're in another block, then we want to check that block is a predecessor of `other`.
  const queue: BasicBlock[] = predecessors[other.block]!.slice();
  const visited = new Set<BasicBlock>();

  let block: BasicBlock | undefined;
  while ((block = queue.pop()) !== undefined) {
    // If we haven't visited this block before, then make sure we visit its predecessors.
    if (!visited.has(block)) {
      visited.add(block);
      queue.push(...predecessors[block]!);
    } else {
      continue;
    }

    // If we found the block that `self` is in, then we are a predecessor of `other` (since
    // we found that block by looking at the predecessors of `other`).
    if (this.block === block) {
      return true;
    }
  }

  return false;
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1643 dominates
Location.prototype.dominates = function (this: Location, other: Location, dominators: Dominators<BasicBlock>): boolean {
  if (this.block === other.block) {
    return this.statement_index <= other.statement_index;
  } else {
    return dominators.dominates(this.block, other.block);
  }
};

// rustc: compiler/rustc_middle/src/mir/mod.rs:1652 strictly_dominates
Location.prototype.strictly_dominates = function (this: Location, other: Location, dominators: Dominators<BasicBlock>): boolean {
  return this.block !== other.block && dominators.strictly_dominates(this.block, other.block);
};

/// Returns `true` if this definition location dominates the given location.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1668 dominates
DefLocation.dominates = function (self: DefLocation, location: Location, dominators: Dominators<BasicBlock>): boolean {
  switch (self.$) {
    case "Argument":
      return true;
    case "Assignment": {
      const def = self._0;
      return def.successor_within_block().dominates(location, dominators);
    }
    case "CallReturn": {
      if (self.target === undefined) return false;
      const { call, target } = self;
      // The definition occurs on the call -> target edge. The definition dominates a use
      // if and only if the edge is on all paths from the entry to the use.
      //
      // Note that a call terminator has only one edge that can reach the target, so when
      // the call strongly dominates the target, all paths from the entry to the target
      // go through the call -> target edge.
      return call !== target && dominators.dominates(call, target) && dominators.dominates(target, location.block);
    }
  }
};

/// Checks if the specified `local` is used as the `self` parameter of a method call
/// in the provided `BasicBlock`. If it is, then the `DefId` of the called method is
/// returned.
// rustc: compiler/rustc_middle/src/mir/mod.rs:1693 find_self_call
export function find_self_call(tcx: TyCtxt, body: Body, local: Local, block: BasicBlock): [DefId, GenericArgsRef] | undefined {
  // debug!("find_self_call(local={:?}): terminator={:?}", local, body[block].terminator);
  const terminator = body.index(block).terminator;
  if (terminator === undefined || terminator.kind.$ !== "Call") return undefined;
  const { func, args } = terminator.kind;
  if (func.$ !== "Constant") return undefined;
  const { const_ } = func._0;
  const kind = mir_Const.ty(const_).kind();
  if (kind.$ !== "FnDef") return undefined;
  const def_id = kind._0;
  const fn_args_ = kind._1;
  const item = tcx.opt_associated_item(def_id);
  if (item === undefined || !ty_assoc().AssocItem.is_method(item)) return undefined;
  const first = args[0];
  if (first === undefined || !(first.node.$ === "Move" || first.node.$ === "Copy")) return undefined;
  const self_place = first.node._0;

  const fn_args = unwrap(binder().Binder.no_bound_vars(fn_args_, generic_args().fold_GenericArgs));

  if (self_place.as_local() === local) {
    return [def_id, fn_args];
  }

  // Handle the case where `self_place` gets reborrowed.
  // This happens when the receiver is `&T`.
  for (const stmt of body.index(block).statements) {
    if (stmt.kind.$ !== "Assign") continue;
    const [place, rvalue] = stmt.kind._0;
    const reborrow_local = place.as_local();
    if (reborrow_local === undefined) continue;
    if (!(self_place.as_local() === reborrow_local)) continue;
    if (rvalue.$ !== "Ref") continue;
    const deref_place = rvalue._2;
    const { local: deref_local, projection } = deref_place.as_ref();
    if (projection.length === 1 && projection[0]!.$ === "Deref" && deref_local === local) {
      return [def_id, fn_args];
    }
  }
  return undefined;
}

// Some nodes are used a lot. Make sure they don't unintentionally get bigger.
// mod size_asserts (#[cfg(target_pointer_width = "64")] static_assert_size!): no runtime behavior.

// ---- lazily loaded modules (init order R2: mir/ is in ty/context.ts's import closure) ----
function ty_mod(): typeof import("../ty/mod.ts") {
  return (ty_mod__m ??= require("../ty/mod.ts") as typeof import("../ty/mod.ts"));
}
var ty_mod__m: typeof import("../ty/mod.ts") | undefined;
function ty_instance(): typeof import("../ty/instance.ts") {
  return (ty_instance__m ??= require("../ty/instance.ts") as typeof import("../ty/instance.ts"));
}
var ty_instance__m: typeof import("../ty/instance.ts") | undefined;
function ty_assoc(): typeof import("../ty/assoc.ts") {
  return (ty_assoc__m ??= require("../ty/assoc.ts") as typeof import("../ty/assoc.ts"));
}
var ty_assoc__m: typeof import("../ty/assoc.ts") | undefined;
function generic_args(): typeof import("../ty/generic_args.ts") {
  return (generic_args__m ??= require("../ty/generic_args.ts") as typeof import("../ty/generic_args.ts"));
}
var generic_args__m: typeof import("../ty/generic_args.ts") | undefined;
function structural_impls(): typeof import("../ty/structural_impls.ts") {
  return (structural_impls__m ??= require("../ty/structural_impls.ts") as typeof import("../ty/structural_impls.ts"));
}
var structural_impls__m: typeof import("../ty/structural_impls.ts") | undefined;
function infer_ctxt(): typeof import("../../rustc_type_ir/infer_ctxt.ts") {
  return (infer_ctxt__m ??= require("../../rustc_type_ir/infer_ctxt.ts") as typeof import("../../rustc_type_ir/infer_ctxt.ts"));
}
var infer_ctxt__m: typeof import("../../rustc_type_ir/infer_ctxt.ts") | undefined;
function binder(): typeof import("../../rustc_type_ir/binder.ts") {
  return (binder__m ??= require("../../rustc_type_ir/binder.ts") as typeof import("../../rustc_type_ir/binder.ts"));
}
var binder__m: typeof import("../../rustc_type_ir/binder.ts") | undefined;
function type_ir_visit(): typeof import("../../rustc_type_ir/visit.ts") {
  return (type_ir_visit__m ??= require("../../rustc_type_ir/visit.ts") as typeof import("../../rustc_type_ir/visit.ts"));
}
var type_ir_visit__m: typeof import("../../rustc_type_ir/visit.ts") | undefined;
function rmeta_decoder(): typeof import("../../rustc_metadata/rmeta/decoder.ts") {
  return (rmeta_decoder__m ??= require("../../rustc_metadata/rmeta/decoder.ts") as typeof import("../../rustc_metadata/rmeta/decoder.ts"));
}
var rmeta_decoder__m: typeof import("../../rustc_metadata/rmeta/decoder.ts") | undefined;
/** PORT: `TyCtxt` as `Interner` (ty/mod.ts `as_interner_` precedent). */
function as_interner(tcx: TyCtxt): Interner {
  return tcx as unknown as Interner;
}
