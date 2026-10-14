// Port of compiler/rustc_type_ir/src/ir_print.rs (lane tyir-misc, sub-lane predicate).
//
// PORT (D3): `I: Interner` is erased, so `<I as IrPrint<X>>::print(t, fmt)` is a static call with no receiver. The
// only implementor is rustc_middle's `TyCtxt` (`impl<T: Lift + Print> IrPrint<T> for TyCtxt`, ty/print/mod.rs:423, and
// `impl IrPrint<PatternKind> for TyCtxt`, ty/pattern.rs:67). The trait is the interface `IrPrint<T>` (an impl is an
// object holding the two fns); TyCtxt's impls are found as follows:
// - **Non-generic `X`** (`TraitRef`, `TraitClause`, ..., `PatternKind`, `Region`, `Const`): the registry `IR_PRINT`
//   has one slot per printed type, which rustc_middle (lane ty-print) fills at module load
//   (`IR_PRINT.TraitRef = { print, print_debug }`). `display_X` / `debug_X` read the slot and stop as UNPORTED while
//   it is empty.
// - **Generic `X<T>`** (`OutlivesClause<I, T>`, `Binder<I, T>`, `Placeholder<I, T>`): upstream's impls carry the bound
//   `where I: IrPrint<X<I, T>>`, which depends on `T`. A trait bound becomes a dictionary parameter (PORTING §5
//   "pass function tables"), so `display_X(self, ir_print_X)` takes the `IrPrint<X<T>>` impl of the caller's `T`;
//   rustc_middle provides those impl objects (e.g. built from `T`'s `Print` impl).
// PORT: `fmt::Display for T` is `display_T(self): string` (convention of `display_InferTy`); the printer writes its
// buffer with `write_str`, so no formatter flag reaches it and `display_T` passes `PLAIN`. `fmt::Debug for T` is
// `debug_T: Debug<T>` and passes its `f` on.
// PORT: `impl IntoDiagArg for T` is `T_into_diag_arg(self, path)`; `self.to_string()` is `display_T(self)` and
// `format!("{self:?}")` is `debug_T(self, PLAIN)`. The generic `impl<T: IntoDiagArg> IntoDiagArg for Binder<I, T>`
// takes `T`'s impl fn as a parameter.
import {
  type DiagArgValue,
  type PathBuf,
  String_into_diag_arg,
} from "../rustc_error_messages/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { type Fmt, PLAIN } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import type { Placeholder } from "./binder.gen.ts";
import { type AliasConstKind, debug_AliasConstKind } from "./const_kind.ts";
import { ClosureKind } from "./lib.ts";
import type { PatternKind } from "./pattern.gen.ts";
import type {
  CoercePredicate,
  ExistentialProjection,
  ExistentialTraitRef,
  HostEffectClause,
  NormalizesTo,
  OutlivesClause,
  ProjectionClause,
  SubtypePredicate,
  TraitClause,
  TraitRef,
} from "./predicate.gen.ts";
import type { Const } from "./sty/consts.ts";
import type { Region } from "./sty/mod.ts";
import type { Alias, AliasTerm, AliasTy } from "./ty/alias.gen.ts";
import { debug_Alias } from "./ty/alias.ts";
import { debug_FnSig, type FnSig } from "./ty_kind.ts";
import { Binder } from "./binder.ts";

// rustc-trait: compiler/rustc_type_ir/src/ir_print.rs:11 IrPrint
export interface IrPrint<T> {
  // rustc: compiler/rustc_type_ir/src/ir_print.rs:12 print
  print(t: T, fmt: Fmt): string;
  // rustc: compiler/rustc_type_ir/src/ir_print.rs:13 print_debug
  print_debug(t: T, fmt: Fmt): string;
}

/**
 * PORT: `TyCtxt`'s `IrPrint<X>` impls for the non-generic `X` printed through `IrPrint` (header). One slot per type;
 * rustc_middle (ty/print/mod.rs:423 / ty/pattern.rs:67, lane ty-print) assigns them at module load.
 */
export interface IrPrintImpls {
  TraitRef?: IrPrint<TraitRef>;
  TraitClause?: IrPrint<TraitClause>;
  ExistentialTraitRef?: IrPrint<ExistentialTraitRef>;
  ExistentialProjection?: IrPrint<ExistentialProjection>;
  ProjectionClause?: IrPrint<ProjectionClause>;
  NormalizesTo?: IrPrint<NormalizesTo>;
  SubtypePredicate?: IrPrint<SubtypePredicate>;
  CoercePredicate?: IrPrint<CoercePredicate>;
  HostEffectClause?: IrPrint<HostEffectClause>;
  AliasTy?: IrPrint<AliasTy>;
  AliasTerm?: IrPrint<AliasTerm>;
  FnSig?: IrPrint<FnSig>;
  PatternKind?: IrPrint<PatternKind>;
  Region?: IrPrint<Region>;
  Const?: IrPrint<Const>;
}

/** PORT: the registry of `TyCtxt`'s `IrPrint` impls (header); empty until rustc_middle fills it. */
export const IR_PRINT: IrPrintImpls = {};

/** PORT: `<I as IrPrint<X>>` for a registry slot; UNPORTED while rustc_middle has not filled it. */
function ir_print_impl<K extends keyof IrPrintImpls>(key: K, method: "print" | "print_debug"): NonNullable<IrPrintImpls[K]> {
  const impl_ = IR_PRINT[key];
  if (impl_ === undefined) {
    return unported(`<I as IrPrint<${key}<I>>>::${method} (rustc_middle ty/print, lane ty-print)`);
  }
  return impl_ as NonNullable<IrPrintImpls[K]>;
}

// ---- define_display_via_print!(TraitRef, TraitClause, ExistentialTraitRef, ExistentialProjection, ProjectionClause,
// NormalizesTo, SubtypePredicate, CoercePredicate, HostEffectClause, AliasTy, AliasTerm, FnSig, PatternKind) ----------
// Each `impl<I: Interner> fmt::Display for $ty<I>` is `display_$ty`, all from the macro's one `fn fmt` (ir_print.rs:20).

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_TraitRef(self: TraitRef): string {
  return ir_print_impl("TraitRef", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_TraitClause(self: TraitClause): string {
  return ir_print_impl("TraitClause", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_ExistentialTraitRef(self: ExistentialTraitRef): string {
  return ir_print_impl("ExistentialTraitRef", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_ExistentialProjection(self: ExistentialProjection): string {
  return ir_print_impl("ExistentialProjection", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_ProjectionClause(self: ProjectionClause): string {
  return ir_print_impl("ProjectionClause", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_NormalizesTo(self: NormalizesTo): string {
  return ir_print_impl("NormalizesTo", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_SubtypePredicate(self: SubtypePredicate): string {
  return ir_print_impl("SubtypePredicate", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_CoercePredicate(self: CoercePredicate): string {
  return ir_print_impl("CoercePredicate", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_HostEffectClause(self: HostEffectClause): string {
  return ir_print_impl("HostEffectClause", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_AliasTy(self: AliasTy): string {
  return ir_print_impl("AliasTy", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_AliasTerm(self: AliasTerm): string {
  return ir_print_impl("AliasTerm", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_FnSig(self: FnSig): string {
  return ir_print_impl("FnSig", "print").print(self, PLAIN);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:20 fmt
export function display_PatternKind(self: PatternKind): string {
  return ir_print_impl("PatternKind", "print").print(self, PLAIN);
}

// ---- define_debug_via_print!(TraitRef, ExistentialTraitRef, PatternKind) -----------------------------------------------
// Each `impl<I: Interner> fmt::Debug for $ty<I>` is `debug_$ty`, all from the macro's one `fn fmt` (ir_print.rs:32).
// PORT: function declarations (hoisted), because predicate.gen.ts reaches them through a module cycle.

// rustc: compiler/rustc_type_ir/src/ir_print.rs:32 fmt
export function debug_TraitRef(self: TraitRef, fmt: Fmt): string {
  return ir_print_impl("TraitRef", "print_debug").print_debug(self, fmt);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:32 fmt
export function debug_ExistentialTraitRef(self: ExistentialTraitRef, fmt: Fmt): string {
  return ir_print_impl("ExistentialTraitRef", "print_debug").print_debug(self, fmt);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:32 fmt
export function debug_PatternKind(self: PatternKind, fmt: Fmt): string {
  return ir_print_impl("PatternKind", "print_debug").print_debug(self, fmt);
}

// ---- the Display impls with an explicit `I: IrPrint<..>` bound ---------------------------------------------------------

/** `impl<I: Interner> fmt::Display for Region<I> where I: IrPrint<Region<I>>` */
// rustc: compiler/rustc_type_ir/src/ir_print.rs:62 fmt
export function display_Region(self: Region): string {
  return ir_print_impl("Region", "print").print(self, PLAIN);
}

/** `impl<I: Interner> fmt::Display for Const<I> where I: IrPrint<Const<I>>` */
// rustc: compiler/rustc_type_ir/src/ir_print.rs:71 fmt
export function display_Const(self: Const): string {
  return ir_print_impl("Const", "print").print(self, PLAIN);
}

/** `impl<I: Interner, T> fmt::Display for OutlivesClause<I, T> where I: IrPrint<OutlivesClause<I, T>>` */
// PORT: the bound is the `ir_print` parameter (header).
// rustc: compiler/rustc_type_ir/src/ir_print.rs:80 fmt
export function display_OutlivesClause<T>(self: OutlivesClause<T>, ir_print: IrPrint<OutlivesClause<T>>): string {
  return ir_print.print(self, PLAIN);
}

/** `impl<I: Interner, T> fmt::Display for Binder<I, T> where I: IrPrint<Binder<I, T>>` */
// PORT: the bound is the `ir_print` parameter (header).
// rustc: compiler/rustc_type_ir/src/ir_print.rs:89 fmt
export function display_Binder<T>(self: Binder<T>, ir_print: IrPrint<Binder<T>>): string {
  return ir_print.print(self, PLAIN);
}

/** `impl<I: Interner, T> fmt::Display for Placeholder<I, T> where I: IrPrint<Placeholder<I, T>>` */
// PORT: the bound is the `ir_print` parameter (header).
// rustc: compiler/rustc_type_ir/src/ir_print.rs:98 fmt
export function display_Placeholder<T>(self: Placeholder<T>, ir_print: IrPrint<Placeholder<T>>): string {
  return ir_print.print(self, PLAIN);
}

// ---- mod into_diag_arg_impls (`#[cfg(feature = "nightly")]`: rustc builds with it) ------------------------------------

// rustc: compiler/rustc_type_ir/src/ir_print.rs:110 into_diag_arg
export function TraitRef_into_diag_arg(self: TraitRef, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(display_TraitRef(self), path);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:116 into_diag_arg
export function ExistentialTraitRef_into_diag_arg(self: ExistentialTraitRef, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(display_ExistentialTraitRef(self), path);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:122 into_diag_arg
export function Region_into_diag_arg(self: Region, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(display_Region(self), path);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:128 into_diag_arg
export function AliasConst_into_diag_arg(self: Alias<AliasConstKind>, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(debug_Alias(self, PLAIN, debug_AliasConstKind), path);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:134 into_diag_arg
export function FnSig_into_diag_arg(self: FnSig, path: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(debug_FnSig(self, PLAIN), path);
}

// PORT: the bound `T: IntoDiagArg` is the `T_into_diag_arg` parameter (header).
// rustc: compiler/rustc_type_ir/src/ir_print.rs:140 into_diag_arg
export function Binder_into_diag_arg<T>(
  self: Binder<T>,
  path: MutRef<PathBuf | undefined>,
  T_into_diag_arg: (self: T, path: MutRef<PathBuf | undefined>) => DiagArgValue,
): DiagArgValue {
  return T_into_diag_arg(Binder.skip_binder(self), path);
}

// rustc: compiler/rustc_type_ir/src/ir_print.rs:146 into_diag_arg
export function ClosureKind_into_diag_arg(self: ClosureKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: ClosureKind.as_str(self) };
}
