// Test-only driver for stack.test.ts (not a port): the environment and the JS stack as the code after `ensure_stack` sees them.
import { environ_entries } from "../std/env.ts";
import { ensure_stack } from "./stack.ts";

ensure_stack();
// A second call must not re-exec, as the variables that mark the re-exec are gone by now. If it did, this would never finish.
ensure_stack();

let depth = 0;
const recurse = (): void => {
  depth++;
  recurse();
};
try {
  recurse();
} catch {
  // RangeError: the JS stack's limit.
}
console.log(
  JSON.stringify({
    environ: environ_entries()!.map((e) => Buffer.from(e).toString("latin1")),
    process_env: process.env,
    depth,
  }),
);
