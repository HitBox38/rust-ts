// Port of rand =0.10.1 `src/rngs/std.rs` `#[cfg(test)] mod test`.
import { expect, test } from "bun:test";
import { StdRng } from "./std.ts";
import { Fill_u128, RngExt } from "../rng.ts";

// crate: rand-0.10.1/src/rngs/std.rs:112 test_stdrng_construction
test("test_stdrng_construction", () => {
  // Test value-stability of StdRng. This is expected to break any time
  // the algorithm is changed.
  const seed = Uint8Array.of(1, 0, 0, 0, 23, 0, 0, 0, 200, 1, 0, 0, 210, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

  const target = [10719222850664546238n, 14064965282130556830n];

  const rng0 = StdRng.from_seed(seed);

  const x0 = rng0.next_u64();

  const rng1 = StdRng.from_rng(rng0);
  const x1 = rng1.next_u64();

  expect([x0, x1]).toEqual(target);
});

function fill_u128(rng: StdRng, n: number): bigint[] {
  const results = new Array<bigint>(n).fill(0n);
  RngExt.fill(rng, Fill_u128, results);
  return results;
}

// crate: rand-0.10.1/src/rngs/std.rs:132 test_chacha_true_values_1
test("test_chacha_true_values_1", () => {
  // Source: Strombergson 2013, Test Vectors for the Stream Cipher ChaCha
  // draft-strombergson-chacha-test-vectors-01
  // https://datatracker.ietf.org/doc/html/draft-strombergson-chacha-test-vectors-01
  // Converted to LE u128 form (four u128 to one block).
  // TC: all zero key and IV, rounds 12, 256-bit key

  const seed = new Uint8Array(32);
  const rng = StdRng.from_seed(seed);

  expect(fill_u128(rng, 8)).toEqual([
    0xd583265f12ce1f8153f955076a9af49bn,
    0x5f15ae2ea589007e1474e049bbc32904n,
    0x798cfaac3428e82cc0e37ad279f86405n,
    0xbe2613412fe80b611969dea02c9f623an,
    0x3d17e08c3371fc86fe743e204188d50bn,
    0xb489c04c21851515cccbbd19b7eb28c6n,
    0x43c88c1b97b802c611f14ca1cd8d2542n,
    0x1693e617b0a64427c0515190ca461ee9n,
  ]);

  expect(rng._0.get_word_pos()).toBe(32n);
});

// crate: rand-0.10.1/src/rngs/std.rs:160 test_chacha_true_values_2
test("test_chacha_true_values_2", () => {
  // Source: Strombergson 2013, Test Vectors for the Stream Cipher ChaCha
  // TC2: single bit set in key, all zero IV, rounds 12, 256-bit key

  const seed = new Uint8Array(32);
  seed[0] = 1;
  const rng = StdRng.from_seed(seed);

  expect(fill_u128(rng, 8)).toEqual([
    0x9a225cdf090f0eef6b0565d596e0512n,
    0x10dd4d0bff1802930f5d5290278c2449n,
    0xfefdfe067d7a109ee254a4d9392200a6n,
    0xc029dc60c972179bf2f944a0eb0f21f0n,
    0x2a37692ab05e660e2404c6cbc566730cn,
    0xc8a72980b8c4c72a0978bb6fb279f97an,
    0xaf15ba8e302e43907dfcbb17c23b5154n,
    0xa9177125baafe601560d10ef48eb5ac6n,
  ]);

  expect(rng._0.get_word_pos()).toBe(32n);
});

// crate: rand-0.10.1/src/rngs/std.rs:186 test_chacha_true_values_3
test("test_chacha_true_values_3", () => {
  // Source: Strombergson 2013, Test Vectors for the Stream Cipher ChaCha
  // TC3: all zero key, single bit set in IV, rounds 12, 256-bit key

  const seed = new Uint8Array(32);
  const rng = StdRng.from_seed(seed);
  rng._0.set_stream(1n);

  expect(fill_u128(rng, 8)).toEqual([
    0x3de08d69eff7ba6d4b8c827bf8bdb864n,
    0x6929e19be5ad36988f411457633fb3f8n,
    0xa5995d1de898cb9efccf8ef3a053c946n,
    0xf1d8f021fb3f31ee4b9450a9a8ffcedn,
    0x28886a59a2b923fe42c422f2a7b49d55n,
    0x23c72a9150a17ca76e8963134fee2251n,
    0x67b7d07029cb2037e802f6a024bf0bfn,
    0x6fa2523bbd836d3a01c8137c82b91afcn,
  ]);

  expect(rng._0.get_word_pos()).toBe(32n);
});

// crate: rand-0.10.1/src/rngs/std.rs:212 test_chacha_true_values_8
test("test_chacha_true_values_8", () => {
  // Source: Strombergson 2013, Test Vectors for the Stream Cipher ChaCha
  // TC8: key: 'All your base are belong to us!', IV: IETF2013, rounds 12, 256-bit key

  const seed = Uint8Array.of(
    0xc4, 0x6e, 0xc1, 0xb1, 0x8c, 0xe8, 0xa8, 0x78, 0x72, 0x5a, 0x37, 0xe7, 0x80, 0xdf, 0xb7, 0x35, 0x1f, 0x68, 0xed, 0x2e, 0x19,
    0x4c, 0x79, 0xfb, 0xc6, 0xae, 0xbe, 0xe1, 0xa6, 0x67, 0x97, 0x5d,
  );
  const iv = Uint8Array.of(0x1a, 0xda, 0x31, 0xd5, 0xcf, 0x68, 0x82, 0x21);
  const rng = StdRng.from_seed(seed);
  let stream = 0n;
  for (let i = 7; i >= 0; i--) stream = (stream << 8n) | BigInt(iv[i]!);
  rng._0.set_stream(stream);

  expect(fill_u128(rng, 8)).toEqual([
    0x10c08b11dc3be7b4066dbc8427078214n,
    0xc19c7e1f25aa8669e018a96c7876793cn,
    0x207c8db0992e2d24b483ee160a9a74b2n,
    0xabfb0f9db3b1613b28876c46bc802b09n,
    0x5495b60d624f9e9b32dbebc16b114bd9n,
    0x31d66e96ad465a970c3d47689b3d8e4an,
    0x3c11e5a1df7a04d8c7ead50a53ff2ae4n,
    0x2ba4a57be08f1cac89d1f183b8e3f391n,
  ]);

  expect(rng._0.get_word_pos()).toBe(32n);
});

// crate: rand-0.10.1/src/rngs/std.rs:245 test_chacha_counter
test("test_chacha_counter", () => {
  // Source: rand_chacha implementation
  // We test six blocks: counter=u32::MAX, four blocks from 2^32 (backends
  // which yield four blocks at a time may need to handle this specially)
  // and the first block after this wrap-logic completes.
  // Test: all zero key and IV, block set to u32::MAX, rounds 12, 256-bit key

  const seed = new Uint8Array(32);
  const rng = StdRng.from_seed(seed);
  const block = 0xffff_ffffn;
  const words_per_block = 16n;
  rng._0.set_word_pos(block * words_per_block);

  expect(fill_u128(rng, 4 * 6)).toEqual([
    0xf106e2fcbb524248292ac9f150afa6d7n,
    0x12032ef6c183b50a83a3309513dd017dn,
    0x2c93ff300438eaed6c958a9aa1619382n,
    0x74fc0624270ab858508377945edb52d0n,
    0xe5f4f4a8b8810524264d8911dc537bccn,
    0x18a6a6cbdc1f823fb1231280056740afn,
    0xabdae0a44b1f45edbccc83dcd3f8638an,
    0xad6b649f12f70de567cc39740dbb8a22n,
    0x37512785327825dc30ecfaf37a38f5a0n,
    0x5af852d2df0dc286c2dd19af39b54e39n,
    0xb04dc185c27497ac9f4a4f6769d1b5dn,
    0x816492be66439cecd2498c9865284377n,
    0x724fe95e0b6cbb8a55b707c06166147fn,
    0xe3e7cda19d92b5318024abb34aa31329n,
    0x1a3594d7283c077017cd511144bf3db3n,
    0x99ab26cf14f38b11d78e413bdce6424cn,
    0x553deaed89d3bf630de05408c0f655e8n,
    0x86c46a5676fef18f0dc0dff3ee16507cn,
    0xd33d6cf5ade97b000b29e3ce614faf51n,
    0x5b62dcc48c0fc60326afc5783c40d40cn,
    0x44eedc777ed030f43d382d4921eba244n,
    0xa2d66a5893ade34a0d17c706e8d89dban,
    0xd229d1f3a07526e47cabd035135012fdn,
    0xefae0722059b654dea6945547e535052n,
  ]);

  expect(rng._0.get_word_pos()).toBe(block * words_per_block + 96n);
});
