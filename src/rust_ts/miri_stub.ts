// Placeholders of the Miri stub modules (lane miri-contract, plan-m6 D2; docs/handoff/miri-contract.md). Our own code,
// not a port: it goes away when the last Miri fill lane lands.
//
// Each stub module of src/miri/ declares the methods of its upstream file (`declare module` augmentations of `InterpCx` for
// Miri's `EvalContextExt` traits, of the generated classes for their inherent impls) and registers them here with
// `stub_methods` / `stub_statics`. `install_miri_stubs()` (called once by src/miri/lib.ts after every module has loaded)
// defines each registered name as a function that stops with `unported("<path>::<name> (<upstream file>; lane <lane>)")`.
//
// Installation is deferred (not done when the stub module loads) so that it never touches a class whose module is still
// evaluating (ESM cycles between generated and hand modules), and it is strict: a name that is already an own property
// of its target (the fill lane assigned the port and forgot to delete the name from the stub list, or two traits declare
// the same method on `InterpCx`, or a Miri method shadows a rustc_const_eval one) is an error, so a collision can never
// silently replace a ported method.
import { unported } from "../std/panic.ts";

export interface MiriStub {
  /** Rust path of the trait or type (`miri::shims::time::EvalContextExt`, `miri::concurrency::thread::ThreadManager`). */
  readonly path: string;
  /** Upstream file (`src/tools/miri/src/shims/time.rs`). */
  readonly upstream: string;
  /** The fill lane (plan-m6 §5). */
  readonly lane: string;
  /** `method`: prototype members; `static`: associated fns (properties of the class object). */
  readonly kind: "method" | "static";
  readonly target: () => object;
  readonly names: readonly string[];
}

/** Every registered stub, in registration (module load) order. */
export const MIRI_STUBS: MiriStub[] = [];
let installed = false;

/** Registers `unported` placeholders for prototype methods (`target()` is the prototype). */
export function stub_methods(path: string, upstream: string, lane: string, target: () => object, names: readonly string[]): void {
  register({ path, upstream, lane, kind: "method", target, names });
}

/** Registers `unported` placeholders for associated fns (`target()` is the class object). */
export function stub_statics(path: string, upstream: string, lane: string, target: () => object, names: readonly string[]): void {
  register({ path, upstream, lane, kind: "static", target, names });
}

/** A ported member set of a class that another module defines (lane miri-alloc, contract fix; see `port_methods`). */
interface MiriPort {
  readonly path: string;
  readonly target: () => object;
  readonly members: Readonly<Record<string, unknown>>;
}

/** Every registered port, in registration (module load) order. */
const MIRI_PORTS: MiriPort[] = [];

/** Registers ported members (prototype methods or associated fns) of a class that *another* module defines, e.g.
 * `impl MiriMachine` in alloc_addresses/mod.rs or `impl machine::AllocExtra` in borrow_tracker/mod.rs. Assigning them at
 * load would read the other module's class at top level, which init-order rule C10 (2) forbids (it is in its TDZ when
 * the ESM cycle through the generated modules enters this module first). `install_miri_stubs()` defines them, before the
 * placeholders, with the same strict check: a name already defined on its target is an error, and a ported name still
 * listed in a `stub_*` call makes the placeholder installation throw. `InterpCx.prototype` (rustc_const_eval, loaded
 * first) and a module's own generated classes need no deferral. */
export function port_methods(path: string, target: () => object, members: Readonly<Record<string, unknown>>): void {
  if (installed) throw new Error(`miri port ${path}: registered after install_miri_stubs()`);
  MIRI_PORTS.push({ path, target, members });
}

function register(s: MiriStub): void {
  if (installed) throw new Error(`miri stub ${s.path}: registered after install_miri_stubs()`);
  MIRI_STUBS.push(s);
}

/** The `unported(..)` text of a placeholder. */
export function stub_message(s: MiriStub, name: string): string {
  return `${s.path}::${name} (${s.upstream}; lane ${s.lane})`;
}

/** Defines every registered port, then every registered placeholder (once; src/miri/lib.ts). Throws on a name that is
 * already defined on its target. */
export function install_miri_stubs(): void {
  if (installed) return;
  installed = true;
  for (const p of MIRI_PORTS) {
    const target = p.target();
    for (const [name, value] of Object.entries(p.members)) {
      if (Object.prototype.hasOwnProperty.call(target, name)) {
        throw new Error(`miri port ${p.path}::${name}: \`${name}\` is already defined on its target`);
      }
      Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
    }
  }
  for (const s of MIRI_STUBS) {
    const target = s.target();
    for (const name of s.names) {
      if (Object.prototype.hasOwnProperty.call(target, name)) {
        throw new Error(`miri stub ${s.path}::${name} (${s.upstream}): \`${name}\` is already defined on its target`);
      }
      const what = stub_message(s, name);
      Object.defineProperty(target, name, {
        value: function (): never {
          return unported(what);
        },
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}
