//! The `rustc_ast_passes` crate contains passes which validate the AST in `syntax`
//! parsed by `rustc_parse` and then lowered, after the passes in this crate,
//! by `rustc_ast_lowering`.

// tidy-alphabetical-start
// #![feature(deref_patterns)]
// #![feature(iter_intersperse)]
// #![feature(iter_is_partitioned)]
// #![feature(option_into_flat_iter)]
// tidy-alphabetical-end

// PORT: `rustc_ast` and `rustc_attr_parsing` attach methods through extension modules; load them first.
import "../rustc_ast/lib.ts";
import "../rustc_attr_parsing/lib.ts";

export * as ast_validation from "./ast_validation.ts";
// mod diagnostics;
export * as feature_gate from "./feature_gate.ts";
