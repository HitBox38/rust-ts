// Oracle tests of lane errrep-need-type-info: infer/need_type_info.rs (E0282 and the "type annotations needed" labels
// and suggestions of E0283 / E0284) and traits/ambiguity.rs (`maybe_report_ambiguity`, `annotate_source_of_ambiguity`,
// E0790), through type checking. See src/rust_ts/typeck_oracle_fixtures.ts for the setup (fixtures from the tydump
// probe, `REGEN=1` rewrites them).
// - `adt_default_param`: a type-relative path whose ADT has a defaulted parameter (`S::new()` with
//   `struct S<T, U = u8>`; review-w19 H1: the `ty::Adt(def, args)` arm of `resolved_path_inferred_arg_iter`'s caller
//   uses the ADT's own `args`).
// - `let_binding`: `let x = Vec::new()` / `let v = None` / a tuple pattern (`ty_to_string`, "for `Vec<_>`").
// - `closure_arg`: closure parameters without a type (`ClosureArg` sources).
// - `method_turbofish`: method calls with uninferable generic parameters (turbofish suggestions), `collect()`.
// - `fully_qualified`: E0790 (`Make::make()`) and a method of a generic trait with two impls (E0283, fully-qualified
//   suggestion).
// - `multi_impl`: E0283 with the "the following types implement trait" list, E0284 (`parse().unwrap()`).
// - `projection`: E0283 whose related projection goals are merged into one note (`error_implies` suppresses the
//   duplicate `<_ as Assoc>::Out == _`; fulfillment_errors.rs:1595 compares the `ParamEnv`s by value).
import { join } from "node:path";
import { typeck_oracle_fixture_tests } from "../../../rust_ts/typeck_oracle_fixtures.ts";

typeck_oracle_fixture_tests("need_type_info_test", join(import.meta.dir, "need_type_info_test"), [
  "adt_default_param",
  "let_binding",
  "closure_arg",
  "method_turbofish",
  "fully_qualified",
  "multi_impl",
  "projection",
]);
