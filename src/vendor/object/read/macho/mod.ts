// Port of object 0.39.1 `src/read/macho/mod.rs` (module root: re-exports the ported submodules).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Support for reading Mach-O files.
//!
//! Traits are used to abstract over the difference between 32-bit and 64-bit Mach-O
//! files. The primary trait for this is [`MachHeader`].
//!
//! ## High level API
//!
//! [`MachOFile`] implements the [`Object`](crate::read::Object) trait for Mach-O files.
//! [`MachOFile`] is parameterised by [`MachHeader`] to allow reading both 32-bit and
//! 64-bit Mach-O files. There are type aliases for these parameters ([`MachOFile32`] and
//! [`MachOFile64`]).
//
// PORT: dyld caches, fat archives, exports tries, function starts and relocations are not
// ported (unused on rustc's metadata read path).

export * from "./file.ts";
export * from "./load_command.ts";
export * from "./segment.ts";
export * from "./section.ts";
export * from "./symbol.ts";
