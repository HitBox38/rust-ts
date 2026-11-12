# Handoff: stable-hash-alloc (tools batch, M7 wave 40o)

`StableHash` for `Allocation`, `ConstAllocation` and `GlobalAlloc` is now generated, along with everything they need. The stop
in cg-context's `alloc_to_backend` (`src/rustc_codegen_llvm/common.ts`, review cg-context N3) is now a real call. Without
`-Zfewer-names`, every unnamed constant allocation gets the oracle's `alloc_<hash>` name. A test compares those names with
the pinned rustc's `--emit=llvm-ir` for each kind of allocation.

Branch `t3/stable-hash-alloc`. Commit ba68406f holds the code; this handoff is its own commit.

## Route: generator (config only)

The generator needed no code change; the work is all in the configuration.

Review ssa-mir-rest N1 assumed a `hand` type could not get a generated derive. In fact the `hand` list only stops the
generator from emitting the type itself. Derive emission is governed by `stable_hash_types`, as for `Ty` and `AdtDef` in set
`rustc_middle`. Field reads that differ from `{ field }` go through `stable_hash_access`.

Changes:
- **Set `rustc_middle_mir`, `stable_hash_types`.** Adds eight derives: `GlobalAlloc` (mod.rs:255), `Allocation`
  (allocation.rs:95), `ConstAllocation` (:286), `InitMask` / `InitMaskBlocks` / `InitMaskMaterialized` (init_mask.rs:23,
  :29, :188), `ProvenanceMap` / `PointerFrag` (provenance_map.rs:36, :21). The generator's `// rustc-derive:` markers give
  the item's line, as everywhere in the generated files; the `#[derive]` lines are one above (:254, :94, :284).
- **Set `rustc_middle_mir`, new `stable_hash_access`.** Three entries:
  - `ConstAllocation::0` → `$v.internee`. The class extends `Interned`, as `AdtDef` does.
  - `InitMaskMaterialized::blocks` → the upstream `Vec<u64>`, rebuilt from init_mask.ts's two u32 words per block (PORT D6):
    `(hi << 32) | lo` as `bigint`. Each block is then hashed with `write_u64`, after the `usize` length of the slice impl.
  - `PointerFrag::bytes` (`[u8; 8]`, a `number[]` in TS) → `Uint8Array.from(..)`. There is no `[T; N]` impl upstream:
    the derive's method call `bytes.stable_hash(..)` unsizes to `[u8]`, whose impl is `stable_hash_bytes` (length, then
    `write`). The generator already maps arrays that way.
- **Set `rustc_abi`.** `stable_hash_types` gains `rustc_abi::Size` (derive at lib.rs:864, struct at :865). Its
  `stable_hash_access` maps `Size::raw` → `$v.bytes_u64()`, the exact `u64` of the hand class.
- **`stable_hash.json`.** Four entries:
  - `rustc_abi::Size` → the generated `stable_hash_Size` (rustc_abi/stable_hash.gen.ts);
  - `CtfeProvenance` → `stable_hash_CtfeProvenance` (ty/impls_ty.ts:80, the impls_ty.rs:64 manual impl);
  - `rustc_middle::ty::instance::Instance` → `stable_hash_Instance` (mono_stable_hash.gen.ts);
  - `PolyExistentialPredicate` → `stable_hash_Binder(.., stable_hash_ExistentialPredicate)`, the same form as the
    `I::BoundExistentialPredicates` entry.

Already in place and used as they were: `SortedMap` (sorted_map.ts:363, which hashes `data` as a slice of pairs), `Align`
(the inline `stable_hash_u8($v.pow2)` entry), `Mutability` (rustc_ast_ir), `Interned`, `RawList`, `Ty`, `DefId`, `Option`,
`()` (`stable_hash_unit`; `extra` is `null`) and `Box<[u8]>` (`Box` is transparent, then `[u8]`).

## Regeneration

- **Generated diff, intended additions only:**
  - `src/rustc_middle/mir_stable_hash.gen.ts`: +8 derives (2 → 10 impls) and their imports.
  - `src/rustc_abi/stable_hash.gen.ts`: +`stable_hash_Size`.
  - `src/rustc_middle/queries.gen.ts`: +1 import and 1 line. A side effect of the `Instance` entry: query
    `resolve_instance_raw` (`Result<Option<Instance>, ErrorGuaranteed>`) gets a generated `stable_hash_value` in place of
    `undefined`. Only the incremental `hash_value_fn` (rustc_query_impl/query_vtables.ts:76) reads it, and it was an
    `unported` stop there before. This is the same as `constness` in codegen-sets-m7.
- All 66 sets of `types.sets.json` were regenerated in place, with no diff outside the files above.
  - Running set `rustc_lexer` writes the stray untracked `src/rustc_lexer/lib.gen.ts` (known, codegen-sets-m7 Notes). I
    deleted it.
- The three generated files above were deleted and regenerated from scratch, and came back byte-identical.
- `--check` of every generator that has one (error_codes, features, icu-data, lints, queries, options, target-config,
  symbols, vendor-tables): all up to date. For queries: 96 `unknown`, and 146 hashed values without StableHash.
  `types.ts` has no `--check`, hence the in-place and from-scratch runs.
- Reports: `missing StableHash: 0` and no errors for both sets.

## Hand-written edits (outside tools/codegen)

- **`src/rustc_codegen_llvm/common.ts`** (cg-context's file; this one repoint was assigned to me), `alloc_to_backend` at
  common.rs:252:
  - It calls `with_stable_hashing_context` and `StableHasher::new()`, then
    `stable_hash_Allocation(alloc_, hcx, hasher, stable_hash_CtfeProvenance, stable_hash_unit, stable_hash_bytes)`: the
    derive with the default type arguments' impls. Then `finish(Hash128)`.
  - `format!("alloc_{hash:032x}")` becomes `Hash128.as_u128(hash).toString(16).padStart(32, "0")`.
    `LowerHex for Hash128` is the `u128`'s (rustc_hashes lib.rs:127), and svh.ts uses the same form.
- **`src/rustc_middle/ty/impls_ty.ts` `stable_hash_AllocId`** (impls_ty.rs:55):
  - Its stop on `GlobalAlloc`'s derive becomes `stable_hash_Option(tcx.try_get_global_alloc(self), hcx, hasher,
    stable_hash_GlobalAlloc)`.
  - The brief lists `AllocId` among the parts; every allocation with a relocation reaches this function.
  - **For root:** this file is outside the brief's list. I count it as "the hand-written impls".
- **`src/rustc_codegen_llvm/skeleton.test.ts`:** the `"rustc_middle": 1` entry is removed. Its count is now 0, and
  `toEqual` needs the key absent. A comment says why.
- **`src/rustc_codegen_llvm/abi_consts.test.ts`** (cg-abi-consts' test; **for root**, outside the brief's list):
  - Its test "without -Zfewer-names an anonymous allocation's name stops in `StableHash for Allocation`" asserted the old
    stop, so it would fail now. I replaced it with the comparison that the stop used to block: statics.rs without
    `-Zfewer-names`, all 24 global lines in order, 3 of them `@alloc_<hash>`.
  - New test `common.rs alloc_to_backend: alloc_<hash> names against the oracle`, over the new fixture
    `abi_consts_test/alloc_names.rs`. The header gains item 4.

## Evidence

**Hash test.** `alloc_names.rs` is built without `-Zfewer-names` for x86_64-unknown-linux-gnu, through cg-abi-consts'
`codegen_statics` (`predefine_static` + `codegen_static`). All of its global lines match the oracle's, in order, including
the names of its 10 anonymous allocations:

| Static | Allocation | Covers |
|---|---|---|
| `A_STR` | `"hello"` | bytes only |
| `A_PAD: &(u8, u32)` | 3 uninit padding bytes | materialized `InitMask`, one block |
| `A_BIG: &[P; 8]`, `#[repr(C)]` 12-byte `P` with padding | 96 bytes | two blocks whose 32-bit halves differ |
| `A_REF: &&u32 = &&S_U32` | relocation to a static | `AllocId` → `GlobalAlloc::Static` → `DefId` |
| `A_REFSTR: &&str` | relocation to `"hi"` (also named) | `GlobalAlloc::Memory` → `ConstAllocation` |
| `A_FN` | relocation to `target` | `GlobalAlloc::Function` → `Instance` |
| `A_DYN: &&dyn Sync` | relocation to a vtable, plus the `5u32` and the vtable themselves | `GlobalAlloc::VTable` → `Ty` + `RawList<Binder<ExistentialPredicate>>` |

- **Negative control.** I swapped the word order in the generated `InitMaskMaterialized` read; `A_PAD`, `A_BIG` and
  `A_REFSTR` then got wrong names and the test failed. Regeneration restored the file.
- **Not covered:** `GlobalAlloc::TypeId`. No fixture static reaches it in an anonymous allocation.

**Checks:**
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check --offline`: `markers ok`.
- `bun test ./src/rustc_codegen_llvm/ ./src/rustc_middle/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`:
  498 pass, 0 fail (49 files).
- `RUST_TS_REQUIRE_PROBES=1 bun test tools/codegen`: 66 pass, 0 fail.

**Sample difftests** (`--sample 200 --jobs 6`, `RUST_TS_AGENT=stable-hash-alloc`):

| Suite | Result | Run |
|---|---|---|
| mir | 200 MATCH | `20261112-211333-stable-hash-alloc-zemj` |
| mir-o2 | 200 MATCH | `20261112-211413-stable-hash-alloc-ez6g` |
| rmeta-ui | 200 MATCH | `20261112-211532-stable-hash-alloc-q18l` |

**Coverage** (`--missing`): impls_ty.rs 4/4, common.rs 43/43, allocation.rs 51/51 (generated derives carry no fn markers).

## `unported(...)` left

- None added. Removed: common.ts `rustc_middle: ... StableHash for Allocation` and impls_ty.ts
  `rustc_middle::mir::interpret::GlobalAlloc: StableHash (derive not generated)`.
- Unchanged: `stable_hash_AllocId`'s `if (tcx === undefined) unported("can't hash AllocIds during hir lowering")`.
  Upstream's `tcx.expect(..)` panics there, so a `panic` would be the faithful form. It cannot be reached under a
  `TyCtxt`, and I did not change it.

## `// PORT:` / tools decisions (for root to record)

1. **The generator route for `hand` types.** A `hand` type gets a generated `StableHash` through `stable_hash_types`, with
   `stable_hash_access` for reads that differ from upstream's fields. No hand-written impls, and no generator change.
2. **`InitMaskMaterialized.blocks`'s stable-hash read** rebuilds the `u64` blocks from init_mask.ts's u32 word pairs (D6)
   as `bigint`s.
3. **`PointerFrag.bytes`** is hashed as `[u8]` (`stable_hash_bytes` over `Uint8Array.from(..)`), following the derive's
   unsizing method call. There is no array impl upstream.
4. **`Size`'s derive is generated** in set `rustc_abi` (`raw` read as `bytes_u64()`). The existing inline `Align` entry
   stays as it is.
5. **`resolve_instance_raw`'s generated `stable_hash_value`** (queries.gen.ts) is accepted as a side effect of the
   `Instance` entry. It is incremental-only.
