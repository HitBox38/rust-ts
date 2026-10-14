// Port of compiler/rustc_hir/src/lib.rs (partial: modules are added by the lanes porting them).
// pub mod def;
export * as def from "./def.ts";
// mod hir;
// pub mod intravisit;
export * as intravisit from "./intravisit.ts";
// pub mod pat_util;
export * as pat_util from "./pat_util.ts";

// #[doc(no_inline)]
// pub use hir::*;
export * from "./hir.ts";
