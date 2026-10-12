// Port of fluent-bundle 0.16.0, src/types/plural.rs.
import { Ok, type Result } from "../../../std/result.ts";
import { panic } from "../../../std/panic.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { negotiate_languages, NegotiationStrategy } from "../../fluent_langneg/lib.ts";
import type { Memoizable } from "../../intl_memoizer/lib.ts";
import { PluralRules as IntlPluralRules, type PluralRuleType } from "../../intl_pluralrules/lib.ts";
import { debug_LanguageIdentifierError, LanguageIdentifier } from "../../unic_langid/lib.ts";
import { TypeId } from "../../type_map/lib.ts";

export class PluralRules {
  constructor(public _0: IntlPluralRules) {}
}

/** `impl Memoizable for PluralRules` (`type Args = (PluralRuleType,); type Error = &'static str;`) */
export const PluralRules_Memoizable: Memoizable<PluralRules, [PluralRuleType], string> = {
  args_key: (args) => args[0],
  memoizer_cache: TypeId.new<Map<string, PluralRules>>("HashMap<(PluralRuleType,), fluent_bundle::types::plural::PluralRules>"),

  // crate: fluent-bundle-0.16.0/src/types/plural.rs:11 construct
  construct(lang: LanguageIdentifier, args: [PluralRuleType]): Result<PluralRules, string> {
    const default_lang_r = LanguageIdentifier.from_str("en");
    if (default_lang_r.$ === "Err") {
      return panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_LanguageIdentifierError(default_lang_r._0, PLAIN)}`);
    }
    const default_lang: LanguageIdentifier = default_lang_r._0;
    const negotiated = negotiate_languages(
      [lang],
      IntlPluralRules.get_locales(args[0]),
      default_lang,
      NegotiationStrategy.Lookup,
    );
    if (negotiated.length === 0) return panic("index out of bounds: the len is 0 but the index is 0");
    const pr_lang = negotiated[0]!.clone();
    const r = IntlPluralRules.create(pr_lang, args[0]);
    if (r.$ === "Err") return r;
    return Ok(new PluralRules(r._0));
  },
};
