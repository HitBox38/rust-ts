// Port of compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs. Lane cg-di-a (wave 40p) ported the fns a `-Cdebuginfo=0`
// compile reaches (`build_global_var_di_node`, `find_vtable_behind_cast`, `apply_vcall_visibility_metadata`,
// `create_vtable_di_node`); lane cg-di-b (wave 40s) ported the rest.
//
// PORT (cg-di-a):
// - `enum VCallVisibility { Public = 0, LinkageUnit = 1, TranslationUnit = 2 }` (local to `apply_vcall_visibility_metadata`)
//   is its discriminant as a `bigint` (`vcall_visibility as u64`).
// - `self.typing_env()` on a `CodegenCx` is `HasTypingEnv::typing_env_()` (context.ts header).
//
// PORT (cg-di-b):
// - `impl PartialEq/Eq/Hash/Debug for llvm::Metadata` compare, hash and print the pointer. A `Metadata` here is an object of
//   the IR model, so `eq` is `===`. It has no address: `hash` (never reached, nothing keys a hash map on a `Metadata`) and
//   `fmt` (only in an ICE message) stop by name.
// - `return_if_di_node_created_in_meantime!` is written out where it is used: an `if` that returns
//   `DINodeCreationResult::new(di_node, true)`.
// - `SmallVec<T>` is `T[]`; `smallvec![..]` an array literal; `Cow<str>` a `string`. The `members`/`generics` closures of
//   `build_type_with_children` are arrow functions, called where upstream calls them.
// - `const NO_GENERICS: for<'ll> fn(..) -> SmallVec<..> = |_| SmallVec::new();` is a function returning `[]`.
// - `Size::bits()` is a `number`; it is passed as `BigInt(..)` where ffi.ts types a `u64`. `align.bits() as u32` is
//   `>>> 0`. `c_longlong` bounds are `bigint`.
// - `trait MsvcBasicName` (on `ty::IntTy`/`ty::UintTy`) is an interface with one impl table per type
//   (`MsvcBasicName_for_IntTy`, `MsvcBasicName_for_UintTy`); the required member's marker sits on the interface.
// - `file_metadata`'s nested `alloc_new_file_metadata` stays nested after the `return`, with its marker (ssa-debuginfo's
//   convention); `entry(..).or_insert_with(..)` is a `get`, then the insert on a miss. `created_files`' key is
//   `key_created_files` (mod.ts).
// - Paths are `string`s: `to_string_lossy()` is the string, `strip_prefix` is `path_strip_prefix`, and `PathBuf::push` is
//   `path_join` (a pushed component replaces an absolute base, as `push` does).
// - `build_compile_unit_di_node`'s `c""` flags is `""`.
// - `TUPLE_FIELD_NAMES.get(i).map(Cow::from).unwrap_or_else(..)`: the table lookup, else the formatted name.
// - `tracing::debug!` / `#[instrument]` are comments.
import { Align, debug_Align, debug_Size, type Endian, FieldsShape, type NumScalableVectors, Size, Size_eq } from "../../rustc_abi/lib.ts";
import { FloatTy, IntTy, UintTy } from "../../rustc_ast_ir/lib.ts";
import { compute_debuginfo_type_name, compute_debuginfo_vtable_name, cpp_like_debuginfo, VTableNameKind } from "../../rustc_codegen_ssa/debuginfo/type_names.ts";
import { Lto, OptLevel, type OutputFilenames } from "../../rustc_session/config.ts";
import { CodegenUnits } from "../../rustc_session/session.ts";
import { debug_target_spec_other } from "../../rustc_target/lib.ts";
import { typeid_for_trait_ref } from "../../rustc_symbol_mangling/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { type TyAndLayout, WIDE_PTR_ADDR, WIDE_PTR_EXTRA } from "../../rustc_middle/ty/layout.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { COMMON_VTABLE_ENTRIES, type VtblEntry } from "../../rustc_middle/ty/vtable.ts";
import { LOCAL_CRATE, type DefId } from "../../rustc_span/def_id.ts";
import { walk_chain_collapsed } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP, ExternalSource, FileName, RemapPathScopeComponents, type SourceFile, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { as_interner, ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import type { TraitRef } from "../../rustc_type_ir/predicate.ts";
import { FnSig, fold_FnSig, UnsafeBinderInner_deref } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_tuple, PLAIN } from "../../std/fmt.ts";
import { path_join, path_strip_prefix } from "../../std/path.ts";
import { assert, assert_eq, assert_eq_args, assert_matches, unported, unreachable, unwrap } from "../../std/panic.ts";
import { utf8, utf8_len } from "../../std/str.ts";
import type { CodegenCx } from "../context.ts";
import * as llvm from "../llvm/mod.ts";
import type { DIBasicType, DIBuilder, DICompositeType, DIDescriptor, DIFile, DIFlags, DILexicalBlock, DIScope, DIType, Metadata, Value } from "../llvm/mod.ts";
import { FromGeneric_for_DebugEmissionKind } from "../llvm/conversions.ts";
import { DIBuilderExt_for_DIBuilder } from "./di_builder.ts";
import * as dwarf_const from "./dwarf_const.ts";
import type { CodegenUnitDebugContext } from "./mod.ts";
import { mangled_name_of_instance } from "./namespace.ts";
import { create_DIArray, DIB, debug_context, get_namespace_for_item, is_node_local_to_unit, WidePtrKind, wide_pointer_kind } from "./utils.ts";
import * as enums from "./metadata/enums/mod.ts";
import { build_type_with_children, DINodeCreationResult, Stub, stub, UniqueTypeId } from "./metadata/type_map.ts";
import * as type_map from "./metadata/type_map.ts";

// pub(crate) use self::type_map::TypeMap;
export { TypeMap, TypeMap_default } from "./metadata/type_map.ts";

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// impl PartialEq for llvm::Metadata
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:46 eq
export function Metadata_eq(self: Metadata, other: Metadata): boolean {
  return self === other;
}

// impl Eq for llvm::Metadata {}

// impl Hash for llvm::Metadata
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:54 hash
export function Metadata_hash(_self: Metadata): never {
  // `(self as *const Self).hash(hasher)`: a model object has no address (header)
  return unported("cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs Hash for llvm::Metadata (a pointer address)");
}

// impl fmt::Debug for llvm::Metadata
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:60 fmt
export function debug_Metadata(_self: Metadata): never {
  // `(self as *const Self).fmt(f)`: a model object has no address (header)
  return unported("cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs Debug for llvm::Metadata (a pointer address)");
}

export const UNKNOWN_LINE_NUMBER: number = 0;
export const UNKNOWN_COLUMN_NUMBER: number = 0;

export const NO_SCOPE_METADATA: DIScope | undefined = undefined;
/// A function that returns an empty list of generic parameter debuginfo nodes.
export const NO_GENERICS = (_: CodegenCx): (DIType | undefined)[] => [];

// SmallVec is used quite a bit in this module, so create a shorthand.
// The actual number of elements is not so important.
// type SmallVec<T> = smallvec::SmallVec<[T; 16]>;  (an array, header)

// mod enums;
// mod type_map;

/// Returns from the enclosing function if the type debuginfo node with the given
/// unique ID can be found in the type map.
// macro_rules! return_if_di_node_created_in_meantime: written out where it is used (header).

/// Extract size and alignment from a TyAndLayout.
// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:92 size_and_align_of
export function size_and_align_of(ty_and_layout: TyAndLayout): [Size, Align] {
  return [ty_and_layout.size, ty_and_layout.align.abi];
}

/// Creates debuginfo for a fixed size array (e.g. `[u64; 123]`).
/// For slices (that is, "arrays" of unknown size) use [build_slice_type_di_node].
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:98 build_fixed_size_array_di_node
function build_fixed_size_array_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId, array_type: Ty, span: Span): DINodeCreationResult {
  const k = array_type.kind();
  if (k.$ !== "Array") {
    return bug(`build_fixed_size_array_di_node() called with non-ty::Array type \`${debug_Ty(array_type, PLAIN)}\``);
  }
  const element_type = k._0;
  const len = k._1;

  const element_type_di_node = spanned_type_di_node(cx, element_type, span);

  // return_if_di_node_created_in_meantime!(cx, unique_type_id);
  const di_node0 = debug_context(cx).type_map.di_node_for_unique_id(unique_type_id);
  if (di_node0 !== undefined) {
    return DINodeCreationResult.new(di_node0, true);
  }

  const [size, align] = cx.spanned_size_and_align_of(array_type, span);

  const upper_bound = BigInt.asIntN(64, BigInt(unwrap(len.try_to_target_usize(cx.tcx), "expected monomorphic const in codegen")));

  const subrange = llvm.LLVMDIBuilderGetOrCreateSubrange(DIB(cx), 0n, upper_bound);
  const subscripts = [subrange];

  const di_node = llvm.LLVMDIBuilderCreateArrayType(DIB(cx), BigInt(size.bits()), align.bits() >>> 0, element_type_di_node, subscripts, subscripts.length >>> 0);

  return DINodeCreationResult.new(di_node, false);
}

/// Creates debuginfo for built-in pointer-like things:
///
///  - ty::Ref
///  - ty::RawPtr
///  - ty::Adt in the case it's Box
///
/// At some point we might want to remove the special handling of Box
/// and treat it the same as other smart pointers (like Rc, Arc, ...).
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:143 build_pointer_or_reference_di_node
function build_pointer_or_reference_di_node(cx: CodegenCx, ptr_type: Ty, pointee_type: Ty, unique_type_id: UniqueTypeId, span: Span): DINodeCreationResult {
  // The debuginfo generated by this function is only valid if `ptr_type` is really just
  // a (wide) pointer. Make sure it is not called for e.g. `Box<T, NonZSTAllocator>`.
  assert_size_and_align_eq(cx.size_and_align_of(ptr_type), cx.size_and_align_of(Ty.new_mut_ptr(cx.tcx, pointee_type)));

  let pointee_type_di_node: DIType;
  const pk = pointee_type.kind();
  switch (pk.$) {
    // `&[T]` will look like `{ data_ptr: *const T, length: usize }`
    case "Slice":
      pointee_type_di_node = spanned_type_di_node(cx, pk._0, span);
      break;
    // `&str` will look like `{ data_ptr: *const u8, length: usize }`
    case "Str":
      pointee_type_di_node = type_di_node(cx, cx.tcx.types.u8);
      break;

    // `&dyn K` will look like `{ pointer: _, vtable: _}`
    // any Adt `Foo` containing an unsized type (eg `&[_]` or `&dyn _`)
    //   will look like `{ data_ptr: *const Foo, length: usize }`
    // and thin pointers `&Foo` will just look like `*const Foo`.
    //
    // in all those cases, we just use the pointee_type
    default:
      pointee_type_di_node = spanned_type_di_node(cx, pointee_type, span);
      break;
  }

  // return_if_di_node_created_in_meantime!(cx, unique_type_id);
  const di_node0 = debug_context(cx).type_map.di_node_for_unique_id(unique_type_id);
  if (di_node0 !== undefined) {
    return DINodeCreationResult.new(di_node0, true);
  }

  const data_layout = cx.tcx.data_layout();
  const pointer_size = data_layout.pointer_size();
  const pointer_align = data_layout.pointer_align();
  const ptr_type_debuginfo_name = compute_debuginfo_type_name(cx.tcx, ptr_type, true);

  const wide_pointer_kind_ = wide_pointer_kind(cx, pointee_type);
  if (wide_pointer_kind_ === undefined) {
    // This is a thin pointer. Create a regular pointer type and give it the correct name.
    assert_eq_args<readonly [Size, Align]>(
      [pointer_size, pointer_align.abi],
      cx.size_and_align_of(ptr_type),
      debug_size_and_align,
      () => `ptr_type=${display_Ty(ptr_type)}, pointee_type=${display_Ty(pointee_type)}`,
      size_and_align_eq,
    );

    const di_node = create_pointer_type(cx, pointee_type_di_node, pointer_size, pointer_align.abi, ptr_type_debuginfo_name);

    return new DINodeCreationResult(di_node, false);
  } else {
    const wide_pointer_kind = wide_pointer_kind_;
    return type_map.build_type_with_children(
      cx,
      type_map.stub(cx, Stub.Struct, unique_type_id, ptr_type_debuginfo_name, undefined, cx.size_and_align_of(ptr_type), NO_SCOPE_METADATA, llvm.DIFlags.FlagZero),
      (cx, owner) => {
        // FIXME: If this wide pointer is a `Box` then we don't want to use its
        //        type layout and instead use the layout of the raw pointer inside
        //        of it.
        //        The proper way to handle this is to not treat Box as a pointer
        //        at all and instead emit regular struct debuginfo for it. We just
        //        need to make sure that we don't break existing debuginfo consumers
        //        by doing that (at least not without a warning period).
        const layout_type = ptr_type.is_box()
          ? // The assertion at the start of this function ensures we have a ZST
            // allocator. We'll make debuginfo "skip" all ZST allocators, not just the
            // default allocator.
            Ty.new_mut_ptr(cx.tcx, pointee_type)
          : ptr_type;

        const layout = cx.layout_of(layout_type);
        const addr_field = layout.field(cx, WIDE_PTR_ADDR);
        const extra_field = layout.field(cx, WIDE_PTR_EXTRA);

        let addr_field_name: string;
        let extra_field_name: string;
        switch (wide_pointer_kind) {
          case WidePtrKind.Dyn:
            [addr_field_name, extra_field_name] = ["pointer", "vtable"];
            break;
          case WidePtrKind.Slice:
            [addr_field_name, extra_field_name] = ["data_ptr", "length"];
            break;
        }

        assert_eq(WIDE_PTR_ADDR, 0, String);
        assert_eq(WIDE_PTR_EXTRA, 1, String);

        // The data pointer type is a regular, thin pointer, regardless of whether this
        // is a slice or a trait object.
        const data_ptr_type_di_node = create_pointer_type(cx, pointee_type_di_node, addr_field.size, addr_field.align.abi, "");

        return [
          build_field_di_node(
            cx,
            owner,
            addr_field_name,
            addr_field,
            FieldsShape.offset(layout.fields, WIDE_PTR_ADDR),
            llvm.DIFlags.FlagZero,
            data_ptr_type_di_node,
            undefined,
          ),
          build_field_di_node(
            cx,
            owner,
            extra_field_name,
            extra_field,
            FieldsShape.offset(layout.fields, WIDE_PTR_EXTRA),
            llvm.DIFlags.FlagZero,
            type_di_node(cx, extra_field.ty),
            undefined,
          ),
        ];
      },
      NO_GENERICS,
    );
  }
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:279 build_subroutine_type_di_node
function build_subroutine_type_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  // It's possible to create a self-referential type in Rust by using 'impl trait':
  //
  // fn foo() -> impl Copy { foo }
  //
  // Unfortunately LLVM's API does not allow us to create recursive subroutine types.
  // In order to work around that restriction we place a marker type in the type map,
  // before creating the actual type. If the actual type is recursive, it will hit the
  // marker type. So we end up with a type that looks like
  //
  // fn foo() -> <recursive_type>
  //
  // Once that is created, we replace the marker in the typemap with the actual type.
  debug_context(cx).type_map.unique_id_to_di_node.set(unique_type_id, recursion_marker_type_di_node(cx));

  const fn_ty = UniqueTypeId.expect_ty(unique_type_id);
  const signature = cx.tcx.normalize_erasing_late_bound_regions(cx.typing_env_(), fn_ty.fn_sig(cx.tcx), fold_FnSig);

  const signature_di_nodes: (Metadata | undefined)[] = [];
  // return type
  const out = FnSig.output(signature);
  const ok = out.kind();
  if (ok.$ === "Tuple" && ok._0.length === 0) {
    // this is a "void" function
    signature_di_nodes.push(undefined);
  } else {
    signature_di_nodes.push(type_di_node(cx, FnSig.output(signature)));
  }
  // regular arguments
  for (const argument_type of FnSig.inputs(signature)) {
    signature_di_nodes.push(type_di_node(cx, argument_type));
  }

  debug_context(cx).type_map.unique_id_to_di_node.delete(unique_type_id);

  const fn_di_node = create_subroutine_type(cx, signature_di_nodes);

  // This is actually a function pointer, so wrap it in pointer DI.
  const name = compute_debuginfo_type_name(cx.tcx, fn_ty, false);
  let size: Size;
  let align: Align;
  switch (fn_ty.kind().$) {
    case "FnDef":
      [size, align] = [Size.ZERO, Align.ONE];
      break;
    case "FnPtr":
      [size, align] = [cx.tcx.data_layout().pointer_size(), cx.tcx.data_layout().pointer_align().abi];
      break;
    default:
      return unreachable();
  }
  const di_node = create_pointer_type(cx, fn_di_node, size, align, name);

  return DINodeCreationResult.new(di_node, false);
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:339 create_subroutine_type
export function create_subroutine_type(cx: CodegenCx, signature: readonly (Metadata | undefined)[]): DICompositeType {
  return llvm.LLVMDIBuilderCreateSubroutineType(
    DIB(cx),
    undefined, // ("File" is ignored and has no effect)
    signature,
    signature.length >>> 0,
    llvm.DIFlags.FlagZero, // (default value)
  );
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:354 create_pointer_type
function create_pointer_type(cx: CodegenCx, pointee_ty: Metadata, size: Size, align: Align, name: string): Metadata {
  return llvm.LLVMDIBuilderCreatePointerType(
    DIB(cx),
    pointee_ty,
    BigInt(size.bits()),
    align.bits() >>> 0,
    0, // Ignore DWARF address space.
    name,
    utf8_len(name),
  );
}

/// Create debuginfo for `dyn SomeTrait` types. Currently these are empty structs
/// we with the correct type name (e.g. "dyn SomeTrait<Foo, Item=u32> + Sync").
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:376 build_dyn_type_di_node
function build_dyn_type_di_node(cx: CodegenCx, dyn_type: Ty, unique_type_id: UniqueTypeId): DINodeCreationResult {
  if (dyn_type.kind().$ === "Dynamic") {
    const type_name = compute_debuginfo_type_name(cx.tcx, dyn_type, true);
    return type_map.build_type_with_children(
      cx,
      type_map.stub(cx, Stub.Struct, unique_type_id, type_name, undefined, cx.size_and_align_of(dyn_type), NO_SCOPE_METADATA, llvm.DIFlags.FlagZero),
      (_, _1) => [],
      NO_GENERICS,
    );
  } else {
    return bug(`Only ty::Dynamic is valid for build_dyn_type_di_node(). Found ${debug_Ty(dyn_type, PLAIN)} instead.`);
  }
}

/// Create debuginfo for `[T]` and `str`. These are unsized.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:407 build_slice_type_di_node
function build_slice_type_di_node(cx: CodegenCx, slice_type: Ty, unique_type_id: UniqueTypeId, span: Span): DINodeCreationResult {
  let element_type: Ty;
  const k = slice_type.kind();
  switch (k.$) {
    case "Slice":
      element_type = k._0;
      break;
    case "Str":
      element_type = cx.tcx.types.u8;
      break;
    default:
      return bug(`Only ty::Slice is valid for build_slice_type_di_node(). Found ${debug_Ty(slice_type, PLAIN)} instead.`);
  }

  const element_type_di_node = type_di_node(cx, element_type);
  // return_if_di_node_created_in_meantime!(cx, unique_type_id);
  const di_node0 = debug_context(cx).type_map.di_node_for_unique_id(unique_type_id);
  if (di_node0 !== undefined) {
    return DINodeCreationResult.new(di_node0, true);
  }
  const [size, align] = cx.spanned_size_and_align_of(slice_type, span);
  const subrange = llvm.LLVMDIBuilderGetOrCreateSubrange(DIB(cx), 0n, -1n);
  const subscripts = [subrange];
  const di_node = llvm.LLVMDIBuilderCreateArrayType(DIB(cx), BigInt(size.bits()), align.bits() >>> 0, element_type_di_node, subscripts, subscripts.length >>> 0);
  return new DINodeCreationResult(di_node, false);
}

/// Get the debuginfo node for the given type.
///
/// This function will look up the debuginfo node in the TypeMap. If it can't find it, it
/// will create the node by dispatching to the corresponding `build_*_di_node()` function.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:446 type_di_node
export function type_di_node(cx: CodegenCx, t: Ty): DIType {
  return spanned_type_di_node(cx, t, DUMMY_SP);
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:450 spanned_type_di_node
export function spanned_type_di_node(cx: CodegenCx, t: Ty, span: Span): DIType {
  const unique_type_id = UniqueTypeId.for_ty(cx.tcx, t);

  const existing_di_node = debug_context(cx).type_map.di_node_for_unique_id(unique_type_id);
  if (existing_di_node !== undefined) {
    return existing_di_node;
  }

  // debug!("type_di_node: {:?} kind: {:?}", t, t.kind());

  let r: DINodeCreationResult;
  const k = t.kind();
  switch (k.$) {
    case "Never":
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
      r = build_basic_type_di_node(cx, t);
      break;
    case "Tuple":
      if (k._0.length === 0) {
        r = build_basic_type_di_node(cx, t);
      } else {
        r = build_tuple_type_di_node(cx, unique_type_id);
      }
      break;
    case "Array":
      r = build_fixed_size_array_di_node(cx, unique_type_id, t, span);
      break;
    case "Slice":
    case "Str":
      r = build_slice_type_di_node(cx, t, unique_type_id, span);
      break;
    case "Dynamic":
      r = build_dyn_type_di_node(cx, t, unique_type_id);
      break;
    case "Foreign":
      r = build_foreign_type_di_node(cx, t, unique_type_id);
      break;
    case "RawPtr":
      r = build_pointer_or_reference_di_node(cx, t, k._0, unique_type_id, span);
      break;
    case "Ref":
      r = build_pointer_or_reference_di_node(cx, t, k._1, unique_type_id, span);
      break;
    case "Adt": {
      const def = k._0;
      const args = k._1;
      // Some `Box` are newtyped pointers, make debuginfo aware of that.
      // Only works if the allocator argument is a 1-ZST and hence irrelevant for layout
      // (or if there is no allocator argument).
      if (def.is_box() && (args.length <= 1 || cx.layout_of(GenericArg.expect_ty(args[1]!)).is_1zst())) {
        r = build_pointer_or_reference_di_node(cx, t, t.expect_boxed_ty(), unique_type_id, span);
        break;
      }
      switch (def.adt_kind()) {
        case "Struct":
          r = build_struct_type_di_node(cx, unique_type_id, span);
          break;
        case "Union":
          r = build_union_type_di_node(cx, unique_type_id, span);
          break;
        case "Enum":
          r = enums.build_enum_type_di_node(cx, unique_type_id, span);
          break;
      }
      break;
    }
    case "FnDef":
    case "FnPtr":
      r = build_subroutine_type_di_node(cx, unique_type_id);
      break;
    case "Closure":
      r = build_closure_env_di_node(cx, unique_type_id);
      break;
    case "CoroutineClosure":
      r = build_closure_env_di_node(cx, unique_type_id);
      break;
    case "Coroutine":
      r = enums.build_coroutine_di_node(cx, unique_type_id);
      break;
    case "Pat":
      return type_di_node(cx, k._0);
    case "UnsafeBinder":
      r = build_unsafe_binder_type_di_node(cx, t, unique_type_id);
      break;
    case "Alias":
    case "Param":
    case "Bound":
    case "Infer":
    case "Placeholder":
    case "CoroutineWitness":
    case "Error":
      return bug(`debuginfo: unexpected type in type_di_node(): ${debug_Ty(t, PLAIN)}`);
  }
  const { di_node, already_stored_in_typemap } = r;

  {
    if (already_stored_in_typemap) {
      // Make sure that we really do have a `TypeMap` entry for the unique type ID.
      const di_node_for_uid0 = debug_context(cx).type_map.di_node_for_unique_id(unique_type_id);
      let di_node_for_uid: DIType;
      if (di_node_for_uid0 !== undefined) {
        di_node_for_uid = di_node_for_uid0;
      } else {
        return bug(
          `expected type debuginfo node for unique type ID '${type_map.debug_UniqueTypeId(unique_type_id, PLAIN)}' to already be in the \`debuginfo::TypeMap\` but it was not.`,
        );
      }

      if (di_node_for_uid !== di_node) {
        // `assert_eq!(di_node_for_uid as *const _, di_node as *const _)`: the message prints both pointers (header)
        debug_Metadata(di_node_for_uid);
      }
    } else {
      debug_context(cx).type_map.insert(unique_type_id, di_node);
    }
  }

  return di_node;
}

// FIXME(mw): Cache this via a regular UniqueTypeId instead of an extra field in the debug context.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:535 recursion_marker_type_di_node
function recursion_marker_type_di_node(cx: CodegenCx): DIType {
  const dbg = debug_context(cx);
  if (dbg.recursion_marker_type === undefined) {
    // The choice of type here is pretty arbitrary -
    // anything reading the debuginfo for a recursive
    // type is going to see *something* weird - the only
    // question is what exactly it will see.
    //
    // FIXME: the name `<recur_type>` does not fit the naming scheme
    //        of other types.
    //
    // FIXME: it might make sense to use an actual pointer type here
    //        so that debuggers can show the address.
    dbg.recursion_marker_type = create_basic_type(cx, "<recur_type>", cx.tcx.data_layout().pointer_size(), dwarf_const.DW_ATE_unsigned);
  }
  return dbg.recursion_marker_type;
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:556 hex_encode
function hex_encode(data: Uint8Array): string {
  let hex_string = "";
  for (const byte of data) {
    hex_string += byte.toString(16).padStart(2, "0");
  }
  return hex_string;
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:564 file_metadata
export function file_metadata(cx: CodegenCx, source_file: SourceFile): DIFile {
  const cache_key: readonly [typeof source_file.stable_id, typeof source_file.src_hash] = [source_file.stable_id, source_file.src_hash];
  const created_files = debug_context(cx).created_files;
  const found = created_files.get(cache_key);
  if (found !== undefined) return found;
  const created = alloc_new_file_metadata(cx, source_file);
  created_files.set(cache_key, created);
  return created;

  // #[instrument(skip(cx, source_file), level = "debug")]
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:573 alloc_new_file_metadata
  function alloc_new_file_metadata(cx: CodegenCx, source_file: SourceFile): DIFile {
    // debug!(?source_file.name);

    let directory: string;
    let file_name: string;
    const name = source_file.name;
    if (name.$ === "Real") {
      const filename = name._0;
      const [working_directory, embeddable_name] = filename.embeddable_name(RemapPathScopeComponents.DEBUGINFO);

      // debug!(?working_directory, ?embeddable_name);

      const rel_path = path_strip_prefix(embeddable_name, working_directory);
      if (rel_path !== undefined) {
        // If the compiler's working directory (which also is the DW_AT_comp_dir of
        // the compilation unit) is a prefix of the path we are about to emit, then
        // only emit the part relative to the working directory. Because of path
        // remapping we sometimes see strange things here: `abs_path` might
        // actually look like a relative path (e.g.
        // `<crate-name-and-version>/src/lib.rs`), so if we emit it without taking
        // the working directory into account, downstream tooling will interpret it
        // as `<working-directory>/<crate-name-and-version>/src/lib.rs`, which
        // makes no sense. Usually in such cases the working directory will also be
        // remapped to `<crate-name-and-version>` or some other prefix of the path
        // we are remapping, so we end up with
        // `<crate-name-and-version>/<crate-name-and-version>/src/lib.rs`.
        //
        // By moving the working directory portion into the `directory` part of the
        // DIFile, we allow LLVM to emit just the relative path for DWARF, while
        // still emitting the correct absolute path for CodeView.
        [directory, file_name] = [working_directory, rel_path];
      } else {
        [directory, file_name] = ["", embeddable_name];
      }
    } else {
      // debug!(?other);
      [directory, file_name] = ["", FileName.display(name, RemapPathScopeComponents.DEBUGINFO).to_string()];
    }

    let hash_kind: llvm.ChecksumKind;
    switch (source_file.src_hash.kind) {
      case "Md5":
        hash_kind = llvm.ChecksumKind.MD5;
        break;
      case "Sha1":
        hash_kind = llvm.ChecksumKind.SHA1;
        break;
      case "Sha256":
        hash_kind = llvm.ChecksumKind.SHA256;
        break;
      case "Blake3":
        hash_kind = llvm.ChecksumKind.None;
        break;
    }
    const hash_value = hex_encode(source_file.src_hash.hash_bytes());

    let source: Uint8Array | undefined = undefined;
    if (cx.sess().opts.unstable_opts.embed_source) {
      const src = source_file.src;
      source = src === undefined ? undefined : src.b.subarray(src.lo, src.hi);
      if (source === undefined) {
        cx.tcx.sess.source_map().ensure_source_file_source_present(source_file);
        const external_src = source_file.external_src.read();
        const s = ExternalSource.get_source(external_src);
        source = s === undefined ? undefined : s.b.subarray(s.lo, s.hi);
      }
    }

    return create_file(DIB(cx), file_name, directory, hash_value, hash_kind, source);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:637 unknown_file_metadata
export function unknown_file_metadata(cx: CodegenCx): DIFile {
  const created_files = debug_context(cx).created_files;
  const found = created_files.get(undefined);
  if (found !== undefined) return found;
  const created = create_file(DIB(cx), "<unknown>", "", "", llvm.ChecksumKind.None, undefined);
  created_files.set(undefined, created);
  return created;
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:643 create_file
function create_file(builder: DIBuilder, file_name: string, directory: string, hash_value: string, hash_kind: llvm.ChecksumKind, source: Uint8Array | undefined): DIFile {
  return llvm.LLVMRustDIBuilderCreateFile(
    builder,
    file_name,
    utf8_len(file_name),
    directory,
    utf8_len(directory),
    hash_kind,
    hash_value,
    utf8_len(hash_value),
    source,
    source === undefined ? 0 : source.length,
  );
}

interface MsvcBasicName<T> {
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:668 msvc_basic_name
  msvc_basic_name(self: T): string;
}

const MsvcBasicName_for_IntTy: MsvcBasicName<IntTy> = {
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:672 msvc_basic_name
  msvc_basic_name(self: IntTy): string {
    switch (self) {
      case "Isize":
        return "ptrdiff_t";
      case "I8":
        return "__int8";
      case "I16":
        return "__int16";
      case "I32":
        return "__int32";
      case "I64":
        return "__int64";
      case "I128":
        return "__int128";
    }
  },
};

const MsvcBasicName_for_UintTy: MsvcBasicName<UintTy> = {
  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:685 msvc_basic_name
  msvc_basic_name(self: UintTy): string {
    switch (self) {
      case "Usize":
        return "size_t";
      case "U8":
        return "unsigned __int8";
      case "U16":
        return "unsigned __int16";
      case "U32":
        return "unsigned __int32";
      case "U64":
        return "unsigned __int64";
      case "U128":
        return "unsigned __int128";
    }
  },
};

/// `float_ty` must be a [`ty::Float`] and `bits_ty` must be a [`ty::Uint`].
/// `cx.size_of(bits_ty) * bits_names.len()` must equal `cx.size_of(float_ty)`.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:699 build_cpp_float_struct_di_node
function build_cpp_float_struct_di_node(cx: CodegenCx, float_ty: Ty, bits_ty: Ty, bits_names: readonly string[]): DINodeCreationResult {
  // debug_assert!(matches!(bits_ty.kind(), ty::Uint(_)));
  // debug_assert_eq!(cx.size_of(bits_ty) * (bits_names.len() as u64), cx.size_of(float_ty));
  // MSVC has no native support for `f16` or `f128`. Instead, emit a struct containing the bits as
  // field(s) to allow the value to be displayed using a Natvis visualiser in `intrinsic.natvis`.
  const fk = float_ty.kind();
  let name: string;
  if (fk.$ === "Float") {
    name = FloatTy.name_str(fk._0);
  } else {
    return bug(`${debug_Ty(float_ty, PLAIN)} was not a float`);
  }
  return type_map.build_type_with_children(
    cx,
    type_map.stub(cx, Stub.Struct, UniqueTypeId.for_ty(cx.tcx, float_ty), name, undefined, cx.size_and_align_of(float_ty), NO_SCOPE_METADATA, llvm.DIFlags.FlagZero),
    // Fields:
    (cx, float_di_node) => {
      const bits_layout = cx.layout_of(bits_ty);
      const bits_node = type_di_node(cx, bits_ty);
      return bits_names.map((field_name, i) =>
        build_field_di_node(cx, float_di_node, field_name, bits_layout, bits_layout.size.mul(i), llvm.DIFlags.FlagZero, bits_node, undefined),
      );
    },
    NO_GENERICS,
  );
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:752 build_basic_type_di_node
function build_basic_type_di_node(cx: CodegenCx, t: Ty): DINodeCreationResult {
  // debug!("build_basic_type_di_node: {:?}", t);

  // When targeting MSVC, emit MSVC style type names for compatibility with
  // .natvis visualizers (and perhaps other existing native debuggers?)
  const cpp_like_debuginfo_ = cpp_like_debuginfo(cx.tcx);

  const { DW_ATE_UTF, DW_ATE_boolean, DW_ATE_float, DW_ATE_signed, DW_ATE_unsigned } = dwarf_const;

  let name: string;
  let encoding: number;
  const k = t.kind();
  if (k.$ === "Never") {
    [name, encoding] = ["!", DW_ATE_unsigned];
  } else if (k.$ === "Tuple" && k._0.length === 0) {
    if (cpp_like_debuginfo_) {
      return build_tuple_type_di_node(cx, UniqueTypeId.for_ty(cx.tcx, t));
    } else {
      [name, encoding] = ["()", DW_ATE_unsigned];
    }
  } else if (k.$ === "Bool") {
    [name, encoding] = ["bool", DW_ATE_boolean];
  } else if (k.$ === "Char") {
    [name, encoding] = ["char", DW_ATE_UTF];
  } else if (k.$ === "Int" && cpp_like_debuginfo_) {
    [name, encoding] = [MsvcBasicName_for_IntTy.msvc_basic_name(k._0), DW_ATE_signed];
  } else if (k.$ === "Uint" && cpp_like_debuginfo_) {
    [name, encoding] = [MsvcBasicName_for_UintTy.msvc_basic_name(k._0), DW_ATE_unsigned];
  } else if (k.$ === "Float" && k._0 === "F16" && cpp_like_debuginfo_) {
    return build_cpp_float_struct_di_node(cx, t, cx.tcx.types.u16, ["bits"]);
  } else if (k.$ === "Float" && k._0 === "F128" && cpp_like_debuginfo_) {
    // All MSVC architectures are little endian.
    assert_eq(cx.target_spec().endian as Endian, "Little" as Endian, String);
    return build_cpp_float_struct_di_node(cx, t, cx.tcx.types.u64, ["low_bits", "high_bits"]);
  } else if (k.$ === "Float" && k._0 === "F32" && cpp_like_debuginfo_) {
    [name, encoding] = ["float", DW_ATE_float];
  } else if (k.$ === "Float" && k._0 === "F64" && cpp_like_debuginfo_) {
    [name, encoding] = ["double", DW_ATE_float];
  } else if (k.$ === "Int") {
    [name, encoding] = [IntTy.name_str(k._0), DW_ATE_signed];
  } else if (k.$ === "Uint") {
    [name, encoding] = [UintTy.name_str(k._0), DW_ATE_unsigned];
  } else if (k.$ === "Float") {
    [name, encoding] = [FloatTy.name_str(k._0), DW_ATE_float];
  } else {
    return bug("debuginfo::build_basic_type_di_node - `t` is invalid type");
  }

  const ty_di_node = create_basic_type(cx, name, cx.size_of(t), encoding);

  if (!cpp_like_debuginfo_) {
    return DINodeCreationResult.new(ty_di_node, false);
  }

  let typedef_name: string;
  switch (k.$) {
    case "Int":
      typedef_name = IntTy.name_str(k._0);
      break;
    case "Uint":
      typedef_name = UintTy.name_str(k._0);
      break;
    case "Float":
      typedef_name = FloatTy.name_str(k._0);
      break;
    default:
      return DINodeCreationResult.new(ty_di_node, false);
  }

  const typedef_di_node = llvm.LLVMDIBuilderCreateTypedef(
    DIB(cx),
    ty_di_node,
    typedef_name,
    utf8_len(typedef_name),
    unknown_file_metadata(cx),
    0, // (no line number)
    undefined, // (no scope)
    0, // (no alignment specified)
  );

  return DINodeCreationResult.new(typedef_di_node, false);
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:827 create_basic_type
function create_basic_type(cx: CodegenCx, name: string, size: Size, encoding: number): DIBasicType {
  return llvm.LLVMDIBuilderCreateBasicType(DIB(cx), name, utf8_len(name), BigInt(size.bits()), encoding, llvm.DIFlags.FlagZero);
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:845 build_foreign_type_di_node
function build_foreign_type_di_node(cx: CodegenCx, t: Ty, unique_type_id: UniqueTypeId): DINodeCreationResult {
  // debug!("build_foreign_type_di_node: {:?}", t);

  const k = UniqueTypeId.expect_ty(unique_type_id).kind();
  if (k.$ !== "Foreign") {
    return bug(`build_foreign_type_di_node() called with unexpected type: ${debug_Ty(UniqueTypeId.expect_ty(unique_type_id), PLAIN)}`);
  }
  const def_id = k._0;

  return build_type_with_children(
    cx,
    type_map.stub(
      cx,
      Stub.Struct,
      unique_type_id,
      compute_debuginfo_type_name(cx.tcx, t, false),
      undefined,
      cx.size_and_align_of(t),
      get_namespace_for_item(cx, def_id),
      llvm.DIFlags.FlagZero,
    ),
    (_, _1) => [],
    NO_GENERICS,
  );
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:876 build_compile_unit_di_node
export function build_compile_unit_di_node(tcx: TyCtxt, codegen_unit_name: string, debug_context: CodegenUnitDebugContext): DIDescriptor {
  const src = tcx.sess.local_crate_source_file();
  let name_in_debuginfo = src !== undefined ? src.path(RemapPathScopeComponents.DEBUGINFO) : Symbol.as_str(tcx.crate_name(LOCAL_CRATE));

  // To avoid breaking split DWARF, we need to ensure that each codegen unit
  // has a unique `DW_AT_name`. This is because there's a remote chance that
  // different codegen units for the same module will have entirely
  // identical DWARF entries for the purpose of the DWO ID, which would
  // violate Appendix F ("Split Dwarf Object Files") of the DWARF 5
  // specification. LLVM uses the algorithm specified in section 7.32 "Type
  // Signature Computation" to compute the DWO ID, which does not include
  // any fields that would distinguish compilation units. So we must embed
  // the codegen unit name into the `DW_AT_name`. (Issue #88521.)
  //
  // Additionally, the OSX linker has an idiosyncrasy where it will ignore
  // some debuginfo if multiple object files with the same `DW_AT_name` are
  // linked together.
  //
  // As a workaround for these two issues, we generate unique names for each
  // object file. Those do not correspond to an actual source file but that
  // is harmless.
  name_in_debuginfo = path_join(name_in_debuginfo, "@");
  name_in_debuginfo = path_join(name_in_debuginfo, codegen_unit_name);

  // debug!("build_compile_unit_di_node: {:?}", name_in_debuginfo);
  const rustc_producer = `rustc version ${tcx.sess.cfg_version}`;
  // FIXME(#41252) Remove "clang LLVM" if we can get GDB and LLVM to play nice.
  const producer = `clang LLVM (${rustc_producer})`;

  const work_dir0 = tcx.sess.psess.source_map().working_dir();
  const output_filenames = tcx.output_filenames(null) as OutputFilenames;
  let split_name0 = undefined;
  if (tcx.sess.target_can_use_split_dwarf()) {
    const f = output_filenames.split_dwarf_path(tcx.sess.split_debuginfo(), tcx.sess.opts.unstable_opts.split_dwarf_kind, codegen_unit_name);
    if (f !== undefined) {
      // We get a path relative to the working directory from split_dwarf_path
      split_name0 = tcx.sess.source_map().path_mapping().to_real_filename(work_dir0, f);
    }
  }
  const split_name = split_name0 !== undefined ? split_name0.path(RemapPathScopeComponents.DEBUGINFO) : "";
  const work_dir = work_dir0.path(RemapPathScopeComponents.DEBUGINFO);
  const kind = FromGeneric_for_DebugEmissionKind.from_generic(tcx.sess.opts.debuginfo);

  const dwarf_version = tcx.sess.dwarf_version();
  const is_dwarf_kind = tcx.sess.target.debuginfo_kind === "Dwarf" || tcx.sess.target.debuginfo_kind === "DwarfDsym";
  // Don't emit `.debug_pubnames` and `.debug_pubtypes` on DWARFv4 or lower.
  const debug_name_table_kind = is_dwarf_kind && dwarf_version <= 4 ? llvm.DebugNameTableKind.None : llvm.DebugNameTableKind.Default;

  {
    const compile_unit_file = create_file(debug_context.builder.as_ref(), name_in_debuginfo, work_dir, "", llvm.ChecksumKind.None, undefined);
    const flags = "";

    const unit_metadata = llvm.LLVMRustDIBuilderCreateCompileUnit(
      debug_context.builder.as_ref(),
      dwarf_const.DW_LANG_Rust,
      compile_unit_file,
      producer,
      utf8_len(producer),
      tcx.sess.opts.optimize !== OptLevel.No,
      flags,
      0,
      // NB: this doesn't actually have any perceptible effect, it seems. LLVM will instead
      // put the path supplied to `MCSplitDwarfFile` into the debug info of the final
      // output(s).
      split_name,
      utf8_len(split_name),
      kind,
      0n,
      tcx.sess.opts.unstable_opts.split_dwarf_inlining,
      debug_name_table_kind,
    );

    return unit_metadata;
  }
}

/// Creates a `DW_TAG_member` entry inside the DIE represented by the given `type_di_node`.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:979 build_field_di_node
export function build_field_di_node(
  cx: CodegenCx,
  owner: DIScope,
  name: string,
  layout: TyAndLayout,
  offset: Size,
  flags: DIFlags,
  type_di_node: DIType,
  def_id: DefId | undefined,
): DIType {
  let file_metadata: DIFile;
  let line_number: number;
  if (cx.sess().opts.unstable_opts.debug_info_type_line_numbers) {
    [file_metadata, line_number] = file_metadata_from_def_id(cx, def_id);
  } else {
    [file_metadata, line_number] = [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];
  }
  return create_member_type(cx, owner, name, file_metadata, line_number, layout, offset, flags, type_di_node);
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1008 create_member_type
export function create_member_type(
  cx: CodegenCx,
  owner: DIScope,
  name: string,
  file_metadata: DIType,
  line_number: number,
  layout: TyAndLayout,
  offset: Size,
  flags: DIFlags,
  type_di_node: DIType,
): DIType {
  return llvm.LLVMDIBuilderCreateMemberType(
    DIB(cx),
    owner,
    name,
    utf8_len(name),
    file_metadata,
    line_number,
    BigInt(layout.size.bits()),
    layout.align.abi.bits() >>> 0,
    BigInt(offset.bits()),
    flags,
    type_di_node,
  );
}

/// Returns the `DIFlags` corresponding to the visibility of the item identified by `did`.
///
/// `DIFlags::Flag{Public,Protected,Private}` correspond to `DW_AT_accessibility`
/// (public/protected/private) aren't exactly right for Rust, but neither is `DW_AT_visibility`
/// (local/exported/qualified), and there's no way to set `DW_AT_visibility` in LLVM's API.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1041 visibility_di_flags
export function visibility_di_flags(cx: CodegenCx, did: DefId, type_did: DefId): DIFlags {
  const parent_did = cx.tcx.parent(type_did);
  const visibility = cx.tcx.visibility(did);
  switch (visibility.$) {
    case "Public":
      return llvm.DIFlags.FlagPublic;
    case "Restricted": {
      const did = visibility._0.to_def_id();
      // Private fields have a restricted visibility of the module containing the type.
      if (did.krate === parent_did.krate && did.index === parent_did.index) {
        return llvm.DIFlags.FlagPrivate;
      }
      // `pub(crate)`/`pub(super)` visibilities are any other restricted visibility.
      return llvm.DIFlags.FlagProtected;
    }
  }
}

/// Creates the debuginfo node for a Rust struct type. Maybe be a regular struct or a tuple-struct.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1058 build_struct_type_di_node
function build_struct_type_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId, span: Span): DINodeCreationResult {
  const struct_type = UniqueTypeId.expect_ty(unique_type_id);

  const k = struct_type.kind();
  if (k.$ !== "Adt") {
    return bug(`build_struct_type_di_node() called with non-struct-type: ${debug_Ty(struct_type, PLAIN)}`);
  }
  const adt_def = k._0;
  assert(adt_def.is_struct(), "assertion failed: adt_def.is_struct()");
  const containing_scope = get_namespace_for_item(cx, adt_def.did());
  const struct_type_and_layout = cx.spanned_layout_of(struct_type, span);
  const variant_def = adt_def.non_enum_variant();
  const def_location = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, adt_def.did()) : undefined;
  const name = compute_debuginfo_type_name(cx.tcx, struct_type, false);

  if (struct_type.is_scalable_vector()) {
    const parts = unwrap(struct_type.scalable_vector_parts(cx.tcx));
    return build_scalable_vector_di_node(cx, unique_type_id, name, adt_def, parts, struct_type_and_layout.layout, def_location, containing_scope);
  }

  return type_map.build_type_with_children(
    cx,
    type_map.stub(
      cx,
      Stub.Struct,
      unique_type_id,
      name,
      def_location,
      size_and_align_of(struct_type_and_layout),
      containing_scope,
      visibility_di_flags(cx, adt_def.did(), adt_def.did()),
    ),
    // Fields:
    (cx, owner) =>
      variant_def.fields.map((f, i) => {
        const field_name =
          variant_def.ctor_kind() === "Fn"
            ? // This is a tuple struct
              tuple_field_name(i)
            : // This is struct with named fields
              Symbol.as_str(f.name);
        const field_layout = struct_type_and_layout.field(cx, i);
        const def_id = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? f.did : undefined;
        return build_field_di_node(
          cx,
          owner,
          field_name,
          field_layout,
          FieldsShape.offset(struct_type_and_layout.fields, i),
          visibility_di_flags(cx, f.did, adt_def.did()),
          type_di_node(cx, field_layout.ty),
          def_id,
        );
      }),
    (cx) => build_generic_type_param_di_nodes(cx, struct_type),
  );
}

/// Generate debuginfo for a `#[rustc_scalable_vector]` type.
///
/// Debuginfo for a scalable vector uses a derived type based on a composite type. The composite
/// type has the  `DIFlagVector` flag set and is based on the element type of the scalable vector.
/// The composite type has a subrange from 0 to an expression that calculates the number of
/// elements in the vector.
///
/// ```text,ignore
/// !1 = !DIDerivedType(tag: DW_TAG_typedef, name: "svint16_t", ..., baseType: !2, ...)
/// !2 = !DICompositeType(tag: DW_TAG_array_type, baseType: !3, ..., flags: DIFlagVector, elements: !4)
/// !3 = !DIBasicType(name: "i16", size: 16, encoding: DW_ATE_signed)
/// !4 = !{!5}
/// !5 = !DISubrange(lowerBound: 0, upperBound: !DIExpression(DW_OP_constu, 4, DW_OP_bregx, 46, 0, DW_OP_mul, DW_OP_constu, 1, DW_OP_minus))
/// ```
///
/// See the `CodegenType::CreateType(const BuiltinType *BT)` implementation in Clang for how this
/// is generated for C and C++.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1159 build_scalable_vector_di_node
function build_scalable_vector_di_node(
  cx: CodegenCx,
  unique_type_id: UniqueTypeId,
  name: string,
  adt_def: AdtDef,
  [element_count, element_ty, number_of_vectors]: readonly [number, Ty, NumScalableVectors],
  layout: TyAndLayout["layout"],
  def_location: DefinitionLocation | undefined,
  containing_scope: DIScope,
): DINodeCreationResult {
  const { DW_OP_bregx, DW_OP_constu, DW_OP_minus, DW_OP_mul } = dwarf_const;
  assert(adt_def.repr().is_scalable(), "assertion failed: adt_def.repr().scalable()");
  // This logic is specific to AArch64 for the moment, but can be extended for other architectures
  // later.
  assert_matches(cx.tcx.sess.target.arch, cx.tcx.sess.target.arch.$ === "AArch64", "Arch::AArch64", debug_target_spec_other);

  let file_metadata: DIFile;
  let line_number: number;
  if (def_location !== undefined) {
    [file_metadata, line_number] = [def_location[0], def_location[1]];
  } else {
    [file_metadata, line_number] = [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];
  }

  let bitstride: Metadata | undefined;
  let element_di_node: DIType;
  if (element_ty.is_bool()) {
    [bitstride, element_di_node] = [llvm.LLVMValueAsMetadata(cx.const_i64(1n)), type_di_node(cx, cx.tcx.types.u8)];
  } else {
    [bitstride, element_di_node] = [undefined, type_di_node(cx, element_ty)];
  }

  const number_of_elements: bigint = BigInt(element_count) * BigInt(number_of_vectors);
  const number_of_elements_per_vg = number_of_elements / 2n;
  const expr: bigint[] = [];
  // `($number_of_elements_per_vector_granule * (value_of_register(AArch64::VG) + 0)) - 1`
  expr.push(DW_OP_constu); // Push a constant onto the stack
  expr.push(number_of_elements_per_vg);
  expr.push(DW_OP_bregx); // Push the value of a register + offset on to the stack
  expr.push(/* AArch64::VG */ 46n);
  expr.push(0n);
  expr.push(DW_OP_mul); // Multiply top two values on stack
  expr.push(DW_OP_constu); // Push a constant onto the stack
  expr.push(1n);
  expr.push(DW_OP_minus); // Subtract top two values on stack

  const di_builder = DIB(cx);
  let metadata: DIType;
  {
    const upper = llvm.LLVMDIBuilderCreateExpression(di_builder, expr, expr.length);
    const subrange = llvm.LLVMRustDIGetOrCreateSubrange(
      di_builder,
      /* CountNode */ undefined,
      llvm.LLVMValueAsMetadata(cx.const_i64(0n)),
      upper,
      /* Stride */ undefined,
    );
    const subscripts = create_DIArray(di_builder, [subrange]);
    const vector_ty = llvm.LLVMRustDICreateVectorType(di_builder, /* Size */ 0n, layout.align().abi.bits() >>> 0, element_di_node, subscripts, bitstride);
    metadata = llvm.LLVMDIBuilderCreateTypedef(di_builder, vector_ty, name, utf8_len(name), file_metadata, line_number, containing_scope, layout.align().abi.bits() >>> 0);
  }

  debug_context(cx).type_map.insert(unique_type_id, metadata);
  return new DINodeCreationResult(metadata, true);
}

//=-----------------------------------------------------------------------------
// Tuples
//=-----------------------------------------------------------------------------

/// Builds the DW_TAG_member debuginfo nodes for the upvars of a closure or coroutine.
/// For a coroutine, this will handle upvars shared by all states.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1242 build_upvar_field_di_nodes
function build_upvar_field_di_nodes(cx: CodegenCx, closure_or_coroutine_ty: Ty, closure_or_coroutine_di_node: DIType): DIType[] {
  let def_id: DefId;
  let up_var_tys: readonly Ty[];
  const k = closure_or_coroutine_ty.kind();
  switch (k.$) {
    case "Coroutine":
      [def_id, up_var_tys] = [k._0, CoroutineArgs.upvar_tys(k._1.as_coroutine())];
      break;
    case "Closure":
      [def_id, up_var_tys] = [k._0, ClosureArgs.upvar_tys(k._1.as_closure())];
      break;
    case "CoroutineClosure":
      [def_id, up_var_tys] = [k._0, CoroutineClosureArgs.upvar_tys(k._1.as_coroutine_closure())];
      break;
    default:
      return bug(`build_upvar_field_di_nodes() called with non-closure-or-coroutine-type: ${debug_Ty(closure_or_coroutine_ty, PLAIN)}`);
  }

  for (const ty of up_var_tys) {
    cx.tcx.assert_fully_normalized(cx.typing_env_(), ty, fold_Ty);
  }

  const capture_names = cx.tcx.closure_saved_names_of_captured_variables(def_id);
  const layout = cx.layout_of(closure_or_coroutine_ty);

  const out: DIType[] = [];
  const n = Math.min(up_var_tys.length, capture_names.length);
  for (let index = 0; index < n; index++) {
    const up_var_ty = up_var_tys[index]!;
    const capture_name = capture_names[index]!;
    out.push(
      build_field_di_node(
        cx,
        closure_or_coroutine_di_node,
        Symbol.as_str(capture_name),
        cx.layout_of(up_var_ty),
        FieldsShape.offset(layout.fields, index),
        llvm.DIFlags.FlagZero,
        type_di_node(cx, up_var_ty),
        undefined,
      ),
    );
  }
  return out;
}

/// Builds the DW_TAG_structure_type debuginfo node for a Rust tuple type.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1286 build_tuple_type_di_node
function build_tuple_type_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  const tuple_type = UniqueTypeId.expect_ty(unique_type_id);
  const k = tuple_type.kind();
  if (k.$ !== "Tuple") {
    return bug(`build_tuple_type_di_node() called with non-tuple-type: ${debug_Ty(tuple_type, PLAIN)}`);
  }
  const component_types = k._0;

  const tuple_type_and_layout = cx.layout_of(tuple_type);
  const type_name = compute_debuginfo_type_name(cx.tcx, tuple_type, false);

  return type_map.build_type_with_children(
    cx,
    type_map.stub(cx, Stub.Struct, unique_type_id, type_name, undefined, size_and_align_of(tuple_type_and_layout), NO_SCOPE_METADATA, llvm.DIFlags.FlagZero),
    // Fields:
    (cx, tuple_di_node) =>
      component_types.map((component_type, index) =>
        build_field_di_node(
          cx,
          tuple_di_node,
          tuple_field_name(index),
          cx.layout_of(component_type),
          FieldsShape.offset(tuple_type_and_layout.fields, index),
          llvm.DIFlags.FlagZero,
          type_di_node(cx, component_type),
          undefined,
        ),
      ),
    NO_GENERICS,
  );
}

/// Builds the debuginfo node for a closure environment.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1334 build_closure_env_di_node
function build_closure_env_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId): DINodeCreationResult {
  const closure_env_type = UniqueTypeId.expect_ty(unique_type_id);
  const k = closure_env_type.kind();
  if (!(k.$ === "Closure" || k.$ === "CoroutineClosure")) {
    return bug(`build_closure_env_di_node() called with non-closure-type: ${debug_Ty(closure_env_type, PLAIN)}`);
  }
  const def_id = k._0;
  const containing_scope = get_namespace_for_item(cx, def_id);
  const type_name = compute_debuginfo_type_name(cx.tcx, closure_env_type, false);

  const def_location = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, def_id) : undefined;

  return type_map.build_type_with_children(
    cx,
    type_map.stub(cx, Stub.Struct, unique_type_id, type_name, def_location, cx.size_and_align_of(closure_env_type), containing_scope, llvm.DIFlags.FlagZero),
    // Fields:
    (cx, owner) => build_upvar_field_di_nodes(cx, closure_env_type, owner),
    NO_GENERICS,
  );
}

/// Build the debuginfo node for a Rust `union` type.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1371 build_union_type_di_node
function build_union_type_di_node(cx: CodegenCx, unique_type_id: UniqueTypeId, span: Span): DINodeCreationResult {
  const union_type = UniqueTypeId.expect_ty(unique_type_id);
  const k = union_type.kind();
  if (k.$ !== "Adt") {
    return bug("build_union_type_di_node on a non-ADT");
  }
  const [union_def_id, variant_def] = [k._0.did(), k._0.non_enum_variant()];
  const containing_scope = get_namespace_for_item(cx, union_def_id);
  const union_ty_and_layout = cx.spanned_layout_of(union_type, span);
  const type_name = compute_debuginfo_type_name(cx.tcx, union_type, false);
  const def_location = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? file_metadata_from_def_id(cx, union_def_id) : undefined;

  return type_map.build_type_with_children(
    cx,
    type_map.stub(cx, Stub.Union, unique_type_id, type_name, def_location, size_and_align_of(union_ty_and_layout), containing_scope, llvm.DIFlags.FlagZero),
    // Fields:
    (cx, owner) =>
      variant_def.fields.map((f, i) => {
        const field_layout = union_ty_and_layout.field(cx, i);
        const def_id = cx.sess().opts.unstable_opts.debug_info_type_line_numbers ? f.did : undefined;
        return build_field_di_node(cx, owner, Symbol.as_str(f.name), field_layout, Size.ZERO, llvm.DIFlags.FlagZero, type_di_node(cx, field_layout.ty), def_id);
      }),
    // Generics:
    (cx) => build_generic_type_param_di_nodes(cx, union_type),
  );
}

/// Computes the type parameters for a type, if any, for the given metadata.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1434 build_generic_type_param_di_nodes
export function build_generic_type_param_di_nodes(cx: CodegenCx, ty: Ty): (DIType | undefined)[] {
  const k = ty.kind();
  if (k.$ === "Adt") {
    const def = k._0;
    const args = k._1;
    // FIXME: also do consts?
    if (args.some((a) => GenericArg.as_type(a) !== undefined)) {
      const generics = cx.tcx.generics_of(def.did()) as Generics;
      const names = get_parameter_names(cx, generics);
      const template_params: (DIType | undefined)[] = [];
      const n = Math.min(args.length, names.length);
      for (let i = 0; i < n; i++) {
        const kind = args[i]!;
        const name = names[i]!;
        const ty = GenericArg.as_type(kind);
        if (ty !== undefined) {
          const actual_type = cx.tcx.normalize_erasing_regions(cx.typing_env_(), Unnormalized.new_wip(ty), fold_Ty);
          const actual_type_di_node = type_di_node(cx, actual_type);
          template_params.push(cx.create_template_type_parameter(Symbol.as_str(name), actual_type_di_node));
        }
      }

      return template_params;
    }
  }

  return [];

  // rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1461 get_parameter_names
  function get_parameter_names(cx: CodegenCx, generics: Generics): Symbol[] {
    const names = generics.parent === undefined ? [] : get_parameter_names(cx, cx.tcx.generics_of(generics.parent) as Generics);
    for (const param of generics.own_params) names.push(param.name);
    return names;
  }
}

/// Creates debug information for the given global variable.
///
/// Adds the created debuginfo nodes directly to the crate's IR.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1473 build_global_var_di_node
export function build_global_var_di_node(cx: CodegenCx, def_id: DefId, global: Value): void {
  if (cx.dbg_cx === undefined) {
    return;
  }

  // Only create type information if full debuginfo is enabled
  if (cx.sess().opts.debuginfo !== "Full") {
    return;
  }

  const tcx = cx.tcx;

  // We may want to remove the namespace scope if we're in an extern block (see
  // https://github.com/rust-lang/rust/pull/46457#issuecomment-351750952).
  const var_scope = get_namespace_for_item(cx, def_id);
  const [file_metadata, line_number] = file_metadata_from_def_id(cx, def_id);

  const is_local_to_unit = is_node_local_to_unit(cx, def_id);

  const def_kind = cx.tcx.def_kind(def_id);
  if (def_kind.$ !== "Static") {
    return bug();
  }
  const { nested } = def_kind;
  if (nested) {
    return;
  }
  const variable_type = Instance.ty(Instance.mono(cx.tcx, def_id), cx.tcx, cx.typing_env_());
  const type_di_node_ = type_di_node(cx, variable_type);
  const var_name0 = tcx.item_name(def_id);
  const var_name = Symbol.as_str(var_name0);
  const linkage_name0 = mangled_name_of_instance(cx, Instance.mono(tcx, def_id)).name;
  // When empty, linkage_name field is omitted,
  // which is what we want for no_mangle statics
  const linkage_name = var_name === linkage_name0 ? "" : linkage_name0;

  const global_align = cx.align_of(variable_type);

  DIBuilderExt_for_DIBuilder.create_static_variable(
    DIB(cx),
    var_scope,
    var_name,
    linkage_name,
    file_metadata,
    line_number,
    type_di_node_,
    is_local_to_unit,
    global, // (value)
    undefined, // (decl)
    global_align,
  );
}

/// Generates LLVM debuginfo for a vtable.
///
/// The vtable type looks like a struct with a field for each function pointer and super-trait
/// pointer it contains (plus the `size` and `align` fields).
///
/// Except for `size`, `align`, and `drop_in_place`, the field names don't try to mirror
/// the name of the method they implement. This can be implemented in the future once there
/// is a proper disambiguation scheme for dealing with methods from different traits that have
/// the same name.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1534 build_vtable_type_di_node
function build_vtable_type_di_node(cx: CodegenCx, ty: Ty, poly_trait_ref: ExistentialTraitRef | undefined): DIType {
  const tcx = cx.tcx;

  let vtable_entries: readonly VtblEntry[];
  if (poly_trait_ref !== undefined) {
    const trait_ref0 = ExistentialTraitRef.with_self_ty(poly_trait_ref, as_interner(tcx), ty);
    const trait_ref = tcx.erase_and_anonymize_regions(trait_ref0, d_TraitRef);

    vtable_entries = tcx.vtable_entries(trait_ref);
  } else {
    vtable_entries = COMMON_VTABLE_ENTRIES;
  }

  // All function pointers are described as opaque pointers. This could be improved in the future
  // by describing them as actual function pointers.
  const void_pointer_ty = Ty.new_imm_ptr(tcx, tcx.types.unit);
  const void_pointer_type_di_node = type_di_node(cx, void_pointer_ty);
  const usize_di_node = type_di_node(cx, tcx.types.usize);
  const pointer_layout = cx.layout_of(void_pointer_ty);
  const pointer_size = pointer_layout.size;
  const pointer_align = pointer_layout.align.abi;
  // If `usize` is not pointer-sized and -aligned then the size and alignment computations
  // for the vtable as a whole would be wrong. Let's make sure this holds even on weird
  // platforms.
  assert_size_and_align_eq(cx.size_and_align_of(tcx.types.usize), [pointer_size, pointer_align]);

  const vtable_type_name = compute_debuginfo_vtable_name(cx.tcx, ty, poly_trait_ref, VTableNameKind.Type);
  const unique_type_id = UniqueTypeId.for_vtable_ty(tcx, ty, poly_trait_ref);
  const size = pointer_size.mul(vtable_entries.length);

  // This gets mapped to a DW_AT_containing_type attribute which allows GDB to correlate
  // the vtable to the type it is for.
  const vtable_holder = type_di_node(cx, ty);

  return build_type_with_children(
    cx,
    type_map.stub(cx, { $: "VTableTy", vtable_holder }, unique_type_id, vtable_type_name, undefined, [size, pointer_align], NO_SCOPE_METADATA, llvm.DIFlags.FlagArtificial),
    (cx, vtable_type_di_node) => {
      const out: DIType[] = [];
      for (let index = 0; index < vtable_entries.length; index++) {
        const vtable_entry = vtable_entries[index]!;
        let field_name: string;
        let field_type_di_node: DIType;
        switch (vtable_entry.$) {
          case "MetadataDropInPlace":
            [field_name, field_type_di_node] = ["drop_in_place", void_pointer_type_di_node];
            break;
          case "Method":
            // Note: This code does not try to give a proper name to each method
            //       because their might be multiple methods with the same name
            //       (coming from different traits).
            [field_name, field_type_di_node] = [`__method${index}`, void_pointer_type_di_node];
            break;
          case "TraitVPtr":
            [field_name, field_type_di_node] = [`__super_trait_ptr${index}`, void_pointer_type_di_node];
            break;
          case "MetadataAlign":
            [field_name, field_type_di_node] = ["align", usize_di_node];
            break;
          case "MetadataSize":
            [field_name, field_type_di_node] = ["size", usize_di_node];
            break;
          case "Vacant":
            continue;
        }

        const field_offset = pointer_size.mul(index);

        out.push(build_field_di_node(cx, vtable_type_di_node, field_name, pointer_layout, field_offset, llvm.DIFlags.FlagZero, field_type_di_node, undefined));
      }
      return out;
    },
    NO_GENERICS,
  ).di_node;
}

/// Creates the debuginfo node for `unsafe<'a> T` binder types.
///
/// We treat an unsafe binder like a struct with a single field named `inner`
/// rather than delegating to the inner type's DI node directly. This way the
/// debugger shows the binder's own type name, and the wrapped value is still
/// accessible through the `inner` field.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1633 build_unsafe_binder_type_di_node
function build_unsafe_binder_type_di_node(cx: CodegenCx, binder_type: Ty, unique_type_id: UniqueTypeId): DINodeCreationResult {
  const k = binder_type.kind();
  if (k.$ !== "UnsafeBinder") {
    return bug(`Only ty::UnsafeBinder is valid for build_unsafe_binder_type_di_node. Found ${debug_Ty(binder_type, PLAIN)} instead.`);
  }
  const inner = k._0;
  const inner_type = cx.tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner_deref(inner) /* `(*inner).into()`: `From<UnsafeBinderInner> for Binder` is its field */, fold_Ty);
  const inner_type_di_node = type_di_node(cx, inner_type);

  const type_name = compute_debuginfo_type_name(cx.tcx, binder_type, true);
  return type_map.build_type_with_children(
    cx,
    type_map.stub(cx, Stub.Struct, unique_type_id, type_name, undefined, cx.size_and_align_of(binder_type), NO_SCOPE_METADATA, llvm.DIFlags.FlagZero),
    (cx, unsafe_binder_type_di_node) => {
      const inner_layout = cx.layout_of(inner_type);
      return [build_field_di_node(cx, unsafe_binder_type_di_node, "inner", inner_layout, Size.ZERO, llvm.DIFlags.FlagZero, inner_type_di_node, undefined)];
    },
    NO_GENERICS,
  );
}

/// Get the global variable for the vtable.
///
/// When using global variables, we may have created an addrspacecast to get a pointer to the
/// default address space if global variables are created in a different address space.
/// For modifying the vtable, we need the real global variable. This function accepts either a
/// global variable (which is simply returned), or an addrspacecast constant expression.
/// If the given value is an addrspacecast, the cast is removed and the global variable behind
/// the cast is returned.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1685 find_vtable_behind_cast
function find_vtable_behind_cast(vtable: Value): Value {
  // The vtable is a global variable, which may be behind an addrspacecast.
  const c = llvm.LLVMIsAConstantExpr(vtable);
  if (c !== undefined) {
    if (llvm.LLVMGetConstOpcode(c) === llvm.Opcode.AddrSpaceCast) {
      return unwrap(llvm.LLVMGetOperand(c, 0));
    }
  }
  return vtable;
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1697 apply_vcall_visibility_metadata
export function apply_vcall_visibility_metadata(cx: CodegenCx, ty: Ty, trait_ref0: ExistentialTraitRef | undefined, vtable0: Value): void {
  // FIXME(flip1995): The virtual function elimination optimization only works with full LTO in
  // LLVM at the moment.
  if (!cx.sess().opts.unstable_opts.virtual_function_elimination || cx.sess().lto() !== Lto.Fat) {
    return;
  }

  // enum VCallVisibility { Public = 0, LinkageUnit = 1, TranslationUnit = 2 } (header)
  const VCallVisibility = { Public: 0n, LinkageUnit: 1n, TranslationUnit: 2n } as const;

  if (trait_ref0 === undefined) return;
  const trait_ref = trait_ref0;

  // Unwrap potential addrspacecast
  const vtable = find_vtable_behind_cast(vtable0);
  const trait_ref_self = ExistentialTraitRef.with_self_ty(trait_ref, as_interner(cx.tcx), ty);
  const trait_def_id = trait_ref_self.def_id;
  const trait_vis = cx.tcx.visibility(trait_def_id);

  const cgus = CodegenUnits.as_usize(cx.sess().codegen_units());
  const single_cgu = cgus === 1;

  const lto = cx.sess().lto();

  // Since LLVM requires full LTO for the virtual function elimination optimization to apply,
  // only the `Lto::Fat` cases are relevant currently.
  let vcall_visibility: bigint;
  if (((lto === "No" || lto === "ThinLocal") && trait_vis.$ === "Public") || (lto === "No" && trait_vis.$ === "Restricted" && single_cgu === false)) {
    // If there is not LTO and the visibility in public, we have to assume that the vtable can
    // be seen from anywhere. With multiple CGUs, the vtable is quasi-public.
    vcall_visibility = VCallVisibility.Public;
  } else if (
    ((lto === "Fat" || lto === "Thin") && trait_vis.$ === "Public") ||
    ((lto === "ThinLocal" || lto === "Thin" || lto === "Fat") && trait_vis.$ === "Restricted" && single_cgu === false)
  ) {
    // With LTO and a quasi-public visibility, the usages of the functions of the vtable are
    // all known by the `LinkageUnit`.
    // FIXME: LLVM only supports this optimization for `Lto::Fat` currently. Once it also
    // supports `Lto::Thin` the `VCallVisibility` may have to be adjusted for those.
    vcall_visibility = VCallVisibility.LinkageUnit;
  } else {
    // (_, Visibility::Restricted(_), true): the match is exhaustive, so this is the remaining case.
    // If there is only one CGU, private vtables can only be seen by that CGU/translation unit
    // and therefore we know of all usages of functions in the vtable.
    vcall_visibility = VCallVisibility.TranslationUnit;
  }

  const trait_ref_typeid = typeid_for_trait_ref(cx.tcx, trait_ref);
  const typeid = cx.create_metadata(utf8(trait_ref_typeid));

  const type_ = [llvm.LLVMValueAsMetadata(cx.const_usize(0n)), typeid];
  cx.global_add_metadata_node(vtable, llvm.MD_type, type_);

  const vcall_visibility_ = [llvm.LLVMValueAsMetadata(cx.const_u64(vcall_visibility))];
  cx.global_set_metadata_node(vtable, llvm.MD_vcall_visibility, vcall_visibility_);
}

/// Creates debug information for the given vtable, which is for the
/// given type.
///
/// Adds the created metadata nodes directly to the crate's IR.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1762 create_vtable_di_node
export function create_vtable_di_node(cx: CodegenCx, ty: Ty, poly_trait_ref: ExistentialTraitRef | undefined, vtable0: Value): void {
  if (cx.dbg_cx === undefined) {
    return;
  }

  // Only create type information if full debuginfo is enabled
  if (cx.sess().opts.debuginfo !== "Full") {
    return;
  }

  // Unwrap potential addrspacecast
  const vtable = find_vtable_behind_cast(vtable0);

  // When full debuginfo is enabled, we want to try and prevent vtables from being
  // merged. Otherwise debuggers will have a hard time mapping from dyn pointer
  // to concrete type.
  llvm.set_unnamed_address(vtable, llvm.UnnamedAddr.No);

  const vtable_name = compute_debuginfo_vtable_name(cx.tcx, ty, poly_trait_ref, VTableNameKind.GlobalVariable);
  const vtable_type_di_node = build_vtable_type_di_node(cx, ty, poly_trait_ref);

  DIBuilderExt_for_DIBuilder.create_static_variable(
    DIB(cx),
    NO_SCOPE_METADATA,
    vtable_name,
    "", // (linkage_name)
    unknown_file_metadata(cx),
    UNKNOWN_LINE_NUMBER,
    vtable_type_di_node,
    true, // (is_local_to_unit)
    vtable, // (value)
    undefined, // (decl)
    undefined,
  );
}

/// Creates an "extension" of an existing `DIScope` into another file.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1804 extend_scope_to_file
export function extend_scope_to_file(cx: CodegenCx, scope_metadata: DIScope, file: SourceFile): DILexicalBlock {
  const file_metadata_ = file_metadata(cx, file);
  return llvm.LLVMDIBuilderCreateLexicalBlockFile(DIB(cx), scope_metadata, file_metadata_, /* Discriminator (default) */ 0);
}

const TUPLE_FIELD_NAMES: readonly string[] = ["__0", "__1", "__2", "__3", "__4", "__5", "__6", "__7", "__8", "__9", "__10", "__11", "__12", "__13", "__14", "__15"];

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1820 tuple_field_name
export function tuple_field_name(field_index: number): string {
  // const TUPLE_FIELD_NAMES: [&'static str; 16] (above)
  const s = TUPLE_FIELD_NAMES[field_index];
  return s !== undefined ? s : `__${field_index}`;
}

export type DefinitionLocation = readonly [DIFile, number];

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs:1833 file_metadata_from_def_id
export function file_metadata_from_def_id(cx: CodegenCx, def_id: DefId | undefined): DefinitionLocation {
  let span: Span | undefined;
  if (def_id !== undefined && ((span = walk_chain_collapsed(cx.tcx.def_span(def_id), DUMMY_SP)), !Span.is_dummy(span))) {
    const loc = cx.lookup_debug_loc(Span.lo(span));
    return [file_metadata(cx, loc.file), loc.line];
  } else {
    return [unknown_file_metadata(cx), UNKNOWN_LINE_NUMBER];
  }
}

/** The derived `PartialEq` of a `(Size, Align)` pair. */
function size_and_align_eq(a: readonly [Size, Align], b: readonly [Size, Align]): boolean {
  return Size_eq(a[0], b[0]) && a[1].pow2 === b[1].pow2;
}

/** The `{:?}` of a `(Size, Align)` pair: `(Size(8 bytes), Align(8 bytes))`. */
function debug_size_and_align(v: readonly [Size, Align]): string {
  return debug_tuple(PLAIN, "", [debug_Size(v[0], PLAIN), debug_Align(v[1], PLAIN)]);
}

/** `assert_eq!(a, b)` on `(Size, Align)` pairs, with core's text. */
export function assert_size_and_align_eq(a: readonly [Size, Align], b: readonly [Size, Align]): void {
  assert_eq(a, b, debug_size_and_align, size_and_align_eq);
}
