// Port of object 0.39.1 `src/read/elf/mod.rs` (module root: re-exports the ported submodules).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Support for reading ELF files.
//!
//! Traits are used to abstract over the difference between 32-bit and 64-bit ELF.
//! The primary trait for this is [`FileHeader`].
//!
//! ## High level API
//!
//! [`ElfFile`] implements the [`Object`](crate::read::Object) trait for ELF files.
//! [`ElfFile`] is parameterised by [`FileHeader`] to allow reading both 32-bit and
//! 64-bit ELF. There are type aliases for these parameters ([`ElfFile32`] and
//! [`ElfFile64`]).
//
// PORT: segment, comdat, dynamic, compression, note, hash, version and attributes are not
// ported (unused on rustc's metadata read path).

export * from "./file.ts";
export * from "./section.ts";
export * from "./symbol.ts";
export * from "./relocation.ts";
