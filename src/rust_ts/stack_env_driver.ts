// Test-only driver for stack.test.ts (not a port): the environment as the code after `ensure_stack` sees it.
import { ensure_stack } from "./stack.ts";

ensure_stack();
console.log(
  JSON.stringify({
    marker: process.env.RUST_TS_JS_STACK === undefined ? undefined : "set",
    shell_env: process.env.RUST_TS_SHELL_ENV,
    PWD: process.env.PWD,
    OLDPWD: process.env.OLDPWD,
    SHLVL: process.env.SHLVL,
  }),
);
