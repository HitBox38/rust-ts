// Port of compiler/rustc_infer/src/infer/lexical_region_resolve/mod.rs (lane infer-regions).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported } from "../../../std/panic.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { LexicalRegionResolutions } from "./mod.gen.ts";
import type { Companions, FreeFns } from "../../decls.ts";
import * as gen from "./mod.gen.ts";

export * from "./mod.gen.ts";

import type { Debug } from "../../../std/fmt.ts";
import type { RegionAndOrigin } from "./mod.gen.ts";

// Stub of the manual `Debug` impl of `RegionAndOrigin` (mod.rs:956).
export const debug_RegionAndOrigin: Debug<RegionAndOrigin> = () =>
  unported("rustc_infer::infer::lexical_region_resolve::<RegionAndOrigin as Debug>::fmt");

unported_methods(LexicalRegionResolutions.prototype, "rustc_infer::infer::lexical_region_resolve::LexicalRegionResolutions", ["normalize", "value", "value_mut", "resolve_region"]);

export type RegionResolutionError = gen.RegionResolutionError;
export const RegionResolutionError = {} as Companions["RegionResolutionError"];
unported_methods(RegionResolutionError, "rustc_infer::infer::lexical_region_resolve::RegionResolutionError", ["origin"]);

// stub: infer/lexical_region_resolve/mod.rs:31
export const resolve = ((): never => unported("rustc_infer::infer::lexical_region_resolve::resolve")) as FreeFns["resolve"];
