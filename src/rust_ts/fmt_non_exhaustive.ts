// `f.debug_struct(name).field(..)...finish_non_exhaustive()` (library/core/src/fmt/builders.rs `DebugStruct::finish_non_exhaustive`),
// for derive_where's Debug of a struct with `#[derive_where(skip(Debug))]` fields (derive-where-1.6.1 src/trait_/debug.rs),
// which tools/codegen/types.ts emits for the rustc_type_ir types (set rustc_ty).
// PORT: belongs next to `debug_struct` in src/std/fmt.ts (lanes may not edit src/std; root moves it and repoints the
// `helpers` entry of tools/codegen/tyir.typemap.json).
import { debug_struct, type Fmt } from "../std/fmt.ts";

/** Field values are already formatted with `f`, as for `debug_struct`. */
export function debug_struct_non_exhaustive(f: Fmt, name: string, fields: [string, string][]): string {
  // `has_fields == false`: `name { .. }` in both modes
  if (fields.length === 0) return name + " { .. }";
  const s = debug_struct(f, name, fields);
  // pretty: the PadAdapter writes `..\n` indented, then `}`; plain: `, .. }`
  if (f.alternate) return s.slice(0, -1) + "    ..\n}";
  return s.slice(0, -2) + ", .. }";
}
