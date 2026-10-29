verdict: APPROVE-WITH-NOTES

Reviewer: independent read-only review of `lane/stablehash-gaps` (`git diff main...lane/stablehash-gaps`, 12 files).

## What I checked

- **Upstream derives:**
  - `InlineAsmReg` (mod.rs:290-291) and `InlineAsmRegClass` (:492-493) are both `#[derive(StableHash)]`. Their variant orders differ: `Amdgpu` comes before `AArch64` in Reg, and after it in RegClass. The generated `InlineAsmReg__discriminant` (Amdgpu 2, AArch64 3) and `InlineAsmRegClass__discriminant` (AArch64 2, Amdgpu 3) follow each enum's own order. `Err` is 20 in both and hashes no field.
  - `Kind` (typetree.rs:27), `TypeTree` (:42) and `Type` (:75, fields `offset: isize, size: usize, kind, child` in that order) match.
  - `UnOp` (syntax.rs:1613; Not, Neg, PtrMetadata) and `BinOp` (:1631; 26 variants, Add..Offset) match in order and count.
  - `CastKind` (abstract_const.rs:13; As, Use) matches.
  - The `ty::ExprKind` call sites now call the right impls.
- **Asm helpers:**
  - Upstream does not use `impl_stable_hash_via_hash!` here. Both macros put `rustc_macros::StableHash` in the derive list: `def_reg_class!` at mod.rs:28, `def_regs!` at :77.
  - `rustc_macros/src/stable_hash.rs:97-101` makes an enum's derive emit `::std::mem::discriminant(self).stable_hash(..)`, followed by the per-variant field body. These enums have no fields, so the body is empty.
  - `StableHash for mem::Discriminant` (rustc_data_structures stable_hash.rs:522) is `Hash::hash`, which is `write_isize` of the declaration index when there is no `#[repr]`.
  - The TS `stable_hash_Discriminant(index)` defaults to `isize`, and the index is the declaration-order position, the same one `decode` and `discriminant` already use. Correct.
  - Wasm's empty `def_regs!` enum can never be hashed, as upstream.
  - Amdgpu's types are not macro-generated (amdgpu.rs:14-15, :272-273, direct `derive(StableHash)`). They correctly go through the stub Proxy and reach `unported(...)`.
- **Markers:** `bun scripts/coverage.ts --check` reports markers ok. The `rustc-derive` lines point at the right upstream lines.
- **Generator / config:** `tools/codegen/types.ts` is unchanged; only `types.sets.json` and `stable_hash.json` changed.
  - In a scratch worktree I regenerated all seven affected sets (rustc_target_asm, rustc_middle_mir, rustc_middle, rustc_ast, rustc_ty, rustc_hir, rustc_attr_ir). `git status` stayed clean, so the committed `.gen.ts` files are exactly what the generator produces.
  - Every set's report shows `missing_stable_hash: {}`.
  - `git grep unported_stable_hash -- src` finds nothing.
- **Harness:** nothing under `harness/`, `scripts/` or `harness/baseline` changed.
- **Checks:** `bunx tsc --noEmit -p .` is clean. `bun test tools/codegen src/rustc_target`: 63 pass, 1 fail (see note 3).
- **Samples (spot checks):**
  - `difftest --suite mir --filter asm/x86_64`: 23/23 MATCH. 22 are protected, so one case is new and none was lost.
  - `difftest --suite hir-tree --filter asm/`: 135/135 MATCH; all 135 are protected.
  - The handoff's sample claims are plausible. The change only replaces paths that used to call `unported`, so it cannot turn a previous MATCH into anything else.

## Findings

1. `tools/codegen/type_fold.test.ts:56-59`, non-blocking: the expectation change is legitimate.
   - The golden used to pin the rustc_ty set's `missing_stable_hash` to [BinOp, UnOp, CastKind]. It now expects `{}`, which is a stronger check.
   - My regenerated rustc_ty report confirms `{}`.
   - The pinned impl counts are unchanged, which is consistent: the new impls live in other sets' modules.
   - This is not expectation tampering.
2. `src/rustc_target/asm/mod.ts:153-157` (`def_reg_class` `stable_hash`), non-blocking nit: it uses `classes.indexOf(self)`, which would quietly hash `-1` for a value that is not a class. The `def_regs` helper uses `by_reg.get(self)![1]` instead. Both give correct results for every valid value, and an invalid value cannot be built from typed code. Optional: share one discriminant lookup (or build a map) so a bad value fails loudly.
3. `tools/codegen/serialize.test.ts:232`, non-blocking, not this lane: in a worktree under `.data/tmp/` the "hand types" golden fails. The cause is the relative paths it computes into the OS temp dir (`../../../codegen-serialize-…`). It fails the same way with `main` checked out in that worktree, so it is pre-existing and depends on where the checkout lives. The lane's "51 pass" was run from the main checkout. Root may want a follow-up so this test does not depend on the checkout's location.
4. `docs/handoff/stablehash-gaps.md`, non-blocking: the claims I could check hold:
   - asm/mod.rs coverage 33/33 (markers ok);
   - no new `// PORT:`;
   - the only new `unported` paths are the stub-arch `stable_hash` methods.

   I did not re-run the heavy `mir-core` (47,734/47,734) and `check-core-bin` numbers, as instructed. Root should treat them as lane-reported until a gate or harness run confirms them.
