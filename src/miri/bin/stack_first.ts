// rust-ts glue (not an upstream mirror). miri.ts imports this first, so that when Miri is the program, `ensure_stack` runs before
// the rest of the compiler's modules evaluate. ESM evaluates imports in order, so an `ensure_stack()` in miri.ts's body comes after
// all of them, and their module-level reads of `process.env` (rustc_session/config.ts's RUST_TS_HOST_TUPLE) would see `.env` variables.
// Bun still parses the whole import graph first, so this does not avoid that cost in the process that re-execs.
import { join } from "node:path";
import { ensure_stack } from "../../rust_ts/stack.ts";

// A `--compile` bundle's `Bun.main` does not match: miri.ts's own call does the same work, later.
if (Bun.main === join(import.meta.dir, "miri.ts")) ensure_stack();
