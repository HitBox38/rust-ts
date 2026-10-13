// Port of compiler/rustc_session/src/options.rs (the hand-written parts).
//
// The expansions of `top_level_options!` (`Options`, `OptionsTargetModifiers`) and of both
// `options!` invocations (`CodegenOptions` / `CG_OPTIONS` / `cgopts`, `UnstableOptions` /
// `Z_OPTIONS` / `dbopts`), plus `mod desc` and `POLONIUS_HELP`, are generated into options.gen.ts by
// tools/codegen/options.ts and re-exported here.
//
// PORT: module layout. options.gen.ts imports the `parse_*` fns from this module and this module
// attaches a method to its `CodegenOptions` class, so consumers must import through this module
// (never options.gen.ts directly): this module evaluates options.gen.ts first (its top level only
// reads config.ts / mitigation_coverage.gen.ts), then itself.
//
// PORT: `mod parse` is flattened: `parse::parse_bool` -> `parse_bool` (exported from this module).
// `&mut T` slots are `MutRef<T>` (`{ value: T }`, PORTING.md section 8); the generated setters copy
// the field in and out. The generic `parse_number<T: FromStr>` / `parse_opt_number<T: FromStr>` take
// the `FromStr` of `T` as an explicit parameter (`usize_from_str`, `u32_from_str`, `u64_from_str`, ...).
import { RustcVersion } from "../rustc_ast/attr/version.ts";
import type { TerminalUrl } from "../rustc_errors/lib.ts";
import { edit_distance } from "../rustc_span/edit_distance.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import { SourceFileHashAlgorithm } from "../rustc_span/lib.ts";
import { is_whitespace } from "../std/char.ts";
import { type Debug, debug_str, debug_struct } from "../std/fmt.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import {
  type AnnotateMoves,
  type AutoDiff,
  type BranchProtection,
  type CFGuard,
  type CFProtection,
  type CodegenRetagOptions,
  type CoverageOptions,
  type DebugInfo,
  type DebugInfoCompression,
  type DumpMonoStatsFormat,
  type FmtDebug,
  type FunctionReturn,
  type IncrementalStateAssertion,
  type InliningThreshold,
  type InstrumentCoverage,
  type InstrumentMcount,
  InstrumentMcountOpts,
  InstrumentXRay,
  type LinkSelfContained,
  type LinkerFeaturesCli,
  type LinkerPluginLto,
  type LocationDetail,
  type LtoCli,
  type MirIncludeSpans,
  type MirStripDebugInfo,
  type NextSolverConfig,
  type Offload,
  PatchableFunctionEntry,
  BranchProtection as BranchProtectionC,
  Passes,
  PointerAuthOption,
  PointerAuthOption_discriminant,
  type Polonius,
  type ProcMacroExecutionStrategy,
  SplitDwarfKind,
  type Strip,
  type SwitchWithOptPath,
  type SymbolManglingVersion,
  type WasiExecModel,
} from "./config.ts";
import type { Session } from "./lib.ts";
import {
  type Align,
  Align as AlignC,
  type CodeModel,
  CodeModel as CodeModelC,
  type CollapseMacroDebuginfo,
  type EarlyDiagCtxt,
  FramePointer,
  type LinkerFlavorCli,
  LinkerFlavorCli as LinkerFlavorCliC,
  type Matches,
  type MergeFunctions,
  MergeFunctions as MergeFunctionsC,
  type OnBrokenPipe,
  type PanicStrategy,
  type RelocModel,
  RelocModel as RelocModelC,
  type RelroLevel,
  RelroLevel as RelroLevelC,
  SanitizerSet,
  type SplitDebuginfo,
  SplitDebuginfo as SplitDebuginfoC,
  type StackProtector,
  StackProtector as StackProtectorC,
  type SymbolVisibility,
  SymbolVisibility as SymbolVisibilityC,
  type TimePassesFormat,
  type TlsModel,
  TlsModel as TlsModelC,
} from "./stand_ins.ts";
import {
  CodegenOptions,
  OptionsTargetModifiers,
  OptionsTargetModifiers_cmp,
  debug_OptionsTargetModifiers,
  desc,
} from "./options.gen.ts";
import type { DeniedPartialMitigationKind } from "./options/mitigation_coverage.gen.ts";
import { MitigationCoverageMap } from "./options/mitigation_coverage.ts";

export * from "./options.gen.ts";
export * as mitigation_coverage from "./options/mitigation_coverage.ts";

// ---- helpers for std behavior the parsers rely on ----

/** `core::num::IntErrorKind` */
export type IntErrorKind = "Empty" | "InvalidDigit" | "PosOverflow" | "NegOverflow" | "Zero";

// PORT: `<uN as FromStr>::from_str` (radix 10): an optional leading `+`, then one or more ASCII
// digits; `""` is `Empty`, a lone `+` or any other character is `InvalidDigit`, a value above
// `max` is `PosOverflow` (reported as soon as the accumulated value overflows, like core).
function uint_from_str(s: string, max: bigint): Result<bigint, IntErrorKind> {
  if (s.length === 0) return Err("Empty");
  let digits = s;
  if (digits.length === 1 && (digits === "+" || digits === "-")) return Err("InvalidDigit");
  if (digits.startsWith("+")) digits = digits.slice(1);
  let v = 0n;
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return Err("InvalidDigit");
    v = v * 10n + BigInt(c - 0x30);
    if (v > max) return Err("PosOverflow");
  }
  return Ok(v);
}
const U8_MAX = 0xffn;
const U32_MAX = 0xffff_ffffn;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
/** `u8::from_str` */
export function u8_from_str(s: string): Result<number, IntErrorKind> {
  const r = uint_from_str(s, U8_MAX);
  return r.$ === "Err" ? r : Ok(Number(r._0));
}
/** `u32::from_str` */
export function u32_from_str(s: string): Result<number, IntErrorKind> {
  const r = uint_from_str(s, U32_MAX);
  return r.$ === "Err" ? r : Ok(Number(r._0));
}
/** `u64::from_str` (PORT: u64 option values are `bigint`; every u64 is accepted exactly). */
export function u64_from_str(s: string): Result<bigint, IntErrorKind> {
  return uint_from_str(s, U64_MAX);
}
/**
 * `usize::from_str` for the 64-bit hosts the oracle runs on. PORT: usize option values (counts,
 * thresholds, limits) are `number`: every u64 string is accepted like upstream, values above 2^53
 * are rounded to the nearest double.
 */
export function usize_from_str(s: string): Result<number, IntErrorKind> {
  const r = uint_from_str(s, U64_MAX);
  return r.$ === "Err" ? r : Ok(Number(r._0));
}
/** `NonZero<usize>::from_str`: `usize::from_str`, then `Zero` for 0. */
export function nonzero_usize_from_str(s: string): Result<number, IntErrorKind> {
  const r = usize_from_str(s);
  if (r.$ === "Err") return r;
  return r._0 === 0 ? Err("Zero") : r;
}

/** `str::split_whitespace` (`char::is_whitespace` separators, empty pieces skipped). */
function split_whitespace(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (is_whitespace(ch.codePointAt(0)!)) {
      if (cur.length > 0) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** `str::split_once(c)` */
function split_once(s: string, c: string): [string, string] | undefined {
  const i = s.indexOf(c);
  return i < 0 ? undefined : [s.slice(0, i), s.slice(i + c.length)];
}

/** `Ord for str` (byte-wise on UTF-8 = code point order); for `sort_unstable` of strings. */
export function str_cmp(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** derive(PartialEq) of `Option<T>` (used by the generated `gather_target_modifiers`). */
export function option_eq<T>(a: T | undefined, b: T | undefined, eq: (x: T, y: T) => boolean): boolean {
  return a === undefined || b === undefined ? a === b : eq(a, b);
}
/** derive(PartialEq) of `Vec<T>` (used by the generated `gather_target_modifiers`). */
export function vec_eq<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((x, i) => eq(x, b[i]!));
}

/// Extended target modifier info.
/// For example, when external target modifier is '-Zregparm=2':
/// Target modifier enum value + user value ('2') from external crate
/// is converted into description: prefix ('Z'), name ('regparm'), tech value ('Some(2)').
export interface ExtendedTargetModifierInfo {
  /// Flag prefix (usually, 'C' for codegen flags or 'Z' for unstable flags)
  prefix: string;
  /// Flag name
  name: string;
  /// Flag parsed technical value
  tech_value: string;
}

// PORT: `mod target_modifier_consistency_check` (options.rs:90, between `struct TargetModifier` and its
// impl; the TS class holds both, so the module comes first) -> a const object of its fns. They read
// `sess.target` / `sess.sanitizers()` (session.rs, rustc_target), which are not ported yet.
const target_modifier_consistency_check = {
  // rustc: compiler/rustc_session/src/options.rs:92 sanitizer
  sanitizer(_sess: Session, _l: TargetModifier, _r: TargetModifier | undefined): boolean {
    unported("rustc_session::options::target_modifier_consistency_check::sanitizer (Session::target, SanitizerSet::combine_with_defaults)");
  },
  // rustc: compiler/rustc_session/src/options.rs:124 sanitizer_cfi_normalize_integers
  sanitizer_cfi_normalize_integers(_sess: Session, _l: TargetModifier, _r: TargetModifier | undefined): boolean {
    unported("rustc_session::options::target_modifier_consistency_check::sanitizer_cfi_normalize_integers (Session::sanitizers)");
  },
  // rustc: compiler/rustc_session/src/options.rs:139 sanitizer_cfi_minimal_runtime
  sanitizer_cfi_minimal_runtime(_sess: Session, _l: TargetModifier, _r: TargetModifier | undefined): boolean {
    unported("rustc_session::options::target_modifier_consistency_check::sanitizer_cfi_minimal_runtime (Session::sanitizers)");
  },
  // rustc: compiler/rustc_session/src/options.rs:154 target_cpu
  target_cpu(_sess: Session, _l: TargetModifier, _r: TargetModifier | undefined): boolean {
    unported("rustc_session::options::target_modifier_consistency_check::target_cpu (Session::target)");
  },
};

/// A recorded -Zopt_name=opt_value (or -Copt_name=opt_value)
/// which alter the ABI or effectiveness of exploit mitigations.
export class TargetModifier {
  constructor(
    /// Option enum value
    public opt: OptionsTargetModifiers,
    /// User-provided option value (before parsing)
    public value_name: string,
  ) {}

  // rustc: compiler/rustc_session/src/options.rs:179 extend
  extend(): ExtendedTargetModifierInfo {
    return OptionsTargetModifiers.reparse(this.opt, this.value_name);
  }
  // Custom consistency check for target modifiers (or default `l.tech_value == r.tech_value`)
  // When other is None, consistency with default value is checked
  // rustc: compiler/rustc_session/src/options.rs:184 consistent
  consistent(sess: Session, other: TargetModifier | undefined): boolean {
    assert(other === undefined || this.opt === other.opt, "assertion failed: other.is_none() || self.opt == other.unwrap().opt");
    switch (this.opt.$) {
      case "UnstableOptions": {
        const unstable = this.opt._0;
        switch (unstable) {
          case "Sanitizer": {
            return target_modifier_consistency_check.sanitizer(sess, this, other);
          }
          case "SanitizerCfiNormalizeIntegers": {
            return target_modifier_consistency_check.sanitizer_cfi_normalize_integers(sess, this, other);
          }
          case "SanitizerCfiMinimalRuntime": {
            return target_modifier_consistency_check.sanitizer_cfi_minimal_runtime(sess, this, other);
          }
          default:
            break;
        }
        break;
      }
      case "CodegenOptions": {
        const codegen = this.opt._0;
        switch (codegen) {
          case "TargetCpu": {
            return target_modifier_consistency_check.target_cpu(sess, this, other);
          }
        }
      }
    }
    if (other !== undefined) {
      return this.extend().tech_value === other.extend().tech_value;
    } else {
      return false;
    }
  }
}
/** `#[derive(Debug)]` */
export const debug_TargetModifier: Debug<TargetModifier> = (v, f) =>
  debug_struct(f, "TargetModifier", [
    ["opt", debug_OptionsTargetModifiers(v.opt, f)],
    ["value_name", debug_str(v.value_name)],
  ]);
/** `#[derive(PartialOrd, Ord)]` (field order: opt, value_name) */
export function TargetModifier_cmp(a: TargetModifier, b: TargetModifier): number {
  const c = OptionsTargetModifiers_cmp(a.opt, b.opt);
  return c !== 0 ? c : str_cmp(a.value_name, b.value_name);
}

// rustc: compiler/rustc_session/src/options.rs:216 tmod_push_impl
export function tmod_push_impl(opt: OptionsTargetModifiers, tmod_vals: Map<OptionsTargetModifiers, string>, tmods: TargetModifier[]): void {
  const v = tmod_vals.get(opt);
  if (v !== undefined) {
    tmods.push(new TargetModifier(opt, v));
  }
}

// PORT: `BTreeMap<OptionsTargetModifiers, String>` -> `Map` keyed by the interned
// `OptionsTargetModifiers` values; readers that need key order sort with `OptionsTargetModifiers_cmp`.
export interface CollectedOptions {
  target_modifiers: Map<OptionsTargetModifiers, string>;
  mitigations: MitigationCoverageMap;
}
export const CollectedOptions = {
  /** `#[derive(Default)]` */
  default(): CollectedOptions {
    return { target_modifiers: new Map(), mitigations: MitigationCoverageMap.default() };
  },
} as const;

declare module "./options.gen.ts" {
  interface CodegenOptions {
    instrument_coverage_(): InstrumentCoverage;
  }
}
// JUSTIFICATION: defn of the suggested wrapper fn
// PORT: the method `instrument_coverage` clashes with the field of the same name, hence `instrument_coverage_()`.
// rustc: compiler/rustc_session/src/options.rs:682 instrument_coverage
CodegenOptions.prototype.instrument_coverage_ = function (this: CodegenOptions): InstrumentCoverage {
  return this.instrument_coverage;
};

export type OptionSetter<O> = (o: O, collected: CollectedOptions, v: string | undefined, pos: number) => boolean;
export type OptionDescrs<O> = readonly OptionDesc<O>[];

/// Indicates whether a removed option should warn or error.
export type RemovedOption = "Warn" | "Err";

// PORT: `OptionDesc` is a data interface plus a companion with its accessors (instead of a class):
// the generated `CG_OPTIONS`/`Z_OPTIONS` tables are evaluated while this module is still loading
// (options.gen.ts runs first, see the header), so they are built from object literals, like the
// upstream struct literals in `options!`.
export interface OptionDesc<O> {
  readonly name: string;
  readonly setter: OptionSetter<O>;
  // description for return value/type from mod desc
  readonly type_desc: string;
  // description for option from options table
  readonly desc: string;
  readonly removed: RemovedOption | undefined;
  readonly tmod: OptionsTargetModifiers | undefined;
  readonly mitigation: DeniedPartialMitigationKind | undefined;
}
export const OptionDesc = {
  // rustc: compiler/rustc_session/src/options.rs:724 name
  name<O>(self: OptionDesc<O>): string {
    return self.name;
  },

  // rustc: compiler/rustc_session/src/options.rs:728 desc
  desc<O>(self: OptionDesc<O>): string {
    return self.desc;
  },
} as const;

// PORT: `O: Default` -> the `default_` fn (`O::default`).
// rustc: compiler/rustc_session/src/options.rs:733 build_options
export function build_options<O>(
  early_dcx: EarlyDiagCtxt,
  matches: Matches,
  collected_options: CollectedOptions,
  descrs: OptionDescrs<O>,
  prefix: string,
  outputname: string,
  default_: () => O,
): O {
  const op = default_();
  for (const [index, option] of matches.opt_strs_pos(prefix)) {
    let key: string;
    let value: string | undefined;
    const kv = split_once(option, "=");
    if (kv === undefined) {
      [key, value] = [option, undefined];
    } else {
      [key, value] = [kv[0], kv[1]];
    }

    const option_to_lookup = key.replaceAll("-", "_");
    const found = descrs.find((opt_desc) => opt_desc.name === option_to_lookup);
    if (found !== undefined) {
      const { setter, type_desc, desc, removed, tmod, mitigation } = found;
      if (removed !== undefined) {
        // deprecation works for prefixed options only
        assert(!(prefix.length === 0), "assertion failed: !prefix.is_empty()");
        switch (removed) {
          case "Warn":
            early_dcx.early_warn(`\`-${prefix} ${key}\`: ${desc}`);
            break;
          case "Err":
            early_dcx.early_fatal(`\`-${prefix} ${key}\`: ${desc}`);
        }
      }
      if (!setter(op, collected_options, value, index)) {
        if (value === undefined) {
          early_dcx.early_fatal(`${outputname} option \`${key}\` requires ${type_desc} (\`-${prefix} ${key}=<value>\`)`);
        } else {
          early_dcx.early_fatal(`incorrect value \`${value}\` for ${outputname} option \`${key}\` - ${type_desc} was expected`);
        }
      }
      if (tmod !== undefined) {
        const v = value === undefined ? "" : value;

        // Accumulate all the -Zsanitizer flags into a single target modifier.
        if (tmod.$ === "UnstableOptions" && tmod._0 === "Sanitizer") {
          const existing = collected_options.target_modifiers.get(tmod);
          if (existing !== undefined) {
            collected_options.target_modifiers.set(tmod, existing + "," + v);
          } else {
            collected_options.target_modifiers.set(tmod, v);
          }
        } else {
          collected_options.target_modifiers.set(tmod, v);
        }
      }
      if (mitigation !== undefined) {
        collected_options.mitigations.reset_mitigation(mitigation, index);
      }
    } else {
      const error = early_dcx.early_struct_fatal(`unknown ${outputname} option: \`${key}\``);
      const max_dist = Math.floor(Math.max([...option_to_lookup].length, 3) / 3);
      let best: [number, OptionDesc<O>] | undefined;
      for (const option of descrs) {
        if (option.removed !== undefined) continue;
        const dist = edit_distance(option_to_lookup, option.name, max_dist);
        if (dist === undefined) continue;
        // `min_by_key` keeps the first of equal minima.
        if (best === undefined || dist < best[0]) best = [dist, option];
      }
      if (best !== undefined) {
        const option = best[1];
        const name = option.name.replaceAll("_", "-");
        const value = option.type_desc === desc.parse_no_value ? "" : "=<value>";
        error.help(`you might have meant to use \`-${prefix} ${name}${value}\``);
      }
      error.emit();
      // `Diag<FatalAbort>::emit` returns `!`.
      return panic("internal error: entered unreachable code");
    }
  }
  return op;
}

// ---- mod parse ----

/// Ignore the value. Used for removed options where we don't actually want to store
/// anything in the session.
// rustc: compiler/rustc_session/src/options.rs:948 parse_ignore
export function parse_ignore(_slot: MutRef<undefined>, _v: string | undefined): boolean {
  return true;
}

/// This is for boolean options that don't take a value, and are true simply
/// by existing on the command-line.
///
/// This style of option is deprecated, and is mainly used by old options
/// beginning with `no-`.
// rustc: compiler/rustc_session/src/options.rs:957 parse_no_value
export function parse_no_value(slot: MutRef<boolean>, v: string | undefined): boolean {
  if (v === undefined) {
    slot.value = true;
    return true;
  }
  // Trying to specify a value is always forbidden.
  return false;
}

/// Use this for any boolean option that has a static default.
// rustc: compiler/rustc_session/src/options.rs:969 parse_bool
export function parse_bool(slot: MutRef<boolean>, v: string | undefined): boolean {
  switch (v) {
    case "y":
    case "yes":
    case "on":
    case "true":
    case undefined:
      slot.value = true;
      return true;
    case "n":
    case "no":
    case "off":
    case "false":
      slot.value = false;
      return true;
    default:
      return false;
  }
}

/// Use this for any boolean option that lacks a static default. (The
/// actions taken when such an option is not specified will depend on
/// other factors, such as other options, or target options.)
// rustc: compiler/rustc_session/src/options.rs:986 parse_opt_bool
export function parse_opt_bool(slot: MutRef<boolean | undefined>, v: string | undefined): boolean {
  switch (v) {
    case "y":
    case "yes":
    case "on":
    case "true":
    case undefined:
      slot.value = true;
      return true;
    case "n":
    case "no":
    case "off":
    case "false":
      slot.value = false;
      return true;
    default:
      return false;
  }
}

/// Parses whether polonius is enabled, and if so, which version.
// rustc: compiler/rustc_session/src/options.rs:1001 parse_polonius
export function parse_polonius(slot: MutRef<Polonius>, v: string | undefined): boolean {
  switch (v) {
    case "legacy":
    case undefined:
      slot.value = "Legacy";
      return true;
    case "next":
      slot.value = "Next";
      return true;
    case "off":
    case "no":
      slot.value = "Off";
      return true;
    default:
      return false;
  }
}

// rustc: compiler/rustc_session/src/options.rs:1019 parse_annotate_moves
export function parse_annotate_moves(slot: MutRef<AnnotateMoves>, v: string | undefined): boolean {
  const bslot = { value: false };
  const nslot = { value: 0n };

  // No value provided: -Z annotate-moves (enable with default limit)
  if (v === undefined) {
    slot.value = { $: "Enabled", _0: undefined };
  }
  // Explicit boolean value provided: -Z annotate-moves=yes/no
  else if (parse_bool(bslot, v)) {
    if (bslot.value) {
      slot.value = { $: "Enabled", _0: undefined };
    } else {
      slot.value = { $: "Disabled" };
    }
  }
  // With numeric limit provided: -Z annotate-moves=1234
  else if (parse_number(nslot, v, u64_from_str)) {
    slot.value = { $: "Enabled", _0: nslot.value };
  } else {
    return false;
  }

  return true;
}

/// Use this for any string option that has a static default.
// rustc: compiler/rustc_session/src/options.rs:1043 parse_string
export function parse_string(slot: MutRef<string>, v: string | undefined): boolean {
  if (v !== undefined) {
    slot.value = v;
    return true;
  }
  return false;
}

/// Use this for any string option that lacks a static default.
// rustc: compiler/rustc_session/src/options.rs:1054 parse_opt_string
export function parse_opt_string(slot: MutRef<string | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    slot.value = v;
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1064 parse_opt_pathbuf
export function parse_opt_pathbuf(slot: MutRef<string | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    slot.value = v;
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1074 parse_string_push
export function parse_string_push(slot: MutRef<string[]>, v: string | undefined): boolean {
  if (v !== undefined) {
    slot.value.push(v);
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1084 parse_list
export function parse_list(slot: MutRef<string[]>, v: string | undefined): boolean {
  if (v !== undefined) {
    slot.value.push(...split_whitespace(v));
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1094 parse_list_with_polarity
export function parse_list_with_polarity(slot: MutRef<[string, boolean][]>, v: string | undefined): boolean {
  if (v !== undefined) {
    for (const s of v.split(",")) {
      if (!(s.startsWith("+") || s.startsWith("-"))) return false;
      const pass_name = s.slice(1);
      slot.value.push([pass_name, s.slice(0, 1) === "+"]);
    }
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1110 parse_pointer_authentication_list_with_polarity
export function parse_pointer_authentication_list_with_polarity(slot: MutRef<[PointerAuthOption, boolean][]>, v: string | undefined): boolean {
  if (v === undefined) {
    return false;
  }
  const s = v;

  // PORT: `BTreeMap<PointerAuthOption, bool>` -> `Map`, iterated in key order below.
  const map = new Map<PointerAuthOption, boolean>();

  for (const item of s.split(",")) {
    if (!(item.startsWith("+") || item.startsWith("-"))) {
      return false;
    }
    const name = item.slice(1);

    const opt = PointerAuthOption.parse(name);
    if (opt === undefined) {
      return false;
    }

    const enabled = item.startsWith("+");

    // Last occurrence wins.
    map.set(opt, enabled);
  }

  slot.value.length = 0;
  slot.value.push(...[...map.entries()].sort((a, b) => PointerAuthOption_discriminant[a[0]] - PointerAuthOption_discriminant[b[0]]));

  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1141 parse_fmt_debug
export function parse_fmt_debug(opt: MutRef<FmtDebug>, v: string | undefined): boolean {
  switch (v) {
    case "full":
      opt.value = "Full";
      break;
    case "shallow":
      opt.value = "Shallow";
      break;
    case "none":
      opt.value = "None";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1151 parse_location_detail
export function parse_location_detail(ld: MutRef<LocationDetail>, v: string | undefined): boolean {
  if (v !== undefined) {
    ld.value.line = false;
    ld.value.file = false;
    ld.value.column = false;
    if (v === "none") {
      return true;
    }
    for (const s of v.split(",")) {
      switch (s) {
        case "file":
          ld.value.file = true;
          break;
        case "line":
          ld.value.line = true;
          break;
        case "column":
          ld.value.column = true;
          break;
        default:
          return false;
      }
    }
    return true;
  } else {
    return false;
  }
}

// rustc: compiler/rustc_session/src/options.rs:1173 parse_comma_list
export function parse_comma_list(slot: MutRef<string[]>, v: string | undefined): boolean {
  if (v !== undefined) {
    const v_ = v.split(",");
    v_.sort(str_cmp);
    slot.value = v_;
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1185 parse_opt_comma_list
export function parse_opt_comma_list(slot: MutRef<string[] | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    const v_ = v.split(",");
    v_.sort(str_cmp);
    slot.value = v_;
    return true;
  }
  return false;
}

/// Use this for any numeric option that has a static default.
// rustc: compiler/rustc_session/src/options.rs:1198 parse_number
export function parse_number<T>(slot: MutRef<T>, v: string | undefined, from_str: (s: string) => Result<T, IntErrorKind>): boolean {
  const r = v === undefined ? undefined : from_str(v);
  if (r !== undefined && r.$ === "Ok") {
    slot.value = r._0;
    return true;
  }
  return false;
}

/// Use this for any numeric option that lacks a static default.
// rustc: compiler/rustc_session/src/options.rs:1209 parse_opt_number
export function parse_opt_number<T>(slot: MutRef<T | undefined>, v: string | undefined, from_str: (s: string) => Result<T, IntErrorKind>): boolean {
  if (v !== undefined) {
    const r = from_str(v);
    slot.value = r.$ === "Ok" ? r._0 : undefined;
    return slot.value !== undefined;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1222 parse_frame_pointer
export function parse_frame_pointer(slot: MutRef<FramePointer>, v: string | undefined): boolean {
  const yes = { value: false };
  if (parse_bool(yes, v) && yes.value) FramePointer.ratchet(slot, "Always");
  else if (parse_bool(yes, v)) FramePointer.ratchet(slot, "MayOmit");
  else if (v === "always") FramePointer.ratchet(slot, "Always");
  else if (v === "non-leaf") FramePointer.ratchet(slot, "NonLeaf");
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1234 parse_passes
export function parse_passes(slot: MutRef<Passes>, v: string | undefined): boolean {
  if (v === "all") {
    slot.value = Passes.All;
    return true;
  } else {
    const passes = { value: [] as string[] };
    if (parse_list(passes, v)) {
      Passes.extend(slot.value, passes.value);
      return true;
    } else {
      return false;
    }
  }
}

// rustc: compiler/rustc_session/src/options.rs:1252 parse_opt_panic_strategy
export function parse_opt_panic_strategy(slot: MutRef<PanicStrategy | undefined>, v: string | undefined): boolean {
  switch (v) {
    case "unwind":
      slot.value = "Unwind";
      break;
    case "abort":
      slot.value = "Abort";
      break;
    case "immediate-abort":
      slot.value = "ImmediateAbort";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1265 parse_panic_strategy
export function parse_panic_strategy(slot: MutRef<PanicStrategy>, v: string | undefined): boolean {
  switch (v) {
    case "unwind":
      slot.value = "Unwind";
      break;
    case "abort":
      slot.value = "Abort";
      break;
    case "immediate-abort":
      slot.value = "ImmediateAbort";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1275 parse_on_broken_pipe
export function parse_on_broken_pipe(slot: MutRef<OnBrokenPipe>, v: string | undefined): boolean {
  switch (v) {
    // OnBrokenPipe::Default can't be explicitly specified
    case "kill":
      slot.value = "Kill";
      break;
    case "error":
      slot.value = "Error";
      break;
    case "inherit":
      slot.value = "Inherit";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1286 parse_patchable_function_entry
export function parse_patchable_function_entry(slot: MutRef<PatchableFunctionEntry>, v: string | undefined): boolean {
  // PORT: `total_nops`/`prefix_nops` are `u8` (inferred from `PatchableFunctionEntry::from_parts`).
  const total_nops = { value: 0 };
  const prefix_nops = { value: 0 };
  let section: string | undefined = undefined;

  if (!parse_number(total_nops, v, u8_from_str)) {
    const parts = (v ?? "").split(",");
    if (parts.length < 2 || parts.length > 3) {
      return false;
    }

    if (!parse_number(total_nops, parts[0], u8_from_str)) {
      return false;
    }
    if (!parse_number(prefix_nops, parts[1], u8_from_str)) {
      return false;
    }
    section = parts[2];
  }

  const pfe = PatchableFunctionEntry.from_parts(total_nops.value, prefix_nops.value, section);
  if (pfe !== undefined) {
    slot.value = pfe;
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1316 parse_relro_level
export function parse_relro_level(slot: MutRef<RelroLevel | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    const r = RelroLevelC.from_str(v);
    if (r.$ === "Ok") slot.value = r._0;
    else return false;
  } else {
    return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1327 parse_sanitizers
export function parse_sanitizers(slot: MutRef<SanitizerSet>, v: string | undefined): boolean {
  if (v !== undefined) {
    for (const s of v.split(",")) {
      let bit: SanitizerSet;
      switch (s) {
        case "address":
          bit = SanitizerSet.ADDRESS;
          break;
        case "cfi":
          bit = SanitizerSet.CFI;
          break;
        case "dataflow":
          bit = SanitizerSet.DATAFLOW;
          break;
        case "kcfi":
          bit = SanitizerSet.KCFI;
          break;
        case "kernel-address":
          bit = SanitizerSet.KERNELADDRESS;
          break;
        case "kernel-hwaddress":
          bit = SanitizerSet.KERNELHWADDRESS;
          break;
        case "leak":
          bit = SanitizerSet.LEAK;
          break;
        case "memory":
          bit = SanitizerSet.MEMORY;
          break;
        case "memtag":
          bit = SanitizerSet.MEMTAG;
          break;
        case "shadow-call-stack":
          bit = SanitizerSet.SHADOWCALLSTACK;
          break;
        case "thread":
          bit = SanitizerSet.THREAD;
          break;
        case "hwaddress":
          bit = SanitizerSet.HWADDRESS;
          break;
        case "safestack":
          bit = SanitizerSet.SAFESTACK;
          break;
        case "realtime":
          bit = SanitizerSet.REALTIME;
          break;
        default:
          return false;
      }
      slot.value |= bit;
    }
    return true;
  } else {
    return false;
  }
}

// rustc: compiler/rustc_session/src/options.rs:1354 parse_sanitizer_memory_track_origins
export function parse_sanitizer_memory_track_origins(slot: MutRef<number>, v: string | undefined): boolean {
  switch (v) {
    case "2":
    case undefined:
      slot.value = 2;
      return true;
    case "1":
      slot.value = 1;
      return true;
    case "0":
      slot.value = 0;
      return true;
    default:
      return false;
  }
}

// rustc: compiler/rustc_session/src/options.rs:1372 parse_strip
export function parse_strip(slot: MutRef<Strip>, v: string | undefined): boolean {
  switch (v) {
    case "none":
      slot.value = "None";
      break;
    case "debuginfo":
      slot.value = "Debuginfo";
      break;
    case "symbols":
      slot.value = "Symbols";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1382 parse_cfguard
export function parse_cfguard(slot: MutRef<CFGuard>, v: string | undefined): boolean {
  if (v !== undefined) {
    const bool_arg = { value: undefined as boolean | undefined };
    if (parse_opt_bool(bool_arg, v)) {
      slot.value = bool_arg.value! ? "Checks" : "Disabled";
      return true;
    }
  }

  switch (v) {
    case undefined:
      slot.value = "Checks";
      break;
    case "checks":
      slot.value = "Checks";
      break;
    case "nochecks":
      slot.value = "NoChecks";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1400 parse_cfprotection
export function parse_cfprotection(slot: MutRef<CFProtection>, v: string | undefined): boolean {
  if (v !== undefined) {
    const bool_arg = { value: undefined as boolean | undefined };
    if (parse_opt_bool(bool_arg, v)) {
      slot.value = bool_arg.value! ? "Full" : "None";
      return true;
    }
  }

  switch (v) {
    case undefined:
    case "none":
      slot.value = "None";
      break;
    case "branch":
      slot.value = "Branch";
      break;
    case "return":
      slot.value = "Return";
      break;
    case "full":
      slot.value = "Full";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1419 parse_debuginfo
export function parse_debuginfo(slot: MutRef<DebugInfo>, v: string | undefined): boolean {
  switch (v) {
    case "0":
    case "none":
      slot.value = "None";
      break;
    case "line-directives-only":
      slot.value = "LineDirectivesOnly";
      break;
    case "line-tables-only":
      slot.value = "LineTablesOnly";
      break;
    case "1":
    case "limited":
      slot.value = "Limited";
      break;
    case "2":
    case "full":
      slot.value = "Full";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1431 parse_debuginfo_compression
export function parse_debuginfo_compression(slot: MutRef<DebugInfoCompression>, v: string | undefined): boolean {
  switch (v) {
    case "none":
      slot.value = "None";
      break;
    case "zlib":
      slot.value = "Zlib";
      break;
    case "zstd":
      slot.value = "Zstd";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1444 parse_mir_strip_debuginfo
export function parse_mir_strip_debuginfo(slot: MutRef<MirStripDebugInfo>, v: string | undefined): boolean {
  switch (v) {
    case "none":
      slot.value = "None";
      break;
    case "locals-in-tiny-functions":
      slot.value = "LocalsInTinyFunctions";
      break;
    case "all-locals":
      slot.value = "AllLocals";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1454 parse_linker_flavor
export function parse_linker_flavor(slot: MutRef<LinkerFlavorCli | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : LinkerFlavorCliC.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1462 parse_opt_symbol_visibility
export function parse_opt_symbol_visibility(slot: MutRef<SymbolVisibility | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    const vis = SymbolVisibilityC.from_str(v);
    if (vis.$ === "Ok") {
      slot.value = vis._0;
    } else {
      return false;
    }
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1476 parse_unpretty
export function parse_unpretty(slot: MutRef<string | undefined>, v: string | undefined): boolean {
  if (v === undefined) return false;
  if (v.split("=").length <= 2) {
    slot.value = v;
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1487 parse_time_passes_format
export function parse_time_passes_format(slot: MutRef<TimePassesFormat>, v: string | undefined): boolean {
  switch (v) {
    case undefined:
      return true;
    case "json":
      slot.value = "Json";
      return true;
    case "text":
      slot.value = "Text";
      return true;
    default:
      return false;
  }
}

// rustc: compiler/rustc_session/src/options.rs:1502 parse_dump_mono_stats
export function parse_dump_mono_stats(slot: MutRef<DumpMonoStatsFormat>, v: string | undefined): boolean {
  switch (v) {
    case undefined:
      return true;
    case "json":
      slot.value = "Json";
      return true;
    case "markdown":
      slot.value = "Markdown";
      return true;
    default:
      return false;
  }
}

// rustc: compiler/rustc_session/src/options.rs:1517 parse_offload
export function parse_offload(slot: MutRef<Offload[]>, v: string | undefined): boolean {
  if (v === undefined) {
    slot.value = [];
    return true;
  }
  const v_ = v.split(",");
  v_.sort(str_cmp);
  for (const val of v_) {
    // Split each entry on '=' if it has an argument
    let key: string;
    let arg: string | undefined;
    const ka = split_once(val, "=");
    if (ka !== undefined) {
      [key, arg] = [ka[0], ka[1]];
    } else {
      [key, arg] = [val, undefined];
    }

    let variant: Offload;
    switch (key) {
      case "Host": {
        if (arg !== undefined) {
          variant = { $: "Host", _0: arg };
        } else {
          return false;
        }
        break;
      }
      case "HostMetadata": {
        if (arg !== undefined) {
          variant = { $: "HostMetadata", _0: arg };
        } else {
          return false;
        }
        break;
      }
      case "Device": {
        // Without an argument, `Device` uses an empty manifest and all kernel
        // instantiations are discovered via monomorphization.
        variant = { $: "Device", _0: arg ?? "" };
        break;
      }
      case "Test": {
        if (arg !== undefined) {
          // Test does not accept a value
          return false;
        }
        variant = { $: "Test" };
        break;
      }
      default: {
        // FIXME(ZuseZ4): print an error saying which value is not recognized
        return false;
      }
    }
    slot.value.push(variant);
  }

  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1569 parse_autodiff
export function parse_autodiff(slot: MutRef<AutoDiff[]>, v: string | undefined): boolean {
  if (v === undefined) {
    slot.value = [];
    return true;
  }
  const v_ = v.split(",");
  v_.sort(str_cmp);
  for (const val of v_) {
    // Split each entry on '=' if it has an argument
    let key: string;
    let arg: string | undefined;
    const ka = split_once(val, "=");
    if (ka !== undefined) {
      [key, arg] = [ka[0], ka[1]];
    } else {
      [key, arg] = [val, undefined];
    }

    let variant: AutoDiff;
    switch (key) {
      case "Enable":
        variant = { $: "Enable" };
        break;
      case "PrintTA":
        variant = { $: "PrintTA" };
        break;
      case "PrintTAFn": {
        if (arg !== undefined) {
          variant = { $: "PrintTAFn", _0: arg };
        } else {
          return false;
        }
        break;
      }
      case "PrintAA":
        variant = { $: "PrintAA" };
        break;
      case "PrintPerf":
        variant = { $: "PrintPerf" };
        break;
      case "PrintSteps":
        variant = { $: "PrintSteps" };
        break;
      case "PrintModBefore":
        variant = { $: "PrintModBefore" };
        break;
      case "PrintModAfter":
        variant = { $: "PrintModAfter" };
        break;
      case "PrintModFinal":
        variant = { $: "PrintModFinal" };
        break;
      case "NoPostopt":
        variant = { $: "NoPostopt" };
        break;
      case "PrintPasses":
        variant = { $: "PrintPasses" };
        break;
      case "LooseTypes":
        variant = { $: "LooseTypes" };
        break;
      case "Inline":
        variant = { $: "Inline" };
        break;
      case "NoTT":
        variant = { $: "NoTT" };
        break;
      default: {
        // FIXME(ZuseZ4): print an error saying which value is not recognized
        return false;
      }
    }
    slot.value.push(variant);
  }

  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1615 parse_instrument_coverage
export function parse_instrument_coverage(slot: MutRef<InstrumentCoverage>, v: string | undefined): boolean {
  if (v !== undefined) {
    const bool_arg = { value: false };
    if (parse_bool(bool_arg, v)) {
      slot.value = bool_arg.value ? "Yes" : "No";
      return true;
    }
  }

  if (v === undefined) {
    slot.value = "Yes";
    return true;
  }

  // Parse values that have historically been accepted by stable compilers,
  // even though they're currently just aliases for boolean values.
  switch (v) {
    case "all":
      slot.value = "Yes";
      break;
    case "0":
      slot.value = "No";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1642 parse_codegen_retag_options
export function parse_codegen_retag_options(slot: MutRef<CodegenRetagOptions | undefined>, v: string | undefined): boolean {
  let no_precise_im = false;
  let no_precise_pin = false;
  if (v !== undefined) {
    const opt_list = v.split(",");
    for (const opt of opt_list) {
      switch (opt) {
        case "no-precise-im": {
          no_precise_im = true;
          break;
        }
        case "no-precise-pin": {
          no_precise_pin = true;
          break;
        }
        default:
          return false;
      }
    }
  }
  slot.value = { no_precise_im, no_precise_pin };
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1665 parse_coverage_options
export function parse_coverage_options(slot: MutRef<CoverageOptions>, v: string | undefined): boolean {
  if (v === undefined) return true;

  for (const option of v.split(",")) {
    switch (option) {
      case "block":
        slot.value.level = "Block";
        break;
      case "branch":
        slot.value.level = "Branch";
        break;
      case "condition":
        slot.value.level = "Condition";
        break;
      case "discard-all-spans-in-codegen":
        slot.value.discard_all_spans_in_codegen = true;
        break;
      default:
        return false;
    }
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1680 parse_instrument_mcount
export function parse_instrument_mcount(slot: MutRef<InstrumentMcount>, v: string | undefined): boolean {
  const use_mcount = { value: false };
  const opts = InstrumentMcountOpts.default();
  if (parse_bool(use_mcount, v)) {
    slot.value = use_mcount.value ? { $: "Mcount", _0: opts } : { $: "Disabled" };
    return true;
  }
  switch (v) {
    case "fentry": {
      slot.value = { $: "Fentry", _0: opts };
      break;
    }
    case "fentry-record": {
      opts.record = true;
      slot.value = { $: "Fentry", _0: opts };
      break;
    }
    case "fentry-nop-record": {
      opts.record = true;
      opts.no_call = true;
      slot.value = { $: "Fentry", _0: opts };
      break;
    }
    default: {
      return false;
    }
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1711 parse_instrument_xray
export function parse_instrument_xray(slot: MutRef<InstrumentXRay | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    const bool_arg = { value: undefined as boolean | undefined };
    if (parse_opt_bool(bool_arg, v)) {
      slot.value = bool_arg.value! ? InstrumentXRay.default() : undefined;
      return true;
    }
  }

  if (slot.value === undefined) slot.value = InstrumentXRay.default();
  const options = slot.value;
  let seen_always = false;
  let seen_never = false;
  let seen_ignore_loops = false;
  let seen_instruction_threshold = false;
  let seen_skip_entry = false;
  let seen_skip_exit = false;
  for (const option of v === undefined ? [] : v.split(",")) {
    if (option === "always" && !seen_always && !seen_never) {
      options.always = true;
      options.never = false;
      seen_always = true;
    } else if (option === "never" && !seen_never && !seen_always) {
      options.never = true;
      options.always = false;
      seen_never = true;
    } else if (option === "ignore-loops" && !seen_ignore_loops) {
      options.ignore_loops = true;
      seen_ignore_loops = true;
    } else if (option.startsWith("instruction-threshold") && !seen_instruction_threshold) {
      const kv = split_once(option, "=");
      if (kv === undefined || kv[0] !== "instruction-threshold") {
        return false;
      }
      const n = kv[1];
      const r = usize_from_str(n);
      if (r.$ === "Ok") options.instruction_threshold = r._0;
      else return false;
      seen_instruction_threshold = true;
    } else if (option === "skip-entry" && !seen_skip_entry) {
      options.skip_entry = true;
      seen_skip_entry = true;
    } else if (option === "skip-exit" && !seen_skip_exit) {
      options.skip_exit = true;
      seen_skip_exit = true;
    } else {
      return false;
    }
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1773 parse_treat_err_as_bug
export function parse_treat_err_as_bug(slot: MutRef<number | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    const r = nonzero_usize_from_str(v);
    if (r.$ === "Ok") {
      slot.value = r._0;
      return true;
    } else {
      slot.value = undefined;
      return r._0 === "Zero";
    }
  } else {
    slot.value = 1;
    return true;
  }
}

// rustc: compiler/rustc_session/src/options.rs:1795 parse_next_solver_config
export function parse_next_solver_config(slot: MutRef<NextSolverConfig>, v: string | undefined): boolean {
  if (v !== undefined) {
    const config = v;
    switch (config) {
      case "no":
      case "coherence":
        slot.value = "Coherence";
        break;
      case "globally":
        slot.value = "Globally";
        break;
      default:
        return false;
    }
  } else {
    slot.value = "Globally";
  }

  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1809 parse_lto
export function parse_lto(slot: MutRef<LtoCli>, v: string | undefined): boolean {
  if (v !== undefined) {
    const bool_arg = { value: undefined as boolean | undefined };
    if (parse_opt_bool(bool_arg, v)) {
      slot.value = bool_arg.value! ? "Yes" : "No";
      return true;
    }
  }

  switch (v) {
    case undefined:
      slot.value = "NoParam";
      break;
    case "thin":
      slot.value = "Thin";
      break;
    case "fat":
      slot.value = "Fat";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1827 parse_linker_plugin_lto
export function parse_linker_plugin_lto(slot: MutRef<LinkerPluginLto>, v: string | undefined): boolean {
  if (v !== undefined) {
    const bool_arg = { value: undefined as boolean | undefined };
    if (parse_opt_bool(bool_arg, v)) {
      slot.value = bool_arg.value! ? { $: "LinkerPluginAuto" } : { $: "Disabled" };
      return true;
    }
  }

  slot.value = v === undefined ? { $: "LinkerPluginAuto" } : { $: "LinkerPlugin", _0: v };
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1847 parse_switch_with_opt_path
export function parse_switch_with_opt_path(slot: MutRef<SwitchWithOptPath>, v: string | undefined): boolean {
  slot.value = v === undefined ? { $: "Enabled", _0: undefined } : { $: "Enabled", _0: v };
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1858 parse_merge_functions
export function parse_merge_functions(slot: MutRef<MergeFunctions | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : MergeFunctionsC.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1869 parse_relocation_model
export function parse_relocation_model(slot: MutRef<RelocModel | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : RelocModelC.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else if (v === "default") slot.value = undefined;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1878 parse_code_model
export function parse_code_model(slot: MutRef<CodeModel | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : CodeModelC.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1886 parse_tls_model
export function parse_tls_model(slot: MutRef<TlsModel | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : TlsModelC.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1894 parse_terminal_url
export function parse_terminal_url(slot: MutRef<TerminalUrl>, v: string | undefined): boolean {
  switch (v) {
    case "on":
    case "":
    case "yes":
    case "y":
    case undefined:
      slot.value = "Yes";
      break;
    case "off":
    case "no":
    case "n":
      slot.value = "No";
      break;
    case "auto":
      slot.value = "Auto";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1904 parse_symbol_mangling_version
export function parse_symbol_mangling_version(slot: MutRef<SymbolManglingVersion | undefined>, v: string | undefined): boolean {
  switch (v) {
    case "legacy":
      slot.value = "Legacy";
      break;
    case "v0":
      slot.value = "V0";
      break;
    case "hashed":
      slot.value = "Hashed";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1917 parse_src_file_hash
export function parse_src_file_hash(slot: MutRef<SourceFileHashAlgorithm | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : SourceFileHashAlgorithm.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1928 parse_cargo_src_file_hash
export function parse_cargo_src_file_hash(slot: MutRef<SourceFileHashAlgorithm | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : SourceFileHashAlgorithm.from_str(v);
  if (r !== undefined && r.$ === "Ok") {
    slot.value = r._0;
  } else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:1941 parse_target_feature
export function parse_target_feature(slot: MutRef<string>, v: string | undefined): boolean {
  if (v !== undefined) {
    if (!(slot.value.length === 0)) {
      slot.value += ",";
    }
    slot.value += v;
    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1954 parse_link_self_contained
export function parse_link_self_contained(slot: MutRef<LinkSelfContained>, v: string | undefined): boolean {
  // Whenever `-C link-self-contained` is passed without a value, it's an opt-in
  // just like `parse_opt_bool`, the historical value of this flag.
  //
  // 1. Parse historical single bool values
  const s = v ?? "y";
  switch (s) {
    case "y":
    case "yes":
    case "on": {
      slot.value.set_all_explicitly(true);
      return true;
    }
    case "n":
    case "no":
    case "off": {
      slot.value.set_all_explicitly(false);
      return true;
    }
    default:
      break;
  }

  // 2. Parse a list of enabled and disabled components.
  for (const comp of s.split(",")) {
    if (slot.value.handle_cli_component(comp) === undefined) {
      return false;
    }
  }

  return true;
}

/// Parse a comma-separated list of enabled and disabled linker features.
// rustc: compiler/rustc_session/src/options.rs:1983 parse_linker_features
export function parse_linker_features(slot: MutRef<LinkerFeaturesCli>, v: string | undefined): boolean {
  if (v !== undefined) {
    for (const feature of v.split(",")) {
      if (slot.value.handle_cli_feature(feature) === undefined) {
        return false;
      }
    }

    return true;
  }
  return false;
}

// rustc: compiler/rustc_session/src/options.rs:1998 parse_wasi_exec_model
export function parse_wasi_exec_model(slot: MutRef<WasiExecModel | undefined>, v: string | undefined): boolean {
  switch (v) {
    case "command":
      slot.value = "Command";
      break;
    case "reactor":
      slot.value = "Reactor";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2007 parse_split_debuginfo
export function parse_split_debuginfo(slot: MutRef<SplitDebuginfo | undefined>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : SplitDebuginfoC.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2018 parse_split_dwarf_kind
export function parse_split_dwarf_kind(slot: MutRef<SplitDwarfKind>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : SplitDwarfKind.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2026 parse_stack_protector
export function parse_stack_protector(slot: MutRef<StackProtector>, v: string | undefined): boolean {
  const r = v === undefined ? undefined : StackProtectorC.from_str(v);
  if (r !== undefined && r.$ === "Ok") slot.value = r._0;
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2034 parse_branch_protection
export function parse_branch_protection(slot_: MutRef<BranchProtection | undefined>, v: string | undefined): boolean {
  if (v !== undefined) {
    const s = v;
    if (slot_.value === undefined) slot_.value = BranchProtectionC.default();
    const slot = slot_.value;
    for (const opt of s.split(",")) {
      if (opt === "bti") slot.bti = true;
      else if (opt === "pac-ret" && slot.pac_ret === undefined) {
        // Note: some targets only support certain keys (Windows on Arm only
        // supports Key B) and this possible discrepancy is handled by the
        // session's `branch_protection` accessor, when we have both the target
        // tuple and branch protection information available.
        slot.pac_ret = { leaf: false, pc: false, key: "A" };
      } else if (opt === "leaf") {
        const pac = slot.pac_ret;
        if (pac !== undefined) pac.leaf = true;
        else return false;
      } else if (opt === "b-key") {
        const pac = slot.pac_ret;
        if (pac !== undefined) pac.key = "B";
        else return false;
      } else if (opt === "pc") {
        const pac = slot.pac_ret;
        if (pac !== undefined) pac.pc = true;
        else return false;
      } else if (opt === "gcs") slot.gcs = true;
      else return false;
    }
  } else {
    return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2073 parse_collapse_macro_debuginfo
export function parse_collapse_macro_debuginfo(slot: MutRef<CollapseMacroDebuginfo>, v: string | undefined): boolean {
  if (v !== undefined) {
    const bool_arg = { value: undefined as boolean | undefined };
    if (parse_opt_bool(bool_arg, v)) {
      slot.value = bool_arg.value! ? "Yes" : "No";
      return true;
    }
  }

  if (v === "external") slot.value = "External";
  else return false;
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2096 parse_proc_macro_execution_strategy
export function parse_proc_macro_execution_strategy(slot: MutRef<ProcMacroExecutionStrategy>, v: string | undefined): boolean {
  switch (v) {
    case "same-thread":
      slot.value = "SameThread";
      break;
    case "cross-thread":
      slot.value = "CrossThread";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2108 parse_inlining_threshold
export function parse_inlining_threshold(slot: MutRef<InliningThreshold>, v: string | undefined): boolean {
  switch (v) {
    case "always":
    case "yes": {
      slot.value = { $: "Always" };
      break;
    }
    case "never": {
      slot.value = { $: "Never" };
      break;
    }
    case undefined:
      return false;
    default: {
      const threshold = usize_from_str(v);
      if (threshold.$ === "Ok") {
        slot.value = { $: "Sometimes", _0: threshold._0 };
      } else {
        return false;
      }
    }
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2128 parse_llvm_module_flag
export function parse_llvm_module_flag(slot: MutRef<[string, number, string][]>, v: string | undefined): boolean {
  const elements = (v ?? "").split(":");
  if (elements.length !== 4) {
    return false;
  }
  const [key, md_type, value_, behavior_] = elements as [string, string, string, string];
  if (md_type !== "u32") {
    // Currently we only support u32 metadata flags, but require the
    // type for forward-compatibility.
    return false;
  }
  const value = u32_from_str(value_);
  if (value.$ === "Err") {
    return false;
  }
  // PORT: `str::to_lowercase` -> `String.prototype.toLowerCase` (locale-independent Unicode
  // lowercase mapping incl. final sigma, like core; the Unicode versions may differ).
  const behavior = behavior_.toLowerCase();
  const all_behaviors = ["error", "warning", "require", "override", "append", "appendunique", "max", "min"];
  if (!all_behaviors.includes(behavior)) {
    return false;
  }

  slot.value.push([key, value._0, behavior]);
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2155 parse_function_return
export function parse_function_return(slot: MutRef<FunctionReturn>, v: string | undefined): boolean {
  switch (v) {
    case "keep":
      slot.value = "Keep";
      break;
    case "thunk-extern":
      slot.value = "ThunkExtern";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2164 parse_wasm_c_abi
export function parse_wasm_c_abi(_slot: MutRef<undefined>, v: string | undefined): boolean {
  return v === "spec";
}

// rustc: compiler/rustc_session/src/options.rs:2168 parse_mir_include_spans
export function parse_mir_include_spans(slot: MutRef<MirIncludeSpans>, v: string | undefined): boolean {
  switch (v) {
    case "on":
    case "yes":
    case "y":
    case "true":
    case undefined:
      slot.value = "On";
      break;
    case "off":
    case "no":
    case "n":
    case "false":
      slot.value = "Off";
      break;
    case "nll":
      slot.value = "Nll";
      break;
    default:
      return false;
  }

  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2179 parse_align
export function parse_align(slot: MutRef<Align | undefined>, v: string | undefined): boolean {
  const bytes = { value: 0n };
  if (!parse_number(bytes, v, u64_from_str)) {
    return false;
  }

  const align = AlignC.from_bytes(bytes.value);
  if (align.$ === "Err") {
    return false;
  }

  slot.value = align._0;

  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2194 parse_assert_incr_state
export function parse_assert_incr_state(slot: MutRef<IncrementalStateAssertion | undefined>, v: string | undefined): boolean {
  switch (v) {
    case "loaded":
      slot.value = "Loaded";
      break;
    case "not-loaded":
      slot.value = "NotLoaded";
      break;
    default:
      return false;
  }
  return true;
}

// rustc: compiler/rustc_session/src/options.rs:2206 parse_rust_version
export function parse_rust_version(slot: MutRef<RustcVersion | undefined>, v: string | undefined): boolean {
  if (v === undefined) {
    return false;
  }
  const version = RustcVersion.parse_str_strict(v);
  if (version !== undefined) {
    slot.value = version;
    return true;
  } else {
    return false;
  }
}
