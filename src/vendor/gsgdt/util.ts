// Port of gsgdt 0.1.2 (the version in upstream's Cargo.lock), src/util.rs.

// crate: gsgdt-0.1.2/src/util.rs:1 escape_html
export function escape_html(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
