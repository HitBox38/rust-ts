// Port of src/tools/clippy/clippy_utils/src/sym.rs (crate `clippy_utils`, plan-m8 D4; lane clippy-contract-b2, wave 41).
//
// The file is all macros: `val!` and `generate!` with its 619 entries are expanded by tools/codegen/clippy.ts into
// sym.gen.ts (plan-m8 D5), which holds `EXTRA_SYMBOLS` (given to `rustc_interface::Config.extra_symbols` by the driver),
// one `Symbol` const per entry at `PREDEFINED_SYMBOLS_COUNT + i` (`${index()}`), and the `sym` table. This hand module
// is what the rest of clippy imports, as src/miri/sym.ts is for Miri:
//   `use clippy_utils::sym;` then `sym::foo`       → `import { sym } from ".../clippy_utils/sym.ts";` then `sym.foo`
//   `use clippy_utils::sym::EXTRA_SYMBOLS;`         → `import { EXTRA_SYMBOLS } from ".../clippy_utils/sym.ts";`
// It has no fns (coverage 0/0).

// #![expect(non_upper_case_globals)]

// use rustc_span::symbol::PREDEFINED_SYMBOLS_COUNT;   (used by the expansion in sym.gen.ts)

// #[doc(no_inline)]
// pub use rustc_span::sym::*;
// PORT: the glob re-export is the `...rustc_span sym` spread at the head of sym.gen.ts's `sym` table (explicit items
// shadow a glob, so clippy's own entries come after it).

// macro_rules! val { .. }
// macro_rules! generate { .. }
// generate! { .. }
export * from "./sym.gen.ts";
