# Handoff: const-check (wave 22: const checking + string-literal allocations)

Branch `lane/const-check`, from `fe77b233`, no merges. Commits (oldest first): `8e571f62` mk_const_alloc,
`f0384be3` check/ops + diagnostics codegen + stubs, `d8e69f10` const-check oracle test, `e27cb2b8` mk_const_alloc
oracle test, then this handoff.

## 1. `TyCtxt::mk_const_alloc` (rustc_middle ty/context.ts)
- The `direct_interners!` entry (context.rs:2018) is ported: `interners.const_allocation` (now
  `InternedSet<ConstAllocation>`) interns an `Allocation` into a frozen `ConstAllocation`.
- Intern key `key_Allocation` (module-local, context.ts): the derived `PartialEq` of `Allocation` (bytes as one char
  per byte, `provenance.ptrs.data`, `provenance.bytes?.data`, `init_mask.blocks` (Lazy / Materialized kept apart, as the
  derive compares them), `init_mask.len`, `align.pow2`, `mutability`; `extra` is `()`). The `SortedMap` comparator
  function is not part of the key (it made `intern_key` panic).
- `allocate_bytes_dedup` / `reserve_and_set_memory_dedup` (mir-interp-a/b) were already ported and are used unchanged;
  `ty/codec.ts`'s `decode ConstAllocation` now works too.
- **Check**: `src/rustc_middle/ty/mk_const_alloc.oracle.test.ts` (+ driver `ty/const_alloc_oracle/run.ts`): `-Zdump-mir=built`
  of 8 fns with str / byte-str / empty / C-str / non-ASCII / >16-byte literals and a duplicated literal: all 8 files
  byte-identical to the pinned rustc, alloc blocks and dedup included. Consts are left out of that test on purpose:
  rustc builds their MIR earlier (CTFE in `check_crate`), so AllocId numbers depend on the real query order (D13).
- Earlier scratch check on the 41 `mk_const_alloc` cases of merge-w22's mirdump-ui sample (built-MIR comparison as in
  merge-w22 §5): 120 files written, 46 identical, the other 74 identical up to the known `const ()` printer stop
  (`try_destructure_mir_constant_for_user_output`); 0 real divergences.

## 2. check_consts/{check, ops}.rs (rustc_const_eval)
- `src/rustc_const_eval/check_consts/check.ts`: 22/22 (`Qualifs` + `in_local` / `in_return_place`, `Checker` with
  `check_body`, `local_is_transient`, `check_op(_spanned)`, `check_static`, `place_may_escape`,
  `revalidate_conditional_constness`, `check_drop_terminator`, `check_callee_stability`, the `Visitor` impl,
  `is_int_bool_float_or_char`, `emit_unstable_in_stable_exposed_error`).
- `src/rustc_const_eval/check_consts/ops.ts`: 29/29 (`Status`, `DiagImportance`, `NonConstOp` + `NonConstOp_provided`,
  every op, `build_error_for_const_call`).
- `src/rustc_const_eval/diagnostics.ts` (hand) + `diagnostics.gen.ts` (generated, new codegen set `rustc_const_eval`):
  2/2 (`FrameNote::add_to_diag`, `InternKind::into_diag_arg`); all 40 derives generated.
- Coverage: rustc_const_eval 57/764; TOTAL 19217/25518. `bun scripts/coverage.ts --check`: markers ok.

### Stubs for lane mt-promote (take mt-promote's files on merge)
`check_consts/{mod, qualifs, resolver, post_drop_elaboration}.ts` on this branch are stub modules
(`// Stub module (lane mt-promote)`) with exactly the names/shapes of mt-promote's port (`ConstCx` with
`const_kind_()`, `Qualif` impl tables `HasMutInterior` / `NeedsDrop` / `NeedsNonConstDrop` passed as `Q_`,
`in_place(Q_, cx, in_local, place)`, `in_any_value_of_ty(cx, ty, tainted)`, `FlowSensitiveAnalysis.new(Q_, ccx)`,
`State.contains`, `checking_enabled(ccx)`). mt-promote's branch has stubs for my `check.ts` / `ops.ts`: **on the add/add
conflicts take mt-promote's mod/qualifs/resolver/post_drop_elaboration and const-check's check/ops**.
`src/rustc_const_eval/lib.ts` is untouched here (mt-promote adds `check_consts`).
- Verified compatible: with mt-promote's four files (at `80d81974`) and dataflow-impls' `impls/storage_liveness.ts`
  (at `5a67d3e6`) copied over (not committed), `bunx tsc` is clean and the const-check oracle test passes 16/16.

### Oracle test `check_consts/check.oracle.test.ts` (+ driver `check_oracle/run.ts`)
- 16 crates (std, edition 2021): non-const fn calls in const / const fn / static (LazyLock note), escaping `&Cell` (E0492)
  and `&mut` (E0764) borrows, live drop of `T` (E0493 + `[const] Destruct` suggestion) and of a `Drop` type,
  fn-pointer calls, ptr-to-int casts, raw ptr comparison, trait method calls (`<T as Default>::default`, non-const
  trait with the "consider making trait const" suggestion), `for` loops / `?` (E0658 + "not yet stable as a const
  trait"), `format_args!`, closure calls, `match` on `&str`, `&i32 == &i32`, async blocks, and a no-error crate.
- Each case: the subject's whole stderr must equal rustc's byte for byte. With the overlays above: **16/16 identical**.
- On this branch alone (stubs) every case stops in an mt-promote stub and is reported `PENDING` (passes); any other
  UNPORTED stop fails. After the merge they run for real.
- The driver runs `Checker` on `build_mir_inner_impl`'s body (MIR as built): `mir_built`'s pass list stops at
  `LintAndRemoveUninhabited` (mt-built-lints). Once that lands, `mir_const_qualif` (wired by mt-promote) is the real path.
- Not covered: cases whose crates stop at `eval_to_valtree` (CTFE, wave 23b) inside the trait solver (e.g. `String`
  deref coercion, `Vec::len`): the stop is in the solver's const normalization, not in const checking.

## 3. Samples (`RUST_TS_AGENT=root-fe77`, vs root's base runs at `fe77b233`)
| suite | base | this lane | status changes |
|---|---|---|---|
| mirdump-minicore | `qdzc` 16/0/30/0 | `20261022-154046-root-fe77-4zig` 16/0/30/0 | 0 |
| mirdump-ui `--sample 300` | `3ska` 0/0/299/0 (+1 UNSTABLE) | `20261022-154105-root-fe77-ib9r` 0/0/299/0 (+1 UNSTABLE) | 0 |
| tydump-minicore | `zgkc` 45/0/1/0 | `20261022-154243-root-fe77-7x2n` 45/0/1/0 | 0 |
| tydump-ui `--sample 300` | `uc9z` 263/1/35/0 (+1 UNSTABLE) | `20261022-154258-root-fe77-tuuu` 263/1/35/0 (+1 UNSTABLE) | 0 |

No new DIFF (the one tydump-ui DIFF is in the base run too). **mirdump stops moved**: all 37 `mk_const_alloc` stops of
the mirdump-ui sample and the 1 of mirdump-minicore now stop at `LintAndRemoveUninhabited` (mt-built-lints), i.e. after
MIR building. Top mirdump-ui stops now: 254 LintAndRemoveUninhabited, 20 mir_borrowck provider, 13 eval_to_valtree,
7 has_ffi_unwind_calls, 4 eval_to_const_value_raw_provider. No `mk_const_alloc` stop is left.

## 4. Tests
- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_const_eval src/rustc_middle/ty/mk_const_alloc.oracle.test.ts`: 0 fail.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test src --timeout=120000` (detached, `RUST_TS_AGENT=const-check`, at `e27cb2b8`): **6022 pass, 1 skip, 0 fail** (6023 tests, 423 files, 2502 s).

## 5. Shared files edited (review)
- `src/rustc_middle/ty/context.ts`: `mk_const_alloc`, `key_Allocation`, the `const_allocation` interner's type.
- `tools/codegen/types.sets.json` (new set `rustc_const_eval`), new `tools/codegen/const_eval.typemap.json`
  (`rustc_hir::ConstContext`, `crate::interpret::InternKind`), `tools/codegen/diag_args.json` (IntoDiagArg / Display of
  `ConstContext` (hir.ts) and `InternKind`). Precedent: pat-b's / merge-w22's codegen-set edits.
- No harness/ or scripts/ edits.

## `unported(...)` left
- check.ts / ops.ts / diagnostics.ts: none. Stub modules for mt-promote: every item (replaced on merge).

## PORT decisions (for `bun scripts/state.ts record decision`)
1. (const-check) `mk_const_alloc` interns by the derived `PartialEq` of `Allocation` (`key_Allocation` in context.ts: bytes, provenance entries without the `SortedMap` comparator, `InitMask` representation, align, mutability); `Hash` only picks the bucket upstream.
2. (const-check) `trait NonConstOp` is an interface with provided methods in `NonConstOp_provided` (via a module-local base class); ops are classes (`ops::FnCallIndirect` is `new FnCallIndirect()`); their `derive(Debug)` (tracing only) is not ported.
3. (const-check) `Qualifs`' `Option<QualifResults>` fields are `MutRef`s filled with `??=`; `Q: Qualif` is the impl table `Q_` (mt-promote's convention); `impl Deref for Checker` is the field `ccx` (`deref()` returns it).
4. (const-check) `crate::interpret::InternKind` is declared in rustc_const_eval/diagnostics.ts until interpret/intern.rs is ported (wave 23b); that port takes it over (typemap const_eval.typemap.json points there).
5. (const-check) Oracle test drivers that bypass `rustc_driver_impl`'s callbacks set `opts.trimmed_def_paths = true` as `TimePassesCallbacks::config` does (else `def_path_str` prints untrimmed paths).
