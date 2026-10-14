// Port of compiler/rustc_infer/src/infer/outlives/mod.rs (lane infer-canonical-outlives).
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

unported_methods(InferCtxt.prototype, "rustc_infer::infer::outlives::InferCtxt", ["resolve_regions_with_outlives_env", "take_and_reset_region_constraints", "with_region_constraints"]);

// stub: infer/outlives/mod.rs:23
export const explicit_outlives_bounds = ((): never => unported("rustc_infer::infer::outlives::explicit_outlives_bounds")) as FreeFns["explicit_outlives_bounds"];
