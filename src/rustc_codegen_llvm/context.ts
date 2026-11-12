// compiler/rustc_codegen_llvm/src/context.rs (lane cg-context, plan-m7 §8 wave 41; the skeleton is lane cg-contract's).
//
// What is here: the structs (`SCx`, `GenericCx`, `FullCx`, the aliases `SimpleCx` / `CodegenCx`), their `Borrow` / `Deref`
// impls, `create_module` (the module's data layout, triple and module flags), `CodegenCx::new`, the inherent impls, the
// trait impls of context.rs (`MiscCodegenMethods`, `HasDataLayout`, `HasTargetSpec`, `HasTyCtxt`, `HasTypingEnv`,
// `LayoutOfHelpers`, `FnAbiOfHelpers`), and the forwarders of the blanket impls (`DerivedTypeCodegenMethods`, `LayoutOf`,
// `FnAbiOf`). The other files' trait impls for `CodegenCx` are in the file of the lane that owns them (type_.ts, common.ts,
// consts.ts, mono_item.ts, asm.ts, debuginfo/mod.ts), attached with PORTING §5's extension pattern; lib.ts imports them.
//
// PORT (cg-contract), the representation:
// - `GenericCx<'ll, T: Borrow<SCx<'ll>>>(T, PhantomData)` is the class `GenericCx<T extends SCxBorrow>` with the field `_0`.
//   The two instantiations upstream names are subclasses, so that impls on one instantiation have a home:
//   `SimpleCx extends GenericCx<SCx>` (`impl SimpleCx`) and `CodegenCx extends GenericCx<FullCx>` (`impl CodegenCx`, every
//   trait impl for `CodegenCx`); impls on `GenericCx<CX>` (`impl<CX: Borrow<SCx>> GenericCx<CX>`) are on `GenericCx`.
//   Upstream's `GenericCx(FullCx { .. }, PhantomData)` is `new CodegenCx(full_cx)`; `GenericCx(SCx { .. }, PhantomData)`
//   is `new SimpleCx(scx)`.
// - `Borrow<SCx>`: `SCxBorrow` (a `borrow()` method); `SCx`'s is std's blanket `impl<T> Borrow<T> for T`.
// - Auto-deref (`cx.tcx`, `cx.instances`, ...) of `CodegenCx` -> `FullCx` is realised as accessor properties on
//   `CodegenCx.prototype`, one per `FullCx` field (`FULL_CX_DEREF_FIELDS`), reading and writing `this._0.<field>`. The
//   fields whose name is also a method of `CodegenCx` are not forwarded, and are reached as `this._0.<field>`:
//   `vtables` (`MiscCodegenMethods::vtables`), `statics_to_rauw` and `coverage_cx` (inherent methods returning the field),
//   and the private `eh_personality` (`MiscCodegenMethods::eh_personality`). The `SCx` fields (`llmod`, `llcx`,
//   `isize_ty`) are not forwarded either: upstream has the methods `llmod()`, `llcx()`, `isize_ty()` (type_.rs:152) that
//   return them, so `cx.llcx` is written `cx.llcx()`.
// - The deref `FullCx` -> `SimpleCx` gives `CodegenCx` the methods of `impl SimpleCx` (`get_type_of_global`):
//   `install_deref_methods(CodegenCx, SimpleCx, (cx) => cx._0.scx)` forwards every method of `SimpleCx.prototype` that
//   `CodegenCx` lacks. It runs in lib.ts after every extension module is loaded; each forwarded method's type is listed in
//   `SimpleCxDeref` below. (`val_ty` is not one: `CodegenCx` has `BaseTypeCodegenMethods::val_ty`, which Rust picks before
//   the deref; `impl SimpleCx`'s own `val_ty` is `val_ty_inherent`, builder.ts header.)
// - Inherent methods with the name of a trait method of the same type (`GenericCx`'s `const_null` / `const_struct`,
//   `SimpleCx`'s `val_ty`) are `<name>_inherent` (review F1; the rule is in builder.ts's header).
// - Trait methods that collide with nothing keep their names. `HasTyCtxt::tcx` / `HasTypingEnv::typing_env` are `tcx_()`
//   / `typing_env_()` (layout-contract), so `cx.tcx` stays the field.
// - The associated types are `LlvmTypes` (common.ts, `impl BackendTypes for GenericCx`); `implements` below names the
//   traits, and `__backend_types` makes `B` inferable from `this` in the `_provided` helpers (ssa-contract N1).
//
// PORT (cg-context):
// - **Sibling modules are read lazily.** This is the defining module of `CodegenCx` / `GenericCx`, which the extension modules
//   (common.ts, abi.ts, declare.ts, debuginfo/mod.ts, ...) attach methods to at load (PORTING §5: the defining module must not
//   import its extension files). The other modules of the crate whose functions context.rs calls (`crate::abi`,
//   `crate::back::write`, `crate::callee`, `crate::debuginfo`, `crate::attributes`, `crate::common`, `crate::llvm_util`) are
//   therefore required on first use by the accessors at the end of this file (the rustc_trait_selection "read lazily (init
//   order)" pattern), never imported eagerly; their types are `import type`. `crate::llvm` (llvm/mod.ts, the IR model) and
//   `crate::diagnostics` are leaves and are imported.
// - **Callees in other crates that are not ported yet** are typed stubs at the end of this file, named after the upstream
//   fn, stopping with `<owner>: <path> <fn>` (the cross-lane stub format): `Session::needs_plt`,
//   `Session::must_emit_unwind_tables`, `Session::branch_protection` (rustc_session; `wants_msvc_seh` is imported from
//   rustc_codegen_ssa/base.ts, ssa-base, root at integ-w54). Root
//   replaces each with the real one once its crate has it (docs/handoff/cg-context.md).
// - Tuple comparisons of `llvm_util::get_version()` (`llvm_version < (23, 0, 0)`) are `version_lt` / `version_ge`.
import type { Size, TargetDataLayout } from "../rustc_abi/lib.ts";
import type { Float, Integer, Primitive, Scalar as abi_Scalar, VariantIdx } from "../rustc_abi/lib.ts";
import { versioned_llvm_target } from "../rustc_codegen_ssa/back/mod.ts";
import { wants_wasm_eh } from "../rustc_codegen_ssa/base.ts";
import { FailedToGetLayout_diagnostic } from "../rustc_codegen_ssa/diagnostics.gen.ts";
import type { CodegenMethods } from "../rustc_codegen_ssa/traits/mod.ts";
import { DerivedTypeCodegenMethods_provided } from "../rustc_codegen_ssa/traits/type_.ts";
import type { MiscCodegenMethods } from "../rustc_codegen_ssa/traits/misc.ts";
import { ALPHANUMERIC_ONLY, to_base } from "../rustc_data_structures/base_n.ts";
import { DefIdMap } from "../rustc_span/def_id.ts";
import type { CodegenUnit } from "../rustc_middle/mono.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import {
  codegen_handle_fn_abi_err,
  display_LayoutError,
  FnAbiOf_provided,
  type FnAbiError,
  type FnAbiRequest,
  type LayoutError,
  LayoutOf_provided,
  LayoutOfHelpers_provided,
  type MaybeResult,
  MaybeResult_T,
  type TyAndLayout,
} from "../rustc_middle/ty/layout.ts";
import { type List, RawList } from "../rustc_middle/ty/list.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { BranchProtection, PacRet } from "../rustc_session/config.ts";
import type { PointerAuthSchema, Session } from "../rustc_session/session.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import { FloatAbi, type FramePointer, LlvmAbi, type Target, TargetTuple, type TlsModel } from "../rustc_target/spec/mod.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import type { ExistentialTraitRef } from "../rustc_type_ir/predicate.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { assert, panic, unported, unreachable } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import type { LlvmTypes } from "./common.ts";
import type { CguCoverageContext } from "./coverageinfo/mod.ts";
import type { CodegenUnitDebugContext } from "./debuginfo/mod.ts";
import type { Debug } from "../std/fmt.ts";
import { MismatchedDataLayout_diagnostic } from "./diagnostics.gen.ts";
import * as llvm from "./llvm/mod.ts";
import type { Context, Metadata, MetadataKindId, Module, ThreadLocalMode, Type, Value } from "./llvm/mod.ts";
import type { ModuleLlvm } from "./back/llvm_backend.ts";
import type { OffloadGlobals, OffloadKernelGlobals } from "./builder/gpu_offload.ts";
import { debug_Value } from "./value.ts";
import { wants_msvc_seh } from "../rustc_codegen_ssa/base.ts";

/** PORT (cg-contract): `rustc_sanitizers::ignorelist::SanitizerIgnoreList`. rustc_sanitizers is out of scope
 *  (harness/scope.json), so a `FullCx` holds `None` until a lane ports it; never constructed. */
export interface SanitizerIgnoreList {
  readonly __SanitizerIgnoreList: never;
}

/// `TyCtxt` (and related cache datastructures) can't be move between threads.
/// However, there are various cx related functions which we want to be available to the builder and
/// other compiler pieces. Here we define a small subset which has enough information and can be
/// moved around more freely.
export class SCx implements SCxBorrow {
  constructor(
    public llmod: Module,
    public llcx: Context,
    public isize_ty: Type,
  ) {}

  /** std's blanket `impl<T> Borrow<T> for T`. */
  borrow(): SCx {
    return this;
  }
}

/** `T: Borrow<SCx<'ll>>` */
export interface SCxBorrow {
  borrow(): SCx;
}

// PORT (cg-contract): `FullCx` (context.rs:94) is declared here, before `GenericCx`, so that its `Borrow` / `Deref` impls
// (context.rs:54-67) keep their upstream place.
export class FullCx implements SCxBorrow {
  constructor(
    public tcx: TyCtxt,
    public bitcode_needed: boolean,
    public scx: SimpleCx,
    public use_dll_storage_attrs: boolean,
    public tls_model: ThreadLocalMode,

    public codegen_unit: CodegenUnit,

    /// Cache instances of monomorphic and polymorphic items
    public instances: KeyedMap<Instance, Value>,
    /// Cache instances of intrinsics
    public intrinsic_instances: KeyedMap<Instance, Value>,
    /// Cache generated vtables
    public vtables: KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], Value>,
    /// Cache of constant strings,
    public const_str_cache: Map<string, Value>,

    /// Cache of emitted const globals (value -> global)
    public const_globals: Map<Value, Value>,

    /// List of globals for static variables which need to be passed to the
    /// LLVM function ReplaceAllUsesWith (RAUW) when codegen is complete.
    /// (We have to make sure we don't invalidate any Values referring
    /// to constants.)
    public statics_to_rauw: [Value, Value][],

    /// Statics that will be placed in the llvm.used variable
    /// See <https://llvm.org/docs/LangRef.html#the-llvm-used-global-variable> for details
    public used_statics: Value[],

    /// Statics that will be placed in the llvm.compiler.used variable
    /// See <https://llvm.org/docs/LangRef.html#the-llvm-compiler-used-global-variable> for details
    public compiler_used_statics: Value[],

    /// Mapping of non-scalar types to llvm types.
    public type_lowering: KeyedMap<readonly [Ty, VariantIdx | undefined], Type>,

    /// Mapping of scalar types to llvm types.
    public scalar_lltypes: Map<Ty, Type>,

    /// Extra per-CGU codegen state needed when coverage instrumentation is enabled.
    public coverage_cx: CguCoverageContext | undefined,
    public dbg_cx: CodegenUnitDebugContext | undefined,
    public sanitizer_ignorelist: SanitizerIgnoreList | undefined,

    /** private; `Cell<Option<&'ll Value>>` */
    public eh_personality: Value | undefined,
    /** `Cell<Option<(&'ll Type, &'ll Value)>>` */
    public rust_try_fn: readonly [Type, Value] | undefined,

    /** private. `RefCell<FxHashMap<(Cow<'static, str>, SmallVec<[&'ll Type; 2]>), (&'ll Type, &'ll Value)>>`: a composite
     *  key with handles in it, so a `KeyedMap` whose key function cg-context chooses. */
    public intrinsics: KeyedMap<readonly [string, readonly Type[]], readonly [Type, Value]>,

    /// A counter that is used for generating local symbol names
    /** private */
    public local_gen_sym_counter: number,

    /// A counter that is used for generating global symbol names
    /** private */
    public global_gen_sym_counter: number,

    /// `codegen_static` will sometimes create a second global variable with a
    /// different type and clear the symbol name of the original global.
    /// `global_asm!` needs to be able to find this new global so that it can
    /// compute the correct mangled symbol name to insert into the asm.
    public renamed_statics: DefIdMap<Value>,

    /// Cached Objective-C class type
    public objc_class_t: Type | undefined,

    /// Cache of Objective-C class references
    public objc_classrefs: Map<Symbol, Value>,

    /// Cache of Objective-C selector references
    public objc_selrefs: Map<Symbol, Value>,

    /// Globals shared by the offloading runtime
    public offload_globals: OffloadGlobals | undefined,

    /// Cache of kernel-specific globals
    public offload_kernel_cache: Map<string, OffloadKernelGlobals>,
  ) {}

  // impl<'ll> Borrow<SCx<'ll>> for FullCx<'ll, '_>
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:55 borrow
  borrow(): SCx {
    // `&self.scx`, deref-coerced from `&SimpleCx` to `&SCx`.
    return this.scx.deref();
  }

  // impl<'ll, 'tcx> Deref for FullCx<'ll, 'tcx>
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:64 deref
  deref(): SimpleCx {
    return this.scx;
  }
}

export class GenericCx<T extends SCxBorrow> {
  /** PORT (plan-m6 D3): type-level only (never set): the associated types of `impl BackendTypes for GenericCx` (common.rs). */
  declare readonly __backend_types?: LlvmTypes;

  /** `GenericCx(T, PhantomData<SCx<'ll>>)` */
  constructor(public _0: T) {}

  // impl<'ll, T: Borrow<SCx<'ll>>> Deref for GenericCx<'ll, T>
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:75 deref
  deref(): T {
    return this._0;
  }

  // impl<'ll, T: Borrow<SCx<'ll>>> DerefMut for GenericCx<'ll, T>
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:82 deref_mut
  deref_mut(): T {
    return this._0;
  }

  // `CodegenObject: Debug` of the associated types (traits/mod.rs; ssa-contract decision 2). `Function` and `Value` are
  // `&Value` (value.rs's impl); `Type` and `FunctionSignature` are `&Type`, whose impl is type_.rs's, so type_.ts sets
  // `debug_Type` / `debug_FunctionSignature` on the prototype.
  get debug_Function(): Debug<Value> {
    return debug_Value;
  }
  get debug_Value(): Debug<Value> {
    return debug_Value;
  }
  declare readonly debug_Type: Debug<Type>;
  declare readonly debug_FunctionSignature: Debug<Type>;

  // ---- impl<'ll, CX: Borrow<SCx<'ll>>> GenericCx<'ll, CX> (context.rs:888) ----
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:889 get_metadata_value
  get_metadata_value(metadata: Metadata): Value {
    return llvm.LLVMMetadataAsValue(this.llcx(), metadata);
  }

  /** `val: u64`, a constant's value: a `bigint` (ssa-contract decision 6). */
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:893 get_const_int
  get_const_int(ty: Type, val: bigint): Value {
    return llvm.LLVMConstInt(ty, val, llvm.FALSE);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:897 get_const_i64
  get_const_i64(n: bigint): Value {
    return this.get_const_int(this.type_i64(), n);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:901 get_const_i32
  get_const_i32(n: bigint): Value {
    return this.get_const_int(this.type_i32(), n);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:905 get_const_i16
  get_const_i16(n: bigint): Value {
    return this.get_const_int(this.type_i16(), n);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:909 get_const_i8
  get_const_i8(n: bigint): Value {
    return this.get_const_int(this.type_i8(), n);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:913 get_md_kind_id
  get_md_kind_id(name: string): MetadataKindId {
    return llvm.LLVMGetMDKindIDInContext(this.llcx(), name, utf8_len(name));
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:917 create_metadata
  create_metadata(name: Uint8Array): Metadata {
    return llvm.LLVMMDStringInContext2(this.llcx(), name, name.length);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:921 get_functions
  get_functions(): Value[] {
    // PORT (cg-context): `LLVMGetFirstFunction` / `LLVMGetNextFunction` are declared in llvm/enzyme_ffi.rs, not ffi.rs, so the
    // IR model's contract (ffi.ts, generated from ffi.rs) lacks them, as it lacks `LLVMRustHasFnAttribute` (cg-contract's
    // "For root and the llir lanes"). The loop is upstream's; the first call stops.
    const functions: Value[] = [];
    let func: Value | undefined = unported("llir: LLVMGetFirstFunction (llvm/enzyme_ffi.rs, not in the IR model's contract)");
    while (func !== undefined) {
      const f: Value = func;
      functions.push(f);
      func = unported("llir: LLVMGetNextFunction (llvm/enzyme_ffi.rs, not in the IR model's contract)");
    }
    return functions;
  }

  // ---- impl<'ll, CX: Borrow<SCx<'ll>>> GenericCx<'ll, CX> (context.rs:1180) ----
  /// Wrapper for `LLVMMDNodeInContext2`, i.e. `llvm::MDNode::get`.
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1182 md_node_in_context
  md_node_in_context(md_list: readonly Metadata[]): Metadata {
    return llvm.LLVMMDNodeInContext2(this.llcx(), md_list, md_list.length);
  }

  /// A wrapper for [`llvm::LLVMSetMetadata`], but it takes `Metadata` as a parameter instead of `Value`.
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1187 set_metadata
  set_metadata(val: Value, kind_id: MetadataKindId, md: Metadata): void {
    const node = this.get_metadata_value(md);
    llvm.LLVMSetMetadata(val, kind_id, node);
  }

  /// Helper method for the sequence of calls:
  /// - `LLVMMDNodeInContext2` (to create an `llvm::MDNode` from a list of metadata)
  /// - `LLVMMetadataAsValue` (to adapt that node to an `llvm::Value`)
  /// - `LLVMSetMetadata` (to set that node as metadata of `kind_id` for `instruction`)
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1201 set_metadata_node
  set_metadata_node(instruction: Value, kind_id: MetadataKindId, md_list: readonly Metadata[]): Metadata {
    const md = this.md_node_in_context(md_list);
    this.set_metadata(instruction, kind_id, md);
    return md;
  }

  /// Helper method for the sequence of calls:
  /// - `LLVMMDNodeInContext2` (to create an `llvm::MDNode` from a list of metadata)
  /// - `LLVMMetadataAsValue` (to adapt that node to an `llvm::Value`)
  /// - `LLVMAddNamedMetadataOperand` (to set that node as metadata of `kind_name` for `module`)
  /** `kind_name: &CStr` */
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1216 module_add_named_metadata_node
  module_add_named_metadata_node(module: Module, kind_name: string, md_list: readonly Metadata[]): void {
    const md = this.md_node_in_context(md_list);
    const md_as_val = this.get_metadata_value(md);
    llvm.LLVMAddNamedMetadataOperand(module, kind_name, md_as_val);
  }

  /// Helper method for the sequence of calls:
  /// - `LLVMMDNodeInContext2` (to create an `llvm::MDNode` from a list of metadata)
  /// - `LLVMGlobalAddMetadata` (to set that node as metadata of `kind_id` for `global`)
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1230 global_add_metadata_node
  global_add_metadata_node(global: Value, kind_id: MetadataKindId, md_list: readonly Metadata[]): void {
    const md = this.md_node_in_context(md_list);
    llvm.LLVMGlobalAddMetadata(global, kind_id, md);
  }

  /// Helper method for the sequence of calls:
  /// - `LLVMMDNodeInContext2` (to create an `llvm::MDNode` from a list of metadata)
  /// - `LLVMGlobalSetMetadata` (to set that node as metadata of `kind_id` for `global`)
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1243 global_set_metadata_node
  global_set_metadata_node(global: Value, kind_id: MetadataKindId, md_list: readonly Metadata[]): void {
    const md = this.md_node_in_context(md_list);
    llvm.LLVMGlobalSetMetadata(global, kind_id, md);
  }
}

export class SimpleCx extends GenericCx<SCx> {
  // ---- impl<'ll> SimpleCx<'ll> (context.rs:869) ----
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:870 get_type_of_global
  get_type_of_global(val: Value): Type {
    return llvm.LLVMGlobalGetValueType(val);
  }

  /** Inherent; `BaseTypeCodegenMethods::val_ty` (on `GenericCx`) has the same name (review F1: builder.ts header). A `CodegenCx` call resolves to the trait method. */
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:873 val_ty
  val_ty_inherent(v: Value): Type {
    return common().val_ty(v);
  }

  // ---- impl<'ll> SimpleCx<'ll> (context.rs:877) ----
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:878 new
  static new(llmod: Module, llcx: Context, pointer_size: Size): SimpleCx {
    const isize_ty = llvm.LLVMIntTypeInContext(llcx, pointer_size.bits());
    return new SimpleCx(new SCx(llmod, llcx, isize_ty));
  }
}

/// There is one `CodegenCx` per codegen unit. Each one has its own LLVM
/// `llvm::Context` so that several codegen units may be processed in parallel.
/// All other LLVM data structures in the `CodegenCx` are tied to that `llvm::Context`.
// pub(crate) type CodegenCx<'ll, 'tcx> = GenericCx<'ll, FullCx<'ll, 'tcx>>; (header)

// rustc: compiler/rustc_codegen_llvm/src/context.rs:174 to_llvm_tls_model
function to_llvm_tls_model(tls_model: TlsModel): ThreadLocalMode {
  switch (tls_model) {
    case "GeneralDynamic":
      return "GeneralDynamic";
    case "LocalDynamic":
      return "LocalDynamic";
    case "InitialExec":
      return "InitialExec";
    case "LocalExec":
      return "LocalExec";
    case "Emulated":
      return "GeneralDynamic";
  }
}

/** `-> &'ll llvm::Module` (an `unsafe fn`). */
// rustc: compiler/rustc_codegen_llvm/src/context.rs:184 create_module
export function create_module(tcx: TyCtxt, llcx: Context, mod_name: string): Module {
  const sess = tcx.sess;
  // let mod_name = SmallCStr::new(mod_name);
  const llmod = llvm.LLVMModuleCreateWithNameInContext(mod_name, llcx);

  const cx = SimpleCx.new(llmod, llcx, tcx.data_layout().pointer_size());

  let target_data_layout = sess.target.data_layout;
  const llvm_version = llvm_util().get_version();

  if (version_lt(llvm_version, [23, 0, 0])) {
    if (sess.target.arch.$ === "S390x") {
      // LLVM 23 updated the s390x layout to specify the stack alignment: https://github.com/llvm/llvm-project/pull/176041
      target_data_layout = target_data_layout.replaceAll("-S64", "");
    }
  }

  // Ensure the data-layout values hardcoded remain the defaults.
  {
    const tm = back_write().create_informational_target_machine(sess);
    llvm.LLVMRustSetDataLayoutFromTargetMachine(llmod, tm.raw());

    // PORT (cg-context): `str::from_utf8(CStr::from_ptr(LLVMGetDataLayoutStr(llmod)).to_bytes()).expect(..)`. The C function
    // returns `getDataLayoutStr().c_str()`, never null, and the model's strings are UTF-8 text, so the `expect` cannot fire.
    const llvm_data_layout = llvm.LLVMGetDataLayoutStr(llmod);
    assert(llvm_data_layout !== undefined, "got a non-UTF8 data-layout from LLVM");

    if (target_data_layout !== llvm_data_layout) {
      tcx.dcx().emit_err(
        MismatchedDataLayout_diagnostic({
          rustc_target: TargetTuple.display(sess.opts.target_triple),
          rustc_layout: target_data_layout,
          llvm_target: sess.target.llvm_target,
          llvm_layout: llvm_data_layout,
        }),
      );
    }
    // PORT (cg-context): `tm` goes out of scope here; `impl Drop for OwnedTargetMachine` disposes the target machine
    // (`LLVMDisposeTargetMachine`, which the oracle calls at this point: src/rust_ts/llvm/proof/*.script).
    tm.drop();
  }

  // let data_layout = SmallCStr::new(&target_data_layout);
  llvm.LLVMSetDataLayout(llmod, target_data_layout);

  // let llvm_target = SmallCStr::new(&versioned_llvm_target(sess));
  // `&Session` deref-coerces to the `&EarlySession` the callee takes.
  llvm.LLVMRustSetNormalizedTarget(llmod, versioned_llvm_target(sess.early_sess));

  const reloc_model = sess.relocation_model();
  if (reloc_model === "Pic" || reloc_model === "Pie") {
    llvm.LLVMRustSetModulePICLevel(llmod);
    // PIE is potentially more effective than PIC, but can only be used in executables.
    // If all our outputs are executables, then we can relax PIC to PIE.
    if (reloc_model === "Pie" || tcx.crate_types().every((ty) => ty === "Executable")) {
      llvm.LLVMRustSetModulePIELevel(llmod);
    }
  }

  // Linking object files with different code models is undefined behavior
  // because the compiler would have to generate additional code (to span
  // longer jumps) if a larger code model is used with a smaller one.
  //
  // See https://reviews.llvm.org/D52322 and https://reviews.llvm.org/D52323.
  llvm.LLVMRustSetModuleCodeModel(llmod, back_write().to_llvm_code_model(sess.code_model()));

  const large_data_threshold = sess.opts.unstable_opts.large_data_threshold;
  if (large_data_threshold !== undefined) {
    llvm.LLVMRustSetModuleLargeDataThreshold(llmod, large_data_threshold);
  }

  // If skipping the PLT is enabled, we need to add some module metadata
  // to ensure intrinsic calls don't use it.
  if (!Session_needs_plt(sess)) {
    llvm.add_module_flag_u32(llmod, "Warning", "RtLibUseGOT", 1);
  }

  // Enable canonical jump tables if CFI is enabled. (See https://reviews.llvm.org/D65629.)
  if (sess.is_sanitizer_cfi_canonical_jump_tables_enabled() && sess.is_sanitizer_cfi_enabled()) {
    llvm.add_module_flag_u32(llmod, "Override", "CFI Canonical Jump Tables", 1);
  }

  // If we're normalizing integers with CFI, ensure LLVM generated functions do the same.
  // See https://github.com/llvm/llvm-project/pull/104826
  if (sess.is_sanitizer_cfi_normalize_integers_enabled()) {
    llvm.add_module_flag_u32(llmod, "Override", "cfi-normalize-integers", 1);
  }

  // Enable LTO unit splitting if specified or if CFI is enabled. (See
  // https://reviews.llvm.org/D53891.)
  if (sess.is_split_lto_unit_enabled() || sess.is_sanitizer_cfi_enabled()) {
    llvm.add_module_flag_u32(llmod, "Override", "EnableSplitLTOUnit", 1);
  }

  if (Session_must_emit_unwind_tables(sess)) {
    // This assertion checks that Max is the correct merge behavior.
    // Async unwind tables are strictly more useful than sync uwtables.
    // const {
    //     assert!((llvm::UWTableKind::None as u32) < (llvm::UWTableKind::Sync as u32));
    //     assert!((llvm::UWTableKind::Sync as u32) < (llvm::UWTableKind::Async as u32));
    // }

    let uwtable: number;
    switch (sess.opts.unstable_opts.use_sync_unwind) {
      case true:
        uwtable = llvm.UWTableKind_discriminant.Sync;
        break;
      case false:
      case undefined:
        uwtable = llvm.UWTableKind_discriminant.Async;
        break;
    }
    llvm.add_module_flag_u32(llmod, "Max", "uwtable", uwtable);
  }

  // Add "kcfi" module flag if KCFI is enabled. (See https://reviews.llvm.org/D119296.)
  if (sess.is_sanitizer_kcfi_enabled()) {
    llvm.add_module_flag_u32(llmod, "Override", "kcfi", 1);

    // Add "kcfi-offset" module flag with -Z patchable-function-entry (See
    // https://reviews.llvm.org/D141172).
    const patchable_prefix_nops = sess.opts.unstable_opts.patchable_function_entry.prefix();
    if (patchable_prefix_nops > 0) {
      llvm.add_module_flag_u32(llmod, "Override", "kcfi-offset", patchable_prefix_nops);
    }

    // Add "kcfi-arity" module flag if KCFI arity indicator is enabled. (See
    // https://github.com/llvm/llvm-project/pull/117121.)
    if (sess.is_sanitizer_kcfi_arity_enabled()) {
      llvm.add_module_flag_u32(llmod, "Override", "kcfi-arity", 1);
    }
  }

  // Control Flow Guard is currently only supported by MSVC and LLVM on Windows.
  if (
    sess.target.is_like_msvc ||
    (sess.target.options.os.$ === "Windows" && sess.target.options.env.$ === "Gnu" && sess.target.options.cfg_abi.$ === "Llvm")
  ) {
    switch (sess.opts.cg.control_flow_guard) {
      case "Disabled":
        break;
      case "NoChecks":
        // Set `cfguard=1` module flag to emit metadata only.
        llvm.add_module_flag_u32(llmod, "Warning", "cfguard", 1);
        break;
      case "Checks":
        // Set `cfguard=2` module flag to emit metadata and checks.
        llvm.add_module_flag_u32(llmod, "Warning", "cfguard", 2);
        break;
    }
  }

  const regparm_count = sess.opts.unstable_opts.regparm;
  if (regparm_count !== undefined) {
    llvm.add_module_flag_u32(llmod, "Error", "NumRegisterParameters", regparm_count);
  }

  const bp = Session_branch_protection(sess);
  if (bp !== undefined) {
    const { bti, pac_ret, gcs } = bp;
    if (sess.target.arch.$ === "AArch64") {
      llvm.add_module_flag_u32(llmod, "Min", "branch-target-enforcement", Number(bti));
      llvm.add_module_flag_u32(llmod, "Min", "sign-return-address", Number(pac_ret !== undefined));
      const pac_opts: PacRet =
        pac_ret ??
        (() => {
          // Windows on Arm only supports PAC key B.
          const key = sess.target.os.$ === "Windows" ? "B" : "A";
          return { leaf: false, pc: false, key };
        })();
      llvm.add_module_flag_u32(llmod, "Min", "branch-protection-pauth-lr", Number(pac_opts.pc));
      llvm.add_module_flag_u32(llmod, "Min", "sign-return-address-all", Number(pac_opts.leaf));
      llvm.add_module_flag_u32(llmod, "Min", "sign-return-address-with-bkey", Number(pac_opts.key === "B"));
      llvm.add_module_flag_u32(llmod, "Min", "guarded-control-stack", Number(gcs));
    } else {
      bug("branch-protection used on non-AArch64 target; this should be checked in rustc_session.");
    }
  }

  // Pass on the control-flow protection flags to LLVM (equivalent to `-fcf-protection` in Clang).
  if (sess.opts.unstable_opts.cf_protection === "Branch" || sess.opts.unstable_opts.cf_protection === "Full") {
    llvm.add_module_flag_u32(llmod, "Override", "cf-protection-branch", 1);
  }
  if (sess.opts.unstable_opts.cf_protection === "Return" || sess.opts.unstable_opts.cf_protection === "Full") {
    llvm.add_module_flag_u32(llmod, "Override", "cf-protection-return", 1);
  }

  if (sess.opts.unstable_opts.virtual_function_elimination) {
    llvm.add_module_flag_u32(llmod, "Error", "Virtual Function Elim", 1);
  }

  // Set module flag to enable Windows EHCont Guard (/guard:ehcont).
  if (sess.opts.unstable_opts.ehcont_guard) {
    llvm.add_module_flag_u32(llmod, "Warning", "ehcontguard", 1);
  }

  switch (sess.opts.unstable_opts.function_return) {
    case "Keep":
      break;
    case "ThunkExtern":
      llvm.add_module_flag_u32(llmod, "Override", "function_return_thunk_extern", 1);
      break;
  }

  const fp = attributes().frame_pointer(sess);
  if (fp !== "MayOmit") {
    let fp_kind: number;
    switch (fp as FramePointer) {
      case "Always":
        fp_kind = llvm.FramePointerKind_discriminant.All;
        break;
      case "NonLeaf":
        fp_kind = llvm.FramePointerKind_discriminant.NonLeaf;
        break;
      case "MayOmit":
        fp_kind = llvm.FramePointerKind_discriminant.None;
        break;
    }
    llvm.add_module_flag_u32(llmod, "Max", "frame-pointer", fp_kind);
  }

  if (sess.opts.unstable_opts.indirect_branch_cs_prefix) {
    llvm.add_module_flag_u32(llmod, "Override", "indirect_branch_cs_prefix", 1);
  }

  {
    const threshold = sess.opts.unstable_opts.small_data_threshold;
    const support = sess.target.small_data_threshold_support_();
    // Set up the small-data optimization limit for architectures that use
    // an LLVM module flag to control this.
    if (threshold !== undefined && support.$ === "LlvmModuleFlag") {
      const flag = support._0;
      // `threshold as u32` (a `usize`)
      llvm.add_module_flag_u32(llmod, "Error", flag, threshold >>> 0);
    }
  }

  // Insert `llvm.ident` metadata.
  //
  // On the wasm targets it will get hooked up to the "producer" sections
  // `processed-by` information.
  // #[allow(clippy::option_env_unwrap)]
  const rustc_producer = `rustc version ${rustc_interface_util().CFG_VERSION}`;

  const name_metadata = cx.create_metadata(new TextEncoder().encode(rustc_producer));
  cx.module_add_named_metadata_node(llmod, "llvm.ident", [name_metadata]);

  // Emit the target-abi module flag for LoongArch and RISC-V to pass the ABI to LTO.
  const llvm_abiname = sess.target.options.llvm_abiname;
  const arch = sess.target.arch.$;
  if (arch === "LoongArch32" || arch === "LoongArch64" || arch === "RiscV32" || arch === "RiscV64") {
    llvm.add_module_flag_str(llmod, "Error", "target-abi", LlvmAbi.desc(llvm_abiname));
  }

  const floatabi = sess.target.llvm_floatabi;
  if (version_ge(llvm_version, [24, 0, 0]) && floatabi !== undefined) {
    llvm.add_module_flag_str(llmod, "Error", "float-abi", FloatAbi.desc(floatabi));
  }

  if (version_ge(llvm_version, [24, 0, 0])) {
    if (sess.target.singlethread_(sess.internal_target_features)) {
      llvm.add_module_flag_str(llmod, "Error", "thread-model", "single");
    }
    if (wants_wasm_eh(sess.target)) {
      llvm.add_module_flag_str(llmod, "Error", "exception-model", "wasm");
    }
  }

  // Add module flags specified via -Z llvm_module_flag
  for (const [key, value, merge_behavior_str] of sess.opts.unstable_opts.llvm_module_flag) {
    let merge_behavior: llvm.ModuleFlagMergeBehavior;
    switch (merge_behavior_str) {
      case "error":
        merge_behavior = "Error";
        break;
      case "warning":
        merge_behavior = "Warning";
        break;
      case "require":
        merge_behavior = "Require";
        break;
      case "override":
        merge_behavior = "Override";
        break;
      case "append":
        merge_behavior = "Append";
        break;
      case "appendunique":
        merge_behavior = "AppendUnique";
        break;
      case "max":
        merge_behavior = "Max";
        break;
      case "min":
        merge_behavior = "Min";
        break;
      // We already checked this during option parsing
      default:
        unreachable();
    }
    llvm.add_module_flag_u32(llmod, merge_behavior, key, value);
  }

  return llmod;
}

/** PORT (cg-context): `llvm_version < (a, b, c)` on `(u32, u32, u32)` tuples: lexicographic. */
function version_lt(v: readonly [number, number, number], w: readonly [number, number, number]): boolean {
  if (v[0] !== w[0]) return v[0] < w[0];
  if (v[1] !== w[1]) return v[1] < w[1];
  return v[2] < w[2];
}

/** PORT (cg-context): `llvm_version >= (a, b, c)`. */
function version_ge(v: readonly [number, number, number], w: readonly [number, number, number]): boolean {
  return !version_lt(v, w);
}

/** The `FullCx` fields `CodegenCx` reaches by auto-deref as accessors (header): all but `vtables`, `statics_to_rauw`,
 *  `coverage_cx` and `eh_personality`. */
export const FULL_CX_DEREF_FIELDS = [
  "tcx",
  "bitcode_needed",
  "scx",
  "use_dll_storage_attrs",
  "tls_model",
  "codegen_unit",
  "instances",
  "intrinsic_instances",
  "const_str_cache",
  "const_globals",
  "used_statics",
  "compiler_used_statics",
  "type_lowering",
  "scalar_lltypes",
  "dbg_cx",
  "sanitizer_ignorelist",
  "rust_try_fn",
  "intrinsics",
  "local_gen_sym_counter",
  "global_gen_sym_counter",
  "renamed_statics",
  "objc_class_t",
  "objc_classrefs",
  "objc_selrefs",
  "offload_globals",
  "offload_kernel_cache",
] as const satisfies readonly (keyof FullCx)[];
type FullCxDeref = Pick<FullCx, (typeof FULL_CX_DEREF_FIELDS)[number]>;

/** The methods of `impl SimpleCx` that `CodegenCx` reaches through `FullCx`'s deref to `SimpleCx` (header);
 *  `install_deref_methods` forwards them at run time. */
type SimpleCxDeref = Pick<SimpleCx, "get_type_of_global">;

// Declaration merging: the deref'd fields and methods are members of `CodegenCx` (header).
export interface CodegenCx extends FullCxDeref, SimpleCxDeref {}

/** PORT (cg-context): the key of `FullCx.intrinsics`, `(Cow<'static, str>, SmallVec<[&'ll Type; 2]>)`, compared by value:
 *  the name, and each `&Type` by pointer identity. Model types are uniqued (one object per LLVM type) but opaque to ported code,
 *  so each `CodegenCx` numbers the types it sees in its own map, and the key is the quoted name with those numbers. */
function intrinsics_key_fn(): (k: readonly [string, readonly Type[]]) => string {
  const ids = new Map<Type, number>();
  const id = (t: Type): number => {
    let n = ids.get(t);
    if (n === undefined) ids.set(t, (n = ids.size));
    return n;
  };
  return ([base_name, type_params]) => `${JSON.stringify(base_name)}${type_params.map((t) => `,${id(t)}`).join("")}`;
}

export class CodegenCx extends GenericCx<FullCx> implements CodegenMethods<LlvmTypes>, MiscCodegenMethods<LlvmTypes> {
  // ---- impl<'ll, 'tcx> CodegenCx<'ll, 'tcx> (context.rs:599) ----
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:600 new
  static new(tcx: TyCtxt, codegen_unit: CodegenUnit, llvm_module: ModuleLlvm, bitcode_needed: boolean): CodegenCx {
    // An interesting part of Windows which MSVC forces our hand on (and
    // apparently MinGW didn't) is the usage of `dllimport` and `dllexport`
    // attributes in LLVM IR as well as native dependencies (in C these
    // correspond to `__declspec(dllimport)`).
    //
    // LD (BFD) in MinGW mode can often correctly guess `dllexport` but
    // relying on that can result in issues like #50176.
    // LLD won't support that and expects symbols with proper attributes.
    // Because of that we make MinGW target emit dllexport just like MSVC.
    // When it comes to dllimport we use it for constants but for functions
    // rely on the linker to do the right thing. Opposed to dllexport this
    // task is easy for them (both LD and LLD) and allows us to easily use
    // symbols from static libraries in shared libraries.
    //
    // Whenever a dynamic library is built on Windows it must have its public
    // interface specified by functions tagged with `dllexport` or otherwise
    // they're not available to be linked against. This poses a few problems
    // for the compiler, some of which are somewhat fundamental, but we use
    // the `use_dll_storage_attrs` variable below to attach the `dllexport`
    // attribute to all LLVM functions that are exported e.g., they're
    // already tagged with external linkage). This is suboptimal for a few
    // reasons:
    //
    // * If an object file will never be included in a dynamic library,
    //   there's no need to attach the dllexport attribute. Most object
    //   files in Rust are not destined to become part of a dll as binaries
    //   are statically linked by default.
    // * If the compiler is emitting both an rlib and a dylib, the same
    //   source object file is currently used but with MSVC this may be less
    //   feasible. The compiler may be able to get around this, but it may
    //   involve some invasive changes to deal with this.
    //
    // The flip side of this situation is that whenever you link to a dll and
    // you import a function from it, the import should be tagged with
    // `dllimport`. At this time, however, the compiler does not emit
    // `dllimport` for any declarations other than constants (where it is
    // required), which is again suboptimal for even more reasons!
    //
    // * Calling a function imported from another dll without using
    //   `dllimport` causes the linker/compiler to have extra overhead (one
    //   `jmp` instruction on x86) when calling the function.
    // * The same object file may be used in different circumstances, so a
    //   function may be imported from a dll if the object is linked into a
    //   dll, but it may be just linked against if linked into an rlib.
    // * The compiler has no knowledge about whether native functions should
    //   be tagged dllimport or not.
    //
    // For now the compiler takes the perf hit (I do not have any numbers to
    // this effect) by marking very little as `dllimport` and praying the
    // linker will take care of everything. Fixing this problem will likely
    // require adding a few attributes to Rust itself (feature gated at the
    // start) and then strongly recommending static linkage on Windows!
    const use_dll_storage_attrs = tcx.sess.target.is_like_windows;

    const tls_model = to_llvm_tls_model(tcx.sess.tls_model());

    const [llcx, llmod] = [llvm_module.llcx, llvm_module.llmod()];

    // `tcx.sess.instrument_coverage().then(coverageinfo::CguCoverageContext::new)`: coverageinfo is out of M7 (plan-m7 D18),
    // and coverageinfo/mod.ts has no stub of `CguCoverageContext::new` (review cg-contract-recheck N1), so the `then` arm stops.
    const coverage_cx: CguCoverageContext | undefined = tcx.sess.instrument_coverage()
      ? unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/coverageinfo/mod.rs CguCoverageContext::new")
      : undefined;

    let dbg_cx: CodegenUnitDebugContext | undefined;
    if (tcx.sess.opts.debuginfo !== "None") {
      const dctx = debuginfo_mod().CodegenUnitDebugContext.new(llmod, tcx.sess);
      debuginfo_metadata().build_compile_unit_di_node(tcx, Symbol.as_str(codegen_unit.name()), dctx);
      dbg_cx = dctx;
    } else {
      dbg_cx = undefined;
    }

    // FIXME: This parses the ignorelist files for each CGU, which adds a performance overhead.
    // Clang parses it once per frontend invocation. LLVM's `SpecialCaseList::inSection`
    // mutates an internal `LazyInit` cache and is not thread-safe. We either need to wrap
    // the queries in a lock or wait for LLVM to expose a thread-safe way to query it.
    let sanitizer_ignorelist: SanitizerIgnoreList | undefined;
    if (tcx.sess.opts.unstable_opts.sanitizer_ignorelist.length !== 0) {
      for (const path of tcx.sess.opts.unstable_opts.sanitizer_ignorelist) {
        void tcx.sess.source_map().load_file(path);
      }
      // `match SanitizerIgnoreList::new(..) { Ok(list) => Some(list), Err(err) => tcx.dcx().fatal(..) }`: rustc_sanitizers is
      // out of scope (harness/scope.json).
      sanitizer_ignorelist = unported("rustc_sanitizers: compiler/rustc_sanitizers/src/ignorelist/mod.rs SanitizerIgnoreList::new");
    } else {
      sanitizer_ignorelist = undefined;
    }

    return new CodegenCx(
      new FullCx(
        /* tcx */ tcx,
        /* bitcode_needed */ bitcode_needed,
        /* scx */ SimpleCx.new(llmod, llcx, tcx.data_layout().pointer_size()),
        /* use_dll_storage_attrs */ use_dll_storage_attrs,
        /* tls_model */ tls_model,
        /* codegen_unit */ codegen_unit,
        /* instances */ new KeyedMap<Instance, Value>(intern_key),
        /* intrinsic_instances */ new KeyedMap<Instance, Value>(intern_key),
        /* vtables */ new KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], Value>(intern_key),
        /* const_str_cache */ new Map(),
        /* const_globals */ new Map(),
        /* statics_to_rauw */ [],
        /* used_statics */ [],
        /* compiler_used_statics */ [],
        /* type_lowering */ new KeyedMap<readonly [Ty, VariantIdx | undefined], Type>(intern_key),
        /* scalar_lltypes */ new Map(),
        /* coverage_cx */ coverage_cx,
        /* dbg_cx */ dbg_cx,
        /* sanitizer_ignorelist */ sanitizer_ignorelist,
        /* eh_personality */ undefined,
        /* rust_try_fn */ undefined,
        /* intrinsics */ new KeyedMap(intrinsics_key_fn()),
        /* local_gen_sym_counter */ 0,
        /* global_gen_sym_counter */ 0,
        /* renamed_statics */ new DefIdMap(),
        /* objc_class_t */ undefined,
        /* objc_classrefs */ new Map(),
        /* objc_selrefs */ new Map(),
        /* offload_globals */ undefined,
        /* offload_kernel_cache */ new Map(),
      ),
    );
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:734 statics_to_rauw
  statics_to_rauw(): [Value, Value][] {
    return this._0.statics_to_rauw;
  }

  /// Extra state that is only available when coverage instrumentation is enabled.
  // #[inline]
  // #[track_caller]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:741 coverage_cx
  coverage_cx(): CguCoverageContext {
    const coverage_cx = this._0.coverage_cx;
    if (coverage_cx === undefined) return panic("only called when coverage instrumentation is enabled");
    return coverage_cx;
  }

  /** `name: &'static CStr` */
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:745 create_used_variable_impl
  create_used_variable_impl(name: string, values: readonly Value[]): void {
    const array = this.const_array(this.type_ptr(), values);

    const g = llvm.add_global(this.llmod(), this.val_ty(array), name);
    llvm.set_initializer(g, array);
    llvm.set_linkage(g, "AppendingLinkage");
    llvm.set_section(g, "llvm.metadata");
  }

  /// The Objective-C ABI that is used.
  ///
  /// This corresponds to the `-fobjc-abi-version=` flag in Clang / GCC.
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:757 objc_abi_version
  objc_abi_version(): number {
    assert(this.tcx.sess.target.is_like_darwin, "assertion failed: self.tcx.sess.target.is_like_darwin");
    if (this.tcx.sess.target.arch.$ === "X86" && this.tcx.sess.target.os.$ === "MacOs") {
      // 32-bit x86 macOS uses ABI version 1 (a.k.a. the "fragile ABI").
      return 1;
    } else {
      // All other Darwin-like targets we support use ABI version 2
      // (a.k.a the "non-fragile ABI").
      return 2;
    }
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:769 add_ptrauth_elf_got_flag
  add_ptrauth_elf_got_flag(): void {
    llvm.add_module_flag_u32(this.llmod(), "Error", "ptrauth-elf-got", 1);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:778 add_ptrauth_sign_personality_flag
  add_ptrauth_sign_personality_flag(): void {
    llvm.add_module_flag_u32(this.llmod(), "Error", "ptrauth-sign-personality", 1);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:787 add_ptrauth_pauthabi_version_and_platform_flags
  add_ptrauth_pauthabi_version_and_platform_flags(aarch64_elf_pauthabi_version: number): void {
    // NOTE: This must correspond to llvm's AARCH64_PAUTH_PLATFORM_LLVM_LINUX, as defined in
    // <llvm_root>/llvm/include/llvm/BinaryFormat/ELF.h.
    // FIXME (jchlanda) extend possible values once we start supporting other platforms (for
    // example: AARCH64_PAUTH_PLATFORM_BAREMETAL = 0x1);
    const AARCH64_PAUTH_PLATFORM_LLVM_LINUX = 0x10000002;
    llvm.add_module_flag_u32(this.llmod(), "Error", "aarch64-elf-pauthabi-platform", AARCH64_PAUTH_PLATFORM_LLVM_LINUX);
    llvm.add_module_flag_u32(this.llmod(), "Error", "aarch64-elf-pauthabi-version", aarch64_elf_pauthabi_version);
  }

  // We do our best here to match what Clang does when compiling Objective-C natively.
  // See Clang's `CGObjCCommonMac::EmitImageInfo`:
  // https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGObjCMac.cpp#L5085
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:813 add_objc_module_flags
  add_objc_module_flags(): void {
    const abi_version = this.objc_abi_version();

    llvm.add_module_flag_u32(this.llmod(), "Error", "Objective-C Version", abi_version);

    llvm.add_module_flag_u32(this.llmod(), "Error", "Objective-C Image Info Version", 0);

    let section: string;
    switch (abi_version) {
      case 1:
        section = "__OBJC,__image_info,regular";
        break;
      case 2:
        section = "__DATA,__objc_imageinfo,regular,no_dead_strip";
        break;
      default:
        return unreachable();
    }
    llvm.add_module_flag_str(this.llmod(), "Error", "Objective-C Image Info Section", section);

    if (this.tcx.sess.target.env.$ === "Sim") {
      llvm.add_module_flag_u32(this.llmod(), "Error", "Objective-C Is Simulated", 1 << 5);
    }

    llvm.add_module_flag_u32(this.llmod(), "Error", "Objective-C Class Properties", 1 << 6);
  }

  /** `sanitizer: &std::ffi::CStr` */
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:858 is_sanitizer_type_ignored
  is_sanitizer_type_ignored(_sanitizer: string, _fn_abi: FnAbi<Ty>): boolean {
    const ignorelist = this.sanitizer_ignorelist;
    if (ignorelist === undefined) return false;
    // `let type_name = typename_for_ignore_list(self.tcx, fn_abi); ignorelist.contains_prefix(sanitizer, c"type", &type_name)`:
    // rustc_sanitizers is out of scope (harness/scope.json); a `FullCx` never holds a list (`CodegenCx::new` stops first).
    return unported("rustc_sanitizers: compiler/rustc_sanitizers/src/ignorelist/mod.rs typename_for_ignore_list");
  }

  // ---- impl<'ll, 'tcx> MiscCodegenMethods<'tcx> for CodegenCx<'ll, 'tcx> (context.rs:932) ----
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:933 vtables
  vtables(): KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], Value> {
    return this._0.vtables;
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:939 apply_vcall_visibility_metadata
  apply_vcall_visibility_metadata(ty: Ty, poly_trait_ref: ExistentialTraitRef | undefined, vtable: Value): void {
    debuginfo_metadata().apply_vcall_visibility_metadata(this, ty, poly_trait_ref, vtable);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:948 get_fn
  get_fn(instance: Instance): Value {
    return callee().get_fn(this, instance);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:952 get_fn_addr
  get_fn_addr(instance: Instance, pointer_auth_schema: PointerAuthSchema | undefined): Value {
    // When pointer authentication metadata is provided, `get_fn_addr` will
    // attempt to sign the pointer using LLVM's `ConstPtrAuth` constant
    // expression.
    //
    // FIXME(jchlanda) Currently, all function addresses requested from
    // within LLVM codegen are signed. This behavior is too broad, resulting
    // in the logic being applied to function values, not just pointers
    // (addresses).
    //
    // See the discussion in the rust-lang issue:
    // <https://github.com/rust-lang/rust/issues/152532>, and comment in
    // builder's `ptrauth_operand_bundle`.
    const llfn = callee().get_fn(this, instance);
    if (pointer_auth_schema !== undefined) {
      return common().maybe_sign_fn_ptr(this, instance, llfn, pointer_auth_schema);
    } else {
      return llfn;
    }
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:976 eh_personality
  eh_personality(): Value {
    // The exception handling personality function.
    //
    // If our compilation unit has the `eh_personality` lang item somewhere
    // within it, then we just need to codegen that. Otherwise, we're
    // building an rlib which will depend on some upstream implementation of
    // this function, so we just codegen a generic reference to it. We don't
    // specify any of the types for the function, we just make it a symbol
    // that LLVM can later use.
    //
    // Note that MSVC is a little special here in that we don't use the
    // `eh_personality` lang item at all. Currently LLVM has support for
    // both Dwarf and SEH unwind mechanisms for MSVC targets and uses the
    // *name of the personality function* to decide what kind of unwind side
    // tables/landing pads to emit. It looks like Dwarf is used by default,
    // injecting a dependency on the `_Unwind_Resume` symbol for resuming
    // an "exception", but for MSVC we want to force SEH. This means that we
    // can't actually have the personality function be our standard
    // `rust_eh_personality` function, but rather we wired it up to the
    // CRT's custom personality function, which forces LLVM to consider
    // landing pads as "landing pads for SEH".
    const llpersonality = this._0.eh_personality;
    if (llpersonality !== undefined) {
      return llpersonality;
    }

    let name: string | undefined;
    if (wants_msvc_seh(this.sess().target)) {
      name = "__CxxFrameHandler3";
    } else if (wants_wasm_eh(this.sess().target)) {
      // LLVM specifically tests for the name of the personality function
      // There is no need for this function to exist anywhere, it will
      // not be called. However, its name has to be "__gxx_wasm_personality_v0"
      // for native wasm exceptions.
      name = "__gxx_wasm_personality_v0";
    } else {
      name = undefined;
    }

    const tcx = this.tcx;
    let llfn: Value;
    const def_id = tcx.lang_items().eh_personality();
    if (def_id !== undefined && name === undefined) {
      llfn = this.get_fn_addr(
        Instance.expect_resolve(tcx, this.typing_env_(), def_id, RawList.empty(), DUMMY_SP),
        tcx.sess.pointer_authentication_functions(),
      );
    } else {
      const name_ = name ?? "rust_eh_personality";
      const declared = this.get_declared_value(name_);
      if (declared !== undefined) {
        llfn = declared;
      } else {
        const fty = this.type_variadic_func([], this.type_i32());
        const llfn_ = this.declare_cfn(name_, "Global", fty);
        const target_cpu = attributes().target_cpu_attr(this.scx, this.sess());
        attributes().apply_to_llfn(llfn_, llvm.AttributePlace.Function, [target_cpu]);
        llfn = llfn_;
      }
    }
    this._0.eh_personality = llfn;
    return llfn;
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1042 sess
  sess(): Session {
    return this.tcx.sess;
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1046 set_frame_pointer_type
  set_frame_pointer_type(llfn: Value): void {
    const attr = attributes().frame_pointer_type_attr(this.scx, this.sess());
    if (attr !== undefined) {
      attributes().apply_to_llfn(llfn, llvm.AttributePlace.Function, [attr]);
    }
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1052 apply_target_cpu_attr
  apply_target_cpu_attr(llfn: Value): void {
    const attrs: llvm.Attribute[] = [];
    attrs.push(attributes().target_cpu_attr(this.scx, this.sess()));
    const tune_cpu = attributes().tune_cpu_attr(this.scx, this.sess());
    if (tune_cpu !== undefined) attrs.push(tune_cpu);
    attributes().apply_to_llfn(llfn, llvm.AttributePlace.Function, attrs);
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1059 declare_c_main
  declare_c_main(fn_type: Type): Value | undefined {
    const entry_name = this.sess().target.entry_name;
    if (this.get_declared_value(entry_name) === undefined) {
      const llfn = this.declare_entry_fn(
        entry_name,
        abi().to_llvm_calling_convention(this.sess(), this.sess().target.entry_abi),
        "Global",
        fn_type,
      );
      const target_features = attributes().target_features_attr(this.scx, this.tcx, []);
      attributes().apply_to_llfn(llfn, llvm.AttributePlace.Function, target_features === undefined ? [] : [target_features]);
      return llfn;
    } else {
      // If the symbol already exists, it is an error: for example, the user wrote
      // #[no_mangle] extern "C" fn main(..) {..}
      return undefined;
    }
  }

  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1081 intrinsic_call_expects_place_always
  intrinsic_call_expects_place_always(name: Symbol): boolean {
    return name === sym.black_box;
  }

  // ---- impl DerivedTypeCodegenMethods for CodegenCx (-:0) ----
  // (provided) DerivedTypeCodegenMethods::type_int -> DerivedTypeCodegenMethods_provided.type_int
  type_int(): Type {
    return DerivedTypeCodegenMethods_provided.type_int(this);
  }

  // (provided) DerivedTypeCodegenMethods::type_from_integer -> DerivedTypeCodegenMethods_provided.type_from_integer
  type_from_integer(i: Integer): Type {
    return DerivedTypeCodegenMethods_provided.type_from_integer(this, i);
  }

  // (provided) DerivedTypeCodegenMethods::type_from_float -> DerivedTypeCodegenMethods_provided.type_from_float
  type_from_float(f: Float): Type {
    return DerivedTypeCodegenMethods_provided.type_from_float(this, f);
  }

  // (provided) DerivedTypeCodegenMethods::type_needs_drop -> DerivedTypeCodegenMethods_provided.type_needs_drop
  type_needs_drop(ty: Ty): boolean {
    return DerivedTypeCodegenMethods_provided.type_needs_drop(this, ty);
  }

  // (provided) DerivedTypeCodegenMethods::type_is_sized -> DerivedTypeCodegenMethods_provided.type_is_sized
  type_is_sized(ty: Ty): boolean {
    return DerivedTypeCodegenMethods_provided.type_is_sized(this, ty);
  }

  // (provided) DerivedTypeCodegenMethods::type_is_freeze -> DerivedTypeCodegenMethods_provided.type_is_freeze
  type_is_freeze(ty: Ty): boolean {
    return DerivedTypeCodegenMethods_provided.type_is_freeze(this, ty);
  }

  // (provided) DerivedTypeCodegenMethods::type_from_primitive -> DerivedTypeCodegenMethods_provided.type_from_primitive
  type_from_primitive(p: Primitive): Type {
    return DerivedTypeCodegenMethods_provided.type_from_primitive(this, p);
  }

  // (provided) DerivedTypeCodegenMethods::type_from_scalar -> DerivedTypeCodegenMethods_provided.type_from_scalar
  type_from_scalar(s: abi_Scalar): Type {
    return DerivedTypeCodegenMethods_provided.type_from_scalar(this, s);
  }

  // ---- impl<'ll> CodegenCx<'ll, '_> (context.rs:1086) ----
  /** `base_name: Cow<'static, str>` */
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1087 get_intrinsic
  get_intrinsic(base_name: string, type_params: readonly Type[]): [Type, Value] {
    // `*self.intrinsics.borrow_mut().entry((base_name, SmallVec::from_slice(type_params))).or_insert_with_key(..)`
    const intrinsics = this.intrinsics;
    const key = [base_name, type_params.slice()] as const;
    let entry = intrinsics.get(key);
    if (entry === undefined) {
      entry = this.declare_intrinsic(key[0], key[1]);
      intrinsics.set(key, entry);
    }
    return [entry[0], entry[1]];
  }

  /** private */
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1101 declare_intrinsic
  declare_intrinsic(base_name: string, type_params: readonly Type[]): [Type, Value] {
    switch (base_name) {
      // This isn't an "LLVM intrinsic", but LLVM's optimization passes
      // recognize it like one (including turning it into `bcmp` sometimes)
      // and we use it to implement intrinsics like `raw_eq` and `compare_bytes`
      case "memcmp": {
        const fn_ty = this.type_func([this.type_ptr(), this.type_ptr(), this.type_isize()], this.type_int());
        const f = this.declare_cfn("memcmp", "No", fn_ty);

        return [fn_ty, f];
      }
      // Experimental retag intrinsics.
      // This form is used to retag a pointer that has already been stored in a register. It receives
      // the pointer and returns an alias with the same address, but different provenance.
      case "__rust_retag_reg": {
        const fn_ty = this.type_func(type_params, this.type_ptr());
        const llfn = this.declare_cfn(base_name, "No", fn_ty);
        const nounwind = llvm.AttributeKind_impl.create_attr("NoUnwind", this.llcx());
        attributes().apply_to_llfn(llfn, llvm.AttributePlace.Function, [nounwind]);
        return [fn_ty, llfn];
      }
      // This form is used to retag a pointer that is stored in another place. It receives a pointer to the
      // place and returns `void`. This communicates the indirection  without requiring an explicit load and
      // store. If we used the `reg` form instead, then we would need to load the place, retag it, and then
      // store the result back, which would be undefined behavior for `readonly` places.
      case "__rust_retag_mem": {
        const fn_ty = this.type_func(type_params, this.type_void());
        const llfn = this.declare_cfn(base_name, "No", fn_ty);
        const nounwind = llvm.AttributeKind_impl.create_attr("NoUnwind", this.llcx());
        attributes().apply_to_llfn(llfn, llvm.AttributePlace.Function, [nounwind]);
        return [fn_ty, llfn];
      }
      default: {
        const intrinsic = llvm.Intrinsic.lookup(new TextEncoder().encode(base_name)) ?? bug(`Unknown intrinsic: \`${base_name}\``);
        const f = intrinsic.get_declaration(this.llmod(), type_params);
        return [this.get_type_of_global(f), f];
      }
    }
  }

  // ---- impl CodegenCx<'_, '_> (context.rs:1150) ----
  /// Generates a new symbol name with the given prefix. This symbol name must
  /// only be used for definitions with `internal` or `private` linkage.
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1153 generate_local_symbol_name
  generate_local_symbol_name(prefix: string): string {
    const idx = this.local_gen_sym_counter;
    this.local_gen_sym_counter = idx + 1;
    // Include a '.' character, so there can be no accidental conflicts with
    // user defined names
    let name = "";
    name += prefix;
    name += ".";
    name += to_base(BigInt(idx), ALPHANUMERIC_ONLY).as_str();
    return name;
  }

  /// Generates a new global symbol name with the given prefix.
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1166 generate_global_symbol_name
  generate_global_symbol_name(): string {
    const idx = this.global_gen_sym_counter;
    this.global_gen_sym_counter = idx + 1;

    const sym_ = this.codegen_unit.symbol_name();
    const prefix = Symbol.as_str(sym_);
    let name = "";
    name += prefix;
    name += ".";
    name += to_base(BigInt(idx), ALPHANUMERIC_ONLY).as_str();
    return name;
  }

  // ---- impl HasDataLayout for CodegenCx (context.rs:1254) ----
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1256 data_layout
  data_layout(): TargetDataLayout {
    return this.tcx.data_layout();
  }

  // ---- impl HasTargetSpec for CodegenCx (context.rs:1261) ----
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1263 target_spec
  target_spec(): Target {
    return this.tcx.sess.target;
  }

  // ---- impl HasTyCtxt for CodegenCx (context.rs:1268) ----
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1270 tcx
  tcx_(): TyCtxt {
    return this.tcx;
  }

  // ---- impl HasTypingEnv for CodegenCx (context.rs:1275) ----
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1276 typing_env
  typing_env_(): TypingEnv {
    return TypingEnv.fully_monomorphized();
  }

  // ---- impl LayoutOfHelpers for CodegenCx (context.rs:1281) ----
  // type LayoutOfResult = TyAndLayout<'tcx>; (the trait's default: `impl<T> MaybeResult<T> for T`)
  get LayoutOfResult(): MaybeResult<TyAndLayout, TyAndLayout, never> {
    return MaybeResult_T;
  }
  // (provided) ty/layout.rs:740 layout_tcx_at_span -> LayoutOfHelpers_provided.layout_tcx_at_span
  layout_tcx_at_span(): Span {
    return LayoutOfHelpers_provided.layout_tcx_at_span(this);
  }
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1283 handle_layout_err
  handle_layout_err(err: LayoutError, span: Span, ty: Ty): never {
    if (err.$ === "SizeOverflow" || err.$ === "ReferencesError" || err.$ === "InvalidSimd") {
      return this.tcx.dcx().span_fatal(span, display_LayoutError(err));
    } else {
      return this.tcx.dcx().emit_fatal(FailedToGetLayout_diagnostic({ span, ty, err }));
    }
  }

  // ---- impl FnAbiOfHelpers for CodegenCx (context.rs:1295) ----
  // type FnAbiOfResult = &'tcx FnAbi<'tcx, Ty<'tcx>>; (the trait's default)
  get FnAbiOfResult(): MaybeResult<FnAbi<Ty>, FnAbi<Ty>, never> {
    return MaybeResult_T;
  }
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/context.rs:1297 handle_fn_abi_err
  handle_fn_abi_err(err: FnAbiError, span: Span, fn_abi_request: FnAbiRequest): never {
    return codegen_handle_fn_abi_err(this.tcx, err, span, fn_abi_request).raise_fatal();
  }

  // ---- impl<'tcx, C: LayoutOfHelpers<'tcx>> LayoutOf<'tcx> for C {} (rustc_middle ty/layout.rs) ----
  // (provided) ty/layout.rs:764 layout_of -> LayoutOf_provided.layout_of
  layout_of(ty: Ty): TyAndLayout {
    return LayoutOf_provided.layout_of(this, ty);
  }
  // (provided) ty/layout.rs:773 spanned_layout_of -> LayoutOf_provided.spanned_layout_of
  spanned_layout_of(ty: Ty, span: Span): TyAndLayout {
    return LayoutOf_provided.spanned_layout_of(this, ty, span);
  }

  // ---- impl<'tcx, C: FnAbiOfHelpers<'tcx>> FnAbiOf<'tcx> for C {} (rustc_middle ty/layout.rs) ----
  // (provided) ty/layout.rs:1452 fn_abi_of_fn_ptr -> FnAbiOf_provided.fn_abi_of_fn_ptr
  fn_abi_of_fn_ptr(sig: PolyFnSig, extra_args: List<Ty>): FnAbi<Ty> {
    return FnAbiOf_provided.fn_abi_of_fn_ptr(this, sig, extra_args);
  }
  // (provided) ty/layout.rs:1481 fn_abi_of_instance_no_deduced_attrs -> FnAbiOf_provided.fn_abi_of_instance_no_deduced_attrs
  fn_abi_of_instance_no_deduced_attrs(instance: Instance, extra_args: List<Ty>): FnAbi<Ty> {
    return FnAbiOf_provided.fn_abi_of_instance_no_deduced_attrs(this, instance, extra_args);
  }
  // (provided) ty/layout.rs:1520 fn_abi_of_instance -> FnAbiOf_provided.fn_abi_of_instance
  fn_abi_of_instance(instance: Instance, extra_args: List<Ty>): FnAbi<Ty> {
    return FnAbiOf_provided.fn_abi_of_instance(this, instance, extra_args);
  }
}

// The auto-deref `CodegenCx` -> `FullCx` (header): one accessor per forwarded field.
for (const field of FULL_CX_DEREF_FIELDS) {
  Object.defineProperty(CodegenCx.prototype, field, {
    get(this: CodegenCx) {
      return this._0[field];
    },
    set(this: CodegenCx, value: never) {
      this._0[field] = value;
    },
    configurable: true,
  });
}

/** PORT (cg-contract): auto-deref to a `Deref::Target` for method calls (header): defines on `Self_.prototype` a
 *  forwarder `function (...args) { return deref(this).name(...args) }` for each method (and an accessor for each
 *  accessor property) of `Target.prototype`'s chain, up to `Object.prototype`, that `Self_.prototype`'s chain lacks. So the
 *  members `Self_` has win, as Rust's method resolution tries `Self` before its deref target. Called by lib.ts after every
 *  extension module has attached its methods. */
export function install_deref_methods(Self_: { prototype: object }, Target: { prototype: object }, deref: (self: never) => object): void {
  const seen = new Set<PropertyKey>(["constructor"]);
  for (let proto = Target.prototype; proto !== Object.prototype && proto !== null; proto = Object.getPrototypeOf(proto)) {
    for (const name of Reflect.ownKeys(proto)) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (name in Self_.prototype) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name)!;
      if (typeof desc.value === "function") {
        Object.defineProperty(Self_.prototype, name, {
          value: function (this: never, ...args: unknown[]): unknown {
            const target = deref(this) as Record<PropertyKey, (...a: unknown[]) => unknown>;
            return target[name]!(...args);
          },
          writable: true,
          configurable: true,
        });
      } else if (desc.get !== undefined) {
        Object.defineProperty(Self_.prototype, name, {
          get(this: never): unknown {
            return (deref(this) as Record<PropertyKey, unknown>)[name];
          },
          set(this: never, value: unknown) {
            (deref(this) as Record<PropertyKey, unknown>)[name] = value;
          },
          configurable: true,
        });
      }
    }
  }
}

// ---- Sibling modules, read lazily (header: this is the defining module of the classes they extend) ----
/** `crate::abi` (abi.ts), read lazily (init order). */
function abi(): typeof import("./abi.ts") {
  return (abi__m ??= require("./abi.ts") as typeof import("./abi.ts"));
}
var abi__m: typeof import("./abi.ts") | undefined;
/** `crate::attributes` (attributes.ts), read lazily (init order). */
function attributes(): typeof import("./attributes.ts") {
  return (attributes__m ??= require("./attributes.ts") as typeof import("./attributes.ts"));
}
var attributes__m: typeof import("./attributes.ts") | undefined;
/** `crate::back::write` (back/write.ts), read lazily (init order). */
function back_write(): typeof import("./back/write.ts") {
  return (back_write__m ??= require("./back/write.ts") as typeof import("./back/write.ts"));
}
var back_write__m: typeof import("./back/write.ts") | undefined;
/** `crate::callee` (callee.ts), read lazily (init order). */
function callee(): typeof import("./callee.ts") {
  return (callee__m ??= require("./callee.ts") as typeof import("./callee.ts"));
}
var callee__m: typeof import("./callee.ts") | undefined;
/** `crate::common` (common.ts, an extension module of this one), read lazily (init order). */
function common(): typeof import("./common.ts") {
  return (common__m ??= require("./common.ts") as typeof import("./common.ts"));
}
var common__m: typeof import("./common.ts") | undefined;
/** `crate::debuginfo` (debuginfo/mod.ts, an extension module of this one), read lazily (init order). */
function debuginfo_mod(): typeof import("./debuginfo/mod.ts") {
  return (debuginfo_mod__m ??= require("./debuginfo/mod.ts") as typeof import("./debuginfo/mod.ts"));
}
var debuginfo_mod__m: typeof import("./debuginfo/mod.ts") | undefined;
/** `crate::debuginfo::metadata` (debuginfo/metadata.ts), read lazily (init order). */
function debuginfo_metadata(): typeof import("./debuginfo/metadata.ts") {
  return (debuginfo_metadata__m ??= require("./debuginfo/metadata.ts") as typeof import("./debuginfo/metadata.ts"));
}
var debuginfo_metadata__m: typeof import("./debuginfo/metadata.ts") | undefined;
/** `crate::llvm_util` (llvm_util.ts), read lazily (init order). */
function llvm_util(): typeof import("./llvm_util.ts") {
  return (llvm_util__m ??= require("./llvm_util.ts") as typeof import("./llvm_util.ts"));
}
var llvm_util__m: typeof import("./llvm_util.ts") | undefined;
/** `option_env!("CFG_VERSION")` lives in rustc_interface/util.ts, which will import this crate's backend: read lazily (init order). */
function rustc_interface_util(): typeof import("../rustc_interface/util.ts") {
  return (rustc_interface_util__m ??= require("../rustc_interface/util.ts") as typeof import("../rustc_interface/util.ts"));
}
var rustc_interface_util__m: typeof import("../rustc_interface/util.ts") | undefined;

// ---- Callees in other crates that are not ported yet (header): typed stubs, for root to replace ----
/** PORT (cg-context): `Session::needs_plt` (rustc_session session.rs:863) is not in rustc_session/session.ts. */
export function Session_needs_plt(_sess: Session): boolean {
  return unported("rustc_session: compiler/rustc_session/src/session.rs Session::needs_plt");
}

/** PORT (cg-context): `Session::must_emit_unwind_tables` (rustc_session session.rs:1144) is not in rustc_session/session.ts. */
export function Session_must_emit_unwind_tables(_sess: Session): boolean {
  return unported("rustc_session: compiler/rustc_session/src/session.rs Session::must_emit_unwind_tables");
}

/** PORT (cg-context): `Session::branch_protection` (rustc_session session.rs:1125) is not in rustc_session/session.ts. */
export function Session_branch_protection(_sess: Session): BranchProtection | undefined {
  return unported("rustc_session: compiler/rustc_session/src/session.rs Session::branch_protection");
}

