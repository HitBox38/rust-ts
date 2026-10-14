// Port of compiler/rustc_infer/src/infer/relate/lattice.rs (lane infer-relate).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";

export * from "./lattice.gen.ts";

import type { ParamEnv } from "../../../rustc_middle/ty/decls.ts";
import type { InferCtxt } from "../../decls.ts";
import type { PredicateObligations } from "../../traits/mod.gen.ts";
import type { TypeTrace } from "../mod.gen.ts";
import type { LatticeOpKind } from "./lattice.gen.ts";

// rustc-type: compiler/rustc_infer/src/infer/relate/lattice.rs:48 LatticeOp
// PORT: hand class (codegen `hand`): the field `param_env` is `param_env_` (`PredicateEmittingRelation::param_env`).
export class LatticeOp {
  constructor(
    public infcx: InferCtxt,
    // Immutable fields
    public trace: TypeTrace,
    public param_env_: ParamEnv,
    // Mutable fields
    public kind: LatticeOpKind,
    public obligations: PredicateObligations,
  ) {}
}

unported_methods(LatticeOp.prototype, "rustc_infer::infer::relate::lattice::LatticeOp", ["into_obligations"]);
unported_methods(LatticeOp, "rustc_infer::infer::relate::lattice::LatticeOp", ["new"]);
