# Handoff: fixer lane `fixers-55` (M7, wave 40o)

Branch `t3/fixers-55-codegen-nits`, based on `ba273e7f`. There is one commit per item, and each commit message cites its finding.

## Items

1. **done** (`e5fe67c8`, ssa-base-recheck N1). `mir/analyze_oracle/driver.ts` now takes `--ssa-out=<file>` as its first
   argument and splices it out of `process.argv`, as `base_oracle/driver.ts` does. It reads nothing from `process.env` except
   `RUST_TS_SSA_STACK`, which was already there. `analyze.test.ts` passes the flag and no longer sets `RUST_TS_SSA_OUT`. Its
   tests: 23 pass.
2. **done** (`328270c8`, root-w54-recheck N1). Comments only:
   - The header of `mir/statement.ts` now says that the three ssa-debuginfo entries are stubs and the two rvalue.rs
     entries forward to the installed methods.
   - The table comment in `statement.ts` now reads "The stubs and forwarders above".
   - The table comment in `mono_item.ts:48` now reads "The forwarders above".
3. **done** (`2b4d279b`, unused imports left by integ-w54). Removed 17 imports in 9 files, from the list
   `tsc --noUnusedLocals` gave for the assigned files:
   - attributes.ts: `BranchProtection`, `Target`
   - base.ts: `MonoItem`, `MonoItemData`
   - context.ts: `BranchProtection`
   - context.test.ts: `BranchProtection`, `PanicStrategy`, `* as context`
   - intrinsic.test.ts: `BranchProtection`, `Session`, the whole `PanicStrategy, type Target` import, `* as attributes`,
     `* as context`
   - mir/intrinsic.ts: `Span`
   - mir/operand.ts: `ConstOperand`
   - mir/place.ts: `Span`
   - mir/rvalue.ts: `ConstOperand`

   How I checked: at `7f61ad18` (the parent of `52231061`), each removed name had uses besides its import. At
   `38fbcf9c` it had none, and no later commit touched these files. Two imports are left as they were, because they were
   already unused before integ-w54:
   - `PreDefineCodegenMethods` in rustc_codegen_llvm/mono_item.ts
   - `Debug` in mir/block.ts, from the ssa-block port

   `abi_consts.test.ts` had no unused imports.
4. **done** (`478aaa5d`, root-w54-recheck N2). The new file is `src/rustc_codegen_ssa/base_unsized_info.test.ts`. It calls
   `unsize_ptr` over a logging mock backend (mir_rest.test.ts's proxy pattern), with real layouts and queries for a small
   crate. Cases:
   - `&u8 → &dyn Tr`: `get_vtable(cx, u8, Some(Tr))` makes `static_addr_of(alloc, vtable)`, then the vcall-visibility
     and debuginfo calls. The vtable is 32 bytes with align 8, and it goes into the cache. A second unsize makes no call.
   - `&dyn Sub → &dyn Sub2` (with `trait Sub: Sup + Sub2`): `load_vtable` at offset 40, that is
     `inbounds_ptradd(old, usize 40)`, `load(ptr, …, align8)`, `set_invariant_load`, `nonnull_metadata`.
   - `&dyn Sub → &dyn Sup`: no slot, so it returns `old_info` with no call.
   - The no-op casts (`dyn Sub + Send → dyn Sub`, `→ dyn Send`): they return `old_info`.

   **How I derived the expected calls.** Which arm runs and what it passes comes from reading upstream `base.rs:163-221`
   (`unsized_info`) and `:225` (`unsize_ptr`), and `meth.rs:103` (`get_vtable`) and `:126` (`load_vtable`). I checked the
   numbers against the oracle:
   - `#[rustc_dump_vtable]` on `impl Sub for u16` puts `TraitVPtr(<u16 as Sub2>)` at entry 5, and `Sup` has no vptr.
   - The `-Cno-prepopulate-passes --emit=llvm-ir` output of the same crate has these lines:
     - `up2`: `getelementptr inbounds i8, ptr %x.1, i64 40` and
       `load ptr, ptr %0, align 8, !invariant.load !12, !nonnull !12`
     - `up1`: no instruction
     - `mk`: `@vtable.0 = <{ [24 x i8], ptr }>`, align 8

   **Mutations.** I tried two temporary mutations of base.ts, then restored it with `git checkout`: `nonnull` set to false
   on the upcast, and the principal dropped from `get_vtable`. Each one failed the test.
5. **done** (`95c6e798`, ssa-operand-place N3). The lines were still at `traits/builder.ts:835`, `:836`, `:869` and `:877`.
   Each `with_type(layout)` call there now passes `self.debug_Value`. Only the failure mode changes: a failed assertion now
   crashes with exit 101 instead of stopping as unported with exit 70.
6. Two findings (`c2650fbe`):
   - **N3: no change needed.** Root already tightened this at integ-w53 (`2abd1fe3`). Every expected `TypeError` in the
     skeleton sketch now names its message, and the `build_inherent` step expects `evaluating 'Block.insts'`
     (skeleton.test.ts:256). The `expect.any(TypeError)` the review quoted is gone.
   - **N4: done.** One comment above the `with_cleanup` define-line check in `builder.test.ts` (about :389) says why
     `unnamed_addr #1` and `!guid !N` are dropped. No other edit in builder.test.ts, so llir-folder's lines 457/459/463
     are untouched apart from moving down by 2.
7. Two findings (`5d2c5672`):
   - **N1: done.** I added `// PORT:` lines for decisions 3 (`Align_max`/`Size_max`), 4 (`u128_to_le_bytes`/
     `all_equal_value`), 5 (the `assert_ne!` in `transmute_scalar`, and `throw_assert_eq_msg` in naked_asm.ts), 6
     (`debug_TargetSpecOther`), 8 (the hoisted `vector_can_bitcast`) and 12 (`template_vec.push(...template)`). These are
     comments only.
   - **N3: done.** The fixture `f` gets a trailing `_h: u16`. It is local 16, so no other local index moves. `S.c` takes
     `copy_(16)`, and the expected store is `%h:i16`, with the same offset and alignment as before.
8. Two findings (`4466a6e7`):
   - **N1: done.** `canon_sig` now captures the text after the parameter list. It reads `noreturn` and `nounwind` there,
     either inline or through the line's `#N` group (`attr_groups`), and appends `fn=[..]`. This works the same way for
     the oracle and the port, and for `define`, `declare` and `call` lines.
     - The group's other attributes still are not compared, because they come from `llfn_attrs_from_instance`. The header
       now says so.
     - What the oracle has: every `extern "C"` fn and `cc_sysv64`/`cc_win64` is `nounwind`, `r_never` is `noreturn`, and
       every call has `nounwind`.
     - Mutations: disabling the llfn `nounwind`, the callsite `nounwind`, or `noreturn` in abi.ts each failed the test. I
       restored abi.ts with `git checkout` each time.
   - **N2: done.** The spill test now checks that the port's blocks are exactly `spill_bool`, `spill_direct` and
     `spill_pair`, with lengths 4/2/3 for Pair/Direct/bool, alloca included. Then it compares the lines.
   - Not assigned, left alone: the duplicated STOPS_O1 comment line (N3), at abi_consts.test.ts:313-316.

## Checks (AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)
- `bunx tsc --noEmit -p .`: exit 0. I ran it before each commit.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26581, 44 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 404)`.
- `bun test ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`:
  **244 pass, 0 fail** across 31 files, with no SKIP lines.
- `difftest --suite mono-ui --sample 200 --jobs 6`: MATCH 200/200 (run `20261112-211417-fixers-55-r7uq`).
- `difftest --suite mir --sample 200 --jobs 6`: MATCH 200/200 (run `20261112-211548-fixers-55-h0ah`).
- Coverage, unchanged because no fn was added or removed: rvalue.rs 14/14, naked_asm.rs 6/6, traits/builder.rs 140/140,
  statement.rs 1/1, mono_item.rs 6/6.

## `unported(...)` left
None added or removed.

## `// PORT:` decisions
None new. Item 7 only tags decisions the ssa-rvalue-intrinsic handoff already recorded.

## For root
- `base_unsized_info.test.ts` is a new unit test file under `src/`. It reads `RUST_TS_AGENT` only to name its temp dir, as
  other src tests do. It writes under `$RUST_TS_DATA/tmp/base-unsized-info/` and removes that directory afterwards.
