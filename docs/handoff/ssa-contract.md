# Handoff: ssa-contract (M7, plan-m7 wave 40, ✱ contract-first): rustc_codegen_ssa `traits/*` and `common.rs`

Branch `t3/port-ssa-contract-traits` (from `b3b29e88`; no merges).

## Summary
- All of `compiler/rustc_codegen_ssa/src/traits/*` (13 files) and `common.rs`, in upstream order with markers.
  **290/290 fns**, which includes the 10 `traits/backend.rs` fns ported earlier in `rustc_interface/stand_ins.ts`, now
  moved here.
- Each trait is a TS interface over `B extends BackendTypes`, with associated types erased to that type record (the
  plan-m6 D3 pattern). Provided methods live in `<Trait>_provided` helpers (PORTING §8), and the interfaces keep
  `// (provided)` placeholders. `cg-contract` can `implements CodegenMethods<LlvmTypes>` / `BuilderMethods<LlvmTypes,
  CodegenCx>` and forward the provided members.
- Wherever the traits call into code a wave 41 fill lane will port, there is a typed stub that calls
  `unported("<fill lane>: <upstream path> <fn>")`, or a type surface. They sit **in the file that lane will own**, so
  each fill lane edits only its own files and the traits' imports are already final (list below).
- Also ported, from `base.rs`: `bin_op_to_icmp_predicate` (:58) and `bin_op_to_fcmp_predicate` (:74). The brief names
  them as test targets, and `BuilderMethods::three_way_compare` calls the first. With these, `base.rs` is 10/28.

## Files touched
New (this lane's files):
- `src/rustc_codegen_ssa/traits/{mod,abi,asm,backend,builder,consts,coverageinfo,debuginfo,declare,intrinsic,misc,statics,type_,write}.ts`
- `src/rustc_codegen_ssa/common.ts`, `src/rustc_codegen_ssa/common.test.ts`

New stub files, each owned by a wave 41 fill lane, which replaces the content (headers say so):
- `src/rustc_codegen_ssa/mir/place.ts`, `mir/operand.ts` (ssa-operand-place)
- `src/rustc_codegen_ssa/mir/mod.ts` (ssa-mir-core)
- `src/rustc_codegen_ssa/mir/debuginfo.ts` (ssa-debuginfo)
- `src/rustc_codegen_ssa/back/write.ts` (ssa-write)

Edited, outside the strict assignment (reasons below):
- `src/rustc_interface/stand_ins.ts`: the `CodegenBackend` interface and `CodegenBackend_provided` moved to
  `traits/backend.ts`. stand_ins.ts now re-exports both, so none of its importers changed (miri.ts,
  rust_ts/codegen_backend.ts, rustc_interface/util.ts, driver, tests). Its unused imports are removed. Reason: the brief
  says "do not duplicate", and the stand-in's header says to replace it with the real module once ported.
  `TargetConfig`, `IncrCompSession` and `WorkProductMap` stay there.
- `src/rustc_codegen_ssa/lib.ts` (ssa-base's file): adds the type surface `ModuleCodegen<M>` (fields only), `MemFlags`
  and `RetagFlags` (bitflags as number + companion, the rustc_span `RemapPathScopeComponents` form, no Debug yet) and
  `RetagInfo<V>`. The header comment now says so.
- `src/rustc_codegen_ssa/back/lto.ts` (ssa-base's file): adds the type surface `ThinModule<W>` (fields only),
  `ThinShared<W>` and `SerializedModule<M>`.
- `src/rustc_codegen_ssa/base.ts` (ssa-base's file): ports `bin_op_to_icmp_predicate` and `bin_op_to_fcmp_predicate`,
  with markers, before `wants_wasm_eh`. It now imports `./common.ts` and `rustc_middle/mir/syntax.ts` at run time.

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| upstream file | ported |
|---|---|
| traits/abi.rs | 1/1 |
| traits/asm.rs | 3/3 |
| traits/backend.rs | 20/20 |
| traits/builder.rs | 140/140 |
| traits/consts.rs | 25/25 |
| traits/coverageinfo.rs | 1/1 |
| traits/debuginfo.rs | 14/14 |
| traits/declare.rs | 2/2 |
| traits/intrinsic.rs | 10/10 |
| traits/misc.rs | 10/10 |
| traits/mod.rs | 0/0 |
| traits/statics.rs | 3/3 |
| traits/type_.rs | 43/43 |
| traits/write.rs | 11/11 |
| common.rs | 7/7 (one is a `rustc-skip`: the no-op `StableHash for ModuleCodegen`, :106, incremental) |
| base.rs | 10/28 (was 8/28) |

- `bun scripts/coverage.ts --check`: `markers ok (25279; vendor 5311; library 728)`.
- `--order` is report only. The new files' rows all come from the interface / `_provided` split that PORTING §8
  allows. Required methods sit in the interface and provided ones in the helper, so each helper restarts the upstream
  order. The one extra row is `BuilderMethodsStatic` (`build` :80, `append_block` :88), which comes before the
  interface.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/rustc_codegen_ssa/common.test.ts`: **33 pass, 0 fail** (61 expects, 0.3 s). It covers:
  - every arm of `bin_op_to_icmp_predicate` (12 (op, signed) pairs) and `bin_op_to_fcmp_predicate` (6), plus the
    `bug!` text for a non-comparison;
  - `shift_mask_val`, integer and vector, inverted and not, plus its `bug!`;
  - `asm_const_to_str`: unsigned, ptr/ref/fn ptr, i8/i16/i32/i128 sign reinterpretation, and isize normalized at 32
    and 64;
  - `asm_const_ptr_clean`: no provenance, `TypeId`, and the provenance-keeping arms;
  - `is_using_dlltool`;
  - `i686_decorated_name`: every calling convention, MSVC vs MinGW, the three `PeImportNameType` arms, statics and
    thread-locals (including the `else if` arm that ignores `add_prefix`), and `\x01`.

  Upstream has no tests for these. Each expectation is read off the upstream source, cited per case. The ZST-`Memory`
  arm of `asm_const_ptr_clean` has no test: it needs a real `TyCtxt` for `truncate_to_target_usize`.
- `bun test ./src/std/result.test.ts`: 3 pass.
- The tests that touch the moved `CodegenBackend` (`back/link.test.ts`, `back/archive.test.ts`,
  `rustc_interface/interface.test.ts`): 8 pass.
- Sample difftests (base.ts and stand_ins.ts load at startup and gained imports): see "Sample difftests" below.

## Stubs and type surfaces per fill lane
Stubs (fns calling `unported("<lane>: <path> <fn>")`) carry no marker; the fill lane replaces each with the port.
"Surface" means a type the traits name in a signature, given its upstream fields (constructors take every field in
declaration order) or, where noted, an opaque placeholder.

| fill lane | fn stubs | type surfaces |
|---|---|---|
| **ssa-operand-place** | **4**: `PlaceValue.with_type` (place.rs:60), `PlaceRef.alloca` (place.rs:111), `OperandValue.store` (operand.rs:1005), `OperandValue.store_with_flags` (operand.rs:1029) | `PlaceValue<V>`, `PlaceRef<V>` (classes, fields), `OperandValue<V>` (full union + `ZeroSized` singleton), `OperandRef<V>` (class, fields) |
| **ssa-mir-core** | 0 | `IntrinsicResult<V>` (mir/mod.rs:164, full union) |
| **ssa-debuginfo** | 0 | `VariableKind` (mir/debuginfo.rs:30, full union) |
| **ssa-base** | 0 (its `bin_op_to_*_predicate` are ported, not stubbed) | lib.ts: `ModuleCodegen<M>` (fields; `new_regular`, `new_allocator`, `into_compiled_module` left), `MemFlags`, `RetagInfo<V>`, `RetagFlags` (`Debug` of the bitflags left). back/lto.ts: `ThinModule<W>` (fields; `name`, `cost`, `data` left), `ThinShared<W>`, `SerializedModule<M>` |
| **ssa-write** | 0 | back/write.ts: `TargetMachineFactoryConfig`, `TargetMachineFactoryFn<W>`, `FatLtoInput<W>`, `ThinLtoInput<W>` (upstream shapes); `ModuleConfig`, `CodegenContext`, `SharedEmitter` (**opaque branded placeholders**, never constructed) |
| ssa-rvalue-intrinsic | 0 | none: the traits do not call into rvalue.rs, intrinsic.rs or naked_asm.rs |
| ssa-block | 0 | none |

Dependency order this shows: ssa-operand-place blocks the provided `typed_place_copy_with_flags` (`-Copt-level=0`
scalar path) and `typed_place_swap`. Every other provided method of the traits runs today, given a backend.

### Not owned by any M7 lane (root to assign)
- **`rustc_middle::ty::typetree::typetree_from_ty`** (rustc_middle/src/ty/typetree.rs:43, 229 lines): a local typed
  stub in `traits/builder.ts` calls `unported("rustc_middle::ty::typetree::typetree_from_ty (...no M7 lane yet)")`.
  `typed_place_copy_with_flags` calls it on its `memcpy` path, which every non-ZST typed copy takes at `-O`, and every
  non-scalar one at `-O0`. **It will stop ir-hello-class cases.** Its first lines return `TypeTree::new()` unless
  `-Zautodiff=Enable`. It fits ssa-operand-place or a small rustc_middle lane. Once ported, replace the local stub with
  an import.
- **`rustc_session::Session::pointer_authentication_functions`** (session.rs:1271) and **`PointerAuthSchema`**
  (session.rs:118) are not on the TS `Session`. `common.ts` has a local, unmarked helper: `None` when
  `sess.pointer_auth_config === undefined`, which is always the case in the port (only `Pauthtest` targets build a
  config, and that path stops), and `unported(...)` otherwise. `traits/misc.ts` exports `type PointerAuthSchema =
  never`. Both belong in rustc_session/session.ts (a rustc_session lane); then point the imports there.
- `rustc_middle::dep_graph::WorkProduct`: `traits/write.ts` exports `type WorkProduct = never` (incremental is out of
  scope; rustc_middle mono.ts says it is not ported).

## Every `unported(...)` left
- `traits/builder.ts` `typetree_from_ty`: `"rustc_middle::ty::typetree::typetree_from_ty (rustc_middle/src/ty/typetree.rs, no M7 lane yet)"`
- `common.ts` `pointer_authentication_functions`: `"rustc_session::Session::pointer_authentication_functions (PointerAuthConfig)"`
  (only when a pointer-auth config exists, which never happens in the port today)
- `mir/place.ts`: `"ssa-operand-place: compiler/rustc_codegen_ssa/src/mir/place.rs with_type"`, `"... place.rs alloca"`
- `mir/operand.ts`: `"ssa-operand-place: compiler/rustc_codegen_ssa/src/mir/operand.rs store"`, `"... operand.rs store_with_flags"`

## `// PORT:` decisions (for root to record)
1. **Associated types → a type record (plan-m6 D3).** `BackendTypes` holds only associated types, so its TS form is
   `interface BackendTypes { Function; BasicBlock; Funclet; Value; Type; FunctionSignature; DIScope; DILocation;
   DIVariable }`. A trait `X: BackendTypes` is `X<B extends BackendTypes>`, and `Self::Value` is `B["Value"]`.
   `InlineAsmOperandRef<'tcx, B>` is `InlineAsmOperandRef<B>`. `WriteBackendMethods`'s associated types are the
   record `WriteBackendTypes` (`W`), and `ExtraBackendMethods::Module` is the type parameter `M`.
2. **`CodegenObject = Copy + Debug`**: `Copy` is erased. The `Debug` impls are run-time members of
   `BackendTypesOf<B>` (`debug_Function`, `debug_Value`, `debug_Type`, `debug_FunctionSignature`), which every trait
   interface over `B` extends. The `assert_eq!(place.llextra, None)` messages use `debug_Value`. `PartialEq`/`Eq`/`Hash`
   on backend objects is `===` (the IR model uniques them).
3. **`BuilderMethods<'a, 'tcx>` → `BuilderMethods<B, Cx = CodegenMethods<B>>`.** `Deref<Target = Self::CodegenCx>` is
   realised by the interface **extending `CodegenMethods<B>`**, so `bx.type_i8()`, `bx.const_usize()` and `bx.sess()`
   read as upstream. The LLVM `Builder` forwards those members to its `cx`. (The alternative, `bx.cx().type_i8()` at
   every call site, would make every fill lane rewrite hundreds of upstream lines.)
4. **Associated fns without `self`.** `BuilderMethods::build`/`append_block` are `BuilderMethodsStatic<B, Cx, Bx>`, the
   static side of the implementing class. Generic code takes it as `Bx_` where upstream writes `Bx::build(cx, llbb)`
   (PORTING §5: pass trait functions for generic code). `WriteBackendMethods`' no-`self` fns stay on the one interface,
   called on the backend value standing for `B` (the `QueryTypeOp` descriptor pattern): upstream `B::codegen(..)` →
   `B_.codegen(..)`.
5. **`CodegenMethods` alias**: `LayoutOf<TyAndLayout, never> & FnAbiOf<TyAndLayout, never, FnAbi<Ty>, never> & ...`
   (rustc_middle ty/layout.ts's `R, E, FR, FE`; `Error = !`). `HasTyCtxt::tcx()` is `tcx_()` and
   `HasTypingEnv::typing_env()` is `typing_env_()` (layout-contract), so provided bodies write `self.tcx_()`.
6. **Integer widths (PORTING §5).**
   - `bigint`: `const_i64`, `const_int`, `const_u64`, `const_u128`, `const_usize`, `const_uint`, `const_uint_big`, the
     `const_to_opt_*` results, `type_array`'s `len`, `write_operand_repeatedly`'s `count`, and `switch` case values. They
     take any value of their type.
   - `number`: `int_width` (a bit width), `vector_length`, `float_width`, `vector_splat`'s count,
     `extract_value`/`insert_value`'s field index, and `type_checked_load`'s vtable offset.
   - Fill lanes write `bx.const_usize(layout.size.bytes_u64())`.
7. `cases: impl ExactSizeIterator<Item = ..>` is a readonly array. `switch_with_weights`'s lazy `map` is an eager
   `map`; the items are plain values.
8. `fragment: &Option<Range<Size>>` is `readonly [Size, Size] | undefined`. `&mut String` is `MutRef<string>`.
   `idx: &mut usize` is `MutRef<number>`. `typeid: &[u8]` is `Uint8Array`. `Box<dyn Any>` is `unknown`.
   `thread_profiler`'s `Box::new(())` is `undefined`.
9. **`CodegenBackend`** keeps the stand-in's shape: `print`, `has_zstd`, `has_mnemonic` and `provide` are `(provided)`
   placeholder comments, not interface members, so the three implementors are unchanged. Their helpers are ported with
   markers. rustc_driver_impl still calls `unported` for those `--print` requests. Making them members later means
   adding forwarders to miri.ts, util.ts and codegen_backend.ts.
10. `impl ModuleBufferMethods for Infallible` is `ModuleBufferMethods_for_Infallible.data(self: never)`.
11. The derived `Debug` of `InlineAsmOperandRef`, `GlobalAsmOperandRef` and `MemFlags`/`RetagFlags` is not written.
    The first two need `OperandRef`'s and `PlaceRef`'s Debug. Whoever first prints one adds it.
12. `DerivedTypeCodegenMethods`' blanket `impl<T> ... for T` is a comment. All 8 of its methods are provided, so an
    implementing class forwards each to `DerivedTypeCodegenMethods_provided`.
13. `!val as i64` (u64) in `shift_mask_val` is `BigInt(-1 - val)`. `u128::wrapping_sub` is `BigInt.asUintN(128, ..)`.
    `(value as iN).to_string()` is `BigInt.asIntN(N, value).toString()`.

## Notes for cg-contract and the fill lanes
- To implement: `class CodegenCx implements CodegenMethods<LlvmTypes>, MiscCodegenMethods<LlvmTypes>, ...` with
  `debug_Value` etc. Then `class Builder implements BuilderMethods<LlvmTypes, CodegenCx>`, with `static build` /
  `static append_block`, so `Builder` itself satisfies `BuilderMethodsStatic`. Every `(provided)` member the backend
  does not override forwards to its `<Trait>_provided` helper (cg_llvm overrides several, for example
  `three_way_compare`, `cond_br_with_expect`, `switch_with_weights` and the `unchecked_*`). A small helper that installs
  the forwarders on a prototype would save boilerplate. It is not here, because it is design rather than port, so it
  is cg-contract's call.
- The stub files' classes have exactly the upstream fields. Fill lanes add the methods in upstream order and remove
  the `Stub (ssa-contract)` methods as they port them.

## Sample difftests
`RUST_TS_AGENT=ssa-contract`, `--sample 200 --jobs 6`. These run because `base.ts` and `stand_ins.ts` load at
startup and gained imports:
- `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-112331-ssa-contract-vgu1`.
- `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-112702-ssa-contract-crfo`.
