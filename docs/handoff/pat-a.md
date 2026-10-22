# Handoff: pat-a (M4 wave 22, rustc_pattern_analysis 2/3): usefulness, pat_column, lints, checks

Branch `lane/pat-a` (from `bcff46df` = lane/pat-b, no merges). Commits: `75c534b7` (the port + unguarded crate tests),
then this handoff.

## Result
- **Filled all 66 pat-a stubs** of pat-b's split table, in place, signatures unchanged:
  - `usefulness.ts` 56/56 (`BranchPatUsefulness`, `UsefulnessCtxt`, `PlaceCtxt` + Debug, `PlaceValidity` + Display,
    `PlaceInfo` (`specialize`, `split_column_ctors`), `PatStack` + Debug, `MatrixRow` + Debug, `Matrix` + Debug,
    `WitnessStack`, `WitnessMatrix`, `collect_overlapping_range_endpoints`, `collect_non_contiguous_range_endpoints`,
    `compute_exhaustiveness_and_usefulness`, `compute_match_usefulness`). The module doc (usefulness.rs:1-709) is
    copied verbatim at the top of the file.
  - `pat_column.ts` 6/6 (`PatternColumn`), `lints.ts` 2/2 (`collect_nonexhaustive_missing_variants`,
    `lint_nonexhaustive_missing_variants`), `checks.ts` 2/2 (`detect_mixed_deref_pat_ctors{,_inner}`).
- **Skip guard removed**: `USEFULNESS_PORTED` (tests/common/mod.ts) and every `test.skipIf(SKIP)` in
  tests/exhaustiveness.test.ts, tests/intersection.test.ts, tests/complexity.test.ts are gone; the 8 upstream tests run
  unconditionally and pass.
- `contract.test.ts` counts lowered: markers 89 -> 155, stubs 99 -> 33, per lane `{ "pat-c": 33 }`.
  **Merge note for root:** pat-c edits the same three lines (its counts on the same base are markers 122, stubs 66,
  `{ "pat-a": 66 }`). After both lanes the values are markers 188, stubs 0, and the per-lane line becomes `{}`.

## Coverage (`bun scripts/coverage.ts --missing`)
usefulness.rs 56/56, pat_column.rs 6/6, lints.rs 2/2, checks.rs 2/2. `--check`: markers ok (19185; vendor 4196).

## unported(...) left
None in pat-a's files. The remaining crate stubs are pat-c's 33 (rustc.rs, rustc/print.rs). lints.ts calls two of them
at runtime: `RustcPatCtxt::is_foreign_non_exhaustive_enum` and (through `Uncovered_new`) `print_witness_pat`.

## PORT decisions (in code)
- usefulness.ts header: `impl Iterator` results are arrays; values consumed by `self` (`WitnessStack::apply_constructor(mut
  self, ..)`, `single_pattern(self)`) are mutated in place; `tracing` (`debug!`, `#[instrument]`) is not ported, the
  `Debug` impls it would use are.
- `Ty::clone()` is the identity (pat-b convention 2), at `PlaceCtxt::wild_from_ctor`, `PlaceInfo::clone`,
  `WitnessStack::apply_constructor`.
- `PatStack::clone` copies the array only (`PatOrWild` is `Copy`, never written in place).
- `BranchPatUsefulness.covered_by` keys on the object (pat-b convention 6); `is_redundant` sorts by `uid` as upstream.
- `Matrix` Debug: column widths are `utf8_len` (upstream `String::len`, bytes), padding (`{:1$}`) counts `char`s, so
  the `✓` validity cell pads as in Rust. The `{pat:?}` inside `write!` use a fresh `PLAIN` Fmt.
- checks.ts / pat_column.ts / lints.ts: `head_ty()` returns `Cx::Ty | undefined`; `undefined` means "no patterns" (every
  implementor's `Ty` is an object).
- lints.ts imports `RevealedTy` as a value from rustc.ts (which imports lints.ts): ESM cycle, only read at call time.
- `Matrix::rows()` is `rows_()` (pat-b convention 8, already declared).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_pattern_analysis`: 18 pass, 0 skip, 0 fail (10 contract + 8 upstream crate tests).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (`RUST_TS_AGENT=pat-a`): 5796 pass, 1 skip, 0 fail, 5797 tests
  across 401 files (2211 s). pat-b's run had 9 skips; the 8 crate tests now run, the 1 remaining skip is not this crate's.

## Samples (`RUST_TS_AGENT=root-ad4b`, vs root's base runs)
| suite | lane run | M / D / U / C | base |
|---|---|---|---|
| tydump-minicore | `20261022-124741-root-ad4b-cu3a` | 45 / 0 / 1 / 0 | `20261022-101651-root-ad4b-9r7y`: 45 / 0 / 1 / 0, identical case by case (id, status, unported path) |
| hir-tree `--sample 200` | `20261022-124800-root-ad4b-d60x` | 200 / 0 / 0 / 0 | 0 DIFF |

No change expected: nothing in the compiler pipeline reaches the crate until mb-check-match and pat-c land.

## Shared files edited
None outside `src/rustc_pattern_analysis/` (the assigned four files, plus the contract test counts and the crate tests'
skip guard, as the assignment asked).
