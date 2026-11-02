// Tests of src/miri/shims/tls.ts (lane miri-shims-a): the pthread-style TLS key / value / destructor bookkeeping of
// `TlsData` (no interpreter needed). Expectations follow upstream's semantics (tls.rs): keys start at 1 and only grow,
// a NULL store removes the value, `fetch_tls_dtor` walks keys in `BTreeMap` order strictly after the last key, clears
// the value it returns, and skips keys without a destructor or without a value for the thread.
import { expect, test } from "bun:test";
import "../lib.ts";
import { TlsData } from "./tls.ts";
import { ThreadId } from "../concurrency/thread.ts";
import { type Scalar } from "../lib.ts";
import { Size, TargetDataLayout } from "../../rustc_abi/lib.ts";
import { Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type Span } from "../../rustc_span/lib.ts";

const dl = TargetDataLayout.default(); // 64-bit pointers
const cx = { data_layout: () => dl };
const usize = (n: bigint): Scalar => interp_Scalar.from_target_usize(n, cx);
const T0 = ThreadId.new(0);
const T1 = ThreadId.new(1);
// The destructor `Instance` / `Span` are carried, never inspected: opaque stand-ins.
const DTOR_A = { name: "dtor_a" } as unknown as Instance;
const DTOR_B = { name: "dtor_b" } as unknown as Instance;
const SPAN = 0 as Span;
const ok = <T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T => {
  if (r.$ !== "Ok") throw new Error("ERROR: expected Ok");
  return r._0;
};
const err_text = (r: { $: string; _0: unknown }): string => JSON.stringify(r);

test("TlsData::default starts at key 1; keys grow; the key must fit in key_size", () => {
  const tls = TlsData.default_();
  expect(tls.next_key).toBe(1n);
  expect(ok(tls.create_tls_key(undefined, Size.from_bytes(4)))).toBe(1n);
  expect(ok(tls.create_tls_key([DTOR_A, SPAN], Size.from_bytes(4)))).toBe(2n);
  expect(tls.next_key).toBe(3n);
  // A 1-byte key space (`unsigned_int_max` = 255): key 255 fits, key 256 is out of space, but (as upstream) it was
  // inserted first.
  tls.next_key = 255n;
  expect(ok(tls.create_tls_key(undefined, Size.from_bytes(1)))).toBe(255n);
  const r = tls.create_tls_key(undefined, Size.from_bytes(1));
  expect(r.$).toBe("Err");
  expect(err_text(r)).toContain("we ran out of TLS key space");
  expect(tls.keys.has(256n)).toBe(true);
});

test("load / store / delete; NULL stores remove the value; errors name the key", () => {
  const tls = TlsData.default_();
  const k = ok(tls.create_tls_key(undefined, Size.from_bytes(8)));
  // Missing value reads as NULL.
  expect(interp_Scalar.to_target_usize(ok(tls.load_tls(k, T0, cx)), cx)).toEqual({ $: "Ok", _0: 0n });
  ok(tls.store_tls(k, T0, usize(0x1234n), cx));
  expect(interp_Scalar.to_target_usize(ok(tls.load_tls(k, T0, cx)), cx)).toEqual({ $: "Ok", _0: 0x1234n });
  // Other threads are separate.
  expect(interp_Scalar.to_target_usize(ok(tls.load_tls(k, T1, cx)), cx)).toEqual({ $: "Ok", _0: 0n });
  ok(tls.store_tls(k, T0, usize(0n), cx));
  expect(tls.keys.get(k)!.data.has(T0)).toBe(false);
  ok(tls.delete_tls_key(k));
  expect(err_text(tls.load_tls(k, T0, cx))).toContain("loading from a non-existing TLS key: 1");
  expect(err_text(tls.store_tls(k, T0, usize(1n), cx))).toContain("storing to a non-existing TLS key: 1");
  expect(err_text(tls.delete_tls_key(k))).toContain("removing a nonexistent TLS key: 1");
});

test("fetch_tls_dtor walks keys in order after the last key, clears the value, skips keys without dtor/value", () => {
  const tls = TlsData.default_();
  const k1 = ok(tls.create_tls_key([DTOR_A, SPAN], Size.from_bytes(4))); // 1
  const k2 = ok(tls.create_tls_key(undefined, Size.from_bytes(4))); // 2: no dtor
  const k3 = ok(tls.create_tls_key([DTOR_B, SPAN], Size.from_bytes(4))); // 3
  const k4 = ok(tls.create_tls_key([DTOR_A, SPAN], Size.from_bytes(4))); // 4: no value for T0
  ok(tls.store_tls(k1, T0, usize(11n), cx));
  ok(tls.store_tls(k2, T0, usize(22n), cx));
  ok(tls.store_tls(k3, T0, usize(33n), cx));
  ok(tls.store_tls(k4, T1, usize(44n), cx));
  // Insert out of order into the `Map` to check the `BTreeMap` order does not depend on insertion order.
  const e1 = tls.keys.get(k1)!;
  tls.keys.delete(k1);
  tls.keys.set(k1, e1);

  const first = tls.fetch_tls_dtor(undefined, T0)!;
  expect([first[0], first[2]]).toEqual([DTOR_A, 1n]);
  expect(interp_Scalar.to_target_usize(first[1], cx)).toEqual({ $: "Ok", _0: 11n });
  expect(tls.keys.get(k1)!.data.has(T0)).toBe(false); // set to NULL before the dtor runs

  const second = tls.fetch_tls_dtor(first[2], T0)!;
  expect([second[0], second[2]]).toEqual([DTOR_B, 3n]); // key 2 has no dtor, so it is skipped
  expect(tls.fetch_tls_dtor(second[2], T0)).toBeUndefined(); // key 4 has no value for T0
  expect(tls.fetch_tls_dtor(undefined, T0)).toBeUndefined(); // the next round finds nothing either
  expect(tls.keys.get(k2)!.data.has(T0)).toBe(true); // values without a dtor are kept

  const t1 = tls.fetch_tls_dtor(undefined, T1)!;
  expect([t1[0], t1[2]]).toEqual([DTOR_A, 4n]);
});

test("delete_all_thread_tls clears one thread's values; macOS dtors must have run", () => {
  const tls = TlsData.default_();
  const k = ok(tls.create_tls_key(undefined, Size.from_bytes(4)));
  ok(tls.store_tls(k, T0, usize(1n), cx));
  ok(tls.store_tls(k, T1, usize(2n), cx));
  tls.delete_all_thread_tls(T0);
  expect([...tls.keys.get(k)!.data.keys()]).toEqual([T1]);

  ok(tls.add_macos_thread_dtor(T1, DTOR_A, usize(5n), SPAN));
  expect(() => tls.delete_all_thread_tls(T1)).toThrow("the destructors should have already been run");
  ok(tls.add_macos_thread_dtor(T0, DTOR_A, usize(5n), SPAN));
  tls.macos_thread_dtors.get(T0)!.pop();
  tls.delete_all_thread_tls(T0);
  expect(tls.macos_thread_dtors.has(T0)).toBe(false);
});

test("visit_provenance visits every stored value and macOS dtor argument", () => {
  const tls = TlsData.default_();
  const k = ok(tls.create_tls_key(undefined, Size.from_bytes(4)));
  ok(tls.store_tls(k, T0, usize(1n), cx));
  ok(tls.add_macos_thread_dtor(T0, DTOR_A, usize(2n), SPAN));
  let calls = 0;
  tls.visit_provenance(() => {
    calls++;
  });
  // Integer scalars carry no provenance: nothing to report (the walk itself must not stop `unported`).
  expect(calls).toBe(0);
});
