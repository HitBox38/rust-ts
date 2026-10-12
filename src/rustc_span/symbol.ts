//! An "interner" is a data structure that associates values with usize tags and
//! allows bidirectional lookup; i.e., given a value, one can easily find the
//! type, and vice versa.
import { debug_int, debug_list, debug_str, debug_vec, PLAIN, type Debug, type Fmt } from "../std/fmt.ts";
import { assert, panic, unwrap } from "../std/panic.ts";
import { utf8 } from "../std/str.ts";
import { find_best_match_for_name } from "./edit_distance.ts";
import { Edition, Edition_discriminant } from "./edition.ts";
import { debug_SyntaxContext, SyntaxContext } from "./hygiene.ts";
import { with_session_globals } from "./lib.ts";
import { DUMMY_SP, Span } from "./span_encoding.ts";
import {
  kw_generated,
  PREDEFINED_SYMBOLS_COUNT,
  PREFILL,
  sym_generated,
  SYMBOL_DIGITS_BASE,
  SYMBOL_LOWERCASE_LETTERS_BASE,
  SYMBOL_UPPERCASE_LETTERS_BASE,
} from "./symbol.gen.ts";

export { PREDEFINED_SYMBOLS_COUNT };

// The proc macro code for this is in `compiler/rustc_macros/src/symbols.rs`.
// PORT: the `symbols! { Keywords { .. } Symbols { .. } }` invocation is expanded by
// tools/codegen/symbols.ts into ./symbol.gen.ts (prefill list, `kw`/`sym` tables, bases, count).

/// Symbols for crates that are part of the stable standard library: `std`, `core`, `alloc`, and
/// `proc_macro`.
// PORT: initialized after `sym` (below); a `const` cannot be read before its declaration.
export let STDLIB_STABLE_CRATES: readonly Symbol[];

export class Ident {
  constructor(
    /// `name` should never be the empty symbol. If you are considering that,
    /// you are probably conflating "empty identifier with "no identifier" and
    /// you should use `Option<Ident>` instead.
    /// Trying to construct an `Ident` with an empty name will trigger debug assertions.
    public name: Symbol,
    public span: Span,
  ) {}

  /// Constructs a new identifier from a symbol and a span.
  // rustc: compiler/rustc_span/src/symbol.rs:2497 new
  static new(name: Symbol, span: Span): Ident {
    // if cfg!(debug_assertions) && name == sym::empty {
    //     crate::span_bug!(span, "called `Ident::new` with empty symbol");
    // }
    return new Ident(name, span);
  }

  /// Constructs a new identifier with a dummy span.
  // rustc: compiler/rustc_span/src/symbol.rs:2506 with_dummy_span
  static with_dummy_span(name: Symbol): Ident {
    return Ident.new(name, DUMMY_SP);
  }

  // For dummy identifiers that are never used and absolutely must be
  // present. Note that this does *not* use the empty symbol; `sym::dummy`
  // makes it clear that it's intended as a dummy value, and is more likely
  // to be detected if it accidentally does get used.
  // rustc: compiler/rustc_span/src/symbol.rs:2515 dummy
  static dummy(): Ident {
    return Ident.with_dummy_span(sym.dummy);
  }

  /// Maps a string to an identifier with a dummy span.
  // rustc: compiler/rustc_span/src/symbol.rs:2520 from_str
  static from_str(string: string): Ident {
    return Ident.with_dummy_span(Symbol.intern(string));
  }

  /// Maps a string and a span to an identifier.
  // rustc: compiler/rustc_span/src/symbol.rs:2526 from_str_and_span
  static from_str_and_span(string: string, span: Span): Ident {
    return Ident.new(Symbol.intern(string), span);
  }

  /// Replaces `lo` and `hi` with those from `span`, but keep hygiene context.
  // rustc: compiler/rustc_span/src/symbol.rs:2531 with_span_pos
  with_span_pos(span: Span): Ident {
    return Ident.new(this.name, Span.with_ctxt(span, Span.ctxt(this.span)));
  }

  /// Creates a new ident with the same span and name with leading quote removed, if any.
  /// Calling it on a `'` ident will return an empty ident, which triggers debug assertions.
  // rustc: compiler/rustc_span/src/symbol.rs:2537 without_first_quote
  without_first_quote(): Ident {
    const s = this.as_str();
    return s.startsWith("'") ? Ident.new(Symbol.intern(s.slice(1)), this.span) : this;
  }

  /// "Normalize" ident for use in comparisons using "item hygiene".
  /// Identifiers with same string value become same if they came from the same macro 2.0 macro
  /// (e.g., `macro` item, but not `macro_rules` item) and stay different if they came from
  /// different macro 2.0 macros.
  /// Technically, this operation strips all non-opaque marks from ident's syntactic context.
  // rustc: compiler/rustc_span/src/symbol.rs:2548 normalize_to_macros_2_0
  normalize_to_macros_2_0(): Ident {
    return Ident.new(this.name, Span.normalize_to_macros_2_0(this.span));
  }

  /// "Normalize" ident for use in comparisons using "local variable hygiene".
  /// Identifiers with same string value become same if they came from the same non-transparent
  /// macro (e.g., `macro` or `macro_rules!` items) and stay different if they came from different
  /// non-transparent macros.
  /// Technically, this operation strips all transparent marks from ident's syntactic context.
  // rustc: compiler/rustc_span/src/symbol.rs:2558 normalize_to_macro_rules
  normalize_to_macro_rules(): Ident {
    return Ident.new(this.name, Span.normalize_to_macro_rules(this.span));
  }

  /// Access the underlying string. This is a slowish operation because it
  /// requires locking the symbol interner.
  ///
  /// Note that the lifetime of the return value is a lie. See
  /// `Symbol::as_str()` for details.
  // rustc: compiler/rustc_span/src/symbol.rs:2567 as_str
  as_str(): string {
    return Symbol.as_str(this.name);
  }

  // impl PartialEq for Ident
  // rustc: compiler/rustc_span/src/symbol.rs:2574 eq
  eq(rhs: Ident): boolean {
    return this.name === rhs.name && Span.eq_ctxt(this.span, rhs.span);
  }

  // impl Hash for Ident
  // PORT: there is no `Hasher` in src/std; `state` receives the values fed to `Hash::hash`
  // in order (a composite map key can be built from them).
  // rustc: compiler/rustc_span/src/symbol.rs:2580 hash
  hash(state: (v: number) => void): void {
    state(this.name);
    state(Span.ctxt(this.span));
  }

  // ---- impl Ident (predicates, defined further down upstream) ----

  /// Returns `true` for reserved identifiers used internally for elided lifetimes,
  /// unnamed method parameters, crate root module, error recovery etc.
  // rustc: compiler/rustc_span/src/symbol.rs:3116 is_special
  is_special(): boolean {
    return Symbol.is_special(this.name);
  }

  /// Returns `true` if the token is a keyword used in the language.
  // rustc: compiler/rustc_span/src/symbol.rs:3121 is_used_keyword
  is_used_keyword(): boolean {
    // Note: `span.edition()` is relatively expensive, don't call it unless necessary.
    return (
      Symbol.is_used_keyword_always(this.name) ||
      Symbol.is_used_keyword_conditional(this.name, () => Span.edition(this.span))
    );
  }

  /// Returns `true` if the token is a keyword reserved for possible future use.
  // rustc: compiler/rustc_span/src/symbol.rs:3128 is_unused_keyword
  is_unused_keyword(): boolean {
    // Note: `span.edition()` is relatively expensive, don't call it unless necessary.
    return (
      Symbol.is_unused_keyword_always(this.name) ||
      Symbol.is_unused_keyword_conditional(this.name, () => Span.edition(this.span))
    );
  }

  /// Returns `true` if the token is either a special identifier or a keyword.
  // rustc: compiler/rustc_span/src/symbol.rs:3135 is_reserved
  is_reserved(): boolean {
    // Note: `span.edition()` is relatively expensive, don't call it unless necessary.
    return Symbol.is_reserved(this.name, () => Span.edition(this.span));
  }

  /// A keyword or reserved identifier that can be used as a path segment.
  // rustc: compiler/rustc_span/src/symbol.rs:3141 is_path_segment_keyword
  is_path_segment_keyword(): boolean {
    return Symbol.is_path_segment_keyword(this.name);
  }

  /// We see this identifier in a normal identifier position, like variable name or a type.
  /// How was it written originally? Did it use the raw form? Let's try to guess.
  // rustc: compiler/rustc_span/src/symbol.rs:3147 is_raw_guess
  is_raw_guess(): boolean {
    return Symbol.can_be_raw(this.name) && this.is_reserved();
  }

  /// Given the name of a lifetime without the first quote (`'`),
  /// returns whether the lifetime name is reserved (therefore invalid)
  // rustc: compiler/rustc_span/src/symbol.rs:3153 is_reserved_lifetime
  is_reserved_lifetime(): boolean {
    return this.is_reserved() && ![kw.Underscore, kw.Static].includes(this.name);
  }

  // rustc: compiler/rustc_span/src/symbol.rs:3157 is_raw_lifetime_guess
  is_raw_lifetime_guess(): boolean {
    // Check that the name isn't just a single quote.
    // `self.without_first_quote()` would return empty ident, which triggers debug assert.
    if (Symbol.as_str(this.name) === "'") {
      return false;
    }
    const ident_without_apostrophe = this.without_first_quote();
    return (
      ident_without_apostrophe.name !== this.name &&
      Symbol.can_be_raw(ident_without_apostrophe.name) &&
      ident_without_apostrophe.is_reserved_lifetime()
    );
  }

  // rustc: compiler/rustc_span/src/symbol.rs:3169 guess_print_mode
  guess_print_mode(): IdentPrintMode {
    if (this.is_raw_lifetime_guess()) {
      return IdentPrintMode.RawLifetime;
    } else if (this.is_raw_guess()) {
      return IdentPrintMode.RawIdent;
    } else {
      return IdentPrintMode.Normal;
    }
  }

  /// Whether this would be the identifier for a tuple field like `self.0`, as
  /// opposed to a named field like `self.thing`.
  // rustc: compiler/rustc_span/src/symbol.rs:3181 is_numeric
  is_numeric(): boolean {
    const s = this.as_str();
    for (let i = 0; i < s.length; i++) {
      const b = s.charCodeAt(i);
      if (!(b >= 0x30 && b <= 0x39)) return false;
    }
    return true;
  }
}

// impl fmt::Debug for Ident
// rustc: compiler/rustc_span/src/symbol.rs:2587 fmt
export const debug_Ident: Debug<Ident> = (v, f) => {
  return display_Ident(v) + debug_SyntaxContext(Span.ctxt(v.span), f);
};

/// This implementation is supposed to be used in error messages, so it's expected to be identical
/// to printing the original identifier token written in source code (`token_to_string`),
/// except that AST identifiers don't keep the rawness flag, so we have to guess it.
// PORT: `Display` impls are `display_<Type>(v): string`; width/fill flags are not supported.
// rustc: compiler/rustc_span/src/symbol.rs:2597 fmt
export function display_Ident(v: Ident): string {
  return display_IdentPrinter(IdentPrinter.new(v.name, v.guess_print_mode(), undefined));
}

export type IdentPrintMode = "Normal" | "RawIdent" | "ForcedKeywordIdent" | "RawLifetime";
export const IdentPrintMode = {
  Normal: "Normal",
  RawIdent: "RawIdent",
  ForcedKeywordIdent: "ForcedKeywordIdent",
  RawLifetime: "RawLifetime",
} as const;

/// The most general type to print identifiers.
///
/// AST pretty-printer is used as a fallback for turning AST structures into token streams for
/// proc macros. Additionally, proc macros may stringify their input and expect it survive the
/// stringification (especially true for proc macro derives written between Rust 1.15 and 1.30).
/// So we need to somehow pretty-print `$crate` in a way preserving at least some of its
/// hygiene data, most importantly name of the crate it refers to.
/// As a result we print `$crate` as `crate` if it refers to the local crate
/// and as `::other_crate_name` if it refers to some other crate.
/// Note, that this is only done if the ident token is printed from inside of AST pretty-printing,
/// but not otherwise. Pretty-printing is the only way for proc macros to discover token contents,
/// so we should not perform this lossy conversion if the top level call to the pretty-printer was
/// done for a token stream or a single token.
export class IdentPrinter {
  constructor(
    public symbol: Symbol,
    public mode: IdentPrintMode,
    /// Span used for retrieving the crate name to which `$crate` refers to,
    /// if this field is `None` then the `$crate` conversion doesn't happen.
    public convert_dollar_crate: Span | undefined,
  ) {}

  /// The most general `IdentPrinter` constructor. Do not use this.
  // rustc: compiler/rustc_span/src/symbol.rs:2632 new
  static new(symbol: Symbol, mode: IdentPrintMode, convert_dollar_crate: Span | undefined): IdentPrinter {
    return new IdentPrinter(symbol, mode, convert_dollar_crate);
  }

  /// This implementation is supposed to be used when printing identifiers
  /// as a part of pretty-printing for larger AST pieces.
  /// Do not use this either.
  // rustc: compiler/rustc_span/src/symbol.rs:2643 for_ast_ident
  static for_ast_ident(ident: Ident, mode: IdentPrintMode): IdentPrinter {
    return IdentPrinter.new(ident.name, mode, ident.span);
  }
}

// impl fmt::Display for IdentPrinter
// rustc: compiler/rustc_span/src/symbol.rs:2649 fmt
export function display_IdentPrinter(v: IdentPrinter): string {
  let f = "";
  let s: Symbol;
  if (v.mode === IdentPrintMode.Normal && v.symbol === kw.DollarCrate && v.convert_dollar_crate !== undefined) {
    const span = v.convert_dollar_crate;
    const converted = SyntaxContext.dollar_crate_name(Span.ctxt(span));
    if (!Symbol.is_path_segment_keyword(converted)) {
      f += "::";
    }
    s = converted;
  } else if (v.mode === IdentPrintMode.Normal) {
    s = v.symbol;
  } else if (v.mode === IdentPrintMode.RawIdent) {
    f += "r#";
    s = v.symbol;
  } else if (v.mode === IdentPrintMode.ForcedKeywordIdent) {
    f += "k#";
    s = v.symbol;
  } else {
    // IdentPrintMode::RawLifetime
    f += "'r#";
    const str = Symbol.as_str(v.symbol);
    if (!str.startsWith("'")) panic("only lifetime idents should be passed with RawLifetime mode");
    s = Symbol.intern(str.slice(1));
  }
  return f + display_Symbol(s);
}

/// A newtype around `Ident` that calls [Ident::normalize_to_macro_rules] on
/// construction for "local variable hygiene" comparisons.
///
/// Use this type when you need to compare identifiers according to macro_rules hygiene.
/// This ensures compile-time safety and avoids manual normalization calls.
export class MacroRulesNormalizedIdent {
  constructor(public _0: Ident) {}

  // rustc: compiler/rustc_span/src/symbol.rs:2694 new
  static new(ident: Ident): MacroRulesNormalizedIdent {
    return new MacroRulesNormalizedIdent(ident.normalize_to_macro_rules());
  }

  // rustc: compiler/rustc_span/src/symbol.rs:2698 symbol
  symbol(): Symbol {
    return this._0.name;
  }

  // rustc: compiler/rustc_span/src/symbol.rs:2702 ident
  ident(): Ident {
    return this._0;
  }
}

// impl fmt::Debug for MacroRulesNormalizedIdent
// rustc: compiler/rustc_span/src/symbol.rs:2708 fmt
export const debug_MacroRulesNormalizedIdent: Debug<MacroRulesNormalizedIdent> = (v, f) => {
  return debug_Ident(v._0, f);
};

// impl fmt::Display for MacroRulesNormalizedIdent
// rustc: compiler/rustc_span/src/symbol.rs:2714 fmt
export function display_MacroRulesNormalizedIdent(v: MacroRulesNormalizedIdent): string {
  return display_Ident(v._0);
}

/// An interned UTF-8 string.
///
/// Internally, a `Symbol` is implemented as an index, and all operations
/// (including hashing, equality, and ordering) operate on that index. The use
/// of `rustc_index::newtype_index!` means that `Option<Symbol>` only takes up 4 bytes,
/// because `rustc_index::newtype_index!` reserves the last 256 values for tagging purposes.
///
/// Note that `Symbol` cannot directly be a `rustc_index::newtype_index!` because it
/// implements `fmt::Debug`, `Encodable`, and `Decodable` in special ways.
// PORT: `Symbol(SymbolIndex)` is a branded number (PORTING §5 interned handles); methods live on
// the companion const `Symbol` (`sym.method()` → `Symbol.method(sym)`). Importing it shadows the
// JS global `Symbol` in the importing module.
export type Symbol = number & { readonly __brand: "Symbol" };

// Used within both `Symbol` and `ByteSymbol`.
// rustc_index::newtype_index! { #[orderable] struct SymbolIndex {} }
// PORT: `SymbolIndex::from_u32` is inlined into `Symbol::new`/`ByteSymbol::new`.
const SymbolIndex_MAX_AS_U32 = 0xffff_ff00;

export const Symbol = {
  /// Avoid this except for things like deserialization of previously
  /// serialized symbols, and testing. Use `intern` instead.
  // rustc: compiler/rustc_span/src/symbol.rs:2740 new
  new(n: number): Symbol {
    assert(n <= SymbolIndex_MAX_AS_U32, "assertion failed: value <= 0xFFFF_FF00");
    return n as Symbol;
  },

  /// Maps a string to its interned representation.
  // rustc: compiler/rustc_span/src/symbol.rs:2747 intern
  intern(str: string): Symbol {
    return with_session_globals((session_globals) => session_globals.symbol_interner.intern_str(str));
  },

  /// Access the underlying string. This is a slowish operation because it
  /// requires locking the symbol interner.
  ///
  /// Note that the lifetime of the return value is a lie. It's not the same
  /// as `&self`, but actually tied to the lifetime of the underlying
  /// interner. Interners are long-lived, and there are very few of them, and
  /// this function is typically used for short-lived things, so in practice
  /// it works out ok.
  // rustc: compiler/rustc_span/src/symbol.rs:2760 as_str
  as_str(self: Symbol): string {
    return with_session_globals((session_globals) => session_globals.symbol_interner.get_str(self));
  },

  // rustc: compiler/rustc_span/src/symbol.rs:2766 as_u32
  as_u32(self: Symbol): number {
    return self;
  },

  // rustc: compiler/rustc_span/src/symbol.rs:2770 is_empty
  is_empty(self: Symbol): boolean {
    return self === sym.empty;
  },

  /// This method is supposed to be used in error messages, so it's expected to be
  /// identical to printing the original identifier token written in source code
  /// (`token_to_string`, `Ident::to_string`), except that symbols don't keep the rawness flag
  /// or edition, so we have to guess the rawness using the global edition.
  // rustc: compiler/rustc_span/src/symbol.rs:2778 to_ident_string
  to_ident_string(self: Symbol): string {
    // Avoid creating an empty identifier, because that asserts in debug builds.
    if (self === sym.empty) {
      return "";
    } else {
      return display_Ident(Ident.with_dummy_span(self));
    }
  },

  /// Checks if `self` is similar to any symbol in `candidates`.
  ///
  /// The returned boolean represents whether the candidate is the same symbol with a different
  /// casing.
  ///
  /// All the candidates are assumed to be lowercase.
  // PORT: `str::to_lowercase` → `String.prototype.toLowerCase` (both locale-independent full
  // Unicode case mapping incl. final sigma; the JS engine's Unicode version may differ).
  // rustc: compiler/rustc_span/src/symbol.rs:2789 find_similar
  find_similar(self: Symbol, candidates: readonly Symbol[]): [Symbol, /* is incorrect case */ boolean] | undefined {
    const lowercase = Symbol.as_str(self).toLowerCase();
    const lowercase_sym = Symbol.intern(lowercase);
    if (candidates.includes(lowercase_sym)) {
      return [lowercase_sym, true];
    } else {
      const similar_sym = find_best_match_for_name(candidates, self, undefined);
      if (similar_sym !== undefined) {
        return [similar_sym, false];
      } else {
        return undefined;
      }
    }
  },

  // impl StableHash for Symbol
  // rustc-skip: compiler/rustc_span/src/symbol.rs:2819 stable_hash StableHash (incremental, out of scope until M5)

  // impl StableCompare for Symbol
  // const CAN_USE_UNSTABLE_SORT: bool = true;
  // PORT: returns `Ordering` as -1/0/1; `str::cmp` is byte-wise, i.e. code point order.
  // rustc: compiler/rustc_span/src/symbol.rs:2827 stable_cmp
  stable_cmp(self: Symbol, other: Symbol): -1 | 0 | 1 {
    return str_cmp(Symbol.as_str(self), Symbol.as_str(other));
  },

  // ---- impl Symbol (predicates, defined further down upstream) ----

  // rustc: compiler/rustc_span/src/symbol.rs:3052 is_special
  is_special(self: Symbol): boolean {
    return self <= kw.Underscore;
  },

  // rustc: compiler/rustc_span/src/symbol.rs:3056 is_used_keyword_always
  is_used_keyword_always(self: Symbol): boolean {
    return self >= kw.As && self <= kw.While;
  },

  // rustc: compiler/rustc_span/src/symbol.rs:3060 is_unused_keyword_always
  is_unused_keyword_always(self: Symbol): boolean {
    return self >= kw.Abstract && self <= kw.Yield;
  },

  // rustc: compiler/rustc_span/src/symbol.rs:3064 is_used_keyword_conditional
  is_used_keyword_conditional(self: Symbol, edition: () => Edition): boolean {
    return self >= kw.Async && self <= kw.Dyn && Edition_discriminant(edition()) >= Edition_discriminant(Edition.Edition2018);
  },

  // rustc: compiler/rustc_span/src/symbol.rs:3068 is_unused_keyword_conditional
  is_unused_keyword_conditional(self: Symbol, edition: () => Edition): boolean {
    return (
      (self === kw.Gen && Edition.at_least_rust_2024(edition())) ||
      (self === kw.Try && Edition.at_least_rust_2018(edition()))
    );
  },

  // rustc: compiler/rustc_span/src/symbol.rs:3073 is_reserved
  is_reserved(self: Symbol, edition: () => Edition): boolean {
    return (
      Symbol.is_special(self) ||
      Symbol.is_used_keyword_always(self) ||
      Symbol.is_unused_keyword_always(self) ||
      Symbol.is_used_keyword_conditional(self, edition) ||
      Symbol.is_unused_keyword_conditional(self, edition)
    );
  },

  // rustc: compiler/rustc_span/src/symbol.rs:3081 is_weak
  is_weak(self: Symbol): boolean {
    return self >= kw.Auto && self <= kw.Yeet;
  },

  /// A keyword or reserved identifier that can be used as a path segment.
  // rustc: compiler/rustc_span/src/symbol.rs:3086 is_path_segment_keyword
  is_path_segment_keyword(self: Symbol): boolean {
    return (
      self === kw.Super ||
      self === kw.SelfLower ||
      self === kw.SelfUpper ||
      self === kw.Crate ||
      self === kw.PathRoot ||
      self === kw.DollarCrate
    );
  },

  /// Returns `true` if the symbol is `true` or `false`.
  // rustc: compiler/rustc_span/src/symbol.rs:3096 is_bool_lit
  is_bool_lit(self: Symbol): boolean {
    return self === kw.True || self === kw.False;
  },

  /// Returns `true` if this symbol can be a raw identifier.
  // rustc: compiler/rustc_span/src/symbol.rs:3101 can_be_raw
  can_be_raw(self: Symbol): boolean {
    return self !== sym.empty && self !== kw.Underscore && !Symbol.is_path_segment_keyword(self);
  },

  /// Was this symbol index predefined in the compiler's `symbols!` macro?
  /// Note: this applies to both `Symbol`s and `ByteSymbol`s, which is why it
  /// takes a `u32` argument instead of a `&self` argument. Use with care.
  // rustc: compiler/rustc_span/src/symbol.rs:3108 is_predefined
  is_predefined(index: number): boolean {
    return index < PREDEFINED_SYMBOLS_COUNT;
  },
};

/** `<str as Ord>::cmp`: byte-wise, which for UTF-8 is code point order. */
function str_cmp(a: string, b: string): -1 | 0 | 1 {
  const ai = a[globalThis.Symbol.iterator]();
  const bi = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

// impl fmt::Debug for Symbol
// rustc: compiler/rustc_span/src/symbol.rs:2806 fmt
export const debug_Symbol: Debug<Symbol> = (v) => {
  return debug_str(Symbol.as_str(v));
};

// impl fmt::Display for Symbol
// rustc: compiler/rustc_span/src/symbol.rs:2812 fmt
export function display_Symbol(v: Symbol): string {
  return Symbol.as_str(v);
}

/// Like `Symbol`, but for byte strings. `ByteSymbol` is used less widely, so
/// it has fewer operations defined than `Symbol`.
export type ByteSymbol = number & { readonly __brand: "ByteSymbol" };

export const ByteSymbol = {
  /// Avoid this except for things like deserialization of previously
  /// serialized symbols, and testing. Use `intern` instead.
  // rustc: compiler/rustc_span/src/symbol.rs:2840 new
  new(n: number): ByteSymbol {
    assert(n <= SymbolIndex_MAX_AS_U32, "assertion failed: value <= 0xFFFF_FF00");
    return n as ByteSymbol;
  },

  /// Maps a string to its interned representation.
  // rustc: compiler/rustc_span/src/symbol.rs:2845 intern
  intern(byte_str: Uint8Array): ByteSymbol {
    return with_session_globals((session_globals) => {
      return session_globals.symbol_interner.intern_byte_str(byte_str);
    });
  },

  /// Like `Symbol::as_str`.
  // rustc: compiler/rustc_span/src/symbol.rs:2852 as_byte_str
  as_byte_str(self: ByteSymbol): Uint8Array {
    return with_session_globals((session_globals) => session_globals.symbol_interner.get_byte_str(self));
  },

  // rustc: compiler/rustc_span/src/symbol.rs:2858 as_u32
  as_u32(self: ByteSymbol): number {
    return self;
  },

  // impl StableHash for ByteSymbol
  // rustc-skip: compiler/rustc_span/src/symbol.rs:2871 stable_hash StableHash (incremental, out of scope until M5)
};

// impl fmt::Debug for ByteSymbol
// rustc: compiler/rustc_span/src/symbol.rs:2864 fmt
export const debug_ByteSymbol: Debug<ByteSymbol> = (v, f) => {
  return debug_bytes(ByteSymbol.as_byte_str(v), f);
};

/** `<[u8] as Debug>::fmt` */
function debug_bytes(b: Uint8Array, f: Fmt): string {
  return debug_list(
    f,
    Array.from(b, (x) => debug_int(x, f)),
  );
}

// PORT: the interner is keyed by JS strings, not byte slices. A byte string that is valid UTF-8
// is keyed by its decoded string (so "foo" and b"foo" share an index, as upstream); one that is
// not is keyed by U+DFFF followed by its bytes as Latin-1 chars. A lone surrogate never occurs in
// a string decoded from valid UTF-8, so the two key spaces cannot collide.
const INVALID_UTF8_KEY = "\udfff";
const utf8_fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function byte_str_key(byte_str: Uint8Array): string {
  try {
    return utf8_fatal.decode(byte_str);
  } catch {
    let key = INVALID_UTF8_KEY;
    for (const b of byte_str) key += String.fromCharCode(b);
    return key;
  }
}

function key_bytes(key: string): Uint8Array {
  if (!key.startsWith(INVALID_UTF8_KEY)) return utf8(key);
  return Uint8Array.from(key.slice(INVALID_UTF8_KEY.length), (c) => c.charCodeAt(0));
}

// The `&'static [u8]`s in this type actually point into the arena.
//
// This type is private to prevent accidentally constructing more than one
// `Interner` on the same thread, which makes it easy to mix up `Symbol`s
// between `Interner`s.
// PORT: `arena: DroplessArena` is erased; `indices: HashTable<(&[u8], u32)>` is a `Map` from
// key to index; `byte_strs` holds the keys.
interface InternerInner {
  indices: Map<string, number>;
  byte_strs: string[];
}

// Interner used for both `Symbol`s and `ByteSymbol`s. If a string and a byte
// string with identical contents (e.g. "foo" and b"foo") are both interned,
// only one copy will be stored and the resulting `Symbol` and `ByteSymbol`
// will have the same index.
export class Interner {
  constructor(public _0: InternerInner) {}

  /// Creates an `Interner` with the predefined symbols from the `symbols!` macro and
  /// any extra symbols provided by external drivers such as Clippy
  // PORT: generated by the `symbols!` macro (compiler/rustc_macros/src/symbols.rs); the prefill
  // list comes from ./symbol.gen.ts.
  static with_extra_symbols(extra_symbols: readonly string[]): Interner {
    return Interner.prefill(PREFILL, extra_symbols);
  }

  // These arguments are `&str`, but because of the sharing, we are
  // effectively pre-interning all these strings for both `Symbol` and
  // `ByteSymbol`.
  // rustc: compiler/rustc_span/src/symbol.rs:2897 prefill
  static prefill(init: readonly string[], extra: readonly string[]): Interner {
    const values = [...init, ...extra];
    const conflicting_values: string[] = [];

    const indices = new Map<string, number>();

    const byte_strs: string[] = [];

    for (const v of values) {
      const occupied = indices.get(v);
      if (occupied !== undefined) {
        conflicting_values.push(v);
      } else {
        indices.set(v, byte_strs.length);
        byte_strs.push(v);
      }
    }

    if (conflicting_values.length !== 0) {
      panic(
        `duplicate symbols in the rustc symbol list and the extra symbols added by the driver: ${debug_vec(
          conflicting_values.map(key_bytes),
          PLAIN,
          debug_bytes,
        )}`,
      );
    }

    return new Interner({ indices, byte_strs });
  }

  // rustc: compiler/rustc_span/src/symbol.rs:2928 intern_str
  intern_str(str: string): Symbol {
    return Symbol.new(this.intern_inner(str));
  }

  // rustc: compiler/rustc_span/src/symbol.rs:2932 intern_byte_str
  intern_byte_str(byte_str: Uint8Array): ByteSymbol {
    return ByteSymbol.new(this.intern_inner(byte_str_key(byte_str)));
  }

  // PORT: takes the interner key of the byte string (see `byte_str_key`).
  // rustc: compiler/rustc_span/src/symbol.rs:2937 intern_inner
  intern_inner(byte_str: string): number {
    const inner = this._0;
    const v = inner.indices.get(byte_str);
    if (v !== undefined) {
      return v;
    } else {
      const idx = inner.byte_strs.length;
      inner.indices.set(byte_str, idx);
      inner.byte_strs.push(byte_str);
      return idx;
    }
  }

  /// Get the symbol as a string.
  ///
  /// [`Symbol::as_str()`] should be used in preference to this function.
  // rustc: compiler/rustc_span/src/symbol.rs:2966 get_str
  get_str(symbol: Symbol): string {
    const byte_str = this.get_inner(symbol);
    // SAFETY: known to be a UTF8 string because it's a `Symbol`.
    // PORT: upstream is UB for a `Symbol` made from a non-UTF-8 `ByteSymbol` index; we panic.
    if (byte_str.startsWith(INVALID_UTF8_KEY)) panic("Symbol index refers to a non-UTF-8 byte string");
    return byte_str;
  }

  /// Get the symbol as a string.
  ///
  /// [`ByteSymbol::as_byte_str()`] should be used in preference to this function.
  // rustc: compiler/rustc_span/src/symbol.rs:2975 get_byte_str
  get_byte_str(symbol: ByteSymbol): Uint8Array {
    return key_bytes(this.get_inner(symbol));
  }

  // PORT: returns the interner key (see `byte_str_key`).
  // rustc: compiler/rustc_span/src/symbol.rs:2979 get_inner
  get_inner(index: number): string {
    const s = this._0.byte_strs[index];
    if (s === undefined) panic(`index out of bounds: the len is ${this._0.byte_strs.length} but the index is ${index}`);
    return s;
  }
}

// This module has a very short name because it's used a lot.
/// This module contains all the defined keyword `Symbol`s.
///
/// Given that `kw` is imported, use them like `kw::keyword_name`.
/// For example `kw::Loop` or `kw::Break`.
export const kw = kw_generated;

/// Get the symbol for an integer.
///
/// The first few non-negative integers each have a static symbol and therefore
/// are fast.
// rustc: compiler/rustc_span/src/symbol.rs:3022 integer
function integer(n: number | bigint): Symbol {
  // `n.try_into::<usize>()` succeeds for every non-negative integer that matters here.
  if (n >= 0) {
    const idx = Number(n);
    if (idx < 10) {
      return Symbol.new(SYMBOL_DIGITS_BASE + idx);
    }
  }
  // itoa::Buffer::format
  const printed = n.toString();
  return Symbol.intern(printed);
}

// rustc: compiler/rustc_span/src/symbol.rs:3033 ascii_letter_digit
function ascii_letter_digit(c: number): Symbol | undefined {
  const i = c;
  let n: number;
  if (c >= 0x30 && c <= 0x39) n = SYMBOL_DIGITS_BASE + (i - 0x30);
  else if (c >= 0x41 && c <= 0x5a) n = SYMBOL_UPPERCASE_LETTERS_BASE + (i - 0x41);
  else if (c >= 0x61 && c <= 0x7a) n = SYMBOL_LOWERCASE_LETTERS_BASE + (i - 0x61);
  else return undefined;
  return Symbol.new(n);
}

// rustc: compiler/rustc_span/src/symbol.rs:3043 character
function character(c: number): Symbol {
  const s = ascii_letter_digit(c);
  return s !== undefined ? s : Symbol.intern(String.fromCodePoint(c));
}

// This module has a very short name because it's used a lot.
/// This module contains all the defined non-keyword `Symbol`s.
///
/// Given that `sym` is imported, use them like `sym::symbol_name`.
/// For example `sym::rustfmt` or `sym::u8`.
// PORT: explicit items shadow the `sym_generated::*` glob import, so they come after the spread.
export const sym = {
  ...sym_generated,
  // Used from a macro in `librustc_feature/accepted.rs`
  macro_rules: kw.MacroRules,

  // Used quite often in relation to C ABI.
  C: unwrap(ascii_letter_digit(0x43)),

  // RISC-V stuff
  f: unwrap(ascii_letter_digit(0x66)),
  d: unwrap(ascii_letter_digit(0x64)),

  integer,
  ascii_letter_digit,
  character,
} as const;

STDLIB_STABLE_CRATES = [sym.std, sym.core, sym.alloc, sym.proc_macro];

/// Collect all the keywords in a given edition into a vector.
///
/// *Note:* Please update this if a new keyword is added beyond the current
/// range.
// rustc: compiler/rustc_span/src/symbol.rs:3190 used_keywords
export function used_keywords(edition: () => Edition): Symbol[] {
  const out: Symbol[] = [];
  for (let k = Symbol.as_u32(kw.DollarCrate); k < Symbol.as_u32(kw.Yeet); k++) {
    const kw_ = Symbol.new(k);
    if (Symbol.is_used_keyword_always(kw_) || Symbol.is_used_keyword_conditional(kw_, edition)) {
      out.push(kw_);
    }
  }
  return out;
}
