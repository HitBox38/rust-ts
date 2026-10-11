// STUB from root (contract: docs/contracts/rustc_span.md). Owned by lane span-hygiene: replace entirely.
import type { Edition } from "./edition.ts";

export type SyntaxContext = number & { readonly __brand: "SyntaxContext" };
export type LocalExpnId = number & { readonly __brand: "LocalExpnId" };

export declare class ExpnId {
  krate: unknown;
  local_id: unknown;
}

export declare class HygieneData {
  static new(edition: Edition): HygieneData;
}
