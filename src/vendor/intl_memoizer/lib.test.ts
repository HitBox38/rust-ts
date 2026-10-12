// Port of the `#[cfg(test)] mod tests` in intl-memoizer 0.5.3 `src/lib.rs`, plus its two doc
// examples (`IntlLangMemoizer`, `IntlMemoizer`).
import { expect, test } from "bun:test";
import { Err, Ok, type Result } from "../../std/result.ts";
import { negotiate_languages, NegotiationStrategy } from "../fluent_langneg/lib.ts";
import { PluralCategory, PluralRuleType, PluralRules as IntlPluralRules } from "../intl_pluralrules/lib.ts";
import { PluralOperands } from "../intl_pluralrules/operands.ts";
import { TypeId } from "../type_map/lib.ts";
import { display_LanguageIdentifier, LanguageIdentifier } from "../unic_langid/lib.ts";
import { concurrent, IntlLangMemoizer, IntlMemoizer, type Memoizable } from "./lib.ts";

function parse(s: string): LanguageIdentifier {
  const r = LanguageIdentifier.from_str(s);
  if (r.$ === "Err") throw new Error("parse");
  return r._0;
}

class PluralRules {
  constructor(public _0: IntlPluralRules) {}

  // crate: intl-memoizer-0.5.3/src/lib.rs:363 new
  static new(lang: LanguageIdentifier, pr_type: PluralRuleType): Result<PluralRules, string> {
    const default_lang = parse("en");
    const pr_lang = negotiate_languages([lang], IntlPluralRules.get_locales(pr_type), default_lang, NegotiationStrategy.Lookup)[0]!.clone();

    const r = IntlPluralRules.create(pr_lang, pr_type);
    if (r.$ === "Err") return r;
    return Ok(new PluralRules(r._0));
  }
}

const PluralRules_Memoizable: Memoizable<PluralRules, [PluralRuleType], string> = {
  args_key: (a) => a[0],
  memoizer_cache: TypeId.new("HashMap<(PluralRuleType,), PluralRules>"),
  // crate: intl-memoizer-0.5.3/src/lib.rs:383 construct
  construct(lang: LanguageIdentifier, args: [PluralRuleType]): Result<PluralRules, string> {
    return PluralRules.new(lang, args[0]);
  },
};

const select5 = (cb: PluralRules) => cb._0.select(5, PluralOperands.try_from_signed);

// crate: intl-memoizer-0.5.3/src/lib.rs:389 test_single_thread
test("test_single_thread", () => {
  const lang = parse("en");

  const memoizer = IntlMemoizer.default();
  {
    const en_memoizer = memoizer.get_for_lang(lang.clone());

    const result = en_memoizer.with_try_get(PluralRules_Memoizable, [PluralRuleType.CARDINAL], select5);
    expect(result).toEqual(Ok(Ok(PluralCategory.OTHER)));
  }

  {
    const en_memoizer = memoizer.get_for_lang(lang);

    const result = en_memoizer.with_try_get(PluralRules_Memoizable, [PluralRuleType.CARDINAL], select5);
    expect(result).toEqual(Ok(Ok(PluralCategory.OTHER)));
  }
});

// crate: intl-memoizer-0.5.3/src/lib.rs:413 test_concurrent
test("test_concurrent", () => {
  const lang = parse("en");
  const memoizer = concurrent.IntlLangMemoizer.new(lang);
  const results: Result<PluralCategory, string>[] = [];

  // Spawn four threads that all use the PluralRules.
  // PORT: no threads; the four calls run one after another.
  for (let i = 0; i < 4; i++) {
    const r = memoizer.with_try_get(PluralRules_Memoizable, [PluralRuleType.CARDINAL], select5);
    if (r.$ === "Err") throw new Error("Failed to get a PluralRules result.");
    results.push(r._0);
  }

  for (const result of results) {
    expect(result).toEqual(Ok(PluralCategory.OTHER));
  }
});

// Doc examples: an `ExampleFormatter` counting its constructions.
let INTL_EXAMPLE_CONSTRUCTS = 0;
class ExampleFormatter {
  constructor(
    public lang: LanguageIdentifier,
    public prefix: string,
  ) {}
  format(example_string: string): string {
    return `${this.prefix} lang(${display_LanguageIdentifier(this.lang)}) string(${example_string})`;
  }
}
const ExampleFormatter_Memoizable: Memoizable<ExampleFormatter, [string], null> = {
  args_key: (a) => a[0],
  memoizer_cache: TypeId.new("HashMap<(String,), ExampleFormatter>"),
  construct(lang, args) {
    INTL_EXAMPLE_CONSTRUCTS += 1;
    return Ok(new ExampleFormatter(lang, args[0]));
  },
};

test("doc example: IntlLangMemoizer", () => {
  INTL_EXAMPLE_CONSTRUCTS = 0;
  const memoizer = IntlLangMemoizer.new(parse("en-US"));
  let construct_args: [string] = ["prefix:"];
  const message1 = "The format operation will run";
  const message2 = "ExampleFormatter will be re-used, when a second format is run";

  let result1 = memoizer.with_try_get(ExampleFormatter_Memoizable, construct_args, (i) => i.format(message1));
  let result2 = memoizer.with_try_get(ExampleFormatter_Memoizable, construct_args, (i) => i.format(message2));
  expect(result1).toEqual(Ok("prefix: lang(en-US) string(The format operation will run)"));
  expect(result2).toEqual(Ok("prefix: lang(en-US) string(ExampleFormatter will be re-used, when a second format is run)"));
  expect(INTL_EXAMPLE_CONSTRUCTS).toBe(1);

  construct_args = ["re-init:"];
  result1 = memoizer.with_try_get(ExampleFormatter_Memoizable, construct_args, (i) => i.format(message1));
  result2 = memoizer.with_try_get(ExampleFormatter_Memoizable, construct_args, (i) => i.format(message2));
  expect(result1).toEqual(Ok("re-init: lang(en-US) string(The format operation will run)"));
  expect(result2).toEqual(Ok("re-init: lang(en-US) string(ExampleFormatter will be re-used, when a second format is run)"));
  expect(INTL_EXAMPLE_CONSTRUCTS).toBe(2);
});

test("doc example: IntlMemoizer", () => {
  const memoizer = IntlMemoizer.default();
  const en_us_memoizer = memoizer.get_for_lang(parse("en-US"));
  const construct_args: [string] = ["prefix:"];
  const message = "The format operation will run";
  const en_us_result = en_us_memoizer.with_try_get(ExampleFormatter_Memoizable, construct_args, (i) => i.format(message));
  expect(en_us_result).toEqual(Ok("prefix: lang(en-US) string(The format operation will run)"));

  const de_de_memoizer = memoizer.get_for_lang(parse("de-DE"));
  const de_de_result = de_de_memoizer.with_try_get(ExampleFormatter_Memoizable, construct_args, (i) => i.format(message));
  expect(de_de_result).toEqual(Ok("prefix: lang(de-DE) string(The format operation will run)"));
  // A live memoizer is handed out again for the same language.
  expect(memoizer.get_for_lang(parse("en-US"))).toBe(en_us_memoizer);
});

test("reentrant use panics like the RefCell borrow", () => {
  const memoizer = IntlLangMemoizer.new(parse("en"));
  expect(() =>
    memoizer.with_try_get(ExampleFormatter_Memoizable, ["a"], () =>
      memoizer.with_try_get(ExampleFormatter_Memoizable, ["b"], () => 0),
    ),
  ).toThrow("Cannot use memoizer reentrantly: BorrowMutError");
  // The borrow is released after the panic.
  expect(memoizer.with_try_get(ExampleFormatter_Memoizable, ["c"], () => 1)).toEqual(Ok(1));
  void Err;
});
