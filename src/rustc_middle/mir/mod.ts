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
import { MirPhase } from "./syntax.ts";
import type { CoroutineKind, HirId } from "../../rustc_hir/lib.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span, Spanned } from "../../rustc_span/lib.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { TyDecoder } from "../ty/codec.ts";
import type { Instance, Ty, TypingEnv } from "../ty/decls.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import type { ShimKind } from "../ty/instance.ts";
import type { CanonicalUserTypeAnnotations } from "../ty/typeck_results.ts";
import type { Dominators } from "./basic_blocks.ts";
import * as gen from "./mod.gen.ts";
import {
  BasicBlockData,
  Body,
  CoroutineInfo,
  debug_BasicBlock,
  type LocalDecls,
  type LocalInfo,
  type LocalKind,
  LocalDecl,
  Location,
  MirSource,
  type MentionedItem,
  SourceInfo,
  type SourceScopeData,
  type UserTypeProjection,
  UserTypeProjections,
  type VarDebugInfo,
  type VarDebugInfoContents,
} from "./mod.gen.ts";
import type { CoroutineLayout } from "./query.ts";
import type { Statement } from "./statement.ts";
import type { ConstOperand, SwitchTargets } from "./syntax.ts";
import type { Successors, Terminator } from "./terminator.ts";
export * from "./mod.gen.ts";
export { BasicBlocks } from "./basic_blocks.ts";
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

// stub: compiler/rustc_middle/src/mir/mod.rs:93 name (lane mir-body-a)
MirPhase.name = function (self: MirPhase): string {
  return unported("rustc_middle::mir::MirPhase::name");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:106 index (lane mir-body-a)
MirPhase.index = function (self: MirPhase): [number, number] {
  return unported("rustc_middle::mir::MirPhase::index");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:126 item (lane mir-body-a)
(MirSource as unknown as { item: typeof MirSource.item }).item = function (def_id: DefId): MirSource {
  return unported("rustc_middle::mir::MirSource::item");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:130 from_shim (lane mir-body-a)
(MirSource as unknown as { from_shim: typeof MirSource.from_shim }).from_shim = function (shim: ShimKind): MirSource {
  return unported("rustc_middle::mir::MirSource::from_shim");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:135 def_id (lane mir-body-a)
MirSource.prototype.def_id = function (this: MirSource): DefId {
  return unported("rustc_middle::mir::MirSource::def_id");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:172 initial (lane mir-body-a)
(CoroutineInfo as unknown as { initial: typeof CoroutineInfo.initial }).initial = function (coroutine_kind: CoroutineKind, yield_ty: Ty, resume_ty: Ty): CoroutineInfo {
  return unported("rustc_middle::mir::CoroutineInfo::initial");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:334 new (lane mir-body-a)
(Body as unknown as { new: typeof Body.new }).new = function (source: MirSource, basic_blocks: BasicBlockData[], source_scopes: SourceScopeData[], local_decls: LocalDecl[], user_type_annotations: CanonicalUserTypeAnnotations, arg_count: number, var_debug_info: VarDebugInfo[], span: Span, coroutine: CoroutineInfo | undefined, tainted_by_errors: ErrorGuaranteed | undefined): Body {
  return unported("rustc_middle::mir::Body::new");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:384 new_cfg_only (lane mir-body-a)
(Body as unknown as { new_cfg_only: typeof Body.new_cfg_only }).new_cfg_only = function (basic_blocks: BasicBlockData[]): Body {
  return unported("rustc_middle::mir::Body::new_cfg_only");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:411 basic_blocks_mut (lane mir-body-a)
Body.prototype.basic_blocks_mut = function (this: Body): BasicBlockData[] {
  return unported("rustc_middle::mir::Body::basic_blocks_mut");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:415 typing_env (lane mir-body-a)
Body.prototype.typing_env = function (this: Body, tcx: TyCtxt): TypingEnv {
  return unported("rustc_middle::mir::Body::typing_env");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:454 local_kind (lane mir-body-a)
Body.prototype.local_kind = function (this: Body, local: Local): LocalKind {
  return unported("rustc_middle::mir::Body::local_kind");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:472 mut_vars_iter (lane mir-body-a)
Body.prototype.mut_vars_iter = function (this: Body): IterableIterator<Local> {
  return unported("rustc_middle::mir::Body::mut_vars_iter");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:482 mut_vars_and_args_iter (lane mir-body-a)
Body.prototype.mut_vars_and_args_iter = function (this: Body): IterableIterator<Local> {
  return unported("rustc_middle::mir::Body::mut_vars_and_args_iter");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:498 args_iter (lane mir-body-a)
Body.prototype.args_iter = function (this: Body): readonly Local[] {
  return unported("rustc_middle::mir::Body::args_iter");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:505 vars_and_temps_iter (lane mir-body-a)
Body.prototype.vars_and_temps_iter = function (this: Body): readonly Local[] {
  return unported("rustc_middle::mir::Body::vars_and_temps_iter");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:512 drain_vars_and_temps (lane mir-body-a)
Body.prototype.drain_vars_and_temps = function (this: Body): IterableIterator<LocalDecl> {
  return unported("rustc_middle::mir::Body::drain_vars_and_temps");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:517 source_info (lane mir-body-a)
Body.prototype.source_info = function (this: Body, location: Location): SourceInfo {
  return unported("rustc_middle::mir::Body::source_info");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:531 return_ty (lane mir-body-a)
Body.prototype.return_ty = function (this: Body): Ty {
  return unported("rustc_middle::mir::Body::return_ty");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:537 bound_return_ty (lane mir-body-a)
Body.prototype.bound_return_ty = function (this: Body, tcx: TyCtxt): EarlyBinder<Ty> {
  return unported("rustc_middle::mir::Body::bound_return_ty");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:543 terminator_loc (lane mir-body-a)
Body.prototype.terminator_loc = function (this: Body, bb: BasicBlock): Location {
  return unported("rustc_middle::mir::Body::terminator_loc");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:547 stmt_at (lane mir-body-a)
Body.prototype.stmt_at = function (this: Body, location: Location): Either<Statement, Terminator> {
  return unported("rustc_middle::mir::Body::stmt_at");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:558 yield_ty (lane mir-body-a)
Body.prototype.yield_ty = function (this: Body): Ty | undefined {
  return unported("rustc_middle::mir::Body::yield_ty");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:563 resume_ty (lane mir-body-a)
Body.prototype.resume_ty = function (this: Body): Ty | undefined {
  return unported("rustc_middle::mir::Body::resume_ty");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:569 coroutine_layout_raw (lane mir-body-a)
Body.prototype.coroutine_layout_raw = function (this: Body): CoroutineLayout | undefined {
  return unported("rustc_middle::mir::Body::coroutine_layout_raw");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:574 coroutine_drop (lane mir-body-a)
Body.prototype.coroutine_drop = function (this: Body): Body | undefined {
  return unported("rustc_middle::mir::Body::coroutine_drop");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:579 coroutine_drop_async (lane mir-body-a)
Body.prototype.coroutine_drop_async = function (this: Body): Body | undefined {
  return unported("rustc_middle::mir::Body::coroutine_drop_async");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:584 coroutine_requires_async_drop (lane mir-body-a)
Body.prototype.coroutine_requires_async_drop = function (this: Body): boolean {
  return unported("rustc_middle::mir::Body::coroutine_requires_async_drop");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:589 future_drop_poll (lane mir-body-a)
Body.prototype.future_drop_poll = function (this: Body): Body | undefined {
  return unported("rustc_middle::mir::Body::future_drop_poll");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:599 coroutine_kind (lane mir-body-a)
Body.prototype.coroutine_kind = function (this: Body): CoroutineKind | undefined {
  return unported("rustc_middle::mir::Body::coroutine_kind");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:604 should_skip (lane mir-body-a)
Body.prototype.should_skip = function (this: Body): boolean {
  return unported("rustc_middle::mir::Body::should_skip");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:612 is_custom_mir (lane mir-body-a)
Body.prototype.is_custom_mir = function (this: Body): boolean {
  return unported("rustc_middle::mir::Body::is_custom_mir");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:619 try_const_mono_switchint (lane mir-body-a)
(Body as unknown as { try_const_mono_switchint: typeof Body.try_const_mono_switchint }).try_const_mono_switchint = function (tcx: TyCtxt, instance: Instance, block: BasicBlockData): [bigint, SwitchTargets] | undefined {
  return unported("rustc_middle::mir::Body::try_const_mono_switchint");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:691 caller_location_span (lane mir-body-a)
Body.prototype.caller_location_span = function <T>(this: Body, source_info: SourceInfo, caller_location: T | undefined, tcx: TyCtxt, from_span: (a0: Span) => T): T {
  return unported("rustc_middle::mir::Body::caller_location_span");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:722 set_required_consts (lane mir-body-a)
Body.prototype.set_required_consts = function (this: Body, required_consts: ConstOperand[]): void {
  return unported("rustc_middle::mir::Body::set_required_consts");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:731 required_consts (lane mir-body-a)
Body.prototype.required_consts_ = function (this: Body): readonly ConstOperand[] {
  return unported("rustc_middle::mir::Body::required_consts");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:739 set_mentioned_items (lane mir-body-a)
Body.prototype.set_mentioned_items = function (this: Body, mentioned_items: Spanned<MentionedItem>[]): void {
  return unported("rustc_middle::mir::Body::set_mentioned_items");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:748 mentioned_items (lane mir-body-a)
Body.prototype.mentioned_items_ = function (this: Body): readonly Spanned<MentionedItem>[] {
  return unported("rustc_middle::mir::Body::mentioned_items");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:760 index (lane mir-body-a)
Body.prototype.index = function (this: Body, index: BasicBlock): BasicBlockData {
  return unported("rustc_middle::mir::<Body as Index>::index");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:767 index_mut (lane mir-body-a)
Body.prototype.index_mut = function (this: Body, index: BasicBlock): BasicBlockData {
  return unported("rustc_middle::mir::<Body as IndexMut>::index_mut");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:779 as_ref (lane mir-body-a)
ClearCrossCrate.as_ref = function <T>(self: ClearCrossCrate<T>): ClearCrossCrate<T> {
  return unported("rustc_middle::mir::ClearCrossCrate::as_ref");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:786 as_mut (lane mir-body-a)
ClearCrossCrate.as_mut = function <T>(self: ClearCrossCrate<T>): ClearCrossCrate<T> {
  return unported("rustc_middle::mir::ClearCrossCrate::as_mut");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:793 unwrap_crate_local (lane mir-body-a)
ClearCrossCrate.unwrap_crate_local = function <T>(self: ClearCrossCrate<T>): T {
  return unported("rustc_middle::mir::ClearCrossCrate::unwrap_crate_local");
};


// rustc-skip: compiler/rustc_middle/src/mir/mod.rs:806 encode Encodable (metadata encoding, M5)

// impl<'tcx, D: TyDecoder<'tcx>, T: Decodable<D>> Decodable<D> for ClearCrossCrate<T>
// stub: compiler/rustc_middle/src/mir/mod.rs:822 decode (lane mir-body-a)
export function decode_ClearCrossCrate<T>(d: TyDecoder, decode_T: (d: TyDecoder) => T): ClearCrossCrate<T> {
  return unported("rustc_middle::mir::<ClearCrossCrate as Decodable>::decode");
}

// stub: compiler/rustc_middle/src/mir/mod.rs:857 outermost (lane mir-body-a)
(SourceInfo as unknown as { outermost: typeof SourceInfo.outermost }).outermost = function (span: Span): SourceInfo {
  return unported("rustc_middle::mir::SourceInfo::outermost");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:880 arg (lane mir-body-a)
Local.arg = function (i: number): Local {
  return unported("rustc_middle::mir::Local::arg");
};


// impl polonius_engine::Atom for Local (PORT: a free fn: `Local.index` is the `newtype_index!` one)
// stub: compiler/rustc_middle/src/mir/mod.rs:886 index (lane mir-body-a)
export function Atom_index_Local(self: Local): number {
  return unported("rustc_middle::mir::<Local as Atom>::index");
}

// stub: compiler/rustc_middle/src/mir/mod.rs:1111 local_info (lane mir-body-a)
LocalDecl.prototype.local_info_ = function (this: LocalDecl): LocalInfo {
  return unported("rustc_middle::mir::LocalDecl::local_info");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1121 can_be_made_mutable (lane mir-body-a)
LocalDecl.prototype.can_be_made_mutable = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::can_be_made_mutable");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1134 is_nonref_binding (lane mir-body-a)
LocalDecl.prototype.is_nonref_binding = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::is_nonref_binding");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1147 is_user_variable (lane mir-body-a)
LocalDecl.prototype.is_user_variable = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::is_user_variable");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1154 is_ref_for_guard (lane mir-body-a)
LocalDecl.prototype.is_ref_for_guard = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::is_ref_for_guard");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1160 is_ref_to_static (lane mir-body-a)
LocalDecl.prototype.is_ref_to_static = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::is_ref_to_static");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1166 is_ref_to_thread_local (lane mir-body-a)
LocalDecl.prototype.is_ref_to_thread_local = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::is_ref_to_thread_local");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1174 is_deref_temp (lane mir-body-a)
LocalDecl.prototype.is_deref_temp = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::is_deref_temp");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1184 from_compiler_desugaring (lane mir-body-a)
LocalDecl.prototype.from_compiler_desugaring = function (this: LocalDecl): boolean {
  return unported("rustc_middle::mir::LocalDecl::from_compiler_desugaring");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1190 new (lane mir-body-a)
(LocalDecl as unknown as { new: typeof LocalDecl.new }).new = function (ty: Ty, span: Span): LocalDecl {
  return unported("rustc_middle::mir::LocalDecl::new");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1196 with_source_info (lane mir-body-a)
(LocalDecl as unknown as { with_source_info: typeof LocalDecl.with_source_info }).with_source_info = function (ty: Ty, source_info: SourceInfo): LocalDecl {
  return unported("rustc_middle::mir::LocalDecl::with_source_info");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1208 immutable (lane mir-body-a)
LocalDecl.prototype.immutable = function (this: LocalDecl): LocalDecl {
  return unported("rustc_middle::mir::LocalDecl::immutable");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1222 fmt (lane mir-body-a)
export const debug_VarDebugInfoContents: Debug<VarDebugInfoContents> = (self, fmt) => {
  return unported("rustc_middle::mir::<VarDebugInfoContents as Debug>::fmt");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1311 start_location (lane mir-body-a)
BasicBlock.start_location = function (self: BasicBlock): Location {
  return unported("rustc_middle::mir::BasicBlock::start_location");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1350 new (lane mir-body-a)
(BasicBlockData as unknown as { new: typeof BasicBlockData.new }).new = function (terminator: Terminator | undefined, is_cleanup: boolean): BasicBlockData {
  return unported("rustc_middle::mir::BasicBlockData::new");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1354 new_stmts (lane mir-body-a)
(BasicBlockData as unknown as { new_stmts: typeof BasicBlockData.new_stmts }).new_stmts = function (statements: Statement[], terminator: Terminator | undefined, is_cleanup: boolean): BasicBlockData {
  return unported("rustc_middle::mir::BasicBlockData::new_stmts");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1372 terminator (lane mir-body-a)
BasicBlockData.prototype.terminator_ = function (this: BasicBlockData): Terminator {
  return unported("rustc_middle::mir::BasicBlockData::terminator");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1377 terminator_mut (lane mir-body-a)
BasicBlockData.prototype.terminator_mut = function (this: BasicBlockData): Terminator {
  return unported("rustc_middle::mir::BasicBlockData::terminator_mut");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1383 is_empty_unreachable (lane mir-body-a)
BasicBlockData.prototype.is_empty_unreachable = function (this: BasicBlockData): boolean {
  return unported("rustc_middle::mir::BasicBlockData::is_empty_unreachable");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1392 mono_successors (lane mir-body-a)
BasicBlockData.prototype.mono_successors = function (this: BasicBlockData, tcx: TyCtxt, instance: Instance): Successors {
  return unported("rustc_middle::mir::BasicBlockData::mono_successors");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1400 retain_statements (lane mir-body-a)
BasicBlockData.prototype.retain_statements = function (this: BasicBlockData, f: (s: Statement) => boolean): void {
  return unported("rustc_middle::mir::BasicBlockData::retain_statements");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1419 strip_nops (lane mir-body-a)
BasicBlockData.prototype.strip_nops = function (this: BasicBlockData): void {
  return unported("rustc_middle::mir::BasicBlockData::strip_nops");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1423 drop_debuginfo (lane mir-body-a)
BasicBlockData.prototype.drop_debuginfo = function (this: BasicBlockData): void {
  return unported("rustc_middle::mir::BasicBlockData::drop_debuginfo");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1447 lint_root (lane mir-body-a)
SourceScope.lint_root = function (self: SourceScope, source_scopes: readonly SourceScopeData[]): HirId | undefined {
  return unported("rustc_middle::mir::SourceScope::lint_root");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1467 inlined_instance (lane mir-body-a)
SourceScope.inlined_instance = function (self: SourceScope, source_scopes: readonly SourceScopeData[]): Instance | undefined {
  return unported("rustc_middle::mir::SourceScope::inlined_instance");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1546 projections (lane mir-body-a)
UserTypeProjections.prototype.projections = function (this: UserTypeProjections): readonly UserTypeProjection[] {
  return unported("rustc_middle::mir::UserTypeProjections::projections");
};


// impl fmt::Debug for Location
// rustc: compiler/rustc_middle/src/mir/mod.rs:1593 fmt
export const debug_Location: Debug<Location> = (self, _fmt) => {
  return `${debug_BasicBlock(self.block, PLAIN)}[${self.statement_index}]`;
};

// stub: compiler/rustc_middle/src/mir/mod.rs:1606 successor_within_block (lane mir-body-a)
Location.prototype.successor_within_block = function (this: Location): Location {
  return unported("rustc_middle::mir::Location::successor_within_block");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1611 is_predecessor_of (lane mir-body-a)
Location.prototype.is_predecessor_of = function (this: Location, other: Location, body: Body): boolean {
  return unported("rustc_middle::mir::Location::is_predecessor_of");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1643 dominates (lane mir-body-a)
Location.prototype.dominates = function (this: Location, other: Location, dominators: Dominators<BasicBlock>): boolean {
  return unported("rustc_middle::mir::Location::dominates");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1652 strictly_dominates (lane mir-body-a)
Location.prototype.strictly_dominates = function (this: Location, other: Location, dominators: Dominators<BasicBlock>): boolean {
  return unported("rustc_middle::mir::Location::strictly_dominates");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1668 dominates (lane mir-body-a)
DefLocation.dominates = function (self: DefLocation, location: Location, dominators: Dominators<BasicBlock>): boolean {
  return unported("rustc_middle::mir::DefLocation::dominates");
};


// stub: compiler/rustc_middle/src/mir/mod.rs:1693 find_self_call (lane mir-body-a)
export function find_self_call(tcx: TyCtxt, body: Body, local: Local, block: BasicBlock): [DefId, GenericArgsRef] | undefined {
  return unported("rustc_middle::mir::find_self_call");
}
