# Handoff: key-value (wave 26): cross-cutting blockers found in wave 25

Branch `lane/key-value`, base `b20ed316` (integ-w25, with mt-inline, meta-mir, driver-m4 and harness-w25 merged). No
merges. Commits:
- `b4c93726`: the `ty::Value` query key;
- `b8c05b34`: the inline-asm metadata decoders;
- `aaddfc19`: `Const::try_to_target_usize` as `bigint` (huge-static.rs);
- this handoff.

## 1. `QueryKey for ty::Value` (`valtree_to_const_val`)
- `src/rustc_middle/query/keys.ts`: new `KEY_Value` (keys.rs:397, `default_span` = `DUMMY_SP`). Its cache key is
  `intern_key`, as for the other keys holding interned values.
- `tools/codegen/queries.config.json`: maps `rustc_middle::ty::Value` to it. `queries.gen.ts` is regenerated; the only
  change is `valtree_to_const_val.key`, and no stray `rustc_lexer/lib.gen.ts` appeared.
- The provider already existed and was wired (`rustc_const_eval/lib.ts`, `valtree_to_const_value` with
  `TypingEnv::fully_monomorphized()`).
- Results:
  - **KPL `cases/bounds.rs`** now runs to completion and its stderr and exit code equal rustc's. The pin
    (`STOP_VALTREE_KEY`) is gone; bounds.rs is now an ordinary `HAND` oracle case that also checks "index out of bounds:
    the length is 3 but the index is 5". `known_panics_lint.oracle.test.ts`: 3/3 pass.
  - **cg_clif mini_core.rs / mini_core_hello_world.rs**:
    - mirdump-minicore and tydump-minicore: both MATCH (they never reached KPL);
    - mir-minicore (`-Zunpretty=mir`): both get past KPL and now stop later in `analysis`, in the late lint pass
      `ImproperCTypes`. `improper_ctypes.ts:89 cache_key` → `tcx.type_id_hash(ty)` → `rust-ts: unported:
      rustc_middle::ty::Ty: StableHash (ty/impls_ty.rs) under StableHashState::while_hashing_spans`
      (rustc_middle ty/util.ts:204). This is a known stop, already pinned by `rustc_lint/types.oracle.test.ts`. Owner:
      StableHash of `Ty` (rustc_middle / codegen stable_hash).

## 2. Inline-asm operands from crate metadata
- The per-arch enums are macro-generated, so the probe cannot see them. Their `derive(Decodable)` is now a `decode` on
  the helpers that port the macros, in `src/rustc_target/asm/mod.ts`:
  - `def_reg_class` (mod.rs:28) and `def_regs` (mod.rs:77). Both use `decode_fieldless_enum`, which is serialize.rs
    `decodable_body` for a fieldless enum: a `read_u8` tag below 255 variants, else `read_usize`; 0 or 1 variants and
    the panic text are handled as upstream.
  - The stub arch modules get `decode` through `StubReg` / `StubRegClass`, so it is `unported(...)` like their other
    fns.
- New codegen set **`rustc_target_asm`** (types.sets.json): derive_only, generating `src/rustc_target/decodable.gen.ts`
  with `decode_InlineAsmReg`, `decode_InlineAsmRegClass` and `decode_InlineAsmRegOrRegClass`.
  - These values are interned (asm/mod.ts header), so the generator gained **per-variant `decodable_construct`** in
    `tools/codegen/types.ts`:
    - a key `<type key>::<Variant>` builds that variant, e.g. `InlineAsmReg.X86($0)`;
    - the construct is emitted in a block, because the `const`s of the different `case`s share the switch's scope.
  - No other set uses such keys, so no other generated file changes.
- `serialize.json`:
  - `InlineAsmRegOrRegClass` points at the generated decoder;
  - each of the 40 per-arch types gets an entry with template `<T>.decode($D)`, as a value from asm/mod.ts.
- The `rustc_middle_mir` set is regenerated. `syntax.gen.ts` now calls `decode_InlineAsmRegOrRegClass`, so its
  `unported_decodable` helper is gone (the MIR set has no `missing_decodable` left).
- `rmeta_mir.oracle.test.ts`:
  - **The `MAX_ASM_STOPS` cap is removed**: any decode error now fails the test.
  - New checks:
    - every In/Out/InOut register operand in core's bodies names an x86 register or class;
    - the number of bodies holding one is pinned exactly (`ASM_REG_BODIES = 38`, the 38 that used to stop);
    - the extern-MIR oracle comparison gets an `asm_ops` fn in the aux crate covering `out(reg)`, `in(reg)`,
      `inout(reg) =>`, `lateout(reg_byte)`, `in("eax")`, `out("xmm0") _` and `inout("ecx") => _`. Its rendering equals
      rustc's `-Zunpretty=mir`.
  - Decode counts: core optimized_mir 24504 (24466 + 38), mir_for_ctfe 19994, promoted 29324, trivial consts 1999. The
    registers seen are `"ax" "cx" "dx" kreg reg reg_byte xmm_reg ymm_reg zmm_reg`.
  - I added a `300_000` ms timeout to the core/alloc test: it takes 8-10 s, which exceeds bun's 5 s default under load.

## 3. `tests/ui/limits/huge-static.rs` exit code
- **Cause.** After the first E0080, building the MIR of `MY_TOO_BIG_ARRAY_2` (`[0x00; 1 << 61]`) called
  `Const::try_to_target_usize`, which ICEd. It returned a `number`, with a panic above 2^53, so the run ended with a
  101 ICE instead of the second E0080 and exit 1. The first ICE was in `as_rvalue` `Repeat`; once that was fixed, the
  next one was in borrowck `type_check` `Rvalue::Repeat`.
- **Fix.** I retyped the method to upstream's `u64`: `Const.try_to_target_usize(tcx): bigint | undefined` (ty/consts.ts
  and the decls.ts declaration), per PORTING §5. The PORT note there had asked root for this retype. All 33 call sites
  are adjusted:
  - comparisons use `0n` / `1n` / `BigInt(x)`. Mixed `<` / `>` with `number`s were already correct.
  - where the callee still takes a `number`, the value goes through the new `src/rust_ts/u64.ts` `u64_to_number(n,
    what)`, which ICEs above 2^53 as before, but only at those sites. The callees are:
    - `Ty::new_array`;
    - `open_drop_for_array`;
    - `prefix_slice_suffix`;
    - pattern_analysis `Slice` / `ConstructorSet::Slice`;
    - simd size;
    - inline-asm size;
    - `MustUsePath::Array`;
    - the diag args `ConsiderSpecifyingLength` / `plural_len`;
    - the E0527 / E0528 lengths;
    - move-path subslice length;
    - the field count in `try_destructure_mir_constant_for_user_output`;
    - the `report_similar_impl_candidates` sort key.
  - `pat_b.test.ts`: the mock returns a `bigint`.
- **Result.** huge-static.rs, `--suite mir --filter tests/ui/limits/`: **MATCH** (stdout, stderr and exit 1 identical).
- Still CRASH, exactly as on the base: `limits/huge-array-simple-64.rs` and `limits/issue-15919-64.rs`. They used to
  ICE in `Const::try_to_target_usize` and now ICE at `u64_to_number` (`ConstructorSet::Slice`) in
  rustc_pattern_analysis, whose `array_len` is a `usize` but a TS `number`. Owner: rustc_pattern_analysis. It needs a
  `bigint` `Slice.array_len` (and `SliceKind::FixedLen` where it holds an array length).

## Files touched
- **rustc_middle**: query/keys.ts, queries.gen.ts, mir/syntax.gen.ts (gen), ty/consts.ts, ty/decls.ts,
  mir/statement.ts, ty/{inhabitedness/mod,inhabitedness/inhabited_predicate,layout,print/pretty,sty,util}.ts.
- **rustc_target**: asm/mod.ts, decodable.gen.ts (new, gen).
- **tools/codegen** (please review): queries.config.json, serialize.json, types.sets.json, types.ts.
- **Tests**:
  - rustc_mir_transform/known_panics_lint.oracle.test.ts;
  - rustc_metadata/rmeta/rmeta_mir.oracle.test.ts;
  - rustc_hir_typeck/pat_b.test.ts.
- **New glue**: src/rust_ts/u64.ts.
- **One- or two-line call-site edits in other lanes' files**:
  - rustc_const_eval const_eval/mod.ts;
  - rustc_hir_analysis check/check.ts;
  - rustc_hir_typeck {pat, inline_asm, fn_ctxt/suggestions}.ts;
  - rustc_lint unused/must_use.ts;
  - rustc_mir_build {builder/expr/as_rvalue, builder/matches/match_pair}.ts;
  - rustc_mir_dataflow move_paths/builder.ts;
  - rustc_mir_transform {elaborate_drop, known_panics_lint, promote_consts, coroutine/layout}.ts. None of these is an
    mt-opt1 pass file.
  - rustc_pattern_analysis rustc.ts;
  - rustc_trait_selection {error_reporting/infer/mod, error_reporting/traits/{fulfillment_errors, suggestions},
    traits/query/dropck_outlives}.ts.

## Coverage
- keys.rs: 56/63. The 7 left are the other `key_unported` keys: `(Ty, VariantIdx)`, `(LocalExpnId, &TokenStream)`,
  `(ValidityRequirement, ..)`, `(Instance, CollectionMode)`, and the canonical-input variants.
- asm/mod.rs: 33/33.
- ty/consts.rs: 14/14.
- `coverage.ts --check`: markers ok (22251; vendor 4351).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- Unit tests:
  - `bun test --timeout=300000` over rustc_middle, rustc_metadata, rustc_mir_transform, rustc_const_eval, rustc_target,
    rustc_hir_typeck, rustc_pattern_analysis, rustc_trait_selection, rustc_lint, rustc_mir_build, rustc_mir_dataflow,
    rustc_hir_analysis, rustc_symbol_mangling and tools/codegen: **1501 pass, 0 fail**;
  - the oracle tests above pass with `RUST_TS_REQUIRE_PROBES=1`.
- Sample difftests, `RUST_TS_AGENT=root-f5de`, run ids `kv-<suite>`. Compared case by case with the w26-common base runs
  (and mir-minicore with harness-w25's `hw25-mir-minicore-port`): **no MATCH lost, 0 DIFF, 0 CRASH, 0 TIMEOUT**.

  | suite | MATCH / total | non-MATCH (all the same status in the base run) |
  |---|---|---|
  | tydump-minicore | 46/46 | |
  | mirdump-minicore | 46/46 | |
  | mir-minicore (all) | 40/46 (base 37) | 2 cg_clif at `Ty: StableHash` (above), 4 `LowerSliceLenCalls` |
  | tydump-ui `--sample 300` | 295 | 2 `hash_result`, 1 `IntoDiagArg`, 2 UNSTABLE |
  | mirdump-ui `--sample 300` | 300/300 | |
  | borrowck-ui `--sample 300` | 286 | 12 `polonius_engine::AllFacts::default`, 1 `LowerSliceLenCalls`, 1 `NonGenericOpaqueTypeParam` |

  The 3 mir-minicore gains come from driver-m4 (`pretty::print (Mir: needs a TyCtxt)` in the base run), not from this
  lane. Comparison script: `$RUST_TS_DATA/tmp/kv/cmp.ts`.

## `unported(...)` left / new runtime stops
- None added. The stub arch modules' `decode` is `unported("rustc_target::asm::<arch>::<Type>::decode")` through
  `stub_impls`; their targets cannot be selected.
- Moved stops:
  - cg_clif mir-minicore now stops at `Ty: StableHash` (improper_ctypes);
  - the two `limits/*-64.rs` crashes now happen at `u64_to_number (ConstructorSet::Slice)`.

## PORT decisions (please record)
1. `KEY_Value` hashes with `intern_key`: `{ ty, valtree }`, both interned.
2. The per-arch `derive(Decodable)` is a `decode` on the `def_reg_class` / `def_regs` helpers: the enums are
   `macro_rules!` types the probe cannot see. The outer enums are generated by the new `rustc_target_asm` set, using
   per-variant `decodable_construct` (`<key>::<Variant>`) so that decoded values are the interned singletons.
3. `Const::try_to_target_usize` returns `bigint` (upstream `u64`). Callers whose callee takes a `number` use
   `rust_ts/u64.ts` `u64_to_number`, an ICE above 2^53 rather than an inexact value. `ConstValue::try_to_target_usize`
   and `Const::try_eval_target_usize` (mir/consts.ts) still return `number`, with their own guard.
4. `rmeta_mir.oracle.test.ts`: the core/alloc decode test gets a 300 s timeout. The cap becomes an exact count plus an
   x86 check per register operand.

## For root / other lanes
- Review the tools/codegen changes (types.ts per-variant construct, the new set, 41 serialize.json entries) and the
  cross-crate call-site edits listed above.
- rustc_pattern_analysis: a `bigint` array length unblocks `limits/huge-array-simple-64.rs` and
  `limits/issue-15919-64.rs`.
- StableHash of `Ty` (`type_id_hash`) is next for both cg_clif files under `-Zunpretty=mir`.
