// Port of compiler/rustc_attr_ir/src/weak_lang_items.rs
//! Validity checking for weak lang items
//
// PORT: `weak_lang_items!` expanded by hand (two rows); `impl LangItem` -> functions that
// lang_items.ts puts on the `LangItem` companion (PORTING §8). Only types are imported from
// lang_items (it imports this module).
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import type { LangItem } from "./lang_items.gen.ts";

// weak_lang_items! {
//     PanicImpl,          rust_begin_unwind;
//     EhPersonality,      rust_eh_personality;
// }

export const WEAK_LANG_ITEMS: readonly LangItem[] = ["PanicImpl", "EhPersonality"];

// rustc: compiler/rustc_attr_ir/src/weak_lang_items.rs:12 is_weak
export function is_weak(self: LangItem): boolean {
  return self === "PanicImpl" || self === "EhPersonality";
}

// rustc: compiler/rustc_attr_ir/src/weak_lang_items.rs:16 link_name
export function link_name(self: LangItem): Symbol | undefined {
  switch (self) {
    case "PanicImpl":
      return sym.rust_begin_unwind;
    case "EhPersonality":
      return sym.rust_eh_personality;
    default:
      return undefined;
  }
}
