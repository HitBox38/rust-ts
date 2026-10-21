// Oracle tests of lane errrep-infer-b: infer/note_and_explain.rs, infer/suggest.rs, the manual impls of diagnostics.rs
// and diagnostics/note_and_explain.rs, through type checking. See src/rust_ts/typeck_oracle_fixtures.ts for the setup
// (fixtures from the tydump probe, `REGEN=1` rewrites them). The `#![no_core]` crates are review-w19's scratch crates.
// - `note_and_explain`: `note_and_explain_type_err` (params vs. concrete types, float/int literals, associated types:
//   `suggest_constraint`, `point_at_methods_that_satisfy_associated_type`, closures, `impl Trait` params).
// - `suggest`: `suggest_tuple_pattern`, `suggest_accessing_field_where_appropriate`, `could_remove_semicolon`,
//   `consider_returning_binding_diag`, `suggest_function_pointers_impl` (unsafe fn pointers, `&`, casting both fn items).
// - `misc`: float literal suggestions (`use a float literal`), fn item to fn pointer, projections with bounds.
// - `fn_ptr_cast`: every `FunctionPointerSuggestion` / `FnConsiderCastingBoth` reached from E0308 (the
//   `Binder<FnSig>` Display / IntoDiagArg of the generated diagnostics: `as fn(u32)`).
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("infer_b_test", join(import.meta.dir, "infer_b_test"), ["note_and_explain", "suggest", "misc", "fn_ptr_cast"]);
