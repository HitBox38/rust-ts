// Port of compiler/rustc_transmute/src/maybe_transmutable/query_context.rs (lane transmute, wave 30).
//
// PORT: the trait `QueryContext` (associated types only) is the table `QueryContext<D, R, T>`: its `Def` is the
// `layout::Def` impl of the associated type `Def`; `Region` / `Type` are erased (lib.ts crate comment). A
// `MaybeTransmutableQuery<Tree, C>` takes the table of its `C` (maybe_transmutable/mod.ts). `#[cfg(test)] pub(crate)
// mod test` is ported (the crate's unit tests use it) as the namespace `test`.

import type { Region } from "../../rustc_middle/ty/decls.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Debug } from "../../std/fmt.ts";
import { type Def, rustc } from "../layout/mod.ts";

/// Context necessary to answer the question "Are these types transmutable?".
export interface QueryContext<D, R, T> {
  /** `type Def: layout::Def;` (the impl table) */
  readonly Def: Def<D>;
  // type Region: layout::Region;
  // type Type: layout::Type;
  /** PORT: phantom fields carrying `R` / `T` (erased). */
  readonly _R?: R;
  readonly _T?: T;
}

// #[cfg(test)]
export namespace test {
  // use std::marker::PhantomData;

  export class UltraMinimal<R = never, T = never> {
    /** `PhantomData<(R, T)>` */
    readonly _0?: [R, T];

    // impl<R, T> Default for UltraMinimal<R, T>
    // rustc: compiler/rustc_transmute/src/maybe_transmutable/query_context.rs:19 default
    static default_<R = never, T = never>(): UltraMinimal<R, T> {
      return new UltraMinimal();
    }
  }

  // #[derive(Debug, Hash, Eq, PartialEq, Clone, Copy)]
  export type Def = "HasSafetyInvariants" | "NoSafetyInvariants";
  export const Def = {
    HasSafetyInvariants: "HasSafetyInvariants",
    NoSafetyInvariants: "NoSafetyInvariants",
  } as const;
  // derive(Debug)
  export const debug_Def: Debug<Def> = (v) => v;

  // impl crate::layout::Def for Def
  export const Def_Def: import("../layout/mod.ts").Def<Def> = {
    // rustc: compiler/rustc_transmute/src/maybe_transmutable/query_context.rs:31 has_safety_invariants
    has_safety_invariants(self: Def): boolean {
      return self === Def.HasSafetyInvariants;
    },
  };

  // impl<R, T> QueryContext for UltraMinimal<R, T>
  export function QueryContext_UltraMinimal<R, T>(): QueryContext<Def, R, T> {
    return { Def: Def_Def };
  }
}

// ---- #[cfg(feature = "rustc")] mod rustc ----
// impl<'tcx> super::QueryContext for TyCtxt<'tcx>
export const QueryContext_TyCtxt: QueryContext<rustc.Def, Region, Ty> = {
  Def: rustc.Def_Def,
};
