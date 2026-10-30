// Port of compiler/rustc_session/src/options/mitigation_coverage.rs.
//
// The `denied_partial_mitigations!` expansion (`DeniedPartialMitigationKind`, its Display/FromStr,
// `KINDS`, `allowed_by_default_at`, `Options::all_denied_partial_mitigations`,
// `Session::gather_enabled_denied_partial_mitigations`) is generated into
// mitigation_coverage.gen.ts by tools/codegen/options.ts.
//
// PORT: `impl Options` methods are attached to `Options.prototype` here (PORTING.md section 5,
// "Methods defined in another file"); `Options` is imported through options.ts (never options.gen.ts
// directly, see options.ts).
import type { Edition } from "../../rustc_span/edition.ts";
import { type Debug, debug_bool, debug_struct, debug_tuple } from "../../std/fmt.ts";
import { type StackProtector, debug_StackProtector } from "../stand_ins.ts";
import { Options } from "../options.ts";
import { type Decoder, decode_bool, encode_bool } from "../../rustc_serialize/serialize.ts";
import type { SpanEncoder } from "../../rustc_span/lib.ts";
import { decode_StackProtector, encode_StackProtector } from "../../rustc_target/spec/mod.ts";
import { panic } from "../../std/panic.ts";
import {
  DeniedPartialMitigationKind,
  DeniedPartialMitigationKind_discriminant,
  all_denied_partial_mitigations,
  debug_DeniedPartialMitigationKind,
} from "./mitigation_coverage.gen.ts";

export * from "./mitigation_coverage.gen.ts";

export type DeniedPartialMitigationLevel =
  // Enabled(false) should be the bottom of the Ord hierarchy
  { readonly $: "Enabled"; readonly _0: boolean } | { readonly $: "StackProtector"; readonly _0: StackProtector };

export const DeniedPartialMitigationLevel = {
  // rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:20 level_str
  level_str(self: DeniedPartialMitigationLevel): string {
    if (self.$ === "StackProtector" && self._0 === "All") return "=all";
    if (self.$ === "StackProtector" && self._0 === "Basic") return "=basic";
    if (self.$ === "StackProtector" && self._0 === "Strong") return "=strong";
    // currently `=disabled` should not appear
    if (self.$ === "Enabled" && self._0 === false) return "=disabled";
    // DeniedPartialMitigationLevel::StackProtector(StackProtector::None)
    // | DeniedPartialMitigationLevel::Enabled(true)
    return "";
  },

  /** `impl From<bool> for DeniedPartialMitigationLevel` */
  // rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:57 from
  from_bool(value: boolean): DeniedPartialMitigationLevel {
    return { $: "Enabled", _0: value };
  },

  /** `impl From<StackProtector> for DeniedPartialMitigationLevel` */
  // rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:63 from
  from_stack_protector(value: StackProtector): DeniedPartialMitigationLevel {
    return { $: "StackProtector", _0: value };
  },
} as const;

/** `impl std::fmt::Display for DeniedPartialMitigationLevel` */
// rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:34 fmt
export function display_DeniedPartialMitigationLevel(self: DeniedPartialMitigationLevel): string {
  if (self.$ === "StackProtector" && self._0 === "All") return "all";
  if (self.$ === "StackProtector" && self._0 === "Basic") return "basic";
  if (self.$ === "StackProtector" && self._0 === "Strong") return "strong";
  if (self.$ === "Enabled" && self._0 === true) return "enabled";
  // DeniedPartialMitigationLevel::StackProtector(StackProtector::None)
  // | DeniedPartialMitigationLevel::Enabled(false)
  return "disabled";
}

/** `#[derive(Debug)]` */
export const debug_DeniedPartialMitigationLevel: Debug<DeniedPartialMitigationLevel> = (v, f) =>
  v.$ === "Enabled" ? debug_tuple(f, "Enabled", [debug_bool(v._0, f)]) : debug_tuple(f, "StackProtector", [debug_StackProtector(v._0, f)]);

interface MitigationStatus {
  // This is the index of the option in the command line. This is needed because
  // re-enabling a mitigation resets the partial mitigation status if it's later in the command
  // line, and this works across `-C` and `-Z` args.
  //
  // e.g. `-Z stack-protector=strong` resets `-C allow-partial-mitigations=stack-protector`.
  index: number;
  allowed: boolean | undefined;
}

// PORT: `BTreeMap<DeniedPartialMitigationKind, MitigationStatus>` -> `Map`; the only reader
// (`allowed_partial_mitigations`) builds a set and returns it in key order.
export class MitigationCoverageMap {
  constructor(public map: Map<DeniedPartialMitigationKind, MitigationStatus>) {}

  /** `#[derive(Default)]` */
  static default(): MitigationCoverageMap {
    return new MitigationCoverageMap(new Map());
  }

  // rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:85 apply_mitigation
  apply_mitigation(kind: DeniedPartialMitigationKind, index: number, allowed: boolean | undefined): void {
    const e = this.map.get(kind);
    if (e !== undefined) {
      if (index >= e.index) {
        this.map.set(kind, { index, allowed });
      }
    } else {
      this.map.set(kind, { index, allowed });
    }
  }

  // rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:101 handle_allowdeny_mitigation_option
  handle_allowdeny_mitigation_option(v: string | undefined, index: number, allowed: boolean): boolean {
    if (v !== undefined) {
      for (const sub of v.split(",")) {
        const kind = DeniedPartialMitigationKind.from_str(sub);
        if (kind.$ === "Ok") this.apply_mitigation(kind._0, index, allowed);
        else return false;
      }
      return true;
    }
    return false;
  }

  // rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:121 reset_mitigation
  reset_mitigation(kind: DeniedPartialMitigationKind, index: number): void {
    this.apply_mitigation(kind, index, undefined);
  }
}

// PORT: the unit struct `DeniedPartialMitigationKindParseError` -> `undefined`.
export type DeniedPartialMitigationKindParseError = undefined;

/// A mitigation that cannot be partially enabled (see
/// [RFC 3855](https://github.com/rust-lang/rfcs/pull/3855)), but are currently enabled for this
/// crate.
export interface DeniedPartialMitigation {
  kind: DeniedPartialMitigationKind;
  level: DeniedPartialMitigationLevel;
}

// PORT: the three `#[derive(BlobDecodable)]`s of this file, hand-expanded (rustc_macros serialize.rs `decodable_body`:
// an enum reads its variant index with `read_u8`, then the variant's fields; a struct reads its fields in order).
// `DeniedPartialMitigationKind` is defined inside `denied_partial_mitigations!` (tools/codegen/options.ts) and the
// other two are hand-written types; crate metadata decodes them (rmeta `CrateRoot::decode_denied_partial_mitigations`).

/** `#[derive(BlobDecodable)]` of `DeniedPartialMitigationLevel` (mitigation_coverage.rs:12). */
export function decode_DeniedPartialMitigationLevel(__decoder: Decoder): DeniedPartialMitigationLevel {
  const __tag = __decoder.read_u8();
  switch (__tag) {
    case 0:
      return { $: "Enabled", _0: decode_bool(__decoder) };
    case 1:
      return { $: "StackProtector", _0: decode_StackProtector(__decoder) };
    default:
      return panic(`invalid enum variant tag while decoding \`DeniedPartialMitigationLevel\`, expected 0..2, actual ${__tag}`);
  }
}

/** `#[derive(BlobDecodable)]` of `DeniedPartialMitigationKind` (inside `denied_partial_mitigations!`, mitigation_coverage.rs:136). */
export function decode_DeniedPartialMitigationKind(__decoder: Decoder): DeniedPartialMitigationKind {
  const __tag = __decoder.read_u8();
  switch (__tag) {
    case 0:
      return "StackProtector";
    case 1:
      return "ControlFlowGuard";
    default:
      return panic(`invalid enum variant tag while decoding \`DeniedPartialMitigationKind\`, expected 0..2, actual ${__tag}`);
  }
}

/** `#[derive(BlobDecodable)]` of `DeniedPartialMitigation` (mitigation_coverage.rs:216). */
export function decode_DeniedPartialMitigation(__decoder: Decoder): DeniedPartialMitigation {
  return {
    kind: decode_DeniedPartialMitigationKind(__decoder),
    level: decode_DeniedPartialMitigationLevel(__decoder),
  };
}
// PORT (lane encoder-d): the `#[derive(Encodable)]` halves of the same three types, hand-expanded likewise
// (rustc_macros serialize.rs `encodable_body`: an enum emits its variant index with `emit_u8`, then the variant's
// fields; a struct emits its fields in order). Crate metadata encodes them (rmeta
// `EncodeContext::encode_enabled_denied_partial_mitigations`).

/** `#[derive(Encodable)]` of `DeniedPartialMitigationLevel` (mitigation_coverage.rs:12). */
export function encode_DeniedPartialMitigationLevel(self: DeniedPartialMitigationLevel, __encoder: SpanEncoder): void {
  switch (self.$) {
    case "Enabled":
      __encoder.emit_u8(0);
      encode_bool(self._0, __encoder);
      break;
    case "StackProtector":
      __encoder.emit_u8(1);
      encode_StackProtector(self._0, __encoder);
      break;
  }
}

/** `#[derive(Encodable)]` of `DeniedPartialMitigationKind` (inside `denied_partial_mitigations!`, mitigation_coverage.rs:136). */
export function encode_DeniedPartialMitigationKind(self: DeniedPartialMitigationKind, __encoder: SpanEncoder): void {
  __encoder.emit_u8(DeniedPartialMitigationKind_discriminant[self]);
}

/** `#[derive(Encodable)]` of `DeniedPartialMitigation` (mitigation_coverage.rs:216). */
export function encode_DeniedPartialMitigation(self: DeniedPartialMitigation, __encoder: SpanEncoder): void {
  encode_DeniedPartialMitigationKind(self.kind, __encoder);
  encode_DeniedPartialMitigationLevel(self.level, __encoder);
}
/** `#[derive(Debug)]` */
export const debug_DeniedPartialMitigation: Debug<DeniedPartialMitigation> = (v, f) =>
  debug_struct(f, "DeniedPartialMitigation", [
    ["kind", debug_DeniedPartialMitigationKind(v.kind, f)],
    ["level", debug_DeniedPartialMitigationLevel(v.level, f)],
  ]);

declare module "../options.gen.ts" {
  interface Options {
    all_denied_partial_mitigations(): DeniedPartialMitigationKind[];
    allowed_partial_mitigations(edition: Edition): DeniedPartialMitigationKind[];
  }
}

// PORT: the `impl Options` fn of the macro expansion is generated (marker in mitigation_coverage.gen.ts).
Options.prototype.all_denied_partial_mitigations = function (this: Options): DeniedPartialMitigationKind[] {
  return all_denied_partial_mitigations(this);
};

// Return the list of mitigations that are allowed to be partial
// rustc: compiler/rustc_session/src/options/mitigation_coverage.rs:224 allowed_partial_mitigations
Options.prototype.allowed_partial_mitigations = function (this: Options, edition: Edition): DeniedPartialMitigationKind[] {
  // PORT: `BTreeSet<DeniedPartialMitigationKind>` -> `Set`, returned sorted by the derived `Ord`.
  const result = new Set(this.all_denied_partial_mitigations().filter((mitigation) => DeniedPartialMitigationKind.allowed_by_default_at(mitigation, edition)));
  for (const [kind, { allowed }] of this.mitigation_coverage_map.map) {
    switch (allowed) {
      case true: {
        result.add(kind);
        break;
      }
      case false: {
        result.delete(kind);
        break;
      }
      case undefined:
        break;
    }
  }
  return [...result].sort((a, b) => DeniedPartialMitigationKind_discriminant[a] - DeniedPartialMitigationKind_discriminant[b]);
};

