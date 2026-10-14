// Port of compiler/rustc_ast_lowering/src/delegation/generics.rs (lane lower-delegation).
//
// The `impl LoweringContext` / `impl DelegationResolver` methods of this file are declared in ../decls.ts (the
// contract) and assigned onto the prototype here, in upstream order, each with its `// rustc:` marker. The
// helper types' methods are attached to their classes / companions here too.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import {
  type AngleBracketedArgs,
  type Delegation,
  GenericArg as AstGenericArg,
  type PathSegment as AstPathSegment,
} from "../../rustc_ast/lib.ts";
import type { Diagnostic } from "../../rustc_errors/lib.ts";
import { DefKind, debug_DefKind, Res } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { type HirId, HirId_INVALID } from "../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type GenericParamDef, GenericParamDefKind, type Generics as TyGenericsOf } from "../../rustc_middle/ty/generics.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { EarlyBinder } from "../../rustc_type_ir/binder.gen.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Ident, kw, sym, type Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert_matches, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { replace_in_place } from "../../std/mut_ref.ts";
import { slice_from, slice_to } from "../../std/slice.ts";
import { DelegationResolver, LoweringContext } from "../decls.ts";

// ---- Types of this file ----
// PORT(gen): stand-ins for delegation/generics.gen.ts. Codegen set rustc_ast_lowering (root; see
// docs/handoff/lowering-contract.md "For root" 3) is not committed yet; these are the shapes a scratch run of that
// set generates (generics.rs:22..295, Debug fns left to the generator). Replace this block with
// `export * from "./generics.gen.ts"` once it exists (the `interface X` method merges below then become
// `declare module "./generics.gen.ts" { interface X .. }`).

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:22 GenericsPosition
export type GenericsPosition = "Parent" | "Child";
export const GenericsPosition = { Parent: "Parent", Child: "Child" } as const;

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:28 GenericArgSlot
export type GenericArgSlot<T> =
  | { readonly $: "UserSpecified" }
  | { readonly $: "Generate"; _0: T; _1: number | undefined /* Infer arg index from AST */ };
/** Unit variants of `GenericArgSlot`, shared frozen singletons. */
export const GenericArgSlot = {
  UserSpecified: Object.freeze({ $: "UserSpecified" as const }),
};

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:34 DelegationGenerics
export class DelegationGenerics<T> {
  constructor(
    public data: T,
    public pos: GenericsPosition,
    public trait_impl: boolean,
    public has_implicit_self: boolean,
  ) {}
}

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:41 TyGenerics
export type TyGenerics = GenericArgSlot<GenericParamDef>[];

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:70 HirOrTyGenerics
/// Used for storing either ty generics or their uplifted HIR version. First we obtain
/// ty generics. Next, at some point of generics processing we need to uplift those
/// generics to HIR, for this purpose we use `into_hir_generics` that uplifts ty generics
/// and replaces Ty variant with Hir. Such approach is useful as we can call this method
/// at any time knowing that uplifting will occur at most only once. Then, in order to obtain generic
/// params or args we use `hir_generics_or_empty` or `into_generic_args` functions.
/// There also may be situations when we obtained ty generics but never uplifted them to HIR,
/// meaning we did not propagate them and thus we do not need to generate generic params
/// (i.e., method call scenarios), in such a case this approach helps
/// a lot as if `into_hir_generics` will not be called then uplifting will not happen.
export type HirOrTyGenerics =
  | { readonly $: "Ty"; _0: DelegationGenerics<TyGenerics> }
  | { readonly $: "Hir"; _0: DelegationGenerics<hir.Generics> };

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:76 GenericsGenerationResult
export class GenericsGenerationResult {
  constructor(
    public generics: HirOrTyGenerics,
    public args_segment_id: HirId,
    public use_for_sig_inheritance: boolean,
  ) {}
}

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:88 GenericsGenerationResults
export class GenericsGenerationResults {
  constructor(
    public parent: GenericsGenerationResult,
    public child: GenericsGenerationResult,
    public self_ty_propagation_kind: hir.DelegationSelfTyPropagationKind | undefined,
  ) {}
}

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:95 DelegationGenericArgsIterator
export class DelegationGenericArgsIterator {
  constructor(
    public index: number,
    public params: readonly hir.GenericParam[],
    public has_implicit_self: boolean,
  ) {}
}

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:259 ParentSegmentArgs
export type ParentSegmentArgs =
  /// Parent segment is valid and generic args are specified:
  /// `reuse Trait::<'static, ()>::foo;`.
  | { readonly $: "Specified"; _0: AngleBracketedArgs }
  /// Parent segment is valid and args are not specified:
  /// `reuse Trait::foo;`.
  | { readonly $: "NotSpecified" }
  /// Parent segment does not exist (`reuse foo`) or we can not
  /// add generics to it:
  /// ```rust
  /// mod to_reuse {
  ///     fn foo() {}
  /// }
  ///
  /// // Can't add generic args to module.
  /// reuse to_reuse::foo;
  /// ```
  | { readonly $: "Invalid" };
/** Unit variants of `ParentSegmentArgs`, shared frozen singletons. */
export const ParentSegmentArgs = {
  NotSpecified: Object.freeze({ $: "NotSpecified" as const }),
  Invalid: Object.freeze({ $: "Invalid" as const }),
};

// rustc-type: compiler/rustc_ast_lowering/src/delegation/generics.rs:279 GenericsResolution
export interface GenericsResolution {
  trait_impl: boolean;
  parent_args: ParentSegmentArgs;
  child_args: AngleBracketedArgs | undefined;
  sig_parent_params: readonly GenericParamDef[];
  sig_child_params: readonly GenericParamDef[];
  free_to_trait_delegation: boolean;
  /// `reuse Trait::foo;`.
  qself_is_none: boolean;
  /// `reuse <_ as Trait>::foo;`.
  qself_is_infer: boolean;
  /// Whether we should generate `Self` generic param.
  generate_free_to_trait_self: boolean;
}

// ---- PORT(stand-in): upstream APIs this file calls that are not ported yet. Each stops as UNPORTED. ----
/** `AdtDef::did` (rustc_middle ty/adt.rs; `AdtDef` is pending, lane ty-adt-assoc). */
function AdtDef_did(_def: unknown): DefId {
  return unported("rustc_middle::ty::adt::AdtDef::did");
}
/** The `#[derive(Diagnostic)]` builders of ../diagnostics.rs this file uses. PORT(diag): see resolution.ts. */
const diagnostics = {
  DelegationInfersMismatch_diagnostic(_: { span: Span; actual: Symbol; expected: Symbol }): Diagnostic {
    return unported("rustc_ast_lowering::diagnostics::DelegationInfersMismatch (diagnostics.gen.ts)");
  },
  DelegationToInherentImplMustContainParentGenerics_diagnostic(_: { span: Span }): Diagnostic {
    return unported("rustc_ast_lowering::diagnostics::DelegationToInherentImplMustContainParentGenerics (diagnostics.gen.ts)");
  },
  DelegationToInherentImplParentContainsInfer_diagnostic(_: { span: Span }): Diagnostic {
    return unported("rustc_ast_lowering::diagnostics::DelegationToInherentImplParentContainsInfer (diagnostics.gen.ts)");
  },
};

// ---- impl DelegationGenerics<TyGenerics> ----
// PORT: the associated fns `DelegationGenerics::generate_all` and `GenericsGenerationResult::new` (no `self`) are
// module-level fns of this file (`generate_all`, `GenericsGenerationResult_new`): both types are private to the
// delegation module and only this file calls them.
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:44 generate_all
function generate_all(
  params: readonly GenericParamDef[],
  pos: GenericsPosition,
  trait_impl: boolean,
  has_implicit_self: boolean,
): DelegationGenerics<TyGenerics> {
  return new DelegationGenerics<TyGenerics>(
    params.map((p): GenericArgSlot<GenericParamDef> => ({ $: "Generate", _0: p, _1: undefined })),
    pos,
    trait_impl,
    has_implicit_self,
  );
}

// ---- impl GenericsGenerationResult ----
export interface GenericsGenerationResult {
  segment_id_for_sig(): HirId | undefined;
}
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:83 segment_id_for_sig
GenericsGenerationResult.prototype.segment_id_for_sig = function (this: GenericsGenerationResult): HirId | undefined {
  return this.use_for_sig_inheritance ? this.args_segment_id : undefined;
};

// ---- impl DelegationGenericArgsIterator ----
/// During generic args propagation we need to create generic args
/// (and their `HirId`s) on demand, as some of generic args can not be used
/// and in this case an assert of an unseen `HirId` will be triggered. Moreover,
/// when replacing infers with generated generic params we should reuse existing
/// `HirId` of replaced infer, thus this iterator abstracts the way `HirId`s are
/// created for new generic args.
export interface DelegationGenericArgsIterator {
  next(ctx: LoweringContext, hir_id_factory: (this_: LoweringContext) => HirId): hir.GenericArg | undefined;
  consume_all(ctx: LoweringContext): hir.GenericArg[];
}
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:108 next
DelegationGenericArgsIterator.prototype.next = function (
  this: DelegationGenericArgsIterator,
  ctx: LoweringContext,
  hir_id_factory: (this_: LoweringContext) => HirId,
): hir.GenericArg | undefined {
  let p: hir.GenericParam;
  for (;;) {
    if (this.index >= this.params.length) {
      return undefined;
    }

    const p_ = this.params[this.index]!;
    const is_implicit_self = this.has_implicit_self && this.index === 0;
    this.index += 1;

    if (is_implicit_self || p_.is_impl_trait()) {
      continue;
    }

    p = p_;
    break;
  }

  const hir_id = hir_id_factory(ctx);

  switch (p.kind.$) {
    case "Lifetime":
      return {
        $: "Lifetime",
        _0: ctx.arena.alloc(
          new hir.Lifetime(
            hir_id,
            hir.ParamName.ident(p.name),
            { $: "Param", _0: p.def_id },
            { $: "Path", angle_brackets: hir.AngleBrackets.Full },
            hir.LifetimeSyntax.ExplicitBound,
          ),
        ),
      };
    case "Type":
      // PORT: `hir::GenericArg::Type(&Ty<AmbigArg>)`: the `Unambig` parameter is erased (hir-types decision 1).
      return { $: "Type", _0: ctx.arena.alloc(new hir.Ty(hir_id, p.span, { $: "Path", _0: ctx.create_generic_arg_path(p) })) as hir.Ty<never> };
    case "Const":
      return {
        $: "Const",
        _0: ctx.arena.alloc(new hir.ConstArg(hir_id, { $: "Path", _0: ctx.create_generic_arg_path(p) }, p.span)) as hir.ConstArg<never>,
      };
  }
};

// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:156 consume_all
DelegationGenericArgsIterator.prototype.consume_all = function (this: DelegationGenericArgsIterator, ctx: LoweringContext): hir.GenericArg[] {
  const args: hir.GenericArg[] = [];

  let arg: hir.GenericArg | undefined;
  while ((arg = this.next(ctx, (ctx) => ctx.next_id())) !== undefined) {
    args.push(arg);
  }

  return args;
};

// ---- impl HirOrTyGenerics ----
// PORT: methods of the data enum live on its companion (PORTING §8). `&mut self` that reassigns `*self`
// replaces the variant object in place (`replace_in_place`, std/mut_ref.ts).
export const HirOrTyGenerics = {
  // rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:171 into_hir_generics
  into_hir_generics(self: HirOrTyGenerics, ctx: LoweringContext, span: Span): void {
    if (self.$ === "Ty") {
      const ty = self._0;
      const rename_self = ty.pos === GenericsPosition.Child;
      const params = ctx.uplift_delegation_generic_params(span, ty.data, rename_self);

      replace_in_place<HirOrTyGenerics>(self, {
        $: "Hir",
        _0: new DelegationGenerics(params, ty.pos, ty.trait_impl, ty.has_implicit_self),
      });
    }
  },

  // rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:185 hir_generics_or_empty
  hir_generics_or_empty(self: HirOrTyGenerics): hir.Generics {
    switch (self.$) {
      case "Ty":
        return hir.Generics.empty();
      case "Hir":
        return self._0.data;
    }
  },

  // rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:192 create_args_iterator
  create_args_iterator(self: HirOrTyGenerics): DelegationGenericArgsIterator {
    switch (self.$) {
      case "Ty":
        return bug("attempting to get generic args before uplifting to HIR");
      case "Hir":
        // `index: usize = Default::default()`
        return new DelegationGenericArgsIterator(0, self._0.data.params, self._0.has_implicit_self);
    }
  },

  // rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:205 infer_indices
  infer_indices(self: HirOrTyGenerics): Set<number> {
    switch (self.$) {
      case "Ty": {
        // PORT: `FxHashSet<usize>`, only queried with `contains`.
        const out = new Set<number>();
        for (const slot of self._0.data) {
          if (slot.$ === "Generate" && slot._1 !== undefined) out.add(slot._1);
        }
        return out;
      }
      case "Hir":
        return bug("accessed infer indices on uplifted generics");
    }
  },

  // rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:219 is_trait_impl
  is_trait_impl(self: HirOrTyGenerics): boolean {
    switch (self.$) {
      case "Ty":
        return self._0.trait_impl;
      case "Hir":
        return self._0.trait_impl;
    }
  },

  // rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:226 find_self_param
  find_self_param(self: HirOrTyGenerics): hir.GenericParam {
    switch (self.$) {
      case "Ty":
        return bug("accessed ty-level generics while searching for uplifted `Self` param");
      case "Hir":
        return unwrap(
          self._0.data.params.find((p) => hir.ParamName.ident(p.name).name === kw.SelfUpper),
          "`Self` generic param is not found while expected",
        );
    }
  },

  // rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:240 pos
  pos(self: HirOrTyGenerics): GenericsPosition {
    switch (self.$) {
      case "Ty":
        return self._0.pos;
      case "Hir":
        return self._0.pos;
    }
  },
};

// ---- impl GenericsGenerationResult ----
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:249 new
function GenericsGenerationResult_new(generics: DelegationGenerics<TyGenerics>): GenericsGenerationResult {
  return new GenericsGenerationResult({ $: "Ty", _0: generics }, HirId_INVALID, false);
}

// ---- impl DelegationResolver (generics.rs) ----
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:298 resolve_generics
DelegationResolver.prototype.resolve_generics = function (
  this: DelegationResolver,
  delegation: Delegation,
  sig_id: DefId,
): Result<GenericsResolution, ErrorGuaranteed> {
  const tcx = this.tcx();
  const delegation_parent_kind = tcx.def_kind(tcx.local_parent(this.owner_id()));

  const delegation_in_free_ctx = !(delegation_parent_kind.$ === "Trait" || delegation_parent_kind.$ === "Impl");

  const sig_in_trait = tcx.def_kind(tcx.parent(sig_id)).$ === "Trait";
  const free_to_trait_delegation = delegation_in_free_ctx && sig_in_trait;

  let sig_parent_params: readonly GenericParamDef[] = [];

  const qself_is_infer = delegation.qself !== undefined && delegation.qself.ty.is_maybe_parenthesised_infer();

  const qself_is_none = delegation.qself === undefined;

  let parent_args: ParentSegmentArgs;
  const segments = delegation.path.segments;
  if (segments.length >= 2) {
    const parent_segment = segments[segments.length - 2]!;
    const res_ = this.get_resolution_id(parent_segment.id);
    if (res_.$ === "Err") return res_;
    const res = res_._0;
    if (!(tcx.def_kind(res).$ === "Mod")) {
      const k = tcx.def_kind(res);
      assert_matches(k, k.$ === "Trait" || k.$ === "Struct" || k.$ === "Enum", "DefKind::Trait | DefKind::Struct | DefKind::Enum", (v) => debug_DefKind(v, PLAIN));

      // PORT: the `generics_of` query value is `unknown` in queries.gen.ts (`&'tcx ty::Generics`).
      sig_parent_params = (tcx.generics_of(res) as TyGenericsOf).own_params;
      const args = this.get_user_args(parent_segment);
      parent_args = args !== undefined ? { $: "Specified", _0: args } : ParentSegmentArgs.NotSpecified;
    } else {
      parent_args = ParentSegmentArgs.Invalid;
    }
  } else {
    parent_args = ParentSegmentArgs.Invalid;
  }

  return Ok({
    parent_args,
    sig_parent_params,
    qself_is_none,
    qself_is_infer,
    free_to_trait_delegation,
    generate_free_to_trait_self: free_to_trait_delegation && (qself_is_none || qself_is_infer),
    trait_impl: delegation_parent_kind.$ === "Impl" && delegation_parent_kind.of_trait === true,
    sig_child_params: (tcx.generics_of(sig_id) as TyGenericsOf).own_params,
    child_args: this.get_user_args(unwrap(segments[segments.length - 1], "must be at least one segment")),
  });
};

// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:354 get_user_args
DelegationResolver.prototype.get_user_args = function (this: DelegationResolver, segment: AstPathSegment): AngleBracketedArgs | undefined {
  const args_ = segment.args;
  if (args_ === undefined) return undefined;
  if (args_.$ !== "AngleBracketed") {
    this.tcx().dcx().span_delayed_bug(segment.span(), "expected angle-bracketed generic args in delegation segment");

    return undefined;
  }
  const args = args_._0;

  // Treat empty args `reuse foo::<> as bar` as `reuse foo as bar`,
  // the same logic applied when we call function `fn f<T>(t: T)`
  // like that `f::<>(())`, in HIR no `<>` will be generated.
  return args.args.length !== 0 ? args : undefined;
};

// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:371 resolve_and_generate_generics
DelegationResolver.prototype.resolve_and_generate_generics = function (
  this: DelegationResolver,
  delegation: Delegation,
  sig_id: DefId,
  span: Span,
): Result<GenericsGenerationResults, ErrorGuaranteed> {
  const res_ = this.resolve_generics(delegation, sig_id);
  if (res_.$ === "Err") return res_;
  const res = res_._0;
  const { trait_impl, generate_free_to_trait_self, sig_child_params, sig_parent_params } = res;

  // If we are in trait impl always generate function whose generics matches
  // those that are defined in trait.
  if (trait_impl) {
    // Considering parent generics, during signature inheritance
    // we will take those args that are in trait impl header trait ref.
    const parent_ = new DelegationGenerics<TyGenerics>([], GenericsPosition.Child, true, false);

    const parent = GenericsGenerationResult_new(parent_);

    const child_ = generate_all(sig_child_params, GenericsPosition.Child, true, false);

    const child = GenericsGenerationResult_new(child_);

    return Ok(new GenericsGenerationResults(parent, child, undefined));
  }

  const check = this.check_delegation_to_inherent_impl(res.parent_args, sig_id, span);
  if (check.$ === "Err") return check;

  const tcx = this.tcx();

  // If parent is inherent impl then there is no `Self` param to skip, so add additional check.
  const skip_self = !generate_free_to_trait_self && tcx.def_kind(tcx.parent(sig_id)).$ === "Trait";

  let parent_generics: DelegationGenerics<TyGenerics>;
  switch (res.parent_args.$) {
    case "Specified":
      parent_generics = new DelegationGenerics(
        DelegationResolver.create_slots_from_args(tcx, res.parent_args._0, slice_from(sig_parent_params, skip_self ? 1 : 0), generate_free_to_trait_self),
        GenericsPosition.Parent,
        trait_impl,
        generate_free_to_trait_self,
      );
      break;
    case "NotSpecified":
      parent_generics = generate_all(slice_from(sig_parent_params, skip_self ? 1 : 0), GenericsPosition.Parent, trait_impl, generate_free_to_trait_self);
      break;
    case "Invalid":
      parent_generics = new DelegationGenerics<TyGenerics>([], GenericsPosition.Parent, trait_impl, false);
      break;
  }

  let child_generics: DelegationGenerics<TyGenerics>;
  if (res.child_args !== undefined) {
    const args = res.child_args;
    const pos = sig_child_params.findIndex((p) => GenericParamDefKind.is_synthetic(p.kind));
    const synth_params_index = pos !== -1 ? pos : sig_child_params.length;

    const slots = DelegationResolver.create_slots_from_args(tcx, args, slice_to(sig_child_params, synth_params_index), trait_impl);

    for (const synth_param of slice_from(sig_child_params, synth_params_index)) {
      slots.push({ $: "Generate", _0: synth_param, _1: undefined });
    }

    child_generics = new DelegationGenerics(slots, GenericsPosition.Child, trait_impl, false);
  } else {
    child_generics = generate_all(sig_child_params, GenericsPosition.Child, trait_impl, false);
  }

  return Ok(
    new GenericsGenerationResults(
      GenericsGenerationResult_new(parent_generics),
      GenericsGenerationResult_new(child_generics),
      // match res.free_to_trait_delegation { true => Some(match res.qself_is_none { .. }), false => None }
      res.free_to_trait_delegation
        ? res.qself_is_none
          ? hir.DelegationSelfTyPropagationKind.SelfParam
          : res.qself_is_infer
            ? hir.DelegationSelfTyPropagationKind.SelfParam
            : // HirId is filled during generic args propagation.
              { $: "SelfTy", _0: HirId_INVALID }
        : undefined,
    ),
  );
};

// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:494 check_delegation_to_inherent_impl
DelegationResolver.prototype.check_delegation_to_inherent_impl = function (
  this: DelegationResolver,
  parent_args: ParentSegmentArgs,
  sig_id: DefId,
  span: Span,
): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx();

  const pk = tcx.def_kind(tcx.parent(sig_id));
  if (!(tcx.def_kind(sig_id).$ === "AssocFn" && pk.$ === "Impl" && pk.of_trait === false)) {
    return Ok(undefined);
  }

  // PORT: the `type_of` query value is `unknown` in queries.gen.ts (`EarlyBinder<'tcx, Ty<'tcx>>`);
  // `EarlyBinder::skip_binder` (binder.rs) is `self.value`.
  const kind = (tcx.type_of(tcx.parent(sig_id)) as EarlyBinder<Ty>).value.kind();
  if (kind.$ !== "Adt") {
    return unreachable("internal error: entered unreachable code: parent of inherent function can be only struct or enum");
  }
  const def = kind._0;

  switch (parent_args.$) {
    case "Invalid":
      return unreachable();
    case "Specified": {
      const args = parent_args._0;
      // `bool::ok_or_else`
      return args.args.every((arg) => {
        if (arg.$ !== "Arg") return false;
        return !AstGenericArg.is_maybe_parenthesised_infer(arg._0);
      })
        ? Ok(undefined)
        : Err(this.tcx().dcx().emit_err(diagnostics.DelegationToInherentImplParentContainsInfer_diagnostic({ span })));
    }
    case "NotSpecified":
      switch ((tcx.generics_of(AdtDef_did(def)) as TyGenericsOf).own_params.length) {
        case 0:
          return Ok(undefined);
        default:
          return Err(this.tcx().dcx().emit_err(diagnostics.DelegationToInherentImplMustContainParentGenerics_diagnostic({ span })));
      }
  }
};

/// Generates generic argument slots for user-specified `args` and
/// generic `params` of the signature function. This function checks whether
/// there are infers (`kw::UnderscoreLifetime` or `kw::Underscore`) in
/// user-specified args, and if so we add `Generate` slot meaning we have to
/// generate generic param for delegation and propagate it instead of this infer.
/// We zip over user-specified args and signature generic params, so if there are more
/// infers than generic params then we will not process all infers thus not generating
/// more generic params then needed (anyway it is an error).
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:542 create_slots_from_args
DelegationResolver.create_slots_from_args = function (
  tcx: TyCtxt,
  args: AngleBracketedArgs,
  params_: readonly GenericParamDef[],
  add_first_self: boolean,
): TyGenerics {
  const slots: TyGenerics = [];
  if (add_first_self) {
    const p0 = params_[0] ?? panic(`index out of bounds: the len is ${params_.length} but the index is 0`);
    slots.push({ $: "Generate", _0: p0, _1: undefined });
  }

  const params = slice_from(params_, add_first_self ? 1 : 0);
  const n = Math.min(args.args.length, params.length);
  for (let idx = 0; idx < n; idx++) {
    const arg_ = args.args[idx]!;
    const param = params[idx]!;
    if (arg_.$ !== "Arg") continue;
    const arg = arg_._0;
    const is_infer = AstGenericArg.is_maybe_parenthesised_infer(arg);

    // If `'_` is used instead of `_` (or vice versa) we emit a meaningful
    // error instead of processing this infer or leaving it as is for signature
    // inheritance.
    if (
      is_infer &&
      ((arg.$ === "Lifetime" && (param.kind.$ === "Type" || param.kind.$ === "Const")) ||
        ((arg.$ === "Type" || arg.$ === "Const") && param.kind.$ === "Lifetime"))
    ) {
      const [actual, expected] = arg.$ === "Lifetime" ? [kw.UnderscoreLifetime, kw.Underscore] : [kw.Underscore, kw.UnderscoreLifetime];

      tcx.dcx().emit_err(diagnostics.DelegationInfersMismatch_diagnostic({ span: AstGenericArg.span(arg), actual, expected }));
    }

    switch (is_infer) {
      case true:
        slots.push({ $: "Generate", _0: param, _1: idx });
        break;
      case false:
        slots.push(GenericArgSlot.UserSpecified);
        break;
    }
  }

  return slots;
};

// ---- impl GenericsGenerationResults ----
export interface GenericsGenerationResults {
  all_params(): Iterable<hir.GenericParam>;
  all_predicates(): Iterable<hir.WherePredicate>;
}
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:593 all_params
GenericsGenerationResults.prototype.all_params = function (this: GenericsGenerationResults): Iterable<hir.GenericParam> {
  const parent = HirOrTyGenerics.hir_generics_or_empty(this.parent.generics).params;
  const child = HirOrTyGenerics.hir_generics_or_empty(this.child.generics).params;

  // Order generics, first we have parent and child lifetimes,
  // then parent and child types and consts.
  // `generics_of` in `rustc_hir_analysis` will order them anyway,
  // however we want the order to be consistent in HIR too.
  return [
    ...parent.filter((p) => p.is_lifetime()),
    ...child.filter((p) => p.is_lifetime()),
    ...parent.filter((p) => !p.is_lifetime()),
    ...child.filter((p) => !p.is_lifetime()),
  ].map(hir.clone_GenericParam);
};

/// As we add hack predicates(`'a: 'a`) for all lifetimes (see `uplift_delegation_generic_params`
/// and `generate_lifetime_predicate` functions) we need to add them to delegation generics.
/// Those predicates will not affect resulting predicate inheritance and folding
/// in `rustc_hir_analysis`, as we inherit all predicates from delegation signature.
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:614 all_predicates
GenericsGenerationResults.prototype.all_predicates = function (this: GenericsGenerationResults): Iterable<hir.WherePredicate> {
  return [
    ...HirOrTyGenerics.hir_generics_or_empty(this.parent.generics).predicates,
    ...HirOrTyGenerics.hir_generics_or_empty(this.child.generics).predicates,
  ].map(hir.clone_WherePredicate);
};

// ---- impl LoweringContext (generics.rs) ----
// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:626 uplift_delegation_generic_params
LoweringContext.prototype.uplift_delegation_generic_params = function (
  this: LoweringContext,
  span: Span,
  params_: readonly GenericArgSlot<GenericParamDef>[],
  rename_self: boolean,
): hir.Generics {
  const params = this.arena.alloc_from_iter(
    params_.flatMap((p_): hir.GenericParam[] => {
      if (p_.$ !== "Generate") return [];
      const p = p_._0;

      let def_kind: DefKind;
      switch (p.kind.$) {
        case "Lifetime":
          def_kind = DefKind.LifetimeParam;
          break;
        case "Type":
          def_kind = DefKind.TyParam;
          break;
        case "Const":
          def_kind = DefKind.ConstParam;
          break;
      }

      // Rename Self generic param to This so it is properly propagated.
      // If the user will create a function `fn foo<Self>() {}` with generic
      // param "Self" then it will not be generated in HIR, the same thing
      // applies to traits, `trait Trait<Self> {}` will be represented as
      // `trait Trait {}` in HIR and "unexpected keyword `Self` in generic parameters"
      // error will be emitted.
      // Note that we do not rename `Self` to `This` after non-recursive reuse
      // from Trait, in this case the `Self` should not be propagated
      // (we rely that implicit `Self` generic param of a trait is named "Self")
      // and it is OK to have Self generic param generated during lowering.
      const param_name = rename_self && p.name === kw.SelfUpper ? sym.This : p.name;

      const param_ident = Ident.new(param_name, span);
      const def_name = param_ident.name;
      const node_id = this.next_node_id();

      const def_id = this.create_def(node_id, def_name, def_kind, span);

      let kind: hir.GenericParamKind;
      switch (p.kind.$) {
        case "Lifetime":
          kind = { $: "Lifetime", kind: hir.LifetimeParamKind.Explicit };
          break;
        case "Type":
          kind = { $: "Type", default: undefined, synthetic: p.kind.synthetic };
          break;
        case "Const": {
          const hir_id = this.next_id();
          const kind_: hir.TyKind = { $: "InferDelegation", _0: { $: "DefId", _0: p.def_id } };

          kind = {
            $: "Const",
            ty: this.arena.alloc(new hir.Ty<null>(hir_id, span, kind_)),
            default: undefined,
          };
          break;
        }
      }

      // Important: we don't use `self.next_id()` as we want to execute
      // `lower_node_id` routine so param's id is added to `self.curr_owner.children`.
      const hir_id = this.lower_node_id(node_id);

      return [new hir.GenericParam(hir_id, def_id, { $: "Plain", _0: param_ident }, span, p.pure_wrt_drop, kind, span, hir.GenericParamSource.Generics)];
    }),
  );

  // HACK: for now we generate predicates such that all lifetimes are early bound,
  // we can not not generate early-bound lifetimes, but we can't know which of them
  // are late-bound at this level of compilation.
  const predicates = this.arena.alloc_from_iter(
    params.flatMap((p) => (p.is_lifetime() ? [this.generate_lifetime_predicate(p, span)] : [])),
  );

  return this.arena.alloc(new hir.Generics(params, predicates, false, span, span));
};

// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:711 generate_lifetime_predicate
LoweringContext.prototype.generate_lifetime_predicate = function (this: LoweringContext, p: hir.GenericParam, span: Span): hir.WherePredicate {
  const create_lifetime = (this_: LoweringContext): hir.Lifetime =>
    this_.arena.alloc(
      new hir.Lifetime(
        this_.next_id(),
        hir.ParamName.ident(p.name),
        { $: "Param", _0: p.def_id },
        { $: "Path", angle_brackets: hir.AngleBrackets.Full },
        hir.LifetimeSyntax.ExplicitBound,
      ),
    );

  const hir_id = this.next_id();
  const lifetime = create_lifetime(this);
  const bounds = this.arena.alloc_slice<hir.GenericBound>([{ $: "Outlives", _0: create_lifetime(this) }]);
  return {
    hir_id,
    span,
    kind: this.arena.alloc<hir.WherePredicateKind>({
      $: "RegionPredicate",
      _0: new hir.WhereRegionPredicate(true, lifetime, bounds),
    }),
  };
};

// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:741 create_generic_arg_path
LoweringContext.prototype.create_generic_arg_path = function (this: LoweringContext, p: hir.GenericParam): hir.QPath {
  let kind: DefKind;
  switch (p.kind.$) {
    case "Lifetime":
      kind = DefKind.LifetimeParam;
      break;
    case "Type":
      kind = DefKind.TyParam;
      break;
    case "Const":
      kind = DefKind.ConstParam;
      break;
  }
  const res: Res = { $: "Def", _0: kind, _1: LocalDefId.to_def_id(p.def_id) };

  return this.create_resolved_qpath(res, hir.ParamName.ident(p.name), p.span);
};

// rustc: compiler/rustc_ast_lowering/src/delegation/generics.rs:757 create_resolved_qpath
LoweringContext.prototype.create_resolved_qpath = function (this: LoweringContext, res: Res, ident: Ident, span: Span): hir.QPath {
  return {
    $: "Resolved",
    _0: undefined,
    _1: this.arena.alloc(new hir.Path(span, res, this.arena.alloc_slice([new hir.PathSegment(ident, this.next_id(), res, undefined, false, false)]))),
  };
};
