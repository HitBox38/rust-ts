// Port of compiler/rustc_builtin_macros/src/global_allocator.rs
import {
  ALLOCATOR_METHODS,
  type AllocatorMethod,
  type AllocatorMethodInput,
  type AllocatorTy,
  global_fn_name,
} from "../rustc_ast/expand/allocator.ts";
import { ast } from "../rustc_ast/lib.ts";
import { Annotatable, clone_Annotatable, type ExtCtxt } from "../rustc_expand/base.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { panic, unreachable } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";
import { check_builtin_macro_attribute } from "./util.ts";

type AttrVec = ast.AttrVec;
type Expr = ast.Expr;
type Param = ast.Param;
type Stmt = ast.Stmt;
type Ty = ast.Ty;

// rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:15 expand
export function expand(ecx: ExtCtxt, _span: Span, meta_item: ast.MetaItem, item_: Annotatable): Annotatable[] {
  check_builtin_macro_attribute(ecx, meta_item, sym.global_allocator);

  const orig_item = clone_Annotatable(item_);

  // Allow using `#[global_allocator]` on an item statement
  // FIXME - if we get deref patterns, use them to reduce duplication here
  let item: ast.Item;
  let ident: Ident;
  let is_stmt: boolean;
  let ty_span: Span;
  if (item_.$ === "Item" && item_._0.kind.$ === "Static") {
    const { ident: ident_, ty } = item_._0.kind._0;
    [item, ident, is_stmt, ty_span] = [item_._0, ident_, false, ecx.with_def_site_ctxt(ty.span)];
  } else if (item_.$ === "Stmt" && item_._0.kind.$ === "Item" && item_._0.kind._0.kind.$ === "Static") {
    const { ident: ident_, ty } = item_._0.kind._0.kind._0;
    [item, ident, is_stmt, ty_span] = [item_._0.kind._0, ident_, true, ecx.with_def_site_ctxt(ty.span)];
  } else {
    ecx.dcx().emit_err(diagnostics.AllocMustStatics_diagnostic({ span: Annotatable.span(item_) }));
    return [orig_item];
  }

  // Forbid `#[thread_local]` attributes on the item
  const attr = item.attrs.find((x) => x.has_name(sym.thread_local));
  if (attr !== undefined) {
    ecx.dcx().emit_err(diagnostics.AllocCannotThreadLocal_diagnostic({ span: item.span, attr: attr.span }));
    return [orig_item];
  }

  // Generate a bunch of new items using the AllocFnFactory
  const span = ecx.with_def_site_ctxt(item.span);
  const f = new AllocFnFactory(span, ty_span, ident, ecx);

  // Generate item statements for the allocator methods.
  const stmts = ALLOCATOR_METHODS.map((method) => f.allocator_fn(method));

  // Generate anonymous constant serving as container for the allocator methods.
  const const_ty = ecx.ty(ty_span, { $: "Tup", _0: [] });
  const const_body = ecx.expr_block(ecx.block(span, stmts));
  const const_item_ = ecx.item_const(span, Ident.new(kw.Underscore, span), const_ty, const_body);
  const const_item: Annotatable = is_stmt ? { $: "Stmt", _0: ecx.stmt_item(span, const_item_) } : { $: "Item", _0: const_item_ };

  // Return the original item and the new methods.
  return [orig_item, const_item];
}

class AllocFnFactory {
  constructor(
    public span: Span,
    public ty_span: Span,
    public global: Ident,
    public cx: ExtCtxt,
  ) {}

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:78 allocator_fn
  allocator_fn(method: AllocatorMethod): Stmt {
    const abi_args: Param[] = [];
    const args = method.inputs.map((input) => this.arg_ty(input, abi_args));
    const result = this.call_allocator(method.name, args);
    const output_ty = this.ret_ty(method.output);
    const decl = this.cx.fn_decl(abi_args, { $: "Ty", _0: output_ty });
    // `FnHeader { safety: Safety::Unsafe(self.span), ..FnHeader::default() }`
    const header = ast.FnHeader.default();
    header.safety = { $: "Unsafe", _0: this.span };
    const sig = new ast.FnSig(header, decl, this.span);
    const body = this.cx.block_expr(result);
    const kind: ast.ItemKind = {
      $: "Fn",
      _0: new ast.Fn(
        ast.Defaultness.Implicit,
        Ident.from_str_and_span(global_fn_name(method.name), this.span),
        generics_default(),
        sig,
        undefined,
        undefined,
        body,
        undefined,
      ),
    };
    const item = this.cx.item(this.span, this.attrs(method), kind);
    return this.cx.stmt_item(this.ty_span, item);
  }

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:101 call_allocator
  call_allocator(method_: Symbol, args: Expr[]): Expr {
    const method__ = this.cx.std_path([sym.alloc, sym.GlobalAlloc, method_]);
    const method = this.cx.expr_path(this.cx.path(this.ty_span, method__));
    const allocator_ = this.cx.path_ident(this.ty_span, this.global);
    const allocator__ = this.cx.expr_path(allocator_);
    const allocator = this.cx.expr_addr_of(this.ty_span, allocator__);
    args.splice(0, 0, allocator);

    return this.cx.expr_call(this.ty_span, method, args);
  }

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:112 attrs
  attrs(method: AllocatorMethod): AttrVec {
    let alloc_attr: Symbol;
    switch (method.name) {
      case sym.alloc:
        alloc_attr = sym.rustc_allocator;
        break;
      case sym.dealloc:
        alloc_attr = sym.rustc_deallocator;
        break;
      case sym.realloc:
        alloc_attr = sym.rustc_reallocator;
        break;
      case sym.alloc_zeroed:
        alloc_attr = sym.rustc_allocator_zeroed;
        break;
      default:
        return unreachable("Unknown allocator method!");
    }
    return [this.cx.attr_word(sym.rustc_std_internal_symbol, this.span), this.cx.attr_word(alloc_attr, this.span)];
  }

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:126 arg_ty
  arg_ty(input: AllocatorMethodInput, args: Param[]): Expr {
    switch (input.ty) {
      case "Layout": {
        // If an allocator method is ever introduced having multiple
        // Layout arguments, these argument names need to be
        // disambiguated somehow. Currently the generated code would
        // fail to compile with "identifier is bound more than once in
        // this parameter list".
        const size_ = Ident.new(sym.size, this.span);
        const align_ = Ident.new(sym.align, this.span);

        const usize = this.cx.path_ident(this.span, Ident.new(sym.usize, this.span));
        const ty_usize = this.cx.ty_path(usize);
        args.push(this.cx.param(this.span, size_, ty_usize));
        const ty_align = this.ptr_alignment();
        args.push(this.cx.param(this.span, align_, ty_align));

        const layout_new_ = this.cx.std_path([sym.alloc, sym.Layout, sym.from_size_alignment_unchecked]);
        const layout_new = this.cx.expr_path(this.cx.path(this.span, layout_new_));
        const size = this.cx.expr_ident(this.span, size_);
        const align = this.cx.expr_ident(this.span, align_);
        const layout = this.cx.expr_call(this.span, layout_new, [size, align]);
        return layout;
      }

      case "Ptr": {
        const ident = Ident.from_str_and_span(input.name, this.span);
        args.push(this.cx.param(this.span, ident, this.ptr_u8()));
        return this.cx.expr_ident(this.span, ident);
      }

      case "Usize": {
        const ident = Ident.from_str_and_span(input.name, this.span);
        args.push(this.cx.param(this.span, ident, this.usize()));
        return this.cx.expr_ident(this.span, ident);
      }

      case "Never":
      case "ResultPtr":
      case "Unit":
        return panic("can't convert AllocatorTy to an argument");
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:173 ret_ty
  ret_ty(ty: AllocatorTy): Ty {
    switch (ty) {
      case "ResultPtr":
        return this.ptr_u8();

      case "Unit":
        return this.cx.ty(this.span, { $: "Tup", _0: [] });

      case "Layout":
      case "Never":
      case "Usize":
      case "Ptr":
        return panic("can't convert `AllocatorTy` to an output");
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:185 usize
  usize(): Ty {
    const usize = this.cx.path_ident(this.span, Ident.new(sym.usize, this.span));
    return this.cx.ty_path(usize);
  }

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:190 ptr_alignment
  ptr_alignment(): Ty {
    const path_ = this.cx.std_path([sym.mem, sym.Alignment]);
    const path = this.cx.path(this.span, path_);
    return this.cx.ty_path(path);
  }

  // rustc: compiler/rustc_builtin_macros/src/global_allocator.rs:196 ptr_u8
  ptr_u8(): Ty {
    const u8 = this.cx.path_ident(this.span, Ident.new(sym.u8, this.span));
    const ty_u8 = this.cx.ty_path(u8);
    return this.cx.ty_ptr(this.span, ty_u8, "Mut");
  }
}

/** PORT: `Generics::default()` (`#[derive(Default)]` on `Generics` and `WhereClause`, ast.rs), as in alloc_error_handler.ts. */
function generics_default(): ast.Generics {
  return { params: [], where_clause: new ast.WhereClause(false, [], DUMMY_SP), span: DUMMY_SP };
}
