// Port of compiler/rustc_attr_parsing/src/check_cfg.rs.
import type { Session } from "../rustc_session/lib.ts";
import { ExpectedValues } from "../rustc_session/config/cfg.ts";
import { str_cmp } from "../rustc_session/options.ts";
import { was_invoked_from_cargo } from "../rustc_session/utils.ts";
import { LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import { MacroKind, SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident, display_Symbol, Ident, sym, Symbol } from "../rustc_span/symbol.ts";
import { escape_char } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";

const MAX_CHECK_CFG_NAMES_OR_VALUES = 35;

type FilterWellKnownNames = "Yes" | "No";

// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:16 sort_and_truncate_possibilities
function sort_and_truncate_possibilities(
  sess: Session,
  possibilities: Symbol[],
  filter_well_known_names: FilterWellKnownNames,
): [Symbol[], number] {
  const possibilities_len = possibilities.length;

  let n_possibilities: number;
  if (sess.opts.unstable_opts.check_cfg_all_expected) {
    n_possibilities = possibilities.length;
  } else {
    switch (filter_well_known_names) {
      case "Yes":
        possibilities = possibilities.filter((cfg_name) => !sess.check_config.well_known_names.has(cfg_name));
        break;
      case "No":
        break;
    }
    n_possibilities = Math.min(possibilities.length, MAX_CHECK_CFG_NAMES_OR_VALUES);
  }

  possibilities.sort((s1, s2) => str_cmp(Symbol.as_str(s1), Symbol.as_str(s2)));

  const and_more = Math.max(possibilities_len - n_possibilities, 0);
  possibilities.length = Math.min(possibilities.length, n_possibilities);
  return [possibilities, and_more];
}

type EscapeQuotes = "Yes" | "No";

// PORT: `str::escape_debug`: the first char with `char::escape_debug` (ESCAPE_ALL), the others without
// escaping grapheme-extended chars. `escape_char` escapes grapheme-extended and non-printable chars alike,
// and no grapheme-extend table is ported, so a non-ASCII `\u{..}` escape after the first char is unported.
function str_escape_debug(s: string): string {
  let out = "";
  let first = true;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const e = escape_char(c, true, true);
    if (!first && c >= 0x80 && e.startsWith("\\u{")) {
      return unported("core::str::escape_debug (non-ASCII escaped continuation char)");
    }
    out += e;
    first = false;
  }
  return out;
}

// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:48 to_check_cfg_arg
function to_check_cfg_arg(name: Ident, value: Symbol | undefined, quotes: EscapeQuotes): string {
  if (value !== undefined) {
    const value_ = str_escape_debug(Symbol.as_str(value));
    let values: string;
    switch (quotes) {
      case "Yes":
        values = `\\"${value_.replaceAll('"', '\\\\\\\\"')}\\"`;
        break;
      case "No":
        values = `"${value_}"`;
        break;
    }
    return `cfg(${display_Ident(name)}, values(${values}))`;
  } else {
    return `cfg(${display_Ident(name)})`;
  }
}

// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:61 cargo_help_sub
function cargo_help_sub(sess: Session, inst: (q: EscapeQuotes) => string): diagnostics.UnexpectedCfgCargoHelp {
  // We don't want to suggest the `build.rs` way to expected cfgs if we are already in a
  // `build.rs`. We therefor do a best effort check (looking if the `--crate-name` is
  // `build_script_build`) to try to figure out if we are building a Cargo build script

  const unescaped = inst("No");
  if (sess.opts.crate_name === "build_script_build") {
    return diagnostics.UnexpectedCfgCargoHelp.lint_cfg(unescaped);
  } else {
    return diagnostics.UnexpectedCfgCargoHelp.lint_cfg_and_build_rs(unescaped, inst("Yes"));
  }
}

// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:80 rustc_macro_help
function rustc_macro_help(span: Span): diagnostics.UnexpectedCfgRustcMacroHelp | undefined {
  const oexpn = SyntaxContext.outer_expn_data(Span.ctxt(span));
  const def_id = oexpn.macro_def_id;
  if (def_id !== undefined && oexpn.kind.$ === "Macro" && def_id.krate !== LOCAL_CRATE) {
    const macro_kind = oexpn.kind._0;
    const macro_name = oexpn.kind._1;
    return {
      macro_kind: MacroKind.descr(macro_kind),
      macro_name,
    };
  } else {
    return undefined;
  }
}

// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:95 cargo_macro_help
function cargo_macro_help(span: Span): diagnostics.UnexpectedCfgCargoMacroHelp | undefined {
  const oexpn = SyntaxContext.outer_expn_data(Span.ctxt(span));
  const def_id = oexpn.macro_def_id;
  if (def_id !== undefined && def_id.krate !== LOCAL_CRATE && oexpn.kind.$ === "Macro") {
    const macro_kind = oexpn.kind._0;
    const macro_name = oexpn.kind._1;
    return {
      macro_kind: MacroKind.descr(macro_kind),
      macro_name,
    };
  } else {
    return undefined;
  }
}

// PORT: `#[allow(rustc::potential_query_instability)]` iterations over `expecteds` (an `FxHashMap`) /
// `well_known_names` / the value sets (`FxHashSet`) follow the JS insertion order. Upstream sorts every
// list it shows; the order only matters for ties in `find_best_match_for_name` over the names.
// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:110 unexpected_cfg_name
export function unexpected_cfg_name(
  sess: Session,
  [name, name_span]: [Symbol, Span],
  value: [Symbol, Span] | undefined,
): diagnostics.UnexpectedCfgName {
  const possibilities: Symbol[] = [...sess.check_config.expecteds.keys()];

  const names_possibilities: Symbol[] =
    value === undefined
      ? // We later sort and display all the possibilities, so the order here does not matter.
        [...sess.check_config.expecteds].filter(([, v]) => v.$ === "Some" && v._0.has(name)).map(([k]) => k)
      : [];

  const is_from_cargo = was_invoked_from_cargo();
  const is_from_external_macro = Span.in_external_macro(name_span, sess.source_map());
  let is_feature_cfg = name === sym.feature;

  // rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:137 miscapitalized_boolean
  function miscapitalized_boolean(name: Symbol): boolean | undefined {
    if (eq_ignore_ascii_case(Symbol.as_str(name), "false")) {
      return false;
    } else if (eq_ignore_ascii_case(Symbol.as_str(name), "true")) {
      return true;
    } else {
      return undefined;
    }
  }

  let code_sugg: diagnostics.unexpected_cfg_name.CodeSuggestion;
  let boolean: boolean | undefined;
  let best_match_: Symbol | undefined;
  if (is_feature_cfg && is_from_cargo) {
    code_sugg = diagnostics.unexpected_cfg_name.CodeSuggestion.DefineFeatures;
    // Suggest correct `version("..")` predicate syntax
  } else if (value !== undefined && name === sym.version) {
    const [, value_span] = value;
    code_sugg = {
      $: "VersionSyntax",
      between_name_and_value: Span.between(name_span, value_span),
      after_value: Span.shrink_to_hi(value_span),
    };
    // Suggest a literal `false` instead
    // Detect miscapitalized `False`/`FALSE` etc, ensuring that this isn't `r#false`
  } else if (
    value === undefined &&
    // If this is a miscapitalized False/FALSE, suggest the boolean literal instead
    (boolean = miscapitalized_boolean(name)) !== undefined &&
    // Check this isn't a raw identifier
    snippet_has_no_raw(sess, name_span)
  ) {
    code_sugg = {
      $: "BooleanLiteral",
      span: name_span,
      literal: boolean,
    };
    // Suggest the most probable if we found one
  } else if ((best_match_ = find_best_match_for_name(possibilities, name, undefined)) !== undefined) {
    const best_match = best_match_;
    is_feature_cfg ||= best_match === sym.feature;

    const best_match_values = sess.check_config.expecteds.get(best_match);
    if (best_match_values !== undefined && best_match_values.$ === "Some") {
      // We will soon sort, so the initial order does not matter.
      const possibilities: Symbol[] = [...best_match_values._0].filter((s): s is Symbol => s !== undefined);
      // `sort_by_key(|s| s.as_str())` (stable)
      possibilities.sort((a, b) => str_cmp(Symbol.as_str(a), Symbol.as_str(b)));

      const get_possibilities_sub = (): diagnostics.unexpected_cfg_name.ExpectedValues | undefined => {
        if (possibilities.length === 0) {
          return undefined;
        } else {
          const possibilities_ = { _0: possibilities.slice() };
          return {
            best_match,
            possibilities: possibilities_,
          };
        }
      };

      const best_match_ident = Ident.new(best_match, name_span);
      if (value !== undefined) {
        const [value_, value_span] = value;
        if (best_match_values._0.has(value_)) {
          code_sugg = {
            $: "SimilarNameAndValue",
            span: name_span,
            code: display_Ident(best_match_ident),
          };
        } else if (best_match_values._0.has(undefined)) {
          code_sugg = {
            $: "SimilarNameNoValue",
            span: Span.to(name_span, value_span),
            code: display_Ident(best_match_ident),
          };
        } else if (possibilities[0] !== undefined) {
          const first_value = possibilities[0];
          code_sugg = {
            $: "SimilarNameDifferentValues",
            span: Span.to(name_span, value_span),
            code: `${display_Ident(best_match_ident)} = "${display_Symbol(first_value)}"`,
            expected: get_possibilities_sub(),
          };
        } else {
          code_sugg = {
            $: "SimilarNameDifferentValues",
            span: Span.to(name_span, value_span),
            code: display_Ident(best_match_ident),
            expected: get_possibilities_sub(),
          };
        }
      } else {
        code_sugg = {
          $: "SimilarName",
          span: name_span,
          code: display_Ident(best_match_ident),
          expected: get_possibilities_sub(),
        };
      }
    } else {
      code_sugg = {
        $: "SimilarName",
        span: name_span,
        code: display_Ident(Ident.new(best_match, name_span)),
        expected: undefined,
      };
    }
  } else {
    let similar_values: diagnostics.unexpected_cfg_name.FoundWithSimilarValue[];
    if (names_possibilities.length !== 0 && names_possibilities.length <= 3) {
      // `Vec<&Symbol>::sort` (`Ord for Symbol` compares the interned indices)
      names_possibilities.sort((a, b) => a - b);
      similar_values = names_possibilities.map((cfg_name) => ({
        span: name_span,
        code: `${display_Symbol(cfg_name)} = "${display_Symbol(name)}"`,
      }));
    } else {
      similar_values = [];
    }

    const [possibilities_, and_more] = sort_and_truncate_possibilities(sess, possibilities, "Yes");
    let expected_names: diagnostics.unexpected_cfg_name.ExpectedNames | undefined;
    if (possibilities_.length === 0) {
      expected_names = undefined;
    } else {
      const possibilities__: Ident[] = possibilities_.map((s) => Ident.new(s, name_span));
      expected_names = {
        possibilities: { _0: possibilities__ },
        and_more,
      };
    }
    code_sugg = {
      $: "SimilarValues",
      with_similar_values: similar_values,
      expected_names,
    };
  }

  const inst = (escape_quotes: EscapeQuotes) =>
    to_check_cfg_arg(Ident.new(name, name_span), value === undefined ? undefined : value[0], escape_quotes);

  let invocation_help: diagnostics.unexpected_cfg_name.InvocationHelp;
  if (is_from_cargo) {
    const help = !is_feature_cfg && !is_from_external_macro ? cargo_help_sub(sess, inst) : undefined;
    invocation_help = {
      $: "Cargo",
      help,
      macro_help: cargo_macro_help(name_span),
    };
  } else {
    const help = diagnostics.UnexpectedCfgRustcHelp.new(inst("No"));
    invocation_help = {
      $: "Rustc",
      help,
      macro_help: rustc_macro_help(name_span),
    };
  }

  return { code_sugg, invocation_help, name };
}

// `str::eq_ignore_ascii_case`
function eq_ignore_ascii_case(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x >= 0x41 && x <= 0x5a) x += 0x20;
    if (y >= 0x41 && y <= 0x5a) y += 0x20;
    if (x !== y) return false;
  }
  return true;
}

// `sess.source_map().span_to_snippet(name_span).map_or(true, |snippet| !snippet.contains("r#"))`
function snippet_has_no_raw(sess: Session, name_span: Span): boolean {
  const r = sess.source_map().span_to_snippet(name_span);
  return r.$ === "Err" ? true : r._0.find("r#") === undefined;
}

// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:293 unexpected_cfg_value
export function unexpected_cfg_value(
  sess: Session,
  [name, name_span]: [Symbol, Span],
  value: [Symbol, Span] | undefined,
): diagnostics.UnexpectedCfgValue {
  const values_ = sess.check_config.expecteds.get(name);
  if (values_ === undefined || values_.$ !== "Some") {
    return panic("it shouldn't be possible to have a diagnostic on a value whose name is not in values");
  }
  const values = values_._0;
  let have_none_possibility = false;
  // We later sort possibilities if it is not empty, so the
  // order here does not matter.
  const possibilities: Symbol[] = [];
  for (const a of values) {
    have_none_possibility ||= a === undefined;
    if (a !== undefined) possibilities.push(a);
  }

  const is_from_cargo = was_invoked_from_cargo();
  const is_from_external_macro = Span.in_external_macro(name_span, sess.source_map());

  let code_sugg: diagnostics.unexpected_cfg_value.CodeSuggestion;
  let valid_names: Symbol[] | undefined;
  if (
    value !== undefined &&
    sess.check_config.well_known_names.has(name) &&
    (valid_names = possible_well_known_names_for_cfg_value(sess, value[0])).length !== 0
  ) {
    const [value_] = value;
    // Suggest changing the name to something for which `value` is an expected value.
    const max_suggestions = 3;
    const suggestions = valid_names.slice(0, max_suggestions).map(
      (name): diagnostics.unexpected_cfg_value.ChangeNameSuggestion => ({
        span: name_span,
        name,
        value: value_,
      }),
    );
    code_sugg = { $: "ChangeName", suggestions };
  } else if (possibilities.length !== 0) {
    // Show the full list if all possible values for a given name, but don't do it
    // for names as the possibilities could be very long
    let expected_values: diagnostics.unexpected_cfg_value.ExpectedValues;
    {
      const [possibilities_, and_more] = sort_and_truncate_possibilities(sess, possibilities.slice(), "No");
      expected_values = {
        name,
        have_none_possibility,
        possibilities: { _0: possibilities_ },
        and_more,
      };
    }

    let suggestion: diagnostics.unexpected_cfg_value.ChangeValueSuggestion | undefined;
    if (value !== undefined) {
      const [value_, value_span] = value;
      // Suggest the most probable if we found one
      const best_match = find_best_match_for_name(possibilities, value_, undefined);
      suggestion =
        best_match === undefined
          ? undefined
          : {
              $: "SimilarName",
              span: value_span,
              best_match,
            };
    } else if (possibilities.length === 1) {
      const first_possibility = possibilities[0]!;
      suggestion = {
        $: "SpecifyValue",
        span: Span.shrink_to_hi(name_span),
        first_possibility,
      };
    } else {
      suggestion = undefined;
    }

    code_sugg = {
      $: "ChangeValue",
      expected_values,
      suggestion,
    };
  } else if (have_none_possibility) {
    const suggestion =
      value === undefined
        ? undefined
        : {
            span: Span.to(Span.shrink_to_hi(name_span), value[1]),
          };
    code_sugg = { $: "RemoveValue", suggestion, name };
  } else {
    const span = value !== undefined ? Span.to(name_span, value[1]) : name_span;
    const suggestion = { span };
    code_sugg = { $: "RemoveCondition", suggestion, name };
  }

  // We don't want to encourage people to add values to a well-known names, as these are
  // defined by rustc/Rust itself. Users can still do this if they wish, but should not be
  // encouraged to do so.
  const can_suggest_adding_value =
    !sess.check_config.well_known_names.has(name) ||
    // Except when working on rustc or the standard library itself, in which case we want to
    // suggest adding these cfgs to the "normal" place because of bootstrapping reasons. As a
    // basic heuristic, we use the "cheat" unstable feature enable method and the
    // non-ui-testing enabled option.
    (sess.unstable_features === "Cheat" && !sess.opts.unstable_opts.ui_testing);

  const inst = (escape_quotes: EscapeQuotes) =>
    to_check_cfg_arg(Ident.new(name, name_span), value === undefined ? undefined : value[0], escape_quotes);

  let invocation_help: diagnostics.unexpected_cfg_value.InvocationHelp;
  if (is_from_cargo) {
    let help: diagnostics.unexpected_cfg_value.CargoHelp | undefined;
    if (name === sym.feature && !is_from_external_macro) {
      if (value !== undefined) {
        const [value_] = value;
        help = { $: "AddFeature", value: value_ };
      } else {
        help = diagnostics.unexpected_cfg_value.CargoHelp.DefineFeatures;
      }
    } else if (can_suggest_adding_value && !is_from_external_macro) {
      help = { $: "Other", _0: cargo_help_sub(sess, inst) };
    } else {
      help = undefined;
    }
    invocation_help = {
      $: "Cargo",
      help,
      macro_help: cargo_macro_help(name_span),
    };
  } else {
    const help = can_suggest_adding_value ? diagnostics.UnexpectedCfgRustcHelp.new(inst("No")) : undefined;
    invocation_help = {
      $: "Rustc",
      help,
      macro_help: rustc_macro_help(name_span),
    };
  }

  return {
    code_sugg,
    invocation_help,
    has_value: value !== undefined,
    value: value === undefined ? "" : display_Symbol(value[0]),
  };
}

// rustc: compiler/rustc_attr_parsing/src/check_cfg.rs:441 possible_well_known_names_for_cfg_value
function possible_well_known_names_for_cfg_value(sess: Session, value: Symbol): Symbol[] {
  const names = [...sess.check_config.well_known_names].filter((name) => {
    const expected_values = sess.check_config.expecteds.get(name);
    return expected_values !== undefined && ExpectedValues.contains(expected_values, value);
  });
  names.sort((a, b) => str_cmp(Symbol.as_str(a), Symbol.as_str(b)));
  return names;
}
