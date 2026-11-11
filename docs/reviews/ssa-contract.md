APPROVE WITH NITS

# Review: ssa-contract (M7 wave 40, contract lane): rustc_codegen_ssa `traits/*`, `common.rs`, `base.rs` predicates

Branch `t3/port-ssa-contract-traits` at `467f2b1b` (one commit on merge-base `b3b29e88`). I compared it against the pinned
upstream (`6f5da406`) `compiler/rustc_codegen_ssa/src/traits/*.rs`, `common.rs`, `base.rs:58-85`, and the struct and enum
shapes in `mir/{place,operand,mod,debuginfo}.rs`, `back/{write,lto}.rs` and `lib.rs` that the stubs mirror. I worked
read-only, from a detached worktree of `467f2b1b`.

## Evidence (re-run by the reviewer)
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (25279; vendor 5311; library 728)`.
- `bun test ./src/rustc_codegen_ssa/common.test.ts`: 33 pass, 0 fail (61 expects).
- `bun test ./src/std/result.test.ts`: 3 pass, 0 fail.
- `back/link.test.ts`, `back/archive.test.ts`, `rustc_interface/interface.test.ts` (the tests that touch the moved
  `CodegenBackend`): 8 pass, 0 fail.
- `--missing` for each file: abi 1/1, asm 3/3, backend 20/20, builder 140/140, consts 25/25, coverageinfo 1/1,
  debuginfo 14/14, declare 2/2, intrinsic 10/10, misc 10/10, mod 0/0, statics 3/3, type_ 43/43, write 11/11, common
  7/7. These match the handoff.
- Sample difftests, `RUST_TS_AGENT=review-ssa-contract`, `--sample 200 --jobs 6`, on AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-113133-review-ssa-contract-nd33`.
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-113317-review-ssa-contract-16jt`.

  This is a different sample from the lane's. The `CodegenBackend` move and the new run-time imports of `base.ts`
  change no output and break no module-load order.

## 1. Fidelity
- **`BuilderMethods` provided methods**: all 29 checked line by line against builder.rs:97-576. Each calls the same
  required or provided methods, in the same order, through `self`, and keeps upstream's `self.cx().x()` vs `self.x()`
  distinction:
  - `three_way_compare` and `unreachable_nonterminator` go through `cx()`; `typed_place_copy_with_flags` and
    `assume_nonnull` use the deref form.
  - `unchecked_suadd`/`susub`/`sumul` delegate to `unchecked_sadd`/`ssub`/`smul`, not to `add`/`sub`/`mul`. This
    matters because cg_llvm overrides the latter set.
  - `typed_place_copy_with_flags`: the three asserts and their texts (including upstream's "unsigned" typo), then
    nontemporal → `-O0` scalar/SIMD → non-ZST memcpy. The memcpy branch calls `typetree_from_ty`, then
    `add_indirection`, builds `FncTree { args: [clone, tt], ret: new }`, then `const_usize(size)`, then the scalable
    vector `vscale * bytes` hack.
  - `typed_place_swap`: same order as upstream.
  - `assume_integer_range`: `u128::wrapping_sub` is `BigInt.asUintN(128, ..)`.
  - The three `assert_eq!(place.llextra, None)` keep core's message, via `debug_Value`.
  - `cast_float_to_int`: the `assert_matches!` pattern text equals `stringify!`.
- **`type_.rs`**: all of `DerivedTypeCodegenMethods` (`type_int` with its `bug!` text, `type_from_integer`/`float`/
  `primitive`/`scalar`, `type_needs_drop`/`is_sized`/`is_freeze` via `tcx_()`/`typing_env_()`) and the four no-op
  `TypeMembershipCodegenMethods` defaults are faithful. `is_backend_immediate`, which the brief names, is not in
  `type_.rs` at this pin. Nothing is missing.
- **`common.rs`**, all of it:
  - The five enums have their variants in upstream order, with `Debug`.
  - `build_langcall` goes `require_lang_item` → `Instance::mono` → `fn_abi_of_instance(.., List::empty())` →
    `get_fn_addr(.., pointer_authentication_functions())`.
  - `shift_mask_val`: `!val as i64` is `-1 - val`, which is correct for `u64`.
  - `asm_const_to_str`: `asIntN` per width; `Isize` is `unreachable!`.
  - `asm_const_ptr_clean`: `TypeId` → `from_u64(offset)`; the ZST `Memory` guard; `align + offset` as a wrapping `u64`
    (`asUintN(64)`), then `truncate_to_target_usize` via `PointerArithmetic_provided`. That is correct: upstream's
    blanket `impl<T: HasDataLayout> PointerArithmetic for T` has no overrides.
  - `is_using_dlltool` and `i686_decorated_name` match upstream, including the `(_, Some(NoPrefix))` and
    `(false, Some(Undecorated))` arm order and the `else if` static arm.
  - The no-op `StableHash` impl is a valid `rustc-skip` (incremental).
  - The brief's "`IntPredicate`/`RealPredicate`/`AtomicOrdering` mappings" do not exist in `common.rs` at this pin:
    the `from_generic` mappings live in cg_llvm. Nothing is missing.
- **`base.rs` predicates**: `bin_op_to_icmp_predicate` (:58) has its 10 `(op, signed)` arms in order and the `bug!`
  text with `{:?}`. `bin_op_to_fcmp_predicate` (:74) has its 6 arms and `bug!`. Both are faithful and complete.
- **Required signatures** in all 13 files match upstream, in order, with correct markers. I checked every parameter
  list, `Option`, `&[T]`, tuple returns, `&mut usize` → `MutRef<number>`, and `&Option<Range<Size>>` → pair or
  `undefined`. The integer-width choices are consistent and recorded (PORT 6).
- **Stub type shapes** match upstream: `PlaceValue`, `PlaceRef`, `OperandValue`, `OperandRef`, `IntrinsicResult`,
  `VariableKind`, `ModuleCodegen`, `MemFlags` (VOLATILE 1, NONTEMPORAL 2, CAPTURES_READ_ONLY 8), `RetagInfo`,
  `RetagFlags`, `ThinModule`, `ThinShared`, `SerializedModule`, `FatLtoInput`, `ThinLtoInput`,
  `TargetMachineFactoryConfig` and `TargetMachineFactoryFn`.
- I found nothing guessed. The one local stand-in that returns a value, `pointer_authentication_functions`, is exactly
  upstream's `pointer_auth_config.as_ref().and_then(..)` on the `None` branch, and stops with `unported` otherwise.

## 2. The representation
I wrote a sketch (reviewer scratch, not committed). It fully `implements` `ConstCodegenMethods<LlvmTypes>`,
`IntrinsicCallBuilderMethods<LlvmTypes>` and `DebugInfoBuilderMethods<LlvmTypes>` with concrete classes. It implements
`BuilderMethods<LlvmTypes, CodegenCx>` with real members checked against the interface (the rest by declaration
merging). It assigns the class to `BuilderMethodsStatic<LlvmTypes, CodegenCx, Builder>`, and writes generic ssa code:
`Bx_.build(cx, llbb)`, `bx.cx(): Cx`, `bx.cond_br_with_expect(..)`, `bx.unchecked_suadd(..)`.
- **`implements` without casts: yes.** That includes the `this`-typed `with_move_annotation<R>(.., f: (self: this) => R)`
  and the `readonly debug_*` members.
- **Override dispatch: faithful.** At run time, the provided `unchecked_suadd` reached the builder's *overriding*
  `unchecked_sadd`, and `cond_br_with_expect` called `expect`, then `cond_br`. No provided helper calls another helper
  directly. I grepped the diff for `_provided.x(`: the only hit is `PointerArithmetic_provided` (blanket impl, correct).
  A backend that overrides a member and forwards the rest gets upstream's default-method semantics.
- **`BuilderMethodsStatic` split: sound.** The class's static side satisfies it, and generic code threads `Bx_` where
  upstream names the type `Bx`. `BuilderMethods<B, Cx>` is assignable to the helpers' `BuilderMethods<B>`, because `Cx`
  appears only covariantly (`cx(): Cx`).
- **Erasure:** these traits have no associated consts. The only trait objects are `Box<dyn Any>` (→ `unknown`) and
  `MetadataLoaderDyn` (unchanged). `InlineAsmOperandRef<'tcx, Self>` → `<B>` keeps `B["BasicBlock"]`. Nothing a fill
  lane needs is lost.
- **`Deref<Target = CodegenCx>` as `extends CodegenMethods<B>`** gives generic code exactly what upstream's bound
  allows (`Bx::CodegenCx: CodegenMethods`). The cost is roughly 100 forwarders on the LLVM `Builder` (N1).

## 3. Stubs
- Every call from the traits into wave-41 code is a typed stub. I grepped the diff for `unported(`: 6 calls. The 4
  `ssa-operand-place` stubs each name their lane, file and fn. The handoff's per-lane table is complete; I found no
  other cross-lane call.
- **`typetree_from_ty` is on the hello-world path, as claimed.** cg_llvm does not override `typed_place_copy*` (no such
  fn in `rustc_codegen_llvm/src/*.rs`). So every non-ZST typed copy at `-O`, and every non-scalar one at `-O0`, reaches
  the stub. It stops at its first line, while upstream returns `TypeTree::new()` unless `-Zautodiff=Enable`.
  `rustc_middle/src/ty/typetree.rs` is counted in coverage (0/4). Recommendation in N3.

## 4. Out-of-list edits
- **The `CodegenBackend` move is behaviour-neutral.**
  - The interface has the same members as the stand-in, and the provided bodies are identical.
  - `stand_ins.ts` now holds only a re-export. Its three implementors and every importer are unchanged.
  - `backend.ts` imports `stand_ins.ts` for types only, so there is no run-time cycle.
  - My two difftests show 200/200.

  The lane added helpers for `print`/`has_zstd`/`has_mnemonic`/`provide` but kept them off the interface, as in the
  stand-in (PORT 9).
- `lib.ts` and `back/lto.ts` gained only type surfaces, with headers that name ssa-base. The `base.ts` additions are
  the two faithful fns above.

## Findings (must fix)
None.

## Nits
- **N1** `src/rustc_codegen_ssa/traits/backend.ts:61-68`: for cg-contract, a class that forwards to a `<Trait>_provided`
  helper must declare `declare readonly __backend_types?: LlvmTypes;`, or pass the type argument explicitly
  (`X_provided.f<LlvmTypes>(this, ..)`). Without either, `B` is not inferred from `this` and tsc fails. Sketch:
  `ConstCodegenMethods_provided.scalar_to_backend(this, ..)` in a class without the field gives TS2345, "'SketchCx' is
  not assignable to 'ConstCodegenMethods<BackendTypes>' ... 'Debug<LFunc>' is not assignable to 'Debug<unknown>'".
  Either fix typechecks. Suggest one line in the backend.ts header or handoff.
- **N2** `src/rustc_codegen_ssa/mir/mod.ts:22`: `IntrinsicResult` has no companion const with a frozen `WroteIntoPlace`
  singleton (PORTING §5), unlike `OperandValue.ZeroSized` and `VariableKind.LocalVariable`. ssa-mir-core can add it.
- **N3** `src/rustc_codegen_ssa/traits/builder.ts:48` (`typetree_from_ty` stub): recommend that **ssa-operand-place**
  owns `compiler/rustc_middle/src/ty/typetree.rs` (4 fns, about 230 lines, `typetree_from_fn`/`typetree_from_ty`/
  `handle_indirection`/`typetree_from_ty_impl_inner`). That lane already gates the same provided method, and
  `-Zautodiff` is parsed (`rustc_session/options.ts:1279`). It must land before any IR or native case of a program with
  a non-ZST typed copy can pass. Then replace the local stub with an import.
- **N4** `src/rustc_codegen_ssa/common.ts:188` and `traits/misc.ts` (`PointerAuthSchema = never`): the local helper is
  correct but belongs in rustc_session. `Session.pointer_auth_config` is typed `unknown`
  (`rustc_session/session.ts:350`). A rustc_session lane should port `PointerAuthConfig`/`PointerAuthSchema` and the
  three accessors (session.rs:1267-1277), then repoint the imports.
- **N5** `src/rustc_codegen_ssa/mir/place.ts`, `mir/operand.ts`: `PlaceValue`, `PlaceRef` and `OperandRef` (upstream
  `Copy`) have mutable `public` fields. ssa-operand-place should choose and record a policy: either `readonly` fields,
  or a copy wherever upstream copies and then mutates a local. Without one, a write to a "copy" aliases the original.

## PORT decisions for root to record
1. Associated types → a type record `B extends BackendTypes`, used as `B["Value"]`. `WriteBackendMethods`' types are
   `W extends WriteBackendTypes`, and `ExtraBackendMethods::Module` is `M` (plan-m6 D3 pattern).
2. `CodegenObject`'s `Debug` → run-time `BackendTypesOf<B>.debug_*` members. Backend-object equality is `===`.
3. `BuilderMethods<'a,'tcx>` → `BuilderMethods<B, Cx>`, and `Deref<Target = CodegenCx>` → `extends CodegenMethods<B>`,
   so the LLVM `Builder` forwards cx members.
4. No-`self` associated fns: `build`/`append_block` → `BuilderMethodsStatic` (the class's static side, passed as
   `Bx_`). `WriteBackendMethods`' no-`self` fns → members called on the backend value.
5. `HasTyCtxt::tcx()`/`HasTypingEnv::typing_env()` → `tcx_()`/`typing_env_()` in provided bodies (layout-contract).
6. Integer widths: `i64`/`u64`/`u128` constant constructors, `const_to_opt_*`, `type_array` len,
   `write_operand_repeatedly` count and `switch` case values are `bigint`. Bit widths, lengths, field indices and the
   vtable offset are `number`.
7. `impl ExactSizeIterator` → a readonly array. `&Option<Range<Size>>` → `[Size, Size] | undefined`.
8. `CodegenBackend`'s `print`/`has_zstd`/`has_mnemonic`/`provide` are helpers only, not interface members.
9. Bitflags (`MemFlags`, `RetagFlags`) → `number` + companion, with `Debug` deferred.
10. A forwarding class declares `__backend_types` for `_provided` inference (N1).
11. `rustc_middle/src/ty/typetree.rs` assigned to ssa-operand-place (N3), if root agrees.
