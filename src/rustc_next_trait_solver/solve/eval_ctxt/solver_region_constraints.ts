//! Logic for `-Zassumptions-on-binders` stuff
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/eval_ctxt/solver_region_constraints.rs (lane
// evalctxt-contract; the file belongs to lane nts-eval). The `EvalCtxt` methods are declared in ../../decls.ts
// (`// solve/eval_ctxt/solver_region_constraints.rs:<line>`); the call below installs `unported(..)` placeholders. To
// fill one: assign `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..) { .. }` with the `// rustc:` marker
// above it, in upstream order, and delete the name from the list (the call when the list is empty). The struct
// `RawAssumptions` is local to `region_assumptions_for_placeholders_in_universe`: port it inside that fn.
// Extension module (docs/handoff/evalctxt-contract.md "Init order").
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { EvalCtxt } from "../../decls.ts";

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::eval_ctxt::solver_region_constraints::EvalCtxt", [
  "region_assumptions_for_placeholders_in_universe",
  "eagerly_handle_placeholders",
  "destructure_type_outlives",
  "destructure_components",
  "destructure_component",
  "destructure_alias_outlives",
]);
