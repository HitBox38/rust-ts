// Port of tinystr 0.8.4 `src/lib.rs` (subset: see ascii.ts header and docs/handoff/langid-plural.md).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).

//! `tinystr` is a utility crate of the [`ICU4X`] project.
//!
//! It includes [`TinyAsciiStr`], a core API for representing small ASCII-only bounded length strings.
//!
//! It is optimized for operations on strings of size 8 or smaller. When use cases involve comparison
//! and conversion of strings for lowercase/uppercase/titlecase, or checking
//! numeric/alphabetic/alphanumeric, `TinyAsciiStr` is the edge performance library.
//!
//! (Examples and details of upstream's crate docs are not repeated here.)
//!
//! [`ICU4X`]: ../icu/index.html

// mod macros;  (macros.ts: the `tinystr!` macro as a function)
// mod ascii; mod asciibyte; mod error; mod int_ops;
// mod unvalidated;  (unvalidated.ts: the subset icu_locale_fallback uses, added by the icu-list lane)
// #[cfg(feature = "serde")] mod serde;  #[cfg(feature = "databake")] mod databake;
// #[cfg(feature = "zerovec")] mod ule;  (features off in rustc's build; not ported)

export { TinyAsciiStr } from "./ascii.ts";
export { ParseError } from "./error.ts";
export { tinystr } from "./macros.ts";
export { to_unvalidated, UnvalidatedTinyAsciiStr } from "./unvalidated.ts";

// PORT: the type aliases `TinyStr4 = TinyAsciiStr<4>`, `TinyStr8 = TinyAsciiStr<8>` and
// `TinyStr16 = TinyAsciiStr<16>` erase `N`; constructors take `N` explicitly (`TinyAsciiStr.try_from_utf8(8, ..)`).
/// These are temporary compatability reexports that will be removed
/// in a future version.
export type { TinyAsciiStr as TinyStr4, TinyAsciiStr as TinyStr8, TinyAsciiStr as TinyStr16 } from "./ascii.ts";

// Modules not ported (features off in rustc's build, or unused by unic-langid-impl):
// crate-skip: tinystr-0.8.4/src/serde.rs:15 serialize feature "serde" off
// crate-skip: tinystr-0.8.4/src/serde.rs:36 new feature "serde" off
// crate-skip: tinystr-0.8.4/src/serde.rs:46 expecting feature "serde" off
// crate-skip: tinystr-0.8.4/src/serde.rs:51 visit_seq feature "serde" off
// crate-skip: tinystr-0.8.4/src/serde.rs:78 deserialize feature "serde" off
// crate-skip: tinystr-0.8.4/src/serde.rs:87 expecting feature "serde" off
// crate-skip: tinystr-0.8.4/src/serde.rs:91 visit_str feature "serde" off
// crate-skip: tinystr-0.8.4/src/ule.rs:23 validate_bytes feature "zerovec" off
// crate-skip: tinystr-0.8.4/src/ule.rs:45 to_unaligned feature "zerovec" off
// crate-skip: tinystr-0.8.4/src/ule.rs:50 from_unaligned feature "zerovec" off
// crate-skip: tinystr-0.8.4/src/ule.rs:74 validate_bytes feature "zerovec" off
// crate-skip: tinystr-0.8.4/src/ule.rs:86 to_unaligned feature "zerovec" off
// crate-skip: tinystr-0.8.4/src/ule.rs:91 from_unaligned feature "zerovec" off
// crate-skip: tinystr-0.8.4/src/ule.rs:110 test_zerovec feature "zerovec" off
// crate-skip: tinystr-0.8.4/src/databake.rs:10 bake feature "databake" off
// crate-skip: tinystr-0.8.4/src/databake.rs:20 borrows_size feature "databake" off
// crate-skip: tinystr-0.8.4/src/databake.rs:26 bake feature "databake" off
// crate-skip: tinystr-0.8.4/src/databake.rs:46 borrows_size feature "databake" off
// crate-skip: tinystr-0.8.4/src/databake.rs:52 test feature "databake" off
// crate-skip: tinystr-0.8.4/src/databake.rs:62 test_unvalidated feature "databake" off
// crate-skip: tinystr-0.8.4/src/unvalidated.rs:86 serialize feature "serde" off
// crate-skip: tinystr-0.8.4/src/unvalidated.rs:104 deserialize feature "serde" off

// crate-skip: tinystr-0.8.4/src/lib.rs:102 test_size checks the `Option` niche (`size_of`); no TS equivalent
