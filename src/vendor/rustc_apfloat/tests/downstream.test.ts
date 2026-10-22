// Port of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `tests/downstream.rs`.
//
// PORT: conventions as in tests/ieee.test.ts. The `u32` / `u64` / `u128` bit patterns are `bigint`s (`.into()` is the
// identity); host `f32` / `f64` values are JS numbers (`f32::from_bits` / `f64::from_bits` through a `DataView`).
//
//! Tests added to `rustc_apfloat`, that were not ported from the C++ code.

import { expect, test } from "bun:test";
import { Double, Single, X87DoubleExtended } from "../ieee.ts";

const buf = new DataView(new ArrayBuffer(8));
/** `f32::from_bits(bits) as i128 as f32).to_bits()` (PORT: Rust's `as`: float -> int truncates and saturates, NaN is 0;
 * int -> float rounds to nearest. The truncated values here are exact `f32` integers, so `Math.fround` is exact.) */
function f32_roundtrip_through_i128(bits: bigint): bigint {
  buf.setUint32(0, Number(bits));
  const i = as_i128(buf.getFloat32(0));
  buf.setFloat32(0, Math.fround(Number(i)));
  return BigInt(buf.getUint32(0));
}
/** `(f64::from_bits(bits) as i128 as f64).to_bits()` (see above). */
function f64_roundtrip_through_i128(bits: bigint): bigint {
  buf.setBigUint64(0, bits);
  const i = as_i128(buf.getFloat64(0));
  buf.setFloat64(0, Number(i));
  return buf.getBigUint64(0);
}
/** `x as i128` for a host float. */
function as_i128(x: number): bigint {
  if (Number.isNaN(x)) return 0n;
  const MIN = -(1n << 127n);
  const MAX = (1n << 127n) - 1n;
  if (x === Infinity) return MAX;
  if (x === -Infinity) return MIN;
  const t = BigInt(Math.trunc(x));
  return t < MIN ? MIN : t > MAX ? MAX : t;
}

// `f32 -> i128 -> f32` previously-crashing bit-patterns (found by fuzzing).
export const FUZZ_IEEE32_ROUNDTRIP_THROUGH_I128_CASES: readonly bigint[] = [
    0xff000000n, // -1.7014118e+38
    0xff00e203n, // -1.713147e+38
    0xff00e900n, // -1.7135099e+38
    0xff7fffffn, // -3.4028235e+38
    0xff800000n, // -inf
];

// `f64 -> i128 -> f64` previously-crashing bit-patterns (found by fuzzing).
export const FUZZ_IEEE64_ROUNDTRIP_THROUGH_I128_CASES: readonly bigint[] = [
    0xc7e5d58020ffedffn, // -2.3217876724230413e+38
    0xc7e7fffefefeff00n, // -2.5521161229511617e+38
    0xc7e8030000653636n, // -2.5533639056589687e+38
    0xea3501e2e8950007n, // -4.116505897277026e+203
    0xf3ff0620ca000600n, // -5.553072340247723e+250
    0xffc909842600d4ffn, // -3.516340112093497e+307
    0xfff0000000000000n, // -inf
];

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/downstream.rs:27 fuzz_roundtrip_through_i128
test("fuzz_roundtrip_through_i128", () => {
  for (const bits of FUZZ_IEEE32_ROUNDTRIP_THROUGH_I128_CASES) {
    expect(Single.from_i128(Single.from_bits(bits).to_i128(128).value).value.to_bits()).toBe(f32_roundtrip_through_i128(bits));
  }
  for (const bits of FUZZ_IEEE64_ROUNDTRIP_THROUGH_I128_CASES) {
    expect(Double.from_i128(Double.from_bits(bits).to_i128(128).value).value.to_bits()).toBe(f64_roundtrip_through_i128(bits));
  }
});

// `f32` FMA bit-patterns which used to produce the wrong output (found by fuzzing).
export const FUZZ_IEEE32_FMA_CASES_WITH_EXPECTED_OUTPUTS: readonly [[bigint, bigint, bigint], bigint][] = [
    [[0x00001000n /* 5.74e-42 */, 0x0000001an /* 3.6e-44 */, 0xffff1a00n /* NaN */], 0xffff1a00n /* NaN */],
    [[0x000080aan /* 4.6156e-41 */, 0xaaff0000n /* -4.52971e-13 */, 0xff9e007fn /* NaN */], 0xffde007fn /* NaN */],
    [[0x0000843fn /* 4.7441e-41 */, 0x0084ff80n /* 1.2213942e-38 */, 0xffff8000n /* NaN */], 0xffff8000n /* NaN */],
    [[0x00009eaan /* 5.6918e-41 */, 0x201d7f1en /* 1.3340477e-19 */, 0xffff0001n /* NaN */], 0xffff0001n /* NaN */],
    [[0x020400ffn /* 9.698114e-38 */, 0x7f7f2200n /* 3.3912968e+38 */, 0xffffffffn /* NaN */], 0xffffffffn /* NaN */],
    [[0x02060320n /* 9.845662e-38 */, 0x20002521n /* 1.0854307e-19 */, 0x7f800000n /* inf */], 0x7f800000n /* inf */],
    [
        [0x04000080n /* 1.5046557e-36 */, 0xff7fff00n /* -3.4027717e+38 */, 0xff800000n /* -inf */],
        0xff800000n, /* -inf */
    ],
    [
        [0x04007faan /* 1.5104948e-36 */, 0xff200000n /* -2.1267648e+38 */, 0xffff0000n /* NaN */],
        0xffff0000n, /* NaN */
    ],
    [[0x1e0603ffn /* 7.094727e-21 */, 0x00100000n /* 1.469368e-39 */, 0xffffff4fn /* NaN */], 0xffffff4fn /* NaN */],
    [[0x200004aan /* 1.0843565e-19 */, 0x00202020n /* 2.95026e-39 */, 0x7fff00ffn /* NaN */], 0x7fff00ffn /* NaN */],
    [
        [0x20005eaan /* 1.0873343e-19 */, 0x9e9e9e3an /* -1.6794342e-20 */, 0xff9e009en /* NaN */],
        0xffde009en, /* NaN */
    ],
    [[0x20007faan /* 1.0884262e-19 */, 0x9e00611en /* -6.796347e-21 */, 0x7faa0600n /* NaN */], 0x7fea0600n /* NaN */],
    [
        [0x20007faan /* 1.0884262e-19 */, 0xaa069e1en /* -1.1956449e-13 */, 0xffffecffn /* NaN */],
        0xffffecffn, /* NaN */
    ],
    [[0x20025eaan /* 1.104275e-19 */, 0x9e01033an /* -6.82987e-21 */, 0xff9e009en /* NaN */], 0xffde009en /* NaN */],
    [[0x3314f400n /* 3.4680852e-8 */, 0x00ff7903n /* 2.3461462e-38 */, 0xffffffdbn /* NaN */], 0xffffffdbn /* NaN */],
    [[0x3314f400n /* 3.4680852e-8 */, 0x00ff7903n /* 2.3461462e-38 */, 0xfffffff6n /* NaN */], 0xfffffff6n /* NaN */],
    [[0x3a218275n /* 0.0006161102 */, 0x3a3a3a3an /* 0.00071040133 */, 0x7f8a063an /* NaN */], 0x7fca063an /* NaN */],
    [[0x40000001n /* 2.0000002 */, 0xfefffffen /* -1.7014116e+38 */, 0xfffe40ffn /* NaN */], 0xfffe40ffn /* NaN */],
    [[0x50007faan /* 8623401000 */, 0x000011fbn /* 6.45e-42 */, 0xff800000n /* -inf */], 0xff800000n /* -inf */],
    [[0x64007f8bn /* 9.481495e+21 */, 0xfa9a8702n /* -4.01176e+35 */, 0xff820000n /* NaN */], 0xffc20000n /* NaN */],
    [[0x6a017faan /* 3.9138577e+25 */, 0x00000070n /* 1.57e-43 */, 0xff80db03n /* NaN */], 0xffc0db03n /* NaN */],
    [[0x6a017faan /* 3.9138577e+25 */, 0x00000070n /* 1.57e-43 */, 0xff80db23n /* NaN */], 0xffc0db23n /* NaN */],
    [
        [0x6e000000n /* 9.9035203e+27 */, 0xdf008000n /* -9259401000000000000 */, 0x7f800000n /* inf */],
        0x7f800000n, /* inf */
    ],
    [[0x7f7fff00n /* 3.4027717e+38 */, 0x02000080n /* 9.404098e-38 */, 0x7fc00000n /* NaN */], 0x7fc00000n /* NaN */],
    [
        [0xb3eb00ffn /* -1.09432214e-7 */, 0x00ffefe2n /* 2.3504105e-38 */, 0xfffffee9n /* NaN */],
        0xfffffee9n, /* NaN */
    ],
    [
        [0xdf0603ffn /* -9656842000000000000 */, 0x808000ffn /* -1.1755301e-38 */, 0xff9b0000n /* NaN */],
        0xffdb0000n, /* NaN */
    ],
    [
        [
            0xf1001101n, /* -634154200000000000000000000000 */
            0x7f400000n, /* 255211780000000000000000000000000000000 */
            0x7f800000n, /* inf */
        ],
        0x7f800000n, /* inf */
    ],
    [[0xf5000080n /* -1.6226175e+32 */, 0xc9ffff00n /* -2097120 */, 0xffff7fffn /* NaN */], 0xffff7fffn /* NaN */],
    [
        [0xf5ffffffn /* -6.4903707e+32 */, 0xff000b09n /* -1.7019848e+38 */, 0xff800000n /* -inf */],
        0xff800000n, /* -inf */
    ],
    [
        [0xf70029e8n /* -2.5994686e+33 */, 0xf7ffff7fn /* -1.0384514e+34 */, 0xffff7fffn /* NaN */],
        0xffff7fffn, /* NaN */
    ],
    [
        [0xff007faan /* -1.7080405e+38 */, 0xd3fface5n /* -2196234700000 */, 0xffff7f00n /* NaN */],
        0xffff7f00n, /* NaN */
    ],
    [
        [0xff200000n /* -2.1267648e+38 */, 0xe380ffffn /* -4.7592594e+21 */, 0xff800000n /* -inf */],
        0xff800000n, /* -inf */
    ],
    [[0xff6d0000n /* -3.1502704e+38 */, 0xc12005ffn /* -10.001464 */, 0xff800000n /* -inf */], 0xff800000n /* -inf */],
];

// `f64` FMA bit-patterns which used to produce the wrong output (found by fuzzing).
export const FUZZ_IEEE64_FMA_CASES_WITH_EXPECTED_OUTPUTS: readonly [[bigint, bigint, bigint], bigint][] = [
    [
        [
            0x000000000000001en, /* 1.5e-322 */
            0x00000000ffdf0000n, /* 2.120927281e-314 */
            0xffffff8000000000n, /* NaN */
        ],
        0xffffff8000000000n, /* NaN */
    ],
    [
        [
            0x000000007fffffffn, /* 1.060997895e-314 */
            0xff00000000200000n, /* -5.486124071348364e+303 */
            0xfffd0000000000e9n, /* NaN */
        ],
        0xfffd0000000000e9n, /* NaN */
    ],
    [
        [
            0x0000020000e30000n, /* 1.086469195027e-311 */
            0xff00000011000000n, /* -5.48612441622957e+303 */
            0xfffd00000000e0e9n, /* NaN */
        ],
        0xfffd00000000e0e9n, /* NaN */
    ],
    [
        [
            0x0000040000006400n, /* 2.1729237025965e-311 */
            0x000000e5ff000000n, /* 4.88050742876e-312 */
            0xffffffe300000000n, /* NaN */
        ],
        0xffffffe300000000n, /* NaN */
    ],
    [
        [
            0x00006a0000000000n, /* 5.75824777836336e-310 */
            0x005015000018f9f1n, /* 3.5783707339010265e-307 */
            0x7fffffde00000000n, /* NaN */
        ],
        0x7fffffde00000000n, /* NaN */
    ],
    [
        [
            0x00007ffa01000373n, /* 6.95208343930866e-310 */
            0x0005000000ff107fn, /* 6.95335589042254e-309 */
            0xffffffff00000005n, /* NaN */
        ],
        0xffffffff00000005n, /* NaN */
    ],
    [
        [
            0x0000ff8000000000n, /* 1.387955006954565e-309 */
            0x0000000001000000n, /* 8.289046e-317 */
            0xfff0000000000000n, /* -inf */
        ],
        0xfff0000000000000n, /* -inf */
    ],
    [
        [
            0x0002a000f6290000n, /* 3.650532203442106e-309 */
            0x400013fffd000000n, /* 2.009765602648258 */
            0xfffdfe0000ff9affn, /* NaN */
        ],
        0xfffdfe0000ff9affn, /* NaN */
    ],
    [
        [
            0x0006000000001700n, /* 8.344026969431096e-309 */
            0xd9000000da080000n, /* -5.164503950933907e+120 */
            0xfffffee5000000fdn, /* NaN */
        ],
        0xfffffee5000000fdn, /* NaN */
    ],
    [
        [
            0x0006000040000013n, /* 8.344032274391576e-309 */
            0xfafe036500061100n, /* -2.7893890583525793e+284 */
            0xffff7fff00001011n, /* NaN */
        ],
        0xffff7fff00001011n, /* NaN */
    ],
    [
        [
            0x00f1000000640000n, /* 3.873408578194326e-304 */
            0xffe6005e00000000n, /* -1.2359946076651026e+308 */
            0xfffd007000000000n, /* NaN */
        ],
        0xfffd007000000000n, /* NaN */
    ],
    [
        [
            0x05203a0080ff0513n, /* 5.456081264530354e-284 */
            0xf90000000000f7ffn, /* -6.924462078599005e+274 */
            0xfff0000000000000n, /* -inf */
        ],
        0xfff0000000000000n, /* -inf */
    ],
    [
        [
            0x0540400001000513n, /* 2.1855837639726535e-283 */
            0xee05130640000100n, /* -9.522265158052987e+221 */
            0x7fff00001004fa01n, /* NaN */
        ],
        0x7fff00001004fa01n, /* NaN */
    ],
    [
        [
            0x0540400001000513n, /* 2.1855837639726535e-283 */
            0xffd8000000000000n, /* -6.741349255733685e+307 */
            0xfff0001000000000n, /* NaN */
        ],
        0xfff8001000000000n, /* NaN */
    ],
    [
        [
            0x054040000100e213n, /* 2.1855837639996873e-283 */
            0xfbd8000000000000n, /* -3.6544927542749997e+288 */
            0xfff0ff1000000000n, /* NaN */
        ],
        0xfff8ff1000000000n, /* NaN */
    ],
    [
        [
            0x060000000000ff04n, /* 8.814425663530262e-280 */
            0x00000020ffff0606n, /* 7.00258294846e-313 */
            0xffffffde00001300n, /* NaN */
        ],
        0xffffffde00001300n, /* NaN */
    ],
    [
        [
            0x1306400001000513n, /* 5.042468007014986e-217 */
            0x00001004fa03ee05n, /* 8.7022551317144e-311 */
            0xfffc80f7ffff7fffn, /* NaN */
        ],
        0xfffc80f7ffff7fffn, /* NaN */
    ],
    [
        [
            0x1306400001000513n, /* 5.042468007014986e-217 */
            0xa5001004fa01ee05n, /* -1.810368898568446e-130 */
            0xfffa80f7ff1b7fffn, /* NaN */
        ],
        0xfffa80f7ff1b7fffn, /* NaN */
    ],
    [
        [
            0x4006400005130100n, /* 2.7812500378059895 */
            0x0000ff4000000000n, /* 1.38659692964835e-309 */
            0x7fffffec4200044bn, /* NaN */
        ],
        0x7fffffec4200044bn, /* NaN */
    ],
    [
        [
            0x4100000001000000n, /* 131072.00048828125 */
            0x0000fffffff00000n, /* 1.390671156386347e-309 */
            0xfffffe00000040ffn, /* NaN */
        ],
        0xfffffe00000040ffn, /* NaN */
    ],
    [
        [
            0x7a7a7a7a7a7a0000n, /* 9.61276249042562e+281 */
            0xff7a7a7a7a7a7a7an, /* -1.1621116772547446e+306 */
            0xfffd007000ef0000n, /* NaN */
        ],
        0xfffd007000ef0000n, /* NaN */
    ],
    [
        [
            0x7f000012007ff010n, /* 5.4862182545686e+303 */
            0x7f0000120091f010n, /* 5.486218256005604e+303 */
            0xfff0000000000000n, /* -inf */
        ],
        0xfff0000000000000n, /* -inf */
    ],
    [
        [
            0x7f0022000a8000f6n, /* 5.531663399192155e+303 */
            0xff00ebfef0800300n, /* -5.802213559159178e+303 */
            0x7ff0000000000000n, /* inf */
        ],
        0x7ff0000000000000n, /* inf */
    ],
    [
        [
            0x7f06400001000513n, /* 7.62914130360521e+303 */
            0xff001004fb88f7ffn, /* -5.507580309563204e+303 */
            0xfffa01ee0513ffffn, /* NaN */
        ],
        0xfffa01ee0513ffffn, /* NaN */
    ],
    [
        [
            0xbbbbbb7f01000513n, /* -5.872565540268704e-21 */
            0x0100bbbbbbbbbbbbn, /* 7.625298445452731e-304 */
            0xffffff4000004000n, /* NaN */
        ],
        0xffffff4000004000n, /* NaN */
    ],
    [
        [
            0xbc00000000400000n, /* -1.0842021734952464e-19 */
            0x00bc000000004000n, /* 3.987332354453194e-305 */
            0xfff0000000e20000n, /* NaN */
        ],
        0xfff8000000e20000n, /* NaN */
    ],
    [
        [
            0xddff000004000000n, /* -6.048387862754913e+144 */
            0xff00000000000000n, /* -5.486124068793689e+303 */
            0xffffff0000000000n, /* NaN */
        ],
        0xffffff0000000000n, /* NaN */
    ],
    [
        [
            0xe100051b060c0513n, /* -1.759578741202065e+159 */
            0xfbfeee0513064110n, /* -1.8838766970066999e+289 */
            0xffff7fdf00001004n, /* NaN */
        ],
        0xffff7fdf00001004n, /* NaN */
    ],
    [
        [
            0xf0000000007ff010n, /* -3.1050361903821855e+231 */
            0x7f06010800180000n, /* 7.54480183807128e+303 */
            0x7ff0000000000000n, /* inf */
        ],
        0x7ff0000000000000n, /* inf */
    ],
    [
        [
            0xf4ffff05021d7d12n, /* -3.753309156386366e+255 */
            0xfd100000e8030000n, /* -2.5546778042386733e+294 */
            0xfff0000000000000n, /* -inf */
        ],
        0xfff0000000000000n, /* -inf */
    ],
    [
        [
            0xff0000fff05f0001n, /* -5.48746313513839e+303 */
            0xff0000fff0800000n, /* -5.487463137772898e+303 */
            0xfff0000000000000n, /* -inf */
        ],
        0xfff0000000000000n, /* -inf */
    ],
];

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/downstream.rs:376 fuzz_fma_with_expected_outputs
test("fuzz_fma_with_expected_outputs", () => {
  for (const [[a_bits, b_bits, c_bits], expected_bits] of FUZZ_IEEE32_FMA_CASES_WITH_EXPECTED_OUTPUTS) {
    const [a, b, c] = [Single.from_bits(a_bits), Single.from_bits(b_bits), Single.from_bits(c_bits)];
    expect(a.mul_add(b, c).value.to_bits()).toBe(expected_bits);
  }
  for (const [[a_bits, b_bits, c_bits], expected_bits] of FUZZ_IEEE64_FMA_CASES_WITH_EXPECTED_OUTPUTS) {
    const [a, b, c] = [Double.from_bits(a_bits), Double.from_bits(b_bits), Double.from_bits(c_bits)];
    expect(a.mul_add(b, c).value.to_bits()).toBe(expected_bits);
  }
});

// x87 80-bit "extended precision"/`long double` bit-patterns which used to
// produce the wrong output when negated (found by fuzzing - though fuzzing also
// found many examples in all ops, as the root issue was the handling of the
// bit-level encoding itself, but negation was the easiest op to test here).
export const FUZZ_X87_F80_NEG_CASES_WITH_EXPECTED_OUTPUTS: readonly [bigint, bigint][] = [
    [0x01010101010100000000n /* NaN */, 0xffff0101010100000000n /* NaN */],
    [
        0x0000ff7f2300ff000000n, /* 6.71098449692300485303E-4932 */
        0x8001ff7f2300ff000000n, /* -6.71098449692300485303E-4932 */
    ],
    [
        0x00008000000000000000n, /* 3.36210314311209350626E-4932 */
        0x80018000000000000000n, /* -3.36210314311209350626E-4932 */
    ],
];

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/downstream.rs:406 fuzz_x87_f80_neg_with_expected_outputs
test("fuzz_x87_f80_neg_with_expected_outputs", () => {
  for (const [bits, expected_bits] of FUZZ_X87_F80_NEG_CASES_WITH_EXPECTED_OUTPUTS) {
    expect(X87DoubleExtended.from_bits(bits).neg().to_bits()).toBe(expected_bits);
  }
});
