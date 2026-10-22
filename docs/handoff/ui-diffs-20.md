# Handoff: ui-diffs-20 (wave 20: the trait-solver DIFFs found by tydump-ui / thirdump-ui)

Branch `lane/ui-diffs-20`, base `b4b2793b` (lane/harness-w20). One port fix, one regression test, this file.

## Files touched
- `src/rustc_trait_selection/error_reporting/traits/fulfillment_errors.ts` (3 lines). **This file belongs to
  error_reporting, which fixer merge-w19 also edits on integ-w19. Expect a trivial merge conflict.**
- `src/rustc_trait_selection/error_reporting/traits/fulfillment_errors.oracle.test.ts` (new): the regression test.
- `docs/handoff/ui-diffs-20.md`.

No new `unported(...)`, no new `// PORT:`. The existing `// PORT:` on `error_implies` now names `ParamEnv_eq`.
Coverage: `fulfillment_errors.rs` 54/54 ported. `coverage.ts --check` ok.

## Root cause: one bug behind DIFFs 1-5
`TypeErrCtxt::error_implies` (fulfillment_errors.rs:1595) and `trait_error_implies_projection_error` (:1638)
compared `Goal::param_env` with `===` / `!==`. In the port `ParamEnv` is a plain wrapper class. It is not
interned, so two equal param-envs built separately are different objects. Upstream's derived `PartialEq` compares
the interned `caller_bounds` list, which is `ParamEnv_eq` in the port. A goal_eq helper doing this already existed
in the same file.

Effect: in `report_fulfillment_errors` (traits/mod.rs), errors with equal goals were not treated as implying each
other, so no duplicate was suppressed.
- Extra errors after the oracle's last one:
  - `normalizes-to-is-not-productive.rs`: E0277 `Foo: Bound`. Two elaborated param-env clauses normalize the
    same alias in `do_normalize_clauses`, and both errors have the leaf `Foo: Bound`.
  - `implied_outlives_bounds_not_resolving_vars_ice.rs`: E0271.
  - `dyn-iterator-deref-in-for-loop.rs#next`: E0277 `Sized`.
- Wrong error reported: `foreach-partial-eq-next-solver.rs` (`PartialEq` instead of `PartialOrd`) and
  `next-solver/fn-trait.rs` (`FnOnce` instead of `Fn`). The oracle suppressed the error that the port printed
  first.

Fix: `goal_eq(cond, error)` for the `cond == error` check, and `ParamEnv_eq` for the two param-env checks.
I grepped `src` for other `param_env ===/!==` comparisons and found none. The `Map`/`Set`s keyed by `ParamEnv` or
`Goal` are already `KeyedMap`/`KeyedSet` on `intern_key`.

Regression test: `fulfillment_errors.oracle.test.ts` runs the five ui files against the oracle's std with
`-Zdeduplicate-diagnostics=no`, comparing the tydump probe with `src/rust_ts/tydump.ts` (stdout, stderr, exit
code). All 5 fail without the fix and pass with it. Without `-Zdeduplicate-diagnostics=no` the emitter hides the
exact duplicates of n.rs and i.rs, so the flag is required.

## The ICE cases: both sides hit the same ICE (no port bug)
The harness-w20 list says cases 6-8 crash the oracle but not the port. That is wrong. In all five cases below, the
port hits the same assert or `bug!`, at the same point, after the same earlier diagnostics. Only the crash report
differs:
- rustc prints `error: internal compiler error: /rustc-dev/<commit>/..:L:C: msg` (for `bug!`) or
  `thread 'rustc' (<tid>) panicked at ..`, then a backtrace (compiletest's `RUST_BACKTRACE`), the notes and the
  query stack.
- The port prints `error: aborting due to N previous errors` first, then `rust-ts: internal compiler error: ..`.

| case | ICE (both sides) |
|---|---|
| `next-solver/normalize/success-results-in-unconstrained-infer.rs#old` | `assert!(!ty.has_non_region_infer())`, outlives_bounds.rs:49 (port: outlives_bounds.ts:70) |
| `next-solver/overflow/incorrect-old-solver-caching-ice-148095.rs#old` | `assert!(self.query_mode == TraitQueryMode::Canonical)`, select/mod.rs:235 |
| `projection-cache-rematch-impl-141124.rs#old` | `bug!` select/mod.rs:2381 "impl .. was matchable ..". The E0275 before it matches the oracle |
| `next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#old` | `bug!` select/mod.rs:2381 |
| `projection-cache-rematch-impl-122529.rs#old` | `bug!` select/mod.rs:2381 |

Root decision: all five are `known-bug` / `failure-status: 101` / `dont-check-compiler-stderr` revisions. They can
become documented permanent exclusions, or the driver's ICE output could be made to match up to the report header.
I left them as they are.

## The TIMEOUT: `projection-cache-rematch-impl-141124.rs#next` is pure slowness
- Correctness: the subject's output is byte-identical to the oracle (6 E0275 overflow errors and the dump). The
  first run took 31.5 s wall / 35 s user on a quiet machine. Under the current load (load average ~45 on 12
  cores, several lanes running), the same run took 2m20 wall / 53 s user, beyond the suite's 60 s limit.
- The oracle itself needs 1.44 s, in release Rust.
- Scaling with `#![recursion_limit = N]` (user seconds, oracle | subject, the subject includes ~1.5 s startup).
  Every N gives byte-identical output. The ratio stays flat (oracle grows ~4x per doubling, subject ~3x), so the
  port does proportional work, not an algorithmic divergence:

  | N | oracle | subject |
  |---|---|---|
  | 8 | 0.02 | 2.2 |
  | 16 | 0.04 | 3.5 |
  | 32 | 0.09 | 6.5 |
  | 64 | 0.36 | 17.2 |
  | 128 (default) | 1.44 | ~35 |
- Hot spots (bun `--cpu-prof`, 20 ms sampling, `RUST_TS_JS_STACK=1` so the stack re-exec doesn't drop the profile):
  - `rust_ts/intern_key.ts` structural keys: ~48% total. Most of it is `push_key`'s `Object.keys(v).sort()` (~8%
    self in `sort`) and `JSON.stringify`. Callers: `reuse_or_mk_predicate`, `intern_predicate`, `slice_intern`,
    `intern_canonical_input`, `mk_external_constraints`, `TyKind_eq`, `AmbiguityKind_eq`.
  - Lazy `require(..)` on hot fold paths (init-order adapters such as `ty/list.ts:278`, called from `fold_with` /
    `fold_PredicateKind` / `super_fold_with`): ~13% total. Bun's `require` costs a resolution on every call.
  - search_graph `NestedGoals.insert` / `extend_from_child` (mod.ts:681/704/705): ~5%. `cycle_step_kinds`
    (`map`/`slice`): ~2%.
  - `fold_with_Vec` (`map`): ~15% total.
- None of these files are mine (rust_ts, rustc_middle, rustc_type_ir). For root: memoizing the module in the lazy
  adapters, and a cheaper key for interned values (e.g. no per-object key sort for codegen'd shapes), would be
  the big wins. Raising the suite timeout is a harness decision.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection`: 99 pass, 2 fail. The 2 failures are
  `error_reporting/traits/suggestions_b.test.ts` (`auto_trait.rs`, `where_clause.rs`: "ours stops as PENDING",
  the expected `unported` no longer happens). They fail the same way on base `b4b2793b`, so they predate this lane:
  stale PENDING expectations, for the owner of suggestions_b (errrep-sugg-b / merge-w19).
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src tools --timeout=120000`: 5347 pass, 1 skip, 12 fail. Base `b4b2793b`: 5342 pass,
  1 skip, 12 fail, with **the identical 12 failures** (the 5 extra passes are the new regression tests). Every failure is
  older than this lane. Almost all are stale "stops UNPORTED / PENDING" expectations for paths that wave 19 ported:
  - infer_core `contract's placeholders`;
  - typeck-fnsugg-b `plus_eq`;
  - `one-argument unwrap_result`;
  - checks_test `stop_method` / `stop_single` / `stop_note`;
  - wfcheck_a `field_bound`, wfcheck_b `static_wf`;
  - compare_impl_item in-process `e0053_sig` / `e0326`;
  - suggestions_b `auto_trait` / `where_clause`.
  These need root or their owners.
- Reruns of every listed case (`difftest --filter`, both suites):
  - tydump-ui and thirdump-ui: foreach-partial-eq, fn-trait, dyn-iterator (both revisions), normalizes-to (3
    cases), implied_outlives: all MATCH.
  - The five ICE cases stay DIFF (same ICE, above). 141124#next stays TIMEOUT under load.
- Samples, lane vs base `b4b2793b`, same `RUST_TS_AGENT=ui-diffs-20` sample:

  | suite | base | lane |
  |---|---|---|
  | tydump-ui `--sample 400` | 226 MATCH / 1 DIFF / 172 UNPORTED / 1 TIMEOUT | 228 MATCH / 0 DIFF / 171 UNPORTED / 1 TIMEOUT |
  | tydump-minicore (46) | 41 / 0 / 5 | 41 / 0 / 5 |
  | tydump-nocore `--sample 300 --seed m17` | 290 / 0 / 10 | 290 / 0 / 10 |
  | hir-tree `--sample 300` | 298 / 0 / 2 | 298 / 0 / 2 |

  - tydump-ui changes: `normalizes-to-is-not-productive.rs` goes DIFF -> MATCH, and
    `consider_builtin_pointee_candidate-instantiate-result-fail.rs` goes UNPORTED -> MATCH (its duplicate error
    used to reach an unported path).
  - The TIMEOUT on both sides is 141124#next.
  - No new DIFF.
