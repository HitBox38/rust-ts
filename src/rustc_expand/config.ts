// Port of compiler/rustc_expand/src/config.rs
//! Conditional compilation stripping.
//
// PORT: `configure<T: HasTokens>` / `process_cfg_attrs<T: HasAttrs>` take the trait impl tables
// (src/rustc_ast/ast_traits.ts) as trailing arguments; `&mut T` nodes are edited in place.
// `#[instrument]`/`tracing` calls have no counterpart. The `configure!` macro_rules has no fn: its
// callers (expand.rs) write `const node = cfg.configure(..); if (node === undefined) return <default>;`.
import "../rustc_attr_parsing/lib.ts";

import {
  type AttrItem,
  AttrStyle,
  type AttrVec,
  type Attribute,
  CRATE_NODE_ID,
  clone_Attribute,
  debug_AttrItem,
  debug_Attribute,
  type Expr,
  HasAttrs,
  HasTokens,
  type NodeId,
} from "../rustc_ast/lib.ts";
import type { HasAttrs as HasAttrsT, HasTokens as HasTokensT } from "../rustc_ast/ast_traits.ts";
import { mk_attr_from_item } from "../rustc_ast/attr/mod.ts";
import {
  AttrTokenStream,
  type AttrTokenTree,
  clone_AttrTokenStream,
  clone_AttrTokenTree,
  debug_AttrTokenTree,
  LazyAttrTokenStream,
  type WithTokens,
} from "../rustc_ast/tokenstream.ts";
import { type Token, TokenKind } from "../rustc_ast/token.ts";
import type { Attribute as attrs_Attribute } from "../rustc_attr_ir/lib.ts";
import { target } from "../rustc_attr_ir/lib.ts";
import { AttributeSafety } from "../rustc_attr_parsing/attributes/mod.ts";
import { CFG_TEMPLATE, EvalConfigResult, eval_config_entry, parse_cfg, parse_cfg_attr } from "../rustc_attr_parsing/attributes/cfg.ts";
import { AttributeParser, type ShouldEmit } from "../rustc_attr_parsing/lib.ts";
import { AllowExprMetavar } from "../rustc_attr_parsing/parser.ts";
import {
  ACCEPTED_LANG_FEATURES,
  Features,
  REMOVED_LANG_FEATURES,
  UNSTABLE_LANG_FEATURES,
} from "../rustc_feature/lib.ts";
import { UNUSED_ATTRIBUTES } from "../rustc_lint_defs/builtin.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import type { Session } from "../rustc_session/session.ts";
import { Span } from "../rustc_span/lib.ts";
import { STDLIB_STABLE_CRATES, Symbol, sym } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import {
  CfgAttrNoAttributes_diagnostic,
  CrateNameInCfgAttr_diagnostic,
  CrateTypeInCfgAttr_diagnostic,
  FeatureNotAllowed_diagnostic,
  FeatureRemoved_diagnostic,
  RemoveExprNotSupported_diagnostic,
} from "./diagnostics.ts";

/// A folder that strips out items that do not belong in the current configuration.
export class StripUnconfigured {
  constructor(
    public sess: Session,
    public features: Features | undefined,
    /// If `true`, perform cfg-stripping on attached tokens.
    /// This is only used for the input to derive macros,
    /// which needs eager expansion of `cfg` and `cfg_attr`
    public config_tokens: boolean,
    public lint_node_id: NodeId,
  ) {}

  // rustc: compiler/rustc_expand/src/config.rs:154 configure
  configure<T>(node: T, T_HasTokens: HasTokensT<T>, T_HasAttrs: HasAttrsT<T>): T | undefined {
    this.process_cfg_attrs(node, T_HasAttrs);
    if (this.in_cfg(T_HasAttrs.attrs(node))) {
      this.try_configure_tokens(node, T_HasTokens);
      return node;
    }
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/config.rs:162 try_configure_tokens
  try_configure_tokens<T>(node: T, T_HasTokens: HasTokensT<T>): void {
    if (this.config_tokens) {
      const tokens = T_HasTokens.tokens_mut(node);
      if (tokens !== undefined && tokens.value !== undefined) {
        const attr_stream = tokens.value.to_attr_token_stream();
        tokens.value = LazyAttrTokenStream.new_direct(this.configure_tokens(attr_stream));
      }
    }
  }

  /// Performs cfg-expansion on `stream`, producing a new `AttrTokenStream`.
  /// This is only used during the invocation of `derive` proc-macros,
  /// which require that we cfg-expand their entire input.
  /// Normal cfg-expansion operates on parsed AST nodes via the `configure` method
  // rustc: compiler/rustc_expand/src/config.rs:175 configure_tokens
  configure_tokens(stream: AttrTokenStream): AttrTokenStream {
    // rustc: compiler/rustc_expand/src/config.rs:176 can_skip
    function can_skip(stream: AttrTokenStream): boolean {
      return stream._0.every((tree) => {
        switch (tree.$) {
          case "AttrsTarget":
            return false;
          case "Token":
            return true;
          case "Delimited":
            return can_skip(tree._3);
        }
      });
    }

    if (can_skip(stream)) {
      return clone_AttrTokenStream(stream);
    }

    const trees: AttrTokenTree[] = [];
    for (const tree_ of stream._0) {
      const tree = clone_AttrTokenTree(tree_);
      let out: AttrTokenTree | undefined;
      switch (tree.$) {
        case "AttrsTarget": {
          const target_ = tree._0;
          // Expand any `cfg_attr` attributes.
          flat_map_in_place(target_.attrs, (attr) => this.process_cfg_attr(attr));

          if (this.in_cfg(target_.attrs)) {
            target_.tokens = LazyAttrTokenStream.new_direct(this.configure_tokens(target_.tokens.to_attr_token_stream()));
            out = { $: "AttrsTarget", _0: target_ };
          } else {
            // Remove the target if there's a `cfg` attribute and
            // the condition isn't satisfied.
            out = undefined;
          }
          break;
        }
        case "Delimited": {
          const [sp, spacing, delim] = [tree._0, tree._1, tree._2];
          let inner = tree._3;
          inner = this.configure_tokens(inner);
          out = { $: "Delimited", _0: sp, _1: spacing, _2: delim, _3: inner };
          break;
        }
        case "Token": {
          const token: Token = tree._0;
          if (TokenKind.is_delim(token.kind)) {
            panic(`Should be \`AttrTokenTree::Delimited\`, not delim tokens: ${debug_AttrTokenTree(tree, PLAIN)}`);
          }
          out = { $: "Token", _0: token, _1: tree._1 };
          break;
        }
      }
      if (out !== undefined) trees.push(out);
    }
    return AttrTokenStream.new(trees);
  }

  /// Parse and expand all `cfg_attr` attributes into a list of attributes
  /// that are within each `cfg_attr` that has a true configuration predicate.
  ///
  /// Gives compiler warnings if any `cfg_attr` does not contain any
  /// attributes and is in the original source code. Gives compiler errors if
  /// the syntax of any `cfg_attr` is incorrect.
  // rustc: compiler/rustc_expand/src/config.rs:226 process_cfg_attrs
  process_cfg_attrs<T>(node: T, T_HasAttrs: HasAttrsT<T>): void {
    T_HasAttrs.visit_attrs(node, (attrs) => {
      flat_map_in_place(attrs, (attr) => this.process_cfg_attr(attr));
    });
  }

  // rustc: compiler/rustc_expand/src/config.rs:232 process_cfg_attr
  process_cfg_attr(attr: Attribute): Attribute[] {
    if (attr.has_name(sym.cfg_attr)) {
      return this.expand_cfg_attr(attr, true);
    } else {
      return [clone_Attribute(attr)];
    }
  }

  /// Parse and expand a single `cfg_attr` attribute into a list of attributes
  /// when the configuration predicate is true, or otherwise expand into an
  /// empty list of attributes.
  ///
  /// Gives a compiler warning when the `cfg_attr` contains no attributes and
  /// is in the original source file. Gives a compiler error if the syntax of
  /// the attribute is incorrect.
  // rustc: compiler/rustc_expand/src/config.rs:247 expand_cfg_attr
  expand_cfg_attr(cfg_attr: Attribute, recursive: boolean): Attribute[] {
    const parsed = parse_cfg_attr(cfg_attr, this.sess, this.features, this.lint_node_id);
    if (parsed === undefined) {
      const trace_attr = clone_Attribute(cfg_attr).convert_normal_to_synthetic({
        $: "CfgAttrTrace",
        _0: { $: "Bool", _0: true, _1: cfg_attr.span },
      });
      return [trace_attr];
    }
    const [cfg_predicate, expanded_attrs] = parsed;

    // Lint on zero attributes in source.
    if (expanded_attrs.length === 0) {
      this.sess.psess.buffer_lint(UNUSED_ATTRIBUTES, cfg_attr.span, CRATE_NODE_ID, CfgAttrNoAttributes_diagnostic({}));
    }

    const cfg_eval = EvalConfigResult.as_bool(eval_config_entry(this.sess, cfg_predicate));

    // A synthetic trace attribute left in AST in place of the original `cfg_attr` attribute.
    // It can later be used by lints or other diagnostics.
    const trace_attr = clone_Attribute(cfg_attr).convert_normal_to_synthetic({ $: "CfgAttrTrace", _0: cfg_predicate });

    if (!cfg_eval) {
      return [trace_attr];
    }

    if (recursive) {
      // We call `process_cfg_attr` recursively in case there's a
      // `cfg_attr` inside of another `cfg_attr`. E.g.
      //  `#[cfg_attr(false, cfg_attr(true, some_attr))]`.
      const out: Attribute[] = [trace_attr];
      for (const item of expanded_attrs) {
        out.push(...this.process_cfg_attr(this.expand_cfg_attr_item(cfg_attr, item)));
      }
      return out;
    } else {
      const out: Attribute[] = [trace_attr];
      for (const item of expanded_attrs) {
        out.push(this.expand_cfg_attr_item(cfg_attr, item));
      }
      return out;
    }
  }

  // rustc: compiler/rustc_expand/src/config.rs:297 expand_cfg_attr_item
  expand_cfg_attr_item(cfg_attr: Attribute, [attr_item, attr_item_span]: [WithTokens<AttrItem>, Span]): Attribute {
    // Convert `#[cfg_attr(pred, attr)]` to `#[attr]`.

    // Use the `#` from `#[cfg_attr(pred, attr)]` in the result `#[attr]`.
    const orig_trees = cfg_attr.token_trees()[globalThis.Symbol.iterator]();
    const t0 = orig_trees.next();
    if (t0.done || t0.value.$ !== "Token" || t0.value._0.kind.$ !== "Pound") {
      return panic(`Bad tokens for attribute ${debug_Attribute(cfg_attr, PLAIN)}`);
    }
    const pound_token = t0.value._0;

    // For inner attributes, we do the same thing for the `!` in `#![attr]`.
    let trees: AttrTokenTree[];
    if (cfg_attr.style === AttrStyle.Inner) {
      const t1 = orig_trees.next();
      if (t1.done || t1.value.$ !== "Token" || t1.value._0.kind.$ !== "Bang") {
        return panic(`Bad tokens for attribute ${debug_Attribute(cfg_attr, PLAIN)}`);
      }
      const bang_token = t1.value._0;
      trees = [
        { $: "Token", _0: pound_token, _1: "Joint" },
        { $: "Token", _0: bang_token, _1: "JointHidden" },
      ];
    } else {
      trees = [{ $: "Token", _0: pound_token, _1: "JointHidden" }];
    }

    // And the same thing for the `[`/`]` delimiters in `#[attr]`.
    const t2 = orig_trees.next();
    if (t2.done || t2.value.$ !== "Delimited" || t2.value._2.$ !== "Bracket") {
      return panic(`Bad tokens for attribute ${debug_Attribute(cfg_attr, PLAIN)}`);
    }
    const [delim_span, delim_spacing] = [t2.value._0, t2.value._1];
    const item_tokens = attr_item.tokens;
    if (item_tokens === undefined) {
      return panic(`Missing tokens for ${debug_AttrItem(attr_item.node, PLAIN)}`);
    }
    trees.push({
      $: "Delimited",
      _0: delim_span,
      _1: delim_spacing,
      _2: { $: "Bracket" },
      _3: item_tokens.to_attr_token_stream(),
    });

    const attr_item_path_span = attr_item.node.path.span;
    const attr_tokens = LazyAttrTokenStream.new_direct(AttrTokenStream.new(trees));
    const attr = mk_attr_from_item(
      this.sess.psess.attr_id_generator,
      attr_item.node,
      attr_tokens,
      cfg_attr.style,
      attr_item_span,
    );
    if (attr.has_name(sym.crate_type)) {
      this.sess.dcx().emit_err(CrateTypeInCfgAttr_diagnostic({ span: attr_item_path_span }));
    }
    if (attr.has_name(sym.crate_name)) {
      this.sess.dcx().emit_err(CrateNameInCfgAttr_diagnostic({ span: attr_item_path_span }));
    }
    return attr;
  }

  /// Determines if a node with the given attributes should be included in this configuration.
  // rustc: compiler/rustc_expand/src/config.rs:363 in_cfg
  in_cfg(attrs: readonly Attribute[]): boolean {
    return attrs.every(
      (attr) =>
        !is_cfg(attr) ||
        EvalConfigResult.as_bool(this.cfg_true(attr, { $: "ErrorsAndLints", recovery: "Allowed" })),
    );
  }

  // rustc: compiler/rustc_expand/src/config.rs:372 cfg_true
  cfg_true(attr: Attribute, emit_errors: ShouldEmit): EvalConfigResult {
    const cfg = AttributeParser.parse_single(
      this.sess,
      attr,
      attr.span,
      this.lint_node_id,
      // Doesn't matter what the target actually is here.
      target.Target.Crate,
      this.features,
      emit_errors,
      parse_cfg,
      CFG_TEMPLATE,
      AllowExprMetavar.Yes,
      AttributeSafety.Normal,
    );
    if (cfg === undefined) {
      // Cfg attribute was not parsable, give up
      return EvalConfigResult.True;
    }

    return eval_config_entry(this.sess, cfg);
  }

  /// If attributes are not allowed on expressions, emit an error for `attr`
  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_expand/src/config.rs:396 maybe_emit_expr_attr_err
  maybe_emit_expr_attr_err(attr: Attribute): void {
    if (
      this.features !== undefined &&
      !this.features.stmt_expr_attributes() &&
      !Span.allows_unstable(attr.span, sym.stmt_expr_attributes)
    ) {
      const err = feature_err(this.sess, sym.stmt_expr_attributes, attr.span, {
        $: "Inline",
        _0: "attributes on expressions are experimental",
      });

      if (attr.is_doc_comment()) {
        err.help(
          attr.style === AttrStyle.Outer
            ? { $: "Inline", _0: "`///` is used for outer documentation comments; for a plain comment, use `//`" }
            : {
                $: "Inline",
                _0: "`//!` is used for inner documentation comments; for a plain comment, use `//` by removing the `!` or inserting a space in between them: `// !`",
              },
        );
      }

      err.emit();
    }
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_expand/src/config.rs:420 configure_expr
  configure_expr(expr: Expr, method_receiver: boolean): void {
    if (!method_receiver) {
      for (const attr of expr.attrs) {
        this.maybe_emit_expr_attr_err(attr);
      }
    }

    // If an expr is valid to cfg away it will have been removed by the
    // outer stmt or expression folder before descending in here.
    // Anything else is always required, and thus has to error out
    // in case of a cfg attr.
    //
    // N.B., this is intentionally not part of the visit_expr() function
    //     in order for filter_map_expr() to be able to avoid this check
    const attr = HasAttrs.Expr.attrs(expr).find((a) => is_cfg(a));
    if (attr !== undefined) {
      this.sess.dcx().emit_err(RemoveExprNotSupported_diagnostic({ span: attr.span }));
    }

    this.process_cfg_attrs(expr, HasAttrs.Expr);
    this.try_configure_tokens(expr, HasTokens.Expr);
  }
}

// rustc: compiler/rustc_expand/src/config.rs:47 features
export function features(sess: Session, krate_attrs: readonly Attribute[], crate_name: Symbol): Features {
  const features = Features.default();

  const parsed: attrs_Attribute | undefined = AttributeParser.parse_limited_sym(sess, krate_attrs, [sym.feature]);
  if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "Feature") {
    const feature_idents = parsed._0._0;
    for (const feature_ident of feature_idents) {
      // If the enabled feature has been removed, issue an error.
      const f_removed = REMOVED_LANG_FEATURES.find((f) => feature_ident.name === f.feature.name);
      if (f_removed !== undefined) {
        const f = f_removed;
        let pull_note: string;
        if (f.pull !== undefined) {
          const pull = f.pull;
          pull_note = `; see <https://github.com/rust-lang/rust/pull/${pull}> for more information`;
        } else {
          pull_note = "";
        }
        sess.dcx().emit_err(
          FeatureRemoved_diagnostic({
            span: feature_ident.span,
            reason: f.reason === undefined ? undefined : { reason: f.reason },
            removed_rustc_version: f.feature.since,
            pull_note,
          }),
        );
        continue;
      }

      // If the enabled feature is stable, record it.
      const f_accepted = ACCEPTED_LANG_FEATURES.find((f) => feature_ident.name === f.name);
      if (f_accepted !== undefined) {
        features.set_enabled_lang_feature({
          gate_name: feature_ident.name,
          attr_sp: feature_ident.span,
          stable_since: Symbol.intern(f_accepted.since),
        });
        continue;
      }

      // If `-Z allow-features` is used and the enabled feature is
      // unstable and not also listed as one of the allowed features,
      // issue an error.
      const allowed = sess.opts.unstable_opts.allow_features;
      if (allowed !== undefined) {
        if (allowed.every((f) => Symbol.as_str(feature_ident.name) !== f)) {
          sess.dcx().emit_err(
            FeatureNotAllowed_diagnostic({
              span: feature_ident.span,
              name: feature_ident.name,
            }),
          );
          continue;
        }
      }

      // If the enabled feature is unstable, record it.
      if (UNSTABLE_LANG_FEATURES.find((f) => feature_ident.name === f.name) !== undefined) {
        features.set_enabled_lang_feature({
          gate_name: feature_ident.name,
          attr_sp: feature_ident.span,
          stable_since: undefined,
        });
      } else {
        // Otherwise, the feature is unknown. Enable it as a lib feature.
        // It will be checked later whether the feature really exists.
        features.set_enabled_lib_feature({
          gate_name: feature_ident.name,
          attr_sp: feature_ident.span,
        });
      }

      // When the ICE comes from a standard library crate, there's a chance that the person
      // hitting the ICE may be using -Zbuild-std or similar with an untested target.
      // The bug is probably in the standard library and not the compiler in that case,
      // but that doesn't really matter - we want a bug report.
      if (features.internal(feature_ident.name) && !STDLIB_STABLE_CRATES.includes(crate_name)) {
        sess.using_internal_features.value = true;
      }
    }
  }

  return features;
}

// rustc: compiler/rustc_expand/src/config.rs:127 pre_configure_attrs
export function pre_configure_attrs(sess: Session, attrs: readonly Attribute[]): AttrVec {
  const strip_unconfigured = new StripUnconfigured(sess, undefined, false, CRATE_NODE_ID);
  // PORT: `iter().flat_map(..).take_while(..).collect()` is lazy: `process_cfg_attr` runs one source
  // attribute at a time and stops with the first `#[cfg]` that is false.
  const out: AttrVec = [];
  outer: for (const attr of attrs) {
    for (const attr_ of strip_unconfigured.process_cfg_attr(attr)) {
      if (!(!is_cfg(attr_) || EvalConfigResult.as_bool(strip_unconfigured.cfg_true(attr_, { $: "Nothing" })))) {
        break outer;
      }
      out.push(attr_);
    }
  }
  return out;
}

// #[macro_export] macro_rules! configure — see the PORT note at the top of this file.

// rustc: compiler/rustc_expand/src/config.rs:443 is_cfg
function is_cfg(attr: Attribute): boolean {
  return attr.has_name(sym.cfg);
}

// PORT: pending a port of compiler/rustc_data_structures/src/flat_map_in_place.rs (`FlatMapInPlace` for
// `ThinVec`); the same local copy as src/rustc_ast/mut_visit.ts (root: move both to
// src/rustc_data_structures/flat_map_in_place.ts). Each element is moved out and replaced, in order, by
// the elements `f` maps it to; on a panic the vec is left empty (`LeakGuard`).
function flat_map_in_place<T>(self: T[], f: (e: T) => Iterable<T>): void {
  let read_i = 0;
  let write_i = 0;
  try {
    while (read_i < self.length) {
      // Move the read_i'th item out of the vector and map it to an iterator.
      const e = self[read_i]!;
      const iter = f(e);
      read_i += 1;

      for (const e of iter) {
        if (write_i < read_i) {
          self[write_i] = e;
          write_i += 1;
        } else {
          // If this is reached we ran out of space in the middle of the vector.
          // However, the vector is in a valid state here, so we just do a somewhat
          // inefficient insert.
          self.splice(write_i, 0, e);

          read_i += 1;
          write_i += 1;
        }
      }
    }

    // `write_i` tracks the number of actually written new items.
    self.length = write_i;
  } catch (err) {
    // Leak all elements in case of panic.
    self.length = 0;
    throw err;
  }
}
