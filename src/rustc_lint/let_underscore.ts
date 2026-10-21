// Port of compiler/rustc_lint/src/let_underscore.rs. The lint statics and the `declare_lint_pass!` expansion are
// generated (let_underscore.lints.gen.ts).
//
// PORT: `LateContext::typeck_results` is `typeck_results_()` (the field shares the name); context.ts types it and
// `typing_env()` as `unknown`, so the call sites cast them (`TypeckResults`, `TypingEnv`).
import { MultiSpan } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { Span } from "../rustc_span/lib.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import type { LateContext } from "./context.ts";
import { NonBindingLet_diagnostic, type NonBindingLetSub } from "./diagnostics.ts";
import { LET_UNDERSCORE_DROP, LET_UNDERSCORE_LOCK, LetUnderscore } from "./let_underscore.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./let_underscore.lints.gen.ts";

declare module "./let_underscore.lints.gen.ts" {
  interface LetUnderscore extends LateLintPass {}
}

const SYNC_GUARD_SYMBOLS: readonly Symbol[] = [sym.MutexGuard, sym.RwLockReadGuard, sym.RwLockWriteGuard];

// impl<'tcx> LateLintPass<'tcx> for LetUnderscore
// rustc: compiler/rustc_lint/src/let_underscore.rs:107 check_local
LetUnderscore.prototype.check_local = function (this: LetUnderscore, cx: LateContext, local: hir.LetStmt): void {
  if (local.source === "AsyncFn") {
    return;
  }

  let top_level = true;

  // We recursively walk through all patterns, so that we can catch cases where the lock is
  // nested in a pattern. For the basic `let_underscore_drop` lint, we only look at the top
  // level, since there are many legitimate reasons to bind a sub-pattern to an `_`, if we're
  // only interested in the rest. But with locks, we prefer having the chance of "false
  // positives" over missing cases, since the effects can be quite catastrophic.
  local.pat.walk_always((pat) => {
    const is_top_level = top_level;
    top_level = false;

    if (pat.kind.$ !== "Wild") {
      return;
    }

    const ty = (cx.typeck_results_() as TypeckResults).pat_ty(pat);

    // If the type has a trivial Drop implementation, then it doesn't
    // matter that we drop the value immediately.
    if (!ty.needs_drop(cx.tcx, cx.typing_env() as TypingEnv)) {
      return;
    }
    // Lint for patterns like `mutex.lock()`, which returns `Result<MutexGuard, _>` as well.
    const k = ty.kind();
    const potential_lock_type = k.$ === "Adt" && cx.tcx.is_diagnostic_item(sym.Result, k._0.did()) ? k._1.type_at(0) : ty;
    const lk = potential_lock_type.kind();
    const is_sync_lock = lk.$ === "Adt" ? SYNC_GUARD_SYMBOLS.some((guard_symbol) => cx.tcx.is_diagnostic_item(guard_symbol, lk._0.did())) : false;

    const can_use_init = is_top_level ? local.init : undefined;

    const sub: NonBindingLetSub = {
      suggestion: pat.span,
      // We can't suggest `drop()` when we're on the top level.
      drop_fn_start_end: can_use_init !== undefined ? [Span.until(local.span, can_use_init.span), Span.shrink_to_hi(can_use_init.span)] : undefined,
      is_assign_desugar: local.source === "AssignDesugar",
    };
    if (is_sync_lock) {
      const span = MultiSpan.from_span(pat.span);
      cx.emit_span_lint(LET_UNDERSCORE_LOCK, span, NonBindingLet_diagnostic({ $: "SyncLock", sub, pat: pat.span }));
      // Only emit let_underscore_drop for top-level `_` patterns.
    } else if (can_use_init !== undefined) {
      cx.emit_span_lint(LET_UNDERSCORE_DROP, local.span, NonBindingLet_diagnostic({ $: "DropType", sub }));
    }
  });
};
