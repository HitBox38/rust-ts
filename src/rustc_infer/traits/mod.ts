// Port of compiler/rustc_infer/src/traits/mod.rs (lane infer-opaque-snapshot).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../rust_ts/stubs.ts";
import { Obligation } from "./mod.gen.ts";

export * from "./mod.gen.ts";

import type { Certainty } from "../../rustc_type_ir/solve/mod.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import type { Result } from "../../std/result.ts";
import type { InferCtxt } from "../decls.ts";
import type { PredicateObligation } from "./mod.gen.ts";

// `pub use rustc_middle::traits::*;`
export * from "../../rustc_middle/traits/mod.ts";
// `pub use self::engine::{FromSolverError, ScrubbedTraitError, TraitEngine, TraitErrors};`
export { type FromSolverError, ScrubbedTraitError, type TraitEngine, TraitEngine_provided, TraitErrors } from "./engine.ts";
// `pub use self::project::{..}` and `pub(crate) use self::project::UndoLog;`
export {
  type MismatchedProjectionTypes,
  Normalized,
  type NormalizedTerm,
  ProjectionCache,
  ProjectionCacheEntry,
  ProjectionCacheKey,
  ProjectionCacheStorage,
  type UndoLog,
} from "./project.ts";
// `pub mod util;`
export * as util from "./util.ts";
// Manual Debug of `Obligation` (traits/structural_impls.rs).
export { debug_Obligation } from "./structural_impls.ts";

/// A callback that can be provided to `inspect_typeck`. Invoked on evaluation
/// of root obligations.
// rustc-type: compiler/rustc_infer/src/traits/mod.rs:126 ObligationInspector
export type ObligationInspector = (infcx: InferCtxt, obligation: PredicateObligation, result: Result<Certainty, NoSolution>) => void;

unported_methods(Obligation.prototype, "rustc_infer::traits::Obligation", ["as_goal", "eq", "hash", "flip_polarity", "derived_cause", "set_depth_from_parent", "with", "polarity", "self_ty"]);
unported_methods(Obligation, "rustc_infer::traits::Obligation", ["new", "with_depth", "misc"]);
