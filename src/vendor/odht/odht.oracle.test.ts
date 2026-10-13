// Oracle tests for vendored odht 0.3.1 (lane odht), against the oracle toolchain's own odht and
// rustc_hir_id `def_path_hash_map::Config` through the `odht` rustc-dev probe (tools/probes/odht):
//   - build: thousands of generated insert scripts on three configs (rustc's u64 -> u32 UnHashFn config,
//     u64 -> u32 and u32 -> u32 FxHashFn configs) and every constructor (`default`, `with_capacity` at
//     many load factors, `from_iterator`): the insert results, `len` and the raw bytes are identical;
//     `{:?}` of small tables is identical.
//   - get: `HashTable::from_raw_bytes` of those bytes (and of corrupted copies: header fields, size,
//     control bytes, non-empty empty slots): the same error message, or the same `len`, iteration order
//     and lookups (present and absent keys).
//   - readmeta: the `def_path_hash_map` of the host sysroot's `core`, `alloc` and `std` `.rmeta`: the
//     same byte range, iteration and lookups. The port also rebuilds each table from its entries in
//     `DefIndex` order with `HashTableOwned::default()` + `insert` (as rustc_hir_id's `Definitions`
//     does) and gets the crate's bytes back exactly.
// Without the probe the oracle tests are a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
// The pinned-bytes test at the end always runs.
import "../../rustc_metadata/lib.ts";
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import { Config as HirConfig } from "../../rustc_hir_id/def_path_hash_map.ts";
import { MetadataBlob } from "../../rustc_metadata/rmeta/decoder.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { DefIndex } from "../../rustc_span/def_id.ts";
import { ByteArray_u8_array, type Config, debug_HashTableOwned, FxHashFn, HashTable, HashTableOwned, UnHashFn } from "./lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "odht");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: odht probe not built (bun scripts/probes.ts build odht); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

// ---- configs ----

/** rustc_hir_id's `def_path_hash_map::Config` with its associated types (`[u8; 8]`, `[u8; 4]`, `UnHashFn`). */
const RustcCfg: Config<Hash64, DefIndex> = {
  ...HirConfig,
  EncodedKey: ByteArray_u8_array(8),
  EncodedValue: ByteArray_u8_array(4),
  H: UnHashFn,
};

function u64_le(x: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, x, true);
  return b;
}
function u32_le(x: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, x, true);
  return b;
}
const rd64 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
const rd32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);

const Fx8: Config<bigint, number> = {
  EncodedKey: ByteArray_u8_array(8),
  EncodedValue: ByteArray_u8_array(4),
  H: FxHashFn,
  encode_key: u64_le,
  encode_value: u32_le,
  decode_key: rd64,
  decode_value: rd32,
};
const Fx4: Config<number, number> = {
  EncodedKey: ByteArray_u8_array(4),
  EncodedValue: ByteArray_u8_array(4),
  H: FxHashFn,
  encode_key: u32_le,
  encode_value: u32_le,
  decode_key: rd32,
  decode_value: rd32,
};

/** Text conversions per config (the probe's `Io` trait). */
interface Io<K, V> {
  C: Config<K, V>;
  key(s: string): K;
  value(s: string): V;
  show_key(k: K): string;
  show_value(v: V): string;
}
const IOS: Record<string, Io<any, any>> = {
  rustc: {
    C: RustcCfg,
    key: (s) => Hash64.new(BigInt(s)),
    value: (s) => DefIndex.from_u32(Number(s)),
    show_key: (k: Hash64) => String(Hash64.as_u64(k)),
    show_value: (v: DefIndex) => String(DefIndex.as_u32(v)),
  } satisfies Io<Hash64, DefIndex>,
  fx8: { C: Fx8, key: (s) => BigInt(s), value: Number, show_key: String, show_value: String } satisfies Io<bigint, number>,
  fx4: { C: Fx4, key: Number, value: Number, show_key: String, show_value: String } satisfies Io<number, number>,
};

const hex = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.length).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));

function fnv1a64(b: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  for (const x of b) {
    h ^= BigInt(x);
    h = (h * 0x100000001b3n) & 0xffff_ffff_ffff_ffffn;
  }
  return h.toString(16).padStart(16, "0");
}

// ---- the port's side of the probe protocol (see tools/probes/odht/main.rs) ----

function build<K, V>(io: Io<K, V>, ctor: string, pairs: readonly string[], debug: boolean): string {
  let out = "";
  const kv: [K, V][] = pairs.map((p) => {
    const i = p.indexOf(":");
    return [io.key(p.slice(0, i)), io.value(p.slice(i + 1))];
  });
  let table: HashTableOwned<K, V>;
  if (ctor.startsWith("iter=")) {
    table = HashTableOwned.from_iterator(io.C, kv, Number(ctor.slice(5)));
  } else {
    if (ctor === "default") {
      table = HashTableOwned.default(io.C);
    } else {
      const [n, pct] = ctor.slice(4).split(",");
      table = HashTableOwned.with_capacity(io.C, Number(n), Number(pct));
    }
    let ins = "inserts";
    for (const [k, v] of kv) {
      const old = table.insert(k, v);
      ins += old !== undefined ? ` ${io.show_value(old)}` : " None";
    }
    if (!debug) out += ins + "\n";
  }
  if (debug) {
    out += debug_HashTableOwned(table as HashTableOwned<unknown, unknown>, PLAIN);
    out += "END\n";
  } else {
    out += `len ${table.len()}\nbytes ${hex(table.raw_bytes())}\n`;
  }
  return out;
}

function get<K, V>(io: Io<K, V>, bytes: Uint8Array, keys: readonly string[], every: number): string {
  let out = "";
  const r = HashTable.from_raw_bytes(io.C, bytes);
  if (r.$ === "Err") return `err ${r._0}\n`;
  const t = r._0;
  out += `ok len ${t.len()}\n`;
  const probe_keys: K[] = [];
  let i = 0;
  for (const [k, v] of t.iter()) {
    out += `iter ${io.show_key(k)} ${io.show_value(v)}\n`;
    if (every !== 0 && i % every === 0) probe_keys.push(k);
    i++;
  }
  for (const k of keys) probe_keys.push(io.key(k));
  for (const k of probe_keys) {
    const v = t.get(k);
    out += v !== undefined ? `get ${io.show_key(k)} ${io.show_value(v)}\n` : `get ${io.show_key(k)} None\n`;
  }
  return out;
}

/** `MemDecoder::read_usize` (unsigned LEB128) at `pos`: `[value, next position]`. */
function read_usize(b: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 1;
  for (;;) {
    const byte = b[pos++]!;
    result += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift *= 128;
  }
}

function readmeta(file: string, pos: number, keys: readonly string[]): { out: string; bytes: Uint8Array } {
  const data = new Uint8Array(readFileSync(file));
  const [len, start] = read_usize(data, pos);
  const bytes = data.subarray(start, start + len);
  return { out: `bytes ${len} ${fnv1a64(bytes)}\n` + get(IOS.rustc!, bytes, keys, 5), bytes };
}

function run_port(cmds: readonly string[]): string {
  let out = "";
  for (const line of cmds) {
    const w = line.split(/\s+/).filter((s) => s !== "");
    try {
      if (w[0] === "build" || w[0] === "debug") out += build(IOS[w[1]!]!, w[2]!, w.slice(3), w[0] === "debug");
      else if (w[0] === "get") out += get(IOS[w[1]!]!, unhex(w[2]!), w.slice(3), 0);
      else if (w[0] === "readmeta") out += readmeta(w[1]!, Number(w[2]), w.slice(3)).out;
      else throw new globalThis.Error(`bad command ${line}`);
    } catch (e) {
      // The probe catches panics and prints `panic <message>` for the whole command.
      if (!(e instanceof Panic)) throw e;
      out += `panic ${e.message.replaceAll("\n", "\\n")}\n`;
    }
  }
  return out;
}

function run_probe(cmds: readonly string[]): string {
  const r = Bun.spawnSync([PROBE], { stdin: Buffer.from(cmds.join("\n") + "\n"), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new globalThis.Error(`probe failed: ${r.stderr.toString().slice(0, 500)}`);
  return r.stdout.toString();
}

/** Compares line by line and reports the first difference only (output discipline). */
function expect_same(port: string, oracle: string): void {
  if (port === oracle) return;
  const a = port.split("\n");
  const b = oracle.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  expect(`first difference at line ${i + 1}: port ${JSON.stringify(a[i]?.slice(0, 300))}`).toBe(
    `first difference at line ${i + 1}: oracle ${JSON.stringify(b[i]?.slice(0, 300))}`,
  );
}

// ---- script generation ----

class Rng {
  constructor(private s: bigint) {}
  u32(): number {
    let x = this.s;
    x ^= x >> 12n;
    x ^= (x << 25n) & 0xffff_ffff_ffff_ffffn;
    x ^= x >> 27n;
    this.s = x;
    return Number(((x * 0x2545f4914f6cdd1dn) & 0xffff_ffff_ffff_ffffn) >> 32n);
  }
  below(n: number): number {
    return this.u32() % n;
  }
  u64(): bigint {
    return (BigInt(this.u32()) << 32n) | BigInt(this.u32());
  }
}

/** A key generator for one script: uniform, small, shared high or low halves (UnHashFn hashes the high half). */
function key_gen(rng: Rng, cfg: string): () => string {
  const mode = rng.below(5);
  const hi = BigInt(rng.u32());
  const lo = BigInt(rng.u32());
  const span = 1 + rng.below(64);
  if (cfg === "fx4") {
    return mode === 0 ? () => String(rng.below(span)) : () => String(rng.u32());
  }
  switch (mode) {
    case 0:
      return () => String(rng.below(span));
    case 1:
      return () => String((hi << 32n) | BigInt(rng.u32()));
    case 2:
      return () => String((BigInt(rng.u32()) << 32n) | lo);
    case 3:
      return () => String((BigInt(rng.below(span)) << 32n) | BigInt(rng.below(span)));
    default:
      return () => String(rng.u64());
  }
}

function gen_scripts(seed: bigint, n: number): string[] {
  const rng = new Rng(seed);
  const cmds: string[] = [];
  const cfgs = ["rustc", "fx8", "fx4"];
  for (let i = 0; i < n; i++) {
    const cfg = cfgs[rng.below(3)]!;
    const size = rng.below(10) === 0 ? rng.below(600) : rng.below(40);
    const ctor_kind = rng.below(4);
    const pct = 1 + rng.below(100);
    const ctor = ctor_kind === 0 ? "default" : ctor_kind === 1 ? `iter=${pct}` : `cap=${rng.below(size + 2)},${pct}`;
    const key = key_gen(rng, cfg);
    const pairs: string[] = [];
    const used: string[] = [];
    for (let j = 0; j < size; j++) {
      // Duplicates (overwrites) now and then.
      const k = used.length > 0 && rng.below(6) === 0 ? used[rng.below(used.length)]! : key();
      used.push(k);
      pairs.push(`${k}:${rng.below(0x7fff_ffff)}`);
    }
    // Low load factors make `grow` fail its own assertion (both sides panic: the probe reports it).
    cmds.push(`build ${cfg} ${ctor} ${pairs.join(" ")}`);
  }
  return cmds;
}

// ---- tests ----

test.skipIf(SKIP)("build: insert results, len and raw bytes match the oracle's odht", () => {
  const cmds = gen_scripts(1n, 3000);
  expect_same(run_port(cmds), run_probe(cmds));
});

test.skipIf(SKIP)("debug: {:?} of small tables matches", () => {
  const rng = new Rng(7n);
  const cmds: string[] = [];
  for (let i = 0; i < 60; i++) {
    const cfg = ["rustc", "fx8", "fx4"][i % 3]!;
    const key = key_gen(rng, cfg);
    const n = rng.below(20);
    const pairs: string[] = [];
    for (let j = 0; j < n; j++) pairs.push(`${key()}:${rng.below(1000)}`);
    cmds.push(`debug ${cfg} ${i % 2 === 0 ? "default" : `cap=${n},${1 + rng.below(100)}`} ${pairs.join(" ")}`);
  }
  expect_same(run_port(cmds), run_probe(cmds));
});

test.skipIf(SKIP)("get: from_raw_bytes, iteration and lookups (incl. corrupted tables) match", () => {
  const builds = gen_scripts(2n, 400);
  const built = run_probe(builds).split("\n");
  const rng = new Rng(3n);
  const cmds: string[] = [];
  let bi = 0;
  for (const line of built) {
    if (!line.startsWith("bytes ")) continue;
    const cmd = builds[bi++]!.split(" ");
    const cfg = cmd[1]!;
    const bytes = line.slice(6);
    const present = cmd.slice(3).map((p) => p.split(":")[0]!);
    const key = key_gen(rng, cfg);
    const keys = [...present.filter(() => rng.below(2) === 0), ...Array.from({ length: 8 }, key)];
    cmds.push(`get ${cfg} ${bytes} ${keys.join(" ")}`);

    // Corruptions (each keeps the slot count a power of two: upstream's size check would otherwise
    // panic in `bytes_needed` before it can report an error).
    const b = unhex(bytes);
    const corrupt = (f: (c: Uint8Array) => Uint8Array) => cmds.push(`get ${cfg} ${hex(f(b.slice()))}`);
    switch (rng.below(9)) {
      case 0:
        corrupt((c) => ((c[rng.below(4)] ^= 1 + rng.below(255)), c)); // tag
        break;
      case 1:
        corrupt((c) => ((c[24 + rng.below(4)] ^= 1 + rng.below(255)), c)); // file format version
        break;
      case 2:
        corrupt((c) => ((c[4 + rng.below(4)] ^= 1 + rng.below(255)), c)); // size_of_* fields
        break;
      case 3:
        corrupt((c) => c.subarray(0, c.length - 1 - rng.below(8))); // truncated
        break;
      case 4:
        corrupt((c) => Uint8Array.from([...c, 0])); // one byte too long
        break;
      case 5:
        corrupt((c) => (new DataView(c.buffer, c.byteOffset + 16, 8).setBigUint64(0, BigInt(c_slot_count(c)) * 2n, true), c)); // slot count doubled
        break;
      case 6: {
        // A control byte within the first 10 slots.
        const slot_count = c_slot_count(b);
        const entry = cfg === "fx4" ? 8 : 12;
        corrupt((c) => ((c[32 + slot_count * entry + rng.below(Math.min(10, slot_count))] ^= 1 + rng.below(255)), c));
        break;
      }
      case 7: {
        // An entry byte within the first 10 slots (non-zero contents in an empty slot, or a hash mismatch).
        const entry = cfg === "fx4" ? 8 : 12;
        corrupt((c) => ((c[32 + rng.below(10 * entry)] ^= 1 + rng.below(255)), c));
        break;
      }
      default:
        corrupt((c) => ((c[8 + rng.below(6)] ^= 1 + rng.below(255)), c)); // item count (below 2^48: see u64_le_to_usize)
    }
  }
  expect_same(run_port(cmds), run_probe(cmds));
});

function c_slot_count(b: Uint8Array): number {
  return Number(new DataView(b.buffer, b.byteOffset + 16, 8).getBigUint64(0, true));
}

/** The host sysroot's full-metadata `core` / `alloc` / `std` `.rmeta` files and their def_path_hash_map positions. */
function sysroot_rmetas(): { file: string; pos: number }[] {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const dir = join(oracle.oracleSysroot(), "lib", "rustlib", process.env.RUST_TS_HOST_TUPLE ?? "aarch64-apple-darwin", "lib");
  const files = readdirSync(dir)
    .filter((f) => /^lib(core|alloc|std)-[0-9a-f]+\.rmeta$/.test(f))
    .sort()
    .map((f) => join(dir, f));
  const out: { file: string; pos: number }[] = [];
  create_default_session_globals_then(() => {
    for (const file of files) {
      const nb = MetadataBlob.new(new Uint8Array(readFileSync(file)));
      if (nb.$ === "Err") throw new globalThis.Error(`MetadataBlob::new failed for ${file}`);
      out.push({ file, pos: nb._0.get_root().def_path_hash_map.position });
    }
  });
  return out;
}

test.skipIf(SKIP)("readmeta: core/alloc/std def_path_hash_map: same bytes, iteration and lookups; rebuilt byte-identically", () => {
  const metas = sysroot_rmetas();
  expect(metas.length).toBe(3);
  const rng = new Rng(11n);
  const cmds = metas.map(({ file, pos }) => {
    const absent = Array.from({ length: 50 }, () => String(rng.u64()));
    return `readmeta ${file} ${pos} ${absent.join(" ")}`;
  });
  const oracle = run_probe(cmds);
  expect(oracle).not.toContain("\nerr ");
  expect_same(run_port(cmds), oracle);

  // Rebuild: `Definitions` inserts every `DefPathHash`'s local hash in `DefIndex` order into a
  // `HashTableOwned::default()`, and the encoder writes its `raw_bytes()`.
  for (const { file, pos } of metas) {
    const { bytes } = readmeta(file, pos, []);
    const r = HashTable.from_raw_bytes(RustcCfg, bytes);
    if (r.$ === "Err") throw new globalThis.Error(String(r._0));
    const entries = [...r._0.iter()].sort((a, b) => DefIndex.as_u32(a[1]) - DefIndex.as_u32(b[1]));
    expect(entries.length).toBeGreaterThan(1000);
    const t = HashTableOwned.default(RustcCfg);
    for (const [k, v] of entries) t.insert(k, v);
    expect(hex(t.raw_bytes()) === hex(bytes)).toBe(true);
  }
});

// Pinned oracle answers (from the probe), so the byte layout stays checked without it.
test("pinned bytes: odht's doc example (with an overwrite) and a one-entry rustc table", () => {
  const t = HashTableOwned.with_capacity(Fx4, 3, 95);
  expect([t.insert(1, 2), t.insert(3, 4), t.insert(5, 6), t.insert(3, 7)]).toEqual([undefined, undefined, undefined, 4]);
  expect(t.len()).toBe(3);
  expect(hex(t.raw_bytes())).toBe(
    "4f44485401040420030000000000000010000000000000000000000232f300000000000000000000000000000000000000000000000000000000000000000000" +
      "00000000000000000100000002000000000000000000000000000000000000000000000000000000050000000600000000000000000000000000000000000000" +
      "0000000000000000000000000000000000000000000000000300000007000000ffffffffff13ffffff61ffffffffff3affffffffff13ffffff61ffffffffff3a",
  );
  const r = HashTableOwned.from_iterator(RustcCfg, [[Hash64.new(1n), DefIndex.from_u32(1)]], 87);
  expect(hex(r.raw_bytes())).toBe(
    "4f444854010804200100000000000000100000000000000000000002b7de00000100000000000000010000000000000000000000000000000000000000000000" +
      "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
      "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
      "000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffff00ffffffffffffffffffffffffffffff",
  );
});
