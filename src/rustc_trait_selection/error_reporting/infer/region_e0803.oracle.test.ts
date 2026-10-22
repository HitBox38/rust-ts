// Oracle tests of lane errrep-region: E0803 (`report_sub_sup_conflict` and the `impl` item signature notes of
// infer/region.rs), through type checking. See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures from the
// tydump probe, `REGEN=1` rewrites them). The cases are tests/ui `lifetimes/lifetime-mismatch-between-trait-and-impl.rs`
// and `lifetimes/param-without-lifetime-constraint.rs` (review-w19; the latter's `String` field is a `u32` here: with
// `String` the port stops earlier, at `Decodable for DenseBitSet<u32>` in crate metadata).
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("region_e0803_test", join(import.meta.dir, "region_e0803_test"), ["e0803_trait_impl_mismatch", "e0803_param_without_lifetime"]);
