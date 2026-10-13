// Port of compiler/rustc_builtin_macros/src/eii.rs
import { ast, token, tokenstream } from "../rustc_ast/lib.ts";
import { path_to_string } from "../rustc_ast_pretty/pprust/mod.ts";
import type { ErrorGuaranteed } from "../rustc_errors/lib.ts";
import type { Annotatable, ExtCtxt } from "../rustc_expand/base.ts";
import { Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import {
  EiiAttributeNotSupported_diagnostic,
  EiiBothDeclAndImpl_diagnostic,
  EiiExternTargetExpectedList_diagnostic,
  EiiExternTargetExpectedMacro_diagnostic,
  EiiExternTargetExpectedUnsafe_diagnostic,
  EiiMacroExpectedMaxOneArgument_diagnostic,
  EiiMultipleImplementations_diagnostic,
  EiiOnlyOnce_diagnostic,
  EiiSharedMacroInStatementPosition_diagnostic,
  EiiSharedMacroTarget_diagnostic,
  EiiStaticArgumentRequired_diagnostic,
  EiiStaticDefaultApple_diagnostic,
  EiiStaticMutable_diagnostic,
} from "./diagnostics.ts";

type Attribute = ast.Attribute;
type ItemKind = ast.ItemKind;
type MetaItem = ast.MetaItem;
type Path = ast.Path;
type Visibility = ast.Visibility;
const { DelimSpacing, DelimSpan, Spacing, TokenStream, TokenTree } = tokenstream;
const { Delimiter, TokenKind } = token;

/// ```rust
/// #[eii]
/// fn panic_handler();
///
/// // or:
///
/// #[eii(panic_handler)]
/// fn panic_handler();
///
/// // expansion:
///
/// extern "Rust" {
///     fn panic_handler();
/// }
///
/// #[rustc_builtin_macro(eii_shared_macro)]
/// #[eii_declaration(panic_handler)]
/// macro panic_handler() {}
/// ```
// rustc: compiler/rustc_builtin_macros/src/eii.rs:38 eii
export function eii(ecx: ExtCtxt, span: Span, meta_item: MetaItem, item: Annotatable): Annotatable[] {
  return eii_(ecx, span, meta_item, item, false);
}

// rustc: compiler/rustc_builtin_macros/src/eii.rs:47 unsafe_eii
export function unsafe_eii(ecx: ExtCtxt, span: Span, meta_item: MetaItem, item: Annotatable): Annotatable[] {
  return eii_(ecx, span, meta_item, item, true);
}

// rustc: compiler/rustc_builtin_macros/src/eii.rs:56 eii_
function eii_(ecx: ExtCtxt, eii_attr_span_: Span, meta_item: MetaItem, orig_item: Annotatable, impl_unsafe: boolean): Annotatable[] {
  const eii_attr_span = ecx.with_def_site_ctxt(eii_attr_span_);

  let item: ast.Item;
  if (orig_item.$ === "Item") {
    item = orig_item._0;
  } else if (orig_item.$ === "Stmt" && orig_item._0.kind.$ === "Item" && orig_item._0.kind._0.kind.$ === "Fn") {
    const item = orig_item._0.kind._0;
    const f = orig_item._0.kind._0.kind._0;
    ecx.dcx().emit_err(
      EiiSharedMacroInStatementPosition_diagnostic({
        span: Span.to(eii_attr_span, item.span),
        name: path_to_string(meta_item.path),
        item_span: f.ident.span,
      }),
    );
    return [orig_item];
  } else {
    ecx.dcx().emit_err(EiiSharedMacroTarget_diagnostic({ span: eii_attr_span, name: path_to_string(meta_item.path) }));
    return [orig_item];
  }

  const { attrs, vis, kind } = item;
  let item_span: Span;
  let foreign_item_name: Ident;
  switch (kind.$) {
    case "Fn": {
      const func = kind._0;
      [item_span, foreign_item_name] = [func.sig.span, func.ident];
      break;
    }
    case "Static": {
      const stat = kind._0;
      // See https://github.com/rust-lang/rust/issues/157649
      const expr = stat.expr;
      if (expr !== undefined && ecx.sess.target.is_like_darwin) {
        ecx.dcx().emit_err(EiiStaticDefaultApple_diagnostic({ span: expr.span, name: path_to_string(meta_item.path) }));
        return [];
      }

      // Statics must have an explicit name for the eii
      if (meta_item.is_word()) {
        ecx.dcx().emit_err(EiiStaticArgumentRequired_diagnostic({ span: eii_attr_span, name: path_to_string(meta_item.path) }));
        return [];
      }

      // Mut statics are currently not supported
      if (stat.mutability === "Mut") {
        ecx.dcx().emit_err(EiiStaticMutable_diagnostic({ span: eii_attr_span, name: path_to_string(meta_item.path) }));
      }

      [item_span, foreign_item_name] = [item.span, stat.ident];
      break;
    }
    default: {
      ecx.dcx().emit_err(EiiSharedMacroTarget_diagnostic({ span: eii_attr_span, name: path_to_string(meta_item.path) }));
      return [{ $: "Item", _0: item }];
    }
  }

  switch (kind.$) {
    case "Fn": {
      const func = kind._0;
      if (func.eii_impl !== undefined) {
        ecx.dcx().emit_err(EiiBothDeclAndImpl_diagnostic({ span: eii_attr_span }));
        return [{ $: "Item", _0: item }];
      }
      break;
    }
    case "Static": {
      const stat = kind._0;
      if (stat.eii_impl !== undefined) {
        ecx.dcx().emit_err(EiiBothDeclAndImpl_diagnostic({ span: eii_attr_span }));
        return [{ $: "Item", _0: item }];
      }
      break;
    }
    default:
      return unreachable("Target was checked earlier");
  }

  // only clone what we need
  const attrs_ = attrs.map(ast.clone_Attribute);
  const vis_ = ast.clone_Visibility(vis);

  const attrs_from_decl = filter_attrs_for_multiple_eii_attr(ecx, attrs_, eii_attr_span, meta_item.path);
  const [macro_attrs, foreign_item_attrs] = split_attrs(ecx, item_span, attrs_from_decl);

  const r = name_for_impl_macro(ecx, foreign_item_name, meta_item);
  if (r.$ === "Err") {
    // we don't need to wrap in Annotatable::Stmt conditionally since
    // EII can't be used on items in statement position
    return [{ $: "Item", _0: item }];
  }
  const macro_name = r._0;

  const module_items: ast.Item[] = [];

  const default_impl = generate_default_impl(ecx, kind, impl_unsafe, macro_name, eii_attr_span, item_span, foreign_item_name);
  if (default_impl !== undefined) {
    module_items.push(default_impl);
  }

  module_items.push(generate_foreign_item(ecx, eii_attr_span, item_span, kind, vis_, foreign_item_attrs));
  module_items.push(generate_attribute_macro_to_implement(ecx, eii_attr_span, macro_name, foreign_item_name, impl_unsafe, macro_attrs));

  // we don't need to wrap in Annotatable::Stmt conditionally since
  // EII can't be used on items in statement position
  return module_items.map((i): Annotatable => ({ $: "Item", _0: i }));
}

// rustc: compiler/rustc_builtin_macros/src/eii.rs:194 split_attrs
function split_attrs(ecx: ExtCtxt, span: Span, attrs: Attribute[]): [Attribute[], Attribute[]] {
  const macro_attributes: Attribute[] = [];
  const foreign_item_attributes: Attribute[] = [];

  for (const attr of attrs) {
    const k = attr.kind;
    switch (k.$) {
      // Forward synthetic CfgTrace and CfgAttrTrace, these are applicable to both foreign item and macro.
      case "Synthetic": {
        // `SyntheticAttr::CfgTrace(_) | SyntheticAttr::CfgAttrTrace(_)`: every variant.
        foreign_item_attributes.push(ast.clone_Attribute(attr));
        macro_attributes.push(attr);
        break;
      }
      // Doc attributes should be forwarded to the macro and the foreign item, since those are
      // the two items you interact with as a user.
      // FIXME: idk yet how EIIs show up in docs, might want to customize
      case "DocComment": {
        foreign_item_attributes.push(ast.clone_Attribute(attr));
        macro_attributes.push(attr);
        break;
      }
      case "Normal": {
        const normal = k._0;
        const name = normal.item.name();
        if (name === sym.lang) {
          // If an eii is marked a lang item, that's because we want to call its declaration, so
          // mark the foreign item as the lang item
          foreign_item_attributes.push(attr);
        } else if (name === sym.deprecated) {
          // Deprecating an eii means deprecating the macro and the foreign item
          foreign_item_attributes.push(ast.clone_Attribute(attr));
          macro_attributes.push(attr);
        } else if (name === sym.stable || name === sym.unstable) {
          // The stability of an EII affects the usage of the macro and calling the foreign item
          foreign_item_attributes.push(ast.clone_Attribute(attr));
          macro_attributes.push(attr);
        } else if (name === sym.track_caller) {
          // `#[track_caller]` goes on the foreign item only: it's the symbol callers link
          // against, so it must carry the flag for call sites to pass the caller location.
          // Implementations derive it during codegen (see `EiiImpls` in `codegen_attrs.rs`),
          // so it must not be routed onto the default impl here.
          foreign_item_attributes.push(attr);
        } else if (name === sym.eii) {
          return unreachable("should already be filtered out");
        } else {
          ecx.dcx().emit_err(EiiAttributeNotSupported_diagnostic({ span, attr_span: attr.span }));
        }
        break;
      }
    }
  }

  return [macro_attributes, foreign_item_attributes];
}

/// Decide on the name of the macro that can be used to implement the EII.
/// This is either an explicitly given name, or the name of the item in the
/// declaration of the EII.
// rustc: compiler/rustc_builtin_macros/src/eii.rs:254 name_for_impl_macro
function name_for_impl_macro(ecx: ExtCtxt, item_ident: Ident, meta_item: MetaItem): Result<Ident, ErrorGuaranteed> {
  if (meta_item.is_word()) {
    return Ok(item_ident);
  }
  const list = meta_item.meta_item_list();
  if (list !== undefined && list.length === 1) {
    const m = ast.MetaItemInner.meta_item(list[0]!);
    if (m !== undefined && m.path.segments.length === 1) {
      return Ok(m.path.segments[0]!.ident);
    }
  }
  return Err(
    ecx.dcx().emit_err(EiiMacroExpectedMaxOneArgument_diagnostic({ span: meta_item.span, name: path_to_string(meta_item.path) })),
  );
}

/// Ensure that in the list of attrs, there's only a single `eii` attribute.
// rustc: compiler/rustc_builtin_macros/src/eii.rs:275 filter_attrs_for_multiple_eii_attr
function filter_attrs_for_multiple_eii_attr(ecx: ExtCtxt, attrs: Attribute[], eii_attr_span: Span, eii_attr_path: Path): Attribute[] {
  return attrs.filter((i) => {
    if (i.has_name(sym.eii)) {
      ecx.dcx().emit_err(EiiOnlyOnce_diagnostic({ span: i.span, first_span: eii_attr_span, name: path_to_string(eii_attr_path) }));
      return false;
    } else {
      return true;
    }
  });
}

// rustc: compiler/rustc_builtin_macros/src/eii.rs:298 generate_default_impl
function generate_default_impl(
  ecx: ExtCtxt,
  item_kind_: ItemKind,
  impl_unsafe: boolean,
  macro_name: Ident,
  eii_attr_span: Span,
  item_span: Span,
  foreign_item_name: Ident,
): ast.Item | undefined {
  const attrs: Attribute[] = [];

  switch (item_kind_.$) {
    case "Fn": {
      const func = item_kind_._0;
      if (func.body === undefined) return undefined;
      break;
    }
    case "Static": {
      const stat = item_kind_._0;
      if (stat.expr === undefined) return undefined;
      break;
    }
    default:
      return unreachable("Target was checked earlier");
  }

  const eii_impl: ast.EiiImpl = {
    node_id: ast.DUMMY_NODE_ID,
    inner_span: macro_name.span,
    eii_macro_path: ast.Path.from_ident(macro_name),
    impl_safety: impl_unsafe ? { $: "Unsafe", _0: eii_attr_span } : ast.Safety.Default,
    span: eii_attr_span,
    is_default: true,
    known_eii_macro_resolution: ecx.path(
      foreign_item_name.span,
      // prefix self to explicitly escape the const block generated below
      // NOTE: this is why EIIs can't be used on statements
      [Ident.new(kw.SelfLower, foreign_item_name.span), foreign_item_name],
    ),
  };

  const item_kind = ast.clone_ItemKind(item_kind_);
  switch (item_kind.$) {
    case "Fn": {
      const func = item_kind._0;
      assert(func.eii_impl === undefined, "assertion failed: func.eii_impl.is_none()");
      func.eii_impl = eii_impl;
      break;
    }
    case "Static": {
      const stat = item_kind._0;
      assert(stat.eii_impl === undefined, "assertion failed: stat.eii_impl.is_none()");
      stat.eii_impl = eii_impl;
      break;
    }
    default:
      return unreachable("Target was checked earlier");
  }

  const anon_mod = (span: Span, stmts: ast.Stmt[]): ast.Item => {
    const unit = ecx.ty(item_span, { $: "Tup", _0: [] });
    const underscore = Ident.new(kw.Underscore, item_span);
    return ecx.item_const(span, underscore, unit, ecx.expr_block(ecx.block(span, stmts)));
  };

  // const _: () = {
  //     <orig item>
  // }
  return anon_mod(item_span, [ecx.stmt_item(item_span, ecx.item(item_span, attrs, item_kind))]);
}

/// Generates a foreign item, like
///
/// ```rust, ignore
/// extern "…" { safe fn item(); }
/// ```
// rustc: compiler/rustc_builtin_macros/src/eii.rs:371 generate_foreign_item
function generate_foreign_item(
  ecx: ExtCtxt,
  eii_attr_span: Span,
  item_span: Span,
  item_kind: ItemKind,
  vis: Visibility,
  attrs_from_decl: Attribute[],
): ast.Item {
  const foreign_item_attrs = attrs_from_decl;

  // Add the rustc_eii_foreign_item on the foreign item. Usually, foreign items are mangled.
  // This attribute makes sure that we later know that this foreign item's symbol should not be.
  foreign_item_attrs.push(ecx.attr_word(sym.rustc_eii_foreign_item, eii_attr_span));

  // We set the abi to the default "rust" abi, which can be overridden by `generate_foreign_func`,
  // if a specific abi was specified on the EII function
  const abi: MutRef<ast.StrLit | undefined> = {
    value: new ast.StrLit(sym.Rust, undefined, sym.Rust, ast.StrStyle.Cooked, eii_attr_span),
  };
  let foreign_kind: ast.ForeignItemKind;
  switch (item_kind.$) {
    case "Fn":
      foreign_kind = generate_foreign_func(ast.clone_Fn(item_kind._0), abi);
      break;
    case "Static":
      foreign_kind = generate_foreign_static(ast.clone_StaticItem(item_kind._0));
      break;
    default:
      return unreachable("Target was checked earlier");
  }

  return ecx.item(eii_attr_span, [], {
    $: "ForeignMod",
    _0: {
      extern_span: eii_attr_span,
      safety: { $: "Unsafe", _0: eii_attr_span },
      abi: abi.value,
      items: [new ast.Item<ast.ForeignItemKind>(foreign_item_attrs, ast.DUMMY_NODE_ID, item_span, vis, foreign_kind, undefined)],
    },
  });
}

// rustc: compiler/rustc_builtin_macros/src/eii.rs:419 generate_foreign_func
function generate_foreign_func(func: ast.Fn, abi: MutRef<ast.StrLit | undefined>): ast.ForeignItemKind {
  const ext = func.sig.header.ext;
  switch (ext.$) {
    // extern "X" fn  =>  extern "X" {}
    case "Explicit":
      abi.value = ext._0;
      break;
    // extern fn  =>  extern {}
    case "Implicit":
      abi.value = undefined;
      break;
    // no abi was specified, so we keep the default
    case "None":
      break;
  }

  // ABI has been moved to the extern {} block, so we remove it from the fn item.
  func.sig.header.ext = ast.Extern.None;
  func.body = undefined;

  // And mark safe functions explicitly as `safe fn`.
  if (func.sig.header.safety.$ === "Default") {
    func.sig.header.safety = { $: "Safe", _0: func.sig.span };
  }

  return { $: "Fn", _0: func };
}

// rustc: compiler/rustc_builtin_macros/src/eii.rs:444 generate_foreign_static
function generate_foreign_static(stat: ast.StaticItem): ast.ForeignItemKind {
  if (stat.safety.$ === "Default") {
    stat.safety = { $: "Safe", _0: stat.ident.span };
  }

  stat.expr = undefined;

  return { $: "Static", _0: stat };
}

/// Generate a stub macro (a bit like in core) that will roughly look like:
///
/// ```rust, ignore, example
/// // Since this a stub macro, the actual code that expands it lives in the compiler.
/// // This attribute tells the compiler that
/// #[builtin_macro(eii_shared_macro)]
/// // the metadata to link this macro to the generated foreign item.
/// #[eii_declaration(<related_foreign_item>)]
/// macro macro_name { () => {} }
/// ```
// rustc: compiler/rustc_builtin_macros/src/eii.rs:464 generate_attribute_macro_to_implement
function generate_attribute_macro_to_implement(
  ecx: ExtCtxt,
  span: Span,
  macro_name: Ident,
  foreign_item_name: Ident,
  impl_unsafe: boolean,
  attrs_from_decl: Attribute[],
): ast.Item {
  const macro_attrs = attrs_from_decl;

  // Avoid "missing stability attribute" errors for eiis in std. See #146993.
  macro_attrs.push(ecx.attr_name_value_str(sym.rustc_macro_transparency, sym.semiopaque, span));

  // #[builtin_macro(eii_shared_macro)]
  macro_attrs.push(ecx.attr_nested_word(sym.rustc_builtin_macro, sym.eii_shared_macro, span));

  // cant use ecx methods here to construct item since we need it to be public
  return new ast.Item(
    macro_attrs,
    ast.DUMMY_NODE_ID,
    span,
    // pub
    { span, kind: ast.VisibilityKind.Public },
    {
      $: "MacroDef",
      // macro macro_name
      _0: macro_name,
      _1: {
        // { () => {} }
        body: new ast.DelimArgs(
          DelimSpan.from_single(span),
          Delimiter.Brace,
          TokenStream.new([
            {
              $: "Delimited",
              _0: DelimSpan.from_single(span),
              _1: DelimSpacing.new(Spacing.Alone, Spacing.Alone),
              _2: Delimiter.Parenthesis,
              _3: TokenStream.default(),
            },
            TokenTree.token_alone(TokenKind.FatArrow, span),
            {
              $: "Delimited",
              _0: DelimSpan.from_single(span),
              _1: DelimSpacing.new(Spacing.Alone, Spacing.Alone),
              _2: Delimiter.Brace,
              _3: TokenStream.default(),
            },
          ]),
        ),
        macro_rules: false,
        // #[eii_declaration(foreign_item_ident)]
        eii_declaration: { foreign_item: ast.Path.from_ident(foreign_item_name), impl_unsafe },
      },
    },
    undefined,
  );
}

// rustc: compiler/rustc_builtin_macros/src/eii.rs:523 eii_declaration
export function eii_declaration(ecx: ExtCtxt, span: Span, meta_item: MetaItem, item: Annotatable): Annotatable[] {
  let i: ast.Item;
  if (item.$ === "Item") {
    i = item._0;
  } else if (item.$ === "Stmt" && item._0.kind.$ === "Item") {
    i = item._0.kind._0;
  } else {
    ecx.dcx().emit_err(EiiExternTargetExpectedMacro_diagnostic({ span }));
    return [item];
  }

  if (i.kind.$ !== "MacroDef") {
    ecx.dcx().emit_err(EiiExternTargetExpectedMacro_diagnostic({ span }));
    return [item];
  }
  const d = i.kind._1;

  const list = meta_item.meta_item_list();
  if (list === undefined) {
    ecx.dcx().emit_err(EiiExternTargetExpectedList_diagnostic({ span: meta_item.span }));
    return [item];
  }

  if (list.length > 2) {
    ecx.dcx().emit_err(EiiExternTargetExpectedList_diagnostic({ span: meta_item.span }));
    return [item];
  }

  const first = list[0] === undefined ? undefined : ast.MetaItemInner.meta_item(list[0]);
  const extern_item_path = first === undefined ? undefined : ast.clone_Path(first.path);
  if (extern_item_path === undefined) {
    ecx.dcx().emit_err(EiiExternTargetExpectedList_diagnostic({ span: meta_item.span }));
    return [item];
  }

  let impl_unsafe: boolean;
  const i1 = list[1];
  if (i1 !== undefined) {
    const lit = ast.MetaItemInner.lit(i1);
    const s = lit === undefined ? undefined : ast.LitKind.str(lit.kind);
    if (s !== undefined && s === kw.Unsafe) {
      impl_unsafe = true;
    } else {
      ecx.dcx().emit_err(EiiExternTargetExpectedUnsafe_diagnostic({ span: ast.MetaItemInner.span(i1) }));
      return [item];
    }
  } else {
    impl_unsafe = false;
  }

  d.eii_declaration = { foreign_item: extern_item_path, impl_unsafe };

  // Return the original item and the new methods.
  return [item];
}

/// all Eiis share this function as the implementation for their attribute.
// rustc: compiler/rustc_builtin_macros/src/eii.rs:579 eii_shared_macro
export function eii_shared_macro(ecx: ExtCtxt, span: Span, meta_item: MetaItem, item: Annotatable): Annotatable[] {
  let i: ast.Item;
  if (item.$ === "Item") {
    i = item._0;
  } else if (item.$ === "Stmt" && item._0.kind.$ === "Item") {
    i = item._0.kind._0;
  } else {
    ecx.dcx().emit_err(EiiSharedMacroTarget_diagnostic({ span, name: path_to_string(meta_item.path) }));
    return [item];
  }

  // PORT: `&mut func.eii_impl` / `&mut stat.eii_impl`: the node owning the field.
  let eii_impl: { eii_impl: ast.EiiImpl | undefined };
  switch (i.kind.$) {
    case "Fn":
      eii_impl = i.kind._0;
      break;
    case "Static":
      eii_impl = i.kind._0;
      break;
    default: {
      ecx.dcx().emit_err(EiiSharedMacroTarget_diagnostic({ span, name: path_to_string(meta_item.path) }));
      return [item];
    }
  }

  let is_default: boolean;
  if (meta_item.is_word()) {
    is_default = false;
  } else {
    const list = meta_item.meta_item_list();
    const m = list !== undefined && list.length === 1 ? ast.MetaItemInner.meta_item(list[0]!) : undefined;
    if (m !== undefined && m.path.segments.length === 1) {
      is_default = m.path.segments[0]!.ident.name === kw.Default;
    } else {
      ecx.dcx().emit_err(EiiMacroExpectedMaxOneArgument_diagnostic({ span: meta_item.span, name: path_to_string(meta_item.path) }));
      return [item];
    }
  }

  if (eii_impl.eii_impl !== undefined) {
    ecx.dcx().emit_err(EiiMultipleImplementations_diagnostic({ span }));
  }
  eii_impl.eii_impl = {
    node_id: ast.DUMMY_NODE_ID,
    inner_span: meta_item.path.span,
    eii_macro_path: ast.clone_Path(meta_item.path),
    impl_safety: ast.clone_Safety(meta_item.unsafety),
    span,
    is_default,
    known_eii_macro_resolution: undefined,
  };

  return [item];
}
