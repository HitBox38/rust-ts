// Port of compiler/rustc_lint_defs/src/lib.rs. Types and derived Debug impls are generated into
// lib.gen.ts (tools/codegen/types.ts, set `rustc_lint_defs`); the `declare_lint!` statics of builtin.rs
// are generated into builtin.gen.ts (tools/codegen/lints.ts).
//
// PORT: methods of the generated types live on companion consts (PORTING §8): `Level.as_str(l)`,
// `Lint.default_level(lint, edition)`, `LintId.of(lint)`, ... `Lint` stays a data interface (not a
// class) because its field `default_level` and its method `default_level` share a name.
import { RustcVersion } from "../rustc_ast/attr/version.ts";
import type { DiagArgValue, PathBuf } from "../rustc_error_messages/lib.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { type Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import type { Debug } from "../std/fmt.ts";
import { assert, panic, unported, unreachable } from "../std/panic.ts";
import { utf8 } from "../std/str.ts";
import * as gen from "./lib.gen.ts";
import type { EditionFcw, FutureIncompatibilityReason as FutureIncompatibilityReason_, ReleaseFcw, StableLintExpectationId, UnstableLintExpectationId } from "./lib.gen.ts";

export * from "./lib.gen.ts";

// ---- Stand-ins for crates that are not ported yet (PORT) ----------------------------------------

/** PORT: stand-in for `rustc_hir_id::ItemLocalId` (a `newtype_index!`) until rustc_hir_id is ported. */
export type ItemLocalId = number & { readonly __brand: "ItemLocalId" };
/** PORT: stand-in for `rustc_hir_id::OwnerId` (fields as upstream). */
export interface OwnerId {
  readonly def_id: LocalDefId;
}
/** PORT: stand-in for `rustc_hir_id::HirId` (fields as upstream); typemap.lint_defs.json points here. */
export interface HirId {
  readonly owner: OwnerId;
  readonly local_id: ItemLocalId;
}
/** PORT: `impl Debug for HirId` prints `HirId(<DefId Debug>.<local_id>)`; DefId Debug needs the tcx def-path printer. */
export const debug_HirId: Debug<HirId> = (_v, _f) => unported("rustc_hir_id::HirId Debug (DefId def-path printing)");

// pub use self::Level::*;
export const { Allow, Expect, Warn, ForceWarn, Deny, Forbid } = gen.Level;

export * as builtin from "./builtin.ts";

// PORT: `macro_rules! pluralize` (exported) → a function with the same arms.
// Pluralize based on count (e.g., apples)
export function pluralize(x: number): string;
export function pluralize(word: "has" | "is" | "was" | "this", x: number): string;
export function pluralize(a: number | "has" | "is" | "was" | "this", b?: number): string {
  if (typeof a === "number") {
    return a === 1 ? "" : "s";
  }
  const x = b!;
  switch (a) {
    case "has":
      return x === 1 ? "has" : "have";
    case "is":
      return x === 1 ? "is" : "are";
    case "was":
      return x === 1 ? "was" : "were";
    case "this":
      return x === 1 ? "this" : "these";
  }
}

/// Grammatical tool for displaying messages to end users in a nice form.
///
/// Take a list of items and a function to turn those items into a `String`, and output a display
/// friendly comma separated list of those items.
// FIXME(estebank): this needs to be changed to go through the translation machinery.
// rustc: compiler/rustc_lint_defs/src/lib.rs:43 listify
export function listify<T>(list: readonly T[], fmt: (t: T) => string): string | undefined {
  if (list.length === 1) {
    return fmt(list[0]!);
  } else if (list.length >= 1) {
    const others = list.slice(0, -1);
    const last = list[list.length - 1]!;
    return `${others.map((i) => fmt(i)).join(", ")} and ${fmt(last)}`;
  } else {
    return undefined;
  }
}

/// Each lint expectation has a `LintExpectationId` assigned by the `LintLevelsBuilder`.
/// Expected diagnostics get the lint level `Expect` which stores the `LintExpectationId`
/// to match it with the actual expectation later on.
///
/// The `LintExpectationId` has to be stable between compilations, as diagnostic
/// instances might be loaded from cache. Lint messages can be emitted during an
/// `EarlyLintPass` operating on the AST and during a `LateLintPass` traversing the
/// HIR tree. The AST doesn't have enough information to create a stable id. The
/// `LintExpectationId` will instead store the [`AttrId`] defining the expectation.
/// These `LintExpectationId` will be updated to use the stable [`HirId`] once the
/// AST has been lowered. The transformation is done by the `LintLevelsBuilder`
///
/// Each lint inside the `expect` attribute is tracked individually, the `lint_index`
/// identifies the lint inside the attribute and ensures that the IDs are unique.
///
/// The index values have a type of `u16` to reduce the size of the `LintExpectationId`.
/// It's reasonable to assume that no user will define 2^16 attributes on one node or
/// have that amount of lints listed. `u16` values should therefore suffice.
// PORT: derived `PartialEq`/`Eq`/`Hash` → interning. Every `LintExpectationId` is a canonical frozen
// object built by `LintExpectationId.Unstable(..)` / `.Stable(..)` (keyed by all field values), so `===`,
// `Set` membership and `Map` keys compare by value. The brand keeps object literals from bypassing it.
declare const LINT_EXPECTATION_ID_INTERNED: unique symbol;
export type LintExpectationId = (
  | { readonly $: "Unstable"; readonly _0: UnstableLintExpectationId }
  | { readonly $: "Stable"; readonly _0: StableLintExpectationId }
) & { readonly [LINT_EXPECTATION_ID_INTERNED]: true };

/** PORT: the interner behind `LintExpectationId` (value → canonical object). */
const LINT_EXPECTATION_IDS = new Map<string, LintExpectationId>();

function intern_lint_expectation_id(key: string, make: () => object): LintExpectationId {
  let id = LINT_EXPECTATION_IDS.get(key);
  if (id === undefined) {
    id = Object.freeze(make()) as LintExpectationId;
    LINT_EXPECTATION_IDS.set(key, id);
  }
  return id;
}

export const LintExpectationId = {
  /** `LintExpectationId::Unstable(id)` (interned). */
  Unstable(id: UnstableLintExpectationId): LintExpectationId {
    const { attr_id, lint_index } = id;
    return intern_lint_expectation_id(`U${attr_id}.${lint_index}`, () => ({
      $: "Unstable",
      _0: Object.freeze({ attr_id, lint_index }),
    }));
  },
  /** `LintExpectationId::Stable(id)` (interned). */
  Stable(id: StableLintExpectationId): LintExpectationId {
    const { hir_id, attr_index, lint_index } = id;
    const def_id = hir_id.owner.def_id;
    const local_id = hir_id.local_id;
    return intern_lint_expectation_id(`S${def_id}.${local_id}.${attr_index}.${lint_index}`, () => ({
      $: "Stable",
      _0: Object.freeze({ hir_id: Object.freeze({ owner: Object.freeze({ def_id }), local_id }), attr_index, lint_index }),
    }));
  },

  /** `impl From<UnstableLintExpectationId> for LintExpectationId` */
  // rustc: compiler/rustc_lint_defs/src/lib.rs:117 from
  from_UnstableLintExpectationId(id: UnstableLintExpectationId): LintExpectationId {
    return LintExpectationId.Unstable(id);
  },

  /** `impl From<StableLintExpectationId> for LintExpectationId` */
  // rustc: compiler/rustc_lint_defs/src/lib.rs:144 from
  from_StableLintExpectationId(id: StableLintExpectationId): LintExpectationId {
    return LintExpectationId.Stable(id);
  },
};

// rustc-skip: compiler/rustc_lint_defs/src/lib.rs:134 stable_hash StableHash impl (incremental, M5)

/// Setting for how to handle a lint.
///
/// See: <https://doc.rust-lang.org/rustc/lints/levels.html>
export type Level = gen.Level;
export const Level = {
  ...gen.Level,

  /// Converts a level to a lower-case string.
  // rustc: compiler/rustc_lint_defs/src/lib.rs:189 as_str
  as_str(self: Level): string {
    switch (self) {
      case "Allow":
        return "allow";
      case "Expect":
        return "expect";
      case "Warn":
        return "warn";
      case "ForceWarn":
        return "force-warn";
      case "Deny":
        return "deny";
      case "Forbid":
        return "forbid";
    }
  },

  /// Converts a lower-case string to a level. This will never construct the expect
  /// level as that would require a [`LintExpectationId`].
  // rustc: compiler/rustc_lint_defs/src/lib.rs:202 from_str
  from_str(x: string): Level | undefined {
    switch (x) {
      case "allow":
        return "Allow";
      case "warn":
        return "Warn";
      case "deny":
        return "Deny";
      case "forbid":
        return "Forbid";
      case "expect":
      default:
        return undefined;
    }
  },

  /// Converts an `Option<Symbol>` to a level.
  // rustc: compiler/rustc_lint_defs/src/lib.rs:213 from_opt_symbol
  from_opt_symbol(s: Symbol | undefined): Level | undefined {
    return s === undefined ? undefined : Level.from_symbol(s);
  },

  /// Converts a `Symbol` to a level.
  // rustc: compiler/rustc_lint_defs/src/lib.rs:218 from_symbol
  from_symbol(s: Symbol): Level | undefined {
    switch (s) {
      case sym.allow:
        return "Allow";
      case sym.expect:
        return "Expect";
      case sym.warn:
        return "Warn";
      case sym.deny:
        return "Deny";
      case sym.forbid:
        return "Forbid";
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_lint_defs/src/lib.rs:229 to_cmd_flag
  to_cmd_flag(self: Level): string {
    switch (self) {
      case "Warn":
        return "-W";
      case "Deny":
        return "-D";
      case "Forbid":
        return "-F";
      case "Allow":
        return "-A";
      case "ForceWarn":
        return "--force-warn";
      case "Expect": {
        unreachable("internal error: entered unreachable code: the expect level does not have a commandline flag");
      }
    }
  },

  // rustc: compiler/rustc_lint_defs/src/lib.rs:242 is_error
  is_error(self: Level): boolean {
    switch (self) {
      case "Allow":
      case "Expect":
      case "Warn":
      case "ForceWarn":
        return false;
      case "Deny":
      case "Forbid":
        return true;
    }
  },

  /** `impl IntoDiagArg for Level` */
  // rustc: compiler/rustc_lint_defs/src/lib.rs:251 into_diag_arg
  into_diag_arg(self: Level, _: MutRef<PathBuf | undefined>): DiagArgValue {
    return { $: "Str", _0: Level.to_cmd_flag(self) };
  },
};

/// Extra information for a future incompatibility lint.
export type FutureIncompatibleInfo = gen.FutureIncompatibleInfo;
export const FutureIncompatibleInfo = {
  // rustc: compiler/rustc_lint_defs/src/lib.rs:451 default_fields_for_macro
  default_fields_for_macro(): FutureIncompatibleInfo {
    return {
      reason: FutureIncompatibilityReason.Unreachable,
      explain_reason: true,
      report_in_deps: false,
    };
  },
};

/// The reason for future incompatibility
export type FutureIncompatibilityReason = FutureIncompatibilityReason_;
export const FutureIncompatibilityReason = {
  ...gen.FutureIncompatibilityReason,

  // rustc: compiler/rustc_lint_defs/src/lib.rs:461 edition
  edition(self: FutureIncompatibilityReason): Edition | undefined {
    switch (self.$) {
      case "EditionError":
      case "EditionSemanticsChange":
      case "EditionAndFutureReleaseError":
      case "EditionAndFutureReleaseSemanticsChange":
        return self._0.edition;

      case "FutureReleaseError":
      case "FutureReleaseSemanticsChange":
      case "Custom":
        return undefined;
      case "Unreachable":
        unreachable();
    }
  },

  // rustc: compiler/rustc_lint_defs/src/lib.rs:475 reference
  reference(self: FutureIncompatibilityReason): string {
    switch (self.$) {
      case "FutureReleaseSemanticsChange":
      case "FutureReleaseError":
        return display_ReleaseFcw(self._0);
      case "Custom":
        return display_ReleaseFcw(self._1);
      case "EditionError":
      case "EditionSemanticsChange":
      case "EditionAndFutureReleaseError":
      case "EditionAndFutureReleaseSemanticsChange":
        return display_EditionFcw(self._0);
      case "Unreachable":
        unreachable();
    }
  },
};

/** `impl Display for ReleaseFcw` */
// rustc: compiler/rustc_lint_defs/src/lib.rs:490 fmt
export function display_ReleaseFcw(self: ReleaseFcw): string {
  const issue_number = self.issue_number;
  return `issue #${issue_number} <https://github.com/rust-lang/rust/issues/${issue_number}>`;
}

/** `impl Display for EditionFcw` */
// rustc: compiler/rustc_lint_defs/src/lib.rs:497 fmt
export function display_EditionFcw(self: EditionFcw): string {
  let edition: string;
  switch (self.edition) {
    case "Edition2015":
      edition = "rust-2015";
      break;
    case "Edition2018":
      edition = "rust-2018";
      break;
    case "Edition2021":
      edition = "rust-2021";
      break;
    case "Edition2024":
      edition = "rust-2024";
      break;
    case "EditionFuture":
      edition = "future";
      break;
  }
  return `<https://doc.rust-lang.org/edition-guide/${edition}/${self.page_slug}.html>`;
}

/// Specification of a single lint.
export type Lint = gen.Lint;
export const Lint = {
  // rustc: compiler/rustc_lint_defs/src/lib.rs:514 default_fields_for_macro
  default_fields_for_macro(): Lint {
    return {
      name: "",
      default_level: "Forbid",
      desc: "",
      edition_lint_opts: undefined,
      is_externally_loaded: false,
      report_in_external_macro: false,
      future_incompatible: undefined,
      feature_gate: undefined,
      crate_level_only: false,
      eval_always: false,
      ignore_deny_warnings: false,
      rust_version: undefined,
    };
  },

  // FIXME(const-hack): This is used so that `declare_lint` can declare an MSRV statically.
  // `RustcVersion::parse_str_strict` should ideally be used instead.
  // rustc: compiler/rustc_lint_defs/src/lib.rs:533 parse_rust_version
  parse_rust_version(version: string): RustcVersion {
    // rustc: compiler/rustc_lint_defs/src/lib.rs:534 parse_part
    function parse_part(input: MutRef<Uint8Array>): number {
      let val = 0;
      let idx = 0;
      while (idx < input.value.length) {
        const v = input.value[idx]!;
        if (v >= 0x30 && v <= 0x39) {
          // PORT: `u16` arithmetic; overflow is a const-eval error upstream (the only callers are
          // `declare_lint!` statics), so the plain sum is exact for every accepted input.
          val = val * 10 + (v - 0x30);
        } else if (v === 0x2e) {
          idx += 1;
          break;
        } else {
          panic("invalid character in version");
        }
        idx += 1;
      }
      input.value = input.value.subarray(idx);
      return val;
    }

    const bytes: MutRef<Uint8Array> = { value: utf8(version) };
    const major = parse_part(bytes);
    const minor = parse_part(bytes);
    const patch = parse_part(bytes);
    assert(bytes.value.length === 0, "assertion failed: bytes.is_empty()");
    return new RustcVersion(major, minor, patch);
  },

  /// Gets the lint's name, with ASCII letters converted to lowercase.
  // rustc: compiler/rustc_lint_defs/src/lib.rs:564 name_lower
  name_lower(self: Lint): string {
    return to_ascii_lowercase(self.name);
  },

  // rustc: compiler/rustc_lint_defs/src/lib.rs:568 default_level
  default_level(self: Lint, edition: Edition): Level {
    const opts = self.edition_lint_opts;
    const filtered = opts !== undefined && Edition_discriminant[opts[0]] <= Edition_discriminant[edition] ? opts : undefined;
    return filtered !== undefined ? filtered[1] : self.default_level;
  },
};

/** `str::to_ascii_lowercase` */
function to_ascii_lowercase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** PORT: `std::cmp::Ordering` as `-1 | 0 | 1`. */
export type Ordering = -1 | 0 | 1;

/** `str::cmp` (byte-wise on the UTF-8 encoding). */
function str_cmp(a: string, b: string): Ordering {
  const x = utf8(a);
  const y = utf8(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i]! !== y[i]!) return x[i]! < y[i]! ? -1 : 1;
  }
  return x.length < y.length ? -1 : x.length > y.length ? 1 : 0;
}

/// Identifies a lint known to the compiler.
// PORT: identity is the `&'static Lint` (pointer equality). `LintId.of` returns one canonical `LintId`
// per `Lint` object, so `===` and JS `Map`/`Set` keys agree with the upstream `PartialEq`/`Hash`.
export type LintId = gen.LintId;
const LINT_IDS = new WeakMap<Lint, LintId>();
export const LintId = {
  /** `impl PartialEq for LintId` */
  // rustc: compiler/rustc_lint_defs/src/lib.rs:584 eq
  eq(self: LintId, other: LintId): boolean {
    return self.lint === other.lint;
  },

  /** `impl Hash for LintId` */
  // PORT: there is no `Hasher` in src/std; `state` receives the values fed to `Hash::hash` (the pointer).
  // rustc: compiler/rustc_lint_defs/src/lib.rs:592 hash
  hash(self: LintId, state: (v: unknown) => void): void {
    const ptr = self.lint;
    state(ptr);
  },

  /// Gets the `LintId` for a `Lint`.
  // rustc: compiler/rustc_lint_defs/src/lib.rs:600 of
  of(lint: Lint): LintId {
    let id = LINT_IDS.get(lint);
    if (id === undefined) {
      id = Object.freeze({ lint });
      LINT_IDS.set(lint, id);
    }
    return id;
  },

  // rustc: compiler/rustc_lint_defs/src/lib.rs:604 lint_name_raw
  lint_name_raw(self: LintId): string {
    return self.lint.name;
  },

  /// Gets the name of the lint.
  // rustc: compiler/rustc_lint_defs/src/lib.rs:609 to_string
  to_string(self: LintId): string {
    return Lint.name_lower(self.lint);
  },

  // rustc-skip: compiler/rustc_lint_defs/src/lib.rs:616 stable_hash StableHash impl (incremental, M5)

  /** `impl StableCompare for LintId` */
  CAN_USE_UNSTABLE_SORT: true,

  // rustc: compiler/rustc_lint_defs/src/lib.rs:624 stable_cmp
  stable_cmp(self: LintId, other: LintId): Ordering {
    return str_cmp(LintId.lint_name_raw(self), LintId.lint_name_raw(other));
  },
};

/// Declares a static item of type `&'static Lint`.
///
/// See <https://rustc-dev-guide.rust-lang.org/diagnostics.html> for
/// documentation and guidelines on writing lints.
// PORT: `macro_rules! declare_lint` is expanded by tools/codegen/lints.ts (builtin.gen.ts), which
// fingerprints the macro body and reads `Lint::default_fields_for_macro` from this file's upstream.
// `macro_rules! declare_tool_lint` has no invocation in the ported crates yet; it is not generated.

export type LintVec = gen.LintVec;

export interface LintPass {
  // rustc: compiler/rustc_lint_defs/src/lib.rs:776 name
  name(): string;
  // rustc: compiler/rustc_lint_defs/src/lib.rs:777 get_lints
  get_lints(): LintVec;
}

/// Implements `LintPass for $ty` with the given list of `Lint` statics.
// PORT: `macro_rules! impl_lint_pass` → `impl_lint_pass(stringify!($ty), () => vec![$($lint),*])`,
// returning the `LintPass` impl plus the inherent `lint_vec`. builtin.gen.ts writes the same expansion
// inline for `declare_lint_pass!` (it cannot call into this module while it is initialised).
export function impl_lint_pass(ty: string, lints: () => LintVec): LintPass & { lint_vec(): LintVec } {
  return {
    // rustc: compiler/rustc_lint_defs/src/lib.rs:785 name
    name(): string {
      return ty;
    },
    // rustc: compiler/rustc_lint_defs/src/lib.rs:786 get_lints
    get_lints(): LintVec {
      return lints();
    },
    // rustc: compiler/rustc_lint_defs/src/lib.rs:790 lint_vec
    lint_vec(): LintVec {
      return lints();
    },
  };
}

/// Declares a type named `$name` which implements `LintPass`.
/// To the right of `=>` a comma separated list of `Lint` statics is given.
// PORT: `macro_rules! declare_lint_pass` (a unit struct + `impl_lint_pass!`).
export function declare_lint_pass(name: string, lints: () => LintVec): LintPass & { lint_vec(): LintVec } {
  return impl_lint_pass(name, lints);
}

// PORT: `macro_rules! fcw` is expanded by tools/codegen/lints.ts (`reason: fcw!(..)` in declare_lint!).

