// Port of the `#[cfg(test)] mod test` of anstream =0.6.21 `src/adapter/wincon.rs`.
// PORT: the `proptest!` property runs as a seeded loop (see ../proptest.ts).
import { expect, test } from "bun:test";
import { PLAIN, PRETTY } from "../../../std/fmt.ts";
import { Ansi256Color, AnsiColor, Color, Style, Style_default, type Style as StyleT } from "../../anstyle/lib.ts";
import { CASES, pc_string, rng } from "../proptest.ts";
import { WinconBytes } from "./wincon.ts";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// crate: anstream-0.6.21/src/adapter/wincon.rs:307 verify
function verify(input: string, expected: [StyleT, string][]): void {
  const state = WinconBytes.new();
  const actual = Array.from(state.extract_next(utf8(input)));
  expect(actual).toEqual(expected);
}

const display = (s: StyleT): string => Style.fmt(s, PLAIN);
const display_alt = (s: StyleT): string => Style.fmt(s, PRETTY);

// crate: anstream-0.6.21/src/adapter/wincon.rs:318 start
test("start", () => {
  const green_on_red = AnsiColor.on("Green", Color.from_AnsiColor("Red"));
  const input = `${display(green_on_red)}Hello${display_alt(green_on_red)} world!`;
  const expected: [StyleT, string][] = [
    [green_on_red, "Hello"],
    [Style_default(), " world!"],
  ];
  verify(input, expected);
});

// crate: anstream-0.6.21/src/adapter/wincon.rs:329 middle
test("middle", () => {
  const green_on_red = AnsiColor.on("Green", Color.from_AnsiColor("Red"));
  const input = `Hello ${display(green_on_red)}world${display_alt(green_on_red)}!`;
  const expected: [StyleT, string][] = [
    [Style_default(), "Hello "],
    [green_on_red, "world"],
    [Style_default(), "!"],
  ];
  verify(input, expected);
});

// crate: anstream-0.6.21/src/adapter/wincon.rs:341 end
test("end", () => {
  const green_on_red = AnsiColor.on("Green", Color.from_AnsiColor("Red"));
  const input = `Hello ${display(green_on_red)}world!${display_alt(green_on_red)}`;
  const expected: [StyleT, string][] = [
    [Style_default(), "Hello "],
    [green_on_red, "world!"],
  ];
  verify(input, expected);
});

// crate: anstream-0.6.21/src/adapter/wincon.rs:352 ansi256_colors
test("ansi256_colors", () => {
  const ansi_11 = new Ansi256Color(11).on_default();
  // termcolor only supports "brights" via these
  const input = `Hello ${display(ansi_11)}world${display_alt(ansi_11)}!`;
  const expected: [StyleT, string][] = [
    [Style_default(), "Hello "],
    [ansi_11, "world"],
    [Style_default(), "!"],
  ];
  verify(input, expected);
});

// crate: anstream-0.6.21/src/adapter/wincon.rs:367 wincon_no_escapes
test("wincon_no_escapes", () => {
  const r = rng(0x3c0);
  for (let i = 0; i < CASES; i++) {
    const s = pc_string(r);
    const expected: [StyleT, string][] = s.length === 0 ? [] : [[Style_default(), s]];
    const state = WinconBytes.new();
    const actual = Array.from(state.extract_next(utf8(s)));
    expect(actual).toEqual(expected);
  }
});
