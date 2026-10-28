// Port of compiler/rustc_mir_build/src/check_unsafety.rs (lane mb-unsafety, plan-m4 wave 22): the THIR unsafety checker
// (the `check_unsafety` query provider). The diagnostics are generated (diagnostics.gen.ts, tools/codegen set
// rustc_mir_build).
//
// PORT: `UnsafetyVisitor` (a thir `Visitor` impl) is a hand class extending rustc_middle thir/visit.ts's `Visitor`; its
// field `thir` is `thir_` (the `Visitor::thir()` method has the same name; precedent check_tail_calls.ts). The methods of
// `impl UnsafetyVisitor` are in the class body, in upstream order, before the `Visitor` impl's. `warnings: &'a mut
// Vec<UnusedUnsafeWarning>` is the shared array (the inner visitor of `visit_inner_body` pushes into the outer one's).
// `SafetyContext::UnsafeBlock` is a mutable object: `ref mut used` / `ref mut nested_used_blocks` write its fields, and
// `mem::replace` of `self.safety_context` moves the object (it is never copied, as upstream never clones it).
// `UnsafeOpKind`'s methods live on its companion const (PORTING §8).
import { type AsmMacro } from "../rustc_ast/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { type DiagArgValue } from "../rustc_errors/lib.ts";
import { Safety } from "../rustc_hir/lib.ts";
import { OwnerNode } from "../rustc_hir/hir.ts";
import { type Mutability } from "../rustc_ast_ir/lib.ts";
import { type HirId } from "../rustc_hir_id/lib.ts";
import { DEPRECATED_SAFE_2024, UNSAFE_OP_IN_UNSAFE_FN, UNUSED_UNSAFE } from "../rustc_lint_defs/builtin.gen.ts";
import { type CodegenFnAttrs, type TargetFeature } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { type Block, type ExprId, type Expr, type Pat, type Thir } from "../rustc_middle/thir.ts";
import { Visitor, walk_block, walk_expr, walk_pat } from "../rustc_middle/thir/visit.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import { type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { assert, unreachable, unwrap } from "../std/panic.ts";
import { type Result } from "../std/result.ts";
import {
  AccessToUnionFieldRequiresUnsafe_diagnostic,
  AccessToUnionFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  BorrowOfLayoutConstrainedFieldRequiresUnsafe_diagnostic,
  BorrowOfLayoutConstrainedFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  CallDropExplicitlyRequiresUnsafe_diagnostic,
  CallToDeprecatedSafeFnRequiresUnsafe_diagnostic,
  CallToFunctionWithRequiresUnsafe_diagnostic,
  CallToFunctionWithRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  CallToUnsafeFunctionRequiresUnsafe_diagnostic,
  CallToUnsafeFunctionRequiresUnsafeNameless_diagnostic,
  CallToUnsafeFunctionRequiresUnsafeNamelessUnsafeOpInUnsafeFnAllowed_diagnostic,
  CallToUnsafeFunctionRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  DerefOfRawPointerRequiresUnsafe_diagnostic,
  DerefOfRawPointerRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  InitializingTypeWithUnsafeFieldRequiresUnsafe_diagnostic,
  InitializingTypeWithUnsafeFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  MutationOfLayoutConstrainedFieldRequiresUnsafe_diagnostic,
  MutationOfLayoutConstrainedFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  UnsafeBinderCastRequiresUnsafe_diagnostic,
  UnsafeBinderCastRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  type UnsafeNotInheritedLintNote,
  type UnsafeNotInheritedNote,
  UnsafeOpInUnsafeFnAccessToUnionFieldRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnBorrowOfLayoutConstrainedFieldRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnCallToFunctionWithRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnCallToUnsafeFunctionRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnCallToUnsafeFunctionRequiresUnsafeNameless_diagnostic,
  UnsafeOpInUnsafeFnDerefOfRawPointerRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnInitializingTypeWithUnsafeFieldRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnMutationOfLayoutConstrainedFieldRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnUnsafeBinderCastRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnUseOfExternStaticRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnUseOfInlineAssemblyRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnUseOfMutableStaticRequiresUnsafe_diagnostic,
  UnsafeOpInUnsafeFnUseOfUnsafeFieldRequiresUnsafe_diagnostic,
  UnusedUnsafe_diagnostic,
  type UnusedUnsafeEnclosing,
  UseOfExternStaticRequiresUnsafe_diagnostic,
  UseOfExternStaticRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  UseOfInlineAssemblyRequiresUnsafe_diagnostic,
  UseOfInlineAssemblyRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  UseOfMutableStaticRequiresUnsafe_diagnostic,
  UseOfMutableStaticRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
  UseOfUnsafeFieldRequiresUnsafe_diagnostic,
  UseOfUnsafeFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic,
} from "./diagnostics.ts";

// rustc-type: compiler/rustc_mir_build/src/check_unsafety.rs:21 UnsafetyVisitor
class UnsafetyVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    // PORT: the field `thir` is `thir_` (the `Visitor::thir()` method has the same name).
    public thir_: Thir,
    /// The `HirId` of the current scope, which would be the `HirId`
    /// of the current HIR node, modulo adjustments. Used for lint levels.
    public hir_context: HirId,
    /// The current "safety context". This notably tracks whether we are in an
    /// `unsafe` block, and whether it has been used.
    public safety_context: SafetyContext,
    /// The `#[target_feature]` attributes of the body. Used for checking
    /// calls to functions with `#[target_feature]` (RFC 2396).
    public body_target_features: readonly TargetFeature[],
    /// When inside the LHS of an assignment to a field, this is the type
    /// of the LHS and the span of the assignment expression.
    public assignment_info: Ty | undefined,
    public in_union_destructure: boolean,
    public typing_env: TypingEnv,
    public inside_adt: boolean,
    public warnings: UnusedUnsafeWarning[],

    /// Flag to ensure that we only suggest wrapping the entire function body in
    /// an unsafe block once.
    public suggest_unsafe_block: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:47 in_safety_context
  in_safety_context(safety_context: SafetyContext, f: (this_: UnsafetyVisitor) => void): void {
    const prev_context = this.safety_context;
    this.safety_context = safety_context;

    f(this);

    const safety_context_ = this.safety_context;
    this.safety_context = prev_context;
    if (safety_context_.$ === "UnsafeBlock") {
      const { used, span, hir_id, nested_used_blocks } = safety_context_;
      if (!used) {
        this.warn_unused_unsafe(hir_id, span, undefined);

        if (this.safety_context.$ === "UnsafeBlock") {
          const prev_nested_used_blocks = this.safety_context.nested_used_blocks;
          prev_nested_used_blocks.push(...nested_used_blocks);
        }
      } else {
        for (const block of nested_used_blocks) {
          this.warn_unused_unsafe(block.hir_id, block.span, {
            $: "Block",
            span: this.tcx.sess.source_map().guess_head_span(span),
          });
        }

        switch (this.safety_context.$) {
          case "UnsafeBlock": {
            const prev_nested_used_blocks = this.safety_context.nested_used_blocks;
            prev_nested_used_blocks.push({ hir_id, span });
            break;
          }
          default:
            break;
        }
      }
    }
  }

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:90 emit_deprecated_safe_fn_call
  emit_deprecated_safe_fn_call(span: Span, kind: UnsafeOpKind): boolean {
    let suggestion: Symbol | undefined;
    // Allow calls to deprecated-safe unsafe functions if the caller is
    // from an edition before 2024.
    if (
      kind.$ === "CallToUnsafeFunction" &&
      kind._0 !== undefined &&
      !Span.at_least_rust_2024(span) &&
      (suggestion = find_attr(HasAttrs_DefId.get_attrs(kind._0, this.tcx), (k) =>
        k.$ === "RustcDeprecatedSafe2024" ? k.suggestion : undefined,
      )) !== undefined
    ) {
      const id = kind._0;
      const sm = this.tcx.sess.source_map();
      const guarantee = `that ${Symbol.as_str(suggestion)}`;
      const indent = sm.indentation_before(span);
      const suggestion_ = indent !== undefined ? `${indent.toString()}// FIXME: Audit that ${Symbol.as_str(suggestion)}.\n` : "";

      this.tcx.emit_node_span_lint(
        DEPRECATED_SAFE_2024,
        this.hir_context,
        span,
        CallToDeprecatedSafeFnRequiresUnsafe_diagnostic({
          span,
          function: with_no_trimmed_paths(() => this.tcx.def_path_str(id)),
          sub: {
            start_of_line_suggestion: suggestion_,
            start_of_line: Span.shrink_to_lo(sm.span_extend_to_line(span)),
            left: Span.shrink_to_lo(span),
            right: Span.shrink_to_hi(span),
            guarantee,
          },
        }),
      );
      return true;
    }
    return false;
  }

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:127 requires_unsafe
  requires_unsafe(span: Span, kind: UnsafeOpKind): void {
    const unsafe_op_in_unsafe_fn_allowed = this.unsafe_op_in_unsafe_fn_allowed();
    const sc = this.safety_context;
    if (sc.$ === "BuiltinUnsafeBlock") {
      // (nothing)
    } else if (sc.$ === "UnsafeBlock") {
      // Mark this block as useful (even inside `unsafe fn`, where it is technically
      // redundant -- but we want to eventually enable `unsafe_op_in_unsafe_fn` by
      // default which will require those blocks:
      // https://github.com/rust-lang/rust/issues/71668#issuecomment-1203075594).
      sc.used = true;
    } else if (sc.$ === "UnsafeFn" && unsafe_op_in_unsafe_fn_allowed) {
      // (nothing)
    } else if (sc.$ === "UnsafeFn") {
      const deprecated_safe_fn = this.emit_deprecated_safe_fn_call(span, kind);
      if (!deprecated_safe_fn) {
        // unsafe_op_in_unsafe_fn is disallowed
        UnsafeOpKind.emit_unsafe_op_in_unsafe_fn_lint(kind, this.tcx, this.hir_context, span, this.suggest_unsafe_block);
        this.suggest_unsafe_block = false;
      }
    } else {
      // SafetyContext::Safe
      const deprecated_safe_fn = this.emit_deprecated_safe_fn_call(span, kind);
      if (!deprecated_safe_fn) {
        UnsafeOpKind.emit_requires_unsafe_err(kind, this.tcx, span, this.hir_context, unsafe_op_in_unsafe_fn_allowed);
      }
    }
  }

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:166 warn_unused_unsafe
  warn_unused_unsafe(hir_id: HirId, block_span: Span, enclosing_unsafe: UnusedUnsafeEnclosing | undefined): void {
    this.warnings.push({ hir_id, block_span, enclosing_unsafe });
  }

  /// Whether the `unsafe_op_in_unsafe_fn` lint is `allow`ed at the current HIR node.
  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:176 unsafe_op_in_unsafe_fn_allowed
  unsafe_op_in_unsafe_fn_allowed(): boolean {
    return this.tcx.lint_level_spec_at_node(UNSAFE_OP_IN_UNSAFE_FN, this.hir_context).is_allow();
  }

  /// Handle closures/coroutines/inline-consts, which is unsafecked with their parent body.
  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:181 visit_inner_body
  visit_inner_body(def: LocalDefId): void {
    // PORT: queries.gen.ts types `thir_body`'s value loosely (`[Steal<unknown>, unknown]`); it is `(&Steal<Thir>, ExprId)`.
    const r = this.tcx.thir_body(def) as Result<[Steal<Thir>, ExprId], ErrorGuaranteed>;
    if (r.$ === "Ok") {
      const [inner_thir_, expr] = r._0;
      // Run all other queries that depend on THIR.
      this.tcx.ensure_done().mir_built(def);
      const inner_thir = this.tcx.sess.opts.unstable_opts.no_steal_thir
        ? inner_thir_.borrow()
        : // We don't have other use for the THIR. Steal it to reduce memory usage.
          inner_thir_.steal();
      const hir_context = this.tcx.local_def_id_to_hir_id(def);
      const safety_context = this.safety_context;
      this.safety_context = SafetyContext.Safe;
      const inner_visitor = new UnsafetyVisitor(
        this.tcx,
        inner_thir,
        hir_context,
        safety_context,
        this.body_target_features,
        this.assignment_info,
        false,
        this.typing_env,
        false,
        this.warnings,
        this.suggest_unsafe_block,
      );
      // params in THIR may be unsafe, e.g. a union pattern.
      for (const param of inner_thir.params) {
        const param_pat = param.pat;
        if (param_pat !== undefined) {
          inner_visitor.visit_pat(param_pat);
        }
      }
      // Visit the body.
      inner_visitor.visit_expr(inner_thir.index_ExprId(expr));
      // Unsafe blocks can be used in the inner body, make sure to take it into account
      this.safety_context = inner_visitor.safety_context;
    }
  }

  // impl Visitor for UnsafetyVisitor

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:221 thir
  thir(): Thir {
    return this.thir_;
  }

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:225 visit_block
  override visit_block(block: Block): void {
    const safety_mode = block.safety_mode;
    switch (safety_mode.$) {
      // compiler-generated unsafe code should not count towards the usefulness of
      // an outer unsafe block
      case "BuiltinUnsafe": {
        this.in_safety_context(SafetyContext.BuiltinUnsafeBlock, (this_) => walk_block(this_, block));
        break;
      }
      case "ExplicitUnsafe": {
        const hir_id = safety_mode._0;
        const used = this.tcx.lint_level_spec_at_node(UNUSED_UNSAFE, hir_id).is_allow();
        this.in_safety_context(
          {
            $: "UnsafeBlock",
            span: block.span,
            hir_id,
            used,
            nested_used_blocks: [],
          },
          (this_) => walk_block(this_, block),
        );
        break;
      }
      case "Safe": {
        walk_block(this, block);
        break;
      }
    }
  }

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:252 visit_pat
  override visit_pat(pat: Pat): void {
    if (this.in_union_destructure) {
      switch (pat.kind.$) {
        case "Missing":
          return unreachable();
        // binding to a variable allows getting stuff out of variable
        case "Binding":
        // match is conditional on having this value
        case "Constant":
        case "Variant":
        case "Leaf":
        case "Deref":
        case "DerefPattern":
        case "Range":
        case "Slice":
        case "Array":
        case "Guard":
        // Never constitutes a witness of uninhabitedness.
        case "Never": {
          this.requires_unsafe(pat.span, UnsafeOpKind.AccessToUnionField);
          return; // we can return here since this already requires unsafe
        }
        // wildcard doesn't read anything.
        case "Wild":
        // these just wrap other patterns, which we recurse on below.
        case "Or":
        case "Error":
          break;
      }
    }

    const kind = pat.kind;
    switch (kind.$) {
      case "Leaf": {
        const { subpatterns } = kind;
        const ty_kind = pat.ty.kind();
        if (ty_kind.$ === "Adt") {
          const adt_def = ty_kind._0;
          for (const pat of subpatterns) {
            if (Safety.is_unsafe(adt_def.non_enum_variant().fields[pat.field]!.safety)) {
              this.requires_unsafe(pat.pattern.span, UnsafeOpKind.UseOfUnsafeField);
            }
          }
          if (adt_def.is_union()) {
            const old_in_union_destructure = this.in_union_destructure;
            this.in_union_destructure = true;
            walk_pat(this, pat);
            this.in_union_destructure = old_in_union_destructure;
          } else {
            walk_pat(this, pat);
          }
        } else {
          walk_pat(this, pat);
        }
        break;
      }
      case "Variant": {
        const { adt_def, variant_index, subpatterns } = kind;
        for (const pat of subpatterns) {
          const field = pat.field;
          if (Safety.is_unsafe(adt_def.variant(variant_index).fields[field]!.safety)) {
            this.requires_unsafe(pat.pattern.span, UnsafeOpKind.UseOfUnsafeField);
          }
        }
        walk_pat(this, pat);
        break;
      }
      case "Binding": {
        if (kind.mode._0.$ === "Yes") {
          const rm: Mutability = kind.mode._0._1;
          const ty = kind.ty;
          if (this.inside_adt) {
            const ty_kind = ty.kind();
            if (ty_kind.$ !== "Ref") {
              return span_bug(pat.span, `ByRef::Yes in pattern, but found non-reference type ${display_Ty(ty)}`);
            }
            const ty_ = ty_kind._1;
            switch (rm) {
              case "Not": {
                if (!ty_.is_freeze(this.tcx, this.typing_env)) {
                  this.requires_unsafe(pat.span, UnsafeOpKind.BorrowOfLayoutConstrainedField);
                }
                break;
              }
              case "Mut": {
                this.requires_unsafe(pat.span, UnsafeOpKind.MutationOfLayoutConstrainedField);
                break;
              }
            }
          }
          walk_pat(this, pat);
        } else {
          walk_pat(this, pat);
        }
        break;
      }
      case "Deref":
      case "DerefPattern": {
        const old_inside_adt = this.inside_adt;
        this.inside_adt = false;
        walk_pat(this, pat);
        this.inside_adt = old_inside_adt;
        break;
      }
      default: {
        walk_pat(this, pat);
        break;
      }
    }
  }

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:343 visit_expr
  override visit_expr(expr: Expr): void {
    // could we be in the LHS of an assignment to a field?
    switch (expr.kind.$) {
      case "Field":
      case "VarRef":
      case "UpvarRef":
      case "Scope":
      case "Cast":
        break;

      case "RawBorrow":
      case "Adt":
      case "Array":
      case "Binary":
      case "Block":
      case "Borrow":
      case "Literal":
      case "NamedConst":
      case "NonHirLiteral":
      case "ZstLiteral":
      case "ConstParam":
      case "ConstBlock":
      case "Deref":
      case "Index":
      case "NeverToAny":
      case "PlaceTypeAscription":
      case "ValueTypeAscription":
      case "PlaceUnwrapUnsafeBinder":
      case "ValueUnwrapUnsafeBinder":
      case "WrapUnsafeBinder":
      case "PointerCoercion":
      case "Repeat":
      case "StaticRef":
      case "ThreadLocalRef":
      case "Tuple":
      case "Unary":
      case "Call":
      case "ByUse":
      case "Assign":
      case "AssignOp":
      case "Break":
      case "Closure":
      case "Continue":
      case "ConstContinue":
      case "Return":
      case "Become":
      case "Yield":
      case "Loop":
      case "LoopMatch":
      case "Let":
      case "Match":
      case "If":
      case "InlineAsm":
      case "LogicalOp":
      case "ValueExpr":
      case "Reborrow": {
        // We don't need to save the old value and restore it
        // because all the place expressions can't have more
        // than one child.
        this.assignment_info = undefined;
        break;
      }
    }
    const kind = expr.kind;
    switch (kind.$) {
      case "Scope": {
        const { value, hir_id } = kind;
        const prev_id = this.hir_context;
        this.hir_context = hir_id;
        this.visit_expr(this.thir_.index_ExprId(value));
        this.hir_context = prev_id;
        return; // don't visit the whole expression
      }
      case "Call": {
        const { fun } = kind;
        const fn_ty = this.thir_.index_ExprId(fun).ty;
        const sig = fn_ty.fn_sig(this.tcx);
        let callee_features: readonly TargetFeature[];
        let safe_target_features: boolean;
        const fn_ty_kind = fn_ty.kind();
        if (fn_ty_kind.$ === "FnDef") {
          const func_id = fn_ty_kind._0;
          // PORT: queries.gen.ts types `codegen_fn_attrs`'s value `unknown`; it is `&CodegenFnAttrs`.
          const cg_attrs = this.tcx.codegen_fn_attrs(func_id) as CodegenFnAttrs;
          [callee_features, safe_target_features] = [cg_attrs.target_features, cg_attrs.safe_target_features];
        } else {
          [callee_features, safe_target_features] = [[], false];
        }
        if (Safety.is_unsafe(PolyFnSig.safety(sig)) && !safe_target_features) {
          const func_id = fn_ty_kind.$ === "FnDef" ? fn_ty_kind._0 : undefined;
          this.requires_unsafe(expr.span, { $: "CallToUnsafeFunction", _0: func_id });
        } else if (fn_ty_kind.$ === "FnDef") {
          const func_did = fn_ty_kind._0;
          if (!this.tcx.is_target_feature_call_safe(callee_features, this.body_target_features)) {
            const missing: Symbol[] = callee_features
              .filter(
                (feature) =>
                  feature.kind === "Enabled" &&
                  !this.body_target_features.some((body_feature) => body_feature.name === feature.name),
              )
              .map((feature) => feature.name);
            const build_enabled: Symbol[] = [...this.tcx.sess.internal_target_features].filter((feature) =>
              missing.includes(feature),
            );
            this.requires_unsafe(expr.span, { $: "CallToFunctionWith", function: func_did, missing, build_enabled });
          }
          const trait_did = this.tcx.trait_of_assoc(func_did);
          if (trait_did !== undefined && this.tcx.is_lang_item(trait_did, LangItem.Drop)) {
            this.requires_unsafe(expr.span, { $: "CallDropExplicitly", _0: func_did });
          }
        }
        break;
      }
      case "RawBorrow": {
        const { arg } = kind;
        {
          const k1 = this.thir_.index_ExprId(arg).kind;
          if (k1.$ === "Scope") {
            const k2 = this.thir_.index_ExprId(k1.value).kind;
            if (k2.$ === "Deref") {
              // Taking a raw ref to a deref place expr is always safe.
              // Make sure the expression we're deref'ing is safe, though.
              walk_expr(this, this.thir_.index_ExprId(k2.arg));
              return;
            }
          }
        }

        // Secondly, we allow raw borrows of union field accesses. Peel
        // any of those off, and recurse normally on the LHS, which should
        // reject any unsafe operations within.
        let peeled = arg;
        for (;;) {
          const k1 = this.thir_.index_ExprId(peeled).kind;
          if (k1.$ !== "Scope") break;
          const k2 = this.thir_.index_ExprId(k1.value).kind;
          if (k2.$ !== "Field") break;
          const lhs = k2.lhs;
          const lhs_kind = this.thir_.index_ExprId(lhs).ty.kind();
          if (!(lhs_kind.$ === "Adt" && lhs_kind._0.is_union())) break;
          peeled = lhs;
        }
        walk_expr(this, this.thir_.index_ExprId(peeled));
        // And return so we don't recurse directly onto the union field access(es).
        return;
      }
      case "Deref": {
        const { arg } = kind;
        const arg_kind = this.thir_.index_ExprId(arg).kind;
        if (arg_kind.$ === "StaticRef" || arg_kind.$ === "ThreadLocalRef") {
          const def_id = arg_kind.$ === "StaticRef" ? arg_kind.def_id : arg_kind._0;
          if (this.tcx.is_mutable_static(def_id)) {
            this.requires_unsafe(expr.span, UnsafeOpKind.UseOfMutableStatic);
          } else if (this.tcx.is_foreign_item(def_id)) {
            const dk = this.tcx.def_kind(def_id);
            if (dk.$ === "Static" && dk.safety === "Safe") {
              // (nothing)
            } else {
              this.requires_unsafe(expr.span, UnsafeOpKind.UseOfExternStatic);
            }
          }
        } else if (this.thir_.index_ExprId(arg).ty.is_raw_ptr()) {
          this.requires_unsafe(expr.span, UnsafeOpKind.DerefOfRawPointer);
        }
        break;
      }
      case "InlineAsm": {
        const asm_macro: AsmMacro = kind._0.asm_macro;
        if (asm_macro !== "Asm" && asm_macro !== "NakedAsm") break;
        const operands = kind._0.operands;
        // The `naked` attribute and the `naked_asm!` block form one atomic unit of
        // unsafety, and `naked_asm!` does not itself need to be wrapped in an unsafe block.
        if (asm_macro === "Asm") {
          this.requires_unsafe(expr.span, UnsafeOpKind.UseOfInlineAssembly);
        }

        // For inline asm, do not use `walk_expr`, since we want to handle the label block
        // specially.
        for (const op of operands) {
          switch (op.$) {
            case "In":
            case "InOut":
              this.visit_expr(this.thir().index_ExprId(op.expr));
              break;
            case "Out":
              if (op.expr !== undefined) {
                this.visit_expr(this.thir().index_ExprId(op.expr));
              }
              break;
            case "SplitInOut": {
              const { in_expr, out_expr } = op;
              this.visit_expr(this.thir().index_ExprId(in_expr));
              if (out_expr !== undefined) {
                this.visit_expr(this.thir().index_ExprId(out_expr));
              }
              break;
            }
            case "Const":
            case "SymFn":
            case "SymStatic":
              break;
            case "Label": {
              const { block } = op;
              // Label blocks are safe context.
              // `asm!()` is forced to be wrapped inside unsafe. If there's no special
              // treatment, the label blocks would also always be unsafe with no way
              // of opting out.
              this.in_safety_context(SafetyContext.Safe, (this_) => walk_block(this_, this_.thir().index_BlockId(block)));
              break;
            }
          }
        }
        return;
      }
      case "Adt": {
        const { adt_def, variant_index } = kind._0;
        if (adt_def.variant(variant_index).has_unsafe_fields()) {
          this.requires_unsafe(expr.span, UnsafeOpKind.InitializingTypeWithUnsafeField);
        }
        break;
      }
      case "Closure": {
        const { closure_id } = kind._0;
        this.visit_inner_body(closure_id);
        break;
      }
      case "ConstBlock": {
        const { did } = kind;
        const def_id = did.expect_local();
        this.visit_inner_body(def_id);
        break;
      }
      case "Field": {
        const { variant_index, name } = kind;
        const lhs = this.thir_.index_ExprId(kind.lhs);
        const lhs_kind = lhs.ty.kind();
        if (lhs_kind.$ === "Adt") {
          const adt_def = lhs_kind._0;
          if (Safety.is_unsafe(adt_def.variant(variant_index).fields[name]!.safety)) {
            this.requires_unsafe(expr.span, UnsafeOpKind.UseOfUnsafeField);
          } else if (adt_def.is_union()) {
            const assigned_ty = this.assignment_info;
            if (assigned_ty !== undefined) {
              if (assigned_ty.needs_drop(this.tcx, this.typing_env)) {
                // This would be unsafe, but should be outright impossible since we
                // reject such unions.
                assert(
                  this.tcx.dcx().has_errors() !== undefined,
                  () => `union fields that need dropping should be impossible: ${display_Ty(assigned_ty)}`,
                );
              }
            } else {
              this.requires_unsafe(expr.span, UnsafeOpKind.AccessToUnionField);
            }
          }
        }
        break;
      }
      case "Assign":
      case "AssignOp": {
        const { rhs } = kind;
        const lhs = this.thir_.index_ExprId(kind.lhs);

        // Check for accesses to union fields. Don't have any
        // special handling for AssignOp since it causes a read *and*
        // write to lhs.
        if (expr.kind.$ === "Assign") {
          this.assignment_info = lhs.ty;
          walk_expr(this, lhs);
          this.assignment_info = undefined;
          walk_expr(this, this.thir().index_ExprId(rhs));
          return; // We have already visited everything by now.
        }
        break;
      }
      case "PlaceUnwrapUnsafeBinder":
      case "ValueUnwrapUnsafeBinder":
      case "WrapUnsafeBinder": {
        this.requires_unsafe(expr.span, UnsafeOpKind.UnsafeBinderCast);
        break;
      }
      default:
        break;
    }
    walk_expr(this, expr);
  }
}

// rustc-type: compiler/rustc_mir_build/src/check_unsafety.rs:623 SafetyContext
type SafetyContext =
  | { readonly $: "Safe" }
  | { readonly $: "BuiltinUnsafeBlock" }
  | { readonly $: "UnsafeFn" }
  | { readonly $: "UnsafeBlock"; span: Span; hir_id: HirId; used: boolean; nested_used_blocks: NestedUsedBlock[] };
/** Unit variants of `SafetyContext`, shared frozen singletons. */
const SafetyContext = {
  Safe: Object.freeze({ $: "Safe" as const }),
  BuiltinUnsafeBlock: Object.freeze({ $: "BuiltinUnsafeBlock" as const }),
  UnsafeFn: Object.freeze({ $: "UnsafeFn" as const }),
};

// rustc-type: compiler/rustc_mir_build/src/check_unsafety.rs:631 NestedUsedBlock
interface NestedUsedBlock {
  hir_id: HirId;
  span: Span;
}

// rustc-type: compiler/rustc_mir_build/src/check_unsafety.rs:636 UnusedUnsafeWarning
interface UnusedUnsafeWarning {
  hir_id: HirId;
  block_span: Span;
  enclosing_unsafe: UnusedUnsafeEnclosing | undefined;
}

// rustc-type: compiler/rustc_mir_build/src/check_unsafety.rs:643 UnsafeOpKind
type UnsafeOpKind =
  | { readonly $: "CallToUnsafeFunction"; _0: DefId | undefined }
  | { readonly $: "UseOfInlineAssembly" }
  | { readonly $: "InitializingTypeWithUnsafeField" }
  | { readonly $: "UseOfMutableStatic" }
  | { readonly $: "UseOfExternStatic" }
  | { readonly $: "UseOfUnsafeField" }
  | { readonly $: "DerefOfRawPointer" }
  | { readonly $: "AccessToUnionField" }
  | { readonly $: "MutationOfLayoutConstrainedField" }
  | { readonly $: "BorrowOfLayoutConstrainedField" }
  | {
      readonly $: "CallToFunctionWith";
      function: DefId;
      /// Target features enabled in callee's `#[target_feature]` but missing in
      /// caller's `#[target_feature]`.
      missing: Symbol[];
      /// Target features in `missing` that are enabled at compile time
      /// (e.g., with `-C target-feature`).
      build_enabled: Symbol[];
    }
  | { readonly $: "UnsafeBinderCast" }
  /// Calling `Drop::drop` or `Drop::pin_drop` explicitly.
  | { readonly $: "CallDropExplicitly"; _0: DefId };

/** `missing.iter().map(|feature| Cow::from(feature.to_string())).collect()` as `DiagArgValue::StrListSepByAnd`. */
function str_list_sep_by_and(features: readonly Symbol[]): DiagArgValue {
  return { $: "StrListSepByAnd", _0: features.map((feature) => Symbol.as_str(feature)) };
}

/** Unit variants of `UnsafeOpKind` (shared frozen singletons) and `impl UnsafeOpKind`. */
const UnsafeOpKind = {
  UseOfInlineAssembly: Object.freeze({ $: "UseOfInlineAssembly" as const }),
  InitializingTypeWithUnsafeField: Object.freeze({ $: "InitializingTypeWithUnsafeField" as const }),
  UseOfMutableStatic: Object.freeze({ $: "UseOfMutableStatic" as const }),
  UseOfExternStatic: Object.freeze({ $: "UseOfExternStatic" as const }),
  UseOfUnsafeField: Object.freeze({ $: "UseOfUnsafeField" as const }),
  DerefOfRawPointer: Object.freeze({ $: "DerefOfRawPointer" as const }),
  AccessToUnionField: Object.freeze({ $: "AccessToUnionField" as const }),
  MutationOfLayoutConstrainedField: Object.freeze({ $: "MutationOfLayoutConstrainedField" as const }),
  BorrowOfLayoutConstrainedField: Object.freeze({ $: "BorrowOfLayoutConstrainedField" as const }),
  UnsafeBinderCast: Object.freeze({ $: "UnsafeBinderCast" as const }),

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:671 emit_unsafe_op_in_unsafe_fn_lint
  emit_unsafe_op_in_unsafe_fn_lint(self: UnsafeOpKind, tcx: TyCtxt, hir_id: HirId, span: Span, suggest_unsafe_block: boolean): void {
    if (tcx.hir_opt_delegation_sig_id(hir_id.owner.def_id) !== undefined) {
      // The body of the delegation item is synthesized, so it makes no sense
      // to emit this lint.
      return;
    }
    const parent_id = tcx.hir_get_parent_item(hir_id);
    const parent_owner = tcx.hir_owner_node(parent_id);
    const sig = OwnerNode.fn_sig(parent_owner);
    const should_suggest =
      sig !== undefined &&
      // Do not suggest for safe target_feature functions
      sig.header.safety.$ === "Normal" &&
      sig.header.safety._0 === "Unsafe";
    let unsafe_not_inherited_note: UnsafeNotInheritedLintNote | undefined;
    if (should_suggest) {
      if (suggest_unsafe_block) {
        const body_span = tcx.hir_body(unwrap(OwnerNode.body_id(parent_owner))).value.span;
        unsafe_not_inherited_note = {
          signature_span: tcx.def_span(LocalDefId.to_def_id(parent_id.def_id)),
          body_span,
        };
      } else {
        unsafe_not_inherited_note = undefined;
      }
    } else {
      unsafe_not_inherited_note = undefined;
    }
    // FIXME: ideally we would want to trim the def paths, but this is not
    // feasible with the current lint emission API (see issue #106126).
    switch (self.$) {
      case "CallToUnsafeFunction": {
        const did = self._0;
        if (did !== undefined) {
          tcx.emit_node_span_lint(
            UNSAFE_OP_IN_UNSAFE_FN,
            hir_id,
            span,
            UnsafeOpInUnsafeFnCallToUnsafeFunctionRequiresUnsafe_diagnostic({
              span,
              function: with_no_trimmed_paths(() => tcx.def_path_str(did)),
              unsafe_not_inherited_note,
            }),
          );
        } else {
          tcx.emit_node_span_lint(
            UNSAFE_OP_IN_UNSAFE_FN,
            hir_id,
            span,
            UnsafeOpInUnsafeFnCallToUnsafeFunctionRequiresUnsafeNameless_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        }
        break;
      }
      case "UseOfInlineAssembly":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnUseOfInlineAssemblyRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "InitializingTypeWithUnsafeField":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnInitializingTypeWithUnsafeFieldRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "UseOfMutableStatic":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnUseOfMutableStaticRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "UseOfExternStatic":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnUseOfExternStaticRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "UseOfUnsafeField":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnUseOfUnsafeFieldRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "DerefOfRawPointer":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnDerefOfRawPointerRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "AccessToUnionField":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnAccessToUnionFieldRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "MutationOfLayoutConstrainedField":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnMutationOfLayoutConstrainedFieldRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "BorrowOfLayoutConstrainedField":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnBorrowOfLayoutConstrainedFieldRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "CallToFunctionWith": {
        const { function: function_, missing, build_enabled } = self;
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnCallToFunctionWithRequiresUnsafe_diagnostic({
            span,
            function: with_no_trimmed_paths(() => tcx.def_path_str(function_)),
            missing_target_features: str_list_sep_by_and(missing),
            missing_target_features_count: missing.length,
            note: build_enabled.length !== 0,
            build_target_features: str_list_sep_by_and(build_enabled),
            build_target_features_count: build_enabled.length,
            unsafe_not_inherited_note,
          }),
        );
        break;
      }
      case "UnsafeBinderCast":
        tcx.emit_node_span_lint(
          UNSAFE_OP_IN_UNSAFE_FN,
          hir_id,
          span,
          UnsafeOpInUnsafeFnUnsafeBinderCastRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
          }),
        );
        break;
      case "CallDropExplicitly": {
        span_bug(span, "`Drop::drop` or `Drop::pin_drop` should not be called explicitly");
      }
    }
  },

  // rustc: compiler/rustc_mir_build/src/check_unsafety.rs:840 emit_requires_unsafe_err
  emit_requires_unsafe_err(self: UnsafeOpKind, tcx: TyCtxt, span: Span, hir_context: HirId, unsafe_op_in_unsafe_fn_allowed: boolean): void {
    let note_non_inherited: [HirId, unknown] | undefined;
    for (const [id, node] of tcx.hir_parent_iter(hir_context)) {
      let found: boolean;
      let sig;
      if (node.$ === "Expr" && node._0.kind.$ === "Block" && node._0.kind._0.rules.$ === "UnsafeBlock") {
        found = true;
      } else if (
        (sig = tcx.hir_fn_sig_by_hir_id(id)) !== undefined &&
        sig.header.safety.$ === "Normal" &&
        sig.header.safety._0 === "Unsafe"
      ) {
        found = true;
      } else {
        found = false;
      }
      if (found) {
        note_non_inherited = [id, node];
        break;
      }
    }
    let unsafe_not_inherited_note: UnsafeNotInheritedNote | undefined;
    if (note_non_inherited !== undefined) {
      const [id] = note_non_inherited;
      let span = tcx.hir_span(id);
      span = tcx.sess.source_map().guess_head_span(span);
      unsafe_not_inherited_note = { span };
    } else {
      unsafe_not_inherited_note = undefined;
    }

    const dcx = tcx.dcx();
    switch (self.$) {
      case "CallToUnsafeFunction": {
        const did = self._0;
        if (did !== undefined && unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            CallToUnsafeFunctionRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
              function: tcx.def_path_str(did),
            }),
          );
        } else if (did !== undefined) {
          dcx.emit_err(
            CallToUnsafeFunctionRequiresUnsafe_diagnostic({
              span,
              unsafe_not_inherited_note,
              function: tcx.def_path_str(did),
            }),
          );
        } else if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            CallToUnsafeFunctionRequiresUnsafeNamelessUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(
            CallToUnsafeFunctionRequiresUnsafeNameless_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        }
        break;
      }
      case "UseOfInlineAssembly":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            UseOfInlineAssemblyRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(UseOfInlineAssemblyRequiresUnsafe_diagnostic({ span, unsafe_not_inherited_note }));
        }
        break;
      case "InitializingTypeWithUnsafeField":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            InitializingTypeWithUnsafeFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(
            InitializingTypeWithUnsafeFieldRequiresUnsafe_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        }
        break;
      case "UseOfMutableStatic":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            UseOfMutableStaticRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(UseOfMutableStaticRequiresUnsafe_diagnostic({ span, unsafe_not_inherited_note }));
        }
        break;
      case "UseOfExternStatic":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            UseOfExternStaticRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(UseOfExternStaticRequiresUnsafe_diagnostic({ span, unsafe_not_inherited_note }));
        }
        break;
      case "UseOfUnsafeField":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            UseOfUnsafeFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(UseOfUnsafeFieldRequiresUnsafe_diagnostic({ span, unsafe_not_inherited_note }));
        }
        break;
      case "DerefOfRawPointer":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            DerefOfRawPointerRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(DerefOfRawPointerRequiresUnsafe_diagnostic({ span, unsafe_not_inherited_note }));
        }
        break;
      case "AccessToUnionField":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            AccessToUnionFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(AccessToUnionFieldRequiresUnsafe_diagnostic({ span, unsafe_not_inherited_note }));
        }
        break;
      case "MutationOfLayoutConstrainedField":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            MutationOfLayoutConstrainedFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(
            MutationOfLayoutConstrainedFieldRequiresUnsafe_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        }
        break;
      case "BorrowOfLayoutConstrainedField":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            BorrowOfLayoutConstrainedFieldRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(
            BorrowOfLayoutConstrainedFieldRequiresUnsafe_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        }
        break;
      case "CallToFunctionWith": {
        const { function: function_, missing, build_enabled } = self;
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            CallToFunctionWithRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              missing_target_features: str_list_sep_by_and(missing),
              missing_target_features_count: missing.length,
              note: build_enabled.length !== 0,
              build_target_features: str_list_sep_by_and(build_enabled),
              build_target_features_count: build_enabled.length,
              unsafe_not_inherited_note,
              function: tcx.def_path_str(function_),
            }),
          );
        } else {
          dcx.emit_err(
            CallToFunctionWithRequiresUnsafe_diagnostic({
              span,
              missing_target_features: str_list_sep_by_and(missing),
              missing_target_features_count: missing.length,
              note: build_enabled.length !== 0,
              build_target_features: str_list_sep_by_and(build_enabled),
              build_target_features_count: build_enabled.length,
              unsafe_not_inherited_note,
              function: tcx.def_path_str(function_),
            }),
          );
        }
        break;
      }
      case "UnsafeBinderCast":
        if (unsafe_op_in_unsafe_fn_allowed) {
          dcx.emit_err(
            UnsafeBinderCastRequiresUnsafeUnsafeOpInUnsafeFnAllowed_diagnostic({
              span,
              unsafe_not_inherited_note,
            }),
          );
        } else {
          dcx.emit_err(UnsafeBinderCastRequiresUnsafe_diagnostic({ span, unsafe_not_inherited_note }));
        }
        break;
      case "CallDropExplicitly": {
        const did = self._0;
        dcx.emit_err(
          CallDropExplicitlyRequiresUnsafe_diagnostic({
            span,
            unsafe_not_inherited_note,
            function: tcx.def_path_str(did),
          }),
        );
        break;
      }
    }
  },
};

// rustc: compiler/rustc_mir_build/src/check_unsafety.rs:1053 check_unsafety
export function check_unsafety(tcx: TyCtxt, def: LocalDefId): null {
  // Closures and inline consts are handled by their owner, if it has a body
  assert(!tcx.is_typeck_child(LocalDefId.to_def_id(def)), "assertion failed: !tcx.is_typeck_child(def.to_def_id())");
  // Also, don't safety check custom MIR
  if (find_attr(HasAttrs_LocalDefId.get_attrs(def, tcx), (k) => (k.$ === "CustomMir" ? null : undefined)) !== undefined) {
    return null;
  }

  // PORT: queries.gen.ts types `thir_body`'s value loosely (`[Steal<unknown>, unknown]`); it is `(&Steal<Thir>, ExprId)`.
  const r = tcx.thir_body(def) as Result<[Steal<Thir>, ExprId], ErrorGuaranteed>;
  if (r.$ === "Err") return null;
  const [thir_, expr] = r._0;
  // Runs all other queries that depend on THIR.
  tcx.ensure_done().mir_built(def);
  const thir = tcx.sess.opts.unstable_opts.no_steal_thir
    ? thir_.borrow()
    : // We don't have other use for the THIR. Steal it to reduce memory usage.
      thir_.steal();

  const hir_id = tcx.local_def_id_to_hir_id(def);
  const fn_sig = tcx.hir_fn_sig_by_hir_id(hir_id);
  let safety_context: SafetyContext;
  if (fn_sig === undefined) {
    safety_context = SafetyContext.Safe;
  } else {
    const safety = fn_sig.header.safety;
    switch (safety.$) {
      // We typeck the body as safe, but otherwise treat it as unsafe everywhere else.
      // Call sites to other SafeTargetFeatures functions are checked explicitly and don't need
      // to care about safety of the body.
      case "SafeTargetFeatures":
        safety_context = SafetyContext.Safe;
        break;
      case "Normal":
        switch (safety._0) {
          case "Unsafe":
            safety_context = SafetyContext.UnsafeFn;
            break;
          case "Safe":
            safety_context = SafetyContext.Safe;
            break;
        }
        break;
    }
  }
  // PORT: ty/context.ts types `body_codegen_attrs` with a local interface listing only `target_features: { name }[]`;
  // the value is the real `CodegenFnAttrs`.
  const body_target_features = (tcx.body_codegen_attrs(LocalDefId.to_def_id(def)) as CodegenFnAttrs).target_features;
  const warnings: UnusedUnsafeWarning[] = [];
  const visitor = new UnsafetyVisitor(
    tcx,
    thir,
    hir_id,
    safety_context,
    body_target_features,
    undefined,
    false,
    TypingEnv.post_typeck_until_borrowck_for_mir_build(tcx, def),
    false,
    warnings,
    true,
  );
  // params in THIR may be unsafe, e.g. a union pattern.
  for (const param of thir.params) {
    const param_pat = param.pat;
    if (param_pat !== undefined) {
      visitor.visit_pat(param_pat);
    }
  }
  // Visit the body.
  visitor.visit_expr(thir.index_ExprId(expr));

  warnings.sort((a, b) => {
    const [a_lo, a_hi] = Span.lo_hi(a.block_span);
    const [b_lo, b_hi] = Span.lo_hi(b.block_span);
    return a_lo - b_lo || a_hi - b_hi;
  });
  for (const { hir_id, block_span: block_span_, enclosing_unsafe } of warnings) {
    const block_span = tcx.sess.source_map().guess_head_span(block_span_);
    tcx.emit_node_span_lint(
      UNUSED_UNSAFE,
      hir_id,
      block_span,
      UnusedUnsafe_diagnostic({ span: block_span, enclosing: enclosing_unsafe }),
    );
  }
  return null;
}
