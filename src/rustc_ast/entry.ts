// Port of compiler/rustc_ast/src/entry.rs
// Types and derived Debug impls are generated into entry.gen.ts (tools/codegen/types.ts).
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import { EntryPointType } from "./entry.gen.ts";

export * from "./entry.gen.ts";

// rustc: compiler/rustc_ast/src/entry.rs:30 entry_point_type
export function entry_point_type(has_rustc_main: boolean, at_root: boolean, name: Symbol | undefined): EntryPointType {
  if (has_rustc_main) {
    return EntryPointType.RustcMainAttr;
  } else if (name !== undefined && name === sym.main) {
    if (at_root) {
      // This is a top-level function so it can be `main`.
      return EntryPointType.MainNamed;
    } else {
      return EntryPointType.OtherMain;
    }
  } else {
    return EntryPointType.None;
  }
}
