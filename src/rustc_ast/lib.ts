// Port of compiler/rustc_ast/src/lib.rs
//! The Rust Abstract Syntax Tree (AST).
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
//
// PORT: `pub mod x;` -> `export * as x from "./x.ts"`; `pub use` -> re-exports. The inline
// `pub mod util { pub mod case; .. }` has no file of its own: import `./util/<name>.ts` directly.
export * as ast from "./ast.ts";
export * as ast_traits from "./ast_traits.ts";
export * as attr from "./attr/mod.ts";
export * as entry from "./entry.ts";
export * as expand from "./expand/mod.ts";
export * as format from "./format.ts";
export * as mut_visit from "./mut_visit.ts";
export * as node_id from "./node_id.ts";
export * as token from "./token.ts";
export * as tokenstream from "./tokenstream.ts";
export * as visit from "./visit.ts";

export * from "./ast.ts";
// pub use self::ast_traits::{AstNodeWrapper, HasAttrs, HasNodeId, HasTokens};
export { AstNodeWrapper, debug_AstNodeWrapper, HasAttrs, HasNodeId, HasTokens } from "./ast_traits.ts";

// Extension modules (methods defined on types from other files, PORTING §5): load after the
// defining modules so the prototypes/companions exist.
import "./util/literal.ts";
import "./attr/mod.ts";
