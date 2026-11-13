// Port of compiler/rustc_codegen_llvm/src/debuginfo/utils.rs (lane cg-di-a, plan-m7 wave 40p).
// Utility Functions.
//
// PORT (cg-di-a):
// - `#[inline]` and `#[allow(non_snake_case)]` are comments; `tracing::trace!` is a comment.
// - `cx.dbg_cx.as_ref().unwrap()` is `unwrap(cx.dbg_cx)`; `debug_context(cx).builder.as_ref()` reads the context's `builder`.
// - `self.typing_env()` on a `CodegenCx` is `HasTypingEnv::typing_env_()` (context.ts header).
import { Size_eq, debug_Size } from "../../rustc_abi/lib.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { PLAIN, type Debug } from "../../std/fmt.ts";
import { assert_eq, panic, unwrap } from "../../std/panic.ts";
import type { CodegenCx } from "../context.ts";
import * as llvm from "../llvm/mod.ts";
import type { DIArray, DIBuilder, DIDescriptor, DIScope } from "../llvm/mod.ts";
import type { CodegenUnitDebugContext } from "./mod.ts";
import { item_namespace } from "./namespace.ts";

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/utils.rs:14 is_node_local_to_unit
export function is_node_local_to_unit(cx: CodegenCx, def_id: DefId): boolean {
  // The is_local_to_unit flag indicates whether a function is local to the
  // current compilation unit (i.e., if it is *static* in the C-sense). The
  // *reachable* set should provide a good approximation of this, as it
  // contains everything that might leak out of the current crate (by being
  // externally visible or by being inlined into something externally
  // visible). It might better to use the `exported_items` set from
  // `driver::CrateAnalysis` in the future, but (atm) this set is not
  // available in the codegen pass.
  return !cx.tcx.is_reachable_non_generic(def_id);
}

// #[allow(non_snake_case)]
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/utils.rs:27 create_DIArray
export function create_DIArray(builder: DIBuilder, arr: readonly (DIDescriptor | undefined)[]): DIArray {
  return llvm.LLVMDIBuilderGetOrCreateArray(builder, arr, arr.length);
}

// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/utils.rs:35 debug_context
export function debug_context(cx: CodegenCx): CodegenUnitDebugContext {
  return unwrap(cx.dbg_cx);
}

// #[inline]
// #[allow(non_snake_case)]
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/utils.rs:43 DIB
export function DIB(cx: CodegenCx): DIBuilder {
  return unwrap(cx.dbg_cx).builder.as_ref();
}

// rustc: compiler/rustc_codegen_llvm/src/debuginfo/utils.rs:47 get_namespace_for_item
export function get_namespace_for_item(cx: CodegenCx, def_id: DefId): DIScope {
  return item_namespace(cx, cx.tcx.parent(def_id));
}

// #[derive(Debug, PartialEq, Eq)]
export type WidePtrKind = "Slice" | "Dyn";
export const WidePtrKind = { Slice: "Slice", Dyn: "Dyn" } as const;
export const debug_WidePtrKind: Debug<WidePtrKind> = (v) => v;

/// Determines if `pointee_ty` is slice-like or trait-object-like, i.e.
/// if the second field of the wide pointer is a length or a vtable-pointer.
/// If `pointee_ty` does not require a wide pointer (because it is Sized) then
/// the function returns `None`.
// rustc: compiler/rustc_codegen_llvm/src/debuginfo/utils.rs:61 wide_pointer_kind
export function wide_pointer_kind(cx: CodegenCx, pointee_ty: Ty): WidePtrKind | undefined {
  const pointee_tail_ty = cx.tcx.struct_tail_for_codegen(pointee_ty, cx.typing_env_());
  const layout = cx.layout_of(pointee_tail_ty);
  // trace!("wide_pointer_kind: {:?} has layout {:?} (is_unsized? {})", pointee_tail_ty, layout, layout.is_unsized());

  if (layout.is_sized()) {
    return undefined;
  }

  const k = pointee_tail_ty.kind();
  switch (k.$) {
    case "Str":
    case "Slice":
      return WidePtrKind.Slice;
    case "Dynamic":
      return WidePtrKind.Dyn;
    case "Foreign": {
      // Assert that pointers to foreign types really are thin:
      assert_eq(
        cx.size_of(Ty.new_imm_ptr(cx.tcx, pointee_tail_ty)),
        cx.size_of(Ty.new_imm_ptr(cx.tcx, cx.tcx.types.u8)),
        (s) => debug_Size(s, PLAIN),
        Size_eq,
      );
      return undefined;
    }
    default: {
      // For all other pointee types we should already have returned None
      // at the beginning of the function.
      return panic(`wide_pointer_kind() - Encountered unexpected \`pointee_tail_ty\`: ${debug_Ty(pointee_tail_ty, PLAIN)}`);
    }
  }
}
