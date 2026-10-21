// Oracle tests of lane typeck-suggest-b: method/suggest.rs:2433..5035 (E0599 / E0034 / E0689 notes and suggestions),
// through type checking. See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures from the tydump probe,
// `REGEN=1` rewrites them). The `#![no_core]` crates are review-w19's scratch crates (s2, s3, s5, s6).
// - `traits_to_implement`: `suggest_traits_to_import` ("the following traits define an item ..., perhaps you need to
//   implement one of them", type-parameter bounds).
// - `derive`: `suggest_derive` (the derive grouping: `#[derive(Debug, Eq, Ord, PartialEq, PartialOrd)]`, `Hash`).
// - `restrict_and_disambiguate`: restriction / supertrait suggestions for `T`, `&T`, `&Self`, `impl Trait`, explicitly
//   unimplemented traits, associated functions ("use associated function syntax instead"), `print_disambiguation_help`.
// - `unwrap_and_numeric`: `suggest_unwrapping_inner_self` (`Option` / `Result`: `expect`, `?`),
//   `report_failed_method_call_on_numerical_infer_var` (E0689), a closure parameter E0282, receiver wrapping.
// (s1 and s4 of the review stop at `SelectionContext::select` and are not adopted.)
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("suggest_b_test", join(import.meta.dir, "suggest_b_test"), [
  "traits_to_implement",
  "derive",
  "restrict_and_disambiguate",
  "unwrap_and_numeric",
]);
