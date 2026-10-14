// Port of compiler/rustc_infer/src/infer/outlives/obligations.rs (lane infer-canonical-outlives).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported } from "../../../std/panic.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { InferCtxt } from "../../decls.ts";
import type { FreeFns } from "../../decls.ts";

export * from "./obligations.gen.ts";

import type { Region } from "../../../rustc_middle/ty/decls.ts";
import type { SubregionOrigin } from "../mod.gen.ts";
import type { GenericKind, VerifyBound } from "../region_constraints/mod.gen.ts";

// rustc-trait: compiler/rustc_infer/src/infer/outlives/obligations.rs:432 TypeOutlivesDelegate
// PORT: `impl TypeOutlivesDelegate for &InferCtxt` (obligations.rs:720) is a delegate object built by the port of this
// file; `impl<A, B> TypeOutlivesDelegate for (A, B)` (obligations.rs:721..) likewise.
export interface TypeOutlivesDelegate {
  // rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:433 push_sub_region_constraint
  push_sub_region_constraint(origin: SubregionOrigin, a: Region, b: Region, constraint_category: unknown): void;

  // rustc: compiler/rustc_infer/src/infer/outlives/obligations.rs:441 push_verify
  push_verify(origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void;
}

unported_methods(InferCtxt.prototype, "rustc_infer::infer::outlives::obligations::InferCtxt", ["register_outlives_constraint", "register_region_eq_constraint", "register_region_outlives_constraint", "register_type_outlives_constraint_inner", "register_solver_region_constraint", "register_type_outlives_constraint", "take_registered_region_obligations", "num_registered_region_obligations", "registered_region_obligations_since", "clone_registered_region_obligations", "register_region_assumption", "take_registered_region_assumptions", "destructure_solver_region_constraints_for_regionck", "destructure_solver_region_constraints_for_borrowck", "destructure_solver_region_constraints", "process_registered_region_obligations"]);

// stub: infer/outlives/obligations.rs:400
export const assumed_type_outlives = ((): never => unported("rustc_infer::infer::outlives::obligations::assumed_type_outlives")) as FreeFns["assumed_type_outlives"];
