//! Fluent is a modern localization system designed to improve how software is translated.
//!
//! `fluent-syntax` is the lowest level component of the [Fluent Localization
//! System](https://www.projectfluent.org).
//!
//! It exposes components necessary for parsing and tooling operations on Fluent Translation Lists ("FTL").
//!
//! The crate provides a [`parser`] module which allows for parsing of an
//! input string to an Abstract Syntax Tree defined in the [`ast`] module.
//!
//! The [`unicode`] module exposes a set of helper functions used to decode
//! escaped unicode literals according to Fluent specification.
//!
//! # Example
//!
//! ```
//! use fluent_syntax::parser;
//! use fluent_syntax::ast;
//!
//! let ftl = r#"
//!
//! hello-world = Hello World!
//!
//! "#;
//!
//! let resource = parser::parse(ftl)
//!     .expect("Failed to parse an FTL resource.");
//!
//! assert_eq!(
//!     resource.body[0],
//!     ast::Entry::Message(
//!         ast::Message {
//!             id: ast::Identifier {
//!                 name: "hello-world"
//!             },
//!             value: Some(ast::Pattern {
//!                 elements: vec![
//!                     ast::PatternElement::TextElement {
//!                         value: "Hello World!"
//!                     },
//!                 ]
//!             }),
//!             attributes: vec![],
//!             comment: None,
//!         }
//!     ),
//! );
//! ```
//
// Port of fluent-syntax-0.12.0 (the version in upstream's Cargo.lock), src/lib.rs.
// PORT: `pub mod x;` → namespace re-exports. Importing `./parser/mod.ts` loads the whole parser.

export * as ast from "./ast/mod.ts";
export * as parser from "./parser/mod.ts";
export * as serializer from "./serializer.ts";
export * as unicode from "./unicode.ts";

// Not ported: developer binaries and benchmarks (not part of the library rustc links).
// crate-skip: fluent-syntax-0.12.0/src/bin/parser.rs:23 read_file dev tool binary (src/bin), not library code
// crate-skip: fluent-syntax-0.12.0/src/bin/parser.rs:30 main dev tool binary (src/bin), not library code
// crate-skip: fluent-syntax-0.12.0/src/bin/update_fixtures.rs:14 read_file dev tool binary (src/bin), not library code
// crate-skip: fluent-syntax-0.12.0/src/bin/update_fixtures.rs:18 write_file dev tool binary (src/bin), not library code
// crate-skip: fluent-syntax-0.12.0/src/bin/update_fixtures.rs:22 main dev tool binary (src/bin), not library code
// crate-skip: fluent-syntax-0.12.0/benches/parser.rs:10 read_file benchmark, not library code or a test
// crate-skip: fluent-syntax-0.12.0/benches/parser.rs:15 get_resources benchmark, not library code or a test
// crate-skip: fluent-syntax-0.12.0/benches/parser.rs:24 get_ctxs benchmark, not library code or a test
// crate-skip: fluent-syntax-0.12.0/benches/parser.rs:41 parse_bench benchmark, not library code or a test
// crate-skip: fluent-syntax-0.12.0/benches/parser_iai.rs:3 iai_parse_ctx_runtime benchmark, not library code or a test
