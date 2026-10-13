//! Object files providing support for basic runtime facilities and added to the produced binaries
//! at the start and at the end of linking.
//!
//! Table of CRT objects for popular toolchains.
//! The `crtx` ones are generally distributed with libc and the `begin/end` ones with gcc.
//! See <https://dev.gentoo.org/~vapier/crt.txt> for some more details.
//!
//! | Pre-link CRT objects | glibc                  | musl                   | bionic           | mingw             | wasi         |
//! |----------------------|------------------------|------------------------|------------------|-------------------|--------------|
//! | dynamic-nopic-exe    | crt1, crti, crtbegin   | crt1, crti, crtbegin   | crtbegin_dynamic | crt2, crtbegin    | crt1-command |
//! | dynamic-pic-exe      | Scrt1, crti, crtbeginS | Scrt1, crti, crtbeginS | crtbegin_dynamic | crt2, crtbegin    | crt1-command |
//! | static-nopic-exe     | crt1, crti, crtbeginT  | crt1, crti, crtbegin   | crtbegin_static  | crt2, crtbegin    | crt1-command |
//! | static-pic-exe       | rcrt1, crti, crtbeginS | rcrt1, crti, crtbeginS | crtbegin_dynamic | crt2, crtbegin    | crt1-command |
//! | dynamic-dylib        | crti, crtbeginS        | crti, crtbeginS        | crtbegin_so      | dllcrt2, crtbegin | crt1-reactor |
//! | static-dylib (gcc)   | crti, crtbeginT        | crti, crtbeginS        | crtbegin_so      | dllcrt2, crtbegin | crt1-reactor |
//! | static-dylib (clang) | crti, crtbeginT        | N/A                    | crtbegin_static  | dllcrt2, crtbegin | ctr1-reactor |
//! | wasi-reactor-exe     | N/A                    | N/A                    | N/A              | N/A               | crt1-reactor |
//!
//! | Post-link CRT objects | glibc         | musl          | bionic         | mingw  | wasi |
//! |-----------------------|---------------|---------------|----------------|--------|------|
//! | dynamic-nopic-exe     | crtend, crtn  | crtend, crtn  | crtend_android | crtend | -    |
//! | dynamic-pic-exe       | crtendS, crtn | crtendS, crtn | crtend_android | crtend | -    |
//! | static-nopic-exe      | crtend, crtn  | crtend, crtn  | crtend_android | crtend | -    |
//! | static-pic-exe        | crtendS, crtn | crtendS, crtn | crtend_android | crtend | -    |
//! | dynamic-dylib         | crtendS, crtn | crtendS, crtn | crtend_so      | crtend | -    |
//! | static-dylib (gcc)    | crtend, crtn  | crtendS, crtn | crtend_so      | crtend | -    |
//! | static-dylib (clang)  | crtendS, crtn | N/A           | crtend_so      | crtend | -    |
//!
//! Use cases for rustc linking the CRT objects explicitly:
//!     - rustc needs to add its own Rust-specific objects (mingw is the example)
//!     - gcc wrapper cannot be used for some reason and linker like ld or lld is used directly.
//!     - gcc wrapper pulls wrong CRT objects (e.g. from glibc when we are targeting musl).
//!
//! In general it is preferable to rely on the target's native toolchain to pull the objects.
//! However, for some targets (musl, mingw) rustc historically provides a more self-contained
//! installation not requiring users to install the native target's toolchain.
//! In that case rustc distributes the objects as a part of the target's Rust toolchain
//! and falls back to linking with them manually.
//! Unlike native toolchains, rustc only currently adds the libc's objects during linking,
//! but not gcc's. As a result rustc cannot link with C++ static libraries (#36710)
//! when linking in self-contained mode.
import type { LinkOutputKind } from "./mod.ts";

/** PORT: `BTreeMap<LinkOutputKind, Vec<Cow<str>>>`; iterate in key order with `LinkOutputKind_cmp`. */
export type CrtObjects = Map<LinkOutputKind, string[]>;

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:50 new
export function new_(obj_table: readonly (readonly [LinkOutputKind, readonly string[]])[]): CrtObjects {
  return new Map(obj_table.map(([z, k]) => [z, [...k]]));
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:54 all
export function all(obj: string): CrtObjects {
  return new_([
    ["DynamicNoPicExe", [obj]],
    ["DynamicPicExe", [obj]],
    ["StaticNoPicExe", [obj]],
    ["StaticPicExe", [obj]],
    ["DynamicDylib", [obj]],
    ["StaticDylib", [obj]],
  ]);
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:65 pre_musl_self_contained
export function pre_musl_self_contained(): CrtObjects {
  return new_([
    ["DynamicNoPicExe", ["crt1.o", "crti.o", "crtbegin.o"]],
    ["DynamicPicExe", ["Scrt1.o", "crti.o", "crtbeginS.o"]],
    ["StaticNoPicExe", ["crt1.o", "crti.o", "crtbegin.o"]],
    ["StaticPicExe", ["rcrt1.o", "crti.o", "crtbeginS.o"]],
    ["DynamicDylib", ["crti.o", "crtbeginS.o"]],
    ["StaticDylib", ["crti.o", "crtbeginS.o"]],
  ]);
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:76 post_musl_self_contained
export function post_musl_self_contained(): CrtObjects {
  return new_([
    ["DynamicNoPicExe", ["crtend.o", "crtn.o"]],
    ["DynamicPicExe", ["crtendS.o", "crtn.o"]],
    ["StaticNoPicExe", ["crtend.o", "crtn.o"]],
    ["StaticPicExe", ["crtendS.o", "crtn.o"]],
    ["DynamicDylib", ["crtendS.o", "crtn.o"]],
    ["StaticDylib", ["crtendS.o", "crtn.o"]],
  ]);
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:87 pre_mingw_self_contained
export function pre_mingw_self_contained(): CrtObjects {
  return new_([
    ["DynamicNoPicExe", ["crt2.o"]],
    ["DynamicPicExe", ["crt2.o"]],
    ["StaticNoPicExe", ["crt2.o"]],
    ["StaticPicExe", ["crt2.o"]],
    ["DynamicDylib", ["dllcrt2.o"]],
    ["StaticDylib", ["dllcrt2.o"]],
  ]);
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:98 pre_i686_mingw_self_contained
export function pre_i686_mingw_self_contained(): CrtObjects {
  return new_([
    ["DynamicNoPicExe", ["crt2.o", "rsbegin.o"]],
    ["DynamicPicExe", ["crt2.o", "rsbegin.o"]],
    ["StaticNoPicExe", ["crt2.o", "rsbegin.o"]],
    ["StaticPicExe", ["crt2.o", "rsbegin.o"]],
    ["DynamicDylib", ["dllcrt2.o", "rsbegin.o"]],
    ["StaticDylib", ["dllcrt2.o", "rsbegin.o"]],
  ]);
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:109 post_i686_mingw_self_contained
export function post_i686_mingw_self_contained(): CrtObjects {
  return all("rsend.o");
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:113 pre_i686_mingw
export function pre_i686_mingw(): CrtObjects {
  return all("rsbegin.o");
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:117 post_i686_mingw
export function post_i686_mingw(): CrtObjects {
  return all("rsend.o");
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:121 pre_wasi_self_contained
export function pre_wasi_self_contained(): CrtObjects {
  // Use crt1-command.o instead of crt1.o to enable support for new-style
  // commands. See https://reviews.llvm.org/D81689 for more info.
  return new_([
    ["DynamicNoPicExe", ["crt1-command.o"]],
    ["DynamicPicExe", ["crt1-command.o"]],
    ["StaticNoPicExe", ["crt1-command.o"]],
    ["StaticPicExe", ["crt1-command.o"]],
    ["WasiReactorExe", ["crt1-reactor.o"]],
    ["DynamicDylib", ["crt1-reactor.o"]],
    ["StaticDylib", ["crt1-reactor.o"]],
  ]);
}

// rustc: compiler/rustc_target/src/spec/crt_objects.rs:135 post_wasi_self_contained
export function post_wasi_self_contained(): CrtObjects {
  return new_([]);
}
