// Stub of compiler/rustc_lint/src/utils.rs (lane lint-early-a): both fns work on HIR / `LateContext` (M3);
// `unported` bodies, no markers.
import { unported } from "../std/panic.ts";
import type { LateContext } from "./context.ts";

/** `pub(crate) fn peel_casts` (utils.rs:11). PORT: stub (HIR, M3). */
export function peel_casts(_cx: LateContext, _e: unknown): never {
  return unported("rustc_lint::utils::peel_casts (HIR, M3)");
}

/** `pub fn std_or_core` (utils.rs:53). PORT: stub (M3). */
export function std_or_core(_cx: LateContext): string | undefined {
  return unported("rustc_lint::utils::std_or_core (M3)");
}
