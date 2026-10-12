// Port of compiler/rustc_ast/src/util/classify.rs
//! Routines the parser and pretty-printer use to classify AST nodes.
//
// Types are generated into classify.gen.ts (tools/codegen/types.ts).
import type { Expr, MacCall, Path, Ty, YieldKind } from "../ast.ts";
import { unported } from "../../std/panic.ts";
import type { TrailingBrace } from "./classify.gen.ts";

export * from "./classify.gen.ts";

/** `YieldKind::expr` (ast.rs, not ported yet). */
function YieldKind_expr(_kind: YieldKind): Expr | undefined {
  return unported("rustc_ast::ast::YieldKind::expr");
}

/// This classification determines whether various syntactic positions break out
/// of parsing the current expression (true) or continue parsing more of the
/// same expression (false).
///
/// For example, it's relevant in the parsing of match arms:
///
/// ```ignore (illustrative)
/// match ... {
///     // Is this calling $e as a function, or is it the start of a new arm
///     // with a tuple pattern?
///     _ => $e (
///             ^                                                          )
///
///     // Is this an Index operation, or new arm with a slice pattern?
///     _ => $e [
///             ^                                                          ]
///
///     // Is this a binary operator, or leading vert in a new arm? Same for
///     // other punctuation which can either be a binary operator in
///     // expression or unary operator in pattern, such as `&` and `-`.
///     _ => $e |
///             ^
/// }
/// ```
///
/// If $e is something like `{}` or `if … {}`, then terminate the current
/// arm and parse a new arm.
///
/// If $e is something like `path::to` or `(…)`, continue parsing the same
/// arm.
///
/// *Almost* the same classification is used as an early bail-out for parsing
/// statements. See `expr_requires_semi_to_be_stmt`.
// rustc: compiler/rustc_ast/src/util/classify.rs:40 expr_is_complete
export function expr_is_complete(e: Expr): boolean {
  const k = e.kind.$;
  return (
    k === "If" ||
    k === "Match" ||
    k === "Block" ||
    k === "While" ||
    k === "Loop" ||
    k === "ForLoop" ||
    k === "TryBlock" ||
    k === "ConstBlock"
  );
}

/// Does this expression require a semicolon to be treated as a statement?
///
/// The negation of this: "can this expression be used as a statement without a
/// semicolon" -- is used as an early bail-out when parsing statements so that,
/// for instance,
///
/// ```ignore (illustrative)
/// if true {...} else {...}
/// |x| 5
/// ```
///
/// isn't parsed as `(if true {...} else {...} | x) | 5`.
///
/// Surprising special case: even though braced macro calls like `m! {}`
/// normally do not introduce a boundary when found at the head of a match arm,
/// they do terminate the parsing of a statement.
///
/// ```ignore (illustrative)
/// match ... {
///     _ => m! {} (),  // macro that expands to a function, which is then called
/// }
///
/// let _ = { m! {} () };  // macro call followed by unit
/// ```
// rustc: compiler/rustc_ast/src/util/classify.rs:78 expr_requires_semi_to_be_stmt
export function expr_requires_semi_to_be_stmt(e: Expr): boolean {
  const kind = e.kind;
  switch (kind.$) {
    case "MacCall":
      // mac_call.args.delim != Delimiter::Brace
      return kind._0.args.delim.$ !== "Brace";
    default:
      return !expr_is_complete(e);
  }
}

/// Returns whether the leftmost token of the given expression is the label of a
/// labeled loop or block, such as in `'inner: loop { break 'inner 1 } + 1`.
///
/// Such expressions are not allowed as the value of an unlabeled break.
///
/// ```ignore (illustrative)
/// 'outer: {
///     break 'inner: loop { break 'inner 1 } + 1;  // invalid syntax
///
///     break 'outer 'inner: loop { break 'inner 1 } + 1;  // okay
///
///     break ('inner: loop { break 'inner 1 } + 1);  // okay
///
///     break ('inner: loop { break 'inner 1 }) + 1;  // okay
/// }
/// ```
// rustc: compiler/rustc_ast/src/util/classify.rs:101 leading_labeled_expr
export function leading_labeled_expr(expr: Expr): boolean {
  for (;;) {
    const kind = expr.kind;
    switch (kind.$) {
      case "Block":
        return kind._1 !== undefined;
      case "ForLoop":
        return kind._0.label !== undefined;
      case "Loop":
        return kind._1 !== undefined;
      case "While":
        return kind._2 !== undefined;

      case "Assign":
      case "Await":
      case "Move":
      case "Use":
      case "Call":
      case "Cast":
      case "Field":
      case "Index":
      case "Try":
        expr = kind._0;
        break;
      case "AssignOp":
      case "Binary":
        expr = kind._1;
        break;
      case "Match":
        if (kind._2 === "Postfix") {
          expr = kind._0;
          break;
        }
        // Match(_, _, MatchKind::Prefix)
        return false;
      case "Range":
        if (kind._0 !== undefined) {
          expr = kind._0;
          break;
        }
        // Range(None, _, _)
        return false;
      case "MethodCall":
        expr = kind._0.receiver;
        break;

      case "AddrOf":
      case "Array":
      case "Become":
      case "Break":
      case "Closure":
      case "ConstBlock":
      case "Continue":
      case "FormatArgs":
      case "Gen":
      case "If":
      case "IncludedBytes":
      case "InlineAsm":
      case "Let":
      case "Lit":
      case "MacCall":
      case "OffsetOf":
      case "Paren":
      case "Path":
      case "Repeat":
      case "Ret":
      case "Struct":
      case "TryBlock":
      case "Tup":
      case "Type":
      case "Unary":
      case "Underscore":
      case "Yeet":
      case "Yield":
      case "UnsafeBinderCast":
      case "GcaMacro":
      case "Err":
      case "Dummy":
        return false;
    }
  }
}

/// If an expression ends with `}`, returns the innermost expression ending in the `}`
// rustc: compiler/rustc_ast/src/util/classify.rs:178 expr_trailing_brace
export function expr_trailing_brace(expr: Expr): TrailingBrace | undefined {
  for (;;) {
    const kind = expr.kind;
    switch (kind.$) {
      case "AddrOf":
        expr = kind._2;
        break;
      case "Assign":
        expr = kind._1;
        break;
      case "AssignOp":
      case "Binary":
        expr = kind._2;
        break;
      case "Break":
        if (kind._1 !== undefined) {
          expr = kind._1;
          break;
        }
        // Break(_, None)
        return undefined;
      case "Let":
        expr = kind._1;
        break;
      case "Range":
        if (kind._1 !== undefined) {
          expr = kind._1;
          break;
        }
        // Range(_, None, _)
        return undefined;
      case "Ret":
      case "Yeet":
        if (kind._0 !== undefined) {
          expr = kind._0;
          break;
        }
        // Ret(None) | Yeet(None)
        return undefined;
      case "Unary":
        expr = kind._1;
        break;
      case "Move":
      case "Become":
        expr = kind._0;
        break;
      case "Yield": {
        const e = YieldKind_expr(kind._0);
        if (e !== undefined) {
          expr = e;
          break;
        }
        return undefined;
      }
      case "Closure":
        expr = kind._0.body;
        break;
      case "Gen":
      case "Block":
      case "ForLoop":
      case "If":
      case "Loop":
      case "Match":
      case "Struct":
      case "TryBlock":
      case "While":
      case "ConstBlock":
        return { $: "Expr", _0: expr };

      case "Cast": {
        const ty = kind._1;
        const mac = type_trailing_braced_mac_call(ty);
        return mac !== undefined ? { $: "MacCall", _0: mac } : undefined;
      }

      case "MacCall": {
        const mac = kind._0;
        return mac.args.delim.$ === "Brace" ? { $: "MacCall", _0: mac } : undefined;
      }

      case "InlineAsm":
      case "OffsetOf":
      case "IncludedBytes":
      case "FormatArgs":
        // These should have been denied pre-expansion.
        return undefined;

      case "Array":
      case "Call":
      case "MethodCall":
      case "Tup":
      case "Lit":
      case "Type":
      case "Await":
      case "Use":
      case "Field":
      case "Index":
      case "Underscore":
      case "Path":
      case "Continue":
      case "Repeat":
      case "Paren":
      case "Try":
      case "UnsafeBinderCast":
      case "GcaMacro":
      case "Err":
      case "Dummy":
        return undefined;
    }
  }
}

/// If the type's last token is `}`, it must be due to a braced macro call, such
/// as in `*const brace! { ... }`. Returns that trailing macro call.
// rustc: compiler/rustc_ast/src/util/classify.rs:258 type_trailing_braced_mac_call
function type_trailing_braced_mac_call(ty: Ty): MacCall | undefined {
  for (;;) {
    const kind = ty.kind;
    switch (kind.$) {
      case "MacCall": {
        const mac = kind._0;
        return mac.args.delim.$ === "Brace" ? mac : undefined;
      }

      case "Ptr":
        ty = kind._0;
        break;
      case "Ref":
      case "PinnedRef":
        ty = kind._1;
        break;

      case "UnsafeBinder":
        ty = kind._0.inner_ty;
        break;

      case "FnPtr": {
        const output = kind._0.decl.output;
        if (output.$ === "Default") return undefined;
        ty = output._0;
        break;
      }

      case "Path": {
        const trailing_ty = path_return_type(kind._1);
        if (trailing_ty !== undefined) {
          ty = trailing_ty;
          break;
        }
        return undefined;
      }

      case "TraitObject":
      case "ImplTrait": {
        const bounds = kind.$ === "TraitObject" ? kind._0 : kind._1;
        const last = bounds[bounds.length - 1];
        if (last !== undefined && last.$ === "Trait") {
          const trailing_ty = path_return_type(last._0.trait_ref.path);
          if (trailing_ty !== undefined) {
            ty = trailing_ty;
            break;
          }
          return undefined;
        }
        // Some(GenericBound::Outlives(_) | GenericBound::Use(..)) | None
        return undefined;
      }

      case "Slice":
      case "Array":
      case "Never":
      case "Tup":
      case "Paren":
      case "Infer":
      case "ImplicitSelf":
      case "CVarArgs":
      case "Pat":
      case "FieldOf":
      case "View":
      case "GcaMacro":
      case "Dummy":
      case "Err":
        return undefined;
    }
  }
}

/// Returns the trailing return type in the given path, if it has one.
///
/// ```ignore (illustrative)
/// ::std::ops::FnOnce(&str) -> fn() -> *const c_void
///                             ^^^^^^^^^^^^^^^^^^^^^
/// ```
// rustc: compiler/rustc_ast/src/util/classify.rs:323 path_return_type
function path_return_type(path: Path): Ty | undefined {
  const last_segment = path.segments[path.segments.length - 1];
  if (last_segment === undefined) return undefined;
  const args = last_segment.args;
  if (args === undefined) return undefined;
  switch (args.$) {
    case "Parenthesized": {
      const output = args._0.output;
      switch (output.$) {
        case "Default":
          return undefined;
        case "Ty":
          return output._0;
      }
    }
    // falls through (unreachable: both arms return)
    case "AngleBracketed":
    case "ParenthesizedElided":
      return undefined;
  }
}
