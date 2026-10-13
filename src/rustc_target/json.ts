// compiler/rustc_target/src/json.rs
//
// PORT: `serde_json::Value` (`Json`) is a JS value: `null`, `boolean`, `number` (integers only here),
// `string`, `Json[]`, or a `JsonObject` (`serde_json::Map`, a `BTreeMap<String, Value>` without the
// `preserve_order` feature: keys iterate sorted). `ToJson` impls are per-type `to_json` functions; the
// blanket impls (`Option`, slices, `BTreeMap`) take the element's `to_json`. serde_json itself is not
// vendored: `to_string_pretty` below reproduces its `PrettyFormatter` output for these values.
import type { Endian } from "../rustc_abi/lib.ts";
import { Endian as EndianImpl } from "../rustc_abi/lib.ts";
import { type CanonAbi, display_CanonAbi } from "../rustc_abi/lib.ts";
import { unported } from "../std/panic.ts";
import type { TargetMetadata } from "./spec/mod.ts";

export type Json = null | boolean | number | string | readonly Json[] | JsonObject;
/** `serde_json::Map<String, Value>` (sorted by key when serialized, like the `BTreeMap` it is). */
export class JsonObject {
  readonly map = new Map<string, Json>();
  insert(key: string, value: Json): void {
    this.map.set(key, value);
  }
}

/** `pub trait ToJson` (PORT: implemented as one `<Type>_to_json` function per impl). */
export interface ToJson {
  // rustc: compiler/rustc_target/src/json.rs:10 to_json
  to_json(): Json;
}

// impl ToJson for Json
// rustc: compiler/rustc_target/src/json.rs:14 to_json
export function json_to_json(self: Json): Json {
  return self;
}

// to_json_impl_num! { isize, i8, i16, i32, i64, usize, u8, u16, u32, u64 }
// rustc: compiler/rustc_target/src/json.rs:22 to_json
export function num_to_json(self: number): Json {
  return self;
}

// impl ToJson for bool
// rustc: compiler/rustc_target/src/json.rs:32 to_json
export function bool_to_json(self: boolean): Json {
  return self;
}

// impl ToJson for str
// rustc: compiler/rustc_target/src/json.rs:38 to_json
export function str_to_json(self: string): Json {
  return self;
}

// impl ToJson for String
// rustc: compiler/rustc_target/src/json.rs:44 to_json
export const string_to_json = str_to_json;

// impl<'a> ToJson for Cow<'a, str>
// rustc: compiler/rustc_target/src/json.rs:50 to_json
export const cow_str_to_json = str_to_json;

// impl<A: ToJson> ToJson for [A]
// rustc: compiler/rustc_target/src/json.rs:56 to_json
export function slice_to_json<A>(self: readonly A[], elt_to_json: (a: A) => Json): Json {
  return self.map((elt) => elt_to_json(elt));
}

// impl<A: ToJson> ToJson for Vec<A>
// rustc: compiler/rustc_target/src/json.rs:62 to_json
export const vec_to_json = slice_to_json;

// impl<'a, A: ToJson> ToJson for Cow<'a, [A]>
// rustc: compiler/rustc_target/src/json.rs:71 to_json
export const cow_slice_to_json = slice_to_json;

// impl<T: ToString, A: ToJson> ToJson for BTreeMap<T, A>
// PORT: the map is given as its entries in key order (`BTreeMap` iteration order).
// rustc: compiler/rustc_target/src/json.rs:77 to_json
export function btree_map_to_json<T, A>(self: Iterable<readonly [T, A]>, key_to_string: (k: T) => string, value_to_json: (a: A) => Json): Json {
  const d = new JsonObject();
  for (const [key, value] of self) {
    d.insert(key_to_string(key), value_to_json(value));
  }
  return d;
}

// impl<A: ToJson> ToJson for Option<A>
// rustc: compiler/rustc_target/src/json.rs:87 to_json
export function option_to_json<A>(self: A | undefined, value_to_json: (a: A) => Json): Json {
  if (self === undefined) {
    return null;
  } else {
    return value_to_json(self);
  }
}

// impl ToJson for TargetMetadata
// rustc: compiler/rustc_target/src/json.rs:96 to_json
export function TargetMetadata_to_json(self: TargetMetadata): Json {
  // `json!({ .. })`
  const d = new JsonObject();
  d.insert("description", option_to_json(self.description, str_to_json));
  d.insert("tier", option_to_json(self.tier, num_to_json));
  d.insert("host_tools", option_to_json(self.host_tools, bool_to_json));
  d.insert("std", option_to_json(self.std, bool_to_json));
  return d;
}

// impl ToJson for rustc_abi::Endian
// rustc: compiler/rustc_target/src/json.rs:107 to_json
export function Endian_to_json(self: Endian): Json {
  return str_to_json(EndianImpl.as_str(self));
}

// impl ToJson for rustc_abi::CanonAbi
// rustc: compiler/rustc_target/src/json.rs:113 to_json
export function CanonAbi_to_json(self: CanonAbi): Json {
  return str_to_json(display_CanonAbi(self));
}

// macro_rules! serde_deserialize_from_str
// PORT: not ported (no marker): deserialization is only used by `Target::from_json` (target JSON files).
export function serde_deserialize_from_str(_ty: string): never {
  return unported("rustc_target::json::serde_deserialize_from_str (target JSON)");
}

/**
 * `serde_json::to_string_pretty(&value)`: `PrettyFormatter` with a two-space indent; objects in key
 * order; empty arrays/objects as `[]`/`{}`. PORT: serde_json is not vendored; strings are escaped
 * like serde_json's `format_escaped_str` (`"`/`\\`, `\b\t\n\f\r`, other C0 controls as `\u00xx`),
 * which is what `JSON.stringify` does for well-formed strings.
 */
export function to_string_pretty(value: Json): string {
  const out: string[] = [];
  const write = (v: Json, indent: string): void => {
    if (v === null) {
      out.push("null");
    } else if (typeof v === "boolean") {
      out.push(v ? "true" : "false");
    } else if (typeof v === "number") {
      if (!Number.isSafeInteger(v)) unported(`serde_json number formatting (${v})`);
      out.push(String(v));
    } else if (typeof v === "string") {
      out.push(JSON.stringify(v));
    } else if (v instanceof JsonObject) {
      const keys = [...v.map.keys()].sort(byte_order);
      if (keys.length === 0) {
        out.push("{}");
        return;
      }
      const inner = indent + "  ";
      out.push("{\n");
      keys.forEach((k, i) => {
        out.push(inner, JSON.stringify(k), ": ");
        write(v.map.get(k)!, inner);
        out.push(i + 1 < keys.length ? ",\n" : "\n");
      });
      out.push(indent, "}");
    } else {
      const arr = v as readonly Json[];
      if (arr.length === 0) {
        out.push("[]");
        return;
      }
      const inner = indent + "  ";
      out.push("[\n");
      arr.forEach((e, i) => {
        out.push(inner);
        write(e, inner);
        out.push(i + 1 < arr.length ? ",\n" : "\n");
      });
      out.push(indent, "]");
    }
  };
  write(value, "");
  return out.join("");
}

/** `String`'s `Ord` (byte-wise UTF-8 = code point order). */
function byte_order(a: string, b: string): number {
  const x = [...a].map((c) => c.codePointAt(0)!);
  const y = [...b].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}
