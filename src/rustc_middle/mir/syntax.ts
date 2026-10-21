// Port of compiler/rustc_middle/src/mir/syntax.rs (lane mir-contract, plan-m4 D3). Every type of the file is generated
// with its derived Debug / Clone / TypeVisitable / TypeFoldable into syntax.gen.ts (tools/codegen/types.ts, set
// rustc_middle_mir); the file's 4 fns are ported below.
//
// This module is also the home of the **companions** of the syntax.rs enums whose methods live in other upstream files
// (PORTING §8: enum methods live on the companion const): `X_methods` interfaces that the extension modules
// (mod.ts, statement.ts, terminator.ts, pretty.ts) augment with `declare module "./syntax.ts"`, and the companion
// `X` (the generated companion object, or a fresh one when the enum has no unit variant) that they assign the methods
// to at load. The manual `Debug` impls of syntax.rs types live in pretty.rs: the `debug_X` exported here forward to
// pretty.ts lazily (pretty.ts is entered only through its own importers; docs/handoff/mir-contract.md "Init order").
//
// PORT (init order): mir/ is entered only through mir/mod.ts (whose first import is this module); never import this
// module from outside mir/.
//! This defines the syntax of MIR, i.e., the set of available MIR operations, and other definitions
//! closely related to MIR semantics.
//! This is in a dedicated file so that changes to this file can be reviewed more carefully.
//! The intention is that this file only contains datatype declarations, no code.
import type { Session } from "../../rustc_session/session.ts";
import type { Debug } from "../../std/fmt.ts";
import * as gen from "./syntax.gen.ts";
export * from "./syntax.gen.ts";

/** pretty.ts (the manual `Debug` impls of syntax.rs types), read lazily (init order). */
function mir_pretty(): typeof import("./pretty.ts") {
  return (mir_pretty__m ??= require("./pretty.ts") as typeof import("./pretty.ts"));
}
var mir_pretty__m: typeof import("./pretty.ts") | undefined;

// ---- manual Debug impls (pretty.rs), forwarded ----
/** `impl Debug for StatementKind` (pretty.rs:874). */
export const debug_StatementKind: Debug<gen.StatementKind> = (v, f) => mir_pretty().debug_StatementKind(v, f);
/** `impl Debug for TerminatorKind` (pretty.rs:935). */
export const debug_TerminatorKind: Debug<gen.TerminatorKind> = (v, f) => mir_pretty().debug_TerminatorKind(v, f);
/** `impl Debug for Rvalue` (pretty.rs:1148). */
export const debug_Rvalue: Debug<gen.Rvalue> = (v, f) => mir_pretty().debug_Rvalue(v, f);
/** `impl Debug for Operand` (pretty.rs:1319). */
export const debug_Operand: Debug<gen.Operand> = (v, f) => mir_pretty().debug_Operand(v, f);
/** `impl Debug for ConstOperand` (pretty.rs:1331). */
export const debug_ConstOperand: Debug<gen.ConstOperand> = (v, f) => mir_pretty().debug_ConstOperand(v, f);
/** `impl Debug for Place` (pretty.rs:1347). */
export const debug_Place: Debug<gen.Place> = (v, f) => mir_pretty().debug_Place(v, f);

// ---- companions (methods declared by the modules that define them; see the header) ----
// mir/mod.rs
export interface MirPhase_methods {}
export type MirPhase = gen.MirPhase;
export const MirPhase = gen.MirPhase as typeof gen.MirPhase & MirPhase_methods;
// mir/statement.rs
export interface BorrowKind_methods {}
export type BorrowKind = gen.BorrowKind;
export const BorrowKind = gen.BorrowKind as typeof gen.BorrowKind & BorrowKind_methods;
export interface RawPtrKind_methods {}
export type RawPtrKind = gen.RawPtrKind;
export const RawPtrKind = gen.RawPtrKind as typeof gen.RawPtrKind & RawPtrKind_methods;
export interface StatementKind_methods {}
export type StatementKind = gen.StatementKind;
export const StatementKind = gen.StatementKind as typeof gen.StatementKind & StatementKind_methods;
export interface ProjectionElem_methods {}
export type ProjectionElem<V, T> = gen.ProjectionElem<V, T>;
export const ProjectionElem = gen.ProjectionElem as typeof gen.ProjectionElem & ProjectionElem_methods;
export interface Operand_methods {}
export type Operand = gen.Operand;
export const Operand = {} as Operand_methods;
export interface Rvalue_methods {}
export type Rvalue = gen.Rvalue;
export const Rvalue = {} as Rvalue_methods;
export interface UnOp_methods {}
export type UnOp = gen.UnOp;
export const UnOp = gen.UnOp as typeof gen.UnOp & UnOp_methods;
export interface BinOp_methods {}
export type BinOp = gen.BinOp;
export const BinOp = gen.BinOp as typeof gen.BinOp & BinOp_methods;
// mir/terminator.rs, mir/pretty.rs
export interface TerminatorKind_methods {}
export type TerminatorKind = gen.TerminatorKind;
export const TerminatorKind = gen.TerminatorKind as typeof gen.TerminatorKind & TerminatorKind_methods;
export interface UnwindAction_methods {}
export type UnwindAction = gen.UnwindAction;
export const UnwindAction = gen.UnwindAction as typeof gen.UnwindAction & UnwindAction_methods;
export interface UnwindTerminateReason_methods {}
export type UnwindTerminateReason = gen.UnwindTerminateReason;
export const UnwindTerminateReason = gen.UnwindTerminateReason as typeof gen.UnwindTerminateReason & UnwindTerminateReason_methods;
export interface AssertKind_methods {}
export type AssertKind<O> = gen.AssertKind<O>;
export const AssertKind = gen.AssertKind as typeof gen.AssertKind & AssertKind_methods;
export interface InlineAsmMacro_methods {}
export type InlineAsmMacro = gen.InlineAsmMacro;
export const InlineAsmMacro = gen.InlineAsmMacro as typeof gen.InlineAsmMacro & InlineAsmMacro_methods;
export interface CallSource_methods {}
export type CallSource = gen.CallSource;
export const CallSource = gen.CallSource as typeof gen.CallSource & CallSource_methods;
// this file
export interface WithRetag_methods {
  // syntax.rs:498
  yes(self: WithRetag): boolean;
  // syntax.rs:502
  no(self: WithRetag): boolean;
}
export type WithRetag = gen.WithRetag;
export const WithRetag = gen.WithRetag as typeof gen.WithRetag & WithRetag_methods;
export interface RuntimeChecks_methods {
  // syntax.rs:1602
  value(self: RuntimeChecks, sess: Session): boolean;
}
export type RuntimeChecks = gen.RuntimeChecks;
export const RuntimeChecks = gen.RuntimeChecks as typeof gen.RuntimeChecks & RuntimeChecks_methods;

// rustc: compiler/rustc_middle/src/mir/syntax.rs:498 yes
WithRetag.yes = function (self: WithRetag): boolean {
  return self === "Yes";
};
// rustc: compiler/rustc_middle/src/mir/syntax.rs:502 no
WithRetag.no = function (self: WithRetag): boolean {
  return self === "No";
};

// rustc: compiler/rustc_middle/src/mir/syntax.rs:1602 value
RuntimeChecks.value = function (self: RuntimeChecks, sess: Session): boolean {
  switch (self) {
    case "UbChecks":
      return sess.ub_checks();
    case "ContractChecks":
      return sess.contract_checks();
    case "OverflowChecks":
      return sess.overflow_checks();
  }
};

// Sometimes `BinOp` and `AssignOp` need the same treatment. The operations
// covered by `AssignOp` are a subset of those covered by `BinOp`, so it makes
// sense to convert `AssignOp` to `BinOp`.
// impl From<AssignOp> for BinOp
// rustc: compiler/rustc_middle/src/mir/syntax.rs:1743 from
export function BinOp_from_AssignOp(op: gen.AssignOp): BinOp {
  switch (op) {
    case "AddAssign":
      return "Add";
    case "SubAssign":
      return "Sub";
    case "MulAssign":
      return "Mul";
    case "DivAssign":
      return "Div";
    case "RemAssign":
      return "Rem";
    case "BitXorAssign":
      return "BitXor";
    case "BitAndAssign":
      return "BitAnd";
    case "BitOrAssign":
      return "BitOr";
    case "ShlAssign":
      return "Shl";
    case "ShrAssign":
      return "Shr";
  }
}
