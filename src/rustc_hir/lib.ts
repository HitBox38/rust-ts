// Port of compiler/rustc_hir/src/lib.rs (partial: modules are added by the lanes porting them).
//! HIR datatypes. See the [rustc dev guide] for more info.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/hir.html

// mod arena; (not ported: arenas are erased, PORTING §5)
// pub mod def;
export * as def from "./def.ts";
// mod hir;
// pub mod intravisit;
export * as intravisit from "./intravisit.ts";
// pub mod lints; (not ported yet)
// pub mod pat_util;
export * as pat_util from "./pat_util.ts";
// mod stable_hash_impls;
// PORT: the `impl StableHash` fns of the private module are re-exported (trait impls are crate-global upstream).
export * from "./stable_hash_impls.ts";
// mod target_impls; (not ported yet)

// #[doc(no_inline)]
// pub use hir::*;
export * from "./hir.ts";
// pub use rustc_hir_id::*;
export * from "../rustc_hir_id/lib.ts";
// pub use rustc_span::def_id;
export * as def_id from "../rustc_span/def_id.ts";
