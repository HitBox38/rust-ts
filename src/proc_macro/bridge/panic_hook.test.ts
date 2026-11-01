// client.rs `maybe_install_panic_hook` (lane followups-35, pm-bridge review N6). `HIDE_PANICS_DURING_EXPANSION` is
// a process-wide `Once`: the first expansion's `force_show_panics` is the one its hook keeps. Each case therefore
// runs in a fresh process. Upstream's hook prints a panic (`prev(info)`) when
// `force_show_panics || !is_available() || !info.can_unwind()`; the port hides panics already (TS has no default
// panic output), and the printing branch (`force_show_panics`, i.e. `-Zproc-macro-backtrace`) stops with `unported`.

import { expect, test } from "bun:test";
import { join } from "node:path";

const here = import.meta.dir;

/** Runs `Client::expand1(..).run1(..)` once per element of `runs` ([force_show_panics, the client panics]). */
function expand_in_fresh_process(runs: [boolean, boolean][]): string[] {
  const script = `
    await import(${JSON.stringify(join(here, "..", "lib.ts"))});
    const { Client } = await import(${JSON.stringify(join(here, "client.ts"))});
    const { MaybeCrossThread } = await import(${JSON.stringify(join(here, "server.ts"))});
    const { panic } = await import(${JSON.stringify(join(here, "..", "..", "std", "panic.ts"))});
    class Server {
      static intern_symbol(s) { return s; }
      static with_symbol_string(s, f) { f(s); }
      static default_TokenStream() { return { trees: [] }; }
      globals() { return { def_site: 1, call_site: 2, mixed_site: 3 }; }
    }
    for (const [force_show_panics, panics] of ${JSON.stringify(runs)}) {
      const client = Client.expand1((ts) => (panics ? panic("proc macro failed") : ts));
      try {
        const r = client.run1(new MaybeCrossThread(false), new Server(), { trees: [] }, force_show_panics);
        console.log(JSON.stringify(r));
      } catch (e) {
        console.log(String(e?.message ?? e));
      }
    }
  `;
  const r = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  return r.stdout.toString().trim().split("\n");
}

const ERR = JSON.stringify({ $: "Err", _0: { $: "String", _0: "proc macro failed" } });
const OK = JSON.stringify({ $: "Ok", _0: { trees: [] } });

test("force_show_panics (the first expansion): a client panic would be printed, which is unported", () => {
  const out = expand_in_fresh_process([[true, true]]);
  expect(out).toHaveLength(1);
  expect(out[0]).toContain("proc_macro::bridge::client::maybe_install_panic_hook");
});

test("force_show_panics without a panic prints nothing and returns the output", () => {
  expect(expand_in_fresh_process([[true, false]])).toEqual([OK]);
});

test("the hook is installed once: a later force_show_panics does not show panics (hidden, Err)", () => {
  expect(expand_in_fresh_process([[false, true], [true, true]])).toEqual([ERR, ERR]);
});
