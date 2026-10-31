// Port of library/proc_macro/src/bridge/fxhash.rs
//
//! This is a copy of the `rustc_hash` crate, adapted to work as a module.
//!
//! If in the future it becomes more reasonable to add dependencies to
//! `proc_macro`, this module should be removed and replaced with a dependency
//! on the `rustc_hash` crate.
//
// PORT: `FxHashMap<K, V>` is a JS `Map` (PORTING §5); iteration order is never observed by the bridge (the handle
// interner and the symbol interner only look keys up). `FxHasher` is ported for completeness; `usize` is 64-bit
// (the hosts are 64-bit), so the state is a `bigint` kept in 0..2^64.

const U64_MASK = (1n << 64n) - 1n;

/// Type alias for a hashmap using the `fx` hash algorithm.
export type FxHashMap<K, V> = Map<K, V>;

/// A speedy hash algorithm for use within rustc. The hashmap in alloc by
/// default uses SipHash which isn't quite as speedy as we want. In the compiler
/// we're not really worried about DOS attempts, so we use a fast
/// non-cryptographic hash.
///
/// This is the same as the algorithm used by Firefox -- which is a homespun
/// one not based on any widely-known algorithm -- though modified to produce
/// 64-bit hash values instead of 32-bit hash values. It consistently
/// out-performs an FNV-based hash within rustc itself -- the collision rate is
/// similar or slightly worse than FNV, but the speed of the hash function
/// itself is much higher because it works on up to 8 bytes at a time.
// std-type: library/proc_macro/src/bridge/fxhash.rs:26 FxHasher
export class FxHasher {
  constructor(public hash: bigint) {}

  /** `#[derive(Default)]` */
  static default_(): FxHasher {
    return new FxHasher(0n);
  }

  // std: library/proc_macro/src/bridge/fxhash.rs:32 add_to_hash
  add_to_hash(i: bigint): void {
    // target_pointer_width = "64"
    const K = 0x517cc1b727220a95n;
    const rotated = ((this.hash << 5n) | (this.hash >> 59n)) & U64_MASK;
    this.hash = ((rotated ^ i) * K) & U64_MASK;
  }

  // ---- impl Hasher for FxHasher ----

  // std: library/proc_macro/src/bridge/fxhash.rs:44 write
  write(bytes: Uint8Array): void {
    const hash = new FxHasher(this.hash);
    // assert!(size_of::<usize>() <= 8);
    // PORT: `from_ne_bytes`: the hosts are little-endian.
    const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.length);
    while (bytes.length >= 8) {
      const d = dv(bytes);
      hash.add_to_hash(BigInt(d.getUint32(0, true)) | (BigInt(d.getUint32(4, true)) << 32n));
      bytes = bytes.subarray(8);
    }
    if (bytes.length >= 4) {
      hash.add_to_hash(BigInt(dv(bytes).getUint32(0, true)));
      bytes = bytes.subarray(4);
    }
    if (bytes.length >= 2) {
      hash.add_to_hash(BigInt(dv(bytes).getUint16(0, true)));
      bytes = bytes.subarray(2);
    }
    if (bytes.length !== 0) {
      hash.add_to_hash(BigInt(bytes[0]!));
    }
    this.hash = hash.hash;
  }

  // std: library/proc_macro/src/bridge/fxhash.rs:66 write_u8
  write_u8(i: number): void {
    this.add_to_hash(BigInt(i));
  }

  // std: library/proc_macro/src/bridge/fxhash.rs:71 write_u16
  write_u16(i: number): void {
    this.add_to_hash(BigInt(i));
  }

  // std: library/proc_macro/src/bridge/fxhash.rs:76 write_u32
  write_u32(i: number): void {
    this.add_to_hash(BigInt(i));
  }

  // std-skip: library/proc_macro/src/bridge/fxhash.rs:82 write_u64 cfg(target_pointer_width = "32"): the hosts are 64-bit

  // std: library/proc_macro/src/bridge/fxhash.rs:89 write_u64
  write_u64(i: bigint): void {
    this.add_to_hash(i);
  }

  // std: library/proc_macro/src/bridge/fxhash.rs:94 write_usize
  write_usize(i: bigint): void {
    this.add_to_hash(i);
  }

  // std: library/proc_macro/src/bridge/fxhash.rs:99 finish
  finish(): bigint {
    return this.hash;
  }
}
