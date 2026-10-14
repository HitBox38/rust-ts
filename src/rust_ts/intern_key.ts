// The canonical key of a value for hash-consing and for struct-keyed maps (docs/plan-m3.md D2, D5).
//
// Upstream interns `TyKind`, `RegionKind`, `ConstKind`, `Binder<PredicateKind>`, slices of handles, ...
// in hash sets that compare by the *value's* derived `Hash` + `PartialEq` (rustc_middle ty/context.rs
// `InternedInSet`). Inside such a value every interned child (`Ty`, `Region`, `Const`, `&List<T>`,
// `AdtDef`, ...) compares by pointer (rustc_data_structures `Interned`), every other field by value.
//
// PORT: `intern_key(v)` is that equality as a string: two values get the same key exactly when the Rust
// values are `==`, given the PORTING §5 representation:
// - an interned object (anything carrying `INTERNED`, see rustc_data_structures/intern.ts) is `#<id>`;
// - numbers (`u8..u64` that fit, branded handles: `Symbol`, `Span`, `LocalDefId`, newtype indices),
//   bigints (`u128`), strings (fieldless enums, `String`s), booleans, `null` (`()`) by value;
// - arrays (`Vec`, slices, tuples) element-wise, in order;
// - objects (data enums `{ $, _0, .. }`, structs, small classes such as `DefId` / `HirId`) by their own
//   enumerable fields, sorted by name, skipping `undefined` (`None`, so a missing optional field and an
//   explicit `undefined` agree).
// It is generic, not generated: tools/codegen may later emit per-type `key_<T>` functions (D5); they must
// agree with this one. `Map`/`Set`/functions inside a key are a bug (no Rust intern key holds them).
import { panic } from "../std/panic.ts";
import { INTERNED } from "../rustc_data_structures/intern.ts";

function push_key(v: unknown, out: string[]): void {
  switch (typeof v) {
    case "number":
      out.push(Object.is(v, -0) ? "-0" : String(v));
      return;
    case "string":
      out.push(JSON.stringify(v));
      return;
    case "boolean":
      out.push(v ? "t" : "f");
      return;
    case "bigint":
      out.push(`${v}n`);
      return;
    case "undefined":
      out.push("~");
      return;
    case "object": {
      if (v === null) {
        out.push("()");
        return;
      }
      const o = v as { readonly [INTERNED]?: true; readonly id?: number };
      if (o[INTERNED] === true) {
        out.push(`#${o.id}`);
        return;
      }
      if (Array.isArray(v)) {
        out.push("[");
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out.push(",");
          push_key(v[i], out);
        }
        out.push("]");
        return;
      }
      if (v instanceof Map || v instanceof Set) panic("intern_key: a Map/Set inside an intern key");
      const keys = Object.keys(v).sort();
      out.push("{");
      let first = true;
      for (const k of keys) {
        const f = (v as Record<string, unknown>)[k];
        if (f === undefined) continue;
        if (!first) out.push(",");
        first = false;
        out.push(k, ":");
        push_key(f, out);
      }
      out.push("}");
      return;
    }
    default:
      panic(`intern_key: a ${typeof v} inside an intern key`);
  }
}

/** The canonical key of `v`: equal exactly when the Rust values are `==` (module comment). */
export function intern_key(v: unknown): string {
  const out: string[] = [];
  push_key(v, out);
  return out.join("");
}
