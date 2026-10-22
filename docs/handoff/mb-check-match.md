# Handoff: mb-check-match (M4 wave 22): rustc_mir_build thir/pattern/check_match.rs

Branch `lane/mb-check-match` (from `7d76ddd0`, no merges). One commit.

## Result
- **check_match.rs: 34/34 fns ported** (`bun scripts/coverage.ts --missing compiler/rustc_mir_build/src/thir/pattern/check_match.rs`),
  in upstream order: the `check_match` query, `MatchVisitor` (the `Visitor` impl and `impl MatchVisitor`, all in the
  class body), and the free fns (borrow conflicts in `@` patterns, `bindings_with_variant_name`, never patterns,
  irrefutable-let lints, unreachable patterns + the const-typo search, reachability, `report_non_exhaustive_match`
  (E0004), witnesses, ADT/variant notes). `coverage --check`: markers ok.
- **Control flow**: upstream sends every fn/closure parameter (`check_binding_is_irrefutable`), every `let` (`check_let`
  -> `check_binding_is_irrefutable` / `is_let_irrefutable`), every `if let` / let chain / `match` through
  `lower_pattern` -> `RustcPatCtxt::lower_pat` and `analyze_match`: the irrefutability check *is* an exhaustiveness
  check, so there is no upstream path that skips pattern analysis for simple bindings. Bodies **without** patterns
  (no params, no `let`, no `match`; e.g. `fn main() { f(); }`) pass `check_match` completely (`Ok`); anything with a
  pattern stops at `rustc_pattern_analysis::rustc::RustcPatCtxt::lower_pat (pending pat-c)`, after the diagnostics
  `lower_pattern` emits before it (borrow conflicts, E0170).
- **No suite reaches `check_match` yet**: `mir_built` is reached only from `build_mir_inner_impl`, and the mirdump
  cases stop earlier (`check_unsafety provider (not ported)`, `mir_keys provider (not ported)`).

## rustc_pattern_analysis contract (pat-b had nothing committed)
Declared at the top of check_match.ts, each marked `// PORT(contract): pending pat-*`. When the crate lands, delete
the block and import the real items (`rustc_pattern_analysis::rustc::{..}` as upstream's `use`):
| item | lane | form here |
|---|---|---|
| `RevealedTy` | pat-c | interface `{ inner(): Ty }` (Deref/Display used via `.inner()`) |
| `IntRange` | pat-b | `unknown` (passed through only) |
| `Constructor` | pat-b | `$`-union of all 21 variants (`Variant._0: VariantIdx`, `IntRange._0`) |
| `IndexedPat`, `DeconstructedPat`, `WitnessPat` | pat-b | interfaces: `ctor() ty() data() iter_fields() walk()` / `ctor() ty() is_never_pattern() iter_fields()` |
| `MatchArm` | pat-b | interface `{ pat, has_guard, arm_data: HirId }` (copied with `{...arm}`) |
| `RedundancyExplanation`, `Usefulness`, `UsefulnessReport` | pat-a | interface / `$`-union / interface (upstream fields) |
| `RustcPatCtxtState` | pat-c | class, `default_()` |
| `RustcPatCtxt` | pat-c | class with upstream's fields in order (built by `new_cx`); methods `is_uninhabited`, `is_foreign_non_exhaustive_enum`, `is_range_beyond_boundaries`, `lower_pat`, `print_witness_pat` are `unported(..)` |
| `analyze_match` | pat-c | `unported(..)` |
| `Uncovered`, `Uncovered::new` | pat-b | `unknown` / `Uncovered_new` `unported(..)` |
| `PatternNotCovered` (+ `_diagnostic`) | tools/codegen | interface with upstream's fields / `unported(..)`: the codegen set still skips it until `Uncovered` exists (diagnostics.ts header) |

`unported(..)` left (all in that block): `RustcPatCtxt::{is_uninhabited, is_foreign_non_exhaustive_enum,
is_range_beyond_boundaries, lower_pat, print_witness_pat} (pending pat-c)`, `analyze_match (pending pat-c)`,
`Uncovered::new (pending pat-b)`, `PatternNotCovered (tools/codegen: skipped until rustc_pattern_analysis Uncovered)`.

## PORT decisions
- `MatchVisitor.thir` is `thir_` (Visitor::thir()); closures `|this| ..` take `(this_) => ..`.
- rustc_arena erased: arena fields hold `null`, `pattern_arena.alloc(x)` is `x`.
- `err = err.and(check_never_pattern(cx, pat))`: argument evaluated first, kept only while `err` is `Ok`.
- `sort_unstable_by_key(.. lo_hi())`: JS sort with a lexicographic `(lo, hi)` comparator (`cmp_lo_hi`).
- `FxIndexSet<RevealedTy>` (collect_special_tys): `Map<Ty, RevealedTy>` keyed on the interned `.inner()`, first
  insertion keeps its position (`insert_revealed`).
- `thir_body` / `typeck` / `hir_crate_items` values are cast (typed loosely by queries.gen.ts), as check_tail_calls.ts.

## Outside my files
- `src/rustc_mir_build/builder/contract.test.ts` (builder-contract's): one expectation updated, because it asserted the
  old `check_match` stub: `build_mir_inner_impl(f)` on `fn f(x: u8, y: bool)` now stops at
  `rustc_pattern_analysis::rustc::RustcPatCtxt::lower_pat (pending pat-c)` (the params' irrefutability check). Root:
  keep this when merging with the mb-* lanes that touch the same test.

## Tests
- New `src/rustc_mir_build/thir/pattern/check_match.oracle.test.ts` + subject runner `check_match_oracle/run.ts`
  (driver up to the global ctxt, then `tcx.check_match` per free fn). 9 cases vs the pinned rustc: pattern-free bodies
  are `Ok`; a param stops at `lower_pat`; E0499 / E0502 (both directions) / E0505 / E0382 (`@`-pattern borrow
  conflicts, in `match` and `let .. else`) and the E0170 lint are byte-identical diagnostic blocks, in order, in the
  oracle's stderr. E0004 / E0005 need `analyze_match` (pat-c); E0030 is thir/pattern/mod.rs (thir_body), not here.
- `bun test src/rustc_mir_build`: pass. Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: 5787 pass, 1 skip, 0 fail (398 files).
- `bunx tsc --noEmit -p .`: clean.

## Samples (`RUST_TS_AGENT=root-ad4b`, case by case vs root's base runs): no status changed
- tydump-minicore 45/46 MATCH, 0 DIFF (run 20261022-104229-root-ad4b-zaww vs 9r7y: 0 changed of 46)
- mirdump-minicore 10/46 MATCH, 0 DIFF (20261022-104303-root-ad4b-jgpk vs xljd: 0 changed of 46)
- tydump-ui --sample 300: 263 MATCH, 0 DIFF, 36 UNPORTED, 1 UNSTABLE (20261022-104356-root-ad4b-uvca vs hqwm: 0 changed of 300)
- hir-tree --sample 200: 200/200 MATCH (20261022-104821-root-ad4b-v511)
