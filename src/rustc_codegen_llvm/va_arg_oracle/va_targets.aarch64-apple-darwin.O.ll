; ModuleID = 'va_targets.62a5447847134272-cgu.0'
source_filename = "va_targets.62a5447847134272-cgu.0"
target datalayout = "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32"
target triple = "arm64-apple-macosx11.0.0"

; Function Attrs: uwtable
define noundef double @va_f64(ptr noalias nofree noundef align 8 dereferenceable(8) %ap) unnamed_addr #0 !guid !4 {
start:
  %0 = load ptr, ptr %ap, align 8
  %1 = getelementptr inbounds i8, ptr %0, i32 8
  store ptr %1, ptr %ap, align 8
  %_0 = load double, ptr %0, align 8
  ret double %_0
}

; Function Attrs: uwtable
define noundef i32 @va_i32(ptr noalias nofree noundef align 8 dereferenceable(8) %ap) unnamed_addr #0 !guid !5 {
start:
  %0 = load ptr, ptr %ap, align 8
  %1 = getelementptr inbounds i8, ptr %0, i32 8
  store ptr %1, ptr %ap, align 8
  %_0 = load i32, ptr %0, align 8
  ret i32 %_0
}

; Function Attrs: uwtable
define noundef i64 @va_i64(ptr noalias nofree noundef align 8 dereferenceable(8) %ap) unnamed_addr #0 !guid !6 {
start:
  %0 = load ptr, ptr %ap, align 8
  %1 = getelementptr inbounds i8, ptr %0, i32 8
  store ptr %1, ptr %ap, align 8
  %_0 = load i64, ptr %0, align 8
  ret i64 %_0
}

; Function Attrs: uwtable
define noundef ptr @va_ptr(ptr noalias nofree noundef align 8 dereferenceable(8) %ap) unnamed_addr #0 !guid !7 {
start:
  %0 = load ptr, ptr %ap, align 8
  %1 = getelementptr inbounds i8, ptr %0, i32 8
  store ptr %1, ptr %ap, align 8
  %_0 = load ptr, ptr %0, align 8
  ret ptr %_0
}

; Function Attrs: uwtable
define noundef i32 @va_u32(ptr noalias nofree noundef align 8 dereferenceable(8) %ap) unnamed_addr #0 !guid !8 {
start:
  %0 = load ptr, ptr %ap, align 8
  %1 = getelementptr inbounds i8, ptr %0, i32 8
  store ptr %1, ptr %ap, align 8
  %_0 = load i32, ptr %0, align 8
  ret i32 %_0
}

; Function Attrs: uwtable
define noundef i64 @va_u64(ptr noalias nofree noundef align 8 dereferenceable(8) %ap) unnamed_addr #0 !guid !9 {
start:
  %0 = load ptr, ptr %ap, align 8
  %1 = getelementptr inbounds i8, ptr %0, i32 8
  store ptr %1, ptr %ap, align 8
  %_0 = load i64, ptr %0, align 8
  ret i64 %_0
}

; Function Attrs: uwtable
define noundef i64 @va_usize(ptr noalias nofree noundef align 8 dereferenceable(8) %ap) unnamed_addr #0 !guid !10 {
start:
  %0 = load ptr, ptr %ap, align 8
  %1 = getelementptr inbounds i8, ptr %0, i32 8
  store ptr %1, ptr %ap, align 8
  %_0 = load i64, ptr %0, align 8
  ret i64 %_0
}

attributes #0 = { uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 7, !"uwtable", i32 2}
!2 = !{i32 7, !"frame-pointer", i32 1}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 -7542522322023173990}
!5 = !{i64 -7403566267722170155}
!6 = !{i64 3832354651819332949}
!7 = !{i64 -3961039088432752339}
!8 = !{i64 5985954481134168832}
!9 = !{i64 8263235085960526106}
!10 = !{i64 5843679358118385526}
