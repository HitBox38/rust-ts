verdict: APPROVE-WITH-NOTES

Lane: transmute (wave 30), branch `lane/transmute` (one commit, 15809f5e), reviewed against `git diff main...lane/transmute`
and upstream `.data/rust/compiler/rustc_transmute` at the pin.

## What was checked

- Every ported fn in lib.ts, layout/mod.ts, layout/tree.ts, layout/dfa.ts, maybe_transmutable/{mod,query_context}.ts, read
  side by side with upstream. Checked: arm order of every `match` (including or-patterns with guards in `Tree::then` / `or`
  and `Answer::and` / `or`), short-circuit and laziness (`prune`'s `try_fold`, `from_tree`'s Alt `filter_map` + `fold`,
  `Quantifier::apply`, `discriminants` is a generator), the order of `State::new` calls, the `IndexMap` insert / overwrite
  semantics in `concat` / `union`, `Peekable` / `UnionIter` mutation through `peek_mut`, `from_tag` LE/BE byte slicing,
  the `answer_memo` clone-on-insert / clone-on-hit pattern, and the `Err` → `Reason` mapping order in `answer` (Ty).
- Diagnostic / panic texts: `There were no fields named ..`, the `delayed_bug` text with `LangItem::TransmuteOpts.name()`,
  `failed to correctly cache transmutability`, `there is no field in Variants::Empty types`, the `unimplemented!` text
  (with the `not implemented: ` prefix), and the assert texts. All match.
- Callers: `solve/delegate.rs:489 is_transmutable`, `confirmation.rs:284/358/366`, `fulfillment_errors.rs:3246-3256` and
  `:3297-3311`. Argument order (`type_at(1)` src, `type_at(0)` dst), the tcx used, and the early returns all match.
- `keys.rs:374` `(Ty, VariantIdx)` `default_span` marker is correct and sits in upstream order (before :380).
- Ran in a scratch worktree (now removed): `bunx tsc --noEmit -p .` clean; `coverage.ts --check` markers ok; `--missing`
  is 3/3, 13/13, 30/30, 26/26, 9/9 and 2/2, and the three tests files are 13/13, 11/11 and 31/31;
  `bun tools/codegen/queries.ts --check` is up to date (3 unported key impls); `bun test src/rustc_transmute` 48 pass;
  trait_selection (solve, select, error_reporting/traits), middle/query and codegen queries tests 63 pass.
- Samples (RUST_TS_AGENT=rev-transmute):
  - mir `--filter transmut`: 142 MATCH / 11 UNPORTED / 0 DIFF / 0 CRASH, the same as the handoff. All 68 protected mir
    cases in that filter MATCH. The 11 UNPORTED stop at the pre-existing stops the handoff lists (Relate for ty::Expr ×2,
    Size beyond 2^53 ×6, NumScalableVectors, EarlyBinder::skip_binder, IntoDiagArg).
  - tydump-ui and thirdump-ui `--filter transmut`: 5/5 each.
- Nothing under `harness/`, `scripts/` or `harness/baseline` changed.

## Findings

1. tools/codegen/queries.config.json:82, src/rustc_middle/query/keys.ts:767-780, src/rustc_middle/queries.gen.ts:4106.
   Severity: non-blocking (root sign-off).
   The lane edited files outside its crate, and PORTING §1 forbids porting lanes from touching `tools/`. The handoff calls
   this out and asks root to OK it. The change is one key-mapping entry, not a generator logic change: the generator is
   untouched, `--check` passes, and the regenerated diff is only `tag_for_variant`'s key plus its import. The new key
   follows the existing `pseudo_canonical_input_key` pattern. It looks correct, but root should approve it explicitly.

2. src/rustc_transmute/layout/tree.ts:527. Severity: non-blocking.
   The `tag_for_variant` query value is `unknown` in queries.gen.ts, so the call site casts it to
   `ScalarInt | undefined` (there is a PORT note). The provider (`rustc_const_eval/const_eval/mod.ts:107`) does return
   `ScalarInt | undefined`, so the cast is sound. Typing the query value in the codegen typemap would remove the cast
   (a follow-up for root).

3. src/rustc_transmute/layout/tree.ts:607. Severity: non-blocking.
   `niche_variants.contains(index)` is written inline as `start <= index && index <= last`. This is equivalent: a
   RangeInclusive from a layout is never exhausted, there is no shared `contains` helper, and rustc_const_eval uses the
   same inline form.

4. src/rustc_transmute/layout/tree.ts:711-744 and lib.ts:59-100. Severity: non-blocking.
   Some items are out of file order. `mod rustc`'s `Err` and its `From<&LayoutError>` come after the `impl Tree` rustc
   methods, not before them. `Assume::from_const` (lib.rs:133) is inside the `Assume` class, ahead of
   `TransmuteTypeEnv` (lib.rs:116/120). Both placements are allowed by PORTING §8, the markers carry the correct
   upstream lines, and tree.ts's module comment explains the reordering.

5. src/rustc_transmute/{layout/tree,layout/dfa,maybe_transmutable}/tests.test.ts (import of `../rustc_middle/lib.ts`).
   Severity: non-blocking.
   The tests have to import rustc_middle first to avoid an existing init-order TDZ (`BoundRegionKind` in
   rustc_type_ir/binder.ts). The driver is not affected, but the TDZ is a latent hazard for any future module that loads
   rustc_transmute or rustc_type_ir before rustc_middle. Root should consider queueing a fix in the owning crate.

6. src/rustc_trait_selection/error_reporting/traits/fulfillment_errors_b.oracle.test.ts:9. Severity: non-blocking.
   The comment there still says the safe-transmute reasons "stop at `rustc_transmute`", which is no longer true. The
   handoff already flags it; the file is outside the lane, so root should fix it.

7. src/rustc_transmute/maybe_transmutable/tests.test.ts (`nonzero::should_permit_identity_transmutation`).
   Severity: non-blocking.
   The test has a 60s timeout because width 16 builds a 65,535-state DFA. `Tree::nonzero` is dead code in rustc, so
   this does not affect compilation, but it does add a few seconds to every gate unit-test run.

No blocking findings. I found no invented behaviour and no guessed values, and the crate has no `unported(..)` left. The
derived `PartialEq` / `Clone` / `Debug` helpers are hand-written but faithful, and `Answer_eq`, `Tree_eq` and `Dfa_eq`
(order-insensitive, like `IndexMap`) are only used in tests or in the `== Tree::uninhabited()` check.
