// Oracle tests of lane errrep-infer-a: infer/mod.rs (`TypeErrCtxt::cmp` and its helpers, `cmp_fn_sig`, `note_type_err`,
// `note_error_origin`, `type_error_additional_suggestions`, `report_and_explain_type_error`), through type checking.
// See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures from the tydump probe, `REGEN=1` rewrites them).
// - `cmp_types`: the expected/found notes of E0308 for ADTs (common prefix `_`, defaulted params), nested ADTs,
//   references and their mutability/regions, tuples, fn pointers (arity, `unsafe`), closures, slices, raw pointers,
//   enums of enums.
// - `error_origin`: `note_error_origin` / `ObligationCauseCode` texts (match arms, `if`/`else`, `if` without `else`,
//   `let`-`else`, patterns, `loop`/`break`, `while let`), the 1-tuple and char/str literal suggestions,
//   `suggest_param_env_shadowing`-style projections.
// - `fn_sigs`: `cmp_fn_sig` through E0053 (compare_impl_item: parameter types, late-bound regions, `unsafe`) and fn items
//   in `if`/`else`.
// Not covered: the `(opaque type at <file:l:c>)` notes and `OpaqueTypesVisitor` (opaque types need `mir_borrowck`, not
// ported), arrays (const values) and trait objects (`supertrait_def_ids`) in E0308.
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("infer_a_test", join(import.meta.dir, "infer_a_test"), ["cmp_types", "error_origin", "fn_sigs"]);
