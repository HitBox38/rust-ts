// Port of compiler/rustc_errors/src/markdown/tests/term.rs
// PORT: `include_str!("input.md")` and the blessed `output.stdout` are copies of upstream's files next to this test.
// `--bless` (`RUSTC_BLESS`) rewrites the copy.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { str_lines, utf8_len } from "../../../std/str.ts";
import { VecU8 } from "../../../vendor/anstream/stream.ts";
import { MdStream } from "../mod.ts";
import { WIDTH_set, write_wrapping } from "../term.ts";

const INPUT: string = readFileSync(join(import.meta.dir, "input.md"), "utf8");
const OUTPUT_PATH: readonly string[] = [import.meta.dir, "output.stdout"];

const TEST_WIDTH = 80;

// We try to make some words long to create corner cases
const TXT = `Lorem ipsum dolor sit amet, consecteturadipiscingelit.
Fusce-id-urna-sollicitudin, pharetra nisl nec, lobortis tellus. In at
metus hendrerit, tincidunteratvel, ultrices turpis. Curabitur_risus_sapien,
porta-sed-nunc-sed, ultricesposuerelacus. Sed porttitor quis
dolor non venenatis. Aliquam ut. `;

const WRAPPED = `Lorem ipsum dolor sit amet, consecteturadipiscingelit. Fusce-id-urna-
sollicitudin, pharetra nisl nec, lobortis tellus. In at metus hendrerit,
tincidunteratvel, ultrices turpis. Curabitur_risus_sapien, porta-sed-nunc-sed,
ultricesposuerelacus. Sed porttitor quis dolor non venenatis. Aliquam ut. Lorem
    ipsum dolor sit amet, consecteturadipiscingelit. Fusce-id-urna-
    sollicitudin, pharetra nisl nec, lobortis tellus. In at metus hendrerit,
    tincidunteratvel, ultrices turpis. Curabitur_risus_sapien, porta-sed-nunc-
    sed, ultricesposuerelacus. Sed porttitor quis dolor non venenatis. Aliquam
    ut. Sample link lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet,
consecteturadipiscingelit. Fusce-id-urna-sollicitudin, pharetra nisl nec,
lobortis tellus. In at metus hendrerit, tincidunteratvel, ultrices turpis.
Curabitur_risus_sapien, porta-sed-nunc-sed, ultricesposuerelacus. Sed porttitor
quis dolor non venenatis. Aliquam ut. `;

const ok = <T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T => {
  if (r.$ === "Err") throw new Error("called `Result::unwrap()` on an `Err` value");
  return r._0;
};

// rustc: compiler/rustc_errors/src/markdown/tests/term.rs:33 test_wrapping_write
test("test_wrapping_write", () => {
  WIDTH_set(TEST_WIDTH);
  try {
    const buf = new VecU8();
    const txt = TXT.replaceAll("-\n", "-").replaceAll("_\n", "_").replaceAll("\n", " ").replaceAll("    ", "");
    ok(write_wrapping(buf, txt, 0, undefined, undefined));
    ok(write_wrapping(buf, txt, 4, undefined, undefined));
    ok(write_wrapping(buf, "Sample link lorem ipsum dolor sit amet. ", 4, "link-address-placeholder", undefined));
    ok(write_wrapping(buf, txt, 0, undefined, undefined));
    let out = new TextDecoder("utf-8", { fatal: true }).decode(buf.bytes());
    out = out.replaceAll("\x1b\\", "").replaceAll("\x1b", "").replaceAll("]8;;", "").replaceAll("link-address-placeholder", "");

    for (const line of str_lines(out)) {
      expect(utf8_len(line) <= TEST_WIDTH, `line length\n'${line}'`).toBe(true);
    }

    expect(out).toBe(WRAPPED);
  } finally {
    // PORT: `WIDTH` is a thread-local in upstream (one per test thread); restore the default for the next test.
    WIDTH_set(140);
  }
});

// rustc: compiler/rustc_errors/src/markdown/tests/term.rs:63 test_output
test("test_output", () => {
  // Capture `--bless` when run via ./x
  const v = process.env.RUSTC_BLESS;
  const bless = v !== undefined && v !== "0";
  const ast = MdStream.parse_str(INPUT);
  const buffer = new VecU8();
  ok(ast.write_anstream_buf(buffer, undefined));

  const blessed = join(...OUTPUT_PATH);

  if (bless) {
    writeFileSync(blessed, buffer.bytes());
    process.stderr.write(`blessed output at ${blessed}\n`);
  } else {
    const output = buffer.bytes();
    expect(Buffer.from(output).equals(readFileSync(blessed)), "markdown output mismatch").toBe(true);
  }
});
