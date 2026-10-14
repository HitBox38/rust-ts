// Port of compiler/rustc_infer/src/infer/opaque_types/table.rs (lane infer-opaque-snapshot).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../../rust_ts/stubs.ts";
import { OpaqueTypeStorage, OpaqueTypeStorageEntries, OpaqueTypeTable } from "./table.gen.ts";

export * from "./table.gen.ts";

unported_methods(OpaqueTypeStorage.prototype, "rustc_infer::infer::opaque_types::table::OpaqueTypeStorage", ["remove", "pop_duplicate_entry", "is_empty", "take_opaque_types", "num_entries", "opaque_types_added_since", "iter_lookup_table", "iter_duplicate_entries", "iter_opaque_types", "with_log"]);
unported_methods(OpaqueTypeStorageEntries.prototype, "rustc_infer::infer::opaque_types::table::OpaqueTypeStorageEntries", ["needs_reevaluation"]);
unported_methods(OpaqueTypeTable.prototype, "rustc_infer::infer::opaque_types::table::OpaqueTypeTable", ["deref", "register", "add_duplicate"]);
