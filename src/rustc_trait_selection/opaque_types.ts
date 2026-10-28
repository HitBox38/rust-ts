// Port of compiler/rustc_trait_selection/src/opaque_types.rs (lane typeck-gaps).
//
// PORT notes:
// - `NonDefiningUseReason` is a data enum (PORTING §5); `impl From<ErrorGuaranteed>` is `NonDefiningUseReason.from` and the
//   inherent `report` is `NonDefiningUseReason.report` on the companion const. Its derived `Debug` is `debug_NonDefiningUseReason`.
// - `FxIndexMap<GenericArg, Vec<usize>>` is a `Map` keyed by the interned `GenericArg` (insertion-ordered).
// - `std::cell::OnceCell<GenericArgsRef>` is a `GenericArgs | undefined` field.
// - `crate::diagnostics::NonGenericOpaqueTypeParam` (`#[derive(Diagnostic)]`, rustc_trait_selection diagnostics.rs:2085) is
//   generated into diagnostics.gen.ts (set rustc_trait_selection_error_reporting); diagnostics.ts is required lazily.
// Init order: top-level code defines only; other modules' bindings (e.g. regions.ts's extension static
// `OutlivesEnvironment.new`) are read inside function bodies.
import type { OpaqueTyOrigin } from "../rustc_hir/hir.ts";
import type { InferCtxt } from "../rustc_infer/decls.ts";
import { OutlivesEnvironment } from "../rustc_infer/infer/outlives/env.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArg, fold_GenericArgs, GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { GenericParamDefKind, type Generics } from "../rustc_middle/ty/generics.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { type DefiningScopeKind, type ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { debug_ErrorGuaranteed, debug_Span, type ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_regions } from "../rustc_type_ir/fold.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { debug_OpaqueTypeKey, type OpaqueTypeKey, OpaqueTypeKey as OpaqueTypeKeyC } from "../rustc_type_ir/opaque_ty.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { type Debug, debug_int, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { ObligationCtxt } from "./traits/engine.ts";

function diagnostics(): typeof import("./diagnostics.ts") {
  return require("./diagnostics.ts");
}

// rustc-type: compiler/rustc_trait_selection/src/opaque_types.rs:17 NonDefiningUseReason
export type NonDefiningUseReason =
  | { readonly $: "Tainted"; _0: ErrorGuaranteed }
  | { readonly $: "NotAParam"; opaque_type_key: OpaqueTypeKey; param_index: number; span: Span }
  | { readonly $: "DuplicateParam"; opaque_type_key: OpaqueTypeKey; param_indices: number[]; span: Span };

/** `#[derive(Debug)]` */
export const debug_NonDefiningUseReason: Debug<NonDefiningUseReason> = (v, f) => {
  switch (v.$) {
    case "Tainted":
      return debug_tuple(f, "Tainted", [debug_ErrorGuaranteed(v._0, f)]);
    case "NotAParam":
      return debug_struct(f, "NotAParam", [
        ["opaque_type_key", debug_OpaqueTypeKey(v.opaque_type_key, f)],
        ["param_index", debug_int(v.param_index, f)],
        ["span", debug_Span(v.span, f)],
      ]);
    case "DuplicateParam":
      return debug_struct(f, "DuplicateParam", [
        ["opaque_type_key", debug_OpaqueTypeKey(v.opaque_type_key, f)],
        ["param_indices", debug_vec(v.param_indices, f, debug_int)],
        ["span", debug_Span(v.span, f)],
      ]);
  }
};

export const NonDefiningUseReason = {
  // impl From<ErrorGuaranteed> for NonDefiningUseReason<'_>
  // rustc: compiler/rustc_trait_selection/src/opaque_types.rs:23 from
  from(guar: ErrorGuaranteed): NonDefiningUseReason {
    return { $: "Tainted", _0: guar };
  },

  // rustc: compiler/rustc_trait_selection/src/opaque_types.rs:28 report
  report(self: NonDefiningUseReason, infcx: InferCtxt): ErrorGuaranteed {
    const tcx = infcx.tcx;
    switch (self.$) {
      case "Tainted":
        return self._0;
      case "NotAParam": {
        const { opaque_type_key, param_index, span } = self;
        const opaque_generics = tcx.generics_of(LocalDefId.to_def_id(opaque_type_key.def_id)) as Generics;
        const opaque_param = opaque_generics.param_at(param_index, tcx);
        const kind = GenericParamDefKind.descr(opaque_param.kind);
        return infcx.dcx().emit_err(
          diagnostics().NonGenericOpaqueTypeParam_diagnostic({
            arg: opaque_type_key.args[param_index]!,
            kind,
            span,
            param_span: tcx.def_span(opaque_param.def_id),
          }),
        );
      }
      case "DuplicateParam": {
        const { opaque_type_key, param_indices, span } = self;
        const opaque_generics = tcx.generics_of(LocalDefId.to_def_id(opaque_type_key.def_id)) as Generics;
        const descr = GenericParamDefKind.descr(opaque_generics.param_at(param_indices[0]!, tcx).kind);
        const spans: Span[] = param_indices.map((i) => tcx.def_span(opaque_generics.param_at(i, tcx).def_id));
        return infcx
          .dcx()
          .struct_span_err(span, "non-defining opaque type use in defining scope")
          .with_span_note(spans, `${descr} used multiple times`)
          .emit_err();
      }
    }
  },
};

/// Opaque type parameter validity check as documented in the [rustc-dev-guide chapter].
/// With the new solver, uses which fail this check are simply treated as non-defining
/// and we only emit an error if no defining use exists.
///
/// [rustc-dev-guide chapter]:
/// https://rustc-dev-guide.rust-lang.org/opaque-types-region-infer-restrictions.html
// rustc: compiler/rustc_trait_selection/src/opaque_types.rs:66 opaque_type_has_defining_use_args
export function opaque_type_has_defining_use_args(
  infcx: InferCtxt,
  opaque_type_key: OpaqueTypeKey,
  span: Span,
  defining_scope_kind: DefiningScopeKind,
): Result<null, NonDefiningUseReason> {
  const tcx = infcx.tcx;
  const opaque_env = LazyOpaqueTyEnv.new(tcx, opaque_type_key.def_id);
  const seen_params = new Map<GenericArg, number[]>();

  // Avoid duplicate errors in case the opaque has already been malformed in
  // HIR typeck.
  if (defining_scope_kind === "MirBorrowck") {
    const r = TypeVisitableExt.error_reported(
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(infcx.tcx.type_of_opaque_hir_typeck(opaque_type_key.def_id) as EarlyBinder<Ty>)),
      fold_Ty,
    );
    if (r.$ === "Err") return Err(NonDefiningUseReason.from(r._0));
  }

  for (const [i, arg] of OpaqueTypeKeyC.iter_captured_args(opaque_type_key, tcx)) {
    let arg_is_param: boolean;
    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Lifetime": {
        const lt: Region = k._0;
        if (defining_scope_kind === "HirTypeck") {
          continue;
        } else {
          const lk = lt.kind();
          arg_is_param = lk.$ === "ReEarlyParam" || lk.$ === "ReLateParam" || (lt.is_static() && opaque_env.param_equal_static(i));
        }
        break;
      }
      case "Type":
        arg_is_param = k._0.kind().$ === "Param";
        break;
      case "Const":
        arg_is_param = k._0.kind().$ === "Param";
        break;
    }

    if (arg_is_param) {
      // Register if the same lifetime appears multiple times in the generic args.
      // There is an exception when the opaque type *requires* the lifetimes to be equal.
      // See [rustc-dev-guide chapter] § "An exception to uniqueness rule".
      let seen_where = seen_params.get(arg);
      if (seen_where === undefined) {
        seen_where = [];
        seen_params.set(arg, seen_where);
      }
      const prev_i = seen_where[0];
      if (!(prev_i !== undefined && opaque_env.params_equal(i, prev_i))) {
        seen_where.push(i);
      }
    } else {
      // Prevent `fn foo() -> Foo<u32>` from being defining.
      const r = opaque_env.param_is_error(i);
      if (r.$ === "Err") return Err(NonDefiningUseReason.from(r._0));
      return Err({ $: "NotAParam", opaque_type_key, param_index: i, span });
    }
  }

  for (const [, param_indices] of seen_params) {
    if (param_indices.length > 1) {
      return Err({ $: "DuplicateParam", opaque_type_key, param_indices, span });
    }
  }

  return Ok(null);
}

/// Computes if an opaque type requires a lifetime parameter to be equal to
/// another one or to the `'static` lifetime.
/// These requirements are derived from the explicit and implied bounds.
// rustc-type: compiler/rustc_trait_selection/src/opaque_types.rs:131 LazyOpaqueTyEnv
class LazyOpaqueTyEnv {
  constructor(
    public tcx: TyCtxt,
    public def_id: LocalDefId,

    /// Equal parameters will have the same name. Computed Lazily.
    /// Example:
    ///     `type Opaque<'a: 'static, 'b: 'c, 'c: 'b> = impl Sized;`
    ///     Identity args: `['a, 'b, 'c]`
    ///     Canonical args: `['static, 'b, 'b]`
    public canonical_args: GenericArgs | undefined,
  ) {}

  // rustc: compiler/rustc_trait_selection/src/opaque_types.rs:144 new
  static new(tcx: TyCtxt, def_id: LocalDefId): LazyOpaqueTyEnv {
    return new LazyOpaqueTyEnv(tcx, def_id, undefined);
  }

  // rustc: compiler/rustc_trait_selection/src/opaque_types.rs:148 param_equal_static
  param_equal_static(param_index: number): boolean {
    return GenericArg.expect_region(this.get_canonical_args()[param_index]!).is_static();
  }

  // rustc: compiler/rustc_trait_selection/src/opaque_types.rs:152 params_equal
  params_equal(param1: number, param2: number): boolean {
    const canonical_args = this.get_canonical_args();
    return canonical_args[param1] === canonical_args[param2];
  }

  // rustc: compiler/rustc_trait_selection/src/opaque_types.rs:157 param_is_error
  param_is_error(param_index: number): Result<null, ErrorGuaranteed> {
    return TypeVisitableExt.error_reported(this.get_canonical_args()[param_index]!, fold_GenericArg);
  }

  // rustc: compiler/rustc_trait_selection/src/opaque_types.rs:161 get_canonical_args
  get_canonical_args(): GenericArgs {
    if (this.canonical_args !== undefined) {
      return this.canonical_args;
    }

    const { tcx, def_id } = this;
    const origin = tcx.local_opaque_ty_origin(def_id) as OpaqueTyOrigin<LocalDefId>;
    let parent: LocalDefId;
    switch (origin.$) {
      case "FnReturn":
      case "AsyncFn":
      case "TyAlias":
        parent = origin.parent;
        break;
    }
    const param_env = tcx.param_env(LocalDefId.to_def_id(parent)) as ParamEnv;
    const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(parent)).extend_to(tcx, LocalDefId.to_def_id(def_id), (param, _) =>
      GenericArg.from_Region(tcx.map_opaque_lifetime_to_parent_lifetime(param.def_id.expect_local())),
    );

    // FIXME(#132279): It feels wrong to use `non_body_analysis` here given that we're
    // in a body here.
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const ocx = ObligationCtxt.new(infcx);

    const r = ocx.assumed_wf_types(param_env, parent);
    let wf_tys: Set<Ty>;
    if (r.$ === "Ok") {
      wf_tys = r._0;
    } else {
      tcx.dcx().span_delayed_bug(tcx.def_span(LocalDefId.to_def_id(def_id)), "error getting implied bounds");
      wf_tys = new Set<Ty>();
    }
    const outlives_env = OutlivesEnvironment.new(infcx, parent, param_env, wf_tys);

    const seen: Region[] = [tcx.lifetimes.re_static];
    const canonical_args = fold_regions(
      tcx,
      args,
      (r1, _) => {
        if (r1.is_error()) {
          return r1;
        }
        const r2 = seen.find((r2) => {
          const free_regions = outlives_env.free_region_map();
          return free_regions.sub_free_regions(tcx, r1, r2) && free_regions.sub_free_regions(tcx, r2, r1);
        });
        if (r2 !== undefined) {
          return r2;
        } else {
          seen.push(r1);
          return r1;
        }
      },
      fold_GenericArgs,
    );
    // `self.canonical_args.set(canonical_args).unwrap()`
    this.canonical_args = canonical_args;
    return canonical_args;
  }
}

// rustc: compiler/rustc_trait_selection/src/opaque_types.rs:213 report_item_does_not_constrain_error
export function report_item_does_not_constrain_error(
  tcx: TyCtxt,
  item_def_id: LocalDefId,
  def_id: LocalDefId,
  non_defining_use: [OpaqueTypeKey, Span] | undefined,
): ErrorGuaranteed {
  const span = tcx.def_ident_span(LocalDefId.to_def_id(item_def_id)) ?? tcx.def_span(LocalDefId.to_def_id(item_def_id));
  const opaque_type_span = tcx.def_span(LocalDefId.to_def_id(def_id));
  const opaque_type_name = tcx.def_path_str(LocalDefId.to_def_id(def_id));

  const err = tcx.dcx().struct_span_err(span, `item does not constrain \`${opaque_type_name}\``);
  err.note("consider removing `#[define_opaque]` or adding an empty `#[define_opaque()]`");
  err.span_note(opaque_type_span, "this opaque type is supposed to be constrained");
  if (non_defining_use !== undefined) {
    const [key, span] = non_defining_use;
    const opaque_ty = Ty.new_opaque(tcx, "No", LocalDefId.to_def_id(key.def_id), key.args);
    err.span_note(span, `this use of \`${display_Ty(opaque_ty)}\` does not have unique universal generic arguments`);
  }
  return err.emit_err();
}

