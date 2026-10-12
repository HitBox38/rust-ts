// Subject side of the `symbols` suite; output format must match tools/probes/symdump/main.rs
// (section list and formats are documented there).
//   bun src/rust_ts/symdump.ts <section>...
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { ALL_EDITIONS, display_Edition } from "../rustc_span/edition.ts";
import { display_Ident, Ident, kw, PREDEFINED_SYMBOLS_COUNT, sym, Symbol, debug_Symbol, used_keywords } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";

/** Sections that read the symbol interner (must match NEEDS_GLOBALS in the probe). */
const NEEDS_GLOBALS = ["predefined", "integer", "character", "ident"];

const b = (v: boolean) => (v ? "1" : "0");
const dbg = (s: Symbol) => debug_Symbol(s, PLAIN);

function names(list: [string, Symbol][]): string {
  const v = list.map(([n, s]): [number, string] => [Symbol.as_u32(s), n]);
  v.sort((x, y) => (x[0] !== y[0] ? x[0] - y[0] : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  return v.map(([i, n]) => `${i}\t${n}\n`).join("");
}

/** Symbol-valued entries of a `kw`/`sym` table (the `sym` object also holds helper fns). */
function entries(o: object): [string, Symbol][] {
  return Object.entries(o).filter((e): e is [string, Symbol] => typeof e[1] === "number");
}

/** Strings for the `ident` section beyond the keyword range (same list as the probe). */
const IDENT_EXTRA = ["main", "'static", "'_", "'a", "'async", "123", "0x1f", "_x", "r", "union", "macro_rules", "raw", "safe", ""];

function section(name: string): string {
  let out = `== ${name}\n`;
  switch (name) {
    case "count":
      out += `count ${PREDEFINED_SYMBOLS_COUNT}\n`;
      break;
    case "predefined":
      for (let i = 0; i < PREDEFINED_SYMBOLS_COUNT; i++) out += `${i}\t${dbg(Symbol.new(i))}\n`;
      break;
    case "kw":
      out += names(entries(kw));
      break;
    case "sym":
      out += names(entries(sym));
      break;
    case "integer": {
      const ns: (number | bigint)[] = [];
      for (let n = 0; n <= 20; n++) ns.push(n);
      // 100u32, 7u8, 9i64, -1i32, -10i64, u32::MAX, u64::MAX, i64::MIN, u128::MAX, i128::MIN, 15usize
      ns.push(100, 7, 9, -1, -10, 4294967295, 2n ** 64n - 1n, -(2n ** 63n), 2n ** 128n - 1n, -(2n ** 127n), 15);
      for (const n of ns) {
        const s = sym.integer(n);
        out += `${n}\t${Symbol.as_u32(s)}\t${dbg(s)}\n`;
      }
      break;
    }
    case "letters":
      for (let c = 0; c < 128; c++) {
        const s = sym.ascii_letter_digit(c);
        out += `${c}\t${s === undefined ? "-" : Symbol.as_u32(s)}\n`;
      }
      break;
    case "character":
      for (const c of [0x61, 0x5a, 0x35, 0x5f, 0x24, 0xe9, 0x4e2d, 0x1f600, 0, 0x0a, 0x22, 0x27, 0x7f, 0x200b]) {
        const s = sym.character(c);
        out += `${c}\t${Symbol.as_u32(s)}\t${dbg(s)}\n`;
      }
      break;
    case "predicates":
      for (let i = 0; i < PREDEFINED_SYMBOLS_COUNT; i++) {
        const s = Symbol.new(i);
        const f = [Symbol.is_empty(s), Symbol.is_weak(s), Symbol.is_path_segment_keyword(s), Symbol.is_bool_lit(s), Symbol.can_be_raw(s), Symbol.is_predefined(i)];
        out += `${i}\t${f.map(b).join("")}\n`;
      }
      break;
    case "editions":
      for (const ed of ALL_EDITIONS) {
        const used = used_keywords(() => ed).map((s) => String(Symbol.as_u32(s)));
        out += `used_keywords ${display_Edition(ed)}\t${used.join(" ")}\n`;
        const reserved: string[] = [];
        for (let i = 0; i < PREDEFINED_SYMBOLS_COUNT; i++) if (Symbol.is_reserved(Symbol.new(i), () => ed)) reserved.push(String(i));
        out += `reserved ${display_Edition(ed)}\t${reserved.join(" ")}\n`;
      }
      break;
    case "ident": {
      const syms: Symbol[] = [];
      for (let i = 0; i <= Symbol.as_u32(kw.Yeet); i++) syms.push(Symbol.new(i));
      for (const s of IDENT_EXTRA) syms.push(Symbol.intern(s));
      for (const s of syms) {
        const id = Ident.with_dummy_span(s);
        const f = [
          id.is_special(),
          id.is_used_keyword(),
          id.is_unused_keyword(),
          id.is_reserved(),
          id.is_path_segment_keyword(),
          id.is_raw_guess(),
          id.is_reserved_lifetime(),
          id.is_raw_lifetime_guess(),
          id.is_numeric(),
        ];
        out += `${Symbol.as_u32(s)}\t${f.map(b).join("")}\t${display_Ident(id)}\n`;
      }
      break;
    }
    default:
      process.stderr.write(`symdump: unknown section ${JSON.stringify(name)}\n`);
      process.exit(2);
  }
  return out;
}

const sections = process.argv.slice(2);
let out = "";
try {
  const all = () => {
    for (const name of sections) out += section(name);
  };
  if (sections.some((s) => NEEDS_GLOBALS.includes(s))) create_default_session_globals_then(all);
  else all();
  process.stdout.write(out);
} catch (e) {
  // Same exit-code contract as src/rust_ts/main.ts: 70 = reached unported code, 101 = ICE.
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}
`);
    process.exitCode = 70;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}
${e instanceof Error ? e.stack : ""}
`);
    process.exitCode = 101;
  }
}
