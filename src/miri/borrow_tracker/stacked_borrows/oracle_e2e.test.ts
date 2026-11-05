// Stacked Borrows programs through the real driver, against committed oracle fixtures (rust_ts/miri_fixture.ts).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { miri_fixture_expected, miri_fixture_port } from "../../../rust_ts/miri_fixture.ts";
import { miri_program_problem } from "../../../rust_ts/miri_program.ts";

const problem = miri_program_problem();
if (problem !== undefined) console.log(`oracle_e2e.test.ts: skipped: ${problem}`);

for (const name of ["gc_unknown_bottom"]) {
  test.skipIf(problem !== undefined)(
    `${name}.rs matches the oracle`,
    () => {
      const file = join(import.meta.dir, "oracle_e2e", `${name}.rs`);
      expect(miri_fixture_port(file)).toEqual(miri_fixture_expected(file));
    },
    600_000,
  );
}
