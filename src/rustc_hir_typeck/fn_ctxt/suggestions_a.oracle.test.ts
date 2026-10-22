// Oracle tests of lane typeck-fnsugg-a: fn_ctxt/suggestions.rs:1..2025 and method/prelude_edition_lints.rs, through
// type checking. See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures from the tydump probe, `REGEN=1`
// rewrites them). (fnsugg_a.test.ts keeps the unit-level checks.)
// - `return_and_call`: `suggest_missing_return_type` (unit fns, `if` arms), `suggest_fn_call` (fn items, closures),
//   `suggest_boxing_when_appropriate`, `try_suggest_return_impl_trait` (`-> T` with `T: Default`),
//   `suggest_remove_last_method_call`, `suggest_deref_ref_or_into` (field / `Option` mismatches).
// - `prelude_collisions` (edition 2018, `#![warn(rust_2021_prelude_collisions)]`): `lint_edition_dependent_dot_call`
//   (method calls, through a deref) and `lint_fully_qualified_call_from_2018` (`<Vec<u8>>::from_iter`,
//   `u16::try_from`).
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("fn_ctxt/suggestions_a_test", join(import.meta.dir, "suggestions_a_test"), [
  "return_and_call",
  { name: "prelude_collisions", edition: "2018" },
]);
