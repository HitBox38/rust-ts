// Port of compiler/rustc_type_ir/src/intern/mod.rs (lane tyir-misc, sub-lane lib-sty).
//
// PORT (D2): the hash-consed classes extend rustc_data_structures/intern.ts's `Interned` and *are* their interned value
// (`Region`, `Const`: `self.0.get()` is the `internee` field), so nothing implements this trait at runtime; it is kept
// as the TS interface for code generic over `I::Interned*`.
/** `pub trait Interned<I>: Copy + Hash + Eq + PartialEq` (`Copy`/`Hash`/`Eq` are erased). */
// rustc-trait: compiler/rustc_type_ir/src/intern/mod.rs:3 Interned
export interface Interned<Value> {
  // rustc: compiler/rustc_type_ir/src/intern/mod.rs:5 get
  get(): Value;
}
