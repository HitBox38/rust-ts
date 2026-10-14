// Port of compiler/rustc_ast_lowering/src/path.rs (lane lower-pat-path-block).
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned onto
// `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates; every other
// rustc_ast_lowering export (lib.ts, diagnostics.ts, ...) is read inside function bodies only.
import type {
  AngleBracketedArgs,
  ParenthesizedArgs,
  Path,
  PathSegment,
  QSelf,
  TraitBoundModifiers,
} from "../rustc_ast/lib.ts";
import { NodeId } from "../rustc_ast/node_id.ts";
import type { LanguageItems } from "../rustc_attr_ir/lang_items.ts";
import type { Diagnostic } from "../rustc_errors/diagnostic.ts";
import { DefKind, type PerNS, Res } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import { debug_LifetimeRes, PartialRes, type PerOwnerResolverData } from "../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { add_feature_diagnostics } from "../rustc_session/diagnostics.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { BytePos, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { Ident, sym, type Symbol } from "../rustc_span/symbol.ts";
import type { ClosureKind } from "../rustc_type_ir/lib.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, unported, unreachable, unwrap } from "../std/panic.ts";
import { LoweringContext } from "./decls.ts";
import * as diagnostics from "./diagnostics.ts";
import * as lib from "./lib.ts";
import {
  ALLOW_ASYNC_FN_TRAITS,
  type AllowReturnTypeNotation,
  type GenericArgsCtor,
  type GenericArgsMode,
  type ImplTraitContext,
  type ParamMode,
} from "./lib.ts";

// ---- PORT(pending-gen): bridge to codegen set rustc_ast_lowering --------------------------------------------------
// The crate's own types are not generated yet (tools/codegen set `rustc_ast_lowering`): lib.ts aliases the lib.rs
// types (`GenericArgsCtor`, `ImplTraitContext`, `ParamMode`, ...) to `unknown` and diagnostics.ts has no
// `#[derive(Diagnostic)]` structs. This block stands in for the generated exports with the generator's names and
// shapes (checked against a scratch run of `bun tools/codegen/types.ts rustc_ast_lowering`); a generated value that is
// still missing at run time stops as UNPORTED. Fieldless lib.rs enums are written as their string values
// (`"Optional"`, `"Err"`), data enums as `{ $: .. }` literals (PORTING §5), so those need no bridge. On integration:
// call `diagnostics.X_diagnostic` / `new GenericArgsCtor(..)` directly, drop the `*View` casts and delete this block.
// The `TyCtxt` lang-item methods (rustc_middle middle/lang_items.rs, ty/context.rs:995) are not ported either;
// `tcx_method` stops as UNPORTED until `TyCtxt` has them.

/** A generated export of `module` (see above); UNPORTED while it does not exist. */
function pending_gen<T>(module: object, name: string): T {
  const v = (module as Record<string, unknown>)[name];
  if (v === undefined) return unported(`rustc_ast_lowering::${name} (pending codegen set rustc_ast_lowering)`);
  return v as T;
}

/** The `#[derive(Diagnostic)]` structs of diagnostics.rs this file emits (diagnostics.gen.ts, lane lower-index-diag). */
const diagnostics_ = {
  /** diagnostics.rs:8 (`sub`: the `#[subdiagnostic] UseAngleBrackets`, diagnostics.rs:18) */
  GenericTypeWithParentheses_diagnostic(d: {
    span: Span;
    sub: { open_param: Span; close_param: Span } | undefined;
  }): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "GenericTypeWithParentheses_diagnostic")(d);
  },
  /** diagnostics.rs:434 (`suggestion`: the `#[subdiagnostic] RTNSuggestion`, diagnostics.rs:426) */
  BadReturnTypeNotation_diagnostic(d: BadReturnTypeNotationView): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "BadReturnTypeNotation_diagnostic")(d);
  },
  /** diagnostics.rs:480 */
  AsyncBoundNotOnTrait_diagnostic(d: { span: Span; descr: string }): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "AsyncBoundNotOnTrait_diagnostic")(d);
  },
  /** diagnostics.rs:488 */
  AsyncBoundOnlyForFnTraits_diagnostic(d: { span: Span }): Diagnostic {
    return pending_gen<(d_: typeof d) => Diagnostic>(diagnostics, "AsyncBoundOnlyForFnTraits_diagnostic")(d);
  },
};
/** diagnostics.rs:434 `enum BadReturnTypeNotation` */
type BadReturnTypeNotationView =
  | { readonly $: "Inputs"; span: Span }
  | { readonly $: "Output"; span: Span; suggestion: { output: Span; input: Span } }
  | { readonly $: "NeedsDots"; span: Span }
  | { readonly $: "Position"; span: Span };

/**
 * `GenericArgsCtor` (lib.rs:3296: generated class in lib.gen.ts, fields in declaration order) with `is_empty`
 * (lib.rs:3304) and `into_generic_args` (lib.rs:3310) of lane lower-lib-b.
 */
interface GenericArgsCtorView {
  args: hir.GenericArg[];
  constraints: readonly hir.AssocItemConstraint[];
  parenthesized: hir.GenericArgsParentheses;
  span: Span;
  is_empty(): boolean;
  into_generic_args(this_: LoweringContext): hir.GenericArgs;
}
/** `GenericArgsCtor { args, constraints, parenthesized, span }` */
function new_GenericArgsCtor(
  args: hir.GenericArg[],
  constraints: readonly hir.AssocItemConstraint[],
  parenthesized: hir.GenericArgsParentheses,
  span: Span,
): GenericArgsCtorView {
  type Ctor = new (
    args: hir.GenericArg[],
    constraints: readonly hir.AssocItemConstraint[],
    parenthesized: hir.GenericArgsParentheses,
    span: Span,
  ) => GenericArgsCtorView;
  const ctor = pending_gen<Ctor>(lib, "GenericArgsCtor");
  return new ctor(args, constraints, parenthesized, span);
}

/** The field of `PerOwnerLoweringState` (lib.rs:155, generated class in lib.gen.ts) this file uses. */
interface PerOwnerLoweringStateView {
  owner: PerOwnerResolverData;
}

/** The `TyCtxt` lang-item methods this file uses (not ported yet, see above). */
interface TyCtxtLangItemsView {
  /** ty/context.rs:995 */
  lang_items(): LanguageItems;
  /** middle/lang_items.rs:38 */
  fn_trait_kind_from_def_id(id: DefId): ClosureKind | undefined;
  /** middle/lang_items.rs:50 */
  async_fn_trait_kind_from_def_id(id: DefId): ClosureKind | undefined;
}
function tcx_method<K extends keyof TyCtxtLangItemsView>(tcx: TyCtxt, name: K): TyCtxtLangItemsView[K] {
  const f = (tcx as unknown as Record<string, unknown>)[name];
  if (typeof f !== "function") {
    const at = name === "lang_items" ? "ty::context" : "middle::lang_items";
    return unported(`rustc_middle::${at}::TyCtxt::${name}`);
  }
  return (f as (...a: unknown[]) => unknown).bind(tcx) as TyCtxtLangItemsView[K];
}
// ---- end PORT(pending-gen) ---------------------------------------------------------------------------------------

// #[instrument(level = "trace", skip(self))] (tracing only)
// rustc: compiler/rustc_ast_lowering/src/path.rs:26 lower_qpath
LoweringContext.prototype.lower_qpath = function (
  this: LoweringContext,
  id: NodeId,
  qself: QSelf | undefined,
  p: Path,
  param_mode: ParamMode,
  allow_return_type_notation: AllowReturnTypeNotation,
  itctx: ImplTraitContext,
  // modifiers of the impl/bound if this is a trait path
  modifiers: TraitBoundModifiers | undefined,
): hir.QPath {
  const qself_position = qself === undefined ? undefined : qself.position;
  const qself_ =
    qself === undefined
      ? undefined
      : // Reject cases like `<impl Trait>::Assoc` and `<impl Trait as Trait>::Assoc`.
        this.lower_ty_alloc(qself.ty, { $: "Disallowed", _0: "Path" });

  const partial_res = this.get_partial_res(id) ?? PartialRes.new({ $: "Err" });
  const base_res = partial_res.base_res();
  const unresolved_segments = partial_res.unresolved_segments();

  let res = this.lower_res(base_res);

  // When we have an `async` kw on a bound, map the trait it resolves to.
  if (modifiers !== undefined && modifiers.asyncness.$ === "Async") {
    if (res.$ === "Def" && res._0.$ === "Trait") {
      const def_id = res._1;
      const async_def_id = this.map_trait_to_async_trait(def_id);
      if (async_def_id !== undefined) {
        res = { $: "Def", _0: DefKind.Trait, _1: async_def_id };
      } else {
        this.dcx().emit_err(diagnostics_.AsyncBoundOnlyForFnTraits_diagnostic({ span: p.span }));
      }
    } else if (res.$ === "Err") {
      // No additional error.
    } else {
      // This error isn't actually emitted AFAICT, but it's best to keep
      // it around in case the resolver doesn't always check the defkind
      // of an item or something.
      this.dcx().emit_err(diagnostics_.AsyncBoundNotOnTrait_diagnostic({ span: p.span, descr: Res.descr(res) }));
    }
  }

  // Ungate the `async_fn_traits` feature in the path if the trait is
  // named via either `async Fn*()` or `AsyncFn*()`.
  let bound_modifier_allowed_features: readonly Symbol[] | undefined;
  if (
    res.$ === "Def" &&
    res._0.$ === "Trait" &&
    tcx_method(this.tcx, "async_fn_trait_kind_from_def_id")(res._1) !== undefined
  ) {
    bound_modifier_allowed_features = ALLOW_ASYNC_FN_TRAITS;
  } else {
    bound_modifier_allowed_features = undefined;
  }

  // Only permit `impl Trait` in the final segment. E.g., we permit `Option<impl Trait>`,
  // `option::Option<T>::Xyz<impl Trait>` and reject `option::Option<impl Trait>::Xyz`.
  const itctx_ = (i: number): ImplTraitContext => {
    if (i + 1 === p.segments.length) {
      return itctx;
    } else {
      return { $: "Disallowed", _0: "Path" };
    }
  };

  const path_span_lo = Span.shrink_to_lo(p.span);
  const proj_start = p.segments.length - unresolved_segments;
  // `hir::Path { res, segments: .., span: .. }`: the fields in source order.
  const segments = this.arena.alloc_from_iter(
    p.segments.slice(0, proj_start).map((segment, i) => {
      let param_mode_: ParamMode;
      if (qself_position !== undefined && param_mode === "Optional" && i < qself_position) {
        // This segment is part of the trait path in a
        // qualified path - one of `a`, `b` or `Trait`
        // in `<X as a::b::Trait>::T::U::method`.
        param_mode_ = "Explicit";
      } else {
        param_mode_ = param_mode;
      }

      let generic_args_mode: GenericArgsMode;
      // `a::b::Trait(Args)`
      if (base_res.$ === "Def" && base_res._0.$ === "Trait" && i + 1 === proj_start) {
        generic_args_mode = "ParenSugar";
      }
      // `a::b::Trait(Args)::TraitItem`
      else if (
        base_res.$ === "Def" &&
        (base_res._0.$ === "AssocFn" || base_res._0.$ === "AssocConst" || base_res._0.$ === "AssocTy") &&
        i + 2 === proj_start
      ) {
        generic_args_mode = "ParenSugar";
      } else if (base_res.$ === "Def" && base_res._0.$ === "AssocFn" && i + 1 === proj_start) {
        generic_args_mode = allow_return_type_notation === "Yes" ? "ReturnTypeNotation" : "Err";
      }
      // Avoid duplicated errors.
      else if (base_res.$ === "Err") {
        generic_args_mode = "Silence";
      }
      // An error
      else {
        generic_args_mode = "Err";
      }

      return this.lower_path_segment(
        p.span,
        segment,
        param_mode_,
        generic_args_mode,
        itctx_(i),
        bound_modifier_allowed_features,
      );
    }),
  );
  const last = proj_start > 0 ? p.segments[proj_start - 1] : undefined;
  const span = this.lower_span(last === undefined ? path_span_lo : Span.to(path_span_lo, last.span()));
  const path = this.arena.alloc(new hir.Path(span, res, segments));

  if (bound_modifier_allowed_features !== undefined) {
    path.span = this.mark_span_with_reason(DesugaringKind.BoundModifier, path.span, bound_modifier_allowed_features);
  }

  // Simple case, either no projections, or only fully-qualified.
  // E.g., `std::mem::size_of` or `<I as Iterator>::Item`.
  if (unresolved_segments === 0) {
    return { $: "Resolved", _0: qself_, _1: path };
  }

  // Create the innermost type that we're projecting from.
  let ty: hir.Ty;
  if (path.segments.length === 0) {
    // If the base path is empty that means there exists a
    // syntactical `Self`, e.g., `&i32` in `<&i32>::clone`.
    ty = unwrap(qself_, "missing QSelf for <T>::...");
  } else {
    // Otherwise, the base path is an implicit `Self` type path,
    // e.g., `Vec` in `Vec::new` or `<I as Iterator>::Item` in
    // `<I as Iterator>::Item::default`.
    const new_id = this.next_id();
    ty = this.arena.alloc(this.ty_path(new_id, path.span, { $: "Resolved", _0: qself_, _1: path }));
  }

  // Anything after the base path are associated "extensions",
  // out of which all but the last one are associated types,
  // e.g., for `std::vec::Vec::<T>::IntoIter::Item::clone`:
  // * base path is `std::vec::Vec<T>`
  // * "extensions" are `IntoIter`, `Item` and `clone`
  // * type nodes are:
  //   1. `std::vec::Vec<T>` (created above)
  //   2. `<std::vec::Vec<T>>::IntoIter`
  //   3. `<<std::vec::Vec<T>>::IntoIter>::Item`
  // * final path is `<<<std::vec::Vec<T>>::IntoIter>::Item>::clone`
  for (let i = proj_start; i < p.segments.length; i++) {
    const segment = p.segments[i]!;
    // If this is a type-dependent `T::method(..)`.
    let generic_args_mode: GenericArgsMode;
    if (i + 1 === p.segments.length && allow_return_type_notation === "Yes") {
      generic_args_mode = "ReturnTypeNotation";
    } else {
      generic_args_mode = "Err";
    }

    const hir_segment = this.arena.alloc(
      this.lower_path_segment(p.span, segment, param_mode, generic_args_mode, itctx_(i), undefined),
    );
    const qpath: hir.QPath = { $: "TypeRelative", _0: ty, _1: hir_segment };

    // It's finished, return the extension of the right node type.
    if (i === p.segments.length - 1) {
      return qpath;
    }

    // Wrap the associated extension in another type node.
    const new_id = this.next_id();
    ty = this.arena.alloc(this.ty_path(new_id, Span.to(path_span_lo, segment.span()), qpath));
  }

  // We should've returned in the for loop above.

  return this.dcx().span_bug(
    p.span,
    `lower_qpath: no final extension segment in ${proj_start}..${p.segments.length}`,
  );
};

// rustc: compiler/rustc_ast_lowering/src/path.rs:230 lower_use_path
LoweringContext.prototype.lower_use_path = function (
  this: LoweringContext,
  res: PerNS<Res | undefined>,
  p: Path,
  param_mode: ParamMode,
): hir.UsePath {
  assert(!res.is_empty(), "assertion failed: !res.is_empty()");
  // `hir::UsePath { res, segments: .., span: .. }`: the fields in source order.
  const segments = this.arena.alloc_from_iter(
    p.segments.map((segment) =>
      this.lower_path_segment(p.span, segment, param_mode, "Err", { $: "Disallowed", _0: "Path" }, undefined),
    ),
  );
  const span = this.lower_span(p.span);
  return this.arena.alloc(new hir.Path(span, res, segments));
};

// rustc: compiler/rustc_ast_lowering/src/path.rs:253 lower_path_segment
LoweringContext.prototype.lower_path_segment = function (
  this: LoweringContext,
  path_span: Span,
  segment: PathSegment,
  param_mode: ParamMode,
  generic_args_mode: GenericArgsMode,
  itctx: ImplTraitContext,
  // Additional features ungated with a bound modifier like `async`.
  // This is passed down to the implicit associated type binding in
  // parenthesized bounds.
  bound_modifier_allowed_features: readonly Symbol[] | undefined,
): hir.PathSegment {
  // debug!("path_span: {:?}, lower_path_segment(segment: {:?})", path_span, segment);
  let generic_args: GenericArgsCtorView;
  let infer_args: boolean;
  const generic_args_ = segment.args;
  if (generic_args_ !== undefined) {
    switch (generic_args_.$) {
      case "AngleBracketed": {
        const data = generic_args_._0;
        [generic_args, infer_args] = this.lower_angle_bracketed_parameter_data(data, param_mode, itctx) as [
          GenericArgsCtorView,
          boolean,
        ];
        break;
      }
      case "Parenthesized": {
        const data = generic_args_._0;
        switch (generic_args_mode) {
          case "ReturnTypeNotation": {
            let err: BadReturnTypeNotationView;
            const output = data.output;
            switch (output.$) {
              // `([_, ..], FnRetTy::Default(_))` / `([], FnRetTy::Default(_))`
              case "Default":
                if (data.inputs.length > 0) {
                  err = { $: "Inputs", span: data.inputs_span };
                } else {
                  err = { $: "NeedsDots", span: data.inputs_span };
                }
                break;
              // The case `T: Trait<method(..) -> Ret>` is handled in the parser.
              case "Ty": {
                const ty = output._0;
                const span = Span.to(Span.shrink_to_hi(data.inputs_span), ty.span);
                err = {
                  $: "Output",
                  span,
                  suggestion: {
                    output: span,
                    input: data.inputs_span,
                  },
                };
                break;
              }
            }
            const err_ = this.dcx().create_err(diagnostics_.BadReturnTypeNotation_diagnostic(err));
            if (!this.tcx.features().return_type_notation() && this.tcx.sess.is_nightly_build()) {
              add_feature_diagnostics(err_, this.tcx.sess, sym.return_type_notation);
            }
            err_.stash(path_span, "ReturnTypeNotation");
            [generic_args, infer_args] = [new_GenericArgsCtor([], [], "ReturnTypeNotation", path_span), false];
            break;
          }
          case "ParenSugar":
          case "Silence":
            [generic_args, infer_args] = this.lower_parenthesized_parameter_data(
              data,
              itctx,
              bound_modifier_allowed_features,
            ) as [GenericArgsCtorView, boolean];
            break;
          case "Err": {
            // Suggest replacing parentheses with angle brackets `Trait(params...)` to `Trait<params...>`
            let sub: { open_param: Span; close_param: Span } | undefined;
            if (data.inputs.length !== 0) {
              // Start of the span to the 1st character of 1st argument
              const open_param = Span.to(
                Span.shrink_to_lo(data.inputs_span),
                Span.shrink_to_lo(unwrap(data.inputs[0]).span),
              );
              // Last character position of last argument to the end of the span
              const close_param = Span.to(
                Span.shrink_to_hi(unwrap(data.inputs[data.inputs.length - 1]).span),
                Span.shrink_to_hi(data.inputs_span),
              );

              sub = { open_param, close_param };
            } else {
              sub = undefined;
            }
            const guar = this.dcx().emit_err(diagnostics_.GenericTypeWithParentheses_diagnostic({ span: data.span, sub }));
            [generic_args, infer_args] = [
              (
                this.lower_angle_bracketed_parameter_data(data.as_angle_bracketed_args(), param_mode, {
                  $: "AlreadyErrored",
                  _0: guar,
                }) as [GenericArgsCtorView, boolean]
              )[0],
              false,
            ];
            break;
          }
          default:
            // PORT: the match is exhaustive upstream; `GenericArgsMode` is `unknown` until lib.gen.ts.
            return unreachable();
        }
        break;
      }
      case "ParenthesizedElided": {
        const span = generic_args_._0;
        switch (generic_args_mode) {
          case "ReturnTypeNotation":
          case "Silence":
            // Ok
            break;
          case "ParenSugar":
          case "Err":
            this.dcx().emit_err(diagnostics_.BadReturnTypeNotation_diagnostic({ $: "Position", span }));
            break;
          default:
            // PORT: the match is exhaustive upstream; `GenericArgsMode` is `unknown` until lib.gen.ts.
            return unreachable();
        }
        [generic_args, infer_args] = [new_GenericArgsCtor([], [], "ReturnTypeNotation", span), false];
        break;
      }
    }
  } else {
    [generic_args, infer_args] = [
      new_GenericArgsCtor([], [], "No", Span.shrink_to_hi(path_span)),
      param_mode === "Optional",
    ];
  }

  const has_lifetimes = generic_args.args.some((arg) => arg.$ === "Lifetime");

  // FIXME(return_type_notation): Is this correct? I think so.
  if (generic_args.parenthesized !== "ParenSugar" && !has_lifetimes) {
    this.maybe_insert_elided_lifetimes_in_path(path_span, segment.id, segment.ident.span, generic_args);
  }

  const res = this.expect_full_res(segment.id);
  const hir_id = this.lower_node_id(segment.id);
  // debug!(
  //     "lower_path_segment: ident={:?} original-id={:?} new-id={:?}",
  //     segment.ident, segment.id, hir_id,
  // );

  // `hir::PathSegment { ident, hir_id, res, infer_args, args, delegation_child_segment }`: the fields in source order.
  const ident = this.lower_ident(segment.ident);
  const res_ = this.lower_res(res);
  const args =
    generic_args.is_empty() && Span.is_empty(generic_args.span) ? undefined : generic_args.into_generic_args(this);
  return new hir.PathSegment(ident, hir_id, res_, args, infer_args, false);
};

// rustc: compiler/rustc_ast_lowering/src/path.rs:422 maybe_insert_elided_lifetimes_in_path
LoweringContext.prototype.maybe_insert_elided_lifetimes_in_path = function (
  this: LoweringContext,
  path_span: Span,
  segment_id: NodeId,
  segment_ident_span: Span,
  generic_args_: GenericArgsCtor,
): void {
  const generic_args = generic_args_ as GenericArgsCtorView;
  const lres = (this.curr_owner as PerOwnerLoweringStateView).owner.get_lifetime_res(segment_id);
  let start: NodeId;
  let end: NodeId;
  if (lres !== undefined && lres.$ === "ElidedAnchor") {
    start = lres.start;
    end = lres.end;
  } else if (lres === undefined) {
    return;
  } else {
    return span_bug(path_span, `expected an elided lifetime to insert. found ${debug_LifetimeRes(lres, PLAIN)}`);
  }
  const expected_lifetimes = NodeId.as_usize(end) - NodeId.as_usize(start);
  void expected_lifetimes; // debug!(expected_lifetimes);

  // Note: these spans are used for diagnostics when they can't be inferred.
  // See rustc_resolve::late::lifetimes::LifetimeContext::add_missing_lifetime_specifiers_label
  let elided_lifetime_span: Span;
  let angle_brackets: hir.AngleBrackets;
  if (Span.is_empty(generic_args.span)) {
    // No brackets, e.g. `Path`: use an empty span just past the end of the identifier.
    // HACK: we use find_ancestor_inside to properly suggest elided spans in paths
    // originating from macros, since the segment's span might be from a macro arg.
    elided_lifetime_span = Span.find_ancestor_inside(segment_ident_span, path_span) ?? path_span;
    angle_brackets = "Missing";
  } else {
    // Brackets, e.g. `Path<>` or `Path<T>`: use an empty span just after the `<`.
    elided_lifetime_span = Span.shrink_to_lo(
      Span.with_lo(generic_args.span, BytePos.add(Span.lo(generic_args.span), BytePos(1))),
    );
    angle_brackets = generic_args.is_empty() ? "Empty" : "Full";
  }

  // `generic_args.args.insert_many(0, (start..end).map(..))`
  const inserted: hir.GenericArg[] = [];
  for (let i = NodeId.as_usize(start); i < NodeId.as_usize(end); i++) {
    const id = NodeId.from_usize(i);
    const l = this.lower_lifetime_hidden_in_path(id, elided_lifetime_span, angle_brackets);
    inserted.push({ $: "Lifetime", _0: l });
  }
  generic_args.args.splice(0, 0, ...inserted);
};

// rustc: compiler/rustc_ast_lowering/src/path.rs:471 lower_angle_bracketed_parameter_data
LoweringContext.prototype.lower_angle_bracketed_parameter_data = function (
  this: LoweringContext,
  data: AngleBracketedArgs,
  param_mode: ParamMode,
  itctx: ImplTraitContext,
): [GenericArgsCtor, boolean] {
  const has_non_lt_args = data.args.some((arg) => {
    if ((arg.$ === "Arg" && arg._0.$ === "Lifetime") || arg.$ === "Constraint") {
      return false;
    } else {
      // `AngleBracketedArg::Arg(ast::GenericArg::Type(_) | ast::GenericArg::Const(_))`
      return true;
    }
  });
  const args: hir.GenericArg[] = [];
  for (const arg of data.args) {
    if (arg.$ === "Arg") {
      args.push(this.lower_generic_arg(arg._0, itctx));
    }
  }
  const constraints_: hir.AssocItemConstraint[] = [];
  for (const arg of data.args) {
    if (arg.$ === "Constraint") {
      constraints_.push(this.lower_assoc_item_constraint(arg._0, itctx));
    }
  }
  const constraints = this.arena.alloc_from_iter(constraints_);
  const ctor = new_GenericArgsCtor(args, constraints, "No", data.span);
  return [ctor, !has_non_lt_args && param_mode === "Optional"];
};

// rustc: compiler/rustc_ast_lowering/src/path.rs:506 lower_parenthesized_parameter_data
LoweringContext.prototype.lower_parenthesized_parameter_data = function (
  this: LoweringContext,
  data: ParenthesizedArgs,
  itctx: ImplTraitContext,
  bound_modifier_allowed_features: readonly Symbol[] | undefined,
): [GenericArgsCtor, boolean] {
  // Switch to `PassThrough` mode for anonymous lifetimes; this
  // means that we permit things like `&Ref<T>`, where `Ref` has
  // a hidden lifetime parameter. This is needed for backwards
  // compatibility, even in contexts like an impl header where
  // we generally don't permit such things (see #51008).
  const { span, inputs: inputs_, inputs_span, output } = data;
  const inputs = this.arena.alloc_from_iter(
    inputs_.map((param) => this.lower_ty(param.ty, { $: "Disallowed", _0: "FnTraitParam" })),
  );
  let output_ty: hir.Ty;
  // Only allow `impl Trait` in return position. i.e.:
  // ```rust
  // fn f(_: impl Fn() -> impl Debug) -> impl Fn() -> impl Debug
  // //      disallowed --^^^^^^^^^^        allowed --^^^^^^^^^^
  // ```
  if (output.$ === "Ty" && (itctx as { readonly $: string }).$ === "OpaqueTy") {
    const ty = output._0;
    if (this.tcx.features().impl_trait_in_fn_trait_return()) {
      output_ty = this.lower_ty_alloc(ty, itctx);
    } else {
      output_ty = this.lower_ty_alloc(ty, {
        $: "FeatureGated",
        _0: "FnTraitReturn",
        _1: sym.impl_trait_in_fn_trait_return,
      });
    }
  } else if (output.$ === "Ty") {
    output_ty = this.lower_ty_alloc(output._0, { $: "Disallowed", _0: "FnTraitReturn" });
  } else {
    output_ty = this.arena.alloc(this.ty_tup(span, []));
  }
  const args: hir.GenericArg[] = [
    { $: "Type", _0: unwrap(this.arena.alloc(this.ty_tup(inputs_span, inputs)).try_as_ambig_ty()) },
  ];

  // If we have a bound like `async Fn() -> T`, make sure that we mark the
  // `Output = T` associated type bound with the right feature gates.
  let output_span = output_ty.span;
  if (bound_modifier_allowed_features !== undefined) {
    output_span = this.mark_span_with_reason(DesugaringKind.BoundModifier, output_span, bound_modifier_allowed_features);
  }
  const constraint = this.assoc_ty_binding(sym.Output, output_span, output_ty);

  return [new_GenericArgsCtor(args, [constraint], "ParenSugar", data.inputs_span), false];
};

/// An associated type binding (i.e., associated type equality constraint).
// rustc: compiler/rustc_ast_lowering/src/path.rs:572 assoc_ty_binding
LoweringContext.prototype.assoc_ty_binding = function (
  this: LoweringContext,
  assoc_ty_name: Symbol,
  span: Span,
  ty: hir.Ty,
): hir.AssocItemConstraint {
  const ident = Ident.with_dummy_span(assoc_ty_name);
  const kind: hir.AssocItemConstraintKind = { $: "Equality", term: hir.Term.from_Ty(ty) };
  const args: hir.GenericArg[] = [];
  const constraints: hir.AssocItemConstraint[] = [];
  const gen_args = this.arena.alloc(new hir.GenericArgs(args, constraints, "No", DUMMY_SP));
  // `hir::AssocItemConstraint { hir_id: self.next_id(), gen_args, span: self.lower_span(span), ident, kind }`
  const hir_id = this.next_id();
  const span_ = this.lower_span(span);
  return new hir.AssocItemConstraint(hir_id, ident, gen_args, kind, span_);
};

/// When a bound is annotated with `async`, it signals to lowering that the trait
/// that the bound refers to should be mapped to the "async" flavor of the trait.
///
/// This only needs to be done until we unify `AsyncFn` and `Fn` traits into one
/// that is generic over `async`ness, if that's ever possible, or modify the
/// lowering of `async Fn()` bounds to desugar to another trait like `LendingFn`.
// rustc: compiler/rustc_ast_lowering/src/path.rs:603 map_trait_to_async_trait
LoweringContext.prototype.map_trait_to_async_trait = function (this: LoweringContext, def_id: DefId): DefId | undefined {
  const lang_items = tcx_method(this.tcx, "lang_items")();
  const kind = tcx_method(this.tcx, "fn_trait_kind_from_def_id")(def_id);
  if (kind === undefined) return undefined;
  switch (kind) {
    case "Fn":
      return lang_items.async_fn_trait();
    case "FnMut":
      return lang_items.async_fn_mut_trait();
    case "FnOnce":
      return lang_items.async_fn_once_trait();
  }
};
