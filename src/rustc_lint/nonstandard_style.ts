// compiler/rustc_lint/src/nonstandard_style.rs. The lint statics and `declare_lint_pass!` expansions are generated
// (nonstandard_style.lints.gen.ts). The early pass (NonCamelCaseTypes) is ported; the late passes (NonSnakeCase,
// NonUpperCaseGlobals, M3) are still `unported` placeholders (rust_ts/stubs.ts).
import type { ast } from "../rustc_ast/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { is_lowercase, is_titlecase, is_uppercase, to_lowercase, to_uppercase } from "../std/char.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import type { EarlyContext } from "./context.ts";
import { NonCamelCaseType_diagnostic, type NonCamelCaseTypeSub } from "./diagnostics.gen.ts";
import { NON_CAMEL_CASE_TYPES, NonCamelCaseTypes, NonSnakeCase, NonUpperCaseGlobals } from "./nonstandard_style.lints.gen.ts";
import type { EarlyLintPass } from "./passes.ts";

export * from "./nonstandard_style.lints.gen.ts";

declare module "./nonstandard_style.lints.gen.ts" {
  interface NonCamelCaseTypes extends EarlyLintPass {
    check_case(cx: EarlyContext, sort: string, ident: Ident): void;
  }
}

// ---- `char::to_titlecase` (std) ----
// PORT: `char::to_titlecase` (unstable `titlecase`, library/core/src/char/methods.rs:1604) is not in src/std yet;
// lane-owned stand-in until root moves it to src/std/char.ts with an oracle-generated table.
// `conversions::to_title` (library/core/src/unicode/unicode_data.rs:1104) is
// `lookup(c, &TITLECASE_LUT).or_else(|| lookup(c, &UPPERCASE_LUT))`; `to_upper` is the same `UPPERCASE_LUT` lookup
// (plus its ASCII/Latin-1 fast paths, which agree with the table), so this is `TITLECASE_LUT` falling back to
// `to_uppercase`. `TITLECASE_LUT` (unicode_data.rs:1489) is transcribed below: `singles` as
// [start, end, delta] (all `step_by_1`/`singleton`), `multis` and `exceptions` as [c, m0, m1, m2] (0 = no char).
// Checked against the oracle's `to_titlecase` for every char (lane lint-early-b).
const TITLECASE_SINGLES: readonly (readonly [number, number, number])[] = [
  [0x01c4, 0x01c4, 1], [0x01c5, 0x01c5, 0], [0x01c6, 0x01c6, -1], [0x01c7, 0x01c7, 1],
  [0x01c8, 0x01c8, 0], [0x01c9, 0x01c9, -1], [0x01ca, 0x01ca, 1], [0x01cb, 0x01cb, 0],
  [0x01cc, 0x01cc, -1], [0x01f1, 0x01f1, 1], [0x01f2, 0x01f2, 0], [0x01f3, 0x01f3, -1],
  [0x10d0, 0x10fa, 0], [0x10fd, 0x10ff, 0], [0x1f80, 0x1f87, 8], [0x1f88, 0x1f8f, 0],
  [0x1f90, 0x1f97, 8], [0x1f98, 0x1f9f, 0], [0x1fa0, 0x1fa7, 8], [0x1fa8, 0x1faf, 0],
  [0x1fb3, 0x1fb3, 9], [0x1fbc, 0x1fbc, 0], [0x1fc3, 0x1fc3, 9], [0x1fcc, 0x1fcc, 0],
  [0x1ff3, 0x1ff3, 9], [0x1ffc, 0x1ffc, 0],
];
const TITLECASE_MULTIS: readonly (readonly [number, number, number, number])[] = [
  [0x00df, 0x0053, 0x0073, 0x0000], [0x0587, 0x0535, 0x0582, 0x0000], [0x1fb2, 0x1fba, 0x0345, 0x0000],
  [0x1fb4, 0x0386, 0x0345, 0x0000], [0x1fb7, 0x0391, 0x0342, 0x0345], [0x1fc2, 0x1fca, 0x0345, 0x0000],
  [0x1fc4, 0x0389, 0x0345, 0x0000], [0x1fc7, 0x0397, 0x0342, 0x0345], [0x1ff2, 0x1ffa, 0x0345, 0x0000],
  [0x1ff4, 0x038f, 0x0345, 0x0000], [0x1ff7, 0x03a9, 0x0342, 0x0345], [0xfb00, 0x0046, 0x0066, 0x0000],
  [0xfb01, 0x0046, 0x0069, 0x0000], [0xfb02, 0x0046, 0x006c, 0x0000], [0xfb03, 0x0046, 0x0066, 0x0069],
  [0xfb04, 0x0046, 0x0066, 0x006c], [0xfb05, 0x0053, 0x0074, 0x0000], [0xfb06, 0x0053, 0x0074, 0x0000],
  [0xfb13, 0x0544, 0x0576, 0x0000], [0xfb14, 0x0544, 0x0565, 0x0000], [0xfb15, 0x0544, 0x056b, 0x0000],
  [0xfb16, 0x054e, 0x0576, 0x0000], [0xfb17, 0x0544, 0x056d, 0x0000],
  // `l2_luts[1].exceptions`: (0xdf95, ['S', 's', '\u{0}']) in plane 1.
  [0x1df95, 0x0053, 0x0073, 0x0000],
];

/** `c.to_titlecase()`, as the array of the chars the `ToTitlecase` iterator yields. */
export function to_titlecase(c: number): number[] {
  for (const [start, end, delta] of TITLECASE_SINGLES) {
    if (c >= start && c <= end) return [c + delta];
  }
  for (const [k, m0, m1, m2] of TITLECASE_MULTIS) {
    if (c === k) return m2 !== 0 ? [m0, m1, m2] : m1 !== 0 ? [m0, m1] : [m0];
  }
  return to_uppercase(c);
}

/** `Iterator::eq` over two case-mapping iterators. */
function chars_eq(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/** `s.chars()` */
function chars(s: string): number[] {
  const out: number[] = [];
  for (const c of s) out.push(c.codePointAt(0)!);
  return out;
}

/** `s.trim_matches('_')` */
function trim_underscores(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === "_") a++;
  while (b > a && s[b - 1] === "_") b--;
  return s.slice(a, b);
}

/// Some unicode characters *have* case, are considered upper, title, or lower case, but they *can't*
/// be title cased or lower cased. For the purposes of the lint suggestion, we care about being able
/// to change the char's case.
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:53 char_has_case
function char_has_case(c: number): boolean {
  return !chars_eq(to_lowercase(c), to_titlecase(c));
}

/// FIXME: we should add a more efficient version
/// in the stdlib for this
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:59 changes_when_titlecased
function changes_when_titlecased(c: number): boolean {
  return !chars_eq(to_titlecase(c), [c]);
}

// contains a capitalisable character followed by, or preceded by, an underscore,
// or contains an uppercase character that changes when titlecased,
// or contains `__`
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:66 not_camel_case
function not_camel_case(s: string): boolean {
  const UNDERSCORE = 0x5f;
  let last = 0; // '\0'
  return chars(s).some((snd) => {
    const fst = last;
    last = snd;
    if (fst === UNDERSCORE && snd === UNDERSCORE) return true;
    if (fst === UNDERSCORE && char_has_case(snd)) return true;
    if (snd === UNDERSCORE && char_has_case(fst)) return true;
    return is_uppercase(snd) && changes_when_titlecased(snd);
  });
}

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:79 is_upper_camel_case
function is_upper_camel_case(name_: string): boolean {
  const name = trim_underscores(name_);
  const first = chars(name)[0];
  if (first === undefined) {
    return true;
  }

  // some scripts don't have a concept of upper/lowercase
  return !(changes_when_titlecased(first) || not_camel_case(name));
}

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:89 to_upper_camel_case
function to_upper_camel_case(s: string): string {
  const SIGMA = 0x3a3; // 'Σ'
  const FINAL_SIGMA = 0x3c2; // 'ς'
  return trim_underscores(s)
    .split("_")
    .filter((component) => component.length !== 0)
    .map((component) => {
      let camel_cased_component: number[] = [];

      let new_word = true;
      let prev_is_lower_case = true;
      let prev_is_lowercased_sigma = false;

      for (const c of chars(component)) {
        // Preserve the case if an uppercase letter follows a lowercase letter, so that
        // `camelCase` is converted to `CamelCase`.
        if (prev_is_lower_case && (is_uppercase(c) || is_titlecase(c))) {
          new_word = true;
        }

        if (new_word) {
          camel_cased_component.push(...to_titlecase(c));
        } else {
          camel_cased_component.push(...to_lowercase(c));
        }

        prev_is_lower_case = is_lowercase(c) || is_titlecase(c);
        prev_is_lowercased_sigma = !new_word && c === SIGMA;
        new_word = false;
      }

      if (prev_is_lowercased_sigma) {
        camel_cased_component.pop();
        camel_cased_component.push(FINAL_SIGMA);
      }

      return String.fromCodePoint(...camel_cased_component);
    })
    .reduce<[string, string | undefined]>(
      ([acc, prev], next) => {
        // separate two components with an underscore if their boundary cannot
        // be distinguished using an uppercase/lowercase case distinction
        let join: boolean;
        if (prev !== undefined) {
          const pc = chars(prev);
          const l = pc[pc.length - 1]!;
          const f = chars(next)[0]!;
          join = !char_has_case(l) && !char_has_case(f);
        } else {
          join = false;
        }
        return [acc + (join ? "_" : "") + next, next];
      },
      ["", undefined],
    )[0];
}

// impl NonCamelCaseTypes
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:141 check_case
NonCamelCaseTypes.prototype.check_case = function (this: NonCamelCaseTypes, cx: EarlyContext, sort: string, ident: Ident): void {
  const name = Symbol.as_str(ident.name);

  if (!is_upper_camel_case(name)) {
    const cc = to_upper_camel_case(name);
    const sub: NonCamelCaseTypeSub = name !== cc ? { $: "Suggestion", span: ident.span, replace: cc } : { $: "Label", span: ident.span };
    cx.emit_span_lint(NON_CAMEL_CASE_TYPES, ident.span, NonCamelCaseType_diagnostic({ sort, name, sub }));
  }
};

// impl EarlyLintPass for NonCamelCaseTypes
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:161 check_item
NonCamelCaseTypes.prototype.check_item = function (this: NonCamelCaseTypes, cx: EarlyContext, it: ast.Item): void {
  const parsed = AttributeParser.parse_limited_sym(cx.sess(), it.attrs, [sym.repr]);
  const has_repr_c =
    parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "Repr" && parsed._0.reprs.some(([r, _]) => r.$ === "ReprC");

  if (has_repr_c) {
    return;
  }

  const kind = it.kind;
  switch (kind.$) {
    case "TyAlias":
      this.check_case(cx, "type", kind._0.ident);
      break;
    case "Enum":
    case "Struct":
    case "Union":
      this.check_case(cx, "type", kind._0);
      break;
    case "Trait":
      this.check_case(cx, "trait", kind._0.ident);
      break;
    case "TraitAlias":
      this.check_case(cx, "trait alias", kind._0.ident);
      break;

    // N.B. This check is only for inherent associated types, so that we don't lint against
    // trait impls where we should have warned for the trait definition already.
    case "Impl":
      if (kind._0.of_trait === undefined) {
        for (const it of kind._0.items) {
          // FIXME: this doesn't respect `#[allow(..)]` on the item itself.
          if (it.kind.$ === "Type") {
            const alias = it.kind._0;
            this.check_case(cx, "associated type", alias.ident);
          }
        }
      }
      break;
    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:195 check_trait_item
NonCamelCaseTypes.prototype.check_trait_item = function (this: NonCamelCaseTypes, cx: EarlyContext, it: ast.AssocItem): void {
  if (it.kind.$ === "Type") {
    const alias = it.kind._0;
    this.check_case(cx, "associated type", alias.ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:201 check_variant
NonCamelCaseTypes.prototype.check_variant = function (this: NonCamelCaseTypes, cx: EarlyContext, v: ast.Variant): void {
  this.check_case(cx, "variant", v.ident);
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:205 check_generic_param
NonCamelCaseTypes.prototype.check_generic_param = function (this: NonCamelCaseTypes, cx: EarlyContext, param: ast.GenericParam): void {
  if (param.kind.$ === "Type") {
    this.check_case(cx, "type parameter", param.ident);
  }
};

// impl LateLintPass for NonSnakeCase (nonstandard_style.rs:330)
unported_methods(NonSnakeCase.prototype, "rustc_lint::nonstandard_style::NonSnakeCase", ["check_mod", "check_generic_param", "check_fn", "check_item", "check_ty", "check_trait_item", "check_pat", "check_field_def"]);
// impl LateLintPass for NonUpperCaseGlobals (nonstandard_style.rs:584)
unported_methods(NonUpperCaseGlobals.prototype, "rustc_lint::nonstandard_style::NonUpperCaseGlobals", ["check_item", "check_trait_item", "check_impl_item", "check_pat", "check_generic_param"]);
