// rust-ts glue (not an upstream mirror): a target `u64` kept as a `bigint` (PORTING §5: array lengths can exceed 2^53,
// e.g. `[u8; 1 << 61]` in tests/ui/limits/huge-static.rs) passed where a TS declaration still takes a `number`.
import { panic } from "../std/panic.ts";

/** `n` as a `number`; an ICE above 2^53, where the `number` would not be exact (never a guessed value). */
export function u64_to_number(n: bigint, what: string): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) panic(`rust-ts: target usize ${n} exceeds 2^53 (${what})`);
  return Number(n);
}
