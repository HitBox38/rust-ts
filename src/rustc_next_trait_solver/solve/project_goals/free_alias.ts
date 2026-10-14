//! Computes a projection goal for inherent associated types,
//! `#![feature(checked_type_aliases)]` and `#![feature(type_alias_impl_trait)]`.
//!
//! Since a free alias is never ambiguous, this just computes the `type_of` of
//! the alias and registers the where-clauses of the type alias.
//
// Contract stub for compiler/rustc_next_trait_solver/src/solve/project_goals/free_alias.rs (lane evalctxt-contract; the file
// belongs to lane nts-normalizes). The `EvalCtxt` methods of the file are declared in ../../decls.ts
// (`// solve/project_goals/free_alias.rs:<line>`); the call below installs `unported(..)` placeholders. To fill one: assign
// `EvalCtxt.prototype.<name> = function (this: EvalCtxt, ..) { .. }` with the `// rustc:` marker above it, in upstream
// order, and delete the name from the list (the call when the list is empty). Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { EvalCtxt } from "../../decls.ts";

unported_methods(EvalCtxt.prototype, "rustc_next_trait_solver::solve::project_goals::free_alias::EvalCtxt", [
  "normalize_free_alias",
]);
