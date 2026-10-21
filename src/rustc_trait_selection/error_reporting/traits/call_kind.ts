// Port of compiler/rustc_trait_selection/src/error_reporting/traits/call_kind.rs (lane errctxt-contract).
//
//! Common logic for borrowck use-after-move errors when moved into a `fn(self)`,
//! as well as errors when attempting to call a non-const function in a const
//! context.
//
// - `enum CallDesugaringKind` / `enum CallKind` are generated (call_kind.gen.ts); `impl CallDesugaringKind` is on the
//   companion `CallDesugaringKind` (PORTING §8).
// - `Instance::try_resolve` (rustc_middle ty/instance.rs) is not ported: the `DerefCoercion` arm stops there.
// Init order: top-level code here may touch only this file's .gen.ts and other crates; other rustc_trait_selection
// modules are read inside function bodies only.
export * from "./call_kind.gen.ts";
import { LangItem, OPERATORS } from "../../../rustc_attr_ir/lang_items.ts";
import { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import { DesugaringKind, DesugaringKind_eq } from "../../../rustc_span/hygiene.ts";
import { DUMMY_SP, Span } from "../../../rustc_span/lib.ts";
import { type Ident, sym } from "../../../rustc_span/symbol.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { panic } from "../../../std/panic.ts";
import { Instance } from "../../../rustc_middle/ty/instance.ts";
import * as specialization_graph from "../../traits/specialize/specialization_graph.ts";
import * as gen from "./call_kind.gen.ts";
import type { CallKind } from "./call_kind.gen.ts";

export type CallDesugaringKind = gen.CallDesugaringKind;
/** `impl CallDesugaringKind` (PORTING §8: enum methods on the companion). */
export const CallDesugaringKind = {
  ...gen.CallDesugaringKind,

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/call_kind.rs:35 name
  name(self: CallDesugaringKind): string {
    switch (self) {
      case "ForLoopIntoIter":
        return "`for` loop";
      case "ForLoopIntoAsyncIter":
        return "`for await` loop";
      case "ForLoopNext":
        return "`for` loop";
      case "QuestionBranch":
        return "question mark operator";
      case "QuestionFromResidual":
        return "question mark operator";
      case "TryBlockFromOutput":
        return "try block";
      case "Await":
        return "`await`";
    }
  },

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/call_kind.rs:47 trait_def_id
  trait_def_id(self: CallDesugaringKind, tcx: TyCtxt): DefId {
    switch (self) {
      case "ForLoopIntoIter":
        return unwrap(tcx.get_diagnostic_item(sym.IntoIterator));
      case "ForLoopIntoAsyncIter":
        return unwrap(tcx.get_diagnostic_item(sym.IntoAsyncIterator));
      case "ForLoopNext":
        return tcx.require_lang_item(LangItem.Iterator, DUMMY_SP);
      case "QuestionBranch":
      case "TryBlockFromOutput":
        return tcx.require_lang_item(LangItem.Try, DUMMY_SP);
      case "QuestionFromResidual":
        return unwrap(tcx.get_diagnostic_item(sym.FromResidual));
      case "Await":
        return unwrap(tcx.get_diagnostic_item(sym.IntoFuture));
    }
  },
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/call_kind.rs:84 call_kind
export function call_kind(
  tcx: TyCtxt,
  typing_env: TypingEnv,
  method_did: DefId,
  method_args: GenericArgs,
  fn_call_span: Span,
  from_hir_call: boolean,
  self_arg: Ident | undefined,
): CallKind {
  const assoc = tcx.opt_associated_item(method_did);
  let parent: DefId | undefined;
  if (assoc !== undefined) {
    const container_id = AssocItem.container_id(assoc, tcx);
    switch (assoc.container.$) {
      case "InherentImpl":
        parent = undefined;
        break;
      case "TraitImpl":
        parent = tcx.impl_trait_id(container_id);
        break;
      case "Trait":
        parent = container_id;
        break;
    }
  }

  const fn_call = parent !== undefined && tcx.fn_trait_kind_from_def_id(parent) !== undefined ? parent : undefined;

  let operator: DefId | undefined;
  if (!from_hir_call && parent !== undefined) {
    const p = parent;
    operator = undefined;
    for (const l of OPERATORS) {
      const id = tcx.lang_items().get(l);
      if (id === undefined) continue;
      if (DefId_eq(id, p)) {
        operator = id;
        break;
      }
    }
  } else {
    operator = undefined;
  }

  // Check for a 'special' use of 'self' -
  // an FnOnce call, an operator (e.g. `<<`), or a
  // deref coercion.
  if (fn_call !== undefined) {
    const trait_id = fn_call;
    return { $: "FnCall", fn_trait_id: trait_id, self_ty: method_args.type_at(0) };
  } else if (operator !== undefined) {
    const trait_id = operator;
    return { $: "Operator", self_arg, trait_id, self_ty: method_args.type_at(0) };
  } else if (!from_hir_call && tcx.is_diagnostic_item(sym.deref_method, method_did)) {
    const deref_target_def_id = expect(tcx.get_diagnostic_item(sym.deref_target), "deref method but no deref target");
    const deref_target_ty = tcx.normalize_erasing_regions(
      typing_env,
      Unnormalized.new(Ty.new_projection(tcx, "No", deref_target_def_id, method_args)),
      fold_Ty,
    );
    let deref_target_span: Span | undefined;
    const r = Instance.try_resolve(tcx, typing_env, method_did, method_args);
    let instance_parent_def_id: DefId;
    let leaf;
    if (
      r.$ === "Ok" &&
      r._0 !== undefined &&
      ((instance_parent_def_id = tcx.parent(Instance.def_id(r._0))), tcx.def_kind(instance_parent_def_id).$ === "Impl") &&
      (leaf = specialization_graph.assoc_def(tcx, instance_parent_def_id, deref_target_def_id)).$ === "Ok" &&
      leaf._0.is_final()
    ) {
      deref_target_span = tcx.def_span(leaf._0.item.def_id);
    } else {
      deref_target_span = undefined;
    }
    return { $: "DerefCoercion", deref_target_ty, deref_target_span, self_ty: method_args.type_at(0) };
  }

  // This isn't a 'special' use of `self`
  // debug!(?method_did, ?fn_call_span);
  let desugaring: [CallDesugaringKind, Ty] | undefined;
  if (tcx.is_lang_item(method_did, LangItem.IntoIterIntoIter) && desugaring_kind_is(fn_call_span, DesugaringKind.ForLoop)) {
    desugaring = ["ForLoopIntoIter", method_args.type_at(0)];
  } else if (tcx.is_lang_item(method_did, LangItem.IntoAsyncIterIntoIter) && desugaring_kind_is(fn_call_span, DesugaringKind.ForLoop)) {
    desugaring = ["ForLoopIntoAsyncIter", method_args.type_at(0)];
  } else if (tcx.is_lang_item(method_did, LangItem.IteratorNext) && desugaring_kind_is(fn_call_span, DesugaringKind.ForLoop)) {
    desugaring = ["ForLoopNext", method_args.type_at(0)];
  } else if (desugaring_kind_is(fn_call_span, DesugaringKind.QuestionMark)) {
    if (tcx.is_lang_item(method_did, LangItem.TryTraitBranch)) {
      desugaring = ["QuestionBranch", method_args.type_at(0)];
    } else if (tcx.is_lang_item(method_did, LangItem.TryTraitFromResidual)) {
      desugaring = ["QuestionFromResidual", method_args.type_at(0)];
    } else {
      desugaring = undefined;
    }
  } else if (tcx.is_lang_item(method_did, LangItem.TryTraitFromOutput) && desugaring_kind_is(fn_call_span, DesugaringKind.TryBlock)) {
    desugaring = ["TryBlockFromOutput", method_args.type_at(0)];
  } else if (Span.is_desugaring(fn_call_span, DesugaringKind.Await)) {
    desugaring = ["Await", method_args.type_at(0)];
  } else {
    desugaring = undefined;
  }
  return { $: "Normal", self_arg, desugaring, method_did, method_args };
}

/** `Option::unwrap`. */
function unwrap<T>(v: T | undefined): T {
  return expect(v, "called `Option::unwrap()` on a `None` value");
}

/** `Option::expect`. */
function expect<T>(v: T | undefined, msg: string): T {
  return v !== undefined ? v : panic(msg);
}

/** `fn_call_span.desugaring_kind() == Some(kind)` (derived `PartialEq`). */
function desugaring_kind_is(sp: Span, kind: DesugaringKind): boolean {
  const k = Span.desugaring_kind(sp);
  return k !== undefined && DesugaringKind_eq(k, kind);
}
