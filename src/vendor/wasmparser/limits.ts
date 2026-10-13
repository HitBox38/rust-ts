// Port of wasmparser 0.247.0 `src/limits.rs` (the limits the ported readers check).
//
// Copyright (c) Bytecode Alliance contributors; licensed under Apache-2.0 WITH LLVM-exception OR
// Apache-2.0 OR MIT (wasmparser).

// The following limits are imposed by wasmparser on WebAssembly modules.
// The limits are agreed upon with other engines for consistency.
//
// See https://webassembly.github.io/spec/js-api/#limits for details.
export const MAX_WASM_STRING_SIZE = 100_000;

// component_limits
export const MAX_WASM_MODULE_SIZE = 1024 * 1024 * 1024; //= 1 GiB
