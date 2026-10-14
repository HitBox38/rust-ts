// Port of compiler/rustc_ast_lowering/src/delegation/mod.rs (lane lower-delegation).
//
// The `impl LoweringContext` methods of this file are declared in ../decls.ts (the contract) and assigned onto the
// prototype here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `../decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
//! This module implements expansion of delegation items with early resolved paths.
//! It includes a delegation to a free functions:
//!
//! ```ignore (illustrative)
//! reuse module::name { target_expr_template }
//! ```
//!
//! And delegation to a trait methods:
//!
//! ```ignore (illustrative)
//! reuse <Type as Trait>::name { target_expr_template }
//! ```
//!
//! After expansion for both cases we get:
//!
//! ```ignore (illustrative)
//! fn name(
//!     arg0: InferDelegation(sig_id, Input(0)),
//!     arg1: InferDelegation(sig_id, Input(1)),
//!     ...,
//!     argN: InferDelegation(sig_id, Input(N)),
//! ) -> InferDelegation(sig_id, Output) {
//!     callee_path(target_expr_template(arg0), arg1, ..., argN)
//! }
//! ```
//!
//! Where `callee_path` is a path in delegation item e.g. `<Type as Trait>::name`.
//! `sig_id` is a id of item from which the signature is inherited. It may be a delegation
//! item id (`item_id`) in case of impl trait or path resolution id (`path_id`) otherwise.
//!
//! Since we do not have a proper way to obtain function type information by path resolution
//! in AST, we mark each function parameter type as `InferDelegation` and inherit it during
//! HIR ty lowering.
//!
//! Similarly generics, predicates and header are set to the "default" values.
//! In case of discrepancy with callee function the `UnsupportedDelegation` error will
//! also be emitted during HIR ty lowering.
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { BindingMode, type Block, type Delegation, type NodeId, visit } from "../../rustc_ast/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lib.ts";
import { clone_Res, DefKind_eq, type Res } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { clone_HirId, type HirId, HirId_INVALID, type ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { LocalExpnId } from "../../rustc_span/hygiene.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { unwrap } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { DelegationResolver, LoweringContext } from "../decls.ts";
import type { AllowReturnTypeNotation, ImplTraitContext, ParamMode } from "../lib.ts";
import { type GenericsGenerationResult, type GenericsGenerationResults, GenericsPosition, HirOrTyGenerics } from "./generics.ts";
import { type DelegationResolution, fn_sig_skip_binders, type ParamInfo } from "./resolution.ts";

// mod attributes;
import "./attributes.ts";
// mod generics;
import "./generics.ts";
// pub(crate) mod resolution;
export * as resolution from "./resolution.ts";

// ---- Types of this file ----
// `DelegationResults` (mod.rs:67): mod.gen.ts. `SelfResolver` (mod.rs:625) is a hand class below (it extends the ast
// `Visitor`; a `hand` entry of the codegen set).
export * from "./mod.gen.ts";
import type { DelegationResults } from "./mod.gen.ts";

// ---- PORT(stand-in): upstream values this file reads whose types are not ported yet. ----
/** `rustc_middle::ty::Asyncness` (rustc_middle ty/mod.rs; a fieldless enum, PORTING §5): the `asyncness` query
 *  value is `unknown` in queries.gen.ts. */
type Asyncness = "Yes" | "No";
/** The `CodegenFnAttrs` field this file reads (rustc_middle middle/codegen_fn_attrs.rs; the `codegen_fn_attrs`
 *  query value is `unknown` in queries.gen.ts). */
interface CodegenFnAttrsFields {
  safe_target_features: boolean;
}

// ---- impl LoweringContext (delegation/mod.rs) ----
// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:75 lower_delegation
LoweringContext.prototype.lower_delegation = function (this: LoweringContext, delegation: Delegation): DelegationResults {
  const span = this.lower_span(delegation.last_segment_span());

  const resolver = DelegationResolver.new(this);
  const r = resolver.resolve_delegation(delegation, span);
  if (r.$ === "Err") {
    return this.generate_delegation_error(span, delegation);
  }
  const [res, generics] = r._0;

  this.add_attrs_if_needed(res);

  const [body_id, call_expr_id, unused_target_expr] = this.lower_delegation_body(delegation, res, generics);

  const decl = this.lower_delegation_decl(res, generics, call_expr_id, unused_target_expr);

  const sig = this.lower_delegation_sig(res.sig_id, decl, span);

  const ident = this.lower_ident(delegation.ident);

  const generics_ = this.arena.alloc(
    new hir.Generics(
      this.arena.alloc_from_iter(generics.all_params()),
      this.arena.alloc_from_iter(generics.all_predicates()),
      false,
      span,
      span,
    ),
  );

  return { body_id, sig, ident, generics: generics_ };
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:105 lower_delegation_decl
LoweringContext.prototype.lower_delegation_decl = function (
  this: LoweringContext,
  res: DelegationResolution,
  generics: GenericsGenerationResults,
  call_expr_id: HirId,
  unused_target_expr: boolean,
): hir.FnDecl {
  const { source, call_path_res, span, sig_id } = res;
  const { param_count, c_variadic, splatted }: ParamInfo = res.param_info;

  // The last parameter in C variadic functions is skipped in the signature,
  // like during regular lowering.
  const decl_param_count = param_count - (c_variadic ? 1 : 0);
  const inputs_: hir.Ty[] = [];
  for (let arg = 0; arg < decl_param_count; arg++) {
    inputs_.push(new hir.Ty<null>(this.next_id(), span, { $: "InferDelegation", _0: { $: "Sig", _0: sig_id, _1: { $: "Input", _0: arg } } }));
  }
  const inputs = this.arena.alloc_from_iter(inputs_);

  const hir_id = this.next_id();
  let id: LocalExpnId | undefined;
  switch (source.$) {
    case "Single":
      id = undefined;
      break;
    case "List":
      id = source._0;
      break;
    case "Glob":
      id = this.tcx.expn_that_defined(this.curr_owner.owner.def_id).expect_local();
      break;
  }
  const output = this.arena.alloc(
    new hir.Ty<null>(hir_id, span, {
      $: "InferDelegation",
      _0: {
        $: "Sig",
        _0: sig_id,
        _1: {
          $: "Output",
          _0: this.arena.alloc<hir.DelegationInfo>({
            call_expr_id,
            call_path_res,
            arguments_to_map: new Set(res.sig_mapping.arguments_to_map),
            child_seg_id: generics.child.args_segment_id,
            child_seg_id_for_sig: generics.child.segment_id_for_sig(),
            parent_seg_id_for_sig: generics.parent.segment_id_for_sig(),
            self_ty_propagation_kind:
              generics.self_ty_propagation_kind === undefined ? undefined : hir.clone_DelegationSelfTyPropagationKind(generics.self_ty_propagation_kind),
            group_id: id === undefined ? undefined : [id, unused_target_expr],
          }),
        },
      },
    }),
  );

  return this.arena.alloc(
    new hir.FnDecl(
      inputs,
      { $: "Return", _0: output },
      unwrap_result(
        hir.FnDeclFlags.default_().set_lifetime_elision_allowed(true).set_c_variadic(c_variadic).set_splatted(splatted, inputs.length),
        hir.debug_SplattedArgIndexError,
      ),
    ),
  );
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:168 lower_delegation_sig
LoweringContext.prototype.lower_delegation_sig = function (this: LoweringContext, sig_id: DefId, decl: hir.FnDecl, span: Span): hir.FnSig {
  const sig = fn_sig_skip_binders(this.tcx, sig_id);
  let asyncness: hir.IsAsync;
  switch (this.tcx.asyncness(sig_id) as Asyncness) {
    case "Yes":
      asyncness = { $: "Async", _0: span };
      break;
    case "No":
      asyncness = hir.IsAsync.NotAsync;
      break;
  }

  const header = new hir.FnHeader(
    (this.tcx.codegen_fn_attrs(sig_id) as CodegenFnAttrsFields).safe_target_features
      ? hir.HeaderSafety.SafeTargetFeatures
      : { $: "Normal", _0: sig.safety() },
    this.tcx.constness(sig_id) as hir.Constness,
    asyncness,
    sig.abi(),
  );

  return { decl, header, span };
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:194 generate_param
LoweringContext.prototype.generate_param = function (this: LoweringContext, is_method: boolean, idx: number, span: Span): [hir.Param, NodeId] {
  const pat_node_id = this.next_node_id();
  const pat_id = this.lower_node_id(pat_node_id);
  // FIXME(cjgillot) AssocItem currently relies on self parameter being exactly named `self`.
  const name = is_method && idx === 0 ? kw.SelfLower : Symbol.intern(`arg${idx}`);
  const ident = Ident.with_dummy_span(name);
  const pat = this.arena.alloc(new hir.Pat(pat_id, { $: "Binding", _0: BindingMode.NONE, _1: pat_id, _2: ident, _3: undefined }, span, false));

  return [{ hir_id: this.next_id(), pat, ty_span: span, span }, pat_node_id];
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:219 generate_arg
LoweringContext.prototype.generate_arg = function (this: LoweringContext, is_method: boolean, idx: number, param_id: HirId, span: Span): hir.Expr {
  // FIXME(cjgillot) AssocItem currently relies on self parameter being exactly named `self`.
  const name = is_method && idx === 0 ? kw.SelfLower : Symbol.intern(`arg${idx}`);

  const segments = this.arena.alloc_from_iter([new hir.PathSegment(Ident.with_dummy_span(name), this.next_id(), { $: "Local", _0: param_id }, undefined, false, false)]);

  const path = this.arena.alloc(new hir.Path(span, { $: "Local", _0: param_id } as Res, segments));
  return this.mk_expr({ $: "Path", _0: { $: "Resolved", _0: undefined, _1: path } }, span);
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:246 lower_delegation_body
LoweringContext.prototype.lower_delegation_body = function (
  this: LoweringContext,
  delegation: Delegation,
  res: DelegationResolution,
  generics: GenericsGenerationResults,
): [hir.BodyId, HirId, boolean] {
  const block = delegation.body;
  let call_expr_id = HirId_INVALID;
  let unused_target_expr = false;

  const block_id = this.lower_body((this_) => {
    const { param_info, span, is_method } = res;
    const { param_count } = param_info;
    const arguments_to_map = res.sig_mapping.arguments_to_map;

    const parameters: hir.Param[] = [];
    const args: hir.Expr[] = [];
    const stmts: (readonly hir.Stmt[])[] = [];

    // Consider non-specified target expression as generated,
    // as we do not want to emit error when target expression is
    // not specified.
    unused_target_expr = block !== undefined && (param_count === 0 || arguments_to_map.size === 0);

    for (let idx = 0; idx < param_count; idx++) {
      const [param, pat_node_id] = this_.generate_param(is_method, idx, span);
      parameters.push(param);

      const generate_arg = (this__: LoweringContext): hir.Expr => this__.generate_arg(is_method, idx, param.pat.hir_id, span);

      let arg: hir.Expr | undefined;
      if (block !== undefined && arguments_to_map.has(idx)) {
        const block_ = this_.lower_block_maybe_more_than_once(block, pat_node_id, param.pat.hir_id.local_id, delegation.id);

        stmts.push(block_.stmts);

        // The behavior of the delegation's target expression differs from the
        // behavior of the usual block, where if there is no final expression
        // the `()` is returned. In case of the similar situation in delegation
        // (no final expression) we propagate first argument instead of replacing
        // it with `()`.
        arg = block_.expr === undefined ? undefined : hir.clone_Expr(block_.expr);
      }
      if (arg === undefined) arg = generate_arg(this_);

      args.push(arg);
    }

    const [final_expr, hir_id] = this_.finalize_body_lowering(
      delegation,
      this_.arena.alloc_from_iter(stmts.flat().map(hir.clone_Stmt)),
      args,
      res,
      generics,
      span,
    );

    call_expr_id = hir_id;

    return [this_.arena.alloc_from_iter(parameters), final_expr];
  });

  // debug_assert_ne!(call_expr_id, HirId::INVALID);

  return [block_id, call_expr_id, unused_target_expr];
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:321 lower_block_maybe_more_than_once
LoweringContext.prototype.lower_block_maybe_more_than_once = function (
  this: LoweringContext,
  block: Block,
  pat_node_id: NodeId,
  param_local_id: ItemLocalId,
  delegation_id: NodeId,
): hir.Block {
  const self_resolver = new SelfResolver(this, delegation_id, pat_node_id, []);

  self_resolver.visit_block(block);

  const overwrites = self_resolver.overwrites;

  // Target expr needs to lower `self` path.
  this.curr_owner.ident_and_label_to_local_id.set(pat_node_id, param_local_id);

  // PORT: `cfg_select! { debug_assertions => ReloweringChecker::allow_relowering(..), _ => .. }`: the oracle is a
  // release build without debug_assertions (root decision, merge-w13), so the `_` arm.
  const block_ = this.lower_block_noalloc(HirId_INVALID, block, false);

  // Remove node ids for which we overwrote resolution to generated param
  // before block lowering as block can be relowered. We need to do it because
  // check in `SelfResolver` uses `get_partial_res` to decide whether to overwrite
  // resolution, and if it is already overwritten from previous block lowering this
  // check will not pass.
  for (const id of overwrites) {
    this.partial_res_overrides.delete(id);
  }

  return block_;
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:363 finalize_body_lowering
LoweringContext.prototype.finalize_body_lowering = function (
  this: LoweringContext,
  delegation: Delegation,
  stmts: readonly hir.Stmt[],
  args_: hir.Expr[],
  res: DelegationResolution,
  generics: GenericsGenerationResults,
  span: Span,
): [hir.Expr, HirId] {
  const path = this.lower_qpath(
    delegation.id,
    delegation.qself,
    delegation.path,
    "Optional" satisfies ParamMode, // ParamMode::Optional
    "No" satisfies AllowReturnTypeNotation, // AllowReturnTypeNotation::No
    { $: "Disallowed", _0: "Path" } satisfies ImplTraitContext, // ImplTraitContext::Disallowed(ImplTraitPosition::Path)
    undefined,
  );

  let new_path: hir.QPath;
  switch (path.$) {
    case "Resolved": {
      const ty = path._0;
      const new_path_ = hir.clone_Path(path._1, clone_Res_HirId);
      const len = new_path_.segments.length;

      new_path_.segments = this.arena.alloc_from_iter(
        new_path_.segments.map((segment, idx) => {
          if (idx + 2 === len) {
            return this.process_segment(span, segment, generics.parent);
          } else if (idx + 1 === len) {
            return this.process_segment(span, segment, generics.child);
          } else {
            return hir.clone_PathSegment(segment);
          }
        }),
      );

      // Explicitly create `Self` self-type in case of infers or static
      // free-to-trait reuses.
      let ty_: hir.Ty | undefined;
      if (generics.self_ty_propagation_kind !== undefined && generics.self_ty_propagation_kind.$ === "SelfParam") {
        const self_param = HirOrTyGenerics.find_self_param(generics.parent.generics);
        const path = this.create_generic_arg_path(self_param);
        const kind: hir.TyKind = { $: "Path", _0: path };

        let ty2: hir.Ty;
        if (ty !== undefined) {
          const c = hir.clone_Ty(ty, (x) => x);
          ty2 = new hir.Ty<null>(c.hir_id, c.span, kind);
        } else {
          ty2 = new hir.Ty<null>(this.next_id(), span, kind);
        }

        ty_ = this.arena.alloc(ty2);
      } else {
        ty_ = ty;
      }

      new_path = { $: "Resolved", _0: ty_, _1: this.arena.alloc(new_path_) };
      break;
    }
    case "TypeRelative": {
      let ty = path._0;
      const segment = this.process_segment(span, path._1, generics.child);
      segment.res = { $: "Def", _0: this.tcx.def_kind(res.call_path_res), _1: res.call_path_res };

      const ty_hir_id = ty.hir_id;

      // Propagating child generics if needed.
      if (ty.kind.$ === "Path" && ty.kind._0.$ === "Resolved") {
        const ty_inner = ty.kind._0._0;
        const new_path_ = hir.clone_Path(ty.kind._0._1, clone_Res_HirId);

        new_path_.segments = this.arena.alloc_from_iter(
          new_path_.segments.map((segment, idx) => {
            if (idx + 1 === new_path_.segments.length) {
              return this.process_segment(span, segment, generics.parent);
            } else {
              return hir.clone_PathSegment(segment);
            }
          }),
        );

        ty = this.arena.alloc(new hir.Ty<null>(ty_hir_id, span, { $: "Path", _0: { $: "Resolved", _0: ty_inner, _1: this.arena.alloc(new_path_) } }));
      }

      new_path = { $: "TypeRelative", _0: ty, _1: this.arena.alloc(segment) };
      break;
    }
  }

  const kind = generics.self_ty_propagation_kind;
  if (kind !== undefined && kind.$ === "SelfTy") {
    let ty: hir.Ty;
    switch (new_path.$) {
      case "Resolved":
        ty = unwrap(new_path._0, "must contain self type as `SelfTy` propagation kind is specified");
        break;
      case "TypeRelative":
        ty = new_path._0;
        break;
    }
    kind._0 = ty.hir_id;
  }

  const callee_path = this.arena.alloc(this.mk_expr({ $: "Path", _0: new_path }, span));
  const args = this.arena.alloc_from_iter(args_);
  const call = this.mk_expr({ $: "Call", _0: callee_path, _1: args }, span);

  let expr: hir.Expr;
  if (res.sig_mapping.map_return) {
    const res_: Res = {
      $: "SelfTyAlias",
      alias_to: LocalDefId.to_def_id(res.parent),
      is_trait_impl: DefKind_eq(this.tcx.def_kind(res.parent), { $: "Impl", of_trait: true }),
    };

    const ident = Ident.new(kw.SelfUpper, span);
    const path = this.create_resolved_qpath(res_, ident, span);

    // FIXME(fn_delegation): add default `..` for all other fields.
    const initializer: hir.ExprKind = {
      $: "Struct",
      _0: this.arena.alloc(path),
      _1: this.arena.alloc_slice<hir.ExprField>([
        {
          hir_id: this.next_id(),
          is_shorthand: false,
          ident: Ident.new(sym.integer(0), span),
          expr: this.arena.alloc(call),
          span,
        },
      ]),
      _2: hir.StructTailExpr.None,
    };

    const expr_ = this.mk_expr(initializer, span);

    const path_ = this.make_lang_item_qpath(LangItem.FromFn, span, undefined);
    const path__ = this.arena.alloc(this.mk_expr({ $: "Path", _0: path_ }, span));

    const call_: hir.ExprKind = { $: "Call", _0: path__, _1: this.arena.alloc_slice([expr_]) };

    expr = this.arena.alloc(this.mk_expr(call_, span));
  } else {
    expr = this.arena.alloc(call);
  }

  const block = this.arena.alloc(new hir.Block(stmts, expr, this.next_id(), hir.BlockCheckMode.DefaultBlock, span, false));

  return [this.mk_expr({ $: "Block", _0: block, _1: undefined }, span), call.hir_id];
};

/** `Res: Clone` for `hir::Path::clone` (`Res<HirId>`). */
function clone_Res_HirId(r: Res): Res {
  return clone_Res(r, clone_HirId);
}

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:514 process_segment
LoweringContext.prototype.process_segment = function (
  this: LoweringContext,
  span: Span,
  segment_: hir.PathSegment,
  result: GenericsGenerationResult,
): hir.PathSegment {
  const infer_indices = HirOrTyGenerics.infer_indices(result.generics);
  HirOrTyGenerics.into_hir_generics(result.generics, this, span);

  const segment = hir.clone_PathSegment(segment_);

  const args_iter = HirOrTyGenerics.create_args_iterator(result.generics);

  const seg_args = segment.args;
  const new_args =
    seg_args !== undefined && !seg_args.is_empty()
      ? this.arena.alloc_from_iter(
          seg_args.args.map((arg, idx) => {
            if (infer_indices.has(idx)) {
              return unwrap(
                args_iter.next(this, (_) => hir.GenericArg.hir_id(arg)),
                "arg must exist for infer",
              );
            } else {
              return hir.clone_GenericArg(arg);
            }
          }),
        )
      : this.arena.alloc_from_iter(args_iter.consume_all(this));

  // Do not omit constraints as there might be some and they must be present in HIR (#158812).
  const has_constraints = segment.args !== undefined && segment.args.constraints.length !== 0;

  // Needed for better error messages (`trait-impl-wrong-args-count.rs` test).
  segment.args =
    has_constraints || new_args.length !== 0
      ? this.arena.alloc(
          new hir.GenericArgs(
            new_args,
            segment.args !== undefined ? segment.args.constraints : [],
            hir.GenericArgsParentheses.No,
            segment.args === undefined ? span : segment.args.span_ext,
          ),
        )
      : undefined;

  result.args_segment_id = segment.hir_id;
  result.use_for_sig_inheritance = !HirOrTyGenerics.is_trait_impl(result.generics);

  segment.delegation_child_segment = HirOrTyGenerics.pos(result.generics) === GenericsPosition.Child;

  return segment;
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:562 generate_delegation_error
LoweringContext.prototype.generate_delegation_error = function (this: LoweringContext, span: Span, delegation: Delegation): DelegationResults {
  const decl = this.arena.alloc(hir.FnDecl.dummy(span));

  const header = this.generate_header_error();
  const sig: hir.FnSig = { decl, header, span };

  const ident = this.lower_ident(delegation.ident);

  const body_id = this.lower_body((this_) => {
    const path = this_.lower_qpath(
      delegation.id,
      delegation.qself,
      delegation.path,
      "Optional" satisfies ParamMode, // ParamMode::Optional
      "No" satisfies AllowReturnTypeNotation, // AllowReturnTypeNotation::No
      { $: "Disallowed", _0: "Path" } satisfies ImplTraitContext, // ImplTraitContext::Disallowed(ImplTraitPosition::Path)
      undefined,
    );

    const callee_path = this_.arena.alloc(this_.mk_expr({ $: "Path", _0: path }, span));
    const block_ = delegation.body;
    const args: readonly hir.Expr[] = block_ !== undefined ? this_.arena.alloc_slice([this_.lower_block_expr(block_)]) : [];

    const call = this_.arena.alloc(this_.mk_expr({ $: "Call", _0: callee_path, _1: args }, span));

    const block = this_.arena.alloc(new hir.Block([], call, this_.next_id(), hir.BlockCheckMode.DefaultBlock, span, false));

    return [[], this_.mk_expr({ $: "Block", _0: block, _1: undefined }, span)];
  });

  const generics = hir.Generics.empty();
  return { ident, generics, body_id, sig };
};

// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:610 generate_header_error
LoweringContext.prototype.generate_header_error = function (this: LoweringContext): hir.FnHeader {
  return new hir.FnHeader(hir.HeaderSafety.from(hir.Safety.Safe), hir.Constness.NotConst, hir.IsAsync.NotAsync, ExternAbi.Rust);
};

// #[inline]
// rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:620 mk_expr
LoweringContext.prototype.mk_expr = function (this: LoweringContext, kind: hir.ExprKind, span: Span): hir.Expr {
  return new hir.Expr(this.next_id(), kind, span);
};

// rustc-type: compiler/rustc_ast_lowering/src/delegation/mod.rs:625 SelfResolver
// PORT: hand-written (an `impl Visitor` type extends the `Visitor` base class, like rustc_resolve's DefCollector);
// codegen set rustc_ast_lowering should list it under `hand`.
export class SelfResolver extends visit.Visitor {
  constructor(
    public ctxt: LoweringContext,
    public path_id: NodeId,
    public self_param_id: NodeId,
    public overwrites: NodeId[],
  ) {
    super();
  }

  // rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:633 try_replace_id
  try_replace_id(id: NodeId): void {
    const res = this.ctxt.get_partial_res(id);
    if (res !== undefined) {
      const full = res.full_res();
      // `if let Some(Res::Local(sig_id)) = res.full_res() && sig_id == self.path_id`
      if (full !== undefined && full.$ === "Local" && full._0 === this.path_id) {
        this.overwrites.push(id);
        this.ctxt.partial_res_overrides.set(id, this.self_param_id);
      }
    }
  }

  // impl<'ast> Visitor<'ast> for SelfResolver<'_, '_, '_>
  // rustc: compiler/rustc_ast_lowering/src/delegation/mod.rs:645 visit_id
  override visit_id(id: NodeId): undefined {
    this.try_replace_id(id);
    return undefined;
  }
}
