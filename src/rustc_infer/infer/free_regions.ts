// Port of compiler/rustc_infer/src/infer/free_regions.rs (lane infer-regions).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../rust_ts/stubs.ts";
import { FreeRegionMap, RegionRelations } from "./free_regions.gen.ts";

export * from "./free_regions.gen.ts";

unported_methods(RegionRelations.prototype, "rustc_infer::infer::free_regions::RegionRelations", ["lub_param_regions"]);
unported_methods(RegionRelations, "rustc_infer::infer::free_regions::RegionRelations", ["new"]);
unported_methods(FreeRegionMap.prototype, "rustc_infer::infer::free_regions::FreeRegionMap", ["elements", "is_empty", "sub_free_regions", "check_relation", "lub_param_regions"]);
