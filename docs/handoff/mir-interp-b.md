# Handoff: mir-interp-b (M4 wave 21, MIR fill lane 6 of 6): rustc_middle mir/interpret/{mod, value, pointer, error, queries}.rs

Branch `lane/mir-interp-b` (from `aae2f3fc`, no merges). Commits: port of the five files + `GlobalCtxt.alloc_map` → stand-in
repointing + oracle tests → decisions → this handoff.

## Result
- **All 184 stubs ported** (coverage `--missing`: mod.rs 29/29, value.rs 61/61, pointer.rs 39/39, error.rs 53/53, queries.rs
  7/7). `src/rustc_middle/mir/contract.test.ts`: the `mir-interp-b` stub count is 0 (entry removed from the per-lane table) and
  its two `stops(..)` probes of this lane's stubs (`CtfeProvenance::alloc_id`, `InterpResult::unwrap`) now assert the ported
  values. Fresh-entry init-order test still green.
- **`GlobalCtxt.alloc_map`** (context.rs:784/:986): a constructor field between `query_system` and `current_gcx`;
  `create_global_ctxt` passes `mir().interpret.AllocMap.new()` (lazy `mir()`, mir/ is in context.ts's import closure).
- **`AllocMap` / `reserve_*`** (D13): `next_id` starts at 1 and only `reserve()` increments it; `reserve_and_set_dedup`
  reserves only on a dedup miss (key = `intern_key` of `(GlobalAlloc, salt)`), `reserve_and_set_memory_alloc` always
  reserves. Scripted order test in `interpret_b.oracle.test.ts`.
- **`CtfeProvenance`** bits (63 = immutable, 62 = shared_ref), `Pointer`, `PointerArithmetic`, `Scalar` (all constructors /
  `to_*`), `InterpErrorInfo` / `InterpErrorBacktrace` / `InterpResult` companions, every error-kind `Display`,
  `InvalidMetaKind: IntoDiagArg`, `GlobalAlloc` methods, `AllocDecodingState` / `AllocDecodingSession::decode_alloc_id`,
  `read/write_target_uint`, the seven `const_eval_*` wrappers of queries.rs (the `eval_to_*` providers stay unported, 23b).

## Stand-ins repointed (files outside the lane, small edits; please review)
- rustc_middle `ty/adt.ts` (`tcx.const_eval_poly`, `ErrorGuaranteed_from_ReportedErrorInfo`; `ConstValue` typed as mir's,
  `ConstValue::try_to_bits_for_ty` stays a stand-in for mir-body-b), `ty/codec.ts` (`decode_CtfeProvenance` →
  `CtfeProvenance::from_parts`; **bug fix**: it decoded `(AllocId, bool)`, the pin's `into_parts` is `(AllocId, bool, bool)`),
  `ty/print/pretty.ts` (`prov_and_relative_offset`, `debug_Pointer`, `CtfeProvenance::alloc_id`, `try_get_global_alloc`,
  `ConstAllocation::inner`; `get_bytes_strip_provenance` left for mir-interp-a), `ty/context.ts` (`allocate_bytes_dedup`
  ported: stops now at mir-interp-a's `Allocation::from_bytes_byte_aligned_immutable` stub, then `mk_const_alloc`),
  `ty/consts/valtree.ts` (`ConstToValTreeResult`'s error is `ErrorHandled`).
- rustc_hir_analysis `lib.ts` (const items: `Instance::new_raw` + `GlobalId` + `ensure_ok().eval_to_const_value_raw`),
  `check/wfcheck.ts` (`tcx.const_eval_poly` ×2, stand-in removed).
- rustc_mir_build `thir/cx/expr.ts` (`reserve_and_set_static_alloc` → `ExprKind::StaticRef`), `thir/print.ts` (`AllocId`
  Debug), `thir/pattern/const_to_pat.ts` (`tcx.const_eval_resolve_for_typeck`).
- rustc_trait_selection `traits/mod.ts` (`try_evaluate_const`: the `match` on `const_eval_resolve_for_typeck`, ported).
- rustc_metadata `rmeta/decoder.ts` (`AllocDecodingState::new`, `new_decoding_session`, `decode_alloc_id`; the
  `AllocDecodingStateStandIn` record removed).
- Not repointed: ty/vtable.ts `Allocation::new`, codec.ts `Decodable for Allocation`, cstore_impl / check/mod.ts
  `ConstAllocation` (all mir-interp-a's types).

## Re-pinned tests (no assertion weakened)
- `rustc_metadata/rmeta/contract.test.ts`: "stubs stop as UNPORTED" probed `decode_alloc_id`, now ported → the test checks
  that it hands the decoder to the crate's `AllocDecodingSession`.
- `rustc_metadata/rmeta/decoder_{a,b}.oracle.test.ts`: the `CrateMetadata` fixtures pass `AllocDecodingState.new([])`
  instead of `undefined` (the field is typed now).
- `rustc_middle/mir/contract.test.ts`: see Result.
- `rustc_ty_utils/layout.test.ts` (`PENDING.layout_discriminants`) and `rustc_lint/late_passes_e1.oracle.test.ts`
  (`default_overrides_default_fields`): their pinned stop was `TyCtxt::const_eval_poly (M4)`; `const_eval_poly` is ported and
  now stops at the `PseudoCanonicalInput<GlobalId>` query key, which is the new pinned stop (same UNPORTED status).

## `unported(...)` left (in the lane's files)
- `rustc_apfloat::Float::BITS / Float::from_bits (Scalar::to_float ...)` (D9; `from_f16..f128` reach int.ts's apfloat stops).
- `std::backtrace::Backtrace::force_capture (RUSTC_CTFE_BACKTRACE[=immediate])` and `Display for std::backtrace::Backtrace`
  (`print_backtrace`): only with the env var set.
- `Decodable for rustc_middle::ty::Instance` (the `Fn` arm of `decode_alloc_id`; not generated).
- New stop reached by suites: `rustc_middle::query::keys: QueryKey for ty::PseudoCanonicalInput<'tcx, GlobalId<'tcx>>`
  (queries.gen.ts `key_unported` for `eval_to_allocation_raw` / `eval_to_const_value_raw` / `eval_to_valtree`). **Follow-up
  (tools, not this lane):** add the key to `tools/codegen/queries.config.json` (as instance-vtable did for
  `PseudoCanonicalInput<(DefId, GenericArgsRef)>`) and regenerate; the providers stay unported until 23b either way.

## PORT decisions (recorded with `state.ts record decision`)
1. `Pointer<Option<Prov>>` = `Pointer<Prov | undefined>`; `debug_Pointer` sends a `None` provenance to the
   `Pointer<Option<Prov>>` impl (the generated Debug of `InvalidVTablePointer` calls `debug_Pointer`);
   `Pointer<Option<Prov>>::addr` asserts `OFFSET_IS_ADDR` = false (every ported provenance).
2. `AllocMap` maps (above); `ShardedHashMap::insert_unique` (release) keeps the first entry on a duplicate key.
3. `Scalar::clear_provenance(&mut self)` takes `MutRef<Scalar>` (contract signature changed); interpret `Display` impls
   return the text, inner `{x}` / `{x:?}` use fresh flags (`PLAIN`); `try_from_unwrap` (pointer.ts) is
   `<u64/i64 as TryFrom<u128/i128>>::try_from(..).unwrap()`.
4. `u64`/`i64`/`u128` interpreter values are bigints; `Size` stays a number, so `max_size_of_val` and
   `wrapping_offset` past 2^53 stop at `Size`'s `SIZE_BEYOND_2_53` (abi-lib decision).
5. `AllocDecodingState.data_offsets` are numbers (metadata converts the `u64`s; positions < 2^53).

## Checks
- `bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok (18185; vendor 3888). Coverage rustc_middle
  2495/3369 (base 2311 + other lanes' work on this base: see per-file numbers above), TOTAL 17666/25518.
- New `src/rustc_middle/mir/interpret/interpret_b.oracle.test.ts` (9 tests): CTFE `error[E0080]` messages of the pinned rustc
  (11 consts: out-of-bounds, dangling/null int pointers, unreachable, ptr-as-int, negative offsets, misalignment) =
  `display_InterpErrorKind` of the matching error values (captured + checked live); `Pointer` / `CtfeProvenance` / `Scalar`
  Debug/Display (`alloc1`, `a3+0xc<imm>`, `0x10[noalloc]`, `null pointer`, `pointer to alloc2`); `Scalar` conversions and
  their panics; AllocId order; `read/write_target_uint`; `InterpResult` helpers.
- `src/rustc_middle/mir/contract.test.ts` 6/6.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (once, at `cba20224`): 5563 pass / 1 skip / 4 fail. Two were
  this lane's moved stops (layout.test.ts, late_passes_e1 above; re-pinned, then 34/34 pass on rerun of those files). The
  other two are **base fallout, also failing on `aae2f3fc`** (per root): `rustc_lint/types.oracle.test.ts` "PENDING TypeLimits:
  fn pointer `==` suggestion stops at utils::std_or_core" and "PENDING TypeLimits: ambiguous_wide_pointer_comparisons stops
  at utils::std_or_core". (A metadata-only run earlier also hit a 5 s default-timeout flake in locator.oracle.test.ts; not
  in the full run.)

## Samples (lane vs base `aae2f3fc` = detached worktree `lanes/mir-visit-base`; both `RUST_TS_AGENT=mir-interp-b`)
| suite | lane run | M / D / U | base run | M / D / U |
|---|---|---|---|---|
| tydump-minicore (46) | `20261021-200702-mir-interp-b-95f4` | 45 / 0 / 1 | `20261021-201216-mir-interp-b-lsnd` | 45 / 0 / 1 |
| thirdump-minicore (46) | `20261021-200730-mir-interp-b-t9pa` | 45 / 0 / 1 | `20261021-201240-mir-interp-b-cfht` | 45 / 0 / 1 |
| tydump-ui `--sample 200` | `20261021-200800-mir-interp-b-rr0s` | 178 / 0 / 22 (+3 unstable) | `20261021-201305-mir-interp-b-qvfo` | 178 / 0 / 22 (+3 unstable) |
| hir-tree `--sample 200` | `20261021-201006-mir-interp-b-mot8` | 199 / 0 / 1 | `20261021-201456-mir-interp-b-ilrm` | 199 / 0 / 1 |
| thirdump-ui `--filter thir-print` (11) | `20261021-201205-mir-interp-b-4u8j` | 0 / 0 / 11 | (base) | 0 / 0 / 11 |

No new DIFF; every case has the same status as on base (compared per case). Stop reasons changed only where the repointed
stand-ins were the stop: 10 cases (mini_core_hello_world in tydump/thirdump-minicore, 8 of tydump-ui's sample) moved from
`const_eval_poly (M4)` / `const_eval_resolve_for_typeck (M4)` to the `PseudoCanonicalInput<GlobalId>` query-key stop above.
