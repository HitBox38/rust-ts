// Port of compiler/rustc_middle/src/ty/typetree.rs (lane ssa-operand-place).
//
// TypeTree metadata for Enzyme autodiff. Without `-Zautodiff=Enable` (always the case outside autodiff builds),
// `typetree_from_ty` returns `TypeTree::new()` before looking at the type; `typed_place_copy_with_flags`
// (rustc_codegen_ssa traits/builder.ts) calls it on every non-ZST memcpy path.
//
// Init order: nothing at top level touches another module; every call goes through function bodies.
import { FieldsShape } from "../../rustc_abi/lib.ts";
import { type FncTree, Kind, Type, TypeTree } from "../../rustc_ast/expand/typetree.ts";
import { bug } from "../../rustc_span/macros.ts";
import { FnSig, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { TyCtxt } from "./context.ts";
import { debug_Ty, type Ty, TypingEnv } from "./mod.ts";
import { display_Ty } from "./print/pretty.ts";

// PORT: `Vec<AutoDiff>::contains(&AutoDiff::Enable)` (derived `PartialEq`): `Enable` and `NoTT` are unit variants, so
// an element equals one exactly when its tag does.
function autodiff_contains(tcx: TyCtxt, tag: "Enable" | "NoTT"): boolean {
  return tcx.sess.opts.unstable_opts.autodiff.some((x) => x.$ === tag);
}

/// Generate TypeTree information for autodiff.
/// This function creates TypeTree metadata that describes the memory layout
/// of function parameters and return types for Enzyme autodiff.
// rustc: compiler/rustc_middle/src/ty/typetree.rs:12 fnc_typetrees
export function fnc_typetrees(tcx: TyCtxt, fn_ty: Ty): FncTree {
  // Check if TypeTrees are disabled via NoTT flag
  if (autodiff_contains(tcx, "NoTT")) {
    return { args: [], ret: TypeTree.new() };
  }

  // Check if this is actually a function type
  if (!fn_ty.is_fn()) {
    return { args: [], ret: TypeTree.new() };
  }

  // Get the function signature
  const fn_sig = fn_ty.fn_sig(tcx);
  const sig = tcx.instantiate_bound_regions_with_erased(fn_sig, fold_FnSig);

  // Create TypeTrees for each input parameter
  const args: TypeTree[] = [];
  for (const ty of FnSig.inputs(sig)) {
    const type_tree = typetree_from_ty(tcx, ty);
    args.push(type_tree);
  }

  // Create TypeTree for return type
  const ret = typetree_from_ty(tcx, FnSig.output(sig));

  const f: FncTree = { args, ret };
  return f;
}

/// Generate a TypeTree for a specific type.
/// Mainly a convenience wrapper around the actual implementation.
// rustc: compiler/rustc_middle/src/ty/typetree.rs:43 typetree_from_ty
export function typetree_from_ty(tcx: TyCtxt, ty: Ty): TypeTree {
  if (!autodiff_contains(tcx, "Enable")) {
    return TypeTree.new();
  }
  if (autodiff_contains(tcx, "NoTT")) {
    return TypeTree.new();
  }
  const visited: Ty[] = [];
  return typetree_from_ty_impl_inner(tcx, ty, 0, visited, false);
}

/// Maximum recursion depth for TypeTree generation to prevent stack overflow
/// from pathological deeply nested types. Combined with cycle detection.
const MAX_TYPETREE_DEPTH: number = 6;

// rustc: compiler/rustc_middle/src/ty/typetree.rs:58 handle_indirection
function handle_indirection(ty: Ty, tcx: TyCtxt, depth: number, visited: Ty[]): TypeTree {
  const inner_ty = ty.builtin_deref(true);
  if (inner_ty === undefined) {
    return bug(`incorrect autodiff typetree handling for type: ${display_Ty(ty)}`);
  }
  // A pointer to a slice-tailed DST is a fat pointer `{data, len}`. `RustSlice` describes both
  // LLVM arguments, while its child describes the memory reached through `data`.
  const typing_env = TypingEnv.fully_monomorphized();
  const tail = tcx.struct_tail_for_codegen(inner_ty, typing_env).kind();
  if (tail.$ === "Slice") {
    const element_ty = tail._0;
    // `layout.size` here is the sized prefix of `inner_ty`, not the slice element size.
    // Direct slices, transparent wrappers (`OsStr`), and ZST-prefixed DSTs have no byte
    // offset to preserve. Nonzero prefixes (e.g. `Header<[f32]>`) keep field offsets.
    // ZST elements still take this path and yield an empty child TypeTree (size 0).
    const layout_r = tcx.layout_of(typing_env.as_query_input(inner_ty));
    const child =
      layout_r.$ === "Ok" && layout_r._0.size.bytes() === 0
        ? typetree_from_ty_impl_inner(tcx, element_ty, depth + 1, visited, false)
        : typetree_from_ty_impl_inner(tcx, inner_ty, depth + 1, visited, true);
    return new TypeTree([new Type(-1, tcx.data_layout().pointer_size().bytes_usize(), Kind.RustSlice, child)]);
  }

  const child = typetree_from_ty_impl_inner(tcx, inner_ty, depth + 1, visited, true);
  return new TypeTree([new Type(-1, tcx.data_layout().pointer_size().bytes_usize(), Kind.Pointer, child)]);
}

/// Internal implementation with context about whether this is for a reference target.
// rustc: compiler/rustc_middle/src/ty/typetree.rs:101 typetree_from_ty_impl_inner
function typetree_from_ty_impl_inner(tcx: TyCtxt, ty: Ty, depth: number, visited: Ty[], is_reference_target: boolean): TypeTree {
  if (depth >= MAX_TYPETREE_DEPTH) {
    // trace!("typetree depth limit {} reached for type: {}", MAX_TYPETREE_DEPTH, ty);
    return TypeTree.new();
  }

  // PORT: `Vec<Ty>::contains`: `Ty` is interned, so `===`.
  if (visited.includes(ty)) {
    return TypeTree.new();
  }
  visited.push(ty);

  let tree: TypeTree;
  const k = ty.kind();
  // PORT: the match arms in upstream order; the guarded `Adt` arms fall through to the next arm when the guard fails.
  if (k.$ === "Slice") {
    // Direct slices are handled by `handle_indirection`. This arm describes a slice tail while
    // recursing through a prefixed DST, so its caller can add the field offset.
    tree = typetree_from_ty_impl_inner(tcx, k._0, depth + 1, visited, false);
  } else if (k.$ === "Ref" || k.$ === "RawPtr") {
    tree = handle_indirection(ty, tcx, depth, visited);
  } else if (k.$ === "Adt" && k._0.is_box()) {
    tree = handle_indirection(ty, tcx, depth, visited);
  } else if (k.$ === "Array") {
    const element_ty = k._0;
    const len = k._1.try_to_target_usize(tcx) ?? 0n;
    if (len === 0n) {
      tree = TypeTree.new();
    } else {
      const element_tree = typetree_from_ty_impl_inner(tcx, element_ty, depth + 1, visited, false);
      const types: Type[] = [];
      for (const elem_type of element_tree._0) {
        types.push(Type.from_ty(-1, elem_type));
      }

      tree = new TypeTree(types);
    }
  } else if (k.$ === "Tuple") {
    const tuple_types = k._0;
    if (tuple_types.length === 0) {
      tree = TypeTree.new();
    } else {
      const types: Type[] = [];
      let current_offset = 0;

      for (const tuple_ty of tuple_types) {
        const element_tree = typetree_from_ty_impl_inner(tcx, tuple_ty, depth + 1, visited, false);

        const layout_r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(tuple_ty));
        const element_layout = layout_r.$ === "Ok" ? layout_r._0.size.bytes_usize() : 0;

        for (const elem_type of element_tree._0) {
          const offset = elem_type.offset === -1 ? current_offset : current_offset + elem_type.offset;
          types.push(Type.from_ty(offset, elem_type));
        }

        current_offset += element_layout;
      }

      tree = new TypeTree(types);
    }
  } else if (k.$ === "Adt" && k._0.is_struct()) {
    const adt_def = k._0;
    const args = k._1;
    const struct_layout = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
    if (struct_layout.$ === "Ok") {
      const layout = struct_layout._0;
      const types: Type[] = [];

      let field_idx = 0;
      for (const field_def of adt_def.all_fields()) {
        const field_ty = field_def.ty(tcx, args);
        const field_tree = typetree_from_ty_impl_inner(tcx, Unnormalized.skip_norm_wip(field_ty), depth + 1, visited, false);

        const field_offset = FieldsShape.offset(layout.fields, field_idx).bytes_usize();

        for (const elem_type of field_tree._0) {
          const offset = elem_type.offset === -1 ? field_offset : field_offset + elem_type.offset;
          types.push(Type.from_ty(offset, elem_type));
        }
        field_idx++;
      }

      tree = new TypeTree(types);
    } else {
      tree = TypeTree.new();
    }
  } else if (k.$ === "Char" || k.$ === "Bool" || (k.$ === "Infer" && k._0.$ === "IntVar") || k.$ === "Int" || k.$ === "Uint") {
    const kind = Kind.Integer;
    const size = ty.primitive_size(tcx).bytes_usize();
    const offset = is_reference_target ? 0 : -1;
    tree = new TypeTree([new Type(offset, size, kind, TypeTree.new())]);
  } else if (k.$ === "Float" || (k.$ === "Infer" && k._0.$ === "FloatVar")) {
    let enzyme_ty: Kind;
    let size: number;
    if (ty === tcx.types.f16) {
      [enzyme_ty, size] = [Kind.Half, 2];
    } else if (ty === tcx.types.f32) {
      [enzyme_ty, size] = [Kind.Float, 4];
    } else if (ty === tcx.types.f64) {
      [enzyme_ty, size] = [Kind.Double, 8];
    } else if (ty === tcx.types.f128) {
      [enzyme_ty, size] = [Kind.F128, 16];
    } else {
      return bug(`Unexpected floating point type: ${debug_Ty(ty, PLAIN)}`);
    }
    const offset = is_reference_target ? 0 : -1;
    tree = new TypeTree([new Type(offset, size, enzyme_ty, TypeTree.new())]);
  } else {
    tree = TypeTree.new();
  }

  const _popped = visited.pop();
  // debug_assert_eq!(popped, Some(ty));
  return tree;
}
