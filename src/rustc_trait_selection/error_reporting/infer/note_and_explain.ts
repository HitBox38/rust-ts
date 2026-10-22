// Port of compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs (lane errrep-infer-b; contract of
// lane errctxt-contract).
//
// The methods of the `impl TypeErrCtxt` block are assigned onto `TypeErrCtxt.prototype` below, in upstream order
// (declarations: ../../decls.ts `// error_reporting/infer/note_and_explain.rs:<line>`). `self.tcx` / InferCtxt methods are
// read through the Deref forwarders; `self.infcx.can_eq(..)` is `this.infcx.can_eq(..)`.
// - `msg: impl Fn() -> String` is `() => string`; `&msg` passes the same closure.
// - The big `match (*values.expected.kind(), *values.found.kind())` of `note_and_explain_type_err` is a labeled block
//   (`arms`) of if-statements in upstream arm order; a guard that fails falls through to the next arm, every arm body
//   ends with `break arms`.
// - `debug!` is tracing only and stays as a comment.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt) and other crates.
import { VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import { Applicability, type Diag, pluralize } from "../../../rustc_errors/lib.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import type { Namespace } from "../../../rustc_hir/def.ts";
import { Safety_discriminant } from "../../../rustc_hir/hir.gen.ts";
import type { CodegenFnAttrs } from "../../../rustc_middle/middle/codegen_fn_attrs.ts";
import type { ObligationCause, ObligationCauseCode } from "../../../rustc_middle/traits/mod.ts";
import { AssocItem, AssocItems } from "../../../rustc_middle/ty/assoc.ts";
import type { Clause, GenericArg, ParamEnv, Ty } from "../../../rustc_middle/ty/decls.ts";
import { suggest_constraining_type_param } from "../../../rustc_middle/ty/diagnostics.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { HasAttrs_DefId } from "../../../rustc_middle/ty/mod.ts";
import type { ParamTy } from "../../../rustc_middle/ty/sty.ts";
import { PRINT_OK, type PrintError } from "../../../rustc_middle/ty/print/mod.ts";
import { display_ParamTy, display_Ty, FmtPrinter } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import { type BytePos, Span } from "../../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, type Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import type { ClauseKind, PolyFnSig } from "../../../rustc_type_ir/decls.ts";
import type { ExpectedFound, TypeError } from "../../../rustc_type_ir/error.ts";
import { DeepRejectCtxt } from "../../../rustc_type_ir/fast_reject.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { as_interner, TraitClause, type TraitRef } from "../../../rustc_type_ir/predicate.ts";
import type { AliasTy as AliasTyT } from "../../../rustc_type_ir/ty/alias.ts";
import { AliasTy, FnHeader, PolyFnSig as PolyFnSigC } from "../../../rustc_type_ir/ty_kind.ts";
import { debug_AliasTyKind } from "../../../rustc_type_ir/ty_kind.gen.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { PLAIN, type Debug } from "../../../std/fmt.ts";
import { to_digit } from "../../../std/char.ts";
import { panic } from "../../../std/panic.ts";
import { expect_result } from "../../../std/result.ts";
import { TypeErrCtxt } from "../../decls.ts";

const MachineApplicable = Applicability.MachineApplicable;
const MaybeIncorrect = Applicability.MaybeIncorrect;

/** `derive(Debug)` of `std::fmt::Error` (a unit struct): `Error`. */
const debug_PrintError: Debug<PrintError> = () => "Error";

/** `Option<DefId> == Option<DefId>` */
function DefId_opt_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  return a === undefined || b === undefined ? a === b : DefId_eq(a, b);
}

// PORT: `#[derive(PartialEq)]` of `hir::TraitBoundModifiers` (and of its two field enums, whose payloads are `Span`s
// compared by value); local because no `_eq` is generated for it (same helper as suggest.ts / rustc_resolve
// late/diagnostics.ts).
function TraitBoundModifiers_eq(a: hir.TraitBoundModifiers, b: hir.TraitBoundModifiers): boolean {
  const eq = (x: { $: string; _0?: Span }, y: { $: string; _0?: Span }): boolean => x.$ === y.$ && x._0 === y._0;
  return eq(a.constness, b.constness) && eq(a.polarity, b.polarity);
}

// impl<'tcx> TypeErrCtxt<'_, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:20 note_and_explain_type_err
TypeErrCtxt.prototype.note_and_explain_type_err = function (
  this: TypeErrCtxt,
  diag: Diag,
  err: TypeError,
  cause: ObligationCause,
  sp: Span,
  body_owner_def_id: DefId | undefined,
): void {
  // debug!("note_and_explain_type_err err={:?} cause={:?}", err, cause);

  const tcx = this.tcx;

  const body_generics = body_owner_def_id === undefined ? undefined : (tcx.generics_of(body_owner_def_id) as Generics);

  switch (err.$) {
    case "ArgumentSorts":
    case "Sorts": {
      const values = err._0;
      const ek = values.expected.kind();
      const fk = values.found.kind();
      arms: {
        if (ek.$ === "Closure" && fk.$ === "Closure") {
          diag.note("no two closures, even if identical, have the same type");
          diag.help("consider boxing your closure and/or using it as a trait object");
          break arms;
        }
        if (ek.$ === "Coroutine" && fk.$ === "Coroutine" && this.tcx.coroutine_is_async(ek._0) && this.tcx.coroutine_is_async(fk._0)) {
          diag.note("no two async blocks, even if identical, have the same type");
          diag.help("consider pinning your async block and casting it to a trait object");
          break arms;
        }
        if (ek.$ === "Alias" && ek._1.kind.$ === "Opaque" && fk.$ === "Alias" && fk._1.kind.$ === "Opaque") {
          // Issue #63167
          diag.note("distinct uses of `impl Trait` result in different opaque types");
          break arms;
        }
        if (ek.$ === "Float" && fk.$ === "Infer" && fk._0.$ === "IntVar") {
          // Issue #53280
          const snippet_r = tcx.sess.source_map().span_to_snippet(sp);
          if (snippet_r.$ === "Ok") {
            const snippet = snippet_r._0.toString();
            let all = true;
            for (const s of snippet) {
              const c = s.codePointAt(0)!;
              if (!(to_digit(c, 10) !== undefined || s === "-" || s === "_")) {
                all = false;
                break;
              }
            }
            if (all) {
              diag.span_suggestion_verbose(Span.shrink_to_hi(sp), "use a float literal", ".0", MachineApplicable);
            }
            break arms;
          }
        }
        if (ek.$ === "Param" && fk.$ === "Param") {
          const expected = ek._0;
          const found = fk._0;
          if (body_generics !== undefined) {
            const generics = body_generics;
            const e_span = tcx.def_span(generics.type_param(expected, tcx).def_id);
            if (!Span.contains(sp, e_span)) {
              diag.span_label(e_span, "expected type parameter");
            }
            const f_span = tcx.def_span(generics.type_param(found, tcx).def_id);
            if (!Span.contains(sp, f_span)) {
              diag.span_label(f_span, "found type parameter");
            }
          }
          diag.note("a type parameter was expected, but a different one was found; you might be missing a type parameter or trait bound");
          diag.note("for more information, visit https://doc.rust-lang.org/book/ch10-02-traits.html#traits-as-parameters");
          break arms;
        }
        if (
          ek.$ === "Alias" &&
          (ek._1.kind.$ === "Projection" || ek._1.kind.$ === "Inherent") &&
          fk.$ === "Alias" &&
          (fk._1.kind.$ === "Projection" || fk._1.kind.$ === "Inherent")
        ) {
          diag.note("an associated type was expected, but a different one was found");
          break arms;
        }
        // FIXME(inherent_associated_types): Extend this to support `ty::Inherent`, too.
        {
          let p_proj: [ParamTy, AliasTyT, DefId] | undefined;
          if (ek.$ === "Param" && fk.$ === "Alias" && fk._1.kind.$ === "Projection") {
            p_proj = [ek._0, fk._1, fk._1.kind.def_id];
          } else if (ek.$ === "Alias" && ek._1.kind.$ === "Projection" && fk.$ === "Param") {
            p_proj = [fk._0, ek._1, ek._1.kind.def_id];
          }
          if (p_proj !== undefined && !tcx.is_impl_trait_in_trait(p_proj[2]) && body_generics !== undefined) {
            const [p, proj, def_id] = p_proj;
            const generics = body_generics;
            const param = generics.type_param(p, tcx);
            const p_def_id = param.def_id;
            const p_span = tcx.def_span(p_def_id);
            const expected = ek.$ === "Param" ? "expected " : fk.$ === "Param" ? "found " : "";
            if (!Span.contains(sp, p_span)) {
              diag.span_label(p_span, `${expected}this type parameter`);
            }
            const self_k = AliasTy.self_ty(proj).kind();
            const param_def_id = self_k.$ === "Param" ? generics.type_param(self_k._0, tcx).def_id : p_def_id;
            const parent = ((): [LocalDefId, hir.Generics] | undefined => {
              const id = param_def_id.as_local();
              if (id === undefined) return undefined;
              const local_id = tcx.local_def_id_to_hir_id(id);
              const generics = hir.Node.generics(tcx.parent_hir_node(local_id));
              if (generics === undefined) return undefined;
              return [id, generics];
            })();
            let note = true;
            if (parent !== undefined) {
              const [local_id, generics] = parent;
              // Synthesize the associated type restriction `Add<Output = Expected>`.
              // FIXME: extract this logic for use in other diagnostics.
              const [trait_ref, assoc_args] = AliasTy.trait_ref_and_own_args(proj, as_interner(tcx));
              const item_name = tcx.item_name(def_id);
              const item_args = this.format_generic_args(assoc_args);

              if (
                // if we're referencing an async fn trait's output future
                //
                // AsyncFnOnce
                (tcx.is_lang_item(trait_ref.def_id, "AsyncFnOnce") && tcx.is_lang_item(def_id, "CallOnceFuture")) ||
                // AsyncFnMut
                (tcx.is_lang_item(trait_ref.def_id, "AsyncFnMut") && tcx.is_lang_item(def_id, "CallRefFuture")) ||
                // AsyncFn
                (tcx.is_lang_item(trait_ref.def_id, "AsyncFn") && tcx.is_lang_item(def_id, "CallRefFuture"))
              ) {
                // don't make a suggestion to constrain it, it's not possible in
                // current rust. In fact, when something is referring to this, you
                // may have just needed to await something.

                diag.help("you may have forgotten to await an async function");
                diag.note(
                  `it is currently not possible to add bounds constraining the future returned from an async function (\`${display_Symbol(item_name)}\`)`,
                );
                // don't note, since it's talking about missing bounds. There's
                // currently no way to bound the return future
                note = false;
              } else {
                // Here, we try to see if there's an existing
                // trait implementation that matches the one that
                // we're suggesting to restrict. If so, find the
                // "end", whether it be at the end of the trait
                // or the end of the generic arguments.
                let matching_span: Span | undefined = undefined;
                let matched_end_of_args = false;
                for (const bound of generics.bounds_for_param(local_id)) {
                  // `bound.bounds.iter().find_map(|bound| { .. })`
                  let potential_spans: [Span, hir.GenericArgs | undefined] | undefined = undefined;
                  for (const bound_ of bound.bounds) {
                    const r = ((): [Span, hir.GenericArgs | undefined] | undefined => {
                      const trait_ref_ = hir.GenericBound.trait_ref(bound_);
                      if (trait_ref_ === undefined) return undefined;
                      const bound_trait_path = trait_ref_.path;
                      const def_id_ = hir.def.Res.opt_def_id(bound_trait_path.res);
                      if (def_id_ === undefined) return undefined;
                      const last = bound_trait_path.segments.at(-1);
                      const generic_args = last === undefined ? undefined : last.args_();
                      return DefId_eq(def_id_, trait_ref.def_id) ? [bound_trait_path.span, generic_args] : undefined;
                    })();
                    if (r !== undefined) {
                      potential_spans = r;
                      break;
                    }
                  }

                  if (potential_spans !== undefined) {
                    const [end_of_trait, end_of_args] = potential_spans;
                    const args_span = end_of_args === undefined ? undefined : end_of_args.span();
                    matched_end_of_args = args_span !== undefined;
                    matching_span = Span.shrink_to_hi(args_span ?? end_of_trait);
                    break;
                  }
                }

                if (matched_end_of_args) {
                  // Append suggestion to the end of our args
                  const path = `, ${display_Symbol(item_name)}${item_args} = ${display_ParamTy(p)}`;
                  note = !suggest_constraining_type_param(tcx, generics, diag, display_Ty(AliasTy.self_ty(proj)), path, undefined, matching_span);
                } else {
                  // Suggest adding a bound to an existing trait
                  // or if the trait doesn't exist, add the trait
                  // and the suggested bounds.
                  const path = `<${display_Symbol(item_name)}${item_args} = ${display_ParamTy(p)}>`;
                  note = !suggest_constraining_type_param(tcx, generics, diag, display_Ty(AliasTy.self_ty(proj)), path, undefined, matching_span);
                }
              }
            }
            if (note) {
              diag.note("you might be missing a type parameter or trait bound");
            }
            break arms;
          }
        }
        {
          const is_dyn_or_opaque = (k: typeof ek): boolean => k.$ === "Dynamic" || (k.$ === "Alias" && k._1.kind.$ === "Opaque");
          let p: ParamTy | undefined;
          if (ek.$ === "Param" && is_dyn_or_opaque(fk)) {
            p = ek._0;
          } else if (is_dyn_or_opaque(ek) && fk.$ === "Param") {
            p = fk._0;
          }
          if (p !== undefined) {
            if (body_generics !== undefined) {
              const generics = body_generics;
              const p_span = tcx.def_span(generics.type_param(p, tcx).def_id);
              const expected = ek.$ === "Param" ? "expected " : fk.$ === "Param" ? "found " : "";
              if (!Span.contains(sp, p_span)) {
                diag.span_label(p_span, `${expected}this type parameter`);
              }
            }
            diag.help("type parameters must be constrained to match other types");
            const code = diag.deref().code;
            if (code !== undefined && tcx.sess.teach(code)) {
              diag.help(
                "given a type parameter `T` and a method `foo`:\n" +
                  "```\n" +
                  "trait Trait<T> { fn foo(&self) -> T; }\n" +
                  "```\n" +
                  "the only ways to implement method `foo` are:\n" +
                  "- constrain `T` with an explicit type:\n" +
                  "```\n" +
                  "impl Trait<String> for X {\n" +
                  "    fn foo(&self) -> String { String::new() }\n" +
                  "}\n" +
                  "```\n" +
                  "- add a trait bound to `T` and call a method on that trait that returns `Self`:\n" +
                  "```\n" +
                  "impl<T: std::default::Default> Trait<T> for X {\n" +
                  "    fn foo(&self) -> T { <T as std::default::Default>::default() }\n" +
                  "}\n" +
                  "```\n" +
                  "- change `foo` to return an argument of type `T`:\n" +
                  "```\n" +
                  "impl<T> Trait<T> for X {\n" +
                  "    fn foo(&self, x: T) -> T { x }\n" +
                  "}\n" +
                  "```",
              );
            }
            diag.note("for more information, visit https://doc.rust-lang.org/book/ch10-02-traits.html#traits-as-parameters");
            break arms;
          }
        }
        if (ek.$ === "Param" && (fk.$ === "Closure" || fk.$ === "CoroutineClosure" || fk.$ === "Coroutine")) {
          const p = ek._0;
          if (body_generics !== undefined) {
            const generics = body_generics;
            const p_span = tcx.def_span(generics.type_param(p, tcx).def_id);
            if (!Span.contains(sp, p_span)) {
              diag.span_label(p_span, "expected this type parameter");
            }
          }
          diag.help(
            `every closure has a distinct type and so could not always match the caller-chosen type of parameter \`${display_ParamTy(p)}\``,
          );
          break arms;
        }
        if ((ek.$ === "Param" || fk.$ === "Param") && body_generics !== undefined) {
          const p = ek.$ === "Param" ? ek._0 : (fk as { _0: ParamTy })._0;
          const generics = body_generics;
          const p_span = tcx.def_span(generics.type_param(p, tcx).def_id);
          const expected = ek.$ === "Param" ? "expected " : fk.$ === "Param" ? "found " : "";
          if (!Span.contains(sp, p_span)) {
            diag.span_label(p_span, `${expected}this type parameter`);
          }
          break arms;
        }
        if (ek.$ === "Alias" && (ek._1.kind.$ === "Projection" || ek._1.kind.$ === "Inherent") && !tcx.is_impl_trait_in_trait(ek._1.kind.def_id)) {
          const proj_ty = ek._1;
          this.expected_projection(diag, proj_ty, values, body_owner_def_id, cause.code_());
          break arms;
        }
        // Don't suggest constraining a projection to something
        // containing itself, e.g. `Item = &<I as Iterator>::Item`.
        if (
          fk.$ === "Alias" &&
          (fk._1.kind.$ === "Projection" || fk._1.kind.$ === "Inherent") &&
          !tcx.is_impl_trait_in_trait(fk._1.kind.def_id) &&
          !tcx.erase_and_anonymize_regions(values.expected, fold_Ty).contains(tcx.erase_and_anonymize_regions(values.found, fold_Ty))
        ) {
          const proj_ty = fk._1;
          const msg = (): string => `consider constraining the associated type \`${display_Ty(values.found)}\` to \`${display_Ty(values.expected)}\``;
          const suggested_projection_constraint =
            proj_ty.kind.$ === "Projection" &&
            (this.suggest_constraining_opaque_associated_type(diag, msg, proj_ty, values.expected) ||
              this.suggest_constraint(diag, msg, body_owner_def_id, proj_ty, values.expected));
          if (!suggested_projection_constraint) {
            diag.help(msg());
            diag.note("for more information, visit https://doc.rust-lang.org/book/ch19-03-advanced-traits.html");
          }
          break arms;
        }
        if (ek.$ === "Dynamic" && fk.$ === "Alias" && fk._1.kind.$ === "Opaque") {
          const t = ek._0;
          const opaque_def_id = fk._1.kind.def_id;
          const def_id = t.principal_def_id();
          if (
            def_id !== undefined &&
            EarlyBinder.skip_binder(tcx.explicit_item_self_bounds(opaque_def_id) as EarlyBinder<readonly [Clause, Span][]>).some(([pred, _span]) => {
              const k: ClauseKind = Binder.skip_binder(pred.kind());
              if (k.$ === "Trait" && k._0.polarity === "Positive") {
                return DefId_eq(TraitClause.def_id(k._0), def_id);
              }
              return false;
            })
          ) {
            diag.help(
              `you can box the \`${display_Ty(values.found)}\` to coerce it to \`Box<${display_Ty(values.expected)}>\`, but you'll have to change the expected type as well`,
            );
            break arms;
          }
        }
        if (ek.$ === "Dynamic") {
          const def_id = ek._0.principal_def_id();
          if (def_id !== undefined) {
            let has_matching_impl = false;
            tcx.for_each_relevant_impl(
              def_id,
              values.found,
              (did) => {
                if (
                  DeepRejectCtxt.relate_rigid_infer(as_interner(tcx)).types_may_unify(values.found, EarlyBinder.skip_binder(tcx.type_of(did) as EarlyBinder<Ty>))
                ) {
                  has_matching_impl = true;
                }
              },
              VisitorResult.unit,
            );
            if (has_matching_impl) {
              const trait_name = display_Symbol(tcx.item_name(def_id));
              diag.help(
                `\`${display_Ty(values.found)}\` implements \`${trait_name}\` so you could box the found value and coerce it to the trait object \`Box<dyn ${trait_name}>\`, you will have to change the expected type as well`,
              );
            }
            break arms;
          }
        }
        if (fk.$ === "Dynamic") {
          const def_id = fk._0.principal_def_id();
          if (def_id !== undefined) {
            let has_matching_impl = false;
            tcx.for_each_relevant_impl(
              def_id,
              values.expected,
              (did) => {
                if (
                  DeepRejectCtxt.relate_rigid_infer(as_interner(tcx)).types_may_unify(values.expected, EarlyBinder.skip_binder(tcx.type_of(did) as EarlyBinder<Ty>))
                ) {
                  has_matching_impl = true;
                }
              },
              VisitorResult.unit,
            );
            if (has_matching_impl) {
              const trait_name = display_Symbol(tcx.item_name(def_id));
              diag.help(
                `\`${display_Ty(values.expected)}\` implements \`${trait_name}\` so you could change the expected type to \`Box<dyn ${trait_name}>\``,
              );
            }
            break arms;
          }
        }
        if ((fk.$ === "Alias" && fk._1.kind.$ === "Opaque") || (ek.$ === "Alias" && ek._1.kind.$ === "Opaque")) {
          const def_id = fk.$ === "Alias" && fk._1.kind.$ === "Opaque" ? fk._1.kind.def_id : (ek as { _1: { kind: { def_id: DefId } } })._1.kind.def_id;
          const is_body_kind = (k: hir.def.DefKind): boolean =>
            k.$ === "Fn" || k.$ === "Static" || k.$ === "Const" || k.$ === "AssocFn" || k.$ === "AssocConst";
          if (body_owner_def_id !== undefined) {
            if (
              def_id.is_local() &&
              is_body_kind(tcx.def_kind(body_owner_def_id)) &&
              (tcx.opaque_ty_origin(def_id) as hir.OpaqueTyOrigin<DefId>).$ === "TyAlias" &&
              !(tcx.opaque_types_defined_by(body_owner_def_id.expect_local()) as readonly LocalDefId[]).includes(def_id.expect_local())
            ) {
              const sp = tcx.def_ident_span(body_owner_def_id) ?? tcx.def_span(body_owner_def_id);
              let alias_def_id = def_id;
              while (tcx.def_kind(alias_def_id).$ === "OpaqueTy") {
                alias_def_id = tcx.parent(alias_def_id);
              }
              const opaque_path = tcx.def_path_str(alias_def_id);
              // FIXME(type_alias_impl_trait): make this a structured suggestion
              const origin = tcx.opaque_ty_origin(def_id) as hir.OpaqueTyOrigin<DefId>;
              switch (origin.$) {
                case "FnReturn":
                  break;
                case "AsyncFn":
                  break;
                case "TyAlias":
                  if (!origin.in_assoc_ty) {
                    diag.span_note(sp, `this item must have a \`#[define_opaque(${opaque_path})]\` attribute to be able to define hidden types`);
                  }
                  break;
              }
            }
          }
          // If two if arms can be coerced to a trait object, provide a structured
          // suggestion.
          const code = cause.code_();
          if (code.$ !== "IfExpression") {
            return;
          }
          const node = this.tcx.hir_node(code.expr_id);
          if (node.$ !== "Expr") return;
          const if_kind = node._0.kind;
          if (if_kind.$ !== "If") return;
          const then_kind = if_kind._1.kind;
          if (then_kind.$ !== "Block" || then_kind._0.expr === undefined) return;
          const then = then_kind._0.expr;
          if (if_kind._2 === undefined) return;
          const else_kind = if_kind._2.kind;
          if (else_kind.$ !== "Block" || else_kind._0.expr === undefined) return;
          const else_ = else_kind._0.expr;
          const expected = values.found.kind().$ === "Alias" ? values.expected : values.found;
          const preds = tcx.explicit_item_self_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>;
          for (const [pred, _span] of EarlyBinder.skip_binder(preds)) {
            const k: ClauseKind = Binder.skip_binder(pred.kind());
            if (k.$ !== "Trait") {
              continue;
            }
            const trait_predicate = k._0;
            if (trait_predicate.polarity !== "Positive") {
              continue;
            }
            const def_id = TraitClause.def_id(trait_predicate);
            const impl_def_ids: DefId[] = [];
            tcx.for_each_relevant_impl(def_id, expected, (did) => void impl_def_ids.push(did), VisitorResult.unit);
            if (impl_def_ids.length === 1) {
              const trait_name = display_Symbol(tcx.item_name(def_id));
              diag.multipart_suggestion(
                `\`${display_Ty(expected)}\` implements \`${trait_name}\` so you can box both arms and coerce to the trait object \`Box<dyn ${trait_name}>\``,
                [
                  [Span.shrink_to_lo(then.span), "Box::new("],
                  [Span.shrink_to_hi(then.span), `) as Box<dyn ${tcx.def_path_str(def_id)}>`],
                  [Span.shrink_to_lo(else_.span), "Box::new("],
                  [Span.shrink_to_hi(else_.span), ")"],
                ],
                MachineApplicable,
              );
            }
          }
          break arms;
        }
        {
          let fn_hdr: [DefId, FnHeader] | undefined;
          if (ek.$ === "FnPtr" && fk.$ === "FnDef") {
            fn_hdr = [fk._0, ek._1];
          } else if (ek.$ === "FnDef" && fk.$ === "FnPtr") {
            fn_hdr = [ek._0, fk._1];
          }
          if (fn_hdr !== undefined) {
            const [def_id, hdr] = fn_hdr;
            if (
              Safety_discriminant[PolyFnSigC.safety(EarlyBinder.skip_binder(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>))] <
              Safety_discriminant[FnHeader.safety(hdr)]
            ) {
              if (!(tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).safe_target_features) {
                diag.note("unsafe functions cannot be coerced into safe function pointers");
              }
            }
            break arms;
          }
        }
        if (ek.$ === "Adt" && fk.$ === "Adt") {
          const def = fk._0;
          const args = fk._1;
          const r = ((): [hir.Expr, DefId] | undefined => {
            const code = cause.code_();
            if (code.$ !== "IfExpression") return undefined;
            const node = this.tcx.hir_node(code.expr_id);
            if (node.$ !== "Expr") return undefined;
            const if_expr = node._0;
            if (if_expr.kind.$ !== "If") return undefined;
            const then_expr = if_expr.kind._1;
            if (then_expr.kind.$ !== "Block") return undefined;
            const blk = then_expr.kind._0;
            const then = blk.expr;
            if (then === undefined) return undefined;
            if (!def.is_box()) return undefined;
            const boxed_ty = args.type_at(0);
            const bk = boxed_ty.kind();
            if (bk.$ !== "Dynamic") return undefined;
            const def_id = bk._0.principal_def_id();
            if (def_id === undefined) return undefined;
            const impl_def_ids: DefId[] = [];
            tcx.for_each_relevant_impl(def_id, values.expected, (did) => void impl_def_ids.push(did), VisitorResult.unit);
            if (impl_def_ids.length !== 1) return undefined;
            return [then, def_id];
          })();
          if (r !== undefined) {
            const [then, def_id] = r;
            // We have divergent if/else arms where the expected value is a type that
            // implements the trait of the found boxed trait object.
            diag.multipart_suggestion(
              `\`${display_Ty(values.expected)}\` implements \`${display_Symbol(tcx.item_name(def_id))}\` so you can box it to coerce to the trait object \`${display_Ty(values.found)}\``,
              [
                [Span.shrink_to_lo(then.span), "Box::new("],
                [Span.shrink_to_hi(then.span), ")"],
              ],
              MachineApplicable,
            );
            break arms;
          }
        }
        // _ => {}
      }
      // debug!(
      //     "note_and_explain_type_err expected={:?} ({:?}) found={:?} ({:?})",
      //     values.expected,
      //     values.expected.kind(),
      //     values.found,
      //     values.found.kind(),
      // );
      break;
    }
    case "CyclicTy": {
      const ty = err._0;
      // Watch out for various cases of cyclic types and try to explain.
      if (ty.is_closure() || ty.is_coroutine() || ty.is_coroutine_closure()) {
        diag.note(
          "closures cannot capture themselves or take themselves as argument;\n" +
            "this error may be the result of a recent compiler bug-fix,\n" +
            "see issue #46062 <https://github.com/rust-lang/rust/issues/46062>\n" +
            "for more information",
        );
      }
      break;
    }
    case "TargetFeatureCast": {
      const def_id = err._0;
      const target_spans = find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) =>
        k.$ === "TargetFeature" && k.was_forced === false ? k.attr_span : undefined,
      );
      diag.note("functions with `#[target_feature(..)]` can only be coerced to `unsafe` function pointers");
      diag.span_labels(target_spans === undefined ? [] : [target_spans], "`#[target_feature(..)]` added here");
      break;
    }
    default:
      break;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:633 suggest_constraint
TypeErrCtxt.prototype.suggest_constraint = function (
  this: TypeErrCtxt,
  diag: Diag,
  msg: () => string,
  body_owner_def_id: DefId | undefined,
  alias_ty: AliasTyT,
  ty: Ty,
): boolean {
  const tcx = this.tcx;
  // FIXME(inherent_associated_types): Extend this to support `ty::Inherent`, too.
  const proj_ty = AliasTy.try_to_projection(alias_ty);
  if (proj_ty === undefined) {
    return false;
  }
  if (body_owner_def_id === undefined) {
    return false;
  }
  const assoc = tcx.associated_item(proj_ty.kind) as AssocItem;
  const [trait_ref, assoc_args] = AliasTy.trait_ref_and_own_args(alias_ty, as_interner(tcx));
  const item = tcx.hir_get_if_local(body_owner_def_id);
  if (item === undefined) {
    return false;
  }
  const hir_generics = hir.Node.generics(item);
  if (hir_generics === undefined) {
    return false;
  }
  // Get the `DefId` for the type parameter corresponding to `A` in `<A as T>::Foo`.
  // This will also work for `impl Trait`.
  const sk = AliasTy.self_ty(alias_ty).kind();
  if (sk.$ !== "Param") {
    return false;
  }
  const param_ty = sk._0;
  const generics = tcx.generics_of(body_owner_def_id) as Generics;
  const def_id_ = generics.type_param(param_ty, tcx).def_id;
  const def_id = def_id_.as_local();
  if (def_id === undefined) {
    return false;
  }

  // First look in the `where` clause, as this might be
  // `fn foo<T>(x: T) where T: Trait`.
  for (const pred of hir_generics.bounds_for_param(def_id)) {
    if (this.constrain_generic_bound_associated_type_structured_suggestion(diag, trait_ref, pred.bounds, assoc, assoc_args, ty, msg, false)) {
      return true;
    }
  }
  if (param_ty.index >= generics.parent_count) {
    // The param comes from the current item, do not look at the parent. (#117209)
    return false;
  }
  // If associated item, look to constrain the params of the trait/impl.
  let hir_id;
  switch (item.$) {
    case "ImplItem":
      hir_id = item._0.hir_id();
      break;
    case "TraitItem":
      hir_id = item._0.hir_id();
      break;
    default:
      return false;
  }
  const parent = tcx.hir_get_parent_item(hir_id).def_id;
  return this.suggest_constraint(diag, msg, LocalDefId.to_def_id(parent), alias_ty, ty);
};

/// An associated type was expected and a different type was found.
///
/// We perform a few different checks to see what we can suggest:
///
///  - In the current item, look for associated functions that return the expected type and
///    suggest calling them. (Not a structured suggestion.)
///  - If any of the item's generic bounds can be constrained, we suggest constraining the
///    associated type to the found type.
///  - If the associated type has a default type and was expected inside of a `trait`, we
///    mention that this is disallowed.
///  - If all other things fail, and the error is not because of a mismatch between the `trait`
///    and the `impl`, we provide a generic `help` to constrain the assoc type or call an assoc
///    fn that returns the type.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:711 expected_projection
TypeErrCtxt.prototype.expected_projection = function (
  this: TypeErrCtxt,
  diag: Diag,
  proj_ty: AliasTyT,
  values: ExpectedFound<Ty>,
  body_owner_def_id: DefId | undefined,
  cause_code: ObligationCauseCode,
): void {
  const tcx = this.tcx;

  // Don't suggest constraining a projection to something containing itself
  if (this.tcx.erase_and_anonymize_regions(values.found, fold_Ty).contains(this.tcx.erase_and_anonymize_regions(values.expected, fold_Ty))) {
    return;
  }

  if (!(proj_ty.kind.$ === "Projection" || proj_ty.kind.$ === "Inherent")) {
    return panic(`expected projection or inherent alias, found ${debug_AliasTyKind(proj_ty.kind, PLAIN)}`);
  }
  const def_id = proj_ty.kind.def_id;

  const msg = (): string => `consider constraining the associated type \`${display_Ty(values.expected)}\` to \`${display_Ty(values.found)}\``;

  const body_owner = body_owner_def_id === undefined ? undefined : tcx.hir_get_if_local(body_owner_def_id);
  const current_method_ident = body_owner === undefined ? undefined : hir.Node.ident(body_owner)?.name;

  // We don't want to suggest calling an assoc fn in a scope where that isn't feasible.
  const callable_scope =
    body_owner !== undefined &&
    ((body_owner.$ === "Item" && body_owner._0.kind.$ === "Fn") ||
      (body_owner.$ === "TraitItem" && body_owner._0.kind.$ === "Fn") ||
      (body_owner.$ === "ImplItem" && body_owner._0.kind.$ === "Fn"));
  const impl_comparison = cause_code.$ === "CompareImplItem";
  if (impl_comparison) {
    // We do not want to suggest calling functions when the reason of the
    // type error is a comparison of an `impl` with its `trait`.
  } else {
    let point_at_assoc_fn: boolean;
    if (
      callable_scope &&
      this.point_at_methods_that_satisfy_associated_type(diag, tcx.parent(def_id), current_method_ident, def_id, values.expected)
    ) {
      // If we find a suitable associated function that returns the expected type, we
      // don't want the more general suggestion later in this method about "consider
      // constraining the associated type or calling a method that returns the associated
      // type".
      point_at_assoc_fn = true;
    } else {
      point_at_assoc_fn = false;
    }
    // Possibly suggest constraining the associated type to conform to the
    // found type.
    if (this.suggest_constraint(diag, msg, body_owner_def_id, proj_ty, values.found) || point_at_assoc_fn) {
      return;
    }
  }

  this.suggest_constraining_opaque_associated_type(diag, msg, proj_ty, values.found);

  if (this.point_at_associated_type(diag, body_owner_def_id, values.found)) {
    return;
  }

  if (!impl_comparison) {
    // Generic suggestion when we can't be more specific.
    if (callable_scope) {
      diag.help(`${msg()} or calling a method that returns \`${display_Ty(values.expected)}\``);
    } else {
      diag.help(msg());
    }
    diag.note("for more information, visit https://doc.rust-lang.org/book/ch19-03-advanced-traits.html");
  }
  const code = diag.deref().code;
  if (code !== undefined && tcx.sess.teach(code)) {
    diag.help(
      "given an associated type `T` and a method `foo`:\n" +
        "```\n" +
        "trait Trait {\n" +
        "type T;\n" +
        "fn foo(&self) -> Self::T;\n" +
        "}\n" +
        "```\n" +
        "the only way of implementing method `foo` is to constrain `T` with an explicit associated type:\n" +
        "```\n" +
        "impl Trait for X {\n" +
        "type T = String;\n" +
        "fn foo(&self) -> Self::T { String::new() }\n" +
        "}\n" +
        "```",
    );
  }
};

/// When the expected `impl Trait` is not defined in the current item, it will come from
/// a return type. This can occur when dealing with `TryStream` (#71035).
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:827 suggest_constraining_opaque_associated_type
TypeErrCtxt.prototype.suggest_constraining_opaque_associated_type = function (
  this: TypeErrCtxt,
  diag: Diag,
  msg: () => string,
  proj_ty: AliasTyT,
  ty: Ty,
): boolean {
  const tcx = this.tcx;

  if (!(proj_ty.kind.$ === "Projection" || proj_ty.kind.$ === "Inherent")) {
    return panic(`expected projection or inherent alias, found ${debug_AliasTyKind(proj_ty.kind, PLAIN)}`);
  }
  const def_id = proj_ty.kind.def_id;

  const assoc = tcx.associated_item(def_id) as AssocItem;
  const sk = AliasTy.self_ty(proj_ty).kind();
  if (sk.$ === "Alias" && sk._1.kind.$ === "Opaque") {
    const def_id = sk._1.kind.def_id;
    const opaque_local_def_id = def_id.as_local();
    let opaque_hir_ty: hir.OpaqueTy;
    if (opaque_local_def_id !== undefined) {
      opaque_hir_ty = tcx.hir_expect_opaque_ty(opaque_local_def_id);
    } else {
      return false;
    }

    const [trait_ref, assoc_args] = AliasTy.trait_ref_and_own_args(proj_ty, as_interner(tcx));

    return this.constrain_generic_bound_associated_type_structured_suggestion(diag, trait_ref, opaque_hir_ty.bounds, assoc, assoc_args, ty, msg, true);
  } else {
    return false;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:868 point_at_methods_that_satisfy_associated_type
TypeErrCtxt.prototype.point_at_methods_that_satisfy_associated_type = function (
  this: TypeErrCtxt,
  diag: Diag,
  assoc_container_id: DefId,
  current_method_ident: Symbol | undefined,
  proj_ty_item_def_id: DefId,
  expected: Ty,
): boolean {
  const tcx = this.tcx;

  const items = tcx.associated_items(assoc_container_id) as AssocItems;
  // Find all the methods in the trait that could be called to construct the
  // expected associated type.
  // FIXME: consider suggesting the use of associated `const`s.
  const methods: [Span, string][] = [];
  for (const item of AssocItems.in_definition_order(items)) {
    if (!(AssocItem.is_fn(item) && AssocItem.name(item) !== current_method_ident && !tcx.is_doc_hidden(item.def_id))) {
      continue;
    }
    const method = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(item.def_id) as EarlyBinder<PolyFnSig>));
    const ok = Binder.skip_binder(PolyFnSigC.output(method)).kind();
    if (ok.$ === "Alias" && ok._1.kind.$ === "Projection" && DefId_eq(ok._1.kind.def_id, proj_ty_item_def_id)) {
      methods.push([tcx.def_span(item.def_id), `consider calling \`${tcx.def_path_str(item.def_id)}\``]);
    }
  }
  if (methods.length !== 0) {
    // Use a single `help:` to show all the methods in the trait that can
    // be used to construct the expected associated type.
    const span: MultiSpan = MultiSpan.from_spans(methods.map(([sp, _]) => sp));
    const msg = `${methods.length === 1 ? "a" : "some"} method${pluralize(methods.length)} ${pluralize("is", methods.length)} available that return${methods.length === 1 ? "s" : ""} \`${display_Ty(expected)}\``;
    for (const [sp, label] of methods) {
      span.push_span_label(sp, label);
    }
    diag.span_help(span, msg);
    return true;
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:925 point_at_associated_type
TypeErrCtxt.prototype.point_at_associated_type = function (this: TypeErrCtxt, diag: Diag, body_owner_def_id: DefId | undefined, found: Ty): boolean {
  const tcx = this.tcx;

  const def_id = body_owner_def_id === undefined ? undefined : body_owner_def_id.as_local();
  if (def_id === undefined) {
    return false;
  }

  // When `body_owner` is an `impl` or `trait` item, look in its associated types for
  // `expected` and point at it.
  const hir_id = tcx.local_def_id_to_hir_id(def_id);
  const parent_id = tcx.hir_get_parent_item(hir_id);
  const _item = tcx.hir_node_by_def_id(parent_id.def_id);

  // debug!("expected_projection parent item {:?}", item);

  const param_env = tcx.param_env(def_id) as ParamEnv;

  const pk = tcx.def_kind(parent_id);
  if (pk.$ === "Trait" || pk.$ === "Impl") {
    const assoc_items = tcx.associated_items(parent_id) as AssocItems;
    // FIXME: account for `#![feature(specialization)]`
    for (const assoc_item of AssocItems.in_definition_order(assoc_items)) {
      if (!AssocItem.is_type(assoc_item)) continue;
      // FIXME: account for returning some type in a trait fn impl that has
      // an assoc type as a return type (#72076).
      const d = AssocItem.defaultness(assoc_item, tcx);
      if (!(d.$ === "Default" && d.has_value === true)) continue;
      const assoc_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(assoc_item.def_id) as EarlyBinder<Ty>));
      if (!this.infcx.can_eq(param_env, assoc_ty, found, ToTrace_Ty)) continue;
      let msg: string;
      switch (assoc_item.container.$) {
        case "Trait":
          msg = "associated type defaults can't be assumed inside the trait defining them";
          break;
        case "InherentImpl":
        case "TraitImpl":
          msg = "associated type is `default` and may be overridden";
          break;
      }
      diag.span_label(tcx.def_span(assoc_item.def_id), msg);
      return true;
    }
  }

  return false;
};

/// Given a slice of `hir::GenericBound`s, if any of them corresponds to the `trait_ref`
/// requirement, provide a structured suggestion to constrain it to a given type `ty`.
///
/// `is_bound_surely_present` indicates whether we know the bound we're looking for is
/// inside `bounds`. If that's the case then we can consider `bounds` containing only one
/// trait bound as the one we're looking for. This can help in cases where the associated
/// type is defined on a supertrait of the one present in the bounds.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:983 constrain_generic_bound_associated_type_structured_suggestion
TypeErrCtxt.prototype.constrain_generic_bound_associated_type_structured_suggestion = function (
  this: TypeErrCtxt,
  diag: Diag,
  trait_ref: TraitRef,
  bounds: hir.GenericBounds,
  assoc: AssocItem,
  assoc_args: readonly GenericArg[],
  ty: Ty,
  msg: () => string,
  is_bound_surely_present: boolean,
): boolean {
  // FIXME: we would want to call `deeply_resolve_ignoring_regions` on `ty` before suggesting.

  const trait_bounds: hir.PolyTraitRef[] = [];
  for (const bound of bounds) {
    if (bound.$ === "Trait" && TraitBoundModifiers_eq(bound._0.modifiers, hir.TraitBoundModifiers.NONE)) {
      trait_bounds.push(bound._0);
    }
  }

  const matching_trait_bounds = trait_bounds.filter((ptr) => DefId_opt_eq(ptr.trait_ref.trait_def_id(), trait_ref.def_id));

  let span: Span;
  if (matching_trait_bounds.length === 1) {
    span = matching_trait_bounds[0]!.span;
  } else if (matching_trait_bounds.length === 0 && is_bound_surely_present) {
    if (trait_bounds.length === 1) {
      span = trait_bounds[0]!.span;
    } else {
      return false;
    }
  } else {
    return false;
  }

  return this.constrain_associated_type_structured_suggestion(diag, span, assoc, assoc_args, ty, msg);
};

/// Given a span corresponding to a bound, provide a structured suggestion to set an
/// associated type to a given type `ty`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:1022 constrain_associated_type_structured_suggestion
TypeErrCtxt.prototype.constrain_associated_type_structured_suggestion = function (
  this: TypeErrCtxt,
  diag: Diag,
  span: Span,
  assoc: AssocItem,
  assoc_args: readonly GenericArg[],
  ty: Ty,
  msg: () => string,
): boolean {
  const tcx = this.tcx;

  const snippet_r = tcx.sess.source_map().span_to_snippet(span);
  if (snippet_r.$ === "Ok") {
    const has_params = snippet_r._0.toString().endsWith(">");
    let span_: Span;
    let sugg: string;
    if (has_params) {
      const pos = (Span.hi(span) - 1) as BytePos;
      const span__ = Span.new(pos, pos, Span.ctxt(span), Span.parent(span));
      [span_, sugg] = [span__, `, ${display_Ident(AssocItem.ident(assoc, tcx))} = ${display_Ty(ty)}`];
    } else {
      const item_args = this.format_generic_args(assoc_args);
      [span_, sugg] = [Span.shrink_to_hi(span), `<${display_Ident(AssocItem.ident(assoc, tcx))}${item_args} = ${display_Ty(ty)}>`];
    }
    diag.span_suggestion_verbose(span_, msg(), sugg, MaybeIncorrect);
    return true;
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/note_and_explain.rs:1050 format_generic_args
TypeErrCtxt.prototype.format_generic_args = function (this: TypeErrCtxt, args: readonly GenericArg[]): string {
  return expect_result(
    FmtPrinter.print_string(this.tcx, "TypeNS" as Namespace, (p) => p.print_path_with_generic_args((_) => PRINT_OK, args)),
    "could not write to `String`.",
    debug_PrintError,
  );
};
