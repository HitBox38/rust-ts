// Port of the `expect-test` crate's `trim_indent`, used by ported `expect![[...]]` tests.

/** Drop the first line if it is empty, then strip the common indentation of non-empty lines. */
export function trim_indent(text: string): string {
  if (text.startsWith("\n")) text = text.slice(1);
  const lines = text.split("\n");
  let indent = Infinity;
  for (const l of lines) {
    if (l.trim() === "") continue;
    indent = Math.min(indent, l.length - l.trimStart().length);
  }
  if (indent === Infinity) indent = 0;
  return lines.map((l) => (l.trim() === "" ? l.trimStart() : l.slice(indent))).join("\n");
}
