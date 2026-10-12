// Port of unic-langid-impl 0.9.6 `src/parser/mod.rs`.
import { Err, Ok, type Result } from "../../../std/result.ts";
import { LanguageIdentifier } from "../lib.ts";
import { Language } from "../subtags/language.ts";
import { Region } from "../subtags/region.ts";
import { Script } from "../subtags/script.ts";
import { Variant } from "../subtags/variant.ts";
import type { ParserError } from "./errors.ts";

export { ParserError } from "./errors.ts";

// PORT: `std::iter::Peekable<impl Iterator<Item = &[u8]>>` → this minimal interface; `peekable`
// builds one over an array. (A shared `src/std` iterator module would own this; see handoff.)
export interface Peekable<T> {
  next(): T | undefined;
  peek(): T | undefined;
}

export function peekable<T>(items: readonly T[]): Peekable<T> {
  let i = 0;
  return {
    next: () => (i < items.length ? items[i++] : undefined),
    peek: () => (i < items.length ? items[i] : undefined),
  };
}

// crate: unic-langid-impl-0.9.6/src/parser/mod.rs:9 parse_language_identifier_from_iter
export function parse_language_identifier_from_iter(
  iter: Peekable<Uint8Array>,
  allow_extension: boolean,
): Result<LanguageIdentifier, ParserError> {
  let language: Language;
  const first = iter.next();
  if (first !== undefined) {
    const r = Language.from_bytes(first);
    if (r.$ === "Err") return r;
    language = r._0;
  } else {
    language = Language.default();
  }

  let script: Script | undefined = undefined;
  let region: Region | undefined = undefined;
  const variants: Variant[] = [];

  let position = 1;

  let subtag: Uint8Array | undefined;
  while ((subtag = iter.peek()) !== undefined) {
    if (position === 1) {
      let s, v;
      if ((s = Script.from_bytes(subtag)).$ === "Ok") {
        script = s._0;
        position = 2;
      } else if ((s = Region.from_bytes(subtag)).$ === "Ok") {
        region = s._0;
        position = 3;
      } else if ((v = Variant.from_bytes(subtag)).$ === "Ok") {
        variants.push(v._0);
        position = 3;
      } else {
        break;
      }
    } else if (position === 2) {
      let s, v;
      if ((s = Region.from_bytes(subtag)).$ === "Ok") {
        region = s._0;
        position = 3;
      } else if ((v = Variant.from_bytes(subtag)).$ === "Ok") {
        variants.push(v._0);
        position = 3;
      } else {
        break;
      }
    } else {
      // Variants
      let v;
      if ((v = Variant.from_bytes(subtag)).$ === "Ok") {
        variants.push(v._0);
      } else {
        break;
      }
    }
    iter.next();
  }

  if (!allow_extension && iter.peek() !== undefined) {
    return Err("InvalidSubtag");
  }

  let variants_: Variant[] | undefined;
  if (variants.length === 0) {
    variants_ = undefined;
  } else {
    sort_unstable_dedup(variants);
    variants_ = variants;
  }

  return Ok(new LanguageIdentifier(language, script, region, variants_));
}

// crate: unic-langid-impl-0.9.6/src/parser/mod.rs:80 parse_language_identifier
export function parse_language_identifier(t: Uint8Array): Result<LanguageIdentifier, ParserError> {
  const iter = peekable(split_bytes(t, (c) => c === 0x2d /* b'-' */ || c === 0x5f /* b'_' */));
  return parse_language_identifier_from_iter(iter, false);
}

/** `<[u8]>::split(pred)`: every separator ends a piece; empty pieces are kept (also at the ends). */
function split_bytes(t: Uint8Array, pred: (c: number) => boolean): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (pred(t[i]!)) {
      out.push(t.subarray(start, i));
      start = i + 1;
    }
  }
  out.push(t.subarray(start));
  return out;
}

/** `v.sort_unstable(); v.dedup();` over `Variant` (total order; equal elements are identical). */
export function sort_unstable_dedup(v: Variant[]): void {
  v.sort((a, b) => a.cmp(b));
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w === 0 || !v[r]!.eq(v[w - 1]!)) v[w++] = v[r]!;
  }
  v.length = w;
}
