# Handoff: mir-tail-30 (wave 30, M4 tail of the `mir` suite)

Branch `lane/mir-tail-30`, from main `b30bd34b`. Scope: the 11 non-UNPORTED failures of the `mir` suite in
gate-20261029-001428-root-june (3 CRASH, 2 DIFF, 6 TIMEOUT).

## Result per case (`bun scripts/difftest.ts --suite mir --filter <case>`, RUST_TS_AGENT=root-f5de)

| case | was | now | cause / fix |
|---|---|---|---|
| lifetimes/lifetime-param-in-fn-coercion.rs | CRASH | MATCH | Subtyper aliasing (below) |
| traits/next-solver/generalize/instantiate-canonical-occurs-check-failure.rs | CRASH | MATCH | Subtyper aliasing |
| implied-bounds/hrlt-implied-trait-bounds-roundtrip.rs | DIFF | MATCH | Subtyper aliasing |
| lint/unused/must_use-array.rs | CRASH | MATCH | `[S; usize::MAX]`: array length kept as `bigint` |
| const-generics/associated-const-bindings/param-in-ty.rs | DIFF | MATCH | `get_or_insert(emit_err(..))` is eager |
| consts/const-eval/infinite_loop.rs | TIMEOUT | MATCH | slow only; `require` per call removed (below) |
| consts/const-eval/issue-52475.rs | TIMEOUT | MATCH | same |
| type-alias-impl-trait/error-tainting-issue-122904.rs | TIMEOUT | TIMEOUT | faithful, too slow (below) |
| type-alias-impl-trait/recursive-drop-elaboration.rs | TIMEOUT | TIMEOUT | same |
| type-alias-impl-trait/recursive-drop-elaboration-2.rs | TIMEOUT | TIMEOUT | same |
| closures/supertrait-hint-cycle.rs | TIMEOUT | TIMEOUT | the **oracle itself** needs 63 s user |

### 1. Subtyper shared one `Place` twice (3 cases)
`add_subtyping_projections.ts` put the same `new_place` object in the new assignment `temp = rvalue` and in the
`Move(temp)` operand of the `Subtype` cast (Rust copies `Place`). SimplifyLocals' `LocalUpdater` then renamed that
object twice (`_5 -> _4 -> _3`), which gave wrong MIR (hrlt), a validator ICE (instantiate-canonical: lhs type
mismatch), or `unwrap()` on a removed local (simplify.ts `visit_local`). Fix: `clone_Place(new_place)` for the
operand. Regression: a fn-pointer subtyping fixture (`subtype`) appended to `alias_check_oracle/ubchecks.rs`. With
the fix reverted, `alias_check.test.ts` reports 4 `ALIAS ... Subtyper.after subtype Place` lines; with the fix it passes.

### 2. must_use on `[S; usize::MAX]`
`MustUsePath::Array`'s `u64` went through `u64_to_number`, which ICEs above 2^53. Now `_1: bigint`, and
`plural_len` is a `bigint` usize with a real `saturating_add` (at `USIZE_MAX = 2^64-1`).

### 3. `check_assoc_const_binding_type` emitted only the first error
`guar.get_or_insert(cx.dcx().emit_err(..))` evaluates (emits) its argument every iteration; the port's `guar ??=`
skipped the rest. Now we emit first, then `guar ??= e`, in both loops. I grepped for the same pattern:
`coherence/orphan.ts` is already right, and the two `??=` in bounds.ts:718/725 mirror `get_or_insert_with`, which is lazy, so they are correct.

### 4. CTFE timeouts: lazy `require()` on every call
Both const-eval tests hit `LINT_TERMINATOR_LIMIT` (2M `ConstEvalCounter` steps). Our counter and `CtfeLimit` are
right (with `-Ztiny-const-eval-limit` both sides stop at once with identical output). A CPU profile of a
100k-iteration loop showed about 30% of the time in Bun's `require()`. The lazy-import helpers (`crate()`, `util()`,
`memory()`, ...) called it on every interpreter step. Each helper now caches its module in a `var` (hoisted, so an
import cycle that calls the function before the module body has run still works). 22 helpers across 11 files in
rustc_const_eval, rustc_mir_transform and rustc_mir_build. 100k iterations went from 12.95 s to 7.33 s user;
infinite_loop.rs takes 38 s user and issue-52475.rs 35 s user, output identical. Wall time is much higher while the machine is
loaded (load average was ~160 during this lane), so these two can still TIMEOUT if a gate runs under load.

Remaining CTFE hotspot (not changed): query-cache hits stringify the key on every lookup
(`DefaultCache.lookup` -> `intern_key(PseudoCanonicalInput<Ty>)`, about 17%), mostly `layout_of` from
`ImmTy::from_bool` / `ty_and_layout_field`. Upstream does the same query calls. The fix belongs in the query key hashing
(tools/codegen/queries.ts / rust_ts/intern_key.ts), which another lane owns.

The same `require()`-per-call pattern remains in rustc_middle/ty/instance.ts (4), rustc_trait_selection (9) and
rustc_hir_analysis/collect/resolve_bound_vars.ts (2). I left those alone: they are outside my lane and not hot in these cases.

### 5. Remaining TIMEOUTs: faithful but slow (no change)
- The three TAIT tests (`with_positive` recursing on its own closure) end in E0275 overflow in the next solver.
  With `#![recursion_limit = "N"]` prepended, our stderr equals the oracle's for N = 4, 6, 8, 10, 16, 24, 32, so there is no
  divergence. Cost grows superlinearly on both sides: oracle 0.06 s (N=8), 0.40 s (N=32), 4.9 s (default 128);
  ours 3.1 s, 13.3 s, and about 150 s projected, so about 30x slower. Profile at N=32: about 45% in interning
  (`key_of` 28%, `sorted_keys` 9%, `sharded.intern`/`intern_ref` 13%), from `intern_region` (impl_interner.ts:594),
  `slice_intern` in canonicalizer.ts `finalize` / `canonicalize_input` / `canonicalize_goal`, and `intern_ty`. The fix
  is faster intern keys (rust_ts/intern_key.ts, ty/context.ts, owned by another lane this wave), not a solver change.
- closures/supertrait-hint-cycle.rs: the oracle needs 63 s user on this machine, more than the subject's 60 s limit.
  It cannot MATCH under the current limit even with a perfect port. **Root:** treat it as out of reach (or as a
  harness-timeout question), not as a port bug.

## Files touched
- src/rustc_mir_transform/add_subtyping_projections.ts (clone_Place)
- src/rustc_mir_transform/alias_check_oracle/ubchecks.rs (fixture fn `subtype`)
- src/rustc_lint/unused/must_use.ts (bigint array length / plural_len)
- src/rustc_hir_analysis/hir_ty_lowering/bounds.ts (eager emit)
- require caches: src/rustc_const_eval/const_eval/{eval_queries,valtrees}.ts,
  src/rustc_const_eval/interpret/{eval_context,machine,memory,stack,step,util}.ts,
  src/rustc_mir_build/builder/mod.ts, src/rustc_mir_transform/{cross_crate_inline,inline/cycle}.ts

None of these are other wave-30 lanes' files. No generated files, harness, scripts, baselines or suites changed.

## Coverage
- `bun scripts/coverage.ts --check`: markers ok (22798; vendor 4483)
- add_subtyping_projections.rs 4/4, unused/must_use.rs 7/7, hir_ty_lowering/bounds.rs 20/20

## `unported(...)` left
None added.

## `// PORT:` decisions
- add_subtyping_projections.ts: the operand gets its own copy of the `Copy` `new_place`.
- must_use.ts: `plural_len` is a `bigint` usize; `usize::try_from(*len)` cannot fail (64-bit host); `pluralize!` gets
  `Number(plural_len)` (only `== 1` matters); `UnusedClosure`/`UnusedCoroutine` `count` is the generated `number`
  field. Above `i32` the diag arg is a string either way and is only plural-selected, so rounding never shows. `USIZE_MAX` const.
- bounds.ts: eager `emit_err` before `guar ??= e` (Rust `get_or_insert` argument semantics).
- 22 lazy-module helpers: `<name>_cache` `var`, with a one-line PORT comment each.

## Tests
- `bunx tsc --noEmit -p .` clean.
- `bun test src/rustc_const_eval src/rustc_mir_transform src/rustc_mir_build src/rustc_lint src/rustc_hir_analysis`:
  607 pass, 0 fail.

## Samples (RUST_TS_AGENT=root-f5de)
- before: mir `--sample 300`: MATCH 290, UNPORTED 8, UNSTABLE 2; mir-minicore 46/46.
- after: mir `--sample 300`: MATCH 290, UNPORTED 8, UNSTABLE 2 (per-case statuses identical to before; none of
  the 11 cases is in this sample); mir-minicore 46/46.
