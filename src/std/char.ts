// `char` is a number holding a Unicode scalar value.

/** Character literal: `ch("a")` is `'a'`. */
export function ch(s: string): number {
  return s.codePointAt(0)!;
}

export function is_ascii(c: number): boolean {
  return c < 0x80;
}

export function is_ascii_digit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

export function is_ascii_hexdigit(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

export function is_ascii_alphabetic(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

export function is_ascii_alphanumeric(c: number): boolean {
  return is_ascii_alphabetic(c) || is_ascii_digit(c);
}

/** `char::len_utf8` */
export function len_utf8(c: number): number {
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}

export function from_u32(n: number): number | undefined {
  return n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? undefined : n;
}

export function to_string(c: number): string {
  return String.fromCodePoint(c);
}
