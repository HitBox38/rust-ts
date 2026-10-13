// Port of getopts =0.2.24 `src/tests/mod.rs` (the crate's `#[cfg(test)] mod tests`).
//
// PORT: `match r { Err(OptionMissing(_)) => {}, _ => panic!() }` → `expect_fail(r, "OptionMissing")`;
// `Ok(ref m) => { .. }, _ => panic!()` → `expect_ok(r)`. `debug!` logging (the `log` dev-dependency)
// is dropped. `#[should_panic]` → `expect(..).toThrow(Panic)`.
// PORT: everything that measures text with `UnicodeWidthStr::width` (`each_split_within`, `usage`)
// throws `Unported` until unicode_width's string widths (`tables::width_in_str`) are ported; those
// tests run through `str_width_test`: until then each must throw exactly that `Unported` (pending
// convention, so the gate sees no skips); afterwards they run as normal tests.
import { expect, test } from "bun:test";
import { Panic, Unported } from "../../../std/panic.ts";
import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import { UnicodeWidthStr } from "../../unicode_width/lib.ts";
import {
  display_Fail,
  each_split_within,
  type Fail,
  HasArg,
  type Matches,
  type Opt,
  Opt_eq,
  Occur,
  Options,
  ParsingStyle,
  type Result,
} from "../lib.ts";

const str_width_ported = (() => {
  try {
    UnicodeWidthStr.width("a");
    return true;
  } catch (e) {
    if (e instanceof Unported) return false;
    throw e;
  }
})();
const str_width_test = str_width_ported
  ? test
  : (name: string, fn: () => void) =>
      test(`${name} (pending: unicode_width::tables::width_in_str)`, () => {
        expect(fn).toThrow(/unicode_width::tables::width_in_str/);
      });

/** `match r { Ok(m) => m, Err(e) => panic!("{}", e) }` */
function expect_ok(r: Result): Matches {
  if (r.$ === "Err") throw new Panic(display_Fail(r._0));
  return r._0;
}

/** `match r { Err(<kind>(_)) => {}, _ => panic!() }` */
function expect_fail(r: Result, kind: Fail["$"]): void {
  if (!(r.$ === "Err" && r._0.$ === kind)) throw new Panic("explicit panic");
}

// PORT: test-only stand-ins for `<i32 / bool / f64 as FromStr>::from_str` (core's grammars,
// restricted to what these tests feed them).
function parse_i32(s: string): StdResult<number, string> {
  if (!/^[+-]?[0-9]+$/.test(s)) return Err("invalid digit found in string");
  const n = Number(s);
  return n >= -(2 ** 31) && n <= 2 ** 31 - 1 ? Ok(n) : Err("number too large to fit in target type");
}
function parse_bool(s: string): StdResult<boolean, string> {
  if (s === "true") return Ok(true);
  if (s === "false") return Ok(false);
  return Err("provided string was not `true` or `false`");
}
function parse_f64(s: string): StdResult<number, string> {
  if (!/^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(s)) return Err("invalid float literal");
  return Ok(Number(s));
}

// crate: getopts-0.2.24/src/tests/mod.rs:6 test_split_within
str_width_test("test_split_within", () => {
  // crate: getopts-0.2.24/src/tests/mod.rs:7 t
  function t(s: string, i: number, u: readonly string[]): void {
    const v = each_split_within(s, i);
    // assert!(v.iter().zip(u.iter()).all(|(a, b)| a == b));
    const n = Math.min(v.length, u.length);
    let all = true;
    for (let k = 0; k < n; k++) if (v[k] !== u[k]) all = false;
    expect(all).toBe(true);
  }
  t("", 0, []);
  t("", 15, []);
  t("hello", 15, ["hello"]);
  t("\nMary had a little lamb\nLittle lamb\n", 15, ["Mary had a", "little lamb", "Little lamb"]);
  // ::std::usize::MAX
  t("\nMary had a little lamb\nLittle lamb\n", 2 ** 64 - 1, ["Mary had a little lamb", "Little lamb"]);
});

// Tests for reqopt
// crate: getopts-0.2.24/src/tests/mod.rs:35 test_reqopt
test("test_reqopt", () => {
  const long_args = ["--test=20"];
  const opts = Options.new();
  opts.reqopt("t", "test", "testing", "TEST");
  {
    const r = opts.parse(long_args);
    if (r.$ !== "Ok") throw new Panic("test_reqopt failed (long arg)");
    const m = r._0;
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_str("test")).toBe("20");
    expect(m.opt_present("t")).toBe(true);
    expect(m.opt_str("t")).toBe("20");
  }
  const short_args = ["-t", "20"];
  {
    const r = opts.parse(short_args);
    if (r.$ !== "Ok") throw new Panic("test_reqopt failed (short arg)");
    const m = r._0;
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_str("test")).toBe("20");
    expect(m.opt_present("t")).toBe(true);
    expect(m.opt_str("t")).toBe("20");
  }
});

// crate: getopts-0.2.24/src/tests/mod.rs:65 test_reqopt_missing
test("test_reqopt_missing", () => {
  const args = ["blah"];
  expect_fail(Options.new().reqopt("t", "test", "testing", "TEST").parse(args), "OptionMissing");
});

// crate: getopts-0.2.24/src/tests/mod.rs:77 test_reqopt_no_arg
test("test_reqopt_no_arg", () => {
  const long_args = ["--test"];
  const opts = Options.new();
  opts.reqopt("t", "test", "testing", "TEST");
  expect_fail(opts.parse(long_args), "ArgumentMissing");
  const short_args = ["-t"];
  expect_fail(opts.parse(short_args), "ArgumentMissing");
});

// crate: getopts-0.2.24/src/tests/mod.rs:93 test_reqopt_multi
test("test_reqopt_multi", () => {
  const args = ["--test=20", "-t", "30"];
  expect_fail(Options.new().reqopt("t", "test", "testing", "TEST").parse(args), "OptionDuplicated");
});

// Tests for optopt
// crate: getopts-0.2.24/src/tests/mod.rs:106 test_optopt
test("test_optopt", () => {
  const long_args = ["--test=20"];
  const opts = Options.new();
  opts.optopt("t", "test", "testing", "TEST");
  {
    const m = expect_ok(opts.parse(long_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_str("test")).toBe("20");
    expect(m.opt_present("t")).toBe(true);
    expect(m.opt_str("t")).toBe("20");
  }
  const short_args = ["-t", "20"];
  {
    const m = expect_ok(opts.parse(short_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_str("test")).toBe("20");
    expect(m.opt_present("t")).toBe(true);
    expect(m.opt_str("t")).toBe("20");
  }
});

// crate: getopts-0.2.24/src/tests/mod.rs:132 test_optopt_missing
test("test_optopt_missing", () => {
  const args = ["blah"];
  const m = expect_ok(Options.new().optopt("t", "test", "testing", "TEST").parse(args));
  expect(!m.opt_present("test")).toBe(true);
  expect(!m.opt_present("t")).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:147 test_optopt_no_arg
test("test_optopt_no_arg", () => {
  const long_args = ["--test"];
  const opts = Options.new();
  opts.optopt("t", "test", "testing", "TEST");
  expect_fail(opts.parse(long_args), "ArgumentMissing");
  const short_args = ["-t"];
  expect_fail(opts.parse(short_args), "ArgumentMissing");
});

// crate: getopts-0.2.24/src/tests/mod.rs:163 test_optopt_multi
test("test_optopt_multi", () => {
  const args = ["--test=20", "-t", "30"];
  expect_fail(Options.new().optopt("t", "test", "testing", "TEST").parse(args), "OptionDuplicated");
});

// Tests for optflag
// crate: getopts-0.2.24/src/tests/mod.rs:176 test_optflag
test("test_optflag", () => {
  const long_args = ["--test"];
  const opts = Options.new();
  opts.optflag("t", "test", "testing");
  {
    const m = expect_ok(opts.parse(long_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_present("t")).toBe(true);
  }
  const short_args = ["-t"];
  {
    const m = expect_ok(opts.parse(short_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_present("t")).toBe(true);
  }
});

// crate: getopts-0.2.24/src/tests/mod.rs:198 test_optflag_missing
test("test_optflag_missing", () => {
  const args = ["blah"];
  const m = expect_ok(Options.new().optflag("t", "test", "testing").parse(args));
  expect(!m.opt_present("test")).toBe(true);
  expect(!m.opt_present("t")).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:210 test_free_trailing_missing
test("test_free_trailing_missing", () => {
  const args: string[] = [];
  const m = expect_ok(Options.new().parse(args));
  expect(m.free_trailing_start()).toBe(undefined);
});

// crate: getopts-0.2.24/src/tests/mod.rs:221 test_free_trailing
test("test_free_trailing", () => {
  const args = ["--", "-t"];
  const m = expect_ok(Options.new().optflag("t", "test", "testing").parse(args));
  expect(!m.opt_present("test")).toBe(true);
  expect(!m.opt_present("t")).toBe(true);
  expect(m.free_trailing_start()).toBe(0);
  expect(m.free.length).toBe(1);
  expect(m.free[0]).toBe("-t");
});

// crate: getopts-0.2.24/src/tests/mod.rs:236 test_free_trailing_only
test("test_free_trailing_only", () => {
  const args = ["--"];
  const m = expect_ok(Options.new().optflag("t", "test", "testing").parse(args));
  expect(!m.opt_present("test")).toBe(true);
  expect(!m.opt_present("t")).toBe(true);
  expect(m.free_trailing_start()).toBe(undefined);
  expect(m.free.length).toBe(0);
});

// crate: getopts-0.2.24/src/tests/mod.rs:250 test_free_trailing_args
test("test_free_trailing_args", () => {
  const args = ["pre", "--", "post"];
  const m = expect_ok(Options.new().parse(args));
  expect(m.free_trailing_start()).toBe(1);
  expect(m.free.length).toBe(2);
});

// crate: getopts-0.2.24/src/tests/mod.rs:262 test_optflag_long_arg
test("test_optflag_long_arg", () => {
  const args = ["--test=20"];
  expect_fail(Options.new().optflag("t", "test", "testing").parse(args), "UnexpectedArgument");
});

// crate: getopts-0.2.24/src/tests/mod.rs:271 test_optflag_multi
test("test_optflag_multi", () => {
  const args = ["--test", "-t"];
  expect_fail(Options.new().optflag("t", "test", "testing").parse(args), "OptionDuplicated");
});

// crate: getopts-0.2.24/src/tests/mod.rs:280 test_optflag_short_arg
test("test_optflag_short_arg", () => {
  const args = ["-t", "20"];
  const m = expect_ok(Options.new().optflag("t", "test", "testing").parse(args));
  // The next variable after the flag is just a free argument

  expect(m.free[0] === "20").toBe(true);
});

// Tests for optflagmulti
// crate: getopts-0.2.24/src/tests/mod.rs:294 test_optflagmulti_short1
test("test_optflagmulti_short1", () => {
  const args = ["-v"];
  const m = expect_ok(Options.new().optflagmulti("v", "verbose", "verbosity").parse(args));
  expect(m.opt_count("v")).toBe(1);
});

// crate: getopts-0.2.24/src/tests/mod.rs:308 test_optflagmulti_short2a
test("test_optflagmulti_short2a", () => {
  const args = ["-v", "-v"];
  const m = expect_ok(Options.new().optflagmulti("v", "verbose", "verbosity").parse(args));
  expect(m.opt_count("v")).toBe(2);
});

// crate: getopts-0.2.24/src/tests/mod.rs:322 test_optflagmulti_short2b
test("test_optflagmulti_short2b", () => {
  const args = ["-vv"];
  const m = expect_ok(Options.new().optflagmulti("v", "verbose", "verbosity").parse(args));
  expect(m.opt_count("v")).toBe(2);
});

// crate: getopts-0.2.24/src/tests/mod.rs:336 test_optflagmulti_long1
test("test_optflagmulti_long1", () => {
  const args = ["--verbose"];
  const m = expect_ok(Options.new().optflagmulti("v", "verbose", "verbosity").parse(args));
  expect(m.opt_count("verbose")).toBe(1);
});

// crate: getopts-0.2.24/src/tests/mod.rs:350 test_optflagmulti_long2
test("test_optflagmulti_long2", () => {
  const args = ["--verbose", "--verbose"];
  const m = expect_ok(Options.new().optflagmulti("v", "verbose", "verbosity").parse(args));
  expect(m.opt_count("verbose")).toBe(2);
});

// crate: getopts-0.2.24/src/tests/mod.rs:364 test_optflagmulti_mix
test("test_optflagmulti_mix", () => {
  const args = ["--verbose", "-v", "-vv", "verbose"];
  const m = expect_ok(Options.new().optflagmulti("v", "verbose", "verbosity").parse(args));
  expect(m.opt_count("verbose")).toBe(4);
  expect(m.opt_count("v")).toBe(4);
});

// Tests for optflagopt
// crate: getopts-0.2.24/src/tests/mod.rs:385 test_optflagopt
test("test_optflagopt", () => {
  let long_args = ["--test"];
  const opts = Options.new();
  opts.optflagopt("t", "test", "testing", "ARG");
  {
    const m = expect_ok(opts.parse(long_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_present("t")).toBe(true);
  }
  let short_args = ["-t"];
  {
    const m = expect_ok(opts.parse(short_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_present("t")).toBe(true);
  }
  short_args = ["-t", "x"];
  {
    const m = expect_ok(opts.parse(short_args));
    expect(m.opt_str("t")).toBe("x");
    expect(m.opt_str("test")).toBe("x");
  }
  long_args = ["--test=x"];
  {
    const m = expect_ok(opts.parse(long_args));
    expect(m.opt_str("t")).toBe("x");
    expect(m.opt_str("test")).toBe("x");
  }
  long_args = ["--test", "x"];
  {
    const m = expect_ok(opts.parse(long_args));
    expect(m.opt_str("t")).toBe(undefined);
    expect(m.opt_str("test")).toBe(undefined);
  }
  const no_args: string[] = [];
  {
    const m = expect_ok(opts.parse(no_args));
    expect(!m.opt_present("test")).toBe(true);
    expect(!m.opt_present("t")).toBe(true);
  }
});

// Tests for optmulti
// crate: getopts-0.2.24/src/tests/mod.rs:440 test_optmulti
test("test_optmulti", () => {
  const long_args = ["--test=20"];
  const opts = Options.new();
  opts.optmulti("t", "test", "testing", "TEST");
  {
    const m = expect_ok(opts.parse(long_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_str("test")).toBe("20");
    expect(m.opt_present("t")).toBe(true);
    expect(m.opt_str("t")).toBe("20");
  }
  const short_args = ["-t", "20"];
  {
    const m = expect_ok(opts.parse(short_args));
    expect(m.opt_present("test")).toBe(true);
    expect(m.opt_str("test")).toBe("20");
    expect(m.opt_present("t")).toBe(true);
    expect(m.opt_str("t")).toBe("20");
  }
});

// crate: getopts-0.2.24/src/tests/mod.rs:466 test_optmulti_missing
test("test_optmulti_missing", () => {
  const args = ["blah"];
  const m = expect_ok(Options.new().optmulti("t", "test", "testing", "TEST").parse(args));
  expect(!m.opt_present("test")).toBe(true);
  expect(!m.opt_present("t")).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:481 test_optmulti_no_arg
test("test_optmulti_no_arg", () => {
  const long_args = ["--test"];
  const opts = Options.new();
  opts.optmulti("t", "test", "testing", "TEST");
  expect_fail(opts.parse(long_args), "ArgumentMissing");
  const short_args = ["-t"];
  expect_fail(opts.parse(short_args), "ArgumentMissing");
});

// crate: getopts-0.2.24/src/tests/mod.rs:497 test_optmulti_multi
test("test_optmulti_multi", () => {
  const args = ["--test=20", "-t", "30"];
  const m = expect_ok(Options.new().optmulti("t", "test", "testing", "TEST").parse(args));
  expect(m.opt_present("test")).toBe(true);
  expect(m.opt_str("test")).toBe("20");
  expect(m.opt_present("t")).toBe(true);
  expect(m.opt_str("t")).toBe("20");
  const pair = m.opt_strs("test");
  expect(pair[0] === "20").toBe(true);
  expect(pair[1] === "30").toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:517 test_free_argument_is_hyphen
test("test_free_argument_is_hyphen", () => {
  const args = ["-"];
  const m = expect_ok(Options.new().parse(args));
  expect(m.free.length).toBe(1);
  expect(m.free[0]).toBe("-");
});

// crate: getopts-0.2.24/src/tests/mod.rs:529 test_unrecognized_option
test("test_unrecognized_option", () => {
  const long_args = ["--untest"];
  const opts = Options.new();
  opts.optmulti("t", "test", "testing", "TEST");
  expect_fail(opts.parse(long_args), "UnrecognizedOption");
  const short_args = ["-u"];
  expect_fail(opts.parse(short_args), "UnrecognizedOption");
});

// crate: getopts-0.2.24/src/tests/mod.rs:545 test_combined
test("test_combined", () => {
  const args = [
    "prog",
    "free1",
    "-s",
    "20",
    "free2",
    "--flag",
    "--long=30",
    "-f",
    "-m",
    "40",
    "-m",
    "50",
    "-n",
    "-A B",
    "-n",
    "-60 70",
  ];
  const m = expect_ok(
    Options.new()
      .optopt("s", "something", "something", "SOMETHING")
      .optflag("", "flag", "a flag")
      .reqopt("", "long", "hi", "LONG")
      .optflag("f", "", "another flag")
      .optmulti("m", "", "mmmmmm", "YUM")
      .optmulti("n", "", "nothing", "NOTHING")
      .optopt("", "notpresent", "nothing to see here", "NOPE")
      .parse(args),
  );
  expect(m.free[0] === "prog").toBe(true);
  expect(m.free[1] === "free1").toBe(true);
  expect(m.opt_str("s")).toBe("20");
  expect(m.free[2] === "free2").toBe(true);
  expect(m.opt_present("flag")).toBe(true);
  expect(m.opt_str("long")).toBe("30");
  expect(m.opt_present("f")).toBe(true);
  let pair = m.opt_strs("m");
  expect(pair[0] === "40").toBe(true);
  expect(pair[1] === "50").toBe(true);
  pair = m.opt_strs("n");
  expect(pair[0] === "-A B").toBe(true);
  expect(pair[1] === "-60 70").toBe(true);
  expect(!m.opt_present("notpresent")).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:595 test_mixed_stop
test("test_mixed_stop", () => {
  const args = ["-a", "b", "-c", "d"];
  const m = expect_ok(
    Options.new().parsing_style(ParsingStyle.StopAtFirstFree).optflag("a", "", "").optopt("c", "", "", "").parse(args),
  );
  // println!("{}", m.opt_present("c"));
  expect(m.opt_present("a")).toBe(true);
  expect(!m.opt_present("c")).toBe(true);
  expect(m.free.length).toBe(3);
  expect(m.free[0]).toBe("b");
  expect(m.free[1]).toBe("-c");
  expect(m.free[2]).toBe("d");
});

// crate: getopts-0.2.24/src/tests/mod.rs:622 test_mixed_stop_hyphen
test("test_mixed_stop_hyphen", () => {
  const args = ["-a", "-", "-c", "d"];
  const m = expect_ok(
    Options.new().parsing_style(ParsingStyle.StopAtFirstFree).optflag("a", "", "").optopt("c", "", "", "").parse(args),
  );
  // println!("{}", m.opt_present("c"));
  expect(m.opt_present("a")).toBe(true);
  expect(!m.opt_present("c")).toBe(true);
  expect(m.free.length).toBe(3);
  expect(m.free[0]).toBe("-");
  expect(m.free[1]).toBe("-c");
  expect(m.free[2]).toBe("d");
});

// crate: getopts-0.2.24/src/tests/mod.rs:649 test_multi
test("test_multi", () => {
  const opts = Options.new();
  opts.optopt("e", "", "encrypt", "ENCRYPT");
  opts.optopt("", "encrypt", "encrypt", "ENCRYPT");
  opts.optopt("f", "", "flag", "FLAG");
  const no_opts: readonly string[] = [];

  const args_single = ["-e", "foo"];
  const matches_single = expect_ok(opts.parse(args_single));
  expect(matches_single.opts_present(["e"])).toBe(true);
  expect(matches_single.opts_present(["encrypt", "e"])).toBe(true);
  expect(matches_single.opts_present(["e", "encrypt"])).toBe(true);
  expect(!matches_single.opts_present(["encrypt"])).toBe(true);
  expect(!matches_single.opts_present(["thing"])).toBe(true);
  expect(!matches_single.opts_present([])).toBe(true);

  expect(matches_single.opts_present_any(["e"])).toBe(true);
  expect(matches_single.opts_present_any(["encrypt", "e"])).toBe(true);
  expect(matches_single.opts_present_any(["e", "encrypt"])).toBe(true);
  expect(!matches_single.opts_present_any(["encrypt"])).toBe(true);
  expect(!matches_single.opts_present_any(no_opts)).toBe(true);

  expect(matches_single.opts_str(["e"])).toBe("foo");
  expect(matches_single.opts_str(["e", "encrypt"])).toBe("foo");
  expect(matches_single.opts_str(["encrypt", "e"])).toBe("foo");

  expect(matches_single.opts_str_first(["e"])).toBe("foo");
  expect(matches_single.opts_str_first(["e", "encrypt"])).toBe("foo");
  expect(matches_single.opts_str_first(["encrypt", "e"])).toBe("foo");
  expect(matches_single.opts_str_first(["encrypt"])).toBe(undefined);
  expect(matches_single.opts_str_first(no_opts)).toBe(undefined);

  const args_both = ["-e", "foo", "--encrypt", "bar"];
  const matches_both = expect_ok(opts.parse(args_both));
  expect(matches_both.opts_present(["e"])).toBe(true);
  expect(matches_both.opts_present(["encrypt"])).toBe(true);
  expect(matches_both.opts_present(["encrypt", "e"])).toBe(true);
  expect(matches_both.opts_present(["e", "encrypt"])).toBe(true);
  expect(!matches_both.opts_present(["f"])).toBe(true);
  expect(!matches_both.opts_present(["thing"])).toBe(true);
  expect(!matches_both.opts_present([])).toBe(true);

  expect(matches_both.opts_present_any(["e"])).toBe(true);
  expect(matches_both.opts_present_any(["encrypt"])).toBe(true);
  expect(matches_both.opts_present_any(["encrypt", "e"])).toBe(true);
  expect(matches_both.opts_present_any(["e", "encrypt"])).toBe(true);
  expect(!matches_both.opts_present_any(["f"])).toBe(true);
  expect(!matches_both.opts_present_any(no_opts)).toBe(true);

  expect(matches_both.opts_str(["e"])).toBe("foo");
  expect(matches_both.opts_str(["encrypt"])).toBe("bar");
  expect(matches_both.opts_str(["e", "encrypt"])).toBe("foo");
  expect(matches_both.opts_str(["encrypt", "e"])).toBe("bar");

  expect(matches_both.opts_str_first(["e"])).toBe("foo");
  expect(matches_both.opts_str_first(["encrypt"])).toBe("bar");
  expect(matches_both.opts_str_first(["e", "encrypt"])).toBe("foo");
  expect(matches_both.opts_str_first(["encrypt", "e"])).toBe("bar");
  expect(matches_both.opts_str_first(["f"])).toBe(undefined);
  expect(matches_both.opts_str_first(no_opts)).toBe(undefined);
});

// crate: getopts-0.2.24/src/tests/mod.rs:758 test_nospace
test("test_nospace", () => {
  const args = ["-Lfoo", "-M."];
  const matches = expect_ok(
    Options.new().optmulti("L", "", "library directory", "LIB").optmulti("M", "", "something", "MMMM").parse(args),
  );
  expect(matches.opts_present(["L"])).toBe(true);
  expect(matches.opts_str(["L"])).toBe("foo");
  expect(matches.opts_present(["M"])).toBe(true);
  expect(matches.opts_str(["M"])).toBe(".");
});

// crate: getopts-0.2.24/src/tests/mod.rs:775 test_nospace_conflict
test("test_nospace_conflict", () => {
  const args = ["-vvLverbose", "-v"];
  const matches = expect_ok(
    Options.new().optmulti("L", "", "library directory", "LIB").optflagmulti("v", "verbose", "Verbose").parse(args),
  );
  expect(matches.opts_present(["L"])).toBe(true);
  expect(matches.opts_str(["L"])).toBe("verbose");
  expect(matches.opts_present(["v"])).toBe(true);
  expect(matches.opt_count("v")).toBe(3);
});

// crate: getopts-0.2.24/src/tests/mod.rs:792 test_long_to_short
test("test_long_to_short", () => {
  const short: Opt = {
    name: { $: "Long", _0: "banana" },
    hasarg: HasArg.Yes,
    occur: Occur.Req,
    aliases: [],
  };
  short.aliases = [
    {
      name: { $: "Short", _0: 0x62 /* 'b' */ },
      hasarg: HasArg.Yes,
      occur: Occur.Req,
      aliases: [],
    },
  ];
  const opts = Options.new();
  opts.reqopt("b", "banana", "some bananas", "VAL");
  const verbose = opts.grps[0]!;
  expect(Opt_eq(verbose.long_to_short(), short)).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:812 test_aliases_long_and_short
test("test_aliases_long_and_short", () => {
  const args = ["-a", "--apple", "-a"];

  const matches = expect_ok(Options.new().optflagmulti("a", "apple", "Desc").parse(args));
  expect(matches.opt_count("a")).toBe(3);
  expect(matches.opt_count("apple")).toBe(3);
});

// crate: getopts-0.2.24/src/tests/mod.rs:824 test_usage
str_width_test("test_usage", () => {
  const opts = Options.new();
  opts.reqopt("b", "banana", "Desc", "VAL");
  opts.optopt("a", "012345678901234567890123456789", "Desc", "VAL");
  opts.optflag("k", "kiwi", "Desc");
  opts.optflagopt("p", "", "Desc", "VAL");
  opts.optmulti("l", "", "Desc", "VAL");
  opts.optflag("", "starfruit", "Starfruit");

  const expected = `Usage: fruits

Options:
    -b, --banana VAL    Desc
    -a, --012345678901234567890123456789 VAL
                        Desc
    -k, --kiwi          Desc
    -p [VAL]            Desc
    -l VAL              Desc
        --starfruit     Starfruit
`;

  const generated_usage = opts.usage("Usage: fruits");

  expect(generated_usage).toBe(expected);
});

// crate: getopts-0.2.24/src/tests/mod.rs:853 test_usage_description_wrapping
str_width_test("test_usage_description_wrapping", () => {
  // indentation should be 24 spaces
  // lines wrap after 78: or rather descriptions wrap after 54

  const opts = Options.new();
  opts.optflag("k", "kiwi", "This is a long description which won't be wrapped..+.."); // 54
  opts.optflag("a", "apple", "This is a long description which _will_ be wrapped..+..");
  opts.optflag("b", "banana", "HereWeNeedOneSingleWordThatIsLongerThanTheWrappingLengthAndThisIsIt");

  const expected = `Usage: fruits

Options:
    -k, --kiwi          This is a long description which won't be wrapped..+..
    -a, --apple         This is a long description which _will_ be
                        wrapped..+..
    -b, --banana        HereWeNeedOneSingleWordThatIsLongerThanTheWrappingLengthAndThisIsIt
`;

  const usage = opts.usage("Usage: fruits");

  expect(usage === expected).toBe(true);
});

// #[cfg(feature = "unicode")]
// crate: getopts-0.2.24/src/tests/mod.rs:892 test_usage_description_multibyte_handling
str_width_test("test_usage_description_multibyte_handling", () => {
  const opts = Options.new();
  opts.optflag("k", "k\u{2013}w\u{2013}", "The word kiwi is normally spelled with two i's");
  opts.optflag(
    "a",
    "apple",
    "This \u{201C}description\u{201D} has some characters that could " +
      "confuse the line wrapping; an apple costs 0.51€ in some parts of Europe.",
  );

  const expected = `Usage: fruits

Options:
    -k, --k–w–          The word kiwi is normally spelled with two i's
    -a, --apple         This “description” has some characters that could
                        confuse the line wrapping; an apple costs 0.51€ in
                        some parts of Europe.
`;

  const usage = opts.usage("Usage: fruits");

  expect(usage === expected).toBe(true);
});

// #[cfg(feature = "unicode")]
// crate: getopts-0.2.24/src/tests/mod.rs:924 test_usage_description_newline_handling
str_width_test("test_usage_description_newline_handling", () => {
  const opts = Options.new();
  opts.optflag("k", "k\u{2013}w\u{2013}", "The word kiwi is normally spelled with two i's");
  opts.optflag("a", "apple", "This description forces a new line.\n Here is a premature\n" + "newline");

  const expected = `Usage: fruits

Options:
    -k, --k–w–          The word kiwi is normally spelled with two i's
    -a, --apple         This description forces a new line.
                        Here is a premature
                        newline
`;

  const usage = opts.usage("Usage: fruits");

  expect(usage === expected).toBe(true);
});

// #[cfg(feature = "unicode")]
// crate: getopts-0.2.24/src/tests/mod.rs:956 test_usage_multiwidth
str_width_test("test_usage_multiwidth", () => {
  const opts = Options.new();
  opts.optflag("a", "apple", "apple description");
  opts.optflag("b", "banana\u{00AB}", "banana description");
  opts.optflag("c", "brûlée", "brûlée quite long description");
  opts.optflag("k", "kiwi\u{20AC}", "kiwi description");
  opts.optflag("o", "orange\u{2039}", "orange description");
  opts.optflag(
    "r",
    "raspberry-but-making-this-option-way-too-long",
    "raspberry description is also quite long indeed longer than " +
      "every other piece of text we might encounter here and thus will " +
      "be automatically broken up",
  );

  const expected = `Usage: fruits

Options:
    -a, --apple         apple description
    -b, --banana«       banana description
    -c, --brûlée        brûlée quite long description
    -k, --kiwi€         kiwi description
    -o, --orange‹       orange description
    -r, --raspberry-but-making-this-option-way-too-long\u{0020}
                        raspberry description is also quite long indeed longer
                        than every other piece of text we might encounter here
                        and thus will be automatically broken up
`;

  const usage = opts.usage("Usage: fruits");

  expect(usage === expected).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:993 test_usage_short_only
str_width_test("test_usage_short_only", () => {
  const opts = Options.new();
  opts.optopt("k", "", "Kiwi", "VAL");
  opts.optflag("s", "", "Starfruit");
  opts.optflagopt("a", "", "Apple", "TYPE");

  const expected = `Usage: fruits

Options:
    -k VAL              Kiwi
    -s                  Starfruit
    -a [TYPE]           Apple
`;

  const usage = opts.usage("Usage: fruits");
  expect(usage === expected).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:1014 test_usage_long_only
str_width_test("test_usage_long_only", () => {
  const opts = Options.new();
  opts.optopt("", "kiwi", "Kiwi", "VAL");
  opts.optflag("", "starfruit", "Starfruit");
  opts.optflagopt("", "apple", "Apple", "TYPE");

  const expected = `Usage: fruits

Options:
    --kiwi VAL          Kiwi
    --starfruit         Starfruit
    --apple [TYPE]      Apple
`;

  const usage = opts.usage("Usage: fruits");
  expect(usage === expected).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:1035 test_short_usage
test("test_short_usage", () => {
  const opts = Options.new();
  opts.reqopt("b", "banana", "Desc", "VAL");
  opts.optopt("a", "012345678901234567890123456789", "Desc", "VAL");
  opts.optflag("k", "kiwi", "Desc");
  opts.optflagopt("p", "", "Desc", "VAL");
  opts.optmulti("l", "", "Desc", "VAL");

  const expected = "Usage: fruits -b VAL [-a VAL] [-k] [-p [VAL]] [-l VAL]..";
  const generated_usage = opts.short_usage("fruits");

  expect(generated_usage).toBe(expected);
});
// crate: getopts-0.2.24/src/tests/mod.rs:1051 test_nonexistant_opt
test("test_nonexistant_opt", () => {
  const opts = Options.new();
  opts.optflag("b", "bar", "Desc");
  const args: string[] = [];
  const matches = expect_ok(opts.parse(args));
  expect(matches.opt_defined("foo")).toBe(false);
  expect(matches.opt_defined("bar")).toBe(true);
});
// crate: getopts-0.2.24/src/tests/mod.rs:1060 test_args_with_equals
test("test_args_with_equals", () => {
  const opts = Options.new();
  opts.optopt("o", "one", "One", "INFO");
  opts.optopt("t", "two", "Two", "INFO");

  const args = ["--one", "A=B", "--two=C=D"];
  const matches = expect_ok(opts.parse(args));
  expect(matches.opts_str(["o"])).toBe("A=B");
  expect(matches.opts_str(["t"])).toBe("C=D");
});

// crate: getopts-0.2.24/src/tests/mod.rs:1079 test_long_only_usage
str_width_test("test_long_only_usage", () => {
  const opts = Options.new();
  opts.long_only(true);
  opts.optflag("k", "kiwi", "Description");
  opts.optflag("a", "apple", "Description");

  const expected = `Usage: fruits

Options:
    -k, -kiwi           Description
    -a, -apple          Description
`;

  const usage = opts.usage("Usage: fruits");

  expect(usage === expected).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:1100 test_long_only_mode
test("test_long_only_mode", () => {
  const opts = Options.new();
  opts.long_only(true);
  opts.optopt("a", "apple", "Description", "X");
  opts.optopt("b", "banana", "Description", "X");
  opts.optopt("c", "currant", "Description", "X");
  opts.optopt("", "durian", "Description", "X");
  opts.optopt("e", "", "Description", "X");
  opts.optopt("", "fruit", "Description", "X");

  const args = ["-a", "A", "-b=B", "--c=C", "-durian", "D", "--e", "E", "-fruit=any"];
  const matches = expect_ok(opts.parse(args));
  expect(matches.opts_str(["a"])).toBe("A");
  expect(matches.opts_str(["b"])).toBe("B");
  expect(matches.opts_str(["c"])).toBe("C");
  expect(matches.opts_str(["durian"])).toBe("D");
  expect(matches.opts_str(["e"])).toBe("E");
  expect(matches.opts_str(["fruit"])).toBe("any");
});

// crate: getopts-0.2.24/src/tests/mod.rs:1134 test_long_only_mode_no_short_parse
test("test_long_only_mode_no_short_parse", () => {
  const opts = Options.new();
  opts.long_only(true);
  opts.optflag("h", "help", "Description");
  opts.optflag("i", "ignore", "Description");
  opts.optflag("", "hi", "Description");

  const args = ["-hi"];
  const matches = expect_ok(opts.parse(args));
  expect(matches.opt_present("hi")).toBe(true);
  expect(!matches.opt_present("h")).toBe(true);
  expect(!matches.opt_present("i")).toBe(true);
});

// crate: getopts-0.2.24/src/tests/mod.rs:1152 test_normal_mode_no_long_parse
test("test_normal_mode_no_long_parse", () => {
  // Like test_long_only_mode_no_short_parse, but we make sure
  // that long_only can be disabled, and the right thing
  // happens.
  const opts = Options.new();
  opts.long_only(true);
  opts.optflag("h", "help", "Description");
  opts.optflag("i", "ignore", "Description");
  opts.optflag("", "hi", "Description");
  opts.long_only(false);

  const args = ["-hi"];
  const matches = expect_ok(opts.parse(args));
  expect(!matches.opt_present("hi")).toBe(true);
  expect(matches.opt_present("h")).toBe(true);
  expect(matches.opt_present("i")).toBe(true);
});

// #[should_panic]
// crate: getopts-0.2.24/src/tests/mod.rs:1175 test_long_name_too_short
test("test_long_name_too_short", () => {
  expect(() => {
    const opts = Options.new();
    opts.optflag("", "a", "Oops, long option too short");
  }).toThrow(Panic);
});

// #[should_panic]
// crate: getopts-0.2.24/src/tests/mod.rs:1182 test_undefined_opt_present
test("test_undefined_opt_present", () => {
  expect(() => {
    const opts = Options.new();
    opts.optflag("h", "help", "Description");
    const args = ["-h"];
    const r = opts.parse(args);
    if (r.$ === "Ok") {
      const matches = r._0;
      if (matches.opt_present("undefined")) throw new Panic("assertion failed: !matches.opt_present(\"undefined\")");
    } else {
      throw new Panic(display_Fail(r._0));
    }
  }).toThrow(Panic);
});

// crate: getopts-0.2.24/src/tests/mod.rs:1193 test_opt_default
test("test_opt_default", () => {
  const opts = Options.new();
  opts.optflag("h", "help", "Description");
  opts.optflag("i", "ignore", "Description");
  opts.optflag("r", "run", "Description");
  opts.long_only(false);

  const args: string[] = ["-i", "-r", "10"].map((x) => x);
  const matches = expect_ok(opts.parse(args));
  expect(matches.opt_default("help", "")).toBe(undefined);
  expect(matches.opt_default("i", "def")).toBe("def");
});

// crate: getopts-0.2.24/src/tests/mod.rs:1210 test_opt_get
test("test_opt_get", () => {
  const opts = Options.new();
  opts.optflag("h", "help", "Description");
  opts.optflagopt("i", "ignore", "Description", "true | false");
  opts.optflagopt("r", "run", "Description", "0 .. 10");
  opts.optflagopt("p", "percent", "Description", "0.0 .. 10.0");
  opts.long_only(false);

  const args: string[] = ["-i", "true", "-p", "1.1"].map((x) => x);
  const matches = expect_ok(opts.parse(args));
  const h_arg = matches.opt_get("help", parse_i32);
  expect(h_arg).toEqual(Ok(undefined));
  const i_arg = matches.opt_get("i", parse_bool);
  expect(i_arg).toEqual(Ok(true));
  const p_arg = matches.opt_get("p", parse_f64);
  expect(p_arg).toEqual(Ok(1.1));
});

// crate: getopts-0.2.24/src/tests/mod.rs:1235 test_opt_get_default
test("test_opt_get_default", () => {
  const opts = Options.new();
  opts.optflag("h", "help", "Description");
  opts.optflagopt("i", "ignore", "Description", "true | false");
  opts.optflagopt("r", "run", "Description", "0 .. 10");
  opts.optflagopt("p", "percent", "Description", "0.0 .. 10.0");
  opts.long_only(false);

  const args: string[] = ["-i", "true", "-p", "1.1"].map((x) => x);
  const matches = expect_ok(opts.parse(args));
  const h_arg = matches.opt_get_default("help", 10, parse_i32);
  expect(h_arg).toEqual(Ok(10));
  const i_arg = matches.opt_get_default("i", false, parse_bool);
  expect(i_arg).toEqual(Ok(true));
  const p_arg = matches.opt_get_default("p", 10.2, parse_f64);
  expect(p_arg).toEqual(Ok(1.1));
});

// crate: getopts-0.2.24/src/tests/mod.rs:1260 test_opt_positions
test("test_opt_positions", () => {
  const opts = Options.new();
  opts.optflagmulti("a", "act", "Description");
  opts.optflagmulti("e", "enact", "Description");
  opts.optflagmulti("r", "react", "Description");

  const args: string[] = ["-a", "-a", "-r", "-a", "-r", "-r"].map((x) => x);

  const matches = expect_ok(opts.parse(args));

  const a_pos = matches.opt_positions("a");
  expect(a_pos).toEqual([0, 1, 3]);
  const e_pos = matches.opt_positions("e");
  expect(e_pos).toEqual([]);
  const r_pos = matches.opt_positions("r");
  expect(r_pos).toEqual([2, 4, 5]);
});

// crate: getopts-0.2.24/src/tests/mod.rs:1285 test_opt_strs_pos
test("test_opt_strs_pos", () => {
  const opts = Options.new();
  opts.optmulti("a", "act", "Description", "NUM");
  opts.optmulti("e", "enact", "Description", "NUM");
  opts.optmulti("r", "react", "Description", "NUM");

  const args: string[] = ["-a1", "-a2", "-r3", "-a4", "-r5", "-r6"].map((x) => x);

  const matches = expect_ok(opts.parse(args));

  const a_pos = matches.opt_strs_pos("a");
  expect(a_pos).toEqual([
    [0, "1"],
    [1, "2"],
    [3, "4"],
  ]);
  const e_pos = matches.opt_strs_pos("e");
  expect(e_pos).toEqual([]);
  const r_pos = matches.opt_strs_pos("r");
  expect(r_pos).toEqual([
    [2, "3"],
    [4, "5"],
    [5, "6"],
  ]);
});
