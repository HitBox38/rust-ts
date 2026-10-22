// Port of compiler/rustc_mir_build/src/builder/expr/into.rs (lane mb-expr-b, plan-m4 wave 22; declared by lane
// builder-contract). Conventions: builder/mod.ts's header and docs/handoff/builder-contract.md.
//! See docs in build/expr/mod.rs
import { FieldIdx } from "../../../rustc_abi/layout.ts";
import { AsmMacro, InlineAsmOptions } from "../../../rustc_ast/lib.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { clone_UnrollAttr, type UnrollAttr } from "../../../rustc_attr_ir/lib.ts";
import {
  type BasicBlock,
  BorrowKind,
  type Const,
  ConstOperand,
  type InlineAsmMacro,
  type InlineAsmOperand as mir_InlineAsmOperand,
  LocalDecl,
  LocalInfo,
  type Mutability,
  Operand,
  type Place,
  Place_from_Local,
  ProjectionElem,
  RawPtrKind_from_Mutability,
  type Rvalue,
  SourceInfo,
  TerminatorKind,
  UnevaluatedConst,
  UnwindAction,
  clone_Operand,
} from "../../../rustc_middle/mir/mod.ts";
import { Const as MirConst } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId, type ExprKind } from "../../../rustc_middle/thir.ts";
import { display_Ty } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { debug_Ty, Ty } from "../../../rustc_middle/ty/mod.ts";
import { UserTypeAnnotationIndex } from "../../../rustc_middle/ty/typeck_results.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import { DUMMY_SP, Span, type Spanned } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { sym, Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq, unwrap } from "../../../std/panic.ts";
import { LoopMatchArmWithGuard_diagnostic, LoopMatchUnsupportedType_diagnostic } from "../../diagnostics.ts";
import { DeclareLetBindings, Exhaustive, HasMatchGuard, LowerIfCondArgs, clone_BuiltMatchTree } from "../matches/mod.gen.ts";
import { LintLevel } from "../scope.gen.ts";
import { and, BlockAnd, BlockFrame, Builder, NeedsTemporary, unit } from "../mod.ts";
import { type Pat } from "../../../rustc_middle/thir.ts";
import { type MutRef } from "../../../std/mut_ref.ts";

declare module "../mod.ts" {
  interface Builder {
    // into.rs:26
    expr_into_dest(destination: Place, block: BasicBlock, expr_id: ExprId): BlockAnd<null>;
    // into.rs:941
    is_let(expr: ExprId): boolean;
  }
}

/// Compile `expr`, storing the result into `destination`, which
/// is assumed to be uninitialized.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_mir_build/src/builder/expr/into.rs:26 expr_into_dest
Builder.prototype.expr_into_dest = function (this: Builder, destination: Place, block: BasicBlock, expr_id: ExprId): BlockAnd<null> {
  // since we frequently have to reference `self` from within a
  // closure, where `self` would be shadowed, it's easier to
  // just use the name `this` uniformly
  // let this = self; // See "LET_THIS_SELF".
  const expr = this.thir.index_ExprId(expr_id);
  const expr_span = expr.span;
  const source_info = this.source_info(expr_span);

  const expr_is_block_or_scope = expr.kind.$ === "Block" || expr.kind.$ === "Scope";

  if (!expr_is_block_or_scope) {
    this.block_context.push(BlockFrame.SubExpr);
  }

  let block_and: BlockAnd<null>;
  const kind: ExprKind = expr.kind;
  switch (kind.$) {
    case "Scope": {
      const { region_scope: region_scope_, hir_id, value } = kind;
      const region_scope: [typeof region_scope_, SourceInfo] = [region_scope_, source_info];
      block_and = this.in_scope(region_scope, { $: "Explicit", _0: hir_id }, (this_) => {
        this_.push_coverage_point_for_expr(block, source_info, hir_id);
        return this_.expr_into_dest(destination, block, value);
      });
      break;
    }
    case "Block": {
      const ast_block = kind.block;
      block_and = this.ast_block(destination, block, ast_block, source_info);
      break;
    }
    case "Match": {
      const { scrutinee, arms } = kind;
      block_and = this.match_expr(destination, block, scrutinee, arms, expr_span);
      break;
    }
    case "If": {
      const { cond, then, else_opt, if_then_scope } = kind;
      const then_span = this.thir.index_ExprId(then).span;
      const then_source_info = this.source_info(then_span);
      const condition_scope = this.local_scope();

      const true_and_false_blocks: BlockAnd<BasicBlock> = this.in_scope(
        [if_then_scope, then_source_info],
        LintLevel.Inherited,
        (this_) => {
          // FIXME: Does this need extra logic to handle let-chains?
          let source_info: SourceInfo;
          if (this_.is_let(cond)) {
            const variable_scope = this_.new_source_scope(then_span, LintLevel.Inherited);
            this_.source_scope = variable_scope;
            source_info = new SourceInfo(then_span, variable_scope);
          } else {
            source_info = this_.source_info(then_span);
          }

          // Lower the condition, and have it branch into *true* and *false* blocks.
          const [true_block, false_block] = this_.in_if_then_scope(condition_scope, then_span, (this_) => {
            const true_block = BlockAnd.into_block(
              this_.lower_if_condition(
                block,
                cond,
                new LowerIfCondArgs(condition_scope, source_info, DeclareLetBindings.Yes),
              ),
            );

            // Lower the `then` arm into its block.
            return this_.expr_into_dest(destination, true_block, then);
          });

          // Pack `(true_block, false_block)` into `BlockAnd<BasicBlock>`.
          return and(true_block, false_block);
        },
      );

      // Unpack `BlockAnd<BasicBlock>` into `(true_block, false_block)`.
      let true_block: BasicBlock;
      let false_block: BasicBlock;
      [true_block, false_block] = true_and_false_blocks;

      // If there is an `else` arm, lower it into `false_block`.
      if (else_opt !== undefined) {
        const else_expr = else_opt;
        false_block = BlockAnd.into_block(this.expr_into_dest(destination, false_block, else_expr));
      } else {
        // There is no `else` arm, so we know both arms have type `()`.
        // Generate the implicit `else {}` by assigning unit.
        const correct_si = this.source_info(Span.shrink_to_hi(expr_span));
        this.push_coverage_point_for_implicit_else(false_block, correct_si, expr);
        this.cfg.push_assign_unit(false_block, correct_si, destination, this.tcx);
      }

      // The `then` and `else` arms have been lowered into their respective
      // blocks, so make both of them meet up in a new block.
      const join_block = this.cfg.start_new_block();
      this.cfg.goto(true_block, source_info, join_block);
      this.cfg.goto(false_block, source_info, join_block);
      block_and = unit(join_block);
      break;
    }
    case "Let": {
      // After desugaring, `let` expressions should only appear inside `if`
      // expressions or `match` guards, possibly nested within a let-chain.
      // In both cases they are specifically handled by the lowerings of
      // those expressions, so this case is currently unreachable.
      return span_bug(expr_span, "unexpected let expression outside of if or match-guard");
    }
    case "NeverToAny": {
      const source = kind.source;
      const source_expr = this.thir.index_ExprId(source);
      const is_call = source_expr.kind.$ === "Call" || source_expr.kind.$ === "InlineAsm";

      // (#66975) Source could be a const of type `!`, so has to
      // exist in the generated MIR.
      [block] = this.as_temp(block, this.local_temp_lifetime(), source, "Mut");

      // This is an optimization. If the expression was a call then we already have an
      // unreachable block. Don't bother to terminate it and create a new one.
      if (is_call) {
        block_and = unit(block);
      } else {
        this.cfg.terminate(block, source_info, TerminatorKind.Unreachable);
        const end_block = this.cfg.start_new_block();
        block_and = unit(end_block);
      }
      break;
    }
    case "LogicalOp": {
      const { op, lhs, rhs } = kind;
      const condition_scope = this.local_scope();
      const source_info = this.source_info(expr.span);

      // We first evaluate the left-hand side of the predicate ...
      const [true_block, false_block] = this.in_if_then_scope(condition_scope, expr.span, (this_) => {
        return this_.lower_if_condition(
          block,
          lhs,
          new LowerIfCondArgs(condition_scope, source_info, DeclareLetBindings.LetNotPermitted),
        );
      });

      // At this point, the control flow splits into a short-circuiting path
      // and a continuation path.
      // - If the operator is `&&`, passing `lhs` leads to continuation of evaluation on `rhs`;
      //   failing it leads to the short-circuting path which assigns `false` to the place.
      // - If the operator is `||`, failing `lhs` leads to continuation of evaluation on `rhs`;
      //   passing it leads to the short-circuting path which assigns `true` to the place.
      let short_circuit_block: BasicBlock;
      let short_circuit_value: boolean;
      let continue_block: BasicBlock;
      switch (op) {
        case "And":
          [short_circuit_block, short_circuit_value, continue_block] = [false_block, false, true_block];
          break;
        case "Or":
          [short_circuit_block, short_circuit_value, continue_block] = [true_block, true, false_block];
          break;
      }
      this.cfg.push_assign_constant(
        short_circuit_block,
        source_info,
        destination,
        new ConstOperand(expr.span, undefined, MirConst.from_bool(this.tcx, short_circuit_value)),
      );
      const rhs_block: MutRef<BasicBlock> = { value: BlockAnd.into_block(this.expr_into_dest(destination, continue_block, rhs)) };
      // Instrument the lowered RHS's value for condition coverage.
      // (Does nothing if condition coverage is not enabled.)
      this.visit_coverage_standalone_condition(rhs, destination, rhs_block);

      // Reunite the continuation path and the short-circuit path.
      const join_block = this.cfg.start_new_block();
      this.cfg.goto(rhs_block.value, source_info, join_block);
      this.cfg.goto(short_circuit_block, source_info, join_block);
      block_and = unit(join_block);
      break;
    }
    case "Loop": {
      const body = kind.body;
      // [block]
      //    |
      //   [loop_block] -> [body_block] -/eval. body/-> [body_block_end]
      //    |        ^                                         |
      // false link  |                                         |
      //    |        +-----------------------------------------+
      //    +-> [diverge_cleanup]
      // The false link is required to make sure borrowck considers unwinds through the
      // body, even when the exact code in the body cannot unwind

      const loop_block = this.cfg.start_new_block();

      // Start the loop.
      this.cfg.goto(block, source_info, loop_block);

      block_and = this.in_breakable_scope(loop_block, destination, expr_span, (this_) => {
        // conduct the test, if necessary
        const body_block = this_.cfg.start_new_block();
        this_.cfg.terminate(loop_block, source_info, {
          $: "FalseUnwind",
          real_target: body_block,
          unwind: UnwindAction.Continue,
        });
        this_.diverge_from(loop_block);

        // The “return” value of the loop body must always be a unit. We therefore
        // introduce a unit temporary as the destination for the loop body.
        const tmp = this_.get_unit_temp();
        // Execute the body, branching back to the test.
        const body_block_end = BlockAnd.into_block(this_.expr_into_dest(tmp, body_block, body));

        const attrs = this_.thir.loop_hint_attrs.get(expr_id);
        const loop_hint_attrs: UnrollAttr[] = attrs !== undefined ? attrs.map(clone_UnrollAttr) : [];
        this_.cfg.goto_with_hints(body_block_end, source_info, loop_block, loop_hint_attrs);

        // Loops are only exited by `break` expressions.
        return undefined;
      });
      break;
    }
    case "LoopMatch": {
      const {
        state,
        region_scope,
        match_data: { arms, span: match_span, scrutinee },
      } = kind;
      // Intuitively, this is a combination of a loop containing a labeled block
      // containing a match.
      //
      // The only new bit here is that the lowering of the match is wrapped in a
      // `in_const_continuable_scope`, which makes the match arms and their target basic
      // block available to the lowering of `#[const_continue]`.

      // rustc: compiler/rustc_mir_build/src/builder/expr/into.rs:270 is_supported_loop_match_type
      function is_supported_loop_match_type(ty: Ty): boolean {
        const k = ty.kind();
        switch (k.$) {
          case "Uint":
          case "Int":
          case "Float":
          case "Bool":
          case "Char":
            return true;
          case "Adt": {
            const adt_def = k._0;
            switch (adt_def.adt_kind()) {
              case "Struct":
              case "Union":
                return false;
              case "Enum":
                return adt_def.variants().every((v) => v.fields.length === 0);
            }
          }
          // falls through (unreachable: the inner switch is exhaustive)
          default:
            return false;
        }
      }

      const state_ty = this.thir.exprs[state]!.ty;
      if (!is_supported_loop_match_type(state_ty)) {
        const span = this.thir.exprs[state]!.span;
        this.tcx.dcx().emit_fatal(LoopMatchUnsupportedType_diagnostic({ span, ty: state_ty }));
      }

      const loop_block = this.cfg.start_new_block();

      // Start the loop.
      this.cfg.goto(block, source_info, loop_block);

      block_and = this.in_breakable_scope(loop_block, destination, expr_span, (this_) => {
        // Logic for `loop`.
        let body_block = this_.cfg.start_new_block();
        this_.cfg.terminate(loop_block, source_info, {
          $: "FalseUnwind",
          real_target: body_block,
          unwind: UnwindAction.Continue,
        });
        this_.diverge_from(loop_block);

        // Logic for `match`.
        const scrutinee_span = this_.thir.exprs[scrutinee]!.span;
        let scrutinee_place_builder;
        [body_block, scrutinee_place_builder] = this_.lower_scrutinee(body_block, scrutinee);

        const match_start_span = Span.to(Span.shrink_to_lo(match_span), scrutinee_span);

        const patterns: [Pat, HasMatchGuard][] = [];
        for (const arm_id of arms) {
          const arm = this_.thir.index_ArmId(arm_id);

          if (arm.guard !== undefined) {
            const guard = arm.guard;
            const span = this_.thir.exprs[guard]!.span;
            this_.tcx.dcx().emit_fatal(LoopMatchArmWithGuard_diagnostic({ span }));
          }

          patterns.push([arm.pattern, HasMatchGuard.No]);
        }

        // The `built_tree` maps match arms to their basic block (where control flow
        // jumps to when a value matches the arm). This structure is stored so that a
        // `#[const_continue]` can figure out what basic block to jump to.
        const built_tree = this_.lower_match_tree(
          body_block,
          scrutinee_span,
          scrutinee_place_builder,
          match_start_span,
          patterns,
          Exhaustive.Yes,
        );

        const state_place = scrutinee_place_builder.to_place(this_);
        const state_result = this_.temp(state_ty, expr_span);
        const state_result_place = state_result;

        // This is logic for the labeled block: a block is a drop scope, hence
        // `in_scope`, and a labeled block can be broken out of with a `break 'label`,
        // hence the `in_breakable_scope`.
        //
        // The state update is still modeled like `state = 'blk: { ... }`: normal
        // match arm results and ordinary breaks to the block are first written to
        // `state_result_place`, then written back to `state_place`. This avoids
        // building an overlapping assignment like `state = state`.
        //
        // Then `in_const_continuable_scope` stores information for the lowering of
        // `#[const_continue]`, which still updates the actual `state_place` directly
        // so it can jump to the statically known next match branch.
        [body_block] = this_.in_scope([region_scope, source_info], LintLevel.Inherited, (this_) => {
          return this_.in_const_continuable_scope(
            arms.slice(),
            clone_BuiltMatchTree(built_tree),
            state_place,
            expr_span,
            (this_) => {
              const block = BlockAnd.into_block(
                this_.in_breakable_scope(undefined, state_result_place, expr_span, (this_) => {
                  return this_.lower_match_arms(
                    state_result_place,
                    scrutinee_place_builder,
                    scrutinee_span,
                    arms,
                    built_tree,
                    this_.source_info(match_span),
                  );
                }),
              );

              this_.cfg.push_assign(block, source_info, state_place, {
                $: "Use",
                _0: this_.consume_by_copy_or_move(state_result_place),
                _1: "Yes",
              });
              return unit(block);
            },
          );
        });

        this_.cfg.goto(body_block, source_info, loop_block);

        // Loops are only exited by `break` expressions.
        return undefined;
      });
      break;
    }
    case "Call": {
      // Some intrinsics are handled here because they desperately want to avoid introducing
      // unnecessary copies.
      const ty_kind = kind.ty.kind();
      const intrinsic = ty_kind.$ === "FnDef" ? this.tcx.intrinsic(ty_kind._0) : undefined;
      if (
        ty_kind.$ === "FnDef" &&
        intrinsic !== undefined &&
        (intrinsic.name === sym.write_via_move || intrinsic.name === sym.write_box_via_move)
      ) {
        const { fun, args } = kind;
        const generic_args = unwrap(Binder.no_bound_vars(ty_kind._1, fold_GenericArgs));
        // We still have to evaluate the callee expression as normal (but we don't care
        // about its result).
        let _fun: Operand;
        [block, _fun] = this.as_local_operand(block, fun);

        switch (intrinsic.name) {
          case sym.write_via_move: {
            // `write_via_move(ptr, val)` becomes `*ptr = val` but without any dropping.

            // The destination must have unit type (so we don't actually have to store anything
            // into it).
            assert(destination.ty(this.local_decls, this.tcx).ty.is_unit(), "assertion failed: destination.ty(&this.local_decls, this.tcx).ty.is_unit()");

            // Compile this to an assignment of the argument into the destination.
            if (args.length !== 2) {
              return span_bug(expr_span, "invalid write_via_move call");
            }
            const [ptr_, val] = args as [ExprId, ExprId];
            let ptr_op: Operand;
            [block, ptr_op] = this.as_local_operand(block, ptr_);
            const ptr = Operand.place(ptr_op);
            if (ptr === undefined) {
              return span_bug(expr_span, "invalid write_via_move call");
            }
            const ptr_deref = ptr.project_deeper([ProjectionElem.Deref], this.tcx);
            block_and = this.expr_into_dest(ptr_deref, block, val);
            break;
          }
          case sym.write_box_via_move: {
            // The signature is:
            // `fn write_box_via_move<T>(b: Box<MaybeUninit<T>>, val: T) -> Box<MaybeUninit<T>>`.
            // `write_box_via_move(b, val)` becomes
            // ```
            // (*b).value.value.value = val;
            // b
            // ```
            // One crucial aspect of this lowering is that the generated code must
            // cause the borrow checker to enforce that `val` lives sufficiently
            // long to be stored in `b`. The above lowering does this; anything that
            // involves a `*const T` or a `NonNull<T>` does not as those are covariant.

            // Extract the operands, compile `b`.
            if (args.length !== 2) {
              return span_bug(expr_span, "invalid init_box_via_move call");
            }
            const [b_, val] = args as [ExprId, ExprId];
            let b_op: Operand;
            [block, b_op] = this.as_local_operand(block, b_);
            const b = Operand.place(b_op);
            if (b === undefined) {
              return span_bug(expr_span, "invalid init_box_via_move call");
            }
            const tcx = this.tcx;
            const decls = this.local_decls;

            // `b` is a `Box<MaybeUninit<T>>`.
            let place = b.project_deeper([ProjectionElem.Deref], tcx);
            // Current type: `MaybeUninit<T>`. Field #1 is `ManuallyDrop<T>`.
            place = place.project_to_field(FieldIdx.from_u32(1), decls, tcx);
            // Current type: `ManuallyDrop<T>`. Field #0 is `T`.
            place = place.project_to_field(FieldIdx.ZERO, decls, tcx);
            // Sanity check.
            assert_eq(place.ty(decls, tcx).ty, generic_args.type_at(0), (t) => debug_Ty(t, PLAIN));

            // Store `val` into place.
            [block] = this.expr_into_dest(place, block, val);

            // Return `b`
            this.cfg.push_assign(
              block,
              source_info,
              destination,
              // Move from `b` so that does not get dropped any more.
              { $: "Use", _0: { $: "Move", _0: b }, _1: "Yes" },
            );
            block_and = unit(block);
            break;
          }
          default:
            return bug();
        }
        break;
      }
      const { fun: fun_, args, from_hir_call, fn_span } = kind;
      let fun: Operand;
      [block, fun] = this.as_local_operand(block, fun_);
      const args_: Spanned<Operand>[] = args.map((arg) => {
        let node: Operand;
        [block, node] = this.as_local_call_operand(block, arg);
        return { node, span: this.thir.exprs[arg]!.span };
      });

      const success = this.cfg.start_new_block();

      this.record_operands_moved(args_);

      // debug!("expr_into_dest: fn_span={:?}", fn_span);

      this.cfg.terminate(block, source_info, {
        $: "Call",
        func: fun,
        args: args_,
        unwind: UnwindAction.Continue,
        destination,
        target: success,
        call_source: from_hir_call ? "Normal" : "OverloadedOperator",
        fn_span,
      });
      this.diverge_from(block);
      block_and = unit(success);
      break;
    }
    case "ByUse": {
      const { expr: expr_, span } = kind;
      let place: Place;
      [block, place] = this.as_place(block, expr_);
      const ty = place.ty(this.local_decls, this.tcx).ty;

      if (this.tcx.type_is_copy_modulo_regions(this.infcx.typing_env(this.param_env), ty)) {
        this.cfg.push_assign(block, source_info, destination, { $: "Use", _0: { $: "Copy", _0: place }, _1: "Yes" });
        block_and = unit(block);
      } else if (this.infcx.type_is_use_cloned_modulo_regions(this.param_env, ty)) {
        // Convert `expr.use` to a call like `Clone::clone(&expr)`
        const success = this.cfg.start_new_block();
        const clone_trait = this.tcx.require_lang_item(LangItem.Clone, span);
        const clone_fn = this.tcx.associated_item_def_ids(clone_trait)[0]!;
        const func = Operand.function_handle(this.tcx, clone_fn, [ty], expr_span);
        const ref_ty = Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_erased, ty);
        const ref_place = this.temp(ref_ty, span);
        this.cfg.push_assign(block, source_info, ref_place, {
          $: "Ref",
          _0: this.tcx.lifetimes.re_erased,
          _1: BorrowKind.Shared,
          _2: place,
        });
        this.cfg.terminate(block, source_info, {
          $: "Call",
          func,
          args: [{ node: { $: "Move", _0: ref_place }, span: DUMMY_SP }],
          destination,
          target: success,
          unwind: UnwindAction.Unreachable,
          call_source: "Use",
          fn_span: expr_span,
        });
        block_and = unit(success);
      } else {
        this.cfg.push_assign(block, source_info, destination, { $: "Use", _0: { $: "Move", _0: place }, _1: "Yes" });
        block_and = unit(block);
      }
      break;
    }
    case "ValueExpr": {
      block_and = this.expr_into_dest(destination, block, kind.source);
      break;
    }
    case "Borrow": {
      const { arg, borrow_kind } = kind;
      // We don't do this in `as_rvalue` because we use `as_place`
      // for borrow expressions, so we cannot create an `RValue` that
      // remains valid across user code. `as_rvalue` is usually called
      // by this method anyway, so this shouldn't cause too many
      // unnecessary temporaries.
      let arg_place: Place;
      switch (borrow_kind.$) {
        case "Shared":
          [block, arg_place] = this.as_read_only_place(block, arg);
          break;
        default:
          [block, arg_place] = this.as_place(block, arg);
      }
      const borrow: Rvalue = { $: "Ref", _0: this.tcx.lifetimes.re_erased, _1: borrow_kind, _2: arg_place };
      this.cfg.push_assign(block, source_info, destination, borrow);
      block_and = unit(block);
      break;
    }
    case "RawBorrow": {
      const { mutability, arg } = kind;
      let place: BlockAnd<Place>;
      switch (mutability) {
        case "Not":
          place = this.as_read_only_place(block, arg);
          break;
        case "Mut":
          place = this.as_place(block, arg);
          break;
      }
      const raw_ptr_kind = RawPtrKind_from_Mutability(mutability);
      let place_: Place;
      [block, place_] = place;
      const address_of: Rvalue = { $: "RawPtr", _0: raw_ptr_kind, _1: place_ };
      this.cfg.push_assign(block, source_info, destination, address_of);
      block_and = unit(block);
      break;
    }
    case "Adt": {
      const { adt_def, variant_index, args, user_ty, fields, base } = kind._0;
      // See the notes for `ExprKind::Array` in `as_rvalue` and for
      // `ExprKind::Borrow` above.
      const is_union = adt_def.is_union();
      const active_field_index = is_union ? fields[0]!.name : undefined;

      const scope = this.local_temp_lifetime();

      // first process the set of fields that were provided
      // (evaluating them in order given by user)
      const fields_map: Map<FieldIdx, Operand> = new Map(
        fields.map((f) => {
          let op: Operand;
          [block, op] = this.as_operand(block, scope, f.expr, LocalInfo.AggregateTemp, NeedsTemporary.Maybe);
          return [f.name, op] as [FieldIdx, Operand];
        }),
      );

      const variant = adt_def.variant(variant_index);
      const field_names: FieldIdx[] = variant.fields.map((_, i) => FieldIdx.from_usize(i));

      let fields_: Operand[];
      switch (base.$) {
        case "None": {
          fields_ = [];
          for (const n of field_names) {
            const v = fields_map.get(n);
            if (v !== undefined) fields_.push(clone_Operand(v));
          }
          break;
        }
        case "Base": {
          const { base: base_, field_types } = base._0;
          let place_builder;
          [block, place_builder] = this.as_place_builder(block, base_);

          // We desugar FRU as we lower to MIR, so for each
          // base-supplied field, generate an operand that
          // reads it from the base.
          fields_ = zip_eq(field_names, field_types).map(([n, ty]) => {
            const v = fields_map.get(n);
            if (v !== undefined) {
              return clone_Operand(v);
            } else {
              const place = place_builder.clone_project({ $: "Field", _0: n, _1: ty });
              return this.consume_by_copy_or_move(place.to_place(this));
            }
          });
          break;
        }
        case "DefaultFields": {
          const field_types = base._0;
          fields_ = zip_eq(field_names, field_types).map(([n, ty]) => {
            const v = fields_map.get(n);
            if (v !== undefined) {
              return clone_Operand(v);
            } else {
              const def = variant.fields[n]!.value;
              if (def !== undefined) {
                const value: Const = { $: "Unevaluated", _0: UnevaluatedConst.new(def, args), _1: ty };
                return { $: "Constant", _0: new ConstOperand(expr_span, undefined, value) };
              } else {
                const name = variant.fields[n]!.name;
                return span_bug(expr_span, `missing mandatory field \`${Symbol.as_str(name)}\` of type \`${display_Ty(ty)}\``);
              }
            }
          });
          break;
        }
      }

      const inferred_ty = expr.ty;
      // PORT: `user_ty.clone()`: the `Box<CanonicalUserType>` is immutable once built, so it is shared (precedent
      // thir/pattern/mod.ts's annotations).
      const user_ty_ =
        user_ty !== undefined
          ? UserTypeAnnotationIndex.from_usize(
              this.canonical_user_type_annotations.push({
                span: source_info.span,
                user_ty: user_ty,
                inferred_ty,
              }) - 1,
            )
          : undefined;
      const adt = {
        $: "Adt" as const,
        _0: adt_def.did(),
        _1: variant_index,
        _2: args,
        _3: user_ty_,
        _4: active_field_index,
      };
      this.cfg.push_assign(block, source_info, destination, { $: "Aggregate", _0: adt, _1: fields_ });
      block_and = unit(block);
      break;
    }
    case "InlineAsm": {
      const { asm_macro, template, operands, options, line_spans } = kind._0;
      // use rustc_middle::{mir, thir};

      const destination_block = this.cfg.start_new_block();
      const targets: BasicBlock[] = AsmMacro.diverges(asm_macro, options) ? [] : [destination_block];

      const operands_: mir_InlineAsmOperand[] = operands.map((op): mir_InlineAsmOperand => {
        switch (op.$) {
          case "In": {
            const { reg, expr } = op;
            let value: Operand;
            [block, value] = this.as_local_operand(block, expr);
            return { $: "In", reg, value };
          }
          case "Out": {
            const { reg, late, expr } = op;
            let place: Place | undefined;
            if (expr !== undefined) {
              [block, place] = this.as_place(block, expr);
            }
            return { $: "Out", reg, late, place };
          }
          case "InOut": {
            const { reg, late, expr } = op;
            let place: Place;
            [block, place] = this.as_place(block, expr);
            return {
              $: "InOut",
              reg,
              late,
              // This works because asm operands must be Copy
              in_value: { $: "Copy", _0: place },
              out_place: place,
            };
          }
          case "SplitInOut": {
            const { reg, late, in_expr, out_expr } = op;
            let in_value: Operand;
            [block, in_value] = this.as_local_operand(block, in_expr);
            let out_place: Place | undefined;
            if (out_expr !== undefined) {
              [block, out_place] = this.as_place(block, out_expr);
            }
            return { $: "InOut", reg, late, in_value, out_place };
          }
          case "Const": {
            // PORT: thir's `InlineAsmOperand::Const::value` is a `mir::Const` (generated as `unknown`).
            const { value, span } = op;
            return { $: "Const", value: new ConstOperand(span, undefined, value as Const) };
          }
          case "SymFn": {
            const { value } = op;
            return { $: "SymFn", value: this.as_constant(this.thir.index_ExprId(value)) };
          }
          case "SymStatic": {
            const { def_id } = op;
            return { $: "SymStatic", def_id };
          }
          case "Label": {
            // PORT: the arm's binding `block` (a `BlockId`) shadows the outer `block`; read as `op.block`.
            let target = this.cfg.start_new_block();
            const target_index = targets.length;
            targets.push(target);

            const tmp = this.get_unit_temp();
            target = BlockAnd.into_block(this.ast_block(tmp, target, op.block, source_info));
            this.cfg.terminate(target, source_info, TerminatorKind.goto(destination_block));

            return { $: "Label", target_index };
          }
        }
      });

      if (!expr.ty.is_never()) {
        this.cfg.push_assign_unit(block, source_info, destination, this.tcx);
      }

      let asm_macro_: InlineAsmMacro;
      switch (asm_macro) {
        case "Asm":
        case "GlobalAsm":
          asm_macro_ = "Asm";
          break;
        case "NakedAsm":
          asm_macro_ = "NakedAsm";
          break;
      }

      this.cfg.terminate(block, source_info, {
        $: "InlineAsm",
        asm_macro: asm_macro_,
        template,
        operands: operands_,
        options,
        line_spans,
        targets,
        unwind: InlineAsmOptions.contains(options, InlineAsmOptions.MAY_UNWIND)
          ? UnwindAction.Continue
          : UnwindAction.Unreachable,
      });
      if (InlineAsmOptions.contains(options, InlineAsmOptions.MAY_UNWIND)) {
        this.diverge_from(block);
      }
      block_and = unit(destination_block);
      break;
    }

    // These cases don't actually need a destination
    case "Assign":
    case "AssignOp": {
      block = BlockAnd.into_block(this.stmt_expr(block, expr_id, undefined));
      this.cfg.push_assign_unit(block, source_info, destination, this.tcx);
      block_and = unit(block);
      break;
    }

    case "Continue":
    case "ConstContinue":
    case "Break":
    case "Return":
    case "Become": {
      block = BlockAnd.into_block(this.stmt_expr(block, expr_id, undefined));
      // No assign, as these have type `!`.
      block_and = unit(block);
      break;
    }

    // Avoid creating a temporary
    case "VarRef":
    case "UpvarRef":
    case "PlaceTypeAscription":
    case "ValueTypeAscription":
    case "PlaceUnwrapUnsafeBinder":
    case "ValueUnwrapUnsafeBinder": {
      // debug_assert!(Category::of(&expr.kind) == Some(Category::Place));

      let place: Place;
      [block, place] = this.as_place(block, expr_id);
      const rvalue: Rvalue = { $: "Use", _0: this.consume_by_copy_or_move(place), _1: "Yes" };
      this.cfg.push_assign(block, source_info, destination, rvalue);
      block_and = unit(block);
      break;
    }
    case "Index":
    case "Deref":
    case "Field": {
      // debug_assert_eq!(Category::of(&expr.kind), Some(Category::Place));

      // Create a "fake" temporary variable so that we check that the
      // value is Sized. Usually, this is caught in type checking, but
      // in the case of box expr there is no such check.
      if (destination.projection.length !== 0) {
        this.local_decls.push(LocalDecl.new(expr.ty, expr.span));
      }

      let place: Place;
      [block, place] = this.as_place(block, expr_id);
      const rvalue: Rvalue = { $: "Use", _0: this.consume_by_copy_or_move(place), _1: "Yes" };
      this.cfg.push_assign(block, source_info, destination, rvalue);
      block_and = unit(block);
      break;
    }

    case "Yield": {
      const scope = this.local_temp_lifetime();
      let value: Operand;
      [block, value] = this.as_operand(block, scope, kind.value, LocalInfo.Boring, NeedsTemporary.No);
      const resume = this.cfg.start_new_block();
      this.cfg.terminate(block, source_info, { $: "Yield", value, resume, resume_arg: destination, drop: undefined });
      this.coroutine_drop_cleanup(block);
      block_and = unit(resume);
      break;
    }

    // these are the cases that are more naturally handled by some other mode
    case "Unary":
    case "Binary":
    case "Cast":
    case "PointerCoercion":
    case "Repeat":
    case "Array":
    case "Tuple":
    case "Closure":
    case "ConstBlock":
    case "Literal":
    case "NamedConst":
    case "NonHirLiteral":
    case "ZstLiteral":
    case "ConstParam":
    case "ThreadLocalRef":
    case "StaticRef":
    case "WrapUnsafeBinder": {
      // debug_assert!(match Category::of(&expr.kind).unwrap() {
      //     // should be handled above
      //     Category::Rvalue(RvalueFunc::Into) => false,
      //
      //     // must be handled above or else we get an
      //     // infinite loop in the builder; see
      //     // e.g., `ExprKind::VarRef` above
      //     Category::Place => false,
      //
      //     _ => true,
      // });

      let rvalue: Rvalue;
      [block, rvalue] = this.as_local_rvalue(block, expr_id);
      this.cfg.push_assign(block, source_info, destination, rvalue);
      block_and = unit(block);
      break;
    }
    case "Reborrow": {
      const { source, mutability, target } = kind;
      let place: Place;
      [block, place] = this.as_place(block, source);
      this.cfg.push_assign(block, source_info, destination, { $: "Reborrow", _0: target, _1: mutability, _2: place });
      block_and = unit(block);
      break;
    }
  }

  if (!expr_is_block_or_scope) {
    const popped = this.block_context.pop();
    assert(popped !== undefined, "assertion failed: popped.is_some()");
  }

  return block_and;
};

// PORT: `itertools::zip_eq`: zips two sequences of equal length and panics (itertools' message) if they differ.
function zip_eq<A, B>(a: readonly A[], b: readonly B[]): [A, B][] {
  if (a.length !== b.length) {
    return bug("itertools: .zip_eq() reached end of one iterator before the other");
  }
  return a.map((x, i) => [x, b[i]!] as [A, B]);
}

// rustc: compiler/rustc_mir_build/src/builder/expr/into.rs:941 is_let
Builder.prototype.is_let = function (this: Builder, expr: ExprId): boolean {
  const kind = this.thir.index_ExprId(expr).kind;
  switch (kind.$) {
    case "Let":
      return true;
    case "Scope":
      return this.is_let(kind.value);
    default:
      return false;
  }
};
