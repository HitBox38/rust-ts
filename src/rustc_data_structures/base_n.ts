// Port of compiler/rustc_data_structures/src/base_n.rs (lane symbol-mangling).
//! Converts unsigned integers into a string representation with some base.
//! Bases up to and including 36 can be used for case-insensitive things.
//
// PORT: `BaseNString { start, buf: [ascii::Char; 128] }` derefs to `&buf[start..]`; it is a class holding both, with
// `as_str()` for the `Deref` / `AsRef<str>` / `Display` impls. `trait ToBaseN: Into<u128>` is the descriptor
// `ToBaseN` (`encoded_len` per implementing type); the provided `to_base` / `to_base_fixed_len` are functions taking
// the value as a `bigint` (`self.into()` = the u128) and, for the fixed length, the descriptor.
import { assert_eq } from "../std/panic.ts";

// #[cfg(test)]
// mod tests;

export const MAX_BASE = 64;
export const ALPHANUMERIC_ONLY = 62;
export const CASE_INSENSITIVE = 36;

const BASE_64 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@$";

export class BaseNString {
  constructor(
    public start: number,
    public buf: string[],
  ) {}

  // rustc: compiler/rustc_data_structures/src/base_n.rs:27 deref
  deref(): string {
    return this.buf.slice(this.start).join("");
  }

  // rustc: compiler/rustc_data_structures/src/base_n.rs:33 as_ref
  as_ref(): string {
    return this.buf.slice(this.start).join("");
  }

  /** `Deref<Target = str>`: the encoded digits. */
  as_str(): string {
    return this.deref();
  }

  // rustc: compiler/rustc_data_structures/src/base_n.rs:39 fmt
  /** `impl Display` (std/fmt.ts convention: the written text). */
  fmt(): string {
    return this.deref();
  }
}

// This trait just lets us reserve the exact right amount of space when doing fixed-length
// case-insensitive encoding. Add any impls you need.
export interface ToBaseN {
  // rustc: compiler/rustc_data_structures/src/base_n.rs:47 encoded_len
  encoded_len(base: number): number;
}

// rustc: compiler/rustc_data_structures/src/base_n.rs:49 to_base_fixed_len
export function to_base_fixed_len(self: bigint, base: number, Self: ToBaseN): BaseNString {
  const encoded = to_base(self, base);
  encoded.start = encoded.buf.length - Self.encoded_len(base);
  return encoded;
}

// rustc: compiler/rustc_data_structures/src/base_n.rs:55 to_base
export function to_base(self: bigint, base: number): BaseNString {
  const output: string[] = new Array<string>(128).fill("0");

  let n: bigint = self;
  const b = BigInt(base);

  let index = output.length;
  for (;;) {
    index -= 1;
    output[index] = BASE_64[Number(n % b)]!;
    n /= b;

    if (n === 0n) {
      break;
    }
  }
  assert_eq(n, 0n, String);

  return new BaseNString(index, output);
}

/** `encoded_len` of the `ToBaseN` impls: the digits of `max` in `base`. */
function encoded_len_of(max: bigint, base: number): number {
  const b = BigInt(base);
  let len = 0;
  while (max > 0n) {
    len += 1;
    max /= b;
  }
  return len;
}

export const ToBaseN_u128: ToBaseN = {
  // rustc: compiler/rustc_data_structures/src/base_n.rs:77 encoded_len
  encoded_len(base: number): number {
    return encoded_len_of((1n << 128n) - 1n, base);
  },
};

export const ToBaseN_u64: ToBaseN = {
  // rustc: compiler/rustc_data_structures/src/base_n.rs:89 encoded_len
  encoded_len(base: number): number {
    return encoded_len_of((1n << 64n) - 1n, base);
  },
};

export const ToBaseN_u32: ToBaseN = {
  // rustc: compiler/rustc_data_structures/src/base_n.rs:101 encoded_len
  encoded_len(base: number): number {
    return encoded_len_of(0xffff_ffffn, base);
  },
};
