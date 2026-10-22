# Handoff: fix-w23-ctfe (merge-w23 fixer, const-eval side)

Branch `lane/fix-w23-ctfe`, base f0e9a0cf (integ-w19). Fix commit 9f60cc27.

## Per test: cause and change

1. `src/rustc_symbol_mangling/symbol_names.oracle.test.ts` (7 cases).
   - `const-generics-structural-demangling.rs`, `const-generics.rs#legacy/#v0`, `impl2.rs`: `CompileTimeMachine::load_mir` is
     ported now, so CTFE of a const with a body goes `load_mir` -> `mir_for_ctfe` -> `mir_drops_elaborated_and_const_checked`
     -> `mir_borrowck`, and stops in the borrowck type check at `relate_types` -> `UniverseInfo::relate` (stub of lane
     bck-diag-f). I checked the stack: it goes through `eval_in_interpreter`/`load_mir`, so this is a real stop further
     along. Re-pinned `STOP_CONST_EVAL` to `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate`.
   - `types.rs#v0`: the trivial const `ZERO` now evaluates end to end, and our stderr and exit code are **byte-identical
     to the oracle**. Removed it from `STOPS`, so it is now oracle-compared.
   - `types.rs#legacy` / `#verbose-legacy`: after the const evaluates, legacy mangling stops at the existing
     `StableHash for Ty` stop (`legacy.ts` `stable_hash_unported`). Re-pinned to `STOP_TY_HASH`, which `basic.rs#legacy`
     already uses. Removed the now-unused `STOP_CONST_EVAL_TRIVIAL`.
2. `src/rustc_const_eval/interpret/contract.test.ts`, runtime test: `eval_to_allocation_raw` of `pub const C: u8 = 7`
   used to stop at `InterpCx::allocate`. It now **succeeds**: borrowck returns early for a trivial const, then the step
   loop, interning and validation run. There is no stop left on this path, so I replaced the pin with checks on the
   result: `Ok`, `ty == u8`, and the `Memory` allocation has 1 byte `[7]` and is `Mutability::Not`. Renamed the test to
   "InterpCx::new, the layout cache and the trivial-const entry points run; a const evaluates through the interpreter"
   and removed the unused `stops` helper and `Unported` import. The count tests are untouched.
3. `src/rustc_const_eval/interpret/place_operand.test.ts`: the pinned stubs (`allocate_ptr`,
   `CompileTimeMachine::enforce_validity`) are ported now. The memory paths are now tested end to end:
   - `allocate(u8, Stack)` returns `Ok`;
   - `copy_op(7_u8, it)` returns `Ok`, and `read_scalar` reads back `Int(7u8)`;
   - `copy_op` to the integer address 16 returns UB `DanglingIntPointer { addr: 16, inbounds_size: 1, msg: MemoryAccess }`,
     which is rustc's behaviour.
   Removed the `stops` helper and updated the header comment.
4. `src/rustc_const_eval/interpret/operator_cast.oracle.test.ts`: the error "requires `Ordering` lang_item" came from the
   real `ImmTy::from_ordering` (`tcx.ty_ordering_enum`). The test's no_core crate has no `Ordering`, and the stand-in
   doubles were only installed while the real helpers were `unported`. Changes:
   - Removed all operand.rs test doubles (the `install_doubles` / `double` / `afterAll` machinery). The test now uses
     the real code.
   - Added core's `#[lang = "Ordering"] #[repr(i8)] pub enum Ordering` to the test crate. `Less` is written as `0xff`
     under `allow(overflowing_literals)`. Unary `-` needs the `neg` lang item. A cast (`0xffu8 as i8`) would make the
     discriminant a non-trivial const, which goes through `mir_borrowck` and stops at `UniverseInfo::relate`.
   - Getting the `Ordering` layout then hit a **real bug** (next section). After the fix, every case equals the
     oracle (1 pass).
5. `ImmTy::from_pair` `cx`: interp-place-operand had already declared the parameter as `HasTyCtxt & HasTypingEnv` in
   `operand.ts`. The remaining fix was in the caller: `src/rustc_const_eval/interpret/operator.ts`. I dropped interp-ops'
   `from_pair_cx` cast helper (and its PORT comment) and pass `this` directly at both call sites. No other casts were left.

## Bug fixed outside the listed files

- `src/rustc_middle/ty/adt.ts`: `AdtDef::eval_explicit_discr` called a local stand-in for
  `ConstValue::try_to_bits_for_ty` that was `unported("rustc_middle::mir::ConstValue::try_to_bits_for_ty (M4)")`. But
  `src/rustc_middle/mir/consts.ts:186` already ports it (mir-body-b). This was a stale stand-in, so every explicit enum
  discriminant stopped there for no reason. I repointed the stand-in to the real function through a lazy `require`
  memo, because adt.ts is a defining module (same pattern as its other lazy requires, with the perf-intern PORT note).
  I also updated the module header note and removed the unused `unported` import.
- Knock-on: `src/rustc_ty_utils/layout.test.ts` had pinned `layout_discriminants` to that stop. It now **equals the
  oracle's `#[rustc_dump_layout(debug)]`**, so I emptied `PENDING` with a note. Root: this file is outside the listed
  set, so please take it with this lane.

## Checks

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok. Coverage of the touched upstream files:
  `interpret/operator.rs` 10/10, `ty/adt.rs` 60/60.
- `bun test src/rustc_const_eval src/rustc_symbol_mangling src/rustc_mir_transform src/rustc_ty_utils src/rustc_middle`:
  496 pass, 1 fail. The failure was `symbol-names: trait-objects.rs#v0` timing out at bun's default 5 s under machine
  load; it is not a stop pin. Rerun alone, `symbol_names.oracle.test.ts` gives 28 pass, 0 fail. The file sets no
  per-test timeout, which is why load can trip it.
- Sample difftests as `RUST_TS_AGENT=root-f5de`, compared case by case with the base runs. No MATCH lost, no
  DIFF/CRASH/TIMEOUT.

| suite | run | result | vs base |
|---|---|---|---|
| tydump-minicore | 20261022-233021-root-f5de-34be | 46/46 MATCH | +1 MATCH (`mini_core_hello_world.rs`) |
| mirdump-minicore | 20261022-233044-root-f5de-tpkv | 45 MATCH, 1 UNPORTED | `mini_core_hello_world.rs`'s stop moved from `try_to_bits_for_ty (M4)` to `UniverseInfo::relate` |
| tydump-ui (300) | 20261022-233109-root-f5de-3o43 | 262 MATCH, 36 UNPORTED, 2 UNSTABLE | +1 MATCH (`enum-discriminant/wrapping_niche.rs`) |
| mirdump-ui (300) | 20261022-233400-root-f5de-ilv5 | 273 MATCH, 27 UNPORTED | +4 MATCH (`mir/enum/option_with_bigger_niche_break.rs`, `mir/issue-76248.rs`, `mir/mir-inlining/ice-issue-77564.rs`, `mir/mir_refs_correct.rs`) |
| borrowck-ui (300) | 20261022-233748-root-f5de-449r | 300 UNPORTED | unchanged |

  The other changes are moved stops only, mostly to `UniverseInfo::relate`, `OutlivesConstraintSet::push`,
  `CleanupPostBorrowck (pass not ported)` and metadata `Decodable for mir::Body`. These mostly come from the wave-23
  merge itself, since the base runs predate it.

## New runtime stops (for root / other lanes)

- CTFE of any **non-trivial** const now stops in `mir_borrowck` at
  `rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate` (lane bck-diag-f). Explicit discriminants
  written as non-literal expressions are included. That stub is now the main CTFE blocker.
- No `unported(...)` added. One `unported(...)` removed: the adt.ts stand-in. No new `// PORT:` decisions, apart from
  the lazy-require memo note in adt.ts, which follows the file's existing pattern.

## Files touched

`src/rustc_symbol_mangling/symbol_names.oracle.test.ts`, `src/rustc_const_eval/interpret/contract.test.ts`,
`src/rustc_const_eval/interpret/place_operand.test.ts`, `src/rustc_const_eval/interpret/operator_cast.oracle.test.ts`,
`src/rustc_const_eval/interpret/operator.ts`, `src/rustc_middle/ty/adt.ts`, `src/rustc_ty_utils/layout.test.ts`, this
handoff. No harness/ or scripts/ edits.
