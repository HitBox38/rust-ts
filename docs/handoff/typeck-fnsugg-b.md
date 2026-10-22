# Handoff: typeck-fnsugg-b (M3 wave 19, error reporting)

Branch `lane/typeck-fnsugg-b` (from integ `52b5e37d`, no merges). Commits: `e9cbe126` (port + oracle test; the first agent,
cut off by a usage limit before the handoff) and this handoff (resumed agent: coverage check, fidelity review, checks,
samples). No code changed on resume.

## Assignment
Row 16 of the split table in `docs/handoff/errctxt-contract.md`: `compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2026..3956`
plus the 10 manual impls in rustc_hir_typeck `diagnostics.rs`.

## Files touched
- `src/rustc_hir_typeck/fn_ctxt/suggestions.ts`: 18 `FnCtxt` methods from `is_loop` (:2027) to `suggest_swapping_lhs_and_rhs`
  (:3925) in upstream order (`is_field_suggestable` :2297 was already ported by typeck-gaps). Names removed from the
  `unported_methods` list; the list now holds only lane typeck-fnsugg-a's 31 names (suggestions.rs:51..1947). The lane's
  imports sit in a block marked `// ---- lane typeck-fnsugg-b ... ----` to make the merge with typeck-fnsugg-a easier
  (both lanes edit the same `unported_methods` line: keep the intersection).
- `src/rustc_hir_typeck/diagnostics.ts`: the 9 remaining stubs filled in place (`SuggestAnnotations`, `TypeMismatchFruTypo`,
  `RemoveSemiForCoerce`, `CastUnknownPointerSub` `add_to_diag`; `BreakNonLoop`, `NakedFunctionsAsmBlock` `into_diag`;
  `HelpUseLatestEdition::new`, `maybe_emit_plus_equals_diagnostic`, `ExprParenthesesNeeded::surrounding`); the
  `ReturnLikeStatementKind` `into_diag_arg` (:99) was already ported.
- `src/rustc_hir_typeck/fnsugg_b.oracle.test.ts` (new): the tydump probe compared with the subject on 4 cases (E0571
  `break_value`, E0641 `cast_ptr`, E0787 `naked`, the never-type fallback lint `fallback`), plus 1 PENDING case (`plus_eq`) pinned
  to its current stop `FnCtxt::suggest_fn_call` (lane typeck-fnsugg-a).

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs`: 19/51. All 32 missing fns are at
  :51..:1947 (lane typeck-fnsugg-a); nothing missing in :2026..3956.
- `bun scripts/coverage.ts --missing compiler/rustc_hir_typeck/src/diagnostics.rs`: 10/10.
- rustc_hir_typeck 864/1041 (83.0%); TOTAL 15930/25518.

## Review (resumed agent)
Three independent read-only passes compared the code with upstream: suggestions.rs :2026..2623, :2624..3422, and :3423..3956
plus diagnostics.rs. They checked arm order, conditions, message and suggestion text (including the multi-line fluent
string of `TypeMismatchFruTypo`), applicabilities, spans, Option handling (`deref_steps_for_suggestion`, `bit_width`: no
truthiness tests) and the helpers called. **No findings.**

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok (16449; vendor 3888).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_hir_typeck --timeout=120000`: 126 pass, 0 fail (14 files, including
  fnsugg_b.oracle.test.ts).
- suggestions.ts and diagnostics.ts each load as a fresh entry point.

## Samples (lane vs base; base = integ `52b5e37d`, `RUST_TS_AGENT=typeck-fnsugg-b-base`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-081530-typeck-fnsugg-b-sfqd` | 21 / 0 / 25 | `20261021-081528-typeck-fnsugg-b-base-hs9p` | 21 / 0 / 25 |
| thirdump-minicore (46) | `20261021-081622-typeck-fnsugg-b-7y2n` | 21 / 0 / 25 | `20261021-081620-typeck-fnsugg-b-base-2feu` | 21 / 0 / 25 |
| tydump-nocore `--sample 300 --seed m17` | `20261021-081656-typeck-fnsugg-b-ypni` | 289 / 0 / 11 | `20261021-081656-typeck-fnsugg-b-base-ne2y` | 289 / 0 / 11 |

No new DIFF. Every case has the same status and the same UNPORTED stop as the base. The new methods are reached only from
error paths that stop earlier today (`TypeErrCtxt::note_type_err`, demand.rs, `suggest_fn_call`, ...).

## `unported(...)` left
- None added. The `unported_methods` list in suggestions.ts keeps only typeck-fnsugg-a's names.
- Placeholders that the ported code calls (other lanes): `FnCtxt::maybe_get_block_expr` (demand.rs, lane typeck-demand-adjust;
  called from `suggest_deref_or_ref`, suggestions.rs:3376) and `TypeErrCtxt::suggest_derive` (traits/suggestions.rs:5171,
  lane errrep-sugg-c; called from `note_type_is_not_clone`).

## `// PORT:` decisions
1. suggestions.ts `note_type_is_not_clone`: queries.gen.ts types the `associated_item` query value as `unknown`, so it is
   cast to `AssocItem` (callee.ts precedent).
2. suggestions.ts file-local helpers: `trim_end_matches(s, pat)` (`str::trim_end_matches(&str)`, which strips repeated
   occurrences) and `is_some_and` (`Option::is_some_and`).
3. diagnostics.ts `maybe_emit_plus_equals_diagnostic` reads `crate::op::contains_let_in_chain` through a lazy `require("./op.ts")`
   (overflow.ts `traits_mod()` precedent). A static import closes a load cycle (rustc_middle traits/mod.ts TDZ) when
   diagnostics.ts is the entry point.

## For root
1. Merge with typeck-fnsugg-a: both lanes edit suggestions.ts's single `unported_methods(...)` line and its imports. The
   result should keep only the names that neither lane ported (likely none, so the call and the `unported_methods` import go).
2. When typeck-fnsugg-a lands, the `plus_eq` PENDING case in fnsugg_b.oracle.test.ts should move on (to the
   `maybe_emit_plus_equals_diagnostic` output or a later stop). Re-pin it or promote it to a full oracle comparison.
3. Decision to record: PORT 3 (lazy `require` for a same-crate cycle in diagnostics.ts).
