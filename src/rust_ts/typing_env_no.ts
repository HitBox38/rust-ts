// PORT(perf) (lane miri-perf, plan-m6 D11): a small dense number for a `TypingEnv`, so query keys and layout memos can
// hold it in a number instead of its `intern_key` text. Two envs get the same number exactly when their `intern_key`s
// are equal: the slow path goes through that key, so the equality is the one the query caches had before. Upstream has
// no such number (it hashes the env's fields); nothing observable depends on the number, it is only ever a map key.
//
// The fast path is a two-entry memo on the two fields' identities. The fields are never written after construction
// (`caller_bounds_` is an interned list, the mode object is `readonly`), so the same identities mean the same key. Miri
// and const eval use one env almost always, and a miss costs one key plus one map lookup.
// PORT(perf) (lane perf-near-limit): two entries, as const eval alternates `PostAnalysis` (`layout_of`'s input) and `Codegen`
// (`InterpCx::typing_env`): with one entry, tests/ui/consts/const-eval/issue-52475.rs built 20M key strings, 27% of its samples.
import { intern_key } from "./intern_key.ts";

type TypingEnvLike = { readonly typing_mode_: { readonly _0: unknown }; readonly param_env: { readonly caller_bounds_: unknown } };

const NUMBERS = new Map<string, number>();
let last_mode: unknown;
let last_bounds: unknown;
let last_no = -1;
let prev_mode: unknown;
let prev_bounds: unknown;
let prev_no = -1;

export function typing_env_no(env: TypingEnvLike): number {
  const mode = env.typing_mode_._0;
  const bounds = env.param_env.caller_bounds_;
  if (mode === last_mode && bounds === last_bounds) return last_no;
  let no: number | undefined;
  if (mode === prev_mode && bounds === prev_bounds) {
    no = prev_no;
  } else {
    const key = intern_key(env);
    no = NUMBERS.get(key);
    if (no === undefined) {
      no = NUMBERS.size;
      NUMBERS.set(key, no);
    }
  }
  prev_mode = last_mode;
  prev_bounds = last_bounds;
  prev_no = last_no;
  last_mode = mode;
  last_bounds = bounds;
  last_no = no;
  return no;
}

/**
 * PORT(perf): `(env, DefId, id)` as one number when all fit (the interpreter's usual case), else -1: env below 4 at bit 51,
 * crate below 2^7 at bit 44, index below 2^20 at bit 24, id below 2^24 at bit 0, 53 bits in all. Injective on what it accepts
 * (tested); a key that does not fit takes another form, decided by its value alone, so one value always has one key.
 */
export function pack_def_id(env: number, d: { readonly krate: number; readonly index: number }, id: number): number {
  if (env < 4 && d.krate < 0x80 && d.index < 0x10_0000 && id < 0x100_0000) {
    return env * 0x8_0000_0000_0000 + d.krate * 0x1000_0000_0000 + d.index * 0x100_0000 + id;
  }
  return -1;
}

/**
 * PORT(perf): `(args, env)` as one number, or undefined if the env does not fit below 0x40: `(args, env)` and
 * `(args - 1, env + 0x40)` would otherwise be the same key (review miri-perf F2). The caller then does not memoize.
 */
export function args_env_key(args_id: number, env: number): number | undefined {
  return env < 0x40 ? args_id * 0x40 + env : undefined;
}
