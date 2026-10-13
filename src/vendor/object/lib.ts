// Port of object 0.39.1 (crate root: the read subset rustc_codegen_ssa's metadata loader uses).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! # `object`
//!
//! The `object` crate provides a unified interface to working with object files
//! across platforms. It supports reading relocatable object files and executable files,
//! and writing relocatable object files and some executable files.
//
// PORT: features as rustc_codegen_ssa enables them: read_core, archive, elf, macho, pe (coff),
// xcoff, unaligned, wasm, write. Only the read half is ported, and only the parts the metadata
// loader reaches (see read/mod.ts and docs/handoff/object-read.md); the `write` and `build`
// modules belong to M5.

export * from "./common.ts";
export * from "./endian.ts";
export * from "./pod.ts";
export * as archive from "./archive.ts";
export * as elf from "./elf.ts";
export * as macho from "./macho.ts";
export * as read from "./read/lib.ts";
export * from "./read/lib.ts";
