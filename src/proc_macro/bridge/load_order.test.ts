// Load-order (TDZ) checks for library/proc_macro (lane followups-35). Each case loads one module first in a fresh
// process, so the module graph is evaluated from that entry. bridge/client.ts → bridge/mod.ts used to evaluate
// bridge/server.ts (an extension module of client.ts: `Client.prototype.run1 = ..`) before client.ts had defined
// `Client`; bridge/mod.ts now re-exports `server` type-only and the crate root loads server.ts.

import { expect, test } from "bun:test";
import { join } from "node:path";

const here = import.meta.dir;
const src = join(here, "..", "..");

function load_first(entry: string, then_: string[], check: string): { code: number; out: string } {
  const imports = [entry, ...then_].map((p) => `await import(${JSON.stringify(join(src, p))});`).join(" ");
  const script = `${imports} const c = await import(${JSON.stringify(join(here, "client.ts"))}); ${check}`;
  const r = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
}

test("bridge/client.ts loads first in a fresh process; the crate root then installs run1 / run2", () => {
  const r = load_first(
    "proc_macro/bridge/client.ts",
    ["proc_macro/lib.ts"],
    `console.log(typeof c.Client, typeof c.Client.prototype.run1, typeof c.Client.prototype.run2, typeof c.Methods);`,
  );
  expect(r.out.trim()).toBe("function function function object");
  expect(r.code).toBe(0);
});

test.each(["proc_macro/bridge/symbol.ts", "proc_macro/diagnostic.ts", "proc_macro/bridge/server.ts", "proc_macro/bridge/mod.ts"])(
  "%s loads first in a fresh process",
  (entry) => {
    const r = load_first(entry, ["proc_macro/lib.ts"], `console.log(typeof c.Client.prototype.run1);`);
    expect(r.out.trim()).toBe("function");
    expect(r.code).toBe(0);
  },
);

test("rustc_builtin_macros/lib.ts (client.ts imported before lib.ts) loads after bridge/client.ts", () => {
  const r = load_first("proc_macro/bridge/client.ts", ["rustc_builtin_macros/lib.ts"], `console.log(typeof c.Client.prototype.run1);`);
  expect(r.out.trim()).toBe("function");
  expect(r.code).toBe(0);
});
