// Port of compiler/rustc_mir_transform/src/liveness.rs (lane mt-liveness).
//
// PORT: `MaybeLivePlaces` is this file's own backward analysis over `PlaceIndex` (it does not use rustc_mir_dataflow's
// `MaybeLiveLocals`); it `extends AnalysisBase<DenseBitSet<PlaceIndex>>` (dataflow contract, plan-m4 D5) and
// `TransferFunction` / `LocalVisitor` / `LiteralFinder` extend mir/visit.ts's `Visitor` (D4); `ExprFinder` and
// `LocalUseVisitor` extend rustc_hir's intravisit `Visitor`. Structs and impls nested in fn bodies are module-level
// classes next to their parent fn (class declarations are not hoisted).
// PORT: `FxHashSet<Location>` is a `KeyedSet` and `FxIndexMap<SourceInfo, Access>` a `KeyedMap` (insertion-ordered, as
// `IndexMap`) keyed by the derived `Eq` (`key_Location` / `key_SourceInfo`; `Span` / `SourceScope` are interned
// handles). `IndexEntry::Vacant/Occupied` is a `get` / `set`; `Access` is a mutable object (`get_mut()` edits it in
// place). `IndexVec<I, Option<T>>` is `(T | undefined)[]`; `insert` / `get_or_insert_with` grow it as upstream.
// PORT: `mir::Place`'s derived `PartialEq` is the module-local `place_eq` (`local` by value, the interned `projection` by
// identity), as mb-scope / mb-matches-c (decision 2026-10-22 #17).
import { BindingMode, BindingMode_eq } from "../rustc_ast/lib.ts";
import type { FieldIdx } from "../rustc_abi/layout.ts";
import { Mutability } from "../rustc_ast_ir/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { type DefKind } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/hir.ts";
import { Node } from "../rustc_hir/hir.ts";
import { Visitor as HirVisitor, walk_expr } from "../rustc_hir/intravisit.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { newtype_index } from "../rustc_index/newtype_index.ts";
import { UNUSED_ASSIGNMENTS, UNUSED_VARIABLES } from "../rustc_lint_defs/builtin.ts";
import {
  BasicBlock,
  type BasicBlockData,
  type Body,
  type CallReturnPlaces,
  clone_Body,
  type ConstOperand,
  Local,
  type LocalDecl,
  type LocalKind,
  Location,
  Place,
  type PlaceElem,
  PlaceRef,
  ProjectionElem,
  type Rvalue,
  SourceInfo,
  SourceScope,
  START_BLOCK,
  type Statement,
  type Terminator,
  TerminatorKind,
  type VarDebugInfo,
} from "../rustc_middle/mir/mod.ts";
import { display_Const } from "../rustc_middle/mir/consts.ts";
import { debug_PlaceRef, PlaceRef_from_Local } from "../rustc_middle/mir/statement.ts";
import * as traversal from "../rustc_middle/mir/traversal.ts";
import { type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import { CAPTURE_STRUCT_LOCAL as ty_CAPTURE_STRUCT_LOCAL, type CapturedPlace } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import { HasAttrs_LocalDefId, TypingEnv, Visibility } from "../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type UpvarArgs, UpvarArgs as UpvarArgsC } from "../rustc_middle/ty/sty.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { AnalysisBase, Backward, type Direction, type Domain, Domain_DenseBitSet, type ResultsCursor } from "../rustc_mir_dataflow/framework/mod.ts";
import { type DebugWithContext, DebugWithContext_impl } from "../rustc_mir_dataflow/framework/fmt.ts";
import { type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { kw, sym, Symbol } from "../rustc_span/symbol.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { ClosureKind } from "../rustc_type_ir/lib.ts";
import { ClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { set_aliases_to_non_rigid } from "../rustc_type_ir/fold.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import { PLAIN } from "../std/fmt.ts";
import { unreachable } from "../std/panic.ts";

import * as diagnostics from "./diagnostics.ts";

// PORT: `ty::CAPTURE_STRUCT_LOCAL` (ty/closure.ts declares its own `Local` brand) as a mir `Local` (decision #15).
const CAPTURE_STRUCT_LOCAL = ty_CAPTURE_STRUCT_LOCAL as unknown as Local;

/** PORT: derived `PartialEq` of `mir::Place` (header). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/** PORT: the derived `Hash + Eq` of `Location` as a `KeyedSet` key (header). */
function key_Location(l: Location): string {
  return `${l.block}:${l.statement_index}`;
}

/** PORT: the derived `Hash + Eq` of `SourceInfo` as a `KeyedMap` key (header). */
function key_SourceInfo(s: SourceInfo): string {
  return `${s.span}:${s.scope}`;
}

/** PORT: `IndexMap::retain` (order kept). */
function retain<K, V>(map: Map<K, V>, keep: (k: K, v: V) => boolean): void {
  for (const [k, v] of [...map]) {
    if (!keep(k, v)) map.delete(k);
  }
}

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:24 AccessKind
type AccessKind = "Param" | "Assign" | "Capture";
const AccessKind = { Param: "Param", Assign: "Assign", Capture: "Capture" } as const;

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:31 CaptureKind
type CaptureKind =
  | { readonly $: "Closure"; _0: ClosureKind }
  | { readonly $: "Coroutine" }
  | { readonly $: "CoroutineClosure" }
  | { readonly $: "None" };
const CaptureKind = {
  Coroutine: Object.freeze({ $: "Coroutine" as const }),
  CoroutineClosure: Object.freeze({ $: "CoroutineClosure" as const }),
  None: Object.freeze({ $: "None" as const }),
};

// #[derive(Copy, Clone, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:39 Access
interface Access {
  /// Describe the current access.
  kind: AccessKind;
  /// MIR location where this access happens.
  location: Location;
  /// Is the accessed place is live at the current statement?
  /// When we encounter multiple statements at the same location, we only increase the liveness,
  /// in order to avoid false positives.
  live: boolean;
  /// Is this a direct access to the place itself, no projections, or to a field?
  /// This helps distinguish `x = ...` from `x.field = ...`
  is_direct: boolean;
}

// #[tracing::instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_mir_transform/src/liveness.rs:54 check_liveness
export function check_liveness(tcx: TyCtxt, def_id: LocalDefId): DenseBitSet<FieldIdx> {
  // Don't run on synthetic MIR, as that will ICE trying to access HIR.
  if (tcx.is_synthetic_mir(def_id)) {
    return DenseBitSet.new_empty(0);
  }

  // Don't run unused pass for intrinsics
  if (tcx.intrinsic(LocalDefId.to_def_id(def_id)) !== undefined) {
    return DenseBitSet.new_empty(0);
  }

  // Don't run unused pass for #[naked]
  if (find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "Naked" ? true : undefined)) !== undefined) {
    return DenseBitSet.new_empty(0);
  }

  // Don't run unused pass for #[derive]
  const parent = tcx.local_parent(tcx.typeck_root_def_id_local(def_id));
  const parent_kind: DefKind = tcx.def_kind(parent);
  if (
    parent_kind.$ === "Impl" &&
    parent_kind.of_trait === true &&
    find_attr(HasAttrs_LocalDefId.get_attrs(parent, tcx), (k) => (k.$ === "AutomaticallyDerived" ? true : undefined)) !== undefined
  ) {
    return DenseBitSet.new_empty(0);
  }

  let body: Body = tcx.mir_promoted(def_id)[0].borrow();
  let body_mem: Body;

  // Don't run if there are errors.
  if (body.tainted_by_errors !== undefined) {
    return DenseBitSet.new_empty(0);
  }

  const checked_places = PlaceSet.default();
  checked_places.insert_locals(body.local_decls);

  // The body is the one of a closure or generator, so we also want to analyse captures.
  let capture_kind: CaptureKind;
  let num_captures: number;
  if (tcx.is_closure_like(LocalDefId.to_def_id(def_id))) {
    let self_ty = body.local_decls[CAPTURE_STRUCT_LOCAL]!.ty;
    let self_is_ref = false;
    const self_ty_kind = self_ty.kind();
    if (self_ty_kind.$ === "Ref") {
      self_ty = self_ty_kind._1;
      self_is_ref = true;
    }

    let capture_kind_: CaptureKind;
    let args: UpvarArgs;
    const k = self_ty.kind();
    switch (k.$) {
      case "Closure":
        [capture_kind_, args] = [{ $: "Closure", _0: ClosureArgs.kind(k._1.as_closure()) }, { $: "Closure", _0: k._1 }];
        break;
      case "Coroutine":
        [capture_kind_, args] = [CaptureKind.Coroutine, { $: "Coroutine", _0: k._1 }];
        break;
      case "CoroutineClosure":
        [capture_kind_, args] = [CaptureKind.CoroutineClosure, { $: "CoroutineClosure", _0: k._1 }];
        break;
      default:
        return bug(`expected closure or generator, found ${debug_Ty(self_ty, PLAIN)}`);
    }
    capture_kind = capture_kind_;

    const captures = tcx.closure_captures(def_id);
    checked_places.insert_captures(tcx, self_is_ref, captures, UpvarArgsC.upvar_tys(args));

    // `FnMut` closures can modify captured values and carry those
    // modified values with them in subsequent calls. To model this behaviour,
    // we consider the `FnMut` closure as jumping to `bb0` upon return.
    if (capture_kind.$ === "Closure" && capture_kind._0 === "FnMut") {
      // FIXME: stop cloning the body.
      body_mem = clone_Body(body);
      for (const bbdata of body_mem.basic_blocks_mut()) {
        // We can call a closure again, either after a normal return or an unwind.
        const tk = bbdata.terminator_().kind;
        if (tk.$ === "Return" || tk.$ === "UnwindResume") {
          bbdata.terminator_mut().kind = TerminatorKind.goto(START_BLOCK);
        }
      }
      body = body_mem;
    }

    num_captures = UpvarArgsC.upvar_tys(args).length;
  } else {
    [capture_kind, num_captures] = [CaptureKind.None, 0];
  }

  // Get the remaining variables' names from debuginfo.
  checked_places.record_debuginfo(body.var_debug_info);

  const self_assignment = find_self_assignments(checked_places, body);

  const live = new MaybeLivePlaces(tcx, checked_places, capture_kind, self_assignment)
    .iterate_to_fixpoint(tcx, body, undefined)
    .into_results_cursor(body);

  const typing_env = TypingEnv.post_analysis(tcx, body.source.def_id());

  const assignments = AssignmentResult.find_dead_assignments(tcx, typing_env, checked_places, live, body);

  assignments.merge_guards();

  const dead_captures = assignments.compute_dead_captures(num_captures);

  assignments.report_fully_unused();
  assignments.report_unused_assignments();

  return dead_captures;
}

/// Small helper to make semantics easier to read.
// #[inline]
// rustc: compiler/rustc_mir_transform/src/liveness.rs:161 is_capture
function is_capture(place: PlaceRef): boolean {
  if (place.projection.length !== 0) {
    // debug_assert_eq!(place.local, ty::CAPTURE_STRUCT_LOCAL);
    return true;
  } else {
    return false;
  }
}

/// Give a diagnostic when an unused variable may be a typo of a unit variant or a struct.
// rustc: compiler/rustc_mir_transform/src/liveness.rs:171 maybe_suggest_unit_pattern_typo
function maybe_suggest_unit_pattern_typo(tcx: TyCtxt, body_def_id: DefId, name: Symbol, span: Span, ty: Ty): diagnostics.PatternTypo | undefined {
  const peeled = ty.peel_refs().kind();
  if (peeled.$ === "Adt") {
    const adt_def = peeled._0;
    const variant_names: Symbol[] = adt_def
      .variants()
      .filter((v) => v.ctor !== undefined && v.ctor[0] === "Const")
      .map((v) => v.name);
    const name_ = find_best_match_for_name(variant_names, name, undefined);
    if (name_ !== undefined) {
      const variant = adt_def.variants().find((v) => v.name === name_ && v.ctor !== undefined && v.ctor[0] === "Const");
      if (variant !== undefined) {
        return {
          span,
          code: with_no_trimmed_paths(() => tcx.def_path_str(variant.def_id)),
          kind: tcx.def_descr(variant.def_id),
          item_name: variant.name,
        };
      }
    }
  }

  // Look for consts of the same type with similar names as well,
  // not just unit structs and variants.
  const constants: LocalDefId[] = [];
  for (const def_id of tcx.hir_body_owners()) {
    if (
      tcx.def_kind(def_id).$ === "Const" &&
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)) === ty &&
      Visibility.is_accessible_from(tcx.visibility(def_id) as Visibility, body_def_id, tcx)
    ) {
      constants.push(def_id);
    }
  }
  const names = constants.map((def_id) => tcx.item_name(def_id));
  const item_name = find_best_match_for_name(names, name, undefined);
  if (item_name !== undefined) {
    const position = names.findIndex((n) => n === item_name);
    if (position !== -1) {
      const def_id = constants[position];
      if (def_id !== undefined) {
        return {
          span,
          code: with_no_trimmed_paths(() => tcx.def_path_str(def_id)),
          kind: "constant",
          item_name,
        };
      }
    }
  }

  return undefined;
}

/// Return whether we should consider the current place as a drop guard and skip reporting.
// rustc: compiler/rustc_mir_transform/src/liveness.rs:227 maybe_drop_guard
function maybe_drop_guard(
  tcx: TyCtxt,
  typing_env: TypingEnv,
  index: PlaceIndex,
  ever_dropped: DenseBitSet<PlaceIndex>,
  checked_places: PlaceSet,
  body: Body,
): boolean {
  if (ever_dropped.contains(index)) {
    let ty = checked_places.places[index]!.ty(body.local_decls, tcx).ty;
    // FIXME(#155345): Liveness uses `TypingMode::PostAnalysis`
    // even though it's run on `mir_promoted` which is still
    // in an earlier `TypingMode`. This is odd and we have to
    // manually mark aliases as non-rigid here.
    ty = Unnormalized.skip_norm_wip(set_aliases_to_non_rigid(tcx, ty, fold_Ty));
    const k = ty.kind();
    return (
      (k.$ === "Closure" ||
        k.$ === "Coroutine" ||
        k.$ === "Tuple" ||
        k.$ === "Adt" ||
        k.$ === "Dynamic" ||
        k.$ === "Array" ||
        k.$ === "Slice" ||
        (k.$ === "Alias" && k._1.kind.$ === "Opaque")) &&
      ty.needs_drop(tcx, typing_env)
    );
  } else {
    return false;
  }
}

/// Detect the following case
///
/// ```text
/// fn change_object(mut a: &Ty) {
///     let a = Ty::new();
///     b = &a;
/// }
/// ```
///
/// where the user likely meant to modify the value behind there reference, use `a` as an out
/// parameter, instead of mutating the local binding. When encountering this we suggest:
///
/// ```text
/// fn change_object(a: &'_ mut Ty) {
///     let a = Ty::new();
///     *b = a;
/// }
/// ```
// rustc: compiler/rustc_mir_transform/src/liveness.rs:276 annotate_mut_binding_to_immutable_binding
function annotate_mut_binding_to_immutable_binding(
  tcx: TyCtxt,
  place: PlaceRef,
  body_def_id: LocalDefId,
  assignment_span: Span,
  body: Body,
): diagnostics.UnusedAssignSuggestion | undefined {
  // use rustc_hir as hir;
  // use rustc_hir::intravisit::{self, Visitor};

  // Verify we have a mutable argument...
  const local = place.as_local();
  if (local === undefined) return undefined;
  if (body.local_kind(local) !== "Arg") return undefined;
  if (body.local_decls[local]!.mutability !== "Mut") return undefined;

  // ... with reference type...
  const hir_param_index = Local.as_usize(local) - (tcx.is_closure_like(LocalDefId.to_def_id(body_def_id)) ? 2 : 1);
  const fn_decl = Node.fn_decl(tcx.hir_node_by_def_id(body_def_id));
  if (fn_decl === undefined) return undefined;
  const ty = fn_decl.inputs[hir_param_index]!;
  if (ty.kind.$ !== "Ref") return undefined;
  const [lt, inner_ty, mutbl] = [ty.kind._0, ty.kind._1, ty.kind._2];

  // ... as a binding pattern.
  const hir_body = tcx.hir_maybe_body_owned_by(body_def_id);
  if (hir_body === undefined) return undefined;
  const param = hir_body.params[hir_param_index]!;
  const pat_kind = param.pat.kind;
  if (!(pat_kind.$ === "Binding" && BindingMode_eq(pat_kind._0, BindingMode.MUT))) {
    return undefined;
  }
  const ident = pat_kind._2;

  // Find the assignment to modify.
  const finder = new ExprFinder(assignment_span, undefined, undefined);
  finder.visit_body(hir_body);
  const lhs = finder.lhs;
  if (lhs === undefined) return undefined;
  const rhs = finder.rhs;
  if (rhs === undefined) return undefined;

  if (!(rhs.kind.$ === "AddrOf" && rhs.kind._0 === "Ref")) return undefined;
  const inner = rhs.kind._2;

  // Changes to the parameter's type.
  const pre = Span.is_empty(lt.ident.span) ? "" : " ";
  const ty_span = Mutability.is_mut(mutbl)
    ? // Leave `&'name mut Ty` and `&mut Ty` as they are (#136028).
      undefined
    : // `&'name Ty` -> `&'name mut Ty` or `&Ty` -> `&mut Ty`
      Span.shrink_to_lo(inner_ty.span);

  return {
    ty_span,
    pre,
    // Span of the `mut` before the binding.
    ty_ref_span: Span.until(param.pat.span, ident.span),
    // Where to add a `*`.
    pre_lhs_span: Span.shrink_to_lo(lhs.span),
    // Where to remove the borrow.
    rhs_borrow_span: Span.until(rhs.span, inner.span),
  };
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:335 ExprFinder
class ExprFinder extends HirVisitor {
  constructor(
    public assignment_span: Span,
    public lhs: hir.Expr | undefined,
    public rhs: hir.Expr | undefined,
  ) {
    super();
  }

  // impl<'hir> Visitor<'hir> for ExprFinder<'hir>
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:341 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    if (expr.span === this.assignment_span && expr.kind.$ === "Assign") {
      const [lhs, rhs] = [expr.kind._0, expr.kind._1];
      this.lhs = lhs;
      this.rhs = rhs;
    } else {
      walk_expr(this, expr);
    }
    return undefined;
  }
}

/// Compute self-assignments of the form `a += b`.
///
/// MIR building generates 2 statements and 1 terminator for such assignments:
/// - _temp = CheckedBinaryOp(a, b)
/// - assert(!_temp.1)
/// - a = _temp.0
///
/// This function tries to detect this pattern in order to avoid marking statement as a definition
/// and use. This will let the analysis be dictated by the next use of `a`.
///
/// Note that we will still need to account for the use of `b`.
// rustc: compiler/rustc_mir_transform/src/liveness.rs:365 find_self_assignments
function find_self_assignments(checked_places: PlaceSet, body: Body): KeyedSet<Location> {
  const self_assign = new KeyedSet<Location>(key_Location);

  const FIELD_0 = 0 as FieldIdx;
  const FIELD_1 = 1 as FieldIdx;

  const blocks = body.basic_blocks.deref();
  for (let bb = 0 as BasicBlock; bb < blocks.length; bb++) {
    const bb_data = blocks[bb]!;
    for (let statement_index = 0; statement_index < bb_data.statements.length; statement_index++) {
      const stmt = bb_data.statements[statement_index]!;
      if (stmt.kind.$ !== "Assign") continue;
      const [first_place, rvalue] = stmt.kind._0;
      if (
        rvalue.$ === "BinaryOp" &&
        (rvalue._0 === "AddWithOverflow" || rvalue._0 === "SubWithOverflow" || rvalue._0 === "MulWithOverflow") &&
        rvalue._1[0].$ === "Copy"
      ) {
        // For checked binary ops, the MIR builder inserts an assertion in between.
        const lhs = rvalue._1[0]._0;
        // Checked binary ops only appear at the end of the block, before the assertion.
        if (statement_index + 1 !== bb_data.statements.length) {
          continue;
        }

        const tk = bb_data.terminator_().kind;
        if (!(tk.$ === "Assert" && tk.msg.$ === "Overflow")) {
          continue;
        }
        const [cond, target] = [tk.cond, tk.target];
        const assign = body.basic_blocks.deref()[target]!.statements[0];
        if (assign === undefined) {
          continue;
        }
        if (!(assign.kind.$ === "Assign" && assign.kind._0[1].$ === "Use" && assign.kind._0[1]._0.$ === "Move")) {
          continue;
        }
        const dest = assign.kind._0[0];
        const temp = assign.kind._0[1]._0._0;

        if (!place_eq(dest, lhs)) {
          continue;
        }

        if (cond.$ !== "Move") continue;
        const cond_ = cond._0;
        const tp = temp.projection;
        if (!(tp.length === 1 && tp[0]!.$ === "Field" && tp[0]!._0 === FIELD_0)) {
          continue;
        }
        const cp = cond_.projection;
        if (!(cp.length === 1 && cp[0]!.$ === "Field" && cp[0]!._0 === FIELD_1)) {
          continue;
        }

        // We ignore indirect self-assignment, because both occurrences of `dest` are uses.
        const got = checked_places.get(dest.as_ref());
        const is_indirect_ = got !== undefined && is_indirect(got[1]);
        if (is_indirect_) {
          continue;
        }

        if (first_place.local === temp.local && first_place.local === cond_.local && first_place.projection.length === 0) {
          // Original block
          self_assign.add(new Location(bb, bb_data.statements.length - 1));
          self_assign.add(new Location(bb, bb_data.statements.length));
          // Target block
          self_assign.add(BasicBlock.start_location(target));
        }
      } else if (rvalue.$ === "BinaryOp" && rvalue._1[0].$ === "Copy") {
        // Straight self-assignment.
        const op = rvalue._0;
        const lhs = rvalue._1[0]._0;
        if (!place_eq(lhs, first_place)) {
          continue;
        }

        // We ignore indirect self-assignment, because both occurrences of `dest` are uses.
        const got = checked_places.get(first_place.as_ref());
        const is_indirect_ = got === undefined ? false : is_indirect(got[1]);
        if (is_indirect_) {
          continue;
        }

        self_assign.add(new Location(bb, statement_index));

        // Checked division verifies overflow before performing the division, so we
        // need to go and ignore this check in the predecessor block.
        if ((op === "Div" || op === "Rem") && statement_index === 0) {
          const preds = body.basic_blocks.predecessors()[bb]!;
          if (preds.length === 1) {
            const pred = preds[0]!;
            const ptk = body.basic_blocks.deref()[pred]!.terminator_().kind;
            if (ptk.$ === "Assert" && ptk.msg.$ === "Overflow") {
              const len = body.basic_blocks.deref()[pred]!.statements.length;
              if (len >= 2) {
                // BitAnd of two checks.
                self_assign.add(new Location(pred, len - 1));
                // `lhs == MIN`.
                self_assign.add(new Location(pred, len - 2));
              }
            }
          }
        }
      }
    }
  }

  return self_assign;
}

// #[derive(Default, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:482 PlaceSet
class PlaceSet {
  constructor(
    public places: PlaceRef[],
    public names: ([Symbol, Span] | undefined)[],

    /// Places corresponding to locals, common case.
    public locals: (PlaceIndex | undefined)[],

    // Handling of captures.
    /// If `_1` is a reference, we need to add a `Deref` to the matched place.
    public capture_field_pos: number,
    /// Captured fields.
    public captures: [PlaceIndex, boolean][],
  ) {}

  /** `#[derive(Default)]`. */
  static default(): PlaceSet {
    return new PlaceSet([], [], [], 0, []);
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:497 insert_locals
  insert_locals(decls: readonly LocalDecl[]): void {
    this.locals = new Array<PlaceIndex | undefined>(decls.length).fill(undefined);
    for (let local = 0 as Local; local < decls.length; local++) {
      const decl = decls[local]!;
      // Record all user-written locals for the analysis.
      // We also keep the `RefForGuard` locals (more on that below).
      const info = decl.local_info_();
      if (info.$ === "User" && (info._0.$ === "Var" || info._0.$ === "RefForGuard")) {
        const index = PlaceIndex.from_usize(this.places.push(PlaceRef_from_Local(local)) - 1);
        this.locals[local] = index;
        this.names.push(undefined);
        // debug_assert_eq!(index, _index);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:513 insert_captures
  insert_captures(tcx: TyCtxt, self_is_ref: boolean, captures: readonly CapturedPlace[], upvars: List<Ty>): void {
    // We should not track the environment local separately.
    // debug_assert_eq!(self.locals[ty::CAPTURE_STRUCT_LOCAL], None);

    const self_place = new Place(CAPTURE_STRUCT_LOCAL, tcx.mk_place_elems(self_is_ref ? [ProjectionElem.Deref] : []));
    if (self_is_ref) {
      this.capture_field_pos = 1;
    }

    const n = Math.min(captures.length, upvars.length);
    for (let f_ = 0; f_ < n; f_++) {
      const [capture, ty] = [captures[f_]!, upvars[f_]!];
      const f = f_ as FieldIdx;
      const elem: PlaceElem = { $: "Field", _0: f, _1: ty };
      const by_ref = capture.info.capture_kind.$ === "ByRef";
      const place = by_ref ? self_place.project_deeper([elem, ProjectionElem.Deref], tcx) : self_place.project_deeper([elem], tcx);
      const index = PlaceIndex.from_usize(this.places.push(place.as_ref()) - 1);
      this.captures.push([index, by_ref]);
      // debug_assert_eq!(_f, f);

      // Record a variable name from the capture, because it is much friendlier than the
      // debuginfo name.
      while (this.names.length <= index) this.names.push(undefined);
      this.names[index] = [Symbol.intern(capture.to_string(tcx)), capture.get_path_span(tcx)];
    }
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:553 record_debuginfo
  record_debuginfo(var_debug_info: readonly VarDebugInfo[]): void {
    const ignore_name = (name: Symbol): boolean => {
      return name === sym.empty || name === kw.SelfLower || Symbol.as_str(name).startsWith("_");
    };
    for (const var_debug_info_ of var_debug_info) {
      if (var_debug_info_.value.$ === "Place") {
        const place = var_debug_info_.value._0;
        const index = this.locals[place.local];
        if (index !== undefined && !ignore_name(var_debug_info_.name)) {
          while (this.names.length <= index) this.names.push(undefined);
          this.names[index] ??= [var_debug_info_.name, var_debug_info_.source_info.span];
        }
      }
    }

    // Discard places that will not result in a diagnostic.
    for (let i = 0; i < this.locals.length; i++) {
      const index = this.locals[i];
      if (index !== undefined) {
        const n = this.names[index];
        let remove: boolean;
        if (n === undefined) {
          remove = true;
        } else {
          const [name] = n;
          remove = ignore_name(name);
        }
        if (remove) {
          this.locals[i] = undefined;
        }
      }
    }
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:583 get
  get(place: PlaceRef): [PlaceIndex, readonly PlaceElem[]] | undefined {
    const index = this.locals[place.local];
    if (index !== undefined) {
      return [index, place.projection];
    }
    if (place.local === CAPTURE_STRUCT_LOCAL && this.captures.length !== 0 && this.capture_field_pos < place.projection.length) {
      const elem = place.projection[this.capture_field_pos]!;
      if (elem.$ === "Field") {
        const f = elem._0;
        const got = this.captures[f];
        if (got !== undefined) {
          const [index, by_ref] = got;
          let start = this.capture_field_pos + 1;
          if (by_ref) {
            // Account for an extra Deref.
            start += 1;
          }
          // We may have an attempt to access `_1.f` as a shallow reborrow. Just ignore it.
          if (start <= place.projection.length) {
            const projection = place.projection.slice(start);
            return [index, projection];
          }
        }
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:607 iter
  iter(): [PlaceIndex, PlaceRef][] {
    return this.places.map((p, i) => [i as PlaceIndex, p]);
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:611 len
  len(): number {
    return this.places.length;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:616 AssignmentResult
class AssignmentResult {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public checked_places: PlaceSet,
    public body: Body,
    /// Set of locals that are live at least once. This is used to report fully unused locals.
    public ever_live: DenseBitSet<PlaceIndex>,
    /// Set of locals that have a non-trivial drop. This is used to skip reporting unused
    /// assignment if it would be used by the `Drop` impl.
    public ever_dropped: DenseBitSet<PlaceIndex>,
    /// Set of assignments for each local. Here, assignment is understood in the AST sense. Any
    /// MIR that may look like an assignment (Assign, DropAndReplace, Yield, Call) are considered.
    ///
    /// For each local, we return a map: for each source position, whether the statement is live
    /// and which kind of access it performs. When we encounter multiple statements at the same
    /// location, we only increase the liveness, in order to avoid false positives.
    public assignments: KeyedMap<SourceInfo, Access>[],
  ) {}

  /// Collect all assignments to checked locals.
  ///
  /// Assignments are collected, even if they are live. Dead assignments are reported, and live
  /// assignments are used to make diagnostics correct for match guards.
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:640 find_dead_assignments
  static find_dead_assignments(
    tcx: TyCtxt,
    typing_env: TypingEnv,
    checked_places: PlaceSet,
    cursor: ResultsCursor<DenseBitSet<PlaceIndex>, MaybeLivePlaces>,
    body: Body,
  ): AssignmentResult {
    const ever_live = DenseBitSet.new_empty<PlaceIndex>(checked_places.len());
    const ever_dropped = DenseBitSet.new_empty<PlaceIndex>(checked_places.len());
    const assignments: KeyedMap<SourceInfo, Access>[] = checked_places.places.map(() => new KeyedMap<SourceInfo, Access>(key_SourceInfo));

    const check_place = (place: Place, kind: AccessKind, source_info: SourceInfo, location: Location, live: DenseBitSet<PlaceIndex>): void => {
      const got = checked_places.get(place.as_ref());
      if (got !== undefined) {
        const [index, extra_projections] = got;
        if (!is_indirect(extra_projections)) {
          const is_direct = extra_projections.length === 0;
          const o = assignments[index]!.get(source_info);
          if (o === undefined) {
            const access: Access = { kind, location, live: live.contains(index), is_direct };
            assignments[index]!.set(source_info, access);
          } else {
            // There were already a sighting. Mark this statement as live if it
            // was, to avoid false positives.
            o.live ||= live.contains(index);
            o.is_direct &&= is_direct;
          }
        }
      }
    };

    const record_drop = (place: Place): void => {
      const got = checked_places.get(place.as_ref());
      if (got !== undefined && got[1].length === 0) {
        ever_dropped.insert(got[0]);
      }
    };

    for (const [bb, bb_data] of traversal.postorder(body)) {
      cursor.seek_to_block_end(bb);
      const live = cursor.get();
      ever_live.union(live);

      const terminator = bb_data.terminator_();
      const tk = terminator.kind;
      switch (tk.$) {
        case "Call":
        case "Yield": {
          const place = tk.$ === "Call" ? tk.destination : tk.resume_arg;
          check_place(place, AccessKind.Assign, terminator.source_info, body.terminator_loc(bb), live);
          record_drop(place);
          break;
        }
        case "Drop":
          record_drop(tk.place);
          break;
        case "InlineAsm": {
          for (const operand of tk.operands) {
            const place = operand.$ === "Out" ? operand.place : operand.$ === "InOut" ? operand.out_place : undefined;
            if (place !== undefined) {
              check_place(place, AccessKind.Assign, terminator.source_info, body.terminator_loc(bb), live);
            }
          }
          break;
        }
        default:
          break;
      }

      for (let statement_index = bb_data.statements.length - 1; statement_index >= 0; statement_index--) {
        const statement = bb_data.statements[statement_index]!;
        const location = new Location(bb, statement_index);
        cursor.seek_before_primary_effect(location);
        const live = cursor.get();
        ever_live.union(live);
        const sk = statement.kind;
        switch (sk.$) {
          case "Assign": {
            const place = sk._0[0];
            check_place(place, AccessKind.Assign, statement.source_info, location, live);
            break;
          }
          case "SetDiscriminant": {
            check_place(sk.place, AccessKind.Assign, statement.source_info, location, live);
            break;
          }
          case "StorageLive":
          case "StorageDead":
          case "Coverage":
          case "Intrinsic":
          case "Nop":
          case "FakeRead":
          case "PlaceMention":
          case "ConstEvalCounter":
          case "BackwardIncompatibleDropHint":
          case "AscribeUserType":
            break;
        }
      }
    }

    // Check liveness of function arguments on entry.
    {
      cursor.seek_to_block_start(START_BLOCK);
      const live = cursor.get();
      ever_live.union(live);

      // Verify that arguments and captured values are useful.
      for (const [index, place] of checked_places.iter()) {
        let kind: AccessKind;
        if (is_capture(place)) {
          // This is a by-ref capture, an assignment to it will modify surrounding
          // environment, so we do not report it.
          const last = place.projection[place.projection.length - 1];
          if (last !== undefined && last.$ === "Deref") {
            continue;
          }

          kind = AccessKind.Capture;
        } else if (body.local_kind(place.local) === "Arg") {
          kind = AccessKind.Param;
        } else {
          continue;
        }
        const source_info = body.local_decls[place.local]!.source_info;
        const access: Access = {
          kind,
          location: Location.START,
          live: live.contains(index),
          is_direct: true,
        };
        assignments[index]!.set(source_info, access);
      }
    }

    return new AssignmentResult(tcx, typing_env, checked_places, body, ever_live, ever_dropped, assignments);
  }

  /// Match guards introduce a different local to freeze the guarded value as immutable.
  /// Having two locals, we need to make sure that we do not report an unused_variable
  /// when the guard local is used but not the arm local, or vice versa, like in this example.
  ///
  ///    match 5 {
  ///      x if x > 2 => {}
  ///      ^    ^- This is `local`
  ///      +------ This is `arm_local`
  ///      _ => {}
  ///    }
  ///
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:814 merge_guards
  merge_guards(): void {
    for (const [index, place] of this.checked_places.iter()) {
      const local = place.local;
      const info = this.body.local_decls[local]!.local_info_();
      if (info.$ === "User" && info._0.$ === "RefForGuard") {
        const arm_local = info._0._0;
        // debug_assert!(place.projection.is_empty());

        // Local to use in the arm.
        const got = this.checked_places.get(PlaceRef_from_Local(arm_local));
        if (got === undefined) {
          continue;
        }
        const [arm_index] = got;
        // debug_assert_ne!(index, arm_index);
        // debug_assert_eq!(_proj, &[]);

        // Mark the arm local as used if the guard local is used.
        if (this.ever_live.contains(index)) {
          this.ever_live.insert(arm_index);
        }

        // Some assignments are common to both locals in the source code.
        // Sadly, we can only detect this using the `source_info`.
        // Therefore, we loop over all the assignments we have for the guard local:
        // - if they already appeared for the arm local, the assignment is live if one of the
        //   two versions is live;
        // - if it does not appear for the arm local, it happened inside the guard, so we add
        //   it as-is.
        const guard_assignments = this.assignments[index]!;
        this.assignments[index] = new KeyedMap<SourceInfo, Access>(key_SourceInfo);
        const arm_assignments = this.assignments[arm_index]!;
        for (const [source_info, access] of guard_assignments) {
          const o = arm_assignments.get(source_info);
          if (o === undefined) {
            arm_assignments.set(source_info, access);
          } else {
            o.live ||= access.live;
          }
        }
      }
    }
  }

  /// Compute captures that are fully dead.
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:858 compute_dead_captures
  compute_dead_captures(num_captures: number): DenseBitSet<FieldIdx> {
    // Report to caller the set of dead captures.
    const dead_captures = DenseBitSet.new_empty<FieldIdx>(num_captures);
    for (const [index, place] of this.checked_places.iter()) {
      if (this.ever_live.contains(index)) {
        continue;
      }

      // This is a capture: pass information to the enclosing function.
      if (is_capture(place)) {
        for (const p of place.projection) {
          if (p.$ === "Field") {
            dead_captures.insert(p._0);
            break;
          }
        }
        continue;
      }
    }

    return dead_captures;
  }

  /// Check if a local is referenced in any reachable basic block.
  /// Variables in unreachable code (e.g., after `todo!()`) should not trigger unused warnings.
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:883 is_local_in_reachable_code
  is_local_in_reachable_code(local: Local): boolean {
    const visitor = new LocalVisitor(local, false);
    for (const [bb, bb_data] of traversal.postorder(this.body)) {
      visitor.visit_basic_block_data(bb, bb_data);
      if (visitor.found) {
        return true;
      }
    }

    return false;
  }

  /// Check for source-level uses that may have been removed from reachable MIR.
  /// For example:
  /// ```rust
  /// fn example() {
  ///     let x = todo!();
  ///     eprintln!("{x}");
  /// }
  /// ```
  /// The use of x is unreachable, but we'll still want to know if x is used to correctly emit
  /// unused variable warning.
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:918 is_local_used_in_source
  is_local_used_in_source(name: Symbol, def_span: Span): boolean {
    // use rustc_hir as hir;
    // use rustc_hir::def::Res;
    // use rustc_hir::intravisit::{self, Visitor};

    const body_def_id = this.body.source.def_id().as_local();
    if (body_def_id === undefined) return false;
    const hir_body = this.tcx.hir_maybe_body_owned_by(body_def_id);
    if (hir_body === undefined) return false;
    // PORT: `typeck` is typed `unknown` in queries.gen.ts (decision #34).
    const typeck_results = this.tcx.typeck(body_def_id) as TypeckResults;

    const visitor = new LocalUseVisitor(this.tcx, typeck_results, name, def_span, false);
    visitor.visit_body(hir_body);
    return visitor.found;
  }

  /// Report fully unused locals, and forget the corresponding assignments.
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:961 report_fully_unused
  report_fully_unused(): void {
    const tcx = this.tcx;

    // Give a diagnostic when any of the string constants look like a naked format string that
    // would interpolate our dead local.
    let string_constants_in_body: [Span, string][] | undefined = undefined;
    const maybe_suggest_literal_matching_name = (name: Symbol): diagnostics.UnusedVariableStringInterp[] => {
      // Visiting MIR to enumerate string constants can be expensive, so cache the result.
      string_constants_in_body ??= (() => {
        const finder = new LiteralFinder([]);
        finder.visit_body(this.body);
        return finder.found;
      })();

      const brace_name = `{${Symbol.as_str(name)}`;
      return string_constants_in_body
        .filter(([, rendered_constant]) =>
          rendered_constant.split(brace_name).some((c) => {
            const first = c.codePointAt(0);
            return first === 0x7d /* '}' */ || first === 0x3a /* ':' */;
          }),
        )
        .map(([lit]) => ({ lit }));
    };

    // First, report fully unused locals.
    for (const [index, place] of this.checked_places.iter()) {
      if (this.ever_live.contains(index)) {
        continue;
      }

      // this is a capture: let the enclosing function report the unused variable.
      if (is_capture(place)) {
        continue;
      }

      const local = place.local;
      const decl = this.body.local_decls[local]!;

      if (decl.from_compiler_desugaring()) {
        continue;
      }

      // Only report actual user-defined binding from now on.
      const info = decl.local_info_();
      if (!(info.$ === "User" && info._0.$ === "Var")) continue;
      const binding = info._0._0;
      const hir_id = SourceScope.lint_root(decl.source_info.scope, this.body.source_scopes);
      if (hir_id === undefined) {
        continue;
      }

      const introductions = binding.introductions;

      const n = this.checked_places.names[index];
      if (n === undefined) continue;
      const [name, def_span] = n;

      // #117284, when `ident_span` and `def_span` have different contexts
      // we can't provide a good suggestion, instead we pointed out the spans from macro
      const from_macro = Span.from_expansion(def_span) && introductions.some((intro) => Span.eq_ctxt(intro.span, def_span));

      const maybe_suggest_typo = (): diagnostics.PatternTypo | undefined => {
        if (this.body.local_kind(local) === "Arg") {
          return undefined;
        } else {
          return maybe_suggest_unit_pattern_typo(tcx, this.body.source.def_id(), name, def_span, decl.ty);
        }
      };

      // the is_local_used_in_source is sufficient to check if the local is used in the source code,
      // but we keep the local_kind check for a cheap filter to avoid heavy check
      const is_used_after_uninitialized =
        this.body.local_kind(local) === "Temp" &&
        binding.opt_match_place !== undefined &&
        binding.opt_match_place[0] === undefined &&
        this.is_local_used_in_source(name, def_span);

      const statements = this.assignments[index]!;
      if (statements.size === 0) {
        if (is_used_after_uninitialized) {
          // A local from `let PAT = ...` normally has an assignment recorded for the
          // value it initializes. If no assignment was recorded in reachable MIR, the
          // initializer did not complete. If the local still has a source-level use,
          // that use was made unreachable by the diverging initializer.
          continue;
        }

        if (!this.is_local_in_reachable_code(local)) {
          continue;
        }

        let sugg: diagnostics.UnusedVariableSugg;
        if (from_macro) {
          sugg = { $: "NoSugg", span: def_span, name };
        } else {
          const typo = maybe_suggest_typo();
          sugg = { $: "TryPrefix", spans: [def_span], name, typo };
        }
        tcx.emit_node_span_lint(
          UNUSED_VARIABLES,
          hir_id,
          def_span,
          diagnostics.UnusedVariable_diagnostic({
            name,
            string_interp: maybe_suggest_literal_matching_name(name),
            sugg,
          }),
        );
        continue;
      }

      // Idiomatic rust assigns a value to a local upon definition. However, we do not want to
      // warn twice, for the unused local and for the unused assignment. Therefore, we remove
      // from the list of assignments the ones that happen at the definition site.
      retain(statements, (source_info) => {
        return !binding.introductions.some((intro) => intro.span === source_info.span);
      });

      // Extra assignments that we recognize thanks to the initialization span. We need to
      // take care of macro contexts here to be accurate.
      if (binding.opt_match_place !== undefined) {
        const initializer_span = binding.opt_match_place[1];
        retain(statements, (source_info) => {
          const within = Span.find_ancestor_inside(source_info.span, initializer_span);
          const outer_initializer_span = Span.find_ancestor_in_same_ctxt(initializer_span, source_info.span);
          return within === undefined && (outer_initializer_span === undefined || !Span.contains(outer_initializer_span, source_info.span));
        });
      }

      if (statements.size !== 0) {
        // We have a dead local with outstanding assignments and with non-trivial drop.
        // This is probably a drop-guard, so we do not issue a warning there.
        if (maybe_drop_guard(tcx, this.typing_env, index, this.ever_dropped, this.checked_places, this.body)) {
          retain(statements, (_, access) => access.is_direct);
          if (statements.size === 0) {
            continue;
          }
        }

        const typo = maybe_suggest_typo();
        tcx.emit_node_span_lint(UNUSED_VARIABLES, hir_id, def_span, diagnostics.UnusedVarAssignedOnly_diagnostic({ name, typo }));
        continue;
      }

      // We do not have outstanding assignments, suggest renaming the binding.
      const spans = introductions.map((intro) => intro.span);

      const any_shorthand = introductions.some((intro) => intro.is_shorthand);

      let sugg: diagnostics.UnusedVariableSugg;
      if (any_shorthand) {
        sugg = {
          $: "TryIgnore",
          name: Symbol.to_ident_string(name),
          shorthands: introductions.filter((intro) => intro.is_shorthand).map((intro) => intro.span),
          non_shorthands: introductions.filter((intro) => !intro.is_shorthand).map((intro) => intro.span),
        };
      } else if (from_macro) {
        sugg = { $: "NoSugg", span: def_span, name };
      } else if (introductions.length !== 0) {
        const typo = maybe_suggest_typo();
        sugg = { $: "TryPrefix", name, typo, spans: spans.slice() };
      } else {
        const typo = maybe_suggest_typo();
        sugg = { $: "TryPrefix", name, typo, spans: [def_span] };
      }

      tcx.emit_node_span_lint(
        UNUSED_VARIABLES,
        hir_id,
        spans,
        diagnostics.UnusedVariable_diagnostic({
          name,
          string_interp: maybe_suggest_literal_matching_name(name),
          sugg,
        }),
      );
    }
  }

  /// Second, report unused assignments that do not correspond to initialization.
  /// Initializations have been removed in the previous loop reporting unused variables.
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1182 report_unused_assignments
  report_unused_assignments(): void {
    const tcx = this.tcx;

    for (let index = 0 as PlaceIndex; index < this.assignments.length; index++) {
      const statements = this.assignments[index]!;
      if (statements.size === 0) {
        continue;
      }

      const n = this.checked_places.names[index];
      if (n === undefined) continue;
      const [name, decl_span] = n;

      const is_maybe_drop_guard = maybe_drop_guard(tcx, this.typing_env, index, this.ever_dropped, this.checked_places, this.body);

      // By convention, underscore-prefixed bindings are allowed to be unused explicitly.
      if (Symbol.as_str(name).startsWith("_")) {
        continue;
      }

      const next_direct_assignments: [Span, Location][] = [];
      const dead_statements: [SourceInfo, AccessKind, boolean, diagnostics.UnusedAssignOverwrite | undefined][] = [];

      for (const [source_info, { live, kind, is_direct, location }] of statements) {
        const direct_assignment = kind === AccessKind.Assign && is_direct;
        const should_report = !live && (is_direct || !is_maybe_drop_guard);

        let overwrite: diagnostics.UnusedAssignOverwrite | undefined;
        if (should_report && direct_assignment) {
          let found: [Span, Location] | undefined = undefined;
          for (let i = next_direct_assignments.length - 1; i >= 0; i--) {
            const [, overwrite_location] = next_direct_assignments[i]!;
            if (location.is_predecessor_of(overwrite_location, this.body)) {
              found = next_direct_assignments[i]!;
              break;
            }
          }
          overwrite =
            found === undefined
              ? undefined
              : {
                  assigned_span: source_info.span,
                  overwrite_span: found[0],
                  name,
                };
        } else {
          overwrite = undefined;
        }

        if (direct_assignment) {
          next_direct_assignments.push([source_info.span, location]);
        }

        if (!should_report) {
          continue;
        }
        dead_statements.push([source_info, kind, is_direct, overwrite]);
      }

      // We probed MIR in reverse order for dataflow.
      // Emit diagnostics in source order instead.
      for (let i = dead_statements.length - 1; i >= 0; i--) {
        const [source_info, kind, is_direct, overwrite] = dead_statements[i]!;
        // Report the dead assignment.
        const hir_id = SourceScope.lint_root(source_info.scope, this.body.source_scopes);
        if (hir_id === undefined) {
          continue;
        }

        switch (kind) {
          case "Assign": {
            const suggestion = annotate_mut_binding_to_immutable_binding(
              tcx,
              this.checked_places.places[index]!,
              this.body.source.def_id().expect_local(),
              source_info.span,
              this.body,
            );
            const overwrite_ = suggestion === undefined && is_direct ? overwrite : undefined;
            const help = suggestion === undefined && overwrite_ === undefined;
            tcx.emit_node_span_lint(
              UNUSED_ASSIGNMENTS,
              hir_id,
              source_info.span,
              diagnostics.UnusedAssign_diagnostic({ name, overwrite: overwrite_, help, suggestion }),
            );
            break;
          }
          case "Param":
            tcx.emit_node_span_lint(UNUSED_ASSIGNMENTS, hir_id, source_info.span, diagnostics.UnusedAssignPassed_diagnostic({ name }));
            break;
          case "Capture":
            tcx.emit_node_span_lint(UNUSED_ASSIGNMENTS, hir_id, decl_span, diagnostics.UnusedCaptureMaybeCaptureRef_diagnostic({ name }));
            break;
        }
      }
    }
  }
}

// struct LocalVisitor (nested in `is_local_in_reachable_code`)
class LocalVisitor extends Visitor {
  constructor(
    public target_local: Local,
    public found: boolean,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for LocalVisitor
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:890 visit_local
  override visit_local(local: Local, _context: PlaceContext, _location: Location): void {
    if (local === this.target_local) {
      this.found = true;
    }
  }
}

// struct LocalUseVisitor (nested in `is_local_used_in_source`)
class LocalUseVisitor extends HirVisitor {
  constructor(
    public tcx: TyCtxt,
    public typeck_results: TypeckResults,
    public name: Symbol,
    public def_span: Span,
    public found: boolean,
  ) {
    super();
  }

  // impl<'a, 'tcx> Visitor<'tcx> for LocalUseVisitor<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:936 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    if (this.found) {
      return undefined;
    }

    if (expr.kind.$ === "Path") {
      const qpath = expr.kind._0;
      const res = this.typeck_results.qpath_res(qpath, expr.hir_id);
      if (res.$ === "Local") {
        const hir_id = res._0;
        if (this.tcx.hir_name(hir_id) === this.name && this.tcx.hir_span(hir_id) === this.def_span) {
          this.found = true;
          return undefined;
        }
      }
    }

    walk_expr(this, expr);
    return undefined;
  }
}

// struct LiteralFinder (nested in `report_fully_unused`)
class LiteralFinder extends Visitor {
  constructor(public found: [Span, string][]) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for LiteralFinder
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:975 visit_const_operand
  override visit_const_operand(constant: ConstOperand, _: Location): void {
    const k = constant.ty().kind();
    if (k.$ === "Ref" && k._1.kind().$ === "Str") {
      const rendered_constant = display_Const(constant.const_);
      this.found.push([constant.span, rendered_constant]);
    }
  }
}

// rustc_index::newtype_index! {
//     pub struct PlaceIndex {}
// }
type PlaceIndex = number & { readonly __brand: "liveness::PlaceIndex" };
const PlaceIndex = newtype_index<PlaceIndex>((n) => `${n}`);

// impl DebugWithContext<MaybeLivePlaces<'_, '_>> for PlaceIndex
const DebugWithContext_PlaceIndex: DebugWithContext<PlaceIndex, MaybeLivePlaces> = DebugWithContext_impl<PlaceIndex, MaybeLivePlaces>(
  (a, b) => a === b,
  PlaceIndex.debug,
  {
    // rustc: compiler/rustc_mir_transform/src/liveness.rs:1289 fmt_with
    fmt_with(self: PlaceIndex, ctxt: MaybeLivePlaces, f): string {
      return debug_PlaceRef(ctxt.checked_places.places[self]!, f);
    },
  },
);

// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:1298 MaybeLivePlaces
export class MaybeLivePlaces extends AnalysisBase<DenseBitSet<PlaceIndex>> {
  constructor(
    public tcx: TyCtxt,
    public checked_places: PlaceSet,
    public capture_kind: CaptureKind,
    public self_assignment: KeyedSet<Location>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1306 transfer_function
  transfer_function(trans: DenseBitSet<PlaceIndex>): TransferFunction {
    return new TransferFunction(this.tcx, this.checked_places, trans, this.capture_kind, this.self_assignment);
  }

  // impl<'tcx> Analysis<'tcx> for MaybeLivePlaces<'_, 'tcx>
  // type Domain = DenseBitSet<PlaceIndex>;
  readonly Domain: Domain<DenseBitSet<PlaceIndex>> = Domain_DenseBitSet(DebugWithContext_PlaceIndex);
  // type Direction = Backward;
  override readonly Direction: Direction = Backward;

  readonly NAME = "liveness-lint";

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1326 bottom_value
  bottom_value(_: Body): DenseBitSet<PlaceIndex> {
    // bottom = not live
    return DenseBitSet.new_empty(this.checked_places.len());
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1331 initialize_start_block
  initialize_start_block(_: Body, _1: DenseBitSet<PlaceIndex>): void {
    // No variables are live until we observe a use
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1335 apply_primary_statement_effect
  apply_primary_statement_effect(trans: DenseBitSet<PlaceIndex>, statement: Statement, location: Location): void {
    this.transfer_function(trans).visit_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1344 apply_primary_terminator_effect
  override apply_primary_terminator_effect(trans: DenseBitSet<PlaceIndex>, terminator: Terminator, location: Location): void {
    this.transfer_function(trans).visit_terminator(terminator, location);
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1353 apply_call_return_effect
  override apply_call_return_effect(_trans: DenseBitSet<PlaceIndex>, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    // FIXME: what should happen here?
  }
}

// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:1363 TransferFunction
class TransferFunction extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public checked_places: PlaceSet,
    public trans: DenseBitSet<PlaceIndex>,
    public capture_kind: CaptureKind,
    public self_assignment: KeyedSet<Location>,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for TransferFunction<'_, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1372 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const sk = statement.kind;
    // `ForLet(None)` and `ForGuardBinding` fake reads erroneously mark the just-assigned
    // locals as live. This defeats the purpose of the analysis for such bindings.
    if (sk.$ === "FakeRead" && ((sk._0[0].$ === "ForLet" && sk._0[0]._0 === undefined) || sk._0[0].$ === "ForGuardBinding")) {
      return;
    }
    // Handle self-assignment by restricting the read/write they do.
    else if (sk.$ === "Assign" && this.self_assignment.has(location)) {
      const [dest, rvalue] = sk._0;
      if (
        rvalue.$ === "BinaryOp" &&
        (rvalue._0 === "AddWithOverflow" || rvalue._0 === "SubWithOverflow" || rvalue._0 === "MulWithOverflow")
      ) {
        const rhs = rvalue._1[1];
        // We are computing the binary operation:
        // - the LHS will be assigned, so we don't read it;
        // - the RHS still needs to be read.
        this.visit_operand(rhs, location);
        this.visit_place(dest, { $: "MutatingUse", _0: "Store" }, location);
      } else if (rvalue.$ === "BinaryOp") {
        const rhs = rvalue._1[1];
        // We are computing the binary operation:
        // - the LHS is being updated, so we don't read it;
        // - the RHS still needs to be read.
        this.visit_operand(rhs, location);
      } else {
        // This is the second part of a checked self-assignment,
        // we are assigning the result.
        // We do not consider the write to the destination as a `def`.
        // `self_assignment` must be false if the assignment is indirect.
        this.visit_rvalue(rvalue, location);
      }
    } else {
      this.super_statement(statement, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1415 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // By-ref captures could be read by the surrounding environment, so we mark
    // them as live upon yield and return.
    const tk = terminator.kind;
    if (
      (tk.$ === "Return" ||
        tk.$ === "Yield" ||
        (tk.$ === "Goto" && tk.target === START_BLOCK) || // Inserted for the `FnMut` case.
        (tk.$ === "Call" && tk.target === undefined)) && // unwinding could be caught
      this.capture_kind.$ !== "None"
    ) {
      // All indirect captures have an effect on the environment, so we mark them as live.
      for (const [index, place] of this.checked_places.iter()) {
        const last = place.projection[place.projection.length - 1];
        if (place.local === CAPTURE_STRUCT_LOCAL && last !== undefined && last.$ === "Deref") {
          this.trans.insert(index);
        }
      }
    }
    // Do not consider a drop to be a use. We whitelist interesting drops elsewhere.
    else if (tk.$ === "Drop") {
    }
    // Ignore assertions since they must be triggered by actual code.
    else if (tk.$ === "Assert") {
    } else {
      this.super_terminator(terminator, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1442 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    // When a closure/generator does not use some of its captures, do not consider these
    // captures as live in the surrounding function. This allows to report unused variables,
    // even if they have been (uselessly) captured.
    if (rvalue.$ === "Aggregate" && (rvalue._0.$ === "Closure" || rvalue._0.$ === "Coroutine")) {
      const def_id = rvalue._0._0;
      const operands = rvalue._1;
      const def_id_ = def_id.as_local();
      if (def_id_ !== undefined) {
        // PORT: the query value is typed `unknown` in queries.gen.ts (lib.ts provides this fn).
        const dead_captures = this.tcx.check_liveness(def_id_) as DenseBitSet<FieldIdx>;
        const n = Math.min(operands.length, dead_captures.domain_size());
        for (let field = 0 as FieldIdx; field < n; field++) {
          const operand = operands[field]!;
          if (!dead_captures.contains(field)) {
            this.visit_operand(operand, location);
          }
        }
      }
    } else {
      this.super_rvalue(rvalue, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1466 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    const got = this.checked_places.get(place.as_ref());
    if (got !== undefined) {
      const [index, extra_projections] = got;
      for (let i = place.projection.length; i >= extra_projections.length; i--) {
        const place_part = new PlaceRef(place.local, place.projection.slice(0, i));
        const extra_projections_ = place.projection.slice(i);

        const elem = extra_projections_[0];
        if (elem !== undefined) {
          this.visit_projection_elem(place_part, elem, context, location);
        }
      }

      const du = DefUse.for_place(extra_projections, context);
      if (du === "Def") {
        this.trans.remove(index);
      } else if (du === "Use") {
        this.trans.insert(index);
      } else {
      }
    } else {
      this.super_place(place, context, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1492 visit_local
  override visit_local(local: Local, context: PlaceContext, _: Location): void {
    const got = this.checked_places.get(PlaceRef_from_Local(local));
    if (got !== undefined) {
      const [index] = got;
      // debug_assert_eq!(_proj, &[]);
      const du = DefUse.for_place([], context);
      if (du === "Def") {
        this.trans.remove(index);
      } else if (du === "Use") {
        this.trans.insert(index);
      } else {
      }
    }
  }
}

// #[derive(Eq, PartialEq, Debug, Clone)]
// rustc-type: compiler/rustc_mir_transform/src/liveness.rs:1509 DefUse
type DefUse = "Def" | "Use";

// rustc: compiler/rustc_mir_transform/src/liveness.rs:1514 is_indirect
function is_indirect(proj: readonly PlaceElem[]): boolean {
  return proj.some((p) => ProjectionElem.is_indirect(p));
}

const DefUse = {
  Def: "Def",
  Use: "Use",

  // rustc: compiler/rustc_mir_transform/src/liveness.rs:1519 for_place
  for_place(projection: readonly PlaceElem[], context: PlaceContext): DefUse | undefined {
    const is_indirect_ = is_indirect(projection);
    if (context.$ === "MutatingUse" && (context._0 === "Store" || context._0 === "SetDiscriminant")) {
      if (is_indirect_) {
        // Treat derefs as a use of the base local. `*p = 4` is not a def of `p` but a
        // use.
        return "Use";
      } else if (projection.length === 0) {
        return "Def";
      } else {
        return undefined;
      }
    }

    // For the associated terminators, this is only a `Def` when the terminator returns
    // "successfully." As such, we handle this case separately in `call_return_effect`
    // above. However, if the place looks like `*_5`, this is still unconditionally a use of
    // `_5`.
    else if (context.$ === "MutatingUse" && (context._0 === "Call" || context._0 === "Yield" || context._0 === "AsmOutput")) {
      return is_indirect_ ? "Use" : undefined;
    }

    // All other contexts are uses...
    else if (
      (context.$ === "MutatingUse" && (context._0 === "RawBorrow" || context._0 === "Borrow" || context._0 === "Drop")) ||
      (context.$ === "NonMutatingUse" &&
        (context._0 === "RawBorrow" ||
          context._0 === "Copy" ||
          context._0 === "Inspect" ||
          context._0 === "Move" ||
          context._0 === "FakeBorrow" ||
          context._0 === "SharedBorrow" ||
          context._0 === "PlaceMention"))
    ) {
      return "Use";
    } else if (
      context.$ === "NonUse" &&
      (context._0.$ === "StorageLive" ||
        context._0.$ === "StorageDead" ||
        context._0.$ === "AscribeUserTy" ||
        context._0.$ === "BackwardIncompatibleDropHint" ||
        context._0.$ === "VarDebugInfo")
    ) {
      return undefined;
    } else if ((context.$ === "MutatingUse" && context._0 === "Projection") || (context.$ === "NonMutatingUse" && context._0 === "Projection")) {
      return unreachable("A projection could be a def or a use and must be handled separately");
    }
    return unreachable();
  },
} as const;
