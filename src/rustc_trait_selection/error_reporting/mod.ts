// Port of compiler/rustc_trait_selection/src/error_reporting/mod.rs (lane errctxt-contract).
//
// - `struct TypeErrCtxt` is the contract class of ../decls.ts (all fields; every method of the crate's `impl TypeErrCtxt`
//   blocks is declared there and assigned onto its prototype by the file that ports it). This module re-exports it,
//   assigns the methods of mod.rs and registers its `Deref<Target = InferCtxt>` (rust_ts/deref.ts: the field `infcx` plus
//   forwarders, which ../lib.ts installs once every module of the crate is loaded).
// - `#[extension(pub trait InferCtxtErrorExt)] impl InferCtxt { fn err_ctxt }` is `InferCtxt.prototype.err_ctxt` (declared in
//   ../decls.ts).
// - The submodules `pub mod infer; pub mod traits;` are loaded by ../lib.ts after this module (they assign onto
//   `TypeErrCtxt.prototype`).
// Init order: top-level code here may touch only rustc_infer (loaded first by ../lib.ts), ../decls.ts and other crates.
export * from "./mod.gen.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { InferCtxt } from "../../rustc_infer/decls.ts";
import type { PredicateObligations } from "../../rustc_infer/traits/mod.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import { bug } from "../../rustc_span/macros.ts";
import { register_deref } from "../../rust_ts/deref.ts";
import { TypeErrCtxt } from "../decls.ts";

// `impl<'tcx> InferCtxtErrorExt<'tcx> for InferCtxt<'tcx>`

/// Creates a `TypeErrCtxt` for emitting various inference errors.
/// During typeck, use `FnCtxt::err_ctxt` instead.
// rustc: compiler/rustc_trait_selection/src/error_reporting/mod.rs:42 err_ctxt
InferCtxt.prototype.err_ctxt = function (this: InferCtxt): TypeErrCtxt {
  return new TypeErrCtxt(
    this,
    undefined,
    undefined,
    false,
    (ty: Ty): [Ty, PredicateObligations][] => {
      // debug_assert!(false, "shouldn't be using autoderef_steps outside of typeck");
      return [[ty, []]];
    },
    (_) => undefined,
  );
};

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/mod.rs:58 dcx
TypeErrCtxt.prototype.dcx = function (this: TypeErrCtxt): DiagCtxtHandle {
  return this.infcx.dcx();
};

/// This is just to avoid a potential footgun of accidentally
/// dropping `typeck_results` by calling `InferCtxt::err_ctxt`
// rustc: compiler/rustc_trait_selection/src/error_reporting/mod.rs:66 err_ctxt
TypeErrCtxt.prototype.err_ctxt = function (this: TypeErrCtxt): never {
  return bug("called `err_ctxt` on `TypeErrCtxt`. Try removing the call");
};

// impl<'tcx> Deref for TypeErrCtxt<'_, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/mod.rs:73 deref
TypeErrCtxt.prototype.deref = function (this: TypeErrCtxt): InferCtxt {
  return this.infcx;
};
register_deref(TypeErrCtxt, "infcx", InferCtxt);

export { TypeErrCtxt };
