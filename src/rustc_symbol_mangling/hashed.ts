// Port of compiler/rustc_symbol_mangling/src/hashed.rs (lane symbol-mangling).
import { StableHasher, stable_hash_String } from "../rustc_data_structures/stable_hash.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Instance, Instance as InstanceC } from "../rustc_middle/ty/instance.ts";
import type { CrateNum } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { encode_integer_62, push_ident } from "./v0.ts";

// rustc: compiler/rustc_symbol_mangling/src/hashed.rs:10 mangle
export function mangle(tcx: TyCtxt, instance: Instance, instantiating_crate: CrateNum | undefined, full_mangling_name: () => string): string {
  // The symbol of a generic function may be scattered in multiple downstream dylibs.
  // If the symbol of a generic function still contains `crate name`, hash conflicts between the
  // generic function and other symbols of the same `crate` cannot be detected in time during
  // construction. This symbol conflict is left over until it occurs during run time.
  // In this case, `instantiating-crate name` is used to replace `crate name` can completely
  // eliminate the risk of the preceding potential hash conflict.
  const crate_num = instantiating_crate !== undefined ? instantiating_crate : InstanceC.def_id(instance).krate;

  const symbol = { value: "_RNxC" };
  push_ident(Symbol.as_str(tcx.crate_name(crate_num)), symbol);

  const hash = tcx.with_stable_hashing_context((hcx) => {
    const hasher = StableHasher.new();
    stable_hash_String(full_mangling_name(), hcx, hasher);
    return Hash64.as_u64(hasher.finish(Hash64));
  });

  push_hash64(hash, symbol);

  return symbol.value;
}

// The hash is encoded based on `base-62` and the final terminator `_` is removed because it does
// not help prevent hash collisions
// rustc: compiler/rustc_symbol_mangling/src/hashed.rs:41 push_hash64
function push_hash64(hash: bigint, output: { value: string }): void {
  const hash_ = encode_integer_62(hash);
  // PORT: `hash_` is ASCII (base 62 digits and `_`), so `len()` is `.length`.
  const hash_len = hash_.length;
  output.value += `${hash_len}H${hash_.slice(0, hash_len - 1)}`;
}
