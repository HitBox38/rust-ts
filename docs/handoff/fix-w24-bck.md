# Handoff: fix-w24-bck (merge fixer after the second borrowck batch)

Branch `lane/fix-w24-bck` (base `a83ca3dd` on integ-w19, no merges).

## Cause
All the borrowck fill lanes are merged (bck-diag-a…f, bck-lib-a/b, bck-regions-b, ...). `mir_borrowck` now runs to
completion on the tested bodies: type check, region inference, the dataflow checks and error reporting. Every pin at
`UniverseInfo::relate` / `MoveError::new` / `UseSpans::var_or_use*` / `CleanupPostBorrowck` was stale. Most cases now
equal the oracle, so I turned them into oracle comparisons. The rest reach a later, real `unported(...)` and are
re-pinned to that exact stop. No assertion was loosened and no case was deleted.

Two cases that now run further exposed real bugs outside borrowck. Both are fixed (see "Bugs fixed").

## Tests
| test | old pin | now |
|---|---|---|
| `rustc_borrowck/bck_lib_b.test.ts` "check_movable_place" | `UNPORTED MoveError::new`, `errors=0` | Pins the pushed `MoveError`s in full (`debug_MoveError`): `BorrowedContent { target_place: (*_2) }` for `*r` and `InteriorOfTypeWithDestructor { container_ty: D }` for `d.x`. I worked both out by hand from lib.rs:1899. |
| same, "check_for_invalidation_at_exit / check_for_local_borrow / check_backward_incompatible_drop" | `UNPORTED UseSpans::var_or_use` / `var_or_use_path_span` | `check_for_local_borrow` now reaches `cannot_borrow_across_coroutine_yield`, which unwraps `body.coroutine` (upstream only reaches it from a coroutine `Yield`). It panicked here (an unhandled error between tests) because the test bodies are plain fns. So the test records that builder, `buffer_error` and `explain_why_borrow_contains_point` (which needs the regioncx the test doesn't build), the same way it already records the other lanes' builders. The pins show these calls. |
| `rustc_borrowck/contract.test.ts` runtime-stop test | `stops(.. "UniverseInfo::relate")` | `mir_borrowck(f)` is `Ok` with 0 hidden types, and `dcx.err_count() == 1` (only the E0308, as rustc). Renamed "... a real body is checked to completion". I removed the now-unused `stops` helper. |
| `rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts` `e0109_kinds` | `CleanupPostBorrowck (pass not ported)` | `PENDING` is empty. The case equals the oracle (stderr + exit 1); I checked it by hand too. |
| `rustc_hir_analysis/check/compare_impl_item.oracle.test.ts` `PENDING` (11 cases) | `UniverseInfo::relate` | 10 error cases equal the oracle. `refine_rpitit` (only a warning, so `analysis` succeeds) prints the oracle's warning and then stops at `rustc_interface::queue::Linker::codegen_and_build_linker (analysis, codegen; M3+)`, re-pinned there. |
| `rustc_hir_analysis/collect_test/misc.expected.txt` (`rpit` opaque `type_of`) | `STOP UNPORTED: ..UniverseInfo::relate` | `type_of EarlyBinder { value: Unit, .. }`, equal to the tydump probe. `misc.rs` min matched facts 40 → 41. |
| `rustc_lint/late_c.oracle.test.ts` blocked `impl_trait_overcaptures` | `blocked_by UniverseInfo::relate` | Moved into `CASES` (full oracle equality). Its fn is now `pub fn f`, like every other case: the late-lint driver documents that it does not run dead-code analysis, and a private `f` made the oracle add a `dead_code` warning. The lint under test is unchanged. |
| `rustc_lint/late_e2.oracle.test.ts` TAIT `opaque_hidden_inferred_bound` | `stop: UniverseInfo::relate` | `stop` removed: full oracle equality. |
| `rustc_symbol_mangling/symbol_names.oracle.test.ts` | `STOP_CONST_EVAL` (`UniverseInfo::relate`) on 4 cases | `impl2.rs` equals the oracle. `const-generics-structural-demangling.rs` equals the oracle after both bug fixes below. `const-generics.rs#legacy/#v0` (`i8::MIN` etc. are `core` consts) re-pinned to `STOP_EXTERN_MIR` = `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for mir::Body<'static>`. |

## Bugs fixed
1. **`src/rustc_const_eval/interpret/eval_context.ts` `size_and_align_from_meta`**: both size-limit checks (the
   Struct/Tuple `TooBig` check and the Slice/Str `SliceTooBig` check) called `max_size_of_val(this).bytes()`. That is
   `Size::from_bytes(isize::MAX)`, beyond 2^53 on 64-bit targets, so **every** validation of a `&str` / `&[T]` in CTFE
   stopped with `unported: rustc_abi::Size beyond 2^53`. Both checks now compare with `target_isize_max` as `bigint`
   (with `// PORT:` comments), the pattern operator.ts `compute_size_in_bytes` and memory.ts `insert_allocation` already
   use. This was found through symbol_names `const-generics-structural-demangling.rs`.
2. **`src/rustc_symbol_mangling/v0.ts` `paths` cache key**: `intern_key` keys an interned `List` as `#id` but a plain
   array element by element. So `print_def_path(crate_root, args)` with an empty interned args list (reached through
   `default_print_def_path`'s `parent_args = args`) missed the entry cached for `print_def_path(crate_root, [])`. A
   back-reference `B3_` came out as the full crate path. This was the first difference in the v0 mangling of the ADT
   const values (`KVNtB3_3Foo...`). The key now spreads the args into a plain array (`// PORT:` comment), which is
   `&[GenericArg]`'s content equality.

No borrowck code needed a fix: there was no TypeError, undefined access or ICE on the real `mir_borrowck` path. The only
panic was the bck_lib_b test calling a coroutine-only path on a plain body.

## Tidy
- `LIMITATION_NOTE` is now exported from `diagnostics/mod.ts` (diagnostics/mod.rs:1650, with a `// ref:` line).
  `region_errors.ts` drops its local copy and reads it through a lazy `diagnostics_mod()` require, following the file's
  init-order convention for hand modules. The header is updated and an unused `DiagMessage` import is removed.
- `conflict_errors.ts` header: the old `ExpressionFinder_366/_2833` / `ExprFinder_2481/_4730` names are replaced. The
  header now says these are fn-local classes under their upstream names.

## Checks
- `bunx tsc --noEmit -p .` is clean. `bun scripts/coverage.ts --check`: markers ok (22099; vendor 4330).
- Coverage of the touched files: diagnostics/mod.rs 45/45, region_errors.rs 24/24, conflict_errors.rs 76/76,
  interpret/eval_context.rs 37/37, v0.rs 28/28.
- `bun test src/rustc_borrowck src/rustc_hir_analysis src/rustc_lint src/rustc_symbol_mangling src/rustc_const_eval`:
  512 pass / 1 fail on the full run. The one failure was `refine_rpitit`, which I then re-pinned, and that file alone
  is green (43/43). Every pin listed above is green.

## Sample difftests (`RUST_TS_AGENT=root-f5de`, compared case by case with the base runs in w25-common.txt)
| suite | run | result | vs base |
|---|---|---|---|
| tydump-minicore | 20261028-011524-root-f5de-fqa9 | 46/46 MATCH | +1 MATCH, 0 lost |
| mirdump-minicore | 20261028-011531-root-f5de-lb9x | 45 MATCH, 1 UNPORTED (mini_core_hello_world: SortedMap Decodable) | 0 lost |
| tydump-ui (300) | 20261028-011538-root-f5de-yu2c | 294 MATCH, 4 UNPORTED, 2 UNSTABLE | +33, 0 lost |
| mirdump-ui (300) | 20261028-011630-root-f5de-t287 | 296 MATCH, 4 UNPORTED | +27, 0 lost |
| borrowck-ui (300) | 20261028-011730-root-f5de-aln7 | **259 MATCH**, 41 UNPORTED, 0 DIFF, 0 CRASH | +259, 0 lost |

No MATCH was lost and there is no new DIFF / CRASH / TIMEOUT.

### Where borrowck-ui (sample 300) stops now (M4b signal)
| n | stop | owner |
|---|---|---|
| 20 | `rustc_mir_transform::inline::cycle::mir_inliner_callees` | rustc_mir_transform (fix-w24-mir / an inliner lane) |
| 12 | `polonius_engine::AllFacts::default` (`-Zpolonius` revisions) | bck-polonius-legacy, wave 26 |
| 5 | `rustc_metadata::rmeta::decoder::cstore_impl: Decodable for mir::Body<'static>` (extern MIR for CTFE / inlining) | metadata decoding (codegen) |
| 3 | `rustc_mir_transform::shim::DropShimElaborator (lane mt-shim)` | mt-shim |
| 1 | `#[derive(Diagnostic)] rustc_trait_selection::diagnostics::NonGenericOpaqueTypeParam` (diagnostics.rs not generated) | tools/codegen diagnostics |

None of these is a borrowck stub. Out of the 300, the only borrowck work left is polonius (12).

## Stubs of other lanes I hit
`mir_inliner_callees`, `DropShimElaborator` (mt-shim), polonius-engine (wave 26), MIR / `(ConstValue, Ty)` / `SortedMap`
metadata Decodable, the `NonGenericOpaqueTypeParam` diagnostic derive, codegen (`codegen_and_build_linker`). All are left
as they are.

## `unported(...)` left / `// PORT:` decisions
- I added no new `unported(...)`.
- New `// PORT:` comments: eval_context.ts (×2, `target_isize_max` comparison) and v0.ts (`new_paths` element-wise key).

## For root
- Two of my fixes are outside borrowck: `rustc_const_eval/interpret/eval_context.ts` and
  `rustc_symbol_mangling/v0.ts`. If another lane touches either file this wave, merge by hand.
- bck_lib_b.test.ts now records `cannot_borrow_across_coroutine_yield`, `buffer_error` and
  `explain_why_borrow_contains_point` on the instance. A real coroutine body would be needed to drive
  `cannot_borrow_across_coroutine_yield` itself.
