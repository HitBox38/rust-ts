//! Computes a projection goal for opaque types. This goal
//! behaves differently depending on the current `TypingMode`.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/project_goals/opaque_types.rs (lane evalctxt-contract; the file
// belongs to lane nts-normalizes). The `EvalCtxt` methods of the file are declared in ../../decls.ts
// (`// solve/project_goals/opaque_types.rs:<line>`); the call below installs `unported(..)` placeholders. To fill one: assign
// `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..) { .. }` with the `// rustc:` marker above it, in upstream
// order, and delete the name from the list (the call when the list is empty). Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { EvalCtxt } from "../../decls.ts";

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::project_goals::opaque_types::EvalCtxt", [
  "normalize_opaque_type",
]);
