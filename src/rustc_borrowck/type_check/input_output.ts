// Port of compiler/rustc_borrowck/src/type_check/input_output.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
//! This module contains code to equate the input/output types appearing
//! in the MIR with the expected input/output types from the function
//! signature. This requires a bit of processing, as the expected types
//! are supplied to us before normalization and may contain opaque
//! `impl Trait` instances. In contrast, the input/output types found in
//! the MIR (specifically, in the special local variables for the
//! `RETURN_PLACE` the MIR arguments) are always fully normalized (and
//! contain revealed `impl Trait` values).
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";
import { TypeChecker } from "./mod.ts";

declare module "./mod.ts" {
  interface TypeChecker {
    // input_output.rs:28 (lane bck-tc-b)
    check_signature_annotation(): void;
    // input_output.rs:163 (lane bck-tc-b)
    equate_inputs_and_outputs(normalized_inputs_and_output: readonly Ty[]): void;
    // input_output.rs:216 (lane bck-tc-b)
    equate_normalized_input_or_output(a: Ty, b: Ty, span: Span): void;
  }
}

// ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> ----

/// Check explicit closure signature annotation,
/// e.g., `|x: FxIndexMap<_, &'static u32>| ...`.
// stub: compiler/rustc_borrowck/src/type_check/input_output.rs:28 check_signature_annotation (lane bck-tc-b)
TypeChecker.prototype.check_signature_annotation = function (this: TypeChecker): void {
  return unported("rustc_borrowck::type_check::input_output::TypeChecker::check_signature_annotation");
};

/// Enforce that the types of the locals corresponding to the inputs and output of
/// the body are equal to those of the (normalized) signature.
///
/// This is necessary for two reasons:
/// - Locals in the MIR all start out with `'erased` regions and then are replaced
///    with unconstrained nll vars. If we have a function returning `&'a u32` then
///    the local `_0: &'?10 u32` needs to have its region var equated with the nll
///    var representing `'a`. i.e. borrow check must uphold that `'?10 = 'a`.
/// - When computing the normalized signature we may introduce new unconstrained nll
///    vars due to higher ranked where clauses ([#136547]). We then wind up with implied
///    bounds involving these vars.
///
///    For this reason it is important that we equate with the *normalized* signature
///    which was produced when computing implied bounds. If we do not do so then we will
///    wind up with implied bounds on nll vars which cannot actually be used as the nll
///    var never gets related to anything.
///
/// For 'closure-like' bodies this function effectively relates the *inferred* signature
/// of the closure against the locals corresponding to the closure's inputs/output. It *does
/// not* relate the user provided types for the signature to the locals, this is handled
/// separately by: [`TypeChecker::check_signature_annotation`].
///
/// [#136547]: <https://www.github.com/rust-lang/rust/issues/136547>
// stub: compiler/rustc_borrowck/src/type_check/input_output.rs:163 equate_inputs_and_outputs (lane bck-tc-b)
TypeChecker.prototype.equate_inputs_and_outputs = function (this: TypeChecker, normalized_inputs_and_output: readonly Ty[]): void {
  return unported("rustc_borrowck::type_check::input_output::TypeChecker::equate_inputs_and_outputs");
};

// stub: compiler/rustc_borrowck/src/type_check/input_output.rs:216 equate_normalized_input_or_output (lane bck-tc-b)
TypeChecker.prototype.equate_normalized_input_or_output = function (this: TypeChecker, a: Ty, b: Ty, span: Span): void {
  return unported("rustc_borrowck::type_check::input_output::TypeChecker::equate_normalized_input_or_output");
};
