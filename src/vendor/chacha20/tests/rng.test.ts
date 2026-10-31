//! Random number generator tests.
//
// Port of chacha20 =0.10.0 `tests/rng.rs` (feature `rng`). `hex!` is `hex`.
import { expect, test } from "bun:test";
import { ChaCha12Rng, ChaCha20Rng, ChaCha8Rng } from "../rng.ts";
import type { CryptoRng } from "../../rand_core/lib.ts";

function hex(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "hex"));
}
const arr = (b: Uint8Array) => [...b];

const KEY = hex("0102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F20");
const STREAM = 0xf0f1f2f3_f4f5f6f7n;
const BLOCK_WORDS = 16;

// crate: chacha20-0.10.0/tests/rng.rs:16 test_rng_output
test("test_rng_output", () => {
  const rng = ChaCha20Rng.from_seed(KEY);
  const bytes = new Uint8Array(13);

  rng.fill_bytes(bytes);
  expect(arr(bytes)).toEqual(arr(hex("B1697E9FC6461E1983D131CF69")));

  rng.fill_bytes(bytes);
  expect(arr(bytes)).toEqual(arr(hex("A7A3FC134F149880E8BB2B5D23")));
});

// crate: chacha20-0.10.0/tests/rng.rs:30 test_chacha_true_values_a
test("test_chacha_true_values_a", () => {
  // Test vectors 1 and 2 from
  // https://tools.ietf.org/html/draft-nir-cfrg-chacha20-poly1305-04
  const seed = new Uint8Array(32);
  const rng = ChaCha20Rng.from_seed(seed);

  let results = Array.from({ length: 16 }, () => rng.next_u32());
  expect(results).toEqual([
    0xade0b876, 0x903df1a0, 0xe56a5d40, 0x28bd8653, 0xb819d2bd, 0x1aed8da0, 0xccef36a8, 0xc70d778b, 0x7c5941da,
    0x8d485751, 0x3fe02477, 0x374ad8b8, 0xf4b8436a, 0x1ca11815, 0x69b687c3, 0x8665eeb2,
  ]);

  results = Array.from({ length: 16 }, () => rng.next_u32());
  expect(results).toEqual([
    0xbee7079f, 0x7a385155, 0x7c97ba98, 0x0d082d73, 0xa0290fcb, 0x6965e348, 0x3e53c612, 0xed7aee32, 0x7621b729,
    0x434ee69c, 0xb03371d5, 0xd539d874, 0x281fed31, 0x45fb0a51, 0x1f0ae1ac, 0x6f4d794b,
  ]);
});

// crate: chacha20-0.10.0/tests/rng.rs:59 test_chacha_true_values_b
test("test_chacha_true_values_b", () => {
  // Test vector 3 from
  // https://tools.ietf.org/html/draft-nir-cfrg-chacha20-poly1305-04
  const seed = hex("0000000000000000000000000000000000000000000000000000000000000001");
  const rng = ChaCha20Rng.from_seed(seed);

  // Skip block 0
  for (let i = 0; i < 16; i++) rng.next_u32();

  const results = Array.from({ length: 16 }, () => rng.next_u32());
  expect(results).toEqual([
    0x2452eb3a, 0x9249f8ec, 0x8d829d9b, 0xddd4ceb1, 0xe8252083, 0x60818b01, 0xf38422b8, 0x5aaa49c9, 0xbb00ca8e,
    0xda3ba7b4, 0xc4b592d1, 0xfdf2732f, 0x4436274e, 0x2561b3c8, 0xebdd4aa6, 0xa0136c00,
  ]);
});

// crate: chacha20-0.10.0/tests/rng.rs:83 test_chacha_true_values_c
test("test_chacha_true_values_c", () => {
  // Test vector 4 from
  // https://tools.ietf.org/html/draft-nir-cfrg-chacha20-poly1305-04
  const seed = hex("00FF000000000000000000000000000000000000000000000000000000000000");
  const expected = [
    0xfb4dd572, 0x4bc42ef1, 0xdf922636, 0x327f1394, 0xa78dea8f, 0x5e269039, 0xa1bebbc1, 0xcaf09aae, 0xa25ab213,
    0x48a6b46c, 0x1b9d9bcb, 0x092c5be6, 0x546ca624, 0x1bec45d5, 0x87f47473, 0x96f0992e,
  ];
  const expected_end = 3n * 16n;

  // Test block 2 by skipping block 0 and 1
  const rng1 = ChaCha20Rng.from_seed(seed);
  for (let i = 0; i < 32; i++) rng1.next_u32();
  expect(Array.from({ length: 16 }, () => rng1.next_u32())).toEqual(expected);
  expect(rng1.get_word_pos()).toBe(expected_end);

  // Test block 2 by using `set_word_pos`
  const rng2 = ChaCha20Rng.from_seed(seed);
  rng2.set_word_pos(2n * 16n);
  expect(Array.from({ length: 16 }, () => rng2.next_u32())).toEqual(expected);
  expect(rng2.get_word_pos()).toBe(expected_end);

  // Test block 2 by using `set_block_pos` and u32
  const rng3 = ChaCha20Rng.from_seed(seed);
  rng3.set_block_pos(2n);
  expect(Array.from({ length: 16 }, () => rng3.next_u32())).toEqual(expected);
  expect(rng3.get_word_pos()).toBe(expected_end);

  // Test block 2 by using `set_block_pos` and [u8; 8]
  const rng4 = ChaCha20Rng.from_seed(seed);
  rng4.set_block_pos(2n);
  expect(Array.from({ length: 16 }, () => rng4.next_u32())).toEqual(expected);
  expect(rng4.get_word_pos()).toBe(expected_end);

  // Test skipping behaviour with other types
  const buf = new Uint8Array(32);
  rng2.fill_bytes(buf);
  expect(rng2.get_word_pos()).toBe(expected_end + 8n);
  rng2.fill_bytes(buf.subarray(0, 25));
  expect(rng2.get_word_pos()).toBe(expected_end + 15n);
  rng2.next_u64();
  expect(rng2.get_word_pos()).toBe(expected_end + 17n);
  rng2.next_u32();
  rng2.next_u64();
  expect(rng2.get_word_pos()).toBe(expected_end + 20n);
  rng2.fill_bytes(buf.subarray(0, 1));
  expect(rng2.get_word_pos()).toBe(expected_end + 21n);
});

// crate: chacha20-0.10.0/tests/rng.rs:151 test_chacha_multiple_blocks
test("test_chacha_multiple_blocks", () => {
  const seed = hex("0000000001000000020000000300000004000000050000000600000007000000");
  const rng = ChaCha20Rng.from_seed(seed);

  // Store the 17*i-th 32-bit word,
  // i.e., the i-th word of the i-th 16-word block
  const results: number[] = [];
  for (let i = 0; i < 16; i++) {
    results.push(rng.next_u32());
    for (let j = 0; j < 16; j++) rng.next_u32();
  }
  expect(results).toEqual([
    0xf225c81a, 0x6ab1be57, 0x04d42951, 0x70858036, 0x49884684, 0x64efec72, 0x4be2d186, 0x3615b384, 0x11cfa18e,
    0xd3c50049, 0x75c775f6, 0x434c6530, 0x2c5bad8f, 0x898881dc, 0x5f1c86d9, 0xc1f8e7f4,
  ]);
});

// crate: chacha20-0.10.0/tests/rng.rs:173 test_chacha_true_bytes
test("test_chacha_true_bytes", () => {
  const seed = new Uint8Array(32);
  const rng = ChaCha20Rng.from_seed(seed);
  const results = new Uint8Array(32);
  rng.fill_bytes(results);
  expect(arr(results)).toEqual(arr(hex("76B8E0ADA0F13D90405D6AE55386BD28BDD219B8A08DED1AA836EFCC8B770DC7")));
});

// crate: chacha20-0.10.0/tests/rng.rs:183 test_chacha_construction
test("test_chacha_construction", () => {
  const seed = hex("0000000000000000010000000000000002000000000000000300000000000000");
  const rng1 = ChaCha20Rng.from_seed(seed);
  expect(rng1.next_u32()).toBe(137206642);

  expect(arr(rng1.get_seed())).toEqual(arr(seed));

  const rng2 = ChaCha20Rng.from_rng(rng1);
  expect(rng2.next_u32()).toBe(1325750369);
});

// crate: chacha20-0.10.0/tests/rng.rs:195 test_chacha_nonce
test("test_chacha_nonce", () => {
  // Test vector 5 from
  // https://www.rfc-editor.org/rfc/rfc8439#section-2.3.2
  const seed = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  const rng = ChaCha20Rng.from_seed(seed);

  rng.set_stream(0x000000004a000000n);
  rng.set_block_pos(0x0900000000000000n); // u64::from_le_bytes(hex!("0000000000000009"))

  // The test vectors omit the first 64-bytes of the keystream
  const discard_first_64 = new Uint8Array(64);
  rng.fill_bytes(discard_first_64);

  const results = Array.from({ length: 16 }, () => rng.next_u32());
  expect(results).toEqual([
    0xe4e7f110, 0x15593bd1, 0x1fdd0f50, 0xc47120a3, 0xc7f4d1c7, 0x0368c033, 0x9aaa2204, 0x4e6cd4c3, 0x466482d2,
    0x09aa9f07, 0x05d7c214, 0xa2028bd9, 0xd19c12b5, 0xb94e16de, 0xe883d0cb, 0x4e3c50a2,
  ]);
});

// crate: chacha20-0.10.0/tests/rng.rs:223 test_chacha_nonce_2
test("test_chacha_nonce_2", () => {
  // Test vector 5 from
  // https://tools.ietf.org/html/draft-nir-cfrg-chacha20-poly1305-04
  // Although we do not support setting a nonce, we try it here anyway so
  // we can use this test vector.
  const seed = new Uint8Array(32);
  const rng = ChaCha20Rng.from_seed(seed);
  // 96-bit nonce in LE order is: 0,0,0,0, 0,0,0,0, 0,0,0,2
  rng.set_stream(2n << (24n + 32n));

  const results = Array.from({ length: 16 }, () => rng.next_u32());
  expect(results).toEqual([
    0x374dc6c2, 0x3736d58c, 0xb904e24a, 0xcd3f93ef, 0x88228b1a, 0x96a4dfb3, 0x5b76ab72, 0xc727ee54, 0x0e0e978a,
    0xf3145c95, 0x1b748ea8, 0xf786c297, 0x99c28f5f, 0x628314e8, 0x398a19fa, 0x6ded1b53,
  ]);
});

/// Test vector 9 from https://github.com/pyca/cryptography/blob/main/vectors/cryptography_vectors/ciphers/ChaCha20/counter-overflow.txt
// crate: chacha20-0.10.0/tests/rng.rs:247 counter_wrap_1
test("counter_wrap_1", () => {
  const rng = ChaCha20Rng.from_seed(new Uint8Array(32));
  const block_pos = 18446744073709551615n;
  expect(block_pos).toBe(0xffff_ffff_ffff_ffffn);
  rng.set_block_pos(block_pos);

  const output = new Uint8Array(64 * 3);
  rng.fill_bytes(output);
  const expected = hex(
    "d7918cd8620cf832532652c04c01a553092cfb32e7b3f2f5467ae9674a2e9eec17368e" +
      "c8027a357c0c51e6ea747121fec45284be0f099d2b3328845607b1768976b8e0ada0f1" +
      "3d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7da41597c5157488d77" +
      "24e03fb8d84a376a43b8f41518a11cc387b669b2ee65869f07e7be5551387a98ba977c" +
      "732d080dcb0f29a048e3656912c6533e32ee7aed29b721769ce64e43d57133b074d839" +
      "d531ed1f28510afb45ace10a1f4b794d6f",
  );
  expect(arr(expected)).toEqual(arr(output));
});

/// Counts how many bytes were incorrect, and returns:
///
/// (`index_of_first_incorrect_word`, `num_incorrect_bytes`)
// crate: chacha20-0.10.0/tests/rng.rs:269 count_incorrect_bytes
function count_incorrect_bytes(expected: Uint8Array, output: Uint8Array): [number | undefined, number] {
  expect(expected.length).toBe(output.length);
  let num_incorrect_bytes = 0;
  let index_of_first_incorrect_word: number | undefined = undefined;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== output[i]) {
      if (index_of_first_incorrect_word === undefined) {
        index_of_first_incorrect_word = Math.floor(i / 4);
      }
      num_incorrect_bytes += 1;
    }
  }
  return [index_of_first_incorrect_word, num_incorrect_bytes];
}

/// Test vector 8 from https://github.com/pyca/cryptography/blob/main/vectors/cryptography_vectors/ciphers/ChaCha20/counter-overflow.txt
// crate: chacha20-0.10.0/tests/rng.rs:290 counter_overflow_and_diagnostics
test("counter_overflow_and_diagnostics", () => {
  const rng = ChaCha20Rng.from_seed(new Uint8Array(32));
  const block_pos = 4294967295n;
  expect(block_pos).toBe(0xffff_ffffn);
  rng.set_block_pos(4294967295n);

  const output = new Uint8Array(64 * 4);
  rng.fill_bytes(output.subarray(0, 64 * 3));
  const block_before_overflow = hex(
    "ace4cd09e294d1912d4ad205d06f95d9c2f2bfcf453e8753f128765b62215f4d92c74f" + "2f626c6a640c0b1284d839ec81f1696281dafc3e684593937023b58b1d",
  );
  const first_block_after_overflow = hex(
    "3db41d3aa0d329285de6f225e6e24bd59c9a17006943d5c9b680e3873bdc683a581946" + "9899989690c281cd17c96159af0682b5b903468a61f50228cf09622b5a",
  );
  const second_block_after_overflow = hex(
    "46f0f6efee15c8f1b198cb49d92b990867905159440cc723916dc0012826981039ce17" + "66aa2542b05db3bd809ab142489d5dbfe1273e7399637b4b3213768aaa",
  );
  expect(arr(output.subarray(0, 64))).toEqual(arr(block_before_overflow));

  rng.set_block_pos(0xffff_ffffn - 1n);
  const skipped_blocks = new Uint8Array(64 * 3);
  rng.fill_bytes(skipped_blocks);
  rng.fill_bytes(output.subarray(64 * 3));

  const bs = [first_block_after_overflow, second_block_after_overflow, second_block_after_overflow];
  for (let i = 1; i < 4; i++) {
    const a = output.subarray(64 * i, 64 * (i + 1));
    const b = bs[i - 1]!;
    const [, num_incorrect_bytes] = count_incorrect_bytes(a, b);
    expect(`PARBLOCK #${i + 1}: ${num_incorrect_bytes}`).toBe(`PARBLOCK #${i + 1}: 0`);
  }
});

// crate: chacha20-0.10.0/tests/rng.rs:337 test_wrapping_add
test("test_wrapping_add", () => {
  const rng = ChaCha20Rng.from_seed(KEY);
  // test counter wrapping-add
  rng.set_word_pos((1n << 68n) - 65n);
  const output = new Uint8Array(1280).fill(3);
  rng.fill_bytes(output);

  expect(output.some((b) => b !== 0)).toBe(true);

  expect(rng.get_word_pos() < 2000n).toBe(true);
  expect(rng.get_word_pos() !== 0n).toBe(true);
});

// crate: chacha20-0.10.0/tests/rng.rs:351 test_chacha_clone_streams
test("test_chacha_clone_streams", () => {
  const seed = Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0);
  const rng1 = ChaCha20Rng.from_seed(seed);
  const rng2 = ChaCha20Rng.from_seed(seed);
  for (let i = 0; i < 16; i++) {
    expect(rng1.next_u64()).toBe(rng2.next_u64());
  }

  rng1.set_stream(51n);
  expect(rng1.get_stream()).toBe(51n);
  expect(rng2.get_stream()).toBe(0n);
  const fill_1 = new Uint8Array(7);
  rng1.fill_bytes(fill_1);
  const fill_2 = new Uint8Array(7);
  rng2.fill_bytes(fill_2);
  expect(arr(fill_1)).not.toEqual(arr(fill_2));
  for (let i = 0; i < 7; i++) {
    expect(rng1.next_u64() !== rng2.next_u64()).toBe(true);
  }
  rng2.set_stream(51n); // switch part way through block
  for (let i = 7; i < 16; i++) {
    expect(rng1.next_u64()).not.toBe(rng2.next_u64());
  }
  rng1.set_stream(51n);
  rng2.set_stream(51n);
  for (let i = 0; i < 16; i++) {
    expect(rng1.next_u64()).toBe(rng2.next_u64());
  }
});

// crate: chacha20-0.10.0/tests/rng.rs:385 test_chacha_word_pos_wrap_exact
test("test_chacha_word_pos_wrap_exact", () => {
  const rng = ChaCha20Rng.from_seed(new Uint8Array(32));
  // refilling the buffer in set_word_pos will wrap the block counter to 0
  const last_block = (1n << 68n) - BigInt(4 * BLOCK_WORDS);
  rng.set_word_pos(last_block);
  expect(rng.get_word_pos()).toBe(last_block);
});

// crate: chacha20-0.10.0/tests/rng.rs:394 test_chacha_word_pos_wrap_excess
test("test_chacha_word_pos_wrap_excess", () => {
  const rng = ChaCha20Rng.from_seed(new Uint8Array(32));
  // refilling the buffer in set_word_pos will wrap the block counter past 0
  const last_block = (1n << 68n) - BigInt(BLOCK_WORDS);
  rng.set_word_pos(last_block);
  expect(rng.get_word_pos()).toBe(last_block);
});

// crate: chacha20-0.10.0/tests/rng.rs:403 test_chacha_word_pos_zero
test("test_chacha_word_pos_zero", () => {
  const rng = ChaCha20Rng.from_seed(new Uint8Array(32));
  expect(rng.get_word_pos()).toBe(0n);
  rng.set_word_pos(0n);
  expect(rng.get_word_pos()).toBe(0n);
});

// crate: chacha20-0.10.0/tests/rng.rs:412 test_trait_objects
test("test_trait_objects", () => {
  const seed = new Uint8Array(32);
  const rng1 = ChaCha20Rng.from_seed(seed);
  const rng2: CryptoRng = ChaCha20Rng.from_seed(seed);
  for (let i = 0; i < 1000; i++) {
    expect(rng1.next_u64()).toBe(rng2.next_u64());
  }
});

/// If this test fails, the backend may not be
/// performing 64-bit addition.
// crate: chacha20-0.10.0/tests/rng.rs:426 counter_wrapping_64_bit_counter
test("counter_wrapping_64_bit_counter", () => {
  const rng = ChaCha20Rng.from_seed(new Uint8Array(32));

  // get first four blocks and word pos
  const first_blocks = new Uint8Array(64 * 4);
  rng.fill_bytes(first_blocks);
  const first_blocks_end_word_pos = rng.get_word_pos();
  const first_blocks_end_block_counter = rng.get_block_pos();

  // get first four blocks after wrapping
  rng.set_block_pos(0xffff_ffff_ffff_ffffn);
  const result = new Uint8Array(64 * 5);
  rng.fill_bytes(result);
  expect(first_blocks_end_word_pos).toBe(rng.get_word_pos());
  expect(first_blocks_end_block_counter).toBe(rng.get_block_pos());

  expect(arr(first_blocks.subarray(0, 64 * 4))).toEqual(arr(result.subarray(64)));
});

/// If this test fails, the backend may be doing 32-bit addition.
// crate: chacha20-0.10.0/tests/rng.rs:452 counter_not_wrapping_at_32_bits
test("counter_not_wrapping_at_32_bits", () => {
  const rng = ChaCha20Rng.from_seed(new Uint8Array(32));

  // get first four blocks and word pos
  const first_blocks = new Uint8Array(64 * 4);
  rng.fill_bytes(first_blocks);
  const first_blocks_end_word_pos = rng.get_word_pos();

  // get first four blocks after the supposed overflow
  rng.set_block_pos(0xffff_ffffn);
  const result = new Uint8Array(64 * 5);
  rng.fill_bytes(result);
  expect(first_blocks_end_word_pos).not.toBe(rng.get_word_pos());
  expect(rng.get_word_pos()).toBe(first_blocks_end_word_pos + (1n << 32n) * BigInt(BLOCK_WORDS));
  expect(arr(first_blocks.subarray(0, 64 * 4))).not.toEqual(arr(result.subarray(64)));
});

function serde_roundtrip(Rng: typeof ChaCha8Rng | typeof ChaCha12Rng | typeof ChaCha20Rng): void {
  for (let skip_words = 0; skip_words < 100; skip_words++) {
    const rng = Rng.from_seed(KEY);
    rng.set_stream(STREAM);
    for (let i = 0; i < skip_words; i++) rng.next_u32();
    const state = rng.serialize_state();
    const rng2 = Rng.deserialize_state(state);
    for (let i = 0; i < 100; i++) {
      expect(rng.next_u32()).toBe(rng2.next_u32());
    }
  }
}

// crate: chacha20-0.10.0/tests/rng.rs:473 test_chacha8rng_serde_roundtrip
test("test_chacha8rng_serde_roundtrip", () => serde_roundtrip(ChaCha8Rng));

// crate: chacha20-0.10.0/tests/rng.rs:489 test_chacha12rng_serde_roundtrip
test("test_chacha12rng_serde_roundtrip", () => serde_roundtrip(ChaCha12Rng));

// crate: chacha20-0.10.0/tests/rng.rs:505 test_chacha20rng_serde_roundtrip
test("test_chacha20rng_serde_roundtrip", () => serde_roundtrip(ChaCha20Rng));

// crate: chacha20-0.10.0/tests/rng.rs:521 test_rng_serialized_state_stability
test("test_rng_serialized_state_stability", () => {
  const EXPECTED = hex("0102030405060708090A0B0C0D0E0F10" + "1112131415161718191A1B1C1D1E1F20" + "F7F6F5F4F3F2F1F06400000000000000" + "00");
  for (const Rng of [ChaCha8Rng, ChaCha12Rng, ChaCha20Rng]) {
    const rng = Rng.from_seed(KEY);
    rng.set_stream(STREAM);
    for (let i = 0; i < 100; i++) rng.next_u32();
    const state = rng.serialize_state();
    expect(arr(state)).toEqual(arr(EXPECTED));
  }
});
