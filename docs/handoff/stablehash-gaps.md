# Handoff: stablehash-gaps (plan-m5 D9, wave 31)

Branch `lane/stablehash-gaps`, base main `fb048c64`.

## Result

Every `unported_stable_hash` in the generated `stable_hash.gen.ts` files is gone (`grep -rn unported_stable_hash src` finds
nothing), and the codegen reports show `missing StableHash: 0` for every set this lane regenerated.

| suite | before (base `fb048c64`, harness-m5a) | after |
|---|---|---|
| `mir-core` | 47,734 UNPORTED (`StableHash without a TS impl`) | **47,734 / 47,734 MATCH**, 0 DIFF, 0 extra. Subject 216.5 s user, 324 s wall, 7.1 GB max RSS (oracle cached) |
| `check-core-bin` | UNPORTED at the `(ValidityRequirement, PseudoCanonicalInput<Ty>)` QueryKey (since fixed by gaps-30c, not by this lane) | UNPORTED at `rustc_metadata::fs::encode_and_write_metadata (metadata encoding; plan-m5 waves 32-33)`. So all of `analysis` on core finishes without a stop. Subject 191.7 s user, 248 s wall, 7.6 GB max RSS (budget 12 GB) |

The heavy runs went one at a time, after another lane's `check-core-bin` run had finished. No gate was running. Runs:
`$RUST_TS_DATA/runs/20261029-211037-root-f5de-vgpy` (mir-core) and `20261029-211602-root-f5de-jdr7` (check-core-bin).

Samples (`RUST_TS_AGENT=root-f5de`, 300 each). Nothing was lost:

| suite | before | after |
|---|---|---|
| mir | 297 MATCH, 1 UNPORTED (`const-generics/transmute-fail.rs`: `rustc_abi::Size beyond 2^53`), 2 UNSTABLE (oracle ICEs) | identical |
| tydump-ui | 298 MATCH, 2 UNSTABLE | identical |
| hir-tree | 300 MATCH | identical |

Logs: `$RUST_TS_DATA/tmp/stablehash-gaps/{before,after}-*.log`.

## The gaps

The plan counted 13 `unported_stable_hash` lines. That number includes the helper declarations. There were 7 call sites over
6 types:

| gap | where it was used | fix |
|---|---|---|
| `rustc_target::asm::InlineAsmReg`, `InlineAsmRegClass` | rustc_hir `InlineAsmRegOrRegClass` (hir.rs:3620-3621) | set `rustc_target_asm` gets `derive_stable_hash` with `stable_hash_types` = these two, generating the new `src/rustc_target/stable_hash.gen.ts`. The per-arch payload enums (`def_reg_class!` / `def_regs!` in mod.rs:28 / :77, `#[derive(.., rustc_macros::StableHash)]`) are hashed by a new `stable_hash` on the `def_reg_class` / `def_regs` helpers in `asm/mod.ts`: `mem::discriminant` as `isize`, with no fields to hash. `stable_hash.json` maps each `<Arch>InlineAsmReg[Class]` to `<T>.stable_hash($v, $hcx, $h)`, as serialize.json does for `.decode` |
| `rustc_ast::expand::typetree::TypeTree` | rustc_attr_ir `AutoDiffItem.inputs` / `.output` | `Kind`, `TypeTree`, `Type` (typetree.rs, all `derive(StableHash)`) added to set `rustc_ast`'s `stable_hash_types`, plus a stable_hash.json entry |
| `rustc_middle::mir::BinOp`, `UnOp` | `ty::ExprKind` (consts/kind.rs:14-15) | set `rustc_middle_mir` gets `derive_stable_hash`, `stable_hash_types` [UnOp, BinOp] and `stable_hash_module: "mir_stable_hash"`, generating the new `src/rustc_middle/mir_stable_hash.gen.ts`. The other two rustc_middle StableHash modules belong to other sets, so this set needs its own module. Plus stable_hash.json entries |
| `rustc_middle::ty::abstract_const::CastKind` | `ty::ExprKind::Cast` (kind.rs:17) | set `rustc_middle` (`derive_only`) gets `ty/abstract_const.rs` in its `files` and `CastKind` in `stable_hash_types`, generating `stable_hash_CastKind` in `rustc_middle/stable_hash.gen.ts`. Plus a stable_hash.json entry |

## Files touched

- `tools/codegen/types.sets.json`: sets rustc_target_asm, rustc_ast, rustc_middle_mir, rustc_middle (see above), plus their notes.
- `tools/codegen/stable_hash.json`:
  - the two `PORT: pending` asm entries now point at the generated impls;
  - 40 per-arch asm entries;
  - entries for TypeTree, mir UnOp / BinOp, and CastKind.
- `tools/codegen/type_fold.test.ts`: the rustc_ty golden pinned `missing_stable_hash` to [BinOp, UnOp, CastKind]. It now expects `{}`. The pinned impl counts did not change.
- `src/rustc_target/asm/mod.ts` (hand-written):
  - `stable_hash` on `DefRegClass` / `DefRegs` and in the `def_reg_class` / `def_regs` helpers, with `rustc-derive` markers mod.rs:28 / :77;
  - `stable_hash` added to the `StubRegClass` / `StubReg` interfaces.
- Regenerated:
  - `src/rustc_target/stable_hash.gen.ts` (new);
  - `src/rustc_middle/mir_stable_hash.gen.ts` (new);
  - `src/rustc_{ast,attr_ir,hir}/stable_hash.gen.ts`;
  - `src/rustc_middle/{stable_hash,ty_stable_hash}.gen.ts`.

  No other generated file changed. All seven affected sets were regenerated, and every other output was byte-identical.

## Checks

- `bunx tsc --noEmit -p .` is clean.
- `bun scripts/coverage.ts --check`: markers ok. `--missing compiler/rustc_target/src/asm/mod.rs`: 33/33.
- `bun test tools/codegen`: 51 pass.
- `bun test src/rustc_target`: 13 pass.
- `bun test src/rustc_middle src/rustc_hir src/rustc_attr_ir src/rustc_ast`: 1183 pass, 0 fail.

## unported / PORT

- New `unported`: the stub arch modules (amdgpu, arm, avr, bpf, csky, hexagon, loongarch, m68k, mips, msp430, nvptx,
  powerpc, riscv, s390x, sparc, spirv, xtensa) get `stable_hash` through their existing `stub_impls` Proxy, so it calls
  `unported("rustc_target::asm::<arch>::<Type>::stable_hash")`. rust-ts has no targets for those architectures, so this
  cannot be reached. Amdgpu's real types (`AmdgpuInlineAsmRegClass` amdgpu.rs:15, `AmdgpuRegStart`, `AmdgpuInlineAsmReg` :273)
  are data-carrying derives and stay with the unported amdgpu module.
- `// PORT:` decisions:
  - none new. The helper `stable_hash` follows the existing `decode` pattern of the same helpers (lane key-value), which
    already has `rustc-derive` markers.
  - The macro-generated fieldless enums cannot be generated by tools/codegen: the typedefs probe does not see them. This
    is the same situation as Decodable.

## For root

- `mir-core` is at 100% (47,734 / 47,734). It is still unprotected; it can be protected once harness-m5b's review fixes land
  (decision 2026-10-29T11:39).
- The next stop of `check-core-bin` is the metadata encoder (`encode_and_write_metadata`), which plan-m5 schedules for waves
  32-33. So analysis of all of core now runs through. Subject cost: 192 s user and 7.6 GB.
- No harness/scripts/baseline changes.
