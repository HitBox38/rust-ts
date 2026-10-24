# Handoff: mt-coroutine-b (M4 wave 23): coroutine layout + drop

Branch `lane/mt-coroutine-b` (base `f5de3f15`, no merges). Commits: the port + repoints + tests → this handoff.

## Files touched
- `src/rustc_mir_transform/coroutine/layout.ts`: **stub replaced** by the whole port of coroutine/layout.rs
  (`LivenessInfo`, `locals_live_across_suspend_points`, `CoroutineSavedLocals` (+ `Deref`), `compute_storage_conflicts`,
  `StorageConflictVisitor`, `compute_layout`, `mir_coroutine_witnesses`, `check_field_tys_sized`, `check_suspend_tys`,
  `SuspendCheckData`, `check_must_not_suspend_ty`, `check_must_not_suspend_def`). `coroutine/mod.ts`'s re-export and
  lib.ts's `q.mir_coroutine_witnesses` provider are unchanged and now reach the port.
- `src/rustc_mir_transform/coroutine/drop.ts` (new): the whole port of coroutine/drop.rs (`FixReturnPendingVisitor`,
  `has_async_drops`, `elaborate_coroutine_drops`, `insert_clean_drop`, `create_coroutine_drop_shim`,
  `create_coroutine_drop_shim_async`, `create_coroutine_drop_shim_proxy_async`). Nothing imports it yet: `mod drop;` and
  `use drop::{..}` are coroutine/mod.rs, lane mt-coroutine-a.
- `src/rustc_mir_transform/pass_manager.test.ts`: stub count 57 → 56 (as the mt-skeleton contract asks).
- Tests (new): `coroutine/layout.test.ts`, `coroutine/layout.oracle.test.ts`, test driver `coroutine/layout_oracle/run.ts`.

## Repoints (shared files, review)
Every `CoroutineLayout` view / `mir_coroutine_witnesses` stand-in now uses the real `mir::CoroutineLayout`
(rustc_middle mir/query.gen.ts; the query's value type in queries.gen.ts already was `CoroutineLayout | undefined`):
1. `rustc_trait_selection/error_reporting/traits/suggestions.ts`: errrep-sugg-b's `CoroutineLayoutView` interface and
   the cast at `maybe_note_obligation_cause_for_async_await` removed.
2. `rustc_trait_selection/traits/query/dropck_outlives.ts`: view `CoroutineLayout_` and cast removed (header updated).
3. `rustc_ty_utils/needs_drop.ts`: view `CoroutineLayout_` and cast removed (header updated).
4. `rustc_traits/coroutine_witnesses.ts`: view `CoroutineLayoutFieldTys` and cast removed (header updated).
5. `rustc_ty_utils/layout.ts`: ty-utils-layout's three views `CoroutineLayout_field_tys` / `_variant_fields` /
   `_storage_conflicts` (which stopped UNPORTED) and the local `CoroutineSavedTy` / `CoroutineSavedLocal` /
   `BitMatrix` import removed; `layout_of_uncached`'s coroutine arm and `variant_info_for_coroutine` read the fields.
6. `rustc_hir_analysis/check/check.ts` (`find_and_apply_rpit_args`' opaque-cycle labels): the `unported(CoroutineLayout)`
   stand-in replaced by upstream's loop `for interior_ty in &coroutine_layout.field_tys { label_match(..) }`.
7. `rustc_middle/ty/mod.ts`: the stand-in `Body_coroutine_layout_raw` (stopped UNPORTED) removed; the three
   `*_coroutine_layout` fns call the real `Body::coroutine_layout_raw` (mir/mod.ts). `coroutine_layout`'s empty proxy
   layout for `async_drop_in_place::{closure}` is now built as upstream (was `unported`); mir/mod.ts and ty/sty.ts are
   reached through a lazy `coroutine_layout_mods()` (init order), `BitMatrix` / two type imports added.
   (`rustc_middle/ty/sty.ts`'s `CoroutineLayout_variant_fields` / `_field_ty` helpers already read the real type: left.)

## Coverage
- coroutine/layout.rs 15/15, coroutine/drop.rs 8/8 (`bun scripts/coverage.ts --missing`).
- rustc_mir_transform 258/1101; TOTAL 19601/25518. `bun scripts/coverage.ts --check`: markers ok (20172; vendor 4330).

## Tests
- `coroutine/layout.test.ts` (2): `CoroutineSavedLocals` (`iter_enumerated`, `get`, `renumber_bitset` and its assert
  text `[_2, _3, _6] not a superset of [_1, _3]`); `has_async_drops` on hand-built bodies (yield behind a `drop` edge,
  through a goto, resume-only path, cleanup block, no yield).
- `coroutine/layout.oracle.test.ts` (3, pinned nightly, std crates, coroutine closures; `async fn` needs `mir_borrowck`
  for its opaque's hidden type and is not reachable yet):
  - `must_not_suspend` (10 lints: plain with reason, `Box` + allocator, reference held in an immovable coroutine,
    tuple / array (plural), `dyn` trait object, dedup across variants, movable): complete stderr + exit code equal.
  - `#![deny(must_not_suspend)]`: stderr + exit code 1 equal.
  - Layouts: 13 coroutines; the driver's `write_coroutine_layout` output equals the oracle's `-Zdump-mir=coroutine_resume`
    header (`coroutine layout {..}` + `coroutine debug` lines) for bodies without drop elaboration / fake borrows (disjoint
    scopes without storage conflicts, borrowed-before-yield static vs movable, `static` ref "(ignored for traits)", resume
    args + upvars, chained borrows over three yields, the lint cases).
- `bun test src/rustc_mir_transform`: 45 pass, 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000`: see "Checks".

## Samples (`RUST_TS_AGENT=root-f5de`, compared case by case with root's base runs)
| suite | lane run | M / D / U / C | base run | changed cases |
|---|---|---|---|---|
| tydump-minicore (46) | `20261022-182036-root-f5de-854o` | 45 / 0 / 1 / 0 | `…-8kp6` | 0 |
| mirdump-minicore (46) | `20261022-182056-root-f5de-4srh` | 17 / 0 / 29 / 0 | `…-bbue` | 0 |
| tydump-ui `--sample 300` | `20261022-182118-root-f5de-24oy` | 258 / 0 / 40 / 0 (+2 unstable) | `…-supl` | 0 |
| mirdump-ui `--sample 300` | `20261022-182318-root-f5de-lqty` | 17 / 0 / 283 / 0 | `…-c6id` | 0 |

No new DIFF; every case has the same status and stop as base.

## `unported(...)` left (drop.ts stand-ins, module-local, not markers; owners repoint)
- coroutine/mod.rs (lane mt-coroutine-a): `TransformVisitor` (interface view: `coroutine_kind`), `Operation` (string
  union + const), `create_cases`, `insert_switch`, `insert_term_block`, `return_poll_ready_assign`,
  `insert_poll_ready_block`, `insert_panic_block`, `make_coroutine_state_argument_indirect`,
  `make_coroutine_state_argument_pinned`, `transform_async_context`, `generate_poison_block_and_redirect_unwinds_there`.
  `SELF_ARG` is redeclared (`Local::arg(0)`, mod.rs:160). mt-coroutine-a: import these from mod.ts in drop.ts (lazily
  or as types only; mod.ts imports drop.ts) and delete the stand-ins.
- `deref_separator::deref_finder` (lane mt-cleanup); `shim::DropShimElaborator` (interface of its fields, lane mt-shim);
  `elaborate_drop::{Unwind, elaborate_drop}` (lane mt-drops; `path` `()` is `null`).
- layout.ts has none of its own. `check_field_tys_sized` (only with `feature(unsized_fn_params)`) is not oracle-tested.

## PORT decisions (please record)
1. `CoroutineSavedLocals` is a class with field `_0`; `impl Deref` is `deref()` (marker on it), auto-deref calls are
   `saved_locals.deref().x()`.
2. `StorageConflictVisitor extends ResultsVisitorBase`; `mem::swap` of the two bitsets swaps the fields.
3. `MaybeStorageLive::new(Cow::Borrowed(..))` takes the bitset itself.
4. Copies of the `Copy` `SourceInfo` (into `CoroutineSavedTy`, the suspension-point list, by-value args used more than
   once in drop.rs, `iter::repeat` in the proxy layout) are `clone_SourceInfo`.
5. `find_attr!(.. MustNotSupend {reason} => reason)` (`Option<Option<Symbol>>`) returns a `{ reason }` holder.
6. `izip!` of the three suspension-point lists runs to the shortest length; `IndexVec<Local, Option<(Ty, VariantIdx,
   FieldIdx)>>` is `([Ty, VariantIdx, FieldIdx] | undefined)[]`.
7. drop.rs: `*rvalue = Rvalue::Aggregate(..)` is `replace_in_place`; `*args = ..` writes the `Adt` aggregate's `_2`;
   unit `TerminatorKind` / `UnwindAction` variants are the companion singletons; `truncate` is `length = min(..)`.

## For root
- **Bug outside this lane (not fixed):** `rustc_index` `debug_BitMatrix` prints raw numbers (`(0, 0)`); upstream's
  `impl<R: Idx, C: Idx> Debug for BitMatrix<R, C>` (bit_set.rs:1466) prints `(r, c)` through `R` / `C`'s Debug, i.e.
  `(_s0, _s0)` for coroutine layouts. Affects `debug_CoroutineLayout` (mir/query.ts) and `write_coroutine_layout`'s
  `storage_conflicts = ..` line (mir/pretty.ts:906), i.e. every `-Zdump-mir` / `-Zunpretty=mir` dump of a coroutine
  after StateTransform. Fix: give `debug_BitMatrix` `debug_R` / `debug_C` parameters and pass `debug_CoroutineSavedLocal`
  at both sites. The oracle test's driver renders that line itself (documented in its header) until then.
- `rustc_ty_utils/layout.test.ts`'s header still says coroutines need `mir::CoroutineLayout` (M4); their layout now
  stops at `optimized_mir` (StateTransform, wave 24).
- `async fn` bodies stop at `mir_borrowck` (opaque hidden types) before reaching the witnesses.

## Checks
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- Full `RUST_TS_AGENT=mt-coroutine-b RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at `5779b367`): 6063 pass, 1 skip, 0 fail (6064 tests, 431 files; 2311 s).
