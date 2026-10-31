// Port of library/proc_macro/src/bridge/symbol.rs
//
//! Client-side interner used for symbols.
//!
//! This is roughly based on the symbol interner from `rustc_span` and the
//! DroplessArena from `rustc_arena`. It is unfortunately a complete
//! copy/re-implementation rather than a dependency as it is difficult to depend
//! on crates from within `proc_macro`, due to it being built at the same time
//! as `std`.
//!
//! If at some point in the future it becomes easier to add dependencies to
//! proc_macro, this module should probably be removed or simplified.
//
// PORT: `Symbol(NonZero<u32>)` is a branded number (PORTING §5 interned handles); its methods live on the
// companion const. The `thread_local!` `INTERNER` is a module-level value (PORTING "Global state");
// `RefCell::with_borrow` / `with_borrow_mut` keep RefCell's borrow check (core's panic texts).

import { debug_str, type Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic } from "../../std/panic.ts";
import { Err, type Result } from "../../std/result.ts";
import { Arena } from "./arena.ts";
import type { Buffer } from "./buffer.ts";
import { Methods } from "./client.ts";
import type { FxHashMap } from "./fxhash.ts";
import { decode_str, encode_str } from "./rpc.ts";
import type { HandleStore } from "./server.ts";

/// Handle for a symbol string stored within the Interner.
// std-type: library/proc_macro/src/bridge/symbol.rs:20 Symbol
export type Symbol = number & { readonly __brand: "proc_macro::bridge::symbol::Symbol" };

export const Symbol = {
  /// Intern a new `Symbol`
  // std: library/proc_macro/src/bridge/symbol.rs:27 new
  new(string: string): Symbol {
    return with_borrow_mut((i) => i.intern(string));
  },

  /// Creates a new `Symbol` for an identifier.
  ///
  /// Validates and normalizes before converting it to a symbol.
  // std: library/proc_macro/src/bridge/symbol.rs:34 new_ident
  new_ident(string: string, is_raw: boolean): Symbol {
    // Fast-path: check if this is a valid ASCII identifier
    if (Symbol.is_valid_ascii_ident(string) || string === "$crate") {
      if (is_raw && !Symbol.can_be_raw(string)) {
        panic(`\`${string}\` cannot be a raw identifier`);
      }
      return Symbol.new(string);
    }

    // Slow-path: If the string is already ASCII we're done, otherwise ask
    // our server to do this for us over RPC.
    // We don't need to check for identifiers which can't be raw here,
    // because all of them are ASCII.
    const r: Result<Symbol, undefined> = is_ascii_str(string) ? Err(undefined) : Methods.symbol_normalize_and_validate_ident(string);
    if (r.$ === "Err") panic(`\`${debug_str(string)}\` is not a valid identifier`);
    return r._0;
  },

  /// Run a callback with the symbol's string value.
  // std: library/proc_macro/src/bridge/symbol.rs:56 with
  with<R>(self: Symbol, f: (s: string) => R): R {
    return with_borrow((i) => f(i.get(self)));
  },

  /// Clear out the thread-local symbol interner, making all previously
  /// created symbols invalid such that `with` will panic when called on them.
  // std: library/proc_macro/src/bridge/symbol.rs:62 invalidate_all
  invalidate_all(): void {
    with_borrow_mut((i) => i.clear());
  },

  /// Checks if the ident is a valid ASCII identifier.
  ///
  /// This is a short-circuit which is cheap to implement within the
  /// proc-macro client to avoid RPC when creating simple idents, but may
  /// return `false` for a valid identifier if it contains non-ASCII
  /// characters.
  // std: library/proc_macro/src/bridge/symbol.rs:72 is_valid_ascii_ident
  // PORT: takes the `&str` whose `as_bytes()` upstream passes; non-ASCII chars are never valid here, so testing
  // UTF-16 code units is the same as testing UTF-8 bytes.
  is_valid_ascii_ident(bytes: string): boolean {
    const first = bytes.charCodeAt(0);
    if (!(bytes.length > 0 && (first === 0x5f || is_ascii_lower(first) || is_ascii_upper(first)))) return false;
    for (let k = 1; k < bytes.length; k++) {
      const b = bytes.charCodeAt(k);
      if (!(b === 0x5f || is_ascii_lower(b) || is_ascii_upper(b) || (b >= 0x30 && b <= 0x39))) return false;
    }
    return true;
  },

  // Mimics the behavior of `Symbol::can_be_raw` from `rustc_span`
  // std: library/proc_macro/src/bridge/symbol.rs:80 can_be_raw
  can_be_raw(string: string): boolean {
    return !(
      string === "_" ||
      string === "super" ||
      string === "self" ||
      string === "Self" ||
      string === "crate" ||
      string === "$crate"
    );
  },
};

// impl fmt::Debug for Symbol
// std: library/proc_macro/src/bridge/symbol.rs:86 fmt
export const debug_Symbol: Debug<Symbol> = (v) => Symbol.with(v, (s) => debug_str(s));

// impl fmt::Display for Symbol
// std: library/proc_macro/src/bridge/symbol.rs:92 fmt
export function display_Symbol(v: Symbol): string {
  return Symbol.with(v, (s) => s);
}

// impl<S> Encode<S> for Symbol
// std: library/proc_macro/src/bridge/symbol.rs:98 encode
export function encode_Symbol<S>(self: Symbol, w: Buffer, s: S): void {
  Symbol.with(self, (sym) => encode_str(sym, w, s));
}

// impl<S: server::Server> Decode<'_, '_, server::HandleStore<S>> for server::MarkedSymbol<S>
// std: library/proc_macro/src/bridge/symbol.rs:104 decode
export function decode_MarkedSymbol<TS, Sp, Sy>(r: MutRef<Uint8Array>, s: HandleStore<TS, Sp, Sy>): Sy {
  return s.S.intern_symbol(decode_str(r, s));
}

// impl<S: server::Server> Encode<server::HandleStore<S>> for server::MarkedSymbol<S>
// std: library/proc_macro/src/bridge/symbol.rs:110 encode
export function encode_MarkedSymbol<TS, Sp, Sy>(self: Sy, w: Buffer, s: HandleStore<TS, Sp, Sy>): void {
  s.S.with_symbol_string(self, (sym) => encode_str(sym, w, s));
}

// impl<S> Decode<'_, '_, S> for Symbol
// std: library/proc_macro/src/bridge/symbol.rs:116 decode
export function decode_Symbol<S>(r: MutRef<Uint8Array>, s: S): Symbol {
  return Symbol.new(decode_str(r, s));
}

/// Basic interner for a `Symbol`, inspired by the one in `rustc_span`.
// std-type: library/proc_macro/src/bridge/symbol.rs:132 Interner
class Interner {
  constructor(
    public arena: Arena,
    // SAFETY: These `'static` lifetimes are actually references to data owned
    // by the Arena. This is safe, as we never return them as static references
    // from `Interner`.
    public names: FxHashMap<string, Symbol>,
    public strings: string[],
    // The offset to apply to symbol names stored in the interner. This is used
    // to ensure that symbol names are not re-used after the interner is
    // cleared.
    public sym_base: number,
  ) {}

  // std: library/proc_macro/src/bridge/symbol.rs:146 intern
  intern(string: string): Symbol {
    const found = this.names.get(string);
    if (found !== undefined) {
      return found;
    }

    // `self.sym_base.checked_add(self.strings.len() as u32).expect(..)`
    const sum = this.sym_base + this.strings.length;
    if (sum > 0xffff_ffff) panic("`proc_macro` symbol name overflow");
    const name = sum as Symbol;

    const s = this.arena.alloc_str(string);

    // SAFETY: we can extend the arena allocation to `'static` because we
    // only access these while the arena is still alive.
    this.strings.push(s);
    this.names.set(s, name);
    return name;
  }

  /// Reads a symbol's value from the store while it is held.
  // std: library/proc_macro/src/bridge/symbol.rs:168 get
  get(symbol: Symbol): string {
    // NOTE: Subtract out the offset which was added to make the symbol
    // nonzero and prevent symbol name re-use.
    // `.checked_sub(self.sym_base.get()).expect(..)`
    if (symbol < this.sym_base) panic("use-after-free of `proc_macro` symbol");
    const name = symbol - this.sym_base;
    // `self.strings[name as usize]`
    if (name >= this.strings.length) panic(`index out of bounds: the len is ${this.strings.length} but the index is ${name}`);
    return this.strings[name]!;
  }

  /// Clear all symbols from the store, invalidating them such that `get` will
  /// panic if they are accessed in the future.
  // std: library/proc_macro/src/bridge/symbol.rs:181 clear
  clear(): void {
    // NOTE: Be careful not to panic here, as we may be called on the client
    // when a `catch_unwind` isn't installed.
    // `self.sym_base.saturating_add(self.strings.len() as u32)`
    this.sym_base = Math.min(this.sym_base + this.strings.length, 0xffff_ffff);
    this.names.clear();
    this.strings.length = 0;

    // SAFETY: This is cleared after the names and strings tables are
    // cleared out, so no references into the arena should remain.
    this.arena = Arena.new();
  }
}

// thread_local! { static INTERNER: RefCell<Interner> = .. }
const INTERNER: Interner = new Interner(
  Arena.new(),
  new Map(),
  [],
  // Start with a base of 1 to make sure that `NonZero<u32>` works.
  1,
);
/** The `RefCell` borrow flag of `INTERNER`: > 0 shared borrows, -1 a mutable borrow. */
let INTERNER_borrow = 0;

/** `INTERNER.with_borrow(f)` */
function with_borrow<R>(f: (i: Interner) => R): R {
  if (INTERNER_borrow < 0) panic("already mutably borrowed: BorrowError");
  INTERNER_borrow += 1;
  try {
    return f(INTERNER);
  } finally {
    INTERNER_borrow -= 1;
  }
}

/** `INTERNER.with_borrow_mut(f)` */
function with_borrow_mut<R>(f: (i: Interner) => R): R {
  if (INTERNER_borrow !== 0) panic("already borrowed: BorrowMutError");
  INTERNER_borrow = -1;
  try {
    return f(INTERNER);
  } finally {
    INTERNER_borrow = 0;
  }
}

/** `str::is_ascii` */
function is_ascii_str(s: string): boolean {
  for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) > 0x7f) return false;
  return true;
}

function is_ascii_lower(b: number): boolean {
  return b >= 0x61 && b <= 0x7a;
}

function is_ascii_upper(b: number): boolean {
  return b >= 0x41 && b <= 0x5a;
}
