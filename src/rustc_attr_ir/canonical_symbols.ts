// Port of compiler/rustc_attr_ir/src/canonical_symbols.rs
// Types and derived Debug/Clone impls are generated into canonical_symbols.gen.ts (tools/codegen/types.ts).
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import * as gen from "./canonical_symbols.gen.ts";
import { type CanonicalSymbol, clone_CanonicalSymbol } from "./canonical_symbols.gen.ts";

export * from "./canonical_symbols.gen.ts";

declare module "./canonical_symbols.gen.ts" {
  interface CanonicalSymbols {
    get(symbol: Symbol): CanonicalSymbol | undefined;
    set(symbol: Symbol, def_id: DefId): DefId | undefined;
    iter(): IterableIterator<CanonicalSymbol>;
  }
}

export type CanonicalSymbols = gen.CanonicalSymbols;
export const CanonicalSymbols = gen.CanonicalSymbols as typeof gen.CanonicalSymbols & {
  new: () => CanonicalSymbols;
};

/// Construct an empty collection of canonical symbols
// rustc: compiler/rustc_attr_ir/src/canonical_symbols.rs:20 new
CanonicalSymbols.new = function (): CanonicalSymbols {
  return new gen.CanonicalSymbols(new Map());
};

// rustc: compiler/rustc_attr_ir/src/canonical_symbols.rs:24 get
CanonicalSymbols.prototype.get = function (this: CanonicalSymbols, symbol: Symbol): CanonicalSymbol | undefined {
  const s = this.symbols.get(symbol);
  return s === undefined ? undefined : clone_CanonicalSymbol(s);
};

// rustc: compiler/rustc_attr_ir/src/canonical_symbols.rs:28 set
CanonicalSymbols.prototype.set = function (this: CanonicalSymbols, symbol: Symbol, def_id: DefId): DefId | undefined {
  // PORT: `IndexMap::insert` returns the previous value; a JS `Map` keeps the key's position too.
  const preexisting = this.symbols.get(symbol);
  this.symbols.set(symbol, { def_id, symbol });

  if (preexisting !== undefined) {
    return !DefId_eq(preexisting.def_id, def_id) ? preexisting.def_id : undefined;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_attr_ir/src/canonical_symbols.rs:38 iter
CanonicalSymbols.prototype.iter = function* (this: CanonicalSymbols): IterableIterator<CanonicalSymbol> {
  for (const s of this.symbols.values()) yield clone_CanonicalSymbol(s);
};
