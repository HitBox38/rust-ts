// Port of compiler/rustc_type_ir/src/ty/alias.rs (lane tyir-misc, sub-lane lib-sty). The types with their derived
// Debug / TypeVisitable / TypeFoldable impls are generated into alias.gen.ts (set rustc_ty of tools/codegen/types.ts);
// this file holds the inherent methods.
// PORT: methods of the generic struct `Alias<I, K>` live on the companion const `Alias` taking `self` first (tyir-kind
// decision 1); the impls on its instances (`AliasTy`, `ProjectionAliasTy`, ...) are in ty_kind.ts / const_kind.ts /
// term_kind.ts.
import type { Interner } from "../interner.ts";
import type { Alias as AliasT } from "./alias.gen.ts";

export * from "./alias.gen.ts";

export type Alias<K> = AliasT<K>;
export const Alias = {
  // rustc: compiler/rustc_type_ir/src/ty/alias.rs:47 kind
  kind<K>(self: Alias<K>, _interner: Interner): K {
    return self.kind;
  },
};
