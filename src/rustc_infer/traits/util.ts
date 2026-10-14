// Port of compiler/rustc_infer/src/traits/util.rs (lane infer-opaque-snapshot).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported } from "../../std/panic.ts";
import type { FreeFns } from "../decls.ts";

export * from "./util.gen.ts";


// stub: traits/util.rs:8
export const anonymize_predicate = ((): never => unported("rustc_infer::traits::util::anonymize_predicate")) as FreeFns["anonymize_predicate"];
// stub: traits/util.rs:111
export const transitive_bounds_that_define_assoc_item = ((): never => unported("rustc_infer::traits::util::transitive_bounds_that_define_assoc_item")) as FreeFns["transitive_bounds_that_define_assoc_item"];
