//! Source positions and related helper functions.
//!
//! Important concepts in this module include:
//!
//! - the *span*, represented by [`SpanData`] and related types;
//! - source code as represented by a [`SourceMap`]; and
//! - interned strings, represented by [`Symbol`]s, with some common symbols available statically
//!   in the [`sym`] module.
//!
//! Unlike most compilers, the span contains not only the position in the source code, but also
//! various other metadata, such as the edition and macro hygiene. This metadata is stored in
//! [`SyntaxContext`] and [`ExpnData`].
//!
//! ## Note
//!
//! This API is completely unstable and subject to change.
//
// PORT: wave-1 boundaries (lane span-core). Sibling lanes (symbol.ts, hygiene.ts, def_id.ts) are
// type-only stubs while the lanes run in parallel, and a value import from a stub fails at link
// time. So:
// - sibling *values* listed in the contract stub are reached through namespace imports
//   (`hygiene.HygieneData.new`), mirroring upstream's `hygiene::HygieneData::new`;
// - everything else from siblings goes through the "stand-ins" section below, each either the
//   exact upstream newtype value or `unported(...)`. Root: replace stand-ins at integration.
// - source_map.rs (wave 2): `SourceMap`/`SourceMapInputs` are opaque placeholders and every call
//   into them is `unported("rustc_span::source_map::...")`.
import { analyze_source_file } from "./analyze_source_file.ts";
import type { CrateNum, LocalDefId } from "./def_id.ts";
import { DEFAULT_EDITION, Edition } from "./edition.ts";
import { FatalError } from "./fatal_error.ts";
import * as hygiene from "./hygiene.ts";
import type { ExpnId, HygieneData, SyntaxContext } from "./hygiene.ts";
import {
  DUMMY_SP,
  Span,
  SpanInterner,
  span_data_eq,
  SyntaxContext_is_root,
  SyntaxContext_root,
} from "./span_encoding.ts";
import type { Interner, Symbol } from "./symbol.ts";
import { debug_int, debug_option, debug_str, debug_struct, debug_tuple, debug_vec, type Debug, type Fmt } from "../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Str } from "../std/str.ts";

export { DUMMY_SP, OrdSpan, Span } from "./span_encoding.ts";
export { bug, span_bug } from "./macros.ts";
// PORT: `pub use unicode_width::UNICODE_VERSION;` waits for vendor `unicode-width` (not ported).

// _____________________________________________________________________________
// Wave-1 stand-ins (see the PORT block at the top). Root: replace with sibling exports.
//

/** Field subset of hygiene.rs `ExpnData` read here (the hygiene.ts stub has no `ExpnData`). */
interface ExpnData {
  readonly kind: ExpnKind;
  readonly call_site: Span;
  readonly allow_internal_unstable: readonly Symbol[] | undefined;
  readonly allow_internal_unsafe: boolean;
  readonly diagnostic_opaque: boolean;
}
/** hygiene.rs `ExpnKind` (`AstPass` payload left opaque). */
type ExpnKind =
  | { readonly $: "Root" }
  | { readonly $: "Macro"; readonly _0: MacroKind; readonly _1: Symbol }
  | { readonly $: "AstPass"; readonly _0: unknown }
  | { readonly $: "Desugaring"; readonly _0: DesugaringKind };
/** hygiene.rs `MacroKind` (fieldless). */
type MacroKind = "Bang" | "Attr" | "Derive";
/** hygiene.rs `DesugaringKind` (variant names only compared here). */
type DesugaringKind = string;
/** hygiene.rs `enum Transparency { Transparent, SemiOpaque, Opaque }` (fieldless). */
type Transparency = "Transparent" | "SemiOpaque" | "Opaque";
/** def_id.rs `StableCrateId`: not in the def_id.ts stub. */
type StableCrateId = unknown;
/** def_id.rs:`pub const LOCAL_CRATE: CrateNum = CrateNum::ZERO;` */
const LOCAL_CRATE = 0 as CrateNum;

function SyntaxContext_outer_expn_data(_ctxt: SyntaxContext): ExpnData {
  return unported("rustc_span::hygiene::SyntaxContext::outer_expn_data");
}
function SyntaxContext_in_external_macro(_ctxt: SyntaxContext, _sm: SourceMap): boolean {
  return unported("rustc_span::hygiene::SyntaxContext::in_external_macro");
}
function SyntaxContext_edition(_ctxt: SyntaxContext): Edition {
  return unported("rustc_span::hygiene::SyntaxContext::edition");
}
function SyntaxContext_apply_mark(_ctxt: SyntaxContext, _expn_id: ExpnId, _transparency: Transparency): SyntaxContext {
  return unported("rustc_span::hygiene::SyntaxContext::apply_mark");
}
/** `&mut self` method: returns `[new ctxt, result]`. */
function SyntaxContext_remove_mark(_ctxt: SyntaxContext): [SyntaxContext, ExpnId] {
  return unported("rustc_span::hygiene::SyntaxContext::remove_mark");
}
function SyntaxContext_adjust(_ctxt: SyntaxContext, _expn_id: ExpnId): [SyntaxContext, ExpnId | undefined] {
  return unported("rustc_span::hygiene::SyntaxContext::adjust");
}
function SyntaxContext_normalize_to_macros_2_0_and_adjust(_ctxt: SyntaxContext, _expn_id: ExpnId): [SyntaxContext, ExpnId | undefined] {
  return unported("rustc_span::hygiene::SyntaxContext::normalize_to_macros_2_0_and_adjust");
}
function SyntaxContext_normalize_to_macros_2_0(_ctxt: SyntaxContext): SyntaxContext {
  return unported("rustc_span::hygiene::SyntaxContext::normalize_to_macros_2_0");
}
function SyntaxContext_normalize_to_macro_rules(_ctxt: SyntaxContext): SyntaxContext {
  return unported("rustc_span::hygiene::SyntaxContext::normalize_to_macro_rules");
}
function ExpnId_root(): ExpnId {
  return unported("rustc_span::hygiene::ExpnId::root");
}
/** hygiene.rs `impl fmt::Debug for SyntaxContext`: `write!(f, "#{}", self.0)`. */
function debug_SyntaxContext(ctxt: SyntaxContext): string {
  return `#${ctxt}`;
}
function Interner_with_extra_symbols(_extra_symbols: readonly string[]): Interner {
  // Generated by the `symbols!` macro (span-symbol lane / tools/codegen/symbols.ts).
  return unported("rustc_span::symbol::Interner::with_extra_symbols");
}
/** `Option<LocalDefId> == Option<LocalDefId>` */
function local_def_id_opt_eq(a: LocalDefId | undefined, b: LocalDefId | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.local_def_index === b.local_def_index;
}

/** source_map.rs (wave 2). */
interface SourceMap {
  readonly __wave2_source_map: never;
}
interface SourceMapInputs {
  readonly __wave2_source_map_inputs: never;
}

/** PORT: `rustc_hashes::Hash64` (u64) / `Hash128` (u128) as bigint until rustc_hashes is ported. */
export type Hash64 = bigint;
export type Hash128 = bigint;
/** `impl Debug for Hash64`: the inner integer. */
const debug_Hash64: Debug<Hash64> = (v) => String(v);

/**
 * PORT: subset of `rustc_data_structures::sync::FreezeLock` (single-threaded): the value plus the
 * frozen bit, which `SourceFile` and `MetavarSpansMap` observe. Root: move to
 * rustc_data_structures when that crate lands.
 */
class FreezeLock<T> {
  constructor(
    public value: T,
    public frozen: boolean,
  ) {}
  static new<T>(value: T): FreezeLock<T> {
    return new FreezeLock(value, false);
  }
  static frozen<T>(value: T): FreezeLock<T> {
    return new FreezeLock(value, true);
  }
  is_frozen(): boolean {
    return this.frozen;
  }
  /** `get`: the value, only once frozen. */
  get(): T | undefined {
    return this.frozen ? this.value : undefined;
  }
  read(): T {
    return this.value;
  }
  /** `try_write`: write access unless frozen. */
  try_write(): FreezeLock<T> | undefined {
    return this.frozen ? undefined : this;
  }
  write(): FreezeLock<T> {
    return unwrap(this.try_write(), "still mutable");
  }
  freeze(): T {
    this.frozen = true;
    return this.value;
  }
}

// _____________________________________________________________________________
// Spanned
//

export interface Spanned<T> {
  node: T;
  span: Span;
}

export function debug_Spanned<T>(v: Spanned<T>, f: Fmt, debug_T: Debug<T>): string {
  return debug_struct(f, "Spanned", [
    ["node", debug_T(v.node, f)],
    ["span", debug_Span(v.span, f)],
  ]);
}

// rustc: compiler/rustc_span/src/lib.rs:103 respan
export function respan<T>(sp: Span, t: T): Spanned<T> {
  return { node: t, span: sp };
}

// rustc: compiler/rustc_span/src/lib.rs:107 dummy_spanned
export function dummy_spanned<T>(t: T): Spanned<T> {
  return respan(DUMMY_SP, t);
}

/// Per-session global variables: this struct is stored in thread-local storage
/// in such a way that it is accessible without any kind of handle to all
/// threads within the compilation session, but is not accessible outside the
/// session.
export class SessionGlobals {
  constructor(
    readonly symbol_interner: Interner,
    readonly span_interner: SpanInterner,
    /// Maps a macro argument token into use of the corresponding metavariable in the macro body.
    /// Collisions are possible and processed in `maybe_use_metavar_location` on best effort basis.
    readonly metavar_spans: MetavarSpansMap,
    readonly hygiene_data: HygieneData,
    /// The session's source map, if there is one. This field should only be
    /// used in places where the `Session` is truly not available, such as
    /// `<Span as Debug>::fmt`.
    readonly source_map: SourceMap | undefined,
  ) {}

  // rustc: compiler/rustc_span/src/lib.rs:130 new
  static new(edition: Edition, extra_symbols: readonly string[], sm_inputs: SourceMapInputs | undefined): SessionGlobals {
    return new SessionGlobals(
      Interner_with_extra_symbols(extra_symbols),
      SpanInterner.default(),
      MetavarSpansMap.default(),
      hygiene.HygieneData.new(edition),
      sm_inputs === undefined ? undefined : unported("rustc_span::source_map::SourceMap::with_inputs"),
    );
  }
}

// rustc: compiler/rustc_span/src/lib.rs:145 create_session_globals_then
export function create_session_globals_then<R>(
  edition: Edition,
  extra_symbols: readonly string[],
  sm_inputs: SourceMapInputs | undefined,
  f: () => R,
): R {
  assert(
    !SESSION_GLOBALS.is_set(),
    "SESSION_GLOBALS should never be overwritten! Use another thread if you need another SessionGlobals",
  );
  const session_globals = SessionGlobals.new(edition, extra_symbols, sm_inputs);
  return SESSION_GLOBALS.set(session_globals, f);
}

// rustc: compiler/rustc_span/src/lib.rs:160 set_session_globals_then
export function set_session_globals_then<R>(session_globals: SessionGlobals, f: () => R): R {
  assert(
    !SESSION_GLOBALS.is_set(),
    "SESSION_GLOBALS should never be overwritten! Use another thread if you need another SessionGlobals",
  );
  return SESSION_GLOBALS.set(session_globals, f);
}

/// No source map.
// rustc: compiler/rustc_span/src/lib.rs:170 create_session_if_not_set_then
export function create_session_if_not_set_then<R>(edition: Edition, f: (g: SessionGlobals) => R): R {
  if (!SESSION_GLOBALS.is_set()) {
    const session_globals = SessionGlobals.new(edition, [], undefined);
    return SESSION_GLOBALS.set(session_globals, () => SESSION_GLOBALS.with(f));
  } else {
    return SESSION_GLOBALS.with(f);
  }
}

// rustc: compiler/rustc_span/src/lib.rs:183 with_session_globals
export function with_session_globals<R>(f: (g: SessionGlobals) => R): R {
  return SESSION_GLOBALS.with(f);
}

/// Default edition, no source map.
// rustc: compiler/rustc_span/src/lib.rs:191 create_default_session_globals_then
export function create_default_session_globals_then<R>(f: () => R): R {
  return create_session_globals_then(DEFAULT_EDITION, [], undefined, f);
}

// If this ever becomes non thread-local, `decode_syntax_context`
// and `decode_expn_id` will need to be updated to handle concurrent
// deserialization.
// PORT: `scoped_tls::scoped_thread_local!(static SESSION_GLOBALS: SessionGlobals)` -> a module-level
// slot with the `ScopedKey` API (`set` restores the previous value in `finally`).
let SESSION_GLOBALS_SLOT: SessionGlobals | undefined;
const SESSION_GLOBALS = {
  is_set(): boolean {
    return SESSION_GLOBALS_SLOT !== undefined;
  },
  set<R>(g: SessionGlobals, f: () => R): R {
    const prev = SESSION_GLOBALS_SLOT;
    SESSION_GLOBALS_SLOT = g;
    try {
      return f();
    } finally {
      SESSION_GLOBALS_SLOT = prev;
    }
  },
  with<R>(f: (g: SessionGlobals) => R): R {
    if (SESSION_GLOBALS_SLOT === undefined) {
      panic("cannot access a scoped thread local variable without calling `set` first");
    }
    return f(SESSION_GLOBALS_SLOT);
  },
};

export class MetavarSpansMap {
  constructor(readonly _0: FreezeLock<Map<Span, [Span, boolean]>>) {}

  /** `#[derive(Default)]` */
  static default(): MetavarSpansMap {
    return new MetavarSpansMap(FreezeLock.new(new Map()));
  }

  // rustc: compiler/rustc_span/src/lib.rs:204 insert
  insert(span: Span, var_span: Span): boolean {
    const map = this._0.write().value;
    // `try_insert`
    const entry = map.get(span);
    if (entry === undefined) {
      map.set(span, [var_span, false]);
      return true;
    } else {
      return entry[0] === var_span;
    }
  }

  /// Read a span and record that it was read.
  // rustc: compiler/rustc_span/src/lib.rs:212 get
  get(span: Span): Span | undefined {
    const mspans = this._0.try_write();
    if (mspans !== undefined) {
      const entry = mspans.value.get(span);
      if (entry !== undefined) {
        entry[1] = true;
        return entry[0];
      } else {
        return undefined;
      }
    } else {
      const entry = this._0.read().get(span);
      if (entry !== undefined && entry[1] === true) {
        return entry[0];
      } else {
        return undefined;
      }
    }
  }

  /// Freeze the set, and return the spans which have been read.
  ///
  /// After this is frozen, no spans that have not been read can be read.
  // rustc: compiler/rustc_span/src/lib.rs:228 freeze_and_get_read_spans
  freeze_and_get_read_spans(): Map<Span, Span> {
    const out = new Map<Span, Span>();
    for (const [s1, [s2, b]] of this._0.freeze()) if (b) out.set(s1, s2);
    return out;
  }
}

// rustc: compiler/rustc_span/src/lib.rs:234 with_metavar_spans
export function with_metavar_spans<R>(f: (m: MetavarSpansMap) => R): R {
  return with_session_globals((session_globals) => f(session_globals.metavar_spans));
}

/// Scopes used to determined if it need to apply to `--remap-path-prefix`
// PORT: `bitflags!` struct over u8 -> number + companion; Debug follows bitflags 2.10.
export type RemapPathScopeComponents = number;
export const RemapPathScopeComponents = {
  /// Apply remappings to the expansion of `std::file!()` macro
  MACRO: 1 << 0,
  /// Apply remappings to printed compiler diagnostics
  DIAGNOSTICS: 1 << 1,
  /// Apply remappings to debug information
  DEBUGINFO: 1 << 3,
  /// Apply remappings to coverage information
  COVERAGE: 1 << 4,
  /// Apply remappings to documentation information
  DOCUMENTATION: 1 << 5,

  /// An alias for `macro`, `debuginfo` and `coverage`. This ensures all paths in compiled
  /// executables, libraries and objects are remapped but not elsewhere.
  OBJECT: (1 << 0) | (1 << 3) | (1 << 4),

  empty: (): RemapPathScopeComponents => 0,
  all: (): RemapPathScopeComponents => REMAP_ALL,
  contains: (self: RemapPathScopeComponents, other: RemapPathScopeComponents): boolean => (self & other) === other,
  is_empty: (self: RemapPathScopeComponents): boolean => self === 0,
  is_all: (self: RemapPathScopeComponents): boolean => (self & REMAP_ALL) === REMAP_ALL,
  count_ones: (self: RemapPathScopeComponents): number => {
    let n = 0;
    for (let b = self; b !== 0; b &= b - 1) n++;
    return n;
  },
} as const;
const REMAP_FLAGS: readonly [string, number][] = [
  ["MACRO", 1 << 0],
  ["DIAGNOSTICS", 1 << 1],
  ["DEBUGINFO", 1 << 3],
  ["COVERAGE", 1 << 4],
  ["DOCUMENTATION", 1 << 5],
  ["OBJECT", (1 << 0) | (1 << 3) | (1 << 4)],
];
const REMAP_ALL = (1 << 0) | (1 << 1) | (1 << 3) | (1 << 4) | (1 << 5);

/** bitflags 2: `Name(A | B | 0x40)`, or `Name(0x0)` when empty. */
export const debug_RemapPathScopeComponents: Debug<RemapPathScopeComponents> = (v, f) => {
  let s: string;
  if (v === 0) {
    s = "0x0";
  } else {
    const names: string[] = [];
    let remaining = v;
    for (const [name, bits] of REMAP_FLAGS) {
      if (remaining === 0) break;
      if ((v & bits) === bits && (remaining & bits) !== 0) {
        remaining &= ~bits;
        names.push(name);
      }
    }
    if (remaining !== 0) names.push("0x" + remaining.toString(16));
    s = names.join(" | ");
  }
  return debug_tuple(f, "RemapPathScopeComponents", [s]);
};

// rustc-skip: compiler/rustc_span/src/lib.rs:261 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:268 decode Decodable impl

/** PORT: `PathBuf`/`&Path` are strings (paths as given on the command line / by the source map). */
export type PathBuf = string;

/// The inner workings of `RealFileName`.
///
/// It contains the `name`, `working_directory` and `embeddable_name` components.
interface InnerRealFileName {
  /// The name.
  name: PathBuf;
  /// The working directory associated with the embeddable name.
  working_directory: PathBuf;
  /// The embeddable name.
  embeddable_name: PathBuf;
}

const debug_InnerRealFileName: Debug<InnerRealFileName> = (v, f) =>
  debug_struct(f, "InnerRealFileName", [
    ["name", debug_str(v.name)],
    ["working_directory", debug_str(v.working_directory)],
    ["embeddable_name", debug_str(v.embeddable_name)],
  ]);

/// A self-contained "real" filename.
///
/// It is produced by `SourceMap::to_real_filename`.
///
/// `RealFileName` represents a filename that may have been (partly) remapped
/// by `--remap-path-prefix` and `-Zremap-path-scope`.
///
/// It also contains an embedabble component which gives a working directory
/// and a maybe-remapped maybe-aboslote name. This is useful for debuginfo where
/// some formats and tools highly prefer absolute paths.
///
/// ## Consistency across compiler sessions
///
/// The type-system, const-eval and other parts of the compiler rely on `FileName`
/// and by extension `RealFileName` to be consistent across compiler sessions.
///
/// Otherwise unsoudness (like rust-lang/rust#148328) may occur.
///
/// As such this type is self-sufficient and consistent in it's output.
///
/// The [`RealFileName::path`] and [`RealFileName::embeddable_name`] methods
/// are guaranteed to always return the same output across compiler sessions.
///
/// ## Usage
///
/// Creation of a [`RealFileName`] should be done using
/// [`FilePathMapping::to_real_filename`][rustc_span::source_map::FilePathMapping::to_real_filename].
///
/// Retrieving a path can be done in two main ways:
///  - by using [`RealFileName::path`] with a given scope (should be preferred)
///  - or by using [`RealFileName::embeddable_name`] with a given scope
export class RealFileName {
  constructor(
    /// The local name (always present in the original crate)
    public local: InnerRealFileName | undefined,
    /// The maybe remapped part. Correspond to `local` when no remapped happened.
    public maybe_remapped: InnerRealFileName,
    /// The remapped scopes. Any active scope MUST use `maybe_virtual`
    public scopes: RemapPathScopeComponents,
  ) {}

  // rustc-skip: compiler/rustc_span/src/lib.rs:330 hash std Hash impl only feeds StableHasher (FileName hashing, see StableSourceFileId PORT)

  /// Returns the associated path for the given remapping scope.
  ///
  /// ## Panic
  ///
  /// Only one scope components can be given to this function.
  // rustc: compiler/rustc_span/src/lib.rs:350 path
  path(scope: RemapPathScopeComponents): PathBuf {
    assert(
      RemapPathScopeComponents.count_ones(scope) === 1,
      `one and only one scope should be passed to \`RealFileName::path\`: ${debug_RemapPathScopeComponents(scope, { alternate: false })}`,
    );
    const local_name = this.local;
    if (!RemapPathScopeComponents.contains(this.scopes, scope) && local_name !== undefined) {
      return local_name.name;
    } else {
      return this.maybe_remapped.name;
    }
  }

  /// Returns the working directory and embeddable path for the given remapping scope.
  ///
  /// Useful for embedding a mostly abosolute path (modulo remapping) in the compiler outputs.
  ///
  /// The embedabble path is not guaranteed to be an absolute path, nor is it garuenteed
  /// that the working directory part is always a prefix of embeddable path.
  ///
  /// ## Panic
  ///
  /// Only one scope components can be given to this function.
  // rustc: compiler/rustc_span/src/lib.rs:375 embeddable_name
  embeddable_name(scope: RemapPathScopeComponents): [PathBuf, PathBuf] {
    assert(
      RemapPathScopeComponents.count_ones(scope) === 1,
      `one and only one scope should be passed to \`RealFileName::embeddable_path\`: ${debug_RemapPathScopeComponents(scope, { alternate: false })}`,
    );
    const local_name = this.local;
    if (!RemapPathScopeComponents.contains(this.scopes, scope) && local_name !== undefined) {
      return [local_name.working_directory, local_name.embeddable_name];
    } else {
      return [this.maybe_remapped.working_directory, this.maybe_remapped.embeddable_name];
    }
  }

  /// Returns the path suitable for reading from the file system on the local host,
  /// if this information exists.
  ///
  /// May not exists if the filename was imported from another crate.
  ///
  /// Avoid embedding this in build artifacts; prefer `path()` or `embeddable_name()`.
  // rustc: compiler/rustc_span/src/lib.rs:396 local_path
  local_path(): PathBuf | undefined {
    if (this.was_not_remapped()) {
      return this.maybe_remapped.name;
    } else if (this.local !== undefined) {
      return this.local.name;
    } else {
      return undefined;
    }
  }

  /// Returns the path suitable for reading from the file system on the local host,
  /// if this information exists.
  ///
  /// May not exists if the filename was imported from another crate.
  ///
  /// Avoid embedding this in build artifacts; prefer `path()` or `embeddable_name()`.
  // rustc: compiler/rustc_span/src/lib.rs:413 into_local_path
  into_local_path(): PathBuf | undefined {
    if (this.was_not_remapped()) {
      return this.maybe_remapped.name;
    } else if (this.local !== undefined) {
      return this.local.name;
    } else {
      return undefined;
    }
  }

  /// Returns whenever the filename was remapped.
  // rustc: compiler/rustc_span/src/lib.rs:425 was_remapped
  was_remapped(): boolean {
    return !RemapPathScopeComponents.is_empty(this.scopes);
  }

  /// Returns whenever the filename was fully remapped.
  // rustc: compiler/rustc_span/src/lib.rs:431 was_fully_remapped
  was_fully_remapped(): boolean {
    return RemapPathScopeComponents.is_all(this.scopes);
  }

  /// Returns whenever the filename was not remapped.
  // rustc: compiler/rustc_span/src/lib.rs:437 was_not_remapped
  was_not_remapped(): boolean {
    return RemapPathScopeComponents.is_empty(this.scopes);
  }

  /// Returns an empty `RealFileName`
  ///
  /// Useful as the working directory input to `SourceMap::to_real_filename`.
  // rustc: compiler/rustc_span/src/lib.rs:445 empty
  static empty(): RealFileName {
    return new RealFileName(
      { name: "", working_directory: "", embeddable_name: "" },
      { name: "", working_directory: "", embeddable_name: "" },
      RemapPathScopeComponents.empty(),
    );
  }

  /// Returns a `RealFileName` that is completely remapped without any local components.
  ///
  /// Only exposed for the purpose of `-Zsimulate-remapped-rust-src-base`.
  // rustc: compiler/rustc_span/src/lib.rs:464 from_virtual_path
  static from_virtual_path(path: PathBuf): RealFileName {
    const name: InnerRealFileName = {
      name: path,
      embeddable_name: path,
      working_directory: "",
    };
    return new RealFileName(undefined, name, RemapPathScopeComponents.all());
  }

  /// Update the filename for encoding in the crate metadata.
  ///
  /// Currently it's about removing the local part when the filename
  /// is either fully remapped or not remapped at all.
  // rustc: compiler/rustc_span/src/lib.rs:478 update_for_crate_metadata
  update_for_crate_metadata(): void {
    if (this.was_fully_remapped() || this.was_not_remapped()) {
      // NOTE: This works because when the filename is fully
      // remapped, we don't care about the `local` part,
      // and when the filename is not remapped at all,
      // `maybe_remapped` and `local` are equal.
      this.local = undefined;
    }
  }

  /// Internal routine to display the filename.
  ///
  /// Users should always use the `RealFileName::path` method or `FileName` methods instead.
  // rustc: compiler/rustc_span/src/lib.rs:491 to_string_lossy
  to_string_lossy(display_pref: FileNameDisplayPreference): string {
    switch (display_pref.$) {
      case "Remapped":
        return this.maybe_remapped.name;
      case "Local":
        return (this.local ?? this.maybe_remapped).name;
      case "Short":
        return unported("std::path::Path::file_name");
      case "Scope":
        return this.path(display_pref._0);
    }
  }
}

export const debug_RealFileName: Debug<RealFileName> = (v, f) =>
  debug_struct(f, "RealFileName", [
    ["local", debug_option(v.local, f, debug_InnerRealFileName)],
    ["maybe_remapped", debug_InnerRealFileName(v.maybe_remapped, f)],
    ["scopes", debug_RemapPathScopeComponents(v.scopes, f)],
  ]);

/// Differentiates between real files and common virtual files.
export type FileName =
  | { readonly $: "Real"; readonly _0: RealFileName }
  /// Strings provided as `--cfg [cfgspec]`.
  | { readonly $: "CfgSpec"; readonly _0: Hash64 }
  /// Command line.
  | { readonly $: "Anon"; readonly _0: Hash64 }
  /// Hack in `src/librustc_ast/parse.rs`.
  // FIXME(jseyfried)
  | { readonly $: "MacroExpansion"; readonly _0: Hash64 }
  | { readonly $: "ProcMacroSourceCode"; readonly _0: Hash64 }
  /// Strings provided as crate attributes in the CLI.
  | { readonly $: "CliCrateAttr"; readonly _0: Hash64 }
  /// Custom sources for explicit parser calls from plugins and drivers.
  | { readonly $: "Custom"; readonly _0: string }
  /// Custom path for doctests
  | { readonly $: "DocTest"; readonly _0: RealFileName; readonly _1: number }
  /// Post-substitution inline assembly from LLVM.
  | { readonly $: "InlineAsm"; readonly _0: Hash64 };

export const debug_FileName: Debug<FileName> = (v, f) => {
  switch (v.$) {
    case "Real":
      return debug_tuple(f, "Real", [debug_RealFileName(v._0, f)]);
    case "Custom":
      return debug_tuple(f, "Custom", [debug_str(v._0)]);
    case "DocTest":
      return debug_tuple(f, "DocTest", [debug_RealFileName(v._0, f), debug_int(v._1, f)]);
    default:
      return debug_tuple(f, v.$, [debug_Hash64(v._0, f)]);
  }
};

export class FileNameDisplay {
  constructor(
    readonly inner: FileName,
    readonly display_pref: FileNameDisplayPreference,
  ) {}

  // rustc: compiler/rustc_span/src/lib.rs:544 fmt
  /** `impl fmt::Display for FileNameDisplay` */
  to_string(): string {
    const inner = this.inner;
    switch (inner.$) {
      case "Real":
      case "DocTest":
        return `${inner._0.to_string_lossy(this.display_pref)}`;
      case "CfgSpec":
        return `<cfgspec>`;
      case "MacroExpansion":
        return `<macro expansion>`;
      case "Anon":
        return `<anon>`;
      case "ProcMacroSourceCode":
        return `<proc-macro source code>`;
      case "CliCrateAttr":
        return `<crate attribute>`;
      case "Custom":
        return `<${inner._0}>`;
      case "InlineAsm":
        return `<inline asm>`;
    }
  }

  // rustc: compiler/rustc_span/src/lib.rs:562 to_string_lossy
  to_string_lossy(): string {
    if (this.inner.$ === "Real") {
      return this.inner._0.to_string_lossy(this.display_pref);
    }
    return this.to_string();
  }
}

// Internal enum. Should not be exposed.
type FileNameDisplayPreference =
  | { readonly $: "Remapped" }
  | { readonly $: "Local" }
  | { readonly $: "Short" }
  | { readonly $: "Scope"; readonly _0: RemapPathScopeComponents };
const FileNameDisplayPreference = {
  Remapped: { $: "Remapped" },
  Local: { $: "Local" },
  Short: { $: "Short" },
} as const;

/** `impl FileName` (methods take the `FileName` as `self`). */
export const FileName = {
  // rustc: compiler/rustc_span/src/lib.rs:571 is_real
  is_real(self: FileName): boolean {
    switch (self.$) {
      case "Real":
        return true;
      case "Anon":
      case "MacroExpansion":
      case "ProcMacroSourceCode":
      case "CliCrateAttr":
      case "Custom":
      case "CfgSpec":
      case "DocTest":
      case "InlineAsm":
        return false;
    }
  },

  /// Returns the path suitable for reading from the file system on the local host,
  /// if this information exists.
  ///
  /// Avoid embedding this in build artifacts. Prefer using the `display` method.
  // rustc: compiler/rustc_span/src/lib.rs:591 prefer_remapped_unconditionally
  prefer_remapped_unconditionally(self: FileName): FileNameDisplay {
    return new FileNameDisplay(self, FileNameDisplayPreference.Remapped);
  },

  /// Returns the path suitable for reading from the file system on the local host,
  /// if this information exists.
  ///
  /// Avoid embedding this in build artifacts. Prefer using the `display` method.
  // rustc: compiler/rustc_span/src/lib.rs:600 prefer_local_unconditionally
  prefer_local_unconditionally(self: FileName): FileNameDisplay {
    return new FileNameDisplay(self, FileNameDisplayPreference.Local);
  },

  /// Returns a short (either the filename or an empty string).
  // rustc: compiler/rustc_span/src/lib.rs:606 short
  short(self: FileName): FileNameDisplay {
    return new FileNameDisplay(self, FileNameDisplayPreference.Short);
  },

  /// Returns a `Display`-able path for the given scope.
  // rustc: compiler/rustc_span/src/lib.rs:612 display
  display(self: FileName, scope: RemapPathScopeComponents): FileNameDisplay {
    return new FileNameDisplay(self, { $: "Scope", _0: scope });
  },

  // rustc: compiler/rustc_span/src/lib.rs:616 macro_expansion_source_code
  macro_expansion_source_code(_src: string): FileName {
    return unported("rustc_data_structures::stable_hasher::StableHasher");
  },

  // rustc: compiler/rustc_span/src/lib.rs:622 anon_source_code
  anon_source_code(_src: string): FileName {
    return unported("rustc_data_structures::stable_hasher::StableHasher");
  },

  // rustc: compiler/rustc_span/src/lib.rs:628 proc_macro_source_code
  proc_macro_source_code(_src: string): FileName {
    return unported("rustc_data_structures::stable_hasher::StableHasher");
  },

  // rustc: compiler/rustc_span/src/lib.rs:634 cfg_spec_source_code
  cfg_spec_source_code(_src: string): FileName {
    return unported("rustc_data_structures::stable_hasher::StableHasher");
  },

  // rustc: compiler/rustc_span/src/lib.rs:640 cli_crate_attr_source_code
  cli_crate_attr_source_code(_src: string): FileName {
    return unported("rustc_data_structures::stable_hasher::StableHasher");
  },

  // rustc: compiler/rustc_span/src/lib.rs:646 doc_test_source_code
  doc_test_source_code(path: RealFileName, line: number): FileName {
    return { $: "DocTest", _0: path, _1: line };
  },

  // rustc: compiler/rustc_span/src/lib.rs:650 inline_asm_source_code
  inline_asm_source_code(_src: string): FileName {
    return unported("rustc_data_structures::stable_hasher::StableHasher");
  },

  /// Returns the path suitable for reading from the file system on the local host,
  /// if this information exists.
  ///
  /// Avoid embedding this in build artifacts.
  // rustc: compiler/rustc_span/src/lib.rs:660 into_local_path
  into_local_path(self: FileName): PathBuf | undefined {
    switch (self.$) {
      case "Real":
        return self._0.into_local_path();
      case "DocTest":
        return self._0.into_local_path();
      default:
        return undefined;
    }
  },
};

/// Represents a span.
///
/// Spans represent a region of code, used for error reporting. Positions in spans
/// are *absolute* positions from the beginning of the [`SourceMap`], not positions
/// relative to [`SourceFile`]s. Methods on the `SourceMap` can be used to relate spans back
/// to the original source.
///
/// You must be careful if the span crosses more than one file, since you will not be
/// able to use many of the functions on spans in source_map and you cannot assume
/// that the length of the span is equal to `span.hi - span.lo`; there may be space in the
/// [`BytePos`] range between files.
///
/// `SpanData` is public because `Span` uses a thread-local interner and can't be
/// sent to other threads, but some pieces of performance infra run in a separate thread.
/// Using `Span` is generally preferred.
// PORT: fields are readonly: interned `SpanData` objects are shared (upstream copies them).
export class SpanData {
  constructor(
    readonly lo: BytePos,
    readonly hi: BytePos,
    /// Information about where the macro came from, if this piece of
    /// code was created by a macro expansion.
    readonly ctxt: SyntaxContext,
    readonly parent: LocalDefId | undefined,
  ) {}

  // rustc: compiler/rustc_span/src/lib.rs:701 span
  span(): Span {
    return Span.new(this.lo, this.hi, this.ctxt, this.parent);
  }
  // rustc: compiler/rustc_span/src/lib.rs:705 with_lo
  with_lo(lo: BytePos): Span {
    return Span.new(lo, this.hi, this.ctxt, this.parent);
  }
  // rustc: compiler/rustc_span/src/lib.rs:709 with_hi
  with_hi(hi: BytePos): Span {
    return Span.new(this.lo, hi, this.ctxt, this.parent);
  }
  /// Avoid if possible, `Span::map_ctxt` should be preferred.
  // rustc: compiler/rustc_span/src/lib.rs:714 with_ctxt
  with_ctxt(ctxt: SyntaxContext): Span {
    return Span.new(this.lo, this.hi, ctxt, this.parent);
  }
  /// Avoid if possible, `Span::with_parent` should be preferred.
  // rustc: compiler/rustc_span/src/lib.rs:719 with_parent
  with_parent(parent: LocalDefId | undefined): Span {
    return Span.new(this.lo, this.hi, this.ctxt, parent);
  }
  /// Returns `true` if this is a dummy span with any hygienic context.
  // rustc: compiler/rustc_span/src/lib.rs:724 is_dummy
  is_dummy(): boolean {
    return this.lo === 0 && this.hi === 0;
  }
  /// Returns `true` if `self` fully encloses `other`.
  // rustc: compiler/rustc_span/src/lib.rs:728 contains
  contains(other: SpanData): boolean {
    return this.lo <= other.lo && other.hi <= this.hi;
  }

  // rustc: compiler/rustc_span/src/lib.rs:734 default
  static default(): SpanData {
    return new SpanData(BytePos(0), BytePos(0), SyntaxContext_root(), undefined);
  }
}

/** `#[derive(PartialEq)]` */
export const SpanData_eq = span_data_eq;

declare module "./span_encoding.ts" {
  namespace Span {
    export let lo: (self: Span) => BytePos;
    export let with_lo: (self: Span, lo: BytePos) => Span;
    export let hi: (self: Span) => BytePos;
    export let with_hi: (self: Span, hi: BytePos) => Span;
    export let with_ctxt: (self: Span, ctxt: SyntaxContext) => Span;
    export let lo_hi: (self: Span) => [BytePos, BytePos];
    export let is_visible: (self: Span, sm: SourceMap) => boolean;
    export let in_external_macro: (self: Span, sm: SourceMap) => boolean;
    export let in_derive_expansion: (self: Span) => boolean;
    export let is_from_async_await: (self: Span) => boolean;
    export let can_be_used_for_suggestions: (self: Span) => boolean;
    export let with_root_ctxt: (lo: BytePos, hi: BytePos) => Span;
    export let shrink_to_lo: (self: Span) => Span;
    export let shrink_to_hi: (self: Span) => Span;
    export let is_empty: (self: Span) => boolean;
    export let substitute_dummy: (self: Span, other: Span) => Span;
    export let contains: (self: Span, other: Span) => boolean;
    export let overlaps: (self: Span, other: Span) => boolean;
    export let overlaps_or_adjacent: (self: Span, other: Span) => boolean;
    export let trim_start: (self: Span, other: Span) => Span | undefined;
    export let trim_end: (self: Span, other: Span) => Span | undefined;
    export let source_callsite: (self: Span) => Span;
    export let parent_callsite: (self: Span) => Span | undefined;
    export let find_ancestor_inside: (self: Span, outer: Span) => Span | undefined;
    export let find_ancestor_in_same_ctxt: (self: Span, other: Span) => Span | undefined;
    export let find_ancestor_inside_same_ctxt: (self: Span, outer: Span) => Span | undefined;
    export let find_ancestor_not_from_extern_macro: (self: Span, sm: SourceMap) => Span | undefined;
    export let find_ancestor_not_from_macro: (self: Span) => Span | undefined;
    export let edition: (self: Span) => Edition;
    export let is_rust_2015: (self: Span) => boolean;
    export let at_least_rust_2018: (self: Span) => boolean;
    export let at_least_rust_2021: (self: Span) => boolean;
    export let at_least_rust_2024: (self: Span) => boolean;
    export let source_callee: (self: Span) => ExpnData | undefined;
    export let allows_unstable: (self: Span, feature: Symbol) => boolean;
    export let is_desugaring: (self: Span, kind: DesugaringKind) => boolean;
    export let desugaring_kind: (self: Span) => DesugaringKind | undefined;
    export let allows_unsafe: (self: Span) => boolean;
    export let macro_backtrace: (self: Span) => Generator<ExpnData, void, undefined>;
    export let split_at: (self: Span, pos: number) => [Span, Span];
    export let with_neighbor: (self: Span, neighbor: Span) => Span;
    export let to: (self: Span, end: Span) => Span;
    export let between: (self: Span, end: Span) => Span;
    export let until: (self: Span, end: Span) => Span;
    export let within_macro: (self: Span, within: Span, sm: SourceMap) => Span | undefined;
    export let from_inner: (self: Span, inner: InnerSpan) => Span;
    export let with_def_site_ctxt: (self: Span, expn_id: ExpnId) => Span;
    export let with_call_site_ctxt: (self: Span, expn_id: ExpnId) => Span;
    export let with_mixed_site_ctxt: (self: Span, expn_id: ExpnId) => Span;
    export let apply_mark: (self: Span, expn_id: ExpnId, transparency: Transparency) => Span;
    /** PORT: `&mut self` methods return `[updated span, result]`. */
    export let remove_mark: (self: Span) => [Span, ExpnId];
    export let adjust: (self: Span, expn_id: ExpnId) => [Span, ExpnId | undefined];
    export let normalize_to_macros_2_0_and_adjust: (self: Span, expn_id: ExpnId) => [Span, ExpnId | undefined];
    export let normalize_to_macros_2_0: (self: Span) => Span;
    export let normalize_to_macro_rules: (self: Span) => Span;
    let default_: () => Span;
    export { default_ as default };
  }
}

// rustc: compiler/rustc_span/src/lib.rs:741 lo
Span.lo = function (self: Span): BytePos {
  return Span.data(self).lo;
};
// rustc: compiler/rustc_span/src/lib.rs:745 with_lo
Span.with_lo = function (self: Span, lo: BytePos): Span {
  return Span.data(self).with_lo(lo);
};
// rustc: compiler/rustc_span/src/lib.rs:749 hi
Span.hi = function (self: Span): BytePos {
  return Span.data(self).hi;
};
// rustc: compiler/rustc_span/src/lib.rs:753 with_hi
Span.with_hi = function (self: Span, hi: BytePos): Span {
  return Span.data(self).with_hi(hi);
};
// rustc: compiler/rustc_span/src/lib.rs:757 with_ctxt
Span.with_ctxt = function (self: Span, ctxt: SyntaxContext): Span {
  return Span.map_ctxt(self, (_) => ctxt);
};

/// When to use this:
/// - Use it instead of `==` for span equality comparisons when either span could be generated
///   code and you only care that they point to the same bytes of source text.
/// - Use it (possibly via `OrdSpan`) for span ordering comparisons of any kind.
// rustc: compiler/rustc_span/src/lib.rs:766 lo_hi
Span.lo_hi = function (self: Span): [BytePos, BytePos] {
  const data = Span.data(self);
  return [data.lo, data.hi];
};

// rustc: compiler/rustc_span/src/lib.rs:772 is_visible
Span.is_visible = function (self: Span, _sm: SourceMap): boolean {
  return !Span.is_dummy(self) && unported("rustc_span::source_map::SourceMap::is_span_accessible");
};

/// Returns whether this span originates in a foreign crate's external macro.
///
/// This is used to test whether a lint should not even begin to figure out whether it should
/// be reported on the current node.
// rustc: compiler/rustc_span/src/lib.rs:781 in_external_macro
Span.in_external_macro = function (self: Span, sm: SourceMap): boolean {
  return SyntaxContext_in_external_macro(Span.ctxt(self), sm);
};

/// Returns `true` if `span` originates in a derive-macro's expansion.
// rustc: compiler/rustc_span/src/lib.rs:786 in_derive_expansion
Span.in_derive_expansion = function (self: Span): boolean {
  const kind = SyntaxContext_outer_expn_data(Span.ctxt(self)).kind;
  return kind.$ === "Macro" && kind._0 === "Derive";
};

/// Return whether `span` is generated by `async` or `await`.
// rustc: compiler/rustc_span/src/lib.rs:791 is_from_async_await
Span.is_from_async_await = function (self: Span): boolean {
  const kind = SyntaxContext_outer_expn_data(Span.ctxt(self)).kind;
  return kind.$ === "Desugaring" && (kind._0 === "Async" || kind._0 === "Await");
};

/// Gate suggestions that would not be appropriate in a context the user didn't write.
// rustc: compiler/rustc_span/src/lib.rs:799 can_be_used_for_suggestions
Span.can_be_used_for_suggestions = function (self: Span): boolean {
  if (!Span.from_expansion(self)) return true;
  // FIXME: If this span comes from a `derive` macro but it points at code the user wrote,
  // the callsite span and the span will be pointing at different places. It also means that
  // we can safely provide suggestions on this span.
  if (!Span.in_derive_expansion(self)) return false;
  const p = Span.parent_callsite(self);
  return p === undefined || Span.lo(p) !== Span.lo(self) || Span.hi(p) !== Span.hi(self);
};

// rustc: compiler/rustc_span/src/lib.rs:809 with_root_ctxt
Span.with_root_ctxt = function (lo: BytePos, hi: BytePos): Span {
  return Span.new(lo, hi, SyntaxContext_root(), undefined);
};

/// Returns a new span representing an empty span at the beginning of this span.
// rustc: compiler/rustc_span/src/lib.rs:815 shrink_to_lo
Span.shrink_to_lo = function (self: Span): Span {
  const span = Span.data_untracked(self);
  return span.with_hi(span.lo);
};
/// Returns a new span representing an empty span at the end of this span.
// rustc: compiler/rustc_span/src/lib.rs:821 shrink_to_hi
Span.shrink_to_hi = function (self: Span): Span {
  const span = Span.data_untracked(self);
  return span.with_lo(span.hi);
};

/// Returns `true` if `hi == lo`.
// rustc: compiler/rustc_span/src/lib.rs:828 is_empty
Span.is_empty = function (self: Span): boolean {
  const span = Span.data_untracked(self);
  return span.hi === span.lo;
};

/// Returns `self` if `self` is not the dummy span, and `other` otherwise.
// rustc: compiler/rustc_span/src/lib.rs:834 substitute_dummy
Span.substitute_dummy = function (self: Span, other: Span): Span {
  return Span.is_dummy(self) ? other : self;
};

/// Returns `true` if `self` fully encloses `other`.
// rustc: compiler/rustc_span/src/lib.rs:839 contains
Span.contains = function (self: Span, other: Span): boolean {
  const span = Span.data(self);
  const other_ = Span.data(other);
  return span.contains(other_);
};

/// Returns `true` if `self` touches `other`.
// rustc: compiler/rustc_span/src/lib.rs:846 overlaps
Span.overlaps = function (self: Span, other: Span): boolean {
  const span = Span.data(self);
  const other_ = Span.data(other);
  return span.lo < other_.hi && other_.lo < span.hi;
};

/// Returns `true` if `self` touches or adjoins `other`.
// rustc: compiler/rustc_span/src/lib.rs:853 overlaps_or_adjacent
Span.overlaps_or_adjacent = function (self: Span, other: Span): boolean {
  const span = Span.data(self);
  const other_ = Span.data(other);
  return span.lo <= other_.hi && other_.lo <= span.hi;
};

/// Returns `Some(span)`, where the start is trimmed by the end of `other`.
// rustc: compiler/rustc_span/src/lib.rs:860 trim_start
Span.trim_start = function (self: Span, other: Span): Span | undefined {
  const span = Span.data(self);
  const other_ = Span.data(other);
  return span.hi > other_.hi ? span.with_lo(BytePos.max(span.lo, other_.hi)) : undefined;
};

/// Returns `Some(span)`, where the end is trimmed by the start of `other`.
// rustc: compiler/rustc_span/src/lib.rs:867 trim_end
Span.trim_end = function (self: Span, other: Span): Span | undefined {
  const span = Span.data(self);
  const other_ = Span.data(other);
  return span.lo < other_.lo ? span.with_hi(BytePos.min(span.hi, other_.lo)) : undefined;
};

/// Returns the source span -- this is either the supplied span, or the span for
/// the macro callsite that expanded to it.
// rustc: compiler/rustc_span/src/lib.rs:875 source_callsite
Span.source_callsite = function (self: Span): Span {
  const ctxt = Span.ctxt(self);
  return !SyntaxContext_is_root(ctxt) ? Span.source_callsite(SyntaxContext_outer_expn_data(ctxt).call_site) : self;
};

/// Returns the call-site span of the last macro expansion which produced this `Span`.
/// (see [`ExpnData::call_site`]). Returns `None` if this is not an expansion.
// rustc: compiler/rustc_span/src/lib.rs:882 parent_callsite
Span.parent_callsite = function (self: Span): Span | undefined {
  const ctxt = Span.ctxt(self);
  return !SyntaxContext_is_root(ctxt) ? SyntaxContext_outer_expn_data(ctxt).call_site : undefined;
};

/// Find the first ancestor span that's contained within `outer`.
///
/// This method traverses the macro expansion ancestors until it finds the first span
/// that's contained within `outer`.
///
/// The span returned by this method may have a different [`SyntaxContext`] than `outer`.
/// If you need to extend the span, use [`find_ancestor_inside_same_ctxt`] instead,
/// because joining spans with different syntax contexts can create unexpected results.
///
/// This is used to find the span of the macro call when a parent expr span, i.e. `outer`, is known.
///
/// [`find_ancestor_inside_same_ctxt`]: Self::find_ancestor_inside_same_ctxt
// rustc: compiler/rustc_span/src/lib.rs:899 find_ancestor_inside
Span.find_ancestor_inside = function (self: Span, outer: Span): Span | undefined {
  while (!Span.contains(outer, self)) {
    const p = Span.parent_callsite(self);
    if (p === undefined) return undefined;
    self = p;
  }
  return self;
};

/// Find the first ancestor span with the same [`SyntaxContext`] as `other`.
///
/// This method traverses the macro expansion ancestors until it finds a span
/// that has the same [`SyntaxContext`] as `other`.
///
/// Like [`find_ancestor_inside_same_ctxt`], but specifically for when spans might not
/// overlap. Take care when using this, and prefer [`find_ancestor_inside`] or
/// [`find_ancestor_inside_same_ctxt`] when you know that the spans are nested (modulo
/// macro expansion).
///
/// [`find_ancestor_inside`]: Self::find_ancestor_inside
/// [`find_ancestor_inside_same_ctxt`]: Self::find_ancestor_inside_same_ctxt
// rustc: compiler/rustc_span/src/lib.rs:918 find_ancestor_in_same_ctxt
Span.find_ancestor_in_same_ctxt = function (self: Span, other: Span): Span | undefined {
  while (!Span.eq_ctxt(self, other)) {
    const p = Span.parent_callsite(self);
    if (p === undefined) return undefined;
    self = p;
  }
  return self;
};

/// Find the first ancestor span that's contained within `outer` and
/// has the same [`SyntaxContext`] as `outer`.
///
/// This method traverses the macro expansion ancestors until it finds a span
/// that is both contained within `outer` and has the same [`SyntaxContext`] as `outer`.
///
/// This method is the combination of [`find_ancestor_inside`] and
/// [`find_ancestor_in_same_ctxt`] and should be preferred when extending the returned span.
/// If you do not need to modify the span, use [`find_ancestor_inside`] instead.
///
/// [`find_ancestor_inside`]: Self::find_ancestor_inside
/// [`find_ancestor_in_same_ctxt`]: Self::find_ancestor_in_same_ctxt
// rustc: compiler/rustc_span/src/lib.rs:937 find_ancestor_inside_same_ctxt
Span.find_ancestor_inside_same_ctxt = function (self: Span, outer: Span): Span | undefined {
  while (!Span.contains(outer, self) || !Span.eq_ctxt(self, outer)) {
    const p = Span.parent_callsite(self);
    if (p === undefined) return undefined;
    self = p;
  }
  return self;
};

/// Find the first ancestor span that does not come from an external macro.
///
/// This method traverses the macro expansion ancestors until it finds a span
/// that is either from user-written code or from a local macro (defined in the current crate).
///
/// External macros are those defined in dependencies or the standard library.
/// This method is useful for reporting errors in user-controllable code and avoiding
/// diagnostics inside external macros.
///
/// # See also
///
/// - [`Self::find_ancestor_not_from_macro`]
/// - [`Self::in_external_macro`]
// rustc: compiler/rustc_span/src/lib.rs:957 find_ancestor_not_from_extern_macro
Span.find_ancestor_not_from_extern_macro = function (self: Span, sm: SourceMap): Span | undefined {
  while (Span.in_external_macro(self, sm)) {
    const p = Span.parent_callsite(self);
    if (p === undefined) return undefined;
    self = p;
  }
  return self;
};

/// Find the first ancestor span that does not come from any macro expansion.
///
/// This method traverses the macro expansion ancestors until it finds a span
/// that originates from user-written code rather than any macro-generated code.
///
/// This method is useful for reporting errors at the exact location users wrote code
/// and providing suggestions at directly editable locations.
///
/// # See also
///
/// - [`Self::find_ancestor_not_from_extern_macro`]
/// - [`Span::from_expansion`]
// rustc: compiler/rustc_span/src/lib.rs:976 find_ancestor_not_from_macro
Span.find_ancestor_not_from_macro = function (self: Span): Span | undefined {
  while (Span.from_expansion(self)) {
    const p = Span.parent_callsite(self);
    if (p === undefined) return undefined;
    self = p;
  }
  return self;
};

/// Edition of the crate from which this span came.
// rustc: compiler/rustc_span/src/lib.rs:984 edition
Span.edition = function (self: Span): Edition {
  return SyntaxContext_edition(Span.ctxt(self));
};

/// Is this edition 2015?
// rustc: compiler/rustc_span/src/lib.rs:990 is_rust_2015
Span.is_rust_2015 = function (self: Span): boolean {
  return Edition.is_rust_2015(Span.edition(self));
};

/// Are we allowed to use features from the Rust 2018 edition?
// rustc: compiler/rustc_span/src/lib.rs:996 at_least_rust_2018
Span.at_least_rust_2018 = function (self: Span): boolean {
  return Edition.at_least_rust_2018(Span.edition(self));
};

/// Are we allowed to use features from the Rust 2021 edition?
// rustc: compiler/rustc_span/src/lib.rs:1002 at_least_rust_2021
Span.at_least_rust_2021 = function (self: Span): boolean {
  return Edition.at_least_rust_2021(Span.edition(self));
};

/// Are we allowed to use features from the Rust 2024 edition?
// rustc: compiler/rustc_span/src/lib.rs:1008 at_least_rust_2024
Span.at_least_rust_2024 = function (self: Span): boolean {
  return Edition.at_least_rust_2024(Span.edition(self));
};

/// Returns the source callee.
///
/// Returns `None` if the supplied span has no expansion trace,
/// else returns the `ExpnData` for the macro definition
/// corresponding to the source callsite.
// rustc: compiler/rustc_span/src/lib.rs:1017 source_callee
Span.source_callee = function (self: Span): ExpnData | undefined {
  let ctxt = Span.ctxt(self);
  let opt_expn_data: ExpnData | undefined = undefined;
  while (!SyntaxContext_is_root(ctxt)) {
    const expn_data = SyntaxContext_outer_expn_data(ctxt);
    ctxt = Span.ctxt(expn_data.call_site);
    opt_expn_data = expn_data;
  }
  return opt_expn_data;
};

/// Checks if a span is "internal" to a macro in which `#[unstable]`
/// items can be used (that is, a macro marked with
/// `#[allow_internal_unstable]`).
// rustc: compiler/rustc_span/src/lib.rs:1031 allows_unstable
Span.allows_unstable = function (self: Span, feature: Symbol): boolean {
  const features = SyntaxContext_outer_expn_data(Span.ctxt(self)).allow_internal_unstable;
  return features !== undefined && features.includes(feature);
};

/// Checks if this span arises from a compiler desugaring of kind `kind`.
// rustc: compiler/rustc_span/src/lib.rs:1039 is_desugaring
Span.is_desugaring = function (self: Span, kind: DesugaringKind): boolean {
  const k = SyntaxContext_outer_expn_data(Span.ctxt(self)).kind;
  return k.$ === "Desugaring" ? k._0 === kind : false;
};

/// Returns the compiler desugaring that created this span, or `None`
/// if this span is not from a desugaring.
// rustc: compiler/rustc_span/src/lib.rs:1048 desugaring_kind
Span.desugaring_kind = function (self: Span): DesugaringKind | undefined {
  const k = SyntaxContext_outer_expn_data(Span.ctxt(self)).kind;
  return k.$ === "Desugaring" ? k._0 : undefined;
};

/// Checks if a span is "internal" to a macro in which `unsafe`
/// can be used without triggering the `unsafe_code` lint.
/// (that is, a macro marked with `#[allow_internal_unsafe]`).
// rustc: compiler/rustc_span/src/lib.rs:1058 allows_unsafe
Span.allows_unsafe = function (self: Span): boolean {
  return SyntaxContext_outer_expn_data(Span.ctxt(self)).allow_internal_unsafe;
};

// rustc: compiler/rustc_span/src/lib.rs:1062 macro_backtrace
Span.macro_backtrace = function* (self: Span): Generator<ExpnData, void, undefined> {
  let prev_span = DUMMY_SP;
  for (;;) {
    const ctxt = Span.ctxt(self);
    if (SyntaxContext_is_root(ctxt)) {
      return;
    }

    const expn_data = SyntaxContext_outer_expn_data(ctxt);
    const [a_lo, a_hi] = Span.lo_hi(expn_data.call_site);
    const [b_lo, b_hi] = Span.lo_hi(prev_span);
    const is_recursive = a_lo === b_lo && a_hi === b_hi;

    prev_span = self;
    self = expn_data.call_site;

    // Don't print recursive invocations.
    if (!is_recursive) {
      yield expn_data;
    }
  }
};

/// Splits a span into two composite spans around a certain position.
// rustc: compiler/rustc_span/src/lib.rs:1086 split_at
Span.split_at = function (self: Span, pos: number): [Span, Span] {
  const len = Span.hi(self) - Span.lo(self);
  // debug_assert!(pos <= len);
  void len;

  const split_pos = BytePos(Span.lo(self) + pos);
  return [
    Span.new(Span.lo(self), split_pos, Span.ctxt(self), Span.parent(self)),
    Span.new(split_pos, Span.hi(self), Span.ctxt(self), Span.parent(self)),
  ];
};

/// Check if you can select metavar spans for the given spans to get matching contexts.
// rustc: compiler/rustc_span/src/lib.rs:1098 try_metavars
function Span_try_metavars(a: SpanData, b: SpanData, a_orig: Span, b_orig: Span): [SpanData, SpanData] {
  const [m_a, m_b] = with_metavar_spans((mspans) => [mspans.get(a_orig), mspans.get(b_orig)] as const);
  if (m_a === undefined && m_b === undefined) {
    // (None, None) => {}
  } else if (m_a !== undefined && m_b === undefined) {
    const meta_a = Span.data(m_a);
    if (meta_a.ctxt === b.ctxt) {
      return [meta_a, b];
    }
  } else if (m_a === undefined && m_b !== undefined) {
    const meta_b = Span.data(m_b);
    if (a.ctxt === meta_b.ctxt) {
      return [a, meta_b];
    }
  } else {
    const meta_b = Span.data(m_b!);
    if (a.ctxt === meta_b.ctxt) {
      return [a, meta_b];
    }
    const meta_a = Span.data(m_a!);
    if (meta_a.ctxt === b.ctxt) {
      return [meta_a, b];
    } else if (meta_a.ctxt === meta_b.ctxt) {
      return [meta_a, meta_b];
    }
  }

  return [a, b];
}

/// Prepare two spans to a combine operation like `to` or `between`.
// rustc: compiler/rustc_span/src/lib.rs:1131 prepare_to_combine
function Span_prepare_to_combine(a_orig: Span, b_orig: Span): Result<[SpanData, SpanData, LocalDefId | undefined], Span> {
  let a = Span.data(a_orig);
  let b = Span.data(b_orig);
  if (a.ctxt === b.ctxt) {
    return Ok([a, b, local_def_id_opt_eq(a.parent, b.parent) ? a.parent : undefined]);
  }

  [a, b] = Span_try_metavars(a, b, a_orig, b_orig);
  if (a.ctxt === b.ctxt) {
    return Ok([a, b, local_def_id_opt_eq(a.parent, b.parent) ? a.parent : undefined]);
  }

  // Context mismatches usually happen when procedural macros combine spans copied from
  // the macro input with spans produced by the macro (`Span::*_site`).
  // In that case we consider the combined span to be produced by the macro and return
  // the original macro-produced span as the result.
  // Otherwise we just fall back to returning the first span.
  // Combining locations typically doesn't make sense in case of context mismatches.
  // `is_root` here is a fast path optimization.
  const a_is_callsite = SyntaxContext_is_root(a.ctxt) || a.ctxt === Span.ctxt(Span.source_callsite(b.span()));
  return Err(a_is_callsite ? b_orig : a_orig);
}

/// This span, but in a larger context, may switch to the metavariable span if suitable.
// rustc: compiler/rustc_span/src/lib.rs:1157 with_neighbor
Span.with_neighbor = function (self: Span, neighbor: Span): Span {
  const r = Span_prepare_to_combine(self, neighbor);
  return r.$ === "Ok" ? r._0[0].span() : self;
};

/// Returns a `Span` that would enclose both `self` and `end`.
///
/// Note that this can also be used to extend the span "backwards":
/// `start.to(end)` and `end.to(start)` return the same `Span`.
///
/// ```text
///     ____             ___
///     self lorem ipsum end
///     ^^^^^^^^^^^^^^^^^^^^
/// ```
// rustc: compiler/rustc_span/src/lib.rs:1174 to
Span.to = function (self: Span, end: Span): Span {
  const r = Span_prepare_to_combine(self, end);
  if (r.$ === "Ok") {
    const [from, to, parent] = r._0;
    return Span.new(BytePos.min(from.lo, to.lo), BytePos.max(from.hi, to.hi), from.ctxt, parent);
  }
  return r._0;
};

/// Returns a `Span` between the end of `self` to the beginning of `end`.
///
/// ```text
///     ____             ___
///     self lorem ipsum end
///         ^^^^^^^^^^^^^
/// ```
// rustc: compiler/rustc_span/src/lib.rs:1190 between
Span.between = function (self: Span, end: Span): Span {
  const r = Span_prepare_to_combine(self, end);
  if (r.$ === "Ok") {
    const [from, to, parent] = r._0;
    return Span.new(BytePos.min(from.hi, to.hi), BytePos.max(from.lo, to.lo), from.ctxt, parent);
  }
  return r._0;
};

/// Returns a `Span` from the beginning of `self` until the beginning of `end`.
///
/// ```text
///     ____             ___
///     self lorem ipsum end
///     ^^^^^^^^^^^^^^^^^
/// ```
// rustc: compiler/rustc_span/src/lib.rs:1206 until
Span.until = function (self: Span, end: Span): Span {
  const r = Span_prepare_to_combine(self, end);
  if (r.$ === "Ok") {
    const [from, to, parent] = r._0;
    return Span.new(BytePos.min(from.lo, to.lo), BytePos.max(from.lo, to.lo), from.ctxt, parent);
  }
  return r._0;
};

/// Returns the `Span` within the syntax context of "within". This is useful when
/// "self" is an expansion from a macro variable, since this can be used for
/// providing extra macro expansion context for certain errors.
///
/// ```text
/// macro_rules! m {
///     ($ident:ident) => { ($ident,) }
/// }
///
/// m!(outer_ident);
/// ```
///
/// If "self" is the span of the outer_ident, and "within" is the span of the `($ident,)`
/// expr, then this will return the span of the `$ident` macro variable.
// rustc: compiler/rustc_span/src/lib.rs:1229 within_macro
Span.within_macro = function (self: Span, within: Span, _sm: SourceMap): Span | undefined {
  const r = Span_prepare_to_combine(self, within);
  if (r.$ === "Err") return undefined;
  const [self_, , parent] = r._0;

  // Only return something if it doesn't overlap with the original span
  // and the span isn't "imported" (i.e. from unavailable sources).
  // FIXME: This does limit the usefulness of the error when the macro is
  // from a foreign crate; we could also take into account `-Zmacro-backtrace`,
  // which doesn't redact this span (but that would mean passing in even more
  // args to this function, lol).
  if (Span.data(self).contains(self_) || unported("rustc_span::source_map::SourceMap::is_imported")) {
    return undefined;
  }

  // Don't return something if it's marked with `#[diagnostic::opaque]`.
  // This already accounts for `-Zmacro-backtrace`.
  if (SyntaxContext_outer_expn_data(Span.data(within).ctxt).diagnostic_opaque) {
    return undefined;
  }

  return Span.new(self_.lo, self_.hi, self_.ctxt, parent);
};

// rustc: compiler/rustc_span/src/lib.rs:1251 from_inner
Span.from_inner = function (self: Span, inner: InnerSpan): Span {
  const span = Span.data(self);
  return Span.new(
    BytePos.add(span.lo, BytePos.from_usize(inner.start)),
    BytePos.add(span.lo, BytePos.from_usize(inner.end)),
    span.ctxt,
    span.parent,
  );
};

/// Equivalent of `Span::def_site` from the proc macro API,
/// except that the location is taken from the `self` span.
// rustc: compiler/rustc_span/src/lib.rs:1263 with_def_site_ctxt
Span.with_def_site_ctxt = function (self: Span, expn_id: ExpnId): Span {
  return Span_with_ctxt_from_mark(self, expn_id, "Opaque");
};

/// Equivalent of `Span::call_site` from the proc macro API,
/// except that the location is taken from the `self` span.
// rustc: compiler/rustc_span/src/lib.rs:1269 with_call_site_ctxt
Span.with_call_site_ctxt = function (self: Span, expn_id: ExpnId): Span {
  return Span_with_ctxt_from_mark(self, expn_id, "Transparent");
};

/// Equivalent of `Span::mixed_site` from the proc macro API,
/// except that the location is taken from the `self` span.
// rustc: compiler/rustc_span/src/lib.rs:1275 with_mixed_site_ctxt
Span.with_mixed_site_ctxt = function (self: Span, expn_id: ExpnId): Span {
  return Span_with_ctxt_from_mark(self, expn_id, "SemiOpaque");
};

/// Produces a span with the same location as `self` and context produced by a macro with the
/// given ID and transparency, assuming that macro was defined directly and not produced by
/// some other macro (which is the case for built-in and procedural macros).
// rustc: compiler/rustc_span/src/lib.rs:1282 with_ctxt_from_mark
function Span_with_ctxt_from_mark(self: Span, expn_id: ExpnId, transparency: Transparency): Span {
  return Span.with_ctxt(self, SyntaxContext_apply_mark(SyntaxContext_root(), expn_id, transparency));
}

// rustc: compiler/rustc_span/src/lib.rs:1287 apply_mark
Span.apply_mark = function (self: Span, expn_id: ExpnId, transparency: Transparency): Span {
  return Span.map_ctxt(self, (ctxt) => SyntaxContext_apply_mark(ctxt, expn_id, transparency));
};

// rustc: compiler/rustc_span/src/lib.rs:1292 remove_mark
Span.remove_mark = function (self: Span): [Span, ExpnId] {
  let mark = ExpnId_root();
  self = Span.map_ctxt(self, (ctxt) => {
    [ctxt, mark] = SyntaxContext_remove_mark(ctxt);
    return ctxt;
  });
  return [self, mark];
};

// rustc: compiler/rustc_span/src/lib.rs:1302 adjust
Span.adjust = function (self: Span, expn_id: ExpnId): [Span, ExpnId | undefined] {
  let mark: ExpnId | undefined = undefined;
  self = Span.map_ctxt(self, (ctxt) => {
    [ctxt, mark] = SyntaxContext_adjust(ctxt, expn_id);
    return ctxt;
  });
  return [self, mark];
};

// rustc: compiler/rustc_span/src/lib.rs:1312 normalize_to_macros_2_0_and_adjust
Span.normalize_to_macros_2_0_and_adjust = function (self: Span, expn_id: ExpnId): [Span, ExpnId | undefined] {
  let mark: ExpnId | undefined = undefined;
  self = Span.map_ctxt(self, (ctxt) => {
    [ctxt, mark] = SyntaxContext_normalize_to_macros_2_0_and_adjust(ctxt, expn_id);
    return ctxt;
  });
  return [self, mark];
};

// rustc: compiler/rustc_span/src/lib.rs:1322 normalize_to_macros_2_0
Span.normalize_to_macros_2_0 = function (self: Span): Span {
  return Span.map_ctxt(self, (ctxt) => SyntaxContext_normalize_to_macros_2_0(ctxt));
};

// rustc: compiler/rustc_span/src/lib.rs:1327 normalize_to_macro_rules
Span.normalize_to_macro_rules = function (self: Span): Span {
  return Span.map_ctxt(self, (ctxt) => SyntaxContext_normalize_to_macro_rules(ctxt));
};

// rustc: compiler/rustc_span/src/lib.rs:1333 default
(Span as unknown as { default: typeof Span.default }).default = function (): Span {
  return DUMMY_SP;
};

// PORT: `rustc_index::newtype_index! { #[orderable] #[debug_format = "AttrId({})"] pub struct AttrId {} }`
// is generated by tools/codegen (PORTING §5 "Macros inside rustc"); only the handle type is declared.
export type AttrId = number & { readonly __brand: "AttrId" };

// The `SpanEncoder`/`SpanDecoder`/`BlobDecoder` traits and their impls, and the `Encodable`/
// `Decodable` impls built on them, only serve metadata/incremental (out of scope until M5).
// rustc-skip: compiler/rustc_span/src/lib.rs:1347 encode_span SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1348 encode_symbol SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1349 encode_byte_symbol SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1350 encode_expn_id SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1351 encode_syntax_context SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1354 encode_crate_num SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1355 encode_def_index SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1356 encode_def_id SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1358 encode_local_def_id SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1364 encode_def_key SpanEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1374 encode_span SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1380 encode_symbol SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1384 encode_byte_symbol SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1388 encode_expn_id SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1392 encode_syntax_context SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1396 encode_crate_num SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1400 encode_def_index SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1404 encode_def_id SpanEncoder for FileEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1411 encode_span SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1417 encode_symbol SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1421 encode_byte_symbol SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1425 encode_expn_id SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1429 encode_syntax_context SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1433 encode_crate_num SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1437 encode_def_index SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1441 encode_def_id SpanEncoder for MemEncoder (metadata encoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1448 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1454 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1460 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1466 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1472 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1478 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1484 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1490 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1496 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1502 decode_symbol BlobDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1503 decode_byte_symbol BlobDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1504 decode_def_index BlobDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1510 decode_local_def_id BlobDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1530 decode_span SpanDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1531 decode_expn_id SpanDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1532 decode_syntax_context SpanDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1533 decode_crate_num SpanDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1534 decode_def_id SpanDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1535 decode_attr_id SpanDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1539 decode_symbol BlobDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1543 decode_byte_symbol BlobDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1547 decode_def_index BlobDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1551 decode_local_def_id BlobDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1557 decode_span SpanDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1564 decode_expn_id SpanDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1568 decode_syntax_context SpanDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1572 decode_crate_num SpanDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1576 decode_def_id SpanDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1580 decode_attr_id SpanDecoder for MemDecoder (metadata decoding)
// rustc-skip: compiler/rustc_span/src/lib.rs:1586 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1592 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1598 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1604 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1610 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1616 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1622 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1628 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:1634 decode Decodable impl

// rustc: compiler/rustc_span/src/lib.rs:1640 fmt
/** `impl fmt::Debug for Span` */
export function debug_Span(self: Span, f: Fmt): string {
  // Use the global `SourceMap` to print the span. If that's not
  // available, fall back to printing the raw values.

  // rustc: compiler/rustc_span/src/lib.rs:1644 fallback
  function fallback(span: Span, f: Fmt): string {
    return debug_struct(f, "Span", [
      ["lo", debug_BytePos(Span.lo(span), f)],
      ["hi", debug_BytePos(Span.hi(span), f)],
      ["ctxt", debug_SyntaxContext(Span.ctxt(span))],
    ]);
  }

  if (SESSION_GLOBALS.is_set()) {
    return with_session_globals((session_globals) => {
      if (session_globals.source_map !== undefined) {
        return unported("rustc_span::source_map::SourceMap::span_to_diagnostic_string");
      } else {
        return fallback(self, f);
      }
    });
  } else {
    return fallback(self, f);
  }
}

// rustc: compiler/rustc_span/src/lib.rs:1667 fmt
/** `impl fmt::Debug for SpanData` */
export function debug_SpanData(self: SpanData, f: Fmt): string {
  return debug_Span(self.span(), f);
}

/// Identifies an offset of a multi-byte character in a `SourceFile`.
export interface MultiByteChar {
  /// The relative offset of the character in the `SourceFile`.
  readonly pos: RelativeBytePos;
  /// The number of bytes, `>= 2`.
  readonly bytes: number;
}

export const debug_MultiByteChar: Debug<MultiByteChar> = (v, f) =>
  debug_struct(f, "MultiByteChar", [
    ["pos", debug_RelativeBytePos(v.pos, f)],
    ["bytes", debug_int(v.bytes, f)],
  ]);

/// Identifies an offset of a character that was normalized away from `SourceFile`.
export interface NormalizedPos {
  /// The relative offset of the character in the `SourceFile`.
  readonly pos: RelativeBytePos;
  /// The difference between original and normalized string at position.
  readonly diff: number;
}

export const debug_NormalizedPos: Debug<NormalizedPos> = (v, f) =>
  debug_struct(f, "NormalizedPos", [
    ["pos", debug_RelativeBytePos(v.pos, f)],
    ["diff", debug_int(v.diff, f)],
  ]);

export type ExternalSource =
  /// No external source has to be loaded, since the `SourceFile` represents a local crate.
  | { readonly $: "Unneeded" }
  | {
      readonly $: "Foreign";
      kind: ExternalSourceKind;
      /// Index of the file inside metadata.
      readonly metadata_index: number;
    };
export const ExternalSource = {
  Unneeded: { $: "Unneeded" } as ExternalSource,

  // rustc: compiler/rustc_span/src/lib.rs:1713 get_source
  get_source(self: ExternalSource): Str | undefined {
    if (self.$ === "Foreign" && self.kind.$ === "Present") return self.kind._0;
    return undefined;
  },
};

/// The state of the lazy external source loading mechanism of a `SourceFile`.
export type ExternalSourceKind =
  /// The external source has been loaded already.
  | { readonly $: "Present"; readonly _0: Str }
  /// No attempt has been made to load the external source.
  | { readonly $: "AbsentOk" }
  /// A failed attempt has been made to load the external source.
  | { readonly $: "AbsentErr" };

export const debug_ExternalSourceKind: Debug<ExternalSourceKind> = (v, f) =>
  v.$ === "Present" ? debug_tuple(f, "Present", [debug_str(v._0.toString())]) : v.$;

export const debug_ExternalSource: Debug<ExternalSource> = (v, f) =>
  v.$ === "Unneeded"
    ? "Unneeded"
    : debug_struct(f, "Foreign", [
        ["kind", debug_ExternalSourceKind(v.kind, f)],
        ["metadata_index", debug_int(v.metadata_index, f)],
      ]);

export class OffsetOverflowError {}
export const debug_OffsetOverflowError = (_v: OffsetOverflowError): string => "OffsetOverflowError";

export type SourceFileHashAlgorithm = "Md5" | "Sha1" | "Sha256" | "Blake3";
export const SourceFileHashAlgorithm = {
  Md5: "Md5",
  Sha1: "Sha1",
  Sha256: "Sha256",
  Blake3: "Blake3",

  // rustc: compiler/rustc_span/src/lib.rs:1747 from_str
  from_str(s: string): Result<SourceFileHashAlgorithm, undefined> {
    switch (s) {
      case "md5":
        return Ok("Md5");
      case "sha1":
        return Ok("Sha1");
      case "sha256":
        return Ok("Sha256");
      case "blake3":
        return Ok("Blake3");
      default:
        return Err(undefined);
    }
  },
} as const;

// rustc: compiler/rustc_span/src/lib.rs:1734 fmt
/** `impl Display for SourceFileHashAlgorithm` */
export function display_SourceFileHashAlgorithm(self: SourceFileHashAlgorithm): string {
  switch (self) {
    case "Md5":
      return "md5";
    case "Sha1":
      return "sha1";
    case "Sha256":
      return "sha256";
    case "Blake3":
      return "blake3";
  }
}

/** PORT: io::Read source for `SourceFileHash::new`; `io::Error` is opaque. */
export interface Read {
  read(buf: Uint8Array): Result<number, unknown>;
}

/** PORT: Md5/Sha1/Sha256 digests via Bun's `CryptoHasher` (same algorithms as the md-5/sha1/sha2 crates). */
function crypto_hasher(kind: SourceFileHashAlgorithm): Bun.CryptoHasher {
  switch (kind) {
    case "Md5":
      return new Bun.CryptoHasher("md5");
    case "Sha1":
      return new Bun.CryptoHasher("sha1");
    case "Sha256":
      return new Bun.CryptoHasher("sha256");
    case "Blake3":
      return unported("blake3::hash");
  }
}

/// The hash of the on-disk source file used for debug info and cargo freshness checks.
export class SourceFileHash {
  constructor(
    readonly kind: SourceFileHashAlgorithm,
    readonly value: Uint8Array,
  ) {}

  // rustc: compiler/rustc_span/src/lib.rs:1777 new_in_memory
  static new_in_memory(kind: SourceFileHashAlgorithm, src: Uint8Array): SourceFileHash {
    const hash = new SourceFileHash(kind, new Uint8Array(32));
    const len = hash.hash_len();
    const value = hash.value.subarray(0, len);
    const data = src;
    const h = crypto_hasher(kind);
    h.update(data);
    value.set(new Uint8Array(h.digest().buffer, 0, len));
    return hash;
  }

  // rustc: compiler/rustc_span/src/lib.rs:1797 new
  static new(kind: SourceFileHashAlgorithm, src: Read): Result<SourceFileHash, unknown> {
    const hash = new SourceFileHash(kind, new Uint8Array(32));
    const len = hash.hash_len();
    const value = hash.value.subarray(0, len);
    // Buffer size is the recommended amount to fully leverage SIMD instructions on AVX-512 as per
    // blake3 documentation.
    const buf = new Uint8Array(16 * 1024);

    // rustc: compiler/rustc_span/src/lib.rs:1805 digest
    function digest(hasher: Bun.CryptoHasher, src: Read, buf: Uint8Array, value: Uint8Array): Result<undefined, unknown> {
      for (;;) {
        const r = src.read(buf);
        if (r.$ === "Err") return r;
        const bytes_read = r._0;
        if (bytes_read === 0) {
          break;
        }
        hasher.update(buf.subarray(0, bytes_read));
      }
      const out = hasher.digest();
      value.set(new Uint8Array(out.buffer, 0, value.length));
      return Ok(undefined);
    }

    // PORT: the four per-algorithm `digest(...)` calls differ only in the hasher type.
    const r = digest(crypto_hasher(kind), src, buf, value);
    if (r.$ === "Err") return r;
    return Ok(hash);
  }

  /// Check if the stored hash matches the hash of the string.
  // rustc: compiler/rustc_span/src/lib.rs:1878 matches
  matches(src: Str): boolean {
    return source_file_hash_eq(SourceFileHash.new_in_memory(this.kind, src.b.subarray(src.lo, src.hi)), this);
  }

  /// The bytes of the hash.
  // rustc: compiler/rustc_span/src/lib.rs:1883 hash_bytes
  hash_bytes(): Uint8Array {
    const len = this.hash_len();
    return this.value.subarray(0, len);
  }

  // rustc: compiler/rustc_span/src/lib.rs:1888 hash_len
  hash_len(): number {
    switch (this.kind) {
      case "Md5":
        return 16;
      case "Sha1":
        return 20;
      case "Sha256":
      case "Blake3":
        return 32;
    }
  }
}

/** `#[derive(PartialEq)] for SourceFileHash` */
export function source_file_hash_eq(a: SourceFileHash, b: SourceFileHash): boolean {
  if (a.kind !== b.kind) return false;
  for (let i = 0; i < 32; i++) if (a.value[i] !== b.value[i]) return false;
  return true;
}

// rustc: compiler/rustc_span/src/lib.rs:1767 fmt
/** `impl Display for SourceFileHash` */
export function display_SourceFileHash(self: SourceFileHash): string {
  let s = `${display_SourceFileHashAlgorithm(self.kind)}=`;
  for (const byte of self.value.subarray(0, self.hash_len())) {
    s += byte.toString(16).padStart(2, "0");
  }
  return s;
}

export const debug_SourceFileHash: Debug<SourceFileHash> = (v, f) =>
  debug_struct(f, "SourceFileHash", [
    ["kind", v.kind],
    ["value", debug_vec(Array.from(v.value), f, debug_int)],
  ]);

export type SourceFileLines =
  /// The source file lines, in decoded (random-access) form.
  | { readonly $: "Lines"; readonly _0: RelativeBytePos[] }
  /// The source file lines, in undecoded difference list form.
  | { readonly $: "Diffs"; readonly _0: SourceFileDiffs };
export const SourceFileLines = {
  // rustc: compiler/rustc_span/src/lib.rs:1907 is_lines
  is_lines(self: SourceFileLines): boolean {
    return self.$ === "Lines";
  },
};

/// The source file lines in difference list form. This matches the form
/// used within metadata, which saves space by exploiting the fact that the
/// lines list is sorted and individual lines are usually not that long.
///
/// We read it directly from metadata and only decode it into `Lines` form
/// when necessary. This is a significant performance win, especially for
/// small crates where very little of `std`'s metadata is used.
export interface SourceFileDiffs {
  /// Always 1, 2, or 4. Always as small as possible, while being big
  /// enough to hold the length of the longest line in the source file.
  /// The 1 case is by far the most common.
  readonly bytes_per_diff: number;

  /// The number of diffs encoded in `raw_diffs`. Always one less than
  /// the number of lines in the source file.
  readonly num_diffs: number;

  /// The diffs in "raw" form. Each segment of `bytes_per_diff` length
  /// encodes one little-endian diff. Note that they aren't LEB128
  /// encoded. This makes for much faster decoding. Besides, the
  /// bytes_per_diff==1 case is by far the most common, and LEB128
  /// encoding has no effect on that case.
  readonly raw_diffs: Uint8Array;
}

/// A single source in the [`SourceMap`].
export class SourceFile {
  static readonly MAX_FILE_SIZE: number = 0xffff_ffff - 1;

  constructor(
    /// The name of the file that the source came from. Source that doesn't
    /// originate from files has names between angle brackets by convention
    /// (e.g., `<anon>`).
    public name: FileName,
    /// The complete source code.
    public src: Str | undefined,
    /// The source code's hash.
    public src_hash: SourceFileHash,
    /// Used to enable cargo to use checksums to check if a crate is fresh rather
    /// than mtimes. This might be the same as `src_hash`, and if the requested algorithm
    /// is identical we won't compute it twice.
    public checksum_hash: SourceFileHash | undefined,
    /// The external source code (used for external crates, which will have a `None`
    /// value as `self.src`.
    public external_src: FreezeLock<ExternalSource>,
    /// The start position of this source in the `SourceMap`.
    public start_pos: BytePos,
    /// The byte length of this source after normalization.
    public normalized_source_len: RelativeBytePos,
    /// The byte length of this source before normalization.
    public unnormalized_source_len: number,
    /// Locations of lines beginnings in the source code.
    // PORT: field `lines` renamed `lines_`: JS classes cannot have a field and a method
    // (`lines()`) with the same name.
    public lines_: FreezeLock<SourceFileLines>,
    /// Locations of multi-byte characters in the source code.
    public multibyte_chars: MultiByteChar[],
    /// Locations of characters removed during normalization.
    public normalized_pos: NormalizedPos[],
    /// A hash of the filename & crate-id, used for uniquely identifying source
    /// files within the crate graph and for speeding up hashing in incremental
    /// compilation.
    public stable_id: StableSourceFileId,
    /// Indicates which crate this `SourceFile` was imported from.
    public cnum: CrateNum,
  ) {}

  // rustc: compiler/rustc_span/src/lib.rs:1976 clone
  clone(): SourceFile {
    return new SourceFile(
      this.name,
      this.src,
      this.src_hash,
      this.checksum_hash,
      new FreezeLock(this.external_src.value, this.external_src.frozen),
      this.start_pos,
      this.normalized_source_len,
      this.unnormalized_source_len,
      new FreezeLock(this.lines_.value, this.lines_.frozen),
      this.multibyte_chars.slice(),
      this.normalized_pos.slice(),
      this.stable_id,
      this.cnum,
    );
  }

  // rustc-skip: compiler/rustc_span/src/lib.rs:1996 encode Encodable impl
  // rustc-skip: compiler/rustc_span/src/lib.rs:2071 decode Decodable impl

  // rustc: compiler/rustc_span/src/lib.rs:2172 new
  static new(
    name: FileName,
    src: Str,
    hash_kind: SourceFileHashAlgorithm,
    checksum_hash_kind: SourceFileHashAlgorithm | undefined,
  ): Result<SourceFile, OffsetOverflowError> {
    // Compute the file hash before any normalization.
    const src_hash = SourceFileHash.new_in_memory(hash_kind, src.b.subarray(src.lo, src.hi));
    const checksum_hash =
      checksum_hash_kind === undefined
        ? undefined
        : checksum_hash_kind === hash_kind
          ? src_hash
          : SourceFileHash.new_in_memory(checksum_hash_kind, src.b.subarray(src.lo, src.hi));
    // Capture the original source length before normalization.
    if (src.len() > 0xffff_ffff) return Err(new OffsetOverflowError());
    const unnormalized_source_len = src.len();
    if (unnormalized_source_len > SourceFile.MAX_FILE_SIZE) {
      return Err(new OffsetOverflowError());
    }

    let normalized_pos: NormalizedPos[];
    [src, normalized_pos] = normalize_src(src);

    const stable_id = StableSourceFileId.from_filename_in_current_crate(name);
    if (src.len() > 0xffff_ffff) return Err(new OffsetOverflowError());
    const normalized_source_len = src.len();
    if (normalized_source_len > SourceFile.MAX_FILE_SIZE) {
      return Err(new OffsetOverflowError());
    }

    const [lines, multibyte_chars] = analyze_source_file(src);

    return Ok(
      new SourceFile(
        name,
        src,
        src_hash,
        checksum_hash,
        FreezeLock.frozen(ExternalSource.Unneeded),
        BytePos.from_u32(0),
        RelativeBytePos.from_u32(normalized_source_len),
        unnormalized_source_len,
        FreezeLock.frozen<SourceFileLines>({ $: "Lines", _0: lines }),
        multibyte_chars,
        normalized_pos,
        stable_id,
        LOCAL_CRATE,
      ),
    );
  }

  /// This converts the `lines` field to contain `SourceFileLines::Lines` if needed and freezes
  /// it.
  // rustc: compiler/rustc_span/src/lib.rs:2222 convert_diffs_to_lines_frozen
  convert_diffs_to_lines_frozen(): void {
    const guard = this.lines_.try_write();
    if (guard === undefined) return;

    const cur = guard.value;
    if (cur.$ === "Lines") {
      guard.freeze();
      return;
    }
    const { bytes_per_diff, num_diffs, raw_diffs } = cur._0;

    // Convert from "diffs" form to "lines" form.
    const lines: RelativeBytePos[] = [];
    let line_start = RelativeBytePos(0);
    lines.push(line_start);

    assert(num_diffs === Math.floor(raw_diffs.length / bytes_per_diff), "assertion `left == right` failed");
    switch (bytes_per_diff) {
      case 1:
        for (const diff of raw_diffs) {
          line_start = RelativeBytePos.add(line_start, RelativeBytePos(diff));
          lines.push(line_start);
        }
        break;
      case 2:
        for (let i = 0; i < num_diffs; i++) {
          const pos = bytes_per_diff * i;
          const diff = raw_diffs[pos]! | (raw_diffs[pos + 1]! << 8);
          line_start = RelativeBytePos.add(line_start, RelativeBytePos(diff));
          lines.push(line_start);
        }
        break;
      case 4:
        for (let i = 0; i < num_diffs; i++) {
          const pos = bytes_per_diff * i;
          const diff = (raw_diffs[pos]! | (raw_diffs[pos + 1]! << 8) | (raw_diffs[pos + 2]! << 16) | (raw_diffs[pos + 3]! << 24)) >>> 0;
          line_start = RelativeBytePos.add(line_start, RelativeBytePos(diff));
          lines.push(line_start);
        }
        break;
      default:
        unreachable();
    }

    guard.value = { $: "Lines", _0: lines };

    guard.freeze();
  }

  // rustc: compiler/rustc_span/src/lib.rs:2278 lines
  lines(): readonly RelativeBytePos[] {
    const l = this.lines_.get();
    if (l !== undefined && l.$ === "Lines") {
      return l._0;
    }

    // outline(|| { ... })
    this.convert_diffs_to_lines_frozen();
    const l2 = this.lines_.get();
    if (l2 !== undefined && l2.$ === "Lines") {
      return l2._0;
    }
    return unreachable();
  }

  /// Returns the `BytePos` of the beginning of the current line.
  // rustc: compiler/rustc_span/src/lib.rs:2293 line_begin_pos
  line_begin_pos(pos: BytePos): BytePos {
    const rpos = this.relative_position(pos);
    const line_index = unwrap(this.lookup_line(rpos));
    const line_start_pos = this.lines()[line_index]!;
    return this.absolute_position(line_start_pos);
  }

  /// Add externally loaded source.
  /// If the hash of the input doesn't match or no input is supplied via None,
  /// it is interpreted as an error and the corresponding enum variant is set.
  /// The return value signifies whether some kind of source is present.
  // rustc: compiler/rustc_span/src/lib.rs:2304 add_external_src
  add_external_src(get_src: () => Str | undefined): boolean {
    if (!this.external_src.is_frozen()) {
      let src = get_src();
      if (src !== undefined) {
        // The src_hash needs to be computed on the pre-normalized src.
        src = this.src_hash.matches(src) ? normalize_src(src)[0] : undefined;
      }

      const external_src = this.external_src.try_write();
      if (external_src !== undefined) {
        const v = external_src.value;
        if (v.$ === "Foreign" && v.kind.$ === "AbsentOk") {
          v.kind = src !== undefined ? { $: "Present", _0: src } : { $: "AbsentErr" };
        } else {
          panic(`unexpected state ${debug_ExternalSource(v, { alternate: false })}`);
        }

        // Freeze this so we don't try to load the source again.
        external_src.freeze();
      }
    }

    return this.src !== undefined || ExternalSource.get_source(this.external_src.read()) !== undefined;
  }

  /// Gets a line from the list of pre-computed line-beginnings.
  /// The line number here is 0-based.
  // rustc: compiler/rustc_span/src/lib.rs:2343 get_line
  get_line(line_number: number): Str | undefined {
    // rustc: compiler/rustc_span/src/lib.rs:2344 get_until_newline
    function get_until_newline(src: Str, begin: number): Str {
      // We can't use `lines.get(line_number+1)` because we might
      // be parsing when we call this function and thus the current
      // line is the last one we have line info for.
      const slice = src.slice(begin);
      const e = slice.find("\n");
      return e !== undefined ? slice.slice(0, e) : slice;
    }

    const line = this.lines()[line_number];
    if (line === undefined) return undefined;
    const begin = RelativeBytePos.to_usize(line);

    if (this.src !== undefined) {
      return get_until_newline(this.src, begin);
    } else {
      const src = ExternalSource.get_source(this.external_src.read());
      return src === undefined ? undefined : get_until_newline(src, begin);
    }
  }

  // rustc: compiler/rustc_span/src/lib.rs:2370 is_real_file
  is_real_file(): boolean {
    return FileName.is_real(this.name);
  }

  // rustc: compiler/rustc_span/src/lib.rs:2375 is_imported
  is_imported(): boolean {
    return this.src === undefined;
  }

  // rustc: compiler/rustc_span/src/lib.rs:2379 count_lines
  count_lines(): number {
    return this.lines().length;
  }

  // rustc: compiler/rustc_span/src/lib.rs:2384 absolute_position
  absolute_position(pos: RelativeBytePos): BytePos {
    return BytePos.from_u32(RelativeBytePos.to_u32(pos) + BytePos.to_u32(this.start_pos));
  }

  // rustc: compiler/rustc_span/src/lib.rs:2389 relative_position
  relative_position(pos: BytePos): RelativeBytePos {
    return RelativeBytePos.from_u32(BytePos.to_u32(pos) - BytePos.to_u32(this.start_pos));
  }

  // rustc: compiler/rustc_span/src/lib.rs:2394 end_position
  end_position(): BytePos {
    return this.absolute_position(this.normalized_source_len);
  }

  /// Finds the line containing the given position. The return value is the
  /// index into the `lines` array of this `SourceFile`, not the 1-based line
  /// number. If the source_file is empty or the position is located before the
  /// first line, `None` is returned.
  // rustc: compiler/rustc_span/src/lib.rs:2402 lookup_line
  lookup_line(pos: RelativeBytePos): number | undefined {
    const lines = this.lines();
    // `partition_point(|x| x <= &pos)`
    let lo = 0;
    let hi = lines.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (lines[mid]! <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? undefined : lo - 1;
  }

  // rustc: compiler/rustc_span/src/lib.rs:2406 line_bounds
  /** `Range<BytePos>` as `[start, end]`. */
  line_bounds(line_index: number): [BytePos, BytePos] {
    if (this.is_empty()) {
      return [this.start_pos, this.start_pos];
    }

    const lines = this.lines();
    assert(line_index < lines.length, "assertion failed: line_index < lines.len()");
    if (line_index === lines.length - 1) {
      return [this.absolute_position(lines[line_index]!), this.end_position()];
    } else {
      return [this.absolute_position(lines[line_index]!), this.absolute_position(lines[line_index + 1]!)];
    }
  }

  /// Returns whether or not the file contains the given `SourceMap` byte
  /// position. The position one past the end of the file is considered to be
  /// contained by the file. This implies that files for which `is_empty`
  /// returns true still contain one byte position according to this function.
  // rustc: compiler/rustc_span/src/lib.rs:2425 contains
  contains(byte_pos: BytePos): boolean {
    return byte_pos >= this.start_pos && byte_pos <= this.end_position();
  }

  // rustc: compiler/rustc_span/src/lib.rs:2430 is_empty
  is_empty(): boolean {
    return RelativeBytePos.to_u32(this.normalized_source_len) === 0;
  }

  /// Calculates the original byte position relative to the start of the file
  /// based on the given byte position.
  // rustc: compiler/rustc_span/src/lib.rs:2436 original_relative_byte_pos
  original_relative_byte_pos(pos: BytePos): RelativeBytePos {
    const rpos = this.relative_position(pos);

    // Diff before any records is 0. Otherwise use the previously recorded
    // diff as that applies to the following characters until a new diff
    // is recorded.
    const r = binary_search_by(this.normalized_pos, (np) => cmp_u32(np.pos, rpos));
    const diff = r.$ === "Ok" ? this.normalized_pos[r._0]!.diff : r._0 === 0 ? 0 : this.normalized_pos[r._0 - 1]!.diff;

    return RelativeBytePos.from_u32(rpos + diff);
  }

  /// Calculates a normalized byte position from a byte offset relative to the
  /// start of the file.
  ///
  /// When we get an inline assembler error from LLVM during codegen, we
  /// import the expanded assembly code as a new `SourceFile`, which can then
  /// be used for error reporting with spans. However the byte offsets given
  /// to us by LLVM are relative to the start of the original buffer, not the
  /// normalized one. Hence we need to convert those offsets to the normalized
  /// form when constructing spans.
  // rustc: compiler/rustc_span/src/lib.rs:2460 normalized_byte_pos
  normalized_byte_pos(offset: number): BytePos {
    const r = binary_search_by(this.normalized_pos, (np) => cmp_u32(np.pos + np.diff, offset));
    const diff = r.$ === "Ok" ? this.normalized_pos[r._0]!.diff : r._0 === 0 ? 0 : this.normalized_pos[r._0 - 1]!.diff;

    return BytePos.from_u32(this.start_pos + offset - diff);
  }

  /// Converts an relative `RelativeBytePos` to a `CharPos` relative to the `SourceFile`.
  // rustc: compiler/rustc_span/src/lib.rs:2472 bytepos_to_file_charpos
  bytepos_to_file_charpos(bpos: RelativeBytePos): CharPos {
    // The number of extra bytes due to multibyte chars in the `SourceFile`.
    let total_extra_bytes = 0;

    for (const mbc of this.multibyte_chars) {
      // debug!("{}-byte char at {:?}", mbc.bytes, mbc.pos);
      if (mbc.pos < bpos) {
        // Every character is at least one byte, so we only
        // count the actual extra bytes.
        total_extra_bytes += mbc.bytes - 1;
        // We should never see a byte position in the middle of a
        // character.
        assert(
          RelativeBytePos.to_u32(bpos) >= RelativeBytePos.to_u32(mbc.pos) + mbc.bytes,
          "assertion failed: bpos.to_u32() >= mbc.pos.to_u32() + mbc.bytes as u32",
        );
      } else {
        break;
      }
    }

    assert(total_extra_bytes <= RelativeBytePos.to_u32(bpos), "assertion failed: total_extra_bytes <= bpos.to_u32()");
    return CharPos(RelativeBytePos.to_usize(bpos) - total_extra_bytes);
  }

  /// Looks up the file's (1-based) line number and (0-based `CharPos`) column offset, for a
  /// given `RelativeBytePos`.
  // rustc: compiler/rustc_span/src/lib.rs:2496 lookup_file_pos
  lookup_file_pos(pos: RelativeBytePos): [number, CharPos] {
    const chpos = this.bytepos_to_file_charpos(pos);
    const a = this.lookup_line(pos);
    if (a !== undefined) {
      const line = a + 1; // Line numbers start at 1
      const linebpos = this.lines()[a]!;
      const linechpos = this.bytepos_to_file_charpos(linebpos);
      const col = CharPos.sub(chpos, linechpos);
      // debug!("byte pos {:?} is on the line at byte pos {:?}", pos, linebpos);
      // debug!("char pos {:?} is on the line at char pos {:?}", chpos, linechpos);
      // debug!("byte is on line: {}", line);
      assert(chpos >= linechpos, "assertion failed: chpos >= linechpos");
      return [line, col];
    } else {
      return [0, chpos];
    }
  }

  /// Looks up the file's (1-based) line number, (0-based `CharPos`) column offset, and (0-based)
  /// column offset when displayed, for a given `BytePos`.
  // rustc: compiler/rustc_span/src/lib.rs:2516 lookup_file_pos_with_col_display
  lookup_file_pos_with_col_display(pos: BytePos): [number, CharPos, number] {
    const rpos = this.relative_position(pos);
    const [line, col_or_chpos] = this.lookup_file_pos(rpos);
    if (line > 0) {
      const code = this.get_line(line - 1);
      if (code === undefined) {
        // If we don't have the code available, it is ok as a fallback to return the bytepos
        // instead of the "display" column, which is only used to properly show underlines
        // in the terminal.
        // FIXME: we'll want better handling of this in the future for the sake of tools
        // that want to use the display col instead of byte offsets to modify Rust code, but
        // that is a problem for another day, the previous code was already incorrect for
        // both displaying *and* third party tools using the json output naïvely.
        // tracing::info!("couldn't find line {line} {:?}", self.name);
        return [line, col_or_chpos, col_or_chpos];
      }
      let display_col = 0;
      const chars = code.chars();
      for (let i = 0; i < col_or_chpos; i++) {
        const ch = chars.next();
        if (ch === undefined) break;
        display_col += char_width(ch);
      }
      return [line, col_or_chpos, display_col];
    } else {
      // This is never meant to happen?
      return [0, col_or_chpos, col_or_chpos];
    }
  }
}

// rustc: compiler/rustc_span/src/lib.rs:2116 fmt
/** `impl fmt::Debug for SourceFile` */
export function debug_SourceFile(self: SourceFile, _f: Fmt): string {
  // `write!(fmt, "SourceFile({:?})", ..)`: the inner `{:?}` does not inherit `{:#?}`.
  return `SourceFile(${debug_FileName(self.name, { alternate: false })})`;
}

/** `slice::binary_search_by`; the comparator returns the order of the element relative to the target. */
function binary_search_by<T>(v: readonly T[], f: (x: T) => -1 | 0 | 1): Result<number, number> {
  let size = v.length;
  if (size === 0) return Err(0);
  let base = 0;
  while (size > 1) {
    const half = size >>> 1;
    const mid = base + half;
    if (f(v[mid]!) !== 1) base = mid;
    size -= half;
  }
  const c = f(v[base]!);
  if (c === 0) return Ok(base);
  return Err(base + (c === -1 ? 1 : 0));
}

function cmp_u32(a: number, b: number): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/// This is a [SourceFile] identifier that is used to correlate source files between
/// subsequent compilation sessions (which is something we need to do during
/// incremental compilation).
///
/// It is a hash value (so we can efficiently consume it when stable-hashing
/// spans) that consists of the `FileName` and the `StableCrateId` of the crate
/// the source file is from. The crate id is needed because sometimes the
/// `FileName` is not unique within the crate graph (think `src/lib.rs`, for
/// example).
///
/// The way the crate-id part is handled is a bit special: source files of the
/// local crate are hashed as `(filename, None)`, while source files from
/// upstream crates have a hash of `(filename, Some(stable_crate_id))`. This
/// is because SourceFiles for the local crate are allocated very early in the
/// compilation process when the `StableCrateId` is not yet known. If, due to
/// some refactoring of the compiler, the `StableCrateId` of the local crate
/// were to become available, it would be better to uniformly make this a
/// hash of `(filename, stable_crate_id)`.
///
/// When `SourceFile`s are exported in crate metadata, the `StableSourceFileId`
/// is updated to incorporate the `StableCrateId` of the exporting crate.
// PORT: upstream stores `Hash128` = StableHasher((filename, stable_crate_id)). That hash is never
// printed and only feeds incremental/metadata (M5); `StableHasher` (SipHasher128) and the derived
// `Hash` of `FileName` are not ported. rust-ts keeps the hash *inputs* instead; `hash()` is
// unported until a consumer needs the value.
export class StableSourceFileId {
  constructor(
    readonly filename: FileName,
    readonly stable_crate_id: StableCrateId | undefined,
  ) {}

  hash(): Hash128 {
    return unported("rustc_data_structures::stable_hasher::StableHasher");
  }

  // rustc: compiler/rustc_span/src/lib.rs:2147 from_filename_in_current_crate
  static from_filename_in_current_crate(filename: FileName): StableSourceFileId {
    return StableSourceFileId.from_filename_and_stable_crate_id(filename, undefined);
  }

  // rustc: compiler/rustc_span/src/lib.rs:2151 from_filename_for_export
  static from_filename_for_export(filename: FileName, local_crate_stable_crate_id: StableCrateId): StableSourceFileId {
    return StableSourceFileId.from_filename_and_stable_crate_id(filename, local_crate_stable_crate_id);
  }

  // rustc: compiler/rustc_span/src/lib.rs:2158 from_filename_and_stable_crate_id
  static from_filename_and_stable_crate_id(filename: FileName, stable_crate_id: StableCrateId | undefined): StableSourceFileId {
    // let mut hasher = StableHasher::new(); filename.hash(&mut hasher);
    // stable_crate_id.hash(&mut hasher); StableSourceFileId(hasher.finish())
    return new StableSourceFileId(filename, stable_crate_id);
  }
}

// rustc: compiler/rustc_span/src/lib.rs:2540 char_width
export function char_width(ch: number): number {
  // FIXME: `unicode_width` sometimes disagrees with terminals on how wide a `char` is. For now,
  // just accept that sometimes the code line will be longer than desired.
  switch (ch) {
    case 0x09:
      return 4;
    // Keep the following list in sync with `rustc_errors::emitter::OUTPUT_REPLACEMENTS`. These
    // are control points that we replace before printing with a visible codepoint for the sake
    // of being able to point at them with underlines.
    case 0x00: case 0x01: case 0x02: case 0x03: case 0x04: case 0x05:
    case 0x06: case 0x07: case 0x08: case 0x0b: case 0x0c: case 0x0d:
    case 0x0e: case 0x0f: case 0x10: case 0x11: case 0x12: case 0x13:
    case 0x14: case 0x15: case 0x16: case 0x17: case 0x18: case 0x19:
    case 0x1a: case 0x1b: case 0x1c: case 0x1d: case 0x1e: case 0x1f:
    case 0x7f: case 0x202a: case 0x202b: case 0x202d: case 0x202e: case 0x2066:
    case 0x2067: case 0x2068: case 0x202c: case 0x2069:
      return 1;
    default:
      return UnicodeWidthChar_width(ch) ?? 1;
  }
}

/**
 * PORT: `unicode_width::UnicodeWidthChar::width` (vendor crate unicode-width 0.2.2, not ported).
 * Printable ASCII is width 1 (the crate's own fast path, `0x20 <= c < 0x7F`); everything else
 * waits for the vendor port.
 */
function UnicodeWidthChar_width(ch: number): number | undefined {
  if (ch >= 0x20 && ch < 0x7f) return 1;
  return unported("unicode_width::UnicodeWidthChar::width");
}

// rustc: compiler/rustc_span/src/lib.rs:2559 str_width
export function str_width(s: Str): number {
  let n = 0;
  const chars = s.chars();
  for (let c = chars.next(); c !== undefined; c = chars.next()) n += char_width(c);
  return n;
}

// PORT: the `&mut String` normalizers return the new `Str` (source text is an immutable view).

/// Normalizes the source code and records the normalizations.
// rustc: compiler/rustc_span/src/lib.rs:2564 normalize_src
function normalize_src(src: Str): [Str, NormalizedPos[]] {
  const normalized_pos: NormalizedPos[] = [];
  src = remove_bom(src, normalized_pos);
  src = normalize_newlines(src, normalized_pos);
  return [src, normalized_pos];
}

/// Removes UTF-8 BOM, if any.
// rustc: compiler/rustc_span/src/lib.rs:2572 remove_bom
function remove_bom(src: Str, normalized_pos: NormalizedPos[]): Str {
  if (src.starts_with("\u{feff}")) {
    src = src.slice(3);
    normalized_pos.push({ pos: RelativeBytePos(0), diff: 3 });
  }
  return src;
}

/// Replaces `\r\n` with `\n` in-place in `src`.
///
/// Leaves any occurrences of lone `\r` unchanged.
// rustc: compiler/rustc_span/src/lib.rs:2582 normalize_newlines
export function normalize_newlines(src: Str, normalized_pos: NormalizedPos[]): Str {
  if (src.b.subarray(src.lo, src.hi).indexOf(0x0d) < 0) {
    return src;
  }

  // We replace `\r\n` with `\n` in-place, which doesn't break utf-8 encoding.
  // While we *can* call `as_mut_vec` and do surgery on the live string
  // directly, let's rather steal the contents of `src`. This makes the code
  // safe even if a panic occurs.

  const buf = src.b.slice(src.lo, src.hi);
  let gap_len = 0;
  let tail = buf.subarray(0);
  let cursor = 0;
  const last = normalized_pos[normalized_pos.length - 1];
  const original_gap = last === undefined ? 0 : last.diff;
  for (;;) {
    const found = find_crlf(tail.subarray(gap_len));
    const idx = found === undefined ? tail.length : found + gap_len;
    tail.copyWithin(0, gap_len, idx);
    tail = tail.subarray(idx - gap_len);
    if (tail.length === gap_len) {
      break;
    }
    cursor += idx - gap_len;
    gap_len += 1;
    normalized_pos.push({
      pos: RelativeBytePos.from_usize(cursor + 1),
      diff: original_gap + gap_len,
    });
  }

  // Account for removed `\r`.
  // After `set_len`, `buf` is guaranteed to contain utf-8 again.
  const new_len = buf.length - gap_len;
  return new Str(buf, 0, new_len);
}

// rustc: compiler/rustc_span/src/lib.rs:2623 find_crlf
function find_crlf(src: Uint8Array): number | undefined {
  let search_idx = 0;
  for (;;) {
    const idx = find_cr(src.subarray(search_idx));
    if (idx === undefined) break;
    if (src[search_idx + idx + 1] !== 0x0a) {
      search_idx += idx + 1;
      continue;
    }
    return search_idx + idx;
  }
  return undefined;
}

// rustc: compiler/rustc_span/src/lib.rs:2635 find_cr
function find_cr(src: Uint8Array): number | undefined {
  const i = src.indexOf(0x0d);
  return i < 0 ? undefined : i;
}

// _____________________________________________________________________________
// Pos, BytePos, CharPos
//

/**
 * `trait Pos` (implemented by `impl_pos!` for `BytePos`, `RelativeBytePos`, `CharPos`).
 * PORT: each position type is a branded number whose companion is a hoisted function (the tuple
 * constructor, `BytePos(5)`) carrying the trait methods and `Add`/`Sub` (`BytePos.add(a, b)`).
 */
export interface Pos<T extends number> {
  // rustc: compiler/rustc_span/src/lib.rs:2645 from_usize
  from_usize(n: number): T;
  // rustc: compiler/rustc_span/src/lib.rs:2646 to_usize
  to_usize(self: T): number;
  // rustc: compiler/rustc_span/src/lib.rs:2647 from_u32
  from_u32(n: number): T;
  // rustc: compiler/rustc_span/src/lib.rs:2648 to_u32
  to_u32(self: T): number;
  add(self: T, rhs: T): T;
  sub(self: T, rhs: T): T;
  /** `cmp::max` / `cmp::min` (`derive(Ord)`). */
  max(a: T, b: T): T;
  min(a: T, b: T): T;
}

/** The body of `impl_pos!` for one type. */
function impl_pos<T extends number>(ident: ((n: number) => T) & Pos<T>): void {
  // rustc: compiler/rustc_span/src/lib.rs:2664 from_usize
  ident.from_usize = function (n: number): T {
    return ident(n);
  };

  // rustc: compiler/rustc_span/src/lib.rs:2669 to_usize
  ident.to_usize = function (self: T): number {
    return self;
  };

  // rustc: compiler/rustc_span/src/lib.rs:2674 from_u32
  ident.from_u32 = function (n: number): T {
    return ident(n);
  };

  // rustc: compiler/rustc_span/src/lib.rs:2679 to_u32
  ident.to_u32 = function (self: T): number {
    return self;
  };

  // rustc: compiler/rustc_span/src/lib.rs:2688 add
  ident.add = function (self: T, rhs: T): T {
    return ident(self + rhs);
  };

  // rustc: compiler/rustc_span/src/lib.rs:2697 sub
  ident.sub = function (self: T, rhs: T): T {
    return ident(self - rhs);
  };

  ident.max = (a: T, b: T): T => (b >= a ? b : a);
  ident.min = (a: T, b: T): T => (b < a ? b : a);
}

/// A byte offset.
///
/// Keep this small (currently 32-bits), as AST contains a lot of them.
export type BytePos = number & { readonly __brand: "BytePos" };
export function BytePos(n: number): BytePos {
  return n as BytePos;
}
export declare namespace BytePos {
  let from_usize: Pos<BytePos>["from_usize"];
  let to_usize: Pos<BytePos>["to_usize"];
  let from_u32: Pos<BytePos>["from_u32"];
  let to_u32: Pos<BytePos>["to_u32"];
  let add: Pos<BytePos>["add"];
  let sub: Pos<BytePos>["sub"];
  let max: Pos<BytePos>["max"];
  let min: Pos<BytePos>["min"];
}
impl_pos(BytePos as typeof BytePos & Pos<BytePos>);
export const debug_BytePos: Debug<BytePos> = (v, f) => debug_tuple(f, "BytePos", [String(v)]);

/// A byte offset relative to file beginning.
export type RelativeBytePos = number & { readonly __brand: "RelativeBytePos" };
export function RelativeBytePos(n: number): RelativeBytePos {
  return n as RelativeBytePos;
}
export declare namespace RelativeBytePos {
  let from_usize: Pos<RelativeBytePos>["from_usize"];
  let to_usize: Pos<RelativeBytePos>["to_usize"];
  let from_u32: Pos<RelativeBytePos>["from_u32"];
  let to_u32: Pos<RelativeBytePos>["to_u32"];
  let add: Pos<RelativeBytePos>["add"];
  let sub: Pos<RelativeBytePos>["sub"];
  let max: Pos<RelativeBytePos>["max"];
  let min: Pos<RelativeBytePos>["min"];
}
impl_pos(RelativeBytePos as typeof RelativeBytePos & Pos<RelativeBytePos>);
export const debug_RelativeBytePos: Debug<RelativeBytePos> = (v, f) => debug_tuple(f, "RelativeBytePos", [String(v)]);

/// A character offset.
///
/// Because of multibyte UTF-8 characters, a byte offset
/// is not equivalent to a character offset. The [`SourceMap`] will convert [`BytePos`]
/// values to `CharPos` values as necessary.
export type CharPos = number & { readonly __brand: "CharPos" };
export function CharPos(n: number): CharPos {
  return n as CharPos;
}
export declare namespace CharPos {
  let from_usize: Pos<CharPos>["from_usize"];
  let to_usize: Pos<CharPos>["to_usize"];
  let from_u32: Pos<CharPos>["from_u32"];
  let to_u32: Pos<CharPos>["to_u32"];
  let add: Pos<CharPos>["add"];
  let sub: Pos<CharPos>["sub"];
  let max: Pos<CharPos>["max"];
  let min: Pos<CharPos>["min"];
}
impl_pos(CharPos as typeof CharPos & Pos<CharPos>);
export const debug_CharPos: Debug<CharPos> = (v, f) => debug_tuple(f, "CharPos", [String(v)]);

// rustc-skip: compiler/rustc_span/src/lib.rs:2726 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:2732 decode Decodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:2738 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:2744 decode Decodable impl

// _____________________________________________________________________________
// Loc, SourceFileAndLine, SourceFileAndBytePos
//

/// A source code location used for error reporting.
export interface Loc {
  /// Information about the original source.
  file: SourceFile;
  /// The (1-based) line number.
  line: number;
  /// The (0-based) column offset.
  col: CharPos;
  /// The (0-based) column offset when displayed.
  col_display: number;
}

export const debug_Loc: Debug<Loc> = (v, f) =>
  debug_struct(f, "Loc", [
    ["file", debug_SourceFile(v.file, f)],
    ["line", debug_int(v.line, f)],
    ["col", debug_CharPos(v.col, f)],
    ["col_display", debug_int(v.col_display, f)],
  ]);

// Used to be structural records.
export interface SourceFileAndLine {
  sf: SourceFile;
  /// Index of line, starting from 0.
  line: number;
}
export interface SourceFileAndBytePos {
  sf: SourceFile;
  pos: BytePos;
}

export interface LineInfo {
  /// Index of line, starting from 0.
  line_index: number;

  /// Column in line where span begins, starting from 0.
  start_col: CharPos;

  /// Column in line where span ends, starting from 0, exclusive.
  end_col: CharPos;
}

export const debug_LineInfo: Debug<LineInfo> = (v, f) =>
  debug_struct(f, "LineInfo", [
    ["line_index", debug_int(v.line_index, f)],
    ["start_col", debug_CharPos(v.start_col, f)],
    ["end_col", debug_CharPos(v.end_col, f)],
  ]);

export interface FileLines {
  file: SourceFile;
  lines: LineInfo[];
}

/** `AtomicRef<fn(LocalDefId)>`; the query system swaps `f` for incremental span tracking. */
export const SPAN_TRACK: { f: (id: LocalDefId) => void } = { f: (_) => {} };

// _____________________________________________________________________________
// SpanLinesError, SpanSnippetError, DistinctSources, MalformedSourceMapPositions
//

export type FileLinesResult = Result<FileLines, SpanLinesError>;

export type SpanLinesError = { readonly $: "DistinctSources"; readonly _0: DistinctSources };

export type SpanSnippetError =
  | { readonly $: "IllFormedSpan"; readonly _0: Span }
  | { readonly $: "DistinctSources"; readonly _0: DistinctSources }
  | { readonly $: "MalformedForSourcemap"; readonly _0: MalformedSourceMapPositions }
  | { readonly $: "SourceNotAvailable"; readonly filename: FileName };

export interface DistinctSources {
  begin: [FileName, BytePos];
  end: [FileName, BytePos];
}

export interface MalformedSourceMapPositions {
  name: FileName;
  source_len: number;
  begin_pos: BytePos;
  end_pos: BytePos;
}

export const debug_DistinctSources: Debug<DistinctSources> = (v, f) =>
  debug_struct(f, "DistinctSources", [
    ["begin", debug_tuple(f, "", [debug_FileName(v.begin[0], f), debug_BytePos(v.begin[1], f)])],
    ["end", debug_tuple(f, "", [debug_FileName(v.end[0], f), debug_BytePos(v.end[1], f)])],
  ]);

export const debug_MalformedSourceMapPositions: Debug<MalformedSourceMapPositions> = (v, f) =>
  debug_struct(f, "MalformedSourceMapPositions", [
    ["name", debug_FileName(v.name, f)],
    ["source_len", debug_int(v.source_len, f)],
    ["begin_pos", debug_BytePos(v.begin_pos, f)],
    ["end_pos", debug_BytePos(v.end_pos, f)],
  ]);

export const debug_SpanLinesError: Debug<SpanLinesError> = (v, f) => debug_tuple(f, "DistinctSources", [debug_DistinctSources(v._0, f)]);

export const debug_SpanSnippetError: Debug<SpanSnippetError> = (v, f) => {
  switch (v.$) {
    case "IllFormedSpan":
      return debug_tuple(f, "IllFormedSpan", [debug_Span(v._0, f)]);
    case "DistinctSources":
      return debug_tuple(f, "DistinctSources", [debug_DistinctSources(v._0, f)]);
    case "MalformedForSourcemap":
      return debug_tuple(f, "MalformedForSourcemap", [debug_MalformedSourceMapPositions(v._0, f)]);
    case "SourceNotAvailable":
      return debug_struct(f, "SourceNotAvailable", [["filename", debug_FileName(v.filename, f)]]);
  }
};

/// Range inside of a `Span` used for diagnostics when we only have access to relative positions.
export class InnerSpan {
  constructor(
    readonly start: number,
    readonly end: number,
  ) {}

  // rustc: compiler/rustc_span/src/lib.rs:2839 new
  static new(start: number, end: number): InnerSpan {
    return new InnerSpan(start, end);
  }
}

export const debug_InnerSpan: Debug<InnerSpan> = (v, f) =>
  debug_struct(f, "InnerSpan", [
    ["start", debug_int(v.start, f)],
    ["end", debug_int(v.end, f)],
  ]);

// rustc-skip: compiler/rustc_span/src/lib.rs:2845 stable_hash StableHash impl (HashStable)

/// Useful type to use with `Result<>` indicate that an error has already
/// been reported to the user, so no need to continue checking.
///
/// The `()` field is necessary: it is non-`pub`, which means values of this
/// type cannot be constructed outside of this crate.
export class ErrorGuaranteed {
  private constructor(readonly _0: undefined) {}

  /// Don't use this outside of `DiagCtxtInner::emit_diagnostic`!
  // rustc: compiler/rustc_span/src/lib.rs:2863 unchecked_error_guaranteed
  static unchecked_error_guaranteed(): ErrorGuaranteed {
    return new ErrorGuaranteed(undefined);
  }

  // rustc: compiler/rustc_span/src/lib.rs:2867 raise_fatal
  raise_fatal(): never {
    return new FatalError().raise();
  }
}

export const debug_ErrorGuaranteed: Debug<ErrorGuaranteed> = (_v, f) => debug_tuple(f, "ErrorGuaranteed", ["()"]);

// rustc-skip: compiler/rustc_span/src/lib.rs:2874 encode Encodable impl
// rustc-skip: compiler/rustc_span/src/lib.rs:2883 decode Decodable impl

