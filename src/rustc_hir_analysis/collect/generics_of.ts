// Port of compiler/rustc_hir_analysis/src/collect/generics_of.rs (lane collect-a).
//
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, type Level } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { debug_Node } from "../../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import { INVALID_TYPE_PARAM_DEFAULT } from "../../rustc_lint_defs/builtin.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import { DefId_hash_key } from "../../rustc_middle/query/caches.ts";
import { type DefId, debug_DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { kw, sym } from "../../rustc_span/symbol.ts";
import { DebruijnIndex, INNERMOST } from "../../rustc_type_ir/lib.ts";
import type { AnonConstKind } from "../../rustc_type_ir/decls.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { field_mut } from "../../std/mut_ref.ts";
import { assert, panic } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import { ParamDefaultPolicy } from "./generics_of.gen.ts";
import { early_bound_lifetimes_from_generics } from "../collect.ts";

export * from "./generics_of.gen.ts";

// PORT: `#[instrument(level = "debug", skip(tcx), ret)]` and the `debug!` calls (tracing) are dropped.
// rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:17 generics_of
export function generics_of(tcx: TyCtxt, def_id: LocalDefId): Generics {
  // struct GenericParametersForbiddenHere { msg: &'static str }
  interface GenericParametersForbiddenHere {
    msg: string;
  }

  // impl<'a> Diagnostic<'a> for GenericParametersForbiddenHere
  // rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:25 into_diag
  function GenericParametersForbiddenHere_into_diag(self: GenericParametersForbiddenHere, dcx: DiagCtxtHandle, level: Level): Diag {
    const { msg } = self;
    return Diag.new(dcx, level, msg);
  }
  const GenericParametersForbiddenHere_diagnostic = (self: GenericParametersForbiddenHere): Diagnostic => ({
    into_diag: (dcx, level) => GenericParametersForbiddenHere_into_diag(self, dcx, level),
  });

  // For an RPITIT, synthesize generics which are equal to the opaque's generics
  // and parent fn's generics compressed into one list.
  const rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id));
  if (rpitit !== undefined && rpitit.$ === "Trait") {
    const { fn_def_id, opaque_def_id } = rpitit;
    // debug!("RPITIT fn_def_id={fn_def_id:?} opaque_def_id={opaque_def_id:?}");
    const trait_def_id = tcx.parent(fn_def_id);
    const opaque_ty_generics = tcx.generics_of(opaque_def_id) as Generics;
    const opaque_ty_parent_count = opaque_ty_generics.parent_count;
    let own_params = opaque_ty_generics.own_params.map(clone_GenericParamDef);

    const parent_generics = tcx.generics_of(trait_def_id) as Generics;
    const parent_count = parent_generics.parent_count + parent_generics.own_params.length;

    const trait_fn_params = (tcx.generics_of(fn_def_id) as Generics).own_params.map(clone_GenericParamDef);

    for (const param of own_params) {
      param.index = param.index + parent_count + trait_fn_params.length - opaque_ty_parent_count;
    }

    trait_fn_params.push(...own_params);
    own_params = trait_fn_params;

    const param_def_id_to_index = new KeyedMap<DefId, number>(
      DefId_hash_key,
      own_params.map((param) => [param.def_id, param.index] as const),
    );

    return new Generics(
      trait_def_id,
      parent_count,
      own_params,
      param_def_id_to_index,
      opaque_ty_generics.has_self,
      opaque_ty_generics.has_late_bound_regions,
    );
  }

  const hir_id = tcx.local_def_id_to_hir_id(def_id);
  const node = tcx.hir_node(hir_id);

  let parent_def_id: LocalDefId | undefined;
  switch (node.$) {
    case "ImplItem":
    case "TraitItem":
    case "Variant":
    case "Ctor":
    case "Field": {
      const parent_id = tcx.hir_get_parent_item(hir_id);
      parent_def_id = parent_id.def_id;
      break;
    }
    // FIXME(#43408) always enable this once `lazy_normalization` is
    // stable enough and does not need a feature gate anymore.
    case "AnonConst": {
      const parent_did = tcx.local_parent(def_id);
      // debug!(?parent_did);

      let in_param_ty = false;
      for (const [_parent, node] of tcx.hir_parent_iter(hir_id)) {
        const generics = hir.Node.generics(node);
        if (generics !== undefined) {
          const visitor = new AnonConstInParamTyDetector(false, hir_id);

          in_param_ty = visitor.visit_generics(generics).$ === "Break";
          break;
        }
      }

      const kind = tcx.anon_const_kind(def_id) as AnonConstKind;
      let param_id: LocalDefId | undefined;
      if (kind === "MCG") {
        // Stable: anon consts are not able to use any generic parameters...
        parent_def_id = undefined;
      } else if (kind === "RepeatExprCount") {
        // we provide generics to repeat expr counts as a backwards compatibility hack. #76200
        parent_def_id = parent_did;
      } else if (kind === "GCE" && in_param_ty) {
        // Even GCE anon const should not be allowed to use generic parameters as it would be
        // trivially forward declared uses once desugared. E.g. `const N: [u8; ANON::<N>]`.
        //
        // We could potentially mirror the hack done for defaults of generic parameters but
        // this case just doesn't come up much compared to `const N: u32 = ...`. Long term the
        // hack for defaulted parameters should be removed eventually anyway.
        parent_def_id = undefined;
      } else if (kind === "GCE" && (param_id = tcx.hir_opt_const_param_default_param_def_id(hir_id)) !== undefined) {
        // GCE anon consts as a default for a generic parameter should have their provided generics
        // "truncated" up to whatever generic parameter this anon const is within the default of.
        //
        // FIXME(generic_const_exprs): This only handles `const N: usize = /*defid*/` but not type
        // parameter defaults, e.g. `T = Foo</*defid*/>`.
        //
        // If the def_id we are calling generics_of on is an anon ct default i.e:
        //
        // struct Foo<const N: usize = { .. }>;
        //        ^^^       ^          ^^^^^^ def id of this anon const
        //        ^         ^ param_id
        //        ^ parent_def_id
        //
        // then we only want to return generics for params to the left of `N`. If we don't do that we
        // end up with that const looking like: `ty::ConstKind::Alias(def_id, args: [N#0])`.
        //
        // This causes ICEs (#86580) when building the args for Foo in `fn foo() -> Foo { .. }` as
        // we instantiate the defaults with the partially built args when we build the args. Instantiating
        // the `N#0` on the alias const indexes into the empty args we're in the process of building.
        //
        // We fix this by having this function return the parent's generics ourselves and truncating the
        // generics to only include non-forward declared params (with the exception of the `Self` ty)
        //
        // For the above code example that means we want `args: []`
        // For the following struct def we want `args: [N#0]` when generics_of is called on
        // the def id of the `{ N + 1 }` anon const
        // struct Foo<const N: usize, const M: usize = { N + 1 }>;
        //
        // This has some implications for how we get the clauses available to the anon const
        // see `explicit_clauses_of` for more information on this
        const parent_def_id = tcx.local_parent(param_id);
        const generics = tcx.generics_of(parent_def_id) as Generics;
        const param_def_idx = generics.param_def_id_to_index.get(LocalDefId.to_def_id(param_id));
        if (param_def_idx === undefined) return panic("key not found");
        // In the above example this would be .params[..N#0]
        const own_params = generics.params_to(param_def_idx, tcx).map(clone_GenericParamDef);
        const param_def_id_to_index = new KeyedMap<DefId, number>(
          DefId_hash_key,
          own_params.map((param) => [param.def_id, param.index] as const),
        );

        return new Generics(
          // we set the parent of these generics to be our parent's parent so that we
          // dont end up with args: [N, M, N] for the const default on a struct like this:
          // struct Foo<const N: usize, const M: usize = { ... }>;
          generics.parent,
          generics.parent_count,
          own_params,
          param_def_id_to_index,
          generics.has_self,
          generics.has_late_bound_regions,
        );
      } else if (kind === "GCE") {
        parent_def_id = parent_did;
      } else if (kind === "NonTypeSystemAnon" && (() => {
        const p = tcx.parent_hir_node(hir_id);
        return p.$ === "TyPat" || p.$ === "Field";
      })()) {
        // Field defaults are allowed to use generic parameters, e.g. `field: u32 = /*defid: N + 1*/`
        parent_def_id = parent_did;
      } else if (kind === "NonTypeSystemAnon") {
        // Default to no generic parameters for other kinds of anon consts
        parent_def_id = undefined;
      } else {
        // ty::AnonConstKind::NonTypeSystemInline
        return span_bug(
          tcx.def_span(def_id),
          "a DefKind::AnonConst with a HIR parent of hir::Node::AnonConst should never be an AnonConstKind::NonTypeSystemInline",
        );
      }
      break;
    }
    case "ConstBlock":
      parent_def_id = tcx.typeck_root_def_id_local(def_id);
      break;
    case "Expr":
      if (node._0.kind.$ === "Closure") {
        parent_def_id = tcx.typeck_root_def_id_local(def_id);
        break;
      }
      return span_bug(tcx.def_span(def_id), `generics_of: unexpected node kind ${debug_Node(node, PLAIN)}`);
    case "OpaqueTy": {
      const origin = node._0.origin;
      switch (origin.$) {
        case "FnReturn":
        case "AsyncFn": {
          const fn_def_id = origin.parent;
          const in_trait_or_impl = origin.in_trait_or_impl;
          if (in_trait_or_impl !== undefined) {
            assert_matches_def_kind(tcx, fn_def_id, ["AssocFn"]);
          } else {
            assert_matches_def_kind(tcx, fn_def_id, ["AssocFn", "Fn"]);
          }
          parent_def_id = fn_def_id;
          break;
        }
        case "TyAlias": {
          const { parent, in_assoc_ty } = origin;
          if (in_assoc_ty) {
            assert_matches_def_kind(tcx, parent, ["AssocTy"]);
          } else {
            assert_matches_def_kind(tcx, parent, ["TyAlias"]);
          }
          // debug!("generics_of: parent of opaque ty {:?} is {:?}", def_id, parent);
          // Opaque types are always nested within another item, and
          // inherit the generics of the item.
          parent_def_id = parent;
          break;
        }
      }
      break;
    }

    // All of these nodes have no parent from which to inherit generics.
    case "Item":
    case "ForeignItem":
      parent_def_id = undefined;
      break;

    // Params don't really have generics, but we use it when instantiating their value paths.
    // FIXME: Use the HIR parent here similar to `Node::Field`. Blocked on the removal of GCE,
    //        see comment in `type_of.rs` for details (Ctrl+F for `generics_of`).
    case "GenericParam":
      parent_def_id = undefined;
      break;

    case "Synthetic":
      return span_bug(tcx.def_span(def_id), "synthetic HIR should have its `generics_of` explicitly fed");

    case "ConstArg":
    case "Infer":
      if (node.$ === "ConstArg" || node._0.kind === "Const") {
        // These can show up in mGCA when representing "direct" const arguments. The
        // DefCollector cannot know whether an anon const will be represented by an actual HIR
        // Node::AnonConst, or whether it will be represented directly, so it must generate a
        // DefId. If it ends up being direct, this DefId is then attached to the top-level
        // ConstArg, which is what we are seeing here.
        // debug_assert!(tcx.features().gca());
        // Forward to the real parent.
        parent_def_id = tcx.local_parent(def_id);
        break;
      }
      return span_bug(tcx.def_span(def_id), `generics_of: unexpected node kind ${debug_Node(node, PLAIN)}`);

    default:
      return span_bug(tcx.def_span(def_id), `generics_of: unexpected node kind ${debug_Node(node, PLAIN)}`);
  }

  // Add in the self type parameter.
  let opt_self: GenericParamDef | undefined;
  if (node.$ === "Item" && (node._0.kind.$ === "Trait" || node._0.kind.$ === "TraitAlias")) {
    // Something of a hack: We reuse the DefId of the trait for the self type parameter.
    opt_self = {
      index: 0,
      name: kw.SelfUpper,
      def_id: LocalDefId.to_def_id(def_id),
      pure_wrt_drop: false,
      kind: { $: "Type", has_default: false, synthetic: false },
    };
  } else {
    opt_self = undefined;
  }

  const param_default_policy_ = param_default_policy(node);
  const hir_generics = hir.Node.generics(node) ?? hir.Generics.empty();
  const has_self = opt_self !== undefined;
  let parent_has_self = false;
  let own_start = has_self ? 1 : 0;
  let parent_count = 0;
  if (parent_def_id !== undefined) {
    const generics = tcx.generics_of(parent_def_id) as Generics;
    assert(!has_self, "assertion failed: !has_self");
    parent_has_self = generics.has_self;
    const count = generics.count();
    own_start = count;
    parent_count = count;
  }

  const own_params: GenericParamDef[] = [];

  if (opt_self !== undefined) {
    own_params.push(opt_self);
  }

  const early_lifetimes = early_bound_lifetimes_from_generics(tcx, hir_generics);
  let i_ = 0;
  for (const param of early_lifetimes) {
    const i = i_++;
    own_params.push({
      name: hir.ParamName.ident(param.name).name,
      index: own_start + i,
      def_id: LocalDefId.to_def_id(param.def_id),
      pure_wrt_drop: param.pure_wrt_drop,
      kind: { $: "Lifetime" },
    });
  }

  // Now create the real type and const parameters.
  const type_start = own_start - (has_self ? 1 : 0) + own_params.length;
  let i = 0;
  const next_index = (): number => {
    const prev = i;
    i += 1;
    return prev + type_start;
  };

  for (const param of hir_generics.params) {
    const MESSAGE = "defaults for generic parameters are not allowed here";
    let kind: GenericParamDef["kind"];
    const pk = param.kind;
    switch (pk.$) {
      case "Lifetime":
        continue;
      case "Type": {
        const { default: default_, synthetic } = pk;
        if (default_ !== undefined) {
          if (param_default_policy_ === undefined) return panic("no policy for generic param default");
          switch (param_default_policy_) {
            case "Allowed":
              break;
            case "FutureCompatForbidden":
              tcx.emit_node_span_lint(INVALID_TYPE_PARAM_DEFAULT, param.hir_id, param.span, GenericParametersForbiddenHere_diagnostic({ msg: MESSAGE }));
              break;
            case "Forbidden":
              tcx.dcx().span_err(param.span, MESSAGE);
              break;
          }
        }

        kind = { $: "Type", has_default: default_ !== undefined, synthetic };
        break;
      }
      case "Const": {
        const { default: default_ } = pk;
        if (default_ !== undefined) {
          if (param_default_policy_ === undefined) return panic("no policy for generic param default");
          switch (param_default_policy_) {
            case "Allowed":
              break;
            case "FutureCompatForbidden":
            case "Forbidden":
              tcx.dcx().span_err(param.span, MESSAGE);
              break;
          }
        }

        kind = { $: "Const", has_default: default_ !== undefined };
        break;
      }
    }
    own_params.push({
      index: next_index(),
      name: hir.ParamName.ident(param.name).name,
      def_id: LocalDefId.to_def_id(param.def_id),
      pure_wrt_drop: param.pure_wrt_drop,
      kind,
    });
  }

  // provide junk type parameter defs - the only place that
  // cares about anything but the length is instantiation,
  // and we don't do that for closures.
  if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const kind = node._0.kind._0.kind;
    // See `ClosureArgsParts`, `CoroutineArgsParts`, and `CoroutineClosureArgsParts`
    // for info on the usage of each of these fields.
    let len: number;
    switch (kind.$) {
      // The args are: closure_kind, closure_signature, upvars.
      case "Closure":
        len = 3;
        break;
      // The args are: coroutine_kind, resume_ty, yield_ty, return_ty, upvars.
      case "Coroutine":
        len = 5;
        break;
      // The args are: closure_kind, closure_signature_parts, upvars, bound_captures_by_ref.
      case "CoroutineClosure":
        len = 4;
        break;
    }

    for (let n = 0; n < len; n++) {
      own_params.push({
        index: next_index(),
        name: sym.empty, // dummy; exact value doesn't matter
        def_id: LocalDefId.to_def_id(def_id),
        pure_wrt_drop: false,
        kind: { $: "Type", has_default: false, synthetic: false },
      });
    }
  }

  // provide junk type parameter defs for const blocks.
  if (node.$ === "ConstBlock") {
    own_params.push({
      index: next_index(),
      name: sym.const_ty_placeholder,
      def_id: LocalDefId.to_def_id(def_id),
      pure_wrt_drop: false,
      kind: { $: "Type", has_default: false, synthetic: false },
    });
  }

  if (node.$ === "OpaqueTy") {
    assert(own_params.length === 0, "assertion failed: own_params.is_empty()");

    const lifetimes = tcx.opaque_captured_lifetimes(def_id) as readonly [unknown, LocalDefId][];
    // debug!(?lifetimes);

    for (const [_, param] of lifetimes) {
      own_params.push({
        name: tcx.item_name(LocalDefId.to_def_id(param)),
        index: next_index(),
        def_id: LocalDefId.to_def_id(param),
        pure_wrt_drop: false,
        kind: { $: "Lifetime" },
      });
    }
  }

  const param_def_id_to_index = new KeyedMap<DefId, number>(
    DefId_hash_key,
    own_params.map((param) => [param.def_id, param.index] as const),
  );

  return new Generics(
    parent_def_id !== undefined ? LocalDefId.to_def_id(parent_def_id) : undefined,
    parent_count,
    own_params,
    param_def_id_to_index,
    has_self || parent_has_self,
    has_late_bound_regions(tcx, node),
  );
}

// rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:412 param_default_policy
export function param_default_policy(node: hir.Node): ParamDefaultPolicy | undefined {
  switch (node.$) {
    case "Item":
      switch (node._0.kind.$) {
        case "Trait":
        case "TraitAlias":
        case "TyAlias":
        case "Enum":
        case "Struct":
        case "Union":
          return ParamDefaultPolicy.Allowed;
        case "Fn":
        case "Impl":
          return ParamDefaultPolicy.FutureCompatForbidden;
        // Re. GCI, we're not bound by backward compatibility.
        case "Const":
          return ParamDefaultPolicy.Forbidden;
        default:
          return undefined;
      }
    case "TraitItem":
      switch (node._0.kind.$) {
        // Re. GATs and GACs (generic_const_items), we're not bound by backward compatibility.
        case "Const":
        case "Type":
          return ParamDefaultPolicy.Forbidden;
        case "Fn":
          return ParamDefaultPolicy.FutureCompatForbidden;
      }
      break;
    case "ImplItem":
      switch (node._0.kind.$) {
        // Re. GATs and GACs (generic_const_items), we're not bound by backward compatibility.
        case "Const":
        case "Type":
          return ParamDefaultPolicy.Forbidden;
        case "Fn":
          return ParamDefaultPolicy.FutureCompatForbidden;
      }
      break;
    // Generic params are (semantically) invalid on foreign items. Still, for maximum forward
    // compatibility, let's hard-reject defaults on them.
    case "ForeignItem":
      return ParamDefaultPolicy.Forbidden;
    case "OpaqueTy":
      return ParamDefaultPolicy.Allowed;
    default:
      return undefined;
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:446 has_late_bound_regions
export function has_late_bound_regions(tcx: TyCtxt, node: hir.Node): Span | undefined {
  // struct LateBoundRegionsDetector<'tcx> { tcx, outer_index }
  class LateBoundRegionsDetector extends hir.intravisit.Visitor<ControlFlow<Span>> {
    override Result = VisitorResult.ControlFlow<Span>();

    constructor(
      public tcx: TyCtxt,
      public outer_index: DebruijnIndex,
    ) {
      super();
    }

    // rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:454 visit_ty
    override visit_ty(ty: hir.Ty<hir.AmbigArg>): ControlFlow<Span> {
      switch (ty.kind.$) {
        case "FnPtr": {
          DebruijnIndex.shift_in(field_mut(this, "outer_index"), 1);
          const res = hir.intravisit.walk_ty(this, ty);
          DebruijnIndex.shift_out(field_mut(this, "outer_index"), 1);
          return res;
        }
        case "UnsafeBinder": {
          DebruijnIndex.shift_in(field_mut(this, "outer_index"), 1);
          const res = hir.intravisit.walk_ty(this, ty);
          DebruijnIndex.shift_out(field_mut(this, "outer_index"), 1);
          return res;
        }
        default:
          return hir.intravisit.walk_ty(this, ty);
      }
    }

    // rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:472 visit_poly_trait_ref
    override visit_poly_trait_ref(tr: hir.PolyTraitRef): ControlFlow<Span> {
      DebruijnIndex.shift_in(field_mut(this, "outer_index"), 1);
      const res = hir.intravisit.walk_poly_trait_ref(this, tr);
      DebruijnIndex.shift_out(field_mut(this, "outer_index"), 1);
      return res;
    }

    // rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:479 visit_lifetime
    override visit_lifetime(lt: hir.Lifetime): ControlFlow<Span> {
      // PORT: `rbv::ResolvedArg` is pending (rustc_middle middle/resolve_bound_vars.rs, lane collect-rbv): its
      // variants are matched by tag, `LateBound(debruijn, _, _)`'s index is `_0`.
      const r = this.tcx.named_bound_var(lt.hir_id);
      if (r !== undefined && (r.$ === "StaticLifetime" || r.$ === "EarlyBound")) {
        return ControlFlow.CONTINUE;
      } else if (r !== undefined && r.$ === "LateBound" && (r._0 as DebruijnIndex) < this.outer_index) {
        return ControlFlow.CONTINUE;
      } else {
        // Some(LateBound(..) | Free(..) | Error(_)) | None
        return ControlFlow.Break(lt.ident.span);
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:499 has_late_bound_regions
  function has_late_bound_regions(tcx: TyCtxt, generics: hir.Generics, decl: hir.FnDecl): Span | undefined {
    const visitor = new LateBoundRegionsDetector(tcx, INNERMOST);
    for (const param of generics.params) {
      if (param.kind.$ === "Lifetime") {
        if (tcx.is_late_bound(param.hir_id)) {
          return param.span;
        }
      }
    }
    const r = visitor.visit_fn_decl(decl);
    return r.$ === "Break" ? r._0 : undefined;
  }

  const decl = hir.Node.fn_decl(node);
  if (decl === undefined) return undefined;
  const generics = hir.Node.generics(node);
  if (generics === undefined) return undefined;
  return has_late_bound_regions(tcx, generics, decl);
}

// rustc-type: compiler/rustc_hir_analysis/src/collect/generics_of.rs:520 AnonConstInParamTyDetector
export class AnonConstInParamTyDetector extends hir.intravisit.Visitor<ControlFlow<null>> {
  override Result = VisitorResult.ControlFlow<null>();

  constructor(
    public in_param_ty: boolean,
    public ct: HirId,
  ) {
    super();
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:528 visit_generic_param
  override visit_generic_param(p: hir.GenericParam): ControlFlow<null> {
    if (p.kind.$ === "Const") {
      const ty = p.kind.ty;
      const prev = this.in_param_ty;
      this.in_param_ty = true;
      const res = this.visit_ty_unambig(ty);
      this.in_param_ty = prev;
      return res;
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/generics_of.rs:540 visit_anon_const
  override visit_anon_const(c: hir.AnonConst): ControlFlow<null> {
    if (this.in_param_ty && HirId_eq(this.ct, c.hir_id)) {
      return ControlFlow.Break(null);
    }
    return hir.intravisit.walk_anon_const(this, c);
  }
}

// ---- helpers (not ports) ----

/** `GenericParamDef`'s derived `Clone` (`own_params.clone()`, `.to_owned()`): a fresh object, so `param.index = ..` on the
 *  copy leaves the cached `Generics` alone. */
function clone_GenericParamDef(p: GenericParamDef): GenericParamDef {
  return { name: p.name, def_id: p.def_id, index: p.index, pure_wrt_drop: p.pure_wrt_drop, kind: p.kind };
}

/** `assert_matches!(tcx.def_kind(def_id), DefKind::A | DefKind::B)`. */
function assert_matches_def_kind(tcx: TyCtxt, def_id: LocalDefId, kinds: readonly string[]): void {
  const k = tcx.def_kind(def_id);
  if (!kinds.includes(k.$)) {
    panic(`assertion \`left matches right\` failed\n  left: ${hir.def.debug_DefKind(k, PLAIN)}\n right: DefKind::${kinds.join(" | DefKind::")}`);
  }
}
