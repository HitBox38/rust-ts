// Port of compiler/rustc_query_impl/src/handle_cycle_error.rs: the default cycle handler and
// `create_cycle_error`. The custom handlers of the five `handle_cycle_error` queries (`fn_sig`,
// `check_representability`, `check_representability_adt_ty`, `variances_of`, `layout_of`) and their
// helpers need `Ty`/HIR (M3+): they are listed in `CUSTOM` and call `unported`.
import type { Diag } from "../rustc_errors/lib.ts";
import type { QueryName } from "../rustc_middle/queries.gen.ts";
import { TaggedQueryKey } from "../rustc_middle/query/query_api.ts";
import type { QueryCycle } from "../rustc_middle/query/job.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefKind } from "../rustc_hir/def.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { assert, unported } from "../std/panic.ts";
import { type Alias, type CycleStack, type CycleUsage, Cycle_diagnostic, NestedCycle_diagnostic, type StackCount } from "./diagnostics.ts";

// Default cycle handler used for all queries that don't use the `handle_cycle_error` query
// modifier.
// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:19 default
export function default_(err: Diag): never {
  const guar = err.emit_err();
  return guar.raise_fatal();
}

/** `$crate::handle_cycle_error::$name` for the queries with the `handle_cycle_error` modifier. */
export const CUSTOM: Partial<Record<QueryName, (tcx: TyCtxt, key: unknown, cycle: QueryCycle, err: Diag) => unknown>> = {
  fn_sig: () => unported("rustc_query_impl::handle_cycle_error::fn_sig (Ty, M3)"),
  check_representability: () => unported("rustc_query_impl::handle_cycle_error::check_representability (Ty, M3)"),
  check_representability_adt_ty: () => unported("rustc_query_impl::handle_cycle_error::check_representability_adt_ty (Ty, M3)"),
  variances_of: () => unported("rustc_query_impl::handle_cycle_error::variances_of (Ty, M3)"),
  layout_of: () => unported("rustc_query_impl::handle_cycle_error::layout_of (Ty, M3)"),
};

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:346 create_cycle_error
export function create_cycle_error(tcx: TyCtxt, { usage, frames }: QueryCycle, nested: boolean): Diag {
  assert(!(frames.length === 0), "assertion failed: !frames.is_empty()");

  const span = TaggedQueryKey.catch_default_span(frames[0]!.tagged_key, tcx, frames[1 % frames.length]!.span);

  const cycle_stack: CycleStack[] = [];

  const stack_bottom = TaggedQueryKey.catch_description(frames[0]!.tagged_key, tcx);
  const stack_count: StackCount = frames.length === 1 ? { $: "Single", stack_bottom } : { $: "Multiple", stack_bottom };

  let prev = span;
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i]!;
    const span = TaggedQueryKey.catch_default_span(frame.tagged_key, tcx, frames[(i + 1) % frames.length]!.span);
    cycle_stack.push({
      span: span === prev ? DUMMY_SP : span,
      desc: TaggedQueryKey.catch_description(frame.tagged_key, tcx),
    });
    prev = span;
  }

  let cycle_usage: CycleUsage | undefined;
  if (usage !== undefined) {
    const cycle_span = TaggedQueryKey.catch_default_span(usage.tagged_key, tcx, usage.span);
    cycle_usage = {
      span: cycle_span !== span ? cycle_span : DUMMY_SP,
      usage: TaggedQueryKey.catch_description(usage.tagged_key, tcx),
    };
  }

  const is_all_def_kind = (def_kind: DefKind["$"]): boolean =>
    // Trivial type alias and trait alias cycles consists of `type_of` and
    // `explicit_implied_clauses_of` queries, so we just check just these here.
    frames.every((frame) => {
      const k = frame.tagged_key;
      if ((k.$ === "type_of" || k.$ === "explicit_implied_clauses_of") && tcx.def_kind(k._0).$ === def_kind) {
        return true;
      }
      return false;
    });

  let alias: Alias | undefined;
  if (!nested) {
    if (is_all_def_kind("TyAlias")) {
      alias = "Ty";
    } else if (is_all_def_kind("TraitAlias")) {
      alias = "Trait";
    } else {
      alias = undefined;
    }
  } else {
    alias = undefined;
  }

  if (nested) {
    return tcx.sess.dcx().create_err(
      NestedCycle_diagnostic({
        span,
        cycle_stack,
        stack_bottom: { stack_bottom },
        cycle_usage,
        stack_count,
        note_span: null,
      }),
    );
  } else {
    return tcx.sess.dcx().create_err(
      Cycle_diagnostic({
        span,
        cycle_stack,
        stack_bottom,
        alias,
        cycle_usage,
        stack_count,
        note_span: null,
      }),
    );
  }
}
