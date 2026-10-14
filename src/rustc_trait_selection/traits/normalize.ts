// Port of compiler/rustc_trait_selection/src/traits/normalize.rs (lane trait-sel-traits-a).
//
// Contract stub (lane infcx-contract): only the `#[extension]` trait methods this file adds to rustc_infer's types are
// declared so far (rustc_trait_selection/decls.ts); they are `unported` placeholders below. The lane that ports this file
// assigns each method onto the prototype (marker above it) and deletes its name from the list; the rest of the file is
// ported as usual. Init order: top-level code here may touch only rustc_infer (loaded first by ../lib.ts) and other crates.

import { unported_methods } from "../../rust_ts/stubs.ts";
import { At } from "../../rustc_infer/decls.ts";

unported_methods(At.prototype, "rustc_trait_selection::traits::normalize::At", ["normalize", "deeply_normalize"]);
