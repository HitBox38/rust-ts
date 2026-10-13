// Port of pulldown-cmark-0.11.3/src/strings.rs (representation only).
//
// PORT: `CowStr<'a>` (Boxed / Borrowed / Inlined) and `InlineStr` are a JS `string`: the variants only
// decide where the bytes live, and no parser code branches on them. Their trait impls (`Deref`,
// `From<&str>`/`From<String>`/`From<char>`, `Clone`, `PartialEq`, `Hash`, `Display`, `into_string`) are
// the string itself; `len()` on a `CowStr` is `utf8_len(..)` at the use site. Not ported (no marker):
// the impls and the `#[cfg(test)]` tests, which only exercise the storage variants.
export type CowStr = string;
