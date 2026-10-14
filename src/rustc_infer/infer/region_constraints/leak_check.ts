// Port of compiler/rustc_infer/src/infer/region_constraints/leak_check.rs (lane infer-regions).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { RegionConstraintCollector } from "./mod.ts";

export * from "./leak_check.gen.ts";

unported_methods(RegionConstraintCollector.prototype, "rustc_infer::infer::region_constraints::leak_check::RegionConstraintCollector", ["leak_check"]);
