//! Unsafety checker: every impl either implements a trait defined in this
//! crate or pertains to a type defined in this crate.
//
// Port of compiler/rustc_hir_analysis/src/coherence/unsafety.rs (lane coherence).
//
// PORT notes (file-wide):
// - The tuple `match` is an if-chain in arm order; `unsafe_attr` is `"may_dangle" | undefined`.
// - `trait_ref.print_trait_sugared()` formatted with `{}` is `display_TraitRefPrintSugared(TraitRef_print_trait_sugared(..))`.
// Init order: top-level code here touches only other crates.
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { E0199, E0200, E0569, struct_span_code_err } from "../../rustc_errors/lib.ts";
import type { Safety } from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { ImplTraitHeader } from "../../rustc_middle/ty/mod.ts";
import { display_TraitRefPrintSugared, display_Ty, TraitRef_print_trait_sugared } from "../../rustc_middle/ty/print/pretty.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { type BytePos, type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TraitRef } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { assert } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";

// rustc: compiler/rustc_hir_analysis/src/coherence/unsafety.rs:14 check_item
export function check_item(tcx: TyCtxt, def_id: LocalDefId, trait_header: ImplTraitHeader, trait_def: TraitDef): Result<null, ErrorGuaranteed> {
  const unsafe_attr = (tcx.generics_of(def_id) as Generics).own_params.find((p) => p.pure_wrt_drop) !== undefined ? "may_dangle" : undefined;
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(trait_header.trait_ref));

  const is_copy = tcx.is_lang_item(trait_def.def_id, LangItem.Copy);
  let trait_def_safety: Safety;
  if (is_copy) {
    // If `Self` has unsafe fields, `Copy` is unsafe to implement.
    if (TraitRef.self_ty(EarlyBinder.skip_binder(trait_header.trait_ref)).has_unsafe_fields()) {
      trait_def_safety = "Unsafe";
    } else {
      trait_def_safety = "Safe";
    }
  } else {
    trait_def_safety = trait_def.safety;
  }

  const sugared = (): string => display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_ref));
  const safety = trait_header.safety;
  const polarity = trait_header.polarity;

  if (trait_def_safety === "Safe" && unsafe_attr === undefined && safety === "Unsafe" && polarity === "Positive") {
    const span = tcx.def_span(def_id);
    return {
      $: "Err",
      _0: struct_span_code_err(tcx.dcx(), tcx.def_span(def_id), E0199, `implementing the trait \`${sugared()}\` is not unsafe`)
        .with_span_suggestion_verbose(Span.with_hi(span, (Span.lo(span) + 7) as BytePos), "remove `unsafe` from this trait implementation", "", "MachineApplicable")
        .emit_err(),
    };
  } else if (trait_def_safety === "Unsafe" && safety === "Safe" && polarity === "Positive") {
    const span = tcx.def_span(def_id);
    return {
      $: "Err",
      _0: struct_span_code_err(tcx.dcx(), span, E0200, `the trait \`${sugared()}\` requires an \`unsafe impl\` declaration`)
        .with_note(
          is_copy
            ? `the trait \`${sugared()}\` cannot be safely implemented for \`${display_Ty(TraitRef.self_ty(trait_ref))}\` because it has unsafe fields. Review the invariants of those fields before adding an \`unsafe impl\``
            : `the trait \`${sugared()}\` enforces invariants that the compiler can't check. Review the trait documentation and make sure this implementation upholds those invariants before adding the \`unsafe\` keyword`,
        )
        .with_span_suggestion_verbose(Span.shrink_to_lo(span), "add `unsafe` to this trait implementation", "unsafe ", "MaybeIncorrect")
        .emit_err(),
    };
  } else if (trait_def_safety === "Safe" && unsafe_attr !== undefined && safety === "Safe" && polarity === "Positive") {
    const attr_name = unsafe_attr;
    const span = tcx.def_span(def_id);
    return {
      $: "Err",
      _0: struct_span_code_err(tcx.dcx(), span, E0569, `requires an \`unsafe impl\` declaration due to \`#[${attr_name}]\` attribute`)
        .with_note(
          `the trait \`${sugared()}\` enforces invariants that the compiler can't check. Review the trait documentation and make sure this implementation upholds those invariants before adding the \`unsafe\` keyword`,
        )
        .with_span_suggestion_verbose(Span.shrink_to_lo(span), "add `unsafe` to this trait implementation", "unsafe ", "MaybeIncorrect")
        .emit_err(),
    };
  } else if (safety === "Unsafe" && polarity === "Negative") {
    // Reported in AST validation
    assert(tcx.dcx().has_errors() !== undefined, "unsafe negative impl");
    return Ok(null);
  } else {
    // (_, _, Safety::Safe, Negative)
    // | (Safety::Unsafe, _, Safety::Unsafe, Positive)
    // | (Safety::Safe, Some(_), Safety::Unsafe, Positive)
    // | (Safety::Safe, None, Safety::Safe, _) => Ok(()),
    return Ok(null);
  }
}
