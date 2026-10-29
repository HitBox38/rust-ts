// Port of the `#[cfg(test)] mod test` of twox-hash =2.1.2 `src/xxhash3_128.rs`.
import "./lib.ts";
import { expect, test } from "bun:test";
import { bytes } from "./xxhash3_test_util.ts";
import { clone_Hasher, Hasher } from "./xxhash3_128.ts";

// const _: () = { const fn is_clone<T: Clone>() {} is_clone::<Hasher>(); };
// PORT: the compile-time `Clone` check is a test that `clone_Hasher` copies the state.
// crate: twox-hash-2.1.2/src/xxhash3_128.rs:435 is_clone
test("is_clone", () => {
  const a = Hasher.new();
  a.write(new Uint8Array(300).fill(7));
  const b = clone_Hasher(a);
  b.write(Uint8Array.of(1));
  expect(a.finish_128()).toBe(Hasher.oneshot(new Uint8Array(300).fill(7)));
  expect(b.finish_128()).toBe(Hasher.oneshot(Uint8Array.of(...new Uint8Array(300).fill(7), 1)));
});

const EMPTY_BYTES = new Uint8Array(0);

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:441 hash_byte_by_byte
function hash_byte_by_byte(input: Uint8Array): bigint {
  const hasher = Hasher.new();
  for (let i = 0; i < input.length; i++) {
    hasher.write(input.subarray(i, i + 1));
  }
  return hasher.finish_128();
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:450 oneshot_empty
test("oneshot_empty", () => {
  const hash = Hasher.oneshot(EMPTY_BYTES);
  expect(hash).toBe(0x99aa_06d3_0147_98d8_6001_c324_468d_497fn);
});

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:456 streaming_empty
test("streaming_empty", () => {
  const hash = hash_byte_by_byte(EMPTY_BYTES);
  expect(hash).toBe(0x99aa_06d3_0147_98d8_6001_c324_468d_497fn);
});

function check(inputs: Uint8Array[], expected: bigint[], f: (input: Uint8Array) => bigint): void {
  expect(inputs.length).toBe(expected.length);
  for (let i = 0; i < inputs.length; i++) {
    const hash = f(inputs[i]!);
    expect({ len: inputs[i]!.length, hash: hash.toString(16) }).toEqual({ len: inputs[i]!.length, hash: expected[i]!.toString(16) });
  }
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:462 oneshot_1_to_3_bytes
test("oneshot_1_to_3_bytes", () => test_1_to_3_bytes(Hasher.oneshot));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:467 streaming_1_to_3_bytes
test("streaming_1_to_3_bytes", () => test_1_to_3_bytes(hash_byte_by_byte));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:472 test_1_to_3_bytes
function test_1_to_3_bytes(f: (input: Uint8Array) => bigint): void {
  const inputs = bytes(1, 2, 3);

  const expected = [
    0xa6cd_5e93_9200_0f6a_c44b_dff4_074e_ecdbn,
    0x6a4a_5274_c1b0_d3ad_d664_5fc3_051a_9457n,
    0xe3b5_5f57_945a_17cf_5f42_99fc_161c_9cbbn,
  ];

  check(inputs, expected, f);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:488 oneshot_4_to_8_bytes
test("oneshot_4_to_8_bytes", () => test_4_to_8_bytes(Hasher.oneshot));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:493 streaming_4_to_8_bytes
test("streaming_4_to_8_bytes", () => test_4_to_8_bytes(hash_byte_by_byte));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:498 test_4_to_8_bytes
function test_4_to_8_bytes(f: (input: Uint8Array) => bigint): void {
  const inputs = bytes(4, 5, 6, 7, 8);

  const expected = [
    0xeb70_bf5f_c779_e9e6_a611_1d53_e80a_3db5n,
    0x9434_5321_06a7_c141_c920_d234_7a85_929bn,
    0x545f_093d_32b1_68fe_a6b5_2f4d_ea38_96a3n,
    0x61ce_291b_c3a4_357d_dbb2_0782_1e6d_5efen,
    0xe1e4_432a_6221_7fe4_cfd5_0c61_c8bb_98c1n,
  ];

  check(inputs, expected, f);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:516 oneshot_9_to_16_bytes
test("oneshot_9_to_16_bytes", () => test_9_to_16_bytes(Hasher.oneshot));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:521 streaming_9_to_16_bytes
test("streaming_9_to_16_bytes", () => test_9_to_16_bytes(hash_byte_by_byte));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:526 test_9_to_16_bytes
function test_9_to_16_bytes(f: (input: Uint8Array) => bigint): void {
  const inputs = bytes(9, 10, 11, 12, 13, 14, 15, 16);

  const expected = [
    0x16c7_69d8_3e4a_ebce_9079_3197_9dca_3746n,
    0xbd93_0669_a87b_4b37_e67b_f1ad_8dcf_73a8n,
    0xacad_8071_8f47_d494_7d67_cfc1_730f_22a3n,
    0x38f9_2247_a7f7_3cc5_7780_eb31_198f_13can,
    0xae92_e123_e947_2408_bd79_5526_1902_66c0n,
    0x5f91_e6bf_7418_cfaa_55d6_5715_e2a5_7c31n,
    0x301a_9f75_4e8f_569a_0017_ea4b_e19b_c787n,
    0x7295_0631_8276_07e2_8428_12cc_870d_cae2n,
  ];

  check(inputs, expected, f);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:547 oneshot_17_to_128_bytes
test("oneshot_17_to_128_bytes", () => test_17_to_128_bytes(Hasher.oneshot));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:552 streaming_17_to_128_bytes
test("streaming_17_to_128_bytes", () => test_17_to_128_bytes(hash_byte_by_byte));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:557 test_17_to_128_bytes
function test_17_to_128_bytes(f: (input: Uint8Array) => bigint): void {
  const lower_boundary = bytes(17, 18, 19);
  const chunk_boundary = bytes(31, 32, 33);
  const upper_boundary = bytes(126, 127, 128);

  const inputs = [...lower_boundary, ...chunk_boundary, ...upper_boundary];

  const expected = [
    // lower_boundary
    0x685b_c458_b37d_057f_c06e_233d_f772_9217n,
    0x87ce_996b_b557_6d8d_e3a3_c96b_b0af_2c23n,
    0x7619_bcef_2e31_1cd8_c47d_dc58_8737_93dfn,
    // chunk_boundary
    0x4ed3_946d_393b_687b_b54d_e399_3874_ed20n,
    0x25e7_c9b3_424c_eed2_457d_9566_b6fc_d697n,
    0x0217_5c3a_abb0_0637_e08d_8495_1339_de86n,
    // upper_boundary
    0x0abc_2062_87ce_2afe_5181_0be2_9323_2106n,
    0xd5ad_d870_c9c9_e00f_060c_2e3d_df0f_2fb9n,
    0x1479_2fc3_af88_dc6c_0532_1a0b_64d6_7b41n,
  ];

  check(inputs, expected, f);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:589 oneshot_129_to_240_bytes
test("oneshot_129_to_240_bytes", () => test_129_to_240_bytes(Hasher.oneshot));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:594 streaming_129_to_240_bytes
test("streaming_129_to_240_bytes", () => test_129_to_240_bytes(hash_byte_by_byte));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:599 test_129_to_240_bytes
function test_129_to_240_bytes(f: (input: Uint8Array) => bigint): void {
  const lower_boundary = bytes(129, 130, 131);
  const upper_boundary = bytes(238, 239, 240);

  const inputs = [...lower_boundary, ...upper_boundary];

  const expected = [
    // lower_boundary
    0xdd5e_74ac_6b45_f54e_bc30_b633_82b0_9a3bn,
    0x6cd2_e56a_10f1_e707_3ec5_f135_d0a7_d28fn,
    0x6da7_92f1_702d_4494_5609_cfc7_9dba_18fdn,
    // upper_boundary
    0x73a9_e8f7_bd32_83c8_2a9b_ddd0_e5c4_014cn,
    0x9843_ab31_a06b_e0df_fe21_3746_28fc_c539n,
    0x65b5_be86_da55_40e7_c92b_68e1_6f83_bbb6n,
  ];

  check(inputs, expected, f);
}

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:623 oneshot_241_plus_bytes
test("oneshot_241_plus_bytes", () => test_241_plus_bytes(Hasher.oneshot));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:628 streaming_241_plus_bytes
test("streaming_241_plus_bytes", () => test_241_plus_bytes(hash_byte_by_byte));

// crate: twox-hash-2.1.2/src/xxhash3_128.rs:633 test_241_plus_bytes
function test_241_plus_bytes(f: (input: Uint8Array) => bigint): void {
  const inputs = bytes(241, 242, 243, 244, 1024, 10240);

  const expected = [
    0x1da1_cb61_bcb8_a2a1_02e8_cd95_421c_6d02n,
    0x1623_84cb_44d1_d806_ddcb_33c4_9405_1832n,
    0xbd2e_9fcf_378c_35e9_8835_f952_9193_e3dcn,
    0x3ff4_93d7_a813_7ab6_bc17_c91e_c3cf_8d7fn,
    0xd0ac_1f7b_93bf_57b9_e5d7_8baf_a45b_2aa5n,
    0x4f63_75cc_a7ec_e1e1_bcd6_3266_df6e_2244n,
  ];

  check(inputs, expected, f);
}
