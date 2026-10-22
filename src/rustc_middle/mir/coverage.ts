// Port of compiler/rustc_middle/src/mir/coverage.rs (lane mir-contract, plan-m4 D3): the types are generated into
// coverage.gen.ts (set rustc_middle_mir); the file's fns are ported below (lane mir-body-a; coverage instrumentation itself
// is M4d, plan-m4 D10; only the types and these small impls are reached from MIR building / printing).
//! Metadata from source code coverage analysis and instrumentation.
import "./mod.ts";
import { debug_HirId } from "../../rustc_hir_id/lib.ts";
import { type Debug, debug_tuple, PLAIN } from "../../std/fmt.ts";
import * as gen from "./coverage.gen.ts";
import { BlockMarkerId, type CovTerm, debug_BasicCoverageBlock, debug_PointKind } from "./coverage.gen.ts";
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
// rustc: compiler/rustc_middle/src/mir/coverage.rs:65 fmt
export const debug_CovTerm: Debug<CovTerm> = (self, f) => {
  switch (self.$) {
    case "Zero":
      return "Zero";
    case "Counter":
      return debug_tuple(f, "Counter", [String(self._0)]);
    case "Expression":
      return debug_tuple(f, "Expression", [String(self._0)]);
  }
};

// impl Debug for CoverageKind
// PORT: `write!(fmt, ..)` formats its arguments with fresh (non-alternate) flags. (Upstream's `Point(..` has no closing
// parenthesis; kept.)
// rustc: compiler/rustc_middle/src/mir/coverage.rs:108 fmt
export const debug_CoverageKind: Debug<CoverageKind> = (self, _fmt) => {
  switch (self.$) {
    case "Point": {
      const { point_kind, hir_id } = self;
      return `Point(${debug_PointKind(point_kind, PLAIN)}, ${debug_HirId(hir_id, PLAIN)}`;
    }
    case "BlockMarker":
      return `BlockMarker(${BlockMarkerId.index(self.id)})`;
    case "VirtualCounter":
      return `VirtualCounter(${debug_BasicCoverageBlock(self.bcb, PLAIN)})`;
  }
};

/// Returns true if this kind of coverage statement is a marker inserted during
/// MIR building, for use by analysis in the `InstrumentCoverage` pass, and is
/// no longer needed after that pass.
// rustc: compiler/rustc_middle/src/mir/coverage.rs:123 is_removed_after_analysis
CoverageKind.is_removed_after_analysis = function (self: CoverageKind): boolean {
  switch (self.$) {
    case "Point":
    case "BlockMarker":
      return true;
    case "VirtualCounter":
      return false;
  }
};

// rustc: compiler/rustc_middle/src/mir/coverage.rs:139 is_add
Op.is_add = function (self: Op): boolean {
  return self === "Add";
};

// rustc: compiler/rustc_middle/src/mir/coverage.rs:143 is_subtract
Op.is_subtract = function (self: Op): boolean {
  return self === "Subtract";
};
