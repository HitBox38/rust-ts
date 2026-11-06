// Test-only driver for fulfill_stalled.oracle.test.ts (not a port): `<rustc flags> -- <programs>`, one compile per program in one
// process, under `StalledPrefix`'s self-check. A process of its own for each would cost a second's load each (plan-m7 F5).
import { ensure_stack } from "./stack.ts";

ensure_stack();
const { TimePassesCallbacks, catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
const { set_stalled_prefix_check } = await import("../rustc_trait_selection/solve/fulfill.ts");
const check = { skipped: 0 };
set_stalled_prefix_check(check);
const args = process.argv.slice(2);
const flags = args.slice(0, args.indexOf("--"));
for (const program of args.slice(args.indexOf("--") + 1)) {
  const before = check.skipped;
  const code = catch_with_exit_code(() => compiler_entrypoint(["rustc", ...flags, program], TimePassesCallbacks.default()));
  console.log(`${program} exit ${code} skipped ${check.skipped - before}`);
}
