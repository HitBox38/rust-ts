// Port of twox-hash =2.1.2 `src/lib.rs`, with the features compiler/rustc_metadata enables
// (`default-features = false, features = ["xxhash3_128", "std"]`): the `xxhash3` support module and
// `xxhash3_128`. `xxhash32`, `xxhash64` and `xxhash3_64` are not compiled there and are not ported.
//
// PORT: import this crate only through this file. `xxhash3.ts` must evaluate before its submodules
// (`xxhash3/large.ts` and `xxhash3/streaming.ts` read its constants at module level), so it is imported
// first here; `xxhash3.ts` itself imports only `xxhash3/secret.ts`.
//
// PORT: u64 values are `bigint` (masked to 64 bits after every wrapping op), u32/u8/usize are `number`,
// u128 hashes are `bigint`. The large-input accumulators (`[u64; 8]`) are pairs of u32 instead; see
// `xxhash3/large.ts`.

// mod xxhash3;
import "./xxhash3.ts";
export * as xxhash3_128 from "./xxhash3_128.ts";
export { Hasher as XxHash3_128 } from "./xxhash3_128.ts";

// trait IntoU32
export interface IntoU32<Self> {
  // crate: twox-hash-2.1.2/src/lib.rs:54 into_u32
  into_u32(self: Self): number;
}

// impl IntoU32 for u8
export const IntoU32_u8: IntoU32<number> = {
  // crate: twox-hash-2.1.2/src/lib.rs:58 into_u32
  into_u32(self: number): number {
    return self;
  },
};

// trait IntoU64
export interface IntoU64<Self> {
  // crate: twox-hash-2.1.2/src/lib.rs:65 into_u64
  into_u64(self: Self): bigint;
}

// impl IntoU64 for u8
export const IntoU64_u8: IntoU64<number> = {
  // crate: twox-hash-2.1.2/src/lib.rs:69 into_u64
  into_u64(self: number): bigint {
    return BigInt(self);
  },
};

// impl IntoU64 for u32
export const IntoU64_u32: IntoU64<number> = {
  // crate: twox-hash-2.1.2/src/lib.rs:75 into_u64
  into_u64(self: number): bigint {
    return BigInt(self);
  },
};

// #[cfg(any(target_pointer_width = "32", target_pointer_width = "64"))]
// impl IntoU64 for usize
export const IntoU64_usize: IntoU64<number> = {
  // crate: twox-hash-2.1.2/src/lib.rs:82 into_u64
  into_u64(self: number): bigint {
    return BigInt(self);
  },
};

// trait IntoU128
export interface IntoU128<Self> {
  // crate: twox-hash-2.1.2/src/lib.rs:89 into_u128
  into_u128(self: Self): bigint;
}

// impl IntoU128 for u64
export const IntoU128_u64: IntoU128<bigint> = {
  // crate: twox-hash-2.1.2/src/lib.rs:93 into_u128
  into_u128(self: bigint): bigint {
    return self;
  },
};
