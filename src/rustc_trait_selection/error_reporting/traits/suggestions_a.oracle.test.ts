// Oracle tests of lane errrep-sugg-a: error_reporting/traits/suggestions.rs:1..2484, reached from E0277 /
// `report_selection_error`, through type checking. See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures
// from the tydump probe, `REGEN=1` rewrites them). The `#![no_core]` crates are review-w19's scratch crates.
// - `restrict_param`, `restrict_self`, `impl_trait_param`: `suggest_restricting_param_bound` (type parameters, `Self`,
//   associated types, `impl Trait` arguments: `suggest_restriction` / "introduce a type parameter").
// - `deref`, `impl_for_ref`, `binop`: `suggest_dereferences` ("consider dereferencing here" / "the borrow").
// - `fn_call`: `suggest_fn_call` ("use parentheses to call this function").
// - `remove_ref`: `suggest_remove_reference` (one and two leading `&`).
// - `borrow`: `suggest_add_reference_to_arg` ("consider borrowing here").
// - `block_tail`: the impl-candidate help on a block's tail expression.
// - `fn_ptr`: fn items vs. fn pointer impls ("try casting using `as`").
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("suggestions_a_test", join(import.meta.dir, "suggestions_a_test"), [
  "restrict_param",
  "restrict_self",
  "impl_trait_param",
  "deref",
  "impl_for_ref",
  "binop",
  "fn_call",
  "remove_ref",
  "borrow",
  "block_tail",
  "fn_ptr",
]);
