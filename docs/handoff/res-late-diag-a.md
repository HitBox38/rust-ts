# Handoff: res-late-diag-a (wave 10, M2: rustc_resolve late/diagnostics.rs, lines 1-2266)

Branch `lane/res-late-diag-a` (from main 00f8a7b, no merges). Commits: the port; the tests; this handoff.

## Files
- `src/rustc_resolve/late/diagnostics.ts` (shared with res-late-diag-b, which owns line 2267 to the end):
  - **In place:** `is_self_type`, `is_self_value`, `path_to_string_without_assoc_item_bindings`,
    `import_candidate_to_enum_paths`, `AssocSuggestion.action`, `TypoCandidate.to_opt_suggestion`.
  - **New region** `// ---- res-late-diag-a: impl LateResolutionVisitor ... ----` / `// ---- end res-late-diag-a ----`,
    just before the `unported_methods(..)` calls. It holds the 32 `LateResolutionVisitor` methods from
    `trait_assoc_type_def_id_by_name` (:188) to `update_err_for_private_tuple_struct_fields` (:2223), in upstream
    order, plus three local helpers without upstream counterpart (`TraitBoundModifiers_eq`, `str_cmp`, `expr_parent_kind`).
  - My 32 names are gone from the `LateResolutionVisitor` `unported_methods` list; lane b's names are left.
  - **Imports.** My imports are in the `// res-late-diag-a imports` block. I also had to turn four header lines of
    the stub from type-only into value imports (`Span`, `Ident`, `TypoSuggestion`, `Segment`), because the code
    needs their companions. **Merge note:** lane b likely edits the same four lines; take the union.
- `src/rustc_resolve/late/diagnostics.test.ts` (new) and `src/rustc_resolve/late/diagnostics_oracle/`
  (`cannot_find.rs`, `self_kw.rs`, `helpers.rs` + `.resdump.stderr` fixtures + `exit_codes.json`; `units.rs` is unit-check
  input only).
- No other file touched. decls.ts needs one addition (see "For root").

## Checks
- `bun scripts/coverage.ts --missing compiler/rustc_resolve/src/late/diagnostics.rs`: 38/69 overall; **0 missing in
  lines 1-2266** (all 38 fns of the range). The 31 left are lane b's (2267+).
- `bun scripts/coverage.ts --check`: `markers ok (6702; vendor 2603)`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3399 pass, 1 skip, 0 fail.
- `RUST_TS_AGENT=res-late-diag-a bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH
  (run `20261013-133102-res-late-diag-a-5rkp`). The parse suite does not reach this file; no regression.

## Tests (`late/diagnostics.test.ts`, 20 tests)
1. **End-to-end oracle cases** (resdump probe, run from the repo root, `#![no_core]`, edition 2021). Each
   fixture is guarded by a "named for" test, and a freshness test re-runs the probe.
   - `cannot_find.rs` (9 errors): E0425 "cannot find type/value/function" with "a struct/constant/unit struct/function
     with a similar name exists", "consider importing this function/struct", `in module shapes::deep`, and E0433
     unresolved modules. At this pin, unresolved *types* are E0425 too (no E0412 in the oracle output).
   - `self_kw.rs` (7 errors): E0411 `Self` in a free fn, E0424 `self` in an associated fn (with the `&self`
     suggestion and the cross-namespace note), `this` -> `self`, "use the available field", "a method by that name is
     available on `Self` here", `True` -> `true`, `printf` -> `print!`.
   - `helpers.rs` (5 errors): pattern `let` in `if x = v`, `@` in slice patterns (both sides) with the range-struct
     suggestion, `m(&self, 1, 2)` -> "try calling `m` as a method".
   - **PENDING: all 3.** Today they stop at `rustc_lint::late::unerased_lint_store (pending lint-early-a)`, before
     resolution; the test asserts exit 70 and that exact last stderr line. After that they need late.rs, lane b and
     res-diag (see below).
2. **Rendered, live:** `suggest_pattern_match_with_let` plus the fallback label, on the base error that
   `smart_resolve_report_errors` makes for `x` in `if x = v {}`. It is emitted through `AnnotateSnippetEmitter` and
   equals the oracle's E0425 block in `helpers.resdump.stderr` byte for byte. Negative control: one extra space in
   the suggestion fails it.
3. **Structural, live:** the free fns and companions, `could_be_expr`, `call_has_self_arg`, `followed_by_brace`,
   `update_err_for_private_tuple_struct_fields` (tuple struct pattern), `explain_functions_in_pattern`,
   `suggest_at_operator_in_slice_pat_with_range` (both sides, with the subdiagnostic's message from the oracle),
   `suggest_changing_type_to_const_param` (type param used as a value).
4. **In-process PENDING** (each asserts the exact `Unported.what` and keeps its full expectations):

   | case | stops at today | expectation once live |
   |---|---|---|
   | `smart_resolve_report_errors`: E0411 for `Self` in a free fn | `rustc_resolve::late::PathSource::descr_expected` | oracle block of self_kw.rs, byte for byte |
   | `smart_resolve_report_errors`: pattern `let` in an `if` | `rustc_resolve::late::PathSource::descr_expected` | oracle block of helpers.rs, byte for byte |
   | `suggest_range_struct_destructuring`: `rest..` | `rustc_resolve::late::LateResolutionVisitor::resolve_path` | `std::ops::RangeFrom { start: rest }` |

   After `descr_expected`, `smart_resolve_report_errors` next reaches `PathSource::error_code` (late) and
   `Resolver::dcx` (res-diag).
- The tests use `tcx.dcx()` where upstream's `Resolver::dcx` (diagnostics.rs, res-diag) would be called.
- Regenerate the fixtures with `REGEN=1 bun test src/rustc_resolve/late/diagnostics.test.ts`.

## `unported(...)` left
- **In my range:** one. `suggest_named_format_argument` reads `tcx.get_diagnostic_name(def_id)` for an *extern*
  `macro_def_id`. That needs the diagnostic items of other crates (wave 11). It is reached only when a format
  macro comes from another crate; local def ids are filtered out before it, as upstream.
- **Reached through other lanes' stubs:**
  - **late.rs** (res-late-a/-b): `PathSource::{namespace, descr_expected, error_code, is_expected, is_call}`, and
    `LateResolutionVisitor::{resolve_path, self_type_is_available, self_value_is_available}`.
  - **late/diagnostics.rs 2267+** (res-late-diag-b): `lookup_typo_candidate`, `lookup_assoc_candidate`,
    `smart_resolve_context_dependent_help`, `suggest_alternative_construction_methods`, `let_binding_suggestion`,
    `likely_rust_type`, `mk_where_bound_predicate`.
  - **diagnostics.rs** (res-diag-a/-b): `Resolver::{dcx, lookup_import_candidates, add_typo_suggestion, find_cfg_stripped,
    struct_ctor, on_unknown_data}`, `StructCtor::has_private_fields`, `TypoSuggestion::single_item`.

## PORT decisions (please record)
1. **`Self::likely_rust_type`** (late/diagnostics.rs:3174, lane b) is an associated fn. decls.ts lists it as
   "static: see the hand module" but declares no static. `err_code_special_cases` calls it as
   `(LateResolutionVisitor as unknown as {likely_rust_type(..)}).likely_rust_type(path)`, marked
   `// PORT(decls): pending root`.
   - Lane b must install it as a static on the class: `LateResolutionVisitor.likely_rust_type = ..`.
   - Root: add `declare static likely_rust_type: (path: readonly Segment[]) => Symbol | undefined;` to the class in
     decls.ts, then drop the cast. `late.rs:1581 new` is in the same situation.
2. **`fallback |= f(..)`** (in `smart_resolve_report_errors` and `suggest_trait_and_bounds`) always runs `f`. It is
   written as `const x = f(..); fallback = fallback || x;`, never `||=`.
3. **`String` ordering.** `suggestions.sort()` and `enum_candidates.sort()` use a local code-point comparator,
   `str_cmp`, so the order is UTF-8 byte order as in Rust. Tuples compare field by field.
4. **`TraitBoundModifiers == NONE`** uses a local `TraitBoundModifiers_eq`, a copy of rustc_parse/parser/path.ts's.
   No `_eq` is generated for that type. Candidate for codegen.
5. **`UnordMap::to_sorted(hcx, true)`** for `patterns_with_skipped_bindings` sorts by `tcx.def_path_hash(def_id)`
   (the `DefId` stable key; `Fingerprint` compared as one u128). It runs inside `with_stable_hashing_context`.
6. **`find_attr!(r.tcx, did, Doc(d) => d)`** reads `tcx.attrs_for_def(did)` directly. `did` is never local there, and
   lib.ts's `DefId_get_attrs` (the same thing) is not exported.
7. **`FxHashMap` iteration** over `Rib.bindings` (last block rib, hygiene-hidden idents) and label ribs uses JS
   insertion order, not hashbrown order.
   - For the last-block-rib lookup at most one key can match, so the order is not observable.
   - For the other two, only the order of the help or labels could differ, with several same-named bindings
     differing in hygiene.
8. **`followed_by_brace`** scans the next source by bytes instead of `char_indices()`. `{` and `}` are ASCII, so the
   offsets are the same.
9. **`import_candidate_to_enum_paths` on an empty path** panics with the slice-index message that release rustc
   gives after the `usize` wrap. JS `slice(0, -1)` would otherwise return `[]` silently. Upstream never reaches it.
10. **Smaller mappings:**
    - The fn-local `enum Side { Start, End }` is a string union.
    - `extract_if` is an order-preserving partition.
    - `str::to_lowercase` is `toLowerCase`.
    - `FormatArgs { unresolved, this, .. }` spells out the declared field defaults.
    - The `let`-chain in `suggest_swapping_misplaced_self_ty_and_trait` is a series of early returns in the same order.
      `resolve_path` still runs before the span, source and res checks.
11. **`expr_parent_kind(source)`** is a local helper for the repeated `PathSource::Expr(Some(Expr { kind, .. }))`
    patterns. It has no upstream counterpart.

## For root
1. Add the `likely_rust_type` static to decls.ts (decision 1). Merge lane b's `likely_rust_type` as a class static.
2. At merge with res-late-diag-b, take the union of the header import edits and of the edits to the
   `unported_methods` line.
3. Take the PENDING entries off as lint-early-a, res-late-*, res-late-diag-b and res-diag-* land. The two rendered
   `smart_resolve_report_errors` cases should go live first: they need only `PathSource` and `Resolver::dcx`.
4. Delete `docs/claims/wave10-res-late-diag-a.md` on integration.
