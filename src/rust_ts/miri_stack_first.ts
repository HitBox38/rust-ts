// rust-ts glue (not an upstream mirror). src/miri/bin/miri.ts imports this first, so that when Miri is the program, `ensure_stack` runs before
// the rest of the compiler's modules evaluate. ESM evaluates imports in order, so an `ensure_stack()` in miri.ts's body comes after
// all of them, and their module-level reads of `process.env` (rustc_session/config.ts's RUST_TS_HOST_TUPLE) would see `.env` variables.
// Bun still parses the whole import graph first, so this import does not avoid that cost in the process that re-execs. The Miri suites avoid
// it with `bun --preload` of this file (harness/suites.ts); the plain form a user runs does not. Each form needs it: scripts/miri.test.ts tests the plain one.
import { join } from "node:path";
import { ensure_stack } from "./stack.ts";

// A `--compile` bundle's `Bun.main` does not match: miri.ts's own call does the same work, later.
if (Bun.main === join(import.meta.dir, "../miri/bin/miri.ts")) ensure_stack();
