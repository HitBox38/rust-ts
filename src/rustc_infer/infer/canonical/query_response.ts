// Port of compiler/rustc_infer/src/infer/canonical/query_response.rs (lane infer-canonical-outlives).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported } from "../../../std/panic.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { InferCtxt } from "../../decls.ts";
import type { FreeFns } from "../../decls.ts";

unported_methods(InferCtxt.prototype, "rustc_infer::infer::canonical::query_response::InferCtxt", ["make_canonicalized_query_response", "make_query_response_ignoring_pending_obligations", "make_query_response", "instantiate_query_response_and_region_obligations", "instantiate_nll_query_response_and_region_obligations", "query_response_instantiation", "query_response_instantiation_guess", "unify_query_response_instantiation_guess", "unify_canonical_vars"]);

// stub: infer/canonical/query_response.rs:617
export const make_query_region_constraints = ((): never => unported("rustc_infer::infer::canonical::query_response::make_query_region_constraints")) as FreeFns["make_query_region_constraints"];
