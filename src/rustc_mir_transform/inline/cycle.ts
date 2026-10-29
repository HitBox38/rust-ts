// Port of compiler/rustc_mir_transform/src/inline/cycle.rs (lane mt-inline).
//
// PORT: `#[instrument]` / `trace!` (tracing) are dropped.
// PORT: `FxHashMap<ty::Instance, bool>` is a `KeyedMap` keyed by `intern_key` (the derived `Hash`+`Eq` of `Instance`);
// `FxHashMap<DefId, usize>` is a `DefIdMap`; `FxHashSet<LocalDefId>` / `UnordSet<LocalDefId>` is a `Set` (LocalDefId is
// an interned handle). `FxIndexSet<(DefId, Binder<GenericArgsRef>)>` is a `KeyedSet` keyed by `intern_key`.
// PORT: the pass objects `&crate::inline::Inline` / `ForceInline` come from ../inline.ts through a lazy `require`:
// inline.ts re-exports this module (`pub(crate) mod cycle;`), so a load-time import back would be a cycle.
import type { Body } from "../../rustc_middle/mir/mod.ts";
import { Operand } from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArgs, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Instance, InstanceKind, visit_with_Instance } from "../../rustc_middle/ty/instance.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { type DefId, DefId_eq, DefIdMap, LocalDefId } from "../../rustc_span/def_id.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { Limit_div } from "../../rustc_structures/limit.ts";
import type { Limit } from "../../rustc_structures/limit.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { assert, unwrap } from "../../std/panic.ts";
import { PassCtx, should_run_pass } from "../pass_manager.ts";

type GenericArgsRef = GenericArgs;

/** PORT: `crate::inline` (see the header). */
function inline_(): typeof import("../inline.ts") {
  return (inline__cache ??= require("../inline.ts") as typeof import("../inline.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var inline__cache: typeof import("../inline.ts") | undefined;

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_mir_transform/src/inline/cycle.rs:11 should_recurse
function should_recurse(tcx: TyCtxt, callee: Instance): boolean {
  const def = callee.def;
  switch (def.$) {
    // If there is no MIR available (either because it was not in metadata or
    // because it has no MIR because it's an extern function), then the inliner
    // won't cause cycles on this.
    case "Item": {
      if (!tcx.is_mir_available(Instance.def_id(callee))) {
        return false;
      }
      break;
    }

    // These have no own callable MIR.
    case "Intrinsic":
    case "LlvmIntrinsic":
    case "Virtual": {
      return false;
    }

    case "Shim": {
      switch (def._0.$) {
        // These have MIR and if that MIR is inlined, instantiated and then inlining is run
        // again, a function item can end up getting inlined. Thus we'll be able to cause
        // a cycle that way
        case "VTable":
        case "Reify":
        case "FnPtr":
        case "ClosureOnce":
        case "ConstructCoroutineInClosure":
        case "ThreadLocal":
        case "Clone":
          break;

        // This shim does not call any other functions, thus there can be no recursion.
        case "FnPtrAsPtr":
        case "FnPtrFromPtr":
          return false;

        // FIXME: A not fully instantiated drop shim can cause ICEs if one attempts to
        // have its MIR built. Likely oli-obk just screwed up the `ParamEnv`s, so this
        // needs some more analysis.
        case "DropGlue":
        case "FutureDropPoll":
        case "AsyncDropGlue":
        case "AsyncDropGlueCtor": {
          if (TypeVisitableExt.has_param(callee, { visit_with: visit_with_Instance })) {
            return false;
          }
          break;
        }
      }
      break;
    }
  }

  const inline = inline_();
  return (
    should_run_pass(new inline.Inline(), PassCtx.for_body(tcx, Instance.def_id(callee))) ||
    inline.ForceInline.should_run_pass_for_callee(tcx, InstanceKind.def_id(callee.def))
  );
}

// #[instrument(
//     level = "debug",
//     skip(tcx, typing_env, seen, involved, recursion_limiter, recursion_limit),
//     ret
// )]
// rustc: compiler/rustc_mir_transform/src/inline/cycle.rs:65 process
function process(
  tcx: TyCtxt,
  typing_env: TypingEnv,
  caller: Instance,
  target: LocalDefId,
  seen: KeyedMap<Instance, boolean>,
  involved: Set<LocalDefId>,
  recursion_limiter: DefIdMap<number>,
  recursion_limit: Limit,
): boolean | undefined {
  // trace!(%caller);
  let reaches_root = false;

  // PORT: the query value is `readonly [DefId, unknown][]` in queries.gen.ts (GenericArgsRef not mapped there).
  for (const [callee_def_id, args_] of tcx.mir_inliner_callees(caller.def) as readonly [DefId, GenericArgsRef][]) {
    const args_r = Instance.try_instantiate_mir_and_normalize_erasing_regions(
      caller,
      tcx,
      typing_env,
      EarlyBinder.bind(tcx, args_, fold_GenericArgs),
      fold_GenericArgs,
    );
    if (args_r.$ !== "Ok") {
      // trace!(?caller, ?typing_env, ?args, "cannot normalize, skipping");
      continue;
    }
    const args = args_r._0;
    const callee_r = Instance.try_resolve(tcx, typing_env, callee_def_id, args);
    if (callee_r.$ !== "Ok" || callee_r._0 === undefined) {
      // trace!(?callee_def_id, "cannot resolve, skipping");
      continue;
    }
    const callee = callee_r._0;

    // Found a path.
    if (DefId_eq(Instance.def_id(callee), LocalDefId.to_def_id(target))) {
      reaches_root = true;
      seen.set(callee, true);
      continue;
    }

    if (tcx.is_constructor(Instance.def_id(callee))) {
      // trace!("constructors always have MIR");
      // Constructor functions cannot cause a query cycle.
      continue;
    }

    if (!should_recurse(tcx, callee)) {
      continue;
    }

    let callee_reaches_root: boolean;
    const c = seen.get(callee);
    if (c !== undefined) {
      // Even if we have seen this callee before, and thus don't need
      // to recurse into it, we still need to propagate whether it reaches
      // the root so that we can mark all the involved callers, in case we
      // end up reaching that same recursive callee through some *other* cycle.
      callee_reaches_root = c;
    } else {
      seen.set(callee, false);
      const callee_did = Instance.def_id(callee);
      const recursion = recursion_limiter.get(callee_did) ?? 0;
      recursion_limiter.set(callee_did, recursion);
      // trace!(?callee, recursion = *recursion);
      let callee_reaches_root_: boolean;
      if (recursion_limit.value_within_limit(recursion)) {
        recursion_limiter.set(callee_did, recursion + 1);

        const r = process(tcx, typing_env, callee, target, seen, involved, recursion_limiter, recursion_limit);
        if (r === undefined) return undefined;
        callee_reaches_root_ = r;
      } else {
        return undefined;
      }
      seen.set(callee, callee_reaches_root_);
      callee_reaches_root = callee_reaches_root_;
    }
    if (callee_reaches_root) {
      const callee_def_id = Instance.def_id(callee).as_local();
      if (callee_def_id !== undefined) {
        // Calling `optimized_mir` of a non-local definition cannot cycle.
        involved.add(callee_def_id);
      }
      reaches_root = true;
    }
  }

  return reaches_root;
}

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_mir_transform/src/inline/cycle.rs:152 mir_callgraph_cyclic
export function mir_callgraph_cyclic(tcx: TyCtxt, root: LocalDefId): Set<LocalDefId> | undefined {
  assert(
    !tcx.is_constructor(LocalDefId.to_def_id(root)),
    "you should not call `mir_callgraph_reachable` on enum/struct constructor functions",
  );

  // FIXME(-Znext-solver=no): Remove this hack when trait solver overflow can return an error.
  // In code like that pointed out in #128887, the type complexity we ask the solver to deal with
  // grows as we recurse into the call graph. If we use the same recursion limit here and in the
  // solver, the solver hits the limit first and emits a fatal error. But if we use a reduced
  // limit, we will hit the limit first and give up on looking for inlining. And in any case,
  // the default recursion limits are quite generous for us. If we need to recurse 64 times
  // into the call graph, we're probably not going to find any useful MIR inlining.
  const recursion_limit = Limit_div(tcx.recursion_limit(), 8);
  const involved = new Set<LocalDefId>();
  const typing_env = TypingEnv.post_analysis(tcx, root);
  const root_instance = Instance.new_raw(LocalDefId.to_def_id(root), RawList.identity_for_item(tcx, LocalDefId.to_def_id(root)));
  if (!should_recurse(tcx, root_instance)) {
    // trace!("cannot walk, skipping");
    return involved;
  }
  const r = process(
    tcx,
    typing_env,
    root_instance,
    root,
    new KeyedMap<Instance, boolean>(intern_key),
    involved,
    new DefIdMap<number>(),
    recursion_limit,
  );
  if (r !== undefined) {
    return involved;
  } else {
    return undefined;
  }
}

// rustc: compiler/rustc_mir_transform/src/inline/cycle.rs:192 mir_inliner_callees
export function mir_inliner_callees(tcx: TyCtxt, instance: InstanceKind): readonly [DefId, GenericArgsRef][] {
  let body: Body;
  const def_id = InstanceKind.def_id(instance).as_local();
  if (instance.$ === "Item" && def_id !== undefined) {
    const steal = tcx.mir_promoted(def_id)[0];
    body = steal.borrow();
  } else {
    // Functions from other crates and MIR shims
    body = tcx.instance_mir(instance);
  }
  const calls = new KeyedSet<[DefId, Binder<GenericArgs>]>(intern_key);
  for (const bb_data of body.basic_blocks.basic_blocks) {
    const terminator = bb_data.terminator_();
    const kind = terminator.kind;
    if (kind.$ === "Call") {
      const func = kind.func;
      const call_args = kind.args;
      const ty = Operand.ty(func, body.local_decls, tcx).kind();
      if (ty.$ !== "FnDef") {
        continue;
      }
      const def_id = ty._0;
      const generic_args = ty._1;
      let call: [DefId, Binder<GenericArgs>];
      if (tcx.is_intrinsic(def_id, sym.const_eval_select)) {
        const func = call_args[2]!.node;
        const ty = Operand.ty(func, body.local_decls, tcx).kind();
        if (ty.$ !== "FnDef") {
          continue;
        }
        call = [ty._0, ty._1];
      } else {
        call = [def_id, generic_args];
      }
      calls.add(call);
    }
  }
  return [...calls].map(([did, args]) => [did, unwrap(Binder.no_bound_vars(args, fold_GenericArgs))]);
}
