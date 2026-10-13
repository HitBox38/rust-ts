// compiler/rustc_lint/src/non_ascii_idents.rs. The lint statics and the `declare_lint_pass!` expansion are generated
// (non_ascii_idents.lints.gen.ts). Uses the vendored unicode-security / unicode-script crates.
import type { ast } from "../rustc_ast/lib.ts";
import { OrdSpan, Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { GeneralSecurityProfile_char, is_potential_mixed_script_confusable_char, skeleton } from "../vendor/unicode_security/lib.ts";
import type { IdentifierType } from "../vendor/unicode_security/general_security_profile.ts";
import { AugmentedScriptSet, display_AugmentedScriptSet } from "../vendor/unicode_security/mixed_script.ts";
import type { EarlyContext } from "./context.ts";
import {
  ConfusableIdentifierPair_diagnostic,
  IdentifierNonAsciiChar_diagnostic,
  IdentifierUncommonCodepoints_diagnostic,
  MixedScriptConfusables_diagnostic,
} from "./diagnostics.gen.ts";
import {
  CONFUSABLE_IDENTS,
  MIXED_SCRIPT_CONFUSABLES,
  NON_ASCII_IDENTS,
  NonAsciiIdents,
  UNCOMMON_CODEPOINTS,
} from "./non_ascii_idents.lints.gen.ts";
import type { EarlyLintPass } from "./passes.ts";

export * from "./non_ascii_idents.lints.gen.ts";

declare module "./non_ascii_idents.lints.gen.ts" {
  interface NonAsciiIdents extends EarlyLintPass {}
}

/** `str::is_ascii` */
function is_ascii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

/** `s.chars()` */
function chars(s: string): number[] {
  const out: number[] = [];
  for (const c of s) out.push(c.codePointAt(0)!);
  return out;
}

/** `Vec::extract_if(.., pred).collect()`: removes the matching elements (in order) and returns them. */
function extract_if<T>(v: T[], pred: (x: T) => boolean): T[] {
  const out: T[] = [];
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    const x = v[r]!;
    if (pred(x)) out.push(x);
    else v[w++] = x;
  }
  v.length = w;
  return out;
}

// impl EarlyLintPass for NonAsciiIdents
// rustc: compiler/rustc_lint/src/non_ascii_idents.rs:155 check_crate
NonAsciiIdents.prototype.check_crate = function (this: NonAsciiIdents, cx: EarlyContext, _: ast.Crate): void {
  // use std::collections::BTreeMap;

  // use rustc_span::Span;
  // use unicode_security::GeneralSecurityProfile;

  const check_non_ascii_idents = !cx.builder.lint_level_spec(NON_ASCII_IDENTS).is_allow();
  const check_uncommon_codepoints = !cx.builder.lint_level_spec(UNCOMMON_CODEPOINTS).is_allow();
  const check_confusable_idents = !cx.builder.lint_level_spec(CONFUSABLE_IDENTS).is_allow();
  const check_mixed_script_confusables = !cx.builder.lint_level_spec(MIXED_SCRIPT_CONFUSABLES).is_allow();

  if (!check_non_ascii_idents && !check_uncommon_codepoints && !check_confusable_idents && !check_mixed_script_confusables) {
    return;
  }

  let has_non_ascii_idents = false;
  const symbols_ = cx.sess().psess.symbol_gallery.symbols;

  // Sort by `Span` so that error messages make sense with respect to the
  // order of identifier locations in the code.
  // We will soon sort, so the initial order does not matter.
  // #[allow(rustc::potential_query_instability)]
  // PORT: `sort_by_key` is stable; the initial order is the gallery's insertion order (`FxHashMap` iteration order in
  // rustc), which only matters for two symbols with equal `lo_hi`.
  const symbols: [Symbol, Span][] = [...symbols_];
  symbols.sort((a, b) => {
    const [a_lo, a_hi] = Span.lo_hi(a[1]);
    const [b_lo, b_hi] = Span.lo_hi(b[1]);
    return a_lo !== b_lo ? a_lo - b_lo : a_hi - b_hi;
  });
  for (const [symbol, sp] of symbols) {
    const symbol_str = Symbol.as_str(symbol);
    if (is_ascii(symbol_str)) {
      continue;
    }
    has_non_ascii_idents = true;
    cx.emit_span_lint(NON_ASCII_IDENTS, sp, IdentifierNonAsciiChar_diagnostic({}));
    if (check_uncommon_codepoints && !chars(symbol_str).every((c) => GeneralSecurityProfile_char.identifier_allowed(c))) {
      const chars_: [number, IdentifierType | undefined][] = chars(symbol_str).map((c) => [c, GeneralSecurityProfile_char.identifier_type(c)]);

      for (const [id_ty, id_ty_descr] of [
        ["Exclusion", "Exclusion"],
        ["Technical", "Technical"],
        ["Limited_Use", "Limited_Use"],
        ["Not_NFKC", "Not_NFKC"],
      ] as const) {
        const codepoints = extract_if(chars_, ([_, ty]) => ty === id_ty);
        if (codepoints.length === 0) {
          continue;
        }
        cx.emit_span_lint(
          UNCOMMON_CODEPOINTS,
          sp,
          IdentifierUncommonCodepoints_diagnostic({
            codepoints_len: codepoints.length,
            codepoints: codepoints.map(([c, _]) => c),
            identifier_type: id_ty_descr,
          }),
        );
      }

      const remaining = extract_if(chars_, ([c, _]) => !GeneralSecurityProfile_char.identifier_allowed(c));
      if (remaining.length !== 0) {
        cx.emit_span_lint(
          UNCOMMON_CODEPOINTS,
          sp,
          IdentifierUncommonCodepoints_diagnostic({
            codepoints_len: remaining.length,
            codepoints: remaining.map(([c, _]) => c),
            identifier_type: "Restricted",
          }),
        );
      }
    }
  }

  if (has_non_ascii_idents && check_confusable_idents) {
    const skeleton_map: Map<Symbol, [Symbol, Span, boolean]> = new Map();
    let skeleton_buf = "";

    for (const [symbol, sp] of symbols) {
      // use unicode_security::confusable_detection::skeleton;

      const symbol_str = Symbol.as_str(symbol);
      const is_ascii_ = is_ascii(symbol_str);

      // Get the skeleton as a `Symbol`.
      skeleton_buf = "";
      const it = skeleton(symbol_str);
      for (let c = it.next(); c !== undefined; c = it.next()) skeleton_buf += String.fromCodePoint(c);
      const skeleton_sym = symbol_str === skeleton_buf ? symbol : Symbol.intern(skeleton_buf);

      const existing = skeleton_map.get(skeleton_sym);
      if (existing !== undefined) {
        const [existing_symbol, existing_span, existing_is_ascii] = existing;
        if (!existing_is_ascii || !is_ascii_) {
          cx.emit_span_lint(
            CONFUSABLE_IDENTS,
            sp,
            ConfusableIdentifierPair_diagnostic({ existing_sym: existing_symbol, sym: symbol, label: existing_span, main_label: sp }),
          );
        }
        if (existing_is_ascii && !is_ascii_) {
          existing[0] = symbol;
          existing[1] = sp;
          existing[2] = is_ascii_;
        }
      } else {
        skeleton_map.set(skeleton_sym, [symbol, sp, is_ascii_]);
      }
    }
  }

  if (has_non_ascii_idents && check_mixed_script_confusables) {
    // use unicode_security::is_potential_mixed_script_confusable_char;
    // use unicode_security::mixed_script::AugmentedScriptSet;

    // #[derive(Clone)]
    type ScriptSetUsage = { $: "Suspicious"; _0: number[]; _1: Span } | { $: "Verified" };

    // PORT: `FxIndexMap<AugmentedScriptSet, ScriptSetUsage>` → insertion-ordered `Map` keyed by `hash_key()`.
    const script_states: Map<string, [AugmentedScriptSet, ScriptSetUsage]> = new Map();
    const latin_augmented_script_set = AugmentedScriptSet.for_char(0x41 /* 'A' */);
    script_states.set(latin_augmented_script_set.hash_key(), [latin_augmented_script_set, { $: "Verified" }]);

    let has_suspicious = false;
    for (const [symbol, sp] of symbols) {
      const symbol_str = Symbol.as_str(symbol);
      for (const ch of chars(symbol_str)) {
        if (ch < 0x80) {
          // all ascii characters are covered by exception.
          continue;
        }
        if (!GeneralSecurityProfile_char.identifier_allowed(ch)) {
          // this character is covered by `uncommon_codepoints` lint.
          continue;
        }
        const augmented_script_set = AugmentedScriptSet.for_char(ch);
        const key = augmented_script_set.hash_key();
        const entry = script_states.get(key);
        if (entry !== undefined) {
          const existing_state = entry[1];
          if (existing_state.$ === "Suspicious") {
            const ch_list = existing_state._0;
            if (is_potential_mixed_script_confusable_char(ch)) {
              ch_list.push(ch);
            } else {
              entry[1] = { $: "Verified" };
            }
          }
        } else {
          let state: ScriptSetUsage;
          if (!is_potential_mixed_script_confusable_char(ch)) {
            state = { $: "Verified" };
          } else {
            has_suspicious = true;
            state = { $: "Suspicious", _0: [ch], _1: sp };
          }
          script_states.set(key, [augmented_script_set, state]);
        }
      }
    }

    if (has_suspicious) {
      // The end result is put in `lint_reports` which is sorted.
      // #[allow(rustc::potential_query_instability)]
      const verified_augmented_script_sets: AugmentedScriptSet[] = [];
      for (const [k, v] of script_states.values()) {
        if (v.$ === "Verified") verified_augmented_script_sets.push(k);
      }

      // we're sorting the output here.
      // PORT: `BTreeMap<(OrdSpan, Vec<char>), AugmentedScriptSet>` → entries kept unique by key, sorted at the end.
      const lint_reports: [[OrdSpan, number[]], AugmentedScriptSet][] = [];

      // The end result is put in `lint_reports` which is sorted.
      // #[allow(rustc::potential_query_instability)]
      outerloop: for (const [augment_script_set, usage] of script_states.values()) {
        if (usage.$ !== "Suspicious") continue;
        const ch_list = [...usage._0];
        const sp = usage._1;

        if (augment_script_set.is_all()) {
          continue;
        }

        for (const existing of verified_augmented_script_sets) {
          if (existing.is_all()) {
            continue;
          }
          const intersect = existing.clone();
          intersect.intersect_with(augment_script_set);
          if (!intersect.is_empty() && !intersect.is_all()) {
            continue outerloop;
          }
        }

        // We sort primitive chars here and can use unstable sort
        ch_list.sort((a, b) => a - b);
        const deduped = ch_list.filter((c, i) => i === 0 || c !== ch_list[i - 1]);
        const key: [OrdSpan, number[]] = [new OrdSpan(sp), deduped];
        const at = lint_reports.findIndex(([k]) => k[0].eq(key[0]) && cmp_chars(k[1], key[1]) === 0);
        if (at >= 0) lint_reports[at]![1] = augment_script_set;
        else lint_reports.push([key, augment_script_set]);
      }
      lint_reports.sort(([a], [b]) => a[0].cmp(b[0]) || cmp_chars(a[1], b[1]));

      for (const [[sp, ch_list], script_set] of lint_reports) {
        let includes = "";
        for (const [idx, ch] of ch_list.entries()) {
          if (idx !== 0) {
            includes += ", ";
          }
          const char_info = `'${String.fromCodePoint(ch)}' (U+${ch.toString(16).toUpperCase().padStart(4, "0")})`;
          includes += char_info;
        }
        cx.emit_span_lint(MIXED_SCRIPT_CONFUSABLES, sp._0, MixedScriptConfusables_diagnostic({ set: display_AugmentedScriptSet(script_set), includes }));
      }
    }
  }
};

/** `Ord` of `Vec<char>` (lexicographic). */
function cmp_chars(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
