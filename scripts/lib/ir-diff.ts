// The pure part of scripts/ir-diff.ts (plan-m7 D17): where two normal forms first differ, and what the tiers say about it. No
// imports beyond ./ir-normal.ts's types, so tests load it without scripts/lib/common.ts.
import type { IrTier } from "./ir-normal.ts";

export interface IrDifference {
  /** `@name` of the definition, or undefined at module level (globals, declarations, attributes, metadata). */
  function?: string;
  /** 1-based lines of the normal forms; past the end of a side, one more than its length. */
  oracleLine: number;
  portLine: number;
  oracle?: string;
  port?: string;
}

/** `@name` of a `define` line, quoted or not. */
const DEFINE_NAME = /^define [^@]*(@(?:"[^"]*"|[-a-zA-Z$._0-9]+))\(/;

/**
 * The first line where two normal forms differ, with the function it is in. Lines are compared in order: order is part of the
 * normal form, so a swap shows at its first line. `undefined` if they are the same.
 */
export function firstIrDifference(oracle: string, port: string): IrDifference | undefined {
  if (oracle === port) return undefined;
  const a = oracle.split("\n");
  const b = port.split("\n");
  let fn: string | undefined;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    if (x === b[i]) {
      if (x!.startsWith("define ")) fn = DEFINE_NAME.exec(x!)?.[1];
      else if (x === "}") fn = undefined;
      continue;
    }
    // The `define` line itself differs: that function, named from the oracle's side.
    const own = x !== undefined && x.startsWith("define ") ? DEFINE_NAME.exec(x)?.[1] : undefined;
    const d: IrDifference = { oracleLine: i + 1, portLine: i + 1 };
    const name = fn ?? own;
    if (name !== undefined) d.function = name;
    if (x !== undefined) d.oracle = x;
    if (b[i] !== undefined) d.port = b[i]!;
    return d;
  }
  return undefined;
}

/**
 * What the three tiers say (review plan-m7 F1's classes): which is the lowest tier at which the sides agree, and what that means.
 * `same` per tier: the sides' normal forms are equal there.
 */
export function tierClass(same: Record<IrTier, boolean>): string {
  if (same.N1) return "same at N1";
  if (same.N2) return "differs at N1 only: local names (a collision suffix or a name), N2 discards them";
  if (same.N3) return "differs at N1 and N2, same at N3: only in what instsimplify removes (a missed fold, or a wrong flag or operand on a folded or dead instruction)";
  return "differs at every tier: not names and not folds";
}
