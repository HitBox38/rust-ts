// Port of compiler/rustc_parse/src/parser/item.rs
// Types (`ReuseKind`, `IsMacroRulesItem`, `UsePathList`) are generated into item.gen.ts.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { ast, token, tokenstream } from "../../rustc_ast/lib.ts";
import type {
  AnonConst,
  AssocItem,
  AssocItemKind,
  AttrVec,
  Attribute,
  Block,
  ConstBlockItem,
  Crate,
  Defaultness,
  DelimArgs,
  Expr,
  FieldDef,
  FieldDefExtras,
  ForeignItem,
  ForeignItemKind,
  Generics,
  ImplPolarity,
  Item,
  ItemKind,
  MacCall,
  ModSpans,
  MutRestriction,
  Mutability,
  Path,
  PathSegment,
  Safety,
  TestBinderBody,
  TestBinderBoundTypeConstraint,
  TestBinderConstraint,
  TestBinderConstraints,
  TestBinderExists,
  TestBinderForall,
  Ty,
  UseTree,
  UseTreeAndId,
  UseTreeKind,
  Variant,
  VariantData,
  Visibility,
} from "../../rustc_ast/lib.ts";
import { HasAttrs, HasTokens } from "../../rustc_ast/lib.ts";
import type { Token } from "../../rustc_ast/token.ts";
import type { TokenTree } from "../../rustc_ast/tokenstream.ts";
import { Case } from "../../rustc_ast/util/case.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { type Diag, E0197, E0584, msg, type PResult, StashKey, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { edit_distance } from "../../rustc_span/edit_distance.ts";
import { Edition, Edition_discriminant } from "../../rustc_span/edition.ts";
import type { MutRef } from "../../rustc_span/hygiene.ts";
import { BytePos, DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { display_Ident, Ident, kw, sym, Symbol, used_keywords } from "../../rustc_span/symbol.ts";
import { is_whitespace } from "../../std/char.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import type { AttrWrapper, UsePreAttrPos } from "./attr_wrapper.ts";
import { ConsumeClosingDelim, type SnapshotParser } from "./diagnostics.ts";
import { type FnParseMode, IsDotDotDot } from "./function.ts";
import { type IsMacroRulesItem, type ReuseKind, type UsePathList } from "./item.gen.ts";
import {
  AllowConstBlockItems,
  type ExpTokenPair,
  FollowedByType,
  ForceCollect,
  Parser,
  Trailing,
  token_descr,
} from "./mod.ts";
import { PathStyle } from "./path.ts";
import { exp } from "./token_type.ts";

export * from "./item.gen.ts";

const DUMMY_NODE_ID = ast.DUMMY_NODE_ID;
const TokenKind = token.TokenKind;

// PORT: `ast::Generics::default()` (`#[derive(Default)]`; `WhereClause` too), as in
// rustc_ast_pretty/pprust/state/item.ts.
function generics_default(): Generics {
  return {
    params: [],
    where_clause: where_clause_default(),
    span: DUMMY_SP,
  };
}

// PORT: `ast::WhereClause::default()` (`#[derive(Default)]`).
function where_clause_default(): ast.WhereClause {
  return new ast.WhereClause(false, [], DUMMY_SP);
}

/// Parses a source module as a crate. This is the main entry point for the parser.
// rustc: compiler/rustc_parse/src/parser/item.rs:31 parse_crate_mod
Parser.prototype.parse_crate_mod = function (this: Parser): PResult<Crate> {
  const r = this.parse_mod(exp.Eof);
  if (r.$ === "Err") return r;
  const [attrs, items, spans] = r._0;
  return Ok({ attrs, items, spans, id: DUMMY_NODE_ID, is_placeholder: false });
};

/// Parses a `mod <foo> { ... }` or `mod <foo>;` item.
// rustc: compiler/rustc_parse/src/parser/item.rs:37 parse_item_mod
Parser.prototype.parse_item_mod = function (this: Parser, attrs: AttrVec): PResult<ItemKind> {
  const safety = this.parse_safety(Case.Sensitive);
  const r = this.expect_keyword(exp.Mod);
  if (r.$ === "Err") return r;
  const r2 = this.parse_ident();
  if (r2.$ === "Err") return r2;
  const ident = r2._0;
  let mod_kind: ast.ModKind;
  if (this.eat(exp.Semi)) {
    mod_kind = ast.ModKind.Unloaded;
  } else {
    const r3 = this.expect(exp.OpenBrace);
    if (r3.$ === "Err") return r3;
    const r4 = this.parse_mod(exp.CloseBrace);
    if (r4.$ === "Err") return r4;
    const [inner_attrs, items, inner_span] = r4._0;
    attrs.push(...inner_attrs);
    mod_kind = { $: "Loaded", _0: items, _1: ast.Inline.Yes, _2: inner_span };
  }
  return Ok({ $: "Mod", _0: safety, _1: ident, _2: mod_kind });
};

/// Parses the contents of a module (inner attributes followed by module items).
/// We exit once we hit `term` which can be either
/// - EOF (for files)
/// - `}` for mod items
// rustc: compiler/rustc_parse/src/parser/item.rs:56 parse_mod
Parser.prototype.parse_mod = function (this: Parser, term: ExpTokenPair): PResult<[AttrVec, Item[], ModSpans]> {
  const lo = this.token.span;
  const r = this.parse_inner_attributes();
  if (r.$ === "Err") return r;
  const attrs = r._0;

  const post_attr_lo = this.token.span;
  const items: Item[] = [];

  // There shouldn't be any stray semicolons before or after items.
  // `parse_item` consumes the appropriate semicolons so any leftover is an error.
  for (;;) {
    while (this.maybe_consume_incorrect_semicolon(items[items.length - 1])) {} // Eat all bad semicolons
    const r2 = this.parse_item(ForceCollect.No, AllowConstBlockItems.Yes);
    if (r2.$ === "Err") return r2;
    const item = r2._0;
    if (item === undefined) {
      break;
    }
    items.push(item);
  }

  if (!this.eat(term)) {
    const token_str = token_descr(this.token);
    if (!this.maybe_consume_incorrect_semicolon(items[items.length - 1])) {
      const is_let = this.token.is_keyword(kw.Let);
      const is_let_mut = is_let && this.look_ahead(1, (t) => t.is_keyword(kw.Mut));
      const let_has_ident = is_let && !is_let_mut && this.is_kw_followed_by_ident(kw.Let);

      const msg_ = `expected item, found ${token_str}`;
      const err = this.dcx().struct_span_err(this.token.span, msg_);

      const label = is_let ? "`let` cannot be used for global variables" : "expected item";
      err.span_label(this.token.span, label);

      if (is_let) {
        if (is_let_mut) {
          err.help("consider using `static` and a `Mutex` instead of `let mut`");
        } else if (let_has_ident) {
          err.span_suggestion_short(
            this.token.span,
            "consider using `static` or `const` instead of `let`",
            "static",
            Applicability.MaybeIncorrect,
          );
        } else {
          err.help("consider using `static` or `const` instead of `let`");
        }
      }
      err.note(
        "for a full list of items that can appear in modules, see <https://doc.rust-lang.org/reference/items.html>",
      );
      return Err(err);
    }
  }

  const inject_use_span = Span.data(post_attr_lo).with_hi(Span.lo(post_attr_lo));
  const mod_spans: ModSpans = { inner_span: Span.to(lo, this.prev_token.span), inject_use_span };
  return Ok([attrs, items, mod_spans]);
};

// (`enum ReuseKind` is generated.)

// rustc: compiler/rustc_parse/src/parser/item.rs:124 parse_item
Parser.prototype.parse_item = function (
  this: Parser,
  force_collect: ForceCollect,
  allow_const_block_items: AllowConstBlockItems,
): PResult<Item | undefined> {
  const fn_parse_mode: FnParseMode = { req_name: (_, __) => true, context: "Free", req_body: true };
  return this.parse_item_(fn_parse_mode, force_collect, allow_const_block_items);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:135 parse_item_
Parser.prototype.parse_item_ = function (
  this: Parser,
  fn_parse_mode: FnParseMode,
  force_collect: ForceCollect,
  const_block_items_allowed: AllowConstBlockItems,
): PResult<Item | undefined> {
  this.recover_vcs_conflict_marker();
  const r = this.parse_outer_attributes();
  if (r.$ === "Err") return r;
  const attrs = r._0;
  this.recover_vcs_conflict_marker();
  return this.parse_item_common(attrs, true, false, fn_parse_mode, force_collect, const_block_items_allowed);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:154 parse_item_common
Parser.prototype.parse_item_common = function (
  this: Parser,
  attrs: AttrWrapper,
  mac_allowed: boolean,
  attrs_allowed: boolean,
  fn_parse_mode: FnParseMode,
  force_collect: ForceCollect,
  allow_const_block_items: AllowConstBlockItems,
): PResult<Item | undefined> {
  // PORT: `eat_metavar_seq` returns `Option<Option<Box<Item>>>` here; the inner option is boxed in
  // `{ _0 }` so that `Some(None)` still reaches the `expect` below (decls: `T` is never undefined).
  const item = this.eat_metavar_seq(token.MetaVarKind.Item, (this_) => {
    const r = this_.parse_item(ForceCollect.Yes, allow_const_block_items);
    if (r.$ === "Err") return r;
    return Ok({ _0: r._0 });
  });
  if (item !== undefined) {
    const item_ = unwrap(item._0, "an actual item");
    attrs.prepend_to_nt_inner(item_.attrs);
    return Ok(item_);
  }

  return this.collect_tokens(
    undefined,
    attrs,
    force_collect,
    (this_, attrs) => {
      const lo = this_.token.span;
      const r = this_.parse_visibility(FollowedByType.No);
      if (r.$ === "Err") return r;
      const vis = r._0;
      const def: MutRef<Defaultness> = { value: this_.parse_defaultness() };
      const r2 = this_.parse_item_kind(
        attrs,
        mac_allowed,
        allow_const_block_items,
        lo,
        vis,
        def,
        fn_parse_mode,
        Case.Sensitive,
      );
      if (r2.$ === "Err") return r2;
      const kind = r2._0;
      if (kind !== undefined) {
        this_.error_on_unconsumed_default(def.value, kind);
        const span = Span.to(lo, this_.prev_token.span);
        const id = DUMMY_NODE_ID;
        const item = new ast.Item<ItemKind>(attrs, id, span, vis, kind, undefined);
        return Ok([item, Trailing.No, "No" as UsePreAttrPos]);
      }

      // At this point, we have failed to parse an item.
      if (!(vis.kind.$ === "Inherited")) {
        const vis_str = pprust.vis_to_string(vis).trimEnd();
        const err = this_.dcx().create_err(
          diagnostics.VisibilityNotFollowedByItem_diagnostic({ span: vis.span, vis: vis_str }),
        );
        const tok_ident = this_.token.ident();
        if (tok_ident !== undefined) {
          const [ident, _] = tok_ident;
          if (!ident.is_used_keyword()) {
            const similar = Symbol.find_similar(
              ident.name,
              used_keywords(() => Span.edition(ident.span)),
            );
            if (similar !== undefined) {
              const [similar_kw, is_incorrect_case] = similar;
              err.subdiagnostic(
                diagnostics.MisspelledKw_subdiagnostic({
                  similar_kw: Symbol.as_str(similar_kw),
                  span: ident.span,
                  is_incorrect_case,
                }),
              );
            }
          }
        }
        err.emit();
      }

      const def_ = def.value;
      if (def_.$ === "Default") {
        const span = def_._0;
        this_.dcx().emit_err(diagnostics.DefaultNotFollowedByItem_diagnostic({ span }));
      } else if (def_.$ === "Final") {
        const span = def_._0;
        this_.dcx().emit_err(diagnostics.FinalNotFollowedByItem_diagnostic({ span }));
      }

      if (!attrs_allowed) {
        const r3 = this_.recover_attrs_no_item(attrs);
        if (r3.$ === "Err") return r3;
      }
      return Ok([undefined, Trailing.No, "No" as UsePreAttrPos]);
    },
    HasTokens.Option(HasTokens.Item),
    HasAttrs.Option(HasAttrs.Item),
  );
};

/// Error in-case `default`/`final` was parsed in an in-appropriate context.
// rustc: compiler/rustc_parse/src/parser/item.rs:229 error_on_unconsumed_default
Parser.prototype.error_on_unconsumed_default = function (this: Parser, def: Defaultness, kind: ItemKind): void {
  switch (def.$) {
    case "Default": {
      const span = def._0;
      this.dcx().emit_err(
        diagnostics.InappropriateDefault_diagnostic({
          span,
          article: ast.ItemKind.article(kind),
          descr: ast.ItemKind.descr(kind),
        }),
      );
      break;
    }
    case "Final": {
      const span = def._0;
      this.dcx().emit_err(
        diagnostics.InappropriateFinal_diagnostic({
          span,
          article: ast.ItemKind.article(kind),
          descr: ast.ItemKind.descr(kind),
        }),
      );
      break;
    }
    case "Implicit":
      break;
  }
};

/// Parses one of the items allowed by the flags.
// rustc: compiler/rustc_parse/src/parser/item.rs:250 parse_item_kind
Parser.prototype.parse_item_kind = function (
  this: Parser,
  attrs: AttrVec,
  macros_allowed: boolean,
  allow_const_block_items: AllowConstBlockItems,
  lo: Span,
  vis: Visibility,
  def: MutRef<Defaultness>,
  fn_parse_mode: FnParseMode,
  case_: Case,
): PResult<ItemKind | undefined> {
  const check_pub = def.value.$ === "Implicit";
  // `mem::replace(def, Defaultness::Implicit)`
  const def_ = (): Defaultness => {
    const v = def.value;
    def.value = ast.Defaultness.Implicit;
    return v;
  };

  let info: ItemKind;
  let const_span: Span | undefined;
  let is_reuse: ReuseKind | undefined;
  let is_macro_rules: IsMacroRulesItem | undefined;
  let static_safety: Safety | undefined;
  if (!this.is_use_closure() && this.eat_keyword_case(exp.Use, case_)) {
    const r = this.parse_use_item();
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.check_fn_front_matter(check_pub, case_)) {
    // FUNCTION ITEM
    const defaultness = def_();
    if (defaultness.$ === "Default") {
      const span = defaultness._0;
      // Default functions should only require feature `min_specialization`. We remove the
      // `specialization` tag again as such spans *require* feature `specialization` to be
      // enabled. In a later stage, we make `specialization` imply `min_specialization`.
      this.psess.gated_spans.gate(sym.min_specialization, span);
      this.psess.gated_spans.ungate_last(sym.specialization, span);
    }
    const r = this.parse_fn(attrs, fn_parse_mode, lo, vis, case_);
    if (r.$ === "Err") return r;
    const [ident, sig, generics, contract, body] = r._0;
    info = {
      $: "Fn",
      _0: new ast.Fn(defaultness, ident, generics, sig, contract, undefined, body, undefined),
    };
  } else if (this.eat_keyword_case(exp.Extern, case_)) {
    if (this.eat_keyword_case(exp.Crate, case_)) {
      // EXTERN CRATE
      const r = this.parse_item_extern_crate();
      if (r.$ === "Err") return r;
      info = r._0;
    } else {
      // EXTERN BLOCK
      const r = this.parse_item_foreign_mod(attrs, ast.Safety.Default);
      if (r.$ === "Err") return r;
      info = r._0;
    }
  } else if (this.is_unsafe_foreign_mod()) {
    // EXTERN BLOCK
    const safety = this.parse_safety(Case.Sensitive);
    const r = this.expect_keyword(exp.Extern);
    if (r.$ === "Err") return r;
    const r2 = this.parse_item_foreign_mod(attrs, safety);
    if (r2.$ === "Err") return r2;
    info = r2._0;
  } else if ((static_safety = this.parse_global_static_front_matter(case_)) !== undefined) {
    // STATIC ITEM
    const safety = static_safety;
    const mutability = this.parse_mutability();
    const r = this.parse_static_item(safety, mutability);
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.check_keyword_case(exp.Trait, case_) || this.check_trait_front_matter()) {
    // TRAIT ITEM
    const r = this.parse_item_trait(attrs, lo);
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.check_impl_frontmatter(0)) {
    // IMPL ITEM
    const r = this.parse_item_impl(attrs, def_(), false);
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (
    (allow_const_block_items === AllowConstBlockItems.Yes ||
      allow_const_block_items === AllowConstBlockItems.DoesNotMatter) &&
    this.check_inline_const(0)
  ) {
    // CONST BLOCK ITEM
    if (allow_const_block_items === AllowConstBlockItems.DoesNotMatter) {
      // debug!("Parsing a const block item that does not matter: {:?}", self.token.span);
    }
    const r = this.parse_const_block_item();
    if (r.$ === "Err") return r;
    info = { $: "ConstBlock", _0: r._0 };
  } else if ((const_span = const_yes_span(this.parse_constness(case_))) !== undefined) {
    // CONST ITEM
    this.recover_const_mut(const_span);
    const r = this.recover_missing_kw_before_item();
    if (r.$ === "Err") return r;
    const r2 = this.parse_const_item(const_span);
    if (r2.$ === "Err") return r2;
    const [ident, generics, ty, body] = r2._0;
    info = {
      $: "Const",
      _0: {
        defaultness: def_(),
        ident,
        generics,
        ty,
        body,
        define_opaque: undefined,
      },
    };
  } else if ((is_reuse = this.is_reuse_item()) !== undefined) {
    const kind = is_reuse;
    const r = this.parse_item_delegation(attrs, def_(), kind);
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (
    this.check_keyword_case(exp.Mod, case_) ||
    (this.check_keyword_case(exp.Unsafe, case_) && this.is_keyword_ahead(1, [kw.Mod]))
  ) {
    // MODULE ITEM
    const r = this.parse_item_mod(attrs);
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.eat_keyword_case(exp.Type, case_)) {
    // TYPE ITEM
    const r = this.parse_type_alias(def_());
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.eat_keyword_case(exp.Enum, case_)) {
    // ENUM ITEM
    const r = this.parse_item_enum();
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.eat_keyword_case(exp.Struct, case_)) {
    // STRUCT ITEM
    const r = this.parse_item_struct();
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.is_kw_followed_by_ident(kw.Union)) {
    // UNION ITEM
    this.bump(); // `union`
    const r = this.parse_item_union();
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (this.is_builtin()) {
    // BUILTIN# ITEM
    return this.parse_item_builtin();
  } else if (this.eat_keyword_case(exp.Macro, case_)) {
    // MACROS 2.0 ITEM
    const r = this.parse_item_decl_macro(lo);
    if (r.$ === "Err") return r;
    info = r._0;
  } else if ((is_macro_rules = this.is_macro_rules_item()).$ === "Yes") {
    // MACRO_RULES ITEM
    const has_bang = is_macro_rules.has_bang;
    const r = this.parse_item_macro_rules(vis, has_bang);
    if (r.$ === "Err") return r;
    info = r._0;
  } else if (
    this.isnt_macro_invocation() &&
    (this.token.is_ident_named(sym.import) ||
      this.token.is_ident_named(sym.using) ||
      this.token.is_ident_named(sym.include) ||
      this.token.is_ident_named(sym.require))
  ) {
    return this.recover_import_as_use();
  } else if (this.isnt_macro_invocation() && ast.VisibilityKind.is_pub(vis.kind)) {
    const r = this.recover_missing_kw_before_item();
    if (r.$ === "Err") return r;
    return Ok(undefined);
  } else if (this.isnt_macro_invocation() && case_ === Case.Sensitive) {
    // `_ = def_;`

    // Recover wrong cased keywords
    return this.parse_item_kind(
      attrs,
      macros_allowed,
      allow_const_block_items,
      lo,
      vis,
      def,
      fn_parse_mode,
      Case.Insensitive,
    );
  } else if (macros_allowed && this.check_path()) {
    // Detect `field_name: Type` or `self: Type` inside a trait body and emit
    // a clearer diagnostic before falling through to the macro invocation path.
    const is_field_in_trait =
      fn_parse_mode.context === "Trait" &&
      this.token.is_path_start() &&
      this.look_ahead(1, (t) => t.kind.$ === "Colon");
    if (is_field_in_trait) {
      return this.recover_field_in_trait();
    }
    if (this.isnt_macro_invocation()) {
      const r = this.recover_missing_kw_before_item();
      if (r.$ === "Err") return r;
    }
    // MACRO INVOCATION ITEM
    const r = this.parse_item_macro(vis);
    if (r.$ === "Err") return r;
    info = { $: "MacCall", _0: r._0 };
  } else {
    return Ok(undefined);
  }
  return Ok(info);
};

// PORT: `if let Const::Yes(const_span) = ..` in an `else if` chain.
function const_yes_span(c: ast.Const): Span | undefined {
  return c.$ === "Yes" ? c._0 : undefined;
}

// rustc: compiler/rustc_parse/src/parser/item.rs:406 recover_import_as_use
Parser.prototype.recover_import_as_use = function (this: Parser): PResult<ItemKind | undefined> {
  const span = this.token.span;
  const token_name = token_descr(this.token);
  const snapshot = this.create_snapshot_for_diagnostic();
  this.bump();
  const r = this.parse_use_item();
  switch (r.$) {
    case "Ok": {
      const u = r._0;
      this.dcx().emit_err(diagnostics.RecoverImportAsUse_diagnostic({ span, token_name }));
      return Ok(u);
    }
    case "Err": {
      const e = r._0;
      e.cancel();
      this.restore_snapshot(snapshot);
      return Ok(undefined);
    }
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:424 recover_field_in_trait
Parser.prototype.recover_field_in_trait = function (this: Parser): PResult<ItemKind | undefined> {
  const ident_span = this.token.span;
  const ident_str = pprust.token_to_string(this.token);
  const is_self = this.token.is_keyword(kw.SelfLower);

  this.bump(); // identifier or `self`
  this.bump(); // `:`

  let ty_str: string;
  const r = this.parse_ty();
  switch (r.$) {
    case "Ok":
      ty_str = pprust.ty_to_string(r._0);
      break;
    case "Err": {
      const e = r._0;
      e.cancel();
      ty_str = "Type";
      break;
    }
  }
  // Eat the trailing separator so the parser doesn't trip over it.
  this.eat(exp.Comma);
  this.eat(exp.Semi);

  const span = Span.to(ident_span, this.prev_token.span);
  const sugg: diagnostics.FieldNotAllowedInTraitSugg = is_self
    ? { $: "SelfReceiver", ty: ty_str }
    : { $: "Method", ident: ident_str, ty: ty_str };
  const err = this.dcx().create_err(diagnostics.FieldNotAllowedInTrait_diagnostic({ span, sugg }));
  return Err(err);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:453 parse_use_item
Parser.prototype.parse_use_item = function (this: Parser): PResult<ItemKind> {
  const use_token_span = this.prev_token.span;
  const r = this.parse_use_tree(use_token_span, undefined);
  if (r.$ === "Err") return r;
  const tree = r._0;
  const r2 = this.expect_semi();
  if (r2.$ === "Err") {
    const e = r2._0;
    switch (tree.kind.$) {
      case "Glob":
        e.note("the wildcard token must be last on the path");
        break;
      case "Nested":
        e.note("glob-like brace syntax must be last on the path");
        break;
      default:
        break;
    }
    return Err(e);
  }
  return Ok({ $: "Use", _0: tree });
};

/// When parsing a statement, would the start of a path be an item?
// rustc: compiler/rustc_parse/src/parser/item.rs:472 is_path_start_item
Parser.prototype.is_path_start_item = function (this: Parser): boolean {
  return (
    this.is_kw_followed_by_ident(kw.Union) || // no: `union::b`, yes: `union U { .. }`
    this.is_reuse_item() !== undefined || // yes: `reuse impl Trait for Struct { self.0 }`, yes: `reuse some_path::foo;`
    this.check_trait_front_matter() || // no: `auto::b`, yes: `auto trait X { .. }`
    this.is_async_fn() || // no(2015): `async::b`, yes: `async fn`
    this.is_macro_rules_item().$ === "Yes" // no: `macro_rules::b`, yes: `macro_rules! mac`
  );
};

// rustc: compiler/rustc_parse/src/parser/item.rs:480 is_reuse_item
Parser.prototype.is_reuse_item = function (this: Parser): ReuseKind | undefined {
  if (!this.token.is_keyword(kw.Reuse)) {
    return undefined;
  }

  // no: `reuse ::path` for compatibility reasons with macro invocations
  if (this.look_ahead(1, (t) => t.is_path_start() && !t.eq(TokenKind.PathSep))) {
    return "Path";
  } else if (this.check_impl_frontmatter(1)) {
    return "Impl";
  } else {
    return undefined;
  }
};

/// Are we sure this could not possibly be a macro invocation?
// rustc: compiler/rustc_parse/src/parser/item.rs:496 isnt_macro_invocation
Parser.prototype.isnt_macro_invocation = function (this: Parser): boolean {
  return this.check_ident() && this.look_ahead(1, (t) => !t.eq(TokenKind.Bang) && !t.eq(TokenKind.PathSep));
};

/// Recover on encountering a struct, enum, or method definition where the user
/// forgot to add the `struct`, `enum`, or `fn` keyword
// rustc: compiler/rustc_parse/src/parser/item.rs:502 recover_missing_kw_before_item
Parser.prototype.recover_missing_kw_before_item = function (this: Parser): PResult<undefined> {
  const is_pub = this.prev_token.is_keyword(kw.Pub);
  const is_const = this.prev_token.is_keyword(kw.Const);
  const ident_span = this.token.span;
  const span = is_pub ? Span.to(this.prev_token.span, ident_span) : ident_span;
  const insert_span = Span.shrink_to_lo(ident_span);

  let ident: Ident;
  if (
    this.token.is_ident() &&
    (!is_const || this.look_ahead(1, (t) => t.eq(TokenKind.OpenParen))) &&
    this.look_ahead(1, (t) => t.kind.$ === "Lt" || t.kind.$ === "OpenBrace" || t.kind.$ === "OpenParen")
  ) {
    ident = unwrap_result(this.parse_ident_common(true));
  } else {
    return Ok(undefined);
  }

  let found_generics = false;
  if (this.check(exp.Lt)) {
    found_generics = true;
    this.eat_to_tokens([exp.Gt]);
    this.bump(); // `>`
  }

  let err: diagnostics.MissingKeywordForItemDefinition | undefined;
  if (this.check(exp.OpenBrace)) {
    // possible struct or enum definition where `struct` or `enum` was forgotten
    if (this.look_ahead(1, (t) => t.eq(TokenKind.CloseBrace))) {
      // `S {}` could be unit enum or struct
      err = { $: "EnumOrStruct", span };
    } else if (this.look_ahead(2, (t) => t.eq(TokenKind.Colon)) || this.look_ahead(3, (t) => t.eq(TokenKind.Colon))) {
      // `S { f:` or `S { pub f:`
      err = { $: "Struct", span, insert_span, ident };
    } else {
      err = { $: "Enum", span, insert_span, ident };
    }
  } else if (this.check(exp.OpenParen)) {
    // possible function or tuple struct definition where `fn` or `struct` was forgotten
    this.bump(); // `(`
    const is_method = this.recover_self_param();

    this.consume_block(exp.OpenParen, exp.CloseParen, ConsumeClosingDelim.Yes);

    let err_: diagnostics.MissingKeywordForItemDefinition;
    if (this.check(exp.RArrow) || this.check(exp.OpenBrace)) {
      this.eat_to_tokens([exp.OpenBrace]);
      this.bump(); // `{`
      this.consume_block(exp.OpenBrace, exp.CloseBrace, ConsumeClosingDelim.Yes);
      if (is_method) {
        err_ = { $: "Method", span, insert_span, ident };
      } else {
        err_ = { $: "Function", span, insert_span, ident };
      }
    } else if (is_pub && this.check(exp.Semi)) {
      err_ = { $: "Struct", span, insert_span, ident };
    } else {
      let subdiag: diagnostics.AmbiguousMissingKwForItemSub | undefined;
      if (found_generics) {
        subdiag = undefined;
      } else {
        const snippet = this.span_to_snippet(ident_span);
        if (snippet.$ === "Ok") {
          subdiag = { $: "SuggestMacro", span: ident_span, snippet: snippet._0 };
        } else {
          subdiag = diagnostics.AmbiguousMissingKwForItemSub.HelpMacro;
        }
      }
      err_ = { $: "Ambiguous", span, subdiag };
    }
    err = err_;
  } else if (found_generics) {
    err = { $: "Ambiguous", span, subdiag: undefined };
  } else {
    err = undefined;
  }

  if (err !== undefined) {
    return Err(this.dcx().create_err(diagnostics.MissingKeywordForItemDefinition_diagnostic(err)));
  } else {
    return Ok(undefined);
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:598 parse_item_builtin
Parser.prototype.parse_item_builtin = function (this: Parser): PResult<ItemKind | undefined> {
  // To be expanded
  return Ok(undefined);
};

/// Parses an item macro, e.g., `item!();`.
// rustc: compiler/rustc_parse/src/parser/item.rs:604 parse_item_macro
Parser.prototype.parse_item_macro = function (this: Parser, vis: Visibility): PResult<MacCall> {
  const r = this.parse_path(PathStyle.Mod); // `foo::bar`
  if (r.$ === "Err") return r;
  const path = r._0;
  const r2 = this.expect(exp.Bang); // `!`
  if (r2.$ === "Err") return r2;
  const r3 = this.parse_delim_args();
  switch (r3.$) {
    // `( .. )` or `[ .. ]` (followed by `;`), or `{ .. }`.
    case "Ok": {
      const args = r3._0;
      this.eat_semi_for_macro_if_needed(args, path);
      this.complain_if_pub_macro(vis, false);
      return Ok(new ast.MacCall(path, args));
    }

    case "Err": {
      const err = r3._0;
      // Maybe the user misspelled `macro_rules` (issue #91227)
      if (
        this.token.is_ident() &&
        path.segments.length === 1 &&
        edit_distance("macro_rules", display_Ident(path.segments[0]!.ident), 2) !== undefined
      ) {
        err.span_suggestion_verbose(
          path.span,
          "perhaps you meant to define a macro",
          "macro_rules",
          Applicability.MachineApplicable,
        );
      }
      return Err(err);
    }
  }
};

/// Recover if we parsed attributes and expected an item but there was none.
// rustc: compiler/rustc_parse/src/parser/item.rs:634 recover_attrs_no_item
Parser.prototype.recover_attrs_no_item = function (this: Parser, attrs: readonly Attribute[]): PResult<undefined> {
  if (attrs.length === 0) {
    return Ok(undefined);
  }
  const start = attrs[0]!;
  const end = attrs[attrs.length - 1]!;
  const msg_ = end.is_doc_comment() ? "expected item after doc comment" : "expected item after attributes";
  const err = this.dcx().struct_span_err(end.span, msg_);
  if (end.is_doc_comment()) {
    err.span_label(end.span, "this doc comment doesn't document anything");
  } else {
    err.span_label(end.span, "expected an item after this");
    if (this.token.eq(TokenKind.Semi)) {
      err.span_suggestion_verbose(
        this.token.span,
        "remove the semicolon after the attribute",
        "",
        Applicability.MaybeIncorrect,
      );
    }
  }
  if (attrs.length >= 2) {
    const penultimate = attrs[attrs.length - 2]!;
    err.span_label(Span.to(start.span, penultimate.span), "other attributes here");
  }
  return Err(err);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:663 is_async_fn
Parser.prototype.is_async_fn = function (this: Parser): boolean {
  return this.token.is_keyword(kw.Async) && this.is_keyword_ahead(1, [kw.Fn]);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:667 parse_polarity
Parser.prototype.parse_polarity = function (this: Parser): ImplPolarity {
  // Disambiguate `impl !Trait for Type { ... }` and `impl ! { ... }` for the never type.
  if (this.check(exp.Bang) && this.look_ahead(1, (t) => t.can_begin_type())) {
    this.psess.gated_spans.gate(sym.negative_impls, this.token.span);
    this.bump(); // `!`
    return { $: "Negative", _0: this.prev_token.span };
  } else {
    return ast.ImplPolarity.Positive;
  }
};

/// Parses an implementation item.
///
/// ```ignore (illustrative)
/// impl<'a, T> TYPE { /* impl items */ }
/// impl<'a, T> TRAIT for TYPE { /* impl items */ }
/// impl<'a, T> !TRAIT for TYPE { /* impl items */ }
/// impl<'a, T> const TRAIT for TYPE { /* impl items */ }
/// ```
///
/// We actually parse slightly more relaxed grammar for better error reporting and recovery.
/// ```ebnf
/// "impl" GENERICS "const"? "!"? TYPE "for"? (TYPE | "..") ("where" PREDICATES)? "{" BODY "}"
/// "impl" GENERICS "const"? "!"? TYPE ("where" PREDICATES)? "{" BODY "}"
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:692 parse_item_impl
Parser.prototype.parse_item_impl = function (
  this: Parser,
  attrs: AttrVec,
  defaultness: Defaultness,
  is_reuse: boolean,
): PResult<ItemKind> {
  const constness = this.parse_constness(Case.Sensitive);
  const safety = this.parse_safety(Case.Sensitive);
  const r0 = this.expect_keyword(exp.Impl);
  if (r0.$ === "Err") return r0;
  let generics_snapshot: SnapshotParser | undefined = undefined;
  // First, parse generic parameters if necessary.
  let generics: Generics;
  if (this.choose_generics_over_qpath(0)) {
    const r = this.parse_generics();
    if (r.$ === "Err") return r;
    generics = r._0;
  } else {
    // We might be mistakenly trying to use a generic type as a generic parameter.
    // impl<X<T>> Trait for Y<T> { ... }
    if (
      this.look_ahead(0, (t) => t.eq(TokenKind.Lt)) &&
      this.look_ahead(1, (t) => t.is_ident()) &&
      this.look_ahead(2, (t) => t.eq(TokenKind.Lt))
    ) {
      generics_snapshot = this.create_snapshot_for_diagnostic();
    }

    const generics_ = generics_default();
    // impl A for B {}
    //    /\ this is where `generics.span` should point when there are no type params.
    generics_.span = Span.shrink_to_hi(this.prev_token.span);
    generics = generics_;
  }

  if (constness.$ === "Yes") {
    const span = constness._0;
    this.psess.gated_spans.gate(sym.const_trait_impl, span);
  }

  // Parse stray `impl async Trait`
  if (
    (Span.at_least_rust_2018(this.token_uninterpolated_span()) && this.token.is_keyword(kw.Async)) ||
    this.is_kw_followed_by_ident(kw.Async)
  ) {
    this.bump();
    this.dcx().emit_err(diagnostics.AsyncImpl_diagnostic({ span: this.prev_token.span }));
  }

  const polarity = this.parse_polarity();

  // Parse both types and traits as a type, then reinterpret if necessary.
  let ty_first: Ty;
  if (this.token.is_keyword(kw.For) && this.look_ahead(1, (t) => !t.eq(TokenKind.Lt))) {
    const span = Span.between(this.prev_token.span, this.token.span);
    return Err(
      this.dcx().create_err(
        diagnostics.MissingTraitInTraitImpl_diagnostic({
          span,
          for_span: Span.to(span, this.token.span),
        }),
      ),
    );
  } else {
    const r = this.parse_ty_with_generics_recovery(generics);
    if (r.$ === "Err") {
      const e = r._0;
      if (generics_snapshot === undefined) {
        return Err(e);
      }
      const snapshot = generics_snapshot;
      return Err(snapshot.parser.maybe_type_in_generic_parameter(e));
    }
    ty_first = r._0;
  }
  // If `for` is missing we try to recover.
  const has_for = this.eat_keyword(exp.For);
  const missing_for_span = Span.between(this.prev_token.span, this.token.span);

  let ty_second: Ty | undefined;
  if (this.token.eq(TokenKind.DotDot)) {
    // We need to report this error after `cfg` expansion for compatibility reasons
    this.bump(); // `..`, do not add it to expected tokens

    // AST validation later detects this `TyKind::Dummy` and emits an
    // error. (#121072 will hopefully remove all this special handling
    // of the obsolete `impl Trait for ..` and then this can go away.)
    ty_second = this.mk_ty(this.prev_token.span, ast.TyKind.Dummy);
  } else if (has_for || this.token.can_begin_type()) {
    const r = this.parse_ty();
    if (r.$ === "Err") return r;
    ty_second = r._0;
  } else {
    ty_second = undefined;
  }

  const r1 = this.parse_where_clause();
  if (r1.$ === "Err") return r1;
  generics.where_clause = r1._0;

  let impl_items: AssocItem[];
  if (is_reuse) {
    impl_items = [];
  } else {
    const r = this.parse_item_list<AssocItem>(attrs, (p) => p.parse_impl_item(ForceCollect.No));
    if (r.$ === "Err") return r;
    impl_items = r._0;
  }

  let of_trait: ast.TraitImplHeader | undefined;
  let self_ty: Ty;
  if (ty_second !== undefined) {
    // impl Trait for Type
    if (!has_for) {
      this.dcx().emit_err(diagnostics.MissingForInTraitImpl_diagnostic({ span: missing_for_span }));
    }

    let path: Path;
    const k = ty_first.kind;
    if (k.$ === "Path" && k._0 === undefined) {
      // This notably includes paths passed through `ty` macro fragments (#46438).
      path = k._1;
    } else {
      const other = k;
      if (other.$ === "ImplTrait" && other._1.length === 1 && other._1[0]!.$ === "Trait") {
        const bound = other._1[0]!;
        const poly_trait_ref = bound._0;
        // Suggest removing extra `impl` keyword:
        // `impl<T: Default> impl Default for Wrapper<T>`
        //                   ^^^^^
        const extra_impl_kw = Span.until(ty_first.span, ast.GenericBound.span(bound));
        this.dcx().emit_err(
          diagnostics.ExtraImplKeywordInTraitImpl_diagnostic({
            extra_impl_kw,
            impl_trait_span: ty_first.span,
          }),
        );
        path = ast.clone_Path(poly_trait_ref.trait_ref.path);
      } else {
        return Err(
          this.dcx().create_err(diagnostics.ExpectedTraitInTraitImplFoundType_diagnostic({ span: ty_first.span })),
        );
      }
    }
    const trait_ref: ast.TraitRef = { path, ref_id: ty_first.id };

    of_trait = { defaultness, safety, polarity, trait_ref };
    self_ty = ty_second;
  } else {
    const self_ty_ = ty_first;
    const error = (modifier: string, modifier_name: string, modifier_span: Span): Diag => {
      return this.dcx().create_err(
        diagnostics.TraitImplModifierInInherentImpl_diagnostic({
          span: self_ty_.span,
          modifier,
          modifier_name,
          modifier_span,
          self_ty: self_ty_.span,
        }),
      );
    };

    if (safety.$ === "Unsafe") {
      const span = safety._0;
      error("unsafe", "unsafe", span).with_code(E0197).emit();
    }
    if (polarity.$ === "Negative") {
      const span = polarity._0;
      error("!", "negative", span).emit();
    }
    if (defaultness.$ === "Default") {
      const def_span = defaultness._0;
      error("default", "default", def_span).emit();
    }
    if (constness.$ === "Yes") {
      const span = constness._0;
      this.psess.gated_spans.gate(sym.const_trait_impl, span);
    }
    of_trait = undefined;
    self_ty = self_ty_;
  }

  return Ok({ $: "Impl", _0: { generics, of_trait, self_ty, items: impl_items, constness } });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:851 parse_item_delegation
Parser.prototype.parse_item_delegation = function (
  this: Parser,
  attrs: AttrVec,
  defaultness: Defaultness,
  kind: ReuseKind,
): PResult<ItemKind> {
  const span = this.token.span;
  const r = this.expect_keyword(exp.Reuse);
  if (r.$ === "Err") return r;

  let r2: PResult<ItemKind>;
  switch (kind) {
    case "Path":
      r2 = this.parse_path_like_delegation();
      break;
    case "Impl":
      r2 = this.parse_impl_delegation(span, attrs, defaultness);
      break;
  }
  if (r2.$ === "Err") return r2;
  const item_kind = r2._0;

  this.psess.gated_spans.gate(sym.fn_delegation, Span.to(span, this.prev_token.span));

  return Ok(item_kind);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:870 parse_delegation_body
Parser.prototype.parse_delegation_body = function (this: Parser): PResult<Block | undefined> {
  if (this.check(exp.OpenBrace)) {
    const r = this.parse_block();
    if (r.$ === "Err") return r;
    return Ok(r._0);
  } else {
    const r = this.expect(exp.Semi);
    if (r.$ === "Err") return r;
    return Ok(undefined);
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:879 parse_impl_delegation
Parser.prototype.parse_impl_delegation = function (
  this: Parser,
  span: Span,
  attrs: AttrVec,
  defaultness: Defaultness,
): PResult<ItemKind> {
  const r = this.parse_item_impl(attrs, defaultness, true);
  if (r.$ === "Err") return r;
  const impl_item = r._0;
  if (impl_item.$ !== "Impl") {
    unreachable();
  }
  const { items, of_trait } = impl_item._0;

  const until_expr_span = Span.to(span, this.prev_token.span);

  if (of_trait === undefined) {
    return Err(this.dcx().create_err(diagnostics.ImplReuseInherentImpl_diagnostic({ span: until_expr_span })));
  }

  const r2 = this.parse_delegation_body();
  if (r2.$ === "Err") return r2;
  const body = r2._0;
  const whole_reuse_span = Span.to(span, this.prev_token.span);

  items.push(
    new ast.Item<AssocItemKind>(
      [],
      DUMMY_NODE_ID,
      whole_reuse_span,
      { kind: ast.VisibilityKind.Inherited, span: whole_reuse_span },
      {
        $: "DelegationMac",
        _0: {
          qself: undefined,
          prefix: ast.clone_Path(of_trait.trait_ref.path),
          suffixes: { $: "Glob", _0: whole_reuse_span },
          body,
        },
      },
      undefined,
    ),
  );

  return Ok(impl_item);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:916 parse_path_like_delegation
Parser.prototype.parse_path_like_delegation = function (this: Parser): PResult<ItemKind> {
  let qself: ast.QSelf | undefined;
  let path: Path;
  if (this.eat_lt()) {
    const r = this.parse_qpath(PathStyle.Expr);
    if (r.$ === "Err") return r;
    const [qself_, path_] = r._0;
    [qself, path] = [qself_, path_];
  } else {
    const r = this.parse_path(PathStyle.Expr);
    if (r.$ === "Err") return r;
    [qself, path] = [undefined, r._0];
  }

  const rename = (this_: Parser): PResult<Ident | undefined> => {
    if (this_.eat_keyword(exp.As)) {
      const r = this_.parse_ident();
      if (r.$ === "Err") return r;
      return Ok(r._0);
    } else {
      return Ok(undefined);
    }
  };

  if (this.eat_path_sep()) {
    let suffixes: ast.DelegationSuffixes;
    if (this.eat(exp.Star)) {
      suffixes = { $: "Glob", _0: this.prev_token.span };
    } else {
      const parse_suffix = (p: Parser): PResult<[Ident, Ident | undefined]> => {
        const r = p.parse_path_segment_ident();
        if (r.$ === "Err") return r;
        const r2 = rename(p);
        if (r2.$ === "Err") return r2;
        return Ok([r._0, r2._0]);
      };
      const r = this.parse_delim_comma_seq(exp.OpenBrace, exp.CloseBrace, parse_suffix);
      if (r.$ === "Err") return r;
      suffixes = { $: "List", _0: r._0[0] };
    }

    const r = this.parse_delegation_body();
    if (r.$ === "Err") return r;
    return Ok({
      $: "DelegationMac",
      _0: {
        qself,
        prefix: path,
        suffixes,
        body: r._0,
      },
    });
  } else {
    const r = rename(this);
    if (r.$ === "Err") return r;
    const rename_ = r._0;
    const ident = rename_ ?? unwrap(path.segments[path.segments.length - 1]).ident;

    const r2 = this.parse_delegation_body();
    if (r2.$ === "Err") return r2;
    return Ok({
      $: "Delegation",
      _0: new ast.Delegation(DUMMY_NODE_ID, qself, path, ident, rename_, r2._0, ast.DelegationSource.Single),
    });
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:960 parse_item_list
Parser.prototype.parse_item_list = function <T>(
  this: Parser,
  attrs: AttrVec,
  parse_item: (this_: Parser) => PResult<{ $: "Some"; _0: T | undefined } | undefined>,
): PResult<T[]> {
  const open_brace_span = this.token.span;

  // Recover `impl Ty;` instead of `impl Ty {}`
  if (this.token.eq(TokenKind.Semi)) {
    this.dcx().emit_err(diagnostics.UseEmptyBlockNotSemi_diagnostic({ span: this.token.span }));
    this.bump();
    return Ok([]);
  }

  const r = this.expect(exp.OpenBrace);
  if (r.$ === "Err") return r;
  const r2 = this.parse_inner_attributes();
  if (r2.$ === "Err") return r2;
  attrs.push(...r2._0);

  const items: T[] = [];
  while (!this.eat(exp.CloseBrace)) {
    if (this.recover_doc_comment_before_brace()) {
      continue;
    }
    this.recover_vcs_conflict_marker();
    const r3 = parse_item(this);
    if (r3.$ === "Ok" && r3._0 === undefined) {
      let is_unnecessary_semicolon =
        (this.token.eq(TokenKind.Semi) && this.prev_token.eq(TokenKind.Semi)) ||
        (items.length !== 0 &&
          // When the close delim is `)` in a case like the following, `token.kind`
          // is expected to be `token::CloseParen`, but the actual `token.kind` is
          // `token::CloseBrace`. This is because the `token.kind` of the close delim
          // is treated as the same as that of the open delim in
          // `TokenTreesReader::parse_token_tree`, even if the delimiters of them are
          // different. Therefore, `token.kind` should not be compared here.
          //
          // issue-60075.rs
          // ```
          // trait T {
          //     fn qux() -> Option<usize> {
          //         let _ = if true {
          //         });
          //          ^ this close delim
          //         Some(4)
          //     }
          // ```
          is_ok_and(this.span_to_snippet(this.prev_token.span), (snippet) => snippet === "}") &&
          this.token.eq(TokenKind.Semi));
      let semicolon_span = this.token.span;
      if (!is_unnecessary_semicolon) {
        // #105369, Detect spurious `;` before assoc fn body
        is_unnecessary_semicolon = this.token.eq(TokenKind.OpenBrace) && this.prev_token.eq(TokenKind.Semi);
        semicolon_span = this.prev_token.span;
      }
      // We have to bail or we'll potentially never make progress.
      const non_item_span = this.token.span;
      const is_let = this.token.is_keyword(kw.Let);

      const err = this.dcx().struct_span_err(non_item_span, "non-item in item list");
      this.consume_block(exp.OpenBrace, exp.CloseBrace, ConsumeClosingDelim.Yes);
      if (is_let) {
        err.span_suggestion_verbose(
          non_item_span,
          "consider using `const` instead of `let` for associated const",
          "const",
          Applicability.MachineApplicable,
        );
      } else {
        err
          .span_label(open_brace_span, "item list starts here")
          .span_label(non_item_span, "non-item starts here")
          .span_label(this.prev_token.span, "item list ends here");
      }
      if (is_unnecessary_semicolon) {
        err.span_suggestion_verbose(
          semicolon_span,
          "consider removing this semicolon",
          "",
          Applicability.MaybeIncorrect,
        );
      }
      err.emit();
      break;
    } else if (r3.$ === "Ok") {
      const item = r3._0!._0;
      if (item !== undefined) {
        items.push(item);
      }
    } else {
      const err = r3._0;
      this.consume_block(exp.OpenBrace, exp.CloseBrace, ConsumeClosingDelim.Yes);
      err
        .with_span_label(open_brace_span, "while parsing this item list starting here")
        .with_span_label(this.prev_token.span, "the item list ends here")
        .emit();
      break;
    }
  }
  return Ok(items);
};

// PORT: `Result::is_ok_and`.
function is_ok_and<T, E>(r: Result<T, E>, f: (v: T) => boolean): boolean {
  return r.$ === "Ok" && f(r._0);
}

/// Recover on a doc comment before `}`.
// rustc: compiler/rustc_parse/src/parser/item.rs:1063 recover_doc_comment_before_brace
Parser.prototype.recover_doc_comment_before_brace = function (this: Parser): boolean {
  if (this.token.kind.$ === "DocComment") {
    if (this.look_ahead(1, (tok) => tok.eq(TokenKind.CloseBrace))) {
      // FIXME: merge with `DocCommentDoesNotDocumentAnything` (E0585)
      struct_span_code_err(
        this.dcx(),
        this.token.span,
        E0584,
        "found a documentation comment that doesn't document anything",
      )
        .with_span_label(this.token.span, "this doc comment doesn't document anything")
        .with_help(
          "doc comments must come before what they document, if a comment was " + "intended use `//`",
        )
        .emit();
      this.bump();
      return true;
    }
  }
  return false;
};

/// Parses defaultness (i.e., `default` or nothing).
// rustc: compiler/rustc_parse/src/parser/item.rs:1087 parse_defaultness
Parser.prototype.parse_defaultness = function (this: Parser): Defaultness {
  // We are interested in `default` followed by another identifier.
  // However, we must avoid keywords that occur as binary operators.
  // Currently, the only applicable keyword is `as` (`default as Ty`).
  if (
    this.check_keyword(exp.Default) &&
    this.look_ahead(1, (t) => {
      const i = t.non_raw_ident();
      return i !== undefined && i.name !== kw.As;
    })
  ) {
    this.psess.gated_spans.gate(sym.specialization, this.token.span);
    this.bump(); // `default`
    return { $: "Default", _0: this.prev_token_uninterpolated_span() };
  } else if (this.eat_keyword(exp.Final)) {
    this.psess.gated_spans.gate(sym.final_associated_functions, this.prev_token.span);
    return { $: "Final", _0: this.prev_token_uninterpolated_span() };
  } else {
    return ast.Defaultness.Implicit;
  }
};

// `const SUFFIXES` of `check_trait_front_matter`.
const CHECK_TRAIT_FRONT_MATTER_SUFFIXES: readonly (readonly Symbol[])[] = [
  [kw.Trait],
  [kw.Auto, kw.Trait],
  [kw.Unsafe, kw.Trait],
  [kw.Unsafe, kw.Auto, kw.Trait],
  [kw.Const, kw.Trait],
  [kw.Const, kw.Auto, kw.Trait],
  [kw.Const, kw.Unsafe, kw.Trait],
  [kw.Const, kw.Unsafe, kw.Auto, kw.Trait],
];

/// Is this an `[impl(in? path)]? const? unsafe? auto? trait` item?
// rustc: compiler/rustc_parse/src/parser/item.rs:1106 check_trait_front_matter
Parser.prototype.check_trait_front_matter = function (this: Parser): boolean {
  const SUFFIXES = CHECK_TRAIT_FRONT_MATTER_SUFFIXES;
  // `impl(`
  if (this.check_keyword(exp.Impl) && this.look_ahead(1, (t) => t.eq(TokenKind.OpenParen))) {
    // `impl(in` unambiguously introduces an `impl` restriction
    if (this.is_keyword_ahead(2, [kw.In])) {
      return true;
    }
    // `impl(crate | self | super)` + SUFFIX
    if (
      this.is_keyword_ahead(2, [kw.Crate, kw.SelfLower, kw.Super]) &&
      this.look_ahead(3, (t) => t.eq(TokenKind.CloseParen)) &&
      SUFFIXES.some((suffix) => suffix.every((kw_, i) => this.is_keyword_ahead(i + 4, [kw_])))
    ) {
      return true;
    }
    // Recover cases like `impl(path::to::module)` + SUFFIX to suggest inserting `in`.
    return SUFFIXES.some((suffix) =>
      suffix.every(
        (kw_, i) =>
          this.tree_look_ahead(i + 2, (t: TokenTree) => {
            if (t.$ === "Token") {
              const token_ = t._0;
              return token_.is_keyword(kw_);
            } else {
              return false;
            }
          }) ?? false,
      ),
    );
  } else {
    return SUFFIXES.some((suffix) =>
      suffix.every((kw_, i) => {
        // We use `check_keyword` for the first token to include it in the expected tokens.
        if (i === 0) {
          switch (kw_) {
            case kw.Const:
              return this.check_keyword(exp.Const);
            case kw.Unsafe:
              return this.check_keyword(exp.Unsafe);
            case kw.Auto:
              return this.check_keyword(exp.Auto);
            case kw.Trait:
              return this.check_keyword(exp.Trait);
            default:
              unreachable();
          }
        } else {
          return this.is_keyword_ahead(i, [kw_]);
        }
      }),
    );
  }
};

/// Parses `[impl(in? path)]? const? unsafe? auto? trait Foo { ... }` or `trait Foo = Bar;`.
// rustc: compiler/rustc_parse/src/parser/item.rs:1166 parse_item_trait
Parser.prototype.parse_item_trait = function (this: Parser, attrs: AttrVec, lo: Span): PResult<ItemKind> {
  const r = this.parse_impl_restriction();
  if (r.$ === "Err") return r;
  const impl_restriction = r._0;
  const constness = this.parse_constness(Case.Sensitive);
  if (constness.$ === "Yes") {
    const span = constness._0;
    this.psess.gated_spans.gate(sym.const_trait_impl, span);
  }
  const safety = this.parse_safety(Case.Sensitive);
  // Parse optional `auto` prefix.
  let is_auto: ast.IsAuto;
  if (this.eat_keyword(exp.Auto)) {
    this.psess.gated_spans.gate(sym.auto_traits, this.prev_token.span);
    is_auto = "Yes";
  } else {
    is_auto = "No";
  }

  const r2 = this.expect_keyword(exp.Trait);
  if (r2.$ === "Err") return r2;
  const r3 = this.parse_ident();
  if (r3.$ === "Err") return r3;
  const ident = r3._0;
  const r4 = this.parse_generics();
  if (r4.$ === "Err") return r4;
  const generics = r4._0;

  // Parse optional colon and supertrait bounds.
  const had_colon = this.eat(exp.Colon);
  const span_at_colon = this.prev_token.span;
  let bounds: ast.GenericBounds;
  if (had_colon) {
    const r5 = this.parse_generic_bounds();
    if (r5.$ === "Err") return r5;
    bounds = r5._0;
  } else {
    bounds = [];
  }

  const span_before_eq = this.prev_token.span;
  if (this.eat(exp.Eq)) {
    // It's a trait alias.
    if (had_colon) {
      const span = Span.to(span_at_colon, span_before_eq);
      this.dcx().emit_err(diagnostics.BoundsNotAllowedOnTraitAliases_diagnostic({ span }));
    }

    const r6 = this.parse_generic_bounds();
    if (r6.$ === "Err") return r6;
    const bounds = r6._0;
    const r7 = this.parse_where_clause();
    if (r7.$ === "Err") return r7;
    generics.where_clause = r7._0;
    const r8 = this.expect_semi();
    if (r8.$ === "Err") return r8;

    const whole_span = Span.to(lo, this.prev_token.span);
    if (is_auto === "Yes") {
      this.dcx().emit_err(diagnostics.TraitAliasCannotBeAuto_diagnostic({ span: whole_span }));
    }
    if (safety.$ === "Unsafe") {
      this.dcx().emit_err(diagnostics.TraitAliasCannotBeUnsafe_diagnostic({ span: whole_span }));
    }
    if (impl_restriction.kind.$ === "Restricted") {
      this.dcx().emit_err(diagnostics.TraitAliasCannotBeImplRestricted_diagnostic({ span: whole_span }));
    }

    this.psess.gated_spans.gate(sym.trait_alias, whole_span);

    return Ok({ $: "TraitAlias", _0: { constness, ident, generics, bounds } });
  } else {
    // It's a normal trait.
    const r6 = this.parse_where_clause();
    if (r6.$ === "Err") return r6;
    generics.where_clause = r6._0;
    const r7 = this.parse_item_list<AssocItem>(attrs, (p) => p.parse_trait_item(ForceCollect.No));
    if (r7.$ === "Err") return r7;
    const items = r7._0;
    return Ok({
      $: "Trait",
      _0: {
        impl_restriction,
        constness,
        is_auto,
        safety,
        ident,
        generics,
        bounds,
        items,
      },
    });
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1234 parse_impl_item
Parser.prototype.parse_impl_item = function (
  this: Parser,
  force_collect: ForceCollect,
): PResult<{ $: "Some"; _0: AssocItem | undefined } | undefined> {
  const fn_parse_mode: FnParseMode = { req_name: (_, __) => true, context: "Impl", req_body: true };
  return this.parse_assoc_item(fn_parse_mode, force_collect);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1243 parse_trait_item
Parser.prototype.parse_trait_item = function (
  this: Parser,
  force_collect: ForceCollect,
): PResult<{ $: "Some"; _0: AssocItem | undefined } | undefined> {
  const fn_parse_mode: FnParseMode = {
    req_name: (edition, _) => Edition_discriminant[edition] >= Edition_discriminant[Edition.Edition2018],
    context: "Trait",
    req_body: false,
  };
  return this.parse_assoc_item(fn_parse_mode, force_collect);
};

/// Parses associated items.
// rustc: compiler/rustc_parse/src/parser/item.rs:1256 parse_assoc_item
Parser.prototype.parse_assoc_item = function (
  this: Parser,
  fn_parse_mode: FnParseMode,
  force_collect: ForceCollect,
): PResult<{ $: "Some"; _0: AssocItem | undefined } | undefined> {
  const r = this.parse_item_(
    fn_parse_mode,
    force_collect,
    AllowConstBlockItems.DoesNotMatter, // due to `AssocItemKind::try_from` below
  );
  if (r.$ === "Err") return r;
  const item_ = r._0;
  if (item_ === undefined) {
    return Ok(undefined);
  }
  const { attrs, id, span, vis, kind: item_kind, tokens } = item_;
  let kind: AssocItemKind;
  const r2 = ast.AssocItemKind.try_from_ItemKind(item_kind);
  if (r2.$ === "Ok") {
    kind = r2._0;
  } else {
    const kind_ = r2._0;
    if (kind_.$ === "Static") {
      const { ident, ty, expr, define_opaque } = kind_._0;
      this.dcx().emit_err(diagnostics.AssociatedStaticItemNotAllowed_diagnostic({ span }));
      kind = {
        $: "Const",
        _0: {
          defaultness: ast.Defaultness.Implicit,
          ident,
          generics: generics_default(),
          ty,
          body: expr,
          define_opaque,
        },
      };
    } else {
      return Ok({ $: "Some", _0: this.error_bad_item_kind<AssocItem>(span, kind_, "`trait`s or `impl`s") });
    }
  }
  return Ok({ $: "Some", _0: new ast.Item<AssocItemKind>(attrs, id, span, vis, kind, tokens) });
};

/// Parses a `type` alias with the following grammar:
/// ```ebnf
/// TypeAlias = "type" Ident Generics (":" GenericBounds)? WhereClause ("=" Ty)? WhereClause ";" ;
/// ```
/// The `"type"` has already been eaten.
// rustc: compiler/rustc_parse/src/parser/item.rs:1303 parse_type_alias
Parser.prototype.parse_type_alias = function (this: Parser, defaultness: Defaultness): PResult<ItemKind> {
  const r = this.parse_ident();
  if (r.$ === "Err") return r;
  const ident = r._0;
  const r2 = this.parse_generics();
  if (r2.$ === "Err") return r2;
  const generics = r2._0;

  // Parse optional colon and param bounds.
  let bounds: ast.GenericBounds;
  if (this.eat(exp.Colon)) {
    const r3 = this.parse_generic_bounds();
    if (r3.$ === "Err") return r3;
    bounds = r3._0;
  } else {
    bounds = [];
  }
  const r4 = this.parse_where_clause();
  if (r4.$ === "Err") return r4;
  generics.where_clause = r4._0;

  let ty: Ty | undefined;
  if (this.eat(exp.Eq)) {
    const r5 = this.parse_ty();
    if (r5.$ === "Err") return r5;
    ty = r5._0;
  } else {
    ty = undefined;
  }

  const r6 = this.parse_where_clause();
  if (r6.$ === "Err") return r6;
  const after_where_clause = r6._0;

  const r7 = this.expect_semi();
  if (r7.$ === "Err") return r7;

  return Ok({
    $: "TyAlias",
    _0: {
      defaultness,
      ident,
      generics,
      after_where_clause,
      bounds,
      ty,
    },
  });
};

/// Parses a `UseTree`.
///
/// ```text
/// USE_TREE = [`::`] `*` |
///            [`::`] `{` USE_TREE_LIST `}` |
///            PATH `::` `*` |
///            PATH `::` `{` USE_TREE_LIST `}` |
///            PATH [`as` IDENT]
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:1337 parse_use_tree
Parser.prototype.parse_use_tree = function (
  this: Parser,
  use_token_span: Span,
  use_path: UsePathList | undefined,
): PResult<UseTree> {
  const lo = this.token.span;

  let prefix = new ast.Path(Span.shrink_to_lo(lo), []);
  let kind: UseTreeKind;
  if (this.check(exp.OpenBrace) || this.check(exp.Star) || this.is_import_coupler()) {
    // `use *;` or `use ::*;` or `use {...};` or `use ::{...};`
    const mod_sep_ctxt = Span.ctxt(this.token.span);
    if (this.eat_path_sep()) {
      prefix.segments.push(ast.PathSegment.path_root(Span.with_ctxt(Span.shrink_to_lo(lo), mod_sep_ctxt)));
    }

    const r = this.parse_use_tree_glob_or_nested(use_token_span, use_path);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else {
    // `use path::*;` or `use path::{...};` or `use path;` or `use path as bar;`
    const r = this.parse_path(PathStyle.Mod);
    if (r.$ === "Err") return r;
    prefix = r._0;

    if (this.eat_path_sep()) {
      const use_path_: UsePathList = { elements: prefix.segments, prev: use_path };
      const r2 = this.parse_use_tree_glob_or_nested(use_token_span, use_path_);
      if (r2.$ === "Err") return r2;
      kind = r2._0;
    } else {
      // Recover from using a colon as path separator.
      while (this.eat_noexpect(TokenKind.Colon)) {
        this.dcx().emit_err(diagnostics.SingleColonImportPath_diagnostic({ span: this.prev_token.span }));

        // We parse the rest of the path and append it to the original prefix.
        const r3 = this.parse_path_segments(prefix.segments, PathStyle.Mod, undefined);
        if (r3.$ === "Err") return r3;
        prefix.span = Span.to(lo, this.prev_token.span);
      }

      const r4 = this.parse_rename();
      if (r4.$ === "Err") return r4;
      kind = { $: "Simple", _0: r4._0 };
    }
  }

  return Ok(new ast.UseTree(prefix, kind));
};

/// Parses `*` or `{...}`.
// rustc: compiler/rustc_parse/src/parser/item.rs:1383 parse_use_tree_glob_or_nested
Parser.prototype.parse_use_tree_glob_or_nested = function (
  this: Parser,
  use_token_span: Span,
  use_path: UsePathList | undefined,
): PResult<UseTreeKind> {
  if (this.eat(exp.Star)) {
    return Ok({ $: "Glob", _0: this.prev_token.span });
  } else {
    const lo = this.token.span;
    const r = this.parse_use_tree_list(use_token_span, use_path);
    if (r.$ === "Err") return r;
    return Ok({
      $: "Nested",
      items: r._0,
      span: Span.to(lo, this.prev_token.span),
    });
  }
};

/// Parses a `UseTreeKind::Nested(list)`.
///
/// ```text
/// USE_TREE_LIST = ∅ | (USE_TREE `,`)* USE_TREE [`,`]
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:1404 parse_use_tree_list
Parser.prototype.parse_use_tree_list = function (
  this: Parser,
  use_token_span: Span,
  prefix: UsePathList | undefined,
): PResult<UseTreeAndId[]> {
  const r = this.parse_delim_comma_seq(exp.OpenBrace, exp.CloseBrace, (p): PResult<UseTreeAndId> => {
    p.recover_vcs_conflict_marker();

    let attr_span: Span | undefined = undefined;
    const r = p.parse_outer_attributes();
    if (r.$ === "Err") return r;
    const attrs = r._0;
    if (!attrs.is_empty()) {
      const raw_attrs = attrs.take_for_recovery(p.psess);
      attr_span = Span.to(unwrap(raw_attrs[0]).span, unwrap(raw_attrs[raw_attrs.length - 1]).span);
    }

    const r2 = p.parse_use_tree(use_token_span, prefix);
    if (r2.$ === "Err") return r2;
    const use_tree = r2._0;

    if (attr_span !== undefined) {
      p.emit_error_attr_in_use_tree(use_token_span, prefix, use_tree.span(), attr_span);
    }

    return Ok({ inner: use_tree, id: DUMMY_NODE_ID });
  });
  if (r.$ === "Err") return r;
  return Ok(r._0[0]);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1431 emit_error_attr_in_use_tree
Parser.prototype.emit_error_attr_in_use_tree = function (
  this: Parser,
  use_token_span: Span,
  prefix: UsePathList | undefined,
  use_tree_span: Span,
  attr_span: Span,
): void {
  const r = this.psess.source_map().span_to_snippet(attr_span);
  if (r.$ !== "Ok") return;
  const attr = r._0.toString();

  let prefix_list: PathSegment[];
  {
    const tmp: (readonly PathSegment[])[] = [];
    while (prefix !== undefined) {
      const prefix_ = prefix;
      tmp.push(prefix_.elements);
      prefix = prefix_.prev;
    }
    tmp.reverse();
    prefix_list = tmp.flat();
  }

  const prefix_str: string = prefix_list
    .map((seg) => (seg.ident.name === kw.PathRoot ? "" : seg.ident.as_str()))
    .join("::");

  let comma_reached = false;
  const r2 = this.psess.source_map().span_extend_while(use_tree_span, (c) => {
    if (comma_reached) {
      return false;
    }
    comma_reached = c === 0x2c; /* ',' */
    return is_whitespace(c) || comma_reached;
  });
  if (r2.$ !== "Ok") {
    return;
  }
  const tree_span = r2._0;

  const r3 = this.psess.source_map().span_to_snippet(use_tree_span);
  if (r3.$ !== "Ok") return;
  const use_tree = r3._0.toString();

  // FIXME: duplicate the attributes that are at the root of the initial use-item.
  const code = `${attr}\nuse ${prefix_str}::${use_tree};\n`;

  this.dcx().emit_err(
    diagnostics.AttrInUseTree_diagnostic({
      attr_span,
      sub: {
        use_lo: Span.shrink_to_lo(use_token_span),
        attr_span,
        tree_span,
        code,
      },
    }),
  );
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1483 parse_rename
Parser.prototype.parse_rename = function (this: Parser): PResult<Ident | undefined> {
  if (this.eat_keyword(exp.As)) {
    const r = this.parse_ident_or_underscore();
    if (r.$ === "Err") return r;
    return Ok(r._0);
  } else {
    return Ok(undefined);
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1491 parse_ident_or_underscore
Parser.prototype.parse_ident_or_underscore = function (this: Parser): PResult<Ident> {
  const ident = this.token.non_raw_ident();
  if (ident !== undefined && ident.name === kw.Underscore) {
    this.bump();
    return Ok(ident);
  } else {
    return this.parse_ident();
  }
};

/// Parses `extern crate` links.
///
/// # Examples
///
/// ```ignore (illustrative)
/// extern crate foo;
/// extern crate bar as foo;
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:1508 parse_item_extern_crate
Parser.prototype.parse_item_extern_crate = function (this: Parser): PResult<ItemKind> {
  // Accept `extern crate name-like-this` for better diagnostics
  const r = this.parse_crate_name_with_dashes();
  if (r.$ === "Err") return r;
  const orig_ident = r._0;
  const r2 = this.parse_rename();
  if (r2.$ === "Err") return r2;
  let orig_name: Symbol | undefined;
  let item_ident: Ident;
  if (r2._0 !== undefined) {
    const rename = r2._0;
    [orig_name, item_ident] = [orig_ident.name, rename];
  } else {
    [orig_name, item_ident] = [undefined, orig_ident];
  }
  const r3 = this.expect_semi();
  if (r3.$ === "Err") return r3;
  return Ok({ $: "ExternCrate", _0: orig_name, _1: item_ident });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1520 parse_crate_name_with_dashes
Parser.prototype.parse_crate_name_with_dashes = function (this: Parser): PResult<Ident> {
  const r = this.token.is_keyword(kw.SelfLower) ? this.parse_path_segment_ident() : this.parse_ident();
  if (r.$ === "Err") return r;
  const ident = r._0;

  const dash = exp.Minus;
  if (!this.token.eq(dash.tok)) {
    return Ok(ident);
  }

  // Accept `extern crate name-like-this` for better diagnostics.
  const dashes: Span[] = [];
  const idents: Ident[] = [];
  while (this.eat(dash)) {
    dashes.push(this.prev_token.span);
    const r2 = this.parse_ident();
    if (r2.$ === "Err") return r2;
    idents.push(r2._0);
  }

  const fixed_name_sp = Span.to(ident.span, unwrap(idents[idents.length - 1]).span);
  let fixed_name = Symbol.as_str(ident.name);
  for (const part of idents) {
    fixed_name += `_${Symbol.as_str(part.name)}`;
  }

  this.dcx().emit_err(
    diagnostics.ExternCrateNameWithDashes_diagnostic({
      span: fixed_name_sp,
      sugg: { dashes },
    }),
  );

  return Ok(Ident.from_str_and_span(fixed_name, fixed_name_sp));
};

/// Parses `extern` for foreign ABIs modules.
///
/// `extern` is expected to have been consumed before calling this method.
///
/// # Examples
///
/// ```ignore (only-for-syntax-highlight)
/// extern "C" {}
/// extern {}
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:1564 parse_item_foreign_mod
Parser.prototype.parse_item_foreign_mod = function (this: Parser, attrs: AttrVec, safety: Safety): PResult<ItemKind> {
  const extern_span = this.prev_token_uninterpolated_span();
  const abi = this.parse_abi(); // ABI?
  // FIXME: This recovery should be tested better.
  if (
    safety.$ === "Default" &&
    this.token.is_keyword(kw.Unsafe) &&
    this.look_ahead(1, (t) => t.eq(TokenKind.OpenBrace))
  ) {
    const r = this.expect(exp.OpenBrace);
    if (r.$ === "Ok") {
      // PORT: `Result::unwrap_err` on `Ok`.
      panic("called `Result::unwrap_err()` on an `Ok` value");
    }
    r._0.emit();
    safety = { $: "Unsafe", _0: this.token.span };
    this.eat_keyword(exp.Unsafe);
  }
  const r2 = this.parse_item_list<ForeignItem>(attrs, (p) => p.parse_foreign_item(ForceCollect.No));
  if (r2.$ === "Err") return r2;
  return Ok({
    $: "ForeignMod",
    _0: {
      extern_span,
      safety,
      abi,
      items: r2._0,
    },
  });
};

/// Parses a foreign item (one in an `extern { ... }` block).
// rustc: compiler/rustc_parse/src/parser/item.rs:1589 parse_foreign_item
Parser.prototype.parse_foreign_item = function (
  this: Parser,
  force_collect: ForceCollect,
): PResult<{ $: "Some"; _0: ForeignItem | undefined } | undefined> {
  const fn_parse_mode: FnParseMode = {
    req_name: (_, is_dot_dot_dot) => is_dot_dot_dot === IsDotDotDot.No,
    context: "Free",
    req_body: false,
  };
  const r = this.parse_item_(
    fn_parse_mode,
    force_collect,
    AllowConstBlockItems.DoesNotMatter, // due to `ForeignItemKind::try_from` below
  );
  if (r.$ === "Err") return r;
  const item_ = r._0;
  if (item_ === undefined) {
    return Ok(undefined);
  }
  const { attrs, id, span, vis, kind: item_kind, tokens } = item_;
  let kind: ForeignItemKind;
  const r2 = ast.ForeignItemKind.try_from_ItemKind(item_kind);
  if (r2.$ === "Ok") {
    kind = r2._0;
  } else {
    const kind_ = r2._0;
    if (kind_.$ === "Const") {
      const { ident, ty, body } = kind_._0;
      const const_span_ = Span.with_hi(span, Span.lo(ident.span));
      const const_span = Span.can_be_used_for_suggestions(const_span_) ? const_span_ : undefined;
      this.dcx().emit_err(
        diagnostics.ExternItemCannotBeConst_diagnostic({
          ident_span: ident.span,
          const_span,
        }),
      );
      kind = {
        $: "Static",
        _0: {
          ident,
          ty,
          mutability: "Not",
          expr: body,
          safety: ast.Safety.Default,
          define_opaque: undefined,
          eii_impl: undefined,
        },
      };
    } else {
      return Ok({ $: "Some", _0: this.error_bad_item_kind<ForeignItem>(span, kind_, "`extern` blocks") });
    }
  }
  return Ok({ $: "Some", _0: new ast.Item<ForeignItemKind>(attrs, id, span, vis, kind, tokens) });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1632 error_bad_item_kind
Parser.prototype.error_bad_item_kind = function <T>(
  this: Parser,
  span: Span,
  kind: ItemKind,
  ctx: string,
): T | undefined {
  // FIXME(#100717): needs variant for each `ItemKind` (instead of using `ItemKind::descr()`)
  const span_ = this.psess.source_map().guess_head_span(span);
  const descr = ast.ItemKind.descr(kind);
  const help = !(kind.$ === "DelegationMac" && kind._0.suffixes.$ === "Glob");
  this.dcx().emit_err(diagnostics.BadItemKind_diagnostic({ span: span_, descr, ctx, help }));
  return undefined;
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1647 is_use_closure
Parser.prototype.is_use_closure = function (this: Parser): boolean {
  if (this.token.is_keyword(kw.Use)) {
    // Check if this could be a closure.
    return this.look_ahead(1, (token_) => {
      // Move or Async here would be an error but still we're parsing a closure
      const dist = token_.is_keyword(kw.Move) || token_.is_keyword(kw.Async) ? 2 : 1;

      return this.look_ahead(dist, (token_) => token_.kind.$ === "Or" || token_.kind.$ === "OrOr");
    });
  } else {
    return false;
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1662 is_unsafe_foreign_mod
Parser.prototype.is_unsafe_foreign_mod = function (this: Parser): boolean {
  // Look for `unsafe`.
  if (!this.token.is_keyword(kw.Unsafe)) {
    return false;
  }
  // Look for `extern`.
  if (!this.is_keyword_ahead(1, [kw.Extern])) {
    return false;
  }

  // Look for the optional ABI string literal.
  const n = this.look_ahead(2, (t) => t.can_begin_string_literal()) ? 3 : 2;

  // Look for the `{`. Use `tree_look_ahead` because the ABI (if present)
  // might be a metavariable i.e. an invisible-delimited sequence, and
  // `tree_look_ahead` will consider that a single element when looking
  // ahead.
  return this.tree_look_ahead(n, (t) => t.$ === "Delimited" && t._2.$ === "Brace") === true;
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1683 parse_global_static_front_matter
Parser.prototype.parse_global_static_front_matter = function (this: Parser, case_: Case): Safety | undefined {
  let is_global_static: boolean;
  if (this.check_keyword_case(exp.Static, case_)) {
    // Check if this could be a closure.
    is_global_static = !this.look_ahead(1, (token_) => {
      if (token_.is_keyword_case(kw.Move, case_) || token_.is_keyword_case(kw.Use, case_)) {
        return true;
      }
      return token_.kind.$ === "Or" || token_.kind.$ === "OrOr";
    });
  } else {
    // `$qual static`
    is_global_static =
      (this.check_keyword_case(exp.Unsafe, case_) || this.check_keyword_case(exp.Safe, case_)) &&
      this.look_ahead(1, (t) => t.is_keyword_case(kw.Static, case_));
  }

  if (is_global_static) {
    const safety = this.parse_safety(case_);
    this.eat_keyword_case(exp.Static, case_);
    return safety;
  } else {
    return undefined;
  }
};

/// Recover on `const mut` with `const` already eaten.
// rustc: compiler/rustc_parse/src/parser/item.rs:1709 recover_const_mut
Parser.prototype.recover_const_mut = function (this: Parser, const_span: Span): void {
  if (this.eat_keyword(exp.Mut)) {
    const span = this.prev_token.span;
    this.dcx().emit_err(diagnostics.ConstGlobalCannotBeMutable_diagnostic({ ident_span: span, const_span }));
  } else if (this.eat_keyword(exp.Let)) {
    const span = this.prev_token.span;
    this.dcx().emit_err(diagnostics.ConstLetMutuallyExclusive_diagnostic({ span: Span.to(const_span, span) }));
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1721 parse_const_block_item
Parser.prototype.parse_const_block_item = function (this: Parser): PResult<ConstBlockItem> {
  const r = this.expect_keyword(exp.Const);
  if (r.$ === "Err") return r;
  const const_span = this.prev_token.span;
  this.psess.gated_spans.gate(sym.const_block_items, const_span);
  const r2 = this.parse_block();
  if (r2.$ === "Err") return r2;
  const block = r2._0;
  return Ok({ id: DUMMY_NODE_ID, span: Span.to(const_span, block.span), block });
};

/// Parse a static item with the prefix `"static" "mut"?` already parsed and stored in
/// `mutability`.
///
/// ```ebnf
/// Static = "static" "mut"? $ident ":" $ty (= $expr)? ";" ;
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:1735 parse_static_item
Parser.prototype.parse_static_item = function (this: Parser, safety: Safety, mutability: Mutability): PResult<ItemKind> {
  const r = this.parse_ident();
  if (r.$ === "Err") return r;
  const ident = r._0;

  if (this.token.eq(TokenKind.Lt) && this.may_recover()) {
    const r2 = this.parse_generics();
    if (r2.$ === "Err") return r2;
    const generics = r2._0;
    this.dcx().emit_err(diagnostics.StaticWithGenerics_diagnostic({ span: generics.span }));
  }

  // Parse the type of a static item. That is, the `":" $ty` fragment.
  // FIXME: This could maybe benefit from `.may_recover()`?
  const colon = this.eat(exp.Colon);
  // PORT: `|` (not `||`): both checks run.
  const check_eq = this.check(exp.Eq);
  const check_semi = this.check(exp.Semi);
  let ty: Ty;
  if (colon && !(check_eq || check_semi)) {
    const r3 = this.parse_ty();
    if (r3.$ === "Err") return r3;
    ty = r3._0;
  } else {
    // If there wasn't a `:` or the colon was followed by a `=` or `;`, recover a missing
    // type.
    ty = this.recover_missing_global_item_type(colon, mutability);
  }

  let expr: Expr | undefined;
  if (this.eat(exp.Eq)) {
    const r4 = this.parse_expr();
    if (r4.$ === "Err") return r4;
    expr = r4._0;
  } else {
    expr = undefined;
  }

  const r5 = this.expect_semi();
  if (r5.$ === "Err") return r5;

  const item: ast.StaticItem = {
    ident,
    ty,
    safety,
    mutability,
    expr,
    define_opaque: undefined,
    eii_impl: undefined,
  };
  return Ok({ $: "Static", _0: item });
};

/// Parse a constant item with the prefix `"const"` already parsed.
///
/// If `const_arg` is true, any expression assigned to the const will be parsed
/// as a const_arg instead of a body expression.
///
/// ```ebnf
/// Const = "const" ($ident | "_") Generics ":" $ty (= $expr)? WhereClause ";" ;
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:1773 parse_const_item
Parser.prototype.parse_const_item = function (
  this: Parser,
  const_span: Span,
): PResult<[Ident, Generics, Ty, Expr | undefined]> {
  const r = this.parse_ident_or_underscore();
  if (r.$ === "Err") return r;
  const ident = r._0;

  const r2 = this.parse_generics();
  if (r2.$ === "Err") return r2;
  const generics = r2._0;

  // Check the span for emptiness instead of the list of parameters in order to correctly
  // recognize and subsequently flag empty parameter lists (`<>`) as unstable.
  if (!Span.is_empty(generics.span)) {
    this.psess.gated_spans.gate(sym.generic_const_items, generics.span);
  }

  // Parse the type of a constant item. That is, the `":" $ty` fragment.
  // FIXME: This could maybe benefit from `.may_recover()`?
  const colon = this.eat(exp.Colon);
  // PORT: `|` (not `||`): all three checks run.
  const check_eq = this.check(exp.Eq);
  const check_semi = this.check(exp.Semi);
  const check_where = this.check_keyword(exp.Where);
  let ty: Ty;
  if (colon && !(check_eq || check_semi || check_where)) {
    const r3 = this.parse_ty();
    if (r3.$ === "Err") return r3;
    ty = r3._0;
  } else {
    // If there wasn't a `:` or the colon was followed by a `=`, `;` or `where`, recover a missing type.
    ty = this.recover_missing_global_item_type(colon, undefined);
  }

  // Proactively parse a where-clause to be able to provide a good error message in case we
  // encounter the item body following it.
  let before_where_clause: ast.WhereClause;
  if (this.may_recover()) {
    const r4 = this.parse_where_clause();
    if (r4.$ === "Err") return r4;
    before_where_clause = r4._0;
  } else {
    before_where_clause = where_clause_default();
  }

  let rhs: Expr | undefined;
  if (this.eat(exp.Eq)) {
    const r5 = this.parse_expr();
    if (r5.$ === "Err") return r5;
    rhs = r5._0;
  } else {
    rhs = undefined;
  }

  const r6 = this.parse_where_clause();
  if (r6.$ === "Err") return r6;
  const after_where_clause = r6._0;

  // Provide a nice error message if the user placed a where-clause before the item body.
  // Users may be tempted to write such code if they are still used to the deprecated
  // where-clause location on type aliases and associated types. See also #89122.
  if (before_where_clause.has_where_token && rhs !== undefined) {
    let sugg: diagnostics.WhereClauseBeforeConstBodySugg | undefined;
    if (!after_where_clause.has_where_token) {
      const s = this.psess.source_map().span_to_snippet(rhs.span);
      sugg =
        s.$ === "Ok"
          ? {
              left: Span.shrink_to_lo(before_where_clause.span),
              snippet: s._0.toString(),
              right: Span.to(Span.shrink_to_hi(before_where_clause.span), rhs.span),
            }
          : undefined;
    } else {
      // FIXME(generic_const_items): Provide a structured suggestion to merge the first
      // where-clause into the second one.
      sugg = undefined;
    }
    this.dcx().emit_err(
      diagnostics.WhereClauseBeforeConstBody_diagnostic({
        span: before_where_clause.span,
        name: ident.span,
        body: rhs.span,
        sugg,
      }),
    );
  }

  // Merge the predicates of both where-clauses since either one can be relevant.
  // If we didn't parse a body (which is valid for associated consts in traits) and we were
  // allowed to recover, `before_where_clause` contains the predicates, otherwise they are
  // in `after_where_clause`. Further, both of them might contain predicates iff two
  // where-clauses were provided which is syntactically ill-formed but we want to recover from
  // it and treat them as one large where-clause.
  const predicates = before_where_clause.predicates;
  predicates.push(...after_where_clause.predicates);
  const where_clause = new ast.WhereClause(
    before_where_clause.has_where_token || after_where_clause.has_where_token,
    predicates,
    after_where_clause.has_where_token ? after_where_clause.span : before_where_clause.span,
  );

  if (where_clause.has_where_token) {
    this.psess.gated_spans.gate(sym.generic_const_items, where_clause.span);
  }

  generics.where_clause = where_clause;

  const rhs_ = this.try_recover_const_missing_semi(rhs, const_span);
  if (rhs_ !== undefined) {
    return Ok([ident, generics, ty, rhs_]);
  }
  const r7 = this.expect_semi();
  if (r7.$ === "Err") return r7;

  return Ok([ident, generics, ty, rhs]);
};

/// We were supposed to parse `":" $ty` but the `:` or the type was missing.
/// This means that the type is missing.
// rustc: compiler/rustc_parse/src/parser/item.rs:1868 recover_missing_global_item_type
Parser.prototype.recover_missing_global_item_type = function (
  this: Parser,
  colon_present: boolean,
  m: Mutability | undefined,
): Ty {
  // Construct the error and stash it away with the hope
  // that typeck will later enrich the error with a type.
  let kind: string;
  switch (m) {
    case "Mut":
      kind = "static mut";
      break;
    case "Not":
      kind = "static";
      break;
    case undefined:
      kind = "const";
      break;
  }

  const colon = colon_present ? "" : ":";

  const span = Span.shrink_to_hi(this.prev_token.span);
  const err = this.dcx().create_err(diagnostics.MissingConstType_diagnostic({ span, colon, kind }));
  err.stash(span, StashKey.ItemNoType);

  // The user intended that the type be inferred,
  // so treat this as if the user wrote e.g. `const A: _ = expr;`.
  return new ast.Ty(DUMMY_NODE_ID, ast.TyKind.Infer, span);
};

/// Parses an enum declaration.
// rustc: compiler/rustc_parse/src/parser/item.rs:1896 parse_item_enum
Parser.prototype.parse_item_enum = function (this: Parser): PResult<ItemKind> {
  if (this.token.is_keyword(kw.Struct)) {
    const span = Span.to(this.prev_token.span, this.token.span);
    const err: diagnostics.EnumStructMutuallyExclusive = { span };
    if (this.look_ahead(1, (t) => t.is_ident())) {
      this.bump();
      this.dcx().emit_err(diagnostics.EnumStructMutuallyExclusive_diagnostic(err));
    } else {
      return Err(this.dcx().create_err(diagnostics.EnumStructMutuallyExclusive_diagnostic(err)));
    }
  }

  const prev_span = this.prev_token.span;
  const r = this.parse_ident();
  if (r.$ === "Err") return r;
  const ident = r._0;
  const r2 = this.parse_generics();
  if (r2.$ === "Err") return r2;
  const generics = r2._0;
  const r3 = this.parse_where_clause();
  if (r3.$ === "Err") return r3;
  generics.where_clause = r3._0;

  // Possibly recover `enum Foo;` instead of `enum Foo {}`
  let variants: (Variant | undefined)[];
  if (this.token.eq(TokenKind.Semi)) {
    this.dcx().emit_err(diagnostics.UseEmptyBlockNotSemi_diagnostic({ span: this.token.span }));
    this.bump();
    variants = [];
  } else {
    const r4 = this.parse_delim_comma_seq(exp.OpenBrace, exp.CloseBrace, (p) => p.parse_enum_variant(ident.span));
    if (r4.$ === "Err") {
      const err = r4._0;
      err.span_label(ident.span, "while parsing this enum");
      // Try to recover `enum Foo { ident : Ty }`.
      if (this.prev_token.is_non_reserved_ident() && this.token.eq(TokenKind.Colon)) {
        const snapshot = this.create_snapshot_for_diagnostic();
        this.bump();
        const r5 = this.parse_ty();
        switch (r5.$) {
          case "Ok":
            err.span_suggestion_verbose(
              prev_span,
              "perhaps you meant to use `struct` here",
              "struct",
              Applicability.MaybeIncorrect,
            );
            break;
          case "Err": {
            const e = r5._0;
            e.cancel();
            break;
          }
        }
        this.restore_snapshot(snapshot);
      }
      this.eat_to_tokens([exp.CloseBrace]);
      this.bump(); // }
      return Err(err);
    }
    variants = r4._0[0];
  }

  const enum_definition: ast.EnumDef = { variants: variants.filter((v): v is Variant => v !== undefined) };
  return Ok({ $: "Enum", _0: ident, _1: generics, _2: enum_definition });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:1953 parse_enum_variant
Parser.prototype.parse_enum_variant = function (this: Parser, span: Span): PResult<Variant | undefined> {
  this.recover_vcs_conflict_marker();
  const r = this.parse_outer_attributes();
  if (r.$ === "Err") return r;
  const variant_attrs = r._0;
  this.recover_vcs_conflict_marker();
  const help =
    "enum variants can be `Variant`, `Variant = <integer>`, " +
    "`Variant(Type, ..., TypeN)` or `Variant { fields: Types }`";
  const r2 = this.collect_tokens(
    undefined,
    variant_attrs,
    ForceCollect.No,
    (this_, variant_attrs): PResult<[Variant | undefined, Trailing, UsePreAttrPos]> => {
      const vlo = this_.token.span;

      const r = this_.parse_visibility(FollowedByType.No);
      if (r.$ === "Err") return r;
      const vis = r._0;
      const r2 = this_.recover_nested_adt_item(kw.Enum);
      if (r2.$ === "Err") return r2;
      if (!r2._0) {
        return Ok([undefined, Trailing.No, "No" as UsePreAttrPos]);
      }
      const r3 = this_.parse_field_ident("enum", vlo);
      if (r3.$ === "Err") return r3;
      const ident = r3._0;

      if (this_.token.eq(TokenKind.Bang)) {
        const r4 = this_.unexpected();
        if (r4.$ === "Err") {
          const err = r4._0;
          err.with_note(msg("macros cannot expand to enum variants")).emit();
        }

        this_.bump();
        const r5 = this_.parse_delim_args();
        if (r5.$ === "Err") return r5;

        return Ok([undefined, Trailing.from(this_.token.eq(TokenKind.Comma)), "No" as UsePreAttrPos]);
      }

      let struct_def: VariantData;
      if (this_.check(exp.OpenBrace)) {
        // Parse a struct variant.
        let fields: FieldDef[];
        let recovered: ast.Recovered;
        const r6 = this_.parse_record_struct_body("struct", ident.span, false);
        switch (r6.$) {
          case "Ok":
            [fields, recovered] = r6._0;
            break;
          case "Err": {
            const err = r6._0;
            if (this_.token.eq(TokenKind.Colon)) {
              // We handle `enum` to `struct` suggestion in the caller.
              return Err(err);
            }
            this_.eat_to_tokens([exp.CloseBrace]);
            this_.bump(); // }
            err.span_label(span, "while parsing this enum");
            err.help(help);
            const guar = err.emit_err();
            [fields, recovered] = [[], { $: "Yes", _0: guar }];
            break;
          }
        }
        struct_def = { $: "Struct", fields, recovered };
      } else if (this_.check(exp.OpenParen)) {
        let body: FieldDef[];
        const r6 = this_.parse_tuple_struct_body();
        switch (r6.$) {
          case "Ok":
            body = r6._0;
            break;
          case "Err": {
            const err = r6._0;
            if (this_.token.eq(TokenKind.Colon)) {
              // We handle `enum` to `struct` suggestion in the caller.
              return Err(err);
            }
            this_.eat_to_tokens([exp.CloseParen]);
            this_.bump(); // )
            err.span_label(span, "while parsing this enum");
            err.help(help);
            err.emit();
            body = [];
            break;
          }
        }
        struct_def = { $: "Tuple", _0: body, _1: DUMMY_NODE_ID };
      } else {
        struct_def = { $: "Unit", _0: DUMMY_NODE_ID };
      }

      let disr_expr: AnonConst | undefined;
      if (this_.eat(exp.Eq)) {
        const r7 = this_.parse_expr_anon_const();
        if (r7.$ === "Err") return r7;
        disr_expr = r7._0;
      } else {
        disr_expr = undefined;
      }

      const span_ = Span.to(vlo, this_.prev_token.span);
      if (ident.name === kw.Underscore) {
        this_.psess.gated_spans.gate(sym.unnamed_enum_variants, span_);
      }
      const vr: Variant = {
        ident,
        vis,
        id: DUMMY_NODE_ID,
        attrs: variant_attrs,
        data: struct_def,
        disr_expr,
        span: span_,
        is_placeholder: false,
      };

      return Ok([vr, Trailing.from(this_.token.eq(TokenKind.Comma)), "No" as UsePreAttrPos]);
    },
    HasTokens.Option(HasTokens.Variant),
    HasAttrs.Option(HasAttrs.Variant),
  );
  if (r2.$ === "Err") {
    const err = r2._0;
    err.help(help);
    return Err(err);
  }
  return r2;
};

/// Parses `struct Foo { ... }`.
// rustc: compiler/rustc_parse/src/parser/item.rs:2046 parse_item_struct
Parser.prototype.parse_item_struct = function (this: Parser): PResult<ItemKind> {
  const r = this.parse_ident();
  if (r.$ === "Err") return r;
  const ident = r._0;

  const r2 = this.parse_generics();
  if (r2.$ === "Err") return r2;
  const generics = r2._0;

  // There is a special case worth noting here, as reported in issue #17904.
  // If we are parsing a tuple struct it is the case that the where clause
  // should follow the field list. Like so:
  //
  // struct Foo<T>(T) where T: Copy;
  //
  // If we are parsing a normal record-style struct it is the case
  // that the where clause comes before the body, and after the generics.
  // So if we look ahead and see a brace or a where-clause we begin
  // parsing a record style struct.
  //
  // Otherwise if we look ahead and see a paren we parse a tuple-style
  // struct.

  let vdata: VariantData;
  if (this.token.is_keyword(kw.Where)) {
    let tuple_struct_body: FieldDef[] | undefined;
    const r3 = this.parse_struct_where_clause(ident, generics.span);
    if (r3.$ === "Err") return r3;
    [generics.where_clause, tuple_struct_body] = r3._0;

    if (tuple_struct_body !== undefined) {
      const body_ = tuple_struct_body;
      // If we see a misplaced tuple struct body: `struct Foo<T> where T: Copy, (T);`
      const body: VariantData = { $: "Tuple", _0: body_, _1: DUMMY_NODE_ID };
      const r4 = this.expect_semi();
      if (r4.$ === "Err") return r4;
      vdata = body;
    } else if (this.eat(exp.Semi)) {
      // If we see a: `struct Foo<T> where T: Copy;` style decl.
      vdata = { $: "Unit", _0: DUMMY_NODE_ID };
    } else {
      // If we see: `struct Foo<T> where T: Copy { ... }`
      const r4 = this.parse_record_struct_body("struct", ident.span, generics.where_clause.has_where_token);
      if (r4.$ === "Err") return r4;
      const [fields, recovered] = r4._0;
      vdata = { $: "Struct", fields, recovered };
    }
    // No `where` so: `struct Foo<T>;`
  } else if (this.eat(exp.Semi)) {
    vdata = { $: "Unit", _0: DUMMY_NODE_ID };
    // Record-style struct definition
  } else if (this.token.eq(TokenKind.OpenBrace)) {
    const r4 = this.parse_record_struct_body("struct", ident.span, generics.where_clause.has_where_token);
    if (r4.$ === "Err") return r4;
    const [fields, recovered] = r4._0;
    vdata = { $: "Struct", fields, recovered };
    // Tuple-style struct definition with optional where-clause.
  } else if (this.token.eq(TokenKind.OpenParen)) {
    const r4 = this.parse_tuple_struct_body();
    if (r4.$ === "Err") return r4;
    const body: VariantData = { $: "Tuple", _0: r4._0, _1: DUMMY_NODE_ID };
    const r5 = this.parse_where_clause();
    if (r5.$ === "Err") return r5;
    generics.where_clause = r5._0;
    const r6 = this.expect_semi();
    if (r6.$ === "Err") return r6;
    vdata = body;
  } else {
    const err = diagnostics.UnexpectedTokenAfterStructName.new(this.token.span, this.token);
    return Err(this.dcx().create_err(diagnostics.UnexpectedTokenAfterStructName_diagnostic(err)));
  }

  return Ok({ $: "Struct", _0: ident, _1: generics, _2: vdata });
};

/// Parses `union Foo { ... }`.
// rustc: compiler/rustc_parse/src/parser/item.rs:2113 parse_item_union
Parser.prototype.parse_item_union = function (this: Parser): PResult<ItemKind> {
  const r = this.parse_ident();
  if (r.$ === "Err") return r;
  const ident = r._0;

  const r2 = this.parse_generics();
  if (r2.$ === "Err") return r2;
  const generics = r2._0;

  let vdata: VariantData;
  if (this.token.is_keyword(kw.Where)) {
    const r3 = this.parse_where_clause();
    if (r3.$ === "Err") return r3;
    generics.where_clause = r3._0;
    const r4 = this.parse_record_struct_body("union", ident.span, generics.where_clause.has_where_token);
    if (r4.$ === "Err") return r4;
    const [fields, recovered] = r4._0;
    vdata = { $: "Struct", fields, recovered };
  } else if (this.token.eq(TokenKind.OpenBrace)) {
    const r4 = this.parse_record_struct_body("union", ident.span, generics.where_clause.has_where_token);
    if (r4.$ === "Err") return r4;
    const [fields, recovered] = r4._0;
    vdata = { $: "Struct", fields, recovered };
  } else {
    const token_str = token_descr(this.token);
    const msg_ = `expected \`where\` or \`{\` after union name, found ${token_str}`;
    const err = this.dcx().struct_span_err(this.token.span, msg_);
    err.span_label(this.token.span, "expected `where` or `{` after union name");
    return Err(err);
  }

  return Ok({ $: "Union", _0: ident, _1: generics, _2: vdata });
};

/// This function parses the fields of record structs:
///
///   - `struct S { ... }`
///   - `enum E { Variant { ... } }`
// rustc: compiler/rustc_parse/src/parser/item.rs:2148 parse_record_struct_body
Parser.prototype.parse_record_struct_body = function (
  this: Parser,
  adt_ty: string,
  ident_span: Span,
  parsed_where: boolean,
): PResult<[FieldDef[], ast.Recovered]> {
  const fields: FieldDef[] = [];
  let recovered: ast.Recovered = ast.Recovered.No;
  if (this.eat(exp.OpenBrace)) {
    while (!this.token.eq(TokenKind.CloseBrace)) {
      const r = this.parse_field_def(adt_ty, ident_span);
      if (r.$ === "Ok") {
        const field = r._0;
        fields.push(field);
      } else {
        const err = r._0;
        this.consume_block(exp.OpenBrace, exp.CloseBrace, ConsumeClosingDelim.No);
        err.span_label(ident_span, `while parsing this ${adt_ty}`);
        const guar = err.emit_err();
        recovered = { $: "Yes", _0: guar };
        break;
      }
    }
    const r2 = this.expect(exp.CloseBrace);
    if (r2.$ === "Err") return r2;
  } else {
    const token_str = token_descr(this.token);
    const where_str = parsed_where ? "" : "`where`, or ";
    const msg_ = `expected ${where_str}\`{\` after struct name, found ${token_str}`;
    const err = this.dcx().struct_span_err(this.token.span, msg_);
    err.span_label(this.token.span, `expected ${where_str}\`{\` after struct name`);
    return Err(err);
  }

  return Ok([fields, recovered]);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2188 parse_unsafe_field
Parser.prototype.parse_unsafe_field = function (this: Parser): Safety {
  // not using parse_safety as that also accepts `safe`.
  if (this.eat_keyword(exp.Unsafe)) {
    const span = this.prev_token.span;
    this.psess.gated_spans.gate(sym.unsafe_fields, span);
    return { $: "Unsafe", _0: span };
  } else {
    return ast.Safety.Default;
  }
};

/// This is the case where we find `struct Foo<T>(T) where T: Copy;`
/// Unit like structs are handled in parse_item_struct function
// rustc: compiler/rustc_parse/src/parser/item.rs:2200 parse_tuple_struct_body
Parser.prototype.parse_tuple_struct_body = function (this: Parser): PResult<FieldDef[]> {
  const openparen_span = this.token.span;
  let encountered_colon = false;
  const r = this.parse_paren_comma_seq((p): PResult<FieldDef> => {
    const r = p.parse_outer_attributes();
    if (r.$ === "Err") return r;
    const attrs = r._0;
    return p.collect_tokens(
      undefined,
      attrs,
      ForceCollect.No,
      (p, attrs): PResult<[FieldDef, Trailing, UsePreAttrPos]> => {
        let snapshot: SnapshotParser | undefined = undefined;
        if (p.is_vcs_conflict_marker(TokenKind.Shl, TokenKind.Lt)) {
          // Account for `<<<<<<<` diff markers. We can't proactively error here because
          // that can be a valid type start, so we snapshot and reparse only we've
          // encountered another parse error.
          snapshot = p.create_snapshot_for_diagnostic();
        }
        const lo = p.token.span;
        let vis: Visibility;
        const r = p.parse_visibility(FollowedByType.Yes);
        switch (r.$) {
          case "Ok":
            vis = r._0;
            break;
          case "Err": {
            const err = r._0;
            if (snapshot !== undefined) {
              snapshot.parser.recover_vcs_conflict_marker();
            }
            return Err(err);
          }
        }
        const r2 = p.parse_mut_restriction();
        if (r2.$ === "Err") return r2;
        const mut_restriction = r2._0;
        encountered_colon ||= p.token.is_ident() && p.look_ahead(1, (tok) => tok.eq(TokenKind.Colon));
        // Unsafe fields are not supported in tuple structs, as doing so would result in a
        // parsing ambiguity for `struct X(unsafe fn())`.
        let ty: Ty;
        const r3 = p.parse_ty();
        switch (r3.$) {
          case "Ok":
            ty = r3._0;
            break;
          case "Err": {
            const err = r3._0;
            if (snapshot !== undefined) {
              snapshot.parser.recover_vcs_conflict_marker();
            }
            return Err(err);
          }
        }
        let default_: AnonConst | undefined = undefined;
        if (p.token.eq(TokenKind.Eq)) {
          const snapshot = p.create_snapshot_for_diagnostic();
          snapshot.parser.bump();
          const r4 = snapshot.parser.parse_expr_anon_const();
          switch (r4.$) {
            case "Ok": {
              const const_expr = r4._0;
              const sp = Span.to(Span.shrink_to_hi(ty.span), const_expr.value.span);
              p.psess.gated_spans.gate(sym.default_field_values, sp);
              p.restore_snapshot(snapshot);
              default_ = const_expr;
              break;
            }
            case "Err": {
              const err = r4._0;
              err.cancel();
              break;
            }
          }
        }

        return Ok([
          new ast.FieldDef(
            attrs,
            DUMMY_NODE_ID,
            Span.to(lo, ty.span),
            vis,
            field_def_extras(ast.Safety.Default, mut_restriction, default_),
            undefined,
            ty,
            false,
          ),
          Trailing.from(p.token.eq(TokenKind.Comma)),
          "No" as UsePreAttrPos,
        ]);
      },
      HasTokens.FieldDef,
      HasAttrs.FieldDef,
    );
  });
  if (r.$ === "Err") {
    const error = r._0;
    if (this.token.eq(TokenKind.Colon)) {
      error.subdiagnostic(diagnostics.UseDoubleColonSuggestion_subdiagnostic({ colon: this.token.span }));
    }
    if (encountered_colon) {
      this.eat_to_tokens([exp.CloseParen]);
      this.bump();
      error.subdiagnostic(
        diagnostics.UseRegularStructSuggestion_subdiagnostic({
          open: openparen_span,
          close: this.prev_token.span,
          semicolon: this.token.eq(TokenKind.Semi) ? this.token.span : undefined,
        }),
      );
    }
    return Err(error);
  }
  return Ok(r._0[0]);
};

// Parser::field_def_extras (an associated fn without `self`).
// rustc: compiler/rustc_parse/src/parser/item.rs:2288 field_def_extras
export function field_def_extras(
  safety: Safety,
  mut_restriction: MutRestriction,
  default_: AnonConst | undefined,
): FieldDefExtras | undefined {
  if (
    safety.$ === "Default" &&
    // We are throwing away the mut restriction span here.
    // see the span field comment for more info
    mut_restriction.kind.$ === "Unrestricted" &&
    default_ === undefined
  ) {
    return undefined;
  } else {
    return { safety, mut_restriction, default: default_ };
  }
}

/// Parses an element of a struct declaration.
// rustc: compiler/rustc_parse/src/parser/item.rs:2308 parse_field_def
Parser.prototype.parse_field_def = function (this: Parser, adt_ty: string, ident_span: Span): PResult<FieldDef> {
  this.recover_vcs_conflict_marker();
  const r = this.parse_outer_attributes();
  if (r.$ === "Err") return r;
  const attrs = r._0;
  this.recover_vcs_conflict_marker();
  return this.collect_tokens(
    undefined,
    attrs,
    ForceCollect.No,
    (this_, attrs): PResult<[FieldDef, Trailing, UsePreAttrPos]> => {
      const lo = this_.token.span;
      const r = this_.parse_visibility(FollowedByType.No);
      if (r.$ === "Err") return r;
      const vis = r._0;
      const r2 = this_.parse_mut_restriction();
      if (r2.$ === "Err") return r2;
      const mut_restriction = r2._0;
      const safety = this_.parse_unsafe_field();
      const r3 = this_.parse_single_struct_field(adt_ty, lo, vis, mut_restriction, safety, attrs, ident_span);
      if (r3.$ === "Err") return r3;
      return Ok([r3._0, Trailing.No, "No" as UsePreAttrPos]);
    },
    HasTokens.FieldDef,
    HasAttrs.FieldDef,
  );
};

/// Parses a structure field declaration.
// rustc: compiler/rustc_parse/src/parser/item.rs:2331 parse_single_struct_field
Parser.prototype.parse_single_struct_field = function (
  this: Parser,
  adt_ty: string,
  lo: Span,
  vis: Visibility,
  mut_restriction: MutRestriction,
  safety: Safety,
  attrs: AttrVec,
  ident_span: Span,
): PResult<FieldDef> {
  const r = this.parse_name_and_ty(adt_ty, lo, vis, mut_restriction, safety, attrs);
  if (r.$ === "Err") return r;
  const a_var = r._0;
  switch (this.token.kind.$) {
    case "Comma": {
      this.bump();
      break;
    }
    case "Semi": {
      this.bump();
      const sp = this.prev_token.span;
      const err = this.dcx().struct_span_err(sp, `${adt_ty} fields are separated by \`,\``);
      err.span_suggestion_short(sp, "replace `;` with `,`", ",", Applicability.MachineApplicable);
      err.span_label(ident_span, `while parsing this ${adt_ty}`);
      err.emit();
      break;
    }
    case "CloseBrace":
      break;
    case "DocComment": {
      const previous_span = this.prev_token.span;
      const err: diagnostics.DocCommentDoesNotDocumentAnything = {
        span: this.token.span,
        missing_comma: undefined,
      };
      this.bump(); // consume the doc comment
      if (this.eat(exp.Comma) || this.token.eq(TokenKind.CloseBrace)) {
        this.dcx().emit_err(diagnostics.DocCommentDoesNotDocumentAnything_diagnostic(err));
      } else {
        const sp = Span.shrink_to_hi(previous_span);
        err.missing_comma = sp;
        return Err(this.dcx().create_err(diagnostics.DocCommentDoesNotDocumentAnything_diagnostic(err)));
      }
      break;
    }
    default: {
      const sp = Span.shrink_to_hi(this.prev_token.span);
      const msg_ = `expected \`,\`, or \`}\`, found ${token_descr(this.token)}`;

      // Try to recover extra trailing angle brackets
      const k = a_var.ty.kind;
      if (k.$ === "Path") {
        const segments = k._1.segments;
        const last_segment = segments[segments.length - 1];
        if (last_segment !== undefined) {
          const guar = this.check_trailing_angle_brackets(last_segment, [exp.Comma, exp.CloseBrace]);
          if (guar !== undefined) {
            // Handle a case like `Vec<u8>>,` where we can continue parsing fields
            // after the comma
            this.eat(exp.Comma);

            // `check_trailing_angle_brackets` already emitted a nicer error, as
            // proven by the presence of `_guar`. We can continue parsing.
            return Ok(a_var);
          }
        }
      }

      const err = this.dcx().struct_span_err(sp, msg_);

      if (
        this.token.is_ident() ||
        (this.token.eq(TokenKind.Pound) && this.look_ahead(1, (t) => t.eq(TokenKind.OpenBracket)))
      ) {
        // This is likely another field, TokenKind::Pound is used for `#[..]`
        // attribute for next field. Emit the diagnostic and continue parsing.
        err.span_suggestion(sp, "try adding a comma", ",", Applicability.MachineApplicable);
        err.emit();
      } else {
        return Err(err);
      }
      break;
    }
  }
  return Ok(a_var);
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2423 expect_field_ty_separator
Parser.prototype.expect_field_ty_separator = function (this: Parser): PResult<undefined> {
  const r = this.expect(exp.Colon);
  if (r.$ === "Err") {
    const err = r._0;
    const sm = this.psess.source_map();
    const eq_typo = this.token.eq(TokenKind.Eq) && this.look_ahead(1, (t) => t.is_path_start());
    const semi_typo =
      this.token.eq(TokenKind.Semi) &&
      this.look_ahead(1, (t) => {
        if (!t.is_path_start()) return false;
        // We check that we are in a situation like `foo; bar` to avoid bad suggestions
        // when there's no type and `;` was used instead of a comma.
        const l = sm.lookup_line(Span.hi(this.token.span));
        const r_ = sm.lookup_line(Span.lo(t.span));
        if (l.$ === "Ok" && r_.$ === "Ok") {
          return l._0.line === r_._0.line;
        } else {
          return true;
        }
      });
    if (eq_typo || semi_typo) {
      this.bump();
      // Gracefully handle small typos.
      err
        .with_span_suggestion_short(
          this.prev_token.span,
          "field names and their types are separated with `:`",
          ":",
          Applicability.MachineApplicable,
        )
        .emit();
    } else {
      return Err(err);
    }
  }
  return Ok(undefined);
};

/// Parses a structure field.
// rustc: compiler/rustc_parse/src/parser/item.rs:2455 parse_name_and_ty
Parser.prototype.parse_name_and_ty = function (
  this: Parser,
  adt_ty: string,
  lo: Span,
  vis: Visibility,
  mut_restriction: MutRestriction,
  safety: Safety,
  attrs: AttrVec,
): PResult<FieldDef> {
  const r = this.parse_field_ident(adt_ty, lo);
  if (r.$ === "Err") return r;
  const name = r._0;
  if (this.token.eq(TokenKind.Bang)) {
    const r2 = this.unexpected();
    if (r2.$ === "Err") {
      const err = r2._0;
      // Encounter the macro invocation
      err.subdiagnostic(diagnostics.MacroExpandsToAdtField_subdiagnostic({ adt_ty }));
      return Err(err);
    }
  }
  const r3 = this.expect_field_ty_separator();
  if (r3.$ === "Err") return r3;
  const r4 = this.parse_ty();
  if (r4.$ === "Err") return r4;
  const ty = r4._0;
  if (this.token.eq(TokenKind.Colon) && this.look_ahead(1, (t) => !t.eq(TokenKind.Colon))) {
    return Err(
      this.dcx()
        .struct_span_err(this.token.span, "found single colon in a struct field type path")
        .with_span_suggestion_verbose(
          this.token.span,
          "write a path separator here",
          "::",
          Applicability.MaybeIncorrect,
        ),
    );
  }
  let default_: AnonConst | undefined;
  if (this.token.eq(TokenKind.Eq)) {
    this.bump();
    const r5 = this.parse_expr_anon_const();
    if (r5.$ === "Err") return r5;
    const const_expr = r5._0;
    const sp = Span.to(Span.shrink_to_hi(ty.span), const_expr.value.span);
    this.psess.gated_spans.gate(sym.default_field_values, sp);
    default_ = const_expr;
  } else {
    default_ = undefined;
  }
  return Ok(
    new ast.FieldDef(
      attrs,
      DUMMY_NODE_ID,
      Span.to(lo, this.prev_token.span),
      vis,
      field_def_extras(safety, mut_restriction, default_),
      name,
      ty,
      false,
    ),
  );
};

/// Parses a field identifier. Specialized version of `parse_ident_common`
/// for better diagnostics and suggestions.
// rustc: compiler/rustc_parse/src/parser/item.rs:2508 parse_field_ident
Parser.prototype.parse_field_ident = function (this: Parser, adt_ty: string, lo: Span): PResult<Ident> {
  const r = this.ident_or_err(true);
  if (r.$ === "Err") return r;
  const [ident, kind] = r._0;
  if (token.ident_of_kind_is_reserved(ident, kind) && !(ident.name === kw.Underscore && adt_ty === "enum")) {
    const snapshot = this.create_snapshot_for_diagnostic();
    let err: Diag;
    if (this.check_fn_front_matter(false, Case.Sensitive)) {
      const inherited_vis: Visibility = { span: DUMMY_SP, kind: ast.VisibilityKind.Inherited };
      // We use `parse_fn` to get a span for the function
      const fn_parse_mode: FnParseMode = { req_name: (_, __) => true, context: "Free", req_body: true };
      const r2 = this.parse_fn([], fn_parse_mode, lo, inherited_vis, Case.Insensitive);
      switch (r2.$) {
        case "Ok":
          err = this.dcx()
            .struct_span_err(Span.to(lo, this.prev_token.span), `functions are not allowed in ${adt_ty} definitions`)
            .with_help("unlike in C++, Java, and C#, functions are declared in `impl` blocks")
            .with_help("see https://doc.rust-lang.org/book/ch05-03-method-syntax.html " + "for more information");
          break;
        case "Err": {
          const err_ = r2._0;
          err_.cancel();
          this.restore_snapshot(snapshot);
          err = this.expected_ident_found_err();
          break;
        }
      }
    } else if (this.eat_keyword(exp.Struct)) {
      const r2 = this.parse_item_struct();
      switch (r2.$) {
        case "Ok": {
          const item = r2._0;
          if (item.$ !== "Struct") {
            unreachable();
          }
          const ident = item._0;
          err = this.dcx()
            .struct_span_err(
              Span.with_hi(lo, Span.hi(ident.span)),
              `structs are not allowed in ${adt_ty} definitions`,
            )
            .with_help("consider creating a new `struct` definition instead of nesting");
          break;
        }
        case "Err": {
          const err_ = r2._0;
          err_.cancel();
          this.restore_snapshot(snapshot);
          err = this.expected_ident_found_err();
          break;
        }
      }
    } else {
      const err_ = this.expected_ident_found_err();
      // PORT: the `if let` chain below; its `else` runs whenever any condition fails.
      let chain_ok = false;
      if (this.eat_keyword_noexpect(kw.Let)) {
        const removal_span = Span.until(this.prev_token.span, this.token.span);
        const r2 = this.parse_ident_common(false);
        if (r2.$ === "Err") {
          // Cancel this error, we don't need it.
          r2._0.cancel();
        } else if (this.token.eq(TokenKind.Colon)) {
          chain_ok = true;
          const ident = r2._0;
          err_.span_suggestion_verbose(
            removal_span,
            "remove the `let` keyword",
            "",
            Applicability.MachineApplicable,
          );
          err_.note("the `let` keyword is not allowed in `struct` fields");
          err_.note(
            "see <https://doc.rust-lang.org/book/ch05-01-defining-structs.html> " + "for more information",
          );
          err_.emit();
          return Ok(ident);
        }
      }
      if (!chain_ok) {
        this.restore_snapshot(snapshot);
      }
      err = err_;
    }
    return Err(err);
  }
  this.bump();
  return Ok(ident);
};

/// Parses a declarative macro 2.0 definition.
/// The `macro` keyword has already been parsed.
/// ```ebnf
/// MacBody = "{" TOKEN_STREAM "}" ;
/// MacParams = "(" TOKEN_STREAM ")" ;
/// DeclMac = "macro" Ident MacParams? MacBody ;
/// ```
// rustc: compiler/rustc_parse/src/parser/item.rs:2605 parse_item_decl_macro
Parser.prototype.parse_item_decl_macro = function (this: Parser, lo: Span): PResult<ItemKind> {
  const r = this.parse_ident();
  if (r.$ === "Err") return r;
  const ident = r._0;
  let body: DelimArgs;
  if (this.check(exp.OpenBrace)) {
    const r2 = this.parse_delim_args(); // `MacBody`
    if (r2.$ === "Err") return r2;
    body = r2._0;
  } else if (this.check(exp.OpenParen)) {
    const params = this.parse_token_tree(); // `MacParams`
    const pspan = tokenstream.TokenTree.span(params);
    if (!this.check(exp.OpenBrace)) {
      const r3 = this.unexpected();
      if (r3.$ === "Err") return r3;
    }
    const body_ = this.parse_token_tree(); // `MacBody`
    // Convert `MacParams MacBody` into `{ MacParams => MacBody }`.
    const bspan = tokenstream.TokenTree.span(body_);
    const arrow = tokenstream.TokenTree.token_alone(TokenKind.FatArrow, Span.between(pspan, bspan)); // `=>`
    const tokens = tokenstream.TokenStream.new([params, arrow, body_]);
    const dspan = tokenstream.DelimSpan.from_pair(Span.shrink_to_lo(pspan), Span.shrink_to_hi(bspan));
    body = new ast.DelimArgs(dspan, token.Delimiter.Brace, tokens);
  } else {
    const r3 = this.unexpected_any<DelimArgs>();
    if (r3.$ === "Err") return r3;
    body = r3._0;
  }

  this.psess.gated_spans.gate(sym.decl_macro, Span.to(lo, this.prev_token.span));
  return Ok({ $: "MacroDef", _0: ident, _1: { body, macro_rules: false, eii_declaration: undefined } });
};

/// Is this a possibly malformed start of a `macro_rules! foo` item definition?
// rustc: compiler/rustc_parse/src/parser/item.rs:2634 is_macro_rules_item
Parser.prototype.is_macro_rules_item = function (this: Parser): IsMacroRulesItem {
  if (this.check_keyword(exp.MacroRules)) {
    const macro_rules_span = this.token.span;

    if (this.look_ahead(1, (t) => t.eq(TokenKind.Bang)) && this.look_ahead(2, (t) => t.is_ident())) {
      return { $: "Yes", has_bang: true };
    } else if (this.look_ahead(1, (t) => t.is_ident())) {
      // macro_rules foo
      this.dcx().emit_err(
        diagnostics.MacroRulesMissingBang_diagnostic({
          span: macro_rules_span,
          hi: Span.shrink_to_hi(macro_rules_span),
        }),
      );

      return { $: "Yes", has_bang: false };
    }
  }

  return { $: "No" };
};

/// Parses a `macro_rules! foo { ... }` declarative macro.
// rustc: compiler/rustc_parse/src/parser/item.rs:2655 parse_item_macro_rules
Parser.prototype.parse_item_macro_rules = function (this: Parser, vis: Visibility, has_bang: boolean): PResult<ItemKind> {
  const r = this.expect_keyword(exp.MacroRules); // `macro_rules`
  if (r.$ === "Err") return r;

  if (has_bang) {
    const r2 = this.expect(exp.Bang); // `!`
    if (r2.$ === "Err") return r2;
  }
  const r3 = this.parse_ident();
  if (r3.$ === "Err") return r3;
  const ident = r3._0;

  if (this.eat(exp.Bang)) {
    // Handle macro_rules! foo!
    const span = this.prev_token.span;
    this.dcx().emit_err(diagnostics.MacroNameRemoveBang_diagnostic({ span }));
  }

  const r4 = this.parse_delim_args();
  if (r4.$ === "Err") return r4;
  const body = r4._0;
  this.eat_semi_for_macro_if_needed(body, undefined);
  this.complain_if_pub_macro(vis, true);

  return Ok({ $: "MacroDef", _0: ident, _1: { body, macro_rules: true, eii_declaration: undefined } });
};

/// Item macro invocations or `macro_rules!` definitions need inherited visibility.
/// If that's not the case, emit an error.
// rustc: compiler/rustc_parse/src/parser/item.rs:2685 complain_if_pub_macro
Parser.prototype.complain_if_pub_macro = function (this: Parser, vis: Visibility, macro_rules: boolean): void {
  if (vis.kind.$ === "Inherited") {
    return;
  }

  const vstr_ = pprust.vis_to_string(vis);
  const vstr = vstr_.trimEnd();
  if (macro_rules) {
    this.dcx().emit_err(diagnostics.MacroRulesVisibility_diagnostic({ span: vis.span, vis: vstr }));
  } else {
    this.dcx().emit_err(diagnostics.MacroInvocationVisibility_diagnostic({ span: vis.span, vis: vstr }));
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2700 eat_semi_for_macro_if_needed
Parser.prototype.eat_semi_for_macro_if_needed = function (this: Parser, args: DelimArgs, path: Path | undefined): void {
  if (args.need_semicolon() && !this.eat(exp.Semi)) {
    this.report_invalid_macro_expansion_item(args, path);
  }
};

/// Parses the contents of a `test_binder_constraints!`. Perma-unstable and for testing only.
// rustc: compiler/rustc_parse/src/parser/item.rs:2707 parse_test_binder_constraints
Parser.prototype.parse_test_binder_constraints = function (this: Parser): PResult<TestBinderConstraints> {
  const r = this.expect_keyword(exp.Impl);
  if (r.$ === "Err") return r;
  const r2 = this.parse_generics();
  if (r2.$ === "Err") return r2;
  const generics = r2._0;
  const r3 = this.parse_where_clause();
  if (r3.$ === "Err") return r3;
  generics.where_clause = r3._0;
  const r4 = this.parse_test_binder_body();
  if (r4.$ === "Err") return r4;
  const body = r4._0;
  return Ok({ generics, body });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2715 parse_test_binder_body
Parser.prototype.parse_test_binder_body = function (this: Parser): PResult<TestBinderBody> {
  const foralls: TestBinderForall[] = [];
  const exists: TestBinderExists[] = [];
  const constraints: TestBinderConstraint[] = [];
  const predicates: ast.WherePredicate[] = [];
  const r = this.parse_delim_comma_seq(exp.OpenBrace, exp.CloseBrace, (this_): PResult<null> => {
    const id = this_.token.ident();
    if (id !== undefined && id[0].name === sym.predicates && id[1] === "Normal") {
      const span = this_.token.span;
      this_.bump();
      const r = this_.parse_where_clause_predicates(undefined, span);
      if (r.$ === "Err") return r;
      predicates.push(...r._0[0]);
    } else if (id !== undefined && id[0].name === sym.forall && id[1] === "Normal") {
      const r = this_.parse_test_binder_forall();
      if (r.$ === "Err") return r;
      foralls.push(r._0);
    } else if (id !== undefined && id[0].name === sym.exists && id[1] === "Normal") {
      const r = this_.parse_test_binder_exists();
      if (r.$ === "Err") return r;
      exists.push(r._0);
    } else {
      const r = this_.parse_test_binder_constraint();
      if (r.$ === "Err") return r;
      constraints.push(r._0);
    }
    return Ok(null);
  });
  if (r.$ === "Err") return r;
  return Ok({ foralls, exists, constraints, predicates });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2741 parse_test_binder_forall
Parser.prototype.parse_test_binder_forall = function (this: Parser): PResult<TestBinderForall> {
  const span = this.token.span;
  this.bump();

  const r = this.parse_generics();
  if (r.$ === "Err") return r;
  const generics = r._0;
  const r2 = this.parse_where_clause();
  if (r2.$ === "Err") return r2;
  generics.where_clause = r2._0;

  const r3 = this.parse_test_binder_body();
  if (r3.$ === "Err") return r3;
  const body = r3._0;

  let assert_on_exit: TestBinderConstraint[] | undefined;
  const id = this.token.ident();
  if (id !== undefined && id[1] === "Normal" && id[0].name === sym.expect) {
    this.bump();
    const r4 = this.parse_delim_comma_seq(exp.OpenBrace, exp.CloseBrace, (this_) =>
      this_.parse_test_binder_constraint(),
    );
    if (r4.$ === "Err") return r4;
    const items = r4._0[0];
    assert_on_exit = items;
  } else {
    assert_on_exit = undefined;
  }

  return Ok({ span, node_id: DUMMY_NODE_ID, generics, body, assert_on_exit });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2767 parse_test_binder_exists
Parser.prototype.parse_test_binder_exists = function (this: Parser): PResult<TestBinderExists> {
  const span = this.token.span;
  this.bump();
  const r = this.parse_generics();
  if (r.$ === "Err") return r;
  const params = r._0.params;
  const r2 = this.parse_test_binder_body();
  if (r2.$ === "Err") return r2;
  const body = r2._0;
  return Ok({ span, node_id: DUMMY_NODE_ID, params, body });
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2775 parse_test_binder_constraint
Parser.prototype.parse_test_binder_constraint = function (this: Parser): PResult<TestBinderConstraint> {
  const id = this.token.ident();
  if (id !== undefined && id[0].name === sym.and && id[1] === "Normal") {
    this.bump();
    const r = this.parse_delim_comma_seq(exp.OpenBrace, exp.CloseBrace, (this_) =>
      this_.parse_test_binder_constraint(),
    );
    if (r.$ === "Err") return r;
    const items = r._0[0];
    return Ok({ $: "And", items });
  } else if (id !== undefined && id[0].name === sym.or && id[1] === "Normal") {
    this.bump();
    const r = this.parse_delim_comma_seq(exp.OpenBrace, exp.CloseBrace, (this_) =>
      this_.parse_test_binder_constraint(),
    );
    if (r.$ === "Err") return r;
    const items = r._0[0];
    return Ok({ $: "Or", items });
  } else if (id !== undefined && id[0].name === sym.ambiguity && id[1] === "Normal") {
    const span = this.token.span;
    this.bump();
    return Ok({ $: "Ambiguity", span });
  } else if (this.check_keyword(exp.For)) {
    const r = this.parse_test_binder_bound_type_constraint();
    if (r.$ === "Err") return r;
    const bound_type_constraint = r._0;
    return Ok({ $: "AliasOutlives", bound_type_constraint });
  } else if (this.token.lifetime() !== undefined) {
    const lhs = this.expect_lifetime();
    const r = this.expect(exp.Colon);
    if (r.$ === "Err") return r;
    if (!this.check_lifetime()) {
      const r2 = this.unexpected();
      if (r2.$ === "Err") return r2;
    }
    const rhs = this.expect_lifetime();
    return Ok({ $: "Lifetime", lhs, rhs });
  } else if (this.token.can_begin_type()) {
    const r = this.parse_ty_for_where_clause();
    if (r.$ === "Err") return r;
    const lhs = r._0;
    const r2 = this.expect(exp.Colon);
    if (r2.$ === "Err") return r2;
    if (!this.check_lifetime()) {
      const r3 = this.unexpected();
      if (r3.$ === "Err") return r3;
    }
    const rhs = this.expect_lifetime();
    return Ok({ $: "PlaceholderOutlives", lhs, rhs });
  } else {
    return Err(this.dcx().struct_span_err(this.token.span, "unexpected token"));
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2826 parse_test_binder_bound_type_constraint
Parser.prototype.parse_test_binder_bound_type_constraint = function (
  this: Parser,
): PResult<TestBinderBoundTypeConstraint> {
  const lo = this.token.span;
  const r = this.parse_ty_where_predicate_kind();
  if (r.$ === "Err") return r;
  const { bound_generic_params, bounded_ty, bounds } = r._0;
  let rhs: ast.Lifetime | undefined = undefined;
  for (const bound of bounds) {
    switch (bound.$) {
      case "Trait": {
        const poly_trait_ref = bound._0;
        this.dcx().span_err(poly_trait_ref.span, "trait bounds aren't supported here");
        break;
      }
      case "Use": {
        const span = bound._1;
        this.dcx().span_err(span, "use bounds aren't supported here");
        break;
      }
      case "Outlives": {
        const lifetime = bound._0;
        if (rhs !== undefined) {
          this.dcx().span_err(lifetime.ident.span, "only one lifetime on the rhs supported");
        } else {
          rhs = lifetime;
        }
        break;
      }
    }
  }
  if (rhs !== undefined) {
    return Ok({
      span: Span.to(lo, this.prev_token.span),
      node_id: DUMMY_NODE_ID,
      params: bound_generic_params,
      lhs: bounded_ty,
      rhs,
    });
  } else {
    return Err(
      this.dcx().struct_span_err(bounded_ty.span, "expected a single lifetime on the rhs of this constraint"),
    );
  }
};

// rustc: compiler/rustc_parse/src/parser/item.rs:2868 report_invalid_macro_expansion_item
Parser.prototype.report_invalid_macro_expansion_item = function (
  this: Parser,
  args: DelimArgs,
  path: Path | undefined,
): void {
  const span = args.dspan.entire();
  const err = this.dcx().struct_span_err(
    span,
    "macros that expand to items must be delimited with braces or followed by a semicolon",
  );
  // FIXME: This will make us not emit the help even for declarative
  // macros within the same crate (that we can fix), which is sad.
  if (!Span.from_expansion(span)) {
    const { open, close } = args.dspan;
    // Check if this looks like `macro_rules!(name) { ... }`
    // a common mistake when trying to define a macro.
    if (
      path !== undefined &&
      path.segments.length > 0 &&
      path.segments[0]!.ident.name === sym.macro_rules &&
      args.delim.$ === "Parenthesis"
    ) {
      const replace = BytePos.add(Span.hi(path.span), BytePos(1)) < Span.lo(open) ? "" : " ";
      err.multipart_suggestion(
        "to define a macro, remove the parentheses around the macro name",
        [
          [open, replace],
          [close, ""],
        ],
        Applicability.MachineApplicable,
      );
    } else {
      err.multipart_suggestion(
        "change the delimiters to curly braces",
        [
          [open, "{"],
          [close, "}"],
        ],
        Applicability.MaybeIncorrect,
      );
      err.span_suggestion_verbose(
        Span.shrink_to_hi(Span.with_neighbor(span, this.token.span)),
        "add a semicolon",
        ";",
        Applicability.MaybeIncorrect,
      );
    }
  }
  err.emit();
};

/// Checks if current token is one of tokens which cannot be nested like `kw::Enum`. In case
/// it is, we try to parse the item and report error about nested types.
// rustc: compiler/rustc_parse/src/parser/item.rs:2910 recover_nested_adt_item
Parser.prototype.recover_nested_adt_item = function (this: Parser, keyword: Symbol): PResult<boolean> {
  if (
    (this.token.is_keyword(kw.Enum) || this.token.is_keyword(kw.Struct) || this.token.is_keyword(kw.Union)) &&
    this.look_ahead(1, (t) => t.is_ident())
  ) {
    const kw_token: Token = this.token;
    const kw_str = pprust.token_to_string(kw_token);
    const r = this.parse_item(
      ForceCollect.No,
      AllowConstBlockItems.DoesNotMatter, // self.token != kw::Const
    );
    if (r.$ === "Err") return r;
    let item = unwrap(r._0).span;
    if (this.token.eq(TokenKind.Comma)) {
      item = Span.to(item, this.token.span);
    }
    this.dcx().emit_err(
      diagnostics.NestedAdt_diagnostic({
        span: kw_token.span,
        item,
        kw_str,
        keyword: Symbol.as_str(keyword),
      }),
    );
    // We successfully parsed the item but we must inform the caller about nested problem.
    return Ok(false);
  }
  return Ok(true);
};

// `const ALL_QUALS` of `check_impl_frontmatter`.
const CHECK_IMPL_FRONTMATTER_ALL_QUALS: readonly Symbol[] = [kw.Const, kw.Unsafe];

// rustc: compiler/rustc_parse/src/parser/item.rs:2938 check_impl_frontmatter
Parser.prototype.check_impl_frontmatter = function (this: Parser, look_ahead: number): boolean {
  const ALL_QUALS = CHECK_IMPL_FRONTMATTER_ALL_QUALS;
  // In contrast to the loop below, this call inserts `impl` into the
  // list of expected tokens shown in diagnostics.
  if (this.check_keyword(exp.Impl)) {
    return true;
  }
  let i = 0;
  while (i < ALL_QUALS.length) {
    const action = this.look_ahead(i + look_ahead, (token_): boolean | undefined => {
      if (token_.is_keyword(kw.Impl)) {
        return true;
      }
      if (ALL_QUALS.some((qual) => token_.is_keyword(qual))) {
        // Ok, we found a legal keyword, keep looking for `impl`
        return undefined;
      }
      return false;
    });
    if (action !== undefined) {
      const ret = action;
      return ret;
    }
    i += 1;
  }

  return this.is_keyword_ahead(i, [kw.Impl]);
};

/// Try to recover from over-parsing in const item when a semicolon is missing.
///
/// This detects cases where we parsed too much because a semicolon was missing
/// and the next line started an expression that the parser treated as a continuation
/// (e.g., `foo() \n &bar` was parsed as `foo() & bar`).
///
/// Returns a corrected expression if recovery is successful.
// rustc: compiler/rustc_parse/src/parser/item.rs:2973 try_recover_const_missing_semi
Parser.prototype.try_recover_const_missing_semi = function (
  this: Parser,
  rhs: Expr | undefined,
  const_span: Span,
): Expr | undefined {
  if (this.token.eq(TokenKind.Semi)) {
    return undefined;
  }
  if (rhs === undefined) {
    return undefined;
  }
  if (!this.in_fn_body || !this.may_recover() || Span.from_expansion(rhs.span)) {
    return undefined;
  }
  const r = this.missing_semi_from_binop("const", rhs, Span.shrink_to_lo(const_span));
  if (r !== undefined) {
    const [span, guar] = r;
    this.fn_body_missing_semi_guar = guar;
    return this.mk_expr(span, { $: "Err", _0: guar });
  } else {
    return undefined;
  }
};

// (`enum IsMacroRulesItem` and `struct UsePathList` are generated.)
