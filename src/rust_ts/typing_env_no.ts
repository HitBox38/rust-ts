// PORT(perf) (lane miri-perf, plan-m6 D11): a small dense number for a `TypingEnv`, so query keys and layout memos can
// hold it in a number instead of its `intern_key` text. Two envs get the same number exactly when their `intern_key`s
// are equal: the slow path goes through that key, so the equality is the one the query caches had before. Upstream has
// no such number (it hashes the env's fields); nothing observable depends on the number, it is only ever a map key.
//
// The fast path is a one-entry memo on the two fields' identities. The fields are never written after construction
// (`caller_bounds_` is an interned list, the mode object is `readonly`), so the same identities mean the same key. Miri
// and const eval use one env almost always, and a miss costs one key plus one map lookup.
import { intern_key } from "./intern_key.ts";

type TypingEnvLike = { readonly typing_mode_: { readonly _0: unknown }; readonly param_env: { readonly caller_bounds_: unknown } };

const NUMBERS = new Map<string, number>();
let last_mode: unknown;
let last_bounds: unknown;
let last_no = -1;

export function typing_env_no(env: TypingEnvLike): number {
  const mode = env.typing_mode_._0;
  const bounds = env.param_env.caller_bounds_;
  if (mode === last_mode && bounds === last_bounds) return last_no;
  const key = intern_key(env);
  let no = NUMBERS.get(key);
  if (no === undefined) {
    no = NUMBERS.size;
    NUMBERS.set(key, no);
  }
  last_mode = mode;
  last_bounds = bounds;
  last_no = no;
  return no;
}

/**
 * PORT(perf): `(env, DefId, id)` as one number when all fit (the interpreter's usual case), else -1: env below 4, crate below
 * 2^7, index below 2^20, id below 2^24. Injective on what it accepts; a key that does not fit takes another form, decided by
 * its value alone, so one value always has one key.
 */
export function pack_def_id(env: number, d: { readonly krate: number; readonly index: number }, id: number): number {
  if (env < 4 && d.krate < 0x80 && d.index < 0x10_0000 && id < 0x100_0000) {
    return env * 0x8_0000_0000_0000 + d.krate * 0x100_0000_0000 + d.index * 0x100_0000 + id;
  }
  return -1;
}
