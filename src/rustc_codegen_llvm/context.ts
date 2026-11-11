// compiler/rustc_codegen_llvm/src/context.rs: the SKELETON (lane cg-contract). The fill lane cg-context (plan-m7 §8 wave 41)
// owns this file: it ports the rest of context.rs here, replacing each `Stub (cg-contract)` method with its port.
//
// What is here: the structs (`SCx`, `GenericCx`, `FullCx`, the aliases `SimpleCx` / `CodegenCx`), their `Borrow` /
// `Deref` impls (ported), the trait impls of context.rs as typed stubs, and the forwarders of the blanket impls
// (`DerivedTypeCodegenMethods`, `LayoutOf`, `FnAbiOf`). The other files' trait impls for `CodegenCx` are typed stubs in the
// file of the lane that owns them (type_.ts, common.ts, consts.ts, mono_item.ts, asm.ts, debuginfo/mod.ts), attached with
// PORTING §5's extension pattern; lib.ts imports them.
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
// - The deref `FullCx` -> `SimpleCx` gives `CodegenCx` the methods of `impl SimpleCx` (`val_ty`, `get_type_of_global`):
//   `install_deref_methods(CodegenCx, SimpleCx, (cx) => cx._0.scx)` forwards every method of `SimpleCx.prototype` that
//   `CodegenCx` lacks. It runs in lib.ts after every extension module is loaded; cg-context declares each forwarded
//   method's type in `SimpleCxDeref` below.
// - Trait methods that collide with nothing keep their names. `HasTyCtxt::tcx` / `HasTypingEnv::typing_env` are `tcx_()`
//   / `typing_env_()` (layout-contract), so `cx.tcx` stays the field.
// - The associated types are `LlvmTypes` (common.ts, `impl BackendTypes for GenericCx`); `implements` below names the
//   traits, and `__backend_types` makes `B` inferable from `this` in the `_provided` helpers (ssa-contract N1).
import type { Size, TargetDataLayout } from "../rustc_abi/lib.ts";
import type { Float, Integer, Primitive, Scalar as abi_Scalar, VariantIdx } from "../rustc_abi/lib.ts";
import type { CodegenMethods } from "../rustc_codegen_ssa/traits/mod.ts";
import { DerivedTypeCodegenMethods_provided } from "../rustc_codegen_ssa/traits/type_.ts";
import type { MiscCodegenMethods, PointerAuthSchema } from "../rustc_codegen_ssa/traits/misc.ts";
import type { DefIdMap } from "../rustc_span/def_id.ts";
import type { CodegenUnit } from "../rustc_middle/mono.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import {
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
import type { List } from "../rustc_middle/ty/list.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { Session } from "../rustc_session/session.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import type { ExistentialTraitRef } from "../rustc_type_ir/predicate.ts";
import type { KeyedMap } from "../rust_ts/keyed.ts";
import { unported } from "../std/panic.ts";
import type { LlvmTypes } from "./common.ts";
import type { CguCoverageContext } from "./coverageinfo/mod.ts";
import type { CodegenUnitDebugContext } from "./debuginfo/mod.ts";
import type { Debug } from "../std/fmt.ts";
import type { Context, Module, ThreadLocalMode, Type, Value } from "./llvm/mod.ts";
import { debug_Value } from "./value.ts";

/** PORT (cg-contract): `rustc_sanitizers::ignorelist::SanitizerIgnoreList`. rustc_sanitizers is out of scope
 *  (harness/scope.json), so a `FullCx` holds `None` until a lane ports it; never constructed. */
export interface SanitizerIgnoreList {
  readonly __SanitizerIgnoreList: never;
}
/** PORT (cg-contract): `builder::gpu_offload::{OffloadGlobals, OffloadKernelGlobals}` (builder/gpu_offload.rs, `-Zoffload`,
 *  out of M7 per plan-m7 D18): never constructed. */
export type OffloadGlobals = never;
export type OffloadKernelGlobals = never;

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
}

export class SimpleCx extends GenericCx<SCx> {
  // Stub (cg-contract): SimpleCx::new (context.rs:878)
  static new(_llmod: Module, _llcx: Context, _pointer_size: Size): SimpleCx {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs new");
  }
}

/// There is one `CodegenCx` per codegen unit. Each one has its own LLVM
/// `llvm::Context` so that several codegen units may be processed in parallel.
/// All other LLVM data structures in the `CodegenCx` are tied to that `llvm::Context`.
// pub(crate) type CodegenCx<'ll, 'tcx> = GenericCx<'ll, FullCx<'ll, 'tcx>>; (header)

/** `-> &'ll llvm::Module` (an `unsafe fn`). */
// Stub (cg-contract): create_module (context.rs:184)
export function create_module(_tcx: TyCtxt, _llcx: Context, _mod_name: string): Module {
  return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs create_module");
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

/** The methods of `impl SimpleCx` that `CodegenCx` reaches through `FullCx`'s deref to `SimpleCx` (header). cg-context lists
 *  each one it ports (`Pick<SimpleCx, "val_ty" | ...>`); `install_deref_methods` forwards them at run time. */
type SimpleCxDeref = Pick<SimpleCx, never>;

// Declaration merging: the deref'd fields and methods are members of `CodegenCx` (header).
export interface CodegenCx extends FullCxDeref, SimpleCxDeref {}

export class CodegenCx extends GenericCx<FullCx> implements CodegenMethods<LlvmTypes>, MiscCodegenMethods<LlvmTypes> {
  // ---- impl MiscCodegenMethods for CodegenCx (context.rs:932) ----
  // Stub (cg-contract): MiscCodegenMethods::vtables
  vtables(): KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], Value> {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs vtables");
  }

  // Stub (cg-contract): MiscCodegenMethods::apply_vcall_visibility_metadata
  apply_vcall_visibility_metadata(_ty: Ty, _poly_trait_ref: ExistentialTraitRef | undefined, _vtable: Value): void {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs apply_vcall_visibility_metadata");
  }

  // Stub (cg-contract): MiscCodegenMethods::get_fn
  get_fn(_instance: Instance): Value {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs get_fn");
  }

  // Stub (cg-contract): MiscCodegenMethods::get_fn_addr
  get_fn_addr(_instance: Instance, _pointer_auth_schema: PointerAuthSchema | undefined): Value {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs get_fn_addr");
  }

  // Stub (cg-contract): MiscCodegenMethods::eh_personality
  eh_personality(): Value {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs eh_personality");
  }

  // Stub (cg-contract): MiscCodegenMethods::sess
  sess(): Session {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs sess");
  }

  // Stub (cg-contract): MiscCodegenMethods::set_frame_pointer_type
  set_frame_pointer_type(_llfn: Value): void {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs set_frame_pointer_type");
  }

  // Stub (cg-contract): MiscCodegenMethods::apply_target_cpu_attr
  apply_target_cpu_attr(_llfn: Value): void {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs apply_target_cpu_attr");
  }

  // Stub (cg-contract): MiscCodegenMethods::declare_c_main
  declare_c_main(_fn_type: Type): Value | undefined {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs declare_c_main");
  }

  // Stub (cg-contract): MiscCodegenMethods::intrinsic_call_expects_place_always
  intrinsic_call_expects_place_always(_name: Symbol): boolean {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs intrinsic_call_expects_place_always");
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

  // ---- impl HasDataLayout for CodegenCx (context.rs:1254) ----
  // Stub (cg-contract): HasDataLayout::data_layout
  data_layout(): TargetDataLayout {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs data_layout");
  }

  // ---- impl HasTargetSpec for CodegenCx (context.rs:1261) ----
  // Stub (cg-contract): HasTargetSpec::target_spec
  target_spec(): Target {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs target_spec");
  }

  // ---- impl HasTyCtxt for CodegenCx (context.rs:1268) ----
  // Stub (cg-contract): HasTyCtxt::tcx (`tcx_`, header)
  tcx_(): TyCtxt {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs tcx");
  }

  // ---- impl HasTypingEnv for CodegenCx (context.rs:1275) ----
  // Stub (cg-contract): HasTypingEnv::typing_env (`typing_env_`, header)
  typing_env_(): TypingEnv {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs typing_env");
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
  // Stub (cg-contract): LayoutOfHelpers::handle_layout_err
  handle_layout_err(_err: LayoutError, _span: Span, _ty: Ty): never {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs handle_layout_err");
  }

  // ---- impl FnAbiOfHelpers for CodegenCx (context.rs:1295) ----
  // type FnAbiOfResult = &'tcx FnAbi<'tcx, Ty<'tcx>>; (the trait's default)
  get FnAbiOfResult(): MaybeResult<FnAbi<Ty>, FnAbi<Ty>, never> {
    return MaybeResult_T;
  }
  // Stub (cg-contract): FnAbiOfHelpers::handle_fn_abi_err
  handle_fn_abi_err(_err: FnAbiError, _span: Span, _fn_abi_request: FnAbiRequest): never {
    return unported("cg-context: compiler/rustc_codegen_llvm/src/context.rs handle_fn_abi_err");
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
