// The encoder contract (lane encode-contract, plan-m5 D3 / wave 32; docs/handoff/encode-contract.md):
// - every fn of compiler/rustc_metadata/src/rmeta/encoder.rs is either ported (a `// rustc:` marker) or declared as a
//   stub (`// stub: <path>:<line> <name> (lane <lane>)` over a declaration whose body calls
//   `unported("rustc_metadata::rmeta::encoder::.. (lane <lane>)")`), never both, and each belongs to the lane the
//   split table below names, so lanes encoder-a..d and encode-span-hygiene cannot drift;
// - the hand `Encodable` impls outside encoder.rs that later lanes fill are pinned the same way (their former
//   `rustc-skip:` markers);
// - `EncodeContext` carries every method of its `impl` blocks, and the ported skeleton (the `Encoder` / `TyEncoder`
//   impls, the lazy machinery, the `Lazy*` writers) writes the bytes upstream writes;
// - the generated encoders mirror the generated / hand decoders (round trips through `MemEncoder` / `MemDecoder`).
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../../scripts/coverage.ts";
import { REPO } from "../../../scripts/lib/common.ts";
import "../lib.ts";
import { decode_IntTy, decode_Mutability, encode_IntTy, encode_Mutability, IntTy, Mutability } from "../../rustc_ast_ir/lib.ts";
import { Fingerprint, decode_Fingerprint, encode_Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { CtorKind, decode_CtorKind, encode_CtorKind } from "../../rustc_hir/def.ts";
import type { AllocId } from "../../rustc_middle/mir/interpret/mod.ts";
import { MAGIC_END_BYTES, MemDecoder, MemEncoder, type FileEncoder } from "../../rustc_serialize/opaque.ts";
import { type Decodable, type Encodable, encode_u8, encode_usize } from "../../rustc_serialize/serialize.ts";
import { decode_SymbolManglingVersion, encode_SymbolManglingVersion, SymbolManglingVersion } from "../../rustc_session/config.ts";
import "../../rustc_span/lib.ts";
import { CrateType, decode_CrateType, encode_CrateType } from "../../rustc_structures/crate_type.ts";
import { X86InlineAsmRegClass } from "../../rustc_target/asm/x86.ts";
import { decode_PanicStrategy, encode_PanicStrategy, PanicStrategy } from "../../rustc_target/spec/mod.ts";
import { decode_TargetTuple, encode_TargetTuple, type TargetTuple } from "../../rustc_target/spec/tuple.ts";
import { Unported } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { decode_Svh, encode_Svh, Svh } from "./decoder.ts";
import { EncodeContext, EncodeContext_CLEAR_CROSS_CRATE, encode_ExpnIndex, should_encode_span, encode_metadata } from "./encoder.ts";
import { encode_LazyArray, encode_LazyTable, encode_LazyValue, LazyState, LazyTable } from "./mod.ts";
import type { ExpnIndex } from "../../rustc_span/hygiene.ts";

const ENCODER = "compiler/rustc_metadata/src/rmeta/encoder.rs";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface Decl {
  file: string;
  path: string;
  line: number;
  name: string;
  kind: "rustc" | "stub";
  lane: string | undefined;
  /** the `unported("..")` text of the body below a stub */
  unported: string | undefined;
}
const decls: Decl[] = [];
for (const f of walk(join(REPO, "src"))) {
  if (f.endsWith(".gen.ts")) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\/\/ (rustc|stub): (compiler\/\S+):(\d+) (\w+)(?: \(lane ([^)]+)\))?/.exec(lines[i]!);
    if (!m) continue;
    const d: Decl = { file: relative(REPO, f), path: m[2]!, line: Number(m[3]), name: m[4]!, kind: m[1] as "rustc" | "stub", lane: m[5], unported: undefined };
    if (d.kind === "stub") {
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        if (/\/\/ (rustc|stub): /.test(lines[j]!)) break;
        const u = /unported\(["`]([^"`]+)["`]/.exec(lines[j]!);
        if (u) {
          d.unported = u[1];
          break;
        }
      }
    }
    decls.push(d);
  }
}
const LANES = ["encoder-a", "encoder-b", "encoder-c", "encoder-d", "encode-span-hygiene", "encode-middle"];

/** The fns ported by this lane: the `Encoder` / `TyEncoder` impls, the lazy machinery and the `Lazy*` / `ExpnIndex` writers. */
const PORTED = new Set([122, 128, 137, 145, 411, 415, 419, 423, 472, 494, 510]);

/** Lane encode-span-hygiene (wave 32, all ported): the `SpanEncoder` impl (:151-:244), `bytes_needed` (:254), `SpanData`
 * (:259), `encode_symbol_or_byte_symbol` (:529), `encode_source_map` (:581), `encode_hygiene` (:2036). */
const SPAN_HYGIENE = new Set([151, 162, 166, 171, 176, 188, 222, 226, 237, 244, 254, 259, 529, 581, 2036]);

/** Lane encoder-a (wave 33, all ported): `[u8]` (:402), `encode_def_path_table` (:556), `encode_def_path_hash_map` (:577). */
const ENCODER_A = new Set([402, 556, 577]);

/** The lane whose `// rustc:` marker a ported fn may carry. */
function ported_by(line: number): string | undefined {
  if (PORTED.has(line)) return "encode-contract";
  if (SPAN_HYGIENE.has(line)) return "encode-span-hygiene";
  if (ENCODER_A.has(line)) return "encoder-a";
  // lane encoder-d (wave 33): all of :2064-end
  if (line >= 2064) return "encoder-d";
  // lane encoder-c (wave 33, all ported): :1482-:2030 (`encode_def_ids` .. `encode_foreign_modules`)
  if (line >= 1482 && line < 2064) return "encoder-c";
  // lane encoder-b (wave 33) ported all of :651–:1481
  if (line >= 651 && line < 1482) return "encoder-b";
  return undefined;
}

/** The split of encoder.rs (plan-m5 wave 32/33; the module comment of encoder.ts). */
function owner(line: number): string {
  if (PORTED.has(line)) return "encode-contract";
  if (SPAN_HYGIENE.has(line)) return "encode-span-hygiene";
  if (line < 651) return "encoder-a";
  if (line < 1482) return "encoder-b";
  if (line < 2064) return "encoder-c";
  return "encoder-d";
}

test("every encoder.rs fn is ported or a stub of its owning lane, never both", () => {
  const fns = upstreamFns(ENCODER);
  expect(fns.length).toBe(95);
  const per_lane: Record<string, number> = {};
  for (const fn of fns) {
    const key = `${fn.line} ${fn.name}`;
    const ds = decls.filter((d) => d.path === ENCODER && d.line === fn.line && d.name === fn.name);
    expect(`${key}: ${ds.length}`).toBe(`${key}: 1`);
    const d = ds[0]!;
    const lane = d.kind === "rustc" ? ported_by(fn.line) : d.lane;
    expect(`${key}: ${lane}`).toBe(`${key}: ${owner(fn.line)}`);
    if (d.kind === "stub") {
      expect(`${key}: ${d.unported?.startsWith("rustc_metadata::rmeta::encoder::")} ${d.unported?.endsWith(`(lane ${d.lane})`)}`).toBe(`${key}: true true`);
    }
    per_lane[lane!] = (per_lane[lane!] ?? 0) + 1;
  }
  // a marker / stub names an upstream fn of encoder.rs
  for (const d of decls.filter((d) => d.path === ENCODER)) {
    expect(`${d.line} ${d.name}: ${fns.some((fn) => fn.line === d.line && fn.name === d.name)}`).toBe(`${d.line} ${d.name}: true`);
  }
  expect(per_lane).toEqual({
    "encode-contract": 11,
    "encoder-a": 3,
    "encode-span-hygiene": 15,
    "encoder-b": 15,
    "encoder-c": 16,
    "encoder-d": 35,
  });
});

test("the hand Encodable impls outside encoder.rs left for later lanes are stubs naming their lane", () => {
  const stubs = decls.filter((d) => d.kind === "stub" && d.path !== ENCODER && d.lane !== undefined && LANES.includes(d.lane));
  for (const d of stubs) {
    const key = `${d.path}:${d.line} ${d.name}`;
    const fns = upstreamFns(d.path);
    expect(`${key}: ${fns.some((fn) => fn.line === d.line && fn.name === d.name)}`).toBe(`${key}: true`);
    expect(`${key}: ${d.unported?.endsWith(`(lane ${d.lane})`) ?? d.unported}`).toBe(`${key}: true`);
  }
  expect(stubs.map((d) => `${d.path.replace(/^compiler\//, "")}:${d.line} ${d.name} (${d.lane})`).sort()).toEqual([
    // encoder-a's 2 (rustc_hir_id definitions.rs:118, rustc_metadata def_path_hash_map.rs:36) are ported (lane encoder-a)
    // encode-middle's 23 (rustc_middle ty/codec.rs, ty/, mir/) are ported (lane encode-middle)
  ]);
});

/** An `EncodeContext` over a `MemEncoder` (only `opaque`, `lazy_state` and `interpret_allocs` are read here). */
function ecx(): EncodeContext {
  const none = undefined as never;
  return new EncodeContext(
    MemEncoder.new() as unknown as FileEncoder,
    none,
    none,
    none,
    none,
    LazyState.NoNode,
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    none,
    new Map(),
    false,
    none,
    new Map(),
  );
}
const bytes = (e: EncodeContext): number[] => [...(e.opaque as unknown as MemEncoder).finish()];

test("EncodeContext declares every method of its impl blocks (Encoder, SpanEncoder, TyEncoder, EncodeContext)", () => {
  const proto = EncodeContext.prototype as unknown as Record<string, unknown>;
  const encoder = ["emit_usize", "emit_u128", "emit_u64", "emit_u32", "emit_u16", "emit_u8", "emit_isize", "emit_i128", "emit_i64", "emit_i32", "emit_i16", "emit_raw_bytes"];
  const provided = ["emit_i8", "emit_bool", "emit_char", "emit_str", "emit_byte_str"];
  for (const n of [...encoder, ...provided]) expect(`${n}: ${typeof proto[n]}`).toBe(`${n}: function`);
  // the methods of `impl SpanEncoder` (:150), `impl TyEncoder` (:408) and the two `impl EncodeContext` blocks (:471, :1460)
  const methods = upstreamFns(ENCODER).filter((fn) => (fn.line > 150 && fn.line < 250) || (fn.line > 408 && fn.line < 930) || (fn.line > 1460 && fn.line < 2420));
  expect(methods.length).toBe(60);
  for (const fn of methods) expect(`${fn.line} ${fn.name}: ${typeof proto[fn.name]}`).toBe(`${fn.line} ${fn.name}: function`);
  expect(EncodeContext_CLEAR_CROSS_CRATE).toBe(true);
});

test("stubs stop with their lane", () => {
  const e = ecx();
  const lane = (f: () => unknown): string => {
    try {
      f();
    } catch (err) {
      if (err instanceof Unported) return /\(lane ([^)]+)\)/.exec(err.message)?.[1] ?? err.message;
      throw err;
    }
    return "returned";
  };
  // encoder-a, -b, -c and -d (wave 33) have no stubs left
});

test("the Encoder impl forwards to opaque; the TyEncoder impl", () => {
  const e = ecx();
  e.emit_u8(7);
  e.emit_usize(300);
  e.emit_str("ab");
  e.emit_bool(true);
  encode_ExpnIndex(5 as ExpnIndex, e);
  expect(e.position()).toBe(9);
  expect(bytes(e)).toEqual([7, 0xac, 0x02, 2, 0x61, 0x62, 0xc1, 1, 5]);
  // `interpret_allocs.insert_full(alloc_id)`: the index of first insertion
  const f = ecx();
  for (const id of [40, 7, 40, 9, 7]) f.encode_alloc_id(id as AllocId);
  expect([...f.interpret_allocs].map(([id, i]) => `${id}:${i}`)).toEqual(["40:0", "7:1", "9:2"]);
  expect(bytes(f)).toEqual([0, 1, 0, 2, 1]);
  expect(f.type_shorthands()).toBe(f.type_shorthands_);
  expect(f.predicate_shorthands()).toBe(f.predicate_shorthands_);
});

test("lazy / lazy_array / emit_lazy_distance and the Lazy* writers (encoder.rs:121-137, :472-:527)", () => {
  const e = ecx();
  e.emit_u8(0xaa); // positions start at 1 (`NonZero`)
  const v = e.lazy(5, encode_usize);
  expect(v.position).toBe(1);
  const a = e.lazy_array([1, 2, 3], encode_u8);
  expect([a.position, a.num_elems]).toEqual([2, 3]);
  const empty = e.lazy_array([] as number[], encode_u8);
  expect([empty.position, empty.num_elems]).toEqual([5, 0]);
  expect(e.lazy_state).toBe(LazyState.NoNode);
  // a node holding them: the first lazy is the backwards distance from the node start, the rest forward from the previous
  const t = new LazyTable<number, number, unknown>(4, 2, 9);
  const node = e.lazy([v, a, empty, t] as const, (x, e) => {
    encode_LazyValue(x[0], e);
    encode_LazyArray(x[1], e);
    encode_LazyArray(x[2], e);
    encode_LazyTable(x[3], e);
  });
  expect(node.position).toBe(5);
  // v: 5 - 1 = 4; a: 3 elems, 2 - 1 = 1; empty: 0 elems, no position; t: width 2, len 9, 4 - 2 = 2
  expect(bytes(e)).toEqual([0xaa, 5, 1, 2, 3, 4, 3, 1, 0, 2, 9, 2]);
});

test("the lazy machinery's assertions", () => {
  const e = ecx();
  e.emit_u8(0);
  const v = e.lazy(1, encode_u8);
  expect(() => encode_LazyValue(v, e)).toThrow("emit_lazy_distance: outside of a metadata node");
  // `assert_eq!(self.lazy_state, LazyState::NoNode)`
  expect(() => e.lazy(1, (x, e) => void e.lazy(x, encode_u8))).toThrow("assertion `left == right` failed\n  left: NodeStart(2)\n right: NoNode");
  // lazies referenced out of encoding order
  const g = ecx();
  g.emit_u8(0);
  const p = g.lazy(1, encode_u8);
  const q = g.lazy(2, encode_u8);
  expect(() =>
    g.lazy(0, (_x, g) => {
      encode_LazyValue(q, g);
      encode_LazyValue(p, g);
    }),
  ).toThrow("make sure that the calls to `lazy*` are in the same order as the metadata fields");
});

/** `encode` then `decode` every value through a `MemEncoder` / `MemDecoder`. */
function round_trip<T>(values: readonly T[], encode: Encodable<T, MemEncoder>, decode: Decodable<T, MemDecoder>): T[] {
  const enc = MemEncoder.new();
  for (const v of values) encode(v, enc);
  const d = unwrap_result(MemDecoder.new(new Uint8Array([...enc.finish(), ...MAGIC_END_BYTES]), 0));
  return values.map(() => decode(d));
}

test("the generated / hand encoders mirror their decoders", () => {
  // the unit variants of a fieldless enum's companion (which may also hold methods)
  const all = <C extends object>(c: C) => Object.values(c).filter((v) => typeof v === "string") as Extract<C[keyof C], string>[];
  expect(round_trip(all(IntTy), encode_IntTy, decode_IntTy)).toEqual(all(IntTy));
  expect(round_trip(all(Mutability), encode_Mutability, decode_Mutability)).toEqual(all(Mutability));
  expect(round_trip(all(CrateType), encode_CrateType, decode_CrateType)).toEqual(all(CrateType));
  expect(round_trip(all(CtorKind), encode_CtorKind, decode_CtorKind)).toEqual(all(CtorKind));
  expect(round_trip(all(PanicStrategy), encode_PanicStrategy, decode_PanicStrategy)).toEqual(all(PanicStrategy));
  expect(round_trip(all(SymbolManglingVersion), encode_SymbolManglingVersion, decode_SymbolManglingVersion)).toEqual(all(SymbolManglingVersion));
  expect(round_trip(X86InlineAsmRegClass.ALL, X86InlineAsmRegClass.encode, X86InlineAsmRegClass.decode)).toEqual([...X86InlineAsmRegClass.ALL]);
  const tuples: TargetTuple[] = [
    { $: "TargetTuple", _0: "x86_64-unknown-linux-gnu" },
    { $: "TargetJson", path_for_rustdoc: "", tuple: "custom", contents: "{}" },
  ];
  expect(round_trip(tuples, encode_TargetTuple, decode_TargetTuple)).toEqual(tuples);
  const fp = Fingerprint.new(0x0123_4567_89ab_cdefn, 0xfedc_ba98_7654_3210n);
  expect(round_trip([fp], encode_Fingerprint, decode_Fingerprint)).toEqual([fp]);
  const svh = Svh.new(fp);
  expect(round_trip([svh], encode_Svh, decode_Svh)).toEqual([svh]);
});
