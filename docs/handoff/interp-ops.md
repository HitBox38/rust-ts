# Handoff: interp-ops (M4 wave 23c, CTFE fill lane)

Branch `lane/interp-ops` (from `43e37d73`, no merges). Lane: the `interp-ops` row of the split table in
`docs/handoff/interp-contract.md`: rustc_const_eval `interpret/{operator, cast, discriminant, projection, traits, util,
visitor}.rs` (2431 upstream lines, 57 stubs).

## Result
- **All 57 stubs ported** (0 `unported(..)` left in the seven files). Commits in order: visitor (`d171e493`, the T
  path `ValueVisitor_provided`, committed first for interp-validity-intern), projection (`a1ca98a3`), discriminant
  (`221043ed`), util (`7a20e42d`), traits (`20b897fd`), operator (`59611e2e`), cast (`f341ce22`), differential test
  (`ffcae4e9`), this handoff.
- Coverage (`bun scripts/coverage.ts --missing compiler/rustc_const_eval/src/interpret/<f>.rs`): operator 10/10, cast
  10/10, discriminant 4/4, projection 19/19, traits 5/5, util 7/7, visitor 9/9 (these counts include the trait
  declarations ported by interp-contract). rustc_const_eval 340/764; TOTAL 19856/25518. `coverage.ts --check`: markers ok.
- `src/rustc_const_eval/interpret/contract.test.ts`: markers 176 → 233, stubs 481 → 424; the `interp-ops` row is gone
  from the per-lane table (0 stubs; a comment marks it done). The runtime stop of `const C: u8 = 7;` is unchanged
  (`eval_queries::eval_in_interpreter`, lane ctfe-a). 4/4 pass, fresh entries included.

## Signature changes to the contract (root: reconcile at merge)
1. **`ensure_monomorphic_enough<T>(ty: T, d_T: TypeVisitable<T>)`** (util.ts): `T: TypeVisitable` takes its descriptor
   (eval_context.ts header, "generic parameters"); `has_param` needs it. The declared signature had no descriptor.
   Callers in other lanes' files (intrinsics.rs, call.rs, ...) pass `fold_Ty` (or the type's fold descriptor). If they
   ported against the old one-argument signature, tsc reports it at merge.
2. `binary_float_op<F extends Float<F>>` and `cast_from_float<F extends Float<F> & FloatConvert>` (were
   unconstrained `<F>`): the bound is needed to call apfloat; `F`'s `FloatType` is `f.Self()`.

## For other lanes / root
- **operand.ts `ImmTy::from_pair(a, b, cx: [HasTypingEnv])`** (lane interp-place-operand): the contract declared the
  `cx: &(impl HasTypingEnv + HasTyCtxt)` parameter as a 1-tuple. operator.ts passes the `InterpCx` itself through
  `from_pair_cx` (a cast). Please make the parameter `HasTypingEnv & HasTyCtxt` (or similar). The call stays correct
  either way, as long as the implementation reads `cx.tcx_()` / `cx.typing_env_()` off the object.
- **rustc_middle mir/interpret/value.ts**: `Scalar::to_float` (and so `to_f16..to_f128`) is still
  `unported("rustc_apfloat::Float::BITS / Float::from_bits ...")`, and the float types there are `Pending` placeholders.
  rustc_apfloat is vendored now (D9), so this can be ported. Until then every float `binary_op` / `unary_op` Neg /
  `float_to_float_or_int` stops there. operator.ts / cast.ts cast the placeholder types to the vendored ones (`ap<T>()`).
- The T functions call stubs owned by other lanes; until those merge, their paths stop there: `ImmTy::from_*`,
  `Immediate::to_scalar*`, `offset_with_meta` / `to_op` / `meta` / `layout_` of the four projectables, `read_immediate`,
  `MemPlaceMeta::{has_meta, unwrap_meta}`, `deref_pointer`, `write_*`, `copy_op_*` (interp-place-operand);
  `scalar_may_be_null`, `get_ptr_vtable_ty`, `global_root_pointer`, `fn_ptr`, `get_ptr_fn` (interp-memory);
  `ptr_offset_inbounds` (interp-intrinsics); `validate_place` (interp-validity-intern); `CompileTimeMachine` hooks
  (ctfe-b).
- `UndefinedBehaviorInfo::BoundsCheckFailed { len, index }` is generated with `number` fields (rustc_middle
  error.gen.ts) while upstream has `u64`; projection.ts converts with `Number(..)` (precision is lost only past 2^53,
  in the error text).

## `// PORT:` decisions
- operator.ts: `i128` / `u128` arithmetic is bigint arithmetic, wrapped with `BigInt.asIntN` / `asUintN(128, ..)` where
  Rust's `overflowing_*` wraps; `checked_shl` / `checked_shr` with an in-range amount become `<<` (wrapped to 128 bits)
  / `>>` (arithmetic on `i128`). `i128::overflowing_div` / `overflowing_rem` are local helpers (`MIN / -1`). `bool`'s
  `Ord` compares 0/1. `<F as Into<Scalar>>` dispatches on `f.Self()` (Half/Single/Double/Quad → `Scalar_from_*`).
  `PartialOrd` of floats is apfloat `partial_cmp` (`None` for NaN).
- projection.ts: `P: From<MPlaceTy>` (`project`'s `Deref`) is `P_from_MPlaceTy`, dispatched on the value's class
  (`MPlaceTy` identity, `PlaceTy_from_MPlaceTy`, `OpTy_from_MPlaceTy`). The `ConstantIndex` / `Subslice` fields are
  numbers in mir (syntax.gen.ts) and widen to bigint. `ArrayIterator.range` is numbers (codegen). `Ty::new_array` takes
  a number. The custom `assert_eq!` message of `project_to_ptr_in_box` is spelled out (std's `assert_eq` has no message).
- discriminant.ts / cast.ts: an `&impl Projectable` / `&impl Writeable` passed to a generic `P: Projectable` fn is cast
  to a local self-typed interface (`AnyProjectable` / `AnyWriteable`). `tag_val.to_scalar()` reads `ImmTy.imm` (the
  `Deref` target) instead of calling the stubbed `deref()`.
- traits.ts: `sort_by` is the stable `Array.prototype.sort`, `dedup` / `!=` on predicates use the derived `PartialEq`
  (`intern_key_eq`). The `TypeFoldable` descriptors (`d_TraitRef`, `d_ExistentialPredicate`, `fold_tuple2(fold_Ty,
  fold_BoundExistentialPredicates)`) are local, as in ty/vtable.ts.
- util.ts: `ConstAllocation::make_result`'s `FxIndexMap::swap_remove` goes through const_eval/machine.ts
  `swap_remove` on the CTFE machine's map (cast to `FxIndexMap_AllocMap`); const_eval/machine.ts and memory.ts are read
  lazily (init order). `EnteredSpan::or_if_tracing_disabled` returns `self` (nothing produces an `EnteredSpan`).
- cast.ts: the `vtable_entries[..b.len()] == b` slice panics as Rust does when out of range, then compares with
  `intern_key_eq`.

## Tests
- **New: `src/rustc_const_eval/interpret/operator_cast.oracle.test.ts`** (differential, not a port). It generates about
  25.2k cases as `const` items of one Rust file, built with the pinned toolchain, so the oracle values come from the
  pinned rustc's own CTFE (preferred-NaN results included). The same cases run through `binary_op` / `unary_op` /
  `int_to_int_or_float` / `binary_float_op` / `cast_from_float`. Coverage: every int width (u/i 8..128) × 21 binops
  (wrapping, `*WithOverflow` flags, `*Unchecked` UB, div/rem by zero and `MIN / -1` UB, `Cmp`), shifts with `u32` and
  `i32` amounts in and out of range (incl. negative, `*Unchecked` UB), `Not` / `Neg`, int → int / float / char casts,
  bool and char ops, f16 / f32 / f64 / f128 compare + arithmetic (signed zeros, subnormals, inf, NaN with payloads),
  float → int (saturating) / float casts. Result: **all equal** (`RUST_TS_REQUIRE_PROBES=1`). Identity float casts are
  excluded, because rustc emits no cast for `f32 as f32`. A mutation check (shift modulus off by one) makes it fail.
  - The test installs **test doubles** for the operand.rs helpers that are still stubs in this lane (`ImmTy::from_*`,
    `Immediate::to_scalar(_pair)`, `ImmTy::to_scalar_int`), written from upstream operand.rs. A double is installed only
    while the real function is `unported`, and restored after the test. `from_ordering`'s double uses the `i8` layout,
    because the no_core test crate lacks the `Ordering` lang item. After interp-place-operand merges, the real functions
    run.
- Samples and full suite: below.

## Samples (`RUST_TS_AGENT=root-f5de`)
| suite | run (at `ffcae4e9`) | M / D / U | interp-contract handoff (`e99b4cde`) M / D / U |
|---|---|---|---|
| mirdump-minicore (46) | `20261022-204249-root-f5de-vlyy` | 45 / 0 / 1 | 43 / 0 / 3 |
| tydump-minicore (46) | `20261022-204336-root-f5de-dtnk` | 45 / 0 / 1 | 45 / 0 / 1 |
| mirdump-ui `--sample 300` | `20261022-204428-root-f5de-gbxx` | 266 / 0 / 34 | 222 / 0 / 78 |
| tydump-ui `--sample 300` | `20261022-205315-root-f5de-bicz` | 258 / 0 / 40 (+2 UNSTABLE) | 258 / 0 / 40 (+2 UNSTABLE) |

**0 DIFF, 0 CRASH.** The gains over the interp-contract numbers come from the integ-w19 base (mt-validate etc.), not
this lane: const evaluation still stops before reaching the code of this lane. Remaining stops: mirdump-ui
`mir_borrowck provider` 16, `eval_queries::eval_in_interpreter` 16 (ctfe-a), `ConstValue::try_to_bits_for_ty (M4)` 2;
tydump-ui `mir_borrowck` 25, `eval_in_interpreter` 12, `dep_graph::hash_result` 2, `try_to_bits_for_ty` 1; minicore
both `try_to_bits_for_ty` 1. No stop is in this lane's files.

## Full unit suite
`RUST_TS_AGENT=interp-ops RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` at `ffcae4e9` (detached, clean tree):
**6102 pass, 1 skip (the existing one), 0 fail** (6103 tests, 436 files, 4612 s under load average ~80 from the parallel
lanes). Log: `$RUST_TS_DATA/scratch/interp-ops/logs/fulltest.log`. Also clean: `bunx tsc --noEmit -p .`,
`bun scripts/coverage.ts --check`, contract.test.ts 4/4.

## Shared files edited
- `src/rustc_const_eval/interpret/contract.test.ts` (counts only, as the contract asks).
- New test file above. No harness/, scripts/, tools/ edits.
