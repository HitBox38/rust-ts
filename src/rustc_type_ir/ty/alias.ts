// Port of compiler/rustc_type_ir/src/ty/alias.rs (lane tyir-misc, sub-lane lib-sty). The types with their derived
// Debug / TypeVisitable / TypeFoldable impls are generated into alias.gen.ts (set rustc_ty of tools/codegen/types.ts);
// this file holds the inherent methods.
// PORT: methods of the generic struct `Alias<I, K>` live on the companion const `Alias` taking `self` first (tyir-kind
// decision 1); the impls on its instances (`AliasTy`, `ProjectionAliasTy`, ...) are in ty_kind.ts / const_kind.ts /
// term_kind.ts.
import type { Fmt } from "../../std/fmt.ts";
import type { Interner } from "../interner.ts";
import { debug_AliasTermKind } from "../term_kind.gen.ts";
import { type Alias as AliasT, type AliasTerm, debug_Alias } from "./alias.gen.ts";

export * from "./alias.gen.ts";

export type Alias<K> = AliasT<K>;
export const Alias = {
  // rustc: compiler/rustc_type_ir/src/ty/alias.rs:47 kind
  kind<K>(self: Alias<K>, _interner: Interner): K {
    return self.kind;
  },
};

/**
 * `{:?}` of `AliasTerm` (`Alias<I, AliasTermKind>`): the derived Debug of `Alias` (alias.rs:21) over `AliasTermKind`'s.
 * PORT: the hand alias the codegen type map names for `rustc_middle::ty::AliasTerm` (middle_traits_thir.typemap.json);
 * a function declaration, so it is safe at load inside the module cycle with term_kind.ts.
 */
export function debug_AliasTerm(v: AliasTerm, f: Fmt): string {
  return debug_Alias(v, f, debug_AliasTermKind);
}
