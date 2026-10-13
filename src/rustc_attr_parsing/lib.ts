//! Centralized logic for parsing and attributes.
//!
//! ## Architecture
//! This crate is part of a series of crates and modules that handle attribute processing.
//! - [`rustc_attr_ir`]: Defines the data structures that store parsed attributes
//! - `rustc_attr_parsing`: This crate, handles the parsing of attributes
//! - [`rustc_passes::check_attr`] handles attribute validation that cannot be done in this crate
//!
//! The separation between data structures and parsing follows the principle of separation of concerns.
//! Data structures (`rustc_attr_ir`) define what attributes look like after parsing.
//! This crate (`rustc_attr_parsing`) handles how to convert raw tokens into those structures.
//! This split allows other parts of the compiler to use the data structures without needing
//! the parsing logic, making the codebase more modular and maintainable.
//!
//! ## Background
//! Previously, the compiler had a single attribute definition ([`ast::Attribute`]) with parsing and
//! validation scattered throughout the codebase. This was reorganized for better maintainability
//! (see [#131229](https://github.com/rust-lang/rust/issues/131229)).
//!
//! ## Types of Attributes
//! In Rust, attributes are markers that can be attached to items. They come in two main categories.
//!
//! ### 1. Active Attributes
//! These are attribute-like proc-macros that expand into other Rust code.
//! They can be either user-defined or compiler-provided. Examples of compiler-provided active attributes:
//!   - `#[derive(...)]`: Expands into trait implementations
//!   - `#[cfg()]`: Expands based on configuration
//!   - `#[cfg_attr()]`: Conditional attribute application
//!
//! ### 2. Inert Attributes
//! These are pure markers that don't expand into other code. They guide the compilation process.
//! They can be user-defined (in proc-macro helpers) or built-in. Examples of built-in inert attributes:
//!   - `#[stable()]`: Marks stable API items
//!   - `#[inline()]`: Suggests function inlining
//!   - `#[repr()]`: Controls type representation
//!
//! ```text
//!                      Active                 Inert
//!              ┌──────────────────────┬──────────────────────┐
//!              │     (mostly in)      │    these are parsed  │
//!              │ rustc_builtin_macros │        here!         │
//!              │                      │                      │
//!              │    #[derive(...)]    │    #[stable()]       │
//!     Built-in │    #[cfg()]          │    #[inline()]       │
//!              │    #[cfg_attr()]     │    #[repr()]         │
//!              │                      │                      │
//!              ├──────────────────────┼──────────────────────┤
//!              │                      │                      │
//!              │                      │       `b` in         │
//!              │                      │ #[proc_macro_derive( │
//! User created │ #[proc_macro_attr()] │    a,                │
//!              │                      │    attributes(b)     │
//!              │                      │ ]                    │
//!              └──────────────────────┴──────────────────────┘
//! ```
//!
//! ## How This Crate Works
//! In this crate, syntactical attributes (sequences of tokens that look like
//! `#[something(something else)]`) are parsed into more semantic attributes, markers on items.
//! Multiple syntactic attributes might influence a single semantic attribute. For example,
//! `#[stable(...)]` and `#[unstable()]` cannot occur together, and both semantically define
//! a "stability" of an item. So, the stability attribute has an
//! [`AttributeParser`](attributes::AttributeParser) that recognizes both the `#[stable()]`
//! and `#[unstable()]` syntactic attributes, and at the end produces a single
//! [`AttributeKind::Stability`](rustc_attr_ir::AttributeKind::Stability).
//!
//! When multiple instances of the same attribute are allowed, they're combined into a single
//! semantic attribute. For example:
//!
//! ```rust
//! #[repr(C)]
//! #[repr(packed)]
//! struct Meow {}
//! ```
//!
//! This is equivalent to `#[repr(C, packed)]` and results in a single `AttributeKind::Repr`
//! containing both `C` and `packed` annotations.
//!
//! ## Early attribute parsing
//!
//! While lowering to the HIR, all attributes are parsed using the attribute parsers.
//! However, sometimes an attributes' parsed form is needed before the HIR is constructed.
//! This is referred to as "early" attribute parsing,
//! and is performed using the `parse_limited_*` family of functions on `AttributeParser`.
//!
//! [`ast::Attribute`]: rustc_ast::ast::Attribute
//! [`rustc_passes::check_attr`]: ../rustc_passes/check_attr/index.html
// Port of compiler/rustc_attr_parsing/src/lib.rs
//
// Module wiring (PORTING §5): the defining modules first, then the extension modules that attach
// `impl AttributeParser` / `impl AcceptContext` methods from other files (safety.rs, stability.rs,
// target_checking.rs, attributes/diagnostic/mod.rs). Consumers outside the crate import this file.
// rustc_parse (and through it rustc_ast) is loaded first: parser.ts uses its extension methods.
import "../rustc_parse/lib.ts";
import "../rustc_attr_ir/lib.ts";
import "./interface.ts";
import "./context.ts";
import "./safety.ts";
import { install as install_stability } from "./stability.ts";
import { install as install_target_checking } from "./target_checking.ts";
import { install as install_util } from "./attributes/util.ts";
import { install as install_diagnostic } from "./attributes/diagnostic/mod.ts";

// #[macro_use]
// mod attributes;
// mod check_cfg;
// mod context;
// mod diagnostics;
// mod interface;
// pub mod parser;
// mod safety;
// mod stability;
// mod synthetic;
// mod target_checking;
// mod template;
// pub mod validate_attr;
export * as parser from "./parser.ts";
export * as validate_attr from "./validate_attr.ts";

export { AttributeSafety } from "./attributes/mod.ts";
export {
  CFG_TEMPLATE,
  type EvalConfigResult,
  eval_config_entry,
  parse_cfg,
  parse_cfg_attr,
  parse_cfg_entry,
} from "./attributes/cfg.ts";
export * from "./attributes/cfg_select.ts";
export { is_builtin_attr, parse_version } from "./attributes/util.ts";
export { debug_ShouldEmit, ShouldEmit } from "./context.ts";
export { ParsedDescription } from "./diagnostics.ts";
export { AttributeParser, EmitAttribute } from "./interface.ts";
// pub use rustc_parse::parser::Recovery;
export { Recovery } from "../rustc_parse/parser/mod.gen.ts";
export { AttributeTemplate, template } from "./template.ts";
export { unstable } from "./stability.ts";

// PORT: extension modules that the attribute parser modules import (so they are evaluated while
// context.ts is still evaluating) install their `impl AttributeParser` / `impl AcceptContext` fns here.
install_stability();
install_target_checking();
install_util();
install_diagnostic();
