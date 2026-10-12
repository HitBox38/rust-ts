// Port of unic-langid-impl 0.9.6 `src/parser/errors.rs`.

// #[derive(Debug, PartialEq)]
export type ParserError = "InvalidLanguage" | "InvalidSubtag";
export const ParserError = { InvalidLanguage: "InvalidLanguage", InvalidSubtag: "InvalidSubtag" } as const;

// impl Error for ParserError {}

// crate: unic-langid-impl-0.9.6/src/parser/errors.rs:13 fmt
/** `impl Display for ParserError` */
export function display_ParserError(self: ParserError): string {
  let value: string;
  switch (self) {
    case "InvalidLanguage":
      value = "The given language subtag is invalid";
      break;
    case "InvalidSubtag":
      value = "Invalid subtag";
      break;
  }
  return value;
}

/** `#[derive(Debug)]` */
export function debug_ParserError(self: ParserError): string {
  return self;
}
