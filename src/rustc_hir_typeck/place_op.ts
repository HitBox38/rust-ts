// Port of compiler/rustc_hir_typeck/src/place_op.rs (STUB, lane typeck-impl): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// place_op.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/place_op.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported_methods } from "../rust_ts/stubs.ts";
import { FnCtxt } from "./decls.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::place_op::FnCtxt", ["lookup_derefing", "lookup_indexing", "negative_index", "try_index_step", "try_overloaded_place_op", "try_mutable_overloaded_place_op", "convert_place_derefs_to_mutable", "convert_place_op_to_mutable"]);
