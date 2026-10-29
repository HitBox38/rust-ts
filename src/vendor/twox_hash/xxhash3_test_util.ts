// The non-`#[test]` items of the `#[cfg(test)] pub mod test` of twox-hash =2.1.2 `src/xxhash3.rs`, shared
// by the crate's tests.
// PORT: a module of its own (not `xxhash3.test.ts`) so that importing it does not register those tests twice.

/** `macro_rules! bytes`: `gen_bytes::<N>()` for each `N`. */
export function bytes(...ns: number[]): Uint8Array[] {
  return ns.map(gen_bytes);
}

// crate: twox-hash-2.1.2/src/xxhash3.rs:357 gen_bytes
export function gen_bytes(N: number): Uint8Array {
  // Picking 251 as it's a prime number, which will hopefully
  // help avoid incidental power-of-two alignment.
  return Uint8Array.from({ length: N }, (_, i) => i % 251);
}
