// Port of compiler/rustc_builtin_macros/src/offload.rs
import { ast, token, tokenstream } from "../rustc_ast/lib.ts";
import { Annotatable, type ExtCtxt } from "../rustc_expand/base.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { Ident, sym } from "../rustc_span/symbol.ts";
import * as diagnostics from "./diagnostics.ts";

// rustc: compiler/rustc_builtin_macros/src/offload.rs:11 compile_for_device
function compile_for_device(ecx: ExtCtxt): boolean {
  return ecx.sess.opts.unstable_opts.offload.some((o) => o.$ === "Device");
}

// rustc: compiler/rustc_builtin_macros/src/offload.rs:15 outer_normal_attr
function outer_normal_attr(normal: ast.NormalAttr, id: ast.AttrId, span: Span): ast.Attribute {
  const style = ast.AttrStyle.Outer;
  const kind: ast.AttrKind = { $: "Normal", _0: ast.clone_NormalAttr(normal) };
  return new ast.Attribute(kind, id, style, span);
}

// rustc: compiler/rustc_builtin_macros/src/offload.rs:21 extract_fn
function extract_fn(item: Annotatable): [ast.Visibility, ast.FnSig, Ident, ast.Generics, ast.Block | undefined] | undefined {
  if (item.$ === "Item") {
    const iitem = item._0;
    if (iitem.kind.$ === "Fn") {
      const { sig, ident, generics, body } = iitem.kind._0;
      return [
        ast.clone_Visibility(iitem.vis),
        ast.clone_FnSig(sig),
        ident,
        ast.clone_Generics(generics),
        body === undefined ? undefined : ast.clone_Block(body),
      ];
    }
    return undefined;
  }
  return undefined;
}

/// The `offload_kernel` macro expands the function into two separate definitions:
/// one on the host to handle the call, and one on the device for executing the kernel.
///
/// ```
/// #[offload_kernel]
/// fn foo(a: &[f32], b: &[f32], c: *mut f32) {
///     *c = a[0] + b[0];
/// }
/// ```
///
/// This expands to the host-side function:
///
/// ```
/// #[inline(never)]
/// fn foo(_: &[f32], _: &[f32], _: *mut f32) {
///     ::core::panicking::panic("not implemented")
/// }
/// ```
///
/// And the device-side kernel:
///
/// ```
/// #[rustc_offload_kernel]
/// unsafe extern "gpu-kernel" fn foo(a: &[f32], b: &[f32], c: *mut f32) {
///     *c = a[0] + b[0];
/// }
/// ```
// rustc: compiler/rustc_builtin_macros/src/offload.rs:62 expand_kernel
export function expand_kernel(ecx: ExtCtxt, expand_span: Span, _meta_item: ast.MetaItem, item: Annotatable): Annotatable[] {
  const dcx = ecx.sess.dcx();

  const extracted = extract_fn(item);
  if (extracted === undefined) {
    dcx.emit_err(diagnostics.AutoDiffInvalidApplication_diagnostic({ span: Annotatable.span(item) }));
    return [item];
  }
  const [vis, sig, ident, generics, body] = extracted;

  const span = ecx.with_def_site_ctxt(expand_span);

  // device function
  const device_fn = new ast.Fn(ast.Defaultness.Implicit, ident, ast.clone_Generics(generics), ast.clone_FnSig(sig), undefined, undefined, body, undefined);

  const extern_gpu_kernel = ast.Extern.from_abi(new ast.StrLit(sym.gpu_kernel, undefined, sym.gpu_kernel, ast.StrStyle.Cooked, span), span);
  device_fn.sig.header.ext = extern_gpu_kernel;
  device_fn.sig.header.safety = { $: "Unsafe", _0: span };

  // rustc_offload_kernel attr
  const rustc_offload_kernel_attr = ast.NormalAttr.from_ident(Ident.with_dummy_span(sym.rustc_offload_kernel));
  const rustc_offload_kernel = outer_normal_attr(rustc_offload_kernel_attr, ecx.sess.psess.attr_id_generator.mk_attr_id(), span);

  let device_item: Annotatable;
  {
    const item_ = ecx.item(span, [ast.clone_Attribute(rustc_offload_kernel)], { $: "Fn", _0: device_fn });
    item_.vis = ast.clone_Visibility(vis);
    device_item = { $: "Item", _0: item_ };
  }

  // unimplemented! body
  const macro_expr = ecx.expr_macro_call(
    span,
    ecx.macro_call(
      span,
      ecx.path_global(
        span,
        [sym.core, sym.unimplemented].map((s) => Ident.new(s, span)),
      ),
      token.Delimiter.Parenthesis,
      tokenstream.TokenStream.default(),
    ),
  );
  const stmt = ecx.stmt_expr(macro_expr);
  const body_ = ecx.block(span, [stmt]);

  // host function
  const host_fn = new ast.Fn(ast.Defaultness.Implicit, ident, generics, sig, undefined, undefined, body_, undefined);

  for (const param of host_fn.sig.decl.inputs) {
    // `*param.pat = ecx.pat_wild(param.pat.span)`
    param.pat = ecx.pat_wild(param.pat.span);
  }

  // inline(never) attr
  const ts = [
    { $: "Token" as const, _0: token.Token.new({ $: "Ident", _0: sym.never, _1: token.IdentKind.Normal }, span), _1: tokenstream.Spacing.Joint },
  ];

  const never_arg = new ast.DelimArgs(
    tokenstream.DelimSpan.from_single(span),
    token.Delimiter.Parenthesis,
    tokenstream.TokenStream.from_iter(ts),
  );

  const inline_item = new ast.AttrItem(
    ast.Safety.Default,
    ast.Path.from_ident(Ident.with_dummy_span(sym.inline)),
    { $: "Delimited", _0: never_arg },
    DUMMY_SP,
  );
  const inline_never_attr = new ast.NormalAttr(inline_item, undefined);

  const new_id = ecx.sess.psess.attr_id_generator.mk_attr_id();
  const inline_never = outer_normal_attr(inline_never_attr, new_id, span);

  let host_item: Annotatable;
  {
    const item_ = ecx.item(span, [rustc_offload_kernel, inline_never], { $: "Fn", _0: host_fn });
    item_.vis = vis;
    host_item = { $: "Item", _0: item_ };
  }

  return compile_for_device(ecx) ? [device_item] : [host_item];
}
