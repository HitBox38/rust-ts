//! Some helper functions for `AutoDeref`.
// Port of compiler/rustc_hir_typeck/src/autoderef.rs (lane fnctxt-contract).
//
// The four `impl FnCtxt` methods of this file, assigned onto `FnCtxt.prototype` (declared in ../decls.ts).
// Init order: top-level code here touches only ./decls.ts and other crates.
import { Autoderef, type AutoderefKind } from "../rustc_hir_analysis/autoderef.ts";
import { InferOk } from "../rustc_infer/infer/mod.ts";
import type { PredicateObligations } from "../rustc_infer/traits/mod.ts";
import type { Adjustment, DerefAdjustKind } from "../rustc_middle/ty/adjustment.ts";
import { DerefAdjustKind as DerefAdjustKindC } from "../rustc_middle/ty/adjustment.gen.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Span } from "../rustc_span/lib.ts";
import { FnSig } from "../rustc_type_ir/ty_kind.ts";
import { assert } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import type { MethodCallee } from "./method/mod.gen.ts";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/autoderef.rs:17 autoderef
FnCtxt.prototype.autoderef = function (this: FnCtxt, span: Span, base_ty: Ty): Autoderef {
  // PORT: `Autoderef::new(self, ..)` takes `&InferCtxt` (the deref coercion of `self`).
  return Autoderef.new(this.infcx, this.param_env, this.body_def_id, span, base_ty);
};

// rustc: compiler/rustc_hir_typeck/src/autoderef.rs:21 try_overloaded_deref
FnCtxt.prototype.try_overloaded_deref = function (this: FnCtxt, span: Span, base_ty: Ty): InferOk<MethodCallee> | undefined {
  return this.try_overloaded_place_op(span, base_ty, undefined, "Deref");
};

/// Returns the adjustment steps.
// rustc: compiler/rustc_hir_typeck/src/autoderef.rs:30 adjust_steps
FnCtxt.prototype.adjust_steps = function (this: FnCtxt, autoderef: Autoderef): Adjustment[] {
  return this.register_infer_ok_obligations(this.adjust_steps_as_infer_ok(autoderef));
};

// rustc: compiler/rustc_hir_typeck/src/autoderef.rs:34 adjust_steps_as_infer_ok
FnCtxt.prototype.adjust_steps_as_infer_ok = function (this: FnCtxt, autoderef: Autoderef): InferOk<Adjustment[]> {
  const steps_ = autoderef.steps();
  if (steps_.length === 0) {
    return new InferOk<Adjustment[]>([], []);
  }

  const obligations: PredicateObligations = [];
  const targets: Ty[] = [...steps_.slice(1).map(([ty, _]) => ty), autoderef.final_ty()];
  const kinds: DerefAdjustKind[] = steps_.map(([source, kind]: readonly [Ty, AutoderefKind]): DerefAdjustKind => {
    switch (kind) {
      case "Overloaded": {
        const ok = this.try_overloaded_deref(autoderef.span(), source);
        let r: DerefAdjustKind | undefined;
        if (ok !== undefined) {
          const { value: method, obligations: o } = ok;
          obligations.push(...o);
          // FIXME: we should assert the sig is &T here... there's no reason for this to be fallible.
          const k = FnSig.output(method.sig).kind();
          r = k.$ === "Ref" ? { $: "Overloaded", _0: { mutbl: k._2, span: autoderef.span() } } : undefined;
        }
        return r ?? DerefAdjustKindC.Builtin;
      }
      case "Builtin":
        return DerefAdjustKindC.Builtin;
    }
  });
  // `.zip_eq(targets)`: panics if the lengths differ.
  assert(kinds.length === targets.length, "itertools: .zip_eq() reached end of one iterator before the other");
  const steps: Adjustment[] = kinds.map((autoderef, i) => ({ kind: { $: "Deref", _0: autoderef }, target: targets[i]! }));

  return new InferOk(steps, obligations);
};
