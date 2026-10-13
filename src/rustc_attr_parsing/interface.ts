//! API for other crates to parse attributes themselves.
// Port of compiler/rustc_attr_parsing/src/interface.rs
//
// PORT:
// - `AttributeParser` is a class. Its fields `sess` and `features` clash with the accessor methods
//   `sess()` / `features()`, so the fields are `sess_` / `features_` (the `recovery_` precedent of
//   rustc_parse's `Parser`). The `'sess` lifetime is erased.
// - Methods of `impl AttributeParser` blocks in other files (safety.rs, stability.rs,
//   target_checking.rs, attributes/diagnostic/mod.rs) are attached to the prototype by those modules,
//   which augment the class interface (PORTING §5 "Methods defined in another file"); this module must
//   not import them at runtime. Associated fns without `self` defined there (`check_target`,
//   `check_crate_level`, `target_checking_help`) are statics, declared below with `declare static`.
// - `parse_fn: fn(..)` / `lower_span: impl Fn` / `emit_lint: impl FnMut` -> plain functions.
// - `#[cfg(debug_assertions)]` code is omitted: rustc ships without debug assertions (the omitted
//   fields/calls are kept as comments; `check_args_used` is a `rustc-skip`).
import * as ast from "../rustc_ast/lib.ts";
import { CRATE_NODE_ID, type NodeId } from "../rustc_ast/node_id.ts";
import { MetaItemLit } from "../rustc_ast/util/literal.ts";
import { target as target_mod } from "../rustc_attr_ir/lib.ts";
import {
  type AttrArgs,
  type AttrItem,
  AttrPath,
  type Attribute,
  clone_AttrPath,
} from "../rustc_attr_ir/lib.ts";
import type { Diag, DiagCtxtHandle, Diagnostic, ErrorGuaranteed, Level, LintId, MultiSpan } from "../rustc_errors/lib.ts";
import type { Features } from "../rustc_feature/lib.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.gen.ts";
import type { Session } from "../rustc_session/lib.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { assert, unwrap } from "../std/panic.ts";
import { AttributeSafety } from "./attributes/mod.ts";
import {
  AcceptContext,
  ATTRIBUTE_PARSERS,
  FinalizeCheckContext,
  type FinalizeCheckFn,
  FinalizeContext,
  type FinalizeFn,
  path_key,
  SharedContext,
  ShouldEmit,
} from "./context.ts";
import { ParsedDescription } from "./diagnostics.ts";
import { type AllowExprMetavar, ArgParser, PathParser, type RefPathParser } from "./parser.ts";
import { SyntheticAttrState } from "./synthetic.ts";
import type { AllowedTargets } from "./target_checking.ts";
import type { AttributeTemplate } from "./template.ts";

type Target = target_mod.Target;
const Target = target_mod.Target;

// PORT: `Box<dyn for<'a> FnOnce(DiagCtxtHandle<'a>, Level, &Session) -> Diag<'a> + DynSend + DynSync>`.
export class EmitAttribute {
  constructor(public _0: (dcx: DiagCtxtHandle, level: Level, sess: Session) => Diag) {}
}

/** `impl FnMut(LintId, MultiSpan, EmitAttribute)` */
export type EmitLintFn = (lint_id: LintId, span: MultiSpan, kind: EmitAttribute) => void;

/// Context created once, for example as part of the ast lowering
/// context, through which all attributes can be lowered.
export class AttributeParser {
  // Associated fns defined in target_checking.rs (attached there).
  declare static check_target: (allowed_targets: AllowedTargets, attribute_args: string, cx: AcceptContext) => void;
  declare static target_checking_help: (attribute_args: string, cx: AcceptContext) => unknown;
  declare static check_crate_level: (cx: AcceptContext, warn: boolean) => void;

  constructor(
    public attr_tools: RegisteredTools | undefined,
    public features_: Features | undefined,
    public sess_: Session,
    public should_emit: ShouldEmit,

    /// *Only* parse attributes that passes this filter.
    ///
    /// Used in cases where we want the lowering infrastructure for parse just limited attributes.
    public parse_filter: ((attr: ast.Attribute) => boolean) | undefined,
  ) {}

  /// This method allows you to parse attributes *before* you have access to features or tools.
  /// One example where this is necessary, is to parse `feature` attributes themselves for
  /// example.
  ///
  /// Try to use this as little as possible. Attributes *should* be lowered during
  /// `rustc_ast_lowering`. Some attributes require access to features to parse, which would
  /// crash if you tried to do so through [`parse_limited`](Self::parse_limited).
  ///
  /// To make sure use is limited, supply a filter. Only attributes that passes the filter are
  /// picked out of the list of instructions and parsed. Those are returned.
  ///
  /// No diagnostics will be emitted when parsing limited. Lints are not emitted at all, while
  /// errors will be emitted as a delayed bugs. in other words, we *expect* attributes parsed
  /// with `parse_limited` to be reparsed later during ast lowering where we *do* emit the errors
  ///
  /// Due to this function not taking in `RegisteredTools`, *do not* use this for parsing any lint attributes
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:68 parse_limited
  static parse_limited(
    sess: Session,
    attrs: readonly ast.Attribute[],
    parse_filter: (attr: ast.Attribute) => boolean,
  ): Attribute | undefined {
    return AttributeParser.parse_limited_should_emit(
      sess,
      attrs,
      parse_filter,
      // Because we're not emitting warnings/errors, the target should not matter
      DUMMY_SP,
      undefined,
      ShouldEmit.Nothing,
    );
  }

  /// This does the same as `parse_limited`, except that it takes a fixed symbol instead of a
  /// filter.
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:86 parse_limited_sym
  static parse_limited_sym(sess: Session, attrs: readonly ast.Attribute[], sym_: readonly Symbol[]): Attribute | undefined {
    return AttributeParser.parse_limited(sess, attrs, (attr) => attr.path_matches(sym_));
  }

  /// This does the same as `parse_limited`, except it has a `should_emit` parameter which allows it to emit errors.
  /// Usually you want `parse_limited`, which emits no errors.
  ///
  /// Due to this function not taking in `RegisteredTools`, *do not* use this for parsing any lint attributes
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:98 parse_limited_should_emit
  static parse_limited_should_emit(
    sess: Session,
    attrs: readonly ast.Attribute[],
    parse_filter: (attr: ast.Attribute) => boolean,
    target_span: Span,
    features: Features | undefined,
    should_emit: ShouldEmit,
  ): Attribute | undefined {
    const parsed = AttributeParser.parse_limited_all(
      sess,
      attrs,
      parse_filter,
      Target.Crate,
      target_span,
      CRATE_NODE_ID,
      features,
      should_emit,
      undefined,
    );
    assert(parsed.length <= 1, "assertion failed: parsed.len() <= 1");
    return parsed.pop();
  }

  /// This does the same as `parse_limited_should_emit`, except that it takes a fixed symbol
  /// instead of a filter.
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:123 parse_limited_sym_should_emit
  static parse_limited_sym_should_emit(
    sess: Session,
    attrs: readonly ast.Attribute[],
    sym_: readonly Symbol[],
    target_span: Span,
    features: Features | undefined,
    should_emit: ShouldEmit,
  ): Attribute | undefined {
    return AttributeParser.parse_limited_should_emit(
      sess,
      attrs,
      (attr) => attr.path_matches(sym_),
      target_span,
      features,
      should_emit,
    );
  }

  /// This method allows you to parse a list of attributes *before* `rustc_ast_lowering`.
  /// This can be used for attributes that would be removed before `rustc_ast_lowering`, such as attributes on macro calls.
  ///
  /// Try to use this as little as possible. Attributes *should* be lowered during
  /// `rustc_ast_lowering`. Some attributes require access to features to parse, which would
  /// crash if you tried to do so through [`parse_limited_all`](Self::parse_limited_all).
  /// Therefore, if `parse_filter` is None, then features *must* be provided.
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:148 parse_limited_all
  static parse_limited_all(
    sess: Session,
    attrs: readonly ast.Attribute[],
    parse_filter: ((attr: ast.Attribute) => boolean) | undefined,
    target: Target,
    target_span: Span,
    target_node_id: NodeId,
    features: Features | undefined,
    should_emit: ShouldEmit,
    attr_tools: RegisteredTools | undefined,
  ): Attribute[] {
    const p = new AttributeParser(attr_tools, features, sess, should_emit, parse_filter);
    return p.parse_attribute_list(
      attrs,
      target_span,
      target,
      undefined,
      (x) => x, // std::convert::identity
      (lint_id, span, kind) => sess.psess.dyn_buffer_lint_sess(lint_id.lint, span, target_node_id, kind._0),
    );
  }

  /// This method parses a single attribute, using `parse_fn`.
  /// This is useful if you already know what exact attribute this is, and want to parse it.
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:174 parse_single
  static parse_single<T>(
    sess: Session,
    attr: ast.Attribute,
    target_span: Span,
    target_node_id: NodeId,
    target: Target,
    features: Features | undefined,
    emit_errors: ShouldEmit,
    parse_fn: (cx: AcceptContext, item: ArgParser) => T | undefined,
    template: AttributeTemplate,
    allow_expr_metavar: AllowExprMetavar,
    expected_safety: AttributeSafety,
  ): T | undefined {
    const attr_item = attr.get_normal_item();
    const parts = attr_item.path.segments.map((seg) => seg.ident.name);

    const path = AttrPath.from_ast(attr_item.path, (x) => x);
    const args = ArgParser.from_attr_args(attr_item.args, parts, sess.psess, emit_errors, allow_expr_metavar);
    if (args === undefined) return undefined;
    return AttributeParser.parse_single_args(
      sess,
      attr.span,
      attr_item.span,
      attr.style,
      path,
      attr_item.unsafety,
      expected_safety,
      ParsedDescription.Attribute,
      target_span,
      target_node_id,
      target,
      features,
      emit_errors,
      args,
      parse_fn,
      template,
    );
  }

  /// This method is equivalent to `parse_single`, but parses arguments using `parse_fn` using manually created `args`.
  /// This is useful when you want to parse other things than attributes using attribute parsers.
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:220 parse_single_args
  static parse_single_args<T, I>(
    sess: Session,
    attr_span: Span,
    inner_span: Span,
    attr_style: ast.AttrStyle,
    attr_path: AttrPath,
    attr_safety: ast.Safety | undefined,
    expected_safety: AttributeSafety,
    parsed_description: ParsedDescription,
    target_span: Span,
    target_node_id: NodeId,
    target: Target,
    features: Features | undefined,
    should_emit: ShouldEmit,
    args: I,
    parse_fn: (cx: AcceptContext, item: I) => T,
    template: AttributeTemplate,
  ): T {
    const parser = new AttributeParser(undefined, features, sess, should_emit, undefined);
    const emit_lint: EmitLintFn = (lint_id, span, kind) => {
      sess.psess.dyn_buffer_lint_sess(lint_id.lint, span, target_node_id, kind._0);
    };
    if (attr_safety !== undefined) {
      const safety = attr_safety;
      parser.check_attribute_safety(attr_path, inner_span, safety, expected_safety, emit_lint);
    }
    const cx = new AcceptContext(
      new SharedContext(
        parser,
        target_span,
        target,
        emit_lint,
        // #[cfg(debug_assertions)] has_lint_been_emitted: AtomicBool::new(false),
      ),
      attr_span,
      inner_span,
      attr_style,
      parsed_description,
      template,
      attr_safety ?? ast.Safety.Default,
      attr_path,
      // #[cfg(debug_assertions)] has_target_been_checked: false,
    );
    return parse_fn(cx, args);
  }

  // rustc: compiler/rustc_attr_parsing/src/interface.rs:275 new
  static new(sess: Session, features: Features, attr_tools: RegisteredTools, should_emit: ShouldEmit): AttributeParser {
    return new AttributeParser(attr_tools, features, sess, should_emit, undefined);
  }

  // rustc: compiler/rustc_attr_parsing/src/interface.rs:290 sess
  sess(): Session {
    return this.sess_;
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:295 features
  features(): Features {
    return unwrap(this.features_, "features not available at this point in the compiler");
  }

  // rustc: compiler/rustc_attr_parsing/src/interface.rs:299 features_option
  features_option(): Features | undefined {
    return this.features_;
  }

  // rustc: compiler/rustc_attr_parsing/src/interface.rs:303 dcx
  dcx(): DiagCtxtHandle {
    return this.sess().dcx();
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:308 emit_err
  emit_err(diag: Diagnostic): ErrorGuaranteed {
    return ShouldEmit.emit_err(this.should_emit, this.sess_.dcx().create_err(diag));
  }

  /// Parse a list of attributes.
  ///
  /// `target_span` is the span of the thing this list of attributes is applied to.
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:315 parse_attribute_list
  parse_attribute_list(
    attrs: readonly ast.Attribute[],
    target_span: Span,
    target: Target,
    target_item: ast.Item | undefined,
    lower_span: (span: Span) => Span,
    emit_lint: EmitLintFn,
  ): Attribute[] {
    const attributes: Attribute[] = [];
    const attr_paths: RefPathParser[] = [];
    const synthetic_attr_state = SyntheticAttrState.default();

    const finalizers: FinalizeFn[] = [];

    for (const attr of attrs) {
      // If we're only looking for a single attribute, skip all the ones we don't care about.
      if (this.parse_filter !== undefined) {
        const filter = this.parse_filter;
        if (!filter(attr)) {
          continue;
        }
      }

      const attr_span = lower_span(attr.span);
      const kind = attr.kind;
      switch (kind.$) {
        case "DocComment": {
          const comment_kind = kind._0;
          const symbol = kind._1;
          attributes.push({
            $: "Parsed",
            _0: {
              $: "DocComment",
              style: attr.style,
              kind: { $: "Sugared", _0: comment_kind },
              span: attr_span,
              comment: symbol,
            },
          });
          break;
        }
        case "Synthetic": {
          const synthetic = kind._0;
          synthetic_attr_state.accept_synthetic_attr(attr_span, lower_span, synthetic);
          break;
        }
        case "Normal": {
          const n = kind._0;
          attr_paths.push(new PathParser(n.item.path));
          const attr_path = AttrPath.from_ast(n.item.path, lower_span);
          const parts = n.item.path.segments.map((seg) => seg.ident.name);
          const inner_span = lower_span(n.item.span);

          const accept = ATTRIBUTE_PARSERS().accepters.get(path_key(parts));
          if (accept !== undefined) {
            this.check_attribute_safety(attr_path, inner_span, n.item.unsafety, accept.safety, emit_lint);
            this.check_attribute_stability(attr_path, attr_span, accept.stability);
            // if let [part] = parts.as_slice() {
            //     debug_assert!(BUILTIN_ATTRIBUTE_SET.contains(part));
            // }

            const args = ArgParser.from_attr_args(n.item.args, parts, this.sess_.psess, this.should_emit, "No");
            if (args === undefined) {
              continue;
            }

            // Special-case handling for `#[doc = "..."]`: if we go through with
            // `DocParser`, the order of doc comments will be messed up because `///`
            // doc comments are added into `attributes` whereas attributes parsed with
            // `DocParser` are added into `parsed_attributes` which are then appended
            // to `attributes`. So if you have:
            //
            // /// bla
            // #[doc = "a"]
            // /// blob
            //
            // You would get:
            //
            // bla
            // blob
            // a
            if (attr.has_name(sym.doc) && args.$ === "NameValue") {
              const nv = args._0;
              // If not a string key/value, it should emit an error, but to make
              // things simpler, it's handled in `DocParser` because it's simpler to
              // emit an error with `AcceptContext`.
              const comment = nv.value_as_str();
              if (comment !== undefined) {
                attributes.push({
                  $: "Parsed",
                  _0: {
                    $: "DocComment",
                    style: attr.style,
                    kind: { $: "Raw", _0: nv.value_span },
                    span: attr_span,
                    comment,
                  },
                });
                continue;
              }
            }

            const cx = new AcceptContext(
              new SharedContext(
                this,
                target_span,
                target,
                emit_lint,
                // #[cfg(debug_assertions)] has_lint_been_emitted: AtomicBool::new(false),
              ),
              attr_span,
              inner_span,
              attr.style,
              ParsedDescription.Attribute,
              accept.template,
              n.item.unsafety,
              clone_AttrPath(attr_path),
              // #[cfg(debug_assertions)] has_target_been_checked: false,
            );

            accept.accept_fn(cx, args);
            finalizers.push(accept.finalizer);

            AttributeParser.check_target(accept.allowed_targets, "", cx);
            // #[cfg(debug_assertions)]
            // if !cx.shared.has_lint_been_emitted.load(Ordering::Relaxed) {
            //     cx.shared.cx.check_args_used(attr, &args)
            // }
          } else if (parts.length >= 2 && parts[0] === sym.diagnostic) {
            // `let [sym::diagnostic, _unknown, ..] = &*parts`
            this.unknown_diagnostic_attr(n.item.path.segments[1]!, emit_lint);
          } else {
            const attr_: AttrItem = {
              path: clone_AttrPath(attr_path),
              args: this.lower_attr_args(n.item.args, lower_span),
              id: { attr_id: attr.id },
              style: attr.style,
              span: attr_span,
            };

            this.check_attribute_safety(attr_path, inner_span, n.item.unsafety, AttributeSafety.Normal, emit_lint);

            if (!(this.should_emit.$ === "Nothing") && target.$ === "Crate") {
              this.check_invalid_crate_level_attr_item(attr_, inner_span);
            }

            attributes.push({ $: "Unparsed", _0: attr_ });
          }
          break;
        }
      }
    }

    synthetic_attr_state.finalize_synthetic_attrs(attributes);

    // First, run all finalizers to produce the parsed attributes. Cross-attribute
    // checks that need to inspect the fully parsed attributes are deferred until all
    // finalizers have run (see below), since the parsed attributes are not yet all
    // available here.
    const deferred_checks: [FinalizeCheckFn, Span][] = [];
    for (const f of finalizers) {
      const { attr, deferred_check } = f(
        new FinalizeContext(
          new SharedContext(
            this,
            target_span,
            target,
            emit_lint,
            // #[cfg(debug_assertions)] has_lint_been_emitted: AtomicBool::new(false),
          ),
          attr_paths,
        ),
      );
      if (attr !== undefined) {
        attributes.push({ $: "Parsed", _0: attr });
      }
      if (deferred_check !== undefined) {
        deferred_checks.push(deferred_check);
      }
    }

    // Now that all attributes have been parsed, run the deferred checks. These can
    // inspect the fully parsed attributes via `FinalizeCheckContext::parsed_attrs`.
    if (!(this.should_emit.$ === "Nothing")) {
      for (const [check, attr_span] of deferred_checks) {
        check(
          new FinalizeCheckContext(
            new SharedContext(
              this,
              target_span,
              target,
              emit_lint,
              // #[cfg(debug_assertions)] has_lint_been_emitted: AtomicBool::new(false),
            ),
            attr_paths,
            attributes,
            target_item,
          ),
          attr_span,
        );
      }
    }

    if (!(this.should_emit.$ === "Nothing") && target.$ === "WherePredicate") {
      this.check_invalid_where_predicate_attrs(attributes);
    }

    return attributes;
  }

  // #[cfg(debug_assertions)]
  // rustc-skip: compiler/rustc_attr_parsing/src/interface.rs:531 check_args_used #[cfg(debug_assertions)]-only (rustc ships without debug assertions; its only caller is cfg'd out too)

  /// Returns whether there is a parser for an attribute with this name
  // rustc: compiler/rustc_attr_parsing/src/interface.rs:549 is_parsed_attribute
  static is_parsed_attribute(path: readonly Symbol[]): boolean {
    /// The list of attributes that are parsed attributes,
    /// even though they don't have a parser in `Late::parsers()`
    const SPECIAL_ATTRIBUTES: readonly (readonly Symbol[])[] = [
      // Cfg attrs are removed after being converted into synthetic attrs and don't need to
      // be in the parser list.
      [sym.cfg],
      [sym.cfg_attr],
    ];

    return (
      ATTRIBUTE_PARSERS().accepters.has(path_key(path)) ||
      SPECIAL_ATTRIBUTES.some((s) => s.length === path.length && s.every((x, i) => x === path[i]))
    );
  }

  // rustc: compiler/rustc_attr_parsing/src/interface.rs:562 lower_attr_args
  lower_attr_args(args: ast.AttrArgs, lower_span: (span: Span) => Span): AttrArgs {
    switch (args.$) {
      case "Empty":
        return { $: "Empty" };
      case "Delimited":
        return { $: "Delimited", _0: ast.clone_DelimArgs(args._0) };
      // This is an inert key-value attribute - it will never be visible to macros
      // after it gets lowered to HIR. Therefore, we can extract literals to handle
      // nonterminals in `#[doc]` (e.g. `#[doc = $e]`).
      case "Eq": {
        const { eq_span, expr } = args;
        // In valid code the value always ends up as a single literal. Otherwise, a dummy
        // literal suffices because the error is handled elsewhere.
        let lit: ast.MetaItemLit;
        const r = expr.kind.$ === "Lit" ? MetaItemLit.from_token_lit(expr.kind._0, lower_span(expr.span)) : undefined;
        if (r !== undefined && r.$ === "Ok") {
          lit = r._0;
        } else {
          const guar = this.dcx().span_delayed_bug(
            ast.AttrArgs.span(args) ?? DUMMY_SP,
            "expr in place where literal is expected (builtin attr parsing)",
          );
          lit = new ast.MetaItemLit(sym.dummy, undefined, { $: "Err", _0: guar }, DUMMY_SP);
        }
        return { $: "Eq", eq_span: lower_span(eq_span), expr: lit };
      }
    }
  }
}
