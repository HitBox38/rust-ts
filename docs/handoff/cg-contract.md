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

## Review fixes (docs/reviews/cg-contract.md, REQUEST CHANGES)
Commits `277ebfa4` (rustc_session) and `a915f565` (this crate), plus this handoff.

### F1: inherent before trait
- **Rule (decision for root to record; stated in builder.ts's header):** an inherent method whose name is also a trait
  method of the same type is named `<name>_inherent`. A call site inside rustc_codegen_llvm writes the `_inherent` name
  exactly where upstream's resolution picks the inherent method: a method call, or a `Type::name(..)` path, on the concrete
  type. Generic code and `BuilderMethods::name(bx, ..)` keep the trait name.
  - In this crate that is almost every call site. Rust tries inherent methods before trait methods at the same autoderef
    step, and the crate calls on concrete `Builder`s. That includes the bodies of `impl BuilderMethods for Builder` itself.
- **Why a suffix and not a `GenericBuilder_<name>` free function:**
  - the method stays on the class it belongs to, so `SBuilder` (no trait impl) and `Builder` share it;
  - `this` is typed;
  - a grep for the upstream name finds both forms.
  - `build_inherent` is a static with a `this` constructor type, so `Builder.build_inherent(cx, llbb)` is typed `Builder`.
- **The 10 `GenericBuilder` names**, all stubs on `GenericBuilder` in builder.ts (cg-builder):
  - `append_block` :101 (static);
  - `trunc` :112;
  - `bitcast` :116;
  - `ret_void` :120;
  - `ret` :124;
  - `build` :130 (static);
  - `inbounds_gep` :156;
  - `store` :175, **body differs**: the trait `store` goes through `store_with_flags`, which clamps the alignment to
    `max_reliable_alignment()` (:887);
  - `load` :185, **body differs**: the trait `load` clamps the same way (:694);
  - `va_arg` :1875.
  - The other eight bodies are identical to the trait's. They follow the rule anyway, so no call site depends on which
    pair it is.
- **Same rule on the contexts:**
  - `GenericCx`'s `const_null` / `const_struct` (common.rs:168, :172) against `ConstCodegenMethods` (:266, :378):
    bodies identical (`self.llcx()` vs `self.llcx` is the same value). Now `const_null_inherent` / `const_struct_inherent`,
    stubs in common.ts.
  - `SimpleCx`'s `val_ty` (context.rs:873) against `BaseTypeCodegenMethods::val_ty` (type_.rs:280): identical. Now
    `val_ty_inherent` on `SimpleCx`. A `CodegenCx` call resolves to the trait method, as in Rust.
  - No other inherent/trait pair exists on these types; that agrees with the review's scan.

### F2: the cross-lane surface
- **Ported** (one-line accessors):
  - `llcx()`, `llmod()`, `isize_ty()` (type_.rs:152-162, `this.deref().borrow().x`);
  - `CodegenCx::statics_to_rauw` (context.rs:734);
  - `Funclet::{cleanuppad, bundle}` (common.rs:119, :123);
  - `Builder::llfn` (builder.rs:1585);
  - `OwnedTargetMachine::raw` (owned_target_machine.rs:79).
- **How the list was derived.** A scanner, kept in the lane's scratch:
  - it parses every upstream fn definition of the crate with its `impl`/trait context;
  - it scans the five wave-41 lanes' files for call sites (`.name(`, `Type::name(`, `module::name(`, bare `name(`),
    resolving paths by type or module name;
  - it keeps fns defined in another lane's file. It drops ssa trait impls (already stubbed) and the crate's
    already-ported files.
  - It found 144 callees. I removed 9 false positives by reading their call sites:
    - `ArgAbiExt::store`: its sites are `OperandValue::store`;
    - `SBuilder::call`: the sites call `BuilderMethods::call` on a `Builder`;
    - `allocator::codegen` / `back::write::codegen`: intrinsic.rs's `codegen` is a closure parameter;
    - `DIBuilderBox::as_ref`, `TypeMap::insert`, `TypeTree::insert`: the sites are `Option::as_ref` and map inserts;
    - `TargetFeatureFoldStrength::as_str`: `Symbol::as_str`;
    - `SimpleCx::val_ty`: the sites are on `CodegenCx`, so the trait method.
  - Result: **135 callees**. 8 are ported accessors and the rest are typed stubs, each in its owner's file, with the usual
    message (`"<lane>: compiler/rustc_codegen_llvm/src/<file> <fn>"`, or `"excluded (plan-m7 D18): …"` for the out-of-M7
    modules).
- **New skeleton files:** `type_of.ts`, `declare.ts`, `attributes.ts`, `callee.ts` (cg-types-attrs); `va_arg.ts`
  (cg-intrinsic-b); `debuginfo/metadata.ts` (cg-di); `typetree.ts`, `builder/autodiff.ts`, `builder/gpu_offload.ts`
  (excluded, D18).
- **Extension traits on foreign classes** (decision for root to record) use the miri decision C2 form: a `declare module`
  augmentation of the foreign class, plus prototype assignments, so calls read as upstream (`layout.llvm_type(cx)`). This
  covers:
  - `LayoutLlvmExt` for `TyAndLayout` (type_of.ts);
  - `LlvmType` for `Reg` / `CastTarget` (abi.ts);
  - `FnAbiLlvmExt` for `FnAbi` (abi.ts).
- **Integer widths:** `type_ix(num_bits)` and `type_vector(count)` take `number` (a width or count).
  `get_const_i32(n: u64)` takes `bigint` (a constant; ssa-contract decision 6).
- **Deref coercion at calls:** a `&SimpleCx` parameter (attributes.rs, `declare_simple_fn`) given a `CodegenCx` upstream
  is passed `cx.scx`.
- **The fill-lane sketch** is skeleton.test.ts's `fill_lane_sketch`. tsc checks it; the test runs it over marker objects.
  It covers `cx.llcx()`, `bx.cx_.llmod()`, `bx.isize_ty()`, `cx.statics_to_rauw()`, `bx.type_i1()`,
  `layout.llvm_type(cx)`, `fn_abi.llvm_type(cx)`, `cx.declare_global(..)`, `cx.const_bytes(..)`, `cx.get_intrinsic(..)`,
  `attributes.apply_to_llfn(..)`, `common.val_ty(..)`, `bx.load_inherent(..)`, `bx.call_intrinsic(..)`,
  `Builder.build_inherent(cx, llbb)` (typed `Builder`) and `llvm_util.get_version()`. Ported accessors answer; each
  cross-lane call stops in its owner's stub.
- **The list per owning lane** (name as the TS member; upstream file:line; who calls it):
  - **cg-types-attrs** (45): `apply_to_llfn` (attributes.rs:29, stub; called from cg-abi-consts, cg-builder, cg-context, cg-intrinsic-a); `apply_to_callsite` (attributes.rs:35, stub; called from cg-abi-consts, cg-builder); `frame_pointer` (attributes.rs:217, stub; called from cg-context); `frame_pointer_type_attr` (attributes.rs:229, stub; called from cg-context); `target_cpu_attr` (attributes.rs:429, stub; called from cg-context); `tune_cpu_attr` (attributes.rs:434, stub; called from cg-context); `target_features_attr` (attributes.rs:440, stub; called from cg-context); `llfn_attrs_from_instance` (attributes.rs:490, stub; called from cg-abi-consts, cg-builder); `set_link_section` (base.rs:224, stub; called from cg-abi-consts); `linkage_to_llvm` (base.rs:230, stub; called from cg-abi-consts); `set_variable_sanitizer_attrs` (base.rs:251, stub; called from cg-abi-consts); `get_fn` (callee.rs:19, stub; called from cg-context); `declare_simple_fn` (declare.rs:36, stub; called from cg-builder); `declare_raw_fn` (declare.rs:58, stub; called from cg-intrinsic-a); `GenericCx::declare_global` (declare.rs:94, stub; called from cg-abi-consts, cg-intrinsic-a); `GenericCx::declare_global_in_addrspace` (declare.rs:105, stub; called from cg-intrinsic-a); `CodegenCx::declare_cfn` (declare.rs:132, stub; called from cg-builder, cg-context); `CodegenCx::declare_entry_fn` (declare.rs:150, stub; called from cg-context); `CodegenCx::declare_fn` (declare.rs:165, stub; called from cg-abi-consts, cg-intrinsic-a); `GenericCx::define_global` (declare.rs:246, stub; called from cg-abi-consts, cg-context); `GenericCx::get_declared_value` (declare.rs:255, stub; called from cg-abi-consts, cg-context, cg-intrinsic-a); `CodegenCx::assume_dso_local` (mono_item.rs:233, stub; called from cg-abi-consts); `GenericCx::type_named_struct` (type_.rs:48, stub; called from cg-abi-consts); `GenericCx::set_struct_body` (type_.rs:53, stub; called from cg-abi-consts); `GenericCx::type_void` (type_.rs:58, stub; called from cg-abi-consts, cg-builder, cg-context, cg-intrinsic-a); `GenericCx::type_ix` (type_.rs:63, stub; called from cg-abi-consts, cg-builder, cg-context, cg-intrinsic-a); `GenericCx::type_vector` (type_.rs:67, stub; called from cg-abi-consts, cg-builder, cg-intrinsic-a); `GenericCx::get_return_type` (type_.rs:80, stub; called from cg-intrinsic-a); `GenericCx::func_params_types` (type_.rs:84, stub; called from cg-builder, cg-intrinsic-a); `GenericCx::func_is_variadic` (type_.rs:94, stub; called from cg-intrinsic-a); `GenericCx::struct_element_types` (type_.rs:98, stub; called from cg-intrinsic-a); `CodegenCx::type_int_from_ty` (type_.rs:109, stub; called from cg-intrinsic-a); `CodegenCx::type_uint_from_ty` (type_.rs:120, stub; called from cg-intrinsic-a); `CodegenCx::type_float_from_ty` (type_.rs:131, stub; called from cg-intrinsic-a); `GenericCx::llcx` (type_.rs:152, ported; called from cg-builder, cg-context); `GenericCx::llmod` (type_.rs:156, ported; called from cg-abi-consts, cg-context); `GenericCx::type_variadic_func` (type_.rs:164, stub; called from cg-abi-consts, cg-context); `GenericCx::type_i1` (type_.rs:168, stub; called from cg-builder, cg-context, cg-intrinsic-a); `GenericCx::type_struct` (type_.rs:172, stub; called from cg-abi-consts, cg-builder, cg-intrinsic-a); `GenericCx::type_bf16` (type_.rs:183, stub; called from cg-intrinsic-a); `CodegenCx::align_of` (type_of.rs:192, stub; called from cg-intrinsic-a); `CodegenCx::size_of` (type_of.rs:196, stub; called from cg-intrinsic-a); `LayoutLlvmExt for TyAndLayout: llvm_type` (type_of.rs:234, stub; called from cg-abi-consts, cg-builder, cg-intrinsic-a); `LayoutLlvmExt for TyAndLayout: immediate_llvm_type` (type_of.rs:287, stub; called from cg-abi-consts, cg-intrinsic-a); `LayoutLlvmExt for TyAndLayout: scalar_pair_element_llvm_type` (type_of.rs:318, stub; called from cg-abi-consts, cg-builder).
  - **cg-context** (33): `Funclet::new` (common.rs:115, stub; called from cg-builder); `Funclet::cleanuppad` (common.rs:119, ported; called from cg-builder, cg-intrinsic-a); `Funclet::bundle` (common.rs:123, ported; called from cg-builder); `GenericCx::const_array` (common.rs:144, stub; called from cg-builder); `GenericCx::const_bytes` (common.rs:149, stub; called from cg-abi-consts, cg-builder, cg-intrinsic-a); `GenericCx::null_terminate_const_bytes` (common.rs:153, stub; called from cg-abi-consts); `GenericCx::const_null_inherent` (common.rs:168, stub; called from cg-abi-consts, cg-builder, cg-intrinsic-a); `GenericCx::const_struct_inherent` (common.rs:172, stub; called from cg-abi-consts, cg-builder, cg-intrinsic-a); `val_ty` (common.rs:468, stub; called from cg-types-attrs); `named_struct` (common.rs:483, stub; called from cg-abi-consts); `get_dllimport` (common.rs:506, stub; called from cg-abi-consts, cg-types-attrs); `CodegenCx::new` (context.rs:600, stub; called from cg-types-attrs); `CodegenCx::statics_to_rauw` (context.rs:734, ported; called from cg-types-attrs); `CodegenCx::create_used_variable_impl` (context.rs:745, stub; called from cg-types-attrs); `CodegenCx::objc_abi_version` (context.rs:757, stub; called from cg-abi-consts, cg-types-attrs); `CodegenCx::add_ptrauth_elf_got_flag` (context.rs:769, stub; called from cg-types-attrs); `CodegenCx::add_ptrauth_sign_personality_flag` (context.rs:778, stub; called from cg-types-attrs); `CodegenCx::add_ptrauth_pauthabi_version_and_platform_flags` (context.rs:787, stub; called from cg-types-attrs); `CodegenCx::add_objc_module_flags` (context.rs:813, stub; called from cg-types-attrs); `CodegenCx::is_sanitizer_type_ignored` (context.rs:858, stub; called from cg-builder); `SimpleCx::get_type_of_global` (context.rs:870, stub; called from cg-abi-consts, cg-intrinsic-a, cg-types-attrs); `GenericCx::get_metadata_value` (context.rs:889, stub; called from cg-builder, cg-intrinsic-a); `GenericCx::get_const_i32` (context.rs:901, stub; called from cg-builder); `GenericCx::get_md_kind_id` (context.rs:913, stub; called from cg-builder); `GenericCx::create_metadata` (context.rs:917, stub; called from cg-abi-consts, cg-builder, cg-intrinsic-a, cg-types-attrs); `CodegenCx::get_intrinsic` (context.rs:1087, stub; called from cg-builder); `CodegenCx::generate_local_symbol_name` (context.rs:1153, stub; called from cg-abi-consts); `GenericCx::md_node_in_context` (context.rs:1182, stub; called from cg-builder); `GenericCx::set_metadata` (context.rs:1187, stub; called from cg-builder); `GenericCx::set_metadata_node` (context.rs:1201, stub; called from cg-builder); `GenericCx::module_add_named_metadata_node` (context.rs:1216, stub; called from cg-abi-consts); `GenericCx::global_add_metadata_node` (context.rs:1230, stub; called from cg-types-attrs); `GenericCx::global_set_metadata_node` (context.rs:1243, stub; called from cg-types-attrs).
  - **cg-builder** (15): `GenericBuilder::append_block_inherent` (builder.rs:101, stub; called from cg-intrinsic-a, cg-types-attrs); `GenericBuilder::trunc_inherent` (builder.rs:112, stub; called from cg-intrinsic-a); `GenericBuilder::bitcast_inherent` (builder.rs:116, stub; called from cg-intrinsic-a); `GenericBuilder::ret_void_inherent` (builder.rs:120, stub; called from cg-types-attrs); `GenericBuilder::ret_inherent` (builder.rs:124, stub; called from cg-intrinsic-a, cg-types-attrs); `GenericBuilder::build_inherent` (builder.rs:130, stub; called from cg-intrinsic-a, cg-types-attrs); `GenericBuilder::store_inherent` (builder.rs:175, stub; called from cg-abi-consts, cg-intrinsic-a); `GenericBuilder::load_inherent` (builder.rs:185, stub; called from cg-intrinsic-a); `Builder::llfn` (builder.rs:1585, ported; called from cg-abi-consts, cg-intrinsic-a); `Builder::set_unpredictable` (builder.rs:1652, stub; called from cg-intrinsic-a); `Builder::shuffle_vector` (builder.rs:1749, stub; called from cg-intrinsic-a); `GenericBuilder::add_clause` (builder.rs:1819, stub; called from cg-intrinsic-a); `GenericBuilder::catch_ret` (builder.rs:1825, stub; called from cg-intrinsic-a); `Builder::call_intrinsic` (builder.rs:1881, stub; called from cg-intrinsic-a); `Builder::landing_pad` (builder.rs:1930, stub; called from cg-intrinsic-a).
  - **cg-abi-consts** (15): `LlvmType for Reg: llvm_type` (abi.rs:140, stub; called from cg-builder, cg-intrinsic-a, cg-types-attrs); `LlvmType for CastTarget: llvm_type` (abi.rs:183, stub; called from cg-builder, cg-intrinsic-a, cg-types-attrs); `FnAbiLlvmExt for FnAbi: llvm_type` (abi.rs:364, stub; called from cg-builder, cg-intrinsic-a, cg-types-attrs); `FnAbiLlvmExt for FnAbi: ptr_to_llvm_type` (abi.rs:451, stub; called from cg-types-attrs); `FnAbiLlvmExt for FnAbi: llvm_cconv` (abi.rs:455, stub; called from cg-types-attrs); `FnAbiLlvmExt for FnAbi: apply_attrs_llfn` (abi.rs:459, stub; called from cg-types-attrs); `FnAbiLlvmExt for FnAbi: apply_attrs_callsite` (abi.rs:640, stub; called from cg-builder); `to_llvm_calling_convention` (abi.rs:773, stub; called from cg-context); `const_alloc_to_llvm` (consts.rs:39, stub; called from cg-context); `CodegenCx::const_bitcast` (consts.rs:284, stub; called from cg-context); `CodegenCx::const_pointercast` (consts.rs:288, stub; called from cg-builder, cg-context, cg-intrinsic-a); `CodegenCx::static_addr_of_mut` (consts.rs:296, stub; called from cg-builder, cg-context); `CodegenCx::static_addr_of_impl` (consts.rs:324, stub; called from cg-builder, cg-context); `CodegenCx::get_static` (consts.rs:349, stub; called from cg-builder, cg-context); `CodegenCx::define_objc_module_info` (consts.rs:874, stub; called from cg-types-attrs).
  - **cg-intrinsic-b** (2): `generic_simd_intrinsic` (intrinsic.rs:2047, stub; called from cg-intrinsic-a); `emit_va_arg` (va_arg.rs:1053, stub; called from cg-intrinsic-a).
  - **cg-asm** (1): `inline_asm_call` (asm.rs:536, stub; called from cg-intrinsic-a).
  - **cg-di-a/b** (7): `build_compile_unit_di_node` (debuginfo/metadata.rs:876, stub; called from cg-builder, cg-context); `build_global_var_di_node` (debuginfo/metadata.rs:1473, stub; called from cg-abi-consts); `apply_vcall_visibility_metadata` (debuginfo/metadata.rs:1697, stub; called from cg-context); `CodegenUnitDebugContext::new` (debuginfo/mod.rs:64, stub; called from cg-builder, cg-context); `CodegenUnitDebugContext::finalize` (debuginfo/mod.rs:117, stub; called from cg-builder); `Builder::get_dbg_loc` (debuginfo/mod.rs:123, stub; called from cg-builder); `CodegenCx::debuginfo_finalize` (debuginfo/mod.rs:727, stub; called from cg-types-attrs).
  - **cg-write** (8): `OwnedTargetMachine::raw` (back/owned_target_machine.rs:79, ported; called from cg-context); `create_informational_target_machine` (back/write.rs:100, stub; called from cg-context); `to_llvm_code_model` (back/write.rs:160, stub; called from cg-context); `IntoIterator for LLVMFeature: into_iter` (llvm_util.rs:217, stub; called from cg-intrinsic-a, cg-types-attrs); `to_llvm_features` (llvm_util.rs:239, stub; called from cg-types-attrs); `get_version` (llvm_util.rs:469, stub; called from cg-abi-consts, cg-context, cg-intrinsic-a, cg-types-attrs); `target_cpu` (llvm_util.rs:657, stub; called from cg-types-attrs); `tune_cpu` (llvm_util.rs:800, stub; called from cg-types-attrs).
  - **excluded** (9): `adjust_activity_to_abi` (builder/autodiff.rs:23, stub; called from cg-intrinsic-a); `generate_enzyme_call` (builder/autodiff.rs:286, stub; called from cg-intrinsic-a); `OffloadGlobals::declare` (builder/gpu_offload.rs:37, stub; called from cg-types-attrs); `OffloadKernelDims::from_operands` (builder/gpu_offload.rs:69, stub; called from cg-intrinsic-a); `declare_omp_get_num_devices` (builder/gpu_offload.rs:129, stub; called from cg-intrinsic-a); `gen_define_handling` (builder/gpu_offload.rs:359, stub; called from cg-intrinsic-a); `gen_call_handling` (builder/gpu_offload.rs:526, stub; called from cg-intrinsic-a); `CodegenCx::coverageinfo_finalize` (coverageinfo/mod.rs:49, stub; called from cg-types-attrs); `add_tt` (typetree.rs:78, stub; called from cg-builder).

### Gaps and nits
- **`Session::fewer_names`** is ported in src/rustc_session/session.ts (session.rs:1060; root's exception to PORTING §1).
  `ModuleLlvm::new` / `new_metadata` call it, and the local stub is gone.
- **`RustString`** stays imported from support.ts. The comment now says why: `use rustc_llvm::RustString`, and support.ts
  is rustc_llvm's Rust side.
- **`LLVMRustHasFnAttribute` / `RemoveFnAttribute`:** unchanged, as root asked.
- **N1:** 16 `BuilderMethods` defaults are overridden (not 17); corrected below. 13 forward.
- **N2:** `val_ty` was the wrong example. `get_type_of_global` is now in `SimpleCxDeref` and context.ts's header says why
  `val_ty` is not.
- **N3:** `str_len` is `utf8_len` (PORTING §5).
- **N4:** type_.ts imports `GenericCx` once.
- **N5 (for the llir lanes):** `get_value_name` re-encodes the string `LLVMGetValueName2` returns. A non-UTF-8 name would
  trip its length assertion, which upstream does not have. rustc names values only with Rust strings, so this cannot happen
  today. It is a limit of the IR model returning `string`.
- **N6 (for the registration lane):** `LlvmCodegenBackend.new()` returns `CodegenBackend`, which has no `print` /
  `has_zstd` / `has_mnemonic` members (ssa-contract decision 9). Registering needs root's decision: optional interface
  members, or an `instanceof LlvmCodegenBackend` arm in rustc_driver_impl.
- **Load order:** abi.ts imports rustc_target through its crate root first, as src/rust_ts/codegen_backend.ts does. Entered
  from callconv/mod.ts, spec/json.ts reads spec/mod.ts's bindings before they exist. Each new file loads standalone.

## Files touched
All of them are under `src/rustc_codegen_llvm/`, plus `src/rustc_session/session.ts` (`fewer_names`, review gap 3, root's exception).
`.env.local` was copied for setup and is gitignored. The review fixes add the files listed under F2.

| file | owner from here on | content |
|---|---|---|
| `lib.ts` | cg-contract | crate root: `pub use`, side-effect imports of the extension files, the deref installers |
| `llvm/mod.ts`, `llvm/conversions.ts`, `llvm/metadata_kind.ts` | cg-contract | ported |
| `value.ts`, `macros.ts` | cg-contract | ported |
| `back/llvm_backend.ts` | cg-contract | ported (see Summary) |
| `llvm/conversions.test.ts`, `llvm/metadata_kind.test.ts`, `llvm/mod.test.ts`, `skeleton.test.ts` | cg-contract | unit tests |
| `context.ts`, `common.ts` | **cg-context** | skeleton: structs, `Borrow`/`Deref` and accessors (ported), stubs |
| `type_.ts`, `type_of.ts`, `declare.ts`, `attributes.ts`, `callee.ts`, `mono_item.ts`, `base.ts` | **cg-types-attrs** | stubs; `llcx`/`llmod`/`isize_ty` ported |
| `builder.ts`, `allocator.ts` | **cg-builder** | skeleton: struct, `Deref` (ported), stubs |
| `abi.ts`, `consts.ts` | **cg-abi-consts** | stubs |
| `intrinsic.ts` | **cg-intrinsic-a** (and cg-intrinsic-b's `generic_simd_intrinsic`) | stubs |
| `va_arg.ts` | cg-intrinsic-b (w43) | stubs |
| `llvm_util.ts`, `back/write.ts`, `back/archive.ts`, `back/owned_target_machine.ts` | **cg-write** (wave 42) | stubs, type surfaces |
| `back/lto.ts` | **cg-lto-diag** (wave 43) | stubs, type surfaces |
| `asm.ts` | **cg-asm** (wave 43) | stubs |
| `debuginfo/mod.ts`, `debuginfo/metadata.ts` | **cg-di-a or cg-di-b** (wave 44; root's split) | stubs, class `CodegenUnitDebugContext` (no fields yet) |
| `coverageinfo/mod.ts`, `typetree.ts`, `builder/autodiff.ts`, `builder/gpu_offload.ts` | none (excluded, D18) | stubs other files call; placeholder types |

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
| context.rs | 5/54: the `Borrow`/`Deref` impls (:55, :64, :75, :82) and `statics_to_rauw` (:734); the rest is cg-context's |
| type_.rs | 3/60: `llcx`, `llmod`, `isize_ty` |
| common.rs | 2/43: `Funclet::{cleanuppad, bundle}` |
| back/owned_target_machine.rs | 1/3: `raw` |
| builder.rs | 2/146: `Deref for Builder` (:262), `llfn` (:1585); the rest is cg-builder's |

- `bun scripts/coverage.ts --check --offline`: `markers ok (25906, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor
  5311; library 735; llvm 174)` (after the review fixes).
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
Stubs carry no marker; the fill lane replaces each with the port. skeleton.test.ts ("stub counts per lane") counts every
`unported("<lane>: …")` in the crate's sources and checks this table. The counts are after the review fixes.

| lane | stubs | trait methods and backend callees | cross-lane surface (F2) and F1 inherents |
|---|---|---|---|
| **cg-builder** | **151** | 135: builder.ts 134 (124 `BuilderMethods` members, `build`, `append_block`, `get_static`, 6 `Has*`/helper forwarders, `drop`), allocator.ts 1 | 16: the 12 `GenericBuilder` inherents (10 `_inherent`, `add_clause`, `catch_ret`), 4 `Builder` inherents |
| **cg-types-attrs** | **80** | 37 (as before) | 43: type_.ts 16, type_of.ts 5, declare.ts 9, attributes.ts 8, callee.ts 1, base.ts 3, mono_item.ts 1 |
| **cg-context** | **73** | 43 (`Funclet::{cleanuppad, bundle}` now ported) | 30: context.ts 23 (incl. `val_ty_inherent`), common.ts 8 (incl. `const_null_inherent`, `const_struct_inherent`, 3 free fns) |
| **cg-abi-consts** | **20** | 5 | 15: abi.ts 8, consts.ts 7 |
| **cg-intrinsic-a** | **10** | 10 | 0 (it is only a caller) |
| cg-write (w42) | 21 | 16 | 5: `to_llvm_code_model`, `LLVMFeature::into_iter`, `to_llvm_features`, `get_version`, `tune_cpu` (`raw` ported) |
| cg-di-a/b (w44) | 21 | 14 | 7: debuginfo/mod.ts 4, debuginfo/metadata.ts 3 |
| cg-lto-diag (w43) | 8 | 8 | 0 |
| cg-asm (w43) | 4 | 3 | 1: `inline_asm_call` |
| cg-intrinsic-b (w43) | 2 | 0 | 2: `generic_simd_intrinsic`, `emit_va_arg` |
| excluded (D18) | 10 | 1 | 9: coverageinfo 1, typetree 1, builder/autodiff 2, builder/gpu_offload 5 |

**Forwarders to `_provided` helpers (not stubs):**
- `Builder`: 13 `BuilderMethods` defaults that builder.rs keeps: `cond_br_with_expect`, `unreachable_nonterminator`,
  `load_from_place`, `assume_integer_range`, `assume_nonnull`, `store_to_place`, `store_to_place_with_flags`, `ptradd`,
  `inbounds_ptradd`, `cast_float_to_int`, `typed_place_copy`, `typed_place_copy_with_flags`, `typed_place_swap`. The
  other 16 defaults are overridden upstream, so they are stubs: `br_with_attrs`, `switch_with_weights`, the
  `unchecked_*` 9, `or_disjoint`, `inbounds_nuw_gep`, `unchecked_utrunc`, `unchecked_strunc`, `three_way_compare`.
- `CodegenCx`: the blanket `DerivedTypeCodegenMethods` (8), `ConstCodegenMethods::scalar_to_backend`, `LayoutOf` /
  `LayoutOfHelpers` / `FnAbiOf` (6).
- `Builder`: the same 6 `LayoutOf`/`FnAbiOf` members.

**Other stops** (named owners, not fill lanes of this crate):
- `back/llvm_backend.ts`:
  - `ssa-base: … base.rs codegen_crate`;
  - `ssa-write: … OngoingCodegen::join`, plus three uses of ssa-write's opaque `CodegenContext`/`SharedEmitter`
    (`DiagCtxt::new(shared_emitter)`, `cgcx.module_config`, `cgcx.fewer_names`, `TargetMachineFactoryConfig::new`);
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
     type_.rs:152 method returning the same value (ported).
   - `impl SimpleCx` methods reached from a `CodegenCx` are listed in `SimpleCxDeref` (`get_type_of_global`).
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
    - opaque: `SanitizerIgnoreList` (rustc_sanitizers is out of scope);
    - classes with no fields yet: `CodegenUnitDebugContext`; `OffloadGlobals`, `OffloadKernelGlobals`, `OffloadKernelDims`
      (out of M7);
    - `never`: `CguCoverageContext`, `OffloadMetadata` (out of M7);
    - fields only: `OwnedTargetMachine`, `ThinData`, `ModuleBuffer`.
18. `FullCx.intrinsics` (key `(Cow<str>, SmallVec<[&Type; 2]>)`) is a `KeyedMap`. Its key function is cg-context's
    choice, since the key holds handles.
19. **Inherent before trait (review F1):** `<name>_inherent` (Review fixes, F1).
20. **Cross-lane surface (review F2):** typed stubs in the owner's file. Extension traits on foreign classes are augmentations
    of those classes (Review fixes, F2).
21. Not registered: `rustc_interface/util.ts` still constructs the stand-in. Registering means replacing its `"llvm"`
    arm with `LlvmCodegenBackend.new()`. That is root's decision, once codegen reaches the oracle (plan-m7 wave 40).

## For root and the llir lanes
- **`LLVMRustHasFnAttribute` / `LLVMRustRemoveFnAttribute` are declared in `llvm/enzyme_ffi.rs`, not `ffi.rs`.** The
  contract (ffi.ts, generated from ffi.rs) therefore lacks them, and `llvm::HasStringAttribute` /
  `RemoveStringAttrFromFn` stop.
  - Callers: attributes.rs:42/46, and builder.rs:2019/2153 (CFI/KCFI).
  - Either the generator takes these two from enzyme_ffi.rs, or the stops stay until a sanitizer case needs them.
- Root will make the enzyme_ffi.rs exclusion partial for these two later; until then the stop stays (review gap 1).
- `RustString` comes from support.ts, rustc_llvm's Rust side; that is faithful, not a gap (review gap 2).
- `Session::fewer_names` is ported (review gap 3).
- plan-m7 §2b's line counts for `lib.rs` are stale (Summary).

## Notes for the fill lanes
- **All:**
  - Replace each `Stub (cg-contract)` with the port and its `// rustc:` marker. Keep upstream order: the stubs are in
    each impl's member order, which is the trait's, so move a method to its upstream place when porting.
  - Add a lane's other upstream fns (inherent methods, free fns) in upstream order around the stubs.
  - The `declare module` blocks carry the concrete signatures; keep them in sync with the prototype assignments.
  - `src/rustc_codegen_llvm/skeleton.test.ts` lists the trait members, checks the stub messages and counts the stubs per
    lane. When you port a stub, update its `stops(...)` line, the sketch's expectation and the lane's count.
  - Call another lane's fn through its stub (the per-lane list above). Do not add stubs to files you do not own; ask root.
  - **F1:** write `bx.load_inherent(..)`, `Builder.build_inherent(cx, llbb)`, `cx.const_null_inherent(t)` etc. wherever
    upstream calls those names on a concrete type (builder.ts header).
  - A `&SimpleCx` parameter given a `CodegenCx` upstream: pass `cx.scx`.
- **cg-context:**
  - `CodegenCx::new` builds `new CodegenCx(new FullCx(…all fields in order…))`.
  - If another `impl SimpleCx` method is reached from a `CodegenCx`, add its name to `SimpleCxDeref`'s `Pick`
    (`get_type_of_global` is there). The run-time forwarder is automatic.
  - Inherent `const_null` / `const_struct` are `const_null_inherent` / `const_struct_inherent` (F1). Upstream's crate calls
    on a `CodegenCx` resolve to them.
  - `MiscCodegenMethods::vtables()` returns `this._0.vtables`, and `eh_personality()` reads `this._0.eh_personality`.
- **cg-types-attrs:**
  - `llcx()`, `llmod()`, `isize_ty()` are ported (type_.rs:152-162).
  - `LayoutLlvmExt`'s other methods go on `TyAndLayout` the same way as the three stubs in type_of.ts.
  - `debug_Type` is the stub at the top of type_.ts.
- **cg-builder:**
  - The field is `cx_`; `UNNAMED` is `""`.
  - `GenericBuilder`'s inherent statics (`build`, `append_block`, `with_cx`) go on `GenericBuilder`. `Builder.build` /
    `append_block` are the `BuilderMethods` ones. `Builder` has an instance member `cx()` and a static `build`.
  - Overridden provided methods are stubs here; keep them overriding.
  - The F1 inherents are stubs on `GenericBuilder` (`load_inherent` …). Port `load`/`store`'s inherent bodies (no
    alignment clamp) there, and the trait bodies (with the clamp) on `Builder`.
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

- **After the review fixes** (`a915f565`; session.ts is on the driver path now). Same settings, AC power:
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-220353-cg-contract-3dwf`.
  - `mir-o2`: **199/200 MATCH, 1 DIFF** (UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261111-220434-cg-contract-txfz`. The DIFF is
    the same unprotected `tests/ui/simd/intrinsic/inlining-issue67557-ice.rs`: the oracle's ICE backtrace against the port's
    JS-stack note.
- Tests after the review fixes:
  - `bunx tsc --noEmit -p .` is clean, and `coverage.ts --check --offline` reports markers ok.
  - `bun test ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./src/rustc_session/`: **153 pass, 0 fail**.
  - The crate's own tests plus result.test.ts: 41 pass.

## Commits
- `72e43136` cg-contract: rustc_codegen_llvm FFI helpers, LlvmCodegenBackend, CodegenCx/Builder skeleton (code and tests).
- `7bec77d8` this handoff; a follow-up commit fixes the branch name above.
- `b5c3e429` handoff branch name.
- `277ebfa4` rustc_session: port `Session::fewer_names`.
- `a915f565` review fixes (F1, F2, N3, N4).
- The commit of this handoff update.
