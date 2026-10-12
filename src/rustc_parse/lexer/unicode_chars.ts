// Port of compiler/rustc_parse/src/lexer/unicode_chars.rs
//! Characters and their corresponding confusables were collected from
//! <https://www.unicode.org/Public/security/10.0.0/confusables.txt>

import { token } from "../../rustc_ast/lib.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import { kw } from "../../rustc_span/symbol.ts";
import { len_utf8 } from "../../std/char.ts";
import type { Str } from "../../std/str.ts";
import type { TokenSubstitution } from "../diagnostics.ts";
import type { Lexer } from "./mod.ts";

// #[rustfmt::skip] // for line breaks
// PORT: `(char, &str, &str)` rows; the char is written as its code point (several are invisible).
export const UNICODE_ARRAY: readonly (readonly [number, string, string])[] = [
  [0x2028, "Line Separator", " "],
  [0x2029, "Paragraph Separator", " "],
  [0x1680, "Ogham Space mark", " "],
  [0x2000, "En Quad", " "],
  [0x2001, "Em Quad", " "],
  [0x2002, "En Space", " "],
  [0x2003, "Em Space", " "],
  [0x2004, "Three-Per-Em Space", " "],
  [0x2005, "Four-Per-Em Space", " "],
  [0x2006, "Six-Per-Em Space", " "],
  [0x2008, "Punctuation Space", " "],
  [0x2009, "Thin Space", " "],
  [0x200A, "Hair Space", " "],
  [0x205F, "Medium Mathematical Space", " "],
  [0x00A0, "No-Break Space", " "],
  [0x2007, "Figure Space", " "],
  [0x202F, "Narrow No-Break Space", " "],
  [0x3000, "Ideographic Space", " "],

  [0x07FA, "Nko Lajanyalan", "_"],
  [0xFE4D, "Dashed Low Line", "_"],
  [0xFE4E, "Centreline Low Line", "_"],
  [0xFE4F, "Wavy Low Line", "_"],
  [0xFF3F, "Fullwidth Low Line", "_"],

  [0x2010, "Hyphen", "-"],
  [0x2011, "Non-Breaking Hyphen", "-"],
  [0x2012, "Figure Dash", "-"],
  [0x2013, "En Dash", "-"],
  [0x2014, "Em Dash", "-"],
  [0xFE58, "Small Em Dash", "-"],
  [0x06D4, "Arabic Full Stop", "-"],
  [0x2043, "Hyphen Bullet", "-"],
  [0x02D7, "Modifier Letter Minus Sign", "-"],
  [0x2212, "Minus Sign", "-"],
  [0x2796, "Heavy Minus Sign", "-"],
  [0x2CBA, "Coptic Letter Dialect-P Ni", "-"],
  [0x30FC, "Katakana-Hiragana Prolonged Sound Mark", "-"],
  [0xFF0D, "Fullwidth Hyphen-Minus", "-"],
  [0x2015, "Horizontal Bar", "-"],
  [0x2500, "Box Drawings Light Horizontal", "-"],
  [0x2501, "Box Drawings Heavy Horizontal", "-"],
  [0x31D0, "CJK Stroke H", "-"],
  [0xA7F7, "Latin Epigraphic Letter Sideways I", "-"],
  [0x1173, "Hangul Jungseong Eu", "-"],
  [0x3161, "Hangul Letter Eu", "-"],
  [0x4E00, "CJK Unified Ideograph-4E00", "-"],
  [0x2F00, "Kangxi Radical One", "-"],

  [0x060D, "Arabic Date Separator", ","],
  [0x066B, "Arabic Decimal Separator", ","],
  [0x201A, "Single Low-9 Quotation Mark", ","],
  [0x00B8, "Cedilla", ","],
  [0xA4F9, "Lisu Letter Tone Na Po", ","],
  [0xFF0C, "Fullwidth Comma", ","],

  [0x037E, "Greek Question Mark", ";"],
  [0xFF1B, "Fullwidth Semicolon", ";"],
  [0xFE14, "Presentation Form For Vertical Semicolon", ";"],

  [0x0903, "Devanagari Sign Visarga", ":"],
  [0x0A83, "Gujarati Sign Visarga", ":"],
  [0xFF1A, "Fullwidth Colon", ":"],
  [0x0589, "Armenian Full Stop", ":"],
  [0x0703, "Syriac Supralinear Colon", ":"],
  [0x0704, "Syriac Sublinear Colon", ":"],
  [0x16EC, "Runic Multiple Punctuation", ":"],
  [0xFE30, "Presentation Form For Vertical Two Dot Leader", ":"],
  [0x1803, "Mongolian Full Stop", ":"],
  [0x1809, "Mongolian Manchu Full Stop", ":"],
  [0x205A, "Two Dot Punctuation", ":"],
  [0x05C3, "Hebrew Punctuation Sof Pasuq", ":"],
  [0x02F8, "Modifier Letter Raised Colon", ":"],
  [0xA789, "Modifier Letter Colon", ":"],
  [0x2236, "Ratio", ":"],
  [0x02D0, "Modifier Letter Triangular Colon", ":"],
  [0xA4FD, "Lisu Letter Tone Mya Jeu", ":"],
  [0xFE13, "Presentation Form For Vertical Colon", ":"],

  [0xFF01, "Fullwidth Exclamation Mark", "!"],
  [0x01C3, "Latin Letter Retroflex Click", "!"],
  [0x2D51, "Tifinagh Letter Tuareg Yang", "!"],
  [0xFE15, "Presentation Form For Vertical Exclamation Mark", "!"],

  [0x0294, "Latin Letter Glottal Stop", "?"],
  [0x0241, "Latin Capital Letter Glottal Stop", "?"],
  [0x097D, "Devanagari Letter Glottal Stop", "?"],
  [0x13AE, "Cherokee Letter He", "?"],
  [0xA6EB, "Bamum Letter Ntuu", "?"],
  [0xFF1F, "Fullwidth Question Mark", "?"],
  [0xFE16, "Presentation Form For Vertical Question Mark", "?"],

  [0x1D16D, "Musical Symbol Combining Augmentation Dot", "."],
  [0x2024, "One Dot Leader", "."],
  [0x0701, "Syriac Supralinear Full Stop", "."],
  [0x0702, "Syriac Sublinear Full Stop", "."],
  [0xA60E, "Vai Full Stop", "."],
  [0x10A50, "Kharoshthi Punctuation Dot", "."],
  [0x0660, "Arabic-Indic Digit Zero", "."],
  [0x06F0, "Extended Arabic-Indic Digit Zero", "."],
  [0xA4F8, "Lisu Letter Tone Mya Ti", "."],
  [0x00B7, "Middle Dot", "."],
  [0x30FB, "Katakana Middle Dot", "."],
  [0xFF65, "Halfwidth Katakana Middle Dot", "."],
  [0x16EB, "Runic Single Punctuation", "."],
  [0x0387, "Greek Ano Teleia", "."],
  [0x2E31, "Word Separator Middle Dot", "."],
  [0x10101, "Aegean Word Separator Dot", "."],
  [0x2022, "Bullet", "."],
  [0x2027, "Hyphenation Point", "."],
  [0x2219, "Bullet Operator", "."],
  [0x22C5, "Dot Operator", "."],
  [0xA78F, "Latin Letter Sinological Dot", "."],
  [0x1427, "Canadian Syllabics Final Middle Dot", "."],
  [0x1427, "Canadian Syllabics Final Middle Dot", "."],
  [0xFF0E, "Fullwidth Full Stop", "."],
  [0x3002, "Ideographic Full Stop", "."],
  [0xFE12, "Presentation Form For Vertical Ideographic Full Stop", "."],

  [0x055D, "Armenian Comma", "'"],
  [0xFF07, "Fullwidth Apostrophe", "'"],
  [0x2018, "Left Single Quotation Mark", "'"],
  [0x2019, "Right Single Quotation Mark", "'"],
  [0x201B, "Single High-Reversed-9 Quotation Mark", "'"],
  [0x2032, "Prime", "'"],
  [0x2035, "Reversed Prime", "'"],
  [0x055A, "Armenian Apostrophe", "'"],
  [0x05F3, "Hebrew Punctuation Geresh", "'"],
  [0x0060, "Grave Accent", "'"],
  [0x1FEF, "Greek Varia", "'"],
  [0xFF40, "Fullwidth Grave Accent", "'"],
  [0x00B4, "Acute Accent", "'"],
  [0x0384, "Greek Tonos", "'"],
  [0x1FFD, "Greek Oxia", "'"],
  [0x1FBD, "Greek Koronis", "'"],
  [0x1FBF, "Greek Psili", "'"],
  [0x1FFE, "Greek Dasia", "'"],
  [0x02B9, "Modifier Letter Prime", "'"],
  [0x0374, "Greek Numeral Sign", "'"],
  [0x02C8, "Modifier Letter Vertical Line", "'"],
  [0x02CA, "Modifier Letter Acute Accent", "'"],
  [0x02CB, "Modifier Letter Grave Accent", "'"],
  [0x02F4, "Modifier Letter Middle Grave Accent", "'"],
  [0x02BB, "Modifier Letter Turned Comma", "'"],
  [0x02BD, "Modifier Letter Reversed Comma", "'"],
  [0x02BC, "Modifier Letter Apostrophe", "'"],
  [0x02BE, "Modifier Letter Right Half Ring", "'"],
  [0xA78C, "Latin Small Letter Saltillo", "'"],
  [0x05D9, "Hebrew Letter Yod", "'"],
  [0x07F4, "Nko High Tone Apostrophe", "'"],
  [0x07F5, "Nko Low Tone Apostrophe", "'"],
  [0x144A, "Canadian Syllabics West-Cree P", "'"],
  [0x16CC, "Runic Letter Short-Twig-Sol S", "'"],
  [0x16F51, "Miao Sign Aspiration", "'"],
  [0x16F52, "Miao Sign Reformed Voicing", "'"],

  [0x1CD3, "Vedic Sign Nihshvasa", "\""],
  [0xFF02, "Fullwidth Quotation Mark", "\""],
  [0x201C, "Left Double Quotation Mark", "\""],
  [0x201D, "Right Double Quotation Mark", "\""],
  [0x201F, "Double High-Reversed-9 Quotation Mark", "\""],
  [0x2033, "Double Prime", "\""],
  [0x2036, "Reversed Double Prime", "\""],
  [0x3003, "Ditto Mark", "\""],
  [0x05F4, "Hebrew Punctuation Gershayim", "\""],
  [0x02DD, "Double Acute Accent", "\""],
  [0x02BA, "Modifier Letter Double Prime", "\""],
  [0x02F6, "Modifier Letter Middle Double Acute Accent", "\""],
  [0x02F5, "Modifier Letter Middle Double Grave Accent", "\""],
  [0x02EE, "Modifier Letter Double Apostrophe", "\""],
  [0x05F2, "Hebrew Ligature Yiddish Double Yod", "\""],
  [0x275E, "Heavy Double Comma Quotation Mark Ornament", "\""],
  [0x275D, "Heavy Double Turned Comma Quotation Mark Ornament", "\""],

  [0xFF08, "Fullwidth Left Parenthesis", "("],
  [0x2768, "Medium Left Parenthesis Ornament", "("],
  [0xFD3E, "Ornate Left Parenthesis", "("],

  [0xFF09, "Fullwidth Right Parenthesis", ")"],
  [0x2769, "Medium Right Parenthesis Ornament", ")"],
  [0xFD3F, "Ornate Right Parenthesis", ")"],

  [0xFF3B, "Fullwidth Left Square Bracket", "["],
  [0x2772, "Light Left Tortoise Shell Bracket Ornament", "["],
  [0x300C, "Left Corner Bracket", "["],
  [0x300E, "Left White Corner Bracket", "["],
  [0x3010, "Left Black Lenticular Bracket", "["],
  [0x3014, "Left Tortoise Shell Bracket", "["],
  [0x3016, "Left White Lenticular Bracket", "["],
  [0x3018, "Left White Tortoise Shell Bracket", "["],
  [0x301A, "Left White Square Bracket", "["],

  [0xFF3D, "Fullwidth Right Square Bracket", "]"],
  [0x2773, "Light Right Tortoise Shell Bracket Ornament", "]"],
  [0x300D, "Right Corner Bracket", "]"],
  [0x300F, "Right White Corner Bracket", "]"],
  [0x3011, "Right Black Lenticular Bracket", "]"],
  [0x3015, "Right Tortoise Shell Bracket", "]"],
  [0x3017, "Right White Lenticular Bracket", "]"],
  [0x3019, "Right White Tortoise Shell Bracket", "]"],
  [0x301B, "Right White Square Bracket", "]"],

  [0x2774, "Medium Left Curly Bracket Ornament", "{"],
  [0x1D114, "Musical Symbol Brace", "{"],
  [0xFF5B, "Fullwidth Left Curly Bracket", "{"],

  [0x2775, "Medium Right Curly Bracket Ornament", "}"],
  [0xFF5D, "Fullwidth Right Curly Bracket", "}"],

  [0x204E, "Low Asterisk", "*"],
  [0x066D, "Arabic Five Pointed Star", "*"],
  [0x2217, "Asterisk Operator", "*"],
  [0x1031F, "Old Italic Letter Ess", "*"],
  [0xFF0A, "Fullwidth Asterisk", "*"],

  [0x1735, "Philippine Single Punctuation", "/"],
  [0x2041, "Caret Insertion Point", "/"],
  [0x2215, "Division Slash", "/"],
  [0x2044, "Fraction Slash", "/"],
  [0x2571, "Box Drawings Light Diagonal Upper Right To Lower Left", "/"],
  [0x27CB, "Mathematical Rising Diagonal", "/"],
  [0x29F8, "Big Solidus", "/"],
  [0x1D23A, "Greek Instrumental Notation Symbol-47", "/"],
  [0x31D3, "CJK Stroke Sp", "/"],
  [0x3033, "Vertical Kana Repeat Mark Upper Half", "/"],
  [0x2CC6, "Coptic Capital Letter Old Coptic Esh", "/"],
  [0x30CE, "Katakana Letter No", "/"],
  [0x4E3F, "CJK Unified Ideograph-4E3F", "/"],
  [0x2F03, "Kangxi Radical Slash", "/"],
  [0xFF0F, "Fullwidth Solidus", "/"],

  [0xFF3C, "Fullwidth Reverse Solidus", "\\"],
  [0xFE68, "Small Reverse Solidus", "\\"],
  [0x2216, "Set Minus", "\\"],
  [0x27CD, "Mathematical Falling Diagonal", "\\"],
  [0x29F5, "Reverse Solidus Operator", "\\"],
  [0x29F9, "Big Reverse Solidus", "\\"],
  [0x29F9, "Greek Vocal Notation Symbol-16", "\\"],
  [0x29F9, "Greek Instrumental Symbol-48", "\\"],
  [0x31D4, "CJK Stroke D", "\\"],
  [0x4E36, "CJK Unified Ideograph-4E36", "\\"],
  [0x2F02, "Kangxi Radical Dot", "\\"],
  [0x3001, "Ideographic Comma", "\\"],
  [0x30FD, "Katakana Iteration Mark", "\\"],

  [0xA778, "Latin Small Letter Um", "&"],
  [0xFF06, "Fullwidth Ampersand", "&"],

  [0x16ED, "Runic Cross Punctuation", "+"],
  [0x2795, "Heavy Plus Sign", "+"],
  [0x1029B, "Lycian Letter H", "+"],
  [0xFB29, "Hebrew Letter Alternative Plus Sign", "+"],
  [0xFF0B, "Fullwidth Plus Sign", "+"],

  [0x2039, "Single Left-Pointing Angle Quotation Mark", "<"],
  [0x276E, "Heavy Left-Pointing Angle Quotation Mark Ornament", "<"],
  [0x02C2, "Modifier Letter Left Arrowhead", "<"],
  [0x1D236, "Greek Instrumental Symbol-40", "<"],
  [0x1438, "Canadian Syllabics Pa", "<"],
  [0x16B2, "Runic Letter Kauna", "<"],
  [0x276C, "Medium Left-Pointing Angle Bracket Ornament", "<"],
  [0x27E8, "Mathematical Left Angle Bracket", "<"],
  [0x2329, "Left-Pointing Angle Bracket", "<"],
  [0x3008, "Left Angle Bracket", "<"],
  [0x31DB, "CJK Stroke Pd", "<"],
  [0x304F, "Hiragana Letter Ku", "<"],
  [0x21FE8, "CJK Unified Ideograph-21FE8", "<"],
  [0x300A, "Left Double Angle Bracket", "<"],
  [0xFF1C, "Fullwidth Less-Than Sign", "<"],

  [0x1400, "Canadian Syllabics Hyphen", "="],
  [0x2E40, "Double Hyphen", "="],
  [0x30A0, "Katakana-Hiragana Double Hyphen", "="],
  [0xA4FF, "Lisu Punctuation Full Stop", "="],
  [0xFF1D, "Fullwidth Equals Sign", "="],

  [0x203A, "Single Right-Pointing Angle Quotation Mark", ">"],
  [0x276F, "Heavy Right-Pointing Angle Quotation Mark Ornament", ">"],
  [0x02C3, "Modifier Letter Right Arrowhead", ">"],
  [0x1D237, "Greek Instrumental Symbol-42", ">"],
  [0x1433, "Canadian Syllabics Po", ">"],
  [0x16F3F, "Miao Letter Archaic Zza", ">"],
  [0x276D, "Medium Right-Pointing Angle Bracket Ornament", ">"],
  [0x27E9, "Mathematical Right Angle Bracket", ">"],
  [0x232A, "Right-Pointing Angle Bracket", ">"],
  [0x3009, "Right Angle Bracket", ">"],
  [0x300B, "Right Double Angle Bracket", ">"],
  [0xFF1E, "Fullwidth Greater-Than Sign", ">"],

  [0x2A75, "Two Consecutive Equals Signs", "=="],
];

// FIXME: the lexer could be used to turn the ASCII version of unicode homoglyphs, instead of
// keeping the substitution token in this table. Ideally, this should be inside `rustc_lexer`.
// However, we should first remove compound tokens like `<<` from `rustc_lexer`, and then add
// fancier error recovery to it, as there will be less overall work to do this way.
const ASCII_ARRAY: readonly (readonly [string, string, token.TokenKind | undefined])[] = [
  [" ", "Space", undefined],
  ["_", "Underscore", { $: "Ident", _0: kw.Underscore, _1: token.IdentKind.Normal }],
  ["-", "Minus/Hyphen", token.TokenKind.Minus],
  [",", "Comma", token.TokenKind.Comma],
  [";", "Semicolon", token.TokenKind.Semi],
  [":", "Colon", token.TokenKind.Colon],
  ["!", "Exclamation Mark", token.TokenKind.Bang],
  ["?", "Question Mark", token.TokenKind.Question],
  [".", "Period", token.TokenKind.Dot],
  ["(", "Left Parenthesis", token.TokenKind.OpenParen],
  [")", "Right Parenthesis", token.TokenKind.CloseParen],
  ["[", "Left Square Bracket", token.TokenKind.OpenBracket],
  ["]", "Right Square Bracket", token.TokenKind.CloseBracket],
  ["{", "Left Curly Brace", token.TokenKind.OpenBrace],
  ["}", "Right Curly Brace", token.TokenKind.CloseBrace],
  ["*", "Asterisk", token.TokenKind.Star],
  ["/", "Slash", token.TokenKind.Slash],
  ["\\", "Backslash", undefined],
  ["&", "Ampersand", token.TokenKind.And],
  ["+", "Plus Sign", token.TokenKind.Plus],
  ["<", "Less-Than Sign", token.TokenKind.Lt],
  ["=", "Equals Sign", token.TokenKind.Eq],
  ["==", "Double Equals Sign", token.TokenKind.EqEq],
  [">", "Greater-Than Sign", token.TokenKind.Gt],
  // FIXME: Literals are already lexed by this point, so we can't recover gracefully just by
  // spitting the correct token out.
  ["'", "Single Quote", undefined],
  ["\"", "Quotation Mark", undefined],
];

const C_LEFT_DOUBLE_QUOTE = 0x201c; // '“'
const C_RIGHT_DOUBLE_QUOTE = 0x201d; // '”'

// rustc: compiler/rustc_parse/src/lexer/unicode_chars.rs:339 check_for_substitution
export function check_for_substitution(
  lexer: Lexer,
  pos: BytePos,
  ch: number,
  count: number,
): [token.TokenKind | undefined, TokenSubstitution | undefined] {
  const found = UNICODE_ARRAY.find(([c, _, __]) => c === ch);
  if (found === undefined) {
    return [undefined, undefined];
  }
  const [, u_name, ascii_str] = found;

  const span = Span.with_root_ctxt(pos, BytePos.add(pos, BytePos.from_usize(len_utf8(ch) * count)));

  const ascii = ASCII_ARRAY.find(([s, _, __]) => s === ascii_str);
  if (ascii === undefined) {
    const msg = `substitution character not found for '${String.fromCodePoint(ch)}'`;
    return lexer.dcx().span_bug(span, msg);
  }
  const [, ascii_name, token_] = ascii;

  // special help suggestion for "directed" double quotes
  let sugg: TokenSubstitution | undefined;
  const s = peek_delimited(lexer.src.slice(lexer.src_index(pos)), C_LEFT_DOUBLE_QUOTE, C_RIGHT_DOUBLE_QUOTE);
  if (s !== undefined) {
    const span = Span.with_root_ctxt(
      pos,
      BytePos.add(pos, BytePos.from_usize(len_utf8(C_LEFT_DOUBLE_QUOTE) + s.len() + len_utf8(C_RIGHT_DOUBLE_QUOTE))),
    );
    sugg = {
      $: "DirectedQuotes",
      span,
      suggestion: `"${s.toString()}"`,
      ascii_str,
      ascii_name,
    };
  } else {
    const suggestion = ascii_str.repeat(count);
    sugg = {
      $: "Other",
      span,
      suggestion,
      ch: String.fromCodePoint(ch),
      u_name,
      ascii_str,
      ascii_name,
    };
  }
  return [token_, sugg];
}

/// Extract string if found at current position with given delimiters
// rustc: compiler/rustc_parse/src/lexer/unicode_chars.rs:383 peek_delimited
function peek_delimited(text: Str, from_ch: number, to_ch: number): Str | undefined {
  const chars = text.chars();
  const first_char = chars.next();
  if (first_char === undefined) return undefined;
  if (first_char !== from_ch) {
    return undefined;
  }
  const last_char_idx = chars.as_str().find(String.fromCodePoint(to_ch));
  if (last_char_idx === undefined) return undefined;
  return chars.as_str().slice(0, last_char_idx);
}
