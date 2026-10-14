// Port of compiler/rustc_trait_selection/src/infer.rs (lane trait-sel-traits-a).
//
// Contract stub (lane infcx-contract): only the `#[extension]` trait methods this file adds to rustc_infer's types are
// declared so far (rustc_trait_selection/decls.ts); they are `unported` placeholders below. The lane that ports this file
// assigns each method onto the prototype (marker above it) and deletes its name from the list; the rest of the file is
// ported as usual. Init order: top-level code here may touch only rustc_infer (loaded first by ../lib.ts) and other crates.

import { unported_methods } from "../rust_ts/stubs.ts";
import { InferCtxt, InferCtxtBuilder } from "../rustc_infer/decls.ts";

// `pub use rustc_infer::infer::*;`
export * from "../rustc_infer/infer/mod.ts";

unported_methods(InferCtxt.prototype, "rustc_trait_selection::infer::InferCtxt", ["can_eq", "type_is_copy_modulo_regions", "type_is_clone_modulo_regions", "type_is_use_cloned_modulo_regions", "type_is_sized_modulo_regions", "type_implements_trait", "type_implements_trait_shallow"]);
unported_methods(InferCtxtBuilder.prototype, "rustc_trait_selection::infer::InferCtxtBuilder", ["enter_canonical_trait_query"]);
