// What one run of sweep.ts counts as (lane mir-alias; test helper, not a port). Apart from sweep.ts, which runs when imported,
// so that alias_check.test.ts can test it.
export type Outcome = "MATCH" | "DIFF" | "UNPORTED" | "ICE" | "BOTH_ICE" | "TIMEOUT" | "CHECKED" | "FAILED";

export interface Side {
  out: string;
  err: string;
  code: number;
}

/**
 * What an ICE says, whichever side printed it: the message after `panicked at <place>:`, as rustc does, or after the port's
 * `rust-ts: internal compiler error:`. `undefined` if `err` has neither.
 */
export function ice_message(err: string): string | undefined {
  return /^rust-ts: internal compiler error: (.*)$/m.exec(err)?.[1] ?? /^thread '.*panicked at .*:\n(.*)$/m.exec(err)?.[1];
}

/**
 * - `CHECKED` is mode `mono`'s success. `driver.ts` writes its `CHECKED` line on any exit, so only exit 0 counts: a program that
 *   fails to compile is `FAILED`, having reached no MIR (docs/reviews/mir-alias.md F4).
 * - `BOTH_ICE` needs the same message on both sides. Invalid custom MIR at this mode does that; the wording around it differs
 *   (`rust-ts: internal compiler error`). A port ICE of another kind on the same program is a `DIFF`.
 */
export function classify_run(mono: boolean, timeout: boolean, oracle: Side | undefined, port: Side, dump_diff: string | undefined): Outcome {
  if (timeout) return "TIMEOUT";
  if (port.code === 70) return "UNPORTED";
  if (mono) return port.code === 101 ? "ICE" : port.code === 0 ? "CHECKED" : "FAILED";
  if (oracle!.code === port.code && dump_diff !== undefined) return "DIFF";
  if (oracle!.out === port.out && oracle!.err === port.err && oracle!.code === port.code) return "MATCH";
  if (port.code === 101 && oracle!.code !== 101) return "ICE";
  if (port.code === 101 && oracle!.code === 101) {
    const message = ice_message(port.err);
    return message !== undefined && message === ice_message(oracle!.err) ? "BOTH_ICE" : "DIFF";
  }
  return "DIFF";
}
