// Port of compiler/rustc_builtin_macros/src/autodiff.rs
//! This module contains the implementation of the `#[autodiff]` attribute.
//! Currently our linter isn't smart enough to see that each import is used in one of the two
//! configs (autodiff enabled or disabled), so we have to add cfg's to each import.
//! FIXME(ZuseZ4): Remove this once we have a smarter linter.
//
// PORT: the inline `mod llvm_enzyme` holds every fn of the file; it is flattened into this module and
// `pub(crate) use llvm_enzyme::{expand_forward, expand_reverse};` becomes their `export`. `debug!` /
// `trace!` (tracing) are dropped as comments.

import {
  DiffActivity,
  type DiffMode,
  DiffMode as DiffModeC,
  display_DiffActivity,
  display_DiffMode,
  valid_input_activity,
  valid_ret_activity,
  valid_ty_for_activity,
} from "../rustc_ast/expand/autodiff_attrs.ts";
import { ast, token, tokenstream } from "../rustc_ast/lib.ts";
import { DUMMY_NODE_ID } from "../rustc_ast/node_id.ts";
import { RustcAutodiff } from "../rustc_attr_ir/lib.ts";
import { Annotatable, type ExtCtxt } from "../rustc_expand/base.ts";
import { DUMMY_SP, debug_Span, type Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";

type TokenTree = tokenstream.TokenTree;

// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:28 outer_normal_attr
export function outer_normal_attr(kind: ast.NormalAttr, id: ast.AttrId, span: Span): ast.Attribute {
  const style = ast.AttrStyle.Outer;
  const kind_: ast.AttrKind = { $: "Normal", _0: ast.clone_NormalAttr(kind) };
  return new ast.Attribute(kind_, id, style, span);
}

// If we have a default `()` return type or explicitley `()` return type,
// then we often can skip doing some work.
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:40 has_ret
function has_ret(ty: ast.FnRetTy): boolean {
  switch (ty.$) {
    case "Ty":
      return !ast.TyKind.is_unit(ty._0.kind);
    case "Default":
      return false;
  }
}
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:46 first_ident
function first_ident(x: ast.MetaItemInner): Ident {
  const l = ast.MetaItemInner.lit(x);
  if (l !== undefined) {
    if (l.kind.$ === "Int") {
      const val = l.kind._0;
      // get an Ident from a lit
      return Ident.from_str(val.toString());
    }
  }

  const segments = unwrap(ast.MetaItemInner.meta_item(x)).path.segments;
  assert(segments.length === 1, "assertion failed: segments.len() == 1");
  return segments[0]!.ident;
}

// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:62 name
function name(x: ast.MetaItemInner): string {
  return Symbol.as_str(first_ident(x).name);
}

// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:66 width
function width(x: ast.MetaItemInner): bigint | undefined {
  const lit = ast.MetaItemInner.lit(x);
  if (lit === undefined) return undefined;
  if (lit.kind.$ === "Int") {
    return lit.kind._0;
  }
  return undefined;
}

// Get information about the function the macro is applied to
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:75 extract_item_info
function extract_item_info(iitem: ast.Item): [ast.Visibility, ast.FnSig, Ident, ast.Generics] | undefined {
  if (iitem.kind.$ === "Fn") {
    const { sig, ident, generics } = iitem.kind._0;
    return [ast.clone_Visibility(iitem.vis), ast.clone_FnSig(sig), ident, ast.clone_Generics(generics)];
  }
  return undefined;
}

// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:84 from_ast
export function from_ast(ecx: ExtCtxt, meta_item: readonly ast.MetaItemInner[], has_ret: boolean, mode: DiffMode): RustcAutodiff {
  const dcx = ecx.sess.dcx();

  // Now we check, whether the user wants autodiff in batch/vector mode, or scalar mode.
  // If he doesn't specify an integer (=width), we default to scalar mode, thus width=1.
  let first_activity = 1;

  let width_: number;
  const x = meta_item.length >= 2 ? width(meta_item[1]!) : undefined;
  if (x !== undefined) {
    first_activity = 2;
    // `x.try_into()`: u128 -> u32
    if (x <= 0xffff_ffffn) {
      width_ = Number(x);
    } else {
      dcx.emit_err(diagnostics.AutoDiffInvalidWidth_diagnostic({ span: ast.MetaItemInner.span(meta_item[1]!), width: x }));
      return RustcAutodiff.error();
    }
  } else {
    width_ = 1;
  }

  const activities: DiffActivity[] = [];
  let errors = false;
  for (const x of meta_item.slice(first_activity)) {
    const activity_str = name(x);
    const res = DiffActivity.from_str(activity_str);
    if (res.$ === "Ok") {
      activities.push(res._0);
    } else {
      dcx.emit_err(diagnostics.AutoDiffUnknownActivity_diagnostic({ span: ast.MetaItemInner.span(x), act: activity_str }));
      errors = true;
    }
  }
  if (errors) {
    return RustcAutodiff.error();
  }

  // If a return type exist, we need to split the last activity,
  // otherwise we return None as placeholder.
  let ret_activity: DiffActivity;
  let input_activity: DiffActivity[];
  if (has_ret) {
    if (activities.length === 0) {
      return unreachable("should not be reachable because we counted the number of activities previously");
    }
    [ret_activity, input_activity] = [activities[activities.length - 1]!, activities.slice(0, -1)];
  } else {
    [ret_activity, input_activity] = [{ $: "None" }, activities];
  }

  return new RustcAutodiff(mode, width_, [...input_activity], ret_activity);
}

// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:155 meta_item_inner_to_ts
function meta_item_inner_to_ts(t: ast.MetaItemInner, ts: TokenTree[]): void {
  const comma = token.Token.new(token.TokenKind.Comma, DUMMY_SP);
  const val = first_ident(t);
  const t_ = token.Token.from_ast_ident(val);
  ts.push({ $: "Token", _0: t_, _1: tokenstream.Spacing.Joint });
  ts.push({ $: "Token", _0: comma, _1: tokenstream.Spacing.Alone });
}

// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:163 expand_forward
export function expand_forward(ecx: ExtCtxt, expand_span: Span, meta_item: ast.MetaItem, item: Annotatable): Annotatable[] {
  return expand_with_mode(ecx, expand_span, meta_item, item, DiffModeC.Forward);
}

// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:172 expand_reverse
export function expand_reverse(ecx: ExtCtxt, expand_span: Span, meta_item: ast.MetaItem, item: Annotatable): Annotatable[] {
  return expand_with_mode(ecx, expand_span, meta_item, item, DiffModeC.Reverse);
}

/// We expand the autodiff macro to generate a new placeholder function which passes
/// type-checking and can be called by users. The exact signature of the generated function
/// depends on the configuration provided by the user, but here is an example:
///
/// ```
/// #[autodiff(cos_box, Reverse, Duplicated, Active)]
/// fn sin(x: &Box<f32>) -> f32 {
///     f32::sin(**x)
/// }
/// ```
/// which becomes expanded to:
/// ```
/// #[rustc_autodiff]
/// fn sin(x: &Box<f32>) -> f32 {
///     f32::sin(**x)
/// }
/// #[rustc_autodiff(Reverse, Duplicated, Active)]
/// fn cos_box(x: &Box<f32>, dx: &mut Box<f32>, dret: f32) -> f32 {
///     std::intrinsics::autodiff(sin::<> as fn(..) -> .., cos_box::<>, (x, dx, dret))
/// }
/// ```
/// FIXME(ZuseZ4): Once autodiff is enabled by default, make this a doc comment which is checked
/// in CI.
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:204 expand_with_mode
export function expand_with_mode(
  ecx: ExtCtxt,
  expand_span: Span,
  meta_item: ast.MetaItem,
  item: Annotatable,
  mode: DiffMode,
): Annotatable[] {
  const dcx = ecx.sess.dcx();

  // first get information about the annotable item: visibility, signature, name and generic
  // parameters.
  // these will be used to generate the differentiated version of the function
  let info: [ast.Visibility, ast.FnSig, Ident, ast.Generics, boolean] | undefined;
  switch (item.$) {
    case "Item": {
      const r = extract_item_info(item._0);
      info = r === undefined ? undefined : [...r, false];
      break;
    }
    case "Stmt": {
      const stmt = item._0;
      if (stmt.kind.$ === "Item") {
        const r = extract_item_info(stmt.kind._0);
        info = r === undefined ? undefined : [...r, false];
      } else {
        info = undefined;
      }
      break;
    }
    case "AssocItem": {
      // `_ctxt @ (Impl { of_trait: _ } | Trait)`
      const ctxt = item._1;
      const assoc_item = item._0;
      if ((ctxt.$ === "Impl" || ctxt.$ === "Trait") && assoc_item.kind.$ === "Fn") {
        const { sig, ident, generics } = assoc_item.kind._0;
        info = [ast.clone_Visibility(assoc_item.vis), ast.clone_FnSig(sig), ident, ast.clone_Generics(generics), true];
      } else {
        info = undefined;
      }
      break;
    }
    default:
      info = undefined;
  }
  if (info === undefined) {
    dcx.emit_err(diagnostics.AutoDiffInvalidApplication_diagnostic({ span: Annotatable.span(item) }));
    return [item];
  }
  const [vis, sig, primal, generics, is_impl] = info;

  let meta_item_vec: ast.MetaItemInner[];
  if (meta_item.kind.$ === "List") {
    meta_item_vec = meta_item.kind._0.map(ast.clone_MetaItemInner);
  } else {
    dcx.emit_err(diagnostics.AutoDiffMissingConfig_diagnostic({ span: Annotatable.span(item) }));
    return [item];
  }

  const has_ret_ = has_ret(sig.decl.output);

  // create TokenStream from vec elemtents:
  // meta_item doesn't have a .tokens field
  const ts_: TokenTree[] = [];
  if (meta_item_vec.length === 0) {
    // At the bare minimum, we need a fnc name.
    dcx.emit_err(diagnostics.AutoDiffMissingConfig_diagnostic({ span: Annotatable.span(item) }));
    return [item];
  }

  let mode_symbol: Symbol;
  switch (mode) {
    case "Forward":
      mode_symbol = sym.Forward;
      break;
    case "Reverse":
      mode_symbol = sym.Reverse;
      break;
    default:
      return unreachable(`Unsupported mode: ${mode}`);
  }

  // Insert mode token
  const mode_token = token.Token.new({ $: "Ident", _0: mode_symbol, _1: token.IdentKind.Normal }, DUMMY_SP);
  ts_.splice(0, 0, { $: "Token", _0: mode_token, _1: tokenstream.Spacing.Joint });
  ts_.splice(1, 0, { $: "Token", _0: token.Token.new(token.TokenKind.Comma, DUMMY_SP), _1: tokenstream.Spacing.Alone });

  // Now, if the user gave a width (vector aka batch-mode ad), then we copy it.
  // If it is not given, we default to 1 (scalar mode).
  let start_position: number;
  const kind = token.LitKind.Integer;
  let symbol: Symbol;
  const w = meta_item_vec.length >= 2 ? width(meta_item_vec[1]!) : undefined;
  if (w !== undefined) {
    start_position = 2;
    symbol = Symbol.intern(w.toString());
  } else {
    start_position = 1;
    symbol = sym.integer(1);
  }

  const l = new token.Lit(kind, symbol, undefined);
  const t = token.Token.new({ $: "Literal", _0: l }, DUMMY_SP);
  const comma = token.Token.new(token.TokenKind.Comma, DUMMY_SP);
  ts_.push({ $: "Token", _0: t, _1: tokenstream.Spacing.Joint });
  ts_.push({ $: "Token", _0: comma, _1: tokenstream.Spacing.Alone });

  for (const t of meta_item_vec.map(ast.clone_MetaItemInner).slice(start_position)) {
    meta_item_inner_to_ts(t, ts_);
  }

  if (!has_ret_) {
    // We don't want users to provide a return activity if the function doesn't return anything.
    // For simplicity, we just add a dummy token to the end of the list.
    const t = token.Token.new({ $: "Ident", _0: sym.None, _1: token.IdentKind.Normal }, DUMMY_SP);
    ts_.push({ $: "Token", _0: t, _1: tokenstream.Spacing.Joint });
    ts_.push({ $: "Token", _0: comma, _1: tokenstream.Spacing.Alone });
  }
  // We remove the last, trailing comma.
  ts_.pop();
  const ts = tokenstream.TokenStream.from_iter(ts_);

  const x = from_ast(ecx, meta_item_vec, has_ret_, mode);
  if (!x.is_active()) {
    // We encountered an error, so we return the original item.
    // This allows us to potentially parse other attributes.
    return [item];
  }
  const span = ecx.with_def_site_ctxt(expand_span);

  const d_sig = gen_enzyme_decl(ecx, sig, x, span);

  const d_body = ecx.block(span, [call_autodiff(ecx, primal, first_ident(meta_item_vec[0]!), span, sig, d_sig, generics, is_impl)]);

  // The first element of it is the name of the function to be generated
  const d_fn = new ast.Fn(
    ast.Defaultness.Implicit,
    first_ident(meta_item_vec[0]!),
    generics,
    d_sig,
    undefined,
    undefined,
    d_body,
    undefined,
  );
  const rustc_ad_attr = ast.NormalAttr.from_ident(Ident.with_dummy_span(sym.rustc_autodiff));

  const ts2: TokenTree[] = [
    { $: "Token", _0: token.Token.new({ $: "Ident", _0: sym.never, _1: token.IdentKind.Normal }, span), _1: tokenstream.Spacing.Joint },
  ];
  const never_arg = new ast.DelimArgs(tokenstream.DelimSpan.from_single(span), token.Delimiter.Parenthesis, tokenstream.TokenStream.from_iter(ts2));
  const inline_item = new ast.AttrItem(
    ast.Safety.Default,
    ast.Path.from_ident(Ident.with_dummy_span(sym.inline)),
    { $: "Delimited", _0: never_arg },
    DUMMY_SP,
  );
  const inline_never_attr = new ast.NormalAttr(inline_item, undefined);
  let new_id = ecx.sess.psess.attr_id_generator.mk_attr_id();
  const attr = outer_normal_attr(rustc_ad_attr, new_id, span);
  new_id = ecx.sess.psess.attr_id_generator.mk_attr_id();
  const inline_never = outer_normal_attr(inline_never_attr, new_id, span);

  // We're avoid duplicating the attribute `#[rustc_autodiff]`.
  // rustc: compiler/rustc_builtin_macros/src/autodiff.rs:370 same_attribute
  function same_attribute(attr: ast.AttrKind, item: ast.AttrKind): boolean {
    if (attr.$ === "Normal" && item.$ === "Normal") {
      const a = attr._0.item.path;
      const b = item._0.item.path;
      // `a.segments.iter().eq_by(&b.segments, |a, b| a.ident == b.ident)`
      return a.segments.length === b.segments.length && a.segments.every((s, i) => s.ident.eq(b.segments[i]!.ident));
    }
    return false;
  }

  let has_inline_never = false;

  // Don't add it multiple times:
  let orig_annotatable: Annotatable;
  switch (item.$) {
    case "Item": {
      const iitem = item._0;
      if (!iitem.attrs.some((a) => same_attribute(a.kind, attr.kind))) {
        iitem.attrs.push(attr);
      }
      if (iitem.attrs.some((a) => same_attribute(a.kind, inline_never.kind))) {
        has_inline_never = true;
      }
      orig_annotatable = { $: "Item", _0: ast.clone_Item(iitem, ast.clone_ItemKind) };
      break;
    }
    case "AssocItem": {
      const [assoc_item, ctxt] = [item._0, item._1];
      if (!(ctxt.$ === "Impl" || ctxt.$ === "Trait")) return unreachable("annotatable kind checked previously");
      if (!assoc_item.attrs.some((a) => same_attribute(a.kind, attr.kind))) {
        assoc_item.attrs.push(attr);
      }
      if (assoc_item.attrs.some((a) => same_attribute(a.kind, inline_never.kind))) {
        has_inline_never = true;
      }
      orig_annotatable = { $: "AssocItem", _0: ast.clone_Item(assoc_item, ast.clone_AssocItemKind), _1: ctxt };
      break;
    }
    case "Stmt": {
      const stmt = item._0;
      if (stmt.kind.$ === "Item") {
        const iitem = stmt.kind._0;
        if (!iitem.attrs.some((a) => same_attribute(a.kind, attr.kind))) {
          iitem.attrs.push(attr);
        }
        if (iitem.attrs.some((a) => same_attribute(a.kind, inline_never.kind))) {
          has_inline_never = true;
        }
      } else {
        return unreachable("stmt kind checked previously");
      }

      orig_annotatable = { $: "Stmt", _0: ast.clone_Stmt(stmt) };
      break;
    }
    default:
      return unreachable("annotatable kind checked previously");
  }
  // Now update for d_fn
  rustc_ad_attr.item.args = {
    $: "Delimited",
    _0: new ast.DelimArgs(tokenstream.DelimSpan.dummy(), token.Delimiter.Parenthesis, ts),
  };

  new_id = ecx.sess.psess.attr_id_generator.mk_attr_id();
  const d_attr = outer_normal_attr(rustc_ad_attr, new_id, span);

  // If the source function has the `#[inline(never)]` attribute, we'll also add it to the diff function
  const d_attrs = [d_attr];

  if (has_inline_never) {
    d_attrs.push(inline_never);
  }

  let d_annotatable: Annotatable;
  switch (item.$) {
    case "AssocItem": {
      const ctxt = item._1;
      const assoc_item: ast.AssocItemKind = { $: "Fn", _0: d_fn };
      const d_fn_ = new ast.Item<ast.AssocItemKind>(d_attrs, DUMMY_NODE_ID, span, vis, assoc_item, undefined);
      d_annotatable = { $: "AssocItem", _0: d_fn_, _1: ctxt };
      break;
    }
    case "Item": {
      const d_fn_ = ecx.item(span, d_attrs, { $: "Fn", _0: d_fn });
      d_fn_.vis = vis;

      d_annotatable = { $: "Item", _0: d_fn_ };
      break;
    }
    case "Stmt": {
      const d_fn_ = ecx.item(span, d_attrs, { $: "Fn", _0: d_fn });
      d_fn_.vis = vis;
      d_annotatable = { $: "Stmt", _0: ecx.stmt_item(span, d_fn_) };
      break;
    }
    default:
      return unreachable("item kind checked previously");
  }

  return [orig_annotatable, d_annotatable];
}

// shadow arguments (the extra ones which were not in the original (primal) function), in reverse mode must be
// mutable references or ptrs, because Enzyme will write into them.
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:473 assure_mut_ref
function assure_mut_ref(ty_: ast.Ty): ast.Ty {
  const ty = ast.clone_Ty(ty_);
  const k = ty.kind;
  switch (k.$) {
    case "Ptr":
      ty.kind = { $: "Ptr", _0: k._0, _1: ast.Mutability.Mut };
      break;
    case "Ref":
      ty.kind = { $: "Ref", _0: k._0, _1: k._1, _2: ast.Mutability.Mut };
      break;
    default:
      return panic(`unsupported type: ${debug_Ty_str(ty)}`);
  }
  return ty;
}

// Generate `autodiff` intrinsic call
// ```
// std::intrinsics::autodiff(source as fn(..) -> .., diff, (args))
// ```
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:493 call_autodiff
function call_autodiff(
  ecx: ExtCtxt,
  primal: Ident,
  diff: Ident,
  span: Span,
  p_sig: ast.FnSig,
  d_sig: ast.FnSig,
  generics: ast.Generics,
  is_impl: boolean,
): ast.Stmt {
  const primal_path_expr = gen_turbofish_expr(ecx, primal, generics, span, is_impl);

  const self_ty = (): ast.Ty => ecx.ty_path(ast.Path.from_ident(Ident.with_dummy_span(kw.SelfUpper)));
  const fn_ptr_params: ast.Param[] = p_sig.decl.inputs.map((param) => {
    let ty: ast.Ty;
    const k = param.ty.kind;
    if (k.$ === "ImplicitSelf") {
      ty = self_ty();
    } else if (k.$ === "Ref" && k._1.kind.$ === "ImplicitSelf") {
      const [lt, mutbl] = [k._0, k._2];
      ty = ecx.ty(span, { $: "Ref", _0: lt === undefined ? undefined : ast.clone_Lifetime(lt), _1: self_ty(), _2: mutbl });
    } else if (k.$ === "Ptr" && k._0.kind.$ === "ImplicitSelf") {
      const mutbl = k._1;
      ty = ecx.ty(span, { $: "Ptr", _0: self_ty(), _1: mutbl });
    } else {
      ty = ast.clone_Ty(param.ty);
    }
    return new ast.Param([], ty, ecx.pat_wild(span), DUMMY_NODE_ID, span, false);
  });
  const fn_ptr_ty = ecx.ty(span, {
    $: "FnPtr",
    _0: new ast.FnPtrTy(
      ast.clone_Safety(p_sig.header.safety),
      ast.clone_Extern(p_sig.header.ext),
      [],
      new ast.FnDecl(fn_ptr_params, ast.clone_FnRetTy(p_sig.decl.output)),
      span,
    ),
  });
  const primal_fn_ptr = ecx.expr(span, { $: "Cast", _0: primal_path_expr, _1: fn_ptr_ty });

  const diff_path_expr = gen_turbofish_expr(ecx, diff, generics, span, is_impl);

  const tuple_expr = ecx.expr_tuple(
    span,
    d_sig.decl.inputs.map((arg) => {
      const pk = arg.pat.kind;
      if (pk.$ === "Ident") {
        const ident = pk._1;
        return ecx.expr_path(ecx.path_ident(span, ident));
      }
      return panic("not implemented"); // `unimplemented!()`
    }),
  );

  const enzyme_path_idents = ecx.std_path([sym.intrinsics, sym.autodiff]);
  const enzyme_path = ecx.path(span, enzyme_path_idents);
  const call_expr = ecx.expr_call(span, ecx.expr_path(enzyme_path), [primal_fn_ptr, diff_path_expr, tuple_expr]);

  return ecx.stmt_expr(call_expr);
}

// Generate turbofish expression from fn name and generics
// Given `foo` and `<A, B, C>` params, gen `foo::<A, B, C>`
// We use this expression when passing primal and diff function to the autodiff intrinsic
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:579 gen_turbofish_expr
function gen_turbofish_expr(ecx: ExtCtxt, ident: Ident, generics: ast.Generics, span: Span, is_impl: boolean): ast.Expr {
  const generic_args: ast.GenericArg[] = [];
  for (const p of generics.params) {
    switch (p.kind.$) {
      case "Type": {
        const path = ast.Path.from_ident(p.ident);
        const ty = ecx.ty_path(path);
        generic_args.push({ $: "Type", _0: ty });
        break;
      }
      case "Const": {
        const expr = ecx.expr_path(ast.Path.from_ident(p.ident));
        const anon_const: ast.AnonConst = { id: DUMMY_NODE_ID, value: expr };
        generic_args.push({ $: "Const", _0: anon_const });
        break;
      }
      case "Lifetime":
        break;
    }
  }

  const idents = is_impl ? [Ident.new(kw.SelfUpper, span), ident] : [ident];
  const path = ecx.path_all(span, false, idents, generic_args);

  return ecx.expr_path(path);
}

// Generate the new function declaration. Const arguments are kept as is. Duplicated arguments must
// be pointers or references. Those receive a shadow argument, which is a mutable reference/pointer.
// Active arguments must be scalars. Their shadow argument is added to the return type (and will be
// zero-initialized by Enzyme).
// Each argument of the primal function (and the return type if existing) must be annotated with an
// activity.
//
// Error handling: If the user provides an invalid configuration (incorrect numbers, types, or
// both), we emit an error and return the original signature. This allows us to continue parsing.
// FIXME(Sa4dUs): make individual activities' span available so errors
// can point to only the activity instead of the entire attribute
// rustc: compiler/rustc_builtin_macros/src/autodiff.rs:622 gen_enzyme_decl
function gen_enzyme_decl(ecx: ExtCtxt, sig: ast.FnSig, x: RustcAutodiff, span: Span): ast.FnSig {
  const dcx = ecx.sess.dcx();
  const has_ret_ = has_ret(sig.decl.output);
  const sig_args = sig.decl.inputs.length + (has_ret_ ? 1 : 0);
  const num_activities = x.input_activity.length + (x.has_ret_activity() ? 1 : 0);
  if (sig_args !== num_activities) {
    dcx.emit_err(diagnostics.AutoDiffInvalidNumberActivities_diagnostic({ span, expected: sig_args, found: num_activities }));
    // This is not the right signature, but we can continue parsing.
    return ast.clone_FnSig(sig);
  }
  assert(sig.decl.inputs.length === x.input_activity.length, "assertion failed: sig.decl.inputs.len() == x.input_activity.len()");
  assert(has_ret_ === x.has_ret_activity(), "assertion failed: has_ret == x.has_ret_activity()");
  const d_decl = ast.clone_FnDecl(sig.decl);
  const d_inputs: ast.Param[] = [];
  const act_ret: ast.Ty[] = [];

  // We have two loops, a first one just to check the activities and types and possibly report
  // multiple errors in one compilation session.
  let errors = false;
  const n = Math.min(sig.decl.inputs.length, x.input_activity.length);
  for (let i = 0; i < n; i++) {
    const [arg, activity] = [sig.decl.inputs[i]!, x.input_activity[i]!];
    if (!valid_input_activity(x.mode, activity)) {
      dcx.emit_err(
        diagnostics.AutoDiffInvalidApplicationModeAct_diagnostic({
          span,
          mode: display_DiffMode(x.mode),
          act: display_DiffActivity(activity),
        }),
      );
      errors = true;
    }
    if (!valid_ty_for_activity(arg.ty, activity)) {
      dcx.emit_err(diagnostics.AutoDiffInvalidTypeForActivity_diagnostic({ span: arg.ty.span, act: display_DiffActivity(activity) }));
      errors = true;
    }
  }

  if (has_ret_ && !valid_ret_activity(x.mode, x.ret_activity)) {
    dcx.emit_err(
      diagnostics.AutoDiffInvalidRetAct_diagnostic({
        span,
        mode: display_DiffMode(x.mode),
        act: display_DiffActivity(x.ret_activity),
      }),
    );
    // We don't set `errors = true` to avoid annoying type errors relative
    // to the expanded macro type signature
  }

  if (errors) {
    // This is not the right signature, but we can continue parsing.
    return ast.clone_FnSig(sig);
  }

  const unsafe_activities = x.input_activity.some((act) => act.$ === "DuplicatedOnly" || act.$ === "DualOnly");
  for (let i = 0; i < n; i++) {
    const [arg, activity] = [sig.decl.inputs[i]!, x.input_activity[i]!];
    d_inputs.push(ast.clone_Param(arg));
    switch (activity.$) {
      case "Active":
        act_ret.push(ast.clone_Ty(arg.ty));
        // if width =/= 1, then push [arg.ty; width] to act_ret
        break;
      case "ActiveOnly":
        // We will add the active scalar to the return type.
        // This is handled later.
        break;
      case "Duplicated":
      case "DuplicatedOnly":
        for (let i = 0; i < x.width; i++) {
          const shadow_arg = ast.clone_Param(arg);
          // We += into the shadow in reverse mode.
          replace_ty(shadow_arg.ty, assure_mut_ref(arg.ty));
          let old_name: Symbol;
          if (arg.pat.kind.$ === "Ident") {
            old_name = arg.pat.kind._1.name;
          } else {
            // debug!("{:#?}", &shadow_arg.pat);
            return panic("not an ident?");
          }
          const name = `d${Symbol.as_str(old_name)}_${i}`;
          const ident = Ident.from_str_and_span(name, shadow_arg.pat.span);
          replace_pat(shadow_arg.pat, ecx.pat_ident(shadow_arg.pat.span, ident));
          d_inputs.push(shadow_arg);
        }
        break;
      case "Dual":
      case "DualOnly":
      case "Dualv":
      case "DualvOnly": {
        // the *v variants get lowered to enzyme_dupv and enzyme_dupnoneedv, which cause
        // Enzyme to not expect N arguments, but one argument (which is instead larger).
        const iterations = activity.$ === "Dualv" || activity.$ === "DualvOnly" ? 1 : x.width;
        for (let i = 0; i < iterations; i++) {
          const shadow_arg = ast.clone_Param(arg);
          let old_name: Symbol;
          if (arg.pat.kind.$ === "Ident") {
            old_name = arg.pat.kind._1.name;
          } else {
            // debug!("{:#?}", &shadow_arg.pat);
            return panic("not an ident?");
          }
          const name = `b${Symbol.as_str(old_name)}_${i}`;
          const ident = Ident.from_str_and_span(name, shadow_arg.pat.span);

          replace_pat(shadow_arg.pat, ecx.pat_ident(shadow_arg.pat.span, ident));
          d_inputs.push(shadow_arg);
        }
        break;
      }
      case "Const":
        // Nothing to do here.
        break;
      case "None":
      case "FakeActivitySize":
        return panic("Should not happen");
    }
  }

  const active_only_ret = x.ret_activity.$ === "ActiveOnly";
  if (active_only_ret) {
    assert(DiffModeC.is_rev(x.mode), "assertion failed: x.mode.is_rev()");
  }

  // If we return a scalar in the primal and the scalar is active,
  // then add it as last arg to the inputs.
  if (DiffModeC.is_rev(x.mode)) {
    switch (x.ret_activity.$) {
      case "Active":
      case "ActiveOnly": {
        let ty: ast.Ty;
        const out = d_decl.output;
        if (out.$ === "Ty") {
          ty = ast.clone_Ty(out._0);
        } else {
          return panic(`Did not expect Default ret ty: ${debug_Span_str(out._0)}`);
        }
        const name = "dret";
        const ident = Ident.from_str_and_span(name, ty.span);
        const shadow_arg = ecx.param(ty.span, ident, ty);
        d_inputs.push(shadow_arg);
        break;
      }
      default:
    }
  }
  d_decl.inputs = d_inputs;

  if (DiffModeC.is_fwd(x.mode)) {
    let ty: ast.Ty;
    const out = d_decl.output;
    if (out.$ === "Ty") {
      ty = ast.clone_Ty(out._0);
    } else {
      const span = out._0;
      // We want to return std::hint::black_box(()).
      const ty_ = ecx.ty_unit(span);
      d_decl.output = { $: "Ty", _0: ast.clone_Ty(ty_) };
      assert(x.ret_activity.$ === "None", "assertion failed: matches!(x.ret_activity, DiffActivity::None)");
      // this won't be used below, so any type would be fine.
      ty = ty_;
    }

    if (x.ret_activity.$ === "Dual" || x.ret_activity.$ === "Dualv") {
      let kind: ast.TyKind;
      if (x.width === 1 || x.ret_activity.$ === "Dualv") {
        // Dual can only be used for f32/f64 ret.
        // In that case we return now a tuple with two floats.
        kind = { $: "Tup", _0: [ast.clone_Ty(ty), ast.clone_Ty(ty)] };
      } else {
        // We have to return [T; width+1], +1 for the primal return.
        const anon_const: ast.AnonConst = { id: DUMMY_NODE_ID, value: ecx.expr_usize(span, 1 + x.width) };
        kind = { $: "Array", _0: ast.clone_Ty(ty), _1: anon_const };
      }
      const ty_ = new ast.Ty(ty.id, kind, ty.span);
      d_decl.output = { $: "Ty", _0: ty_ };
    }
    if (x.ret_activity.$ === "DualOnly" || x.ret_activity.$ === "DualvOnly") {
      // No need to change the return type,
      // we will just return the shadow in place of the primal return.
      // However, if we have a width > 1, then we don't return -> T, but -> [T; width]
      if (x.width > 1) {
        const anon_const: ast.AnonConst = { id: DUMMY_NODE_ID, value: ecx.expr_usize(span, x.width) };
        const kind: ast.TyKind = { $: "Array", _0: ast.clone_Ty(ty), _1: anon_const };
        const ty_ = new ast.Ty(ty.id, kind, ty.span);
        d_decl.output = { $: "Ty", _0: ty_ };
      }
    }
  }

  // If we use ActiveOnly, drop the original return value.
  d_decl.output = active_only_ret ? { $: "Default", _0: span } : ast.clone_FnRetTy(d_decl.output);

  // trace!("act_ret: {:?}", act_ret);

  // If we have an active input scalar, add it's gradient to the
  // return type. This might require changing the return type to a
  // tuple.
  if (act_ret.length > 0) {
    let ret_ty: ast.Ty;
    const out = d_decl.output;
    if (out.$ === "Ty") {
      const ty = out._0;
      if (!active_only_ret) {
        act_ret.splice(0, 0, ast.clone_Ty(ty));
      }
      const kind: ast.TyKind = { $: "Tup", _0: act_ret };
      ret_ty = new ast.Ty(ty.id, kind, ty.span);
    } else {
      const span = out._0;
      if (act_ret.length === 1) {
        ret_ty = ast.clone_Ty(act_ret[0]!);
      } else {
        const kind: ast.TyKind = { $: "Tup", _0: act_ret };
        ret_ty = new ast.Ty(DUMMY_NODE_ID, kind, span);
      }
    }
    d_decl.output = { $: "Ty", _0: ret_ty };
  }

  const d_header = ast.clone_FnHeader(sig.header);
  if (unsafe_activities) {
    d_header.safety = { $: "Unsafe", _0: span };
  }
  const d_sig = new ast.FnSig(d_header, d_decl, span);
  // trace!("Generated signature: {:?}", d_sig);
  return d_sig;
}

// ---- local helpers ---------------------------------------------------------------------------------

/** PORT: `*shadow_arg.ty = ..` (`P<Ty>` assignment through the box): replace the node in place. */
function replace_ty(dst: ast.Ty, src: ast.Ty): void {
  dst.id = src.id;
  dst.kind = src.kind;
  dst.span = src.span;
}

/** PORT: `*shadow_arg.pat = ..` (`P<Pat>` assignment through the box): replace the node in place. */
function replace_pat(dst: ast.Pat, src: ast.Pat): void {
  Object.assign(dst, src);
}

/** `{:?}` of a `Ty` (for the `panic!` message). */
function debug_Ty_str(ty: ast.Ty): string {
  return ast.debug_Ty(ty, PLAIN);
}

/** `{:?}` of a `Span` (for the `panic!` message). */
function debug_Span_str(sp: Span): string {
  return debug_Span(sp, PLAIN);
}
