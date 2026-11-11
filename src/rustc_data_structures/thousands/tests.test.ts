// Port of compiler/rustc_data_structures/src/thousands/tests.rs.
import { expect, test } from "bun:test";
import { f64p1_with_underscores, format_with_underscores, isize_with_underscores, usize_with_underscores } from "./mod.ts";

// rustc: compiler/rustc_data_structures/src/thousands/tests.rs:4 test_format_with_underscores
test("test_format_with_underscores", () => {
  expect(format_with_underscores("")).toBe("");
  expect(format_with_underscores("0")).toBe("0");
  expect(format_with_underscores("12345.67e14")).toBe("12_345.67e14");
  expect(format_with_underscores("-1234.5678e10")).toBe("-1_234.5678e10");
  expect(format_with_underscores("------")).toBe("------");
  expect(format_with_underscores("abcdefgh")).toBe("abcdefgh");
  expect(format_with_underscores("-1b")).toBe("-1b");
  expect(format_with_underscores("-3456xyz")).toBe("-3_456xyz");
});

// rustc: compiler/rustc_data_structures/src/thousands/tests.rs:16 test_usize_with_underscores
test("test_usize_with_underscores", () => {
  expect(usize_with_underscores(0)).toBe("0");
  expect(usize_with_underscores(1)).toBe("1");
  expect(usize_with_underscores(99)).toBe("99");
  expect(usize_with_underscores(345)).toBe("345");
  expect(usize_with_underscores(1_000)).toBe("1_000");
  expect(usize_with_underscores(12_001)).toBe("12_001");
  expect(usize_with_underscores(999_999)).toBe("999_999");
  expect(usize_with_underscores(1_000_000)).toBe("1_000_000");
  expect(usize_with_underscores(12_345_678)).toBe("12_345_678");
});

// rustc: compiler/rustc_data_structures/src/thousands/tests.rs:29 test_isize_with_underscores
test("test_isize_with_underscores", () => {
  expect(isize_with_underscores(0)).toBe("0");
  expect(isize_with_underscores(-1)).toBe("-1");
  expect(isize_with_underscores(99)).toBe("99");
  expect(isize_with_underscores(345)).toBe("345");
  expect(isize_with_underscores(-1_000)).toBe("-1_000");
  expect(isize_with_underscores(12_001)).toBe("12_001");
  expect(isize_with_underscores(-999_999)).toBe("-999_999");
  expect(isize_with_underscores(1_000_000)).toBe("1_000_000");
  expect(isize_with_underscores(-12_345_678)).toBe("-12_345_678");
});

// rustc: compiler/rustc_data_structures/src/thousands/tests.rs:42 test_f64p1_with_underscores
test("test_f64p1_with_underscores", () => {
  expect(f64p1_with_underscores(0)).toBe("0.0");
  expect(f64p1_with_underscores(0.00000001)).toBe("0.0");
  expect(f64p1_with_underscores(-0.00000001)).toBe("-0.0");
  expect(f64p1_with_underscores(0.9999999)).toBe("1.0");
  expect(f64p1_with_underscores(-0.9999999)).toBe("-1.0");
  expect(f64p1_with_underscores(345.4999999)).toBe("345.5");
  expect(f64p1_with_underscores(-100_000)).toBe("-100_000.0");
  expect(f64p1_with_underscores(123456789.123456789)).toBe("123_456_789.1");
  expect(f64p1_with_underscores(-123456789.123456789)).toBe("-123_456_789.1");
});
