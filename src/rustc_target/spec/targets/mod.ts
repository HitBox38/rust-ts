// `mod targets { $(pub(crate) mod $module;)+ }` (spec/mod.rs `supported_targets!`).
// PORT: only these built-in target modules are ported; the full list is `SUPPORTED_TARGETS` in
// ../mod.ts. Target modules only declare functions (see `PORTED_TARGETS`).
export * as aarch64_apple_darwin from "./aarch64_apple_darwin.ts";
export * as aarch64_unknown_linux_gnu from "./aarch64_unknown_linux_gnu.ts";
export * as wasm32_wasip2 from "./wasm32_wasip2.ts";
export * as x86_64_apple_darwin from "./x86_64_apple_darwin.ts";
export * as x86_64_pc_windows_msvc from "./x86_64_pc_windows_msvc.ts";
export * as x86_64_unknown_linux_gnu from "./x86_64_unknown_linux_gnu.ts";
