// Port of compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs (STUB, lane fnctxt-contract): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/mod.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./mod.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { FnCtxt } from "../decls.ts";
import { LoweredTy } from "./mod.gen.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::FnCtxt", ["typing_mode", "dcx", "cause", "misc", "sess", "err_ctxt"]);
unported_methods(LoweredTy, "rustc_hir_typeck::fn_ctxt::LoweredTy", ["from_raw"]);
