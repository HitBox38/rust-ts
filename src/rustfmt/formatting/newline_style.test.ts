// Port of the `#[cfg(test)] mod tests` of src/tools/rustfmt/src/formatting/newline_style.rs:85 (lane rustfmt-contract-3).
import { expect, test } from "bun:test";
import type { NewlineStyle } from "../config/mod.ts";
import { EffectiveNewlineStyle, apply_newline_style, auto_detect_newline_style } from "./newline_style.ts";

/** `cfg!(windows)`, as `native_newline_style` reads it. */
const cfg_windows = process.platform === "win32";

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:89 auto_detects_unix_newlines
test("auto_detects_unix_newlines", () => {
  expect(auto_detect_newline_style("One\nTwo\nThree")).toBe(EffectiveNewlineStyle.Unix);
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:97 auto_detects_windows_newlines
test("auto_detects_windows_newlines", () => {
  expect(auto_detect_newline_style("One\r\nTwo\r\nThree")).toBe(EffectiveNewlineStyle.Windows);
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:105 auto_detects_windows_newlines_with_multibyte_char_on_first_line
test("auto_detects_windows_newlines_with_multibyte_char_on_first_line", () => {
  expect(auto_detect_newline_style("A 🎢 of a first line\r\nTwo\r\nThree")).toBe(EffectiveNewlineStyle.Windows);
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:113 falls_back_to_native_newlines_if_no_newlines_are_found
test("falls_back_to_native_newlines_if_no_newlines_are_found", () => {
  const expected_newline_style = cfg_windows ? EffectiveNewlineStyle.Windows : EffectiveNewlineStyle.Unix;
  expect(auto_detect_newline_style("One Two Three")).toBe(expected_newline_style);
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:126 auto_detects_and_applies_unix_newlines
test("auto_detects_and_applies_unix_newlines", () => {
  const formatted_text = "One\nTwo\nThree";
  const raw_input_text = "One\nTwo\nThree";

  const out = { value: formatted_text };
  apply_newline_style("Auto", out, raw_input_text);
  expect(out.value, "auto should detect 'lf'").toBe("One\nTwo\nThree");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:136 auto_detects_and_applies_windows_newlines
test("auto_detects_and_applies_windows_newlines", () => {
  const formatted_text = "One\nTwo\nThree";
  const raw_input_text = "One\r\nTwo\r\nThree";

  const out = { value: formatted_text };
  apply_newline_style("Auto", out, raw_input_text);
  expect(out.value, "auto should detect 'crlf'").toBe("One\r\nTwo\r\nThree");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:146 auto_detects_and_applies_native_newlines
test("auto_detects_and_applies_native_newlines", () => {
  const formatted_text = "One\nTwo\nThree";
  const raw_input_text = "One Two Three";

  const out = { value: formatted_text };
  apply_newline_style("Auto", out, raw_input_text);

  if (cfg_windows) {
    expect(out.value, "auto-native-windows should detect 'crlf'").toBe("One\r\nTwo\r\nThree");
  } else {
    expect(out.value, "auto-native-unix should detect 'lf'").toBe("One\nTwo\nThree");
  }
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:167 applies_unix_newlines
test("applies_unix_newlines", () => {
  test_newlines_are_applied_correctly("One\r\nTwo\nThree", "One\nTwo\nThree", "Unix");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:176 applying_unix_newlines_changes_nothing_for_unix_newlines
test("applying_unix_newlines_changes_nothing_for_unix_newlines", () => {
  const formatted_text = "One\nTwo\nThree";
  test_newlines_are_applied_correctly(formatted_text, formatted_text, "Unix");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:182 applies_unix_newlines_to_string_with_unix_and_windows_newlines
test("applies_unix_newlines_to_string_with_unix_and_windows_newlines", () => {
  test_newlines_are_applied_correctly("One\r\nTwo\r\nThree\nFour", "One\nTwo\nThree\nFour", "Unix");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:191 applies_windows_newlines_to_string_with_unix_and_windows_newlines
test("applies_windows_newlines_to_string_with_unix_and_windows_newlines", () => {
  test_newlines_are_applied_correctly("One\nTwo\nThree\r\nFour", "One\r\nTwo\r\nThree\r\nFour", "Windows");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:200 applying_windows_newlines_changes_nothing_for_windows_newlines
test("applying_windows_newlines_changes_nothing_for_windows_newlines", () => {
  const formatted_text = "One\r\nTwo\r\nThree";
  test_newlines_are_applied_correctly(formatted_text, formatted_text, "Windows");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:206 keeps_carriage_returns_when_applying_windows_newlines_to_str_with_unix_newlines
test("keeps_carriage_returns_when_applying_windows_newlines_to_str_with_unix_newlines", () => {
  test_newlines_are_applied_correctly("One\nTwo\nThree\rDrei", "One\r\nTwo\r\nThree\rDrei", "Windows");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:215 keeps_carriage_returns_when_applying_unix_newlines_to_str_with_unix_newlines
test("keeps_carriage_returns_when_applying_unix_newlines_to_str_with_unix_newlines", () => {
  test_newlines_are_applied_correctly("One\nTwo\nThree\rDrei", "One\nTwo\nThree\rDrei", "Unix");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:224 keeps_carriage_returns_when_applying_windows_newlines_to_str_with_windows_newlines
test("keeps_carriage_returns_when_applying_windows_newlines_to_str_with_windows_newlines", () => {
  test_newlines_are_applied_correctly("One\r\nTwo\r\nThree\rDrei", "One\r\nTwo\r\nThree\rDrei", "Windows");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:233 keeps_carriage_returns_when_applying_unix_newlines_to_str_with_windows_newlines
test("keeps_carriage_returns_when_applying_unix_newlines_to_str_with_windows_newlines", () => {
  test_newlines_are_applied_correctly("One\r\nTwo\r\nThree\rDrei", "One\nTwo\nThree\rDrei", "Unix");
});

// rustc: src/tools/rustfmt/src/formatting/newline_style.rs:241 test_newlines_are_applied_correctly
function test_newlines_are_applied_correctly(input: string, expected: string, newline_style: NewlineStyle): void {
  const out = { value: input };
  apply_newline_style(newline_style, out, input);
  expect(out.value).toBe(expected);
}
