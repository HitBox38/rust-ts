// Port of anstyle-1.0.13's inline `#[cfg(test)]` tests (color.rs, effect.rs, reset.rs, style.rs) and
// of the asserting doc examples in effect.rs/style.rs, plus rust-ts checks whose expected values
// come from running anstyle 1.0.13 (see docs/handoff/annotate-a.md, "oracle evidence").
//
// PORT: `print_size_of` tests only `dbg!` Rust type sizes; there is nothing to port:
// crate-skip: anstyle-1.0.13/src/color.rs:658 print_size_of (Rust type sizes)
// crate-skip: anstyle-1.0.13/src/effect.rs:387 print_size_of (Rust type sizes)
// crate-skip: anstyle-1.0.13/src/reset.rs:30 print_size_of (Rust type sizes)
// crate-skip: anstyle-1.0.13/src/style.rs:433 print_size_of (Rust type sizes)
// The `no_align` tests check that `{:<10}` adds no padding. `Fmt` has no width flag and the
// `render*` functions return finished strings, so the port checks that rendering is stable.
import { expect, test } from "bun:test";
import { debug_vec, PLAIN, PRETTY } from "../../std/fmt.ts";
import { Ok } from "../../std/result.ts";
import {
  Ansi256Color,
  AnsiColor,
  Color,
  debug_Color,
  debug_Effects,
  debug_Reset,
  debug_Style,
  DISPLAY_BUFFER_CAPACITY,
  Effects,
  Reset,
  RgbColor,
  Style,
  Style_eq,
} from "./lib.ts";
import { utf8_len as utf8_len_of } from "../../std/str.ts";

// crate: anstyle-1.0.13/src/color.rs:650 max_display_buffer
test("color::max_display_buffer", () => {
  const c = new RgbColor(255, 255, 255);
  const actual = c.render_fg();
  expect(actual).toBe("\u{1b}[38;2;255;255;255m");
  expect(utf8_len_of(actual)).toBe(DISPLAY_BUFFER_CAPACITY);
});

// crate: anstyle-1.0.13/src/color.rs:668 no_align
test("color::no_align", () => {
  // crate: anstyle-1.0.13/src/color.rs:670 assert_no_align
  function assert_no_align(d: () => string): void {
    const expected = d();
    const actual = d();
    expect(actual).toBe(expected);
  }

  assert_no_align(() => AnsiColor.render_fg("White"));
  assert_no_align(() => AnsiColor.render_bg("White"));
  assert_no_align(() => new Ansi256Color(0).render_fg());
  assert_no_align(() => new Ansi256Color(0).render_bg());
  assert_no_align(() => new RgbColor(0, 0, 0).render_fg());
  assert_no_align(() => new RgbColor(0, 0, 0).render_bg());
  assert_no_align(() => Color.render_fg({ $: "Ansi", _0: "White" }));
  assert_no_align(() => Color.render_bg({ $: "Ansi", _0: "White" }));
});

// crate: anstyle-1.0.13/src/effect.rs:394 no_align
test("effect::no_align", () => {
  // crate: anstyle-1.0.13/src/effect.rs:396 assert_no_align
  function assert_no_align(d: () => string): void {
    expect(d()).toBe(d());
  }

  assert_no_align(() => Effects.render(Effects.BOLD));
});

// crate: anstyle-1.0.13/src/reset.rs:36 no_align
test("reset::no_align", () => {
  // crate: anstyle-1.0.13/src/reset.rs:38 assert_no_align
  function assert_no_align(d: () => string): void {
    expect(d()).toBe(d());
  }

  assert_no_align(() => new Reset().fmt(PLAIN));
  assert_no_align(() => new Reset().render());
});

test("doc examples: Effects", () => {
  const E = Effects;
  expect(E.is_plain(E.new())).toBe(true);
  expect(E.is_plain(E.bitor(E.BOLD, E.UNDERLINE))).toBe(false);
  expect(E.contains(E.bitor(E.BOLD, E.UNDERLINE), E.BOLD)).toBe(true);
  expect(E.contains(E.new(), E.BOLD)).toBe(false);
  expect(E.is_plain(E.insert(E.new(), E.new()))).toBe(true);
  expect(E.contains(E.insert(E.new(), E.BOLD), E.BOLD)).toBe(true);
  const r = E.remove(E.bitor(E.BOLD, E.UNDERLINE), E.BOLD);
  expect(E.contains(r, E.BOLD)).toBe(false);
  expect(E.contains(r, E.UNDERLINE)).toBe(true);
  const c = E.clear(E.bitor(E.BOLD, E.UNDERLINE));
  expect(E.contains(c, E.BOLD) || E.contains(c, E.UNDERLINE)).toBe(false);
  expect(E.contains(E.set(E.new(), E.BOLD, true), E.BOLD)).toBe(true);
  expect(debug_Effects(E.new(), PLAIN)).toBe("Effects()");
  expect(debug_Effects(E.bitor(E.BOLD, E.UNDERLINE), PLAIN)).toBe("Effects(BOLD | UNDERLINE)");
  const cell = { value: E.BOLD };
  E.bitor_assign(cell, E.UNDERLINE);
  expect(debug_Effects(cell.value, PLAIN)).toBe("Effects(BOLD | UNDERLINE)");
  expect(debug_Effects(E.sub(E.bitor(E.BOLD, E.UNDERLINE), E.BOLD), PLAIN)).toBe("Effects(UNDERLINE)");
  E.sub_assign(cell, E.BOLD);
  expect(debug_Effects(cell.value, PLAIN)).toBe("Effects(UNDERLINE)");
});

test("doc examples: Style == Effects", () => {
  const effects = Effects.BOLD;
  expect(Style.eq_Effects(Style.effects(Style.new(), effects), effects)).toBe(true);
  expect(Style.eq_Effects(Style.from_Effects(Effects.bitor(Effects.UNDERLINE, effects)), effects)).toBe(false);
  expect(Style.eq_Effects(Style.bitor(new RgbColor(0, 0, 0).on_default(), effects), effects)).toBe(false);
});

// rust-ts: values from anstyle 1.0.13 (oracle run).
test("rendering and Debug match anstyle", () => {
  const E = Effects;
  const s = Style.underline_color(
    Style.bg_color(Style.fg_color(Style.underline(Style.italic(Style.bold(Style.new()))), { $: "Ansi256", _0: new Ansi256Color(7) }), {
      $: "Rgb",
      _0: new RgbColor(255, 0, 9),
    }),
    Color.from_AnsiColor("Red"),
  );
  expect(Style.fmt(s, PLAIN)).toBe("\u{1b}[1m\u{1b}[3m\u{1b}[4m\u{1b}[38;5;7m\u{1b}[48;2;255;0;9m\u{1b}[58;5;1m");
  expect(Style.fmt(s, PRETTY)).toBe("\u{1b}[0m");
  expect(debug_Style(s, PLAIN)).toBe(
    "Style { fg: Some(Ansi256(Ansi256Color(7))), bg: Some(Rgb(RgbColor(255, 0, 9))), underline: Some(Ansi(Red)), effects: Effects(BOLD | ITALIC | UNDERLINE) }",
  );
  expect(Style.fmt(Style.new(), PLAIN)).toBe("");
  expect(Style.fmt(Style.new(), PRETTY)).toBe("");
  expect(Style.is_plain(Style.new())).toBe(true);
  const all = [E.DOUBLE_UNDERLINE, E.CURLY_UNDERLINE, E.DOTTED_UNDERLINE, E.DASHED_UNDERLINE, E.BLINK, E.INVERT, E.HIDDEN, E.STRIKETHROUGH, E.DIMMED].reduce(
    (a, b) => E.bitor(a, b),
    E.new(),
  );
  expect(Style.render(Style.effects(Style.new(), all))).toBe("\u{1b}[2m\u{1b}[21m\u{1b}[4:3m\u{1b}[4:4m\u{1b}[4:5m\u{1b}[5m\u{1b}[7m\u{1b}[8m\u{1b}[9m");
  expect(Style.fmt(AnsiColor.on("BrightMagenta", Color.from_AnsiColor("Black")), PLAIN)).toBe("\u{1b}[95m\u{1b}[40m");
  expect(Style.fmt(Style.underline_color(Color.on_default({ $: "Ansi", _0: "Cyan" }), { $: "Ansi", _0: "BrightWhite" }), PLAIN)).toBe("\u{1b}[36m\u{1b}[58;5;15m");
  expect(AnsiColor.render_bg("BrightBlack")).toBe("\u{1b}[100m");
  expect(AnsiColor.bright("BrightWhite", false)).toBe("White");
  expect(new Ansi256Color(9).into_ansi()).toBe("BrightRed");
  expect(new Ansi256Color(100).render_fg()).toBe("\u{1b}[38;5;100m");
  expect(new Ansi256Color(10).render_bg()).toBe("\u{1b}[48;5;10m");
  expect(debug_Color(Color.from_tuple([1, 2, 3]), PLAIN)).toBe("Rgb(RgbColor(1, 2, 3))");
  expect(debug_Color(Color.from_u8(255), PRETTY)).toBe("Ansi256(\n    Ansi256Color(\n        255,\n    ),\n)");
  const it = E.iter(E.bitor(E.BOLD, E.UNDERLINE));
  const items: Effects[] = [];
  for (let x = it.next(); x !== undefined; x = it.next()) items.push(x);
  expect(debug_vec(items, PLAIN, debug_Effects)).toBe("[Effects(BOLD), Effects(UNDERLINE)]");
  expect(new Reset().render()).toBe("\u{1b}[0m");
  expect(debug_Reset(new Reset(), PLAIN)).toBe("Reset");
  let w = "";
  const W = {
    write_all(b: Uint8Array) {
      w += new TextDecoder().decode(b);
      return Ok(undefined);
    },
  };
  Style.write_to(Style.underline_color(Style.bold(new Ansi256Color(5).on(Color.from_RgbColor(new RgbColor(1, 2, 3)))), Color.from_AnsiColor("Red")), W);
  Style.write_reset_to(Style.bold(Style.new()), W);
  Style.write_reset_to(Style.new(), W);
  expect(w).toBe("\u{1b}[1m\u{1b}[38;5;5m\u{1b}[48;2;1;2;3m\u{1b}[58;5;1m\u{1b}[0m");
  expect(Style_eq(Style.sub(Style.underline(Style.bold(Style.new())), E.BOLD), Style.underline(Style.new()))).toBe(true);
});
