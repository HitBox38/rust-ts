// Port of rustc_apfloat =0.2.3+llvm-462a31f5a5ab `tests/ppc.rs` (the crate's integration tests of `DoubleDouble`).
//
// PORT: conventions as in tests/ieee.test.ts (`assert!(c)` is `expect(c).toBe(true)`, `assert_eq!(a, b)` is
// `expect(a).toBe(b)`; `"..".parse::<DoubleDouble>().unwrap()` is `parse(..)`; the `assert_eq!` messages are comments).
import { expect, test } from "bun:test";
import { DoubleDouble } from "../ppc.ts";
import { Category, type Ordering, Round } from "../lib.ts";

/** `"..".parse::<DoubleDouble>().unwrap()` */
function parse(s: string): DoubleDouble {
  const r = DoubleDouble.from_str(s);
  if (r.$ === "Err") throw new Error(`${JSON.stringify(s)}: called \`Result::unwrap()\` on an \`Err\` value: ParseError(${JSON.stringify(r._0._0)})`);
  return r._0;
}

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:7 ppc_double_double
test("ppc_double_double", () => {
  let test = DoubleDouble.ZERO;
  let expected = parse("0x0p+0");
  expect(test.is_zero()).toBe(true);
  expect(!test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);
  expect(test.to_bits()).toBe(0n);

  test = DoubleDouble.ZERO.neg();
  expected = parse("-0x0p+0");
  expect(test.is_zero()).toBe(true);
  expect(test.is_negative()).toBe(true);
  expect(test.bitwise_eq(expected)).toBe(true);
  expect(test.to_bits()).toBe(0x8000000000000000n);

  test = parse("1.0");
  expect(test.to_bits()).toBe(0x3ff0000000000000n);

  // LDBL_MAX
  test = parse("1.79769313486231580793728971405301e+308");
  expect(test.to_bits()).toBe(0x7c8ffffffffffffe_7fefffffffffffffn);

  // LDBL_MIN
  test = parse("2.00416836000897277799610805135016e-292");
  expect(test.to_bits()).toBe(0x0000000000000000_0360000000000000n);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:39 ppc_double_double_add_special
test("ppc_double_double_add_special", () => {
  const data: [bigint, bigint, Category, Round][] = [
    // (1 + 0) + (-1 + 0) = Category::Zero
    [0x3ff0000000000000n, 0xbff0000000000000n, Category.Zero, Round.NearestTiesToEven],
    // LDBL_MAX + (1.1 >> (1023 - 106) + 0)) = Category::Infinity
    [0x7c8ffffffffffffe_7fefffffffffffffn, 0x7948000000000000n, Category.Infinity, Round.NearestTiesToEven],
    // FIXME: change the 4th 0x75effffffffffffe to 0x75efffffffffffff when
    // DoubleDouble's fallback is gone.
    // LDBL_MAX + (1.011111... >> (1023 - 106) + (1.1111111...0 >> (1023 -
    // 160))) = Category::Normal
    [0x7c8ffffffffffffe_7fefffffffffffffn, 0x75effffffffffffe_7947ffffffffffffn, Category.Normal, Round.NearestTiesToEven],
    // LDBL_MAX + (1.1 >> (1023 - 106) + 0)) = Category::Infinity
    [0x7c8ffffffffffffe_7fefffffffffffffn, 0x7c8ffffffffffffe_7fefffffffffffffn, Category.Infinity, Round.NearestTiesToEven],
    // NaN + (1 + 0) = Category::NaN
    [0x7ff8000000000000n, 0x3ff0000000000000n, Category.NaN, Round.NearestTiesToEven],
  ];

  for (const [op1, op2, expected, round] of data) {
    {
      let a1 = DoubleDouble.from_bits(op1);
      const a2 = DoubleDouble.from_bits(op2);
      a1 = a1.add_r(a2, round).value;

      expect(a1.category()).toBe(expected); // "{:#x} + {:#x}", op1, op2
    }
    {
      const a1 = DoubleDouble.from_bits(op1);
      let a2 = DoubleDouble.from_bits(op2);
      a2 = a2.add_r(a1, round).value;

      expect(a2.category()).toBe(expected); // "{:#x} + {:#x}", op2, op1
    }
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:85 ppc_double_double_add
test("ppc_double_double_add", () => {
  const data: [bigint, bigint, bigint, Round][] = [
    // (1 + 0) + (1e-105 + 0) = (1 + 1e-105)
    [0x3ff0000000000000n, 0x3960000000000000n, 0x3960000000000000_3ff0000000000000n, Round.NearestTiesToEven],
    // (1 + 0) + (1e-106 + 0) = (1 + 1e-106)
    [0x3ff0000000000000n, 0x3950000000000000n, 0x3950000000000000_3ff0000000000000n, Round.NearestTiesToEven],
    // (1 + 1e-106) + (1e-106 + 0) = (1 + 1e-105)
    [0x3950000000000000_3ff0000000000000n, 0x3950000000000000n, 0x3960000000000000_3ff0000000000000n, Round.NearestTiesToEven],
    // (1 + 0) + (epsilon + 0) = (1 + epsilon)
    [0x3ff0000000000000n, 0x0000000000000001n, 0x0000000000000001_3ff0000000000000n, Round.NearestTiesToEven],
    // FIXME: change 0xf950000000000000 to 0xf940000000000000, when
    // DoubleDouble's fallback is gone.
    // (DBL_MAX - 1 << (1023 - 105)) + (1 << (1023 - 53) + 0) = DBL_MAX +
    // 1.11111... << (1023 - 52)
    [0xf950000000000000_7fefffffffffffffn, 0x7c90000000000000n, 0x7c8ffffffffffffe_7fefffffffffffffn, Round.NearestTiesToEven],
    // FIXME: change 0xf950000000000000 to 0xf940000000000000, when
    // DoubleDouble's fallback is gone.
    // (1 << (1023 - 53) + 0) + (DBL_MAX - 1 << (1023 - 105)) = DBL_MAX +
    // 1.11111... << (1023 - 52)
    [0x7c90000000000000n, 0xf950000000000000_7fefffffffffffffn, 0x7c8ffffffffffffe_7fefffffffffffffn, Round.NearestTiesToEven],
  ];

  for (const [op1, op2, expected, round] of data) {
    {
      let a1 = DoubleDouble.from_bits(op1);
      const a2 = DoubleDouble.from_bits(op2);
      a1 = a1.add_r(a2, round).value;

      expect(a1.to_bits()).toBe(expected); // "{:#x} + {:#x}", op1, op2
    }
    {
      const a1 = DoubleDouble.from_bits(op1);
      let a2 = DoubleDouble.from_bits(op2);
      a2 = a2.add_r(a1, round).value;

      expect(a2.to_bits()).toBe(expected); // "{:#x} + {:#x}", op2, op1
    }
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:141 ppc_double_double_subtract
test("ppc_double_double_subtract", () => {
  const data: [bigint, bigint, bigint, Round][] = [
    // (1 + 0) - (-1e-105 + 0) = (1 + 1e-105)
    [0x3ff0000000000000n, 0xb960000000000000n, 0x3960000000000000_3ff0000000000000n, Round.NearestTiesToEven],
    // (1 + 0) - (-1e-106 + 0) = (1 + 1e-106)
    [0x3ff0000000000000n, 0xb950000000000000n, 0x3950000000000000_3ff0000000000000n, Round.NearestTiesToEven],
  ];

  for (const [op1, op2, expected, round] of data) {
    let a1 = DoubleDouble.from_bits(op1);
    const a2 = DoubleDouble.from_bits(op2);
    a1 = a1.sub_r(a2, round).value;

    expect(a1.to_bits()).toBe(expected); // "{:#x} - {:#x}", op1, op2
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:159 ppc_double_double_multiply_special
test("ppc_double_double_multiply_special", () => {
  const data: [bigint, bigint, Category, Round][] = [
    // Category::NaN * Category::NaN = Category::NaN
    [0x7ff8000000000000n, 0x7ff8000000000000n, Category.NaN, Round.NearestTiesToEven],
    // Category::NaN * Category::Zero = Category::NaN
    [0x7ff8000000000000n, 0n, Category.NaN, Round.NearestTiesToEven],
    // Category::NaN * Category::Infinity = Category::NaN
    [0x7ff8000000000000n, 0x7ff0000000000000n, Category.NaN, Round.NearestTiesToEven],
    // Category::NaN * Category::Normal = Category::NaN
    [0x7ff8000000000000n, 0x3ff0000000000000n, Category.NaN, Round.NearestTiesToEven],
    // Category::Infinity * Category::Infinity = Category::Infinity
    [0x7ff0000000000000n, 0x7ff0000000000000n, Category.Infinity, Round.NearestTiesToEven],
    // Category::Infinity * Category::Zero = Category::NaN
    [0x7ff0000000000000n, 0n, Category.NaN, Round.NearestTiesToEven],
    // Category::Infinity * Category::Normal = Category::Infinity
    [0x7ff0000000000000n, 0x3ff0000000000000n, Category.Infinity, Round.NearestTiesToEven],
    // Category::Zero * Category::Zero = Category::Zero
    [0n, 0n, Category.Zero, Round.NearestTiesToEven],
    // Category::Zero * Category::Normal = Category::Zero
    [0n, 0x3ff0000000000000n, Category.Zero, Round.NearestTiesToEven],
  ];

  for (const [op1, op2, expected, round] of data) {
    {
      let a1 = DoubleDouble.from_bits(op1);
      const a2 = DoubleDouble.from_bits(op2);
      a1 = a1.mul_r(a2, round).value;

      expect(a1.category()).toBe(expected); // "{:#x} * {:#x}", op1, op2
    }
    {
      const a1 = DoubleDouble.from_bits(op1);
      let a2 = DoubleDouble.from_bits(op2);
      a2 = a2.mul_r(a1, round).value;

      expect(a2.category()).toBe(expected); // "{:#x} * {:#x}", op2, op1
    }
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:200 ppc_double_double_multiply
test("ppc_double_double_multiply", () => {
  const data: [bigint, bigint, bigint, Round][] = [
    // 1/3 * 3 = 1.0
    [0x3c75555555555556_3fd5555555555555n, 0x4008000000000000n, 0x3ff0000000000000n, Round.NearestTiesToEven],
    // (1 + epsilon) * (1 + 0) = Category::Zero
    [0x0000000000000001_3ff0000000000000n, 0x3ff0000000000000n, 0x0000000000000001_3ff0000000000000n, Round.NearestTiesToEven],
    // (1 + epsilon) * (1 + epsilon) = 1 + 2 * epsilon
    [
      0x0000000000000001_3ff0000000000000n,
      0x0000000000000001_3ff0000000000000n,
      0x0000000000000002_3ff0000000000000n,
      Round.NearestTiesToEven,
    ],
    // -(1 + epsilon) * (1 + epsilon) = -1
    [0x0000000000000001_bff0000000000000n, 0x0000000000000001_3ff0000000000000n, 0xbff0000000000000n, Round.NearestTiesToEven],
    // (0.5 + 0) * (1 + 2 * epsilon) = 0.5 + epsilon
    [0x3fe0000000000000n, 0x0000000000000002_3ff0000000000000n, 0x0000000000000001_3fe0000000000000n, Round.NearestTiesToEven],
    // (0.5 + 0) * (1 + epsilon) = 0.5
    [0x3fe0000000000000n, 0x0000000000000001_3ff0000000000000n, 0x3fe0000000000000n, Round.NearestTiesToEven],
    // __LDBL_MAX__ * (1 + 1 << 106) = inf
    [0x7c8ffffffffffffe_7fefffffffffffffn, 0x3950000000000000_3ff0000000000000n, 0x7ff0000000000000n, Round.NearestTiesToEven],
    // __LDBL_MAX__ * (1 + 1 << 107) > __LDBL_MAX__, but not inf, yes =_=|||
    [
      0x7c8ffffffffffffe_7fefffffffffffffn,
      0x3940000000000000_3ff0000000000000n,
      0x7c8fffffffffffff_7fefffffffffffffn,
      Round.NearestTiesToEven,
    ],
    // __LDBL_MAX__ * (1 + 1 << 108) = __LDBL_MAX__
    [
      0x7c8ffffffffffffe_7fefffffffffffffn,
      0x3930000000000000_3ff0000000000000n,
      0x7c8ffffffffffffe_7fefffffffffffffn,
      Round.NearestTiesToEven,
    ],
  ];

  for (const [op1, op2, expected, round] of data) {
    {
      let a1 = DoubleDouble.from_bits(op1);
      const a2 = DoubleDouble.from_bits(op2);
      a1 = a1.mul_r(a2, round).value;

      expect(a1.to_bits()).toBe(expected); // "{:#x} * {:#x}", op1, op2
    }
    {
      const a1 = DoubleDouble.from_bits(op1);
      let a2 = DoubleDouble.from_bits(op2);
      a2 = a2.mul_r(a1, round).value;

      expect(a2.to_bits()).toBe(expected); // "{:#x} * {:#x}", op2, op1
    }
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:276 ppc_double_double_divide
test("ppc_double_double_divide", () => {
  // FIXME: Only a sanity check for now. Add more edge cases when the
  // double-double algorithm is implemented.
  const data: [bigint, bigint, bigint, Round][] = [
    // 1 / 3 = 1/3
    [0x3ff0000000000000n, 0x4008000000000000n, 0x3c75555555555556_3fd5555555555555n, Round.NearestTiesToEven],
  ];

  for (const [op1, op2, expected, round] of data) {
    let a1 = DoubleDouble.from_bits(op1);
    const a2 = DoubleDouble.from_bits(op2);
    a1 = a1.div_r(a2, round).value;

    expect(a1.to_bits()).toBe(expected); // "{:#x} / {:#x}", op1, op2
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:294 ppc_double_double_remainder
test("ppc_double_double_remainder", () => {
  const data: [bigint, bigint, bigint][] = [
    // ieee_rem(3.0 + 3.0 << 53, 1.25 + 1.25 << 53) = (0.5 + 0.5 << 53)
    [0x3cb8000000000000_4008000000000000n, 0x3ca4000000000000_3ff4000000000000n, 0x3c90000000000000_3fe0000000000000n],
    // ieee_rem(3.0 + 3.0 << 53, 1.75 + 1.75 << 53) = (-0.5 - 0.5 << 53)
    [0x3cb8000000000000_4008000000000000n, 0x3cac000000000000_3ffc000000000000n, 0xbc90000000000000_bfe0000000000000n],
  ];

  for (const [op1, op2, expected] of data) {
    const a1 = DoubleDouble.from_bits(op1);
    const a2 = DoubleDouble.from_bits(op2);
    const result = a1.ieee_rem(a2).value;

    expect(result.to_bits()).toBe(expected); // "ieee_rem({:#x}, {:#x})", op1, op2
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:312 ppc_double_double_mod
test("ppc_double_double_mod", () => {
  const data: [bigint, bigint, bigint][] = [
    // mod(3.0 + 3.0 << 53, 1.25 + 1.25 << 53) = (0.5 + 0.5 << 53)
    [0x3cb8000000000000_4008000000000000n, 0x3ca4000000000000_3ff4000000000000n, 0x3c90000000000000_3fe0000000000000n],
    // mod(3.0 + 3.0 << 53, 1.75 + 1.75 << 53) = (1.25 + 1.25 << 53)
    // 0xbc98000000000000 doesn't seem right, but it's what we currently have.
    // FIXME: investigate
    [0x3cb8000000000000_4008000000000000n, 0x3cac000000000000_3ffc000000000000n, 0xbc98000000000000_3ff4000000000001n],
  ];

  for (const [op1, op2, expected] of data) {
    const a1 = DoubleDouble.from_bits(op1);
    const a2 = DoubleDouble.from_bits(op2);
    const r = a1.rem(a2).value;

    expect(r.to_bits()).toBe(expected); // "fmod({:#x}, {:#x})", op1, op2
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:332 ppc_double_double_fma
test("ppc_double_double_fma", () => {
  // Sanity check for now.
  let a = parse("2");
  a = a.mul_add(parse("3"), parse("4")).value;
  expect(parse("10").partial_cmp(a)).toBe(0 satisfies Ordering);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:342 ppc_double_double_round_to_integral
test("ppc_double_double_round_to_integral", () => {
  {
    let a = parse("1.5");
    a = a.round_to_integral(Round.NearestTiesToEven).value;
    expect(parse("2").partial_cmp(a)).toBe(0 satisfies Ordering);
  }
  {
    let a = parse("2.5");
    a = a.round_to_integral(Round.NearestTiesToEven).value;
    expect(parse("2").partial_cmp(a)).toBe(0 satisfies Ordering);
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:356 ppc_double_double_compare
test("ppc_double_double_compare", () => {
  const data: [bigint, bigint, Ordering | undefined][] = [
    // (1 + 0) = (1 + 0)
    [0x3ff0000000000000n, 0x3ff0000000000000n, 0],
    // (1 + 0) < (1.00...1 + 0)
    [0x3ff0000000000000n, 0x3ff0000000000001n, -1],
    // (1.00...1 + 0) > (1 + 0)
    [0x3ff0000000000001n, 0x3ff0000000000000n, 1],
    // (1 + 0) < (1 + epsilon)
    [0x3ff0000000000000n, 0x0000000000000001_3ff0000000000001n, -1],
    // NaN != NaN
    [0x7ff8000000000000n, 0x7ff8000000000000n, undefined],
    // (1 + 0) != NaN
    [0x3ff0000000000000n, 0x7ff8000000000000n, undefined],
    // Inf = Inf
    [0x7ff0000000000000n, 0x7ff0000000000000n, 0],
  ];

  for (const [op1, op2, expected] of data) {
    const a1 = DoubleDouble.from_bits(op1);
    const a2 = DoubleDouble.from_bits(op2);
    expect(a1.partial_cmp(a2)).toBe(expected); // "compare({:#x}, {:#x})", op1, op2
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:382 ppc_double_double_bitwise_eq
test("ppc_double_double_bitwise_eq", () => {
  const data: [bigint, bigint, boolean][] = [
    // (1 + 0) = (1 + 0)
    [0x3ff0000000000000n, 0x3ff0000000000000n, true],
    // (1 + 0) != (1.00...1 + 0)
    [0x3ff0000000000000n, 0x3ff0000000000001n, false],
    // NaN = NaN
    [0x7ff8000000000000n, 0x7ff8000000000000n, true],
    // NaN != NaN with a different bit pattern
    [0x7ff8000000000000n, 0x3ff0000000000000_7ff8000000000000n, false],
    // Inf = Inf
    [0x7ff0000000000000n, 0x7ff0000000000000n, true],
  ];

  for (const [op1, op2, expected] of data) {
    const a1 = DoubleDouble.from_bits(op1);
    const a2 = DoubleDouble.from_bits(op2);
    expect(a1.bitwise_eq(a2)).toBe(expected); // "{:#x} = {:#x}", op1, op2
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:404 ppc_double_double_change_sign
test("ppc_double_double_change_sign", () => {
  const float = DoubleDouble.from_bits(0xbcb0000000000000_400f000000000000n);
  {
    const actual = float.copy_sign(parse("1"));
    expect(actual.to_bits()).toBe(0xbcb0000000000000_400f000000000000n);
  }
  {
    const actual = float.copy_sign(parse("-1"));
    expect(actual.to_bits()).toBe(0x3cb0000000000000_c00f000000000000n);
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:417 ppc_double_double_factories
test("ppc_double_double_factories", () => {
  expect(DoubleDouble.ZERO.to_bits()).toBe(0n);
  expect(DoubleDouble.largest().to_bits()).toBe(0x7c8ffffffffffffe_7fefffffffffffffn);
  expect(DoubleDouble.SMALLEST.to_bits()).toBe(0x0000000000000001n);
  expect(DoubleDouble.smallest_normalized().to_bits()).toBe(0x0360000000000000n);
  expect(DoubleDouble.ZERO.neg().to_bits()).toBe(0x0000000000000000_8000000000000000n);
  expect(DoubleDouble.largest().neg().to_bits()).toBe(0xfc8ffffffffffffe_ffefffffffffffffn);
  expect(DoubleDouble.SMALLEST.neg().to_bits()).toBe(0x0000000000000000_8000000000000001n);
  expect(DoubleDouble.smallest_normalized().neg().to_bits()).toBe(0x0000000000000000_8360000000000000n);
  expect(DoubleDouble.SMALLEST.is_smallest()).toBe(true);
  expect(DoubleDouble.largest().is_largest()).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:431 ppc_double_double_is_denormal
test("ppc_double_double_is_denormal", () => {
  expect(DoubleDouble.SMALLEST.is_denormal()).toBe(true);
  expect(!DoubleDouble.largest().is_denormal()).toBe(true);
  expect(!DoubleDouble.smallest_normalized().is_denormal()).toBe(true);
  {
    // (4 + 3) is not normalized
    const data = 0x4008000000000000_4010000000000000n;
    expect(DoubleDouble.from_bits(data).is_denormal()).toBe(true);
  }
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:443 ppc_double_double_exact_inverse
test("ppc_double_double_exact_inverse", () => {
  const inv = parse("2.0").get_exact_inverse();
  if (inv === undefined) throw new Error("called `Option::unwrap()` on a `None` value");
  expect(inv.bitwise_eq(parse("0.5"))).toBe(true);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:453 ppc_double_double_scalbn
test("ppc_double_double_scalbn", () => {
  // 3.0 + 3.0 << 53
  const input = 0x3cb8000000000000_4008000000000000n;
  const result = DoubleDouble.from_bits(input).scalbn(1);
  // 6.0 + 6.0 << 53
  expect(result.to_bits()).toBe(0x3cc8000000000000_4018000000000000n);
});

// crate: rustc_apfloat-0.2.3+llvm-462a31f5a5ab/tests/ppc.rs:462 ppc_double_double_frexp
test("ppc_double_double_frexp", () => {
  // 3.0 + 3.0 << 53
  const input = 0x3cb8000000000000_4008000000000000n;
  const exp = { value: 0 };
  // 0.75 + 0.75 << 53
  const result = DoubleDouble.from_bits(input).frexp(exp);
  expect(exp.value).toBe(2);
  expect(result.to_bits()).toBe(0x3c98000000000000_3fe8000000000000n);
});
