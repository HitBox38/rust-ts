// Port of fluent-langneg 0.13.1, src/negotiate/likely_subtags.rs (compiled when the `cldr`
// feature is off, as in rustc's build).
import { PLAIN } from "../../../std/fmt.ts";
import { panic } from "../../../std/panic.ts";
import {
  debug_LanguageIdentifierError,
  display_LanguageIdentifier,
  LanguageIdentifier,
  subtags,
} from "../../unic_langid/lib.ts";
import { debug_ParserError } from "../../unic_langid_impl/parser/errors.ts";

const REGION_MATCHING_KEYS: readonly string[] = [
  "az", "bg", "cs", "de", "es", "fi", "fr", "hu", "it", "lt", "lv", "nl", "pl", "ro", "ru",
];

/** `pub trait MockLikelySubtags` */
export interface MockLikelySubtags {
  // crate: fluent-langneg-0.13.1/src/negotiate/likely_subtags.rs:8 maximize
  maximize(self: LanguageIdentifier): boolean;
}

/** `impl MockLikelySubtags for LanguageIdentifier` (`&mut self` → the object is mutated). */
export const MockLikelySubtags: MockLikelySubtags = {
  // crate: fluent-langneg-0.13.1/src/negotiate/likely_subtags.rs:12 maximize
  maximize(self: LanguageIdentifier): boolean {
    let extended: string;
    switch (display_LanguageIdentifier(self)) {
      case "en":
        extended = "en-Latn-US";
        break;
      case "fr":
        extended = "fr-Latn-FR";
        break;
      case "sr":
        extended = "sr-Cyrl-SR";
        break;
      case "sr-RU":
        extended = "sr-Latn-SR";
        break;
      case "az-IR":
        extended = "az-Arab-IR";
        break;
      case "zh-GB":
        extended = "zh-Hant-GB";
        break;
      case "zh-US":
        extended = "zh-Hant-US";
        break;
      default: {
        const lang = self.language;

        for (const subtag of REGION_MATCHING_KEYS) {
          if (lang.eq_str(subtag)) {
            const r = subtags.Region.from_str(subtag);
            if (r.$ === "Err") return panic(`called \`Result::unwrap()\` on an \`Err\` value: ${debug_ParserError(r._0)}`);
            self.region = r._0;
            return true;
          }
        }
        return false;
      }
    }
    const langid_r = LanguageIdentifier.from_str(extended);
    if (langid_r.$ === "Err") {
      return panic(`Failed to parse langid.: ${debug_LanguageIdentifierError(langid_r._0, PLAIN)}`);
    }
    const langid = langid_r._0;
    self.language = langid.language;
    self.script = langid.script;
    self.region = langid.region;
    return true;
  },
};
