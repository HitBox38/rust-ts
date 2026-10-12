// Port of compiler/rustc_ast/src/attr/version.rs
// Types and derived Debug impls are generated into version.gen.ts (tools/codegen/types.ts).
//
// PORT: `RustcVersion` is a generated class; its associated const and static fns are assigned onto
// it and re-exported with the extended type (the token.ts pattern). The derived `PartialOrd`/`Ord`
// (field order: major, minor, patch) is `RustcVersion_cmp`; the derived `PartialEq` is `RustcVersion_eq`.
import * as gen from "./version.gen.ts";

export * from "./version.gen.ts";

export type RustcVersion = gen.RustcVersion;
export const RustcVersion = gen.RustcVersion as typeof gen.RustcVersion & {
  CURRENT: RustcVersion;
  current_overridable: () => RustcVersion;
  parse_str: (value: string) => RustcVersion | undefined;
  parse_str_strict: (value: string) => RustcVersion | undefined;
};

// PORT: `str::parse::<u16>()` (core `u16::from_str`): an optional `+`, then one or more ASCII
// digits, no overflow; anything else is an error (`None` after `.ok()`).
function u16_from_str(s: string): number | undefined {
  let digits = s;
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  if (digits.length === 0) {
    return undefined;
  }
  let v = 0;
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i);
    if (c < 0x30 || c > 0x39) {
      return undefined;
    }
    v = v * 10 + (c - 0x30);
    if (v > 0xffff) {
      return undefined;
    }
  }
  return v;
}

// PORT: `str::splitn(n, '.')` iterator (yields at most `n` pieces; the last holds the rest).
function* splitn(s: string, n: number, sep: string): Generator<string, undefined> {
  let rest = s;
  let count = 0;
  while (count < n - 1) {
    const i = rest.indexOf(sep);
    if (i < 0) {
      break;
    }
    yield rest.slice(0, i);
    rest = rest.slice(i + sep.length);
    count++;
  }
  yield rest;
  return undefined;
}

/// Parse a [`RustcVersion`] with an optional patch version, ignoring suffixes such as `-dev` or `-nightly`.
// rustc: compiler/rustc_ast/src/attr/version.rs:29 parse_str
RustcVersion.parse_str = function (value: string): RustcVersion | undefined {
  const components = splitn(value.split("-")[0]!, 3, ".");
  const c0 = components.next();
  if (c0.done) return undefined;
  const major = u16_from_str(c0.value);
  if (major === undefined) return undefined;
  const c1 = components.next();
  if (c1.done) return undefined;
  const minor = u16_from_str(c1.value);
  if (minor === undefined) return undefined;
  const c2 = components.next();
  const patch = u16_from_str(c2.done ? "0" : c2.value);
  if (patch === undefined) return undefined;
  return new gen.RustcVersion(major, minor, patch);
};

// PORT: `current_rustc_version!()` (compiler/rustc_macros/src/current_version.rs) parses the
// `CFG_RELEASE` env var at rustc build time with the same algorithm as `parse_str`. The pinned
// release is `UPSTREAM.json` `rust.release` (also `sym::env_CFG_RELEASE` in symbol.gen.ts).
const CFG_RELEASE = "1.101.0-nightly";
RustcVersion.CURRENT = RustcVersion.parse_str(CFG_RELEASE)!;

let CURRENT_OVERRIDABLE: RustcVersion | undefined;

// rustc: compiler/rustc_ast/src/attr/version.rs:16 current_overridable
RustcVersion.current_overridable = function (): RustcVersion {
  if (CURRENT_OVERRIDABLE === undefined) {
    // PORT: `std::env::var` -> `process.env` (non-unicode values cannot occur in JS strings).
    const override_var = process.env["RUSTC_OVERRIDE_VERSION_STRING"];
    let override_: RustcVersion | undefined;
    if (override_var !== undefined && (override_ = RustcVersion.parse_str(override_var)) !== undefined) {
      CURRENT_OVERRIDABLE = override_;
    } else {
      CURRENT_OVERRIDABLE = RustcVersion.CURRENT;
    }
  }
  return CURRENT_OVERRIDABLE;
};

/// Parse a [`RustcVersion`] which is exactly `<major>.<minor>.<patch>`, with no suffix.
// rustc: compiler/rustc_ast/src/attr/version.rs:38 parse_str_strict
RustcVersion.parse_str_strict = function (value: string): RustcVersion | undefined {
  const components = splitn(value, 3, ".");
  const c0 = components.next();
  if (c0.done) return undefined;
  const major = u16_from_str(c0.value);
  if (major === undefined) return undefined;
  const c1 = components.next();
  if (c1.done) return undefined;
  const minor = u16_from_str(c1.value);
  if (minor === undefined) return undefined;
  const c2 = components.next();
  if (c2.done) return undefined;
  const patch = u16_from_str(c2.value);
  if (patch === undefined) return undefined;
  return new gen.RustcVersion(major, minor, patch);
};

// impl Display for RustcVersion
// rustc: compiler/rustc_ast/src/attr/version.rs:50 fmt
export function display_RustcVersion(self: RustcVersion): string {
  return `${self.major}.${self.minor}.${self.patch}`;
}

/** Derived `PartialEq` for `RustcVersion`. */
export function RustcVersion_eq(a: RustcVersion, b: RustcVersion): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

/** Derived `Ord` for `RustcVersion` (lexicographic over major, minor, patch). */
export function RustcVersion_cmp(a: RustcVersion, b: RustcVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}
