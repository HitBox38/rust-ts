// Port of compiler/rustc_parse/src/parser/asm.rs (STUB: not ported yet).
//
// Created by lane parser-core as the per-file module the owning lane fills in:
// - types are generated into asm.gen.ts (tools/codegen, set `rustc_parse`) and re-exported here;
// - every `impl Parser` method of this file is declared in parser/decls.ts; port each one as
//   `Parser.prototype.<name> = function (this: Parser, ..) {..}` with its `// rustc:` marker, in
//   upstream order, and delete its name from the `unported_methods` list below;
// - the companions / free fns below are signatures with `unported(..)` bodies and no markers.
// Init order: see parser/mod.ts (never touch other extension modules at module top level).
import { Parser } from "./mod.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { AsmMacro } from "../../rustc_ast/lib.ts";
import type { PResult } from "../../rustc_errors/lib.ts";
import type { AsmArg } from "./asm.gen.ts";
import * as gen from "./asm.gen.ts";
import { unported } from "../../std/panic.ts";

export * from "./asm.gen.ts";

// PORT: statics of the generated `AsmAttrVec` class. The `ast::HasAttrs` / `ast::HasTokens` impls for
// `AsmAttrVec` are left to the asm lane (impl tables, ast-visit convention).
export const AsmAttrVec = gen.AsmAttrVec as typeof gen.AsmAttrVec & {
  parse: (p: Parser) => PResult<gen.AsmAttrVec>;
};
export type AsmAttrVec = gen.AsmAttrVec;
AsmAttrVec.parse = function (_p: Parser): PResult<gen.AsmAttrVec> {
  return unported("rustc_parse::parser::asm::AsmAttrVec::parse");
};

// pub fn parse_asm_args<'a>(p: &mut Parser<'a>, sp: Span, asm_macro: ast::AsmMacro) -> PResult<'a, Vec<AsmArg>> (asm.rs:169)
export function parse_asm_args(_p: Parser, _sp: Span, _asm_macro: AsmMacro): PResult<AsmArg[]> {
  return unported("rustc_parse::parser::asm::parse_asm_args");
}
