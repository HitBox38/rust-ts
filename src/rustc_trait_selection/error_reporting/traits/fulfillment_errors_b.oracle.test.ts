// Oracle tests of lane errrep-traits-b: error_reporting/traits/fulfillment_errors.rs:1530..4136, through type checking.
// See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures from the tydump probe, `REGEN=1` rewrites them).
// - `similar_impls`: `report_similar_impl_candidates` / `find_similar_impl_candidates` / `fuzzy_match_tys` (other
//   impls of the trait, a generic ADT with other instantiations, tuples, the "and N others" cut at 9).
// - `closure_args`: `report_arg_count_mismatch` (E0593: too many / too few arguments, a tuple vs. distinct
//   arguments both ways) and the closure-signature notes of `report_selection_error` (E0277 "expected an `Fn(..)`
//   closure", a fn item with the wrong parameter type).
// Not covered here: `note_adt_version_mismatch` / `check_same_name_different_path` (need several versions of one
// crate), the safe-transmute reasons (stop at `rustc_transmute`), `report_closure_error` (E0525 is reported after
// type checking).
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("fulfillment_errors_b_test", join(import.meta.dir, "fulfillment_errors_b_test"), ["similar_impls", "closure_args"]);
