// Port of compiler/rustc_parse/src/lib.rs (crate root). Partial: only the module wiring the
// lexer needs so far; the lib.rs fns belong to the parser lane.
//
// PORT: extension modules (PORTING §5): `lexer/tokentrees.ts` adds methods to `Lexer` and is
// imported here for its side effects, after the defining module `lexer/mod.ts`.
import "./lexer/mod.ts";
import "./lexer/tokentrees.ts";

// pub mod lexer;
export * as lexer from "./lexer/mod.ts";
