// Port of compiler/rustc_builtin_macros/src/deriving/debug.rs
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import { FmtDebug } from "../../rustc_session/config.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { assert, unwrap } from "../../std/panic.ts";
import { ast, BlockOrExpr, combine_substructure, type FieldInfo, MethodDef, type Substructure, TraitDef } from "./generic/mod.ts";
import { path_std } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/debug.rs:10 expand_deriving_debug
export function expand_deriving_debug(cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
  // &mut ::std::fmt::Formatter
  const fmtr = cx.ty_ref(span, cx.ty_path(path_std(cx, span, [sym.fmt, sym.Formatter])), undefined, "Mut");

  const trait_def = new TraitDef(
    span,
    path_std(cx, span, [sym.fmt, sym.Debug]),
    false,
    true,
    [],
    false,
    [
      new MethodDef(
        sym.fmt,
        cx.empty_generics(span),
        true,
        [[fmtr, sym.character(0x66 /* 'f' */)]],
        false,
        cx.ty_path(path_std(cx, span, [sym.fmt, sym.Result])),
        [cx.attr_word(sym.inline, span)],
        "SpecializeIfAllVariantsFieldless",
        combine_substructure((cx, span, substr) => show_substructure(cx, span, substr, unwrap(ast.ItemKind.ident(item.kind)))),
      ),
    ],
    is_const,
    ast.Safety.Default,
    true,
  );
  trait_def.expand(cx, item, push);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/debug.rs:56 formatter_ident
function formatter_ident(cx: ExtCtxt, span: Span): ast.Expr {
  return cx.expr_ident_sym(span, sym.character(0x66 /* 'f' */));
}

// rustc: compiler/rustc_builtin_macros/src/deriving/debug.rs:60 show_substructure
function show_substructure(cx: ExtCtxt, span: Span, substr: Substructure, type_ident: Ident): BlockOrExpr {
  const fmt_detail = cx.sess.opts.unstable_opts.fmt_debug;
  if (fmt_detail === FmtDebug.None) {
    return BlockOrExpr.new_expr(cx.expr_ok(span, cx.expr_tuple(span, [])));
  }

  let ident: Ident;
  let vdata: ast.VariantData;
  let fields: FieldInfo[];
  const f = substr.fields;
  switch (f.$) {
    case "Struct":
      [ident, vdata, fields] = [type_ident, f._0, f._1];
      break;
    case "EnumMatching":
      [ident, vdata, fields] = [f._0.ident, f._0.data, f._1];
      break;
    case "AllFieldlessEnum":
      return show_fieldless_enum(cx, span, f._0, type_ident);
    default:
      return cx.dcx().span_bug(span, "unexpected substructure in `derive(Debug)`");
  }

  const name = cx.expr_str(span, ident.name);
  const fmt = formatter_ident(cx, span);

  // Fieldless enums have been special-cased earlier
  if (fmt_detail === FmtDebug.Shallow) {
    const fn_path_write_str = cx.std_path([sym.fmt, sym.Formatter, sym.write_str]);
    const expr = cx.expr_call_global(span, fn_path_write_str, [fmt, name]);
    return BlockOrExpr.new_expr(expr);
  }

  // Struct and tuples are similar enough that we use the same code for both,
  // with some extra pieces for structs due to the field names.
  let is_struct: boolean;
  let args_per_field: number;
  switch (vdata.$) {
    case "Unit":
      // Special fast path for unit variants.
      assert(fields.length === 0, "assertion failed: fields.is_empty()");
      [is_struct, args_per_field] = [false, 0];
      break;
    case "Tuple":
      [is_struct, args_per_field] = [false, 1];
      break;
    case "Struct":
      [is_struct, args_per_field] = [true, 2];
      break;
  }
  void args_per_field; // PORT: only a `with_capacity` hint upstream.

  // The number of fields that can be handled without an array.
  const CUTOFF = 5;

  const len = fields.length;
  const expr_for_field = (field: FieldInfo, index: number): ast.Expr => {
    if (index < len - 1) {
      return field.self_expr;
    } else {
      // Unsized types need an extra indirection, but only the last field
      // may be unsized.
      return cx.expr_addr_of(field.span, field.self_expr);
    }
  };

  if (fields.length === 0) {
    // Special case for no fields.
    const fn_path_write_str = cx.std_path([sym.fmt, sym.Formatter, sym.write_str]);
    const expr = cx.expr_call_global(span, fn_path_write_str, [fmt, name]);
    return BlockOrExpr.new_expr(expr);
  } else if (fields.length <= CUTOFF) {
    // Few enough fields that we can use a specific-length method.
    const debug = is_struct ? `debug_struct_field${fields.length}_finish` : `debug_tuple_field${fields.length}_finish`;
    const fn_path_debug = cx.std_path([sym.fmt, sym.Formatter, Symbol.intern(debug)]);

    const args: ast.Expr[] = [];
    args.push(fmt, name);
    for (const [i, field_] of fields.entries()) {
      if (is_struct) {
        const name = cx.expr_str(field_.span, unwrap(field_.name).name);
        args.push(name);
      }

      const field = expr_for_field(field_, i);
      args.push(field);
    }
    const expr = cx.expr_call_global(span, fn_path_debug, args);
    return BlockOrExpr.new_expr(expr);
  } else {
    // Enough fields that we must use the any-length method.
    const name_exprs: ast.Expr[] = [];
    const value_exprs: ast.Expr[] = [];

    for (const [i, field_] of fields.entries()) {
      if (is_struct) {
        name_exprs.push(cx.expr_str(field_.span, unwrap(field_.name).name));
      }

      const field = expr_for_field(field_, i);
      value_exprs.push(field);
    }

    // `let names: &'static _ = &["field1", "field2"];`
    const names_let = is_struct
      ? (() => {
          const lt_static = cx.lifetime_static(span);
          const ty_static_ref = cx.ty_ref(span, cx.ty_infer(span), lt_static, "Not");
          return cx.stmt_let_ty(span, false, Ident.new(sym.names, span), ty_static_ref, cx.expr_array_ref(span, name_exprs));
        })()
      : undefined;

    // `let values: &[&dyn Debug] = &[&&self.field1, &&self.field2];`
    const path_debug = cx.path_global(span, cx.std_path([sym.fmt, sym.Debug]));
    const ty_dyn_debug = cx.ty(span, { $: "TraitObject", _0: [cx.trait_bound(path_debug, false)], _1: "Dyn" });
    const ty_slice = cx.ty(span, { $: "Slice", _0: cx.ty_ref(span, ty_dyn_debug, undefined, "Not") });
    const values_let = cx.stmt_let_ty(
      span,
      false,
      Ident.new(sym.values, span),
      cx.ty_ref(span, ty_slice, undefined, "Not"),
      cx.expr_array_ref(span, value_exprs),
    );

    // `fmt::Formatter::debug_struct_fields_finish(fmt, name, names, values)` or
    // `fmt::Formatter::debug_tuple_fields_finish(fmt, name, values)`
    const sym_debug = is_struct ? sym.debug_struct_fields_finish : sym.debug_tuple_fields_finish;
    const fn_path_debug_internal = cx.std_path([sym.fmt, sym.Formatter, sym_debug]);

    const args: ast.Expr[] = [];
    args.push(fmt);
    args.push(name);
    if (is_struct) {
      args.push(cx.expr_ident_sym(span, sym.names));
    }
    args.push(cx.expr_ident_sym(span, sym.values));
    const expr = cx.expr_call_global(span, fn_path_debug_internal, args);

    const stmts: ast.Stmt[] = [];
    if (is_struct) {
      stmts.push(unwrap(names_let));
    }
    stmts.push(values_let);
    return BlockOrExpr.new_mixed(stmts, expr);
  }
}

/// Special case for enums with no fields. Builds:
/// ```text
/// impl ::core::fmt::Debug for A {
///     fn fmt(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
///          ::core::fmt::Formatter::write_str(f,
///             match self {
///                 A::A => "A",
///                 A::B() => "B",
///                 A::C {} => "C",
///             })
///     }
/// }
/// ```
// rustc: compiler/rustc_builtin_macros/src/deriving/debug.rs:229 show_fieldless_enum
function show_fieldless_enum(cx: ExtCtxt, span: Span, def: ast.EnumDef, type_ident: Ident): BlockOrExpr {
  const fmt = formatter_ident(cx, span);
  const arms = def.variants.map((v) => {
    const variant_path = cx.path(span, [type_ident, v.ident]);
    let pat: ast.Pat;
    switch (v.data.$) {
      case "Tuple":
        // debug_assert!(fields.is_empty());
        pat = cx.pat_tuple_struct(span, variant_path, []);
        break;
      case "Struct":
        // debug_assert!(fields.is_empty());
        pat = cx.pat_struct(span, variant_path, []);
        break;
      case "Unit":
        pat = cx.pat_path(span, variant_path);
        break;
    }
    return cx.arm(span, pat, cx.expr_str(span, v.ident.name));
  });
  const name = cx.expr_match(span, cx.expr_self(span), arms);
  const fn_path_write_str = cx.std_path([sym.fmt, sym.Formatter, sym.write_str]);
  return BlockOrExpr.new_expr(cx.expr_call_global(span, fn_path_write_str, [fmt, name]));
}
