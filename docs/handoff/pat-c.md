# Handoff: pat-c (M4 wave 22, rustc_pattern_analysis 3/3): `RustcPatCtxt` (rustc.rs, rustc/print.rs)

Branch `lane/pat-c` (from `bcff46df` = lane/pat-b, no merges). Commits: `1ce4fb8a` (the port), `0e419524` (tests), `02c8abb7` (fix), then
this handoff.

## Result
- **`src/rustc_pattern_analysis/rustc.ts`: 38/38** (pat-b's 29 stubs filled + its 9 markers): `reveal_opaque_ty` /
  `reveal_inner`, `reveal_opaque_key`, `is_uninhabited`, `is_foreign_non_exhaustive_enum`, `is_range_beyond_boundaries`,
  `variant_sub_tys`, `variant_index_for_adt`, `ctor_sub_tys` / `reveal_and_alloc`, `ctor_arity`, `ctors_for_ty`,
  `lower_pat_range_bdy`, `lower_pat`, `hoist_pat_range_bdy`, `print_pat_range`, `print_witness_pat`,
  `would_print_as_wildcard`, the `PatCx` impl (`is_exhaustive_patterns_feature_on`, `write_variant_name`, `bug`,
  `delayed_bug`, `lint_overlapping_range_endpoints`, `complexity_exceeded`, `lint_non_contiguous_range_endpoints`,
  `match_may_contain_deref_pats`, `report_mixed_deref_pat_ctors`), `expand_or_pat` / `expand`.
- **`src/rustc_pattern_analysis/rustc/print.ts`: 4/4** (`start_or_comma`, `write_struct_like`, `write_ref_like`,
  `write_slice_like`).
- Signatures of pat-b's declarations kept unchanged. No `unported(..)` left in either file.
- `contract.test.ts`: counts lowered (markers 89 -> 122, stubs 99 -> 66, per lane `{ "pat-a": 66 }`); its
  `analyze_match` test now expects the first stub on the path in usefulness (`PlaceValidity::from_bool`, pat-a) and is
  `skipIf(USEFULNESS_PORTED)`.

## Tests (new): `src/rustc_pattern_analysis/rustc.test.ts` + `rustc_test_driver.ts` (not a port)
The driver compiles `#![no_core]` libraries with the ported driver up to type checking (tydump_dump.ts's
`run_required_analyses_prefix`, as thirdump), builds a `RustcPatCtxt` per body as check_match's `new_cx` does and runs
one scenario in a subprocess (so diagnostics can be compared):
- `lower` (21 fns): `lower_pat` of every arm (`Debug`, ctor, arity), `ctors_for_ty` of every scrutinee, `ctor_sub_tys`
  (incl. `PrivateUninhabitedField(true)` for a private uninhabited field seen from outside its module), and each arm
  printed back with `print_witness_pat`. Covers enums (incl. a visibly-empty variant -> `Empty`, a local doc(hidden) one
  -> `Visible`), structs / tuple structs / unit structs / 1-tuples, unions, refs (match ergonomics), slices, arrays
  (`VarLen` / `FixedLen`), signed / unsigned / pointer-sized / 128-bit integers and their ranges (incl. half-open),
  chars, bools, `&str`, f64 literals and ranges, or-patterns, `x @ p`, `!` / empty enums (`NoConstructors`), raw and
  fn pointers (`Unlistable`). Expected values worked out from upstream (rustc.rs, constructor.rs `Debug`s).
- `witness`: hand-built witnesses. `w1`..`w14` are the witnesses the oracle reports in E0004 for the same fns; the test
  checks the recorded strings and, live, the oracle's E0004 messages (`i8::MIN..=-1_i8`, `11_i8..=i8::MAX`,
  `'\0'..='`'`, `&mut None`, `[false, ..]`, `S { a: false, .. }`, `(T(false, _), _)`, `..=-1_isize`, ...). Plus the
  other arms: wildcard-like ctors, `deref!(_)`, the array `..` merge vs slices, `Missing` (bug), the full range,
  `would_print_as_wildcard`, `is_range_beyond_boundaries`, `variant_index_for_adt`, `write_variant_name`, ...
- `hooks`: `lint_overlapping_range_endpoints` and `lint_non_contiguous_range_endpoints` (gap and `MAX` forms) called as
  usefulness calls them: **stderr byte-identical to the oracle's** on the same source (checked live + recorded).
- `complexity`: `complexity_exceeded` with the match span: stderr byte-identical to the oracle's
  (`#![pattern_complexity_limit = "1"]`).
Live oracle checks are skipped (with a printed SKIP) when the pinned toolchain is not installed.

## What needs pat-a (not testable here)
Everything that goes through `compute_match_usefulness` / `PatternColumn` / `lint_nonexhaustive_missing_variants`:
`analyze_match` end to end, E0004/E0005 witness lists, unreachable-pattern lints, the order and arguments with which
usefulness calls the lint hooks, `report_mixed_deref_pat_ctors` (called from checks.rs; emits
`MixedDerefPatternConstructors`, not exercised: deref patterns need `#![feature(deref_patterns)]` + lang items),
`delayed_bug` / `bug` (ICE paths), `exhaustive_witnesses`. The 8 upstream crate tests stay skipped until pat-a.

## Known gaps / notes for root
1. **`usize::MAX..` / `isize::MAX..` witnesses**: `print_pat_range` calls `Ty::numeric_max_val`, whose body
   (`mir::Const::from_bits`, rustc_middle ty/util.ts `mir_Const_from_bits`) is `unported`. Also its TS declaration
   (ty/decls.ts) returns `ty::Const`, upstream returns `mir::Const` (util.rs:1152); rustc.ts casts with a `// PORT:`.
   Owner: rustc_middle (ty/util.ts, ty/decls.ts). Pinned by the test case `usize_max_plus_one`.
2. **Opaque types**: `reveal_opaque_ty` / `reveal_opaque_key` are ported but not exercised: a body that defines an
   opaque type reaches `mir_borrowck` (unported) through `type_of` before THIR, so no test.
3. **Merging mb-check-match**: its check_match.ts declares a stand-in `RustcPatCtxtState` with `default_()`; pat-b's
   (now real) one has `static default()`. When replacing its contract block with imports from
   `rustc_pattern_analysis/rustc.ts`, use `RustcPatCtxtState.default()`. Its uses (`lower_pat`, `analyze_match`,
   `is_range_beyond_boundaries`, `print_witness_pat`, `is_uninhabited`, `is_foreign_non_exhaustive_enum`) match the
   signatures here.
4. **Merging pat-a**: both lanes edit `contract.test.ts` (counts at its lines 112-119 and the `analyze_match` test). After
   both: markers 188, stubs 0, `per_lane` `{}`; the `analyze_match` test is skipped once `USEFULNESS_PORTED` (pat-a may
   delete it).
5. `print_witness_pat` (like upstream) runs inside diagnostics; outside them `def_path_str` with trimmed paths panics
   ("trimmed_def_paths called, diagnostics were expected but none were emitted"), so the test driver wraps its calls in
   `with_no_trimmed_paths`. In check_match it is called while building E0004, as upstream.

## unported(...) left
None in rustc.ts / rustc/print.ts. (Reached transitively: `rustc_middle::mir::Const::from_bits`, note 1.)

## PORT decisions (in code)
- rustc.ts header: conventions of pat-b's lib.ts/rustc.ts headers kept; `fmt::Arguments` given to `bug` / `delayed_bug`
  is the formatted string; `{:?}` / `{}` in messages use the ported `Debug` / `Display` fns with `PLAIN`.
- `mod print;` is a namespace import (`print.FieldPat`, `print.write_struct_like`, ..).
- `write_variant_name` (associated fn) never reads `this`, so `RustcPatCtxt.prototype` serves as the static side.
- `numeric_max_val` cast to `mir::Const` (note 1).
- `reveal_opaque_key` reaches rustc_type_ir binder.ts (`EarlyBinder::instantiate`) through a lazy `require` (init order,
  as rustc_middle ty/mod.ts); `ValTree::to_leaf` is `ValTreeKind.to_leaf(valtree.kind())` (deref, as thir.ts).
- Shadowed Rust locals get `_` suffixes (`ty_`, `ty__`, `lo_`, `hi_`, `value_`, `kind_`, `start_or_comma_`).
- `lower_pat`: `PatKind::Binding { subpattern: Some(_) } | Guard` and `Binding { subpattern: None }` share the
  `"Binding"` case (same arm order and results).
- print.ts: every caller writes into a `String`, whose `fmt::Write` never fails: `write!(..)?` appends to `f.value`, the
  fns return `PRINT_OK`.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (19152; vendor 4196).
- Coverage: rustc.rs 38/38, rustc/print.rs 4/4 (crate: lib 14/14, constructor 34/34, pat 31/31, diagnostics 1/1;
  pat-a's usefulness 0/56, pat_column 0/6, lints 0/2, checks 0/2 still stubs).
- `bun test src/rustc_pattern_analysis`: 14 pass, 8 skip (upstream crate tests, until pat-a), 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=pat-c`, at `02c8abb7`): 5792 pass, 9 skip (8 of them the upstream crate tests, until pat-a), 0 fail, 402 files (1283 s). A first run found one failure, std/result.test.ts's rule against the one-argument `unwrap_result` (rustc.ts `print_unwrap`), fixed in `02c8abb7`.

## Samples (`RUST_TS_AGENT=root-ad4b`, vs root's base runs)
| suite | lane run | M / D / U / C | base |
|---|---|---|---|
| tydump-minicore | `20261022-130533-root-ad4b-9xlf` | 45 / 0 / 1 / 0, case by case identical | `20261022-101651-root-ad4b-9r7y`: 45 / 0 / 1 / 0 |
| hir-tree `--sample 200` | `20261022-130555-root-ad4b-qecn` | 200 / 0 / 0 / 0 | 0 DIFF |

No suite change expected: nothing calls the crate until mb-check-match is merged, and its bodies then stop in pat-a's
usefulness until pat-a lands.
