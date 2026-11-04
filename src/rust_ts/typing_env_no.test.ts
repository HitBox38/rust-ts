// The packed memo keys (review miri-perf F1, F2): a collision runs the wrong function or hides an error, and no sample shows it.
import { expect, test } from "bun:test";
import { args_env_key, pack_def_id } from "./typing_env_no.ts";

test("pack_def_id is injective on everything it accepts, and stays exact", () => {
  const seen = new Map<number, string>();
  for (const env of [0, 1, 2, 3]) {
    for (const krate of [0, 1, 2, 0x3f, 0x40, 0x7e, 0x7f]) {
      for (const index of [0, 1, 0xffff, 0x1_0000, 0x1_0001, 0x7_ffff, 0x8_0000, 0xf_fffe, 0xf_ffff]) {
        for (const id of [0, 1, 0xff_ffff, 0x80_0000]) {
          const label = `${env}:${krate}:${index}:${id}`;
          const n = pack_def_id(env, { krate, index }, id);
          expect(Number.isSafeInteger(n), label).toBe(true);
          expect(seen.get(n), label).toBeUndefined();
          seen.set(n, label);
        }
      }
    }
  }
  expect(pack_def_id(0, { krate: 0, index: 0x1_0000 }, 0)).not.toBe(pack_def_id(0, { krate: 1, index: 0 }, 0));
  expect(pack_def_id(3, { krate: 0x7f, index: 0xf_ffff }, 0xff_ffff)).toBe(2 ** 53 - 1);
});

test("pack_def_id refuses what does not fit", () => {
  expect(pack_def_id(4, { krate: 0, index: 0 }, 0)).toBe(-1);
  expect(pack_def_id(0, { krate: 0x80, index: 0 }, 0)).toBe(-1);
  expect(pack_def_id(0, { krate: 0, index: 0x10_0000 }, 0)).toBe(-1);
  expect(pack_def_id(0, { krate: 0, index: 0 }, 0x100_0000)).toBe(-1);
});

test("args_env_key: an env past 0x3f is not memoized, so (args, env) and (args - 1, env + 64) cannot meet", () => {
  expect(args_env_key(5, 0x3f)).toBe(5 * 0x40 + 0x3f);
  expect(args_env_key(5, 0x40)).toBeUndefined();
  expect(args_env_key(4, 0x40 + 3)).toBeUndefined();
  const seen = new Set<number>();
  for (let args = 0; args < 8; args++) for (let env = 0; env < 0x40; env++) seen.add(args_env_key(args, env)!);
  expect(seen.size).toBe(8 * 0x40);
});
