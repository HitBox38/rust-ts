//! Computes a projection goal for inherent associated types,
//! `#![feature(inherent_associated_type)]`. Since HIR ty lowering already determines
//! which impl the IAT is being projected from, we just:
//! 1. instantiate generic parameters,
//! 2. equate the self type, and
//! 3. instantiate and register where clauses.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/project_goals/inherent.rs (lane evalctxt-contract; the file
// belongs to lane nts-normalizes). The `EvalCtxt` methods of the file are declared in ../../decls.ts
// (`// solve/project_goals/inherent.rs:<line>`); the call below installs `unported(..)` placeholders. To fill one: assign
// `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..) { .. }` with the `// rustc:` marker above it, in upstream
// order, and delete the name from the list (the call when the list is empty). Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { EvalCtxt } from "../../decls.ts";

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::project_goals::inherent::EvalCtxt", [
  "normalize_inherent_associated_term",
  "convert_inherent_self_to_impl",
]);
