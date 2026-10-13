// Port of compiler/rustc_parse/src/parser/path.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into path.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import * as gen from "./path.gen.ts";
import { unported } from "../../std/panic.ts";

export * from "./path.gen.ts";

export type PathStyle = gen.PathStyle;
export const PathStyle = {
  ...gen.PathStyle,
  // fn has_generic_ambiguity(&self) -> bool (path.rs)
  has_generic_ambiguity(_self: PathStyle): boolean {
    return unported("rustc_parse::parser::path::PathStyle::has_generic_ambiguity");
  },
};

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::path::Parser", [
  "parse_qpath",
  "recover_colon_before_qpath_proj",
  "parse_path",
  "parse_path_inner",
  "parse_path_segments",
  "eat_path_sep",
  "parse_path_segment",
  "parse_path_segment_ident",
  "recover_fn_call_leading_path_sep",
  "parse_angle_args_with_leading_angle_bracket_recovery",
  "parse_angle_args",
  "parse_angle_arg",
  "parse_assoc_equality_term",
  "expr_is_valid_const_arg",
  "parse_const_arg",
  "parse_unambiguous_unbraced_const_arg",
  "parse_generic_arg",
  "get_ident_from_generic_arg",
]);
