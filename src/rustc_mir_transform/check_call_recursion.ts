// Port of compiler/rustc_mir_transform/src/check_call_recursion.rs (lane mt-built-lints).
//
// PORT: `trait TerminatorClassifier` is an interface implemented by the classes `CallRecursion` / `RecursiveDrop`;
// `Search<C>` implements rustc_data_structures' `TriColorVisitor<BasicBlock, NonRecursive>` (`type BreakVal`), and the
// unit struct `NonRecursive` is the frozen singleton `NonRecursive`. `&body.basic_blocks` as a graph is the
// `BasicBlocks` object (it implements the graph traits; basic_blocks.ts header). `&call_args[..n] == self.trait_args`
// compares interned `GenericArg`s by identity.
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { ControlFlow } from "../rustc_ast_ir/visit.ts";
import { type NodeStatus, TriColorDepthFirstSearch, type TriColorVisitor } from "../rustc_data_structures/graph/iterate/mod.ts";
import type { StartNode, Successors } from "../rustc_data_structures/graph/mod.ts";
import { UNCONDITIONAL_RECURSION } from "../rustc_lint_defs/builtin.ts";
import { type BasicBlock, type Body, Operand, type Terminator } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs, type GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { DefId_eq, LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { type FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../std/panic.ts";
import { UnconditionalRecursion_diagnostic } from "./diagnostics.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_call_recursion.rs:16 CheckCallRecursion
export class CheckCallRecursion extends MirLint {
  readonly type_name = "rustc_mir_transform::check_call_recursion::CheckCallRecursion";

  // impl<'tcx> MirLint<'tcx> for CheckCallRecursion
  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:19 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    const def_id = body.source.def_id().expect_local();

    const def_kind = tcx.def_kind(def_id);
    if (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") {
      // If this is trait/impl method, extract the trait's args.
      let trait_args: readonly GenericArg[];
      const trait_def_id = tcx.trait_of_assoc(LocalDefId.to_def_id(def_id));
      if (trait_def_id !== undefined) {
        // PORT: the `generics_of` query value is `unknown` in queries.gen.ts.
        const trait_args_count = (tcx.generics_of(trait_def_id) as Generics).count();
        trait_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id)).slice(0, trait_args_count);
      } else {
        trait_args = [];
      }

      check_recursion(tcx, body, new CallRecursion(trait_args));
    }
  }
}

/// Requires drop elaboration to have been performed.
// rustc-type: compiler/rustc_mir_transform/src/check_call_recursion.rs:38 CheckDropRecursion
export class CheckDropRecursion extends MirLint {
  readonly type_name = "rustc_mir_transform::check_call_recursion::CheckDropRecursion";

  // impl<'tcx> MirLint<'tcx> for CheckDropRecursion
  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:41 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    const def_id = body.source.def_id().expect_local();

    // First check if `body` is an `fn drop()` of `Drop`
    if (tcx.def_kind(def_id).$ !== "AssocFn") return;
    const impl_id = tcx.trait_impl_of_assoc(LocalDefId.to_def_id(def_id));
    if (impl_id === undefined) return;
    const trait_ref = tcx.impl_trait_ref(impl_id);
    if (!tcx.is_lang_item(EarlyBinder.def_id(trait_ref), LangItem.Drop)) return;
    // avoid erroneous `Drop` impls from causing ICEs below
    // PORT: the `fn_sig` query value is `unknown` in queries.gen.ts.
    const sig = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate_identity(tcx.fn_sig(LocalDefId.to_def_id(def_id)) as EarlyBinder<Binder<FnSig>>),
    );
    if (Binder.skip_binder(PolyFnSig.inputs(sig)).length !== 1) return;
    {
      // It was. Now figure out for what type `Drop` is implemented and then
      // check for recursion.
      const kind = tcx.liberate_late_bound_regions(LocalDefId.to_def_id(def_id), PolyFnSig.input(sig, 0), fold_Ty).kind();
      if (kind.$ === "Ref") {
        const dropped_ty = kind._1;
        check_recursion(tcx, body, new RecursiveDrop(dropped_ty));
      }
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:64 check_recursion
function check_recursion(tcx: TyCtxt, body: Body, classifier: TerminatorClassifier): void {
  const def_id = body.source.def_id().expect_local();

  const def_kind = tcx.def_kind(def_id);
  if (def_kind.$ === "Fn" || def_kind.$ === "AssocFn") {
    const vis = new Search(tcx, body, classifier, []);
    // PORT: `BasicBlocks` implements the graph traits (basic_blocks.ts header); the cast is for the overloaded
    // `predecessors` slot.
    const graph = body.basic_blocks as unknown as Successors<BasicBlock> & StartNode<BasicBlock>;
    if (TriColorDepthFirstSearch.new<BasicBlock>(graph).run_from_start(vis) === NonRecursive) {
      return;
    }
    if (vis.reachable_recursive_calls.length === 0) {
      return;
    }

    // `sort_by_key(|span| span.lo_hi())` (stable)
    vis.reachable_recursive_calls.sort((a, b) => {
      const [a_lo, a_hi] = Span.lo_hi(a);
      const [b_lo, b_hi] = Span.lo_hi(b);
      return a_lo - b_lo || a_hi - b_hi;
    });

    const sp = tcx.def_span(def_id);
    const hir_id = tcx.local_def_id_to_hir_id(def_id);
    tcx.emit_node_span_lint(
      UNCONDITIONAL_RECURSION,
      hir_id,
      sp,
      UnconditionalRecursion_diagnostic({ span: sp, call_sites: vis.reachable_recursive_calls }),
    );
  }
}

// rustc-trait: compiler/rustc_mir_transform/src/check_call_recursion.rs:95 TerminatorClassifier
interface TerminatorClassifier {
  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:96 is_recursive_terminator
  is_recursive_terminator(tcx: TyCtxt, body: Body, terminator: Terminator): boolean;
}

// rustc-type: compiler/rustc_mir_transform/src/check_call_recursion.rs:104 NonRecursive
type NonRecursive = { readonly $: "NonRecursive" };
const NonRecursive: NonRecursive = Object.freeze({ $: "NonRecursive" as const });

// rustc-type: compiler/rustc_mir_transform/src/check_call_recursion.rs:114 CallRecursion
class CallRecursion implements TerminatorClassifier {
  constructor(public trait_args: readonly GenericArg[]) {}

  // impl<'tcx> TerminatorClassifier<'tcx> for CallRecursion<'tcx>
  /// Returns `true` if `func` refers to the function we are searching in.
  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:125 is_recursive_terminator
  is_recursive_terminator(tcx: TyCtxt, body: Body, terminator: Terminator): boolean {
    const kind = terminator.kind;
    if (kind.$ !== "Call") {
      return false;
    }
    const { func, args } = kind;

    // Resolving function type to a specific instance that is being called is expensive. To
    // avoid the cost we check the number of arguments first, which is sufficient to reject
    // most of calls as non-recursive.
    if (args.length !== body.arg_count) {
      return false;
    }
    const caller = body.source.def_id();
    const typing_env = body.typing_env(tcx);

    const func_ty = Operand.ty(func, body, tcx);
    const func_kind = func_ty.kind();
    if (func_kind.$ === "FnDef") {
      const callee_ = func_kind._0;
      const args = unwrap(Binder.no_bound_vars(func_kind._1, fold_GenericArgs));
      const normalized = tcx.try_normalize_erasing_regions(typing_env, Unnormalized.new_wip(args), fold_GenericArgs);
      if (normalized.$ !== "Ok") {
        return false;
      }
      const normalized_args = normalized._0;
      const resolved = Instance.try_resolve(tcx, typing_env, callee_, normalized_args);
      let callee;
      let call_args;
      if (resolved.$ === "Ok" && resolved._0 !== undefined) {
        const instance = resolved._0;
        [callee, call_args] = [Instance.def_id(instance), instance.args];
      } else {
        [callee, call_args] = [callee_, normalized_args];
      }

      // FIXME(#57965): Make this work across function boundaries

      // If this is a trait fn, the args on the trait have to match, or we might be
      // calling into an entirely different method (for example, a call from the default
      // method in the trait to `<A as Trait<B>>::method`, where `A` and/or `B` are
      // specific types).
      return DefId_eq(callee, caller) && slice_eq(call_args.slice(0, this.trait_args.length), this.trait_args);
    }

    return false;
  }
}

/** `&[GenericArg] == &[GenericArg]` (interned values: identity). */
function slice_eq(a: readonly GenericArg[], b: readonly GenericArg[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// rustc-type: compiler/rustc_mir_transform/src/check_call_recursion.rs:118 RecursiveDrop
class RecursiveDrop implements TerminatorClassifier {
  constructor(
    /// The type that `Drop` is implemented for.
    public drop_for: Ty,
  ) {}

  // impl<'tcx> TerminatorClassifier<'tcx> for RecursiveDrop<'tcx>
  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:174 is_recursive_terminator
  is_recursive_terminator(tcx: TyCtxt, body: Body, terminator: Terminator): boolean {
    const kind = terminator.kind;
    if (kind.$ !== "Drop") return false;
    const place = kind.place;

    const dropped_ty = place.ty(body, tcx).ty;
    return dropped_ty === this.drop_for;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/check_call_recursion.rs:106 Search
class Search<C extends TerminatorClassifier> implements TriColorVisitor<BasicBlock, NonRecursive> {
  constructor(
    public tcx: TyCtxt,
    public body: Body,
    public classifier: C,
    public reachable_recursive_calls: Span[],
  ) {}

  // impl<'mir, 'tcx, C: TerminatorClassifier<'tcx>> TriColorVisitor<BasicBlocks<'tcx>> for Search<'mir, 'tcx, C>
  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:192 node_examined
  node_examined(bb: BasicBlock, prior_status: NodeStatus | undefined): ControlFlow<NonRecursive> {
    // Back-edge in the CFG (loop).
    if (prior_status === "Visited") {
      return { $: "Break", _0: NonRecursive };
    }

    const kind = this.body.basic_blocks.deref()[bb]!.terminator_().kind;
    switch (kind.$) {
      // These terminators return control flow to the caller.
      case "UnwindTerminate":
      case "CoroutineDrop":
      case "UnwindResume":
      case "Return":
      case "Unreachable":
      case "Yield":
        return { $: "Break", _0: NonRecursive };

      // A InlineAsm without targets (diverging and contains no labels)
      // is treated as non-recursing.
      case "InlineAsm": {
        const targets = kind.targets;
        if (targets.length !== 0) {
          return ControlFlow.CONTINUE;
        } else {
          return { $: "Break", _0: NonRecursive };
        }
      }

      // These do not.
      case "Assert":
      case "Call":
      case "Drop":
      case "FalseEdge":
      case "FalseUnwind":
      case "Goto":
      case "SwitchInt":
        return ControlFlow.CONTINUE;

      // Note that tail call terminator technically returns to the caller,
      // but for purposes of this lint it makes sense to count it as possibly recursive,
      // since it's still a call.
      //
      // If this'll be repurposed for something else, this might need to be changed.
      case "TailCall":
        return ControlFlow.CONTINUE;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:239 node_settled
  node_settled(bb: BasicBlock): ControlFlow<NonRecursive> {
    // When we examine a node for the last time, remember it if it is a recursive call.
    const terminator = this.body.basic_blocks.deref()[bb]!.terminator_();

    // FIXME(explicit_tail_calls): highlight tail calls as "recursive call site"
    //
    // We don't want to lint functions that recurse only through tail calls
    // (such as `fn g() { become () }`), so just adding `| TailCall { ... }`
    // here won't work.
    //
    // But at the same time we would like to highlight both calls in a function like
    // `fn f() { if false { become f() } else { f() } }`, so we need to figure something out.
    if (this.classifier.is_recursive_terminator(this.tcx, this.body, terminator)) {
      this.reachable_recursive_calls.push(terminator.source_info.span);
    }

    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_mir_transform/src/check_call_recursion.rs:258 ignore_edge
  ignore_edge(bb: BasicBlock, target: BasicBlock): boolean {
    const terminator = this.body.basic_blocks.deref()[bb]!.terminator_();
    const unwind = terminator.unwind();
    // `terminator.successors().count()`
    let successors_count = 0;
    for (const _ of terminator.successors()) successors_count++;
    const ignore_unwind =
      unwind !== undefined && unwind.$ === "Cleanup" && unwind._0 === target && successors_count > 1;
    if (ignore_unwind || this.classifier.is_recursive_terminator(this.tcx, this.body, terminator)) {
      return true;
    }
    const kind = terminator.kind;
    switch (kind.$) {
      case "FalseEdge":
        return kind.imaginary_target === target;
      default:
        return false;
    }
  }
}
