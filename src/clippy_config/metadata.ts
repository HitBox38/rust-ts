// rust-ts port of src/tools/clippy/clippy_config/src/metadata.rs.
//
// PORT: an `impl Display` value is its `Display` output, a `string`; the local `struct S` of each
// `display_markdown_*` method is its `fmt` function.

import { str_lines } from "../std/str.ts";

export class ConfMetadata {
  name: string;
  default: string;
  lints: readonly string[];
  doc: string;
  renamed_to: string | undefined;

  constructor(name: string, default_: string, lints: readonly string[], doc: string, renamed_to: string | undefined) {
    this.name = name;
    this.default = default_;
    this.lints = lints;
    this.doc = doc;
    this.renamed_to = renamed_to;
  }

  // rustc: src/tools/clippy/clippy_config/src/metadata.rs:23 display_markdown_paragraph
  display_markdown_paragraph(): string {
    // struct S<'a>(&'a ConfMetadata);
    // rustc: src/tools/clippy/clippy_config/src/metadata.rs:26 fmt
    const fmt = (self: ConfMetadata): string =>
      `## \`${self.name}\`\n${str_lines(self.doc)
        .map((doc) => (doc.startsWith(" ") ? doc.slice(1) : doc))
        .join("\n")}\n\n**Default Value:** \`${self.default}\`\n\n---\n**Affected lints:**\n${self.lints
        .map((name) => `* [\`${name}\`](https://rust-lang.github.io/rust-clippy/main/index.html#${name})`)
        .join("\n")}\n\n`;
    return fmt(this);
  }

  // rustc: src/tools/clippy/clippy_config/src/metadata.rs:45 display_markdown_link
  display_markdown_link(): string {
    // struct S<'a>(&'a ConfMetadata);
    // rustc: src/tools/clippy/clippy_config/src/metadata.rs:48 fmt
    const fmt = (self: ConfMetadata): string =>
      `[\`${self.name}\`]: https://doc.rust-lang.org/clippy/lint_configuration.html#${self.name}`;
    return fmt(this);
  }
}

// rustc: src/tools/clippy/clippy_config/src/metadata.rs:13 fmt
export function display_ConfMetadata(self: ConfMetadata): string {
  let f = `- \`${self.name}\`: ${self.doc}`;
  if (self.default.length !== 0) {
    f += `\n\n   (default: \`${self.default}\`)`;
  }
  return f;
}
