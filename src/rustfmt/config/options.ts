// Port of the hand-written parts of src/tools/rustfmt/src/config/options.rs (lane rustfmt-contract-1).
// The `#[config_type]` enums, `WidthHeuristics` (+ its serde derives) and `IgnoreList` are generated into options.gen.ts
// (tools/codegen/rustfmt.ts), `config_option_with_style_edition_default!` (options.rs:599) into create_config.gen.ts. Here:
// the enums' inherent and trait fns on their companion consts (PORTING §8), the classes' associated fns and methods
// (`Object.assign` / `declare module` + prototype), `Display` (`display_<T>`), the manual serde impls of `IgnoreList`, and
// `CliOptions`.
import * as gen from "./options.gen.ts";
import { IgnoreList, WidthHeuristics, debug_WidthHeuristics } from "./options.gen.ts";
import type { ListTactic } from "./lists.ts";
import type { Config } from "./create_config.gen.ts";
import { type Edition as rustc_span_Edition, Edition_discriminant as rustc_span_Edition_discriminant } from "../../rustc_span/edition.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { deserialize_String } from "../../vendor/serde_core/de/impls.ts";
import type { Deserializer, SeqAccess, Visitor } from "../../vendor/serde_core/de/mod.ts";
import type { Serializer } from "../../vendor/serde_core/ser/mod.ts";

export * from "./options.gen.ts";

/** `Option<std::cmp::Ordering>`: `-1` Less, `0` Equal, `1` Greater, `undefined` None. */
export type PartialOrdering = -1 | 0 | 1 | undefined;

/// Heuristic settings that can be used to simply
/// the configuration of the granular width configurations
/// like `struct_lit_width`, `array_width`, etc.
export type Heuristics = gen.Heuristics;

/// Configuration for doc comments
/// from the top-level configuration.
export type DocCodeHeuristics = gen.DocCodeHeuristics;
export const DocCodeHeuristics = {
  ...gen.DocCodeHeuristics,

  // rustc: src/tools/rustfmt/src/config/options.rs:113 to_heuristics
  to_heuristics(self: DocCodeHeuristics): Heuristics | undefined {
    switch (self) {
      case "Inherit":
        return undefined;
      case "Off":
        return "Off";
      case "Max":
        return "Max";
      case "Default":
        return "Default";
    }
  },
};

export type Density = gen.Density;
export const Density = {
  ...gen.Density,

  // rustc: src/tools/rustfmt/src/config/options.rs:124 to_list_tactic
  to_list_tactic(self: Density, style_edition: StyleEdition, len: number): ListTactic {
    switch (self) {
      case "Compressed":
        return { $: "Mixed" };
      case "Tall":
        return { $: "HorizontalVertical" };
      case "Vertical":
        if (len === 1) {
          if (StyleEdition.le(style_edition, "Edition2024")) {
            return { $: "Horizontal" };
          } else {
            return { $: "HorizontalVertical" };
          }
        }
        return { $: "Vertical" };
    }
  },
};

export type Color = gen.Color;
export const Color = {
  ...gen.Color,

  /// Whether we should use a coloured terminal.
  // rustc: src/tools/rustfmt/src/config/options.rs:248 use_colored_tty
  use_colored_tty(self: Color): boolean {
    switch (self) {
      case "Always":
      case "Auto":
        return true;
      case "Never":
        return false;
    }
  },
};

// rustc: src/tools/rustfmt/src/config/options.rs:295 fmt
export function display_WidthHeuristics(self: WidthHeuristics): string {
  return debug_WidthHeuristics(self, PLAIN);
}

/** `#[derive(PartialEq)]` of `WidthHeuristics`. */
export function WidthHeuristics_eq(self: WidthHeuristics, other: WidthHeuristics): boolean {
  return (
    self.fn_call_width === other.fn_call_width &&
    self.attr_fn_like_width === other.attr_fn_like_width &&
    self.struct_lit_width === other.struct_lit_width &&
    self.struct_variant_width === other.struct_variant_width &&
    self.array_width === other.array_width &&
    self.chain_width === other.chain_width &&
    self.single_line_if_else_max_width === other.single_line_if_else_max_width &&
    self.single_line_let_else_max_width === other.single_line_let_else_max_width
  );
}

/** PORT: `usize::MAX` is `Number.MAX_SAFE_INTEGER` (as in rustc_mir_transform/promote_consts.ts): exact in every comparison
 *  with a real width; printing it (`--print-config current` with `use_small_heuristics = "Off"`) is not. Handoff item. */
export const USIZE_MAX = Number.MAX_SAFE_INTEGER;

/** `f32::round` (half away from zero) of an f32 value. */
function f32_round(x: number): number {
  return Math.fround(x < 0 ? -Math.round(-x) : Math.round(x));
}
/** `f32 as usize` (saturating; NaN → 0) of an integral f32. */
function f32_as_usize(x: number): number {
  return Number.isNaN(x) || x <= 0 ? 0 : x >= 2 ** 64 ? USIZE_MAX : x;
}

declare module "./options.gen.ts" {
  namespace WidthHeuristics {
    function null_(): WidthHeuristics;
    export { null_ as null };
    export function set(max_width: number): WidthHeuristics;
    export function scaled(max_width: number): WidthHeuristics;
    export function from_str(s: string): Result<WidthHeuristics, string>;
  }
}

Object.assign(WidthHeuristics, {
  // Using this WidthHeuristics means we ignore heuristics.
  // rustc: src/tools/rustfmt/src/config/options.rs:302 null
  null(): WidthHeuristics {
    return new WidthHeuristics(USIZE_MAX, USIZE_MAX, 0, 0, USIZE_MAX, USIZE_MAX, 0, 0);
  },

  // rustc: src/tools/rustfmt/src/config/options.rs:315 set
  set(max_width: number): WidthHeuristics {
    return new WidthHeuristics(max_width, max_width, max_width, max_width, max_width, max_width, max_width, max_width);
  },

  // scale the default WidthHeuristics according to max_width
  // rustc: src/tools/rustfmt/src/config/options.rs:329 scaled
  scaled(max_width: number): WidthHeuristics {
    const DEFAULT_MAX_WIDTH = 100;
    // PORT: f32 arithmetic: every intermediate result is rounded to f32 (`Math.fround`).
    let max_width_ratio: number;
    if (max_width > DEFAULT_MAX_WIDTH) {
      const ratio = Math.fround(Math.fround(max_width) / Math.fround(DEFAULT_MAX_WIDTH));
      // round to the closest 0.1
      max_width_ratio = Math.fround(f32_round(Math.fround(ratio * 10.0)) / 10.0);
    } else {
      max_width_ratio = 1.0;
    }
    const w = (n: number): number => f32_as_usize(f32_round(Math.fround(n * max_width_ratio)));
    return new WidthHeuristics(w(60.0), w(70.0), w(18.0), w(35.0), w(60.0), w(60.0), w(50.0), w(50.0));
  },

  // `impl ::std::str::FromStr for WidthHeuristics`
  // rustc: src/tools/rustfmt/src/config/options.rs:354 from_str
  from_str(_: string): Result<WidthHeuristics, string> {
    return Err("WidthHeuristics is not parsable");
  },
});

export type EmitMode = gen.EmitMode;

// `impl Default for EmitMode`
// rustc: src/tools/rustfmt/src/config/options.rs:360 default
export function default_EmitMode(): EmitMode {
  return "Files";
}

/// A set of directories, files and modules that rustfmt should ignore.
// rustc: src/tools/rustfmt/src/config/options.rs:375 fmt
export function display_IgnoreList(self: IgnoreList): string {
  // PORT: `path_set` is a std `HashSet` (`RandomState`): its iteration order is random per process upstream, so no output
  // depends on one; the port iterates in insertion order, one of the orders upstream can produce.
  // `.format_with(", ", |path, f| f(&format_args!("{}", path.to_string_lossy())))` (itertools)
  return `[${[...self.path_set].join(", ")}]`;
}

/** `#[derive(PartialEq)]` of `IgnoreList`. */
export function IgnoreList_eq(self: IgnoreList, other: IgnoreList): boolean {
  if (self.path_set.size !== other.path_set.size) return false;
  for (const p of self.path_set) if (!other.path_set.has(p)) return false;
  return self.rustfmt_toml_path === other.rustfmt_toml_path;
}

// PORT: the serde surface the manual impls below use beyond what the derives need (serde.ts SERDE_SURFACE_DECLS):
// `Serializer::serialize_seq`, `SerializeSeq` and `Deserializer::deserialize_seq`. Typed here until vendor-serde-de
// provides them (handoff: docs/handoff/rustfmt-contract-1.md).
interface SerializeSeq<O, E> {
  serialize_element<T>(value: T, serialize_T: <O2, E2>(self: T, serializer: Serializer<O2, E2>) => Result<O2, E2>): Result<null, E>;
  end(): Result<O, E>;
}
type SeqSerializer<O, E> = Serializer<O, E> & { serialize_seq(len: number | undefined): Result<SerializeSeq<O, E>, E> };
type SeqDeserializer<E> = Deserializer<E> & { deserialize_seq<V>(visitor: Visitor<V>): Result<V, E> };

/** `impl Serialize for PathBuf` (serde): `serialize_str` of a UTF-8 path. */
function serialize_PathBuf<O, E>(self: string, serializer: Serializer<O, E>): Result<O, E> {
  // PORT: `self.to_str()` is `None` only for a non-UTF-8 path, which a JS string cannot hold.
  return serializer.serialize_str(self);
}

// rustc: src/tools/rustfmt/src/config/options.rs:390 serialize
export function serialize_IgnoreList<O, E>(self: IgnoreList, serializer: Serializer<O, E>): Result<O, E> {
  const seq_r = (serializer as SeqSerializer<O, E>).serialize_seq(self.path_set.size);
  if (seq_r.$ === "Err") return seq_r;
  const seq = seq_r._0;
  // PORT: insertion order for the `HashSet` (see `display_IgnoreList`).
  for (const e of self.path_set) {
    const r = seq.serialize_element(e, serialize_PathBuf);
    if (r.$ === "Err") return r;
  }
  return seq.end();
}

// rustc: src/tools/rustfmt/src/config/options.rs:403 deserialize
export function deserialize_IgnoreList<E>(deserializer: Deserializer<E>): Result<IgnoreList, E> {
  const HashSetVisitor: Visitor<Set<string>> = {
    // rustc: src/tools/rustfmt/src/config/options.rs:411 expecting
    expecting(): string {
      return "a sequence of path";
    },

    // rustc: src/tools/rustfmt/src/config/options.rs:415 visit_seq
    visit_seq<A>(seq: SeqAccess<A>): Result<Set<string>, A> {
      const path_set = new Set<string>();
      for (;;) {
        // PORT: `PathBuf: Deserialize` reads a string (serde's `PathBufVisitor` also takes bytes; vendor-serde-de's).
        const elem = seq.next_element<string>(deserialize_String);
        if (elem.$ === "Err") return elem;
        if (elem._0 === undefined) break;
        path_set.add(elem._0._0);
      }
      return Ok(path_set);
    },
  };
  const path_set = (deserializer as SeqDeserializer<E>).deserialize_seq(HashSetVisitor);
  if (path_set.$ === "Err") return path_set;
  return Ok(new IgnoreList(path_set._0, ""));
}

declare module "./options.gen.ts" {
  interface IgnoreList {
    into_iter(): IterableIterator<string>;
    add_prefix(dir: string): void;
    rustfmt_toml_path_(): string;
  }
  namespace IgnoreList {
    export function from_str(s: string): Result<IgnoreList, string>;
  }
}

// `impl<'a> IntoIterator for &'a IgnoreList`
// rustc: src/tools/rustfmt/src/config/options.rs:437 into_iter
IgnoreList.prototype.into_iter = function (this: IgnoreList): IterableIterator<string> {
  return this.path_set.values();
};

// rustc: src/tools/rustfmt/src/config/options.rs:443 add_prefix
IgnoreList.prototype.add_prefix = function (this: IgnoreList, dir: string): void {
  this.rustfmt_toml_path = dir;
};

// PORT: the getter `rustfmt_toml_path()` is `rustfmt_toml_path_()`: the class has a field of that name.
// rustc: src/tools/rustfmt/src/config/options.rs:447 rustfmt_toml_path
IgnoreList.prototype.rustfmt_toml_path_ = function (this: IgnoreList): string {
  return this.rustfmt_toml_path;
};

Object.assign(IgnoreList, {
  // `impl FromStr for IgnoreList`
  // rustc: src/tools/rustfmt/src/config/options.rs:455 from_str
  from_str(_: string): Result<IgnoreList, string> {
    return Err("IgnoreList is not parsable");
  },
});

/// Maps client-supplied options to Rustfmt's internals, mostly overriding
/// values in a config with values from the command line.
export interface CliOptions {
  // rustc: src/tools/rustfmt/src/config/options.rs:463 apply_to
  apply_to(config: Config): void;

  /// It is ok if the returned path doesn't exist or is not canonicalized
  /// (i.e. the callers are expected to handle such cases).
  // rustc: src/tools/rustfmt/src/config/options.rs:467 config_path
  config_path(): string | undefined;
  // rustc: src/tools/rustfmt/src/config/options.rs:468 edition
  edition(): Edition | undefined;
  // rustc: src/tools/rustfmt/src/config/options.rs:469 style_edition
  style_edition(): StyleEdition | undefined;
  // rustc: src/tools/rustfmt/src/config/options.rs:470 version
  version(): Version | undefined;
}

export type Version = gen.Version;

/// The edition of the syntax and semantics of code (RFC 2052).
export type Edition = gen.Edition;
export const Edition = {
  ...gen.Edition,

  // `impl Default for Edition`
  // rustc: src/tools/rustfmt/src/config/options.rs:495 default
  default(): Edition {
    return "Edition2015";
  },

  // `impl From<Edition> for rustc_span::edition::Edition`
  // rustc: src/tools/rustfmt/src/config/options.rs:501 from
  into_rustc_span(edition: Edition): rustc_span_Edition {
    switch (edition) {
      case "Edition2015":
        return "Edition2015";
      case "Edition2018":
        return "Edition2018";
      case "Edition2021":
        return "Edition2021";
      case "Edition2024":
        return "Edition2024";
    }
  },

  // `impl From<Edition> for StyleEdition`
  // rustc: src/tools/rustfmt/src/config/options.rs:512 from
  into_StyleEdition(edition: Edition): StyleEdition {
    switch (edition) {
      case "Edition2015":
        return "Edition2015";
      case "Edition2018":
        return "Edition2018";
      case "Edition2021":
        return "Edition2021";
      case "Edition2024":
        return "Edition2024";
    }
  },

  // `impl PartialOrd for Edition`
  // rustc: src/tools/rustfmt/src/config/options.rs:523 partial_cmp
  partial_cmp(self: Edition, other: Edition): PartialOrdering {
    return rustc_span_Edition_partial_cmp(Edition.into_rustc_span(self), Edition.into_rustc_span(other));
  },
};

/** `rustc_span::edition::Edition::partial_cmp` (`#[derive(PartialOrd)]`: declaration order). */
function rustc_span_Edition_partial_cmp(a: rustc_span_Edition, b: rustc_span_Edition): PartialOrdering {
  const x = rustc_span_Edition_discriminant[a];
  const y = rustc_span_Edition_discriminant[b];
  return x < y ? -1 : x > y ? 1 : 0;
}

/// Defines the default values for each config according to the edition of the
/// [Style Guide] as per [RFC 3338]. Rustfmt output may differ between Style editions.
///
/// [Style Guide]: https://doc.rust-lang.org/nightly/style-guide/
/// [RFC 3338]: https://rust-lang.github.io/rfcs/3338-style-evolution.html
export type StyleEdition = gen.StyleEdition;
export const StyleEdition = {
  ...gen.StyleEdition,

  // `impl From<StyleEdition> for rustc_span::edition::Edition`
  // rustc: src/tools/rustfmt/src/config/options.rs:570 from
  into_rustc_span(edition: StyleEdition): rustc_span_Edition {
    switch (edition) {
      case "Edition2015":
        return "Edition2015";
      case "Edition2018":
        return "Edition2018";
      case "Edition2021":
        return "Edition2021";
      case "Edition2024":
        return "Edition2024";
      // TODO: should update to Edition2027 when it becomes available
      case "Edition2027":
        return "Edition2024";
    }
  },

  // `impl PartialOrd for StyleEdition`
  // rustc: src/tools/rustfmt/src/config/options.rs:583 partial_cmp
  partial_cmp(self: StyleEdition, other: StyleEdition): PartialOrdering {
    // FIXME(ytmimi): Update `StyleEdition::Edition2027` logic when
    // `rustc_span::edition::Edition::Edition2027` becomes available in the compiler
    if (self === "Edition2027" && other === "Edition2027") return 0;
    if (other === "Edition2027") return -1;
    if (self === "Edition2027") return 1;
    return rustc_span_Edition_partial_cmp(StyleEdition.into_rustc_span(self), StyleEdition.into_rustc_span(other));
  },

  /** `PartialOrd::lt` (provided: `partial_cmp == Some(Less)`). */
  lt(self: StyleEdition, other: StyleEdition): boolean {
    return StyleEdition.partial_cmp(self, other) === -1;
  },
  /** `PartialOrd::le` (provided: `Some(Less | Equal)`). */
  le(self: StyleEdition, other: StyleEdition): boolean {
    const o = StyleEdition.partial_cmp(self, other);
    return o === -1 || o === 0;
  },
  /** `PartialOrd::gt` (provided: `Some(Greater)`). */
  gt(self: StyleEdition, other: StyleEdition): boolean {
    return StyleEdition.partial_cmp(self, other) === 1;
  },
  /** `PartialOrd::ge` (provided: `Some(Greater | Equal)`). */
  ge(self: StyleEdition, other: StyleEdition): boolean {
    const o = StyleEdition.partial_cmp(self, other);
    return o === 1 || o === 0;
  },
};
