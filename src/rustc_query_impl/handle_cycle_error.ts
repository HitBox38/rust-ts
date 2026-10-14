// Port of compiler/rustc_query_impl/src/handle_cycle_error.rs: the default cycle handler, the custom handlers of
// the five `handle_cycle_error` queries (`fn_sig`, `check_representability`, `check_representability_adt_ty`,
// `variances_of`, `layout_of`) with their helpers, and `create_cycle_error`.
//
// PORT: the query values and keys of the type system are typed `unknown` in the generated declarations until the
// type lanes land (queries.gen.ts), so the handlers take their keys at the rustc_middle types and the CUSTOM table
// (the `$crate::handle_cycle_error::$name` paths of query_vtables.rs) erases them. `tcx.arena.alloc*` is the value
// itself (arenas are erased, PORTING §5).
import type { Diag } from "../rustc_errors/lib.ts";
import { E0072, E0733, struct_span_code_err } from "../rustc_errors/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import { Applicability, pluralize } from "../rustc_lint_defs/lib.ts";
import type { QueryName } from "../rustc_middle/queries.gen.ts";
import { TaggedQueryKey } from "../rustc_middle/query/query_api.ts";
import type { QueryCycle, QueryStackFrame } from "../rustc_middle/query/job.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { Ty as TyC } from "../rustc_middle/ty/mod.ts";
import type { AdtDef, PseudoCanonicalInput } from "../rustc_middle/ty/decls.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { DefKind } from "../rustc_hir/def.ts";
import { CoroutineKind, Node, type Ty as HirTy } from "../rustc_hir/lib.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { type FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { Variance } from "../rustc_type_ir/lib.ts";
import { type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { type Alias, type CycleStack, type CycleUsage, Cycle_diagnostic, NestedCycle_diagnostic, type StackCount } from "./diagnostics.ts";

// Default cycle handler used for all queries that don't use the `handle_cycle_error` query
// modifier.
// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:19 default
export function default_(err: Diag): never {
  const guar = err.emit_err();
  return guar.raise_fatal();
}

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:24 fn_sig
export function fn_sig(tcx: TyCtxt, def_id: DefId, _: QueryCycle, err: Diag): EarlyBinder<Binder<FnSig>> {
  const guar = err.delay_as_bug();

  const err_ = TyC.new_error(tcx, guar);

  let arity: number;
  const node = tcx.hir_get_if_local(def_id);
  const sig = node !== undefined ? Node.fn_sig(node) : undefined;
  if (node !== undefined && sig !== undefined) {
    arity = sig.decl.inputs.length;
  } else {
    tcx.dcx().abort_if_errors();
    return unreachable();
  }

  return EarlyBinder.bind(
    tcx,
    Binder.dummy(
      tcx.mk_fn_sig_safe_rust_abi(
        Array.from({ length: arity }, () => err_),
        err_,
      ),
      fold_FnSig,
    ),
    fold_Binder(fold_FnSig),
  );
}

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:49 check_representability
export function check_representability(tcx: TyCtxt, _key: LocalDefId, cycle: QueryCycle, _err: Diag): null {
  return check_representability_inner(tcx, cycle);
}

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:58 check_representability_adt_ty
export function check_representability_adt_ty(tcx: TyCtxt, _key: Ty, cycle: QueryCycle, _err: Diag): null {
  return check_representability_inner(tcx, cycle);
}

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:67 check_representability_inner
function check_representability_inner(tcx: TyCtxt, cycle: QueryCycle): never {
  const item_and_field_ids: [LocalDefId, LocalDefId][] = [];
  const representable_ids = new Set<LocalDefId>();
  for (const frame of cycle.frames) {
    const k = frame.tagged_key;
    if (k.$ === "check_representability" && tcx.def_kind(k._0).$ === "Field") {
      const def_id = k._0;
      const field_id: LocalDefId = def_id;
      const parent_id = tcx.parent(LocalDefId.to_def_id(field_id));
      let item_id: DefId;
      switch (tcx.def_kind(parent_id).$) {
        case "Variant":
          item_id = tcx.parent(parent_id);
          break;
        default:
          item_id = parent_id;
      }
      item_and_field_ids.push([item_id.expect_local(), field_id]);
    }
  }
  for (const frame of cycle.frames) {
    const k = frame.tagged_key;
    if (k.$ === "check_representability_adt_ty") {
      const key = k._0 as Ty;
      const adt = key.ty_adt_def();
      if (adt !== undefined) {
        const def_id = AdtDef_did(adt).as_local();
        if (def_id !== undefined && !item_and_field_ids.some(([id, _]) => id === def_id)) {
          representable_ids.add(def_id);
        }
      }
    }
  }
  // We used to continue here, but the cycle error printed next is actually less useful than
  // the error produced by `recursive_type_error`.
  const guar = recursive_type_error(tcx, item_and_field_ids, representable_ids);
  return guar.raise_fatal();
}

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:98 variances_of
export function variances_of(tcx: TyCtxt, def_id: DefId, _cycle: QueryCycle, err: Diag): readonly Variance[] {
  const _guar = err.delay_as_bug();
  const n = (tcx.generics_of(def_id) as Generics).count();
  return Array.from({ length: n }, (): Variance => "Bivariant");
}

/** `ControlFlow<B, ()>` */
type ControlFlow<B> = { $: "Continue" } | { $: "Break"; _0: B };

// Take a cycle of `Q` and try `try_cycle` on every permutation, falling back to `otherwise`.
// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:110 search_for_cycle_permutation
function search_for_cycle_permutation<Q, T>(cycle_: readonly Q[], try_cycle: (cycle: Q[]) => ControlFlow<T>, otherwise: () => T): T {
  // PORT: `VecDeque<&Q>`: an array rotated in place.
  const cycle: Q[] = [...cycle_];
  for (let _ = 0; _ < cycle.length; _++) {
    const r = try_cycle(cycle);
    switch (r.$) {
      case "Continue":
        cycle.push(cycle.shift()!);
        break;
      case "Break":
        return r._0;
    }
  }

  return otherwise();
}

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:128 layout_of
export function layout_of(tcx: TyCtxt, _key: PseudoCanonicalInput<Ty>, cycle: QueryCycle, err: Diag): never {
  const _guar = err.delay_as_bug();
  const diag = search_for_cycle_permutation(
    cycle.frames,
    (frames: QueryStackFrame[]): ControlFlow<Diag> => {
      const k = frames[0]!.tagged_key;
      if (k.$ !== "layout_of") return { $: "Continue" };
      const kind = PseudoCanonicalInput_value(k._0 as PseudoCanonicalInput<Ty>).kind();
      if (kind.$ !== "Coroutine") return { $: "Continue" };
      const def_id = kind._0.as_local();
      if (def_id === undefined) return { $: "Continue" };
      const def_kind = tcx.def_kind(def_id);
      if (!(def_kind.$ === "Closure")) return { $: "Continue" };
      const coroutine_kind = tcx.coroutine_kind(def_id) as CoroutineKind | undefined;
      if (coroutine_kind === undefined) return { $: "Continue" };

      // FIXME: `def_span` for an fn-like coroutine will point to the fn's body
      // due to interactions between the desugaring into a closure expr and the
      // def_span code. I'm not motivated to fix it, because I tried and it was
      // not working, so just hack around it by grabbing the parent fn's span.
      const span = CoroutineKind.is_fn_like(coroutine_kind) ? tcx.def_span(tcx.local_parent(def_id)) : tcx.def_span(def_id);
      const diag = struct_span_code_err(
        tcx.sess.dcx(),
        span,
        E0733,
        `recursion in ${tcx.def_kind_descr_article(def_kind, LocalDefId.to_def_id(def_id))} ${tcx.def_kind_descr(def_kind, LocalDefId.to_def_id(def_id))} requires boxing`,
      );
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!;
        const fk = frame.tagged_key;
        if (fk.$ !== "layout_of") {
          continue;
        }
        const frame_kind = PseudoCanonicalInput_value(fk._0 as PseudoCanonicalInput<Ty>).kind();
        if (frame_kind.$ !== "Coroutine") {
          continue;
        }
        const frame_def_id = frame_kind._0;
        const frame_coroutine_kind = tcx.coroutine_kind(frame_def_id) as CoroutineKind | undefined;
        if (frame_coroutine_kind === undefined) {
          continue;
        }
        const frame_span = TaggedQueryKey.default_span(frame.tagged_key, tcx, frames[(i + 1) % frames.length]!.span);
        if (Span.is_dummy(frame_span)) {
          continue;
        }
        if (i === 0) {
          diag.span_label(frame_span, "recursive call here");
        } else {
          const coroutine_span: Span = CoroutineKind.is_fn_like(frame_coroutine_kind) ? tcx.def_span(tcx.parent(frame_def_id)) : tcx.def_span(frame_def_id);
          const multispan = MultiSpan.from_span(coroutine_span);
          multispan.push_span_label(frame_span, "...leading to this recursive call");
          diag.span_note(multispan, `which leads to this ${tcx.def_descr(frame_def_id)}`);
        }
      }
      // FIXME: We could report a structured suggestion if we had
      // enough info here... Maybe we can use a hacky HIR walker.
      if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async") {
        diag.note("a recursive `async fn` call must introduce indirection such as `Box::pin` to avoid an infinitely sized future");
      }

      return { $: "Break", _0: diag };
    },
    () => create_cycle_error(tcx, cycle, false),
  );

  return diag.emit_err().raise_fatal();
}

// item_and_field_ids should form a cycle where each field contains the
// type in the next element in the list
// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:215 recursive_type_error
function recursive_type_error(tcx: TyCtxt, item_and_field_ids: [LocalDefId, LocalDefId][], representable_ids: Set<LocalDefId>): ErrorGuaranteed {
  const ITEM_LIMIT = 5;

  // Rotate the cycle so that the item with the lowest span is first
  // PORT: `min_by_key` keeps the first of equal minima; the key is `(lo, hi)`.
  let start_index: number | undefined;
  let min_key: [number, number] | undefined;
  for (let i = 0; i < item_and_field_ids.length; i++) {
    const [id, _] = item_and_field_ids[i]!;
    const [lo, hi] = Span.lo_hi(tcx.def_span(id));
    if (min_key === undefined || lo < min_key[0] || (lo === min_key[0] && hi < min_key[1])) {
      min_key = [lo, hi];
      start_index = i;
    }
  }
  item_and_field_ids.push(...item_and_field_ids.splice(0, unwrap(start_index)));

  const cycle_len = item_and_field_ids.length;
  const show_cycle_len = Math.min(cycle_len, ITEM_LIMIT);

  const err_span = MultiSpan.from_spans(item_and_field_ids.slice(0, show_cycle_len).map(([id, _]) => tcx.def_span(LocalDefId.to_def_id(id))));
  const suggestion: [Span, string][] = [];
  for (let i = 0; i < show_cycle_len; i++) {
    const [_, field_id] = item_and_field_ids[i]!;
    const [next_item_id, __] = item_and_field_ids[(i + 1) % cycle_len]!;
    // Find the span(s) that contain the next item in the cycle
    const node = tcx.hir_node_by_def_id(field_id);
    if (node.$ !== "Field") {
      panic("expected field");
    }
    const field = node._0;
    const found: Span[] = [];
    find_item_ty_spans(tcx, field.ty, next_item_id, found, representable_ids);

    // Couldn't find the type. Maybe it's behind a type alias?
    // In any case, we'll just suggest boxing the whole field.
    if (found.length === 0) {
      found.push(field.ty.span);
    }

    for (const span of found) {
      err_span.push_span_label(span, "recursive without indirection");
      // FIXME(compiler-errors): This suggestion might be erroneous if Box is shadowed
      suggestion.push([Span.shrink_to_lo(span), "Box<"]);
      suggestion.push([Span.shrink_to_hi(span), ">"]);
    }
  }
  let items_list: string;
  {
    let s = "";
    for (let i = 0; i < item_and_field_ids.length; i++) {
      const [item_id, _] = item_and_field_ids[i]!;
      const path = tcx.def_path_str(item_id);
      s += `\`${path}\``;
      if (i === ITEM_LIMIT - 1 && cycle_len > ITEM_LIMIT) {
        s += ` and ${cycle_len - 5} more`;
        break;
      }
      if (cycle_len > 1 && i < cycle_len - 2) {
        s += ", ";
      } else if (cycle_len > 1 && i === cycle_len - 2) {
        s += " and ";
      }
    }
    items_list = s;
  }
  return struct_span_code_err(tcx.dcx(), err_span, E0072, `recursive type${pluralize(cycle_len)} ${items_list} ${pluralize("has", cycle_len)} infinite size`)
    .with_multipart_suggestion("insert some indirection (e.g., a `Box`, `Rc`, or `&`) to break the cycle", suggestion, Applicability.HasPlaceholders)
    .emit_err();
}

// rustc: compiler/rustc_query_impl/src/handle_cycle_error.rs:298 find_item_ty_spans
function find_item_ty_spans(tcx: TyCtxt, ty: HirTy, needle: LocalDefId, spans: Span[], seen_representable: Set<LocalDefId>): void {
  const kind = ty.kind;
  switch (kind.$) {
    case "Path": {
      if (kind._0.$ !== "Resolved") break;
      const path = kind._0._1;
      const res = path.res;
      if (res.$ === "Def" && (res._0.$ === "Enum" || res._0.$ === "Struct" || res._0.$ === "Union")) {
        const def_id = res._1;
        const local = def_id.as_local();
        let check_params: boolean;
        if (local === undefined) {
          check_params = true;
        } else {
          if (local === needle) {
            spans.push(ty.span);
          }
          check_params = seen_representable.has(local);
        }
        const args = unwrap(path.segments.at(-1)).args;
        if (check_params && args !== undefined) {
          const params_in_repr = tcx.params_in_repr(def_id) as DenseBitSet<number>;
          // the domain size check is needed because the HIR may not be well-formed at this point
          const n = Math.min(args.args.length, params_in_repr.domain_size());
          for (let i = 0; i < n; i++) {
            const arg = args.args[i]!;
            if (arg.$ === "Type" && params_in_repr.contains(i)) {
              find_item_ty_spans(tcx, arg._0.as_unambig_ty(), needle, spans, seen_representable);
            }
          }
        }
      }
      break;
    }
    case "Array":
      find_item_ty_spans(tcx, kind._0, needle, spans, seen_representable);
      break;
    case "Tup":
      for (const ty of kind._0) find_item_ty_spans(tcx, ty, needle, spans, seen_representable);
      break;
    default:
      break;
  }
}

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

/** `$crate::handle_cycle_error::$name` for the queries with the `handle_cycle_error` modifier (query_vtables.rs
 * `make_query_vtable`), erased to the vtable's `handle_cycle_error_fn` shape. */
export const CUSTOM: Partial<Record<QueryName, (tcx: TyCtxt, key: unknown, cycle: QueryCycle, err: Diag) => unknown>> = {
  fn_sig: (tcx, key, cycle, err) => fn_sig(tcx, key as DefId, cycle, err),
  check_representability: (tcx, key, cycle, err) => check_representability(tcx, key as LocalDefId, cycle, err),
  check_representability_adt_ty: (tcx, key, cycle, err) => check_representability_adt_ty(tcx, key as Ty, cycle, err),
  variances_of: (tcx, key, cycle, err) => variances_of(tcx, key as DefId, cycle, err),
  layout_of: (tcx, key, cycle, err) => layout_of(tcx, key as PseudoCanonicalInput<Ty>, cycle, err),
};

// ---- stand-ins for fns of other upstream files that are not ported yet (not markers; repoint when they land) ----

/** PORT: stand-in for `AdtDef::did` (ty/adt.rs, lane ty-adt-assoc): `AdtDef` is still `Pending` in ty/decls.ts. */
function AdtDef_did(adt: AdtDef): DefId {
  return (adt as unknown as { did(): DefId }).did();
}

/** PORT: stand-in for the `pub value: T` field of `ty::PseudoCanonicalInput` (ty/mod.rs, lane ty-mod): the type is
 * still `Pending` in ty/decls.ts. */
function PseudoCanonicalInput_value<T>(k: PseudoCanonicalInput<T>): T {
  return (k as unknown as { value: T }).value;
}
