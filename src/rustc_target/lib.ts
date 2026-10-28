//! Some stuff used by rustc that doesn't have many dependencies
//!
//! Originally extracted from rustc::back, which was nominally the
//! compiler 'backend', though LLVM is rustc's backend, so rustc_target
//! is really just odds-and-ends relating to code gen and linking.
//! This crate mostly exists to make rustc smaller, so we might put
//! more 'stuff' here in the future. It does not have a dependency on
//! LLVM.
import { existsSync } from "node:fs";
import type { PathBuf } from "../rustc_span/lib.ts";
import { type Debug, debug_str } from "../std/fmt.ts";
import { path_join } from "../std/path.ts";
import { unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { Json } from "./json.ts";

// PORT: import rustc_target through this file only: `target_features.ts` attaches `impl Target` methods
// to the class defined in `spec/mod.ts`, so the spec must be evaluated first (see PORTING §8).
// `spec/mod.ts` imports this file back for `target_spec_enum!` (a function declaration, so usable
// before this module body runs).
export * as asm from "./asm/mod.ts";
export * as json from "./json.ts";
export * as spec from "./spec/mod.ts";
// pub mod callconv; (lane fn-abi: mod.rs and x86_64.rs; after the spec, whose `AbiMap` / `Arch` it reads)
export * as callconv from "./callconv/mod.ts";
// `spec::json` (`impl ToJson for Target`); after the spec, whose values its tables read at load time.
export { Target_to_json } from "./spec/json.ts";
export * as target_features from "./target_features.ts";

/// The name of rustc's own place to organize libraries.
///
/// Used to be `rustc`, now the default is `rustlib`.
const RUST_LIB_DIR = "rustlib";

/// Returns a `rustlib` path for this particular target, relative to the provided sysroot.
///
/// For example: `target_sysroot_path("/usr", "x86_64-unknown-linux-gnu")` =>
/// `"lib*/rustlib/x86_64-unknown-linux-gnu"`.
// rustc: compiler/rustc_target/src/lib.rs:36 relative_target_rustlib_path
export function relative_target_rustlib_path(sysroot: PathBuf, target_triple: string): PathBuf {
  const libdir = find_relative_libdir(sysroot);
  return path_join(path_join(libdir, RUST_LIB_DIR), target_triple);
}

/// The name of the directory rustc expects libraries to be located.
// rustc: compiler/rustc_target/src/lib.rs:42 find_relative_libdir
function find_relative_libdir(sysroot: PathBuf): string {
  // FIXME: This is a quick hack to make the rustc binary able to locate
  // Rust libraries in Linux environments where libraries might be installed
  // to lib64/lib32. This would be more foolproof by basing the sysroot off
  // of the directory where `librustc_driver` is located, rather than
  // where the rustc binary is.
  // If --libdir is set during configuration to the value other than
  // "lib" (i.e., non-default), this value is used (see issue #16552).

  // #[cfg(target_pointer_width = "64")]
  // PORT: the oracle is a 64-bit host build.
  const PRIMARY_LIB_DIR = "lib64";

  const SECONDARY_LIB_DIR = "lib";

  // PORT: `option_env!("CFG_LIBDIR_RELATIVE")` of the oracle build is `None` or `Some("lib")` (the
  // rustup toolchains use the default libdir); both take the first arm.
  if (existsSync(path_join(path_join(sysroot, PRIMARY_LIB_DIR), RUST_LIB_DIR))) {
    return PRIMARY_LIB_DIR;
  } else {
    return SECONDARY_LIB_DIR;
  }
}

// ---- `target_spec_enum!` ----

/**
 * One `$Variant = $string $(, $alias)*` line of a `target_spec_enum!` invocation.
 * PORT: the macro (lib.rs:71) is a helper that builds the generated impls from the variant table.
 */
export type TargetSpecVariant<T extends string> = readonly [variant: T, string: string, ...aliases: string[]];

/** The impls `target_spec_enum!` generates for a fieldless enum (first macro arm). */
export interface TargetSpecEnum<T extends string> {
  readonly ALL: readonly T[];
  from_str(s: string): Result<T, string>;
  desc(self: T): string;
  to_json(self: T): Json;
  display(self: T): string;
}

/** `target_spec_enum! { pub enum $Name { $Variant = $string, .. } parse_error_type = $parse_error_type; }` */
export function target_spec_enum<T extends string>(variants: readonly TargetSpecVariant<T>[], parse_error_type: string): TargetSpecEnum<T> {
  const desc = (self: T): string => {
    for (const [variant, string] of variants) {
      if (variant === self) return string;
    }
    return unreachable();
  };
  return {
    // pub const ALL: &'static [$Name] = &[ $( $Name::$Variant, )* ];
    ALL: variants.map(([v]) => v),

    // impl FromStr for $Name
    // rustc: compiler/rustc_target/src/lib.rs:97 from_str
    from_str(s: string): Result<T, string> {
      for (const [variant, string, ...aliases] of variants) {
        if (s === string || aliases.includes(s)) return Ok(variant);
      }
      const all = variants.map(([, string]) => `'${string}'`).join(", ");
      return Err(`invalid ${parse_error_type}: '${s}'. allowed values: ${all}`);
    },

    // rustc: compiler/rustc_target/src/lib.rs:113 desc
    desc,

    // crate::target_spec_enum!(@common_impls $Name);
    // impl crate::json::ToJson for $Name
    // rustc: compiler/rustc_target/src/lib.rs:194 to_json
    to_json(self): Json {
      return desc(self);
    },

    // impl std::fmt::Display for $Name
    // rustc: compiler/rustc_target/src/lib.rs:203 fmt
    display(self): string {
      return desc(self);
    },
  };
}

/** A value of a `target_spec_enum!` enum with an `other_variant` (second macro arm). */
export type TargetSpecOther<T extends string, O extends string> = { readonly $: T } | { readonly $: O; readonly _0: string };

/** The impls `target_spec_enum!` generates for an enum with an `other_variant` (second macro arm). */
export interface TargetSpecOtherEnum<T extends string, O extends string> {
  /** The shared singleton of each known variant. */
  readonly V: { readonly [K in T]: { readonly $: K } };
  from_str(s: string): Result<TargetSpecOther<T, O>, never>;
  desc(self: TargetSpecOther<T, O>): string;
  to_json(self: TargetSpecOther<T, O>): Json;
  display(self: TargetSpecOther<T, O>): string;
}

/** `target_spec_enum! { pub enum $Name { $Variant = $string, .. } other_variant = $OtherVariant; }` */
export function target_spec_other_enum<T extends string, O extends string>(
  variants: readonly TargetSpecVariant<T>[],
  other_variant: O,
): TargetSpecOtherEnum<T, O> {
  const V = Object.fromEntries(variants.map(([v]) => [v, Object.freeze({ $: v })])) as { readonly [K in T]: { readonly $: K } };
  const desc = (self: TargetSpecOther<T, O>): string => {
    if ("_0" in self) return self._0;
    for (const [variant, string] of variants) {
      if (variant === self.$) return string;
    }
    return unreachable();
  };
  return {
    V,
    // impl FromStr for $Name
    // rustc: compiler/rustc_target/src/lib.rs:169 from_str
    from_str(s: string): Result<TargetSpecOther<T, O>, never> {
      for (const [variant, string, ...aliases] of variants) {
        if (s === string || aliases.includes(s)) return Ok(V[variant]);
      }
      return Ok({ $: other_variant, _0: s });
    },

    // rustc: compiler/rustc_target/src/lib.rs:181 desc
    desc,

    // crate::target_spec_enum!(@common_impls $Name);
    // impl crate::json::ToJson for $Name
    // rustc: compiler/rustc_target/src/lib.rs:194 to_json
    to_json(self): Json {
      return desc(self);
    },

    // impl std::fmt::Display for $Name
    // rustc: compiler/rustc_target/src/lib.rs:203 fmt
    display(self): string {
      return desc(self);
    },
  };
}

/** `#[derive(Debug)]` of a `target_spec_enum!` enum: the variant name (and `Other("..")`). */
export function debug_target_spec_enum<T extends string>(): Debug<T> {
  return (v) => v;
}

/** `#[derive(Debug)]` of a `target_spec_enum!` enum with an `other_variant`. */
export function debug_target_spec_other<T extends string, O extends string>(v: TargetSpecOther<T, O>): string {
  return "_0" in v ? `${v.$}(${debug_str(v._0)})` : v.$;
}
