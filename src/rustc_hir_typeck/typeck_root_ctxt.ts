// Port of compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs (lane fnctxt-contract).
//
// `TypeckRootCtxt` itself (the struct, typeck_root_ctxt.rs:26) is declared in ../decls.ts (the contract): the class with
// all fields, its methods' declarations and the `Deref<Target = InferCtxt>` forwarders (`register_deref` below).
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
import { HirIdMap } from "../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../rustc_infer/decls.ts";
import type { InferOk } from "../rustc_infer/infer/mod.ts";
import type { PredicateObligation } from "../rustc_infer/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { FulfillmentEngine, FulfillmentErrorKinds_FulfillmentError } from "../rustc_trait_selection/traits/engine.ts";
import { visit_with_PredicateObligation } from "../rustc_trait_selection/traits/mod.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { InferCtxt as InferCtxtC } from "../rustc_infer/decls.ts";
import { debug_Obligation } from "../rustc_infer/traits/structural_impls.ts";
import { debug_Predicate } from "../rustc_middle/ty/predicate.ts";
import { PLAIN } from "../std/fmt.ts";
import { register_deref, TypeckRootCtxt } from "./decls.ts";

export * from "./typeck_root_ctxt.gen.ts";
export { TypeckRootCtxt } from "./decls.ts";

// rustc: compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs:77 deref
TypeckRootCtxt.prototype.deref = function (this: TypeckRootCtxt): InferCtxt {
  return this.infcx;
};
// typeck_root_ctxt.rs:75 `impl Deref for TypeckRootCtxt { type Target = InferCtxt }` (`&self.infcx`): the forwarders are
// installed by lib.ts (decls.ts `register_deref`).
register_deref(TypeckRootCtxt, "infcx", InferCtxtC);

// rustc: compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs:83 new
TypeckRootCtxt.new = function (tcx: TyCtxt, def_id: LocalDefId): TypeckRootCtxt {
  const mod_id = tcx.parent_module_from_def_id(def_id);
  const hir_owner = tcx.local_def_id_to_hir_id(def_id).owner;

  const infcx = tcx.infer_ctxt().ignoring_regions().in_hir_typeck().build(TypingMode.typeck_for_body(tcx, def_id));
  const typeck_results = TypeckResults.new(hir_owner);
  const fulfillment_cx = FulfillmentEngine.new(infcx, FulfillmentErrorKinds_FulfillmentError);

  return new TypeckRootCtxt(
    infcx,
    typeck_results,
    /* locals */ new HirIdMap(),
    fulfillment_cx,
    /* checked_opaque_types_storage_entries */ undefined,
    /* deferred_sized_obligations */ [],
    /* deferred_call_resolutions */ new Map(),
    /* deferred_cast_checks */ [],
    /* deferred_transmute_checks */ [],
    /* deferred_offload_checks */ [],
    /* deferred_asm_checks */ [],
    /* deferred_repeat_expr_checks */ [],
    /* diverging_type_vars */ [],
    mod_id,
  );
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs:114 register_predicate
TypeckRootCtxt.prototype.register_predicate = function (this: TypeckRootCtxt, obligation: PredicateObligation): void {
  if (TypeVisitableExt.has_escaping_bound_vars(obligation, { visit_with: visit_with_PredicateObligation })) {
    span_bug(obligation.cause.span, `escaping bound vars in predicate ${debug_Obligation(obligation, PLAIN, debug_Predicate)}`);
  }

  // PORT: `register_predicate_obligation(self, ..)` takes `&InferCtxt` (the deref coercion of `self`).
  this.fulfillment_cx.register_predicate_obligation(this.infcx, obligation);
};

// rustc: compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs:122 register_predicates
TypeckRootCtxt.prototype.register_predicates = function (this: TypeckRootCtxt, obligations: Iterable<PredicateObligation>): void {
  for (const obligation of obligations) {
    this.register_predicate(obligation);
  }
};

// rustc: compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs:131 register_infer_ok_obligations
TypeckRootCtxt.prototype.register_infer_ok_obligations = function <T>(this: TypeckRootCtxt, infer_ok: InferOk<T>): T {
  this.register_predicates(infer_ok.obligations);
  return infer_ok.value;
};
