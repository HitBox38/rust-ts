// core::fmt Debug formatting. A derive(Debug) port is a function `(v, f) => string`
// built from these helpers; output must be byte-identical to rustc's `{:?}` / `{:#?}`.
import { in_table } from "./unicode/mod.ts";
import { DEBUG_ESCAPE_UNICODE } from "./unicode/tables.ts";

export interface Fmt {
  /** `{:#?}` */
  readonly alternate: boolean;
}

export const PLAIN: Fmt = { alternate: false };
export const PRETTY: Fmt = { alternate: true };

export type Debug<T> = (v: T, f: Fmt) => string;

/** PadAdapter: indent every line after the first by 4 spaces. */
function pad(s: string): string {
  return s.replaceAll("\n", "\n    ");
}

/** `f.debug_struct(name).field(..)...finish()`; field values are already formatted with `f`. */
export function debug_struct(f: Fmt, name: string, fields: [string, string][]): string {
  if (fields.length === 0) return name;
  if (f.alternate) {
    let s = name + " {\n";
    for (const [k, v] of fields) s += "    " + k + ": " + pad(v) + ",\n";
    return s + "}";
  }
  return name + " { " + fields.map(([k, v]) => k + ": " + v).join(", ") + " }";
}

/** `f.debug_tuple(name).field(..)...finish()` */
export function debug_tuple(f: Fmt, name: string, fields: string[]): string {
  if (fields.length === 0) return name;
  if (f.alternate) {
    let s = name + "(\n";
    for (const v of fields) s += "    " + pad(v) + ",\n";
    return s + ")";
  }
  // A 1-tuple with an empty name gets a trailing comma: `(x,)`.
  if (fields.length === 1 && name === "") return "(" + fields[0] + ",)";
  return name + "(" + fields.join(", ") + ")";
}

function debug_seq(f: Fmt, open: string, close: string, items: string[]): string {
  if (items.length === 0) return open + close;
  if (f.alternate) {
    let s = open + "\n";
    for (const v of items) s += "    " + pad(v) + ",\n";
    return s + close;
  }
  return open + items.join(", ") + close;
}

export function debug_list(f: Fmt, items: string[]): string {
  return debug_seq(f, "[", "]", items);
}

export function debug_set(f: Fmt, items: string[]): string {
  return debug_seq(f, "{", "}", items);
}

export function debug_map(f: Fmt, entries: [string, string][]): string {
  if (entries.length === 0) return "{}";
  if (f.alternate) {
    let s = "{\n";
    for (const [k, v] of entries) s += "    " + pad(k) + ": " + pad(v) + ",\n";
    return s + "}";
  }
  return "{" + entries.map(([k, v]) => k + ": " + v).join(", ") + "}";
}

export function debug_option<T>(v: T | undefined, f: Fmt, inner: Debug<T>): string {
  return v === undefined ? "None" : debug_tuple(f, "Some", [inner(v, f)]);
}

export function debug_vec<T>(v: readonly T[], f: Fmt, inner: Debug<T>): string {
  return debug_list(
    f,
    v.map((x) => inner(x, f)),
  );
}

export const debug_bool: Debug<boolean> = (v) => (v ? "true" : "false");
export const debug_int: Debug<number | bigint> = (v) => String(v);

/** `char::escape_debug_ext` */
function escape_char(c: number, single_quote: boolean, double_quote: boolean): string {
  switch (c) {
    case 0x00:
      return "\\0";
    case 0x09:
      return "\\t";
    case 0x0a:
      return "\\n";
    case 0x0d:
      return "\\r";
    case 0x5c:
      return "\\\\";
    case 0x22:
      return double_quote ? '\\"' : '"';
    case 0x27:
      return single_quote ? "\\'" : "'";
  }
  if (c >= 0x20 && c < 0x7f) return String.fromCharCode(c);
  if (in_table(DEBUG_ESCAPE_UNICODE, c)) return "\\u{" + c.toString(16) + "}";
  return String.fromCodePoint(c);
}

/** `<str as Debug>::fmt` for a JS string. */
export function debug_str(s: string): string {
  let out = '"';
  for (const ch of s) out += escape_char(ch.codePointAt(0)!, false, true);
  return out + '"';
}

/** `<char as Debug>::fmt` */
export function debug_char(c: number): string {
  return "'" + escape_char(c, true, false) + "'";
}
