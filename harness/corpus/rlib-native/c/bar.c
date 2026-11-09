// libfoo.a's bar.o: an undefined reference (harness/corpus/gen-rlib-native.ts).
extern int undefined_sym(void);
int bar_fn(void) { return undefined_sym(); }
