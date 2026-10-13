// Port of compiler/rustc_parse/src/parser/cfg_select.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into cfg_select.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

export * from "./cfg_select.gen.ts";

// PORT(stub): placeholders until this file is ported; remove each name as its method is ported.
unported_methods(Parser.prototype, "rustc_parse::parser::cfg_select::Parser", [
  "parse_cfg_select_branch_rhs",
]);
