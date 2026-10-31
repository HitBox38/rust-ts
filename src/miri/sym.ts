// Port of src/tools/miri/src/sym.rs (crate `miri`, plan-m6 D2; lane miri-contract, wave 35): Miri's extra symbols.
//
// PORT: the file's `val!` / `generate!` macros are expanded by hand (3 symbols): `EXTRA_SYMBOLS` lists the names (given to
// `rustc_interface::Config.extra_symbols` by bin/miri.rs), and symbol `i` of the list is
// `Symbol::new(PREDEFINED_SYMBOLS_COUNT + i)` (`${index()}`), the index the session's interner gives the i-th extra symbol.
// `pub use rustc_span::sym::*` is the `sym` table below (rustc_span's `sym` spread, then Miri's own, as rustc_span's
// own `sym` table is built: explicit items after the glob).
import { PREDEFINED_SYMBOLS_COUNT, Symbol, sym as rustc_span_sym } from "../rustc_span/symbol.ts";

// List of extra symbols to be included in Miri.
// An alternative content can be specified using a colon after the symbol name.
// generate! { sys_mutex_lock, sys_mutex_try_lock, sys_mutex_unlock, }

/// To be supplied to `rustc_interface::Config`
export const EXTRA_SYMBOLS: readonly string[] = ["sys_mutex_lock", "sys_mutex_try_lock", "sys_mutex_unlock"];

export const sys_mutex_lock: Symbol = Symbol.new(PREDEFINED_SYMBOLS_COUNT + 0);
export const sys_mutex_try_lock: Symbol = Symbol.new(PREDEFINED_SYMBOLS_COUNT + 1);
export const sys_mutex_unlock: Symbol = Symbol.new(PREDEFINED_SYMBOLS_COUNT + 2);

/** `miri::sym::*`: every rustc_span `sym::*` symbol plus Miri's extra ones. */
export const sym = { ...rustc_span_sym, sys_mutex_lock, sys_mutex_try_lock, sys_mutex_unlock } as const;
