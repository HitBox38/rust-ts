// Port of compiler/rustc_type_ir/src/opaque_ty.rs (lane tyir-misc, sub-lane lib-sty). The types with their derived
// Debug / TypeVisitable / TypeFoldable impls are generated into opaque_ty.gen.ts (set rustc_ty of
// tools/codegen/types.ts); this file holds the inherent methods.
// PORT: methods of the generated struct `OpaqueTypeKey` live on a same-named companion const taking `self` first
// (tyir-kind decision 1). `cx: I` is `TyCtxt` (the body calls rustc_middle's `mk_args_from_iter`, D3). The returned /
// consumed iterators stay lazy (generators), so the `panic!` happens when the item is reached, as upstream.
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { panic } from "../std/panic.ts";
import type { Variance } from "./lib.ts";
import type { OpaqueTypeKey as OpaqueTypeKeyT } from "./opaque_ty.gen.ts";
import type { Region } from "./sty/mod.ts";

export * from "./opaque_ty.gen.ts";

export type OpaqueTypeKey = OpaqueTypeKeyT;
export const OpaqueTypeKey = {
  // rustc: compiler/rustc_type_ir/src/opaque_ty.rs:23 iter_captured_args
  iter_captured_args(self: OpaqueTypeKey, cx: TyCtxt): Iterable<[number, GenericArg]> {
    // PORT: `I::VariancesOf` is `&[Variance]` (interner.ts header); the `variances_of` query serves it.
    const variances = cx.variances_of(LocalDefId.to_def_id(self.def_id)) as readonly Variance[];
    const args = self.args;
    return (function* () {
      // `zip(self.args.iter(), variances.iter()).enumerate().filter_map(..)`
      const n = Math.min(args.length, variances.length);
      for (let i = 0; i < n; i++) {
        const arg = args[i]!;
        const v = variances[i]!;
        const k = GenericArg.kind(arg);
        if (v === "Invariant") {
          yield [i, arg] as [number, GenericArg];
        } else if (k.$ === "Lifetime" && v === "Bivariant") {
          continue;
        } else {
          panic("unexpected opaque type arg variance");
        }
      }
    })();
  },

  // rustc: compiler/rustc_type_ir/src/opaque_ty.rs:34 fold_captured_lifetime_args
  fold_captured_lifetime_args(self: OpaqueTypeKey, cx: TyCtxt, f: (r: Region) => Region): OpaqueTypeKey {
    const { def_id, args } = self;
    const variances = cx.variances_of(LocalDefId.to_def_id(def_id)) as readonly Variance[];
    const args2 = (function* () {
      const n = Math.min(args.length, variances.length);
      for (let i = 0; i < n; i++) {
        const arg = args[i]!;
        const v = variances[i]!;
        const k = GenericArg.kind(arg);
        if (k.$ === "Lifetime" && v === "Bivariant") {
          yield arg;
        } else if (k.$ === "Lifetime") {
          const lt = k._0;
          yield GenericArg.from_Region(f(lt));
        } else {
          yield arg;
        }
      }
    })();
    const args3 = cx.mk_args_from_iter(args2);
    return { def_id, args: args3 };
  },
};
