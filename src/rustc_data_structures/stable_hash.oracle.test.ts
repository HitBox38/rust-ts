// rust-ts: `StableHasher` / `StableHash` against the oracle. stable_hash_oracle.json is the output of
// `hashprobe battery` (src/rustc_data_structures/stable_hash_probe/main.rs, a rustc-dev probe built
// against the pinned nightly): for each case, the Rust type and value, and what the pinned
// rustc_data_structures computes for `value.stable_hash(hcx, &mut StableHasher::new())` finished as
// `Hash128`, `Hash64`, `Fingerprint`, and `Hasher::finish`. This test rebuilds every value from its
// type, hashes it with the TS impls and compares all four.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hash128, Hash64 } from "../rustc_hashes/lib.ts";
import { panic } from "../std/panic.ts";
import { Fingerprint } from "./fingerprint.ts";
import {
  type Ordering,
  type StableHash,
  type StableHashCtxt,
  StableHasher,
  StableOrd_String,
  stable_hash_bool,
  stable_hash_BTreeMap,
  stable_hash_bytes,
  stable_hash_char,
  stable_hash_f32,
  stable_hash_f64,
  stable_hash_Fingerprint,
  stable_hash_Hash128,
  stable_hash_Hash64,
  stable_hash_i128,
  stable_hash_i16,
  stable_hash_i32,
  stable_hash_i64,
  stable_hash_i8,
  stable_hash_isize,
  stable_hash_Option,
  stable_hash_Option_some,
  stable_hash_Ordering,
  stable_hash_Result,
  stable_hash_str,
  stable_hash_String,
  stable_hash_tuple1,
  stable_hash_tuple2,
  stable_hash_tuple3,
  stable_hash_tuple4,
  stable_hash_u128,
  stable_hash_u16,
  stable_hash_u32,
  stable_hash_u64,
  stable_hash_u8,
  stable_hash_unit,
  stable_hash_usize,
  stable_hash_Vec,
} from "./stable_hash.ts";

interface Case {
  name: string;
  ty: string;
  value: unknown;
  hash128: string;
  hash64: string;
  fingerprint: [string, string];
  finish_u64: string;
}
const CASES: Case[] = JSON.parse(readFileSync(join(import.meta.dir, "stable_hash_oracle.json"), "utf8"));

const NO_HCX: StableHashCtxt = {
  stable_hash_span: () => panic("span"),
  def_path_hash: () => panic("def_path_hash"),
  stable_hash_controls: () => panic("controls"),
  assert_default_stable_hash_controls: () => panic("assert"),
};

// ---- the probe's type names ----
type Ty = { k: "name"; name: string; args: Ty[] } | { k: "tuple"; elems: Ty[] };
function parseTy(s: string): Ty {
  let i = 0;
  const ws = () => {
    while (s[i] === " ") i++;
  };
  const one = (): Ty => {
    ws();
    if (s[i] === "(") {
      i++;
      const elems: Ty[] = [];
      ws();
      while (s[i] !== ")") {
        elems.push(one());
        ws();
        if (s[i] === ",") i++;
        ws();
      }
      i++;
      return { k: "tuple", elems };
    }
    if (s[i] === "[") {
      const j = s.indexOf("]", i);
      const name = s.slice(i, j + 1);
      i = j + 1;
      return { k: "name", name, args: [] };
    }
    const m = /^[A-Za-z0-9_]+/.exec(s.slice(i))!;
    i += m[0].length;
    const args: Ty[] = [];
    if (s[i] === "<") {
      i++;
      for (;;) {
        args.push(one());
        ws();
        if (s[i] === ",") i++;
        else break;
      }
      i++; // '>'
    }
    return { k: "name", name: m[0], args };
  };
  const t = one();
  expect(i).toBe(s.length);
  return t;
}

type Hasher = [(v: unknown) => unknown, StableHash<unknown>];
const prim = <T>(conv: (v: unknown) => T, h: StableHash<T>): Hasher => [conv, h as StableHash<unknown>];
const num = (v: unknown) => Number(v as string);
const big = (v: unknown) => BigInt(v as string);

/** [JSON value -> TS value, StableHash impl] of a type. */
function impl(t: Ty): Hasher {
  if (t.k === "tuple") {
    const es = t.elems.map(impl);
    const conv = (v: unknown) => (v as unknown[]).map((x, i) => es[i]![0](x));
    const hs = es.map((e) => e[1]);
    switch (es.length) {
      case 0:
        return prim(() => null, stable_hash_unit);
      case 1:
        return [conv, (v, hcx, h) => stable_hash_tuple1(v as [unknown], hcx, h, hs[0]!)];
      case 2:
        return [conv, (v, hcx, h) => stable_hash_tuple2(v as [unknown, unknown], hcx, h, hs[0]!, hs[1]!)];
      case 3:
        return [conv, (v, hcx, h) => stable_hash_tuple3(v as [unknown, unknown, unknown], hcx, h, hs[0]!, hs[1]!, hs[2]!)];
      default:
        return [conv, (v, hcx, h) => stable_hash_tuple4(v as [unknown, unknown, unknown, unknown], hcx, h, hs[0]!, hs[1]!, hs[2]!, hs[3]!)];
    }
  }
  switch (t.name) {
    case "u8":
      return prim(num, stable_hash_u8);
    case "u16":
      return prim(num, stable_hash_u16);
    case "u32":
      return prim(num, stable_hash_u32);
    case "u64":
      return prim(big, stable_hash_u64);
    case "u128":
      return prim(big, stable_hash_u128);
    // PORT: usize/isize values beyond 2^53 are not JS numbers; the battery's are written through
    // their exact 64-bit pattern below.
    case "usize":
      return prim((v) => v as string, (v, hcx, h) => (BigInt(v) < 2n ** 53n ? stable_hash_usize(Number(v), hcx, h) : h.write_u64(BigInt(v))));
    case "i8":
      return prim(num, stable_hash_i8);
    case "i16":
      return prim(num, stable_hash_i16);
    case "i32":
      return prim(num, stable_hash_i32);
    case "i64":
      return prim(big, stable_hash_i64);
    case "i128":
      return prim(big, stable_hash_i128);
    case "isize":
      return prim(
        (v) => v as string,
        (v, hcx, h) => {
          const b = BigInt(v);
          if (b >= -(2n ** 53n) && b <= 2n ** 53n) stable_hash_isize(Number(b), hcx, h);
          else {
            // `write_isize` of a value outside 0..0xFF: the 0xFF marker then the 8 bytes.
            h.write_u8(0xff);
            h.write_u64(BigInt.asUintN(64, b));
          }
        },
      );
    case "bool":
      return prim((v) => v as boolean, stable_hash_bool);
    case "char":
      return prim(num, stable_hash_char);
    case "f32":
      return prim((v) => new DataView(Uint32Array.of(Number(v as string)).buffer).getFloat32(0, true), stable_hash_f32);
    case "f64":
      return prim((v) => new DataView(BigUint64Array.of(BigInt(v as string)).buffer).getFloat64(0, true), stable_hash_f64);
    case "Ordering":
      return prim((v) => v as Ordering, stable_hash_Ordering);
    case "Hash64":
      return prim((v) => Hash64.new(BigInt(v as string)), stable_hash_Hash64);
    case "Hash128":
      return prim((v) => Hash128.new(BigInt(v as string)), stable_hash_Hash128);
    case "Fingerprint":
      return prim((v) => Fingerprint.new(BigInt((v as string[])[0]!), BigInt((v as string[])[1]!)), stable_hash_Fingerprint);
    case "str":
      return prim((v) => v as string, stable_hash_str);
    case "String":
      return prim((v) => v as string, stable_hash_String);
    case "[u8]":
      return prim((v) => Uint8Array.from(v as number[]), stable_hash_bytes);
    case "Vec": {
      const [c, h] = impl(t.args[0]!);
      return [(v) => (v as unknown[]).map(c), (v, hcx, hh) => stable_hash_Vec(v as unknown[], hcx, hh, h)];
    }
    case "Option": {
      const [c, h] = impl(t.args[0]!);
      const inner = t.args[0]!;
      // `Option<Option<T>>`: the outer level is `{ $: "Some", _0 } | undefined` (PORTING §5)
      if (inner.k === "name" && inner.name === "Option")
        return [
          (v) => (v === null ? undefined : { $: "Some" as const, _0: c((v as { Some: unknown }).Some) }),
          (v, hcx, hh) => stable_hash_Option_some(v as { $: "Some"; _0: unknown } | undefined, hcx, hh, h),
        ];
      return [(v) => (v === null ? undefined : c((v as { Some: unknown }).Some)), (v, hcx, hh) => stable_hash_Option(v, hcx, hh, h)];
    }
    case "Result": {
      const [c0, h0] = impl(t.args[0]!);
      const [c1, h1] = impl(t.args[1]!);
      return [
        (v) => ("Ok" in (v as object) ? { $: "Ok", _0: c0((v as { Ok: unknown }).Ok) } : { $: "Err", _0: c1((v as { Err: unknown }).Err) }),
        (v, hcx, hh) => stable_hash_Result(v as never, hcx, hh, h0, h1),
      ];
    }
    case "BTreeMap": {
      expect(t.args[0]).toEqual({ k: "name", name: "String", args: [] });
      const [c1, h1] = impl(t.args[1]!);
      return [
        (v) => new Map((v as [string, unknown][]).map(([k, x]) => [k, c1(x)])),
        (v, hcx, hh) => stable_hash_BTreeMap(v as Map<string, unknown>, hcx, hh, stable_hash_String, h1, StableOrd_String),
      ];
    }
  }
  throw new Error(`ERROR: battery type ${JSON.stringify(t)} not handled`);
}

test("StableHasher battery matches the oracle", () => {
  expect(CASES.length).toBeGreaterThan(200);
  const bad: string[] = [];
  for (const c of CASES) {
    const [conv, h] = impl(parseTy(c.ty));
    const value = conv(c.value);
    const hasher = StableHasher.new();
    h(value, NO_HCX, hasher);
    const finish_u64 = hasher.finish_u64();
    const h64 = hasher.clone().finish(Hash64);
    const fp = hasher.clone().finish(Fingerprint);
    const h128 = hasher.finish(Hash128);
    const got = [String(h128), String(h64), Fingerprint.split(fp).map(String), String(finish_u64)];
    const want = [c.hash128, c.hash64, c.fingerprint, c.finish_u64];
    if (JSON.stringify(got) !== JSON.stringify(want) && bad.length < 5) bad.push(`${c.name} (${c.ty}): got ${JSON.stringify(got)}, oracle ${JSON.stringify(want)}`);
  }
  expect(bad).toEqual([]);
});
