# Independent re-check: root's fix commits on `integ-w54` (wave 40n)

I am the reviewer, read-only on code. I checked root's two fix commits on `integ-w54` after `c72e7fbd`, merged into this
worktree:

- `38fbcf9c` ("root-w54-check findings 1-4"), which changes `base.ts`, `mono_item.ts` and `builder.test.ts`;
- `bb93c95e` ("base.ts header: meth.rs is no longer a stub"), which changes only `base.ts:13`.

I checked them against `docs/reviews/root-w54-check.md` (`8e645726`, findings 1–4). Upstream was read from
`$RUST_TS_DATA/rust` at `6f5da406`.

## Verdict: APPROVE WITH NITS

All four findings are fixed. The two new nits below are stale comments of the same kind as finding 2, plus an optional
test gap. Neither blocks.

## Re-check of findings 1–4

1. **Finding 1 (meth.rs stubs in `unsized_info`): fixed.**
   - **Arguments.** The calls at `src/rustc_codegen_ssa/base.ts:284` and `:291` match base.rs:209 and :214-219.
     - `load_vtable(bx, old_info, bx.type_ptr(), vtable_byte_offset, source, true)` has the same receiver, the same
       arguments and the same order. Upstream calls it bare (`load_vtable`); this calls `lazy_meth().load_vtable`.
     - `get_vtable(cx, source, principal.map(|p| bx.tcx().instantiate_bound_regions_with_erased(p)))` maps to the
       `principal === undefined ? undefined : …` form.
     - Both targets are meth.ts's real ports: `get_vtable` at meth.ts:120 (meth.rs:103) and `load_vtable` at meth.ts:141
       (meth.rs:126).
   - **Offset type.** `entry_idx * ptr_size.bytes()` is correct.
     - `Size.bytes()` returns a `number` (`src/rustc_abi/lib.ts:1137`).
     - meth.ts's `load_vtable` takes `vtable_byte_offset: number` (meth.ts:146). `VirtualIndex` computes its offset the
       same way, `this._0 * ptr_size.bytes()` (meth.ts:52, :74).
     - Upstream's `u64::try_from(entry_idx).unwrap()` cannot fail for a `usize`.
     - A vtable slot index times the pointer size stays far below 2^53, so PORTING §5's `u64` → `number` rule applies.
       The `// PORT:` note at base.ts:281-282 says exactly this and is accurate.
   - **Lazy require.** `lazy_meth` (base.ts:1438-1441) has the same shape as `lazy_mir`, `lazy_mir_operand`,
     `lazy_infer_*` and the other lazy loaders: a memoised `require` typed `typeof import(…)`. meth.ts does not import
     base.ts, so there is no cycle to break. The `require` only keeps meth.ts and what it imports
     (`rustc_symbol_mangling/lib.ts`, `rustc_middle/mir/interpret`, …) off lib.ts's startup load order, under plan-m7 D14,
     which base.ts's header names. It is a pure load-order device and changes no behaviour.
   - **Leftover stubs.** I grepped `src/rustc_codegen_ssa/` and `src/rustc_codegen_llvm/` for:
     - `meth_load_vtable` / `meth_get_vtable`: gone;
     - `no lane yet` and `no lane owns`;
     - `not landed`;
     - `unported("` with a landed lane's prefix (ssa-mir-rest, ssa-mir-core, ssa-base, ssa-block,
       ssa-rvalue-intrinsic, ssa-operand-place, cg-abi-consts, cg-intrinsic-a, cg-context);
     - comments that mention `stub` together with a landed lane or file.

     No stub that stops for a landed lane remains. Every remaining match belongs to a lane that has not landed:
     - `lib.ts:458/463` `OutputFilenames::temp_path*_for_cgu`, which still stop in `rustc_session/config.ts:1397`;
     - ssa-debuginfo (mod.ts, block.ts, statement.ts);
     - ssa-write (base.ts's `ssa_write` table);
     - cg-intrinsic-b (`intrinsic.ts:2076`);
     - `place.ts:45`, a Debug-format stop and not a lane stub.

     Two stale comments remain; see nit N1.
   - **The base.ts header comment.** Line 13 (`bb93c95e`) now reads "meth.rs's `load_vtable` / `get_vtable`
     (ssa-mir-rest) are read lazily (`lazy_meth`; root at integ-w54, they were stubs)". That is correct, and it matches
     how intrinsic.ts:8-9, rvalue.ts:12, place.ts:18 and operand.ts:14 record their own repoints. The old section header
     "Cross-lane stubs" became "Not ported (stops)" (base.ts:1443). That is accurate for what follows it,
     `get_resident_set_size` / `print_time_passes_entry` and the `ssa_write` table.
2. **Finding 2 (mono_item.ts header): fixed.** `src/rustc_codegen_ssa/mono_item.ts:10-12` now says the three base.rs /
   naked_asm.rs functions are reached through `mono_item_xlane`, whose entries forward to them. That matches
   mono_item.ts:29-46. (`:48`'s "The stubs above" is part of nit N1.)
3. **Finding 3 (allocator test): fixed, and proven by mutation.**
   - `src/rustc_codegen_llvm/builder.test.ts:692-695` wraps `Session.prototype.must_emit_unwind_tables` in a recorder.
     `:704` asserts `uwtable_calls` equals `[false]`, so the call ran once and returned `false`.
   - `uwtable_calls` is declared after `sess`, at :698, but it is only read when the method runs, so there is no TDZ
     problem.
   - **Mutation.** I temporarily replaced `src/rustc_codegen_llvm/attributes.ts:573`'s `if (sess.must_emit_unwind_tables())`
     with `if (false as boolean)`. `bun test ./src/rustc_codegen_llvm/builder.test.ts -t "allocator::codegen"` then
     failed: 0 pass, 1 fail, `Expected - 3 / Received + 1` on the `toEqual([false])`.
   - **Revert.** I reverted with `git checkout -- src/rustc_codegen_llvm/attributes.ts`. `git status` was clean, and the
     same test passed again (1 pass).
4. **Finding 4 (casts): fixed.** The `cx as never` casts at mono_item.ts:30 and :45 are gone, and `bunx tsc --noEmit -p .`
   exits 0. The forwarding is now type-checked.

## Regressions

- `git diff --stat c72e7fbd integ-w54` touches only `builder.test.ts` (+9/−3), `base.ts` (−11 net) and `mono_item.ts`
  (header and casts). Nothing in `harness/`, `scripts/`, `docs/` or any baseline changed.
- No check was weakened.
  - builder.test.ts keeps both earlier expectations, `toThrow(/unstable_opts/)` and the shim's `declare` line, and adds
    one. The `expect()` count went from 71,854 to 71,855.
  - The only `unported(...)` literals removed are the two meth.rs stubs. They had no `<lane>:` prefix, so
    skeleton.test.ts's `EXPECTED` counts are unaffected, and that test passes.

## New findings

- **N1 (nit): stale stub comments in two files.** These are the same kind of problem as finding 2. Neither review
  flagged them before.
  - `src/rustc_codegen_ssa/mir/statement.ts:6-9` still says mir/rvalue.rs `codegen_rvalue` and
    `codegen_rvalue_operand` (ssa-rvalue-intrinsic) are "typed module-private stubs … Root repoints each to the owner's
    method at integration". Since `c72e7fbd` they forward to the installed methods (statement.ts:44-53). Only the three
    ssa-debuginfo entries are still stubs.
  - `statement.ts:55` and `src/rustc_codegen_ssa/mono_item.ts:48` call their tables "The stubs above". In mono_item.ts
    every entry is now a forwarder, and in statement.ts two of the five are.
  - Suggested fix: reword them as `mir/mod.ts:17-20` does ("Entries whose owner has not landed … are typed stubs; the
    entries of landed owners forward …").
- **N2 (optional): no unit test reaches `unsized_info`'s `Dynamic` arms (base.ts:276-296).**
  rvalue_intrinsic.test.ts:433 covers only the `Array`→`Slice` arm, and mir_rest.test.ts calls `meth.get_vtable`
  directly. So the repointed calls at base.ts:284/:291 are checked by tsc and by reading, not by a run.
  - A mock-backend case unsizing `&u8` to `&dyn Trait` (to reach `get_vtable`) and a trait upcast with a
    `supertrait_vtable_slot` (to reach `load_vtable` with `slot * 8`) would pin the wiring.
  - The backend is not registered, so nothing protected reaches these lines. This does not block.

## Commands

The worktree was on AC power (`pmset`: "Now drawing from 'AC Power'"), with `RUST_TS_REQUIRE_PROBES=1`,
`RUSTUP_AUTO_INSTALL=0` and `bun install --frozen-lockfile`. HEAD was `bb93c95e`, merged.

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | exit 0 (`markers ok (26581, …)`) |
| `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/rustc_session/ ./src/rustc_middle/ ./scripts/lib/unit-steps.test.ts` | 821 pass, 0 fail, 0 skip, 71,855 `expect()` calls, 84 files |
| mutation: `attributes.ts:573` call removed, allocator test only | 0 pass, 1 fail (reverted; then 1 pass) |
