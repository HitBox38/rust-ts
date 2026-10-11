// STUB from root (contract: docs/contracts/rustc_span.md). Owned by lane span-core: replace entirely.
import { unported } from "../std/panic.ts";
import type { HygieneData, SyntaxContext } from "./hygiene.ts";
import type { Interner } from "./symbol.ts";
import type { Edition } from "./edition.ts";
import type { Span } from "./span_encoding.ts";
export type { Span };

export type BytePos = number & { readonly __brand: "BytePos" };
export type CharPos = number & { readonly __brand: "CharPos" };
export type RelativeBytePos = number & { readonly __brand: "RelativeBytePos" };

export declare class SpanData {
  lo: BytePos;
  hi: BytePos;
  ctxt: SyntaxContext;
  parent: unknown;
}

export declare class SessionGlobals {
  symbol_interner: Interner;
  hygiene_data: HygieneData;
  source_map: unknown;
}

export function with_session_globals<R>(_f: (g: SessionGlobals) => R): R {
  unported("rustc_span::with_session_globals");
}

export function create_session_globals_then<R>(_edition: Edition, _extra_symbols: readonly string[], _sm_inputs: unknown, _f: () => R): R {
  unported("rustc_span::create_session_globals_then");
}

export function create_default_session_globals_then<R>(_f: () => R): R {
  unported("rustc_span::create_default_session_globals_then");
}
