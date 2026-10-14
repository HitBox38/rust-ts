// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs (lane hir-ty-lowering-c).
//
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { display_ParamKindOrd, type ParamKindOrd, ParamKindOrd_discriminant } from "../../rustc_ast/lib.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, E0747, E0794, type Level, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { LATE_BOUND_LIFETIME_ARGUMENTS } from "../../rustc_lint_defs/builtin.gen.ts";
import type { GenericArg, GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericParamDef, GenericParamDefKind, type Generics } from "../../rustc_middle/ty/generics.ts";
import { GenericArg as TyGenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { IsSuggestable } from "../../rustc_middle/ty/diagnostics.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_GenericArg, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { display_Symbol, kw, Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { supertrait_def_ids } from "../../rustc_type_ir/elaborate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_str, debug_vec, PLAIN } from "../../std/fmt.ts";
import { assert_eq, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { unported } from "../../std/panic.ts";
import type { GenericArgsLowerer, HirTyLowerer } from "../decls.ts";
import { prohibit_assoc_item_constraint } from "./errors.ts";
import type { ExplicitLateBound, GenericArgCountMismatch, GenericArgCountResult, GenericArgPosition, IsMethodCall } from "./mod.gen.ts";

/// Report an error that a generic argument did not match the generic parameter that was
/// expected.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs:29 generic_arg_mismatch_err
export function generic_arg_mismatch_err(cx: HirTyLowerer, arg: hir.GenericArg, param: GenericParamDef, possible_ordering_error: boolean, help: string | undefined): ErrorGuaranteed {
  const tcx = cx.tcx();
  const sess = tcx.sess;
  const err = struct_span_code_err(
    cx.dcx(),
    hir.GenericArg.span(arg),
    E0747,
    `${hir.GenericArg.descr(arg)} provided when a ${GenericParamDefKind.descr(param.kind)} was expected`,
  );

  const add_braces_suggestion = (arg: hir.GenericArg, err: Diag): void => {
    const suggestions: [Span, string][] = [
      [Span.shrink_to_lo(hir.GenericArg.span(arg)), "{ "],
      [Span.shrink_to_hi(hir.GenericArg.span(arg)), " }"],
    ];
    err.multipart_suggestion(
      "if this generic argument was intended as a const parameter, \
surround it with braces",
      suggestions,
      Applicability.MaybeIncorrect,
    );
  };

  // Specific suggestion set for diagnostics
  if (arg.$ === "Type" && arg._0.kind.$ === "Path" && arg._0.kind._0.$ === "Resolved" && param.kind.$ === "Const") {
    const path = arg._0.kind._0._1;
    const res = path.res;
    if (res.$ === "Err") {
      add_braces_suggestion(arg, err);
      err.primary_message("unresolved item provided when a constant was expected");
      // A resolve error will already have been emitted pointing at this.
      return err.delay_as_bug();
    } else if (res.$ === "Def" && res._0.$ === "TyParam") {
      const src_def_id = res._1;
      const param_local_id = param.def_id.as_local();
      if (param_local_id !== undefined) {
        const param_name = tcx.hir_ty_param_name(param_local_id);
        const param_type = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(param.def_id) as EarlyBinder<Ty>));
        if (IsSuggestable.is_suggestable(param_type, tcx, false, fold_Ty)) {
          err.span_suggestion_verbose(
            tcx.def_span(src_def_id),
            "consider changing this type parameter to a const parameter",
            `const ${display_Symbol(param_name)}: ${display_Ty(param_type)}`,
            Applicability.MaybeIncorrect,
          );
        }
      }
    } else {
      add_braces_suggestion(arg, err);
    }
  } else if (arg.$ === "Type" && arg._0.kind.$ === "Path" && param.kind.$ === "Const") {
    add_braces_suggestion(arg, err);
  } else if (
    arg.$ === "Type" &&
    arg._0.kind.$ === "Array" &&
    param.kind.$ === "Const" &&
    EarlyBinder.skip_binder(tcx.type_of(param.def_id) as EarlyBinder<Ty>) === tcx.types.usize
  ) {
    const len = arg._0.kind._1;
    err.span_label(hir.GenericArg.span(arg), "array type provided where a `usize` was expected");
    const snippet = sess.source_map().span_to_snippet(tcx.hir_span(len.hir_id));
    if (snippet.$ === "Ok") {
      const snippet_ = snippet._0.toString();
      let sugg: string;
      if (len.kind.$ === "Anon" && tcx.hir_body(len.kind._0.body).value.kind.$ === "Lit") {
        // We don't need to surround literals in braces when used as consts
        sugg = snippet_;
      } else if (len.kind.$ === "Literal") {
        // We don't need to surround literals in braces when used as consts
        sugg = snippet_;
      } else {
        sugg = `{ ${snippet_} }`;
      }
      err.span_suggestion_verbose(
        hir.GenericArg.span(arg),
        `you might have meant to use the array's length's value`,
        sugg,
        Applicability.MaybeIncorrect,
      );
    }
  } else if (arg.$ === "Const" && param.kind.$ === "Type") {
    const cnst = arg._0;
    let body;
    if (
      cnst.kind.$ === "Path" &&
      cnst.kind._0.$ === "Resolved" &&
      cnst.kind._0._1.res.$ === "Def" &&
      cnst.kind._0._1.res._0.$ === "Fn"
    ) {
      const id = cnst.kind._0._1.res._1;
      err.help(`\`${display_Symbol(tcx.item_name(id))}\` is a function item, not a type`);
      err.help("function item types cannot be named directly");
    } else if (
      cnst.kind.$ === "Anon" &&
      ((body = tcx.hir_body(cnst.kind._0.body)), true) &&
      body.value.kind.$ === "Path" &&
      body.value.kind._0.$ === "Resolved" &&
      body.value.kind._0._1.res.$ === "Def" &&
      body.value.kind._0._1.res._0.$ === "Fn"
    ) {
      const id = body.value.kind._0._1.res._1;
      // FIXME(mgca): this branch is dead once new const path lowering
      // (for single-segment paths) is no longer gated
      err.help(`\`${display_Symbol(tcx.item_name(id))}\` is a function item, not a type`);
      err.help("function item types cannot be named directly");
    }
  }

  const kind_ord = GenericParamDefKind.to_ord(param.kind);
  const arg_ord = hir.GenericArg.to_ord(arg);

  // This note is only true when generic parameters are strictly ordered by their kind.
  if (possible_ordering_error && kind_ord !== arg_ord) {
    const [first, last] =
      ParamKindOrd_discriminant[kind_ord] < ParamKindOrd_discriminant[arg_ord]
        ? [GenericParamDefKind.descr(param.kind), hir.GenericArg.descr(arg)]
        : [hir.GenericArg.descr(arg), GenericParamDefKind.descr(param.kind)];
    err.note(`${first} arguments must be provided before ${last} arguments`);
    if (help !== undefined) {
      err.help(help);
    }
  }

  return err.emit_err();
}

/// Lower generic arguments from the HIR to the [`rustc_middle::ty`] representation.
///
/// This is a rather complex function. Let us try to explain the role
/// of each of its parameters:
///
/// To start, we are given the `def_id` of the thing whose generic parameters we
/// are creating, and a partial set of arguments `parent_args`. In general,
/// the generic arguments for an item begin with arguments for all the "parents"
/// of that item -- e.g., for a method it might include the parameters from the impl.
///
/// Therefore, the method begins by walking down these parents,
/// starting with the outermost parent and proceed inwards until
/// it reaches `def_id`. For each parent `P`, it will check `parent_args`
/// first to see if the parent's arguments are listed in there. If so,
/// we can append those and move on. Otherwise, it uses the provided
/// [`GenericArgsLowerer`] `ctx` which has the following methods:
///
/// - `args_for_def_id`: given the `DefId` `P`, supplies back the
///   generic arguments that were given to that parent from within
///   the path; so e.g., if you have `<T as Foo>::Bar`, the `DefId`
///   might refer to the trait `Foo`, and the arguments might be
///   `[T]`. The boolean value indicates whether to infer values
///   for arguments whose values were not explicitly provided.
/// - `provided_kind`: given the generic parameter and the value
///   from `args_for_def_id`, creating a `GenericArg`.
/// - `inferred_kind`: if no parameter was provided, and inference
///   is enabled, then creates a suitable inference variable.
// PORT: the `Peekable` iterators over `defs.own_params` and the provided args are an array plus a cursor (`pi`, `ai`);
// `peek()` is `xs[i]`, `next()` is `i++`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs:190 lower_generic_args
export function lower_generic_args(cx: HirTyLowerer, def_id: DefId, parent_args: readonly GenericArg[], has_self: boolean, self_ty: Ty | undefined, arg_count: GenericArgCountResult, ctx: GenericArgsLowerer): GenericArgs {
  const tcx = cx.tcx();
  // Collect the segments of the path; we need to instantiate arguments
  // for parameters throughout the entire path (wherever there are
  // generic parameters).
  let parent_defs = tcx.generics_of(def_id) as Generics;
  const count = parent_defs.count();
  const stack: [DefId, Generics][] = [[def_id, parent_defs]];
  let parent_def_id: DefId | undefined;
  while ((parent_def_id = parent_defs.parent) !== undefined) {
    parent_defs = tcx.generics_of(parent_def_id) as Generics;
    stack.push([parent_def_id, parent_defs]);
  }

  // We manually build up the generic arguments, rather than using convenience
  // methods in `rustc_middle/src/ty/generic_args.rs`, so that we can iterate over the arguments and
  // parameters in lock-step linearly, instead of trying to match each pair.
  // PORT: `SmallVec::with_capacity(count)`: capacities are dropped.
  const args: GenericArg[] = [];
  // Iterate over each segment of the path.
  let popped: [DefId, Generics] | undefined;
  while ((popped = stack.pop()) !== undefined) {
    const [def_id, defs] = popped;
    const params = defs.own_params;
    let pi = 0;

    // If we have already computed the generic arguments for parents,
    // we can use those directly.
    while (pi < params.length) {
      const param = params[pi]!;
      const kind = parent_args[param.index];
      if (kind !== undefined) {
        args.push(kind);
        pi++;
      } else {
        break;
      }
    }

    // `Self` is handled first, unless it's been handled in `parent_args`.
    if (has_self) {
      const param = params[pi];
      if (param !== undefined) {
        if (param.index === 0) {
          if (param.kind.$ === "Type") {
            assert_eq<readonly GenericArg[]>(args, [], (v) => debug_vec(v, PLAIN, debug_GenericArg), (a, b) => a.length === b.length);
            args.push(self_ty !== undefined ? TyGenericArg.from_Ty(self_ty) : ctx.inferred_kind(args, param, true));
            pi++;
          }
        }
      }
    }

    // Check whether this segment takes generic arguments and the user has provided any.
    const [generic_args, infer_args] = ctx.args_for_def_id(def_id);

    const args_iter: readonly hir.GenericArg[] = generic_args !== undefined ? generic_args.args : [];
    let ai = 0;

    // If we encounter a type or const when we expect a lifetime, we infer the lifetimes.
    // If we later encounter a lifetime, we know that the arguments were provided in the
    // wrong order. `force_infer_lt` records the type or const that forced lifetimes to be
    // inferred, so we can use it for diagnostics later.
    let force_infer_lt: [hir.GenericArg, GenericParamDef] | undefined = undefined;

    for (;;) {
      // We're going to iterate through the generic arguments that the user
      // provided, matching them with the generic parameters we expect.
      // Mismatches can occur as a result of elided lifetimes, or for malformed
      // input. We try to handle both sensibly.
      const arg = args_iter[ai];
      const param = params[pi];
      if (arg !== undefined && param !== undefined) {
        if (
          (arg.$ === "Lifetime" && param.kind.$ === "Lifetime") ||
          ((arg.$ === "Type" || (arg.$ === "Infer" && arg._0.kind === "TypeOrConst")) && param.kind.$ === "Type") ||
          ((arg.$ === "Const" || arg.$ === "Infer") && param.kind.$ === "Const")
        ) {
          // We lower to an infer even when the feature gate is not enabled
          // as it is useful for diagnostics to be able to see a `ConstKind::Infer`
          args.push(ctx.provided_kind(args, param, arg));
          ai++;
          pi++;
        } else if ((arg.$ === "Infer" || arg.$ === "Type" || arg.$ === "Const") && param.kind.$ === "Lifetime") {
          // We expected a lifetime argument, but got a type or const
          // argument. That means we're inferring the lifetimes.
          args.push(ctx.inferred_kind(args, param, infer_args));
          force_infer_lt = [arg, param];
          pi++;
        } else if (arg.$ === "Lifetime" && arg_count.explicit_late_bound === "Yes") {
          // We've come across a lifetime when we expected something else in
          // the presence of explicit late bounds. This is most likely
          // due to the presence of the explicit bound so we're just going to
          // ignore it.
          ai++;
        } else {
          // We expected one kind of parameter, but the user provided
          // another. This is an error. However, if we already know that
          // the arguments don't match up with the parameters, we won't issue
          // an additional error, as the user already knows what's wrong.
          if (arg_count.correct.$ === "Ok") {
            // We're going to iterate over the parameters to sort them out, and
            // show that order to the user as a possible order for the parameters
            const param_types_present_: [ParamKindOrd, GenericParamDef][] = defs.own_params.map(
              (param): [ParamKindOrd, GenericParamDef] => [GenericParamDefKind.to_ord(param.kind), { ...param }],
            );
            // PORT: `sort_by_key` is a stable sort, as `Array.prototype.sort`.
            param_types_present_.sort((a, b) => ParamKindOrd_discriminant[a[0]] - ParamKindOrd_discriminant[b[0]]);
            const param_types_present: ParamKindOrd[] = param_types_present_.map(([ord]) => ord);
            const ordered_params: GenericParamDef[] = param_types_present_.map(([, p]) => p);
            // param_types_present.dedup();
            const deduped: ParamKindOrd[] = [];
            for (const ord of param_types_present) {
              if (deduped.length === 0 || deduped[deduped.length - 1] !== ord) deduped.push(ord);
            }

            // `!args_iter.clone().is_sorted_by_key(|arg| arg.to_ord())`
            let is_sorted = true;
            for (let i = ai + 1; i < args_iter.length; i++) {
              if (ParamKindOrd_discriminant[hir.GenericArg.to_ord(args_iter[i - 1]!)] > ParamKindOrd_discriminant[hir.GenericArg.to_ord(args_iter[i]!)]) {
                is_sorted = false;
                break;
              }
            }

            generic_arg_mismatch_err(
              cx,
              arg,
              param,
              !is_sorted,
              `reorder the arguments: ${deduped.map((ord) => `${display_ParamKindOrd(ord)}s`).join(", then ")}: \`<${ordered_params
                .flatMap((param) => (param.name === kw.SelfUpper ? [] : [Symbol.as_str(param.name)]))
                .join(", ")}>\``,
            );
          }

          // We've reported the error, but we want to make sure that this
          // problem doesn't bubble down and create additional, irrelevant
          // errors. In this case, we're simply going to ignore the argument
          // and any following arguments. The rest of the parameters will be
          // inferred.
          ai = args_iter.length;
        }
      } else if (arg !== undefined && param === undefined) {
        // We should never be able to reach this point with well-formed input.
        // There are three situations in which we can encounter this issue.
        //
        //  1. The number of arguments is incorrect. In this case, an error
        //     will already have been emitted, and we can ignore it.
        //  2. There are late-bound lifetime parameters present, yet the
        //     lifetime arguments have also been explicitly specified by the
        //     user.
        //  3. We've inferred some lifetimes, which have been provided later (i.e.
        //     after a type or const). We want to throw an error in this case.

        if (arg_count.correct.$ === "Ok" && arg_count.explicit_late_bound === "No") {
          const kind = hir.GenericArg.descr(arg);
          assert_eq(kind, "lifetime", debug_str);
          const [provided_arg, param] = unwrap(force_infer_lt, "lifetimes ought to have been inferred");
          generic_arg_mismatch_err(cx, provided_arg, param, false, undefined);
        }

        break;
      } else if (arg === undefined && param !== undefined) {
        // If there are fewer arguments than parameters, it means
        // we're inferring the remaining arguments.
        args.push(ctx.inferred_kind(args, param, infer_args));
        pi++;
      } else {
        break;
      }
    }
  }

  return tcx.mk_args(args);
}

/// Checks that the correct number of generic arguments have been provided.
/// Used specifically for function calls.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs:405 check_generic_arg_count_for_value_path
export function check_generic_arg_count_for_value_path(cx: HirTyLowerer, def_id: DefId, generics: Generics, seg: hir.PathSegment, is_method_call: IsMethodCall): GenericArgCountResult {
  const gen_pos: GenericArgPosition = { $: "Value", _0: is_method_call };
  return check_generic_arg_count(cx, def_id, seg, generics, gen_pos, generics.has_own_self());
}

/// Checks that the correct number of generic arguments have been provided.
/// This is used both for datatypes and function calls.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs:419 check_generic_arg_count
export function check_generic_arg_count(cx: HirTyLowerer, def_id: DefId, seg: hir.PathSegment, gen_params: Generics, gen_pos: GenericArgPosition, has_self: boolean): GenericArgCountResult {
  const gen_args = seg.args_();
  const default_counts = gen_params.own_defaults();
  const param_counts = gen_params.own_counts();
  // If we have any `Vec<foo: Bar>` constraint, where `Bar` is unresolved, the user likely meant
  // to write `Vec<foo::Bar>`, so we silence the incorrect number of generics error.
  let has_invalid_bound: boolean;
  if (seg.args !== undefined) {
    has_invalid_bound = seg.args.constraints.some((c) => {
      if (c.kind.$ === "Bound" && c.kind.bounds.length === 1 && c.kind.bounds[0]!.$ === "Trait" && c.kind.bounds[0]!._0.trait_ref.path.res.$ === "Err") {
        return true;
      } else {
        return false;
      }
    });
  } else {
    has_invalid_bound = false;
  }

  // Subtracting from param count to ensure type params synthesized from `impl Trait`
  // cannot be explicitly specified.
  const synth_type_param_count = gen_params.own_params.filter((param) => param.kind.$ === "Type" && param.kind.synthetic === true).length;
  const named_type_param_count = param_counts.types - (has_self ? 1 : 0) - synth_type_param_count;
  const named_const_param_count = param_counts.consts;
  const infer_lifetimes = (gen_pos.$ !== "Type" || seg.infer_args) && !gen_args.has_lifetime_args();

  if (gen_pos.$ !== "Type") {
    const c = gen_args.constraints[0];
    if (c !== undefined) {
      prohibit_assoc_item_constraint(cx, c, undefined);
    }
  }

  const tcx = cx.tcx();

  // Suppress this warning for delegations as it is compiler generated and lifetimes are
  // propagated while late-bound lifetimes may be present.
  const explicit_late_bound: ExplicitLateBound = seg.delegation_child_segment
    ? "No"
    : prohibit_explicit_late_bound_lifetimes(cx, gen_params, gen_args, gen_pos);

  const invalid_args: number[] = [];

  const check_lifetime_args = (min_expected_args: number, max_expected_args: number, provided_args: number, late_bounds_ignore: boolean): Result<null, ErrorGuaranteed> => {
    if (min_expected_args <= provided_args && provided_args <= max_expected_args) {
      return Ok(null);
    }

    if (late_bounds_ignore) {
      return Ok(null);
    }

    for (let i = min_expected_args; i < provided_args; i++) invalid_args.push(i);

    // PORT: `GenericArgsInfo::{ExcessLifetimes, MissingLifetimes}` and `WrongNumberOfGenericArgs::new` live in
    // diagnostics/wrong_number_of_generic_args.rs, which no lane has ported yet: the
    // `let gen_args_info = ..; let reported = cx.dcx().emit_err(WrongNumberOfGenericArgs::new(..)); Err(reported)` tail
    // stops here.
    return unported("rustc_hir_analysis::diagnostics::wrong_number_of_generic_args::WrongNumberOfGenericArgs::new (E0107, lifetimes)");
  };

  const min_expected_lifetime_args = infer_lifetimes ? 0 : param_counts.lifetimes;
  const max_expected_lifetime_args = param_counts.lifetimes;
  const num_provided_lifetime_args = gen_args.num_lifetime_args();

  const lifetimes_correct = check_lifetime_args(
    min_expected_lifetime_args,
    max_expected_lifetime_args,
    num_provided_lifetime_args,
    explicit_late_bound === "Yes",
  );

  const check_types_and_consts = (
    expected_min: number,
    expected_max: number,
    expected_max_with_synth: number,
    provided: number,
    params_offset: number,
    args_offset: number,
  ): Result<null, ErrorGuaranteed> => {
    // debug!(?expected_min, ?expected_max, ?provided, ?params_offset, ?args_offset, "check_types_and_consts");
    if (expected_min <= provided && provided <= expected_max) {
      return Ok(null);
    }

    const num_default_params = expected_max - expected_min;

    let all_params_are_binded = false;
    if (provided > expected_max) {
      for (let i = expected_max; i < provided; i++) invalid_args.push(i + args_offset);
      const num_redundant_args = provided - expected_max;

      // Provide extra note if synthetic arguments like `impl Trait` are specified.
      const synth_provided = provided <= expected_max_with_synth;

      // PORT: `GenericArgsInfo::ExcessTypesOrConsts { num_redundant_args, num_default_params, args_offset, synth_provided }`
      // (diagnostics/wrong_number_of_generic_args.rs, unported; see below).
    } else {
      // Check if associated type bounds are incorrectly written in impl block header like:
      // ```
      // trait Foo<T> {}
      // impl Foo<T: Default> for u8 {}
      // ```
      const first = cx.tcx().hir_parent_owner_iter(seg.hir_id).next();
      const parent_is_impl_block = first !== undefined && hir.OwnerNode.is_impl_block(first[1]);
      if (parent_is_impl_block) {
        const constraint_names: Symbol[] = gen_args.constraints.map((b) => b.ident.name);
        const param_names: Symbol[] = gen_params.own_params
          .filter((param) => !has_self || param.index !== 0) // Assumes `Self` will always be the first parameter
          .map((param) => param.name);
        if (constraint_names.length === param_names.length && constraint_names.every((n, i) => n === param_names[i])) {
          let has_assoc_ty_with_same_name: boolean;
          if (tcx.def_kind(def_id).$ === "Trait") {
            has_assoc_ty_with_same_name = gen_args.constraints.some((constraint) => {
              for (const trait_did of supertrait_def_ids(tcx, def_id)) {
                if (cx.probe_trait_that_defines_assoc_item(trait_did, "Type", constraint.ident)) return true;
              }
              return false;
            });
          } else {
            has_assoc_ty_with_same_name = false;
          }
          // We set this to true and delay emitting `WrongNumberOfGenericArgs`
          // to provide a succinct error for cases like issue #113073,
          // but only if when we don't have any assoc type with the same name with a
          // generic arg. Otherwise it will cause an ICE due to a delayed error because we
          // don't have any error other than `WrongNumberOfGenericArgs`.
          all_params_are_binded = !has_assoc_ty_with_same_name;
        }
      }

      const num_missing_args = expected_max - provided;

      // PORT: `GenericArgsInfo::MissingTypesOrConsts { num_missing_args, num_default_params, args_offset }`
      // (diagnostics/wrong_number_of_generic_args.rs, unported; see below).
    }

    // debug!(?gen_args_info);

    let reported = gen_args.has_err();
    if (reported === undefined) {
      // PORT: `cx.dcx().create_err(WrongNumberOfGenericArgs::new(tcx, gen_args_info, seg, gen_params, params_offset, gen_args,
      // def_id, cx.item_def_id())).emit_err_unless_delay(all_params_are_binded || has_invalid_bound)`:
      // diagnostics/wrong_number_of_generic_args.rs is unported.
      reported = unported("rustc_hir_analysis::diagnostics::wrong_number_of_generic_args::WrongNumberOfGenericArgs::new (E0107, types/consts)");
    }

    return Err(reported);
  };

  // `let args_correct = { .. };`
  const expected_min = seg.infer_args ? 0 : param_counts.consts + named_type_param_count - default_counts.types - default_counts.consts;
  // debug!(?expected_min);
  // debug!(arg_counts.lifetimes=?gen_args.num_lifetime_args());

  const provided = gen_args.num_generic_params();

  const args_correct = check_types_and_consts(
    expected_min,
    named_const_param_count + named_type_param_count,
    named_const_param_count + named_type_param_count + synth_type_param_count,
    provided,
    param_counts.lifetimes + (has_self ? 1 : 0),
    gen_args.num_lifetime_args(),
  );

  // `lifetimes_correct.and(args_correct).map_err(|reported| GenericArgCountMismatch { reported, invalid_args })`
  const and = lifetimes_correct.$ === "Err" ? lifetimes_correct : args_correct;
  const correct: Result<null, GenericArgCountMismatch> = and.$ === "Ok" ? Ok(null) : Err({ reported: and._0, invalid_args });
  return {
    explicit_late_bound,
    correct,
  };
}

/// Prohibits explicit lifetime arguments if late-bound lifetime parameters
/// are present. This is used both for datatypes and function calls.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs:662 prohibit_explicit_late_bound_lifetimes
export function prohibit_explicit_late_bound_lifetimes(cx: HirTyLowerer, def: Generics, args: hir.GenericArgs, position: GenericArgPosition): ExplicitLateBound {
  // struct LifetimeArgsIssue { msg: &'static str }
  // impl<'a> Diagnostic<'a> for LifetimeArgsIssue
  const LifetimeArgsIssue = (msg: string): Diagnostic => ({
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/generics.rs:673 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      return Diag.new(dcx, level, msg);
    },
  });

  const param_counts = def.own_counts();

  const span_late = def.has_late_bound_regions;
  if (span_late !== undefined && args.has_lifetime_args()) {
    const msg = "cannot specify lifetime arguments explicitly \
if late bound lifetime parameters are present";
    const note = "the late bound lifetime parameter is introduced here";
    const span = hir.GenericArg.span(args.args[0]!);

    if (position.$ === "Value" && position._0 === "No" && args.num_lifetime_args() !== param_counts.lifetimes) {
      struct_span_code_err(cx.dcx(), span, E0794, msg).with_span_note(span_late, note).emit();
    } else {
      const multispan = MultiSpan.from_span(span);
      multispan.push_span_label(span_late, note);
      cx.tcx().emit_node_span_lint(LATE_BOUND_LIFETIME_ARGUMENTS, hir.GenericArg.hir_id(args.args[0]!), multispan, LifetimeArgsIssue(msg));
    }

    return "Yes";
  } else {
    return "No";
  }
}

