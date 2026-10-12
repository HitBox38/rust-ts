// `&str` for byte-indexed text. Rust strings are UTF-8 and every offset the compiler
// stores (token lengths, BytePos, ...) is a UTF-8 byte offset, so source text is kept
// as a view over UTF-8 bytes. Plain JS strings are fine where no byte offsets leak out.
import { Panic } from "./panic.ts";

const encoder = new TextEncoder();
// ignoreBOM: a Rust `&str` keeps a leading U+FEFF; TextDecoder strips it by default.
const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

/** UTF-8 length of a JS string (`str::len`). */
export function utf8_len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Decode the char starting at byte `i` (input must be valid UTF-8). */
export function decode_at(b: Uint8Array, i: number): number {
  const x = b[i]!;
  if (x < 0x80) return x;
  if (x < 0xe0) return ((x & 0x1f) << 6) | (b[i + 1]! & 0x3f);
  if (x < 0xf0) return ((x & 0x0f) << 12) | ((b[i + 1]! & 0x3f) << 6) | (b[i + 2]! & 0x3f);
  return ((x & 0x07) << 18) | ((b[i + 1]! & 0x3f) << 12) | ((b[i + 2]! & 0x3f) << 6) | (b[i + 3]! & 0x3f);
}

/** Width in bytes of the UTF-8 sequence starting with byte `x`. */
export function utf8_width(x: number): number {
  return x < 0x80 ? 1 : x < 0xe0 ? 2 : x < 0xf0 ? 3 : 4;
}

function is_char_boundary(b: Uint8Array, i: number): boolean {
  return i === b.length || (b[i]! & 0xc0) !== 0x80;
}

export class Str {
  constructor(
    readonly b: Uint8Array,
    readonly lo: number,
    readonly hi: number,
  ) {}

  static from(s: string): Str {
    const b = utf8(s);
    return new Str(b, 0, b.length);
  }

  static of_bytes(b: Uint8Array): Str {
    return new Str(b, 0, b.length);
  }

  len(): number {
    return this.hi - this.lo;
  }

  is_empty(): boolean {
    return this.hi === this.lo;
  }

  /** `as_bytes()[i]` */
  byte(i: number): number {
    return this.b[this.lo + i]!;
  }

  /** `&self[a..b]` */
  slice(a: number, b: number = this.len()): Str {
    if (a > b || b > this.len()) throw new Panic(`byte index ${b} is out of bounds`);
    if (!is_char_boundary(this.b, this.lo + a) || !is_char_boundary(this.b, this.lo + b)) {
      throw new Panic(`byte index is not a char boundary`);
    }
    return new Str(this.b, this.lo + a, this.lo + b);
  }

  starts_with(p: string): boolean {
    if (p.length > this.len()) return false;
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      if (c >= 0x80) return this.starts_with_bytes(utf8(p));
      if (this.b[this.lo + i] !== c) return false;
    }
    return true;
  }

  private starts_with_bytes(p: Uint8Array): boolean {
    if (p.length > this.len()) return false;
    for (let i = 0; i < p.length; i++) if (this.b[this.lo + i] !== p[i]) return false;
    return true;
  }

  /** Byte offset of the first occurrence of `p`. */
  find(p: string): number | undefined {
    const pat = utf8(p);
    if (pat.length === 0) return 0;
    const first = pat[0]!;
    const last = this.hi - pat.length;
    let i = this.lo;
    while (i <= last) {
      i = this.b.indexOf(first, i);
      if (i < 0 || i > last) return undefined;
      let k = 1;
      while (k < pat.length && this.b[i + k] === pat[k]) k++;
      if (k === pat.length) return i - this.lo;
      i++;
    }
    return undefined;
  }

  rfind(p: string): number | undefined {
    const pat = utf8(p);
    for (let i = this.hi - pat.length; i >= this.lo; i--) {
      let k = 0;
      while (k < pat.length && this.b[i + k] === pat[k]) k++;
      if (k === pat.length) return i - this.lo;
    }
    return undefined;
  }

  chars(): Chars {
    return new Chars(this.b, this.lo, this.hi);
  }

  /** `str::lines` (splits on `\n`, strips a trailing `\r`). */
  *lines(): Generator<Str> {
    let start = this.lo;
    while (start < this.hi) {
      let nl = this.b.indexOf(0x0a, start);
      if (nl < 0 || nl >= this.hi) nl = this.hi;
      let end = nl;
      if (end > start && this.b[end - 1] === 0x0d) end--;
      yield new Str(this.b, start, end);
      start = nl + 1;
    }
  }

  toString(): string {
    return decoder.decode(this.b.subarray(this.lo, this.hi));
  }
}

/** `std::str::Chars` */
export class Chars {
  constructor(
    readonly b: Uint8Array,
    public pos: number,
    readonly end: number,
  ) {}

  next(): number | undefined {
    if (this.pos >= this.end) return undefined;
    const c = decode_at(this.b, this.pos);
    this.pos += utf8_width(this.b[this.pos]!);
    return c;
  }

  /** Peek `n` chars ahead without consuming (`self.clone().nth(n)`). */
  peek(n: number): number | undefined {
    let p = this.pos;
    for (let i = 0; i < n; i++) {
      if (p >= this.end) return undefined;
      p += utf8_width(this.b[p]!);
    }
    return p < this.end ? decode_at(this.b, p) : undefined;
  }

  as_str(): Str {
    return new Str(this.b, this.pos, this.end);
  }

  /** Remaining length in bytes (`as_str().len()`), without allocating. */
  rest_len(): number {
    return this.end - this.pos;
  }

  clone(): Chars {
    return new Chars(this.b, this.pos, this.end);
  }
}
