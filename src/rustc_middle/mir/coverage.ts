// Port of compiler/rustc_middle/src/mir/coverage.rs (lane mir-contract, plan-m4 D3): the types are generated into
// coverage.gen.ts (set rustc_middle_mir); the file's fns are stubs for lane mir-body-a (coverage instrumentation itself
// is M4d, plan-m4 D10; only the types and these small impls are reached from MIR building / printing).
//! Metadata from source code coverage analysis and instrumentation.
import "./mod.ts";
import type { Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import * as gen from "./coverage.gen.ts";
import type { CovTerm } from "./coverage.gen.ts";
export * from "./coverage.gen.ts";

export interface CoverageKind_methods {
  // coverage.rs:123 (lane mir-body-a)
  is_removed_after_analysis(self: CoverageKind): boolean;
}
export type CoverageKind = gen.CoverageKind;
export const CoverageKind = {} as CoverageKind_methods;

export interface Op_methods {
  // coverage.rs:139 (lane mir-body-a)
  is_add(self: Op): boolean;
  // coverage.rs:143 (lane mir-body-a)
  is_subtract(self: Op): boolean;
}
export type Op = gen.Op;
export const Op = gen.Op as typeof gen.Op & Op_methods;

// impl Debug for CovTerm
// stub: compiler/rustc_middle/src/mir/coverage.rs:65 fmt (lane mir-body-a)
export const debug_CovTerm: Debug<CovTerm> = (self, fmt) => {
  return unported("rustc_middle::mir::coverage::<CovTerm as Debug>::fmt");
};

// impl Debug for CoverageKind
// stub: compiler/rustc_middle/src/mir/coverage.rs:108 fmt (lane mir-body-a)
export const debug_CoverageKind: Debug<CoverageKind> = (self, fmt) => {
  return unported("rustc_middle::mir::coverage::<CoverageKind as Debug>::fmt");
};

// stub: compiler/rustc_middle/src/mir/coverage.rs:123 is_removed_after_analysis (lane mir-body-a)
CoverageKind.is_removed_after_analysis = function (self: CoverageKind): boolean {
  return unported("rustc_middle::mir::coverage::CoverageKind::is_removed_after_analysis");
};

// stub: compiler/rustc_middle/src/mir/coverage.rs:139 is_add (lane mir-body-a)
Op.is_add = function (self: Op): boolean {
  return unported("rustc_middle::mir::coverage::Op::is_add");
};

// stub: compiler/rustc_middle/src/mir/coverage.rs:143 is_subtract (lane mir-body-a)
Op.is_subtract = function (self: Op): boolean {
  return unported("rustc_middle::mir::coverage::Op::is_subtract");
};
