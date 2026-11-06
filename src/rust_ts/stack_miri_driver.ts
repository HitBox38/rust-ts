// Test-only driver for stack.oracle.test.ts (not a port): the port's Miri run on each command line in `argv[2]`, a JSON array of
// argv tails, in one process through `ensure_stack`. A process of its own for each would cost a second's load each (plan-m7 F5).
import { ensure_stack } from "./stack.ts";
import { set_args_os } from "../std/env.ts";

ensure_stack();
const { main, MiriExit } = await import("../miri/bin/miri.ts");
const encoder = new TextEncoder();
for (const args of JSON.parse(process.argv[2]!) as string[][]) {
  set_args_os(["miri", ...args].map((a) => encoder.encode(a)));
  let code: number;
  try {
    code = main();
  } catch (e) {
    if (!(e instanceof MiriExit)) throw e;
    code = e.code;
  }
  console.log(`exit ${code}`);
}
