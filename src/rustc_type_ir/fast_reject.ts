// Partial port of compiler/rustc_type_ir/src/fast_reject.rs: `SimplifiedType` (type, derived Debug / Clone /
// Decodable_NoContext / Encodable_NoContext / StableHash, all generated into fast_reject.gen.ts and
// stable_hash.gen.ts) and `SimplifiedType::def`. Crate metadata decodes `SimplifiedType<DefId>` as the keys of
// `incoherent_impls` and the self types of `trait_impls` (rmeta decoder.rs). `simplify_type` and `DeepRejectCtxt`
// work on `I::Ty` and are M3.
import * as gen from "./fast_reject.gen.ts";

export * from "./fast_reject.gen.ts";

export type SimplifiedType<DefId> = gen.SimplifiedType<DefId>;
export const SimplifiedType = {
  ...gen.SimplifiedType,

  // rustc: compiler/rustc_type_ir/src/fast_reject.rs:151 def
  def<DefId>(self: SimplifiedType<DefId>): DefId | undefined {
    switch (self.$) {
      case "Adt":
      case "Foreign":
      case "Trait":
      case "Closure":
      case "Coroutine":
      case "CoroutineWitness":
        return self._0;
      default:
        return undefined;
    }
  },
};

/**
 * PORT: `#[derive(PartialEq, Eq, Hash)]` of `SimplifiedType<DefId>` as a JS map key (rust_ts/keyed.ts `KeyedMap`):
 * the variant name plus its field, the `DefId` through `key_DefId`. Equal exactly when the Rust values are `==`.
 */
export function SimplifiedType_key<DefId>(self: SimplifiedType<DefId>, key_DefId: (d: DefId) => string | number): string {
  switch (self.$) {
    case "Int":
    case "Uint":
    case "Float":
    case "Ref":
    case "Ptr":
    case "Tuple":
    case "Function":
      return `${self.$}(${self._0})`;
    case "Adt":
    case "Foreign":
    case "Trait":
    case "Closure":
    case "Coroutine":
    case "CoroutineWitness":
      return `${self.$}(${key_DefId(self._0)})`;
    default:
      return self.$;
  }
}
