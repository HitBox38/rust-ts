// Port of compiler/rustc_errors/src/dedup_hash.rs.
//
// PORT: `StableHasher` (SipHasher128) and the `#[derive(Encodable)]` impls are not ported. The
// dedup hash is only ever compared for equality (`FxHashSet<Hash128>` in `DiagCtxtInner`), so the
// encoder records the same traversal as a token sequence and `finish()` hashes it to 128 bits:
// equal encodings get the same `Hash128`, different ones (up to 128-bit collisions, as upstream)
// different values. The `encode_*` helpers below follow the field order of the
// upstream `derive(Encodable)`s (enums: variant index, then fields; `Vec`/maps: length, then items;
// `Option`: 0 / 1 + value) and are used only for this hash.
import { createHash } from "node:crypto";
import type { RustcVersion } from "../rustc_ast/attr/version.ts";
import type { DiagArgMap, DiagArgValue, DiagMessage, MultiSpan } from "../rustc_error_messages/lib.ts";
import type { Hash128 } from "../rustc_hashes/lib.ts";
import { Span } from "../rustc_span/lib.ts";

/// Hasher used to determine if two diagnostics are the same and should be deduplicated. Used by
/// `DiagCtxtInner::emitted_diagnostics`. It's a stable hash with one special behaviour: parents of
/// spans within the diagnostics are ignored so that incremental and non-incremental compilation
/// get the same behaviour.
///
/// Although this has nothing to do with encoding data to/from file, it is implemented on top of
/// `Encoder`/`SpanEncoder` because they provide traversals of all the relevant types used within
/// diagnostics. There is no corresponding decoder.
export class DedupHashEncoder {
  constructor(public _0: DedupHasher) {}

  // encoder_methods! { emit_usize(usize); ... emit_raw_bytes(&[u8]); }: `value.hash(&mut self.0)`
  // PORT: only the methods something hashed here reaches are ported. Left out because no field of
  // `DiagInner` encodes through them: `emit_u128`, `emit_u64`, `emit_isize`, `emit_i128`,
  // `emit_i64`, `emit_i16`, `emit_raw_bytes`, and the `SpanEncoder` methods `encode_symbol`,
  // `encode_byte_symbol`, `encode_expn_id`, `encode_syntax_context`, `encode_crate_num`,
  // `encode_def_index`, `encode_def_id`. `emit_bool`/`emit_str` stand for the `Encoder` defaults.
  emit_usize(value: number): void {
    this._0.write(value);
  }
  emit_u32(value: number): void {
    this._0.write(value);
  }
  emit_u16(value: number): void {
    this._0.write(value);
  }
  emit_u8(value: number): void {
    this._0.write(value);
  }
  emit_i32(value: number): void {
    this._0.write(value);
  }
  emit_bool(value: boolean): void {
    this._0.write(value ? 1 : 0);
  }
  emit_str(value: string): void {
    this._0.write_str(value);
  }

  // rustc: compiler/rustc_errors/src/dedup_hash.rs:49 encode_span
  encode_span(span: Span): void {
    // The raison d'être of `DedupHashEncoder` is to ignore `parent` here.
    // PORT: spans are interned by their full `SpanData`, so the handle identifies the data.
    this._0.write(Span.with_parent(span, undefined));
  }
}

/** PORT: stand-in for `StableHasher` used by `DedupHashEncoder` (see the top of this file). */
export class DedupHasher {
  private readonly tokens: (number | string)[] = [];

  static new(): DedupHasher {
    return new DedupHasher();
  }

  write(n: number): void {
    this.tokens.push(n);
  }

  write_str(s: string): void {
    this.tokens.push(s);
  }

  // PORT: the first 128 bits of SHA-256 over the recorded token sequence, not SipHasher128: the
  // values differ from upstream's, but only their equality is observable (`emitted_diagnostics`),
  // and like upstream no table of past encodings is kept (collisions as unlikely as upstream's).
  finish(): Hash128 {
    const digest = createHash("sha256").update(JSON.stringify(this.tokens)).digest("hex");
    return BigInt("0x" + digest.slice(0, 32)) as Hash128;
  }
}

// ---- `derive(Encodable)` traversals used by `dedup_hash` (PORT, see top) ----

export function encode_DiagMessage(e: DedupHashEncoder, m: DiagMessage): void {
  e.emit_usize(m.$ === "Str" ? 0 : 1);
  e.emit_str(m._0);
}

export function encode_MultiSpan(e: DedupHashEncoder, ms: MultiSpan): void {
  e.emit_usize(ms.primary_spans.length);
  for (const sp of ms.primary_spans) e.encode_span(sp);
  e.emit_usize(ms.span_labels.length);
  for (const [sp, m] of ms.span_labels) {
    e.encode_span(sp);
    encode_DiagMessage(e, m);
  }
  e.emit_usize(ms.span_context.length);
  for (const sp of ms.span_context) e.encode_span(sp);
}

export function encode_DiagArgValue(e: DedupHashEncoder, v: DiagArgValue): void {
  switch (v.$) {
    case "Str":
      e.emit_usize(0);
      e.emit_str(v._0);
      return;
    case "Number":
      e.emit_usize(1);
      e.emit_i32(v._0);
      return;
    case "StrListSepByAnd":
      e.emit_usize(2);
      e.emit_usize(v._0.length);
      for (const s of v._0) e.emit_str(s);
      return;
  }
}

export function encode_DiagArgMap(e: DedupHashEncoder, args: DiagArgMap): void {
  e.emit_usize(args.size);
  for (const [k, v] of args) {
    e.emit_str(k);
    encode_DiagArgValue(e, v);
  }
}

export function encode_option<T>(e: DedupHashEncoder, v: T | undefined, f: (e: DedupHashEncoder, v: T) => void): void {
  if (v === undefined) {
    e.emit_usize(0);
  } else {
    e.emit_usize(1);
    f(e, v);
  }
}

export function encode_RustcVersion(e: DedupHashEncoder, v: RustcVersion): void {
  e.emit_u16(v.major);
  e.emit_u16(v.minor);
  e.emit_u16(v.patch);
}
