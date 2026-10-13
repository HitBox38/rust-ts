// Port of compiler/rustc_builtin_macros/src/deriving/default.rs
import { attr, visit } from "../../rustc_ast/lib.ts";
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { DummyResult, type ExtCtxt } from "../../rustc_expand/base.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import { ast, BlockOrExpr, combine_substructure, MethodDef, TraitDef } from "./generic/mod.ts";
import { new_path } from "./mod.ts";

// rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:14 expand_deriving_default
export function expand_deriving_default(cx: ExtCtxt, span: Span, item: ast.Item, push: (item: ast.Item) => void, is_const: boolean): void {
  new DetectNonVariantDefaultAttr(cx).visit_item(item);

  const trait_def = new TraitDef(
    span,
    new_path(cx, span, [kw.Default, sym.Default], []),
    has_a_default_variant(item),
    false,
    [],
    false,
    [
      new MethodDef(
        kw.Default,
        cx.empty_generics(span),
        false,
        [],
        false,
        cx.ty_self(span),
        [cx.attr_word(sym.inline, span)],
        "Default",
        combine_substructure((cx, trait_span, substr) => {
          const fields = substr.fields;
          switch (fields.$) {
            case "StaticStruct":
              return default_struct_substructure(cx, trait_span, fields._0, substr.type_ident);
            case "StaticEnum":
              return default_enum_substructure(cx, trait_span, fields._0, item.span);
            default:
              return cx.dcx().span_bug(trait_span, "unexpected substructure in `derive(Default)`");
          }
        }),
      ),
    ],
    is_const,
    ast.Safety.Default,
    true,
  );
  trait_def.expand(cx, item, push);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:60 default_call
function default_call(cx: ExtCtxt, span: Span): ast.Expr {
  // Note that `kw::Default` is "default" and `sym::Default` is "Default"!
  const default_ident = cx.std_path([kw.Default, sym.Default, kw.Default]);
  return cx.expr_call_global(span, default_ident, []);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:66 default_struct_substructure
function default_struct_substructure(cx: ExtCtxt, trait_span: Span, variant_data: ast.VariantData, type_ident: Ident): BlockOrExpr {
  let expr: ast.Expr;
  switch (variant_data.$) {
    case "Unit":
      expr = cx.expr_ident(trait_span, type_ident);
      break;
    case "Tuple": {
      const fields = variant_data._0;
      const exprs = fields.map((field) => default_call(cx, Span.with_ctxt(field.span, Span.ctxt(trait_span))));
      expr = cx.expr_call_ident(trait_span, type_ident, exprs);
      break;
    }
    case "Struct": {
      const fields = variant_data.fields;
      const default_fields = fields.map((field) => {
        const span = Span.with_ctxt(field.span, Span.ctxt(trait_span));
        let value: ast.Expr;
        const default_val = field.default_value();
        if (default_val !== undefined) {
          // We use the field default const expression.
          value = cx.expr(default_val.value.span, { $: "ConstBlock", _0: ast.clone_AnonConst(default_val) });
        } else {
          // We use `Default::default()`.
          value = default_call(cx, span);
        }
        return cx.field_imm(span, unwrap(field.ident), value);
      });
      expr = cx.expr_struct_ident(trait_span, type_ident, default_fields);
      break;
    }
  }
  return BlockOrExpr.new_expr(expr);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:105 default_enum_substructure
function default_enum_substructure(cx: ExtCtxt, trait_span: Span, enum_def: ast.EnumDef, item_span: Span): BlockOrExpr {
  // PORT: the `try { .. }` block -> an immediately invoked function with explicit `?` checks.
  const r = ((): Result<ast.Variant, ErrorGuaranteed> => {
    const default_variant = extract_default_variant(cx, enum_def, trait_span, item_span);
    if (default_variant.$ === "Err") return default_variant;
    const v = validate_default_attribute(cx, default_variant._0);
    if (v.$ === "Err") return v;
    return Ok(default_variant._0);
  })();
  let expr: ast.Expr;
  if (r.$ === "Ok") {
    const default_variant = r._0;
    // We now know there is exactly one unit variant with exactly one `#[default]` attribute.
    const data = default_variant.data;
    switch (data.$) {
      case "Unit":
        expr = cx.expr_path(cx.path(default_variant.span, [Ident.new(kw.SelfUpper, default_variant.span), default_variant.ident]));
        break;
      case "Struct": {
        const fields = data.fields;
        // This only happens if `#![feature(default_field_values)]`. We have validated
        // all fields have default values in the definition.
        const default_fields = fields.map((field) => {
          const val = field.default_value();
          return cx.field_imm(
            field.span,
            unwrap(field.ident),
            val === undefined
              ? // We use `Default::default()`.
                default_call(cx, field.span)
              : // We use the field default const expression.
                cx.expr(val.value.span, { $: "ConstBlock", _0: ast.clone_AnonConst(val) }),
          );
        });
        const path = cx.path(default_variant.span, [Ident.new(kw.SelfUpper, default_variant.span), default_variant.ident]);
        expr = cx.expr_struct(default_variant.span, path, default_fields);
        break;
      }
      // Logic error in `extract_default_variant`.
      case "Tuple":
        return cx.dcx().bug("encountered tuple variant annotated with `#[default]`");
    }
  } else {
    const guar = r._0;
    expr = DummyResult.raw_expr(trait_span, guar);
  }
  return BlockOrExpr.new_expr(expr);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:164 extract_default_variant
function extract_default_variant(cx: ExtCtxt, enum_def: ast.EnumDef, trait_span: Span, item_span: Span): Result<ast.Variant, ErrorGuaranteed> {
  const default_variants: ast.Variant[] = enum_def.variants.filter((variant) => attr.contains_name(variant.attrs, kw.Default));

  let variant: ast.Variant;
  if (default_variants.length === 1) {
    variant = default_variants[0]!;
  } else if (default_variants.length === 0) {
    const possible_defaults = enum_def.variants
      .filter((variant) => variant.data.$ === "Unit")
      .filter((variant) => !attr.contains_name(variant.attrs, sym.non_exhaustive));

    const suggs = possible_defaults.map((v): diagnostics.NoDefaultVariantSugg => ({ span: Span.shrink_to_lo(v.span) }));
    const guar = cx.dcx().emit_err(
      diagnostics.NoDefaultVariant_diagnostic({
        span: trait_span,
        item_span,
        suggs,
      }),
    );

    return Err(guar);
  } else {
    const [first, ...rest] = default_variants as [ast.Variant, ...ast.Variant[]];
    const suggs: diagnostics.MultipleDefaultsSugg[] = [];
    for (const variant of default_variants) {
      const a = attr.find_by_name(variant.attrs, kw.Default);
      if (a === undefined) continue;
      const keep = a.span;
      const spans: Span[] = default_variants.flatMap((v) =>
        [...attr.filter_by_name(v.attrs, kw.Default)].flatMap((attr) => (attr.span !== keep ? [attr.span] : [])),
      );
      if (spans.length !== 0) {
        suggs.push({
          spans,
          ident: variant.ident,
        });
      }
    }
    const guar = cx.dcx().emit_err(
      diagnostics.MultipleDefaults_diagnostic({
        span: trait_span,
        first: first.span,
        additional: rest.map((v) => v.span),
        suggs,
      }),
    );
    return Err(guar);
  }

  const data = variant.data;
  if (
    cx.ecfg.features.default_field_values() &&
    data.$ === "Struct" &&
    data.fields.every((f) => f.default_value() !== undefined) &&
    // Disallow `#[default] Variant {}`
    data.fields.length !== 0
  ) {
    // Allowed
  } else if (!(variant.data.$ === "Unit")) {
    const post = cx.ecfg.features.default_field_values() ? " or variants where every field has a default value" : "";
    const guar = cx.dcx().emit_err(diagnostics.NonUnitDefault_diagnostic({ span: variant.ident.span, post }));
    return Err(guar);
  }

  const non_exhaustive_attr = attr.find_by_name(variant.attrs, sym.non_exhaustive);
  if (non_exhaustive_attr !== undefined) {
    const guar = cx.dcx().emit_err(
      diagnostics.NonExhaustiveDefault_diagnostic({
        span: variant.ident.span,
        non_exhaustive: non_exhaustive_attr.span,
      }),
    );

    return Err(guar);
  }

  return Ok(variant);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:254 validate_default_attribute
function validate_default_attribute(cx: ExtCtxt, default_variant: ast.Variant): Result<null, ErrorGuaranteed> {
  const attrs: ast.Attribute[] = [...attr.filter_by_name(default_variant.attrs, kw.Default)];

  let attr_: ast.Attribute;
  if (attrs.length === 1) {
    attr_ = attrs[0]!;
  } else if (attrs.length === 0) {
    return cx.dcx().bug("this method must only be called with a variant that has a `#[default]` attribute");
  } else {
    const [first, ...rest] = attrs as [ast.Attribute, ...ast.Attribute[]];
    const sugg: diagnostics.MultipleDefaultAttrsSugg = {
      spans: rest.map((attr) => attr.span),
    };
    const guar = cx.dcx().emit_err(
      diagnostics.MultipleDefaultAttrs_diagnostic({
        span: default_variant.ident.span,
        first: first.span,
        first_rest: rest[0]!.span,
        rest: MultiSpan.from_Vec(rest.map((attr) => attr.span)),
        only_one: rest.length === 1,
        sugg,
      }),
    );

    return Err(guar);
  }
  if (!attr_.is_word()) {
    const guar = cx.dcx().emit_err(diagnostics.DefaultHasArg_diagnostic({ span: attr_.span }));

    return Err(guar);
  }
  return Ok(null);
}

class DetectNonVariantDefaultAttr extends visit.Visitor {
  constructor(public cx: ExtCtxt) {
    super();
  }

  // rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:295 visit_attribute
  override visit_attribute(attr: ast.Attribute): undefined {
    if (attr.has_name(kw.Default)) {
      const post = this.cx.ecfg.features.default_field_values() ? " or variants where every field has a default value" : "";
      this.cx.dcx().emit_err(diagnostics.NonUnitDefault_diagnostic({ span: attr.span, post }));
    }

    visit.walk_attribute(this, attr);
    return undefined;
  }
  // rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:307 visit_variant
  override visit_variant(v: ast.Variant): undefined {
    this.visit_ident(v.ident);
    this.visit_vis(v.vis);
    this.visit_variant_data(v.data);
    if (v.disr_expr !== undefined) this.visit_anon_const(v.disr_expr);
    for (const attr of v.attrs) {
      visit.walk_attribute(this, attr);
    }
    return undefined;
  }
}

// rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:318 has_a_default_variant
function has_a_default_variant(item: ast.Item): boolean {
  // PORT: the fn-local `struct HasDefaultAttrOnVariant` and its `impl Visitor` -> a local subclass.
  class HasDefaultAttrOnVariant extends visit.Visitor<ControlFlow<null>> {
    override Result = VisitorResult.ControlFlow<null>();
    // rustc: compiler/rustc_builtin_macros/src/deriving/default.rs:323 visit_variant
    override visit_variant(v: ast.Variant): ControlFlow<null> {
      if (v.attrs.some((attr) => attr.has_name(kw.Default))) {
        return ControlFlow.Break(null);
      } else {
        // no need to walk the variant, we are only looking for top level variants
        return ControlFlow.CONTINUE;
      }
    }
  }

  return new HasDefaultAttrOnVariant().visit_item(item).$ === "Break";
}
