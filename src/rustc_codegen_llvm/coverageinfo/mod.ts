// compiler/rustc_codegen_llvm/src/coverageinfo/mod.rs: out of M7 (harness/scope.json excludes src/coverageinfo; plan-m7 D18,
// `-Cinstrument-coverage`). Lane cg-contract placed here what the skeleton needs: `impl CoverageInfoBuilderMethods for
// Builder` as a stub, and the type `CguCoverageContext` for `FullCx.coverage_cx`, which stays `None`.
import type { CoverageInfoBuilderMethods } from "../../rustc_codegen_ssa/traits/coverageinfo.ts";
import type { CoverageKind } from "../../rustc_middle/mir/coverage.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import { unported } from "../../std/panic.ts";
import { Builder } from "../builder.ts";

/** PORT (cg-contract): `CguCoverageContext<'ll, 'tcx>` (out of M7): `FullCx.coverage_cx` is always `None`. */
export type CguCoverageContext = never;

// ---- impl CoverageInfoBuilderMethods for Builder (coverageinfo/mod.rs:85) ----
declare module "../builder.ts" {
  interface Builder {
    add_coverage(instance: Instance, kind: CoverageKind): void;
  }
}

// Stub (cg-contract): CoverageInfoBuilderMethods::add_coverage
Builder.prototype.add_coverage = function (this: Builder, _instance: Instance, _kind: CoverageKind): void {
  return unported("coverageinfo is excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/coverageinfo/mod.rs add_coverage");
};
