// Port of compiler/rustc_expand/src/lib.rs (crate root).
//
// PORT: extension modules (PORTING §5) are imported here for their side effects, after their defining
// module: build.ts attaches the `ExtCtxt` builder methods (build.rs `impl ExtCtxt`) to base.ts's class.
// Consumers outside the crate import this module (PORTING §8).
import "../rustc_ast/lib.ts";
import "../rustc_parse/lib.ts";
import "../rustc_attr_parsing/lib.ts";
import "./base.ts";
import "./build.ts";

// mod build;
// mod diagnostics;
// mod mbe;
// mod placeholders;
// mod proc_macro_server;
// mod stats;
// (crate-private modules: imported directly by the crate's files)

// pub use mbe::macro_rules::{MacroRulesMacroExpander, compile_declarative_macro};
// PORT(pending mbe-b): `compile_declarative_macro` is added to this re-export when mbe/macro_rules.ts lands.
export { MacroRulesMacroExpander } from "./mbe/macro_rules.ts";
export * as base from "./base.ts";
export * as config from "./config.ts";
export * as expand from "./expand.ts";
export * as module from "./module.ts";
export * as proc_macro from "./proc_macro.ts";
