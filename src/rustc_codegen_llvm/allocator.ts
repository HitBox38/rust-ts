// Port of compiler/rustc_codegen_llvm/src/allocator.rs (skeleton: lane cg-contract; bodies: lane cg-builder, plan-m7 §8 wave 41).
//
// PORT (cg-builder): `cx.llcx` / `cx.llmod` (fields of `SCx`, through `SimpleCx`'s deref) are the type_.rs accessors
// `cx.llcx()` / `cx.llmod()` (cg-contract decision 4). `SBuilder::build`, `bx.ret(..)` and `bx.ret_void()` on the concrete
// `SBuilder` are the inherent methods (`build_inherent`, `ret_inherent`, `ret_void_inherent`; builder.ts header, review F1).
import { default_fn_name, global_fn_name, NO_ALLOC_SHIM_IS_UNSTABLE, type AllocatorMethod } from "../rustc_ast/expand/allocator.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { bug } from "../rustc_span/macros.ts";
import { mangle_internal_symbol } from "../rustc_symbol_mangling/v0.ts";
import { assert, panic } from "../std/panic.ts";
import * as attributes from "./attributes.ts";
import { llfn_attrs_from_instance } from "./attributes.ts";
import { SBuilder } from "./builder.ts";
import type { SimpleCx } from "./context.ts";
import { CodegenUnitDebugContext } from "./debuginfo/mod.ts";
import { build_compile_unit_di_node } from "./debuginfo/metadata.ts";
import { declare_simple_fn } from "./declare.ts";
import * as llvm from "./llvm/mod.ts";
import type { Attribute, Type } from "./llvm/mod.ts";

// rustc: compiler/rustc_codegen_llvm/src/allocator.rs:20 codegen
export function codegen(tcx: TyCtxt, cx: SimpleCx, module_name: string, methods: readonly AllocatorMethod[]): void {
  let usize: Type;
  const tws = tcx.sess.target.pointer_width;
  switch (tws) {
    case 16:
      usize = cx.type_i16();
      break;
    case 32:
      usize = cx.type_i32();
      break;
    case 64:
      usize = cx.type_i64();
      break;
    default:
      return bug(`Unsupported target word size for int: ${tws}`);
  }
  const i8p = cx.type_ptr();

  for (const method of methods) {
    const args: Type[] = [];
    for (const input of method.inputs) {
      switch (input.ty) {
        case "Layout":
          args.push(usize); // size
          args.push(usize); // align
          break;
        case "Ptr":
          args.push(i8p);
          break;
        case "Usize":
          args.push(usize);
          break;

        case "Never":
        case "ResultPtr":
        case "Unit":
          panic("invalid allocator arg");
      }
    }

    let no_return = false;
    let output: Type | undefined;
    switch (method.output) {
      case "ResultPtr":
        output = i8p;
        break;
      case "Unit":
        output = undefined;
        break;
      case "Never":
        no_return = true;
        output = undefined;
        break;

      case "Layout":
      case "Usize":
      case "Ptr":
        panic("invalid allocator output");
    }

    const from_name = mangle_internal_symbol(tcx, global_fn_name(method.name));
    const to_name = mangle_internal_symbol(tcx, default_fn_name(method.name));

    let alloc_attr_flag: CodegenFnAttrFlags;
    switch (method.special) {
      case "Alloc":
        alloc_attr_flag = CodegenFnAttrFlags.ALLOCATOR;
        break;
      case "Dealloc":
        alloc_attr_flag = CodegenFnAttrFlags.DEALLOCATOR;
        break;
      case "Realloc":
        alloc_attr_flag = CodegenFnAttrFlags.REALLOCATOR;
        break;
      case "AllocZeroed":
        alloc_attr_flag = CodegenFnAttrFlags.ALLOCATOR_ZEROED;
        break;
      case undefined:
        alloc_attr_flag = CodegenFnAttrFlags.empty();
        break;
    }

    const attrs = CodegenFnAttrs.new();
    attrs.flags = CodegenFnAttrFlags.union(attrs.flags, alloc_attr_flag);
    create_wrapper_function(tcx, cx, from_name, to_name, args, output, no_return, attrs);
  }

  // __rust_no_alloc_shim_is_unstable_v2
  create_wrapper_function(tcx, cx, mangle_internal_symbol(tcx, NO_ALLOC_SHIM_IS_UNSTABLE), undefined, [], undefined, false, CodegenFnAttrs.new());

  if (tcx.sess.opts.debuginfo !== "None") {
    const dbg_cx = CodegenUnitDebugContext.new(cx.llmod(), tcx.sess);
    build_compile_unit_di_node(tcx, module_name, dbg_cx);
    dbg_cx.finalize();
  }
}

// rustc: compiler/rustc_codegen_llvm/src/allocator.rs:109 create_wrapper_function
function create_wrapper_function(
  tcx: TyCtxt,
  cx: SimpleCx,
  from_name: string,
  to_name: string | undefined,
  args_: readonly Type[],
  output: Type | undefined,
  no_return_: boolean,
  attrs: CodegenFnAttrs,
): void {
  const ty = cx.type_func(args_, output ?? cx.type_void());
  const llfn = declare_simple_fn(
    cx,
    from_name,
    llvm.CallConv.CCallConv,
    llvm.UnnamedAddr.Global,
    llvm.FromGeneric_for_Visibility.from_generic(tcx.sess.default_visibility()),
    ty,
  );

  llfn_attrs_from_instance(cx, tcx, llfn, attrs, undefined, undefined);

  let no_return: Attribute | undefined;
  if (no_return_) {
    // -> ! DIFlagNoReturn
    const no_return_attr = llvm.AttributeKind_impl.create_attr(llvm.AttributeKind.NoReturn, cx.llcx());
    attributes.apply_to_llfn(llfn, llvm.AttributePlace.Function, [no_return_attr]);
    no_return = no_return_attr;
  } else {
    no_return = undefined;
  }

  if (tcx.sess.target.is_like_gpu) {
    // Conservatively apply convergent to all functions in case they may call
    // a convergent function. Rely on LLVM to optimize away the unnecessary
    // convergent attributes.
    attributes.apply_to_llfn(llfn, llvm.AttributePlace.Function, [llvm.AttributeKind_impl.create_attr(llvm.AttributeKind.Convergent, cx.llcx())]);
  }

  const llbb = llvm.LLVMAppendBasicBlockInContext(cx.llcx(), llfn, "entry");
  const bx = SBuilder.build_inherent(cx, llbb);

  if (to_name !== undefined) {
    const callee = declare_simple_fn(cx, to_name, llvm.CallConv.CCallConv, llvm.UnnamedAddr.Global, llvm.Visibility.Hidden, ty);
    if (no_return !== undefined) {
      // -> ! DIFlagNoReturn
      attributes.apply_to_llfn(callee, llvm.AttributePlace.Function, [no_return]);
    }
    llvm.set_visibility(callee, llvm.Visibility.Hidden);

    const args = args_.map((_, i) => llvm.get_param(llfn, i >>> 0));
    const ret = bx.call(ty, callee, args, undefined);
    llvm.LLVMSetTailCall(ret, llvm.TRUE);
    if (output !== undefined) {
      bx.ret_inherent(ret);
    } else {
      bx.ret_void_inherent();
    }
  } else {
    assert(output === undefined, "assertion failed: output.is_none()");
    bx.ret_void_inherent();
  }
}
