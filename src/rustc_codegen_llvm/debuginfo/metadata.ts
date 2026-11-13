// compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs: SKELETON (lane cg-contract), with the fns a `-Cdebuginfo=0` compile
// reaches ported (lane cg-di-a, wave 40p). The rest of metadata.rs and metadata/* is wave 44's (plan-m7 D9): each fn that
// debuginfo/mod.rs, or a ported fn here, calls is a typed stop naming its upstream file and fn, so a `-Cdebuginfo>0` case stops
// by name.
//
// PORT (cg-di-a):
// - Ported, whole and in upstream order, because a compile without `-g` reaches them (they return early when `cx.dbg_cx` is
//   `None` or the debuginfo level is not `Full`, or without `-Zvirtual-function-elimination` and fat LTO):
//   `build_global_var_di_node` (consts.rs `codegen_static`, every `static`), `find_vtable_behind_cast`,
//   `apply_vcall_visibility_metadata` and `create_vtable_di_node` (rustc_codegen_ssa meth.rs `get_vtable`, every vtable).
//   Their callees past the early returns that live in metadata.rs stay stops.
// - The consts `UNKNOWN_LINE_NUMBER`, `UNKNOWN_COLUMN_NUMBER` (`c_uint`) and `NO_SCOPE_METADATA` (`None`) are ported with
//   their upstream values.
// - The stubs keep cg-contract's label `cg-di-a` (plan-m7 §8 wave 44 gives metadata.rs to `cg-di-a`, metadata/* to
//   `cg-di-b`); `metadata::TypeMap` (metadata/type_map.rs, `#[derive(Default)]`) is an opaque type with a typed-stop default,
//   labelled `cg-di-b`.
// - `enum VCallVisibility { Public = 0, LinkageUnit = 1, TranslationUnit = 2 }` (local to `apply_vcall_visibility_metadata`)
//   is its discriminant as a `bigint` (`vcall_visibility as u64`).
// - `self.typing_env()` on a `CodegenCx` is `HasTypingEnv::typing_env_()` (context.ts header).
import { Lto } from "../../rustc_session/config.ts";
import { CodegenUnits } from "../../rustc_session/session.ts";
import { typeid_for_trait_ref } from "../../rustc_symbol_mangling/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import type { Ty, Visibility } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { SourceFile, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { compute_debuginfo_vtable_name, VTableNameKind } from "../../rustc_codegen_ssa/debuginfo/type_names.ts";
import { as_interner, ExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { utf8 } from "../../std/str.ts";
import type { CodegenCx } from "../context.ts";
import * as llvm from "../llvm/mod.ts";
import type { DIDescriptor, DIFile, DILexicalBlock, DIScope, DIType, Metadata, Value } from "../llvm/mod.ts";
import { DIBuilderExt_for_DIBuilder } from "./di_builder.ts";
import type { CodegenUnitDebugContext } from "./mod.ts";
import { mangled_name_of_instance } from "./namespace.ts";
import { DIB, get_namespace_for_item, is_node_local_to_unit } from "./utils.ts";

/** `metadata::TypeMap<'ll, 'tcx>` (metadata/type_map.rs:113, cg-di-b's, wave 44): opaque here. */
export interface TypeMap {
  readonly __TypeMap: never;
}

// Stub (cg-di-a): `#[derive(Default)] TypeMap` (metadata/type_map.rs:112)
export function TypeMap_default(): TypeMap {
  return unported("cg-di-b: compiler/rustc_codegen_llvm/src/debuginfo/metadata/type_map.rs TypeMap::default");
}

export const UNKNOWN_LINE_NUMBER: number = 0;
export const UNKNOWN_COLUMN_NUMBER: number = 0;

const NO_SCOPE_METADATA: DIScope | undefined = undefined;

// Stub (cg-di-a): create_subroutine_type (debuginfo/metadata.rs:339)
export function create_subroutine_type(_cx: CodegenCx, _signature: readonly (Metadata | undefined)[]): DIType {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs create_subroutine_type");
}

// Stub (cg-di-a): type_di_node (debuginfo/metadata.rs:446)
export function type_di_node(_cx: CodegenCx, _t: Ty): DIType {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs type_di_node");
}

// Stub (cg-di-a): spanned_type_di_node (debuginfo/metadata.rs:450)
export function spanned_type_di_node(_cx: CodegenCx, _t: Ty, _span: Span): DIType {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs spanned_type_di_node");
}

// Stub (cg-di-a): file_metadata (debuginfo/metadata.rs:564)
export function file_metadata(_cx: CodegenCx, _source_file: SourceFile): DIFile {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs file_metadata");
}

// Stub (cg-di-a): unknown_file_metadata (debuginfo/metadata.rs:637)
function unknown_file_metadata(_cx: CodegenCx): DIFile {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs unknown_file_metadata");
}

// Stub (cg-contract): build_compile_unit_di_node (debuginfo/metadata.rs:876)
export function build_compile_unit_di_node(_tcx: TyCtxt, _codegen_unit_name: string, _debug_context: CodegenUnitDebugContext): DIDescriptor {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs build_compile_unit_di_node");
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

// Stub (cg-di-a): build_vtable_type_di_node (debuginfo/metadata.rs:1534)
function build_vtable_type_di_node(_cx: CodegenCx, _ty: Ty, _poly_trait_ref: ExistentialTraitRef | undefined): DIType {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs build_vtable_type_di_node");
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
  const trait_vis = cx.tcx.visibility(trait_def_id) as Visibility<DefId>;

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

// Stub (cg-di-a): extend_scope_to_file (debuginfo/metadata.rs:1804)
export function extend_scope_to_file(_cx: CodegenCx, _scope_metadata: DIScope, _file: SourceFile): DILexicalBlock {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs extend_scope_to_file");
}

// Stub (cg-di-a): file_metadata_from_def_id (debuginfo/metadata.rs:1832)
function file_metadata_from_def_id(_cx: CodegenCx, _def_id: DefId | undefined): [DIFile, number] {
  return unported("cg-di-a: compiler/rustc_codegen_llvm/src/debuginfo/metadata.rs file_metadata_from_def_id");
}
