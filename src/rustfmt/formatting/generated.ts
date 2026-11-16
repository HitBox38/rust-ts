// Port of src/tools/rustfmt/src/formatting/generated.rs (lane rustfmt-contract-3).
import type { Config } from "../config/mod.ts";
import { str_lines } from "../../std/str.ts";

/// Returns `true` if the given span is a part of generated files.
// rustc: src/tools/rustfmt/src/formatting/generated.rs:4 is_generated_file
export function is_generated_file(original_snippet: string, config: Config): boolean {
  return (
    str_lines(original_snippet)
      // looking for marker only in the beginning of the file
      .slice(0, config.generated_marker_line_search_limit())
      .some((line) => line.includes("@generated"))
  );
}
