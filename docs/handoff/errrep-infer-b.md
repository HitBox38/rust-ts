# Handoff: errrep-infer-b (M3 wave 19, error reporting; row 10 of docs/handoff/errctxt-contract.md)

Branch `lane/errrep-infer-b` (from integ `52b5e37d`, no merges). The lane was resumed after an API limit; the first agent's
work (55b1ad00 and the uncommitted suggest.ts) was kept and reviewed.

Commits: `55b1ad00` diagnostics.rs manual impls + diagnostics/note_and_explain.rs → `e16754b4` infer/suggest.rs →
`8b48a2a5` infer/note_and_explain.rs → (this commit) suggest.ts review nit + this handoff.

## Files touched
- `src/rustc_trait_selection/diagnostics.ts` (the manual impls; stubs filled in place)
- `src/rustc_trait_selection/diagnostics/note_and_explain.ts`
- `src/rustc_trait_selection/error_reporting/infer/suggest.ts`
- `src/rustc_trait_selection/error_reporting/infer/note_and_explain.ts`
- outside the lane (for review): `traits/specialize/mod.ts` (its `NegativePositiveConflict` stand-in removed; it now reads
  `diagnostics.ts`'s `NegativePositiveConflict_diagnostic` lazily, as errctxt-contract "For root" 5 planned) and
  `traits/coherence_specialize.test.ts` (re-pinned: negpos.rs (E0751) no longer stops and must equal the oracle's stderr,
  as overlap.rs does; `PENDING_COHERENCE` is empty. Stricter than before, nothing weakened).

## Coverage (`bun scripts/coverage.ts --missing`)
- diagnostics.rs 16/16, diagnostics/note_and_explain.rs 5/5, error_reporting/infer/suggest.rs 19/19,
  error_reporting/infer/note_and_explain.rs 9/9.
- rustc_trait_selection 646/976 (was 597 at base); TOTAL 15953/25518.

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (16472; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_trait_selection`: 66 pass, 0 fail (errctxt_contract.test.ts 7/7 pass;
  coherence_specialize.test.ts 4/4 pass).
- Independent read-only reviews: suggest.ts, the diagnostics manual impls and note_and_explain.ts against upstream. The one
  finding fixed: suggest.ts's local `display_PolyFnSig` now uses `IrPrint_print_debug` for `print_debug`. The other findings
  were low-severity notes; the only one that needs action is the `ObligationCauseAsDiagArg` stand-in listed below.

## Samples (lane vs base; base = integ worktree at 52b5e37d, `RUST_TS_AGENT=errrep-infer-b-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-083000-errrep-infer-b-kven` | 21 / 0 / 25 | `20261021-082718-errrep-infer-b-base-c2en` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-083007-errrep-infer-b-34f7` | 21 / 0 / 25 | `20261021-082727-errrep-infer-b-base-0472` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-083013-errrep-infer-b-q2o3` | 289 / 0 / 11 | `20261021-082746-errrep-infer-b-base-u38h` | 289 / 0 / 11 |

The per-case status and stop text are identical to base in all three suites: no new DIFF and no moved stop. None of the
minicore stops reach this lane's code; the stops are in lanes errrep-infer-a and typeck-*. The samples ran before the
one-line `print_debug` fix, which only affects a Debug path that Display formatting never uses.

## `unported(...)` left
- `diagnostics.ts` `ObligationCauseAsDiagArg_into_diag_arg`: a local stand-in marked `PORT(decls): pending root` for
  `impl IntoDiagArg for ObligationCauseAsDiagArg` (error_reporting/infer/mod.rs:2692, lane **errrep-infer-a**). At merge,
  replace it with that lane's function.
- None in suggest.ts, note_and_explain.ts or diagnostics/note_and_explain.ts.

## `// PORT:` decisions
- suggest.ts: fn-local `collect_blocks` / `IfVisitor` stay local to their method; `T: Relate` args are `relate_*`
  descriptors; `FxIndexSet<Symbol>` → insertion-ordered `Set`; local `TraitBoundModifiers_eq` (derive(PartialEq); no
  generated `_eq`; same helper as rustc_resolve late/diagnostics.ts).
- note_and_explain.ts: `msg: impl Fn() -> String` → `() => string`; the big `match (expected.kind(), found.kind())` is a
  labeled block of ifs in arm order (a failed guard falls through, a matched arm `break`s); `debug!` kept as comments; the
  same local `TraitBoundModifiers_eq` and `DefId_opt_eq` helpers; `find_attr!(tcx, def_id, ..)` →
  `find_attr(HasAttrs_DefId.get_attrs(..), ..)`; the `Option<Span>` passed to `span_labels` becomes a 0/1-element array.
- diagnostics.ts: `SourceKindSubdiag` / `ActualImplExplNotes` constructors are on companions (PORTING §8); `str::trim_start`
  → `trimStart()` (equal on type names).

## For root
1. **decls.ts bug**: `src/rustc_trait_selection/decls.ts` does not import rustc_span's `Symbol`, so `Symbol` in
   `point_at_methods_that_satisfy_associated_type(.., current_method_ident: Symbol | undefined, ..)` (:645) and
   `get_closure_name(..): Symbol | undefined` (:861) is the **global JS `Symbol`**. Fix: add
   `import type { Symbol } from "../rustc_span/symbol.ts";` (decls.ts uses no global `Symbol.*`). Until then
   note_and_explain.ts casts at the call and at the assignment (`DeclSymbol`, marked `PORT(decls): pending root`). Remove
   those casts after the fix. The lane that ports `get_closure_name` will hit the same problem.
2. At the merge with errrep-infer-a: repoint `ObligationCauseAsDiagArg_into_diag_arg` (above).
3. Review the out-of-lane edits listed under "Files touched" (specialize/mod.ts stand-in removal, coherence test re-pin).
