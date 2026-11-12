# Review: stable-hash-alloc (tools batch, wave 40o)

**Verdict: PASS WITH NOTES.** No must-fix (F) findings. Four nits (N1–N4).

**Reviewed:** branch `t3/stable-hash-alloc`: `ba68406f` (code) and `1f746a45` (handoff), against `main` at `ba273e7f`
(`git diff ba273e7f..1f746a45`), merged into the review worktree. Upstream is the pin `6f5da406b56c`
(`$RUST_TS_DATA/rust`, read-only). Run on AC power, with `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0` and
`RUSTC_ICE=0`.

## 1. Generated impls against upstream's `#[derive(StableHash)]`

The derive (`rustc_macros/src/stable_hash.rs:100,118`) hashes `mem::discriminant(self)`, then each field in declaration
order through a method call, `#bi.stable_hash(..)`. None of these items carries `#[stable_hash(..)]` attributes.

| Generated (`mir_stable_hash.gen.ts`, `rustc_abi/stable_hash.gen.ts`) | Upstream | Result |
|---|---|---|
| `stable_hash_GlobalAlloc` | `mir/interpret/mod.rs:254`: `Function{instance}`, `VTable(Ty, &List<PolyExistentialPredicate>)`, `Static(DefId)`, `Memory(ConstAllocation)`, `TypeId{ty}` | discriminants 0–4 in this order; field hashes match (`RawList` + `Binder<ExistentialPredicate>` for the list) |
| `stable_hash_Allocation` | `allocation.rs:94`: `bytes, provenance, init_mask, align, mutability, extra` | same order. `align` is the existing inline `Align` entry, `stable_hash_u8(pow2)`, which is `Align { pow2: u8 }`'s derive (rustc_abi lib.rs:1102). `Mutability` is `Not`=0, `Mut`=1 (rustc_ast_ir lib.rs:232). |
| `stable_hash_ConstAllocation` | `allocation.rs:284`: `ConstAllocation(pub Interned<'tcx, Allocation>)` | the `Interned` impl, then `Allocation<CtfeProvenance, (), Box<[u8]>>`, the default type arguments |
| `stable_hash_InitMask` | `init_mask.rs:22`: `blocks: InitMaskBlocks, len: Size` | matches |
| `stable_hash_InitMaskBlocks` | `init_mask.rs:28`: `Lazy { state: bool }`=0, `Materialized(..)`=1 | matches |
| `stable_hash_InitMaskMaterialized` | `init_mask.rs:187`: `blocks: Vec<Block>` (`u64`) | `Vec` → `[T]`: `usize` length, then each `u64` (see §2) |
| `stable_hash_PointerFrag` | `provenance_map.rs:20`: `idx: u8, prov: Prov, bytes: [u8; 8]` | matches (see §2 for `bytes`) |
| `stable_hash_ProvenanceMap` | `provenance_map.rs:35`: `ptrs: SortedMap<Size, Prov>, bytes: Option<Box<SortedMap<Size, PointerFrag<Prov>>>>` | `SortedMap` hashes `data` (sorted_map.rs:350); `Box` is transparent (stable_hash.rs:410); `Option` matches |
| `stable_hash_Size` | rustc_abi `lib.rs:864`: `struct Size { raw: u64 }` | `write_u64` of the exact `bytes_u64()` (a `bigint`, rustc_abi/lib.ts:1145) |

Markers: `// rustc-derive:` names the item's line (mod.rs:255, allocation.rs:95 and :286, init_mask.rs:23, :29 and
:188, provenance_map.rs:21 and :36, lib.rs:865), one below the `#[derive]`. This is the generator's usual form.
`coverage --check` passes.

## 2. The three accessors

- **`ConstAllocation::0` → `$v.internee`: correct.** Upstream's `impl StableHash for Interned<'_, T>`
  (`rustc_data_structures/src/intern.rs:88`) is `self.0.stable_hash(..)`: the referent alone, with no pointer or id. The
  port's `stable_hash_Interned` (intern.ts:101) is the identity wrapper, and `ConstAllocation.internee` is the interned
  `Allocation` (allocation.ts:801). The generated call passes `CtfeProvenance`, `()` and `[u8]` impls, the default
  arguments.
- **`InitMaskMaterialized::blocks`: correct.** init_mask.ts PORT D6 (lines 3–4, and `block_or` / `block_and_not` /
  `block_set` at :125–140) stores `blocks[2k]` = bits 0..32 and `blocks[2k+1]` = bits 32..64, each in `0..2^32`. The read
  `(BigInt(blocks[2k+1]) << 32n) | BigInt(blocks[2k])` is therefore the u64 block. `stable_hash_Vec` →
  `stable_hash_slice`: `write_usize(len)` (the block count, `blocks.length / 2`), then `write_u64` per block. This is
  `Vec<T>` → `self[..]` → `[T]` (stable_hash.rs:357, :341). `u64` has no slice specialisation; only `[u8]` does. The
  `BigInt(__v)` around an already-`bigint` value is redundant but harmless (generator form).
- **`PointerFrag::bytes` as `[u8]`: correct.** At the pin there is no `StableHash` impl for `[T; N]` anywhere in
  `compiler/` or `library/` (grep `StableHash for \[` finds only stable_hash.rs:341 `[T]` and :350 `[u8]`; the only
  `const N` impl is `SmallVec<[A; N]>`, :393). The derive's method call on the `&[u8; 8]` binding therefore resolves by
  method probing's final unsize step to `[u8]`. The specialised impl (:350) writes the `usize` length (8), then the
  bytes. `stable_hash_bytes(Uint8Array.from(..))` (stable_hash.ts:405) does the same. The fixture has no pointer
  fragments, so this route is untested, but it follows from the code.

## 3. New `stable_hash.json` entries and the `queries.gen.ts` side effect

- `rustc_abi::Size` → the generated `stable_hash_Size`: matches the derive (§1).
- `CtfeProvenance` → `stable_hash_CtfeProvenance` (impls_ty.ts): upstream's manual impl hashes `into_parts()`
  (`ty/impls_ty.rs:64`). The entry points at the existing port of that impl.
- `Instance` → `stable_hash_Instance` (mono_stable_hash.gen.ts): the existing generated derive (`ty/instance.rs`), which
  hashes `def` then `args`.
- `PolyExistentialPredicate` → `stable_hash_Binder(.., stable_hash_ExistentialPredicate)`: the alias is
  `Binder<'tcx, ExistentialPredicate<'tcx>>`. Same form as the existing `I::BoundExistentialPredicates` entry.
- **`resolve_instance_raw`: confined to the incremental and feed paths.** Upstream hashes this query
  (`queries.rs:2713`, no `no_hash`), so a generated `stable_hash_value` is right. `stable_hash_value` is read only by
  `hash_value_fn` (rustc_query_impl/query_vtables.ts:76). That `hash_value_fn` is called from three places, and none
  runs in a non-incremental session for this query:
  - `check_feedable_consistency` (execution.ts:214), guarded by `query.feedable`, and `resolve_instance_raw` is
    `feedable: false`;
  - `query_feed` (calls.ts:222), for fed queries only;
  - `DepGraph.with_task` / `with_feed_task` (dep_graph/graph.ts:96, :149), which ignore it when the graph is disabled.

## 4. `impls_ty.ts` `stable_hash_AllocId`

Upstream (`ty/impls_ty.rs:54–61`): `tcx.expect(..)`, then `tcx.try_get_global_alloc(*self).stable_hash(hcx, hasher)`,
an `Option<GlobalAlloc>`. The port now calls `stable_hash_Option(tcx.try_get_global_alloc(self), hcx, hasher,
stable_hash_GlobalAlloc)`. `Option`'s impl is a `u8` tag of 0 or 1, then the value (stable_hash.ts:518). The port
matches upstream. See N4 for the unchanged `expect` line.

## 5. Regeneration

- **`--check`.** All up to date: error_codes, features, icu-data, lints, queries (96 unknown, 146 hashed values without
  StableHash, as the handoff says), options, target-config, symbols and vendor-tables.
- **From scratch.** I deleted `src/rustc_middle/mir_stable_hash.gen.ts`, `src/rustc_abi/stable_hash.gen.ts` and
  `src/rustc_middle/queries.gen.ts`, then regenerated them with sets `rustc_middle_mir` and `rustc_abi`, and with
  `queries.ts`. All three came back byte-identical (`git status` clean). The reports show `missing StableHash: 0` and
  `errors: []`.
- **All 66 sets of `types.sets.json`, in place.** No tracked file changed. The only output is the known stray untracked
  `src/rustc_lexer/lib.gen.ts` (codegen-sets-m7 Notes), which I deleted.

## 6. Tests

- **Oracle names.** I copied `alloc_names.rs` to scratch and ran the pinned `rustc +nightly` (1.101.0-nightly 6f5da406b)
  on it from a relative path, with `--target x86_64-unknown-linux-gnu --emit=llvm-ir -Cno-prepopulate-passes
  -Ccodegen-units=1 -Copt-level=0` and no `-Zfewer-names`. The output has 10 `@alloc_<32 hex>` globals. All `@` lines
  are identical to a run from the test's absolute path, so the path does not enter the hash. The test then compares
  the port's lines with this oracle (`toEqual`, with the never-matching `/(?!)/g` pattern, so no names are
  anonymised): 7/7 pass in `abi_consts.test.ts`.
- **The negative control is real.** I swapped the two words in the generated `InitMaskMaterialized` read. The new test
  failed with wrong names for `A_PAD`, `A_BIG`, `A_REFSTR` and `A_DYN`, and for the vtable allocation (see N1). I
  restored the file with `git checkout`, and the tree was clean. The fixture's `A_BIG` makes the halves differ, as
  claimed: `P` has a 12-byte period and 32 mod 12 ≠ 0.
- **The changed `abi_consts.test.ts` still tests what it did, and more.** The `-Zfewer-names=yes` comparison (line 459)
  is unchanged. The old test only asserted that the stop was reached. Its replacement compares all 24 global lines of
  `statics.rs` without `-Zfewer-names`, 3 of them `alloc_<hash>`, so it is strictly stronger. The `skeleton.test.ts`
  count change (`rustc_middle` 1 → absent) matches the removed stop.
- `bun test ./scripts/lib/unit-steps.test.ts`: 10 pass, 0 fail.

## 7. Commands

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check --offline` | `markers ok` |
| `bun test ./src/rustc_codegen_llvm/ ./src/rustc_middle/ ./src/std/result.test.ts` | 488 pass, 0 fail (48 files) |
| `bun test tools/codegen` | 66 pass, 0 fail |

The 488 here plus unit-steps' 10 make the handoff's 498.

The hand-written `alloc_to_backend` (`src/rustc_codegen_llvm/common.ts:323`) follows `common.rs:252–258` line for line.
`alloc_` is `alloc.inner()` (common.rs:230), and `{hash:032x}` is `LowerHex` of the `u128`
(`rustc_hashes/src/lib.rs:127`), which `as_u128(..).toString(16).padStart(32, "0")` reproduces.

## Findings

- **N1 (nit, docs).** `docs/handoff/stable-hash-alloc.md:100` says the negative control broke the names of `A_PAD`,
  `A_BIG` and `A_REFSTR`. In my rerun it also broke `A_DYN` and the vtable allocation (`@alloc_bab78e…`). `A_DYN`'s
  `&dyn` pair is written in two parts, so its init mask is materialized, as `A_REFSTR`'s is. The evidence is stronger
  than reported; correct the list.
- **N2 (nit, comment).** `src/rustc_codegen_llvm/abi_consts.test.ts:20`: header item 4 lists the relocations to a
  static, to another allocation and to a fn, but leaves out the vtable relocation (`A_DYN`, `GlobalAlloc::VTable`,
  upstream `mir/interpret/mod.rs:262`). The fixture covers that case and the test asserts it.
- **N3 (coverage gap, already noted in the handoff).** The `GlobalAlloc::TypeId` arm
  (`src/rustc_middle/mir_stable_hash.gen.ts:52`; upstream `mir/interpret/mod.rs:270`) and `PointerFrag`
  (`provenance_map.rs:20`) have no test. No fixture static reaches them. Both are mechanical derive output, and §1 and
  §2 checked them by reading. They are low risk, but a later fixture should cover them: a `TypeId` in a const, and a
  partially copied pointer.
- **N4 (pre-existing, not introduced here).** `src/rustc_middle/ty/impls_ty.ts:71` stops with `unported("can't hash
  AllocIds during hir lowering")`. Upstream (`ty/impls_ty.rs:58`) uses `tcx.expect(..)`, a panic. The faithful form is a
  `panic`/`expect`, not `unported`. It cannot be reached under a `TyCtxt`, and the handoff already reports it. This is
  for root's queue, not a blocker.
