// compiler/rustc_lint/src/nonstandard_style/tests.rs
import { expect, test } from "bun:test";
import { is_upper_camel_case, to_upper_camel_case } from "../nonstandard_style.ts";

// rustc: compiler/rustc_lint/src/nonstandard_style/tests.rs:4 camel_case
test("camel_case", () => {
  expect(!is_upper_camel_case("userData")).toBe(true);
  expect(to_upper_camel_case("userData")).toBe("UserData");

  expect(is_upper_camel_case("X86_64")).toBe(true);

  expect(!is_upper_camel_case("X86__64")).toBe(true);
  expect(to_upper_camel_case("X86__64")).toBe("X86_64");

  expect(!is_upper_camel_case("Abc_123")).toBe(true);
  expect(to_upper_camel_case("Abc_123")).toBe("Abc123");

  expect(!is_upper_camel_case("A1_b2_c3")).toBe(true);
  expect(to_upper_camel_case("A1_b2_c3")).toBe("A1B2C3");

  expect(!is_upper_camel_case("ONE_TWO_THREE")).toBe(true);
  expect(to_upper_camel_case("ONE_TWO_THREE")).toBe("OneTwoThree");

  // FIXME(@Jules-Bertholet): This test doesn't work due to what I believe
  // is a Unicode spec bug - uppercase Georgian letters have
  // incorrect titlecase mappings.
  // I've reported it to Unicode.
  // Georgian mtavruli is only used in all-caps
  //assert!(!is_upper_camel_case("ᲫალაᲔრთობაშია"));
  //assert_eq!(to_upper_camel_case("ᲫალაᲔრთობაშია"), "ძალა_ერთობაშია");

  expect(!is_upper_camel_case("ǇǊaaaǄooo")).toBe(true);
  expect(to_upper_camel_case("ǇǊaaǈǊaǄooo")).toBe("ǈǌaaǈǋaǅooo");

  // Final sigma
  expect(!is_upper_camel_case("ΦΙΛΟΣ_ΦΙΛΟΣ")).toBe(true);
  expect(to_upper_camel_case("ΦΙΛΟΣ_ΦΙΛΟΣ")).toBe("ΦιλοςΦιλος");
  expect(is_upper_camel_case("ΦιλοσΦιλοσ")).toBe(true);
});
