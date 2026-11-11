# Handoff: cg-contract (M7, plan-m7 wave 40, ✱ contract-first): rustc_codegen_llvm FFI helpers, `LlvmCodegenBackend`, the `CodegenCx`/`Builder` skeleton

Branch `t3/llvm-codegen-contract` (from `b3772ebb`; no merges). Commits: see the end.

## Summary
- **Ported in full, in upstream order, with markers:** `llvm/mod.rs` (60/60), `llvm/conversions.rs` (9/9),
  `llvm/metadata_kind.rs` (0/0 fns; its 42 constants), `value.rs` (3/3), `macros.rs` (1/1), `lib.rs` (0/0) and
  `back/llvm_backend.rs` (33/33).
- **`lib.rs` at the pin is 43 lines of `mod` items.** `LlvmCodegenBackend` with its `CodegenBackend`,
  `ExtraBackendMethods` and `WriteBackendMethods` impls, and `ModuleLlvm`, are in `back/llvm_backend.rs`, which `lib.rs`
  re-exports. plan-m7 §2b's "lib.rs (838 lines)" is stale. I ported `back/llvm_backend.rs` whole. Every body in it is a
  delegation into another lane's file, which is a typed stub there. **Root:** take `back/llvm_backend.rs` off cg-write's
  list (plan-m7 §2b puts it under "Backend driver").
- **The skeleton.** `CodegenCx` implements `CodegenMethods<LlvmTypes>` and `MiscCodegenMethods<LlvmTypes>`, and
  `Builder` implements `BuilderMethods<LlvmTypes, CodegenCx>` and `StaticBuilderMethods<LlvmTypes>`. Both are built over
  the IR model's handles (`llvm.Value`, `llvm.Type`, `llvm.BasicBlock`, `llvm.Metadata`). The class `Builder` is a
  `BuilderMethodsStatic<LlvmTypes, CodegenCx, Builder>` (`builder.ts` `Builder_static`). **All of these typecheck without a
  cast.**
  - I checked that the checks bite. I changed `type_i8(): Type` to `number` and `vector_length` to `string`, and removed
    `get_param`. tsc then reported `Class 'Builder' incorrectly implements interface 'BuilderMethods<LlvmTypes,
    CodegenCx>'`, `Type 'CodegenCx' does not satisfy the constraint 'CodegenMethods<LlvmTypes>'` and `Property
    'get_param' does not exist`. I reverted the changes.
- **Typed stubs.** Each trait method whose body belongs to a fill lane calls `unported("<lane>: <upstream path> <fn>")`.
  It sits in the file that lane owns, attached with PORTING §5's extension pattern. Provided methods that upstream does
  not override forward to the ssa-contract `<Trait>_provided` helpers. Overridden ones are stubs.
- **Not registered.** `rustc_interface` still constructs the stand-in `src/rust_ts/codegen_backend.ts`. Nothing outside
  `src/rustc_codegen_llvm/` imports the new crate, so no current path changes; the samples show it.

## Files touched
All of them are new and under `src/rustc_codegen_llvm/`. **No file outside it was edited.** `.env.local` was copied for
setup and is gitignored.

| file | owner from here on | content |
|---|---|---|
| `lib.ts` | cg-contract | crate root: `pub use`, side-effect imports of the extension files, the deref installers |
| `llvm/mod.ts`, `llvm/conversions.ts`, `llvm/metadata_kind.ts` | cg-contract | ported |
| `value.ts`, `macros.ts` | cg-contract | ported |
| `back/llvm_backend.ts` | cg-contract | ported (see Summary) |
| `llvm/conversions.test.ts`, `llvm/metadata_kind.test.ts`, `llvm/mod.test.ts`, `skeleton.test.ts` | cg-contract | unit tests |
| `context.ts`, `common.ts` | **cg-context** | skeleton: structs, `Borrow`/`Deref` (ported), stubs |
| `type_.ts`, `mono_item.ts`, `base.ts` | **cg-types-attrs** | stubs |
| `builder.ts`, `allocator.ts` | **cg-builder** | skeleton: struct, `Deref` (ported), stubs |
| `abi.ts`, `consts.ts` | **cg-abi-consts** | stubs |
| `intrinsic.ts` | **cg-intrinsic-a** | stubs |
| `llvm_util.ts`, `back/write.ts`, `back/archive.ts`, `back/owned_target_machine.ts` | **cg-write** (wave 42) | stubs, type surfaces |
| `back/lto.ts` | **cg-lto-diag** (wave 43) | stubs, type surfaces |
| `asm.ts` | **cg-asm** (wave 43) | stubs |
| `debuginfo/mod.ts` | **cg-di-a or cg-di-b** (wave 44; root's split) | stubs, placeholder `CodegenUnitDebugContext` |
| `coverageinfo/mod.ts` | none (excluded, D18) | 1 stub, `CguCoverageContext = never` |

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/<file>`)
| upstream file | ported |
|---|---|
| llvm/mod.rs | 60/60 |
| llvm/conversions.rs | 9/9 |
| llvm/metadata_kind.rs | 0/0 (no fns; 42 consts) |
| value.rs | 3/3 |
| macros.rs | 1/1 |
| lib.rs | 0/0 |
| back/llvm_backend.rs | 33/33 |
| context.rs | 4/54: the skeleton's ported `Borrow`/`Deref` impls (:55, :64, :75, :82); the rest is cg-context's |
| builder.rs | 1/146: `Deref for Builder` (:262); the rest is cg-builder's |

- `bun scripts/coverage.ts --check --offline`: `markers ok (25897, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor
  5311; library 735; llvm 174)`.
- `--order`: no rows for `rustc_codegen_llvm`. `FullCx` is declared before `GenericCx` so that its impls (context.rs:54-67)
  keep their upstream place.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun test ./src/std/result.test.ts ./src/rustc_codegen_llvm/`: **38 pass, 0 fail** (715 expects), 5 files:
  - `llvm/conversions.test.ts` (8 tests):
    - each `from_generic`/`to_generic` table is read off conversions.rs, cites its line, and is checked to cover every
      variant of the source enum, with every result a variant of the LLVM enum;
    - `ToGeneric_for_TypeKind` is also run through the IR model: `LLVMGetTypeKind(ty).to_rust().to_generic()`, which is
      type_.rs:242's chain.
  - `llvm/metadata_kind.test.ts` (3 tests):
    - the 42 constants take the values 0..41;
    - each equals LLVM's own `LLVM_FIXED_MD_KIND(MD_x, "name", N)` in the pinned
      `llvm/include/llvm/IR/FixedMetadataKinds.def`, read from `$RUST_TS_DATA/llvm-src`. Its SHA-256 is checked against
      `harness/llvm-manifest.json`. This is the analog of RustWrapper.cpp's static assertions;
    - the IR model's `LLVMGetMDKindIDInContext(name)` returns the same id for each.
  - `llvm/mod.test.ts` (12 tests):
    - `AttributePlace::as_uint`;
    - the `get_value_name`/`set_value_name` round trip, including non-ASCII;
    - `SetUniqueComdat`, `set_comdat`, linkage, visibility, constness and alignment, read back and printed through
      `Debug for Value`, which is RustWrapper's `(<type>:<value>)`;
    - `get_param`'s assertion text;
    - string-attribute uniquing;
    - `build_string`, Ok and Err, with `FromUtf8Error`'s derived Debug;
    - `into_result`;
    - `TryFromU32` over `CallConv`'s discriminants.
  - `skeleton.test.ts` (12 tests):
    - every trait member is attached at run time on `GenericCx`, `CodegenCx` and `Builder`. For `Builder` that includes
      every `CodegenCx` member reached through the deref forwarders;
    - stubs stop with their lane's name;
    - `CodegenCx`'s field accessors read and write `FullCx`;
    - `Builder` forwards to its `cx_` and keeps its own members;
    - **`LlvmCodegenBackend::print` matches the oracle byte for byte** for `--print relocation-models`, `code-models`,
      `tls-models` and `stack-protector-strategies`. The expected text is the stdout of `rustc +nightly-2026-10-11
      --print <kind>` on aarch64-apple-darwin.
- Sample difftests, `RUST_TS_AGENT=cg-contract`, `--sample 200 --jobs 6`, on AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-212951-cg-contract-ctja`.
  - `mir-o2`: **199/200 MATCH, 1 DIFF** (unprotected, unrelated), run `20261111-213039-cg-contract-mwxt` (details at the end).

## Stubs per fill lane
Stubs carry no marker; the fill lane replaces each with the port. A test checks the counts below by lane name.

| lane | stubs | where | what |
|---|---|---|---|
| **cg-builder** | **135** | builder.ts 134, allocator.ts 1 | 124 `BuilderMethods` members, `build`, `append_block`; `StaticBuilderMethods::get_static`; the 6 `Has*`/`LayoutOfHelpers`/`FnAbiOfHelpers` forwarders of builder.rs:213-256; `GenericBuilder::drop`; `allocator::codegen` |
| **cg-context** | **45** | context.ts 18, common.ts 27 | `MiscCodegenMethods` (10); `HasDataLayout`, `HasTargetSpec`, `HasTyCtxt`, `HasTypingEnv`, `handle_layout_err`, `handle_fn_abi_err` (6); `SimpleCx::new`, `create_module`; `ConstCodegenMethods` (24); `Funclet::{new, cleanuppad, bundle}` |
| **cg-types-attrs** | **37** | type_.ts 34, mono_item.ts 2, base.ts 1 | `BaseTypeCodegenMethods` (22, on `GenericCx`), `LayoutTypeCodegenMethods` (7), `TypeMembershipCodegenMethods` (4), `Debug for Type` (`debug_Type`); `PreDefineCodegenMethods` (2); `compile_codegen_unit` |
| **cg-abi-consts** | **5** | abi.ts 3, consts.ts 2 | `ArgAbiBuilderMethods` (2), `AbiBuilderMethods::get_param`; `StaticCodegenMethods` (2) |
| **cg-intrinsic-a** | **10** | intrinsic.ts | `IntrinsicCallBuilderMethods` (10) |
| cg-write (w42) | 16 | llvm_util.ts 9, back/write.ts 5, back/archive.ts 1, back/owned_target_machine.ts 1 | `init`, `time_trace_profiler_finish`, `target_config`, `print_version`, `print_passes`, `print`, `target_cpu`, `global_llvm_features`, `target_has_mnemonic`; `create_informational_target_machine`, `create_target_machine`, `target_machine_factory`, `optimize`, `codegen`; `new_archive_builder`; `OwnedTargetMachine::drop` |
| cg-lto-diag (w43) | 8 | back/lto.ts | `run_fat`, `run_thin`, `enable_autodiff_settings`, `run_pass_manager`, `ModuleBuffer::{new, data}`, `optimize_and_codegen_thin_module`, `parse_module` |
| cg-di-a/b (w44) | 14 | debuginfo/mod.ts | `DebugInfoBuilderMethods` (13), `DebugInfoCodegenMethods::create_vtable_debuginfo` |
| cg-asm (w43) | 3 | asm.ts | `AsmBuilderMethods::codegen_inline_asm`, `AsmCodegenMethods::{codegen_global_asm, mangled_name}` |
| (excluded, D18) | 1 | coverageinfo/mod.ts | `CoverageInfoBuilderMethods::add_coverage` |

**Forwarders to `_provided` helpers (not stubs):**
- `Builder`: 13 `BuilderMethods` defaults that builder.rs keeps: `cond_br_with_expect`, `unreachable_nonterminator`,
  `load_from_place`, `assume_integer_range`, `assume_nonnull`, `store_to_place`, `store_to_place_with_flags`, `ptradd`,
  `inbounds_ptradd`, `cast_float_to_int`, `typed_place_copy`, `typed_place_copy_with_flags`, `typed_place_swap`. The
  other 17 defaults are overridden upstream, so they are stubs: `br_with_attrs`, `switch_with_weights`, the
  `unchecked_*` 9, `or_disjoint`, `inbounds_nuw_gep`, `unchecked_utrunc`, `unchecked_strunc`, `three_way_compare`.
- `CodegenCx`: the blanket `DerivedTypeCodegenMethods` (8), `ConstCodegenMethods::scalar_to_backend`, `LayoutOf` /
  `LayoutOfHelpers` / `FnAbiOf` (6).
- `Builder`: the same 6 `LayoutOf`/`FnAbiOf` members.

**Other stops** (named owners, not fill lanes of this crate):
- `back/llvm_backend.ts`:
  - `ssa-base: … base.rs codegen_crate`;
  - `ssa-write: … OngoingCodegen::join`, plus three uses of ssa-write's opaque `CodegenContext`/`SharedEmitter`
    (`DiagCtxt::new(shared_emitter)`, `cgcx.module_config`, `cgcx.fewer_names`, `TargetMachineFactoryConfig::new`);
  - `rustc_session::Session::fewer_names` (not on the TS `Session`);
  - Enzyme / offload library loading (`-Zautodiff=Enable`, `-Zoffload`: D18).
- `llvm/mod.ts`: `llir: LLVMRustHasFnAttribute`, `llir: LLVMRustRemoveFnAttribute` (see "For root and the llir lanes").
- `value.ts`: `Hash for Value` (a pointer address; nothing calls it).

## Every `unported(...)` left (grouped)
- Fill-lane stubs: the table above. The message form is `"<lane>: compiler/rustc_codegen_llvm/src/<file> <fn>"`.
- `llvm/mod.ts`:
  - `"llir: LLVMRustHasFnAttribute (llvm/enzyme_ffi.rs, not in the IR model's contract)"`;
  - `"llir: LLVMRustRemoveFnAttribute (…)"`.
- `value.ts`: `"rustc_codegen_llvm::value::<Value as Hash>::hash (pointer address)"`.
- `back/llvm_backend.ts`:
  - `"rustc_session::Session::fewer_names (…)"`;
  - `"ssa-base: compiler/rustc_codegen_ssa/src/base.rs codegen_crate"`;
  - `"ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs OngoingCodegen::join"`;
  - `"ssa-write: DiagCtxt::new(Box::new(shared_emitter.clone())) (SharedEmitter)"`;
  - `"ssa-write: CodegenContext.module_config"`;
  - `"ssa-write: CodegenContext.fewer_names"`;
  - `"ssa-write: TargetMachineFactoryConfig::new (…)"`;
  - `"rustc_codegen_llvm::llvm::EnzymeWrapper::get_or_init (-Zautodiff=Enable; plan-m7 D18)"`;
  - `"rustc_codegen_llvm::llvm::RustOffloadWrapper::get_or_init (-Zoffload; plan-m7 D18)"`.
- The IR model's own stubs that ported code here reaches: `llir: <name>`, from ffi.ts. Examples:
  `LLVMRustLLVMHasZstdCompression`, `LLVMRustCreateRangeAttribute`, `LLVMLookupIntrinsicID`, `LLVMCreateOperandBundle`.

## `// PORT:` decisions (for root to record)
1. **`back/llvm_backend.rs` is this lane's "lib.rs".** It is ported whole here (Summary).
2. **`GenericCx<'ll, T: Borrow<SCx>>(T, PhantomData)`** is `class GenericCx<T extends SCxBorrow>` with the field `_0`.
   - The two instantiations are subclasses: `SimpleCx extends GenericCx<SCx>` and `CodegenCx extends GenericCx<FullCx>`.
     So `impl SimpleCx` / `impl CodegenCx` / trait impls for `CodegenCx` have a home, and `impl<CX> GenericCx<CX>` sits
     on `GenericCx`.
   - `GenericCx(FullCx { .. }, PhantomData)` is `new CodegenCx(full)`.
   - `Borrow<SCx>` is the `SCxBorrow` interface. `SCx::borrow` returns `this` (std's blanket impl).
   - `GenericBuilder<CX>` is the same, with `SBuilder` and `Builder` as subclasses.
3. **Auto-deref.**
   - `CodegenCx` → `FullCx` fields are accessor properties on `CodegenCx.prototype` (`FULL_CX_DEREF_FIELDS`, read/write
     `this._0.<field>`). Four field names are also method names and are not forwarded; they are reached as
     `this._0.<field>`: `vtables`, `statics_to_rauw`, `coverage_cx`, and the private `eh_personality`.
   - `SCx`'s fields (`llmod`, `llcx`, `isize_ty`) are not forwarded either: `cx.llcx` is written `cx.llcx()`, the
     type_.rs:152 method returning the same value.
   - `FullCx` → `SimpleCx` methods, and `Builder` → `CodegenCx`, are run-time forwarders that
     `install_deref_methods` (context.ts) defines for every member the deref-ing class lacks. lib.ts runs it after
     every extension module is loaded.
   - Type side: declaration merging. `interface CodegenCx extends FullCxDeref, SimpleCxDeref {}` and
     `interface Builder extends BuilderDeref {}`.
   - Rust's precedence holds: a class's own members win over the deref target's.
4. **Field renames where a method of the same name exists:**
   - `GenericBuilder.cx` → `cx_`. `BuilderMethods::cx()` is called by generic code and so keeps its name.
   - `Funclet.cleanuppad` → `cleanuppad_`.
   - `ModuleBuffer.data` → `data_`.
5. **Stubs placement.**
   - A trait impl in another upstream file is a `declare module "./context.ts" | "./builder.ts"` augmentation with the
     concrete signatures (`B["Value"]` → `llvm.Value`, `B["FunctionSignature"]` → `llvm.Type`, …), plus a prototype
     assignment, in that lane's file.
   - Impls in the class's own file are class-body methods.
   - `implements` on the class checks every augmentation's signatures.
6. **Associated types.** `LlvmTypes` (common.ts) is `impl BackendTypes for GenericCx`. `LlvmWriteTypes`
   (llvm_backend.ts) is `WriteBackendMethods`' types. `GenericCx` declares `__backend_types?: LlvmTypes` (ssa-contract
   N1).
   - `debug_Function` / `debug_Value` are `GenericCx` getters returning value.rs's impl.
   - type_.ts defines `debug_Type` / `debug_FunctionSignature` on `GenericCx.prototype` with `Object.defineProperty`
     (type_.rs's impl). context.ts must not import its extension files.
7. **`FromGeneric` / `ToGeneric` impls** are consts `FromGeneric_for_<Type>` / `ToGeneric_for_TypeKind`: the
   `ModuleBufferMethods_for_Infallible` form. Callers write `FromGeneric_for_IntPredicate.from_generic(op)`.
8. **Inherent impls on generated enums** (ffi_types.ts companions, which ported code cannot edit) are `<Enum>_impl`
   consts: `LLVMRustResult_impl.into_result`, `AttributeKind_impl.create_attr`, `MemoryEffects_impl.create_attr`.
9. `pub(crate) use self::CallConv::*` / `CodeGenOptSize::*` have no TS form: write `CallConv.CCallConv`.
10. `MetadataKindId` is the contract's brand (support.ts); metadata_kind.ts only declares the 42 constants.
11. `#[derive(TryFromU32)]` is `TryFromU32(<Enum>_discriminant)`, which returns `try_from`. Variants are tried in
    declaration order.
12. **`Drop` impls** are `drop()` methods, which nothing calls at scope end: `OperandBundleBox`, `TimeTraceProfiler`,
    `ModuleLlvm`, `GenericBuilder` (stub), `OwnedTargetMachine` (stub). `ManuallyDrop` is erased.
13. `build_string`'s error is `FromUtf8Error { bytes, error }` with its derived Debug, so `.unwrap()`/`.expect()`
    panic texts match. `&CStr` parameters are strings, or `Uint8Array` where upstream takes `to_bytes()`.
14. `Value`: `PartialEq` is `Value_eq` (`===`). `Hash` is `unported`: maps key on the object.
15. **`print`, `has_zstd`, `has_mnemonic`** are methods of `LlvmCodegenBackend`, not `CodegenBackend` members
    (ssa-contract decision 9). The class also forwards the defaults `supported_crate_types`, `metadata_loader` and
    `supports_parallel`.
16. `LayoutOfResult` / `FnAbiOfResult` (the traits' defaults) are getters returning `MaybeResult_T` on both classes.
17. **Placeholder types**, never constructed until their lane ports them:
    - opaque: `SanitizerIgnoreList` (rustc_sanitizers is out of scope), `CodegenUnitDebugContext`;
    - `never`: `OffloadGlobals`, `OffloadKernelGlobals`, `CguCoverageContext` (out of M7);
    - fields only: `OwnedTargetMachine`, `ThinData`, `ModuleBuffer`.
18. `FullCx.intrinsics` (key `(Cow<str>, SmallVec<[&Type; 2]>)`) is a `KeyedMap`. Its key function is cg-context's
    choice, since the key holds handles.
19. Not registered: `rustc_interface/util.ts` still constructs the stand-in. Registering means replacing its `"llvm"`
    arm with `LlvmCodegenBackend.new()`. That is root's decision, once codegen reaches the oracle (plan-m7 wave 40).

## For root and the llir lanes
- **`LLVMRustHasFnAttribute` / `LLVMRustRemoveFnAttribute` are declared in `llvm/enzyme_ffi.rs`, not `ffi.rs`.** The
  contract (ffi.ts, generated from ffi.rs) therefore lacks them, and `llvm::HasStringAttribute` /
  `RemoveStringAttrFromFn` stop.
  - Callers: attributes.rs:42/46, and builder.rs:2019/2153 (CFI/KCFI).
  - Either the generator takes these two from enzyme_ffi.rs, or the stops stay until a sanitizer case needs them.
- **ffi.ts re-exports `RustString` type-only.** Its `export type { RustString }` from handles.ts shadows support.ts's
  class. llvm/mod.ts imports the class from support.ts with a PORT note. The generator should re-export the value.
- `rustc_session::Session::fewer_names` is not on the TS `Session`. `ModuleLlvm::new` needs it: a small rustc_session
  item.
- plan-m7 §2b's line counts for `lib.rs` are stale (Summary).

## Notes for the fill lanes
- **All:**
  - Replace each `Stub (cg-contract)` with the port and its `// rustc:` marker. Keep upstream order: the stubs are in
    each impl's member order, which is the trait's, so move a method to its upstream place when porting.
  - Add a lane's other upstream fns (inherent methods, free fns) in upstream order around the stubs.
  - The `declare module` blocks carry the concrete signatures; keep them in sync with the prototype assignments.
  - `src/rustc_codegen_llvm/skeleton.test.ts` lists the trait members and checks the stub messages. When you port a
    stub, change its `stops(...)` line in that test.
- **cg-context:**
  - `CodegenCx::new` builds `new CodegenCx(new FullCx(…all fields in order…))`.
  - When you port an `impl SimpleCx` method that `CodegenCx` uses (`val_ty`, `get_type_of_global`), add its name to
    `SimpleCxDeref`'s `Pick`. The run-time forwarder is automatic.
  - `const_null` and `const_struct` exist twice upstream: inherent on `GenericCx` (common.rs:143) and in
    `ConstCodegenMethods for CodegenCx`. In TS the `CodegenCx` one shadows the `GenericCx` one for a `CodegenCx`; Rust
    picks the inherent one. Check that both bodies agree, or call the inherent one explicitly
    (`GenericCx.prototype.const_null.call(this, t)`).
  - `MiscCodegenMethods::vtables()` returns `this._0.vtables`, and `eh_personality()` reads `this._0.eh_personality`.
- **cg-types-attrs:**
  - Port `llcx()`, `llmod()`, `isize_ty()` (type_.rs:152-162) early: every other lane reads the `SCx` fields through
    them. They need `this._0.borrow()`.
  - `debug_Type` is the stub at the top of type_.ts.
- **cg-builder:**
  - The field is `cx_`; `UNNAMED` is `""`.
  - `GenericBuilder`'s inherent statics (`build`, `append_block`, `with_cx`) go on `GenericBuilder`. `Builder.build` /
    `append_block` are the `BuilderMethods` ones. `Builder` has an instance member `cx()` and a static `build`.
  - Overridden provided methods are stubs here; keep them overriding.
- **cg-write:** src/rust_ts/codegen_backend.ts holds the oracle tables and partial ports (`global_llvm_features`,
  `target_config`, `target_cpu`, the `ORACLE_ACCEPTED_LLVM_ARGS` guard). Port llvm_util.rs around them, as plan-m7 §2e
  says.

## Sample difftests
`RUST_TS_AGENT=cg-contract`, `--sample 200 --jobs 6`, on AC power, with four other lanes running (load about 22):
- `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-212951-cg-contract-ctja`.
- `mir-o2`: **199/200 MATCH, 1 DIFF** (UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-213039-cg-contract-mwxt`.
  - The DIFF is `tests/ui/simd/intrinsic/inlining-issue67557-ice.rs`. The oracle ICEs (`broken MIR … Projecting into SIMD
    type Simd2 is banned by MCP#838`), and its stderr's first difference is the Rust backtrace frame (`0:
    std::panicking::begin_panic::<…ExplicitBug>`) against the port's `note: rust-ts prints the JS stack, not a Rust
    backtrace`.
  - The case is **not in `harness/baseline/mir-o2.txt`**.
  - This lane's code cannot reach it: nothing outside `src/rustc_codegen_llvm/` imports the new crate (grep of `src`,
    `scripts`, `tools`, `harness`).

## Commits
- `72e43136` cg-contract: rustc_codegen_llvm FFI helpers, LlvmCodegenBackend, CodegenCx/Builder skeleton (code and tests).
- `7bec77d8` this handoff; a follow-up commit fixes the branch name above.
