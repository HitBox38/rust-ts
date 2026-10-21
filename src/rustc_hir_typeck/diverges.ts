// Port of compiler/rustc_hir_typeck/src/diverges.rs (lane fnctxt-contract).
//
// `enum Diverges` and its derived Debug / Clone are generated (diverges.gen.ts). Its methods (the `ops` impls and the
// inherent ones) live on the companion const (PORTING §8), declared in decls.ts `Companions["Diverges"]`.
// - `impl ops::BitAnd` / `BitOr` are `Diverges.bitand(self_, other)` / `.bitor(self_, other)` (`a & b` -> `bitand(a, b)`).
// - `impl ops::BitAndAssign` / `BitOrAssign` (`&mut self`) take the place as a `MutRef` cell (PORTING §8): `x &= y` is
//   `Diverges.bitand_assign(cell, y)`.
// - `#[derive(PartialEq, Eq)]`: compare with `Diverges_eq` (below; `Always { span, custom_note }` compares both fields).
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
import type { Span } from "../rustc_span/lib.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { Companions } from "./decls.ts";
import * as gen from "./diverges.gen.ts";
import type { Diverges as DivergesT } from "./diverges.gen.ts";

export * from "./diverges.gen.ts";

export type Diverges = DivergesT;
export const Diverges: typeof gen.Diverges & Companions["Diverges"] = {
  ...gen.Diverges,

  // Convenience impls for combining `Diverges`.

  // impl ops::BitAnd for Diverges { type Output = Self; }
  // rustc: compiler/rustc_hir_typeck/src/diverges.rs:42 bitand
  bitand(self_: DivergesT, other: DivergesT): DivergesT {
    if (self_.$ === "Maybe") return self_;
    if (other.$ === "Maybe") return other;
    // Using `span`/`custom_note` from `self` seems to give better error messages.
    if (self_.$ === "Always" && other.$ === "Always") return self_;
    if (self_.$ === "WarnedAlways") return other;
    // (x, Self::WarnedAlways) => x,
    return self_;
  },

  // impl ops::BitOr for Diverges { type Output = Self; }
  // rustc: compiler/rustc_hir_typeck/src/diverges.rs:56 bitor
  bitor(self_: DivergesT, other: DivergesT): DivergesT {
    if (self_.$ === "WarnedAlways") return self_;
    if (other.$ === "WarnedAlways") return other;
    // Using `span`/`custom_note` from `self` seems to give better error messages.
    if (self_.$ === "Always" && other.$ === "Always") return self_;
    if (self_.$ === "Maybe") return other;
    // (x, Self::Maybe) => x,
    return self_;
  },

  // impl ops::BitAndAssign for Diverges
  // rustc: compiler/rustc_hir_typeck/src/diverges.rs:69 bitand_assign
  bitand_assign(self_: MutRef<DivergesT>, other: DivergesT): void {
    self_.value = Diverges.bitand(self_.value, other);
  },

  // impl ops::BitOrAssign for Diverges
  // rustc: compiler/rustc_hir_typeck/src/diverges.rs:75 bitor_assign
  bitor_assign(self_: MutRef<DivergesT>, other: DivergesT): void {
    self_.value = Diverges.bitor(self_.value, other);
  },

  // impl Diverges {
  /// Creates a `Diverges::Always` with the provided `span` and the default note message.
  // rustc: compiler/rustc_hir_typeck/src/diverges.rs:82 always
  always(span: Span): DivergesT {
    return { $: "Always", span, custom_note: undefined };
  },

  // rustc: compiler/rustc_hir_typeck/src/diverges.rs:86 is_always
  is_always(self_: DivergesT): boolean {
    return self_.$ === "WarnedAlways" || self_.$ === "Always";
  },
};

/** `#[derive(PartialEq, Eq)]` (`Span` is an interned handle, `custom_note` a `&'static str`). */
export function Diverges_eq(a: DivergesT, b: DivergesT): boolean {
  if (a.$ !== b.$) return false;
  if (a.$ === "Always" && b.$ === "Always") return a.span === b.span && a.custom_note === b.custom_note;
  return true;
}
