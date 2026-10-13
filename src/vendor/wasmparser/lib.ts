// Port of wasmparser 0.247.0 (crate root: the read subset object's Wasm reader uses).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).
//
//! A simple event-driven library for parsing WebAssembly binary files
//! (or streams).
//!
//! The parser library reports events as they happen and only stores
//! parsing information for a brief period of time, making it very fast
//! and memory-efficient. The event-driven model, however, has some drawbacks.
//! If you need random access to the entire WebAssembly data-structure,
//! this is not the right library for you. You could however, build such
//! a data-structure using this library.
//
// PORT: only the module parser, the custom/linking section readers and the reader primitives
// are ported; validation, operators, types and the component model are not.

export * from "./binary_reader.ts";
export * from "./parser.ts";
export * from "./readers.ts";
export * from "./readers/core/code.ts";
export * from "./readers/core/custom.ts";
export * from "./readers/core/linking.ts";
