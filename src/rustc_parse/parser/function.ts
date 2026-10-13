// Port of compiler/rustc_parse/src/parser/function.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into function.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import type { IsDotDotDot } from "./function.gen.ts";

export * from "./function.gen.ts";

/// The parsing configuration used to parse a parameter list (see `FnParseMode`).
///
/// The function decides if, per-parameter `p`, `p` must have a pattern or just a type.
///
/// This function pointer accepts an edition, because in edition 2015, trait declarations
/// were allowed to omit parameter names. In 2018, they became required. It also accepts an
/// `IsDotDotDot` parameter, as `extern` function declarations and function pointer types are
/// allowed to omit the name of the `...` but regular function items are not.
// PORT: `type ReqName = fn(Edition, IsDotDotDot) -> bool;` (hand: the probe does not describe fn types).
export type ReqName = (edition: Edition, is_dot_dot_dot: IsDotDotDot) => boolean;
/** `fn` pointers are `Copy`. */
export function clone_ReqName(v: ReqName): ReqName {
  return v;
}

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::function::Parser", [
  "parse_fn",
  "error_fn_body_not_found",
  "parse_fn_body",
  "check_fn_front_matter",
  "parse_fn_front_matter",
  "parse_fn_decl",
  "parse_fn_params",
  "parse_param_general",
  "parse_self_param",
  "is_named_param",
  "recover_self_param",
]);
