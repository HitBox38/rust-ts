// STUB from root (contract: docs/contracts/rustc_span.md). Owned by lane span-symbol: replace entirely.
import type { Span } from "./span_encoding.ts";

export type Symbol = number & { readonly __brand: "Symbol" };

export declare class Ident {
  name: Symbol;
  span: Span;
}

export declare class Interner {
  static prefill(init: readonly string[], extra: readonly string[]): Interner;
  intern(string: string): Symbol;
  get(symbol: Symbol): string;
}
