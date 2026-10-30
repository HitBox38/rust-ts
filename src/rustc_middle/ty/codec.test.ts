// Lane encode-middle (plan-m5 wave 32): the encode half of ty/codec.rs and the rustc_middle hand `Encodable` impls,
// round-tripped through the port's own decoders: `Ty` / `Predicate` with shorthands, the interned lists, `GenericArg`,
// `Const` / `ValTree` / `ScalarInt`, `Allocation` (`AllocFlags`, `ProvenanceMap`, `InitMask`), `ClearCrossCrate`.
//
// The encoder is rustc_metadata's `EncodeContext` over a `MemEncoder` (only `opaque` and the shorthand maps are read);
// the decoder a minimal `TyDecoder` over a `MemDecoder` (the rmeta `MetadataDecodeContext` needs a crate). The types
// carry no `DefId` / `Span` (their `SpanEncoder` methods belong to lane encoder-a). `FlagComputation` is stubbed as in
// interning.test.ts.
import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import "../lib.ts";
import { Align, Size } from "../../rustc_abi/lib.ts";
import { EncodeContext } from "../../rustc_metadata/rmeta/encoder.ts";
import { LazyState } from "../../rustc_metadata/rmeta/mod.ts";
import { MAGIC_END_BYTES, MemDecoder, MemEncoder, type FileEncoder } from "../../rustc_serialize/opaque.ts";
import { type Decoder, Decoder_provided, decode_u32, decode_unit, encode_u32, encode_unit } from "../../rustc_serialize/serialize.ts";
import { type Binder as BinderT, type PredicateKind, type RegionVid } from "../../rustc_type_ir/decls.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { FlagComputation } from "../../rustc_type_ir/flags.ts";
import { unwrap_result } from "../../std/result.ts";
import { Allocation, decode_Allocation, encode_Allocation } from "../mir/interpret/allocation.ts";
import { decode_InitMaskMaterialized, encode_InitMaskMaterialized, InitMaskMaterialized } from "../mir/interpret/allocation/init_mask.ts";
import { ClearCrossCrate, encode_ClearCrossCrate } from "../mir/mod.ts";
import type { AllocId } from "../mir/interpret/mod.ts";
import {
  decode_GenericArgs,
  decode_Predicate,
  decode_Ty,
  encode_GenericArgs,
  encode_Predicate,
  encode_Ty,
  forward_all_decoder_methods_to,
  SHORTHAND_OFFSET,
  type TyDecoder,
  TyDecoder_provided,
} from "./codec.ts";
import { decode_ScalarInt, encode_ScalarInt, ScalarInt } from "./consts/int.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { GenericArg } from "./generic_args.ts";
import { Ty } from "./mod.ts";

const spies: { mockRestore(): void }[] = [];
beforeAll(() => {
  spies.push(spyOn(FlagComputation, "for_kind").mockImplementation(() => FlagComputation.new()));
  spies.push(spyOn(FlagComputation, "for_const_kind").mockImplementation(() => FlagComputation.new()));
  spies.push(spyOn(FlagComputation, "for_predicate").mockImplementation(() => FlagComputation.new()));
});
afterAll(() => {
  for (const s of spies) s.mockRestore();
});

/** A `TyCtxt` over a fresh `CtxtInterners` (interning.test.ts). */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

/** An `EncodeContext` over a `MemEncoder` (encoder_contract.test.ts). */
function ecx(): EncodeContext {
  const none = undefined as never;
  return new EncodeContext(MemEncoder.new() as unknown as FileEncoder, none, none, none, none, LazyState.NoNode, new Map(), new Map(), new Map(), new Map(), none, new Map(), false, none, new Map());
}
const bytes = (e: EncodeContext): Uint8Array => (e.opaque as unknown as MemEncoder).finish();

/** A minimal `TyDecoder`: shorthands cached by position, `with_position` on a split `MemDecoder`. */
class TestTyDecoder {
  readonly ty_cache = new Map<number, Ty>();
  constructor(
    public opaque: MemDecoder,
    readonly tcx: TyCtxt,
  ) {}
  interner(): TyCtxt {
    return this.tcx;
  }
  cached_ty_for_shorthand(shorthand: number, or_insert_with: (d: TyDecoder) => Ty): Ty {
    const t = this.ty_cache.get(shorthand);
    if (t !== undefined) return t;
    const ty = or_insert_with(this as unknown as TyDecoder);
    this.ty_cache.set(shorthand, ty);
    return ty;
  }
  with_position<R>(pos: number, f: (d: TyDecoder) => R): R {
    const old = this.opaque;
    this.opaque = old.split_at(pos);
    try {
      return f(this as unknown as TyDecoder);
    } finally {
      this.opaque = old;
    }
  }
  positioned_at_shorthand(): boolean {
    return TyDecoder_provided.positioned_at_shorthand(this as unknown as TyDecoder);
  }
  read_bool(): boolean {
    return Decoder_provided.read_bool(this as unknown as Decoder);
  }
  decode_alloc_id(): AllocId {
    throw new Error("no allocs");
  }
}
forward_all_decoder_methods_to(TestTyDecoder.prototype, (self) => self.opaque);

function decoder(tcx: TyCtxt, b: Uint8Array): TyDecoder {
  return new TestTyDecoder(unwrap_result(MemDecoder.new(new Uint8Array([...b, ...MAGIC_END_BYTES]), 0)), tcx) as unknown as TyDecoder;
}

test("Ty: full encoding, then shorthands for repeats (codec.rs:87 / :126; decoded back to the same interned types)", () => {
  const tcx = mk_tcx();
  const i32 = tcx.types.i32;
  const r = Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, i32);
  const tup = Ty.new_tup(tcx, [i32, r, i32]);
  const ct = Const.new_value(tcx, tcx.intern_valtree({ $: "Leaf", _0: ScalarInt.TRUE } as never), tcx.types.bool);
  const arr = tcx.mk_ty_from_kind({ $: "Array", _0: tup, _1: ct } as never);
  const slice = Ty.new_slice(tcx, tup);
  const tys = [i32, tup, arr, slice, tup, r, tcx.types.never];

  const e = ecx();
  const starts: number[] = [];
  for (const t of tys) {
    starts.push(e.position());
    encode_Ty(t, e);
  }
  const b = bytes(e);
  // `i32` (`Int(I32)`: 2 bytes, 14 bits) at 0 gets the shorthand 0x80 (< 2^14); the tuple is cached at its start, so its
  // repeat (the 5th) is `start + SHORTHAND_OFFSET` as a LEB128 usize; `Never` (one byte, 7 bits) never fits
  expect(e.type_shorthands_.get(i32)).toBe(SHORTHAND_OFFSET);
  const sh = starts[1]! + SHORTHAND_OFFSET;
  expect(e.type_shorthands_.get(tup)).toBe(sh);
  expect([...b.slice(starts[4]!, starts[5]!)]).toEqual([(sh & 0x7f) | 0x80, sh >> 7]);
  expect(e.type_shorthands_.get(tcx.types.never)).toBeUndefined();

  const d = decoder(tcx, b);
  expect(tys.map(() => decode_Ty(d))).toEqual(tys);
  const d2 = decoder(tcx, b);
  for (const t of tys) expect(decode_Ty(d2)).toBe(t);
  expect(d2.position()).toBe(b.length);
});

test("Predicate: bound vars, then the kind or its shorthand (codec.rs:132)", () => {
  const tcx = mk_tcx();
  const i32 = tcx.types.i32;
  const tup = Ty.new_tup(tcx, [i32, Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, i32)]);
  const kind: PredicateKind = { $: "Coerce", _0: { a: tup, b: i32 } } as never;
  const no_vars = tcx.mk_bound_variable_kinds_from_iter([]);
  const p = tcx.mk_predicate(Binder.bind_with_vars(kind, no_vars) as BinderT<PredicateKind>);
  const q = tcx.mk_predicate(Binder.bind_with_vars({ $: "Ambiguous" } as PredicateKind, no_vars) as BinderT<PredicateKind>);
  const e = ecx();
  for (const x of [p, q, p, q]) encode_Predicate(x, e);
  // `Coerce` is long enough to be cached; `Ambiguous` (one byte) is not
  expect(e.predicate_shorthands_.size).toBe(1);
  const d = decoder(tcx, bytes(e));
  for (const x of [p, q, p, q]) expect(decode_Predicate(d)).toBe(x);
});

test("GenericArgs: the interned list as a slice of packed args (list.rs:199, generic_args.rs:366)", () => {
  const tcx = mk_tcx();
  const re = tcx.intern_region({ $: "ReVar", _0: 3 as RegionVid } as never);
  const args = tcx.mk_args([GenericArg.from_Ty(tcx.types.u8), GenericArg.from_Region(re), GenericArg.from_Ty(tcx.types.u8)]);
  const e = ecx();
  encode_GenericArgs(args, e);
  const b = bytes(e);
  expect(b[0]).toBe(3); // the length
  expect(decode_GenericArgs(decoder(tcx, b))).toBe(args);
});

test("ScalarInt: the size, then that many little-endian bytes (int.rs:172)", () => {
  const vals = [ScalarInt.TRUE, ScalarInt.FALSE, new ScalarInt(0x1234n, 2), new ScalarInt((1n << 128n) - 2n, 16)];
  const enc = MemEncoder.new();
  for (const v of vals) encode_ScalarInt(v, enc);
  const b = enc.finish();
  expect([...b.slice(0, 7)]).toEqual([1, 1, 1, 0, 2, 0x34, 0x12]);
  const d = unwrap_result(MemDecoder.new(new Uint8Array([...b, ...MAGIC_END_BYTES]), 0));
  expect(vals.map(() => decode_ScalarInt(d))).toEqual(vals);
});

test("Allocation: AllocFlags, the bytes unless all zero, provenance, init mask, extra (allocation.rs:129 / :194)", () => {
  const some = Allocation.from_bytes<number>(new Uint8Array([1, 0, 255, 7]), Align.EIGHT, "Mut", null);
  const zero = Allocation.from_bytes<number>(new Uint8Array(5), unwrap_result(Align.from_bytes(1)), "Not", null);
  const enc = MemEncoder.new();
  for (const a of [some, zero]) encode_Allocation(a, enc, encode_u32, encode_unit);
  const b = enc.finish();
  // flags: align 2^3, Mut (bit 6), not all zero; len 4; the bytes; no provenance (an empty `SortedMap`)
  expect([...b.slice(0, 7)]).toEqual([3 | 0x40, 4, 1, 0, 255, 7, 0]);
  const d = unwrap_result(MemDecoder.new(new Uint8Array([...b, ...MAGIC_END_BYTES]), 0));
  const back = [decode_Allocation(d, decode_u32, decode_unit), decode_Allocation(d, decode_u32, decode_unit)];
  expect([...back[0]!.bytes]).toEqual([1, 0, 255, 7]);
  expect([back[0]!.align, back[0]!.mutability]).toEqual([Align.EIGHT, "Mut"]);
  expect([...back[1]!.bytes]).toEqual([0, 0, 0, 0, 0]);
  expect(back[1]!.mutability).toBe("Not");
  expect(d.position()).toBe(b.length);
  // the zero allocation's flags byte: align 2^0, Not, all zero (bit 7)
  const z = MemEncoder.new();
  encode_Allocation(zero, z, encode_u32, encode_unit);
  expect([...z.finish().slice(0, 2)]).toEqual([0x80, 5]);
});

test("InitMaskMaterialized: the block count, then each u64 block's little-endian bytes (init_mask.rs:198)", () => {
  const m = InitMaskMaterialized.new(Size.from_bytes(100), true);
  const enc = MemEncoder.new();
  encode_InitMaskMaterialized(m, enc);
  const b = enc.finish();
  expect(b.length).toBe(1 + 2 * 8);
  expect(b[0]).toBe(2);
  const d = unwrap_result(MemDecoder.new(new Uint8Array([...b, ...MAGIC_END_BYTES]), 0));
  expect(decode_InitMaskMaterialized(d)).toEqual(m);
});

test("ClearCrossCrate: nothing for crate metadata (`EncodeContext::CLEAR_CROSS_CRATE`, mir/mod.rs:806)", () => {
  const e = ecx();
  encode_ClearCrossCrate({ $: "Set", _0: 5 } as ClearCrossCrate<number>, e, encode_u32);
  encode_ClearCrossCrate(ClearCrossCrate.Clear as ClearCrossCrate<number>, e, encode_u32);
  expect(e.position()).toBe(0);
});
