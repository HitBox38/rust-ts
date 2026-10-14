// Port of compiler/rustc_infer/src/infer/opaque_types/mod.rs (lane infer-opaque-snapshot).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { InferCtxt } from "../../decls.ts";

unported_methods(InferCtxt.prototype, "rustc_infer::infer::opaque_types::InferCtxt", ["replace_opaque_types_with_inference_vars", "handle_opaque_type", "register_hidden_type", "register_hidden_type_in_storage", "insert_hidden_type", "add_item_bounds_for_hidden_type"]);
