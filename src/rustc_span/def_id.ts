// STUB from root (contract: docs/contracts/rustc_span.md). Owned by lane span-hygiene: replace entirely.
export type CrateNum = number & { readonly __brand: "CrateNum" };
export type DefIndex = number & { readonly __brand: "DefIndex" };

export declare class DefId {
  krate: CrateNum;
  index: DefIndex;
}

export declare class LocalDefId {
  local_def_index: DefIndex;
}
