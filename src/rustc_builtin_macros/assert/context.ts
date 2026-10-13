// Port of compiler/rustc_builtin_macros/src/assert/context.rs
import { ast, token, tokenstream } from "../../rustc_ast/lib.ts";
import { DUMMY_NODE_ID } from "../../rustc_ast/node_id.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import type { ExtCtxt } from "../../rustc_expand/base.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, sym, Symbol } from "../../rustc_span/symbol.ts";
import { escape_char } from "../../std/fmt.ts";
import { replace_in_place } from "../../std/mut_ref.ts";

export class Context {
  constructor(
    // An optimization.
    //
    // Elements that aren't consumed (PartialEq, PartialOrd, ...) can be copied **after** the
    // `assert!` expression fails rather than copied on-the-fly.
    public best_case_captures: ast.Stmt[],
    // Top-level `let captureN = Capture::new()` statements
    public capture_decls: Capture[],
    public cx: ExtCtxt,
    // Formatting string used for debugging
    public fmt_string: string,
    // If the current expression being visited consumes itself. Used to construct
    // `best_case_captures`.
    public is_consumed: boolean,
    // Top-level `let __local_bindN = &expr` statements
    public local_bind_decls: ast.Stmt[],
    // Used to avoid capturing duplicated paths
    //
    // ```rust
    // let a = 1i32;
    // assert!(add(a, a) == 3);
    // ```
    // PORT: `FxHashSet<Ident>`: only `contains`/`insert` are used, so a list compared with `Ident::eq`
    // (name + syntax context, like `Ident`'s `Hash`/`Eq`) is equivalent.
    public paths: Ident[],
    public span: Span,
  ) {}

  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:40 new
  static new(cx: ExtCtxt, span: Span): Context {
    return new Context([], [], cx, "", true, [], [], span);
  }

  /// Builds the whole `assert!` expression. For example, `let elem = 1; assert!(elem == 1);` expands to:
  ///
  /// ```rust
  /// let elem = 1;
  /// {
  ///   #[allow(unused_imports)]
  ///   use ::core::asserting::{TryCaptureGeneric, TryCapturePrintable};
  ///   let mut __capture0 = ::core::asserting::Capture::new();
  ///   let __local_bind0 = &elem;
  ///   if !(
  ///     *{
  ///       (&::core::asserting::Wrapper(__local_bind0)).try_capture(&mut __capture0);
  ///       __local_bind0
  ///     } == 1
  ///   ) {
  ///     panic!("Assertion failed: elem == 1\nWith captures:\n  elem = {:?}", __capture0)
  ///   }
  /// }
  /// ```
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:72 build
  build(cond_expr: ast.Expr, panic_path: ast.Path): ast.Expr {
    const expr_str = pprust.expr_to_string(cond_expr);
    this.manage_cond_expr(cond_expr);
    const initial_imports = this.build_initial_imports();
    const panic = this.build_panic(expr_str, panic_path);
    const cond_expr_with_unlikely = this.build_unlikely(cond_expr);

    const { best_case_captures, capture_decls, cx, local_bind_decls, span } = this;

    const assert_then_stmts: ast.Stmt[] = [];
    assert_then_stmts.push(...best_case_captures);
    assert_then_stmts.push(this.cx.stmt_expr(panic));
    const assert_then = this.cx.block(span, assert_then_stmts);

    const stmts: ast.Stmt[] = [];
    stmts.push(initial_imports);
    stmts.push(...capture_decls.map((c) => c.decl));
    stmts.push(...local_bind_decls);
    stmts.push(cx.stmt_expr(cx.expr(span, { $: "If", _0: cond_expr_with_unlikely, _1: assert_then, _2: undefined })));
    return cx.expr_block(cx.block(span, stmts));
  }

  /// Initial **trait** imports
  ///
  /// use ::core::asserting::{ ... };
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:99 build_initial_imports
  build_initial_imports(): ast.Stmt {
    const nested_tree = (this_: Context, sym_: Symbol): ast.UseTreeAndId => ({
      inner: new ast.UseTree(this_.cx.path(this_.span, [Ident.with_dummy_span(sym_)]), { $: "Simple", _0: undefined }),
      id: DUMMY_NODE_ID,
    });
    return this.cx.stmt_item(
      this.span,
      this.cx.item(this.span, [this.cx.attr_nested_word(sym.allow, sym.unused_imports, this.span)], {
        $: "Use",
        _0: new ast.UseTree(this.cx.path(this.span, this.cx.std_path([sym.asserting])), {
          $: "Nested",
          items: [nested_tree(this, sym.TryCaptureGeneric), nested_tree(this, sym.TryCapturePrintable)],
          span: this.span,
        }),
      }),
    );
  }

  /// Takes the conditional expression of `assert!` and then wraps it inside `unlikely`
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:127 build_unlikely
  build_unlikely(cond_expr: ast.Expr): ast.Expr {
    const unlikely_path = this.cx.std_path([sym.intrinsics, sym.unlikely]);
    return this.cx.expr_call(this.span, this.cx.expr_path(this.cx.path(this.span, unlikely_path)), [
      this.cx.expr(this.span, { $: "Unary", _0: ast.UnOp.Not, _1: cond_expr }),
    ]);
  }

  /// The necessary custom `panic!(...)` expression.
  ///
  /// panic!(
  ///     "Assertion failed: ... \n With expansion: ...",
  ///     __capture0,
  ///     ...
  /// );
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:143 build_panic
  build_panic(expr_str: string, panic_path: ast.Path): ast.Expr {
    const escaped_expr_str = escape_to_fmt(expr_str);
    const initial = [
      tokenstream.TokenTree.token_joint(
        {
          $: "Literal",
          _0: new token.Lit(
            token.LitKind.Str,
            Symbol.intern(
              this.fmt_string.length === 0
                ? `Assertion failed: ${escaped_expr_str}`
                : `Assertion failed: ${escaped_expr_str}\nWith captures:\n${this.fmt_string}`,
            ),
            undefined,
          ),
        },
        this.span,
      ),
      tokenstream.TokenTree.token_alone(token.TokenKind.Comma, this.span),
    ];
    const captures = this.capture_decls.flatMap((cap) => [
      tokenstream.TokenTree.token_joint({ $: "Ident", _0: cap.ident.name, _1: token.IdentKind.Normal }, cap.ident.span),
      tokenstream.TokenTree.token_alone(token.TokenKind.Comma, this.span),
    ]);
    return this.cx.expr(this.span, {
      $: "MacCall",
      _0: new ast.MacCall(
        panic_path,
        new ast.DelimArgs(
          tokenstream.DelimSpan.from_single(this.span),
          token.Delimiter.Parenthesis,
          tokenstream.TokenStream.from_iter([...initial, ...captures]),
        ),
      ),
    });
  }

  /// Recursive function called until `cond_expr` and `fmt_str` are fully modified.
  ///
  /// See [Self::manage_initial_capture] and [Self::manage_try_capture]
  // PORT: `expr: &mut Box<Expr>` -> the `Expr` object; `*expr = ..` replaces it in place.
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:188 manage_cond_expr
  manage_cond_expr(expr: ast.Expr): void {
    const kind = expr.kind;
    switch (kind.$) {
      case "AddrOf": {
        const [mutability, local_expr] = [kind._1, kind._2];
        this.with_is_consumed_management(mutability === ast.Mutability.Mut, (this_) => this_.manage_cond_expr(local_expr));
        break;
      }
      case "Array": {
        const local_exprs = kind._0;
        for (const local_expr of local_exprs) {
          this.manage_cond_expr(local_expr);
        }
        break;
      }
      case "Binary": {
        const [op, lhs, rhs] = [kind._0, kind._1, kind._2];
        const n = op.node;
        this.with_is_consumed_management(
          n === "Add" ||
            n === "And" ||
            n === "BitAnd" ||
            n === "BitOr" ||
            n === "BitXor" ||
            n === "Div" ||
            n === "Mul" ||
            n === "Or" ||
            n === "Rem" ||
            n === "Shl" ||
            n === "Shr" ||
            n === "Sub",
          (this_) => {
            this_.manage_cond_expr(lhs);
            this_.manage_cond_expr(rhs);
          },
        );
        break;
      }
      case "Call": {
        const local_exprs = kind._1;
        for (const local_expr of local_exprs) {
          this.manage_cond_expr(local_expr);
        }
        break;
      }
      case "Cast":
        this.manage_cond_expr(kind._0);
        break;
      case "If":
        this.manage_cond_expr(kind._0);
        break;
      case "Index":
        this.manage_cond_expr(kind._0);
        this.manage_cond_expr(kind._1);
        break;
      case "Let":
        this.manage_cond_expr(kind._1);
        break;
      case "Match":
        this.manage_cond_expr(kind._0);
        break;
      case "MethodCall": {
        const call = kind._0;
        for (const arg of call.args) {
          this.manage_cond_expr(arg);
        }
        break;
      }
      case "Move":
        this.manage_cond_expr(kind._0);
        break;
      case "Path": {
        const segments = kind._1.segments;
        if (segments.length === 1) {
          const path_segment = segments[0]!;
          const path_ident = path_segment.ident;
          this.manage_initial_capture(expr, path_ident);
        }
        // else: `ExprKind::Path(_, _)` below (not captured).
        break;
      }
      case "Paren":
        this.manage_cond_expr(kind._0);
        break;
      case "Range": {
        const [prefix, suffix] = [kind._0, kind._1];
        if (prefix !== undefined) {
          this.manage_cond_expr(prefix);
        }
        if (suffix !== undefined) {
          this.manage_cond_expr(suffix);
        }
        break;
      }
      case "Repeat":
        this.manage_cond_expr(kind._0);
        this.manage_cond_expr(kind._1.value);
        break;
      case "Struct": {
        const elem = kind._0;
        for (const field of elem.fields) {
          this.manage_cond_expr(field.expr);
        }
        if (elem.rest.$ === "Base") {
          this.manage_cond_expr(elem.rest._0);
        }
        break;
      }
      case "Tup": {
        const local_exprs = kind._0;
        for (const local_expr of local_exprs) {
          this.manage_cond_expr(local_expr);
        }
        break;
      }
      case "Unary": {
        const [un_op, local_expr] = [kind._0, kind._1];
        this.with_is_consumed_management(un_op === ast.UnOp.Neg || un_op === ast.UnOp.Not, (this_) =>
          this_.manage_cond_expr(local_expr),
        );
        break;
      }
      // Expressions that are not worth or can not be captured.
      //
      // Full list instead of `_` to catch possible future inclusions and to
      // sync with the `rfc-2011-nicer-assert-messages/all-expr-kinds.rs` test.
      case "Assign":
      case "AssignOp":
      case "Gen":
      case "Await":
      case "Use":
      case "Block":
      case "Break":
      case "Closure":
      case "ConstBlock":
      case "Continue":
      case "Dummy":
      case "Err":
      case "Field":
      case "ForLoop":
      case "FormatArgs":
      case "IncludedBytes":
      case "InlineAsm":
      case "Lit":
      case "Loop":
      case "MacCall":
      case "OffsetOf":
      case "Ret":
      case "Try":
      case "TryBlock":
      case "Type":
      case "Underscore":
      case "While":
      case "Yeet":
      case "Become":
      case "Yield":
      case "GcaMacro":
      case "UnsafeBinderCast":
        break;
    }
  }

  /// Pushes the top-level declarations and modifies `expr` to try capturing variables.
  ///
  /// `fmt_str`, the formatting string used for debugging, is constructed to show possible
  /// captured variables.
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:333 manage_initial_capture
  manage_initial_capture(expr: ast.Expr, path_ident: Ident): void {
    if (this.paths.some((p) => p.eq(path_ident))) {
      return;
    } else {
      this.fmt_string += "  ";
      this.fmt_string += path_ident.as_str();
      this.fmt_string += " = {:?}\n";
      this.paths.push(path_ident);
    }
    const curr_capture_idx = this.capture_decls.length;
    const capture_string = `__capture${curr_capture_idx}`;
    const ident = Ident.new(Symbol.intern(capture_string), this.span);
    const init_std_path = this.cx.std_path([sym.asserting, sym.Capture, sym.new]);
    const init = this.cx.expr_call(this.span, this.cx.expr_path(this.cx.path(this.span, init_std_path)), []);
    const capture: Capture = { decl: this.cx.stmt_let(this.span, true, ident, init), ident };
    this.capture_decls.push(capture);
    this.manage_try_capture(ident, curr_capture_idx, expr);
  }

  /// Tries to copy `__local_bindN` into `__captureN`.
  ///
  /// *{
  ///    (&Wrapper(__local_bindN)).try_capture(&mut __captureN);
  ///    __local_bindN
  /// }
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:362 manage_try_capture
  manage_try_capture(capture: Ident, curr_capture_idx: number, expr: ast.Expr): void {
    const local_bind_string = `__local_bind${curr_capture_idx}`;
    const local_bind = Ident.new(Symbol.intern(local_bind_string), this.span);
    this.local_bind_decls.push(this.cx.stmt_let(this.span, false, local_bind, this.cx.expr_addr_of(this.span, ast.clone_Expr(expr))));
    const wrapper = this.cx.expr_call(
      this.span,
      this.cx.expr_path(this.cx.path(this.span, this.cx.std_path([sym.asserting, sym.Wrapper]))),
      [this.cx.expr_path(ast.Path.from_ident(local_bind))],
    );
    const try_capture_call = this.cx
      .stmt_expr(
        this.cx.expr_method_call(
          this.span,
          this.cx.expr_paren(this.span, this.cx.expr_addr_of(this.span, wrapper)),
          Ident.new(sym.try_capture, this.span),
          [expr_addr_of_mut(this.cx, this.span, this.cx.expr_path(ast.Path.from_ident(capture)))],
        ),
      )
      .add_trailing_semicolon();
    const local_bind_path = this.cx.expr_path(ast.Path.from_ident(local_bind));
    let rslt: ast.Expr;
    if (this.is_consumed) {
      const ret = this.cx.stmt_expr(local_bind_path);
      rslt = this.cx.expr_block(this.cx.block(this.span, [try_capture_call, ret]));
    } else {
      this.best_case_captures.push(try_capture_call);
      rslt = local_bind_path;
    }
    replace_in_place(expr, this.cx.expr_deref(this.span, rslt));
  }

  // Calls `f` with the internal `is_consumed` set to `curr_is_consumed` and then
  // sets the internal `is_consumed` back to its original value.
  // rustc: compiler/rustc_builtin_macros/src/assert/context.rs:409 with_is_consumed_management
  with_is_consumed_management(curr_is_consumed: boolean, f: (this_: Context) => void): void {
    const prev_is_consumed = this.is_consumed;
    this.is_consumed = curr_is_consumed;
    f(this);
    this.is_consumed = prev_is_consumed;
  }
}

/// Information about a captured element.
// #[derive(Debug)] (unused)
interface Capture {
  // Generated indexed `Capture` statement.
  //
  // `let __capture{} = Capture::new();`
  decl: ast.Stmt;
  // The name of the generated indexed `Capture` variable.
  //
  // `__capture{}`
  ident: Ident;
}

/// Escapes to use as a formatting string.
// rustc: compiler/rustc_builtin_macros/src/assert/context.rs:431 escape_to_fmt
function escape_to_fmt(s: string): string {
  let rslt = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    // `c.escape_debug()`
    rslt += escape_char(c, true, true);
    switch (ch) {
      case "{":
      case "}":
        rslt += ch;
        break;
      default:
    }
  }
  return rslt;
}

// rustc: compiler/rustc_builtin_macros/src/assert/context.rs:443 expr_addr_of_mut
function expr_addr_of_mut(cx: ExtCtxt, sp: Span, e: ast.Expr): ast.Expr {
  return cx.expr(sp, { $: "AddrOf", _0: ast.BorrowKind.Ref, _1: ast.Mutability.Mut, _2: e });
}
