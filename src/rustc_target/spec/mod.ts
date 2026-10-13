//! [Flexible target specification.](https://github.com/rust-lang/rfcs/pull/131)
//!
//! Rust targets a wide variety of usecases, and in the interest of flexibility,
//! allows new target tuples to be defined in configuration files. Most users
//! will not need to care about these, but this is invaluable when porting Rust
//! to a new platform, and allows for an unprecedented level of control over how
//! the compiler works.
//!
//! # Using targets and target.json
//!
//! Invoking "rustc --target=${TUPLE}" will result in rustc initiating the [`Target::search`] by
//! - checking if "$TUPLE" is a complete path to a json (ending with ".json") and loading if so
//! - checking builtin targets for "${TUPLE}"
//! - checking directories in "${RUST_TARGET_PATH}" for "${TUPLE}.json"
//! - checking for "${RUSTC_SYSROOT}/lib/rustlib/${TUPLE}/target.json"
//!
//! Code will then be compiled using the first discovered target spec.
//!
//! # Defining a new target
//!
//! Targets are defined using a struct which additionally has serialization to and from [JSON].
//! The `Target` struct in this module loosely corresponds with the format the JSON takes.
//! We usually try to make the fields equivalent but we have given up on a 1:1 correspondence
//! between the JSON and the actual structure itself.
//!
//! Some fields are required in every target spec, and they should be embedded in Target directly.
//! Optional keys are in TargetOptions, but Target derefs to it, for no practical difference.
//! Most notable is the "data-layout" field which specifies Rust's notion of sizes and alignments
//! for several key types, such as f64, pointers, and so on.
//!
//! At one point we felt `-C` options should override the target's settings, like in C compilers,
//! but that was an essentially-unmarked route for making code incorrect and Rust unsound.
//! Confronted with programmers who prefer a compiler with a good UX instead of a lethal weapon,
//! we have almost-entirely recanted that notion, though we hope "target modifiers" will offer
//! a way to have a decent UX yet still extend the necessary compiler controls, without
//! requiring a new target spec for each and every single possible target micro-variant.
//!
//! [JSON]: https://json.org
//
// PORT notes for this module:
// - `LinkerFlavor`/`LinkerFlavorCli` values are interned (one frozen object per value, built by the
//   variant constructors on the companion const), so `===` is their derived `PartialEq` and they can key
//   the `LinkArgs`/`LinkArgsCli` maps. `BTreeMap` iteration order is restored with the derived `Ord`
//   (`btree_entries`).
// - `TargetOptions` is a class built from a field object (123 fields); struct update syntax
//   `TargetOptions { a, ..base }` is `TargetOptions.update(base, { a })` (the base is moved, so it is
//   updated in place). Private upstream fields (`vendor`, `singlethread`, ...) are public here.
// - `Target` derefs to its `options`: every `TargetOptions` field and method is forwarded by a getter on
//   `Target.prototype` (see below). The `Target` methods whose names clash with a `TargetOptions` field
//   get a trailing underscore: `min_atomic_width_()`, `max_atomic_width_()`, `singlethread_()`,
//   `small_data_threshold_support_()`.
// - Only the built-in targets listed in `PORTED_TARGETS` are ported; `load_builtin` of any other
//   built-in tuple calls `unported`.
import {
  Align,
  type AddressSpace,
  AddressSpace as AddressSpaceImpl,
  CanonAbi,
  type CVariadicStatus,
  Endian,
  Integer,
  Size,
  TargetDataLayout,
  type TargetDataLayoutError,
} from "../../rustc_abi/lib.ts";
import type { DiagArgValue } from "../../rustc_error_messages/lib.ts";
import type { PathBuf } from "../../rustc_span/lib.ts";
import { kw, Symbol, sym } from "../../rustc_span/symbol.ts";
import { SanitizerSet } from "../stand_ins.ts";
import { is_numeric } from "../../std/char.ts";
import { type Debug, debug_str } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert_eq, panic, unported, unwrap } from "../../std/panic.ts";
import { path_join } from "../../std/path.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter } from "node:path";
import { type Json, JsonObject, num_to_json, slice_to_json, str_to_json } from "../json.ts";
import {
  relative_target_rustlib_path,
  type TargetSpecOther,
  target_spec_enum,
  target_spec_other_enum,
} from "../lib.ts";
import type { CrtObjects } from "./crt_objects.ts";
import * as targets from "./targets/mod.ts";
import { TargetTuple } from "./tuple.ts";

export * as crt_objects from "./crt_objects.ts";

// mod abi_map;     (not ported)
// mod base;
// mod consistency; (not ported)
// mod json;
// mod tuple;

// pub use abi_map::{AbiMap, AbiMapping};  (not ported)
// pub use base::apple;
// pub use base::avr::ef_avr_arch;         (not ported)
// pub use json::json_schema;              (not ported)
export { SanitizerSet };
export { TargetTuple };

/// Linker is called through a C/C++ compiler.
// #[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
export type Cc = "Yes" | "No";
export const Cc = { Yes: "Yes", No: "No" } as const;

/// Linker is LLD.
// #[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
export type Lld = "Yes" | "No";
export const Lld = { Yes: "Yes", No: "No" } as const;

/** Derived `Ord` of `Cc`/`Lld` (`Yes` < `No`). */
function yes_no_ord(v: "Yes" | "No"): number {
  return v === "Yes" ? 0 : 1;
}

/// All linkers have some kinds of command line interfaces and rustc needs to know which commands
/// to use with each of them. So we cluster all such interfaces into a (somewhat arbitrary) number
/// of classes that we call "linker flavors".
///
/// Technically, it's not even necessary, we can nearly always infer the flavor from linker name
/// and target properties like `is_like_windows`/`is_like_darwin`/etc. However, the PRs originally
/// introducing `-Clinker-flavor` (#40018 and friends) were aiming to reduce this kind of inference
/// and provide something certain and explicitly specified instead, and that design goal is still
/// relevant now.
///
/// The second goal is to keep the number of flavors to the minimum if possible.
/// LLD somewhat forces our hand here because that linker is self-sufficient only if its executable
/// (`argv[0]`) is named in specific way, otherwise it doesn't work and requires a
/// `-flavor LLD_FLAVOR` argument to choose which logic to use. Our shipped `rust-lld` in
/// particular is not named in such specific way, so it needs the flavor option, so we make our
/// linker flavors sufficiently fine-grained to satisfy LLD without inferring its flavor from other
/// target properties, in accordance with the first design goal.
///
/// The first component of the flavor is tightly coupled with the compilation target,
/// while the `Cc` and `Lld` flags can vary within the same target.
// #[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
export type LinkerFlavor =
  /// Unix-like linker with GNU extensions (both naked and compiler-wrapped forms).
  /// Besides similar "default" Linux/BSD linkers this also includes Windows/GNU linker,
  /// which is somewhat different because it doesn't produce ELFs.
  | { readonly $: "Gnu"; readonly _0: Cc; readonly _1: Lld }
  /// Unix-like linker for Apple targets (both naked and compiler-wrapped forms).
  /// Extracted from the "umbrella" `Unix` flavor due to its corresponding LLD flavor.
  | { readonly $: "Darwin"; readonly _0: Cc; readonly _1: Lld }
  /// Unix-like linker for Wasm targets (both naked and compiler-wrapped forms).
  /// Extracted from the "umbrella" `Unix` flavor due to its corresponding LLD flavor.
  /// Non-LLD version does not exist, so the lld flag is currently hardcoded here.
  | { readonly $: "WasmLld"; readonly _0: Cc }
  /// Basic Unix-like linker for "any other Unix" targets (Solaris/illumos, L4Re, MSP430, etc),
  /// possibly with non-GNU extensions (both naked and compiler-wrapped forms).
  /// LLD doesn't support any of these.
  | { readonly $: "Unix"; readonly _0: Cc }
  /// MSVC-style linker for Windows and UEFI, LLD supports it.
  | { readonly $: "Msvc"; readonly _0: Lld }
  /// Emscripten Compiler Frontend, a wrapper around `WasmLld(Cc::Yes)` that has a different
  /// interface and produces some additional JavaScript output.
  | { readonly $: "EmCc" }
  // Below: other linker-like tools with unique interfaces for exotic targets.
  /// Linker tool for BPF.
  | { readonly $: "Bpf" }
  /// LLVM bitcode linker that can be used as a `self-contained` linker
  | { readonly $: "Llbc" };

/** Interning table: one frozen object per `LinkerFlavor`/`LinkerFlavorCli` value (see the module notes). */
function interner<T extends { readonly $: string }>(): (v: T) => T {
  const table = new Map<string, T>();
  return (v) => {
    const key = JSON.stringify(v);
    let t = table.get(key);
    if (t === undefined) {
      t = Object.freeze(v);
      table.set(key, t);
    }
    return t;
  };
}
const intern_linker_flavor = interner<LinkerFlavor>();
const intern_linker_flavor_cli = interner<LinkerFlavorCli>();

/** Derived `Ord` of `LinkerFlavor` (variant order, then fields). */
const LINKER_FLAVOR_ORDER = ["Gnu", "Darwin", "WasmLld", "Unix", "Msvc", "EmCc", "Bpf", "Llbc"];
export function LinkerFlavor_cmp(a: LinkerFlavor, b: LinkerFlavor): number {
  const d = LINKER_FLAVOR_ORDER.indexOf(a.$) - LINKER_FLAVOR_ORDER.indexOf(b.$);
  if (d !== 0) return d;
  const fa = a as { _0?: "Yes" | "No"; _1?: "Yes" | "No" };
  const fb = b as { _0?: "Yes" | "No"; _1?: "Yes" | "No" };
  if (fa._0 !== undefined && fb._0 !== undefined && fa._0 !== fb._0) return yes_no_ord(fa._0) - yes_no_ord(fb._0);
  if (fa._1 !== undefined && fb._1 !== undefined && fa._1 !== fb._1) return yes_no_ord(fa._1) - yes_no_ord(fb._1);
  return 0;
}

/// Linker flavors available externally through command line (`-Clinker-flavor`)
/// or json target specifications.
/// This set has accumulated historically, and contains both (stable and unstable) legacy values, as
/// well as modern ones matching the internal linker flavors (`LinkerFlavor`).
// #[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
export type LinkerFlavorCli =
  // Modern (unstable) flavors, with direct counterparts in `LinkerFlavor`.
  | { readonly $: "Gnu"; readonly _0: Cc; readonly _1: Lld }
  | { readonly $: "Darwin"; readonly _0: Cc; readonly _1: Lld }
  | { readonly $: "WasmLld"; readonly _0: Cc }
  | { readonly $: "Unix"; readonly _0: Cc }
  // Note: `Msvc(Lld::No)` is also a stable value.
  | { readonly $: "Msvc"; readonly _0: Lld }
  | { readonly $: "EmCc" }
  | { readonly $: "Bpf" }
  | { readonly $: "Llbc" }

  // Legacy stable values
  | { readonly $: "Gcc" }
  | { readonly $: "Ld" }
  | { readonly $: "Lld"; readonly _0: LldFlavor }
  | { readonly $: "Em" };

/** Derived `Ord` of `LinkerFlavorCli` (variant order, then fields). */
const LINKER_FLAVOR_CLI_ORDER = ["Gnu", "Darwin", "WasmLld", "Unix", "Msvc", "EmCc", "Bpf", "Llbc", "Gcc", "Ld", "Lld", "Em"];
export function LinkerFlavorCli_cmp(a: LinkerFlavorCli, b: LinkerFlavorCli): number {
  const d = LINKER_FLAVOR_CLI_ORDER.indexOf(a.$) - LINKER_FLAVOR_CLI_ORDER.indexOf(b.$);
  if (d !== 0) return d;
  if (a.$ === "Lld" && b.$ === "Lld") return LldFlavor.ALL.indexOf(a._0) - LldFlavor.ALL.indexOf(b._0);
  const fa = a as { _0?: "Yes" | "No"; _1?: "Yes" | "No" };
  const fb = b as { _0?: "Yes" | "No"; _1?: "Yes" | "No" };
  if (fa._0 !== undefined && fb._0 !== undefined && fa._0 !== fb._0) return yes_no_ord(fa._0) - yes_no_ord(fb._0);
  if (fa._1 !== undefined && fb._1 !== undefined && fa._1 !== fb._1) return yes_no_ord(fa._1) - yes_no_ord(fb._1);
  return 0;
}

/** `BTreeMap` iteration: the entries of `map` in key order. */
export function btree_entries<K, V>(map: ReadonlyMap<K, V>, cmp: (a: K, b: K) => number): [K, V][] {
  return [...map.entries()].sort((a, b) => cmp(a[0], b[0]));
}

// crate::target_spec_enum! { pub enum LldFlavor { .. } parse_error_type = "LLD flavor"; }
export type LldFlavor = "Wasm" | "Ld64" | "Ld" | "Link";
export const LldFlavor = {
  Wasm: "Wasm",
  Ld64: "Ld64",
  Ld: "Ld",
  Link: "Link",
  ...target_spec_enum<LldFlavor>(
    [
      ["Wasm", "wasm"],
      ["Ld64", "darwin"],
      ["Ld", "gnu"],
      ["Link", "link"],
    ],
    "LLD flavor",
  ),
} as const;

export const LinkerFlavorCli = {
  Gnu: (cc: Cc, lld: Lld): LinkerFlavorCli => intern_linker_flavor_cli({ $: "Gnu", _0: cc, _1: lld }),
  Darwin: (cc: Cc, lld: Lld): LinkerFlavorCli => intern_linker_flavor_cli({ $: "Darwin", _0: cc, _1: lld }),
  WasmLld: (cc: Cc): LinkerFlavorCli => intern_linker_flavor_cli({ $: "WasmLld", _0: cc }),
  Unix: (cc: Cc): LinkerFlavorCli => intern_linker_flavor_cli({ $: "Unix", _0: cc }),
  Msvc: (lld: Lld): LinkerFlavorCli => intern_linker_flavor_cli({ $: "Msvc", _0: lld }),
  EmCc: intern_linker_flavor_cli({ $: "EmCc" }),
  Bpf: intern_linker_flavor_cli({ $: "Bpf" }),
  Llbc: intern_linker_flavor_cli({ $: "Llbc" }),
  Gcc: intern_linker_flavor_cli({ $: "Gcc" }),
  Ld: intern_linker_flavor_cli({ $: "Ld" }),
  Lld: (f: LldFlavor): LinkerFlavorCli => intern_linker_flavor_cli({ $: "Lld", _0: f }),
  Em: intern_linker_flavor_cli({ $: "Em" }),

  /// Returns whether this `-C linker-flavor` option is one of the unstable values.
  // rustc: compiler/rustc_target/src/spec/mod.rs:167 is_unstable
  is_unstable(self: LinkerFlavorCli): boolean {
    switch (self.$) {
      case "Gnu":
      case "Darwin":
      case "WasmLld":
      case "Unix":
      case "EmCc":
      case "Bpf":
      case "Llbc":
        return true;
      case "Msvc":
        return self._0 === "Yes";
      case "Gcc":
      case "Ld":
      case "Lld":
      case "Em":
        return false;
    }
  },

  // linker_flavor_cli_impls! { .. }
  // rustc: compiler/rustc_target/src/spec/mod.rs:458 all
  all(): readonly LinkerFlavorCli[] {
    return LINKER_FLAVOR_CLI_TABLE().map(([f]) => f);
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:462 one_of
  one_of(): string {
    return "one of: " + LINKER_FLAVOR_CLI_TABLE().map(([, s]) => s + " ").join("");
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:466 desc
  desc(self: LinkerFlavorCli): string {
    for (const [f, s] of LINKER_FLAVOR_CLI_TABLE()) {
      if (f === self) return s;
    }
    return panic("unreachable LinkerFlavorCli");
  },

  // impl FromStr for LinkerFlavorCli
  // rustc: compiler/rustc_target/src/spec/mod.rs:476 from_str
  from_str(s: string): Result<LinkerFlavorCli, string> {
    for (const [f, string] of LINKER_FLAVOR_CLI_TABLE()) {
      if (s === string) return Ok(f);
    }
    return Err(`invalid linker flavor, allowed values: ${LinkerFlavorCli.one_of()}`);
  },

  // impl ToJson for LinkerFlavorCli
  // rustc: compiler/rustc_target/src/spec/mod.rs:531 to_json
  to_json(self: LinkerFlavorCli): Json {
    return str_to_json(LinkerFlavorCli.desc(self));
  },
} as const;

export const LinkerFlavor = {
  Gnu: (cc: Cc, lld: Lld): LinkerFlavor => intern_linker_flavor({ $: "Gnu", _0: cc, _1: lld }),
  Darwin: (cc: Cc, lld: Lld): LinkerFlavor => intern_linker_flavor({ $: "Darwin", _0: cc, _1: lld }),
  WasmLld: (cc: Cc): LinkerFlavor => intern_linker_flavor({ $: "WasmLld", _0: cc }),
  Unix: (cc: Cc): LinkerFlavor => intern_linker_flavor({ $: "Unix", _0: cc }),
  Msvc: (lld: Lld): LinkerFlavor => intern_linker_flavor({ $: "Msvc", _0: lld }),
  EmCc: intern_linker_flavor({ $: "EmCc" }),
  Bpf: intern_linker_flavor({ $: "Bpf" }),
  Llbc: intern_linker_flavor({ $: "Llbc" }),

  /// At this point the target's reference linker flavor doesn't yet exist and we need to infer
  /// it. The inference always succeeds and gives some result, and we don't report any flavor
  /// incompatibility errors for json target specs. The CLI flavor is used as the main source
  /// of truth, other flags are used in case of ambiguities.
  // rustc: compiler/rustc_target/src/spec/mod.rs:202 from_cli_json
  from_cli_json(cli: LinkerFlavorCli, lld_flavor: LldFlavor, is_gnu: boolean): LinkerFlavor {
    switch (cli.$) {
      case "Gnu":
        return LinkerFlavor.Gnu(cli._0, cli._1);
      case "Darwin":
        return LinkerFlavor.Darwin(cli._0, cli._1);
      case "WasmLld":
        return LinkerFlavor.WasmLld(cli._0);
      case "Unix":
        return LinkerFlavor.Unix(cli._0);
      case "Msvc":
        return LinkerFlavor.Msvc(cli._0);
      case "EmCc":
        return LinkerFlavor.EmCc;
      case "Bpf":
        return LinkerFlavor.Bpf;
      case "Llbc":
        return LinkerFlavor.Llbc;

      // Below: legacy stable values
      case "Gcc":
        if (lld_flavor === "Ld" && is_gnu) return LinkerFlavor.Gnu("Yes", "No");
        if (lld_flavor === "Ld64") return LinkerFlavor.Darwin("Yes", "No");
        if (lld_flavor === "Wasm") return LinkerFlavor.WasmLld("Yes");
        // LldFlavor::Ld | LldFlavor::Link
        return LinkerFlavor.Unix("Yes");
      case "Ld":
        if (lld_flavor === "Ld" && is_gnu) return LinkerFlavor.Gnu("No", "No");
        if (lld_flavor === "Ld64") return LinkerFlavor.Darwin("No", "No");
        // LldFlavor::Ld | LldFlavor::Wasm | LldFlavor::Link
        return LinkerFlavor.Unix("No");
      case "Lld":
        switch (cli._0) {
          case "Ld":
            return LinkerFlavor.Gnu("No", "Yes");
          case "Ld64":
            return LinkerFlavor.Darwin("No", "Yes");
          case "Wasm":
            return LinkerFlavor.WasmLld("No");
          case "Link":
            return LinkerFlavor.Msvc("Yes");
        }
      // falls through (unreachable)
      case "Em":
        return LinkerFlavor.EmCc;
    }
  },

  /// Returns the corresponding backwards-compatible CLI flavor.
  // rustc: compiler/rustc_target/src/spec/mod.rs:234 to_cli
  to_cli(self: LinkerFlavor): LinkerFlavorCli {
    if (
      (self.$ === "Gnu" && self._0 === "Yes") ||
      (self.$ === "Darwin" && self._0 === "Yes") ||
      (self.$ === "WasmLld" && self._0 === "Yes") ||
      (self.$ === "Unix" && self._0 === "Yes")
    ) {
      return LinkerFlavorCli.Gcc;
    }
    if (self.$ === "Gnu" && self._1 === "Yes") return LinkerFlavorCli.Lld("Ld");
    if (self.$ === "Darwin" && self._1 === "Yes") return LinkerFlavorCli.Lld("Ld64");
    if (self.$ === "WasmLld") return LinkerFlavorCli.Lld("Wasm");
    if (self.$ === "Gnu" || self.$ === "Darwin" || self.$ === "Unix") {
      return LinkerFlavorCli.Ld;
    }
    if (self.$ === "Msvc" && self._0 === "Yes") return LinkerFlavorCli.Lld("Link");
    if (self.$ === "Msvc") return LinkerFlavorCli.Msvc("No");
    if (self.$ === "EmCc") return LinkerFlavorCli.Em;
    if (self.$ === "Bpf") return LinkerFlavorCli.Bpf;
    // LinkerFlavor::Llbc
    return LinkerFlavorCli.Llbc;
  },

  /// Returns the modern CLI flavor that is the counterpart of this flavor.
  // rustc: compiler/rustc_target/src/spec/mod.rs:255 to_cli_counterpart
  to_cli_counterpart(self: LinkerFlavor): LinkerFlavorCli {
    switch (self.$) {
      case "Gnu":
        return LinkerFlavorCli.Gnu(self._0, self._1);
      case "Darwin":
        return LinkerFlavorCli.Darwin(self._0, self._1);
      case "WasmLld":
        return LinkerFlavorCli.WasmLld(self._0);
      case "Unix":
        return LinkerFlavorCli.Unix(self._0);
      case "Msvc":
        return LinkerFlavorCli.Msvc(self._0);
      case "EmCc":
        return LinkerFlavorCli.EmCc;
      case "Bpf":
        return LinkerFlavorCli.Bpf;
      case "Llbc":
        return LinkerFlavorCli.Llbc;
    }
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:268 infer_cli_hints
  infer_cli_hints(cli: LinkerFlavorCli): [Cc | undefined, Lld | undefined] {
    switch (cli.$) {
      case "Gnu":
      case "Darwin":
        return [cli._0, cli._1];
      case "WasmLld":
        return [cli._0, "Yes"];
      case "Unix":
        return [cli._0, undefined];
      case "Msvc":
        return ["No", cli._0];
      case "EmCc":
        return ["Yes", "Yes"];
      case "Bpf":
        return [undefined, undefined];
      case "Llbc":
        return [undefined, undefined];

      // Below: legacy stable values
      case "Gcc":
        return ["Yes", undefined];
      case "Ld":
        return ["No", "No"];
      case "Lld":
        return ["No", "Yes"];
      case "Em":
        return ["Yes", "Yes"];
    }
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:288 infer_linker_hints
  infer_linker_hints(linker_stem: string): Result<LinkerFlavor, [Cc | undefined, Lld | undefined]> {
    // Remove any version postfix.
    let stem = linker_stem;
    const i = linker_stem.lastIndexOf("-");
    if (i !== -1) {
      const lhs = linker_stem.slice(0, i);
      const rhs = linker_stem.slice(i + 1);
      if ([...rhs].every((c) => is_numeric(c.codePointAt(0)!))) stem = lhs;
    }

    if (stem === "llvm-bitcode-linker") {
      return Ok(LinkerFlavor.Llbc);
    } else if (
      stem === "emcc" || // GCC/Clang can have an optional target prefix.
      stem === "gcc" ||
      stem.endsWith("-gcc") ||
      stem === "g++" ||
      stem.endsWith("-g++") ||
      stem === "clang" ||
      stem.endsWith("-clang") ||
      stem === "clang++" ||
      stem.endsWith("-clang++")
    ) {
      return Err(["Yes", "No"] as [Cc | undefined, Lld | undefined]);
    } else if (
      stem === "wasm-ld" ||
      stem.endsWith("-wasm-ld") ||
      stem === "ld.lld" ||
      stem === "lld" ||
      stem === "rust-lld" ||
      stem === "lld-link"
    ) {
      return Err(["No", "Yes"] as [Cc | undefined, Lld | undefined]);
    } else if (stem === "ld" || stem.endsWith("-ld") || stem === "link") {
      return Err(["No", "No"] as [Cc | undefined, Lld | undefined]);
    } else {
      return Err([undefined, undefined] as [Cc | undefined, Lld | undefined]);
    }
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:323 with_hints
  with_hints(self: LinkerFlavor, [cc_hint, lld_hint]: [Cc | undefined, Lld | undefined]): LinkerFlavor {
    switch (self.$) {
      case "Gnu":
        return LinkerFlavor.Gnu(cc_hint ?? self._0, lld_hint ?? self._1);
      case "Darwin":
        return LinkerFlavor.Darwin(cc_hint ?? self._0, lld_hint ?? self._1);
      case "WasmLld":
        return LinkerFlavor.WasmLld(cc_hint ?? self._0);
      case "Unix":
        return LinkerFlavor.Unix(cc_hint ?? self._0);
      case "Msvc":
        return LinkerFlavor.Msvc(lld_hint ?? self._0);
      case "EmCc":
      case "Bpf":
      case "Llbc":
        return self;
    }
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:338 with_cli_hints
  with_cli_hints(self: LinkerFlavor, cli: LinkerFlavorCli): LinkerFlavor {
    return LinkerFlavor.with_hints(self, LinkerFlavor.infer_cli_hints(cli));
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:342 with_linker_hints
  with_linker_hints(self: LinkerFlavor, linker_stem: string): LinkerFlavor {
    const r = LinkerFlavor.infer_linker_hints(linker_stem);
    switch (r.$) {
      case "Ok":
        return r._0;
      case "Err":
        return LinkerFlavor.with_hints(self, r._0);
    }
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:349 check_compatibility
  check_compatibility(self: LinkerFlavor, cli: LinkerFlavorCli): string | undefined {
    const compatible = (cli: LinkerFlavorCli): boolean => {
      // The CLI flavor should be compatible with the target if:
      // they are counterparts: they have the same principal flavor.
      if (
        (self.$ === "Gnu" && cli.$ === "Gnu") ||
        (self.$ === "Darwin" && cli.$ === "Darwin") ||
        (self.$ === "WasmLld" && cli.$ === "WasmLld") ||
        (self.$ === "Unix" && cli.$ === "Unix") ||
        (self.$ === "Msvc" && cli.$ === "Msvc") ||
        (self.$ === "EmCc" && cli.$ === "EmCc") ||
        (self.$ === "Bpf" && cli.$ === "Bpf") ||
        (self.$ === "Llbc" && cli.$ === "Llbc")
      ) {
        return true;
      }

      // 3. or, the flavor is legacy and survives this roundtrip.
      return cli === LinkerFlavor.to_cli(LinkerFlavor.with_cli_hints(self, cli));
    };
    return !compatible(cli)
      ? LinkerFlavorCli.all()
          .filter((cli) => compatible(cli))
          .map((cli) => LinkerFlavorCli.desc(cli))
          .join(", ")
      : undefined;
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:378 lld_flavor
  lld_flavor(self: LinkerFlavor): LldFlavor {
    switch (self.$) {
      case "Gnu":
      case "Unix":
      case "EmCc":
      case "Bpf":
      case "Llbc":
        return "Ld";
      case "Darwin":
        return "Ld64";
      case "WasmLld":
        return "Wasm";
      case "Msvc":
        return "Link";
    }
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:391 is_gnu
  is_gnu(self: LinkerFlavor): boolean {
    return self.$ === "Gnu";
  },

  /// Returns whether the flavor uses the `lld` linker.
  // rustc: compiler/rustc_target/src/spec/mod.rs:396 uses_lld
  uses_lld(self: LinkerFlavor): boolean {
    // Exhaustive match in case new flavors are added in the future.
    switch (self.$) {
      case "Gnu":
      case "Darwin":
        return self._1 === "Yes";
      case "WasmLld":
      case "EmCc":
        return true;
      case "Msvc":
        return self._0 === "Yes";
      case "Unix":
      case "Bpf":
      case "Llbc":
        return false;
    }
  },

  /// Returns whether the flavor calls the linker via a C/C++ compiler.
  // rustc: compiler/rustc_target/src/spec/mod.rs:414 uses_cc
  uses_cc(self: LinkerFlavor): boolean {
    // Exhaustive match in case new flavors are added in the future.
    switch (self.$) {
      case "Gnu":
      case "Darwin":
      case "WasmLld":
      case "Unix":
        return self._0 === "Yes";
      case "EmCc":
        return true;
      case "Msvc":
      case "Bpf":
      case "Llbc":
        return false;
    }
  },

  /// For flavors with an `Lld` component, ensure it's enabled. Otherwise, returns the given
  /// flavor unmodified.
  // rustc: compiler/rustc_target/src/spec/mod.rs:434 with_lld_enabled
  with_lld_enabled(self: LinkerFlavor): LinkerFlavor {
    if (self.$ === "Gnu" && self._1 === "No") return LinkerFlavor.Gnu(self._0, "Yes");
    if (self.$ === "Darwin" && self._1 === "No") return LinkerFlavor.Darwin(self._0, "Yes");
    if (self.$ === "Msvc" && self._0 === "No") return LinkerFlavor.Msvc("Yes");
    return self;
  },

  /// For flavors with an `Lld` component, ensure it's disabled. Otherwise, returns the given
  /// flavor unmodified.
  // rustc: compiler/rustc_target/src/spec/mod.rs:445 with_lld_disabled
  with_lld_disabled(self: LinkerFlavor): LinkerFlavor {
    if (self.$ === "Gnu" && self._1 === "Yes") return LinkerFlavor.Gnu(self._0, "No");
    if (self.$ === "Darwin" && self._1 === "Yes") return LinkerFlavor.Darwin(self._0, "No");
    if (self.$ === "Msvc" && self._0 === "Yes") return LinkerFlavor.Msvc("No");
    return self;
  },
} as const;

/** `#[derive(Debug)]` of `LinkerFlavor`/`LinkerFlavorCli`. */
export const debug_LinkerFlavor: Debug<LinkerFlavor | LinkerFlavorCli> = (v) => {
  const f = v as { $: string; _0?: string; _1?: string };
  if (f._1 !== undefined) return `${f.$}(${f._0}, ${f._1})`;
  if (f._0 !== undefined) return `${f.$}(${f._0})`;
  return f.$;
};

/** The `linker_flavor_cli_impls!` table (flavor, string), in invocation order. */
let LINKER_FLAVOR_CLI_TABLE_: [LinkerFlavorCli, string][] | undefined;
function LINKER_FLAVOR_CLI_TABLE(): [LinkerFlavorCli, string][] {
  return (LINKER_FLAVOR_CLI_TABLE_ ??= [
    [LinkerFlavorCli.Gnu("No", "No"), "gnu"],
    [LinkerFlavorCli.Gnu("No", "Yes"), "gnu-lld"],
    [LinkerFlavorCli.Gnu("Yes", "No"), "gnu-cc"],
    [LinkerFlavorCli.Gnu("Yes", "Yes"), "gnu-lld-cc"],
    [LinkerFlavorCli.Darwin("No", "No"), "darwin"],
    [LinkerFlavorCli.Darwin("No", "Yes"), "darwin-lld"],
    [LinkerFlavorCli.Darwin("Yes", "No"), "darwin-cc"],
    [LinkerFlavorCli.Darwin("Yes", "Yes"), "darwin-lld-cc"],
    [LinkerFlavorCli.WasmLld("No"), "wasm-lld"],
    [LinkerFlavorCli.WasmLld("Yes"), "wasm-lld-cc"],
    [LinkerFlavorCli.Unix("No"), "unix"],
    [LinkerFlavorCli.Unix("Yes"), "unix-cc"],
    [LinkerFlavorCli.Msvc("Yes"), "msvc-lld"],
    [LinkerFlavorCli.Msvc("No"), "msvc"],
    [LinkerFlavorCli.EmCc, "em-cc"],
    [LinkerFlavorCli.Bpf, "bpf"],
    [LinkerFlavorCli.Llbc, "llbc"],

    // Legacy stable flavors
    [LinkerFlavorCli.Gcc, "gcc"],
    [LinkerFlavorCli.Ld, "ld"],
    [LinkerFlavorCli.Lld("Ld"), "ld.lld"],
    [LinkerFlavorCli.Lld("Ld64"), "ld64.lld"],
    [LinkerFlavorCli.Lld("Link"), "lld-link"],
    [LinkerFlavorCli.Lld("Wasm"), "wasm-ld"],
    [LinkerFlavorCli.Em, "em"],
  ]);
}

// crate::json::serde_deserialize_from_str!(LinkerFlavorCli);
// impl schemars::JsonSchema for LinkerFlavorCli: not ported (no markers; mod.rs:517 schema_name,
// 520 json_schema): only `--print target-spec-json-schema` reads it.

/// The different `-Clink-self-contained` options that can be specified in a target spec:
/// - enabling or disabling in bulk
/// - some target-specific pieces of inference to determine whether to use self-contained linking
///   if `-Clink-self-contained` is not specified explicitly (e.g. on musl/mingw)
/// - explicitly enabling some of the self-contained linking components, e.g. the linker component
///   to use `rust-lld`
// #[derive(Clone, Copy, PartialEq, Debug)]
export type LinkSelfContainedDefault =
  /// The target spec explicitly enables self-contained linking.
  | { readonly $: "True" }

  /// The target spec explicitly disables self-contained linking.
  | { readonly $: "False" }

  /// The target spec requests that the self-contained mode is inferred, in the context of musl.
  | { readonly $: "InferredForMusl" }

  /// The target spec requests that the self-contained mode is inferred, in the context of mingw.
  | { readonly $: "InferredForMingw" }

  /// The target spec explicitly enables a list of self-contained linking components: e.g. for
  /// targets opting into a subset of components like the CLI's `-C link-self-contained=+linker`.
  | { readonly $: "WithComponents"; readonly _0: LinkSelfContainedComponents };

export const LinkSelfContainedDefault = {
  True: Object.freeze({ $: "True" }) as LinkSelfContainedDefault,
  False: Object.freeze({ $: "False" }) as LinkSelfContainedDefault,
  InferredForMusl: Object.freeze({ $: "InferredForMusl" }) as LinkSelfContainedDefault,
  InferredForMingw: Object.freeze({ $: "InferredForMingw" }) as LinkSelfContainedDefault,

  /** derived `PartialEq` */
  eq(a: LinkSelfContainedDefault, b: LinkSelfContainedDefault): boolean {
    return a.$ === b.$ && (a.$ !== "WithComponents" || a._0 === (b as { _0: number })._0);
  },

  /// Parses a backwards-compatible `-Clink-self-contained` option string, without components.
  // impl FromStr for LinkSelfContainedDefault
  // rustc: compiler/rustc_target/src/spec/mod.rs:565 from_str
  from_str(s: string): Result<LinkSelfContainedDefault, string> {
    switch (s) {
      case "false":
        return Ok(LinkSelfContainedDefault.False);
      case "true":
      case "wasm":
        return Ok(LinkSelfContainedDefault.True);
      case "musl":
        return Ok(LinkSelfContainedDefault.InferredForMusl);
      case "mingw":
        return Ok(LinkSelfContainedDefault.InferredForMingw);
      default:
        return Err(`'${s}' is not a valid \`-Clink-self-contained\` default. Use 'false', 'true', 'wasm', 'musl' or 'mingw'`);
    }
  },

  // crate::json::serde_deserialize_from_str!(LinkSelfContainedDefault);
  // impl schemars::JsonSchema: not ported (no markers; mod.rs:583 schema_name, 586 json_schema).

  // impl ToJson for LinkSelfContainedDefault
  // rustc: compiler/rustc_target/src/spec/mod.rs:595 to_json
  to_json(self: LinkSelfContainedDefault): Json {
    switch (self.$) {
      case "WithComponents": {
        const components = self._0;
        // Serialize the components in a json object's `components` field, to prepare for a
        // future where `crt-objects-fallback` is removed from the json specs and
        // incorporated as a field here.
        const map = new JsonObject();
        map.insert("components", LinkSelfContainedComponents.to_json(components));
        return map;
      }

      // Stable backwards-compatible values
      case "True":
        return str_to_json("true");
      case "False":
        return str_to_json("false");
      case "InferredForMusl":
        return str_to_json("musl");
      case "InferredForMingw":
        return str_to_json("mingw");
    }
  },

  /// Returns whether the target spec has self-contained linking explicitly disabled. Used to emit
  /// errors if the user then enables it on the CLI.
  // rustc: compiler/rustc_target/src/spec/mod.rs:618 is_disabled
  is_disabled(self: LinkSelfContainedDefault): boolean {
    return LinkSelfContainedDefault.eq(self, LinkSelfContainedDefault.False);
  },

  /// Returns the key to use when serializing the setting to json:
  /// - individual components in a `link-self-contained` object value
  /// - the other variants as a backwards-compatible `crt-objects-fallback` string
  // rustc: compiler/rustc_target/src/spec/mod.rs:625 json_key
  json_key(self: LinkSelfContainedDefault): string {
    switch (self.$) {
      case "WithComponents":
        return "link-self-contained";
      default:
        return "crt-objects-fallback";
    }
  },

  /// Creates a `LinkSelfContainedDefault` enabling the self-contained linker for target specs
  /// (the equivalent of `-Clink-self-contained=+linker` on the CLI).
  // rustc: compiler/rustc_target/src/spec/mod.rs:634 with_linker
  with_linker(): LinkSelfContainedDefault {
    return { $: "WithComponents", _0: LinkSelfContainedComponents.LINKER };
  },
} as const;

// bitflags::bitflags! {
//     #[derive(Clone, Copy, PartialEq, Eq, Default)]
//     /// The `-C link-self-contained` components that can individually be enabled or disabled.
//     pub struct LinkSelfContainedComponents: u8 { .. }
// }
// rustc_data_structures::external_bitflags_debug! { LinkSelfContainedComponents } (not ported)
export type LinkSelfContainedComponents = number;
export const LinkSelfContainedComponents = {
  /// CRT objects (e.g. on `windows-gnu`, `musl`, `wasi` targets)
  CRT_OBJECTS: 1 << 0,
  /// libc static library (e.g. on `musl`, `wasi` targets)
  LIBC: 1 << 1,
  /// libgcc/libunwind (e.g. on `windows-gnu`, `fuchsia`, `fortanix`, `gnullvm` targets)
  UNWIND: 1 << 2,
  /// Linker, dlltool, and their necessary libraries (e.g. on `windows-gnu` and for `rust-lld`)
  LINKER: 1 << 3,
  /// Sanitizer runtime libraries
  SANITIZERS: 1 << 4,
  /// Other MinGW libs and Windows import libs
  MINGW: 1 << 5,

  /** bitflags `empty()` */
  empty: (): LinkSelfContainedComponents => 0,
  /** bitflags `all()` */
  all: (): LinkSelfContainedComponents => 0b111111,
  /** bitflags `contains` */
  contains: (self: LinkSelfContainedComponents, other: LinkSelfContainedComponents): boolean => (self & other) === other,

  /// Return the component's name.
  ///
  /// Returns `None` if the bitflags aren't a singular component (but a mix of multiple flags).
  // rustc: compiler/rustc_target/src/spec/mod.rs:663 as_str
  as_str(self: LinkSelfContainedComponents): string | undefined {
    switch (self) {
      case LinkSelfContainedComponents.CRT_OBJECTS:
        return "crto";
      case LinkSelfContainedComponents.LIBC:
        return "libc";
      case LinkSelfContainedComponents.UNWIND:
        return "unwind";
      case LinkSelfContainedComponents.LINKER:
        return "linker";
      case LinkSelfContainedComponents.SANITIZERS:
        return "sanitizers";
      case LinkSelfContainedComponents.MINGW:
        return "mingw";
      default:
        return undefined;
    }
  },

  /// Returns an array of all the components.
  // rustc: compiler/rustc_target/src/spec/mod.rs:676 all_components
  all_components(): LinkSelfContainedComponents[] {
    return [
      LinkSelfContainedComponents.CRT_OBJECTS,
      LinkSelfContainedComponents.LIBC,
      LinkSelfContainedComponents.UNWIND,
      LinkSelfContainedComponents.LINKER,
      LinkSelfContainedComponents.SANITIZERS,
      LinkSelfContainedComponents.MINGW,
    ];
  },

  /// Returns whether at least a component is enabled.
  // rustc: compiler/rustc_target/src/spec/mod.rs:688 are_any_components_enabled
  are_any_components_enabled(self: LinkSelfContainedComponents): boolean {
    return self !== 0;
  },

  /// Returns whether `LinkSelfContainedComponents::LINKER` is enabled.
  // rustc: compiler/rustc_target/src/spec/mod.rs:693 is_linker_enabled
  is_linker_enabled(self: LinkSelfContainedComponents): boolean {
    return LinkSelfContainedComponents.contains(self, LinkSelfContainedComponents.LINKER);
  },

  /// Returns whether `LinkSelfContainedComponents::CRT_OBJECTS` is enabled.
  // rustc: compiler/rustc_target/src/spec/mod.rs:698 is_crt_objects_enabled
  is_crt_objects_enabled(self: LinkSelfContainedComponents): boolean {
    return LinkSelfContainedComponents.contains(self, LinkSelfContainedComponents.CRT_OBJECTS);
  },

  /// Parses a single `-Clink-self-contained` well-known component, not a set of flags.
  // impl FromStr for LinkSelfContainedComponents
  // rustc: compiler/rustc_target/src/spec/mod.rs:707 from_str
  from_str(s: string): Result<LinkSelfContainedComponents, string> {
    switch (s) {
      case "crto":
        return Ok(LinkSelfContainedComponents.CRT_OBJECTS);
      case "libc":
        return Ok(LinkSelfContainedComponents.LIBC);
      case "unwind":
        return Ok(LinkSelfContainedComponents.UNWIND);
      case "linker":
        return Ok(LinkSelfContainedComponents.LINKER);
      case "sanitizers":
        return Ok(LinkSelfContainedComponents.SANITIZERS);
      case "mingw":
        return Ok(LinkSelfContainedComponents.MINGW);
      default:
        return Err(`'${s}' is not a valid link-self-contained component, expected 'crto', 'libc', 'unwind', 'linker', 'sanitizers', 'mingw'`);
    }
  },

  // crate::json::serde_deserialize_from_str!(LinkSelfContainedComponents);
  // impl schemars::JsonSchema: not ported (no markers; mod.rs:726 schema_name, 729 json_schema).

  // impl ToJson for LinkSelfContainedComponents
  // rustc: compiler/rustc_target/src/spec/mod.rs:740 to_json
  to_json(self: LinkSelfContainedComponents): Json {
    const components: string[] = LinkSelfContainedComponents.all_components()
      .filter((c) => LinkSelfContainedComponents.contains(self, c))
      .map((c) => {
        // We can unwrap because we're iterating over all the known singular components,
        // not an actual set of flags where `as_str` can fail.
        return unwrap(LinkSelfContainedComponents.as_str(c));
      });

    return slice_to_json(components, str_to_json);
  },
} as const;

// bitflags::bitflags! {
//     /// The `-C linker-features` components that can individually be enabled or disabled.
//     ///
//     /// They are feature flags intended to be a more flexible mechanism than linker flavors, and
//     /// also to prevent a combinatorial explosion of flavors whenever a new linker feature is
//     /// required. These flags are "generic", in the sense that they can work on multiple targets on
//     /// the CLI. Otherwise, one would have to select different linkers flavors for each target.
//     ///
//     /// Here are some examples of the advantages they offer:
//     /// - default feature sets for principal flavors, or for specific targets.
//     /// - flavor-specific features: for example, clang offers automatic cross-linking with
//     ///   `--target`, which gcc-style compilers don't support. The *flavor* is still a C/C++
//     ///   compiler, and we don't need to multiply the number of flavors for this use-case. Instead,
//     ///   we can have a single `+target` feature.
//     /// - umbrella features: for example if clang accumulates more features in the future than just
//     ///   the `+target` above. That could be modeled as `+clang`.
//     /// - niche features for resolving specific issues: for example, on Apple targets the linker
//     ///   flag implementing the `as-needed` native link modifier (#99424) is only possible on
//     ///   sufficiently recent linker versions.
//     /// - still allows for discovery and automation, for example via feature detection. This can be
//     ///   useful in exotic environments/build systems.
//     #[derive(Clone, Copy, PartialEq, Eq, Default)]
//     pub struct LinkerFeatures: u8 { .. }
// }
// rustc_data_structures::external_bitflags_debug! { LinkerFeatures } (not ported)
export type LinkerFeatures = number;
export const LinkerFeatures = {
  /// Invoke the linker via a C/C++ compiler (e.g. on most unix targets).
  CC: 1 << 0,
  /// Use the lld linker, either the system lld or the self-contained linker `rust-lld`.
  LLD: 1 << 1,

  /** bitflags `empty()` */
  empty: (): LinkerFeatures => 0,
  /** bitflags `contains` */
  contains: (self: LinkerFeatures, other: LinkerFeatures): boolean => (self & other) === other,
  /** bitflags `iter()`: each defined flag contained in `self`, in definition order. */
  iter(self: LinkerFeatures): LinkerFeatures[] {
    return [LinkerFeatures.CC, LinkerFeatures.LLD].filter((f) => (self & f) === f);
  },

  /// Parses a single `-C linker-features` well-known feature, not a set of flags.
  // rustc: compiler/rustc_target/src/spec/mod.rs:788 from_str
  from_str(s: string): LinkerFeatures | undefined {
    switch (s) {
      case "cc":
        return LinkerFeatures.CC;
      case "lld":
        return LinkerFeatures.LLD;
      default:
        return undefined;
    }
  },

  /// Return the linker feature name, as would be passed on the CLI.
  ///
  /// Returns `None` if the bitflags aren't a singular component (but a mix of multiple flags).
  // rustc: compiler/rustc_target/src/spec/mod.rs:799 as_str
  as_str(self: LinkerFeatures): string | undefined {
    switch (self) {
      case LinkerFeatures.CC:
        return "cc";
      case LinkerFeatures.LLD:
        return "lld";
      default:
        return undefined;
    }
  },

  /// Returns whether the `lld` linker feature is enabled.
  // rustc: compiler/rustc_target/src/spec/mod.rs:808 is_lld_enabled
  is_lld_enabled(self: LinkerFeatures): boolean {
    return LinkerFeatures.contains(self, LinkerFeatures.LLD);
  },

  /// Returns whether the `cc` linker feature is enabled.
  // rustc: compiler/rustc_target/src/spec/mod.rs:813 is_cc_enabled
  is_cc_enabled(self: LinkerFeatures): boolean {
    return LinkerFeatures.contains(self, LinkerFeatures.CC);
  },
} as const;

// crate::target_spec_enum! { #[derive(Encodable, BlobDecodable, StableHash)] pub enum PanicStrategy { .. } }
export type PanicStrategy = "Unwind" | "Abort" | "ImmediateAbort";
export const PanicStrategy = {
  Unwind: "Unwind",
  Abort: "Abort",
  ImmediateAbort: "ImmediateAbort",
  ...target_spec_enum<PanicStrategy>(
    [
      ["Unwind", "unwind"],
      ["Abort", "abort"],
      ["ImmediateAbort", "immediate-abort"],
    ],
    "panic strategy",
  ),

  // rustc: compiler/rustc_target/src/spec/mod.rs:838 desc_symbol
  desc_symbol(self: PanicStrategy): Symbol {
    switch (self) {
      case "Unwind":
        return sym.unwind;
      case "Abort":
        return sym.abort;
      case "ImmediateAbort":
        return sym.immediate_abort;
    }
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:846 unwinds
  unwinds(self: PanicStrategy): boolean {
    return self === "Unwind";
  },

  // impl IntoDiagArg for PanicStrategy
  // rustc: compiler/rustc_target/src/spec/mod.rs:863 into_diag_arg
  into_diag_arg(self: PanicStrategy, _: MutRef<PathBuf | undefined>): DiagArgValue {
    return { $: "Str", _0: PanicStrategy.desc(self) };
  },
} as const;

// #[derive(Clone, Copy, Debug, PartialEq, Hash, Encodable, BlobDecodable, StableHash)]
export type OnBrokenPipe = "Default" | "Kill" | "Error" | "Inherit";
export const OnBrokenPipe = { Default: "Default", Kill: "Kill", Error: "Error", Inherit: "Inherit" } as const;

// crate::target_spec_enum! { pub enum RelroLevel { .. } parse_error_type = "relro level"; }
export type RelroLevel = "Full" | "Partial" | "Off" | "None";
export const RelroLevel = {
  Full: "Full",
  Partial: "Partial",
  Off: "Off",
  None: "None",
  ...target_spec_enum<RelroLevel>(
    [
      ["Full", "full"],
      ["Partial", "partial"],
      ["Off", "off"],
      ["None", "none"],
    ],
    "relro level",
  ),
} as const;

// crate::target_spec_enum! { pub enum SymbolVisibility { .. } parse_error_type = "symbol visibility"; }
export type SymbolVisibility = "Hidden" | "Protected" | "Interposable";
export const SymbolVisibility = {
  Hidden: "Hidden",
  Protected: "Protected",
  Interposable: "Interposable",
  ...target_spec_enum<SymbolVisibility>(
    [
      ["Hidden", "hidden"],
      ["Protected", "protected"],
      ["Interposable", "interposable"],
    ],
    "symbol visibility",
  ),
} as const;

// #[derive(Clone, Debug, PartialEq, Hash)]
export type SmallDataThresholdSupport =
  | { readonly $: "None" }
  | { readonly $: "DefaultForArch" }
  | { readonly $: "LlvmModuleFlag"; readonly _0: string }
  | { readonly $: "LlvmArg"; readonly _0: string };
export const SmallDataThresholdSupport = {
  None: Object.freeze({ $: "None" }) as SmallDataThresholdSupport,
  DefaultForArch: Object.freeze({ $: "DefaultForArch" }) as SmallDataThresholdSupport,

  // impl FromStr for SmallDataThresholdSupport
  // rustc: compiler/rustc_target/src/spec/mod.rs:889 from_str
  from_str(s: string): Result<SmallDataThresholdSupport, string> {
    if (s === "none") {
      return Ok(SmallDataThresholdSupport.None);
    } else if (s === "default-for-arch") {
      return Ok(SmallDataThresholdSupport.DefaultForArch);
    } else if (s.startsWith("llvm-module-flag=")) {
      const flag = s.slice("llvm-module-flag=".length);
      return Ok({ $: "LlvmModuleFlag", _0: flag });
    } else if (s.startsWith("llvm-arg=")) {
      const arg = s.slice("llvm-arg=".length);
      return Ok({ $: "LlvmArg", _0: arg });
    } else {
      return Err(`'${s}' is not a valid value for small-data-threshold-support.`);
    }
  },

  // crate::json::serde_deserialize_from_str!(SmallDataThresholdSupport);
  // impl schemars::JsonSchema: not ported (no markers; mod.rs:906 schema_name, 909 json_schema).

  // impl ToJson for SmallDataThresholdSupport
  // rustc: compiler/rustc_target/src/spec/mod.rs:918 to_json
  to_json(self: SmallDataThresholdSupport): Json {
    switch (self.$) {
      case "None":
        return str_to_json("none");
      case "DefaultForArch":
        return str_to_json("default-for-arch");
      case "LlvmModuleFlag":
        return str_to_json(`llvm-module-flag=${self._0}`);
      case "LlvmArg":
        return str_to_json(`llvm-arg=${self._0}`);
    }
  },
} as const;

// crate::target_spec_enum! { pub enum MergeFunctions { .. } parse_error_type = "value for merge-functions"; }
export type MergeFunctions =
  /// Disable function merging entirely.
  | "Disabled"
  /// Allow function merging via trampolines (i.e., functions can be implemented
  /// in terms of a jump to an unrelated function with identical behavior), but
  /// not via object-format-level global aliases.
  | "Trampolines"
  /// (Default) allow function merging via either trampolines or (object format
  /// level) global aliases. LLVM will normally use global aliases for merging, but
  /// trampolines are also permissible.
  | "Aliases";
export const MergeFunctions = {
  Disabled: "Disabled",
  Trampolines: "Trampolines",
  Aliases: "Aliases",
  ...target_spec_enum<MergeFunctions>(
    [
      ["Disabled", "disabled"],
      ["Trampolines", "trampolines"],
      ["Aliases", "aliases"],
    ],
    "value for merge-functions",
  ),
} as const;

// crate::target_spec_enum! { pub enum RelocModel { .. } parse_error_type = "relocation model"; }
export type RelocModel = "Static" | "Pic" | "Pie" | "DynamicNoPic" | "Ropi" | "Rwpi" | "RopiRwpi";
export const RelocModel = {
  Static: "Static",
  Pic: "Pic",
  Pie: "Pie",
  DynamicNoPic: "DynamicNoPic",
  Ropi: "Ropi",
  Rwpi: "Rwpi",
  RopiRwpi: "RopiRwpi",
  ...target_spec_enum<RelocModel>(
    [
      ["Static", "static"],
      ["Pic", "pic"],
      ["Pie", "pie"],
      ["DynamicNoPic", "dynamic-no-pic"],
      ["Ropi", "ropi"],
      ["Rwpi", "rwpi"],
      ["RopiRwpi", "ropi-rwpi"],
    ],
    "relocation model",
  ),

  // rustc: compiler/rustc_target/src/spec/mod.rs:960 desc_symbol
  desc_symbol(self: RelocModel): Symbol {
    switch (self) {
      case "Static":
        return kw.Static;
      case "Pic":
        return sym.pic;
      case "Pie":
        return sym.pie;
      case "DynamicNoPic":
        return sym.dynamic_no_pic;
      case "Ropi":
        return sym.ropi;
      case "Rwpi":
        return sym.rwpi;
      case "RopiRwpi":
        return sym.ropi_rwpi;
    }
  },
} as const;

// crate::target_spec_enum! { pub enum CodeModel { .. } parse_error_type = "code model"; }
export type CodeModel = "Tiny" | "Small" | "Kernel" | "Medium" | "Large";
export const CodeModel = {
  Tiny: "Tiny",
  Small: "Small",
  Kernel: "Kernel",
  Medium: "Medium",
  Large: "Large",
  ...target_spec_enum<CodeModel>(
    [
      ["Tiny", "tiny"],
      ["Small", "small"],
      ["Kernel", "kernel"],
      ["Medium", "medium"],
      ["Large", "large"],
    ],
    "code model",
  ),
} as const;

// crate::target_spec_enum! {
//     /// The float ABI setting to be configured in the LLVM target machine.
//     pub enum FloatAbi { .. } parse_error_type = "float abi";
// }
export type FloatAbi = "Soft" | "Hard";
export const FloatAbi = {
  Soft: "Soft",
  Hard: "Hard",
  ...target_spec_enum<FloatAbi>(
    [
      ["Soft", "soft"],
      ["Hard", "hard"],
    ],
    "float abi",
  ),
} as const;

// crate::target_spec_enum! {
//     /// The Rustc-specific variant of the ABI used for this target.
//     pub enum RustcAbi { .. } parse_error_type = "rustc abi";
// }
export type RustcAbi =
  /// On x86-32/64, aarch64, and S390x: do not use any FPU or SIMD registers for the ABI.
  | "Softfloat"
  /// On x86-32 only: make use of SSE and SSE2 for ABI purposes.
  | "X86Sse2"
  /// On PowerPC only: build for SPE.
  | "PowerPcSpe"
  /// On SPARC-32: use the V8+ ABI.
  | "SparcV8Plus";
export const RustcAbi = {
  Softfloat: "Softfloat",
  X86Sse2: "X86Sse2",
  PowerPcSpe: "PowerPcSpe",
  SparcV8Plus: "SparcV8Plus",
  ...target_spec_enum<RustcAbi>(
    [
      ["Softfloat", "softfloat"],
      ["X86Sse2", "x86-sse2"],
      ["PowerPcSpe", "powerpc-spe"],
      ["SparcV8Plus", "sparc-v8plus"],
    ],
    "rustc abi",
  ),
} as const;

// crate::target_spec_enum! { pub enum TlsModel { .. } parse_error_type = "TLS model"; }
export type TlsModel = "GeneralDynamic" | "LocalDynamic" | "InitialExec" | "LocalExec" | "Emulated";
export const TlsModel = {
  GeneralDynamic: "GeneralDynamic",
  LocalDynamic: "LocalDynamic",
  InitialExec: "InitialExec",
  LocalExec: "LocalExec",
  Emulated: "Emulated",
  ...target_spec_enum<TlsModel>(
    [
      ["GeneralDynamic", "global-dynamic"],
      ["LocalDynamic", "local-dynamic"],
      ["InitialExec", "initial-exec"],
      ["LocalExec", "local-exec"],
      ["Emulated", "emulated"],
    ],
    "TLS model",
  ),
} as const;

// crate::target_spec_enum! {
//     /// Everything is flattened to a single enum to make the json encoding/decoding less annoying.
//     pub enum LinkOutputKind { .. } parse_error_type = "CRT object kind";
// }
export type LinkOutputKind =
  /// Dynamically linked non position-independent executable.
  | "DynamicNoPicExe"
  /// Dynamically linked position-independent executable.
  | "DynamicPicExe"
  /// Statically linked non position-independent executable.
  | "StaticNoPicExe"
  /// Statically linked position-independent executable.
  | "StaticPicExe"
  /// Regular dynamic library ("dynamically linked").
  | "DynamicDylib"
  /// Dynamic library with bundled libc ("statically linked").
  | "StaticDylib"
  /// WASI module with a lifetime past the _initialize entry point
  | "WasiReactorExe";
export const LinkOutputKind = {
  DynamicNoPicExe: "DynamicNoPicExe",
  DynamicPicExe: "DynamicPicExe",
  StaticNoPicExe: "StaticNoPicExe",
  StaticPicExe: "StaticPicExe",
  DynamicDylib: "DynamicDylib",
  StaticDylib: "StaticDylib",
  WasiReactorExe: "WasiReactorExe",
  ...target_spec_enum<LinkOutputKind>(
    [
      ["DynamicNoPicExe", "dynamic-nopic-exe"],
      ["DynamicPicExe", "dynamic-pic-exe"],
      ["StaticNoPicExe", "static-nopic-exe"],
      ["StaticPicExe", "static-pic-exe"],
      ["DynamicDylib", "dynamic-dylib"],
      ["StaticDylib", "static-dylib"],
      ["WasiReactorExe", "wasi-reactor-exe"],
    ],
    "CRT object kind",
  ),

  // rustc: compiler/rustc_target/src/spec/mod.rs:1046 can_link_dylib
  can_link_dylib(self: LinkOutputKind): boolean {
    switch (self) {
      case "StaticNoPicExe":
      case "StaticPicExe":
        return false;
      case "DynamicNoPicExe":
      case "DynamicPicExe":
      case "DynamicDylib":
      case "StaticDylib":
      case "WasiReactorExe":
        return true;
    }
  },
} as const;
/** Derived `Ord` of `LinkOutputKind` (declaration order). */
export function LinkOutputKind_cmp(a: LinkOutputKind, b: LinkOutputKind): number {
  return LinkOutputKind.ALL.indexOf(a) - LinkOutputKind.ALL.indexOf(b);
}

export type LinkArgs = Map<LinkerFlavor, string[]>;
export type LinkArgsCli = Map<LinkerFlavorCli, string[]>;

// crate::target_spec_enum! {
//     /// Which kind of debuginfo does the target use?
//     ///
//     /// Useful in determining whether a target supports Split DWARF (a target with
//     /// `DebuginfoKind::Dwarf` and supporting `SplitDebuginfo::Unpacked` for example).
//     #[derive(Default)]
//     pub enum DebuginfoKind { .. } parse_error_type = "debuginfo kind";
// }
export type DebuginfoKind =
  /// DWARF debuginfo (such as that used on `x86_64_unknown_linux_gnu`).
  // #[default]
  | "Dwarf"
  /// DWARF debuginfo in dSYM files (such as on Apple platforms).
  | "DwarfDsym"
  /// Program database files (such as on Windows).
  | "Pdb";
export const DebuginfoKind = {
  Dwarf: "Dwarf",
  DwarfDsym: "DwarfDsym",
  Pdb: "Pdb",
  /** `#[derive(Default)]` (`#[default] Dwarf`) */
  default: (): DebuginfoKind => "Dwarf",
  ...target_spec_enum<DebuginfoKind>(
    [
      ["Dwarf", "dwarf"],
      ["DwarfDsym", "dwarf-dsym"],
      ["Pdb", "pdb"],
    ],
    "debuginfo kind",
  ),
} as const;

// crate::target_spec_enum! {
//     #[derive(Default, Encodable, Decodable)]
//     pub enum SplitDebuginfo { .. } parse_error_type = "split debuginfo";
// }
export type SplitDebuginfo =
  /// Split debug-information is disabled, meaning that on supported platforms
  /// you can find all debug information in the executable itself. This is
  /// only supported for ELF effectively.
  ///
  /// * Windows - not supported
  /// * macOS - don't run `dsymutil`
  /// * ELF - `.debug_*` sections
  // #[default]
  | "Off"

  /// Split debug-information can be found in a "packed" location separate
  /// from the final artifact. This is supported on all platforms.
  ///
  /// * Windows - `*.pdb`
  /// * macOS - `*.dSYM` (run `dsymutil`)
  /// * ELF - `*.dwp` (run `thorin`)
  | "Packed"

  /// Split debug-information can be found in individual object files on the
  /// filesystem. The main executable may point to the object files.
  ///
  /// * Windows - not supported
  /// * macOS - supported, scattered object files
  /// * ELF - supported, scattered `*.dwo` or `*.o` files (see `SplitDwarfKind`)
  | "Unpacked";
export const SplitDebuginfo = {
  Off: "Off",
  Packed: "Packed",
  Unpacked: "Unpacked",
  /** `#[derive(Default)]` (`#[default] Off`) */
  default: (): SplitDebuginfo => "Off",
  ...target_spec_enum<SplitDebuginfo>(
    [
      ["Off", "off"],
      ["Packed", "packed"],
      ["Unpacked", "unpacked"],
    ],
    "split debuginfo",
  ),

  // into_diag_arg_using_display!(SplitDebuginfo);
  into_diag_arg(self: SplitDebuginfo, _: MutRef<PathBuf | undefined>): DiagArgValue {
    return { $: "Str", _0: SplitDebuginfo.display(self) };
  },
} as const;

// #[derive(Clone, Debug, PartialEq, Eq, serde_derive::Deserialize, schemars::JsonSchema)]
// #[serde(tag = "kind")]
// #[serde(rename_all = "kebab-case")]
export type StackProbeType =
  /// Don't emit any stack probes.
  | { readonly $: "None" }
  /// It is harmless to use this option even on targets that do not have backend support for
  /// stack probes as the failure mode is the same as if no stack-probe option was specified in
  /// the first place.
  | { readonly $: "Inline" }
  /// Call `__rust_probestack` whenever stack needs to be probed.
  | { readonly $: "Call" }
  /// Use inline option for LLVM versions later than specified in `min_llvm_version_for_inline`
  /// and call `__rust_probestack` otherwise.
  | {
      readonly $: "InlineOrCall";
      // #[serde(rename = "min-llvm-version-for-inline")]
      readonly min_llvm_version_for_inline: readonly [number, number, number];
    };
export const StackProbeType = {
  None: Object.freeze({ $: "None" }) as StackProbeType,
  Inline: Object.freeze({ $: "Inline" }) as StackProbeType,
  Call: Object.freeze({ $: "Call" }) as StackProbeType,

  // impl ToJson for StackProbeType
  // rustc: compiler/rustc_target/src/spec/mod.rs:1136 to_json
  to_json(self: StackProbeType): Json {
    const o = new JsonObject();
    switch (self.$) {
      case "None":
        o.insert("kind", str_to_json("none"));
        break;
      case "Inline":
        o.insert("kind", str_to_json("inline"));
        break;
      case "Call":
        o.insert("kind", str_to_json("call"));
        break;
      case "InlineOrCall": {
        const [maj, min, patch] = self.min_llvm_version_for_inline;
        o.insert("kind", str_to_json("inline-or-call"));
        o.insert("min-llvm-version-for-inline", [num_to_json(maj), num_to_json(min), num_to_json(patch)]);
        break;
      }
    }
    return o;
  },
} as const;

// impl ToJson for SanitizerSet
// rustc: compiler/rustc_target/src/spec/mod.rs:1161 to_json
export function SanitizerSet_to_json(self: SanitizerSet): Json {
  const out: Json[] = [];
  for (const v of SanitizerSet.iter(self)) {
    const s = SanitizerSet.as_str(v);
    // `.collect::<Option<Vec<_>>>().unwrap_or_default()`
    if (s === undefined) return slice_to_json([], str_to_json);
    out.push(str_to_json(s));
  }
  return out;
}

// crate::target_spec_enum! { pub enum FramePointer { .. } parse_error_type = "frame pointer"; }
export type FramePointer =
  /// Forces the machine code generator to always preserve the frame pointers.
  | "Always"
  /// Forces the machine code generator to preserve the frame pointers except for the leaf
  /// functions (i.e. those that don't call other functions).
  | "NonLeaf"
  /// Allows the machine code generator to omit the frame pointers.
  ///
  /// This option does not guarantee that the frame pointers will be omitted.
  | "MayOmit";
export const FramePointer = {
  Always: "Always",
  NonLeaf: "NonLeaf",
  MayOmit: "MayOmit",
  ...target_spec_enum<FramePointer>(
    [
      ["Always", "always"],
      ["NonLeaf", "non-leaf"],
      ["MayOmit", "may-omit"],
    ],
    "frame pointer",
  ),

  /// It is intended that the "force frame pointer" transition is "one way"
  /// so this convenience assures such if used
  // #[inline]
  // rustc: compiler/rustc_target/src/spec/mod.rs:1190 ratchet
  ratchet(self: MutRef<FramePointer>, rhs: FramePointer): FramePointer {
    if (self.value === "Always" || rhs === "Always") {
      self.value = "Always";
    } else if (self.value === "NonLeaf" || rhs === "NonLeaf") {
      self.value = "NonLeaf";
    } else {
      self.value = "MayOmit";
    }
    return self.value;
  },
} as const;

// crate::target_spec_enum! {
//     /// Controls use of stack canaries.
//     #[derive(Encodable, BlobDecodable, StableHash)]
//     pub enum StackProtector { .. } parse_error_type = "stack protector";
// }
export type StackProtector =
  /// Disable stack canary generation.
  | "None"

  /// On LLVM, mark all generated LLVM functions with the `ssp` attribute (see
  /// llvm/docs/LangRef.rst). This triggers stack canary generation in
  /// functions which contain an array of a byte-sized type with more than
  /// eight elements.
  | "Basic"

  /// On LLVM, mark all generated LLVM functions with the `sspstrong`
  /// attribute (see llvm/docs/LangRef.rst). This triggers stack canary
  /// generation in functions which either contain an array, or which take
  /// the address of a local variable.
  | "Strong"

  /// Generate stack canaries in all functions.
  | "All";
export const StackProtector = {
  None: "None",
  Basic: "Basic",
  Strong: "Strong",
  All: "All",
  ...target_spec_enum<StackProtector>(
    [
      ["None", "none"],
      ["Basic", "basic"],
      ["Strong", "strong"],
      ["All", "all"],
    ],
    "stack protector",
  ),

  // into_diag_arg_using_display!(StackProtector);
  into_diag_arg(self: StackProtector, _: MutRef<PathBuf | undefined>): DiagArgValue {
    return { $: "Str", _0: StackProtector.display(self) };
  },
} as const;

// crate::target_spec_enum! { pub enum BinaryFormat { .. } parse_error_type = "binary format"; }
export type BinaryFormat = "Coff" | "Elf" | "MachO" | "Wasm" | "Xcoff";
export const BinaryFormat = {
  Coff: "Coff",
  Elf: "Elf",
  MachO: "MachO",
  Wasm: "Wasm",
  Xcoff: "Xcoff",
  ...target_spec_enum<BinaryFormat>(
    [
      ["Coff", "coff"],
      ["Elf", "elf"],
      ["MachO", "mach-o"],
      ["Wasm", "wasm"],
      ["Xcoff", "xcoff"],
    ],
    "binary format",
  ),

  /// Returns [`object::BinaryFormat`] for given `BinaryFormat`
  // not ported (no marker; mod.rs:1242 to_object): needs the `object` crate (wave 11).
  to_object(_self: BinaryFormat): never {
    return unported("rustc_target::spec::BinaryFormat::to_object (object crate)");
  },

  // rustc: compiler/rustc_target/src/spec/mod.rs:1252 desc_symbol
  desc_symbol(self: BinaryFormat): Symbol {
    switch (self) {
      case "Coff":
        return sym.coff;
      case "Elf":
        return sym.elf;
      case "MachO":
        return sym.macho;
      case "Wasm":
        return sym.wasm;
      case "Xcoff":
        return sym.xcoff;
    }
  },
} as const;

// impl ToJson for Align
// rustc: compiler/rustc_target/src/spec/mod.rs:1264 to_json
export function Align_to_json(self: Align): Json {
  return num_to_json(self.bits());
}

// macro_rules! supported_targets { .. }
// PORT: `mod targets { $(pub(crate) mod $module;)+ }`: only the modules in `PORTED_TARGETS` are ported
// (`./targets/<module>.ts`); `load_builtin` of any other listed tuple calls `unported`.

/** `supported_targets! { ($tuple, $module), .. }`: every built-in tuple and its module, in order. */
const SUPPORTED_TARGETS: readonly (readonly [string, string])[] = [
  ["x86_64-unknown-linux-gnu", "x86_64_unknown_linux_gnu"],
  ["x86_64-unknown-linux-gnux32", "x86_64_unknown_linux_gnux32"],
  ["i686-unknown-linux-gnu", "i686_unknown_linux_gnu"],
  ["i586-unknown-linux-gnu", "i586_unknown_linux_gnu"],
  ["loongarch64-unknown-linux-gnu", "loongarch64_unknown_linux_gnu"],
  ["loongarch64-unknown-linux-musl", "loongarch64_unknown_linux_musl"],
  ["m68k-unknown-linux-gnu", "m68k_unknown_linux_gnu"],
  ["m68k-unknown-none-elf", "m68k_unknown_none_elf"],
  ["csky-unknown-linux-gnuabiv2", "csky_unknown_linux_gnuabiv2"],
  ["csky-unknown-linux-gnuabiv2hf", "csky_unknown_linux_gnuabiv2hf"],
  ["mips-unknown-linux-gnu", "mips_unknown_linux_gnu"],
  ["mips64-unknown-linux-gnuabi64", "mips64_unknown_linux_gnuabi64"],
  ["mips64el-unknown-linux-gnuabi64", "mips64el_unknown_linux_gnuabi64"],
  ["mipsisa32r6-unknown-linux-gnu", "mipsisa32r6_unknown_linux_gnu"],
  ["mipsisa32r6el-unknown-linux-gnu", "mipsisa32r6el_unknown_linux_gnu"],
  ["mipsisa64r6-unknown-linux-gnuabi64", "mipsisa64r6_unknown_linux_gnuabi64"],
  ["mipsisa64r6el-unknown-linux-gnuabi64", "mipsisa64r6el_unknown_linux_gnuabi64"],
  ["mipsel-unknown-linux-gnu", "mipsel_unknown_linux_gnu"],
  ["powerpc-unknown-linux-gnu", "powerpc_unknown_linux_gnu"],
  ["powerpc-unknown-linux-gnuspe", "powerpc_unknown_linux_gnuspe"],
  ["powerpc-unknown-linux-musl", "powerpc_unknown_linux_musl"],
  ["powerpc-unknown-linux-muslspe", "powerpc_unknown_linux_muslspe"],
  ["powerpc64-ibm-aix", "powerpc64_ibm_aix"],
  ["powerpc64-unknown-linux-gnu", "powerpc64_unknown_linux_gnu"],
  ["powerpc64-unknown-linux-gnuelfv2", "powerpc64_unknown_linux_gnuelfv2"],
  ["powerpc64-unknown-linux-musl", "powerpc64_unknown_linux_musl"],
  ["powerpc64le-unknown-linux-gnu", "powerpc64le_unknown_linux_gnu"],
  ["powerpc64le-unknown-linux-musl", "powerpc64le_unknown_linux_musl"],
  ["s390x-unknown-linux-gnu", "s390x_unknown_linux_gnu"],
  ["s390x-unknown-none-softfloat", "s390x_unknown_none_softfloat"],
  ["s390x-unknown-linux-musl", "s390x_unknown_linux_musl"],
  ["sparc-unknown-linux-gnu", "sparc_unknown_linux_gnu"],
  ["sparc64-unknown-linux-gnu", "sparc64_unknown_linux_gnu"],
  ["arm-unknown-linux-gnueabi", "arm_unknown_linux_gnueabi"],
  ["arm-unknown-linux-gnueabihf", "arm_unknown_linux_gnueabihf"],
  ["armeb-unknown-linux-gnueabi", "armeb_unknown_linux_gnueabi"],
  ["arm-unknown-linux-musleabi", "arm_unknown_linux_musleabi"],
  ["arm-unknown-linux-musleabihf", "arm_unknown_linux_musleabihf"],
  ["armv4t-unknown-linux-gnueabi", "armv4t_unknown_linux_gnueabi"],
  ["armv5te-unknown-linux-gnueabi", "armv5te_unknown_linux_gnueabi"],
  ["armv5te-unknown-linux-musleabi", "armv5te_unknown_linux_musleabi"],
  ["armv5te-unknown-linux-uclibceabi", "armv5te_unknown_linux_uclibceabi"],
  ["armv7-unknown-linux-gnueabi", "armv7_unknown_linux_gnueabi"],
  ["armv7-unknown-linux-gnueabihf", "armv7_unknown_linux_gnueabihf"],
  ["thumbv7neon-unknown-linux-gnueabihf", "thumbv7neon_unknown_linux_gnueabihf"],
  ["thumbv7neon-unknown-linux-musleabihf", "thumbv7neon_unknown_linux_musleabihf"],
  ["armv7-unknown-linux-musleabi", "armv7_unknown_linux_musleabi"],
  ["armv7-unknown-linux-musleabihf", "armv7_unknown_linux_musleabihf"],
  ["aarch64-unknown-linux-gnu", "aarch64_unknown_linux_gnu"],
  ["aarch64-unknown-linux-musl", "aarch64_unknown_linux_musl"],
  ["aarch64-unknown-linux-pauthtest", "aarch64_unknown_linux_pauthtest"],
  ["aarch64_be-unknown-linux-musl", "aarch64_be_unknown_linux_musl"],
  ["x86_64-unknown-linux-musl", "x86_64_unknown_linux_musl"],
  ["i686-unknown-linux-musl", "i686_unknown_linux_musl"],
  ["i586-unknown-linux-musl", "i586_unknown_linux_musl"],
  ["mips-unknown-linux-musl", "mips_unknown_linux_musl"],
  ["mipsel-unknown-linux-musl", "mipsel_unknown_linux_musl"],
  ["mips64-unknown-linux-muslabi64", "mips64_unknown_linux_muslabi64"],
  ["mips64el-unknown-linux-muslabi64", "mips64el_unknown_linux_muslabi64"],
  ["hexagon-unknown-linux-musl", "hexagon_unknown_linux_musl"],
  ["hexagon-unknown-none-elf", "hexagon_unknown_none_elf"],
  ["hexagon-unknown-qurt", "hexagon_unknown_qurt"],

  ["mips-unknown-linux-uclibc", "mips_unknown_linux_uclibc"],
  ["mipsel-unknown-linux-uclibc", "mipsel_unknown_linux_uclibc"],

  ["i686-linux-android", "i686_linux_android"],
  ["x86_64-linux-android", "x86_64_linux_android"],
  ["arm-linux-androideabi", "arm_linux_androideabi"],
  ["armv7-linux-androideabi", "armv7_linux_androideabi"],
  ["thumbv7neon-linux-androideabi", "thumbv7neon_linux_androideabi"],
  ["aarch64-linux-android", "aarch64_linux_android"],
  ["riscv64-linux-android", "riscv64_linux_android"],

  ["aarch64-unknown-freebsd", "aarch64_unknown_freebsd"],
  ["armv6-unknown-freebsd", "armv6_unknown_freebsd"],
  ["armv7-unknown-freebsd", "armv7_unknown_freebsd"],
  ["i686-unknown-freebsd", "i686_unknown_freebsd"],
  ["powerpc-unknown-freebsd", "powerpc_unknown_freebsd"],
  ["powerpc64-unknown-freebsd", "powerpc64_unknown_freebsd"],
  ["powerpc64le-unknown-freebsd", "powerpc64le_unknown_freebsd"],
  ["riscv64gc-unknown-freebsd", "riscv64gc_unknown_freebsd"],
  ["x86_64-unknown-freebsd", "x86_64_unknown_freebsd"],

  ["x86_64-unknown-dragonfly", "x86_64_unknown_dragonfly"],

  ["aarch64-unknown-openbsd", "aarch64_unknown_openbsd"],
  ["i686-unknown-openbsd", "i686_unknown_openbsd"],
  ["powerpc-unknown-openbsd", "powerpc_unknown_openbsd"],
  ["powerpc64-unknown-openbsd", "powerpc64_unknown_openbsd"],
  ["riscv64gc-unknown-openbsd", "riscv64gc_unknown_openbsd"],
  ["sparc64-unknown-openbsd", "sparc64_unknown_openbsd"],
  ["x86_64-unknown-openbsd", "x86_64_unknown_openbsd"],

  ["aarch64-unknown-netbsd", "aarch64_unknown_netbsd"],
  ["aarch64_be-unknown-netbsd", "aarch64_be_unknown_netbsd"],
  ["armv6-unknown-netbsd-eabihf", "armv6_unknown_netbsd_eabihf"],
  ["armv7-unknown-netbsd-eabihf", "armv7_unknown_netbsd_eabihf"],
  ["i586-unknown-netbsd", "i586_unknown_netbsd"],
  ["i686-unknown-netbsd", "i686_unknown_netbsd"],
  ["mipsel-unknown-netbsd", "mipsel_unknown_netbsd"],
  ["powerpc-unknown-netbsd", "powerpc_unknown_netbsd"],
  ["riscv64gc-unknown-netbsd", "riscv64gc_unknown_netbsd"],
  ["sparc64-unknown-netbsd", "sparc64_unknown_netbsd"],
  ["x86_64-unknown-netbsd", "x86_64_unknown_netbsd"],

  ["i686-unknown-haiku", "i686_unknown_haiku"],
  ["x86_64-unknown-haiku", "x86_64_unknown_haiku"],

  ["aarch64-unknown-helenos", "aarch64_unknown_helenos"],
  ["i686-unknown-helenos", "i686_unknown_helenos"],
  ["powerpc-unknown-helenos", "powerpc_unknown_helenos"],
  ["sparc64-unknown-helenos", "sparc64_unknown_helenos"],
  ["x86_64-unknown-helenos", "x86_64_unknown_helenos"],

  ["i686-unknown-hurd-gnu", "i686_unknown_hurd_gnu"],
  ["x86_64-unknown-hurd-gnu", "x86_64_unknown_hurd_gnu"],

  ["aarch64-apple-darwin", "aarch64_apple_darwin"],
  ["arm64e-apple-darwin", "arm64e_apple_darwin"],
  ["x86_64-apple-darwin", "x86_64_apple_darwin"],
  ["x86_64h-apple-darwin", "x86_64h_apple_darwin"],
  ["i686-apple-darwin", "i686_apple_darwin"],

  ["aarch64-unknown-fuchsia", "aarch64_unknown_fuchsia"],
  ["riscv64gc-unknown-fuchsia", "riscv64gc_unknown_fuchsia"],
  ["x86_64-unknown-fuchsia", "x86_64_unknown_fuchsia"],

  ["avr-none", "avr_none"],

  ["aarch64-unknown-l4re-uclibc", "aarch64_unknown_l4re_uclibc"],
  ["x86_64-unknown-l4re-uclibc", "x86_64_unknown_l4re_uclibc"],

  ["aarch64-unknown-redox", "aarch64_unknown_redox"],
  ["i586-unknown-redox", "i586_unknown_redox"],
  ["riscv64gc-unknown-redox", "riscv64gc_unknown_redox"],
  ["x86_64-unknown-redox", "x86_64_unknown_redox"],

  ["x86_64-unknown-managarm-mlibc", "x86_64_unknown_managarm_mlibc"],
  ["aarch64-unknown-managarm-mlibc", "aarch64_unknown_managarm_mlibc"],
  ["riscv64gc-unknown-managarm-mlibc", "riscv64gc_unknown_managarm_mlibc"],

  ["i386-apple-ios", "i386_apple_ios"],
  ["x86_64-apple-ios", "x86_64_apple_ios"],
  ["aarch64-apple-ios", "aarch64_apple_ios"],
  ["arm64e-apple-ios", "arm64e_apple_ios"],
  ["armv7s-apple-ios", "armv7s_apple_ios"],
  ["x86_64-apple-ios-macabi", "x86_64_apple_ios_macabi"],
  ["aarch64-apple-ios-macabi", "aarch64_apple_ios_macabi"],
  ["aarch64-apple-ios-sim", "aarch64_apple_ios_sim"],

  ["aarch64-apple-tvos", "aarch64_apple_tvos"],
  ["aarch64-apple-tvos-sim", "aarch64_apple_tvos_sim"],
  ["arm64e-apple-tvos", "arm64e_apple_tvos"],
  ["x86_64-apple-tvos", "x86_64_apple_tvos"],

  ["armv7k-apple-watchos", "armv7k_apple_watchos"],
  ["arm64_32-apple-watchos", "arm64_32_apple_watchos"],
  ["x86_64-apple-watchos-sim", "x86_64_apple_watchos_sim"],
  ["aarch64-apple-watchos", "aarch64_apple_watchos"],
  ["aarch64-apple-watchos-sim", "aarch64_apple_watchos_sim"],

  ["aarch64-apple-visionos", "aarch64_apple_visionos"],
  ["aarch64-apple-visionos-sim", "aarch64_apple_visionos_sim"],

  ["armebv7r-none-eabi", "armebv7r_none_eabi"],
  ["armebv7r-none-eabihf", "armebv7r_none_eabihf"],
  ["armv7r-none-eabi", "armv7r_none_eabi"],
  ["thumbv7r-none-eabi", "thumbv7r_none_eabi"],
  ["armv7r-none-eabihf", "armv7r_none_eabihf"],
  ["thumbv7r-none-eabihf", "thumbv7r_none_eabihf"],
  ["armv8r-none-eabihf", "armv8r_none_eabihf"],
  ["thumbv8r-none-eabihf", "thumbv8r_none_eabihf"],

  ["armv7-rtems-eabihf", "armv7_rtems_eabihf"],

  ["x86_64-pc-solaris", "x86_64_pc_solaris"],
  ["sparcv9-sun-solaris", "sparcv9_sun_solaris"],

  ["x86_64-unknown-illumos", "x86_64_unknown_illumos"],
  ["aarch64-unknown-illumos", "aarch64_unknown_illumos"],

  ["x86_64-pc-windows-gnu", "x86_64_pc_windows_gnu"],
  ["x86_64-uwp-windows-gnu", "x86_64_uwp_windows_gnu"],
  ["x86_64-win7-windows-gnu", "x86_64_win7_windows_gnu"],
  ["i686-pc-windows-gnu", "i686_pc_windows_gnu"],
  ["i686-uwp-windows-gnu", "i686_uwp_windows_gnu"],
  ["i686-win7-windows-gnu", "i686_win7_windows_gnu"],

  ["aarch64-pc-windows-gnullvm", "aarch64_pc_windows_gnullvm"],
  ["i686-pc-windows-gnullvm", "i686_pc_windows_gnullvm"],
  ["x86_64-pc-windows-gnullvm", "x86_64_pc_windows_gnullvm"],

  ["aarch64-pc-windows-msvc", "aarch64_pc_windows_msvc"],
  ["aarch64-uwp-windows-msvc", "aarch64_uwp_windows_msvc"],
  ["arm64ec-pc-windows-msvc", "arm64ec_pc_windows_msvc"],
  ["x86_64-pc-windows-msvc", "x86_64_pc_windows_msvc"],
  ["x86_64-uwp-windows-msvc", "x86_64_uwp_windows_msvc"],
  ["x86_64-win7-windows-msvc", "x86_64_win7_windows_msvc"],
  ["i686-pc-windows-msvc", "i686_pc_windows_msvc"],
  ["i686-uwp-windows-msvc", "i686_uwp_windows_msvc"],
  ["i686-win7-windows-msvc", "i686_win7_windows_msvc"],
  ["thumbv7a-pc-windows-msvc", "thumbv7a_pc_windows_msvc"],
  ["thumbv7a-uwp-windows-msvc", "thumbv7a_uwp_windows_msvc"],

  ["wasm32-unknown-emscripten", "wasm32_unknown_emscripten"],
  ["wasm32-unknown-unknown", "wasm32_unknown_unknown"],
  ["wasm32v1-none", "wasm32v1_none"],
  ["wasm32-wasip1", "wasm32_wasip1"],
  ["wasm32-wasip2", "wasm32_wasip2"],
  ["wasm32-wasip3", "wasm32_wasip3"],
  ["wasm32-wasip1-threads", "wasm32_wasip1_threads"],
  ["wasm32-wali-linux-musl", "wasm32_wali_linux_musl"],
  ["wasm64-unknown-unknown", "wasm64_unknown_unknown"],

  ["thumbv6m-none-eabi", "thumbv6m_none_eabi"],
  ["thumbv7m-none-eabi", "thumbv7m_none_eabi"],
  ["thumbv7em-none-eabi", "thumbv7em_none_eabi"],
  ["thumbv7em-none-eabihf", "thumbv7em_none_eabihf"],
  ["thumbv8m.base-none-eabi", "thumbv8m_base_none_eabi"],
  ["thumbv8m.main-none-eabi", "thumbv8m_main_none_eabi"],
  ["thumbv8m.main-none-eabihf", "thumbv8m_main_none_eabihf"],

  ["armv7a-none-eabi", "armv7a_none_eabi"],
  ["thumbv7a-none-eabi", "thumbv7a_none_eabi"],
  ["armv7a-none-eabihf", "armv7a_none_eabihf"],
  ["thumbv7a-none-eabihf", "thumbv7a_none_eabihf"],
  ["armv7a-nuttx-eabi", "armv7a_nuttx_eabi"],
  ["armv7a-nuttx-eabihf", "armv7a_nuttx_eabihf"],
  ["thumbv7a-vex-v5", "thumbv7a_vex_v5"],

  ["msp430-none-elf", "msp430_none_elf"],

  ["aarch64_be-unknown-hermit", "aarch64_be_unknown_hermit"],
  ["aarch64-unknown-hermit", "aarch64_unknown_hermit"],
  ["riscv64gc-unknown-hermit", "riscv64gc_unknown_hermit"],
  ["x86_64-unknown-hermit", "x86_64_unknown_hermit"],
  ["x86_64-unknown-motor", "x86_64_unknown_motor"],

  ["x86_64-unikraft-linux-musl", "x86_64_unikraft_linux_musl"],

  ["armv7-unknown-trusty", "armv7_unknown_trusty"],
  ["aarch64-unknown-trusty", "aarch64_unknown_trusty"],
  ["x86_64-unknown-trusty", "x86_64_unknown_trusty"],

  ["riscv32i-unknown-none-elf", "riscv32i_unknown_none_elf"],
  ["riscv32im-risc0-zkvm-elf", "riscv32im_risc0_zkvm_elf"],
  ["riscv32im-unknown-none-elf", "riscv32im_unknown_none_elf"],
  ["riscv32ima-unknown-none-elf", "riscv32ima_unknown_none_elf"],
  ["riscv32imc-unknown-none-elf", "riscv32imc_unknown_none_elf"],
  ["riscv32imfc-unknown-none-elf", "riscv32imfc_unknown_none_elf"],
  ["riscv32imc-esp-espidf", "riscv32imc_esp_espidf"],
  ["riscv32imac-esp-espidf", "riscv32imac_esp_espidf"],
  ["riscv32imafc-esp-espidf", "riscv32imafc_esp_espidf"],

  ["riscv32e-unknown-none-elf", "riscv32e_unknown_none_elf"],
  ["riscv32em-unknown-none-elf", "riscv32em_unknown_none_elf"],
  ["riscv32emc-unknown-none-elf", "riscv32emc_unknown_none_elf"],

  ["riscv32imac-unknown-none-elf", "riscv32imac_unknown_none_elf"],
  ["riscv32imafc-unknown-none-elf", "riscv32imafc_unknown_none_elf"],
  ["riscv32imac-unknown-xous-elf", "riscv32imac_unknown_xous_elf"],
  ["riscv32gc-unknown-linux-gnu", "riscv32gc_unknown_linux_gnu"],
  ["riscv32gc-unknown-linux-musl", "riscv32gc_unknown_linux_musl"],
  ["riscv64im-unknown-none-elf", "riscv64im_unknown_none_elf"],
  ["riscv64imac-unknown-none-elf", "riscv64imac_unknown_none_elf"],
  ["riscv64gc-unknown-none-elf", "riscv64gc_unknown_none_elf"],
  ["riscv64gc-unknown-linux-gnu", "riscv64gc_unknown_linux_gnu"],
  ["riscv64gc-unknown-linux-musl", "riscv64gc_unknown_linux_musl"],
  ["riscv64a23-unknown-linux-gnu", "riscv64a23_unknown_linux_gnu"],

  ["sparc-unknown-none-elf", "sparc_unknown_none_elf"],

  ["loongarch32-unknown-none", "loongarch32_unknown_none"],
  ["loongarch32-unknown-none-softfloat", "loongarch32_unknown_none_softfloat"],
  ["loongarch64-unknown-none", "loongarch64_unknown_none"],
  ["loongarch64-unknown-none-softfloat", "loongarch64_unknown_none_softfloat"],

  ["aarch64-unknown-none", "aarch64_unknown_none"],
  ["aarch64-unknown-none-softfloat", "aarch64_unknown_none_softfloat"],
  ["aarch64_be-unknown-none-softfloat", "aarch64_be_unknown_none_softfloat"],
  ["aarch64-unknown-nuttx", "aarch64_unknown_nuttx"],
  ["aarch64v8r-unknown-none", "aarch64v8r_unknown_none"],
  ["aarch64v8r-unknown-none-softfloat", "aarch64v8r_unknown_none_softfloat"],

  ["x86_64-fortanix-unknown-sgx", "x86_64_fortanix_unknown_sgx"],

  ["x86_64-unknown-uefi", "x86_64_unknown_uefi"],
  ["i686-unknown-uefi", "i686_unknown_uefi"],
  ["aarch64-unknown-uefi", "aarch64_unknown_uefi"],

  ["nvptx64-nvidia-cuda", "nvptx64_nvidia_cuda"],

  ["amdgcn-amd-amdhsa", "amdgcn_amd_amdhsa"],

  ["xtensa-esp32-none-elf", "xtensa_esp32_none_elf"],
  ["xtensa-esp32-espidf", "xtensa_esp32_espidf"],
  ["xtensa-esp32s2-none-elf", "xtensa_esp32s2_none_elf"],
  ["xtensa-esp32s2-espidf", "xtensa_esp32s2_espidf"],
  ["xtensa-esp32s3-none-elf", "xtensa_esp32s3_none_elf"],
  ["xtensa-esp32s3-espidf", "xtensa_esp32s3_espidf"],

  ["i686-wrs-vxworks", "i686_wrs_vxworks"],
  ["x86_64-wrs-vxworks", "x86_64_wrs_vxworks"],
  ["armv7-wrs-vxworks-eabihf", "armv7_wrs_vxworks_eabihf"],
  ["aarch64-wrs-vxworks", "aarch64_wrs_vxworks"],
  ["powerpc-wrs-vxworks", "powerpc_wrs_vxworks"],
  ["powerpc-wrs-vxworks-spe", "powerpc_wrs_vxworks_spe"],
  ["powerpc64-wrs-vxworks", "powerpc64_wrs_vxworks"],
  ["riscv32-wrs-vxworks", "riscv32_wrs_vxworks"],
  ["riscv64-wrs-vxworks", "riscv64_wrs_vxworks"],

  ["aarch64-kmc-solid_asp3", "aarch64_kmc_solid_asp3"],
  ["armv7a-kmc-solid_asp3-eabi", "armv7a_kmc_solid_asp3_eabi"],
  ["armv7a-kmc-solid_asp3-eabihf", "armv7a_kmc_solid_asp3_eabihf"],

  ["powerpc64-sony-ps3", "powerpc64_sony_ps3"],
  ["mipsel-sony-psp", "mipsel_sony_psp"],
  ["mipsel-sony-psx", "mipsel_sony_psx"],
  ["mipsel-unknown-none", "mipsel_unknown_none"],
  ["mips-mti-none-elf", "mips_mti_none_elf"],
  ["mipsel-mti-none-elf", "mipsel_mti_none_elf"],

  ["armv4t-none-eabi", "armv4t_none_eabi"],
  ["armv5te-none-eabi", "armv5te_none_eabi"],
  ["armv6-none-eabi", "armv6_none_eabi"],
  ["armv6-none-eabihf", "armv6_none_eabihf"],
  ["thumbv4t-none-eabi", "thumbv4t_none_eabi"],
  ["thumbv5te-none-eabi", "thumbv5te_none_eabi"],
  ["thumbv6-none-eabi", "thumbv6_none_eabi"],

  ["aarch64_be-unknown-linux-gnu", "aarch64_be_unknown_linux_gnu"],
  ["aarch64-unknown-linux-gnu_ilp32", "aarch64_unknown_linux_gnu_ilp32"],
  ["aarch64_be-unknown-linux-gnu_ilp32", "aarch64_be_unknown_linux_gnu_ilp32"],

  ["bpfeb-unknown-none", "bpfeb_unknown_none"],
  ["bpfel-unknown-none", "bpfel_unknown_none"],

  ["armv6k-nintendo-3ds", "armv6k_nintendo_3ds"],

  ["aarch64-nintendo-switch-freestanding", "aarch64_nintendo_switch_freestanding"],

  ["armv7-sony-vita-newlibeabihf", "armv7_sony_vita_newlibeabihf"],

  ["armv7-unknown-linux-uclibceabi", "armv7_unknown_linux_uclibceabi"],
  ["armv7-unknown-linux-uclibceabihf", "armv7_unknown_linux_uclibceabihf"],

  ["x86_64-unknown-none", "x86_64_unknown_none"],

  ["aarch64-unknown-teeos", "aarch64_unknown_teeos"],

  ["mips64-openwrt-linux-musl", "mips64_openwrt_linux_musl"],

  ["aarch64-unknown-nto-qnx700", "aarch64_unknown_nto_qnx700"],
  ["aarch64-unknown-nto-qnx710", "aarch64_unknown_nto_qnx710"],
  ["aarch64-unknown-nto-qnx710_iosock", "aarch64_unknown_nto_qnx710_iosock"],
  ["aarch64-unknown-qnx", "aarch64_unknown_qnx"],
  ["x86_64-pc-nto-qnx710", "x86_64_pc_nto_qnx710"],
  ["x86_64-pc-nto-qnx710_iosock", "x86_64_pc_nto_qnx710_iosock"],
  ["x86_64-pc-qnx", "x86_64_pc_qnx"],
  ["i686-pc-nto-qnx700", "i686_pc_nto_qnx700"],

  ["aarch64-unknown-linux-ohos", "aarch64_unknown_linux_ohos"],
  ["armv7-unknown-linux-ohos", "armv7_unknown_linux_ohos"],
  ["loongarch64-unknown-linux-ohos", "loongarch64_unknown_linux_ohos"],
  ["x86_64-unknown-linux-ohos", "x86_64_unknown_linux_ohos"],

  ["x86_64-unknown-linux-none", "x86_64_unknown_linux_none"],

  ["thumbv6m-nuttx-eabi", "thumbv6m_nuttx_eabi"],
  ["thumbv7a-nuttx-eabi", "thumbv7a_nuttx_eabi"],
  ["thumbv7a-nuttx-eabihf", "thumbv7a_nuttx_eabihf"],
  ["thumbv7m-nuttx-eabi", "thumbv7m_nuttx_eabi"],
  ["thumbv7em-nuttx-eabi", "thumbv7em_nuttx_eabi"],
  ["thumbv7em-nuttx-eabihf", "thumbv7em_nuttx_eabihf"],
  ["thumbv8m.base-nuttx-eabi", "thumbv8m_base_nuttx_eabi"],
  ["thumbv8m.main-nuttx-eabi", "thumbv8m_main_nuttx_eabi"],
  ["thumbv8m.main-nuttx-eabihf", "thumbv8m_main_nuttx_eabihf"],
  ["riscv32imc-unknown-nuttx-elf", "riscv32imc_unknown_nuttx_elf"],
  ["riscv32imac-unknown-nuttx-elf", "riscv32imac_unknown_nuttx_elf"],
  ["riscv32imafc-unknown-nuttx-elf", "riscv32imafc_unknown_nuttx_elf"],
  ["riscv64imac-unknown-nuttx-elf", "riscv64imac_unknown_nuttx_elf"],
  ["riscv64gc-unknown-nuttx-elf", "riscv64gc_unknown_nuttx_elf"],
  ["x86_64-lynx-lynxos178", "x86_64_lynx_lynxos178"],

  ["x86_64-pc-cygwin", "x86_64_pc_cygwin"],

  ["x86_64-unknown-linux-gnuasan", "x86_64_unknown_linux_gnuasan"],
  ["x86_64-unknown-linux-gnumsan", "x86_64_unknown_linux_gnumsan"],
  ["x86_64-unknown-linux-gnutsan", "x86_64_unknown_linux_gnutsan"],

  ["aarch64-oe-linux-gnu", "aarch64_oe_linux_gnu"],
  ["armv7-oe-linux-gnueabihf", "armv7_oe_linux_gnueabihf"],
  ["i686-oe-linux-gnu", "i686_oe_linux_gnu"],
  ["riscv64-oe-linux-gnu", "riscv64_oe_linux_gnu"],
  ["x86_64-oe-linux-gnu", "x86_64_oe_linux_gnu"],

  ["aarch64-unknown-hyperlight", "aarch64_unknown_hyperlight"],
  ["x86_64-unknown-hyperlight", "x86_64_unknown_hyperlight"],
];

/// List of supported targets
export const TARGETS: readonly string[] = SUPPORTED_TARGETS.map(([tuple]) => tuple);

/**
 * The built-in target modules that are ported (`targets::$module::target`), by module name. PORT: the
 * target modules only declare functions, so this import cycle is safe (function declarations are
 * initialized before any module body runs).
 */
export const PORTED_TARGETS: ReadonlyMap<string, () => Target> = new Map(
  Object.entries(targets as Record<string, { target: () => Target }>).map(([m, ns]) => [m, ns.target]),
);

// rustc: compiler/rustc_target/src/spec/mod.rs:1278 load_builtin
function load_builtin(target: string): Target | undefined {
  const entry = SUPPORTED_TARGETS.find(([tuple]) => tuple === target);
  if (entry === undefined) return undefined;
  const f = PORTED_TARGETS.get(entry[1]);
  if (f === undefined) return unported(`rustc_target::spec::targets::${entry[1]} (built-in target ${target})`);
  const t = f();
  // debug!("got builtin target: {:?}", t);
  return t;
}

// rustc: compiler/rustc_target/src/spec/mod.rs:1287 load_all_builtins
function load_all_builtins(): Target[] {
  return SUPPORTED_TARGETS.map(([tuple]) => unwrap(load_builtin(tuple)));
}

/// Cow-Vec-Str: Cow<'static, [Cow<'static, str>]>
// macro_rules! cvs { .. }  PORT: `cvs![a, b]` is the array literal `[a, b]`.

/// Warnings encountered when parsing the target `json`.
///
/// Includes fields that weren't recognized and fields that don't have the expected type.
// #[derive(Debug, PartialEq)]
export class TargetWarnings {
  constructor(readonly unused_fields: string[]) {}

  // rustc: compiler/rustc_target/src/spec/mod.rs:1735 empty
  static empty(): TargetWarnings {
    return new TargetWarnings([]);
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:1739 warning_messages
  warning_messages(): string[] {
    const warnings: string[] = [];
    if (this.unused_fields.length !== 0) {
      warnings.push(`target json file contains unused fields: ${this.unused_fields.join(", ")}`);
    }
    return warnings;
  }
}

/// For the [`Target::check_consistency`] function, determines whether the given target is a builtin or a JSON
/// target.
// #[derive(Copy, Clone, Debug, PartialEq)]
export type TargetKind = "Json" | "Builtin";


// crate::target_spec_enum! { pub enum Arch { .. } other_variant = Other; }
export type ArchVariant = "AArch64" | "AmdGpu" | "Arm" | "Arm64EC" | "Avr" | "Bpf" | "CSky" | "Hexagon" | "LoongArch32" | "LoongArch64" | "M68k" | "Mips" | "Mips32r6" | "Mips64" | "Mips64r6" | "Msp430" | "Nvptx64" | "PowerPC" | "PowerPC64" | "RiscV32" | "RiscV64" | "S390x" | "Sparc" | "Sparc64" | "SpirV" | "Wasm32" | "Wasm64" | "X86" | "X86_64" | "Xtensa";
export type Arch = TargetSpecOther<ArchVariant, "Other">;
const Arch_impl = target_spec_other_enum<ArchVariant, "Other">(
  [
    ["AArch64", "aarch64"],
    ["AmdGpu", "amdgpu"],
    ["Arm", "arm"],
    ["Arm64EC", "arm64ec"],
    ["Avr", "avr"],
    ["Bpf", "bpf"],
    ["CSky", "csky"],
    ["Hexagon", "hexagon"],
    ["LoongArch32", "loongarch32"],
    ["LoongArch64", "loongarch64"],
    ["M68k", "m68k"],
    ["Mips", "mips"],
    ["Mips32r6", "mips32r6"],
    ["Mips64", "mips64"],
    ["Mips64r6", "mips64r6"],
    ["Msp430", "msp430"],
    ["Nvptx64", "nvptx64"],
    ["PowerPC", "powerpc"],
    ["PowerPC64", "powerpc64"],
    ["RiscV32", "riscv32"],
    ["RiscV64", "riscv64"],
    ["S390x", "s390x"],
    ["Sparc", "sparc"],
    ["Sparc64", "sparc64"],
    ["SpirV", "spirv"],
    ["Wasm32", "wasm32"],
    ["Wasm64", "wasm64"],
    ["X86", "x86"],
    ["X86_64", "x86_64"],
    ["Xtensa", "xtensa"],
  ],
  "Other",
);
export const Arch = {
  ...Arch_impl.V,
  ...Arch_impl,

  // rustc: compiler/rustc_target/src/spec/mod.rs:1796 desc_symbol
  desc_symbol(self: Arch): Symbol {
    switch (self.$) {
      case "AArch64":
        return sym.aarch64;
      case "AmdGpu":
        return sym.amdgpu;
      case "Arm":
        return sym.arm;
      case "Arm64EC":
        return sym.arm64ec;
      case "Avr":
        return sym.avr;
      case "Bpf":
        return sym.bpf;
      case "CSky":
        return sym.csky;
      case "Hexagon":
        return sym.hexagon;
      case "LoongArch32":
        return sym.loongarch32;
      case "LoongArch64":
        return sym.loongarch64;
      case "M68k":
        return sym.m68k;
      case "Mips":
        return sym.mips;
      case "Mips32r6":
        return sym.mips32r6;
      case "Mips64":
        return sym.mips64;
      case "Mips64r6":
        return sym.mips64r6;
      case "Msp430":
        return sym.msp430;
      case "Nvptx64":
        return sym.nvptx64;
      case "PowerPC":
        return sym.powerpc;
      case "PowerPC64":
        return sym.powerpc64;
      case "RiscV32":
        return sym.riscv32;
      case "RiscV64":
        return sym.riscv64;
      case "S390x":
        return sym.s390x;
      case "Sparc":
        return sym.sparc;
      case "Sparc64":
        return sym.sparc64;
      case "SpirV":
        return sym.spirv;
      case "Wasm32":
        return sym.wasm32;
      case "Wasm64":
        return sym.wasm64;
      case "X86":
        return sym.x86;
      case "X86_64":
        return sym.x86_64;
      case "Xtensa":
        return sym.xtensa;
      case "Other":
        return Symbol.intern(self._0);
    }
  },

  /// Whether `#[rustc_scalable_vector]` is supported for a target architecture
  // rustc: compiler/rustc_target/src/spec/mod.rs:1833 supports_scalable_vectors
  supports_scalable_vectors(self: Arch): boolean {
    // use Arch::*;

    switch (self.$) {
      case "AArch64":
      case "RiscV32":
      case "RiscV64":
        return true;
      default:
        return false;
    }
  },
} as const;

// crate::target_spec_enum! { pub enum Os { .. } other_variant = Other; }
export type OsVariant = "Aix" | "AmdHsa" | "Android" | "Cuda" | "Cygwin" | "Dragonfly" | "Emscripten" | "EspIdf" | "FreeBsd" | "Fuchsia" | "Haiku" | "HelenOs" | "Hermit" | "Horizon" | "Hurd" | "Hyperlight" | "Illumos" | "IOs" | "L4Re" | "Linux" | "LynxOs178" | "MacOs" | "Managarm" | "Motor" | "NetBsd" | "None" | "Nto" | "NuttX" | "OpenBsd" | "Ps3" | "Psp" | "Psx" | "Qnx" | "Qurt" | "Redox" | "Rtems" | "Solaris" | "SolidAsp3" | "TeeOs" | "Trusty" | "TvOs" | "Uefi" | "VexOs" | "VisionOs" | "Vita" | "VxWorks" | "Wasi" | "WatchOs" | "Windows" | "Xous" | "Zkvm" | "Unknown";
export type Os = TargetSpecOther<OsVariant, "Other">;
const Os_impl = target_spec_other_enum<OsVariant, "Other">(
  [
    ["Aix", "aix"],
    ["AmdHsa", "amdhsa"],
    ["Android", "android"],
    ["Cuda", "cuda"],
    ["Cygwin", "cygwin"],
    ["Dragonfly", "dragonfly"],
    ["Emscripten", "emscripten"],
    ["EspIdf", "espidf"],
    ["FreeBsd", "freebsd"],
    ["Fuchsia", "fuchsia"],
    ["Haiku", "haiku"],
    ["HelenOs", "helenos"],
    ["Hermit", "hermit"],
    ["Horizon", "horizon"],
    ["Hurd", "hurd"],
    ["Hyperlight", "hyperlight"],
    ["Illumos", "illumos"],
    ["IOs", "ios"],
    ["L4Re", "l4re"],
    ["Linux", "linux"],
    ["LynxOs178", "lynxos178"],
    ["MacOs", "macos"],
    ["Managarm", "managarm"],
    ["Motor", "motor"],
    ["NetBsd", "netbsd"],
    ["None", "none"],
    ["Nto", "nto"],
    ["NuttX", "nuttx"],
    ["OpenBsd", "openbsd"],
    ["Ps3", "ps3"],
    ["Psp", "psp"],
    ["Psx", "psx"],
    ["Qnx", "qnx"],
    ["Qurt", "qurt"],
    ["Redox", "redox"],
    ["Rtems", "rtems"],
    ["Solaris", "solaris"],
    ["SolidAsp3", "solid_asp3"],
    ["TeeOs", "teeos"],
    ["Trusty", "trusty"],
    ["TvOs", "tvos"],
    ["Uefi", "uefi"],
    ["VexOs", "vexos"],
    ["VisionOs", "visionos"],
    ["Vita", "vita"],
    ["VxWorks", "vxworks"],
    ["Wasi", "wasi"],
    ["WatchOs", "watchos"],
    ["Windows", "windows"],
    ["Xous", "xous"],
    ["Zkvm", "zkvm"],
    ["Unknown", "unknown"],
  ],
  "Other",
);
export const Os = {
  ...Os_impl.V,
  ...Os_impl,

  // rustc: compiler/rustc_target/src/spec/mod.rs:1905 desc_symbol
  desc_symbol(self: Os): Symbol {
    return Symbol.intern(Os_impl.desc(self));
  },
} as const;

// crate::target_spec_enum! { pub enum Env { .. } other_variant = Other; }
export type EnvVariant = "Gnu" | "MacAbi" | "Mlibc" | "Msvc" | "Musl" | "Newlib" | "Nto70" | "Nto71" | "Nto71IoSock" | "Ohos" | "Relibc" | "Sgx" | "Sim" | "P1" | "P2" | "P3" | "Uclibc" | "V5" | "Unspecified";
export type Env = TargetSpecOther<EnvVariant, "Other">;
const Env_impl = target_spec_other_enum<EnvVariant, "Other">(
  [
    ["Gnu", "gnu"],
    ["MacAbi", "macabi"],
    ["Mlibc", "mlibc"],
    ["Msvc", "msvc"],
    ["Musl", "musl"],
    ["Newlib", "newlib"],
    ["Nto70", "nto70"],
    ["Nto71", "nto71"],
    ["Nto71IoSock", "nto71_iosock"],
    ["Ohos", "ohos"],
    ["Relibc", "relibc"],
    ["Sgx", "sgx"],
    ["Sim", "sim"],
    ["P1", "p1"],
    ["P2", "p2"],
    ["P3", "p3"],
    ["Uclibc", "uclibc"],
    ["V5", "v5"],
    ["Unspecified", ""],
  ],
  "Other",
);
export const Env = {
  ...Env_impl.V,
  ...Env_impl,

  // rustc: compiler/rustc_target/src/spec/mod.rs:1936 desc_symbol
  desc_symbol(self: Env): Symbol {
    return Symbol.intern(Env_impl.desc(self));
  },
} as const;

// crate::target_spec_enum! { pub enum CfgAbi { .. } other_variant = Other; }
/// An enum representing possible values for `cfg(target_abi)`.
/// This field is not forwarded to LLVM so it does not by itself affect codegen.
/// See the `cfg_abi` field of [`TargetOptions`] for more details.
export type CfgAbiVariant = "Abi64" | "AbiV2" | "AbiV2Hf" | "Eabi" | "EabiHf" | "ElfV1" | "ElfV2" | "Fortanix" | "Ilp32" | "Ilp32e" | "Llvm" | "MacAbi" | "Pauthtest" | "Sim" | "SoftFloat" | "Spe" | "Uwp" | "VecDefault" | "X32" | "V8Plus" | "Unspecified";
export type CfgAbi = TargetSpecOther<CfgAbiVariant, "Other">;
const CfgAbi_impl = target_spec_other_enum<CfgAbiVariant, "Other">(
  [
    ["Abi64", "abi64"],
    ["AbiV2", "abiv2"],
    ["AbiV2Hf", "abiv2hf"],
    ["Eabi", "eabi"],
    ["EabiHf", "eabihf"],
    ["ElfV1", "elfv1"],
    ["ElfV2", "elfv2"],
    ["Fortanix", "fortanix"],
    ["Ilp32", "ilp32"],
    ["Ilp32e", "ilp32e"],
    ["Llvm", "llvm"],
    ["MacAbi", "macabi"],
    ["Pauthtest", "pauthtest"],
    ["Sim", "sim"],
    ["SoftFloat", "softfloat"],
    ["Spe", "spe"],
    ["Uwp", "uwp"],
    ["VecDefault", "vec-default"],
    ["X32", "x32"],
    ["V8Plus", "v8plus"],
    ["Unspecified", ""],
  ],
  "Other",
);
export const CfgAbi = {
  ...CfgAbi_impl.V,
  ...CfgAbi_impl,

  // rustc: compiler/rustc_target/src/spec/mod.rs:1972 desc_symbol
  desc_symbol(self: CfgAbi): Symbol {
    return Symbol.intern(CfgAbi_impl.desc(self));
  },
} as const;

// crate::target_spec_enum! { pub enum LlvmAbi { .. } other_variant = Other; }
/// An enum representing possible values for the `llvm_abiname` field of [`TargetOptions`].
/// This field is used by LLVM on some targets to control which ABI to use.
export type LlvmAbiVariant = "Ilp32" | "Ilp32f" | "Ilp32d" | "Ilp32e" | "Ilp32s" | "Lp64" | "Lp64f" | "Lp64d" | "Lp64e" | "Lp64s" | "O32" | "N32" | "N64" | "ElfV1" | "ElfV2" | "Pauthtest" | "Unspecified";
export type LlvmAbi = TargetSpecOther<LlvmAbiVariant, "Other">;
const LlvmAbi_impl = target_spec_other_enum<LlvmAbiVariant, "Other">(
  [
    // RISC-V and LoongArch
    ["Ilp32", "ilp32"],
    ["Ilp32f", "ilp32f"],
    ["Ilp32d", "ilp32d"],
    ["Ilp32e", "ilp32e"],
    ["Ilp32s", "ilp32s"],
    ["Lp64", "lp64"],
    ["Lp64f", "lp64f"],
    ["Lp64d", "lp64d"],
    ["Lp64e", "lp64e"],
    ["Lp64s", "lp64s"],
    // MIPS
    ["O32", "o32"],
    ["N32", "n32"],
    ["N64", "n64"],
    // PowerPC
    ["ElfV1", "elfv1"],
    ["ElfV2", "elfv2"],
    // AArch64
    ["Pauthtest", "pauthtest"],

    ["Unspecified", ""],
  ],
  "Other",
);
export const LlvmAbi = {
  ...LlvmAbi_impl.V,
  ...LlvmAbi_impl,
} as const;

/** derived `PartialEq` of the `target_spec_enum!` enums with an `other_variant` */
export function spec_other_eq<T extends string, O extends string>(a: TargetSpecOther<T, O>, b: TargetSpecOther<T, O>): boolean {
  return a.$ === b.$ && (a as { _0?: string })._0 === (b as { _0?: string })._0;
}

/// Everything `rustc` knows about how to compile for a specific target.
///
/// Every field here must be specified, and has no default value.
// #[derive(PartialEq, Clone, Debug)]
export class Target {
  constructor(
    /// Unversioned target tuple to pass to LLVM.
    ///
    /// Target tuples can optionally contain an OS version (notably Apple targets), which rustc
    /// cannot know without querying the environment.
    ///
    /// Use `rustc_codegen_ssa::back::versioned_llvm_target` if you need the full LLVM target.
    public llvm_target: string,
    /// Metadata about a target, for example the description or tier.
    /// Used for generating target documentation.
    public metadata: TargetMetadata,
    /// Number of bits in a pointer. Influences the `target_pointer_width` `cfg` variable.
    public pointer_width: number,
    /// Architecture to use for ABI considerations. Valid options include: "x86",
    /// "x86_64", "arm", "aarch64", "mips", "powerpc", "powerpc64", and others.
    public arch: Arch,
    /// [Data layout](https://llvm.org/docs/LangRef.html#data-layout) to pass to LLVM.
    public data_layout: string,
    /// Optional settings with defaults.
    public options: TargetOptions,
  ) {}

  /** `#[derive(Clone)]` */
  clone(): Target {
    return new Target(this.llvm_target, { ...this.metadata }, this.pointer_width, this.arch, this.data_layout, this.options.clone());
  }

  /** `#[derive(PartialEq)]` */
  eq(other: Target): boolean {
    return (
      this.llvm_target === other.llvm_target &&
      spec_value_eq(this.metadata, other.metadata) &&
      this.pointer_width === other.pointer_width &&
      spec_other_eq(this.arch, other.arch) &&
      this.data_layout === other.data_layout &&
      this.options.eq(other.options)
    );
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:2051 parse_data_layout
  parse_data_layout(): Result<TargetDataLayout, TargetDataLayoutError> {
    const r = TargetDataLayout.parse_from_llvm_datalayout_string(this.data_layout, this.options.default_address_space);
    if (r.$ === "Err") return r;
    const dl = r._0;

    // Perform consistency checks against the Target information.
    if (dl.endian !== this.endian) {
      return Err({
        $: "InconsistentTargetArchitecture",
        dl: Endian.as_str(dl.endian),
        target: Endian.as_str(this.endian),
      });
    }

    const target_pointer_width: number = this.pointer_width;
    const dl_pointer_size: number = dl.pointer_size().bits();
    if (dl_pointer_size !== target_pointer_width) {
      return Err({
        $: "InconsistentTargetPointerWidth",
        pointer_size: dl_pointer_size,
        target: this.pointer_width,
      });
    }

    const c_enum_min_size = Integer.from_size(Size.from_bits(this.c_enum_min_bits ?? this.c_int_width));
    if (c_enum_min_size.$ === "Err") return Err({ $: "InvalidBitsSize", err: c_enum_min_size._0 });
    dl.c_enum_min_size = c_enum_min_size._0;

    return Ok(dl);
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:2082 supports_c_variadic_definitions
  supports_c_variadic_definitions(): CVariadicStatus {
    // use Arch::*;

    switch (this.arch.$) {
      // These targets just inherently do not support c-variadic definitions.
      case "Bpf":
      case "SpirV":
        return { $: "NotSupported" };

      // The c-variadic ABI for this target may change in the future, per this comment in
      // clang:
      //
      // > To be compatible with GCC's behaviors, we force arguments with
      // > 2×XLEN-bit alignment and size at most 2×XLEN bits like `long long`,
      // > `unsigned long long` and `double` to have 4-byte alignment. This
      // > behavior may be changed when RV32E/ILP32E is ratified.
      case "RiscV32":
        if (this.llvm_abiname.$ === "Ilp32e") {
          return { $: "Unstable", feature: sym.c_variadic_experimental_arch };
        }
        return { $: "Stable" };

      // We don't know how c-variadics work for this target. Using the default LLVM
      // fallback implementation probably works, but we can't guarantee it.
      case "Other":
        return { $: "Unstable", feature: sym.c_variadic_experimental_arch };

      // These targets require more testing before we commit to c-variadic definitions
      // being stable.
      //
      // To stabilize c-variadic functions for one of these targets, the following
      // requirements must be met:
      //
      // - Check that `core::ffi::VaArgSafe` is (un)implemented for all the correct types.
      // - Add an assembly test to `tests/assembly-llvm/c-variadic` that tests the assembly
      // for all implementers of `VaArgSafe`. The generated assembly should either match
      // `clang`, or we should understand and document why it deviates.
      // - Ensure that `va_arg` is implemented in rustc. For stable targets we don't rely on
      // the LLVM implementation, it has historically caused miscompilations.
      // - Ensure that LLVM's `va_end` for this target is a NOP.
      // - Ensure that LLVM's `va_copy` for this target is equivalent to `memcpy`.
      // - The `tests/ui/c-variadic/roundtrip.rs` test must pass for the target. It may
      // need slight modifications for embedded targets, that's fine.
      // - Check that calling c-variadic functions defined in Rust can be called from C.
      // For most targets `tests/run-make/c-link-to-rust-va-list-fn` can be used here.
      // For no_std targets a manual setup may be needed.
      case "Sparc":
      case "Avr":
      case "M68k":
      case "Msp430":
        return { $: "Unstable", feature: sym.c_variadic_experimental_arch };

      case "AArch64":
      case "AmdGpu":
      case "Arm":
      case "Arm64EC":
      case "CSky":
      case "Hexagon":
      case "LoongArch32":
      case "LoongArch64":
      case "Mips":
      case "Mips32r6":
      case "Mips64":
      case "Mips64r6":
      case "Nvptx64":
      case "PowerPC":
      case "PowerPC64":
      case "RiscV64":
      case "S390x":
      case "Sparc64":
      case "Wasm32":
      case "Wasm64":
      case "X86":
      case "X86_64":
      case "Xtensa":
        return { $: "Stable" };
    }
  }

  /// Is this target single-threaded?
  ///
  /// This affects both optimizations (e.g., atomics can be lowered to regular operations) and
  /// is also exposed as cfg(target_has_threads).
  // PORT: named `singlethread_` (clashes with the `singlethread` field reached through `Deref`).
  // rustc: compiler/rustc_target/src/spec/mod.rs:2139 singlethread
  singlethread_(target_features: ReadonlySet<Symbol>): boolean {
    // On the wasm target once the `atomics` feature is enabled that means that
    // we're no longer single-threaded, or otherwise we don't want LLVM to
    // lower atomic operations to single-threaded operations.
    //
    // FIXME: This (probably?) implies that atomics should be a target modifier, at which point
    // it probably makes sense to be a separate target to ship precompiled artifacts for it?
    //
    // cc #77839 (tracking issue for wasm atomics)
    if (this.singlethread && this.is_like_wasm && target_features.has(sym.atomics)) {
      return false;
    }

    return this.singlethread;
  }

  // impl HasTargetSpec for Target
  // #[inline]
  // rustc: compiler/rustc_target/src/spec/mod.rs:2162 target_spec
  target_spec(): Target {
    return this;
  }

  // ---- `impl Target` (mod.rs:2874) ----

  // not ported (no marker; mod.rs:2875 is_abi_supported): needs `AbiMap` (abi_map.rs).
  is_abi_supported(_abi: unknown): boolean {
    return unported("rustc_target::spec::Target::is_abi_supported (AbiMap)");
  }

  /// Minimum integer size in bits that this target can perform atomic
  /// operations on.
  // PORT: named `min_atomic_width_` (clashes with the `min_atomic_width` field reached through `Deref`).
  // rustc: compiler/rustc_target/src/spec/mod.rs:2882 min_atomic_width
  min_atomic_width_(): number {
    return this.min_atomic_width ?? 8;
  }

  /// Maximum integer size in bits that this target can perform atomic
  /// operations on.
  // PORT: named `max_atomic_width_` (clashes with the `max_atomic_width` field reached through `Deref`).
  // rustc: compiler/rustc_target/src/spec/mod.rs:2888 max_atomic_width
  max_atomic_width_(): number {
    return this.max_atomic_width ?? this.pointer_width;
  }

  /// Test target self-consistency and JSON encoding/decoding roundtrip.
  // #[cfg(test)]
  // rustc-skip: compiler/rustc_target/src/spec/mod.rs:2894 test_target cfg(test) helper (needs from_json and consistency.rs)

  // Add your target to the whitelist if it has `std` library
  // and you certainly want "unknown" for the OS name.
  // rustc: compiler/rustc_target/src/spec/mod.rs:2905 can_use_os_unknown
  can_use_os_unknown(): boolean {
    return (
      this.llvm_target === "wasm32-unknown-unknown" ||
      this.llvm_target === "wasm64-unknown-unknown" ||
      (this.env.$ === "Sgx" && this.vendor === "fortanix")
    );
  }

  /// Load a built-in target
  // rustc: compiler/rustc_target/src/spec/mod.rs:2912 expect_builtin
  static expect_builtin(target_tuple: TargetTuple): Target {
    switch (target_tuple.$) {
      case "TargetTuple":
        return unwrap(load_builtin(target_tuple._0), "built-in target");
      case "TargetJson":
        return panic("built-in targets doesn't support target-paths");
    }
  }

  /// Load all built-in targets
  // rustc: compiler/rustc_target/src/spec/mod.rs:2924 builtins
  static builtins(): Target[] {
    return load_all_builtins();
  }

  /// Search for a JSON file specifying the given target tuple.
  ///
  /// If none is found in `$RUST_TARGET_PATH`, look for a file called `target.json` inside the
  /// sysroot under the target-tuple's `rustlib` directory. Note that it could also just be a
  /// bare filename already, so also check for that. If one of the hardcoded targets we know
  /// about, just return it directly.
  ///
  /// The error string could come from any of the APIs called, including filesystem access and
  /// JSON decoding.
  // rustc: compiler/rustc_target/src/spec/mod.rs:2937 search
  static search(target_tuple: TargetTuple, sysroot: PathBuf, unstable_options: boolean): Result<[Target, TargetWarnings], string> {
    // use std::{env, fs};

    // rustc: compiler/rustc_target/src/spec/mod.rs:2944 load_file
    function load_file(path: PathBuf, unstable_options: boolean): Result<[Target, TargetWarnings], string> {
      if (!unstable_options) {
        return Err("custom targets are unstable and require `-Zunstable-options`");
      }
      let contents: string;
      try {
        contents = readFileSync(path, "utf8");
      } catch (e) {
        // PORT: `io::Error`'s Display of the read failure is not ported.
        return unported(`rustc_target::spec::Target::search load_file (io::Error: ${String(e)})`);
      }
      return Target.from_json(contents);
    }

    switch (target_tuple.$) {
      case "TargetTuple": {
        const tuple = target_tuple._0;
        // check if tuple is in list of built-in targets
        const t = load_builtin(tuple);
        if (t !== undefined) {
          return Ok([t, TargetWarnings.empty()]);
        }

        // search for a file named `target_tuple`.json in RUST_TARGET_PATH
        const path = `${tuple}.json`;

        const target_path = process.env.RUST_TARGET_PATH ?? "";

        // PORT: `env::split_paths` (the platform's path-list separator; no quoting on Windows).
        for (const dir of target_path.split(delimiter)) {
          const p = path_join(dir, path);
          if (is_file(p)) {
            return load_file(p, unstable_options);
          }
        }

        // Additionally look in the sysroot under `lib/rustlib/<tuple>/target.json`
        // as a fallback.
        const rustlib_path = relative_target_rustlib_path(sysroot, tuple);
        const p = path_join(path_join(sysroot, rustlib_path), "target.json");
        if (is_file(p)) {
          return load_file(p, unstable_options);
        }

        // PORT: `{target_tuple:?}` is the `Debug` of a `&String`.
        return Err(`could not find specification for target ${debug_str(tuple)}`);
      }
      case "TargetJson":
        if (!unstable_options) {
          return Err("custom targets are unstable and require `-Zunstable-options`");
        }
        return Target.from_json(target_tuple.contents);
    }
  }

  // json.rs:19 `Target::from_json` (not ported: target JSON files).
  static from_json(_json: string): Result<[Target, TargetWarnings], string> {
    return unported("rustc_target::spec::Target::from_json (target JSON)");
  }

  /// Return the target's small data threshold support, converting
  /// `DefaultForArch` into a concrete value.
  // PORT: named `small_data_threshold_support_` (clashes with the field reached through `Deref`).
  // rustc: compiler/rustc_target/src/spec/mod.rs:3003 small_data_threshold_support
  small_data_threshold_support_(): SmallDataThresholdSupport {
    const s = this.options.small_data_threshold_support;
    switch (s.$) {
      // Avoid having to duplicate the small data support in every
      // target file by supporting a default value for each
      // architecture.
      case "DefaultForArch":
        switch (this.arch.$) {
          case "Mips":
          case "Mips64":
          case "Mips32r6":
            return { $: "LlvmArg", _0: "mips-ssection-threshold" };
          case "Hexagon":
            return { $: "LlvmArg", _0: "hexagon-small-data-threshold" };
          case "M68k":
            return { $: "LlvmArg", _0: "m68k-ssection-threshold" };
          case "RiscV32":
          case "RiscV64":
            return { $: "LlvmModuleFlag", _0: "SmallDataLimit" };
          default:
            return SmallDataThresholdSupport.None;
        }
      default:
        return s;
    }
  }

  // not ported (no marker; mod.rs:3025 object_architecture): returns `object::Architecture` (the
  // `object` crate, wave 11).
  object_architecture(_internal_target_features: ReadonlySet<Symbol>): never {
    return unported("rustc_target::spec::Target::object_architecture (object crate)");
  }

  /// Returns whether this target is known to have unreliable alignment:
  /// native C code for the target fails to align some data to the degree
  /// required by the C standard. We can't *really* do anything about that
  /// since unsafe Rust code may assume alignment any time, but we can at least
  /// inhibit some optimizations, and we suppress the alignment checks that
  /// would detect this unsoundness.
  ///
  /// Every target that returns less than `Align::MAX` here is still has a soundness bug.
  // rustc: compiler/rustc_target/src/spec/mod.rs:3105 max_reliable_alignment
  max_reliable_alignment(): Align {
    // FIXME(#112480) MSVC on x86-32 is unsound and fails to properly align many types with
    // more-than-4-byte-alignment on the stack. This makes alignments larger than 4 generally
    // unreliable on 32bit Windows.
    if (this.is_like_windows && this.arch.$ === "X86") {
      const r = Align.from_bytes(4);
      if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
      return r._0;
    } else {
      return Align.MAX;
    }
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:3116 vendor_symbol
  vendor_symbol(): Symbol {
    return Symbol.intern(this.vendor);
  }
}

/** `p.is_file()` */
function is_file(p: PathBuf): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/// Metadata about a target like the description or tier.
/// Part of #120745.
/// All fields are optional for now, but intended to be required in the future.
// #[derive(Default, PartialEq, Clone, Debug)]
export interface TargetMetadata {
  /// A short description of the target including platform requirements,
  /// for example "64-bit Linux (kernel 3.2+, glibc 2.17+)".
  description: string | undefined;
  /// The tier of the target. 1, 2 or 3.
  tier: number | undefined;
  /// Whether the Rust project ships host tools for a target.
  host_tools: boolean | undefined;
  /// Whether a target has the `std` library. This is usually true for targets running
  /// on an operating system.
  std: boolean | undefined;
}

// pub trait HasTargetSpec {
//     // rustc: compiler/rustc_target/src/spec/mod.rs:2157 target_spec
//     fn target_spec(&self) -> &Target;
// }
export interface HasTargetSpec {
  // rustc: compiler/rustc_target/src/spec/mod.rs:2157 target_spec
  target_spec(): Target;
}

/// x86 (32-bit) abi options.
// #[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
export interface X86Abi {
  /// On x86-32 targets, the regparm N causes the compiler to pass arguments
  /// in registers EAX, EDX, and ECX instead of on the stack.
  regparm: number | undefined;
  /// Override the default ABI to return small structs in registers
  reg_struct_return: boolean;
}

export interface HasX86AbiOpt {
  // rustc: compiler/rustc_target/src/spec/mod.rs:2178 x86_abi_opt
  x86_abi_opt(): X86Abi;
}

// type StaticCow<T> = Cow<'static, T>;  PORT: `StaticCow<str>` is `string`, `StaticCow<[T]>` is `readonly T[]`.

/**
 * Structural equality of target-spec values (the derived `PartialEq` of the spec types): primitives
 * with `===` (interned flavors included), arrays element-wise, maps by entries, objects (enum payloads,
 * `Align`, `TargetMetadata`, ...) field by field.
 */
export function spec_value_eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => spec_value_eq(x, b[i]));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !spec_value_eq(v, b.get(k))) return false;
    }
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => spec_value_eq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/// Optional aspects of a target specification.
///
/// This has an implementation of `Default`, see each field for what the default is. In general,
/// these try to take "minimal defaults" that don't assume anything about the runtime they run in.
///
/// `TargetOptions` as a separate structure is mostly an implementation detail of `Target`
/// construction, all its fields logically belong to `Target` and available from `Target`
/// through `Deref` impls.
// #[derive(PartialEq, Clone, Debug)]
// #[rustc_lint_opt_ty]
export interface TargetOptionsFields {
  /// Used as the `target_endian` `cfg` variable. Defaults to little endian.
  endian: Endian;
  /// Width of c_int type. Defaults to "32".
  c_int_width: number;
  /// OS name to use for conditional compilation (`target_os`). Defaults to [`Os::None`].
  /// [`Os::None`] implies a bare metal target without `std` library.
  /// A couple of targets having `std` also use [`Os::Unknown`] as their `os` value,
  /// but they are exceptions.
  os: Os;
  /// Environment name to use for conditional compilation (`target_env`). Defaults to [`Env::Unspecified`].
  env: Env;
  /// ABI name to distinguish multiple ABIs on the same OS and architecture. For instance,
  /// `"eabi"` or `"eabihf"`. Defaults to [`CfgAbi::Unspecified`].
  /// The only purpose of this field is to control `cfg(target_abi)`. This does not control the
  /// calling convention used by this target! The actual calling convention is controlled by
  /// `llvm_abiname`, `llvm_floatabi`, and `rustc_abi`.
  ///
  /// In a target spec, this field generally *informs* the user about what the ABI is, but you
  /// have to also set up other parts of the target spec to ensure that this information is
  /// correct. In the rest of the compiler, do not check this field if what you actually need to
  /// know about is the calling convention. Most targets have an open-ended set of values for this
  /// field.
  cfg_abi: CfgAbi;
  /// Vendor name to use for conditional compilation (`target_vendor`). Defaults to "unknown".
  // #[rustc_lint_opt_deny_field_access(
  // "use `Target::is_like_*` instead of this field; see https://github.com/rust-lang/rust/issues/100343 for rationale"
  // )]
  // PORT: private upstream (`vendor`).
  vendor: string;

  /// Linker to invoke
  linker: string | undefined;
  /// Default linker flavor used if `-C linker-flavor` or `-C linker` are not passed
  /// on the command line. Defaults to `LinkerFlavor::Gnu(Cc::Yes, Lld::No)`.
  linker_flavor: LinkerFlavor;
  // PORT: private upstream (`linker_flavor_json`).
  linker_flavor_json: LinkerFlavorCli;
  // PORT: private upstream (`lld_flavor_json`).
  lld_flavor_json: LldFlavor;
  // PORT: private upstream (`linker_is_gnu_json`).
  linker_is_gnu_json: boolean;

  /// Objects to link before and after all other object code.
  pre_link_objects: CrtObjects;
  post_link_objects: CrtObjects;
  /// Same as `(pre|post)_link_objects`, but when self-contained linking mode is enabled.
  pre_link_objects_self_contained: CrtObjects;
  post_link_objects_self_contained: CrtObjects;
  /// Behavior for the self-contained linking mode: inferred for some targets, or explicitly
  /// enabled (in bulk, or with individual components).
  link_self_contained: LinkSelfContainedDefault;

  /// Linker arguments that are passed *before* any user-defined libraries.
  pre_link_args: LinkArgs;
  // PORT: private upstream (`pre_link_args_json`).
  pre_link_args_json: LinkArgsCli;
  /// Linker arguments that are unconditionally passed after any
  /// user-defined but before post-link objects. Standard platform
  /// libraries that should be always be linked to, usually go here.
  late_link_args: LinkArgs;
  // PORT: private upstream (`late_link_args_json`).
  late_link_args_json: LinkArgsCli;
  /// Linker arguments used in addition to `late_link_args` if at least one
  /// Rust dependency is dynamically linked.
  late_link_args_dynamic: LinkArgs;
  // PORT: private upstream (`late_link_args_dynamic_json`).
  late_link_args_dynamic_json: LinkArgsCli;
  /// Linker arguments used in addition to `late_link_args` if all Rust
  /// dependencies are statically linked.
  late_link_args_static: LinkArgs;
  // PORT: private upstream (`late_link_args_static_json`).
  late_link_args_static_json: LinkArgsCli;
  /// Linker arguments that are unconditionally passed *after* any
  /// user-defined libraries.
  post_link_args: LinkArgs;
  // PORT: private upstream (`post_link_args_json`).
  post_link_args_json: LinkArgsCli;

  /// Optional link script applied to `dylib` and `executable` crate types.
  /// This is a string containing the script, not a path. Can only be applied
  /// to linkers where linker flavor matches `LinkerFlavor::Gnu(..)`.
  link_script: string | undefined;
  /// Environment variables to be set for the linker invocation.
  link_env: readonly (readonly [string, string])[];
  /// Environment variables to be removed for the linker invocation.
  link_env_remove: readonly string[];

  /// Extra arguments to pass to the external assembler (when used)
  asm_args: readonly string[];

  /// Default CPU to pass to LLVM. Corresponds to `llc -mcpu=$cpu`. Must be a name the backend
  /// accepts. Defaults to "generic" (which some backends won't accept).
  cpu: string;
  /// Whether a cpu needs to be explicitly set via `-Ctarget-cpu` for codegen to run. (Even if
  /// true, `cpu` is still consulted on non-codegen paths such as cfg/feature computation.)
  /// Defaults to false.
  need_explicit_cpu: boolean;
  /// Whether `-Ctarget-cpu` is treated as a target modifier. If this is set
  /// all crates that are linked together must have been compiled with the
  /// same target-cpu. Defaults to false.
  requires_consistent_cpu: boolean;
  /// A list of CPUs that are provided by LLVM but are considered unsupported by Rust.
  /// These CPUs are omitted from `--print target-cpus` output and will cause an error
  /// if used with `-Ctarget-cpu`.
  unsupported_cpus: readonly string[];
  /// Default (Rust) target features to enable for this target. These features
  /// overwrite `-Ctarget-cpu` but can be overwritten with `-Ctarget-features`.
  /// Corresponds to `llc -mattr=$llvm_features` where `$llvm_features` is the
  /// result of mapping the Rust features in this field to LLVM features.
  ///
  /// Generally it is a bad idea to use negative target features because they often interact very
  /// poorly with how `-Ctarget-cpu` works. Instead, try to use a lower "base CPU" and enable the
  /// features you want to use.
  features: string;
  /// Direct or use GOT indirect to reference external data symbols
  direct_access_external_data: boolean | undefined;
  /// Whether dynamic linking is available on this target. Defaults to false.
  dynamic_linking: boolean;
  /// Whether dynamic linking can export TLS globals. Defaults to true.
  dll_tls_export: boolean;
  /// If dynamic linking is available, whether only cdylibs are supported.
  only_cdylib: boolean;
  /// Whether executables are available on this target. Defaults to true.
  executables: boolean;
  /// Relocation model to use in object file. Corresponds to `llc
  /// -relocation-model=$relocation_model`. Defaults to `Pic`.
  relocation_model: RelocModel;
  /// Code model to use. Corresponds to `llc -code-model=$code_model`.
  /// Defaults to `None` which means "inherited from the base LLVM target".
  code_model: CodeModel | undefined;
  /// TLS model to use. Options are "global-dynamic" (default), "local-dynamic", "initial-exec"
  /// and "local-exec". This is similar to the -ftls-model option in GCC/Clang.
  tls_model: TlsModel;
  /// Do not emit code that uses the "red zone", if the ABI has one. Defaults to false.
  disable_redzone: boolean;
  /// Frame pointer mode for this target. Defaults to `MayOmit`.
  frame_pointer: FramePointer;
  /// Emit each function in its own section. Defaults to true.
  function_sections: boolean;
  /// String to prepend to the name of every dynamic library. Defaults to "lib".
  dll_prefix: string;
  /// String to append to the name of every dynamic library. Defaults to ".so".
  dll_suffix: string;
  /// String to append to the name of every executable.
  exe_suffix: string;
  /// String to prepend to the name of every static library. Defaults to "lib".
  staticlib_prefix: string;
  /// String to append to the name of every static library. Defaults to ".a".
  staticlib_suffix: string;
  /// Values of the `target_family` cfg set for this target.
  ///
  /// Common options are: "unix", "windows". Defaults to no families.
  ///
  /// See <https://doc.rust-lang.org/reference/conditional-compilation.html#target_family>.
  families: readonly string[];
  /// Whether the target toolchain's ABI supports returning small structs as an integer.
  abi_return_struct_as_int: boolean;
  /// Whether the target toolchain is like AIX's. Linker options on AIX are special and it uses
  /// XCOFF as binary format. Defaults to false.
  is_like_aix: boolean;
  /// Whether the target toolchain is like macOS's. Only useful for compiling against iOS/macOS,
  /// in particular running dsymutil and some other stuff like `-dead_strip`. Defaults to false.
  /// Also indicates whether to use Apple-specific ABI changes, such as extending function
  /// parameters to 32-bits.
  is_like_darwin: boolean;
  /// Whether the target is a GPU (e.g. NVIDIA, AMD, Intel).
  is_like_gpu: boolean;
  /// Whether the target toolchain is like Solaris's.
  /// Only useful for compiling against Illumos/Solaris,
  /// as they have a different set of linker flags. Defaults to false.
  is_like_solaris: boolean;
  /// Whether the target is like Windows.
  /// This is a combination of several more specific properties represented as a single flag:
  ///   - The target uses a Windows ABI,
  ///   - uses PE/COFF as a format for object code,
  ///   - uses Windows-style dllexport/dllimport for shared libraries,
  ///   - uses import libraries and .def files for symbol exports,
  ///   - executables support setting a subsystem.
  is_like_windows: boolean;
  /// Whether the target is like MSVC.
  /// This is a combination of several more specific properties represented as a single flag:
  ///   - The target has all the properties from `is_like_windows`
  ///     (for in-tree targets "is_like_msvc ⇒ is_like_windows" is ensured by a unit test),
  ///   - has some MSVC-specific Windows ABI properties,
  ///   - uses a link.exe-like linker,
  ///   - uses CodeView/PDB for debuginfo and natvis for its visualization,
  ///   - uses SEH-based unwinding,
  ///   - supports control flow guard mechanism.
  is_like_msvc: boolean;
  /// Whether a target toolchain is like WASM.
  is_like_wasm: boolean;
  /// Whether a target toolchain is like Android, implying a Linux kernel and a Bionic libc
  is_like_android: boolean;
  /// Whether a target toolchain is like VEXos, the operating system used by the VEX Robotics V5 Brain.
  is_like_vexos: boolean;
  /// Target's binary file format. Defaults to BinaryFormat::Elf
  binary_format: BinaryFormat;
  /// Default supported version of DWARF on this platform.
  /// Useful because some platforms (osx, bsd) only want up to DWARF2.
  default_dwarf_version: number;
  /// Whether the linker support rpaths or not. Defaults to false.
  has_rpath: boolean;
  /// Whether to disable linking to the default libraries, typically corresponds
  /// to `-nodefaultlibs`. Defaults to true.
  no_default_libraries: boolean;
  /// Dynamically linked executables can be compiled as position independent
  /// if the default relocation model of position independent code is not
  /// changed. This is a requirement to take advantage of ASLR, as otherwise
  /// the functions in the executable are not randomized and can be used
  /// during an exploit of a vulnerability in any code.
  position_independent_executables: boolean;
  /// Executables that are both statically linked and position-independent are supported.
  static_position_independent_executables: boolean;
  /// Determines if the target always requires using the PLT for indirect
  /// library calls or not. This controls the default value of the `-Z plt` flag.
  plt_by_default: boolean;
  /// Either partial, full, or off. Full RELRO makes the dynamic linker
  /// resolve all symbols at startup and marks the GOT read-only before
  /// starting the program, preventing overwriting the GOT.
  relro_level: RelroLevel;
  /// Format that archives should be emitted in. This affects whether we use
  /// LLVM to assemble an archive or fall back to the system linker, and
  /// currently only "gnu" is used to fall into LLVM. Unknown strings cause
  /// the system linker to be used.
  archive_format: string;
  /// Is asm!() allowed? Defaults to true.
  allow_asm: boolean;
  /// Static initializers must be acyclic.
  /// Defaults to false
  static_initializer_must_be_acyclic: boolean;
  /// Whether the runtime startup code requires the `main` function be passed
  /// `argc` and `argv` values.
  main_needs_argc_argv: boolean;

  /// Flag indicating whether #[thread_local] is available for this target.
  has_thread_local: boolean;
  /// This is mainly for easy compatibility with emscripten.
  /// If we give emcc .o files that are actually .bc files it
  /// will 'just work'.
  obj_is_bitcode: boolean;

  /// Don't use this field; instead use the `.min_atomic_width()` method.
  min_atomic_width: number | undefined;

  /// Don't use this field; instead use the `.max_atomic_width()` method.
  max_atomic_width: number | undefined;

  /// Whether the target supports atomic CAS operations natively
  atomic_cas: boolean;

  /// Panic strategy: "unwind" or "abort"
  panic_strategy: PanicStrategy;

  /// Whether or not linking dylibs to a static CRT is allowed.
  crt_static_allows_dylibs: boolean;
  /// Whether or not the CRT is statically linked by default.
  crt_static_default: boolean;
  /// Whether or not crt-static is respected by the compiler (or is a no-op).
  crt_static_respected: boolean;

  /// The implementation of stack probes to use.
  stack_probes: StackProbeType;

  /// The minimum alignment for global symbols.
  min_global_align: Align | undefined;

  /// Default number of codegen units to use in debug mode
  default_codegen_units: number | undefined;

  /// Default codegen backend used for this target. Defaults to `None`.
  ///
  /// If `None`, then `CFG_DEFAULT_CODEGEN_BACKEND` environmental variable captured when
  /// compiling `rustc` will be used instead (or llvm if it is not set).
  ///
  /// N.B. when *using* the compiler, backend can always be overridden with `-Zcodegen-backend`.
  ///
  /// This was added by WaffleLapkin in #116793. The motivation is a rustc fork that requires a
  /// custom codegen backend for a particular target.
  default_codegen_backend: string | undefined;

  /// Whether to generate trap instructions in places where optimization would
  /// otherwise produce control flow that falls through into unrelated memory.
  trap_unreachable: boolean;

  /// This target requires everything to be compiled with LTO to emit a final
  /// executable, aka there is no native linker for this target.
  requires_lto: boolean;

  /// This target has no support for threads.
  // This is private because wasm changes this depending on target features.
  // PORT: private upstream (`singlethread`).
  singlethread: boolean;

  /// Whether library functions call lowering/optimization is disabled in LLVM
  /// for this target unconditionally.
  no_builtins: boolean;

  /// The default visibility for symbols in this target.
  ///
  /// This value typically shouldn't be accessed directly, but through the
  /// `rustc_session::Session::default_visibility` method, which allows `rustc` users to override
  /// this setting using cmdline flags.
  default_visibility: SymbolVisibility | undefined;

  /// Whether a .debug_gdb_scripts section will be added to the output object file
  emit_debug_gdb_scripts: boolean;

  /// Whether or not to unconditionally `uwtable` attributes on functions,
  /// typically because the platform needs to unwind for things like stack
  /// unwinders.
  requires_uwtable: boolean;

  /// Whether or not to emit `uwtable` attributes on functions if `-C force-unwind-tables`
  /// is not specified and `uwtable` is not required on this target.
  default_uwtable: boolean;

  /// Whether or not SIMD types are passed by reference in the Rust ABI,
  /// typically required if a target can be compiled with a mixed set of
  /// target features. This is `true` by default, and `false` for targets like
  /// wasm32 where the whole program either has simd or not.
  simd_types_indirect: boolean;

  /// Pass a list of symbol which should be exported in the dylib to the linker.
  limit_rdylib_exports: boolean;

  /// If set, have the linker export exactly these symbols, instead of using
  /// the usual logic to figure this out from the crate itself.
  override_export_symbols: readonly string[] | undefined;

  /// Determines how or whether the MergeFunctions LLVM pass should run for
  /// this target. Either "disabled", "trampolines", or "aliases".
  /// The MergeFunctions pass is generally useful, but some targets may need
  /// to opt out. The default is "aliases".
  ///
  /// Workaround for: <https://github.com/rust-lang/rust/issues/57356>
  merge_functions: MergeFunctions;

  /// Use platform dependent mcount function
  mcount: string;

  /// Use LLVM intrinsic for mcount function name
  llvm_mcount_intrinsic: string | undefined;

  /// LLVM ABI name, corresponds to the '-mabi' parameter available in multilib C compilers and
  /// the `-target-abi` flag in llc. In the LLVM API this is `MCTargetOptions::ABIName`.
  llvm_abiname: LlvmAbi;

  /// Control the float ABI to use, for architectures that support it. The only architecture we
  /// currently use this for is ARM. Corresponds to the `-float-abi` flag in llc. In the LLVM API
  /// this is `FloatABIType`. (clang's `-mfloat-abi` is similar but more complicated since it
  /// can also affect the `soft-float` target feature.)
  ///
  /// If not provided, LLVM will infer the float ABI from the target triple (`llvm_target`).
  llvm_floatabi: FloatAbi | undefined;

  /// Picks a specific ABI for this target. This is *not* just for "Rust" ABI functions,
  /// it can also affect "C" ABI functions; the point is that this flag is interpreted by
  /// rustc and not forwarded to LLVM.
  rustc_abi: RustcAbi | undefined;

  /// Whether or not X86RelaxRelocations flag will be passed to LLVM (x86 only).
  relax_elf_relocations: boolean;

  /// Additional arguments to pass to LLVM, similar to the `-C llvm-args` codegen option.
  llvm_args: readonly string[];

  /// Whether to use legacy .ctors initialization hooks rather than .init_array. Defaults
  /// to false (uses .init_array).
  use_ctors_section: boolean;

  /// Whether the linker is instructed to add a `GNU_EH_FRAME` ELF header
  /// used to locate unwinding information is passed
  /// (only has effect if the linker is `ld`-like).
  eh_frame_header: boolean;

  /// Is true if the target is an ARM architecture using thumb v1 which allows for
  /// thumb and arm interworking.
  has_thumb_interworking: boolean;

  /// Which kind of debuginfo is used by this target?
  debuginfo_kind: DebuginfoKind;
  /// How to handle split debug information, if at all. Specifying `None` has
  /// target-specific meaning.
  split_debuginfo: SplitDebuginfo;
  /// Which kinds of split debuginfo are supported by the target?
  supported_split_debuginfo: readonly SplitDebuginfo[];

  /// The sanitizers supported by this target
  ///
  /// Note that the support here is at a codegen level. If the machine code with sanitizer
  /// enabled can generated on this target, but the necessary supporting libraries are not
  /// distributed with the target, the sanitizer should still appear in this list for the target.
  supported_sanitizers: SanitizerSet;

  /// The sanitizers that are enabled by default on this target.
  ///
  /// Note that the support here is at a codegen level. If the machine code with sanitizer
  /// enabled can generated on this target, but the necessary supporting libraries are not
  /// distributed with the target, the sanitizer should still appear in this list for the target.
  default_sanitizers: SanitizerSet;

  /// Minimum number of bits in #[repr(C)] enum. Defaults to the size of c_int
  c_enum_min_bits: number | undefined;

  /// Whether or not the DWARF `.debug_aranges` section should be generated.
  generate_arange_section: boolean;

  /// Whether the target supports stack canary checks. `true` by default,
  /// since this is most common among tier 1 and tier 2 targets.
  supports_stack_protector: boolean;

  /// The name of entry function.
  /// Default value is "main"
  entry_name: string;

  /// The ABI of the entry function.
  /// Default value is `CanonAbi::C`
  entry_abi: CanonAbi;

  /// Whether the target supports fentry instrumentation.
  supports_fentry: boolean;

  /// Whether the target supports XRay instrumentation.
  supports_xray: boolean;

  /// The default address space for this target. When using LLVM as a backend, most targets simply
  /// use LLVM's default address space (0). Some other targets, such as CHERI targets, use a
  /// custom default address space (in this specific case, `200`).
  default_address_space: AddressSpace;

  /// Whether the targets supports -Z small-data-threshold
  // PORT: private upstream (`small_data_threshold_support`).
  small_data_threshold_support: SmallDataThresholdSupport;

}
export interface TargetOptions extends TargetOptionsFields {}
export class TargetOptions {
  constructor(fields: TargetOptionsFields) {
    Object.assign(this, fields);
  }

  /** Struct update syntax `TargetOptions { <overrides>, ..base }` (the base is moved: updated in place). */
  static update(base: TargetOptions, overrides: Partial<TargetOptionsFields>): TargetOptions {
    return Object.assign(base, overrides);
  }

  /** `#[derive(Clone)]` (maps and their vectors are copied; the rest is immutable or `Copy`). */
  clone(): TargetOptions {
    const o = new TargetOptions({ ...(this as TargetOptionsFields) });
    for (const [k, v] of Object.entries(o)) {
      if (v instanceof Map) {
        (o as unknown as Record<string, unknown>)[k] = new Map([...v].map(([mk, mv]) => [mk, Array.isArray(mv) ? [...mv] : mv]));
      }
    }
    return o;
  }

  /** `#[derive(PartialEq)]` */
  eq(other: TargetOptions): boolean {
    return spec_value_eq({ ...this }, { ...other });
  }

  // ---- `impl TargetOptions` (mod.rs:2652) ----

  // rustc: compiler/rustc_target/src/spec/mod.rs:2653 supports_comdat
  supports_comdat(): boolean {
    // XCOFF and MachO don't support COMDAT.
    return !this.is_like_aix && !this.is_like_darwin;
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:2658 uses_pdb_debuginfo
  uses_pdb_debuginfo(): boolean {
    return this.debuginfo_kind === "Pdb";
  }

  // ---- `impl TargetOptions` (mod.rs:2663) ----

  // rustc: compiler/rustc_target/src/spec/mod.rs:2664 link_args
  static link_args(flavor: LinkerFlavor, args: readonly string[]): LinkArgs {
    const link_args: LinkArgs = new Map();
    add_link_args(link_args, flavor, args);
    return link_args;
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:2670 add_pre_link_args
  add_pre_link_args(flavor: LinkerFlavor, args: readonly string[]): void {
    add_link_args(this.pre_link_args, flavor, args);
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:2674 update_from_cli
  update_from_cli(): void {
    this.linker_flavor = LinkerFlavor.from_cli_json(this.linker_flavor_json, this.lld_flavor_json, this.linker_is_gnu_json);
    for (const [args, args_json] of [
      [this.pre_link_args, this.pre_link_args_json],
      [this.late_link_args, this.late_link_args_json],
      [this.late_link_args_dynamic, this.late_link_args_dynamic_json],
      [this.late_link_args_static, this.late_link_args_static_json],
      [this.post_link_args, this.post_link_args_json],
    ] as const) {
      args.clear();
      for (const [flavor, args_json_] of btree_entries(args_json, LinkerFlavorCli_cmp)) {
        let linker_flavor = LinkerFlavor.with_cli_hints(this.linker_flavor, flavor);
        // Normalize to no lld to avoid asserts.
        switch (linker_flavor.$) {
          case "Gnu":
            linker_flavor = LinkerFlavor.Gnu(linker_flavor._0, "No");
            break;
          case "Darwin":
            linker_flavor = LinkerFlavor.Darwin(linker_flavor._0, "No");
            break;
          case "Msvc":
            linker_flavor = LinkerFlavor.Msvc("No");
            break;
          default:
            break;
        }
        if (!args.has(linker_flavor)) {
          add_link_args_iter(args, linker_flavor, [...args_json_]);
        }
      }
    }
  }

  // rustc: compiler/rustc_target/src/spec/mod.rs:2704 update_to_cli
  update_to_cli(): void {
    this.linker_flavor_json = LinkerFlavor.to_cli_counterpart(this.linker_flavor);
    this.lld_flavor_json = LinkerFlavor.lld_flavor(this.linker_flavor);
    this.linker_is_gnu_json = LinkerFlavor.is_gnu(this.linker_flavor);
    const to_cli = (args: LinkArgs): LinkArgsCli =>
      new Map(btree_entries(args, LinkerFlavor_cmp).map(([flavor, args]) => [LinkerFlavor.to_cli_counterpart(flavor), [...args]]));
    this.pre_link_args_json = to_cli(this.pre_link_args);
    this.late_link_args_json = to_cli(this.late_link_args);
    this.late_link_args_dynamic_json = to_cli(this.late_link_args_dynamic);
    this.late_link_args_static_json = to_cli(this.late_link_args_static);
    this.post_link_args_json = to_cli(this.post_link_args);
  }

  // ---- `impl Default for TargetOptions` (mod.rs:2723) ----

  /// Creates a set of "sane defaults" for any target. This is still
  /// incomplete, and if used for compilation, will certainly not work.
  // rustc: compiler/rustc_target/src/spec/mod.rs:2726 default
  static default(): TargetOptions {
    return new TargetOptions({
      endian: "Little",
      c_int_width: 32,
      os: Os.None,
      env: Env.Unspecified,
      cfg_abi: CfgAbi.Unspecified,
      vendor: "unknown",
      // PORT: `option_env!("CFG_DEFAULT_LINKER")` is unset in the oracle build (its built-in specs
      // print no `linker`, see `--print target-spec-json`).
      linker: undefined,
      linker_flavor: LinkerFlavor.Gnu("Yes", "No"),
      linker_flavor_json: LinkerFlavorCli.Gcc,
      lld_flavor_json: "Ld",
      linker_is_gnu_json: true,
      link_script: undefined,
      asm_args: [],
      cpu: "generic",
      need_explicit_cpu: false,
      requires_consistent_cpu: false,
      unsupported_cpus: [],
      features: "",
      direct_access_external_data: undefined,
      dynamic_linking: false,
      dll_tls_export: true,
      only_cdylib: false,
      executables: true,
      relocation_model: "Pic",
      code_model: undefined,
      tls_model: "GeneralDynamic",
      disable_redzone: false,
      frame_pointer: "MayOmit",
      function_sections: true,
      dll_prefix: "lib",
      dll_suffix: ".so",
      exe_suffix: "",
      staticlib_prefix: "lib",
      staticlib_suffix: ".a",
      families: [],
      abi_return_struct_as_int: false,
      is_like_aix: false,
      is_like_darwin: false,
      is_like_gpu: false,
      is_like_solaris: false,
      is_like_windows: false,
      is_like_msvc: false,
      is_like_wasm: false,
      is_like_android: false,
      is_like_vexos: false,
      binary_format: "Elf",
      default_dwarf_version: 4,
      has_rpath: false,
      no_default_libraries: true,
      position_independent_executables: false,
      static_position_independent_executables: false,
      plt_by_default: true,
      relro_level: "None",
      pre_link_objects: new Map(),
      post_link_objects: new Map(),
      pre_link_objects_self_contained: new Map(),
      post_link_objects_self_contained: new Map(),
      link_self_contained: LinkSelfContainedDefault.False,
      pre_link_args: new Map(),
      pre_link_args_json: new Map(),
      late_link_args: new Map(),
      late_link_args_json: new Map(),
      late_link_args_dynamic: new Map(),
      late_link_args_dynamic_json: new Map(),
      late_link_args_static: new Map(),
      late_link_args_static_json: new Map(),
      post_link_args: new Map(),
      post_link_args_json: new Map(),
      link_env: [],
      link_env_remove: [],
      archive_format: "gnu",
      main_needs_argc_argv: true,
      allow_asm: true,
      static_initializer_must_be_acyclic: false,
      has_thread_local: false,
      obj_is_bitcode: false,
      min_atomic_width: undefined,
      max_atomic_width: undefined,
      atomic_cas: true,
      panic_strategy: "Unwind",
      crt_static_allows_dylibs: false,
      crt_static_default: false,
      crt_static_respected: false,
      stack_probes: StackProbeType.None,
      min_global_align: undefined,
      default_codegen_units: undefined,
      default_codegen_backend: undefined,
      trap_unreachable: true,
      requires_lto: false,
      singlethread: false,
      no_builtins: false,
      default_visibility: undefined,
      emit_debug_gdb_scripts: true,
      requires_uwtable: false,
      default_uwtable: false,
      simd_types_indirect: true,
      limit_rdylib_exports: true,
      override_export_symbols: undefined,
      merge_functions: "Aliases",
      mcount: "mcount",
      llvm_mcount_intrinsic: undefined,
      llvm_abiname: LlvmAbi.Unspecified,
      llvm_floatabi: undefined,
      rustc_abi: undefined,
      relax_elf_relocations: false,
      llvm_args: [],
      use_ctors_section: false,
      eh_frame_header: true,
      has_thumb_interworking: false,
      debuginfo_kind: DebuginfoKind.default(),
      split_debuginfo: SplitDebuginfo.default(),
      // `Off` is supported by default, but targets can remove this manually, e.g. Windows.
      supported_split_debuginfo: ["Off"],
      supported_sanitizers: SanitizerSet.empty(),
      default_sanitizers: SanitizerSet.empty(),
      c_enum_min_bits: undefined,
      generate_arange_section: true,
      supports_stack_protector: true,
      entry_name: "main",
      entry_abi: CanonAbi.C,
      supports_fentry: false,
      supports_xray: false,
      default_address_space: AddressSpaceImpl.ZERO,
      small_data_threshold_support: SmallDataThresholdSupport.DefaultForArch,
    });
  }
}

/// Add arguments for the given flavor and also for its "twin" flavors
/// that have a compatible command line interface.
// rustc: compiler/rustc_target/src/spec/mod.rs:2620 add_link_args_iter
function add_link_args_iter(link_args: LinkArgs, flavor: LinkerFlavor, args: readonly string[]): void {
  const insert = (flavor: LinkerFlavor): void => {
    let v = link_args.get(flavor);
    if (v === undefined) {
      v = [];
      link_args.set(flavor, v);
    }
    v.push(...args);
  };
  insert(flavor);
  switch (flavor.$) {
    case "Gnu":
      assert_eq(flavor._1, "No", String);
      insert(LinkerFlavor.Gnu(flavor._0, "Yes"));
      break;
    case "Darwin":
      assert_eq(flavor._1, "No", String);
      insert(LinkerFlavor.Darwin(flavor._0, "Yes"));
      break;
    case "Msvc":
      assert_eq(flavor._0, "No", String);
      insert(LinkerFlavor.Msvc("Yes"));
      break;
    case "WasmLld":
    case "Unix":
    case "EmCc":
    case "Bpf":
    case "Llbc":
      break;
  }
}

// rustc: compiler/rustc_target/src/spec/mod.rs:2648 add_link_args
export function add_link_args(link_args: LinkArgs, flavor: LinkerFlavor, args: readonly string[]): void {
  add_link_args_iter(link_args, flavor, args);
}

/// `TargetOptions` being a separate type is basically an implementation detail of `Target` that is
/// used for providing defaults. Perhaps there's a way to merge `TargetOptions` into `Target` so
/// this `Deref` implementation is no longer necessary.
// impl Deref for Target / impl DerefMut for Target
// PORT: every `TargetOptions` field and method is forwarded from `Target` (getter + setter on the
// prototype); `target.os` reads `target.options.os` like the auto-deref.
export interface Target extends TargetOptionsFields {
  supports_comdat(): boolean;
  uses_pdb_debuginfo(): boolean;
  add_pre_link_args(flavor: LinkerFlavor, args: readonly string[]): void;
  update_from_cli(): void;
  update_to_cli(): void;
}
// #[inline]
// rustc: compiler/rustc_target/src/spec/mod.rs:2863 deref
function deref(self: Target): TargetOptions {
  return self.options;
}
// #[inline]
// rustc: compiler/rustc_target/src/spec/mod.rs:2869 deref_mut
function deref_mut(self: Target): TargetOptions {
  return self.options;
}
/** The `TargetOptions` field names, in declaration order. */
const TARGET_OPTIONS_FIELDS: readonly (keyof TargetOptionsFields)[] = [
  "endian",
  "c_int_width",
  "os",
  "env",
  "cfg_abi",
  "vendor",
  "linker",
  "linker_flavor",
  "linker_flavor_json",
  "lld_flavor_json",
  "linker_is_gnu_json",
  "pre_link_objects",
  "post_link_objects",
  "pre_link_objects_self_contained",
  "post_link_objects_self_contained",
  "link_self_contained",
  "pre_link_args",
  "pre_link_args_json",
  "late_link_args",
  "late_link_args_json",
  "late_link_args_dynamic",
  "late_link_args_dynamic_json",
  "late_link_args_static",
  "late_link_args_static_json",
  "post_link_args",
  "post_link_args_json",
  "link_script",
  "link_env",
  "link_env_remove",
  "asm_args",
  "cpu",
  "need_explicit_cpu",
  "requires_consistent_cpu",
  "unsupported_cpus",
  "features",
  "direct_access_external_data",
  "dynamic_linking",
  "dll_tls_export",
  "only_cdylib",
  "executables",
  "relocation_model",
  "code_model",
  "tls_model",
  "disable_redzone",
  "frame_pointer",
  "function_sections",
  "dll_prefix",
  "dll_suffix",
  "exe_suffix",
  "staticlib_prefix",
  "staticlib_suffix",
  "families",
  "abi_return_struct_as_int",
  "is_like_aix",
  "is_like_darwin",
  "is_like_gpu",
  "is_like_solaris",
  "is_like_windows",
  "is_like_msvc",
  "is_like_wasm",
  "is_like_android",
  "is_like_vexos",
  "binary_format",
  "default_dwarf_version",
  "has_rpath",
  "no_default_libraries",
  "position_independent_executables",
  "static_position_independent_executables",
  "plt_by_default",
  "relro_level",
  "archive_format",
  "allow_asm",
  "static_initializer_must_be_acyclic",
  "main_needs_argc_argv",
  "has_thread_local",
  "obj_is_bitcode",
  "min_atomic_width",
  "max_atomic_width",
  "atomic_cas",
  "panic_strategy",
  "crt_static_allows_dylibs",
  "crt_static_default",
  "crt_static_respected",
  "stack_probes",
  "min_global_align",
  "default_codegen_units",
  "default_codegen_backend",
  "trap_unreachable",
  "requires_lto",
  "singlethread",
  "no_builtins",
  "default_visibility",
  "emit_debug_gdb_scripts",
  "requires_uwtable",
  "default_uwtable",
  "simd_types_indirect",
  "limit_rdylib_exports",
  "override_export_symbols",
  "merge_functions",
  "mcount",
  "llvm_mcount_intrinsic",
  "llvm_abiname",
  "llvm_floatabi",
  "rustc_abi",
  "relax_elf_relocations",
  "llvm_args",
  "use_ctors_section",
  "eh_frame_header",
  "has_thumb_interworking",
  "debuginfo_kind",
  "split_debuginfo",
  "supported_split_debuginfo",
  "supported_sanitizers",
  "default_sanitizers",
  "c_enum_min_bits",
  "generate_arange_section",
  "supports_stack_protector",
  "entry_name",
  "entry_abi",
  "supports_fentry",
  "supports_xray",
  "default_address_space",
  "small_data_threshold_support",
];
for (const key of TARGET_OPTIONS_FIELDS) {
  Object.defineProperty(Target.prototype, key, {
    configurable: true,
    get(this: Target) {
      return (deref(this) as unknown as Record<string, unknown>)[key];
    },
    set(this: Target, v: unknown) {
      (deref_mut(this) as unknown as Record<string, unknown>)[key] = v;
    },
  });
}
for (const key of ["supports_comdat", "uses_pdb_debuginfo", "add_pre_link_args", "update_from_cli", "update_to_cli"] as const) {
  Object.defineProperty(Target.prototype, key, {
    configurable: true,
    value(this: Target, ...args: unknown[]) {
      return (deref_mut(this)[key] as (...a: unknown[]) => unknown).apply(deref_mut(this), args);
    },
  });
}
