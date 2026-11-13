// rust-ts: the IR model's implementation modules (lanes llir-core-a, llir-core-b; intrinsics.ts: cg-intrinsic-a; target.ts: llir-init), in the order tools/llir/ffi_gen.ts searches them for the
// ffi.rs functions they export. A later llir lane adds its module here and reruns `bun tools/llir/ffi_gen.ts`; it never edits
// tools/. Paths are relative to this directory.
export const IMPL_MODULES: readonly string[] = ["./core.ts", "./build.ts", "./intrinsics.ts", "./target.ts"];
