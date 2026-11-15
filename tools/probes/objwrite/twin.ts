// The port's side of the objwrite probe (lane harness-w40s; adopted from the vendor-object-write review's scratch twin,
// N2): runs a tools/probes/objwrite script on src/vendor/object/write and prints what tools/probes/objwrite/main.rs
// prints on the oracle's own `object` 0.39.1 (the script language and the output are described there). Each step is
// the same call with the same arguments, and each logged value is printed the way the probe's `{:?}` / `{}` prints it.
import { add_elf_gnu_property_u32 } from "../../../src/vendor/object/write/elf/object.ts";
import { Object as WObject, Symbol as WSymbol, debug_Error, debug_SymbolId, type Relocation, type SectionId, type StandardSection, type SymbolId, type SymbolSection } from "../../../src/vendor/object/write/mod.ts";
import type { Architecture, RelocationEncoding, RelocationFlags, RelocationKind, SectionKind, SymbolKind, SymbolScope } from "../../../src/vendor/object/common.ts";

const enc = new TextEncoder();

/** The probe's `pat`: `n` bytes of `(i * 13 + 5) & 0xff`. */
const pat = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 5) & 0xff);

/** `{:?}` of a `Result<(), Error>`. */
const debugResult = (r: { $: "Ok" } | { $: "Err"; _0: Parameters<typeof debug_Error>[0] }): string => (r.$ === "Ok" ? "Ok(())" : `Err(${debug_Error(r._0)})`);

/** The probe's `dump`: `object <length>`, then the bytes, 32 per line as `<offset hex>: <hex>`. */
function dump(bytes: Uint8Array): string {
  let s = `object ${bytes.length}\n`;
  for (let i = 0; i < bytes.length; i += 32) {
    let hex = "";
    for (const b of bytes.subarray(i, i + 32)) hex += b.toString(16).padStart(2, "0");
    s += `${i.toString(16).padStart(6, "0")}: ${hex}\n`;
  }
  return s;
}

/** What `objwrite <script>` prints for the script text `script`, computed by the port. */
export function objwrite(script: string): string {
  let obj: WObject | undefined;
  let secs: SectionId[] = [];
  let syms: SymbolId[] = [];
  let log = "";
  let out = "";
  for (const line of script.split("\n")) {
    const t = line.trim().split(/\s+/).filter(Boolean);
    if (t.length === 0 || t[0]!.startsWith("#")) continue;
    const n = (i: number): number => Number(t[i]);
    const o = obj!;
    switch (t[0]) {
      case "new":
        obj = new WObject(t[1] === "Elf" ? "Elf" : "MachO", t[2] as Architecture, t[3] === "Little" ? "Little" : "Big");
        secs = [];
        syms = [];
        log = "";
        break;
      case "subsections":
        o.set_subsections_via_symbols();
        break;
      case "sid":
        secs.push(o.section_id(t[1] as StandardSection));
        break;
      case "subsec":
        secs.push(o.add_subsection(t[1] as StandardSection, enc.encode(t[2])));
        break;
      case "addsec":
        secs.push(o.add_section(t[1] === "-" ? new Uint8Array(0) : enc.encode(t[1]), enc.encode(t[2]), { $: t[3] } as SectionKind));
        break;
      case "data":
        log += `data ${o.append_section_data(secs[n(1)]!, pat(n(2)), n(3))}\n`;
        break;
      case "bss":
        log += `bss ${o.append_section_bss(secs[n(1)]!, n(2), n(3))}\n`;
        break;
      case "sym": {
        const s = t[5]!;
        const section: SymbolSection =
          s === "U" ? { $: "Undefined" } : s === "A" ? { $: "Absolute" } : s === "C" ? { $: "Common" } : s === "N" ? { $: "None" } : { $: "Section", _0: secs[Number(s)]! };
        const id = o.add_symbol(new WSymbol(enc.encode(t[1]), 0, 0, t[2] as SymbolKind, t[3] as SymbolScope, t[4] === "1", section, { $: "None" }));
        log += `sym ${debug_SymbolId(id)}\n`;
        syms.push(id);
        break;
      }
      case "symdata":
        log += `symdata ${o.add_symbol_data(syms[n(1)]!, secs[n(2)]!, pat(n(3)), n(4))}\n`;
        break;
      case "symbss":
        log += `symbss ${o.add_symbol_bss(syms[n(1)]!, secs[n(2)]!, n(3), n(4))}\n`;
        break;
      case "common": {
        const sym = new WSymbol(enc.encode(t[1]), 0, 0, t[2] as SymbolKind, t[3] as SymbolScope, false, { $: "Undefined" }, { $: "None" });
        const id = o.add_common_symbol(sym, n(4), n(5));
        log += `common ${debug_SymbolId(id)}\n`;
        syms.push(id);
        break;
      }
      case "filesym":
        syms.push(o.add_file_symbol(enc.encode(t[1])));
        break;
      case "secsym": {
        const id = o.section_symbol(secs[n(1)]!);
        log += `secsym ${debug_SymbolId(id)}\n`;
        syms.push(id);
        break;
      }
      case "symid": {
        const id = o.symbol_id(enc.encode(t[1]));
        log += `symid ${id === undefined ? "None" : `Some(${debug_SymbolId(id)})`}\n`;
        break;
      }
      case "symsecoff": {
        const r = o.symbol_section_and_offset(syms[n(1)]!);
        log += `symsecoff ${r === undefined ? "None" : `Some((${debug_SymbolId(r[0])}, ${r[1]}))`}\n`;
        break;
      }
      case "reloc":
      case "relocsub":
      case "relocmacho":
      case "relocelf": {
        let flags: RelocationFlags;
        if (t[0] === "relocmacho") flags = { $: "MachO", r_type: n(5), r_pcrel: t[6] === "1", r_length: n(7) };
        else if (t[0] === "relocelf") flags = { $: "Elf", r_type: n(5) };
        else flags = { $: "Generic", kind: t[5] as RelocationKind, encoding: t[6] as RelocationEncoding, size: n(7) };
        const rel: Relocation = { offset: n(2), symbol: syms[n(3)]!, addend: BigInt(t[4]!), flags };
        const r = t[0] === "relocsub" ? o.add_relocation_with_subtractor(secs[n(1)]!, rel, t[8] === "-" ? undefined : syms[n(8)]!) : o.add_relocation(secs[n(1)]!, rel);
        log += `${t[0]} ${debugResult(r)}\n`;
        break;
      }
      case "comdat": {
        const id = o.add_comdat({ kind: t.length > 3 ? "NoDuplicates" : "Any", symbol: syms[n(1)]!, sections: t[2]!.split(",").map((x) => secs[Number(x)]!) });
        log += `comdat ComdatId(${id})\n`;
        break;
      }
      case "gnuprop":
        add_elf_gnu_property_u32(o, n(1), n(2));
        break;
      case "out": {
        const r = o.write();
        if (r.$ === "Err") log += `write Err(${debug_Error(r._0)}) ${r._0.fmt()}\n`;
        out += `out ${t[1]}\n${log}`;
        if (r.$ === "Ok") out += dump(r._0);
        break;
      }
      default:
        throw new Error(`op ${t[0]}`);
    }
  }
  return out;
}
