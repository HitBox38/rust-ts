// Port of compiler/rustc_ast_lowering/src/delegation/resolution.rs (lane lower-delegation).
//
// The `impl DelegationResolver` methods of this file are declared in ../decls.ts (the contract) and assigned onto
// the prototype here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import type { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { type Block, type Delegation, type NodeId, visit } from "../../rustc_ast/lib.ts";
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { Steal } from "../../rustc_data_structures/steal.ts";
import { DefKind, DefKind_eq, Res } from "../../rustc_hir/def.ts";
import type { Safety } from "../../rustc_hir/lib.ts";
import type {
  AstOwner,
  DelegationInherentFnKind,
  ResolverAstLowering,
  TypeRelativeDelegationRes,
} from "../../rustc_middle/middle/resolve.ts";
import type { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { type Ty, visit_with_Ty } from "../../rustc_middle/ty/mod.ts";
import { type DefId, DefIdSet, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import { type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { debug_NodeId } from "../../rustc_ast/node_id.gen.ts";
import { debug_LocalDefId } from "../../rustc_span/def_id.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { DelegationResolver, type LoweringContext } from "../decls.ts";
import * as diagnostics from "../diagnostics.ts";
import type { GenericsGenerationResults } from "./generics.ts";

// ---- Types of this file: resolution.gen.ts (codegen set rustc_ast_lowering) ----
export * from "./resolution.gen.ts";
import type { DelegationResolution, ParamInfo, SigMapping } from "./resolution.gen.ts";

// ---- PORT(stand-in): upstream APIs this file calls that are not ported yet. Each stops as UNPORTED; replace the
// call sites with the real API when it lands. ----

/** The `ty::FnSig` accessors this lane calls (rustc_type_ir ty_kind.rs:1141 `inputs`, :1145 `output`, :1170
 *  `safety`, :1174 `abi`, :1178 `c_variadic`); `ty::FnSig` (wave 15) has no methods yet. */
export interface TyFnSigView {
  inputs(): readonly Ty[];
  output(): Ty;
  safety(): Safety;
  abi(): ExternAbi;
  c_variadic(): boolean;
}
/** `tcx.fn_sig(def_id).skip_binder().skip_binder()`: `EarlyBinder::skip_binder` / `Binder::skip_binder`
 *  (rustc_type_ir binder.rs) and the `ty::FnSig` methods are not ported (wave 15). */
export function fn_sig_skip_binders(tcx: TyCtxt, def_id: DefId): TyFnSigView {
  void tcx.fn_sig(def_id);
  return unported("rustc_type_ir::binder::{EarlyBinder, Binder}::skip_binder of `tcx.fn_sig(..)` (ty::FnSig, wave 15)");
}
/** `TyCtxt::is_method` (rustc_middle ty/context.rs:1295) is not ported. */
export function TyCtxt_is_method(_tcx: TyCtxt, _id: DefId): boolean {
  return unported("rustc_middle::ty::context::TyCtxt::is_method");
}
/** `AssocItems::filter_by_name_unhygienic` (rustc_middle ty/assoc.rs) is not ported. */
function AssocItems_filter_by_name_unhygienic(_self: AssocItems, _name: unknown): Iterable<AssocItem> {
  return unported("rustc_middle::ty::assoc::AssocItems::filter_by_name_unhygienic");
}
/** `impl TypeSuperVisitable for Ty` (rustc_middle ty/structural_impls.rs:420) is not ported. */
function Ty_super_visit_with<R>(_t: Ty, _visitor: TypeVisitor<R>): R {
  return unported("rustc_middle::ty::Ty: TypeSuperVisitable::super_visit_with (structural_impls.rs:420)");
}

/// Simple (hack or heuristic) resolution of some delegations to inherent impls
/// while correct resolution through `ProbeContext` is not available
/// during AST -> HIR lowering due to query cycles.
/// Successful resolutions from this heuristics are not a subset of
/// successful resolutions from the correct approach, if we want to stabilize
/// delegations to inherent impls with this approach we need a second pass in type checking
/// (i.e., when there's no cycles) that makes sure that resolutions from
/// the heuristic match the correct resolutions, or report errors otherwise.
/// FIXME(fn_delegation): correct resolution through `ProbeContext` engine
// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:34 resolve_type_relative_delegations
export function resolve_type_relative_delegations(tcx: TyCtxt, _: null): Map<LocalDefId, TypeRelativeDelegationRes> {
  // PORT: the `index_ast` query value is `unknown` in queries.gen.ts; lib.rs:587 `index_ast` returns
  // `IndexVec<LocalDefId, Option<Steal<(ResolverAstLowering, AstOwner)>>>`.
  const ast_index = tcx.index_ast(null) as readonly (Steal<[ResolverAstLowering, AstOwner]> | undefined)[];
  const resolutions = tcx.resolutions(null);

  const infos = resolutions.delegation_infos;
  const inh_fns = resolutions.delegation_inherent_fn_map;

  const type_relative_resolutions: Map<LocalDefId, TypeRelativeDelegationRes> = new Map();

  // PORT: `delegation_infos` (a `LocalDefIdMap`, i.e. FxHashMap) is a JS `Map` in the resolver, iterated here in
  // insertion order, not hashbrown order. The result is only looked up by key; the order is observable only as
  // the creation order of the `span_delayed_bug`s below.
  for (const [def_id, res] of infos) {
    switch (res.resolution.$) {
      case "Error":
      case "Full": {
        continue;
      }
      // Also record resolutions for cases when signature is resolved but call path is not.
      case "Partial":
      case "PartialCall": {
        const r_and_owner = unwrap(ast_index[def_id], "ast index must contain delegations").borrow();

        const [r, owner] = r_and_owner;

        let delegation: Delegation;
        if (owner.$ === "Item" && owner._0.kind.$ === "Delegation") {
          delegation = owner._0.kind._0;
        } else if ((owner.$ === "TraitItem" || owner.$ === "ImplItem") && owner._0.kind.$ === "Delegation") {
          delegation = owner._0.kind._0;
        } else {
          return unreachable("internal error: entered unreachable code: we are processing only delegations");
        }

        const res_ = r.partial_res_map.get(delegation.id);
        const res__ = res_ === undefined ? undefined : Res.opt_def_id(res_.base_res());
        const last = delegation.path.segments[delegation.path.segments.length - 1];
        const ident = last === undefined ? undefined : last.ident;

        const span = delegation.last_segment_span();

        const ambig_error_res = (): TypeRelativeDelegationRes => ({
          $: "Ambig",
          _0: tcx.dcx().span_delayed_bug(span, "ambiguous delegation to inherent impl"),
        });

        const default_error_res = (): TypeRelativeDelegationRes => ({
          $: "Error",
          _0: tcx.dcx().span_delayed_bug(span, "failed to resolve delegation to inherent impl"),
        });

        let res3: TypeRelativeDelegationRes;
        if (res__ !== undefined && ident !== undefined) {
          const res = res__;
          const local_def_id = res.as_local();
          if (local_def_id !== undefined) {
            // PORT: the inner map is a `KeyedMap` keyed by `Ident` (rustc_resolve late.rs:3842).
            const map = inh_fns.get(local_def_id) as Map<Ident, DelegationInherentFnKind> | undefined;
            const res = map === undefined ? undefined : map.get(ident);

            if (res !== undefined) {
              switch (res.$) {
                case "Ambig":
                  res3 = ambig_error_res();
                  break;
                case "Single":
                  res3 = { $: "Ok", _0: LocalDefId.to_def_id(res._0) };
                  break;
              }
            } else {
              res3 = default_error_res();
            }
          } else {
            let sig_res: TypeRelativeDelegationRes | undefined = undefined;
            inh_loop: for (const inh_impl_id of tcx.inherent_impls(res)) {
              const assoc_items = tcx.associated_items(inh_impl_id) as AssocItems;

              // FIXME(fn_delegation): use correct identifier hygiene
              const candidates = AssocItems_filter_by_name_unhygienic(assoc_items, ident.name);

              for (const candidate of candidates) {
                if (!(candidate.kind.$ === "Fn")) continue;
                if (sig_res !== undefined) {
                  sig_res = ambig_error_res();
                  break inh_loop;
                } else {
                  sig_res = { $: "Ok", _0: candidate.def_id };
                }
              }
            }

            res3 = sig_res ?? default_error_res();
          }
        } else {
          res3 = default_error_res();
        }

        type_relative_resolutions.set(def_id, res3);
      }
    }
  }

  return type_relative_resolutions;
}

// pub(super) mod resolver {
/// Abstracts operations that are needed for delegation's resolution, so resolution
/// is independent of `LoweringContext`. Placed in a separate module so `LoweringContext`
/// can not be accessed directly.
// PORT: `pub(crate) struct DelegationResolver<'a, 'hir>(&'a LoweringContext<'a, 'hir>)` is declared in ../decls.ts
// (the contract), so it can carry the generics.rs methods too.
export const resolver = { DelegationResolver };

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:186 new
DelegationResolver.new = function (ctx: LoweringContext): DelegationResolver {
  return new DelegationResolver(ctx);
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:191 tcx
DelegationResolver.prototype.tcx = function (this: DelegationResolver): TyCtxt {
  return this._0.tcx;
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:196 owner_id
DelegationResolver.prototype.owner_id = function (this: DelegationResolver): LocalDefId {
  return this._0.curr_owner.owner.def_id;
};

/// (from `tests\ui\delegation\target-expr-removal-defs-inside.rs`):
/// ```rust
/// reuse impl Trait for S1 {
///     some::path::<{ fn foo() {} }>::xd();
///     fn foo() {}
///     self.0
/// }
/// ```
///
/// Constant from unresolved path will be in `node_id_to_def_id`,
/// `fn foo() {}` will not be in `node_id_to_def_id` but will be in `owners`,
/// both have `LocalDefId`, so we check those two maps.
// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:213 is_definition
DelegationResolver.prototype.is_definition = function (this: DelegationResolver, id: NodeId): boolean {
  return this._0.resolver.owners.has(id) || this._0.curr_owner.owner.node_id_to_def_id.has(id);
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:219 get_resolution_id
DelegationResolver.prototype.get_resolution_id = function (this: DelegationResolver, id: NodeId): Result<DefId, ErrorGuaranteed> {
  const r = this._0.get_partial_res(id);
  const def_id = r === undefined ? undefined : Res.opt_def_id(r.expect_full_res());
  if (def_id !== undefined) return Ok(def_id);
  return Err(this.tcx().dcx().delayed_bug(`failed to resolve node ${debug_NodeId(id, PLAIN)}`));
};
// }

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:228 resolve_delegation
DelegationResolver.prototype.resolve_delegation = function (
  this: DelegationResolver,
  delegation: Delegation,
  span: Span,
): Result<[DelegationResolution, GenericsGenerationResults], ErrorGuaranteed> {
  const tcx = this.tcx();
  const def_id = this.owner_id();

  // Delegation can be missing from the `delegations_resolutions` table
  // in illegal places such as function bodies in extern blocks (see #151356).
  const sig_id_r = this.resolve_delegation_sig(def_id, span);
  if (sig_id_r.$ === "Err") return sig_id_r;
  const sig_id = sig_id_r._0;

  const create_invalid_path_error = (): ErrorGuaranteed => tcx.dcx().span_delayed_bug(span, "invalid delegation path");

  const segments = delegation.path.segments;
  if (segments.length === 0) {
    return Err(create_invalid_path_error());
  } else if (segments.length === 1) {
    const child = segments[0]!;
    const res = this.get_resolution_id(child.id);
    if (res.$ === "Err") return res;
    if (!DefKind_eq(tcx.def_kind(res._0), DefKind.Fn)) {
      return Err(create_invalid_path_error());
    }
  } else {
    const parent = segments[segments.length - 2]!;
    const child_res = this.get_call_path_res(delegation, span);
    if (child_res.$ === "Err") return child_res;
    const parent_res = this.get_resolution_id(parent.id);
    if (parent_res.$ === "Err") return parent_res;

    const ck = tcx.def_kind(child_res._0);
    const pk = tcx.def_kind(parent_res._0);
    if (ck.$ === "Fn" && pk.$ === "Mod") {
      // {}
    } else if (ck.$ === "AssocFn" && (pk.$ === "Trait" || pk.$ === "Struct" || pk.$ === "Enum")) {
      // {}
    } else {
      return Err(create_invalid_path_error());
    }
  }

  const cycles = this.check_for_cycles(sig_id, span);
  if (cycles.$ === "Err") return cycles;

  const is_method = TyCtxt_is_method(tcx, sig_id);
  const sig = fn_sig_skip_binders(tcx, sig_id);
  const param_count = sig.inputs().length + (sig.c_variadic() ? 1 : 0);
  const parent = tcx.local_parent(def_id);

  const soundness = this.check_block_soundness(delegation, sig_id, is_method, param_count);
  if (soundness.$ === "Err") return soundness;
  const [should_generate_block, contains_defs] = soundness._0;

  // PORT: the struct literal's field initializers run in source order; `?` returns early.
  const param_info: ParamInfo = { param_count, c_variadic: sig.c_variadic(), splatted: undefined };
  const call_path_res = this.get_call_path_res(delegation, span);
  if (call_path_res.$ === "Err") return call_path_res;
  const sig_mapping = this.create_sig_mapping(delegation, span, should_generate_block, parent, sig, contains_defs);
  if (sig_mapping.$ === "Err") return sig_mapping;
  const res: DelegationResolution = {
    is_method,
    span,
    sig_id,
    parent,
    // FIXME(splat): use `sig.splatted()` once FnSig has it
    param_info,
    source: delegation.source,
    call_path_res: call_path_res._0,
    sig_mapping: sig_mapping._0,
  };

  const generics = this.resolve_and_generate_generics(delegation, sig_id, span);
  if (generics.$ === "Err") return generics;
  return Ok([res, generics._0]);
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:295 get_call_path_res
DelegationResolver.prototype.get_call_path_res = function (
  this: DelegationResolver,
  delegation: Delegation,
  span: Span,
): Result<DefId, ErrorGuaranteed> {
  const def_id = this.owner_id();

  const resolution = unwrap(this.tcx().resolutions(null).delegation_infos.get(def_id), "no entry found for key").resolution;
  switch (resolution.$) {
    case "Full":
      return this.get_resolution_id(delegation.id);
    case "Partial":
    case "PartialCall":
      return this.resolve_type_relative_delegation_sig(def_id, span);
    case "Error":
      return Err(resolution._0);
  }
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:312 resolve_delegation_sig
DelegationResolver.prototype.resolve_delegation_sig = function (
  this: DelegationResolver,
  def_id: LocalDefId,
  span: Span,
): Result<DefId, ErrorGuaranteed> {
  const tcx = this.tcx();

  const res = tcx.resolutions(null).delegation_infos.get(def_id);
  if (res !== undefined) {
    const resolution = res.resolution;
    switch (resolution.$) {
      case "Error":
        return Err(resolution._0);
      case "Full":
      case "PartialCall":
        return Ok(resolution._0);
      case "Partial":
        return this.resolve_type_relative_delegation_sig(def_id, span);
    }
  } else {
    return Err(this.create_unresolved_error(def_id, span));
  }
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:332 create_unresolved_error
DelegationResolver.prototype.create_unresolved_error = function (this: DelegationResolver, def_id: LocalDefId, span: Span): ErrorGuaranteed {
  return this.tcx().dcx().span_delayed_bug(span, `unresolved delegation ${debug_LocalDefId(def_id, PLAIN)}`);
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:336 resolve_type_relative_delegation_sig
DelegationResolver.prototype.resolve_type_relative_delegation_sig = function (
  this: DelegationResolver,
  def_id: LocalDefId,
  span: Span,
): Result<DefId, ErrorGuaranteed> {
  const tcx = this.tcx();

  // PORT: the query value is `FxIndexMap<LocalDefId, TypeRelativeDelegationRes>` (`unknown` values in queries.gen.ts).
  const res = tcx.resolve_type_relative_delegations(null).get(def_id) as TypeRelativeDelegationRes | undefined;
  if (res !== undefined) {
    switch (res.$) {
      case "Ok":
        return Ok(res._0);
      case "Error":
        return Err(tcx.dcx().emit_err(diagnostics.UnresolvedDelegationCallee_diagnostic({ span })));
      case "Ambig":
        return Err(tcx.dcx().emit_err(diagnostics.AmbiguousDelegationToInherentImpl_diagnostic({ span })));
    }
  } else {
    return Err(this.create_unresolved_error(def_id, span));
  }
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:357 check_for_cycles
DelegationResolver.prototype.check_for_cycles = function (this: DelegationResolver, def_id: DefId, span: Span): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx();
  const visited: DefIdSet = new DefIdSet();
  const delegation_infos = tcx.resolutions(null).delegation_infos;

  for (;;) {
    visited.add(def_id);

    // If def_id is in local crate and it corresponds to another delegation
    // it means that we refer to another delegation as a callee, so in order to obtain
    // a signature DefId we obtain NodeId of the callee delegation and try to get signature from it.
    const local_id = def_id.as_local();
    let id: Result<DefId, ErrorGuaranteed> | undefined;
    if (local_id !== undefined && delegation_infos.has(local_id) && (id = this.resolve_delegation_sig(local_id, span)).$ === "Ok") {
      def_id = id._0;
      if (visited.has(def_id)) {
        return Err(
          visited.size === 1
            ? tcx.dcx().emit_err(diagnostics.UnresolvedDelegationCallee_diagnostic({ span }))
            : tcx.dcx().emit_err(diagnostics.CycleInDelegationSignatureResolution_diagnostic({ span })),
        );
      }
    } else {
      return Ok(undefined);
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:385 check_block_soundness
DelegationResolver.prototype.check_block_soundness = function (
  this: DelegationResolver,
  delegation: Delegation,
  sig_id: DefId,
  is_method: boolean,
  param_count: number,
): Result<[/* should generate block */ boolean, /* contains defs */ boolean], ErrorGuaranteed> {
  const tcx = this.tcx();
  const should_generate_block = is_method || tcx.def_kind(sig_id).$ === "Fn" || delegation.source.$ === "Single";

  const block: Block | undefined = delegation.body;
  if (block === undefined) return Ok([should_generate_block, false]);

  // Report an error if user has explicitly specified delegation's target expression
  // in a single delegation when reused function has no params.
  if (param_count === 0 && should_generate_block) {
    const err = { span: block.span };
    return Err(tcx.dcx().emit_err(diagnostics.DelegationBlockSpecifiedWhenNoParams_diagnostic(err)));
  }

  class DefinitionsFinder extends visit.Visitor<ControlFlow<null>> {
    override Result = VisitorResult.ControlFlow<null>();
    constructor(public resolver: DelegationResolver) {
      super();
    }

    // rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:413 visit_id
    override visit_id(id: NodeId): ControlFlow<null> {
      // match self.resolver.is_definition(id) { true => Break(()), false => Continue(()) }
      if (this.resolver.is_definition(id)) {
        return ControlFlow.Break(null);
      } else {
        return ControlFlow.CONTINUE;
      }
    }
  }

  const collector = new DefinitionsFinder(this);

  const contains_defs = collector.visit_block(block).$ === "Break";

  // If there are definitions inside and we can't delete target expression, then report an error.
  // FIXME(fn_delegation): support deletion of target expression with defs inside.
  if (should_generate_block || !contains_defs) {
    return Ok([should_generate_block, contains_defs]);
  } else {
    return Err(tcx.dcx().emit_err(diagnostics.DelegationAttemptedBlockWithDefsDeletion_diagnostic({ span: block.span })));
  }
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:434 create_sig_mapping
DelegationResolver.prototype.create_sig_mapping = function (
  this: DelegationResolver,
  delegation: Delegation,
  span: Span,
  should_generate_block: boolean,
  parent: LocalDefId,
  sig_: unknown,
  contains_defs: boolean,
): Result<SigMapping, ErrorGuaranteed> {
  // PORT: `ty::FnSig<'tcx>` is `TyFnSig = unknown` in decls.ts; the stand-in view of its methods.
  const sig = sig_ as TyFnSigView;
  // SigMapping::default()
  const mapping: SigMapping = { map_return: false, arguments_to_map: new Set() };
  if (should_generate_block) {
    mapping.arguments_to_map.add(0);
  }

  if (this.can_perform_self_mapping(delegation, parent, span)) {
    /// Finds `Self` generic param only in ADT or references, so we avoid cases like
    /// `Self::Item` which will return true if `output.contains(...)` will be used.
    // PORT: unit struct `SelfFinder` with `impl TypeVisitor<TyCtxt>` (`type Result = ControlFlow<()>`); the provided
    // methods it does not override delegate to `TypeVisitor_provided`.
    class SelfFinder implements TypeVisitor<ControlFlow<null>> {
      readonly Result = VisitorResult.ControlFlow<null>();

      // rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:456 visit_ty
      visit_ty(t: Ty): ControlFlow<null> {
        const kind = t.kind();
        switch (kind.$) {
          case "Adt": {
            const args = kind._1;
            if (args.some((arg) => {
              const type_arg = GenericArg.as_type(arg);
              return type_arg !== undefined && type_arg.is_self_param();
            })) {
              return ControlFlow.Break(null);
            }

            return Ty_super_visit_with(t, this);
          }
          case "Ref": {
            const ref_t = kind._1;
            if (ref_t.is_self_param()) {
              return ControlFlow.Break(null);
            }

            return Ty_super_visit_with(t, this);
          }
          default:
            return ControlFlow.CONTINUE;
        }
      }

      // rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:482 contains_self
      static contains_self(t: Ty): boolean {
        return t.is_self_param() || visit_with_Ty(t, new SelfFinder()).$ === "Break";
      }

      // (provided)
      visit_binder: TypeVisitor<ControlFlow<null>>["visit_binder"] = (t, d) => TypeVisitor_provided.visit_binder(this, t, d);
      visit_region: TypeVisitor<ControlFlow<null>>["visit_region"] = (r) => TypeVisitor_provided.visit_region(this, r);
      visit_const: TypeVisitor<ControlFlow<null>>["visit_const"] = (c) => TypeVisitor_provided.visit_const(this, c);
      visit_predicate: TypeVisitor<ControlFlow<null>>["visit_predicate"] = (p, d) => TypeVisitor_provided.visit_predicate(this, p, d);
      visit_clauses: TypeVisitor<ControlFlow<null>>["visit_clauses"] = (c) => TypeVisitor_provided.visit_clauses(this, c);
      visit_error: TypeVisitor<ControlFlow<null>>["visit_error"] = (g) => TypeVisitor_provided.visit_error(this, g);
    }

    mapping.map_return = SelfFinder.contains_self(sig.output());

    const inputs = sig.inputs();
    // .skip(1): Already checked above.
    for (let idx = 1; idx < inputs.length; idx++) {
      const param = inputs[idx]!;
      if (SelfFinder.contains_self(param)) mapping.arguments_to_map.add(idx);
    }
  }

  // We can't yet map more than one argument if there are definitions inside.
  // FIXME(fn_delegation): support relowering with defs inside
  if (contains_defs && mapping.arguments_to_map.size > 1) {
    const err = { span };
    const err_ = this.tcx().dcx().emit_err(diagnostics.DelegationAttemptedBlockWithDefsRelowering_diagnostic(err));
    return Err(err_);
  }

  return Ok(mapping);
};

// rustc: compiler/rustc_ast_lowering/src/delegation/resolution.rs:510 can_perform_self_mapping
DelegationResolver.prototype.can_perform_self_mapping = function (
  this: DelegationResolver,
  delegation: Delegation,
  parent: LocalDefId,
  span: Span,
): boolean {
  // Heuristic: don't do wrapping if there is no target expression.
  if (delegation.body === undefined) {
    return false;
  }

  const tcx = this.tcx();

  // Apply wrapping for delegations inside
  // 1) Trait impls, as the return type of both signature function
  //    and generated delegation has `Self` generic param returned
  //    (checked below).
  //    FIXME(fn_delegation): think of enabling wrapping in more scenarios:
  //      trait-(impl)-to-free
  //      trait-(impl)-to-inherent
  //      inherent-to-free
  // 2) Inherent methods when delegating to trait, as we change the type of
  //    `Self` to type of struct or enum we delegate from.
  if (!(tcx.def_kind(parent).$ === "Impl")) {
    return false;
  }

  // Check that delegation path resolves to a trait AssocFn, not to a free method.
  // After previous check we are sure that `sig_id` and `delegation.id`
  // point to the same function.
  const r = this.get_call_path_res(delegation, span);
  const id = unwrap(r.$ === "Ok" ? r._0 : undefined, "invalid paths are filtered out earlier");

  return DefKind_eq(tcx.def_kind(id), DefKind.AssocFn) && DefKind_eq(tcx.def_kind(tcx.parent(id)), DefKind.Trait);
};
