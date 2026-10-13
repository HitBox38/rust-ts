// Port of compiler/rustc_parse/src/parser/generics.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into generics.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

export * from "./generics.gen.ts";

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::generics::Parser", [
  "parse_lt_param_bounds",
  "parse_ty_param",
  "parse_const_param",
  "recover_const_param_with_mistyped_const",
  "parse_generic_params",
  "parse_generics",
  "parse_contract",
  "parse_contract_requires",
  "parse_contract_ensures",
  "parse_where_clause",
  "parse_struct_where_clause",
  "parse_where_clause_common",
  "parse_where_clause_predicates",
  "parse_ty_where_predicate_kind_or_recover_tuple_struct_body",
  "parse_ty_where_predicate_kind",
  "choose_generics_over_qpath",
]);
