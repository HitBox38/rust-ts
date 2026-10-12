// Port of getopts =0.2.24 `src/lib.rs` (default features, i.e. with `unicode`).
//
// Copyright 2012-2014 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.
//
// ignore-lexer-test FIXME #15677

//! Simple getopt alternative.
//!
//! Construct instance of `Options` and configure it by using  `reqopt()`,
//! `optopt()` and other methods that add option configuration. Then call
//! `parse()` method and pass into it a vector of actual arguments (not
//! including `argv[0]`).
//!
//! You'll either get a failure code back, or a match. You'll have to verify
//! whether the amount of 'free' arguments in the match is what you expect. Use
//! `opt_*` accessors to get argument values out of the matches object.
//!
//! Single-character options are expected to appear on the command line with a
//! single preceding dash; multiple-character options are expected to be
//! proceeded by two dashes. Options that expect an argument accept their
//! argument following either a space or an equals sign. Single-character
//! options don't require the space. Everything after double-dash "--"  argument
//! is considered to be a 'free' argument, even if it starts with dash.
//!
//! (The usage/example sections of upstream's crate docs are not repeated here.)
//
// PORT: `OsStr` arguments are JS strings (`Options::parse` takes `readonly string[]`);
// `IntoIterator<Item: AsRef<str>>` parameters are `Iterable<string>`; `T: FromStr` (`opt_get`,
// `opt_get_default`) becomes an explicit `from_str: (s: string) => Result<T, E>` parameter.
// `str::len()` is the UTF-8 byte length (`utf8_len`); byte-offset slicing goes through `Str`.

import { is_whitespace, len_utf8, to_string as char_to_string } from "../../std/char.ts";
import { debug_str, debug_tuple, type Fmt } from "../../std/fmt.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result as StdResult } from "../../std/result.ts";
import { Str, str_trim_end, str_trim_start, utf8_len } from "../../std/str.ts";
import { UnicodeWidthStr } from "../unicode_width/lib.ts";

// use self::Fail::*; use self::HasArg::*; use self::Name::*; use self::Occur::*; use self::Optval::*;

// #[cfg(feature = "unicode")] use unicode_width::UnicodeWidthStr;
//
// #[cfg(not(feature = "unicode"))] trait UnicodeWidthStr { fn width(&self) -> usize; }
// crate-skip: getopts-0.2.24/src/lib.rs:126 width cfg(not(feature = "unicode")) fallback trait; rustc builds getopts with `unicode` (unicode-width 0.2.2 in Cargo.lock)
//
// #[cfg(not(feature = "unicode"))] impl UnicodeWidthStr for str { fn width(&self) -> usize { self.len() } }
// crate-skip: getopts-0.2.24/src/lib.rs:131 width cfg(not(feature = "unicode")) fallback impl; rustc builds getopts with `unicode` (unicode-width 0.2.2 in Cargo.lock)

// #[cfg(test)] mod tests;  → tests/mod.test.ts

const C_SPACE = 0x20; // ' '
const C_MINUS = 0x2d; // '-'

/// A description of the options that a program can handle.
export class Options {
  // PORT: the private fields `parsing_style` and `long_only` share their names with the builder
  // methods `parsing_style()` / `long_only()`, which a JS class cannot express; the fields carry
  // a trailing underscore.
  constructor(
    public grps: OptGroup[],
    public parsing_style_: ParsingStyle,
    public long_only_: boolean,
  ) {}

  // impl Default for Options
  // crate: getopts-0.2.24/src/lib.rs:148 default
  static default_(): Options {
    return Options.new();
  }

  /// Create a blank set of options.
  // crate: getopts-0.2.24/src/lib.rs:155 new
  static new(): Options {
    return new Options([], ParsingStyle.FloatingFrees, false);
  }

  /// Set the parsing style.
  // crate: getopts-0.2.24/src/lib.rs:164 parsing_style
  parsing_style(style: ParsingStyle): this {
    this.parsing_style_ = style;
    return this;
  }

  /// Set or clear "long options only" mode.
  ///
  /// In "long options only" mode, short options cannot be clustered
  /// together, and long options can be given with either a single
  /// "-" or the customary "--".  This mode also changes the meaning
  /// of "-a=b"; in the ordinary mode this will parse a short option
  /// "-a" with argument "=b"; whereas in long-options-only mode the
  /// argument will be simply "b".
  // crate: getopts-0.2.24/src/lib.rs:177 long_only
  long_only(long_only: boolean): this {
    this.long_only_ = long_only;
    return this;
  }

  /// Create a generic option group, stating all parameters explicitly.
  // crate: getopts-0.2.24/src/lib.rs:183 opt
  opt(short_name: string, long_name: string, desc: string, hint: string, hasarg: HasArg, occur: Occur): this {
    validate_names(short_name, long_name);
    this.grps.push(new OptGroup(short_name, long_name, hint, desc, hasarg, occur));
    return this;
  }

  /// Create a long option that is optional and does not take an argument.
  ///
  /// * `short_name` - e.g. `"h"` for a `-h` option, or `""` for none
  /// * `long_name` - e.g. `"help"` for a `--help` option, or `""` for none
  /// * `desc` - Description for usage help
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  /// opts.optflag("h", "help", "help flag");
  ///
  /// let matches = opts.parse(&["-h"]).unwrap();
  /// assert!(matches.opt_present("h"));
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:220 optflag
  optflag(short_name: string, long_name: string, desc: string): this {
    validate_names(short_name, long_name);
    this.grps.push(new OptGroup(short_name, long_name, "", desc, HasArg.No, Occur.Optional));
    return this;
  }

  /// Create a long option that can occur more than once and does not
  /// take an argument.
  ///
  /// * `short_name` - e.g. `"h"` for a `-h` option, or `""` for none
  /// * `long_name` - e.g. `"help"` for a `--help` option, or `""` for none
  /// * `desc` - Description for usage help
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  /// opts.optflagmulti("v", "verbose", "verbosity flag");
  ///
  /// let matches = opts.parse(&["-v", "--verbose"]).unwrap();
  /// assert_eq!(2, matches.opt_count("v"));
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:250 optflagmulti
  optflagmulti(short_name: string, long_name: string, desc: string): this {
    validate_names(short_name, long_name);
    this.grps.push(new OptGroup(short_name, long_name, "", desc, HasArg.No, Occur.Multi));
    return this;
  }

  /// Create a long option that is optional and takes an optional argument.
  ///
  /// * `short_name` - e.g. `"h"` for a `-h` option, or `""` for none
  /// * `long_name` - e.g. `"help"` for a `--help` option, or `""` for none
  /// * `desc` - Description for usage help
  /// * `hint` - Hint that is used in place of the argument in the usage help,
  ///   e.g. `"FILE"` for a `-o FILE` option
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  /// opts.optflagopt("t", "text", "flag with optional argument", "TEXT");
  ///
  /// let matches = opts.parse(&["--text"]).unwrap();
  /// assert_eq!(None, matches.opt_str("text"));
  ///
  /// let matches = opts.parse(&["--text=foo"]).unwrap();
  /// assert_eq!(Some("foo".to_owned()), matches.opt_str("text"));
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:284 optflagopt
  optflagopt(short_name: string, long_name: string, desc: string, hint: string): this {
    validate_names(short_name, long_name);
    this.grps.push(new OptGroup(short_name, long_name, hint, desc, HasArg.Maybe, Occur.Optional));
    return this;
  }

  /// Create a long option that is optional, takes an argument, and may occur
  /// multiple times.
  ///
  /// * `short_name` - e.g. `"h"` for a `-h` option, or `""` for none
  /// * `long_name` - e.g. `"help"` for a `--help` option, or `""` for none
  /// * `desc` - Description for usage help
  /// * `hint` - Hint that is used in place of the argument in the usage help,
  ///   e.g. `"FILE"` for a `-o FILE` option
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  /// opts.optmulti("t", "text", "text option", "TEXT");
  ///
  /// let matches = opts.parse(&["-t", "foo", "--text=bar"]).unwrap();
  ///
  /// let values = matches.opt_strs("t");
  /// assert_eq!(2, values.len());
  /// assert_eq!("foo", values[0]);
  /// assert_eq!("bar", values[1]);
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:326 optmulti
  optmulti(short_name: string, long_name: string, desc: string, hint: string): this {
    validate_names(short_name, long_name);
    this.grps.push(new OptGroup(short_name, long_name, hint, desc, HasArg.Yes, Occur.Multi));
    return this;
  }

  /// Create a long option that is optional and takes an argument.
  ///
  /// * `short_name` - e.g. `"h"` for a `-h` option, or `""` for none
  /// * `long_name` - e.g. `"help"` for a `--help` option, or `""` for none
  /// * `desc` - Description for usage help
  /// * `hint` - Hint that is used in place of the argument in the usage help,
  ///   e.g. `"FILE"` for a `-o FILE` option
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// # use getopts::Fail;
  /// let mut opts = Options::new();
  /// opts.optopt("o", "optional", "optional text option", "TEXT");
  ///
  /// let matches = opts.parse(&["arg1"]).unwrap();
  /// assert_eq!(None, matches.opt_str("optional"));
  ///
  /// let matches = opts.parse(&["--optional", "foo", "arg1"]).unwrap();
  /// assert_eq!(Some("foo".to_owned()), matches.opt_str("optional"));
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:367 optopt
  optopt(short_name: string, long_name: string, desc: string, hint: string): this {
    validate_names(short_name, long_name);
    this.grps.push(new OptGroup(short_name, long_name, hint, desc, HasArg.Yes, Occur.Optional));
    return this;
  }

  /// Create a long option that is required and takes an argument.
  ///
  /// * `short_name` - e.g. `"h"` for a `-h` option, or `""` for none
  /// * `long_name` - e.g. `"help"` for a `--help` option, or `""` for none
  /// * `desc` - Description for usage help
  /// * `hint` - Hint that is used in place of the argument in the usage help,
  ///   e.g. `"FILE"` for a `-o FILE` option
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// # use getopts::Fail;
  /// let mut opts = Options::new();
  /// opts.optopt("o", "optional", "optional text option", "TEXT");
  /// opts.reqopt("m", "mandatory", "madatory text option", "TEXT");
  ///
  /// let result = opts.parse(&["--mandatory", "foo"]);
  /// assert!(result.is_ok());
  ///
  /// let result = opts.parse(&["--optional", "foo"]);
  /// assert!(result.is_err());
  /// assert_eq!(Fail::OptionMissing("mandatory".to_owned()), result.unwrap_err());
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:410 reqopt
  reqopt(short_name: string, long_name: string, desc: string, hint: string): this {
    validate_names(short_name, long_name);
    this.grps.push(new OptGroup(short_name, long_name, hint, desc, HasArg.Yes, Occur.Req));
    return this;
  }

  /// Parse command line arguments according to the provided options.
  ///
  /// On success returns `Ok(Matches)`. Use methods such as `opt_present`
  /// `opt_str`, etc. to interrogate results.
  /// # Panics
  ///
  /// Returns `Err(Fail)` on failure: use the `Debug` implementation of `Fail`
  /// to display information about it.
  // crate: getopts-0.2.24/src/lib.rs:437 parse
  parse(args: Iterable<string>): Result {
    const opts: Opt[] = this.grps.map((x) => x.long_to_short());

    const vals: [number, Optval][][] = opts.map(() => []);
    const free: string[] = [];
    let args_end: number | undefined = undefined;

    // let args = args.into_iter().map(|i| i.as_ref().to_str().ok_or_else(..).map(..)).collect::<Result<Vec<_>, _>>()?;
    const args_: string[] = [];
    for (const i of args) {
      // PORT: `OsStr::to_str` fails only on non-UTF-8 input; a JS string can only be non-UTF-8
      // through lone surrogates, whose `OsStr` Debug rendering (`format!("{:?}", ..)`) has no
      // faithful JS source.
      if (/[\uD800-\uDFFF]/u.test(i)) {
        return unported("getopts::Options::parse non-UTF-8 OsStr argument (Fail::UnrecognizedOption(format!(\"{:?}\", os_str)))");
      }
      args_.push(i);
    }
    // PORT: `args.into_iter().peekable()` → index `k` into `args_` (`next()` = `args_[k++]`,
    // `peek()` = `args_[k]`, `free.extend(args)` = push the rest and exhaust).
    let k = 0;
    let arg_pos = 0;
    while (k < args_.length) {
      const cur = args_[k++]!;
      if (!is_arg(cur)) {
        free.push(cur);
        if (this.parsing_style_ === "FloatingFrees") {
          // ParsingStyle::FloatingFrees => {}
        } else {
          // ParsingStyle::StopAtFirstFree
          free.push(...args_.slice(k));
          k = args_.length;
          break;
        }
      } else if (cur === "--") {
        args_end = free.length;
        free.push(...args_.slice(k));
        k = args_.length;
        break;
      } else {
        let name: Name | undefined = undefined;
        let i_arg: string | undefined = undefined;
        let was_long = true;
        // PORT: `is_arg` guarantees `cur` starts with the ASCII '-' and has more than one byte,
        // so `cur.as_bytes()[1]` is `-` exactly when UTF-16 unit 1 is `-`.
        const cur_s = Str.from(cur);
        if (cur_s.byte(1) === C_MINUS || this.long_only_) {
          let tail: Str;
          if (cur_s.byte(1) === C_MINUS) {
            tail = cur_s.slice(2);
          } else {
            assert(this.long_only_, "assertion failed: self.long_only");
            tail = cur_s.slice(1);
          }
          // let mut parts = tail.splitn(2, '=');
          const tail_ = tail.toString();
          const eq = tail_.indexOf("=");
          name = Name.from_str(eq < 0 ? tail_ : tail_.slice(0, eq));
          if (eq >= 0) {
            const rest = tail_.slice(eq + 1);
            i_arg = rest;
          }
        } else {
          was_long = false;
          // for (j, ch) in cur.char_indices().skip(1)
          const chars = cur_s.chars();
          chars.next();
          for (;;) {
            const j = chars.pos - cur_s.lo;
            const ch = chars.next();
            if (ch === undefined) break;
            const opt: Name = { $: "Short", _0: ch };

            const opt_id = find_opt(opts, opt);
            if (opt_id === undefined) return Err({ $: "UnrecognizedOption", _0: Name.to_string(opt) });

            // In a series of potential options (eg. -aheJ), if we
            // see one which takes an argument, we assume all
            // subsequent characters make up the argument. This
            // allows options such as -L/usr/local/lib/foo to be
            // interpreted correctly
            let arg_follows: boolean;
            switch (opts[opt_id]!.hasarg) {
              case "Yes":
              case "Maybe":
                arg_follows = true;
                break;
              case "No":
                arg_follows = false;
                break;
            }

            if (arg_follows) {
              name = opt;
              const next = j + len_utf8(ch);
              if (next < cur_s.len()) {
                i_arg = cur_s.slice(next).toString();
                break;
              }
            } else {
              vals[opt_id]!.push([arg_pos, Optval.Given]);
            }
          }
        }
        if (name !== undefined) {
          const nm = name;
          const opt_id = find_opt(opts, nm);
          if (opt_id === undefined) return Err({ $: "UnrecognizedOption", _0: Name.to_string(nm) });
          switch (opts[opt_id]!.hasarg) {
            case "No": {
              if (i_arg !== undefined) {
                return Err({ $: "UnexpectedArgument", _0: Name.to_string(nm) });
              }
              vals[opt_id]!.push([arg_pos, Optval.Given]);
              break;
            }
            case "Maybe": {
              // Note that here we do not handle `--arg value`.
              // This matches GNU getopt behavior; but also
              // makes sense, because if this were accepted,
              // then users could only write a "Maybe" long
              // option at the end of the arguments when
              // FloatingFrees is in use.
              const peeked = args_[k];
              if (i_arg !== undefined) {
                const i_arg_ = i_arg;
                i_arg = undefined;
                vals[opt_id]!.push([arg_pos, { $: "Val", _0: i_arg_ }]);
              } else if (was_long || (peeked === undefined ? true : is_arg(peeked))) {
                vals[opt_id]!.push([arg_pos, Optval.Given]);
              } else {
                vals[opt_id]!.push([arg_pos, { $: "Val", _0: args_[k++]! }]);
              }
              break;
            }
            case "Yes": {
              if (i_arg !== undefined) {
                const i_arg_ = i_arg;
                i_arg = undefined;
                vals[opt_id]!.push([arg_pos, { $: "Val", _0: i_arg_ }]);
              } else if (k < args_.length) {
                const n = args_[k++]!;
                vals[opt_id]!.push([arg_pos, { $: "Val", _0: n }]);
              } else {
                return Err({ $: "ArgumentMissing", _0: Name.to_string(nm) });
              }
              break;
            }
          }
        }
      }
      arg_pos += 1;
    }
    // debug_assert_eq!(vals.len(), opts.len());
    for (let idx = 0; idx < vals.length && idx < opts.length; idx++) {
      const vals_ = vals[idx]!;
      const opt = opts[idx]!;
      if (opt.occur === "Req" && vals_.length === 0) {
        return Err({ $: "OptionMissing", _0: Name.to_string(opt.name) });
      }
      if (opt.occur !== "Multi" && vals_.length > 1) {
        return Err({ $: "OptionDuplicated", _0: Name.to_string(opt.name) });
      }
    }

    // Note that if "--" is last argument on command line, then index stored
    // in option does not exist in `free` and must be replaced with `None`
    args_end = args_end !== undefined && args_end !== free.length ? args_end : undefined;

    return Ok(new Matches(opts, vals, free, args_end));
  }

  /// Derive a short one-line usage summary from a set of long options.
  // crate: getopts-0.2.24/src/lib.rs:586 short_usage
  short_usage(program_name: string): string {
    let line = `Usage: ${program_name} `;
    line += this.grps.map(format_option).join(" ");
    return line;
  }

  /// Derive a formatted message from a set of options.
  // crate: getopts-0.2.24/src/lib.rs:600 usage
  usage(brief: string): string {
    return this.usage_with_format((opts) => `${brief}\n\nOptions:\n${Array.from(opts).join("\n")}\n`);
  }

  /// Derive a custom formatted message from a set of options. The formatted options provided to
  /// a closure as an iterator.
  // crate: getopts-0.2.24/src/lib.rs:612 usage_with_format
  usage_with_format(formatter: (opts: IterableIterator<string>) => string): string {
    return formatter(this.usage_items());
  }

  /// Derive usage items from a set of options.
  // PORT: the lazy `Box<dyn Iterator<Item = String>>` (`self.grps.iter().map(..)`) is a generator,
  // so each row (and its panics) is produced only when the caller pulls it.
  // crate: getopts-0.2.24/src/lib.rs:620 usage_items
  usage_items(): IterableIterator<string> {
    const desc_sep = `\n${" ".repeat(24)}`;

    const any_short = this.grps.some((optref) => optref.short_name.length !== 0);

    const self = this;
    function* rows(): Generator<string, void, undefined> {
      for (const optref of self.grps) {
        const { short_name, long_name, hint, desc, hasarg } = optref;

        let row = "    ";

        // short option
        switch (UnicodeWidthStr.width(short_name)) {
          case 0: {
            if (any_short) {
              row += "    ";
            }
            break;
          }
          case 1: {
            row += "-";
            row += short_name;
            if (UnicodeWidthStr.width(long_name) > 0) {
              row += ", ";
            } else {
              // Only a single space here, so that any
              // argument is printed in the correct spot.
              row += " ";
            }
            break;
          }
          // FIXME: refer issue #7.
          default:
            panic("the short name should only be 1 ascii char long");
        }

        // long option
        switch (UnicodeWidthStr.width(long_name)) {
          case 0:
            break;
          default: {
            row += self.long_only_ ? "-" : "--";
            row += long_name;
            row += " ";
          }
        }

        // arg
        switch (hasarg) {
          case "No":
            break;
          case "Yes":
            row += hint;
            break;
          case "Maybe": {
            row += "[";
            row += hint;
            row += "]";
            break;
          }
        }

        const rowlen = UnicodeWidthStr.width(row);
        if (rowlen < 24) {
          for (let _ = 0; _ < 24 - rowlen; _++) {
            row += " ";
          }
        } else {
          row += desc_sep;
        }

        const desc_rows = each_split_within(desc, 54);
        row += desc_rows.join(desc_sep);

        yield row;
      }
    }

    return rows();
  }
}

// crate: getopts-0.2.24/src/lib.rs:699 validate_names
function validate_names(short_name: string, long_name: string): void {
  let len = utf8_len(short_name);
  assert(len === 1 || len === 0, "the short_name (first argument) should be a single character, or an empty string for none");
  len = utf8_len(long_name);
  assert(
    len === 0 || len > 1,
    "the long_name (second argument) should be longer than a single character, or an empty string for none",
  );
}

/// What parsing style to use when parsing arguments.
export type ParsingStyle =
  /// Flags and "free" arguments can be freely inter-mixed.
  | "FloatingFrees"
  /// As soon as a "free" argument (i.e. non-flag) is encountered, stop
  /// considering any remaining arguments as flags.
  | "StopAtFirstFree";
export const ParsingStyle = { FloatingFrees: "FloatingFrees", StopAtFirstFree: "StopAtFirstFree" } as const;

/// Name of an option. Either a string or a single char.
export type Name =
  /// A string representing the long name of an option.
  /// For example: "help"
  | { readonly $: "Long"; readonly _0: string }
  /// A char representing the short name of an option.
  /// For example: 'h'
  | { readonly $: "Short"; readonly _0: number };

/** `#[derive(PartialEq)]` */
export function Name_eq(a: Name, b: Name): boolean {
  return a.$ === b.$ && a._0 === b._0;
}

// impl Name
export const Name = {
  // crate: getopts-0.2.24/src/lib.rs:834 from_str
  from_str(nm: string): Name {
    if (utf8_len(nm) === 1) {
      return { $: "Short", _0: nm.charCodeAt(0) };
    } else {
      return { $: "Long", _0: nm };
    }
  },

  // crate: getopts-0.2.24/src/lib.rs:842 to_string
  to_string(self: Name): string {
    switch (self.$) {
      case "Short":
        return char_to_string(self._0);
      case "Long":
        return self._0;
    }
  },
} as const;

/// Describes whether an option has an argument.
export type HasArg =
  /// The option requires an argument.
  | "Yes"
  /// The option takes no argument.
  | "No"
  /// The option argument is optional.
  | "Maybe";
export const HasArg = { Yes: "Yes", No: "No", Maybe: "Maybe" } as const;

/// Describes how often an option may occur.
export type Occur =
  /// The option occurs once.
  | "Req"
  /// The option occurs at most once.
  | "Optional"
  /// The option occurs zero or more times.
  | "Multi";
export const Occur = { Req: "Req", Optional: "Optional", Multi: "Multi" } as const;

/// A description of a possible option.
export interface Opt {
  /// Name of the option
  name: Name;
  /// Whether it has an argument
  hasarg: HasArg;
  /// How often it can occur
  occur: Occur;
  /// Which options it aliases
  aliases: Opt[];
}

/** `#[derive(PartialEq)]` */
export function Opt_eq(a: Opt, b: Opt): boolean {
  return (
    Name_eq(a.name, b.name) &&
    a.hasarg === b.hasarg &&
    a.occur === b.occur &&
    a.aliases.length === b.aliases.length &&
    a.aliases.every((x, i) => Opt_eq(x, b.aliases[i]!))
  );
}

/// One group of options, e.g., both `-h` and `--help`, along with
/// their shared description and properties.
export class OptGroup {
  constructor(
    /// Short name of the option, e.g. `h` for a `-h` option
    public short_name: string,
    /// Long name of the option, e.g. `help` for a `--help` option
    public long_name: string,
    /// Hint for argument, e.g. `FILE` for a `-o FILE` option
    public hint: string,
    /// Description for usage help text
    public desc: string,
    /// Whether option has an argument
    public hasarg: HasArg,
    /// How often it can occur
    public occur: Occur,
  ) {}

  /// Translate OptGroup into Opt.
  /// (Both short and long names correspond to different Opts).
  // crate: getopts-0.2.24/src/lib.rs:853 long_to_short
  long_to_short(): Opt {
    const { short_name, long_name, hasarg, occur } = this;

    const sl = utf8_len(short_name);
    const ll = utf8_len(long_name);
    if (sl === 0 && ll === 0) {
      return panic("this long-format option was given no name");
    } else if (sl === 0) {
      return { name: { $: "Long", _0: long_name }, hasarg, occur, aliases: [] };
    } else if (sl === 1 && ll === 0) {
      return { name: { $: "Short", _0: short_name.charCodeAt(0) }, hasarg, occur, aliases: [] };
    } else if (sl === 1) {
      return {
        name: { $: "Long", _0: long_name },
        hasarg,
        occur,
        aliases: [
          {
            name: { $: "Short", _0: short_name.charCodeAt(0) },
            hasarg: hasarg,
            occur: occur,
            aliases: [],
          },
        ],
      };
    } else {
      return panic("something is wrong with the long-form opt");
    }
  }
}

/// Describes whether an option is given at all or has a value.
export type Optval = { readonly $: "Val"; readonly _0: string } | { readonly $: "Given" };
export const Optval = { Given: Object.freeze({ $: "Given" }) as Optval } as const;

/// The result of checking command line arguments. Contains a vector
/// of matches and a vector of free strings.
export class Matches {
  constructor(
    /// Options that matched
    public opts: Opt[],
    /// Values of the Options that matched and their positions
    public vals: [number, Optval][][],

    /// Free string fragments
    public free: string[],

    /// Index of first free fragment after "--" separator
    public args_end: number | undefined,
  ) {}

  // crate: getopts-0.2.24/src/lib.rs:893 opt_vals
  opt_vals(nm: string): [number, Optval][] {
    const id = find_opt(this.opts, Name.from_str(nm));
    if (id !== undefined) return this.vals[id]!.slice();
    return panic(`No option '${nm}' defined`);
  }

  // crate: getopts-0.2.24/src/lib.rs:900 opt_val
  opt_val(nm: string): Optval | undefined {
    const v = this.opt_vals(nm)[0];
    return v === undefined ? undefined : v[1];
  }
  /// Returns true if an option was defined
  // crate: getopts-0.2.24/src/lib.rs:904 opt_defined
  opt_defined(name: string): boolean {
    return find_opt(this.opts, Name.from_str(name)) !== undefined;
  }

  /// Returns true if an option was matched.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // crate: getopts-0.2.24/src/lib.rs:913 opt_present
  opt_present(name: string): boolean {
    return this.opt_vals(name).length !== 0;
  }

  /// Returns the number of times an option was matched.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // crate: getopts-0.2.24/src/lib.rs:922 opt_count
  opt_count(name: string): number {
    return this.opt_vals(name).length;
  }

  /// Returns a vector of all the positions in which an option was matched.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // crate: getopts-0.2.24/src/lib.rs:931 opt_positions
  opt_positions(name: string): number[] {
    return this.opt_vals(name).map(([pos, _]) => pos);
  }

  /// Returns true if any of several options were matched.
  // crate: getopts-0.2.24/src/lib.rs:939 opts_present
  opts_present(names: readonly string[]): boolean {
    return names.some((nm) => {
      const id = find_opt(this.opts, Name.from_str(nm));
      if (id !== undefined && this.vals[id]!.length !== 0) return true;
      return false;
    });
  }

  /// Returns true if any of several options were matched.
  ///
  /// Similar to `opts_present` but accepts any argument that can be converted
  /// into an iterator over string references.
  ///
  /// # Panics
  ///
  /// This function might panic if some option name is not defined.
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  /// opts.optopt("a", "alpha", "first option", "STR");
  /// opts.optopt("b", "beta", "second option", "STR");
  ///
  /// let args = vec!["-a", "foo"];
  /// let matches = &match opts.parse(&args) {
  ///     Ok(m) => m,
  ///     _ => panic!(),
  /// };
  ///
  /// assert!(matches.opts_present_any(&["alpha"]));
  /// assert!(!matches.opts_present_any(&["beta"]));
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:974 opts_present_any
  opts_present_any(names: Iterable<string>): boolean {
    for (const nm of names) {
      if (this.opt_vals(nm).length !== 0) return true;
    }
    return false;
  }

  /// Returns the string argument supplied to one of several matching options or `None`.
  // crate: getopts-0.2.24/src/lib.rs:984 opts_str
  opts_str(names: readonly string[]): string | undefined {
    for (const nm of names) {
      const v = this.opt_val(nm);
      if (v !== undefined && v.$ === "Val") return v._0;
    }
    return undefined;
  }

  /// Returns the string argument supplied to the first matching option of
  /// several options or `None`.
  ///
  /// Similar to `opts_str` but accepts any argument that can be converted
  /// into an iterator over string references.
  ///
  /// # Panics
  ///
  /// This function might panic if some option name is not defined.
  ///
  /// # Example
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  /// opts.optopt("a", "alpha", "first option", "STR");
  /// opts.optopt("b", "beta", "second option", "STR");
  ///
  /// let args = vec!["-a", "foo", "--beta", "bar"];
  /// let matches = &match opts.parse(&args) {
  ///     Ok(m) => m,
  ///     _ => panic!(),
  /// };
  ///
  /// assert_eq!(Some("foo".to_string()), matches.opts_str_first(&["alpha", "beta"]));
  /// assert_eq!(Some("bar".to_string()), matches.opts_str_first(&["beta", "alpha"]));
  /// ```
  // crate: getopts-0.2.24/src/lib.rs:1021 opts_str_first
  opts_str_first(names: Iterable<string>): string | undefined {
    for (const nm of names) {
      const v = this.opt_val(nm);
      if (v !== undefined && v.$ === "Val") return v._0;
    }
    return undefined;
  }

  /// Returns a vector of the arguments provided to all matches of the given
  /// option.
  ///
  /// Used when an option accepts multiple values.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // crate: getopts-0.2.24/src/lib.rs:1042 opt_strs
  opt_strs(name: string): string[] {
    const out: string[] = [];
    for (const [_, v] of this.opt_vals(name)) {
      if (v.$ === "Val") out.push(v._0);
    }
    return out;
  }

  /// Returns a vector of the arguments provided to all matches of the given
  /// option, together with their positions.
  ///
  /// Used when an option accepts multiple values.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // crate: getopts-0.2.24/src/lib.rs:1060 opt_strs_pos
  opt_strs_pos(name: string): [number, string][] {
    const out: [number, string][] = [];
    for (const [p, v] of this.opt_vals(name)) {
      if (v.$ === "Val") out.push([p, v._0]);
    }
    return out;
  }

  /// Returns the string argument supplied to a matching option or `None`.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // crate: getopts-0.2.24/src/lib.rs:1075 opt_str
  opt_str(name: string): string | undefined {
    const v = this.opt_val(name);
    if (v !== undefined && v.$ === "Val") return v._0;
    return undefined;
  }

  /// Returns the matching string, a default, or `None`.
  ///
  /// Returns `None` if the option was not present, `def` if the option was
  /// present but no argument was provided, and the argument if the option was
  /// present and an argument was provided.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // crate: getopts-0.2.24/src/lib.rs:1091 opt_default
  opt_default(name: string, def: string): string | undefined {
    const v = this.opt_val(name);
    if (v !== undefined && v.$ === "Val") return v._0;
    if (v !== undefined) return def;
    return undefined;
  }

  /// Returns some matching value or `None`.
  ///
  /// Similar to opt_str, also converts matching argument using FromStr.
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // PORT: `T: FromStr` → `from_str` (`<T as FromStr>::from_str`, i.e. `str::parse`).
  // crate: getopts-0.2.24/src/lib.rs:1106 opt_get
  opt_get<T, E>(name: string, from_str: (s: string) => StdResult<T, E>): StdResult<T | undefined, E> {
    const v = this.opt_val(name);
    if (v !== undefined && v.$ === "Val") {
      const r = from_str(v._0);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    }
    if (v !== undefined /* Some(Given) */) return Ok(undefined);
    return Ok(undefined);
  }

  /// Returns a matching value or default.
  ///
  /// Similar to opt_default, except the two differences.
  /// Instead of returning None when argument was not present, return `def`.
  /// Instead of returning &str return type T, parsed using str::parse().
  ///
  /// # Panics
  ///
  /// This function will panic if the option name is not defined.
  // PORT: `T: FromStr` → `from_str` (`<T as FromStr>::from_str`, i.e. `str::parse`).
  // crate: getopts-0.2.24/src/lib.rs:1126 opt_get_default
  opt_get_default<T, E>(name: string, def: T, from_str: (s: string) => StdResult<T, E>): StdResult<T, E> {
    const v = this.opt_val(name);
    if (v !== undefined && v.$ === "Val") return from_str(v._0);
    if (v !== undefined /* Some(Given) */) return Ok(def);
    return Ok(def);
  }

  /// Returns index of first free argument after "--".
  ///
  /// If double-dash separator is present and there are some args after it in
  /// the argument list then the method returns index into `free` vector
  /// indicating first argument after it.
  /// behind it.
  ///
  /// # Examples
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  ///
  /// let matches = opts.parse(&vec!["arg1", "--", "arg2"]).unwrap();
  /// let end_pos = matches.free_trailing_start().unwrap();
  /// assert_eq!(end_pos, 1);
  /// assert_eq!(matches.free[end_pos], "arg2".to_owned());
  /// ```
  ///
  /// If the double-dash is missing from argument list or if there are no
  /// arguments after it:
  ///
  /// ```
  /// # use getopts::Options;
  /// let mut opts = Options::new();
  ///
  /// let matches = opts.parse(&vec!["arg1", "--"]).unwrap();
  /// assert_eq!(matches.free_trailing_start(), None);
  ///
  /// let matches = opts.parse(&vec!["arg1", "arg2"]).unwrap();
  /// assert_eq!(matches.free_trailing_start(), None);
  /// ```
  ///
  // crate: getopts-0.2.24/src/lib.rs:1170 free_trailing_start
  free_trailing_start(): number | undefined {
    return this.args_end;
  }
}

/// The type returned when the command line does not conform to the
/// expected format. Use the `Debug` implementation to output detailed
/// information.
export type Fail =
  /// The option requires an argument but none was passed.
  | { readonly $: "ArgumentMissing"; readonly _0: string }
  /// The passed option is not declared among the possible options.
  | { readonly $: "UnrecognizedOption"; readonly _0: string }
  /// A required option is not present.
  | { readonly $: "OptionMissing"; readonly _0: string }
  /// A single occurrence option is being used multiple times.
  | { readonly $: "OptionDuplicated"; readonly _0: string }
  /// There's an argument being passed to a non-argument option.
  | { readonly $: "UnexpectedArgument"; readonly _0: string };

/** `#[derive(PartialEq)]` */
export function Fail_eq(a: Fail, b: Fail): boolean {
  return a.$ === b.$ && a._0 === b._0;
}

/** `#[derive(Debug)]` */
export const debug_Fail = (v: Fail, f: Fmt): string => debug_tuple(f, v.$, [debug_str(v._0)]);

// impl Error for Fail {}
// PORT: the empty `Error` impl has no fns (0.2.24 no longer overrides the deprecated `description`).

/// The result of parsing a command line with a set of options.
export type Result = StdResult<Matches, Fail>;

// crate: getopts-0.2.24/src/lib.rs:1175 is_arg
function is_arg(arg: string): boolean {
  return arg.charCodeAt(0) === C_MINUS && utf8_len(arg) > 1;
}

// crate: getopts-0.2.24/src/lib.rs:1179 find_opt
function find_opt(opts: readonly Opt[], nm: Name): number | undefined {
  // Search main options.
  const pos = opts.findIndex((opt) => Name_eq(opt.name, nm));
  if (pos >= 0) {
    return pos;
  }

  // Search in aliases.
  for (const candidate of opts) {
    if (candidate.aliases.some((opt) => Name_eq(opt.name, nm))) {
      const p = opts.findIndex((opt) => Name_eq(opt.name, candidate.name));
      return p >= 0 ? p : undefined;
    }
  }

  return undefined;
}

/** `impl fmt::Display for Fail` (`fail.to_string()`) */
// crate: getopts-0.2.24/src/lib.rs:1197 fmt
export function display_Fail(self: Fail): string {
  switch (self.$) {
    case "ArgumentMissing":
      return `Argument to option '${self._0}' missing`;
    case "UnrecognizedOption":
      return `Unrecognized option: '${self._0}'`;
    case "OptionMissing":
      return `Required option '${self._0}' missing`;
    case "OptionDuplicated":
      return `Option '${self._0}' given more than once`;
    case "UnexpectedArgument":
      return `Option '${self._0}' does not take an argument`;
  }
}

// crate: getopts-0.2.24/src/lib.rs:1208 format_option
function format_option(opt: OptGroup): string {
  let line = "";

  if (opt.occur !== "Req") {
    line += "[";
  }

  // Use short_name if possible, but fall back to long_name.
  if (opt.short_name.length !== 0) {
    line += "-";
    line += opt.short_name;
  } else {
    line += "--";
    line += opt.long_name;
  }

  if (opt.hasarg !== "No") {
    line += " ";
    if (opt.hasarg === "Maybe") {
      line += "[";
    }
    line += opt.hint;
    if (opt.hasarg === "Maybe") {
      line += "]";
    }
  }

  if (opt.occur !== "Req") {
    line += "]";
  }
  if (opt.occur === "Multi") {
    line += "..";
  }

  return line;
}

/// Splits a string into substrings with possibly internal whitespace,
/// each of them at most `lim` bytes long, if possible. The substrings
/// have leading and trailing whitespace removed, and are only cut at
/// whitespace boundaries.
// crate: getopts-0.2.24/src/lib.rs:1249 each_split_within
export function each_split_within(desc: string, lim: number): string[] {
  const rows: string[] = [];
  for (const line of str_trim_end(str_trim_start(Str.from(desc))).lines()) {
    // let line_chars = line.chars().chain(Some(' '));
    const line_chars: number[] = [];
    const it = line.chars();
    for (let c = it.next(); c !== undefined; c = it.next()) line_chars.push(c);
    line_chars.push(C_SPACE);
    // .fold((Vec::new(), 0, 0), |(mut words, a, z), c| { .. }).0
    const words: Str[] = [];
    let a = 0;
    let z = 0;
    for (const c of line_chars) {
      const idx = z + len_utf8(c); // Get the current byte offset

      // If the char is whitespace, advance the word start and maybe push a word
      if (is_whitespace(c)) {
        if (a !== z) {
          words.push(line.slice(a, z));
        }
        a = idx;
        z = idx;
      }
      // If the char is not whitespace, continue, retaining the current
      else {
        z = idx;
      }
    }

    let row = "";
    for (const word_ of words) {
      const word = word_.toString();
      const sep = row.length !== 0 ? " " : undefined;
      const width = UnicodeWidthStr.width(row) + UnicodeWidthStr.width(word) + (sep !== undefined ? UnicodeWidthStr.width(sep) : 0);

      if (width <= lim) {
        if (sep !== undefined) {
          row += sep;
        }
        row += word;
        continue;
      }
      if (row.length !== 0) {
        rows.push(row);
        row = "";
      }
      row += word;
    }
    if (row.length !== 0) {
      rows.push(row);
    }
  }
  return rows;
}
