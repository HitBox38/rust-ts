// Port of compiler/rustc_infer/src/infer/resolve.rs (lane infer-core).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported } from "../../std/panic.ts";
import type { FreeFns } from "../decls.ts";

export * from "./resolve.gen.ts";


// stub: infer/resolve.rs:76
export const deeply_resolve_via_region_graph = ((): never => unported("rustc_infer::infer::resolve::deeply_resolve_via_region_graph")) as FreeFns["deeply_resolve_via_region_graph"];
