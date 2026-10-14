// Port of compiler/rustc_infer/src/infer/canonical/instantiate.rs (lane infer-canonical-outlives).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported } from "../../../std/panic.ts";
import type { FreeFns } from "../../decls.ts";

export * from "./instantiate.gen.ts";


// stub: infer/canonical/instantiate.rs:55
export const instantiate_value = ((): never => unported("rustc_infer::infer::canonical::instantiate::instantiate_value")) as FreeFns["instantiate_value"];
// stub: infer/canonical/instantiate.rs:24
export const Canonical_instantiate = ((): never => unported("rustc_infer::infer::canonical::instantiate::CanonicalExt::instantiate")) as FreeFns["Canonical_instantiate"];
// stub: infer/canonical/instantiate.rs:37
export const Canonical_instantiate_projected = ((): never => unported("rustc_infer::infer::canonical::instantiate::CanonicalExt::instantiate_projected")) as FreeFns["Canonical_instantiate_projected"];
