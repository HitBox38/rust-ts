# Handoff: typeck-suggest-b (M3 wave 19, error reporting)

Branch `lane/typeck-suggest-b` (from integ `52b5e37d`, no merges). Resumed lane: the first agent was cut off before
committing; its uncommitted port was committed as-is (`054995cb`), then reviewed function by function against upstream
(no fidelity issues found; no code changes needed), then this handoff.

## Files touched
- `src/rustc_hir_typeck/method/suggest.ts` only.
  - Region `// ==== lane typeck-suggest-b: method/suggest.rs:2433..5035 ... ====` (after lane typeck-suggest-a's
    `unported_methods` list, to the end of the file): its own imports, local helpers (`fold_TraitRef`,
    `fold_TraitClause`, `d_PredicateKind` descriptors, `sort_by_cached_key`, `dedup_by`, `CandidateSource_eq`,
    `cmp_derive`), then every fn of 2433..5035 in upstream order.
  - Shared header (merge note for root): 3 import lines changed from type-only to value imports because the region
    calls them: `import { AssocItem } from ".../ty/assoc.ts"`, `import { Span } from ".../rustc_span/lib.ts"`,
    `import { TraitRef } from ".../rustc_type_ir/predicate.ts"` (was `import type { TraitRef }` from
    `rustc_type_ir/decls.ts`). Lane typeck-suggest-a will likely touch the same lines: a trivial conflict.
  - Lane typeck-suggest-a's `unported_methods` list: my 26 names removed (its 21 remain, untouched); the `all_traits`
    / `print_disambiguation_help` stubs replaced by the ports.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/method/suggest.rs`: 30/60; all 30 remaining are
  lines 64..2372 (lane typeck-suggest-a). My region: 31 markers (29 methods incl. nested `LetVisitor::visit_stmt`
  :3150 and `type_derefs_to_local::is_local` :4908, + `all_traits`, `print_disambiguation_help`).
- rustc_hir_typeck 868/1041; TOTAL 15934/25518 (base 15881).

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (16453; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_typeck`: 121 pass, 0 fail (13 files).

## Samples (lane vs base; base = integ `52b5e37d` worktree, `RUST_TS_AGENT=typeck-suggest-b-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081340-typeck-suggest-b-xij3` | 21 / 0 / 25 | `20261021-081340-typeck-suggest-b-base-uugd` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-081554-typeck-suggest-b-x4o1` | 21 / 0 / 25 | `20261021-081554-typeck-suggest-b-base-dfpj` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-081732-typeck-suggest-b-7yk5` | 289 / 0 / 11 | `20261021-081730-typeck-suggest-b-base-y32h` | 289 / 0 / 11 |

No new DIFF, statuses identical. Stops moved (minicore suites identical in both):
- `lang-items/issue-83471.rs`, `privacy/privacy4.rs`: `suggest_assoc_method_call` → `fn_ctxt::suggestions::FnCtxt::extract_callable_info`
  (lane typeck-fnsugg-a/-b).
- `privacy/privacy1.rs` (and tydump-nocore `proc-macro/auxiliary/expect-modules.rs`): `all_traits` →
  `method::suggest::FnCtxt::report_method_error` (lane typeck-suggest-a).

## `unported(...)` left
- None in my region. Runtime stops reachable from it are other lanes' placeholders (e.g. `extract_callable_info`,
  `TypeErrCtxt::note_different_trait_with_same_name`, lane typeck-suggest-a's methods).

## `// PORT:` decisions
1. `report_failed_method_call_on_numerical_infer_var`: decls.ts declares `long_ty_path: PathBuf | undefined` (by value)
   where upstream has `&mut Option<PathBuf>`; the port wraps it in a local `MutRef`. Equivalent: the caller's
   `ty_file` is only written on the `Err` path (after which the caller returns), and `create_missing_writer_err` reads
   it only after `Ok`. **For root**: the decl (and `create_missing_writer_err`'s) could become `MutRef<PathBuf | undefined>`
   per errctxt-contract decision 5; not changed (decls.ts is root-owned).
2. `TypeFoldable` descriptors for `TraitRef` / `TraitClause` and `TypeVisitable` for `PredicateKind` built locally from
   the derived `visit_with_*` / `fold_with_*` fns (no shared descriptor exists yet).
3. `slice::sort_by_key` → stable `sort_by_cached_key` (keys are pure strings); `Vec::dedup` → `dedup_by`.
4. Derived `PartialEq` of `CandidateSource` (`CandidateSource_eq`); derived tuple `Ord` of `(String, OrdSpan, Symbol)`
   (`cmp_derive`; `Symbol`'s derived `Ord` is its index). `TraitInfo`'s `PartialEq` is def_id equality.
5. `FxIndexSet<DefId>` → `DefIdSet` (insertion-ordered); `skippable.contains(&did)` on `[Option<DefId>; 5]` →
   `skippable_contains`.
6. `suggest_traits_to_import`: the three lazy `.filter(..)`s are one per-element predicate, in order (the third pushes to
   `arbitrary_rcvr`, so laziness/order matters and is preserved).

## For root
1. Merge: trivial header import conflict with typeck-suggest-a likely (see "Files touched").
2. Optional decls fix: `long_ty_path` of `report_failed_method_call_on_numerical_infer_var` / `create_missing_writer_err`
   as `MutRef` (PORT 1).
