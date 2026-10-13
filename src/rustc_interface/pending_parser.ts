// Not an upstream mirror. PORT: pending parser (lane parser-core creates src/rustc_parse/lib.ts with these
// entry points). The driver codes against the upstream names; until the parser merges each one calls
// `unported`. ROOT: on integration, delete this file and import from "../rustc_parse/lib.ts" (and the
// `Parser` methods from the parser modules) in passes.ts and ../rustc_driver_impl/lib.ts.
import type { AttrVec, Crate } from "../rustc_ast/ast.gen.ts";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import type { PResult } from "../rustc_errors/lib.gen.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { StripTokens } from "../rustc_parse/lexer/mod.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { FileName, Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";

/** `rustc_parse::parser::Parser` (the methods the driver calls). */
export interface Parser {
  parse_crate_mod(): PResult<Crate>;
  parse_inner_attributes(): PResult<AttrVec>;
}

/** `rustc_parse::unwrap_or_emit_fatal` (lib.rs:78) */
export function unwrap_or_emit_fatal<T>(_expr: Result<T, Diag[]>): T {
  return unported("rustc_parse::unwrap_or_emit_fatal (pending lane parser-core)");
}

/** `rustc_parse::new_parser_from_source_str` (lib.rs:94) */
export function new_parser_from_source_str(_psess: ParseSess, _name: FileName, _source: string, _strip_tokens: StripTokens): Result<Parser, Diag[]> {
  return unported("rustc_parse::new_parser_from_source_str (pending lane parser-core)");
}

/** `rustc_parse::new_parser_from_file` (lib.rs:111) */
export function new_parser_from_file(_psess: ParseSess, _path: PathBuf, _strip_tokens: StripTokens, _sp: Span | undefined): Result<Parser, Diag[]> {
  return unported("rustc_parse::new_parser_from_file (pending lane parser-core)");
}
