// Cases and replay for the `serialize` probe (tools/probes/serialize/main.rs documents the output) and
// src/rustc_serialize/serialize_oracle.test.ts (lane serialize). Each case lists the values the probe
// encodes, in the same order, with the port's Encodable / Decodable impls of their type.
//
//   bun src/rustc_serialize/serialize_oracle/cases.ts fixture   rewrite expected.txt from the probe
//
// expected.txt: `<name> <sha256 of the MemEncoder bytes> <length> <file>` per case (`<file>` as the probe's).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode_Fingerprint, Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { Hash128, Hash64 } from "../../rustc_hashes/lib.ts";
import { FxHashMap, FxHashSet, LAYOUT_USIZE, u32_key } from "../../rust_ts/hash_map.ts";
import { DefPathHash, StableCrateId } from "../../rustc_span/def_id.ts";
import {
  decode_AstPass,
  decode_DefPathHash,
  decode_DesugaringKind,
  decode_Edition,
  decode_ExpnHash,
  decode_MacroKind,
  decode_MultiByteChar,
  decode_NormalizedPos,
  decode_SourceFileHash,
  decode_SourceFileHashAlgorithm,
  decode_StableCrateId,
  decode_Transparency,
  encode_AstPass,
  encode_DefPathHash,
  encode_DesugaringKind,
  encode_Edition,
  encode_ExpnHash,
  encode_MacroKind,
  encode_MultiByteChar,
  encode_NormalizedPos,
  encode_SourceFileHash,
  encode_SourceFileHashAlgorithm,
  encode_StableCrateId,
  encode_Transparency,
} from "../../rustc_span/decodable.gen.ts";
import { type AstPass, DesugaringKind, ExpnHash, type MacroKind, type Transparency } from "../../rustc_span/hygiene.ts";
import { type Edition } from "../../rustc_span/edition.ts";
import { type MultiByteChar, type NormalizedPos, RelativeBytePos, SourceFileHash, type SourceFileHashAlgorithm } from "../../rustc_span/lib.ts";
import { ch } from "../../std/char.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import { DATA } from "../../../scripts/lib/common.ts";
import {
  FileEncoder,
  FileEncoder_encode_IntEncodedWithFixedSize,
  IntEncodedWithFixedSize,
  MemDecoder,
  MemDecoder_decode_IntEncodedWithFixedSize,
  MemEncoder,
  MemEncoder_encode_IntEncodedWithFixedSize,
} from "../opaque.ts";
import {
  type Decodable,
  decode_array,
  decode_bool,
  decode_Box_slice,
  decode_BTreeMap,
  decode_BTreeSet,
  decode_char,
  decode_Hash128,
  decode_Hash64,
  decode_HashMap,
  decode_HashSet,
  decode_i128,
  decode_i16,
  decode_i32,
  decode_i64,
  decode_i8,
  decode_IndexMap,
  decode_isize,
  decode_NonZero,
  decode_Option,
  decode_Option_some,
  decode_PathBuf,
  decode_Result,
  decode_String,
  decode_tuple,
  decode_u128,
  decode_u16,
  decode_u32,
  decode_u64,
  decode_u8,
  decode_unit,
  decode_usize,
  decode_Vec,
  type Encodable,
  encode_array,
  encode_bool,
  encode_Box,
  encode_BTreeMap,
  encode_BTreeSet,
  encode_char,
  encode_Hash128,
  encode_Hash64,
  encode_HashMap,
  encode_HashSet,
  encode_i128,
  encode_i16,
  encode_i32,
  encode_i64,
  encode_i8,
  encode_IndexMap,
  encode_isize,
  encode_NonZero,
  encode_Option,
  encode_Option_some,
  encode_PathBuf,
  encode_Result,
  encode_slice,
  encode_String,
  encode_tuple,
  encode_u128,
  encode_u16,
  encode_u32,
  encode_u64,
  encode_u8,
  encode_unit,
  encode_usize,
  encode_Vec,
} from "../serialize.ts";

export const EXPECTED = join(import.meta.dir, "expected.txt");

export interface Case<T = unknown> {
  name: string;
  values: T[];
  encode: (v: T, e: MemEncoder | FileEncoder) => void;
  decode: Decodable<T, MemDecoder>;
}
const c = <T>(name: string, values: T[], encode: Encodable<T, MemEncoder>, decode: Decodable<T, MemDecoder>): Case => ({ name, values, encode, decode }) as Case;
const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);

const U64_MAX = (1n << 64n) - 1n;
const long = "abcdefghij".repeat(20);

/** The `big` case: a blob larger than FileEncoder's 64 KiB buffer, then many LEB128 writes. */
interface Big {
  blob: number[];
  nums: bigint[];
  end: string;
}
const big: Big = {
  blob: range(0, 70_000).map((i) => (i * 7) % 251),
  nums: range(0, 12_000).map((i) => BigInt.asUintN(64, BigInt(i) * 0x9e37_79b9_7f4a_7c15n) >> BigInt(i % 64)),
  end: "end",
};

function fx_map(): Map<number, bigint> {
  const fx = FxHashMap.default<number, bigint>(u32_key, LAYOUT_USIZE);
  for (const i of range(0, 50)) fx.set(i * 7919, BigInt(i) << 40n);
  return fx;
}

const algs: SourceFileHashAlgorithm[] = ["Md5", "Sha1", "Sha256", "Blake3"];
const SRC_TEXT = utf8("fn main() {}\n");
/** `SourceFileHash::new_in_memory(kind, b"fn main() {}\n")`; blake3 is unported: its digest is the probe's. */
const source_file_hash = (k: SourceFileHashAlgorithm): SourceFileHash =>
  k === "Blake3" ? new SourceFileHash(k, Uint8Array.from(Buffer.from("2d1ebfa706ba230165250f744796a92accba5e1b6fa357983b65319da33f8e93", "hex"))) : SourceFileHash.new_in_memory(k, SRC_TEXT);
const scid = StableCrateId.of(Hash64.new(0x1122_3344_5566_7788n));

export const CASES: Case[] = [
  // ---- primitives ----
  c("u8", range(0, 256), encode_u8, decode_u8),
  c("u16", [0, 1, 127, 128, 255, 256, 0x7fff, 0x8000, 0xffff], encode_u16, decode_u16),
  c("u32", [0, 1, 127, 128, 16383, 16384, 0x1234_5678, 2 ** 31, 0xffff_ffff], encode_u32, decode_u32),
  c("u64", [0n, 1n, 127n, 128n, 1n << 32n, 1n << 53n, (1n << 53n) + 1n, 0x0123_4567_89ab_cdefn, U64_MAX], encode_u64, decode_u64),
  c("u128", [0n, 1n, U64_MAX + 1n, 0x0123_4567_89ab_cdef_fedc_ba98_7654_3210n, (1n << 128n) - 1n], encode_u128, decode_u128),
  c("usize", [0, 1, 127, 128, 300, 65535, 2 ** 32, 2 ** 49 - 1, 2 ** 49, 2 ** 53 - 1], encode_usize, decode_usize),
  c("i8", [-128, -1, 0, 1, 127], encode_i8, decode_i8),
  c("i16", [-32768, -129, -128, -65, -64, -1, 0, 1, 63, 64, 127, 128, 32767], encode_i16, decode_i16),
  c("i32", [-(2 ** 31), -65, -64, -1, 0, 63, 64, 0x1234_5678, 2 ** 31 - 1], encode_i32, decode_i32),
  c("i64", [-(1n << 63n), -(1n << 53n), -65n, -1n, 0n, 64n, 1n << 53n, (1n << 63n) - 1n], encode_i64, decode_i64),
  c("i128", [-(1n << 127n), -(1n << 63n) - 1n, -1n, 0n, U64_MAX + 1n, (1n << 127n) - 1n], encode_i128, decode_i128),
  c("isize", [-(2 ** 53 - 1), -(2 ** 49), -65, -64, -1, 0, 63, 64, 2 ** 49 - 1, 2 ** 49, 2 ** 53 - 1], encode_isize, decode_isize),
  c("bool", [false, true, true], encode_bool, decode_bool),
  c("char", ["a", "\0", "é", "€", "😀", "\u{7f}", "\u{80}", "\u{d7ff}", "\u{e000}", "\u{10ffff}"].map(ch), encode_char, decode_char),
  c("unit", [null, null], encode_unit, decode_unit),

  // ---- strings and bytes ----
  c("String", ["", "a", "héllo wörld", "😀".repeat(10), long], encode_String, decode_String),
  c(
    "byte_str",
    [new Uint8Array(0), Uint8Array.from([0x00, 0xc1, 0xc2, 0xff]), utf8(long)],
    (v, e) => e.emit_byte_str(v),
    (d) => d.read_byte_str(),
  ),
  c("PathBuf", ["/tmp/a b/c.rs", "relative/ü.rs"], encode_PathBuf, decode_PathBuf),

  // ---- sequences, options, results, tuples, arrays ----
  c("Vec_u8", [[], [1, 2, 3], range(0, 300).map((i) => i & 0xff)], (v, e) => encode_Vec(v, e, encode_u8), (d) => decode_Vec(d, decode_u8)),
  c("Vec_u32", [[], [0, 128, 0xffff_ffff]], (v, e) => encode_Vec(v, e, encode_u32), (d) => decode_Vec(d, decode_u32)),
  c("Vec_String", [["x", "", "ÿ"]], (v, e) => encode_Vec(v, e, encode_String), (d) => decode_Vec(d, decode_String)),
  c("Option_u32", [undefined, 0, 0xffff_ffff], (v, e) => encode_Option(v, e, encode_u32), (d) => decode_Option(d, decode_u32)),
  c<{ $: "Some"; _0: number | undefined } | undefined>(
    "Option_Option_u8",
    [undefined, { $: "Some", _0: undefined }, { $: "Some", _0: 7 }],
    (v, e) => encode_Option_some(v, e, (x, s) => encode_Option(x, s, encode_u8)),
    (d) => decode_Option_some(d, (dd) => decode_Option(dd, decode_u8)),
  ),
  c<Result<number, string>>("Result_u32_String", [Ok(5), Err("bad")], (v, e) => encode_Result(v, e, encode_u32, encode_String), (d) => decode_Result(d, decode_u32, decode_String)),
  c<[number, string, boolean]>(
    "tuple3",
    [
      [1, "s", true],
      [255, "", false],
    ],
    (v, e) => encode_tuple(v, e, encode_u8, encode_String, encode_bool),
    (d) => decode_tuple(d, decode_u8, decode_String, decode_bool),
  ),
  c(
    "array_u8_4",
    [
      [1, 2, 3, 4],
      [0, 0, 0, 255],
    ],
    (v, e) => encode_array(v, e, encode_u8),
    (d) => decode_array(d, 4, decode_u8),
  ),
  c(
    "Box_slice_u32",
    [[], [7, 1 << 20]],
    (v, e) => encode_Box(v, e, (x, s) => encode_slice(x, s, encode_u32)),
    (d) => decode_Box_slice(d, decode_u32),
  ),
  c("NonZero_u32", [1, 0xffff_ffff], (v, e) => encode_NonZero(v, e, encode_u32), (d) => decode_NonZero(d, decode_u32)),

  // ---- maps and sets ----
  c(
    "BTreeMap_u32_String",
    [new Map(["zero", "one", "two", "three"].map((s, i) => [i * 1000, s] as const))],
    (v, e) => encode_BTreeMap(v, e, encode_u32, encode_String),
    (d) => decode_BTreeMap(d, decode_u32, decode_String),
  ),
  c("BTreeSet_i64", [new Set([-5n, 0n, 3n, 1n << 40n])], (v, e) => encode_BTreeSet(v, e, encode_i64), (d) => decode_BTreeSet(d, decode_i64)),
  c(
    "FxHashMap_u32_u64",
    // `FxHashMap::default()` + 50 inserts: the oracle's (hashbrown) iteration order
    [fx_map()],
    (v, e) => encode_HashMap(v, e, encode_u32, encode_u64),
    (d) => decode_HashMap(d, decode_u32, decode_u64),
  ),
  // `(0..40).map(..).collect::<FxHashSet<_>>()` (exact size hint 40)
  c("FxHashSet_u32", [FxHashSet.from_iter(range(0, 40).map((i) => i * 31), 40, u32_key) as Set<number>], (v, e) => encode_HashSet(v, e, encode_u32), (d) => decode_HashSet(d, decode_u32)),
  c(
    "FxIndexMap_String_u32",
    [new Map<string, number>([["b", 1], ["a", 1], ["c", 1], ["ä", 2]])],
    (v, e) => encode_IndexMap(v, e, encode_String, encode_u32),
    (d) => decode_IndexMap(d, decode_String, decode_u32),
  ),

  // ---- hashes and the opaque specializations ----
  c("Hash64", [Hash64.new(0n), Hash64.new(0x0123_4567_89ab_cdefn), Hash64.new(U64_MAX)], encode_Hash64, decode_Hash64),
  c("Hash128", [Hash128.new(0n), Hash128.new(0x0123_4567_89ab_cdef_fedc_ba98_7654_3210n)], encode_Hash128, decode_Hash128),
  c(
    "Fingerprint",
    [Fingerprint.new(1n, 2n), Fingerprint.new(U64_MAX, 0x8000_0000_0000_0000n)],
    // `impl Encodable for Fingerprint` (fingerprint.rs:172) is rustc-skipped in the port (M5)
    (v, e) => e.emit_raw_bytes(Fingerprint.to_le_bytes(v)),
    decode_Fingerprint,
  ),
  {
    name: "IntEncodedWithFixedSize",
    values: [new IntEncodedWithFixedSize(0n), new IntEncodedWithFixedSize(0x0102_0304_0506_0708n), new IntEncodedWithFixedSize(U64_MAX)],
    encode: (v, e) => (e instanceof FileEncoder ? FileEncoder_encode_IntEncodedWithFixedSize(v as IntEncodedWithFixedSize, e) : MemEncoder_encode_IntEncodedWithFixedSize(v as IntEncodedWithFixedSize, e)),
    decode: MemDecoder_decode_IntEncodedWithFixedSize,
  },
  c<Big>(
    "big",
    [big],
    (v, e) => {
      encode_Vec(v.blob, e, encode_u8);
      for (const n of v.nums) e.emit_u64(n);
      e.emit_str(v.end);
    },
    (d) => ({ blob: decode_Vec(d, decode_u8), nums: big.nums.map(() => d.read_u64()), end: d.read_str() }),
  ),

  // ---- rustc_span types (generated: src/rustc_span/decodable.gen.ts) ----
  c<Edition>("Edition", ["Edition2015", "Edition2018", "Edition2021", "Edition2024", "EditionFuture"], encode_Edition, decode_Edition),
  c<Transparency>("Transparency", ["Transparent", "SemiOpaque", "Opaque"], encode_Transparency, decode_Transparency),
  c<MacroKind>("MacroKind", ["Bang", "Attr", "Derive"], encode_MacroKind, decode_MacroKind),
  c<AstPass>("AstPass", ["StdImports", "TestHarness", "ProcMacroHarness"], encode_AstPass, decode_AstPass),
  c<DesugaringKind>(
    "DesugaringKind",
    [
      DesugaringKind.QuestionMark,
      DesugaringKind.TryBlock,
      DesugaringKind.YeetExpr,
      DesugaringKind.OpaqueTy,
      DesugaringKind.Async,
      DesugaringKind.Await,
      DesugaringKind.ForLoop,
      DesugaringKind.WhileLoop,
      DesugaringKind.BoundModifier,
      DesugaringKind.Contract,
      DesugaringKind.PatTyRange,
      { $: "FormatLiteral", source: true },
      { $: "FormatLiteral", source: false },
      DesugaringKind.RangeExpr,
    ],
    encode_DesugaringKind,
    decode_DesugaringKind,
  ),
  c("SourceFileHashAlgorithm", algs, encode_SourceFileHashAlgorithm, decode_SourceFileHashAlgorithm),
  c("SourceFileHash", algs.map(source_file_hash), encode_SourceFileHash, decode_SourceFileHash),
  c<MultiByteChar>(
    "MultiByteChar",
    [
      { pos: RelativeBytePos(5), bytes: 3 },
      { pos: RelativeBytePos(70000), bytes: 4 },
    ],
    encode_MultiByteChar,
    decode_MultiByteChar,
  ),
  c<NormalizedPos>(
    "NormalizedPos",
    [
      { pos: RelativeBytePos(0), diff: 1 },
      { pos: RelativeBytePos(300), diff: 1 << 20 },
    ],
    encode_NormalizedPos,
    decode_NormalizedPos,
  ),
  c("StableCrateId", [scid], encode_StableCrateId, decode_StableCrateId),
  c("DefPathHash", [DefPathHash.new(scid, Hash64.new(0x99aa_bbcc_ddee_ff00n))], encode_DefPathHash, decode_DefPathHash),
  c("ExpnHash", [ExpnHash.of(Fingerprint.new(0x0102_0304_0506_0708n, 0xf0e0_d0c0_b0a0_9080n))], encode_ExpnHash, decode_ExpnHash),
];

/** The port's MemEncoder bytes of a case. */
export function mem_encode(cs: Case): Uint8Array {
  const e = MemEncoder.new();
  for (const v of cs.values) cs.encode(v, e);
  return e.finish();
}

/** The port's FileEncoder file of a case (written under `dir`). */
export function file_encode(cs: Case, dir: string): Uint8Array {
  const path = join(dir, cs.name);
  const r = FileEncoder.new(path);
  if (r.$ === "Err") throw new Error(`FileEncoder::new(${path})`);
  const e = r._0;
  for (const v of cs.values) cs.encode(v, e);
  const f = e.finish();
  e.drop();
  if (f.$ === "Err") throw new Error(`FileEncoder::finish(${path})`);
  return new Uint8Array(readFileSync(path));
}

/** Probe output lines: name -> { mem, file } (`file` undefined for `=`). */
export interface ProbeCase {
  mem: Uint8Array;
  file: Uint8Array | undefined;
}
export const unhex = (h: string): Uint8Array => (h === "_" ? new Uint8Array(0) : Uint8Array.from(Buffer.from(h, "hex")));
export function parse_probe(out: string): Map<string, ProbeCase> {
  const m = new Map<string, ProbeCase>();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, mem, file] = line.split(" ");
    m.set(name!, { mem: unhex(mem!), file: file === "=" ? undefined : unhex(file!) });
  }
  return m;
}

export const PROBE_NAME = "serialize";

/** Run the probe (built with `bun scripts/probes.ts build serialize`). */
export function run_probe(probe: string, dir: string): Map<string, ProbeCase> {
  mkdirSync(dir, { recursive: true });
  const r = Bun.spawnSync([probe, dir], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`serialize probe failed: ${r.stderr.toString().trim()}`);
  return parse_probe(r.stdout.toString());
}

export const sha256 = (b: Uint8Array): string => new Bun.CryptoHasher("sha256").update(b).digest("hex");
/** A fixture line. */
export const fixture_line = (name: string, p: ProbeCase): string => `${name} ${sha256(p.mem)} ${p.mem.length} ${p.file === undefined ? "=" : sha256(p.file)}`;

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd !== "fixture") {
    console.log("usage: bun src/rustc_serialize/serialize_oracle/cases.ts fixture");
    process.exit(2);
  }
  const { probePath } = await import("../../../scripts/probes.ts");
  const got = run_probe(probePath(PROBE_NAME), join(DATA, "tmp", "serialize-fixture"));
  const lines = ["# serialize probe: <case> <sha256 of the MemEncoder bytes> <length> <file: `=` = mem + MAGIC_END_BYTES>"];
  for (const cs of CASES) {
    const p = got.get(cs.name);
    if (!p) throw new Error(`ERROR: probe has no case ${cs.name}`);
    lines.push(fixture_line(cs.name, p));
  }
  if (got.size !== CASES.length) throw new Error(`ERROR: probe has ${got.size} cases, cases.ts ${CASES.length}`);
  writeFileSync(EXPECTED, lines.join("\n") + "\n");
  console.log(`wrote ${CASES.length} cases to ${EXPECTED}`);
}
