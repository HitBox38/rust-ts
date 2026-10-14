// PORT(hir-shim): the HIR types of `compiler/rustc_hir/src/hir.rs` as rustc_ast_lowering names them (`use rustc_hir
// as hir`); its TS modules write `hir.X` with `import type * as hir from "./hir_shim.ts"`. Not a port of any
// upstream file. Since merge-w13 this re-exports rustc_hir's crate root (`pub use hir::*` there), so tsc checks every
// contract signature against the generated types.
export type * from "../rustc_hir/lib.ts";

// PORT: `rustc_hir::lints::DelayedLint` (compiler/rustc_hir/src/lints.rs) is not ported yet (the codegen typemap entry
// of `DelayedLints` is pending too); stays opaque until a lane ports lints.rs.
export type DelayedLint = unknown;
