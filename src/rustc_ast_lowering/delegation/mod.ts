// Port of compiler/rustc_ast_lowering/src/delegation/mod.rs (STUB, lane lower-delegation: see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ../decls.ts (the
// contract) and assigned onto the prototype here, in upstream order, each with its `// rustc:` marker; until
// then the `unported_methods(..)` calls below install an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
//! This module implements expansion of delegation items with early resolved paths.
//! (See the upstream module doc comment; the porting lane copies it in full.)
import { LoweringContext } from "../decls.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

// mod attributes;
import "./attributes.ts";
// mod generics;
import "./generics.ts";
// pub(crate) mod resolution;
export * as resolution from "./resolution.ts";

// Types of this file (PORT: `unknown` until codegen set rustc_ast_lowering generates delegation/mod.gen.ts).
/** delegation/mod.rs:67 `pub(crate) struct DelegationResults<'hir>` */
export type DelegationResults = unknown;
/** delegation/mod.rs:625 `struct SelfResolver<'a, 'b, 'hir>` (a `Visitor`) */
export type SelfResolver = unknown;

unported_methods(LoweringContext.prototype, "rustc_ast_lowering::delegation::LoweringContext", [
  "lower_delegation", "lower_delegation_decl", "lower_delegation_sig", "generate_param", "generate_arg",
  "lower_delegation_body", "lower_block_maybe_more_than_once", "finalize_body_lowering", "process_segment",
  "generate_delegation_error", "generate_header_error", "mk_expr",
]);
