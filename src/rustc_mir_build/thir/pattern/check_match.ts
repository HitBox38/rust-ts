// Port of compiler/rustc_mir_build/src/thir/pattern/check_match.rs (lane mb-check-match, plan-m4 wave 22).
//
// Every fn of check_match.rs is ported. Exhaustiveness goes through rustc_pattern_analysis (src/rustc_pattern_analysis/:
// lane pat-b's declarations, filled by pat-a / pat-c). Upstream's control flow sends every `let`, every fn/closure
// parameter and every `match`/`if let` through `lower_pattern` -> `RustcPatCtxt::lower_pat` and `analyze_match` (the
// irrefutability check *is* an exhaustiveness check).
//
// PORT: `RevealedTy` is a branded `Ty` (rustc_pattern_analysis rustc.ts): upstream's `.inner()` is `RevealedTy.inner(ty)`,
// its `Deref` / `Display` use the value as the `Ty`.
//
// PORT: `MatchVisitor` (a thir `Visitor` impl) is a class extending rustc_middle thir/visit.ts's `Visitor`; its field
// `thir` is `thir_` (the `Visitor::thir()` method has the same name). The methods of the `Visitor` impl and of
// `impl MatchVisitor` are in the class body, in upstream order. The closures `|this| ..` take the visitor as a
// parameter (`(this_) => ..`; PORTING §4).
// PORT: rustc_arena's `TypedArena` / `DroplessArena` are erased: the arena fields hold `null` and
// `pattern_arena.alloc(x)` is `x`.
import type { MultiSpan as MultiSpanT } from "../../../rustc_error_messages/lib.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import { Applicability, E0004, msg, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import type { Diagnostic } from "../../../rustc_errors/lib.ts";
import { ItemKind, MatchSource, Node } from "../../../rustc_hir/hir.ts";
import type { LocalSource } from "../../../rustc_hir/hir.ts";
import { debug_DefKind } from "../../../rustc_hir/def.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { pluralize } from "../../../rustc_lint_defs/lib.ts";
import {
  BINDINGS_WITH_VARIANT_NAME,
  IRREFUTABLE_LET_PATTERNS,
  UNREACHABLE_PATTERNS,
} from "../../../rustc_lint_defs/builtin.gen.ts";
import type { ArmId, Expr, ExprId, Pat, Stmt, Thir } from "../../../rustc_middle/thir.ts";
import { Visitor, walk_expr, walk_stmt } from "../../../rustc_middle/thir/visit.ts";
import type { Arm } from "../../../rustc_middle/thir.ts";
import type { Steal } from "../../../rustc_data_structures/steal.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { AdtDef, TypeckResults, VariantIdx } from "../../../rustc_middle/ty/decls.ts";
import { InhabitedPredicate } from "../../../rustc_middle/ty/inhabitedness/inhabited_predicate.ts";
import { type Ty, TypingEnv, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { type DefId, debug_LocalDefId, LocalDefId, type LocalModId } from "../../../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../../../rustc_span/edit_distance.ts";
import { type ErrorGuaranteed, Span } from "../../../rustc_span/lib.ts";
import type { BytePos } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Ident, sym, Symbol } from "../../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { ch, is_alphanumeric, is_whitespace, to_digit } from "../../../std/char.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, unported } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import {
  AlreadyBorrowed_diagnostic,
  AlreadyMutBorrowed_diagnostic,
  BindingsWithVariantName_diagnostic,
  BorrowOfMovedValue_diagnostic,
  type Conflict,
  type Inform,
  type InterpretedAsConst,
  type InterpretedAsConstSugg,
  IrrefutableLetPatternsIfLet_diagnostic,
  IrrefutableLetPatternsIfLetGuard_diagnostic,
  IrrefutableLetPatternsLetElse_diagnostic,
  IrrefutableLetPatternsWhileLet_diagnostic,
  type AdtDefinedHere,
  type LetElseReplacementSuggestion,
  type MiscPatternSuggestion,
  MovedWhileBorrowed_diagnostic,
  MultipleMutBorrows_diagnostic,
  NonEmptyNeverPattern_diagnostic,
  NonExhaustiveMatchAllArmsGuarded_subdiagnostic,
  NonExhaustivePatternsTypeNotEmpty_diagnostic,
  type SuggestLet,
  UnreachablePattern_diagnostic,
  type UnreachablePatternInner,
  type Variant,
  type WantedConstant,
  PatternNotCovered_diagnostic,
} from "../../diagnostics.ts";
import { type Uncovered, Uncovered_new } from "../../../rustc_pattern_analysis/diagnostics.ts";
import {
  analyze_match,
  type Constructor,
  type DeconstructedPat,
  type MatchArm,
  type RedundancyExplanation,
  RevealedTy,
  RustcPatCtxt,
  RustcPatCtxtState,
  type Usefulness,
  type UsefulnessReport,
  type WitnessPat,
} from "../../../rustc_pattern_analysis/rustc.ts";

// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:30 check_match
export function check_match(tcx: TyCtxt, def_id: LocalDefId): Result<null, ErrorGuaranteed> {
  const typeck_results = tcx.typeck(def_id) as TypeckResults;
  // PORT: queries.gen.ts types `thir_body`'s value loosely (`[Steal<unknown>, unknown]`); it is `(&Steal<Thir>, ExprId)`.
  const r = tcx.thir_body(def_id) as Result<[Steal<Thir>, ExprId], ErrorGuaranteed>;
  if (r.$ === "Err") return r;
  const [thir_, expr] = r._0;
  const thir = thir_.borrow();
  const pattern_arena = null;
  const dropless_arena = null;
  const visitor = new MatchVisitor(
    tcx,
    TypingEnv.post_typeck_until_borrowck_for_mir_build(tcx, def_id),
    typeck_results,
    thir,
    tcx.local_def_id_to_hir_id(def_id),
    LetSource.None,
    pattern_arena,
    dropless_arena,
    Ok(null),
  );
  visitor.visit_expr(thir.index_ExprId(expr));

  let origin: string;
  const kind = tcx.def_kind(LocalDefId.to_def_id(def_id));
  if (kind.$ === "AssocFn" || kind.$ === "Fn") {
    origin = "function argument";
  } else if (kind.$ === "Closure") {
    origin = "closure argument";
  } else if (thir.params.length === 0) {
    // other types of MIR don't have function parameters, and we don't need to
    // categorize those for the irrefutable check.
    origin = "";
  } else {
    return bug(`unexpected function parameters in THIR: ${debug_DefKind(kind, PLAIN)} ${debug_LocalDefId(def_id, PLAIN)}`);
  }

  for (const param of thir.params) {
    if (param.pat !== undefined) {
      const pattern = param.pat;
      visitor.check_binding_is_irrefutable(pattern, origin, undefined, undefined, undefined);
    }
  }
  return visitor.error;
}

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:67 RefutableFlag
export type RefutableFlag = "Irrefutable" | "Refutable";
export const RefutableFlag = { Irrefutable: "Irrefutable", Refutable: "Refutable" } as const;
// use RefutableFlag::*;
const { Irrefutable, Refutable } = RefutableFlag;

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:74 LetSource
export type LetSource = "None" | "PlainLet" | "IfLet" | "IfLetGuard" | "LetElse" | "WhileLet" | "Else" | "ElseIfLet";
export const LetSource = {
  None: "None",
  PlainLet: "PlainLet",
  IfLet: "IfLet",
  IfLetGuard: "IfLetGuard",
  LetElse: "LetElse",
  WhileLet: "WhileLet",
  Else: "Else",
  ElseIfLet: "ElseIfLet",
} as const;

// rustc-type: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:85 MatchVisitor
// Visitor for a thir body. This calls `check_match` and `check_let` as appropriate.
export class MatchVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public typeck_results: TypeckResults,
    // PORT: the field `thir` is `thir_` (the `Visitor::thir()` method has the same name).
    public thir_: Thir,
    public hir_source: HirId,
    public let_source: LetSource,
    public pattern_arena: null,
    public dropless_arena: null,
    /// Tracks if we encountered an error while checking this body. That the first function to
    /// report it stores it here. Some functions return `Result` to allow callers to short-circuit
    /// on error, but callers don't need to store it here again.
    public error: Result<null, ErrorGuaranteed>,
  ) {
    super();
  }

  // impl<'p, 'tcx> Visitor<'p, 'tcx> for MatchVisitor<'p, 'tcx>

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:102 thir
  thir(): Thir {
    return this.thir_;
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:107 visit_arm
  override visit_arm(arm: Arm): void {
    this.with_hir_source(arm.hir_id, (this_) => {
      if (arm.guard !== undefined) {
        const expr = arm.guard;
        this_.with_let_source(LetSource.IfLetGuard, (this_) => {
          this_.visit_expr(this_.thir_.index_ExprId(expr));
        });
      }
      this_.visit_pat(arm.pattern);
      this_.visit_expr(this.thir_.index_ExprId(arm.body));
    });
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:120 visit_expr
  override visit_expr(ex: Expr): void {
    const kind = ex.kind;
    switch (kind.$) {
      case "Scope": {
        const { value, hir_id } = kind;
        this.with_hir_source(hir_id, (this_) => {
          this_.visit_expr(this_.thir_.index_ExprId(value));
        });
        return;
      }
      case "If": {
        const { cond, then, else_opt } = kind;
        // Give a specific `let_source` for the condition.
        const dk = Span.desugaring_kind(ex.span);
        let let_source: LetSource;
        if (dk !== undefined && dk.$ === "WhileLoop") {
          let_source = LetSource.WhileLet;
        } else {
          switch (this.let_source) {
            case LetSource.Else:
              let_source = LetSource.ElseIfLet;
              break;
            default:
              let_source = LetSource.IfLet;
          }
        }
        this.with_let_source(let_source, (this_) => this_.visit_expr(this.thir_.index_ExprId(cond)));
        this.with_let_source(LetSource.None, (this_) => {
          this_.visit_expr(this_.thir_.index_ExprId(then));
        });
        if (else_opt !== undefined) {
          const else_ = else_opt;
          this.with_let_source(LetSource.Else, (this_) => {
            this_.visit_expr(this_.thir_.index_ExprId(else_));
          });
        }
        return;
      }
      case "Match": {
        const { scrutinee, arms, match_source } = kind;
        this.check_match(scrutinee, arms, match_source, ex.span);
        break;
      }
      case "LoopMatch": {
        const { scrutinee, arms, span } = kind.match_data;
        this.check_match(scrutinee, arms, MatchSource.Normal, span);
        break;
      }
      case "Let": {
        const { pat, expr } = kind;
        this.check_let(pat, expr, ex.span);
        break;
      }
      case "LogicalOp": {
        if (kind.op === "And" && !(this.let_source === LetSource.None)) {
          const chain_refutabilities: ([Span, RefutableFlag] | undefined)[] = [];
          const r = this.visit_land(ex, chain_refutabilities);
          if (r.$ !== "Ok") return;
          // Lint only single irrefutable let binding.
          if (chain_refutabilities.length === 1) {
            const c = chain_refutabilities[0];
            if (c !== undefined && c[1] === Irrefutable) {
              this.lint_single_let(ex.span, undefined, undefined);
            }
          }
          return;
        }
        break;
      }
      default:
        break;
    }
    this.with_let_source(LetSource.None, (this_) => walk_expr(this_, ex));
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:176 visit_stmt
  override visit_stmt(stmt: Stmt): void {
    const kind = stmt.kind;
    switch (kind.$) {
      case "Let": {
        const { pattern, initializer, else_block, hir_id, span } = kind;
        this.with_hir_source(hir_id, (this_) => {
          const let_source = else_block !== undefined ? LetSource.LetElse : LetSource.PlainLet;
          this_.with_let_source(let_source, (this_) => {
            this_.check_let(pattern, initializer, span);
          });
          walk_stmt(this_, stmt);
        });
        break;
      }
      case "Expr": {
        walk_stmt(this, stmt);
        break;
      }
    }
  }

  // impl<'p, 'tcx> MatchVisitor<'p, 'tcx>

  // #[instrument(level = "trace", skip(self, f))]
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:197 with_let_source
  with_let_source(let_source: LetSource, f: (this_: MatchVisitor) => void): void {
    const old_let_source = this.let_source;
    this.let_source = let_source;
    f(this);
    this.let_source = old_let_source;
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:204 with_hir_source
  with_hir_source<T>(new_hir_source: HirId, f: (this_: MatchVisitor) => T): T {
    const old_hir_source = this.hir_source;
    this.hir_source = new_hir_source;
    const ret = f(this);
    this.hir_source = old_hir_source;
    return ret;
  }

  /// Visit a nested chain of `&&`. Used for if-let chains. This must call `visit_expr` on the
  /// subexpressions we are not handling ourselves.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:214 visit_land
  visit_land(ex: Expr, accumulator: ([Span, RefutableFlag] | undefined)[]): Result<null, ErrorGuaranteed> {
    const kind = ex.kind;
    if (kind.$ === "Scope") {
      const { value, hir_id } = kind;
      return this.with_hir_source(hir_id, (this_) => this_.visit_land(this_.thir_.index_ExprId(value), accumulator));
    } else if (kind.$ === "LogicalOp" && kind.op === "And") {
      const { lhs, rhs } = kind;
      // We recurse into the lhs only, because `&&` chains associate to the left.
      const res_lhs = this.visit_land(this.thir_.index_ExprId(lhs), accumulator);
      const r = this.visit_land_rhs(this.thir_.index_ExprId(rhs));
      if (r.$ === "Err") return r;
      const res_rhs = r._0;
      accumulator.push(res_rhs);
      return res_lhs;
    } else {
      const r = this.visit_land_rhs(ex);
      if (r.$ === "Err") return r;
      const res = r._0;
      accumulator.push(res);
      return Ok(null);
    }
  }

  /// Visit the right-hand-side of a `&&`. Used for if-let chains. Returns `Some` if the
  /// expression was ultimately a `let ... = ...`, and `None` if it was a normal boolean
  /// expression. This must call `visit_expr` on the subexpressions we are not handling ourselves.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:241 visit_land_rhs
  visit_land_rhs(ex: Expr): Result<[Span, RefutableFlag] | undefined, ErrorGuaranteed> {
    const kind = ex.kind;
    if (kind.$ === "Scope") {
      const { value, hir_id } = kind;
      return this.with_hir_source(hir_id, (this_) => this_.visit_land_rhs(this_.thir_.index_ExprId(value)));
    } else if (kind.$ === "Let") {
      const pat = kind.pat;
      const expr = this.thir().index_ExprId(kind.expr);
      this.with_let_source(LetSource.None, (this_) => {
        this_.visit_expr(expr);
      });
      const r = this.is_let_irrefutable(pat, expr);
      if (r.$ === "Err") return r;
      return Ok([ex.span, r._0]);
    } else {
      this.with_let_source(LetSource.None, (this_) => {
        this_.visit_expr(ex);
      });
      return Ok(undefined);
    }
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:265 lower_pattern
  lower_pattern(cx: RustcPatCtxt, pat: Pat): Result<DeconstructedPat, ErrorGuaranteed> {
    const e = pat.pat_error_reported();
    if (e.$ === "Err") {
      const err = e._0;
      this.error = Err(err);
      return Err(err);
    } else {
      // Check the pattern for some things unrelated to exhaustiveness.
      const refutable = cx.refutable ? Refutable : Irrefutable;
      // PORT: `as` widens the type: TS does not see the closure's writes.
      let err = Ok(null) as Result<null, ErrorGuaranteed>;
      pat.walk_always((pat) => {
        check_borrow_conflicts_in_at_patterns(this, pat);
        check_for_bindings_named_same_as_variants(this, pat, refutable);
        // PORT: `err = err.and(check_never_pattern(cx, pat))`: the argument is evaluated first.
        const r = check_never_pattern(cx, pat);
        if (err.$ === "Ok") err = r;
      });
      if (err.$ === "Err") return err;
      // PORT: `self.pattern_arena.alloc(..)` (arena erased).
      return Ok(cx.lower_pat(pat));
    }
  }

  /// Inspects the match scrutinee expression to determine whether the place it evaluates to may
  /// hold invalid data.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:289 is_known_valid_scrutinee
  is_known_valid_scrutinee(scrutinee: Expr): boolean {
    // use ExprKind::*;
    const kind = scrutinee.kind;
    switch (kind.$) {
      // Pointers can validly point to a place with invalid data. It is undecided whether
      // references can too, so we conservatively assume they can.
      case "Deref":
        return false;
      // Inherit validity of the parent place, unless the parent is an union.
      case "Field": {
        const lhs = this.thir().index_ExprId(kind.lhs);
        const k = lhs.ty.kind();
        if (k.$ === "Adt" && k._0.is_union()) {
          return false;
        } else {
          return this.is_known_valid_scrutinee(lhs);
        }
      }
      // Essentially a field access.
      case "Index": {
        const lhs = this.thir().index_ExprId(kind.lhs);
        return this.is_known_valid_scrutinee(lhs);
      }

      // No-op.
      case "Scope":
        return this.is_known_valid_scrutinee(this.thir().index_ExprId(kind.value));

      // Casts don't cause a load.
      case "NeverToAny":
      case "Cast":
      case "ValueExpr":
      case "PointerCoercion":
      case "PlaceTypeAscription":
      case "ValueTypeAscription":
      case "PlaceUnwrapUnsafeBinder":
      case "ValueUnwrapUnsafeBinder":
      case "WrapUnsafeBinder":
        return this.is_known_valid_scrutinee(this.thir().index_ExprId(kind.source));

      // These diverge.
      case "Become":
      case "Break":
      case "Continue":
      case "ConstContinue":
      case "Return":
        return true;

      // These are statements that evaluate to `()`.
      case "Assign":
      case "AssignOp":
      case "InlineAsm":
      case "Let":
        return true;

      // These evaluate to a value.
      case "RawBorrow":
      case "Adt":
      case "Array":
      case "Binary":
      case "Block":
      case "Borrow":
      case "Call":
      case "ByUse":
      case "Closure":
      case "ConstBlock":
      case "ConstParam":
      case "If":
      case "Literal":
      case "LogicalOp":
      case "Loop":
      case "LoopMatch":
      case "Match":
      case "NamedConst":
      case "NonHirLiteral":
      case "Repeat":
      case "StaticRef":
      case "ThreadLocalRef":
      case "Tuple":
      case "Unary":
      case "UpvarRef":
      case "VarRef":
      case "ZstLiteral":
      case "Yield":
      case "Reborrow":
        return true;
    }
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:366 new_cx
  new_cx(refutability: RefutableFlag, whole_match_span: Span | undefined, scrutinee: Expr | undefined, scrut_span: Span): RustcPatCtxt {
    let refutable: boolean;
    switch (refutability) {
      case Irrefutable:
        refutable = false;
        break;
      case Refutable:
        refutable = true;
        break;
    }
    // If we don't have a scrutinee we're either a function parameter or a `let x;`. Both cases
    // require validity.
    const known_valid_scrutinee = scrutinee !== undefined ? this.is_known_valid_scrutinee(scrutinee) : true;
    return new RustcPatCtxt(
      this.tcx,
      this.typeck_results,
      this.tcx.parent_module(this.hir_source),
      this.typing_env,
      this.dropless_arena,
      this.hir_source,
      whole_match_span,
      scrut_span,
      refutable,
      known_valid_scrutinee,
      RustcPatCtxtState.default(),
    );
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:396 analyze_patterns
  analyze_patterns(cx: RustcPatCtxt, arms: readonly MatchArm[], scrut_ty: Ty): Result<UsefulnessReport, ErrorGuaranteed> {
    const rr = analyze_match(cx, arms, scrut_ty);
    if (rr.$ === "Err") {
      const err = rr._0;
      this.error = Err(err);
      return Err(err);
    }
    const report = rr._0;

    // Warn unreachable subpatterns.
    for (const [arm, is_useful] of report.arm_usefulness) {
      if (is_useful.$ === "Useful" && is_useful._0.length !== 0) {
        const redundant_subpats = is_useful._0.slice();
        // Emit lints in the order in which they occur in the file.
        // PORT: `sort_unstable_by_key(|(pat, _)| pat.data().span.lo_hi())` (lexicographic on `(lo, hi)`).
        redundant_subpats.sort(([a], [b]) => cmp_lo_hi(Span.lo_hi(a.data().span), Span.lo_hi(b.data().span)));
        for (const [pat, explanation] of redundant_subpats) {
          report_unreachable_pattern(cx, arm.arm_data, pat, explanation, undefined);
        }
      }
    }
    return Ok(report);
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:425 check_let
  check_let(pat: Pat, scrutinee: ExprId | undefined, span: Span): void {
    assert(this.let_source !== LetSource.None, "assertion failed: self.let_source != LetSource::None");
    const scrut = scrutinee !== undefined ? this.thir_.index_ExprId(scrutinee) : undefined;
    if (this.let_source === LetSource.PlainLet) {
      // `lhs = rhs` destructuring assignments are lowered to a `let` tagged
      // `AssignDesugar`; report them as assignments, not `let` bindings (#157553).
      const node = this.tcx.hir_node(this.hir_source);
      if (node.$ === "LetStmt" && node._0.source === ("AssignDesugar" satisfies LocalSource)) {
        this.check_binding_is_irrefutable(pat, "assignment", { descr: "destructuring assignments" }, scrut, undefined);
      } else {
        this.check_binding_is_irrefutable(pat, "local binding", { descr: "`let` bindings" }, scrut, span);
      }
    } else {
      const r = this.is_let_irrefutable(pat, scrut);
      if (r.$ === "Ok" && r._0 === Irrefutable) {
        if (Span.from_expansion(span)) {
          this.lint_single_let(span, undefined, undefined);
          return;
        }
        const let_else_span = this.check_irrefutable_option_some(pat, scrut, span);

        const sm = this.tcx.sess.source_map();
        const next_token_start = Span.hi(sm.span_extend_while_whitespace(span));
        const line_span = Span.with_lo(sm.span_extend_to_line(span), next_token_start);
        const else_keyword_span = sm.span_until_whitespace(line_span);
        this.lint_single_let(span, else_keyword_span, let_else_span);
      }
    }
  }

  /// Check case `let x = Some(y);`, user likely intended to destructure `Option`
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:468 check_irrefutable_option_some
  check_irrefutable_option_some(pat: Pat, initializer: Expr | undefined, span: Span): LetElseReplacementSuggestion | undefined {
    const sm = this.tcx.sess.source_map();
    if (initializer === undefined) return undefined;
    const s_ty = initializer.ty.ty_adt_def();
    if (s_ty === undefined) return undefined;
    if (!this.tcx.is_diagnostic_item(sym.Option, s_ty.did())) return undefined;
    if (initializer.kind.$ !== "Scope") return undefined;
    const value = initializer.kind.value;
    const initializer_expr = this.thir_.index_ExprId(value);
    if (initializer_expr.kind.$ !== "Adt") return undefined;
    const fields = initializer_expr.kind._0.fields;
    const field = fields[0];
    if (field === undefined) return undefined;
    const inner = this.thir_.index_ExprId(field.expr);
    const inner_ty = inner.ty.ty_adt_def();
    if (inner_ty === undefined) return undefined;
    if (!this.tcx.is_diagnostic_item(sym.Option, inner_ty.did())) return undefined;
    const rhs_r = sm.span_to_snippet(inner.span);
    if (rhs_r.$ !== "Ok") return undefined;
    const lhs_r = sm.span_to_snippet(pat.span);
    if (lhs_r.$ !== "Ok") return undefined;
    const rhs = rhs_r._0.toString();
    const lhs = `Some(${lhs_r._0.toString()})`;
    return { span, lhs, rhs };
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:495 check_match
  check_match(scrut_: ExprId, arms: readonly ArmId[], source: MatchSource, expr_span: Span): void {
    const scrut = this.thir_.index_ExprId(scrut_);
    const cx = this.new_cx(Refutable, expr_span, scrut, scrut.span);

    const tarms: MatchArm[] = [];
    for (const arm_ of arms) {
      const arm = this.thir_.index_ArmId(arm_);
      const got_error = this.with_hir_source(arm.hir_id, (this_) => {
        const r = this_.lower_pattern(cx, arm.pattern);
        if (r.$ !== "Ok") return true;
        const pat = r._0;
        const arm2: MatchArm = { pat, arm_data: this_.hir_source, has_guard: arm.guard !== undefined };
        tarms.push(arm2);
        return false;
      });
      if (got_error) {
        return;
      }
    }

    const rr = this.analyze_patterns(cx, tarms, scrut.ty);
    if (rr.$ !== "Ok") return;
    const report = rr._0;

    switch (source.$) {
      // Don't report arm reachability of desugared `match $iter.into_iter() { iter => .. }`
      // when the iterator is an uninhabited type. unreachable_code will trigger instead.
      case "ForLoopDesugar":
      case "Postfix":
      case "Normal":
      case "FormatArgs": {
        if (source.$ === "ForLoopDesugar" && arms.length === 1) {
          break;
        }
        const is_match_arm = source.$ === "Postfix" || source.$ === "Normal";
        report_arm_reachability(cx, report, is_match_arm);
        break;
      }
      // Unreachable patterns in try and await expressions occur when one of
      // the arms are an uninhabited type. Which is OK.
      case "AwaitDesugar":
      case "TryDesugar":
        break;
    }

    // Check if the match is exhaustive.
    const witnesses = report.non_exhaustiveness_witnesses;
    if (witnesses.length !== 0) {
      if (source.$ === "ForLoopDesugar" && arms.length === 2) {
        const snd_arm = arms[1]!;
        // the for loop pattern is not irrefutable
        const pat = this.thir_.index_ArmId(snd_arm).pattern;
        // `pat` should be `Some(<pat_field>)` from a desugared for loop.
        // debug_assert_eq!(pat.span.desugaring_kind(), Some(DesugaringKind::ForLoop));
        if (pat.kind.$ !== "Variant") return bug();
        const subpatterns = pat.kind.subpatterns;
        if (subpatterns.length !== 1) return bug();
        const pat_field = subpatterns[0]!;
        this.check_binding_is_irrefutable(pat_field.pattern, "`for` loop binding", undefined, undefined, undefined);
      } else {
        // span after scrutinee, or after `.match`. That is, the braces, arms,
        // and any whitespace preceding the braces.
        let braces_span: Span | undefined;
        switch (source.$) {
          case "Normal": {
            const scrut_span = Span.find_ancestor_in_same_ctxt(scrut.span, expr_span);
            braces_span =
              scrut_span !== undefined ? Span.with_hi(Span.shrink_to_hi(scrut_span), Span.hi(expr_span)) : undefined;
            break;
          }
          case "Postfix": {
            // This is horrendous, and we should deal with it by just
            // stashing the span of the braces somewhere (like in the match source).
            const scrut_span = Span.find_ancestor_in_same_ctxt(scrut.span, expr_span);
            if (scrut_span === undefined) {
              braces_span = undefined;
            } else {
              const sm = this.tcx.sess.source_map();
              const brace_span = sm.span_extend_to_next_char(scrut_span, ch("{"), true);
              const snip = sm.span_to_snippet(sm.next_point(brace_span));
              if (snip.$ === "Ok" && snip._0.toString() === "{") {
                const sp = Span.with_hi(Span.shrink_to_hi(brace_span), Span.hi(expr_span));
                // We also need to extend backwards for whitespace
                const e = sm.span_extend_prev_while(sp, (c) => is_whitespace(c));
                braces_span = e.$ === "Ok" ? e._0 : undefined;
              } else {
                braces_span = undefined;
              }
            }
            break;
          }
          case "ForLoopDesugar":
          case "TryDesugar":
          case "AwaitDesugar":
          case "FormatArgs":
            braces_span = undefined;
            break;
        }

        // Check if the match would be exhaustive if all guards were removed.
        // If so, we leave a note that guards don't count towards exhaustivity.
        let would_be_exhaustive_without_guards: boolean;
        {
          const any_arm_has_guard = tarms.some((arm) => arm.has_guard);
          would_be_exhaustive_without_guards =
            any_arm_has_guard &&
            (() => {
              const guardless_arms: MatchArm[] = tarms.map((arm) => ({ ...arm, has_guard: false }));
              const r = analyze_match(cx, guardless_arms, scrut.ty);
              return r.$ === "Ok" && r._0.non_exhaustiveness_witnesses.length === 0;
            })();
        }
        this.error = Err(
          report_non_exhaustive_match(
            cx,
            this.thir_,
            scrut.ty,
            scrut.span,
            witnesses,
            arms,
            braces_span,
            would_be_exhaustive_without_guards,
          ),
        );
      }
    }
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:613 lint_single_let
  lint_single_let(
    let_span: Span,
    else_keyword_span: Span | undefined,
    let_else_span: LetElseReplacementSuggestion | undefined,
  ): void {
    report_irrefutable_let_patterns(
      this.tcx,
      this.hir_source,
      this.let_source,
      1,
      let_span,
      else_keyword_span,
      let_else_span,
    );
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:630 analyze_binding
  analyze_binding(pat_: Pat, refutability: RefutableFlag, scrut: Expr | undefined): Result<[RustcPatCtxt, UsefulnessReport], ErrorGuaranteed> {
    const cx = this.new_cx(refutability, undefined, scrut, pat_.span);
    const lp = this.lower_pattern(cx, pat_);
    if (lp.$ === "Err") return lp;
    const pat = lp._0;
    const arms: MatchArm[] = [{ pat, arm_data: this.hir_source, has_guard: false }];
    const rr = this.analyze_patterns(cx, arms, RevealedTy.inner(pat.ty()));
    if (rr.$ === "Err") return rr;
    const report = rr._0;
    return Ok([cx, report]);
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:643 is_let_irrefutable
  is_let_irrefutable(pat: Pat, scrut: Expr | undefined): Result<RefutableFlag, ErrorGuaranteed> {
    const r = this.analyze_binding(pat, Refutable, scrut);
    if (r.$ === "Err") return r;
    const [cx, report] = r._0;
    // Report if the pattern is unreachable, which can only occur when the type is uninhabited.
    report_arm_reachability(cx, report, false);
    // If the list of witnesses is empty, the match is exhaustive, i.e. the `if let` pattern is
    // irrefutable.
    return Ok(report.non_exhaustiveness_witnesses.length === 0 ? Irrefutable : Refutable);
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:657 check_binding_is_irrefutable
  check_binding_is_irrefutable(
    pat: Pat,
    origin: string,
    inform: Inform | undefined,
    scrut: Expr | undefined,
    sp: Span | undefined,
  ): void {
    const pattern_ty = pat.ty;

    const r = this.analyze_binding(pat, Irrefutable, scrut);
    if (r.$ !== "Ok") return;
    const [cx, report] = r._0;
    const witnesses = report.non_exhaustiveness_witnesses;
    if (witnesses.length === 0) {
      // The pattern is irrefutable.
      return;
    }

    let let_suggestion: SuggestLet | undefined = undefined;
    let misc_suggestion: MiscPatternSuggestion | undefined = undefined;
    let interpreted_as_const: InterpretedAsConst | undefined = undefined;
    let interpreted_as_const_sugg: InterpretedAsConstSugg | undefined = undefined;

    const def_id = is_const_pat_that_looks_like_binding(this.tcx, pat);
    if (def_id !== undefined) {
      const span = this.tcx.def_span(def_id);
      const name = this.tcx.item_name(def_id);
      // When we encounter a constant as the binding name, point at the `const` definition.
      interpreted_as_const = { span, variable: Symbol.to_ident_string(name) };
      // The suggested name is suffixed, so it is never a keyword and never needs `r#`.
      interpreted_as_const_sugg = { span: pat.span, variable: Symbol.as_str(name) };
    } else if (pat.kind.$ === "Constant") {
      const snippet = this.tcx.sess.source_map().span_to_snippet(pat.span);
      if (snippet.$ === "Ok") {
        // If the pattern to match is an integer literal:
        let all = true;
        const it = snippet._0.chars();
        for (let c = it.next(); c !== undefined; c = it.next()) {
          if (to_digit(c, 10) === undefined) {
            all = false;
            break;
          }
        }
        if (all) {
          // Then give a suggestion, the user might've meant to create a binding instead.
          misc_suggestion = {
            $: "AttemptedIntegerLiteral",
            start_span: Span.shrink_to_lo(pat.span),
          };
        }
      }
    }

    if (
      sp !== undefined &&
      this.tcx.sess.source_map().is_span_accessible(sp) &&
      interpreted_as_const === undefined &&
      scrut !== undefined
    ) {
      const span = sp;
      const bindings: Symbol[] = [];
      pat.each_binding((name, _, _2, _3) => bindings.push(name));

      const semi_span = Span.shrink_to_hi(span);
      const start_span = Span.shrink_to_lo(span);
      const end_span = Span.shrink_to_lo(semi_span);
      const count = witnesses.length;

      let_suggestion =
        bindings.length === 0 ? { $: "If", start_span, semi_span, count } : { $: "Else", end_span, count };
    }

    const adt_defined_here = report_adt_defined_here(this.tcx, pattern_ty, witnesses, false);

    // Emit an extra note if the first uncovered witness would be uninhabited
    // if we disregard visibility.
    let witness_1_is_privately_uninhabited = false;
    const witness_1_ = witnesses[0];
    if (witness_1_ !== undefined) {
      const k = witness_1_.ty().kind();
      if (k.$ === "Adt") {
        const [adt, args] = [k._0, k._1];
        const ctor = witness_1_.ctor();
        if (adt.is_enum() && ctor.$ === "Variant") {
          const variant_index = ctor._0;
          const variant_inhabited = InhabitedPredicate.instantiate(
            adt.variant(variant_index).inhabited_predicate(this.tcx),
            this.tcx,
            args,
          );
          witness_1_is_privately_uninhabited =
            InhabitedPredicate.apply(variant_inhabited, this.tcx, cx.typing_env, cx.module) &&
            !InhabitedPredicate.apply_ignore_module(variant_inhabited, this.tcx, cx.typing_env);
        }
      }
    }

    const witness_1 = cx.print_witness_pat(witnesses[0]!);

    this.error = Err(
      this.tcx.dcx().emit_err(
        PatternNotCovered_diagnostic({
          span: pat.span,
          origin,
          uncovered: Uncovered_new(pat.span, cx, witnesses),
          inform,
          interpreted_as_const,
          interpreted_as_const_sugg,
          witness_1_is_privately_uninhabited,
          witness_1,
          _p: null,
          pattern_ty,
          let_suggestion,
          misc_suggestion,
          adt_defined_here,
        }),
      ),
    );
  }
}

/** PORT: the `Ord` of `(BytePos, BytePos)` (for `sort_unstable_by_key(.. lo_hi())`). */
function cmp_lo_hi(a: [BytePos, BytePos], b: [BytePos, BytePos]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

/// Check if a by-value binding is by-value. That is, check if the binding's type is not `Copy`.
/// Check that there are no borrow or move conflicts in `binding @ subpat` patterns.
///
/// For example, this would reject:
/// - `ref x @ Some(ref mut y)`,
/// - `ref mut x @ Some(ref y)`,
/// - `ref mut x @ Some(ref mut y)`,
/// - `ref mut? x @ Some(y)`, and
/// - `x @ Some(ref mut? y)`.
///
/// This analysis is *not* subsumed by NLL.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:770 check_borrow_conflicts_in_at_patterns
export function check_borrow_conflicts_in_at_patterns(cx: MatchVisitor, pat: Pat): void {
  // Extract `sub` in `binding @ sub`.
  if (pat.kind.$ !== "Binding" || pat.kind.subpattern === undefined) {
    return;
  }
  const { name, mode, ty } = pat.kind;
  const sub = pat.kind.subpattern;

  const is_binding_by_move = (ty: Ty): boolean => !cx.tcx.type_is_copy_modulo_regions(cx.typing_env, ty);

  const sess = cx.tcx.sess;

  // Get the binding move, extract the mutability if by-ref.
  let mut_outer: "Not" | "Mut";
  const by_ref = mode._0;
  if (by_ref.$ === "No" && is_binding_by_move(ty)) {
    // We have `x @ pat` where `x` is by-move. Reject all borrows in `pat`.
    const conflicts_ref: Span[] = [];
    sub.each_binding((_, mode, _2, span) => {
      if (mode.$ === "Yes") {
        conflicts_ref.push(span);
      }
    });
    if (conflicts_ref.length !== 0) {
      sess.dcx().emit_err(
        BorrowOfMovedValue_diagnostic({
          binding_span: pat.span,
          conflicts_ref,
          name: Ident.new(name, pat.span),
          ty,
          suggest_borrowing: Span.shrink_to_lo(pat.span),
        }),
      );
    }
    return;
  } else if (by_ref.$ === "No") {
    return;
  } else {
    mut_outer = by_ref._1;
  }

  // We now have `ref $mut_outer binding @ sub` (semantically).
  // Recurse into each binding in `sub` and find mutability or move conflicts.
  const conflicts_move: Conflict[] = [];
  const conflicts_mut_mut: Conflict[] = [];
  const conflicts_mut_ref: Conflict[] = [];
  sub.each_binding((name, mode, ty, span) => {
    if (mode.$ === "Yes") {
      const mut_inner = mode._1;
      if (mut_outer === "Not" && mut_inner === "Not") {
        // Both sides are `ref`.
      } else if (mut_outer === "Mut" && mut_inner === "Mut") {
        // 2x `ref mut`.
        conflicts_mut_mut.push({ $: "Mut", span, name });
      } else if (mut_outer === "Not" && mut_inner === "Mut") {
        conflicts_mut_ref.push({ $: "Mut", span, name });
      } else {
        // (Mutability::Mut, Mutability::Not)
        conflicts_mut_ref.push({ $: "Ref", span, name });
      }
    } else if (is_binding_by_move(ty)) {
      conflicts_move.push({ $: "Moved", span, name }); // `ref mut?` + by-move conflict.
    } else {
      // `ref mut?` + by-copy is fine.
    }
  });

  const report_mut_mut = conflicts_mut_mut.length !== 0;
  const report_mut_ref = conflicts_mut_ref.length !== 0;
  const report_move_conflict = conflicts_move.length !== 0;

  const occurrences: Conflict[] =
    mut_outer === "Mut" ? [{ $: "Mut", span: pat.span, name }] : [{ $: "Ref", span: pat.span, name }];
  occurrences.push(...conflicts_mut_mut);
  occurrences.push(...conflicts_mut_ref);
  occurrences.push(...conflicts_move);

  // Report errors if any.
  if (report_mut_mut) {
    // Report mutability conflicts for e.g. `ref mut x @ Some(ref mut y)`.
    sess.dcx().emit_err(MultipleMutBorrows_diagnostic({ span: pat.span, occurrences }));
  } else if (report_mut_ref) {
    // Report mutability conflicts for e.g. `ref x @ Some(ref mut y)` or the converse.
    switch (mut_outer) {
      case "Mut":
        sess.dcx().emit_err(AlreadyMutBorrowed_diagnostic({ span: pat.span, occurrences }));
        break;
      case "Not":
        sess.dcx().emit_err(AlreadyBorrowed_diagnostic({ span: pat.span, occurrences }));
        break;
    }
  } else if (report_move_conflict) {
    // Report by-ref and by-move conflicts, e.g. `ref x @ y`.
    sess.dcx().emit_err(MovedWhileBorrowed_diagnostic({ span: pat.span, occurrences }));
  }
}

// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:865 check_for_bindings_named_same_as_variants
export function check_for_bindings_named_same_as_variants(cx: MatchVisitor, pat: Pat, rf: RefutableFlag): void {
  if (
    pat.kind.$ === "Binding" &&
    pat.kind.mode._0.$ === "No" &&
    pat.kind.mode._1 === "Not" &&
    pat.kind.subpattern === undefined
  ) {
    const { name, ty } = pat.kind;
    const k = ty.peel_refs().kind();
    if (k.$ !== "Adt") return;
    const edef = k._0;
    if (
      edef.is_enum() &&
      edef.variants().some((variant) => variant.name === name && variant.ctor_kind() === "Const")
    ) {
      const variant_count = edef.variants().length;
      const ty_path = with_no_trimmed_paths(() => cx.tcx.def_path_str(edef.did()));
      cx.tcx.emit_node_span_lint(
        BINDINGS_WITH_VARIANT_NAME,
        cx.hir_source,
        pat.span,
        BindingsWithVariantName_diagnostic({
          // If this is an irrefutable pattern, and there's > 1 variant,
          // then we can't actually match on this. Applying the below
          // suggestion would produce code that breaks on `check_binding_is_irrefutable`.
          suggestion: rf === Refutable || variant_count === 1 ? pat.span : undefined,
          ty_path,
          name: Ident.new(name, pat.span),
        }),
      );
    }
  }
}

/// Check that never patterns are only used on inhabited types.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:907 check_never_pattern
export function check_never_pattern(cx: RustcPatCtxt, pat: Pat): Result<null, ErrorGuaranteed> {
  if (pat.kind.$ === "Never") {
    if (!cx.is_uninhabited(pat.ty)) {
      return Err(cx.tcx.dcx().emit_err(NonEmptyNeverPattern_diagnostic({ span: pat.span, ty: pat.ty })));
    }
  }
  return Ok(null);
}

// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:919 report_irrefutable_let_patterns
export function report_irrefutable_let_patterns(
  tcx: TyCtxt,
  id: HirId,
  source: LetSource,
  count: number,
  span: Span,
  else_keyword_span: Span | undefined,
  let_else_span: LetElseReplacementSuggestion | undefined,
): void {
  // macro_rules! emit_diag { ($lint:tt) => { tcx.emit_node_span_lint(IRREFUTABLE_LET_PATTERNS, id, span, $lint { count }) } }
  const emit_diag = (lint: Diagnostic): void => {
    tcx.emit_node_span_lint(IRREFUTABLE_LET_PATTERNS, id, span, lint);
  };

  switch (source) {
    case LetSource.None:
    case LetSource.PlainLet:
    case LetSource.Else:
      return bug();
    case LetSource.IfLet:
    case LetSource.ElseIfLet:
      emit_diag(IrrefutableLetPatternsIfLet_diagnostic({ count }));
      break;
    case LetSource.IfLetGuard:
      emit_diag(IrrefutableLetPatternsIfLetGuard_diagnostic({ count }));
      break;
    case LetSource.LetElse: {
      let spans: MultiSpanT | Span;
      if (else_keyword_span !== undefined) {
        const spans_ = MultiSpan.from_span(else_keyword_span);
        spans_.push_span_label(span, msg("assigning to binding pattern will always succeed"));
        spans = spans_;
      } else {
        spans = span;
      }

      tcx.emit_node_span_lint(
        IRREFUTABLE_LET_PATTERNS,
        id,
        spans,
        IrrefutableLetPatternsLetElse_diagnostic({ be_replaced: let_else_span }),
      );
      break;
    }
    case LetSource.WhileLet:
      emit_diag(IrrefutableLetPatternsWhileLet_diagnostic({ count }));
      break;
  }
}

/// Report unreachable arms, if any.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:963 report_unreachable_pattern
export function report_unreachable_pattern(
  cx: RustcPatCtxt,
  hir_id: HirId,
  pat: DeconstructedPat,
  explanation: RedundancyExplanation,
  whole_arm_span: Span | undefined,
): void {
  const CAP_COVERED_BY_MANY = 4;
  const pat_span = pat.data().span;
  const lint: UnreachablePatternInner = {
    span: pat_span,
    matches_no_values: undefined,
    matches_no_values_ty: pat.ty(),
    uninhabited_note: undefined,
    covered_by_catchall: undefined,
    covered_by_one: undefined,
    covered_by_many: undefined,
    wanted_constant: undefined,
    accessible_constant: undefined,
    inaccessible_constant: undefined,
    pattern_let_binding: undefined,
    suggest_remove: undefined,
  };
  let covered_by_many_n_more_count: number | undefined = undefined;
  const covered_by = explanation.covered_by;
  if (covered_by.length === 0) {
    // Empty pattern; we report the uninhabited type that caused the emptiness.
    lint.span = undefined; // Don't label the pattern itself
    lint.uninhabited_note = null; // Give a link about empty types
    lint.matches_no_values = pat_span;
    lint.suggest_remove = whole_arm_span; // Suggest to remove the match arm
    pat.walk((subpat) => {
      const ty: Ty = subpat.ty();
      const c = subpat.ctor();
      if (cx.is_uninhabited(ty)) {
        lint.matches_no_values_ty = ty;
        return false; // No need to dig further.
      } else if (c.$ === "Ref" || c.$ === "UnionField") {
        return false; // Don't explore further since they are not by-value.
      } else {
        return true;
      }
    });
  } else if (covered_by.length === 1 && pat_is_catchall(covered_by[0]!)) {
    const covering_pat = covered_by[0]!;
    // A binding pattern that matches all, a single binding name.
    const pat = covering_pat.data();
    lint.covered_by_catchall = pat.span;
    find_fallback_pattern_typo(cx, hir_id, pat, lint);
  } else if (covered_by.length === 1) {
    const covering_pat = covered_by[0]!;
    lint.covered_by_one = covering_pat.data().span;
  } else {
    const covering_pats = covered_by;
    const multispan = MultiSpan.from_span(pat_span);
    const take = Math.min(CAP_COVERED_BY_MANY, covering_pats.length);
    for (let i = 0; i < take; i++) {
      const p = covering_pats[i]!;
      multispan.push_span_label(p.data().span, msg("matches some of the same values"));
    }
    const remain = covering_pats.length - take;
    if (remain === 0) {
      multispan.push_span_label(pat_span, msg("collectively making this unreachable"));
    } else {
      covered_by_many_n_more_count = remain;
      multispan.push_span_label(
        pat_span,
        msg("...and {$covered_by_many_n_more_count} other patterns collectively make this unreachable"),
      );
    }
    lint.covered_by_many = multispan;
  }
  cx.tcx.emit_node_span_lint(
    UNREACHABLE_PATTERNS,
    hir_id,
    pat_span,
    UnreachablePattern_diagnostic({ inner: lint, covered_by_many_n_more_count }),
  );
}

/// Detect typos that were meant to be a `const` but were interpreted as a new pattern binding.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1043 find_fallback_pattern_typo
export function find_fallback_pattern_typo(cx: RustcPatCtxt, hir_id: HirId, pat: Pat, lint: UnreachablePatternInner): void {
  if (cx.tcx.lint_level_spec_at_node(UNREACHABLE_PATTERNS, hir_id).is_allow()) {
    // This is because we use `with_no_trimmed_paths` later, so if we never emit the lint we'd
    // ICE. At the same time, we don't really need to do all of this if we won't emit anything.
    return;
  }
  if (pat.kind.$ === "Binding" && pat.kind.subpattern === undefined) {
    const { name, ty } = pat.kind;
    // See if the binding might have been a `const` that was mistyped or out of scope.
    const accessible: Symbol[] = [];
    const accessible_path: string[] = [];
    const inaccessible: Span[] = [];
    const imported: Symbol[] = [];
    const imported_spans: Span[] = [];
    const [infcx, param_env] = cx.tcx.infer_ctxt().build_with_typing_env(cx.typing_env);
    const parent = cx.tcx.hir_get_parent_item(hir_id);

    // PORT: queries.gen.ts types `hir_crate_items`'s value loosely; it is `&ModuleItems`.
    for (const item_ of (cx.tcx.hir_crate_items(null) as ModuleItems).free_items()) {
      if (cx.tcx.def_kind(item_.owner_id).$ === "Use") {
        // Look for consts being re-exported.
        const item = cx.tcx.hir_expect_item(item_.owner_id.def_id);
        if (item.kind.$ !== "Use") {
          continue;
        }
        const path = item.kind._0.prefix;
        const value_ns = path.res.value_ns;
        if (
          value_ns !== undefined &&
          value_ns.$ === "Def" &&
          value_ns._0.$ === "Const" &&
          infcx.can_eq(
            param_env,
            ty,
            Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(value_ns._1) as EarlyBinder<Ty>)),
            ToTrace_Ty,
          )
        ) {
          const id = value_ns._1;
          if (Visibility.is_accessible_from(cx.tcx.visibility(id), parent, cx.tcx)) {
            // The original const is accessible, suggest using it directly.
            const item_name = cx.tcx.item_name(id);
            accessible.push(item_name);
            accessible_path.push(with_no_trimmed_paths(() => cx.tcx.def_path_str(id)));
          } else if (Visibility.is_accessible_from(cx.tcx.visibility(item.owner_id), parent, cx.tcx)) {
            // The const is accessible only through the re-export, point at
            // the `use`.
            const ident = ItemKind.ident(item.kind)!;
            imported.push(ident.name);
            imported_spans.push(ident.span);
          }
        }
      }
      if (
        cx.tcx.def_kind(item_.owner_id).$ === "Const" &&
        infcx.can_eq(
          param_env,
          ty,
          Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(item_.owner_id) as EarlyBinder<Ty>)),
          ToTrace_Ty,
        )
      ) {
        // Look for local consts.
        const item_name = cx.tcx.item_name(item_.owner_id);
        const vis = cx.tcx.visibility(item_.owner_id);
        if (Visibility.is_accessible_from(vis, parent, cx.tcx)) {
          accessible.push(item_name);
          // FIXME: the line below from PR #135310 is a workaround for the ICE in issue
          // #135289, where a macro in a dependency can create unreachable patterns in the
          // current crate. Path trimming expects diagnostics for a typoed const, but no
          // diagnostics are emitted and we ICE. See
          // `tests/ui/resolve/const-with-typo-in-pattern-binding-ice-135289.rs` for a
          // test that reproduces the ICE if we don't use `with_no_trimmed_paths!`.
          const path = with_no_trimmed_paths(() => cx.tcx.def_path_str(item_.owner_id));
          accessible_path.push(path);
        } else if (name === item_name) {
          // The const exists somewhere in this crate, but it can't be imported
          // from this pattern's scope. We'll just point at its definition.
          inaccessible.push(cx.tcx.def_span(item_.owner_id));
        }
      }
    }
    const i_exact = accessible.findIndex((const_name) => const_name === name);
    let best: Symbol | undefined;
    let j_exact: number;
    if (i_exact !== -1) {
      const i = i_exact;
      const const_name = accessible[i]!;
      // The pattern name is an exact match, so the pattern needed to be imported.
      lint.wanted_constant = {
        span: pat.span,
        is_typo: false,
        const_name: Symbol.as_str(const_name),
        const_path: accessible_path[i]!,
      } satisfies WantedConstant;
    } else if ((best = find_best_match_for_name(accessible, name, undefined)) !== undefined) {
      const name = best;
      // The pattern name is likely a typo.
      lint.wanted_constant = {
        span: pat.span,
        is_typo: true,
        const_name: Symbol.as_str(name),
        const_path: Symbol.as_str(name),
      };
    } else if ((j_exact = imported.findIndex((const_name) => const_name === name)) !== -1) {
      const i = j_exact;
      // The const with the exact name wasn't re-exported from an import in this
      // crate, we point at the import.
      lint.accessible_constant = imported_spans[i];
    } else if ((best = find_best_match_for_name(imported, name, undefined)) !== undefined) {
      const name = best;
      // The typoed const wasn't re-exported by an import in this crate, we suggest
      // the right name (which will likely require another follow up suggestion).
      lint.wanted_constant = {
        span: pat.span,
        is_typo: true,
        const_path: Symbol.as_str(name),
        const_name: Symbol.as_str(name),
      };
    } else if (inaccessible.length !== 0) {
      for (const span of inaccessible) {
        // The const with the exact name match isn't accessible, we just point at it.
        lint.inaccessible_constant = span;
      }
    } else {
      // Look for local bindings for people that might have gotten confused with how
      // `let` and `const` works.
      for (const [, node] of cx.tcx.hir_parent_iter(hir_id)) {
        if (node.$ === "Stmt" && node._0.kind.$ === "Let") {
          const let_stmt = node._0.kind._0;
          if (let_stmt.pat.kind.$ === "Binding") {
            const binding_name = let_stmt.pat.kind._2;
            if (name === binding_name.name) {
              lint.pattern_let_binding = binding_name.span;
            }
          }
        } else if (node.$ === "Block") {
          const stmts = node._0.stmts;
          for (const stmt of stmts) {
            if (stmt.kind.$ === "Let" && stmt.kind._0.pat.kind.$ === "Binding") {
              const binding_name = stmt.kind._0.pat.kind._2;
              if (name === binding_name.name) {
                lint.pattern_let_binding = binding_name.span;
              }
            }
          }
        } else if (node.$ === "Item") {
          break;
        }
      }
    }
  }
}

/// Report unreachable arms, if any.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1190 report_arm_reachability
export function report_arm_reachability(cx: RustcPatCtxt, report: UsefulnessReport, is_match_arm: boolean): void {
  const sm = cx.tcx.sess.source_map();
  for (const [arm, is_useful] of report.arm_usefulness) {
    if (is_useful.$ === "Redundant") {
      const explanation = is_useful._0;
      const hir_id = arm.arm_data;
      const arm_span = cx.tcx.hir_span(hir_id);
      let whole_arm_span: Span | undefined;
      if (is_match_arm) {
        // If the arm is followed by a comma, extend the span to include it.
        const comma = sm.span_followed_by(arm_span, ",");
        if (comma !== undefined) {
          whole_arm_span = Span.to(arm_span, comma);
        } else {
          whole_arm_span = arm_span;
        }
      } else {
        whole_arm_span = undefined;
      }
      report_unreachable_pattern(cx, hir_id, arm.pat, explanation, whole_arm_span);
    }
  }
}

/// Checks for common cases of "catchall" patterns that may not be intended as such.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1216 pat_is_catchall
export function pat_is_catchall(pat: DeconstructedPat): boolean {
  const c = pat.ctor();
  switch (c.$) {
    case "Wildcard":
      return true;
    case "Struct":
    case "Ref": {
      for (const ipat of pat.iter_fields()) {
        if (!pat_is_catchall(ipat.pat)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/// If the given pattern is a named constant that looks like it could have been
/// intended to be a binding, returns the `DefId` of the named constant.
///
/// Diagnostics use this to give more detailed suggestions for non-exhaustive
/// matches.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1231 is_const_pat_that_looks_like_binding
export function is_const_pat_that_looks_like_binding(tcx: TyCtxt, pat: Pat): DefId | undefined {
  // The pattern must be a named constant, and the name that appears in
  // the pattern's source text must resemble a plain identifier without any
  // `::` namespace separators or other non-identifier characters.
  if (pat.extra === undefined) return undefined;
  const expanded_const = pat.extra.expanded_const;
  if (expanded_const === undefined) return undefined;
  if (expanded_const.$ === "Free") {
    const def_id = expanded_const.def_id;
    const snippet = tcx.sess.source_map().span_to_snippet(pat.span);
    if (snippet.$ === "Ok") {
      const s = snippet._0.starts_with("r#") ? snippet._0.slice(2) : snippet._0;
      let all = true;
      const it = s.chars();
      for (let c = it.next(); c !== undefined; c = it.next()) {
        if (!(is_alphanumeric(c) || c === ch("_"))) {
          all = false;
          break;
        }
      }
      if (all) {
        return def_id;
      }
    }
  }
  return undefined;
}

/// Report that a match is not exhaustive.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1250 report_non_exhaustive_match
export function report_non_exhaustive_match(
  cx: RustcPatCtxt,
  thir: Thir,
  scrut_ty: Ty,
  sp: Span,
  witnesses: WitnessPat[],
  arms: readonly ArmId[],
  braces_span: Span | undefined,
  would_be_exhaustive_without_guards: boolean,
): ErrorGuaranteed {
  const is_empty_match = arms.length === 0;
  const sk = scrut_ty.kind();
  const non_empty_enum = sk.$ === "Adt" ? sk._0.is_enum() && sk._0.variants().length !== 0 : false;
  // In the case of an empty match, replace the '`_` not covered' diagnostic with something more
  // informative.
  if (is_empty_match && !non_empty_enum) {
    return cx.tcx.dcx().emit_err(
      NonExhaustivePatternsTypeNotEmpty_diagnostic({
        cx,
        scrut_span: sp,
        braces_span,
        ty: scrut_ty,
      }),
    );
  }

  // FIXME: migration of this diagnostic will require list support
  const joined_patterns = joined_uncovered_patterns(cx, witnesses);
  const err = struct_span_code_err(cx.tcx.dcx(), sp, E0004, `non-exhaustive patterns: ${joined_patterns} not covered`);
  err.span_label(sp, `pattern${pluralize(witnesses.length)} ${joined_patterns} not covered`);

  // Point at the definition of non-covered `enum` variants.
  const adh = report_adt_defined_here(cx.tcx, scrut_ty, witnesses, true);
  if (adh !== undefined) {
    const { adt_def_span, ty, variants } = adh;
    const multi_span = MultiSpan.from_span(adt_def_span);
    multi_span.push_span_context(adt_def_span);
    for (const { span } of variants) {
      multi_span.push_span_label(span, "not covered");
    }
    err.span_note(multi_span, `\`${display_Ty(ty)}\` defined here`);
  }
  err.note(`the matched value is of type \`${display_Ty(scrut_ty)}\``);

  if (!is_empty_match) {
    // PORT: `FxIndexSet<RevealedTy>` is a `Set` (a `RevealedTy` is its interned `Ty`; insertion-ordered).
    const special_tys: Set<RevealedTy> = new Set();
    // Look at the first witness.
    collect_special_tys(cx, witnesses[0]!, special_tys);

    for (const ty of special_tys) {
      if (ty.is_ptr_sized_integral()) {
        if (RevealedTy.inner(ty) === cx.tcx.types.usize) {
          err.note(
            `\`${display_Ty(ty)}::MAX\` is not treated as exhaustive, ` +
              `so half-open ranges are necessary to match exhaustively`,
          );
        } else if (RevealedTy.inner(ty) === cx.tcx.types.isize) {
          err.note(
            `\`${display_Ty(ty)}::MIN\` and \`${display_Ty(ty)}::MAX\` are not treated as exhaustive, ` +
              `so half-open ranges are necessary to match exhaustively`,
          );
        }
      } else if (RevealedTy.inner(ty) === cx.tcx.types.str_) {
        err.note("`&str` cannot be matched exhaustively, so a wildcard `_` is necessary");
      } else if (cx.is_foreign_non_exhaustive_enum(ty)) {
        err.note(
          `\`${display_Ty(ty)}\` is marked as non-exhaustive, so a wildcard \`_\` is necessary to match exhaustively`,
        );
      } else if (cx.is_uninhabited(RevealedTy.inner(ty))) {
        // The type is uninhabited yet there is a witness: we must be in the `MaybeInvalid`
        // case.
        err.note(
          `\`${display_Ty(ty)}\` is uninhabited but is not being matched by value, so a wildcard \`_\` is required`,
        );
      }
    }
  }

  if (sk.$ === "Ref") {
    const sub_ty = sk._1;
    if (!sub_ty.is_inhabited_from(cx.tcx, cx.module, cx.typing_env)) {
      err.note("references are always considered inhabited");
    }
  }

  for (const arm_ of arms) {
    const arm = thir.index_ArmId(arm_);
    const def_id = is_const_pat_that_looks_like_binding(cx.tcx, arm.pattern);
    if (def_id !== undefined) {
      const const_name = cx.tcx.item_name(def_id);
      err.span_label(
        arm.pattern.span,
        `this pattern doesn't introduce a new catch-all binding, but rather pattern ` +
          `matches against the value of constant \`${Symbol.as_str(const_name)}\``,
      );
      err.span_note(cx.tcx.def_span(def_id), `constant \`${Symbol.as_str(const_name)}\` defined here`);
      err.span_suggestion_verbose(
        Span.shrink_to_hi(arm.pattern.span),
        "if you meant to introduce a binding, use a different name",
        "_var",
        Applicability.MaybeIncorrect,
      );
    }
  }

  // Whether we suggest the actual missing patterns or `_`.
  const suggest_the_witnesses = witnesses.length < 4;
  let suggested_arm: string;
  if (suggest_the_witnesses) {
    const pattern = witnesses.map((witness) => cx.print_witness_pat(witness)).join(" | ");
    if (witnesses.every((p) => p.is_never_pattern()) && cx.tcx.features().never_patterns()) {
      // Arms with a never pattern don't take a body.
      suggested_arm = pattern;
    } else {
      // ignore-tidy-todo
      suggested_arm = `${pattern} => todo!()`;
    }
  } else {
    // ignore-tidy-todo
    suggested_arm = `_ => todo!()`;
  }
  let suggestion: [Span, string] | undefined = undefined;
  const sm = cx.tcx.sess.source_map();
  if (arms.length === 0 && braces_span !== undefined) {
    // Get the span for the empty match body `{}`.
    let indentation: string;
    let more: string;
    const snippet = sm.indentation_before(sp);
    if (snippet !== undefined) {
      [indentation, more] = [`\n${snippet.toString()}`, "    "];
    } else {
      [indentation, more] = [" ", ""];
    }
    suggestion = [braces_span, ` {${indentation}${more}${suggested_arm},${indentation}}`];
  } else if (arms.length === 1) {
    const only = thir.index_ArmId(arms[0]!);
    let pre_indentation: string;
    let is_multiline: boolean;
    const snippet = sm.indentation_before(only.span);
    const with_trailing = snippet !== undefined ? sm.span_extend_while(only.span, (c) => is_whitespace(c) || c === ch(",")) : undefined;
    if (snippet !== undefined && with_trailing !== undefined && with_trailing.$ === "Ok" && sm.is_multiline(with_trailing._0)) {
      [pre_indentation, is_multiline] = [`\n${snippet.toString()}`, true];
    } else {
      [pre_indentation, is_multiline] = [" ", false];
    }
    const only_body = thir.index_ExprId(only.body);
    const comma = only_body.kind.$ === "Block" && Span.eq_ctxt(only.span, only_body.span) && is_multiline ? "" : ",";
    suggestion = [Span.shrink_to_hi(only.span), `${comma}${pre_indentation}${suggested_arm}`];
  } else if (arms.length >= 2) {
    const prev = thir.index_ArmId(arms[arms.length - 2]!);
    const last = thir.index_ArmId(arms[arms.length - 1]!);
    if (Span.eq_ctxt(prev.span, last.span)) {
      const last_body = thir.index_ExprId(last.body);
      const comma = last_body.kind.$ === "Block" && Span.eq_ctxt(last.span, last_body.span) ? "" : ",";
      let spacing: string | undefined;
      if (sm.is_multiline(Span.between(prev.span, last.span))) {
        const indent = sm.indentation_before(last.span);
        spacing = indent !== undefined ? `\n${indent.toString()}` : undefined;
      } else {
        spacing = " ";
      }
      if (spacing !== undefined) {
        suggestion = [Span.shrink_to_hi(last.span), `${comma}${spacing}${suggested_arm}`];
      }
    }
  }

  let msg2: string;
  if (witnesses.length === 0) {
    // non-exhaustive enum case
    msg2 = suggestion !== undefined ? " as shown" : "";
  } else if (witnesses.length === 1) {
    msg2 = suggestion !== undefined ? " or an explicit pattern as shown" : " or an explicit pattern";
  } else {
    msg2 = suggestion !== undefined ? " as shown, or multiple match arms" : " or multiple match arms";
  }
  const msg_ =
    `ensure that all possible cases are being handled by adding a match arm with a wildcard ` +
    `pattern${
      witnesses.length > 1 && suggest_the_witnesses && suggestion !== undefined
        ? ", a match arm with multiple or-patterns"
        : // we are either not suggesting anything, or suggesting `_`
          ""
    }${msg2}`;

  if (would_be_exhaustive_without_guards) {
    err.subdiagnostic(NonExhaustiveMatchAllArmsGuarded_subdiagnostic({}));
  }
  if (suggestion !== undefined) {
    const [span, sugg] = suggestion;
    err.span_suggestion_verbose(span, msg_, sugg, Applicability.HasPlaceholders);
  } else {
    err.help(msg_);
  }
  return err.emit_err();
}

// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1482 joined_uncovered_patterns
export function joined_uncovered_patterns(cx: RustcPatCtxt, witnesses: readonly WitnessPat[]): string {
  const LIMIT = 3;
  const pat_to_str = (pat: WitnessPat): string => cx.print_witness_pat(pat);
  if (witnesses.length === 0) {
    return bug();
  } else if (witnesses.length === 1) {
    return `\`${cx.print_witness_pat(witnesses[0]!)}\``;
  } else if (witnesses.length - 1 < LIMIT) {
    const head_ = witnesses.slice(0, witnesses.length - 1);
    const tail = witnesses[witnesses.length - 1]!;
    const head = head_.map(pat_to_str);
    return `\`${head.join("`, `")}\` and \`${cx.print_witness_pat(tail)}\``;
  } else {
    const head_ = witnesses.slice(0, LIMIT);
    const tail = witnesses.slice(LIMIT);
    const head = head_.map(pat_to_str);
    return `\`${head.join("`, `")}\` and ${tail.length} more`;
  }
}

/// Collect types that require specific explanations when they show up in witnesses.
// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1504 collect_special_tys
export function collect_special_tys(cx: RustcPatCtxt, pat: WitnessPat, special_tys: Set<RevealedTy>): void {
  const c = pat.ctor();
  if (c.$ === "NonExhaustive" || c.$ === "Never") {
    special_tys.add(pat.ty());
  }
  if (c.$ === "IntRange") {
    const range = c._0;
    if (cx.is_range_beyond_boundaries(range, pat.ty())) {
      // The range denotes the values before `isize::MIN` or the values after `usize::MAX`/`isize::MAX`.
      special_tys.add(pat.ty());
    }
  }
  for (const field_pat of pat.iter_fields()) {
    collect_special_tys(cx, field_pat, special_tys);
  }
}

// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1521 report_adt_defined_here
export function report_adt_defined_here(
  tcx: TyCtxt,
  ty_: Ty,
  witnesses: readonly WitnessPat[],
  point_at_non_local_ty: boolean,
): AdtDefinedHere | undefined {
  const ty = ty_.peel_refs();
  const k = ty.kind();
  if (k.$ !== "Adt") {
    return undefined;
  }
  const def = k._0;
  const node = tcx.hir_get_if_local(def.did());
  const ident = node === undefined ? undefined : Node.ident(node);
  const adt_def_span_ = ident === undefined ? undefined : ident.span;
  let adt_def_span: Span;
  if (point_at_non_local_ty) {
    adt_def_span = adt_def_span_ !== undefined ? adt_def_span_ : tcx.def_span(def.did());
  } else {
    if (adt_def_span_ === undefined) return undefined;
    adt_def_span = adt_def_span_;
  }

  const variants: Variant[] = [];
  for (const span of maybe_point_at_variant(tcx, def, witnesses.slice(0, 5))) {
    variants.push({ span });
  }
  return { adt_def_span, ty, variants };
}

// rustc: compiler/rustc_mir_build/src/thir/pattern/check_match.rs:1546 maybe_point_at_variant
export function maybe_point_at_variant(tcx: TyCtxt, def: AdtDef, patterns: Iterable<WitnessPat>): Span[] {
  const covered: Span[] = [];
  for (const pattern of patterns) {
    const c = pattern.ctor();
    if (c.$ === "Variant") {
      const variant_index = c._0;
      const k = pattern.ty().kind();
      if (k.$ === "Adt" && k._0.did() !== def.did()) {
        continue;
      }
      const sp = def.variant(variant_index).ident(tcx).span;
      if (covered.includes(sp)) {
        // Don't point at variants that have already been covered due to other patterns to avoid
        // visual clutter.
        continue;
      }
      covered.push(sp);
    }
    covered.push(...maybe_point_at_variant(tcx, def, pattern.iter_fields()));
  }
  return covered;
}
