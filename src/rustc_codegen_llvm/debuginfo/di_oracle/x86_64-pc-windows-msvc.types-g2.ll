; ModuleID = 'types.ca9a2c18325d504-cgu.0'
source_filename = "types.ca9a2c18325d504-cgu.0"
target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-pc-windows-msvc"

@_RNvCs15oYSsIuqjM_5types6GLOBAL = constant <{ [13 x i8], [3 x i8] }> <{ [13 x i8] c"\00\00\00\00\00\00\00@\01\00\00\00\03", [3 x i8] undef }>, align 8, !dbg !0, !guid !17
@vtable.0 = private constant [24 x i8] c"\00\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00", align 8, !dbg !18, !guid !31
@vtable.1 = private constant <{ [24 x i8], ptr }> <{ [24 x i8] c"\00\00\00\00\00\00\00\00\10\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area }>, align 8, !dbg !32, !guid !40
@"\01__imp__RNvCs15oYSsIuqjM_5types6GLOBAL" = global ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL

; types::take::<types::closure::{closure#0}>
; Function Attrs: noinline uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %t) unnamed_addr #0 !dbg !316 !guid !327 {
start:
  %t.dbg.spill = alloca [4 x i8], align 4
  store i32 %t, ptr %t.dbg.spill, align 4
    #dbg_declare(ptr %t.dbg.spill, !324, !DIExpression(), !328)
  ret i32 0, !dbg !329
}

; types::take::<types::rec_impl>
; Function Attrs: noinline uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_() unnamed_addr #0 !dbg !330 !guid !341 {
start:
  %t.dbg.spill = alloca [0 x i8], align 1
    #dbg_declare(ptr %t.dbg.spill, !338, !DIExpression(), !342)
  ret i32 0, !dbg !343
}

; types::diverge
; Function Attrs: noreturn uwtable
define internal void @_RNvCs15oYSsIuqjM_5types7diverge() unnamed_addr #1 !dbg !344 !guid !347 {
start:
  br label %bb1, !dbg !348

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !348
}

; types::rec_impl
; Function Attrs: uwtable
define void @_RNvCs15oYSsIuqjM_5types8rec_impl() unnamed_addr #2 !dbg !349 !guid !350 {
start:
  ret void, !dbg !351
}

; <types::Point as types::Shape>::area
; Function Attrs: uwtable
define i32 @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area(ptr align 8 %self) unnamed_addr #2 !dbg !352 !guid !359 {
start:
  %self.dbg.spill = alloca [8 x i8], align 8
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !358, !DIExpression(), !360)
  %0 = getelementptr inbounds i8, ptr %self, i64 12, !dbg !361
  %_2 = load i8, ptr %0, align 4, !dbg !361
  %_0 = zext i8 %_2 to i32, !dbg !361
  ret i32 %_0, !dbg !362
}

; Function Attrs: uwtable
define i32 @basics(i8 %a, i64 %b, float %c, double %d, i64 %e, i64 %f, i128 %g, i128 %h, half %i, fp128 %j, i32 %l) unnamed_addr #2 !dbg !363 !guid !398 {
start:
  %k.dbg.spill = alloca [0 x i8], align 1
  %l.dbg.spill = alloca [4 x i8], align 4
  %_11.dbg.spill = alloca [0 x i8], align 1
  %j.dbg.spill = alloca [16 x i8], align 16
  %i.dbg.spill = alloca [2 x i8], align 2
  %h.dbg.spill = alloca [16 x i8], align 16
  %g.dbg.spill = alloca [16 x i8], align 16
  %f.dbg.spill = alloca [8 x i8], align 8
  %e.dbg.spill = alloca [8 x i8], align 8
  %d.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [4 x i8], align 4
  %b.dbg.spill = alloca [8 x i8], align 8
  %a.dbg.spill = alloca [1 x i8], align 1
  store i8 %a, ptr %a.dbg.spill, align 1
    #dbg_declare(ptr %a.dbg.spill, !385, !DIExpression(), !399)
  store i64 %b, ptr %b.dbg.spill, align 8
    #dbg_declare(ptr %b.dbg.spill, !386, !DIExpression(), !399)
  store float %c, ptr %c.dbg.spill, align 4
    #dbg_declare(ptr %c.dbg.spill, !387, !DIExpression(), !399)
  store double %d, ptr %d.dbg.spill, align 8
    #dbg_declare(ptr %d.dbg.spill, !388, !DIExpression(), !399)
  store i64 %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !389, !DIExpression(), !399)
  store i64 %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !390, !DIExpression(), !399)
  store i128 %g, ptr %g.dbg.spill, align 16
    #dbg_declare(ptr %g.dbg.spill, !391, !DIExpression(), !399)
  store i128 %h, ptr %h.dbg.spill, align 16
    #dbg_declare(ptr %h.dbg.spill, !392, !DIExpression(), !399)
  store half %i, ptr %i.dbg.spill, align 2
    #dbg_declare(ptr %i.dbg.spill, !393, !DIExpression(), !399)
  store fp128 %j, ptr %j.dbg.spill, align 16
    #dbg_declare(ptr %j.dbg.spill, !394, !DIExpression(), !399)
    #dbg_declare(ptr %_11.dbg.spill, !397, !DIExpression(), !399)
  store i32 %l, ptr %l.dbg.spill, align 4
    #dbg_declare(ptr %l.dbg.spill, !396, !DIExpression(), !399)
    #dbg_declare(ptr %k.dbg.spill, !395, !DIExpression(), !399)
  ret i32 0, !dbg !400
}

; Function Attrs: uwtable
define i32 @closure(i32 %x) unnamed_addr #2 !dbg !401 !guid !408 {
start:
  %c.dbg.spill = alloca [4 x i8], align 4
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !405, !DIExpression(), !409)
  store i32 %x, ptr %c.dbg.spill, align 4, !dbg !410
    #dbg_declare(ptr %c.dbg.spill, !406, !DIExpression(), !411)
; call types::take::<types::closure::{closure#0}>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %x), !dbg !412
  ret i32 %_0, !dbg !413
}

; Function Attrs: uwtable
define i32 @enums(i8 %c, ptr align 8 %t, ptr align 4 %o, i8 %n, i64 %s.0, i32 %s.1, ptr %e, i128 %w.0, i8 %w.1, ptr align 8 %r) unnamed_addr #2 !dbg !414 !guid !427 {
start:
  %r.dbg.spill = alloca [8 x i8], align 8
  %w.dbg.spill = alloca [32 x i8], align 16
  %e.dbg.spill = alloca [8 x i8], align 8
  %s.dbg.spill = alloca [16 x i8], align 8
  %n.dbg.spill = alloca [1 x i8], align 1
  %o.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [1 x i8], align 1
  store i8 %c, ptr %c.dbg.spill, align 1
    #dbg_declare(ptr %c.dbg.spill, !419, !DIExpression(), !428)
    #dbg_declare(ptr %t, !420, !DIExpression(), !428)
  store ptr %o, ptr %o.dbg.spill, align 8
    #dbg_declare(ptr %o.dbg.spill, !421, !DIExpression(), !428)
  store i8 %n, ptr %n.dbg.spill, align 1
    #dbg_declare(ptr %n.dbg.spill, !422, !DIExpression(), !428)
  store i64 %s.0, ptr %s.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i32 %s.1, ptr %0, align 8
    #dbg_declare(ptr %s.dbg.spill, !423, !DIExpression(), !428)
  store ptr %e, ptr %e.dbg.spill, align 8
    #dbg_declare(ptr %e.dbg.spill, !424, !DIExpression(), !428)
  store i128 %w.0, ptr %w.dbg.spill, align 16
  %1 = getelementptr inbounds i8, ptr %w.dbg.spill, i64 16
  store i8 %w.1, ptr %1, align 16
    #dbg_declare(ptr %w.dbg.spill, !425, !DIExpression(), !428)
  store ptr %r, ptr %r.dbg.spill, align 8
    #dbg_declare(ptr %r.dbg.spill, !426, !DIExpression(), !428)
  ret i32 0, !dbg !429
}

; Function Attrs: uwtable
define align 8 ptr @global() unnamed_addr #2 !dbg !430 !guid !433 {
start:
  ret ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL, !dbg !434
}

; Function Attrs: uwtable
define i32 @never(i1 zeroext %flag) unnamed_addr #2 !dbg !435 !guid !440 {
start:
  %flag.dbg.spill = alloca [1 x i8], align 1
  %0 = zext i1 %flag to i8
  store i8 %0, ptr %flag.dbg.spill, align 1
    #dbg_declare(ptr %flag.dbg.spill, !439, !DIExpression(), !441)
  br i1 %flag, label %bb1, label %bb2, !dbg !442

bb2:                                              ; preds = %start
  ret i32 1, !dbg !443

bb1:                                              ; preds = %start
; call types::diverge
  call void @_RNvCs15oYSsIuqjM_5types7diverge() #4, !dbg !444
  unreachable, !dbg !444
}

; Function Attrs: uwtable
define { ptr, ptr } @no_principal(ptr align 4 %x) unnamed_addr #2 !dbg !445 !guid !460 {
start:
  %x.dbg.spill = alloca [8 x i8], align 8
  store ptr %x, ptr %x.dbg.spill, align 8
    #dbg_declare(ptr %x.dbg.spill, !459, !DIExpression(), !461)
  %0 = insertvalue { ptr, ptr } poison, ptr %x, 0, !dbg !462
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.0, 1, !dbg !462
  ret { ptr, ptr } %1, !dbg !462
}

; Function Attrs: uwtable
define i32 @pointers(ptr align 8 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1, ptr %d.0, ptr align 8 %d.1, ptr %raw, ptr align 2 %m, ptr %f, ptr %op) unnamed_addr #2 !dbg !463 !guid !503 {
start:
  %op.dbg.spill = alloca [8 x i8], align 8
  %f.dbg.spill = alloca [8 x i8], align 8
  %m.dbg.spill = alloca [8 x i8], align 8
  %raw.dbg.spill = alloca [8 x i8], align 8
  %d.dbg.spill = alloca [16 x i8], align 8
  %s.dbg.spill = alloca [16 x i8], align 8
  %sl.dbg.spill = alloca [16 x i8], align 8
  store ptr %sl.0, ptr %sl.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %sl.dbg.spill, i64 8
  store i64 %sl.1, ptr %0, align 8
    #dbg_declare(ptr %sl.dbg.spill, !496, !DIExpression(), !504)
  store ptr %s.0, ptr %s.dbg.spill, align 8
  %1 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i64 %s.1, ptr %1, align 8
    #dbg_declare(ptr %s.dbg.spill, !497, !DIExpression(), !504)
  store ptr %d.0, ptr %d.dbg.spill, align 8
  %2 = getelementptr inbounds i8, ptr %d.dbg.spill, i64 8
  store ptr %d.1, ptr %2, align 8
    #dbg_declare(ptr %d.dbg.spill, !498, !DIExpression(), !504)
  store ptr %raw, ptr %raw.dbg.spill, align 8
    #dbg_declare(ptr %raw.dbg.spill, !499, !DIExpression(), !504)
  store ptr %m, ptr %m.dbg.spill, align 8
    #dbg_declare(ptr %m.dbg.spill, !500, !DIExpression(), !504)
  store ptr %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !501, !DIExpression(), !504)
  store ptr %op, ptr %op.dbg.spill, align 8
    #dbg_declare(ptr %op.dbg.spill, !502, !DIExpression(), !504)
  %3 = getelementptr inbounds i8, ptr %d.1, i64 24, !dbg !505
  %4 = load ptr, ptr %3, align 8, !dbg !505, !invariant.load !16, !nonnull !16
  %_0 = call i32 %4(ptr %d.0), !dbg !505
  ret i32 %_0, !dbg !506
}

; Function Attrs: uwtable
define i32 @recursive_fn_type() unnamed_addr #2 !dbg !507 !guid !510 {
start:
; call types::rec_impl
  call void @_RNvCs15oYSsIuqjM_5types8rec_impl(), !dbg !511
; call types::take::<types::rec_impl>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_(), !dbg !511
  ret i32 %_0, !dbg !512
}

; Function Attrs: uwtable
define i32 @structs(ptr align 8 %p, i64 %q.0, i16 %q.1, ptr align 4 %g, ptr align 8 %l) unnamed_addr #2 !dbg !513 !guid !538 {
start:
  %_u.dbg.spill = alloca [0 x i8], align 1
  %l.dbg.spill = alloca [8 x i8], align 8
  %_3.dbg.spill = alloca [0 x i8], align 1
  %q.dbg.spill = alloca [16 x i8], align 8
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !532, !DIExpression(), !539)
  store i64 %q.0, ptr %q.dbg.spill, align 8
  %0 = getelementptr inbounds i8, ptr %q.dbg.spill, i64 8
  store i16 %q.1, ptr %0, align 8
    #dbg_declare(ptr %q.dbg.spill, !533, !DIExpression(), !539)
    #dbg_declare(ptr %_3.dbg.spill, !537, !DIExpression(), !539)
    #dbg_declare(ptr %g, !535, !DIExpression(), !539)
  store ptr %l, ptr %l.dbg.spill, align 8
    #dbg_declare(ptr %l.dbg.spill, !536, !DIExpression(), !539)
    #dbg_declare(ptr %_u.dbg.spill, !534, !DIExpression(), !539)
  %1 = getelementptr inbounds i8, ptr %p, i64 12, !dbg !540
  %_6 = load i8, ptr %1, align 4, !dbg !540
  %_0 = zext i8 %_6 to i32, !dbg !540
  ret i32 %_0, !dbg !541
}

; Function Attrs: uwtable
define i32 @union_(i32 %0) unnamed_addr #2 !dbg !542 !guid !551 {
start:
  %1 = alloca [4 x i8], align 4
  %u = alloca [4 x i8], align 4
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 4 %u, ptr align 4 %1, i64 4, i1 false)
    #dbg_declare(ptr %u, !550, !DIExpression(), !552)
  %_0 = load i32, ptr %u, align 4, !dbg !553
  ret i32 %_0, !dbg !554
}

; Function Attrs: uwtable
define i8 @visibility(ptr %v) unnamed_addr #2 !dbg !555 !guid !568 {
start:
  %v.dbg.spill = alloca [8 x i8], align 8
  store ptr %v, ptr %v.dbg.spill, align 8
    #dbg_declare(ptr %v.dbg.spill, !567, !DIExpression(), !569)
  %0 = getelementptr inbounds i8, ptr %v, i64 3, !dbg !570
  %_0 = load i8, ptr %0, align 1, !dbg !570
  ret i8 %_0, !dbg !571
}

; Function Attrs: uwtable
define { ptr, ptr } @vtable(ptr align 8 %p) unnamed_addr #2 !dbg !572 !guid !577 {
start:
  %p.dbg.spill = alloca [8 x i8], align 8
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !576, !DIExpression(), !578)
  %0 = insertvalue { ptr, ptr } poison, ptr %p, 0, !dbg !579
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.1, 1, !dbg !579
  ret { ptr, ptr } %1, !dbg !579
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #3

attributes #0 = { noinline uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #1 = { noreturn uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #2 = { uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #3 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #4 = { noreturn }

!llvm.module.flags = !{!41, !42, !43, !44}
!llvm.ident = !{!45}
!llvm.dbg.cu = !{!46}

!0 = !DIGlobalVariableExpression(var: !1, expr: !DIExpression())
!1 = distinct !DIGlobalVariable(name: "GLOBAL", linkageName: "_RNvCs15oYSsIuqjM_5types6GLOBAL", scope: !2, file: !3, line: 114, type: !4, isLocal: false, isDefinition: true, align: 64)
!2 = !DINamespace(name: "types", scope: null)
!3 = !DIFile(filename: "types.rs", directory: ".", checksumkind: CSK_SHA256, checksum: "c08678894be596df936a93ac74430fa5d0444434a8e526b32f55975c64080c3b")
!4 = !DICompositeType(tag: DW_TAG_structure_type, name: "Point", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !6, templateParams: !16, identifier: "308b9833e873e4487af9ab3f6fc9138b")
!5 = !DIFile(filename: "<unknown>", directory: "")
!6 = !{!7, !10, !13}
!7 = !DIDerivedType(tag: DW_TAG_member, name: "x", scope: !4, file: !5, baseType: !8, size: 32, align: 32, offset: 64, flags: DIFlagPublic)
!8 = !DIDerivedType(tag: DW_TAG_typedef, name: "i32", file: !5, baseType: !9)
!9 = !DIBasicType(name: "__int32", size: 32, encoding: DW_ATE_signed)
!10 = !DIDerivedType(tag: DW_TAG_member, name: "y", scope: !4, file: !5, baseType: !11, size: 64, align: 64, flags: DIFlagPrivate)
!11 = !DIDerivedType(tag: DW_TAG_typedef, name: "f64", file: !5, baseType: !12)
!12 = !DIBasicType(name: "double", size: 64, encoding: DW_ATE_float)
!13 = !DIDerivedType(tag: DW_TAG_member, name: "z", scope: !4, file: !5, baseType: !14, size: 8, align: 8, offset: 96, flags: DIFlagPrivate)
!14 = !DIDerivedType(tag: DW_TAG_typedef, name: "u8", file: !5, baseType: !15)
!15 = !DIBasicType(name: "unsigned __int8", size: 8, encoding: DW_ATE_unsigned)
!16 = !{}
!17 = !{i64 -2440327355056123239}
!18 = !DIGlobalVariableExpression(var: !19, expr: !DIExpression())
!19 = distinct !DIGlobalVariable(name: "impl$<u32, _>::vtable$", scope: null, file: !5, type: !20, isLocal: true, isDefinition: true)
!20 = !DICompositeType(tag: DW_TAG_structure_type, name: "impl$<u32, _>::vtable_type$", file: !5, size: 192, align: 64, flags: DIFlagArtificial, elements: !21, vtableHolder: !29, templateParams: !16, identifier: "d853a453a803e41b742b60c4e025482d")
!21 = !{!22, !25, !28}
!22 = !DIDerivedType(tag: DW_TAG_member, name: "drop_in_place", scope: !20, file: !5, baseType: !23, size: 64, align: 64)
!23 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<tuple$<> >", baseType: !24, size: 64, align: 64, dwarfAddressSpace: 0)
!24 = !DICompositeType(tag: DW_TAG_structure_type, name: "tuple$<>", file: !5, align: 8, elements: !16, identifier: "46dc9fa5938407e177dc75118fa86611")
!25 = !DIDerivedType(tag: DW_TAG_member, name: "size", scope: !20, file: !5, baseType: !26, size: 64, align: 64, offset: 64)
!26 = !DIDerivedType(tag: DW_TAG_typedef, name: "usize", file: !5, baseType: !27)
!27 = !DIBasicType(name: "size_t", size: 64, encoding: DW_ATE_unsigned)
!28 = !DIDerivedType(tag: DW_TAG_member, name: "align", scope: !20, file: !5, baseType: !26, size: 64, align: 64, offset: 128)
!29 = !DIDerivedType(tag: DW_TAG_typedef, name: "u32", file: !5, baseType: !30)
!30 = !DIBasicType(name: "unsigned __int32", size: 32, encoding: DW_ATE_unsigned)
!31 = !{i64 -6426483837549638915}
!32 = !DIGlobalVariableExpression(var: !33, expr: !DIExpression())
!33 = distinct !DIGlobalVariable(name: "impl$<types::Point, types::Shape>::vtable$", scope: null, file: !5, type: !34, isLocal: true, isDefinition: true)
!34 = !DICompositeType(tag: DW_TAG_structure_type, name: "impl$<types::Point, types::Shape>::vtable_type$", file: !5, size: 256, align: 64, flags: DIFlagArtificial, elements: !35, vtableHolder: !4, templateParams: !16, identifier: "3d57a5951e71546da41ef57cf0b7bf59")
!35 = !{!36, !37, !38, !39}
!36 = !DIDerivedType(tag: DW_TAG_member, name: "drop_in_place", scope: !34, file: !5, baseType: !23, size: 64, align: 64)
!37 = !DIDerivedType(tag: DW_TAG_member, name: "size", scope: !34, file: !5, baseType: !26, size: 64, align: 64, offset: 64)
!38 = !DIDerivedType(tag: DW_TAG_member, name: "align", scope: !34, file: !5, baseType: !26, size: 64, align: 64, offset: 128)
!39 = !DIDerivedType(tag: DW_TAG_member, name: "__method3", scope: !34, file: !5, baseType: !23, size: 64, align: 64, offset: 192)
!40 = !{i64 -9115322521351085872}
!41 = !{i32 8, !"PIC Level", i32 2}
!42 = !{i32 7, !"uwtable", i32 2}
!43 = !{i32 2, !"CodeView", i32 1}
!44 = !{i32 2, !"Debug Info Version", i32 3}
!45 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!46 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !47, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, enums: !48, globals: !315, splitDebugInlining: false)
!47 = !DIFile(filename: "types.rs/@/types.ca9a2c18325d504-cgu.0", directory: ".")
!48 = !{!49, !54, !94, !122, !156, !173, !199, !226, !258, !286}
!49 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "CLike", scope: !2, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagEnumClass, elements: !50)
!50 = !{!51, !52, !53}
!51 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!52 = !DIEnumerator(name: "B", value: 5, isUnsigned: true)
!53 = !DIEnumerator(name: "C", value: 6, isUnsigned: true)
!54 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !55, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !90)
!55 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Tagged>", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !56, templateParams: !16, identifier: "7a09859a618fbf60b7f03e353ea66444")
!56 = !{!57, !70, !82, !89}
!57 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !55, file: !5, baseType: !58, size: 128, align: 64, flags: DIFlagPublic)
!58 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !55, file: !5, size: 128, align: 64, elements: !59, templateParams: !16, identifier: "ee6afa6597c5c511238fd6091a453dd0")
!59 = !{!60, !64, !66}
!60 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !58, file: !5, baseType: !61, size: 128, align: 64)
!61 = !DICompositeType(tag: DW_TAG_structure_type, name: "One", scope: !55, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !62, templateParams: !16, identifier: "c665cbede025898820f5e95706c59e3d")
!62 = !{!63}
!63 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !61, file: !5, baseType: !29, size: 32, align: 32, offset: 32, flags: DIFlagPublic)
!64 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !58, file: !5, baseType: !65, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!65 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !54)
!66 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !58, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!67 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !68)
!68 = !DIDerivedType(tag: DW_TAG_typedef, name: "u64", file: !5, baseType: !69)
!69 = !DIBasicType(name: "unsigned __int64", size: 64, encoding: DW_ATE_unsigned)
!70 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !55, file: !5, baseType: !71, size: 128, align: 64, flags: DIFlagPublic)
!71 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !55, file: !5, size: 128, align: 64, elements: !72, templateParams: !16, identifier: "536c0951f75c238db7d9756cb97e65a7")
!72 = !{!73, !80, !81}
!73 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !71, file: !5, baseType: !74, size: 128, align: 64)
!74 = !DICompositeType(tag: DW_TAG_structure_type, name: "Two", scope: !55, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !75, templateParams: !16, identifier: "c09a96c7dcac441a491510fc40babb8")
!75 = !{!76, !77}
!76 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !74, file: !5, baseType: !68, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!77 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !74, file: !5, baseType: !78, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!78 = !DIDerivedType(tag: DW_TAG_typedef, name: "i8", file: !5, baseType: !79)
!79 = !DIBasicType(name: "__int8", size: 8, encoding: DW_ATE_signed)
!80 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !71, file: !5, baseType: !65, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!81 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !71, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!82 = !DIDerivedType(tag: DW_TAG_member, name: "variant2", scope: !55, file: !5, baseType: !83, size: 128, align: 64, flags: DIFlagPublic)
!83 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant2", scope: !55, file: !5, size: 128, align: 64, elements: !84, templateParams: !16, identifier: "f964c8150a61fec8ea04ddd26999f105")
!84 = !{!85, !87, !88}
!85 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !83, file: !5, baseType: !86, size: 128, align: 64)
!86 = !DICompositeType(tag: DW_TAG_structure_type, name: "Three", scope: !55, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !16, identifier: "42f47fc3dc3096c640fb5aebb978d263")
!87 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !83, file: !5, baseType: !65, align: 32, flags: DIFlagStaticMember, extraData: i64 2)
!88 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !83, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 2)
!89 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !55, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!90 = !{!91, !92, !93}
!91 = !DIEnumerator(name: "One", value: 0, isUnsigned: true)
!92 = !DIEnumerator(name: "Two", value: 1, isUnsigned: true)
!93 = !DIEnumerator(name: "Three", value: 2, isUnsigned: true)
!94 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !95, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !119)
!95 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Option<ref$<u32> > >", file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !96, templateParams: !16, identifier: "ed51b03b247287f78ba1f38cb9acddcc")
!96 = !{!97, !108, !118}
!97 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !95, file: !5, baseType: !98, size: 64, align: 64, flags: DIFlagPublic)
!98 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !95, file: !5, size: 64, align: 64, elements: !99, templateParams: !16, identifier: "2faeaab8e93bbeda33244fb6069000b2")
!99 = !{!100, !105, !107}
!100 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !98, file: !5, baseType: !101, size: 64, align: 64)
!101 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !95, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !16, templateParams: !102, identifier: "f0a46f3663c63171c9dc683a6faecac0")
!102 = !{!103}
!103 = !DITemplateTypeParameter(name: "T", type: !104)
!104 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<u32>", baseType: !29, size: 64, align: 64, dwarfAddressSpace: 0)
!105 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !98, file: !5, baseType: !106, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!106 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !94)
!107 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !98, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!108 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !95, file: !5, baseType: !109, size: 64, align: 64, flags: DIFlagPublic)
!109 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !95, file: !5, size: 64, align: 64, elements: !110, templateParams: !16, identifier: "8886950086c89303465a304a65944084")
!110 = !{!111, !115, !116, !117}
!111 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !109, file: !5, baseType: !112, size: 64, align: 64)
!112 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !95, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !113, templateParams: !102, identifier: "8d7c597acf3c283f429ba8765eea1968")
!113 = !{!114}
!114 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !112, file: !5, baseType: !104, size: 64, align: 64, flags: DIFlagPublic)
!115 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !109, file: !5, baseType: !106, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!116 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !109, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!117 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !109, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!118 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !95, file: !5, baseType: !68, size: 64, align: 64, flags: DIFlagPublic)
!119 = !{!120, !121}
!120 = !DIEnumerator(name: "None", value: 0, isUnsigned: true)
!121 = !DIEnumerator(name: "Some", value: 1, isUnsigned: true)
!122 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !123, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !152)
!123 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Niche>", file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !124, templateParams: !16, identifier: "2e768aced9ebecf4f9b14578e52e8ced")
!124 = !{!125, !137, !144, !151}
!125 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !123, file: !5, baseType: !126, size: 8, align: 8, flags: DIFlagPublic)
!126 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !123, file: !5, size: 8, align: 8, elements: !127, templateParams: !16, identifier: "776932099d8beba7d6429ebaa1518b33")
!127 = !{!128, !133, !135, !136}
!128 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !126, file: !5, baseType: !129, size: 8, align: 8)
!129 = !DICompositeType(tag: DW_TAG_structure_type, name: "A", scope: !123, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !130, templateParams: !16, identifier: "199633efd9ee9f6fc1ce5b3db71839a8")
!130 = !{!131}
!131 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !129, file: !5, baseType: !132, size: 8, align: 8, flags: DIFlagPublic)
!132 = !DIBasicType(name: "bool", size: 8, encoding: DW_ATE_boolean)
!133 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !126, file: !5, baseType: !134, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!134 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !122)
!135 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !126, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!136 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !126, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!137 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !123, file: !5, baseType: !138, size: 8, align: 8, flags: DIFlagPublic)
!138 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !123, file: !5, size: 8, align: 8, elements: !139, templateParams: !16, identifier: "e82b86ae321196fa3194e9125df57f63")
!139 = !{!140, !142, !143}
!140 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !138, file: !5, baseType: !141, size: 8, align: 8)
!141 = !DICompositeType(tag: DW_TAG_structure_type, name: "B", scope: !123, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !16, identifier: "79e87793cf0c2eacd81fa34d6de2e77")
!142 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !138, file: !5, baseType: !134, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!143 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !138, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 2)
!144 = !DIDerivedType(tag: DW_TAG_member, name: "variant2", scope: !123, file: !5, baseType: !145, size: 8, align: 8, flags: DIFlagPublic)
!145 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant2", scope: !123, file: !5, size: 8, align: 8, elements: !146, templateParams: !16, identifier: "89995eab01536e11f33c404f42bc10ff")
!146 = !{!147, !149, !150}
!147 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !145, file: !5, baseType: !148, size: 8, align: 8)
!148 = !DICompositeType(tag: DW_TAG_structure_type, name: "C", scope: !123, file: !5, size: 8, align: 8, flags: DIFlagPublic, elements: !16, identifier: "c68aa38615ac2ea80174f362c1f697a")
!149 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !145, file: !5, baseType: !134, align: 32, flags: DIFlagStaticMember, extraData: i64 2)
!150 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !145, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 3)
!151 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !123, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!152 = !{!153, !154, !155}
!153 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!154 = !DIEnumerator(name: "B", value: 1, isUnsigned: true)
!155 = !DIEnumerator(name: "C", value: 2, isUnsigned: true)
!156 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !157, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !171)
!157 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Single>", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !158, templateParams: !16, identifier: "99e2882fa157a99c759e60ab9c3b3f65")
!158 = !{!159, !170}
!159 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !157, file: !5, baseType: !160, size: 128, align: 64, flags: DIFlagPublic)
!160 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !157, file: !5, size: 128, align: 64, elements: !161, templateParams: !16, identifier: "2a375f42d5ee6b6b6fe1fae3b3c85a3e")
!161 = !{!162, !167, !169}
!162 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !160, file: !5, baseType: !163, size: 128, align: 64)
!163 = !DICompositeType(tag: DW_TAG_structure_type, name: "Only", scope: !157, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !164, templateParams: !16, identifier: "d78e06573f5341017ca9ac123671afa6")
!164 = !{!165, !166}
!165 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !163, file: !5, baseType: !29, size: 32, align: 32, offset: 64, flags: DIFlagPublic)
!166 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !163, file: !5, baseType: !68, size: 64, align: 64, flags: DIFlagPublic)
!167 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !160, file: !5, baseType: !168, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!168 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !156)
!169 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !160, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!170 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !157, file: !5, baseType: !156, align: 32, flags: DIFlagPublic | DIFlagStaticMember, extraData: i64 0)
!171 = !{!172}
!172 = !DIEnumerator(name: "Only", value: 0, isUnsigned: true)
!173 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !174, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !119)
!174 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Option<ref$<enum2$<types::Empty> > > >", file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !175, templateParams: !16, identifier: "9ec6ad741cd0cf6e134acb98a307d263")
!175 = !{!176, !188, !198}
!176 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !174, file: !5, baseType: !177, size: 64, align: 64, flags: DIFlagPublic)
!177 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !174, file: !5, size: 64, align: 64, elements: !178, templateParams: !16, identifier: "636c5c69b8529124c1f2590eac869412")
!178 = !{!179, !185, !187}
!179 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !177, file: !5, baseType: !180, size: 64, align: 64)
!180 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !174, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !16, templateParams: !181, identifier: "40e79cf9f10dccd63132410c3a601fa7")
!181 = !{!182}
!182 = !DITemplateTypeParameter(name: "T", type: !183)
!183 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<enum2$<types::Empty> >", baseType: !184, size: 64, align: 64, dwarfAddressSpace: 0)
!184 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Empty>", file: !5, align: 8, flags: DIFlagPublic, elements: !16, identifier: "64e96f3ce920dff82e10d4b6a35be4fb")
!185 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !177, file: !5, baseType: !186, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!186 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !173)
!187 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !177, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!188 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !174, file: !5, baseType: !189, size: 64, align: 64, flags: DIFlagPublic)
!189 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !174, file: !5, size: 64, align: 64, elements: !190, templateParams: !16, identifier: "487d2207a7f22fc42dc9e77e35717cd8")
!190 = !{!191, !195, !196, !197}
!191 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !189, file: !5, baseType: !192, size: 64, align: 64)
!192 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !174, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !193, templateParams: !181, identifier: "d733b5aa48f30b7797ac71a20eabbe3c")
!193 = !{!194}
!194 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !192, file: !5, baseType: !183, size: 64, align: 64, flags: DIFlagPublic)
!195 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !189, file: !5, baseType: !186, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!196 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !189, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!197 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !189, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!198 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !174, file: !5, baseType: !68, size: 64, align: 64, flags: DIFlagPublic)
!199 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !200, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !223)
!200 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Wide>", file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !201, templateParams: !16, identifier: "580c897493afe5768312143f2fc7c866")
!201 = !{!202, !213, !221, !222}
!202 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !200, file: !5, baseType: !203, size: 256, align: 128, flags: DIFlagPublic)
!203 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !200, file: !5, size: 256, align: 128, elements: !204, templateParams: !16, identifier: "158ca601276ea566e6f37fb1849a6cec")
!204 = !{!205, !209, !211, !212}
!205 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !203, file: !5, baseType: !206, size: 256, align: 128)
!206 = !DICompositeType(tag: DW_TAG_structure_type, name: "X", scope: !200, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !207, templateParams: !16, identifier: "edbe3ce3537b8454a1586fee1f8f976f")
!207 = !{!208}
!208 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !206, file: !5, baseType: !14, size: 8, align: 8, offset: 128, flags: DIFlagPublic)
!209 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !203, file: !5, baseType: !210, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!210 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !199)
!211 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_LO", scope: !203, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!212 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_HI", scope: !203, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!213 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !200, file: !5, baseType: !214, size: 256, align: 128, flags: DIFlagPublic)
!214 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !200, file: !5, size: 256, align: 128, elements: !215, templateParams: !16, identifier: "742bb51d783f318f3eea38fc782f2157")
!215 = !{!216, !218, !219, !220}
!216 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !214, file: !5, baseType: !217, size: 256, align: 128)
!217 = !DICompositeType(tag: DW_TAG_structure_type, name: "Y", scope: !200, file: !5, size: 256, align: 128, flags: DIFlagPublic, elements: !16, identifier: "af4b7981b1de14baf478bdaf175e1a20")
!218 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !214, file: !5, baseType: !210, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!219 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_LO", scope: !214, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!220 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR128_EXACT_HI", scope: !214, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 65535)
!221 = !DIDerivedType(tag: DW_TAG_member, name: "tag128_lo", scope: !200, file: !5, baseType: !68, size: 64, align: 64, flags: DIFlagPublic)
!222 = !DIDerivedType(tag: DW_TAG_member, name: "tag128_hi", scope: !200, file: !5, baseType: !68, size: 64, align: 64, offset: 64)
!223 = !{!224, !225}
!224 = !DIEnumerator(name: "X", value: 0, isUnsigned: true)
!225 = !DIEnumerator(name: "Y", value: 1, isUnsigned: true)
!226 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !227, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !259)
!227 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Rec<u8> >", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !228, templateParams: !16, identifier: "bdcb87c0e6172cf96ca64813776a9af5")
!228 = !{!229, !276, !285}
!229 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !227, file: !5, baseType: !230, size: 128, align: 64, flags: DIFlagPublic)
!230 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !227, file: !5, size: 128, align: 64, elements: !231, templateParams: !16, identifier: "ce59f0381887f818216ec4bb73bc00")
!231 = !{!232, !273, !275}
!232 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !230, file: !5, baseType: !233, size: 128, align: 64)
!233 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !227, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !234, templateParams: !254, identifier: "47d9e89338842c2a9b75f1a10a02ddd8")
!234 = !{!235}
!235 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !233, file: !5, baseType: !236, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!236 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<enum2$<types::Rec<types::Pair2<u8> > > >", baseType: !237, size: 64, align: 64, dwarfAddressSpace: 0)
!237 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Rec<types::Pair2<u8> > >", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !238, templateParams: !16, identifier: "5ede9f07d678e971a0ca7153f666e62")
!238 = !{!239, !263, !272}
!239 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !237, file: !5, baseType: !240, size: 128, align: 64, flags: DIFlagPublic)
!240 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !237, file: !5, size: 128, align: 64, elements: !241, templateParams: !16, identifier: "51a4b67288e271768cd7559ad32b756d")
!241 = !{!242, !256, !262}
!242 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !240, file: !5, baseType: !243, size: 128, align: 64)
!243 = !DICompositeType(tag: DW_TAG_structure_type, name: "Recurse", scope: !237, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !244, templateParams: !248, identifier: "ade1e3fa13f1df495ef599f3dbd8a94c")
!244 = !{!245}
!245 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !243, file: !5, baseType: !246, size: 64, align: 64, offset: 64, flags: DIFlagPublic)
!246 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<enum2$<types::Rec<types::Pair2<types::Pair2<u8> > > > >", baseType: !247, size: 64, align: 64, dwarfAddressSpace: 0)
!247 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Rec<types::Pair2<types::Pair2<u8> > > >", file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !16, identifier: "54791e7a79c18c75653e890640491966")
!248 = !{!249}
!249 = !DITemplateTypeParameter(name: "T", type: !250)
!250 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair2<u8>", scope: !2, file: !5, size: 16, align: 8, flags: DIFlagPublic, elements: !251, templateParams: !254, identifier: "317b48cb039e3e7fb5a8fbd2cc6135a5")
!251 = !{!252, !253}
!252 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !250, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPrivate)
!253 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !250, file: !5, baseType: !14, size: 8, align: 8, offset: 8, flags: DIFlagPrivate)
!254 = !{!255}
!255 = !DITemplateTypeParameter(name: "T", type: !14)
!256 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !240, file: !5, baseType: !257, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!257 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !258)
!258 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !237, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !259)
!259 = !{!260, !261}
!260 = !DIEnumerator(name: "Recurse", value: 0, isUnsigned: true)
!261 = !DIEnumerator(name: "Item", value: 1, isUnsigned: true)
!262 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !240, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!263 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !237, file: !5, baseType: !264, size: 128, align: 64, flags: DIFlagPublic)
!264 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !237, file: !5, size: 128, align: 64, elements: !265, templateParams: !16, identifier: "a3513a087c97e1eea2d98407ab9e9553")
!265 = !{!266, !270, !271}
!266 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !264, file: !5, baseType: !267, size: 128, align: 64)
!267 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !237, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !268, templateParams: !248, identifier: "cee43346f500b874e72e06bc2d9e234a")
!268 = !{!269}
!269 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !267, file: !5, baseType: !250, size: 16, align: 8, offset: 8, flags: DIFlagPublic)
!270 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !264, file: !5, baseType: !257, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!271 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !264, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!272 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !237, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!273 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !230, file: !5, baseType: !274, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!274 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !226)
!275 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !230, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!276 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !227, file: !5, baseType: !277, size: 128, align: 64, flags: DIFlagPublic)
!277 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !227, file: !5, size: 128, align: 64, elements: !278, templateParams: !16, identifier: "303afcd472797dc2e9a9c07349eae2a5")
!278 = !{!279, !283, !284}
!279 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !277, file: !5, baseType: !280, size: 128, align: 64)
!280 = !DICompositeType(tag: DW_TAG_structure_type, name: "Item", scope: !227, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !281, templateParams: !254, identifier: "8bbff529e44d2a45a49c95f6b6c9380")
!281 = !{!282}
!282 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !280, file: !5, baseType: !14, size: 8, align: 8, offset: 8, flags: DIFlagPublic)
!283 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !277, file: !5, baseType: !274, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!284 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !277, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!285 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !227, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagPublic)
!286 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !287, file: !5, baseType: !29, size: 32, align: 32, flags: DIFlagEnumClass, elements: !119)
!287 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<types::Option<ref$<types::List> > >", file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !288, templateParams: !16, identifier: "81608bde9c02ca68284619d5a8da3749")
!288 = !{!289, !304, !314}
!289 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !287, file: !5, baseType: !290, size: 64, align: 64, flags: DIFlagPublic)
!290 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !287, file: !5, size: 64, align: 64, elements: !291, templateParams: !16, identifier: "6c66799f47f97586bba62e66f13e5814")
!291 = !{!292, !301, !303}
!292 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !290, file: !5, baseType: !293, size: 64, align: 64)
!293 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !287, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !16, templateParams: !294, identifier: "e1386b739e649cc1b2ae583acd057ecc")
!294 = !{!295}
!295 = !DITemplateTypeParameter(name: "T", type: !296)
!296 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::List>", baseType: !297, size: 64, align: 64, dwarfAddressSpace: 0)
!297 = !DICompositeType(tag: DW_TAG_structure_type, name: "List", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !298, templateParams: !16, identifier: "784c52a69e4fd732fc2cb610c53ce42b")
!298 = !{!299, !300}
!299 = !DIDerivedType(tag: DW_TAG_member, name: "next", scope: !297, file: !5, baseType: !287, size: 64, align: 64, flags: DIFlagPrivate)
!300 = !DIDerivedType(tag: DW_TAG_member, name: "v", scope: !297, file: !5, baseType: !8, size: 32, align: 32, offset: 64, flags: DIFlagPrivate)
!301 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !290, file: !5, baseType: !302, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!302 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !286)
!303 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !290, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!304 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !287, file: !5, baseType: !305, size: 64, align: 64, flags: DIFlagPublic)
!305 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !287, file: !5, size: 64, align: 64, elements: !306, templateParams: !16, identifier: "6ee29b602a08e95f50e3dfe033101764")
!306 = !{!307, !311, !312, !313}
!307 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !305, file: !5, baseType: !308, size: 64, align: 64)
!308 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !287, file: !5, size: 64, align: 64, flags: DIFlagPublic, elements: !309, templateParams: !294, identifier: "89da0816b97d49e3dac2e41fc3e93b83")
!309 = !{!310}
!310 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !308, file: !5, baseType: !296, size: 64, align: 64, flags: DIFlagPublic)
!311 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !305, file: !5, baseType: !302, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!312 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_BEGIN", scope: !305, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!313 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_END", scope: !305, file: !5, baseType: !67, align: 64, flags: DIFlagStaticMember, extraData: i64 -1)
!314 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !287, file: !5, baseType: !68, size: 64, align: 64, flags: DIFlagPublic)
!315 = !{!0, !18, !32}
!316 = distinct !DISubprogram(name: "take<types::closure::closure_env$0>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_", scope: !2, file: !3, line: 156, type: !317, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !46, templateParams: !325, retainedNodes: !323)
!317 = !DISubroutineType(types: !318)
!318 = !{!29, !319}
!319 = !DICompositeType(tag: DW_TAG_structure_type, name: "closure_env$0", scope: !320, file: !5, size: 32, align: 32, elements: !321, templateParams: !16, identifier: "fc485e4bf1acde5e12ed9b065b27b2ae")
!320 = !DINamespace(name: "closure", scope: !2)
!321 = !{!322}
!322 = !DIDerivedType(tag: DW_TAG_member, name: "x", scope: !319, file: !5, baseType: !29, size: 32, align: 32)
!323 = !{!324}
!324 = !DILocalVariable(name: "t", arg: 1, scope: !316, file: !3, line: 156, type: !319)
!325 = !{!326}
!326 = !DITemplateTypeParameter(name: "T", type: !319)
!327 = !{i64 1915899645086356215}
!328 = !DILocation(line: 156, scope: !316)
!329 = !DILocation(line: 159, scope: !316)
!330 = distinct !DISubprogram(name: "take<recursive_type$ (*)()>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_", scope: !2, file: !3, line: 156, type: !331, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !46, templateParams: !339, retainedNodes: !337)
!331 = !DISubroutineType(types: !332)
!332 = !{!29, !333}
!333 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "recursive_type$ (*)()", baseType: !334, align: 8, dwarfAddressSpace: 0)
!334 = !DISubroutineType(types: !335)
!335 = !{!336}
!336 = !DIBasicType(name: "<recur_type>", size: 64, encoding: DW_ATE_unsigned)
!337 = !{!338}
!338 = !DILocalVariable(name: "t", arg: 1, scope: !330, file: !3, line: 156, type: !333)
!339 = !{!340}
!340 = !DITemplateTypeParameter(name: "T", type: !333)
!341 = !{i64 -740690765248574201}
!342 = !DILocation(line: 156, scope: !330)
!343 = !DILocation(line: 159, scope: !330)
!344 = distinct !DISubprogram(name: "diverge", linkageName: "_RNvCs15oYSsIuqjM_5types7diverge", scope: !2, file: !3, line: 147, type: !345, scopeLine: 147, flags: DIFlagPrototyped | DIFlagNoReturn, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !46, templateParams: !16)
!345 = !DISubroutineType(types: !346)
!346 = !{null}
!347 = !{i64 3518661633375468340}
!348 = !DILocation(line: 148, scope: !344)
!349 = distinct !DISubprogram(name: "rec_impl", linkageName: "_RNvCs15oYSsIuqjM_5types8rec_impl", scope: !2, file: !3, line: 173, type: !345, scopeLine: 173, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16)
!350 = !{i64 73545626838823865}
!351 = !DILocation(line: 175, scope: !349)
!352 = distinct !DISubprogram(name: "area", linkageName: "_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area", scope: !353, file: !3, line: 109, type: !354, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !357)
!353 = !DINamespace(name: "impl$9", scope: !2)
!354 = !DISubroutineType(types: !355)
!355 = !{!29, !356}
!356 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::Point>", baseType: !4, size: 64, align: 64, dwarfAddressSpace: 0)
!357 = !{!358}
!358 = !DILocalVariable(name: "self", arg: 1, scope: !352, file: !3, line: 109, type: !356)
!359 = !{i64 -4356820192056016148}
!360 = !DILocation(line: 109, scope: !352)
!361 = !DILocation(line: 110, scope: !352)
!362 = !DILocation(line: 111, scope: !352)
!363 = distinct !DISubprogram(name: "basics", scope: !2, file: !3, line: 132, type: !364, scopeLine: 132, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !384)
!364 = !DISubroutineType(types: !365)
!365 = !{!29, !78, !68, !366, !11, !368, !26, !370, !372, !374, !379, !24, !383}
!366 = !DIDerivedType(tag: DW_TAG_typedef, name: "f32", file: !5, baseType: !367)
!367 = !DIBasicType(name: "float", size: 32, encoding: DW_ATE_float)
!368 = !DIDerivedType(tag: DW_TAG_typedef, name: "isize", file: !5, baseType: !369)
!369 = !DIBasicType(name: "ptrdiff_t", size: 64, encoding: DW_ATE_signed)
!370 = !DIDerivedType(tag: DW_TAG_typedef, name: "i128", file: !5, baseType: !371)
!371 = !DIBasicType(name: "__int128", size: 128, encoding: DW_ATE_signed)
!372 = !DIDerivedType(tag: DW_TAG_typedef, name: "u128", file: !5, baseType: !373)
!373 = !DIBasicType(name: "unsigned __int128", size: 128, encoding: DW_ATE_unsigned)
!374 = !DICompositeType(tag: DW_TAG_structure_type, name: "f16", file: !5, size: 16, align: 16, elements: !375, templateParams: !16, identifier: "482f2e429f63994a77033c9b9fb4ec97")
!375 = !{!376}
!376 = !DIDerivedType(tag: DW_TAG_member, name: "bits", scope: !374, file: !5, baseType: !377, size: 16, align: 16)
!377 = !DIDerivedType(tag: DW_TAG_typedef, name: "u16", file: !5, baseType: !378)
!378 = !DIBasicType(name: "unsigned __int16", size: 16, encoding: DW_ATE_unsigned)
!379 = !DICompositeType(tag: DW_TAG_structure_type, name: "f128", file: !5, size: 128, align: 128, elements: !380, templateParams: !16, identifier: "6f7b65fc657167ba766cd5847c5d14a0")
!380 = !{!381, !382}
!381 = !DIDerivedType(tag: DW_TAG_member, name: "low_bits", scope: !379, file: !5, baseType: !68, size: 64, align: 64)
!382 = !DIDerivedType(tag: DW_TAG_member, name: "high_bits", scope: !379, file: !5, baseType: !68, size: 64, align: 64, offset: 64)
!383 = !DIBasicType(name: "char", size: 32, encoding: DW_ATE_UTF)
!384 = !{!385, !386, !387, !388, !389, !390, !391, !392, !393, !394, !395, !396, !397}
!385 = !DILocalVariable(name: "a", arg: 1, scope: !363, file: !3, line: 132, type: !78)
!386 = !DILocalVariable(name: "b", arg: 2, scope: !363, file: !3, line: 132, type: !68)
!387 = !DILocalVariable(name: "c", arg: 3, scope: !363, file: !3, line: 132, type: !366)
!388 = !DILocalVariable(name: "d", arg: 4, scope: !363, file: !3, line: 132, type: !11)
!389 = !DILocalVariable(name: "e", arg: 5, scope: !363, file: !3, line: 132, type: !368)
!390 = !DILocalVariable(name: "f", arg: 6, scope: !363, file: !3, line: 132, type: !26)
!391 = !DILocalVariable(name: "g", arg: 7, scope: !363, file: !3, line: 132, type: !370)
!392 = !DILocalVariable(name: "h", arg: 8, scope: !363, file: !3, line: 132, type: !372)
!393 = !DILocalVariable(name: "i", arg: 9, scope: !363, file: !3, line: 132, type: !374)
!394 = !DILocalVariable(name: "j", arg: 10, scope: !363, file: !3, line: 132, type: !379)
!395 = !DILocalVariable(name: "k", scope: !363, file: !3, line: 132, type: !24, align: 8)
!396 = !DILocalVariable(name: "l", arg: 12, scope: !363, file: !3, line: 132, type: !383)
!397 = !DILocalVariable(arg: 11, scope: !363, file: !3, line: 132, type: !24)
!398 = !{i64 -5181654353206422152}
!399 = !DILocation(line: 132, scope: !363)
!400 = !DILocation(line: 135, scope: !363)
!401 = distinct !DISubprogram(name: "closure", scope: !2, file: !3, line: 151, type: !402, scopeLine: 151, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !404)
!402 = !DISubroutineType(types: !403)
!403 = !{!29, !29}
!404 = !{!405, !406}
!405 = !DILocalVariable(name: "x", arg: 1, scope: !401, file: !3, line: 151, type: !29)
!406 = !DILocalVariable(name: "c", scope: !407, file: !3, line: 152, type: !319, align: 32)
!407 = distinct !DILexicalBlock(scope: !401, file: !3, line: 152)
!408 = !{i64 -8001930764763462056}
!409 = !DILocation(line: 151, scope: !401)
!410 = !DILocation(line: 152, scope: !401)
!411 = !DILocation(line: 152, scope: !407)
!412 = !DILocation(line: 153, scope: !407)
!413 = !DILocation(line: 154, scope: !401)
!414 = distinct !DISubprogram(name: "enums", scope: !2, file: !3, line: 122, type: !415, scopeLine: 122, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !418)
!415 = !DISubroutineType(types: !416)
!416 = !{!29, !49, !55, !95, !123, !157, !174, !200, !417}
!417 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<enum2$<types::Rec<u8> > >", baseType: !227, size: 64, align: 64, dwarfAddressSpace: 0)
!418 = !{!419, !420, !421, !422, !423, !424, !425, !426}
!419 = !DILocalVariable(name: "c", arg: 1, scope: !414, file: !3, line: 122, type: !49)
!420 = !DILocalVariable(name: "t", arg: 2, scope: !414, file: !3, line: 122, type: !55)
!421 = !DILocalVariable(name: "o", arg: 3, scope: !414, file: !3, line: 122, type: !95)
!422 = !DILocalVariable(name: "n", arg: 4, scope: !414, file: !3, line: 122, type: !123)
!423 = !DILocalVariable(name: "s", scope: !414, file: !3, line: 122, type: !157, align: 64)
!424 = !DILocalVariable(name: "e", arg: 6, scope: !414, file: !3, line: 122, type: !174)
!425 = !DILocalVariable(name: "w", scope: !414, file: !3, line: 122, type: !200, align: 128)
!426 = !DILocalVariable(name: "r", arg: 8, scope: !414, file: !3, line: 122, type: !417)
!427 = !{i64 -6981848288932498368}
!428 = !DILocation(line: 122, scope: !414)
!429 = !DILocation(line: 125, scope: !414)
!430 = distinct !DISubprogram(name: "global", scope: !2, file: !3, line: 170, type: !431, scopeLine: 170, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16)
!431 = !DISubroutineType(types: !432)
!432 = !{!356}
!433 = !{i64 7866218443099566236}
!434 = !DILocation(line: 172, scope: !430)
!435 = distinct !DISubprogram(name: "never", scope: !2, file: !3, line: 141, type: !436, scopeLine: 141, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !438)
!436 = !DISubroutineType(types: !437)
!437 = !{!29, !132}
!438 = !{!439}
!439 = !DILocalVariable(name: "flag", arg: 1, scope: !435, file: !3, line: 141, type: !132)
!440 = !{i64 4169515925740803783}
!441 = !DILocation(line: 141, scope: !435)
!442 = !DILocation(line: 142, scope: !435)
!443 = !DILocation(line: 146, scope: !435)
!444 = !DILocation(line: 143, scope: !435)
!445 = distinct !DISubprogram(name: "no_principal", scope: !2, file: !3, line: 166, type: !446, scopeLine: 166, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !458)
!446 = !DISubroutineType(types: !447)
!447 = !{!448, !104}
!448 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<dyn$<types::Sync> >", file: !5, size: 128, align: 64, elements: !449, templateParams: !16, identifier: "c885107d35bcd1fca3520397c2790ef9")
!449 = !{!450, !453}
!450 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !448, file: !5, baseType: !451, size: 64, align: 64)
!451 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !452, size: 64, align: 64, dwarfAddressSpace: 0)
!452 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn$<types::Sync>", file: !5, align: 8, elements: !16, identifier: "b0f94999abdbb52473f42d5bdd51018d")
!453 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !448, file: !5, baseType: !454, size: 64, align: 64, offset: 64)
!454 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<array$<usize,3> >", baseType: !455, size: 64, align: 64, dwarfAddressSpace: 0)
!455 = !DICompositeType(tag: DW_TAG_array_type, baseType: !26, size: 192, align: 64, elements: !456)
!456 = !{!457}
!457 = !DISubrange(count: 3, lowerBound: 0)
!458 = !{!459}
!459 = !DILocalVariable(name: "x", arg: 1, scope: !445, file: !3, line: 166, type: !104)
!460 = !{i64 -9201868857759523069}
!461 = !DILocation(line: 166, scope: !445)
!462 = !DILocation(line: 168, scope: !445)
!463 = distinct !DISubprogram(name: "pointers", scope: !2, file: !3, line: 127, type: !464, scopeLine: 127, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !495)
!464 = !DISubroutineType(types: !465)
!465 = !{!29, !466, !473, !478, !488, !489, !491, !492}
!466 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<slice2$<i64> >", file: !5, size: 128, align: 64, elements: !467, templateParams: !16, identifier: "b4a8090213073d4713897d6f185bba6b")
!467 = !{!468, !472}
!468 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !466, file: !5, baseType: !469, size: 64, align: 64)
!469 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !470, size: 64, align: 64, dwarfAddressSpace: 0)
!470 = !DIDerivedType(tag: DW_TAG_typedef, name: "i64", file: !5, baseType: !471)
!471 = !DIBasicType(name: "__int64", size: 64, encoding: DW_ATE_signed)
!472 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !466, file: !5, baseType: !26, size: 64, align: 64, offset: 64)
!473 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<str$>", file: !5, size: 128, align: 64, elements: !474, templateParams: !16, identifier: "6fc9dd7daffb1f73292744aea0793200")
!474 = !{!475, !477}
!475 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !473, file: !5, baseType: !476, size: 64, align: 64)
!476 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !14, size: 64, align: 64, dwarfAddressSpace: 0)
!477 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !473, file: !5, baseType: !26, size: 64, align: 64, offset: 64)
!478 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<dyn$<types::Shape> >", file: !5, size: 128, align: 64, elements: !479, templateParams: !16, identifier: "fe29d79d289ba2d7e0ec59f2c9f4dc75")
!479 = !{!480, !483}
!480 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !478, file: !5, baseType: !481, size: 64, align: 64)
!481 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !482, size: 64, align: 64, dwarfAddressSpace: 0)
!482 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn$<types::Shape>", file: !5, align: 8, elements: !16, identifier: "b991d0562d06e41c69a1bb075371dbaa")
!483 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !478, file: !5, baseType: !484, size: 64, align: 64, offset: 64)
!484 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<array$<usize,4> >", baseType: !485, size: 64, align: 64, dwarfAddressSpace: 0)
!485 = !DICompositeType(tag: DW_TAG_array_type, baseType: !26, size: 256, align: 64, elements: !486)
!486 = !{!487}
!487 = !DISubrange(count: 4, lowerBound: 0)
!488 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<u8>", baseType: !14, size: 64, align: 64, dwarfAddressSpace: 0)
!489 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref_mut$<array$<u16,4> >", baseType: !490, size: 64, align: 64, dwarfAddressSpace: 0)
!490 = !DICompositeType(tag: DW_TAG_array_type, baseType: !377, size: 64, align: 16, elements: !486)
!491 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "u32 (*)(u32)", baseType: !402, size: 64, align: 64, dwarfAddressSpace: 0)
!492 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::extern$0::Opaque>", baseType: !493, size: 64, align: 64, dwarfAddressSpace: 0)
!493 = !DICompositeType(tag: DW_TAG_structure_type, name: "Opaque", scope: !494, file: !5, align: 8, elements: !16, identifier: "a3877f7c886e7d8757337d2282356247")
!494 = !DINamespace(name: "extern$0", scope: !2)
!495 = !{!496, !497, !498, !499, !500, !501, !502}
!496 = !DILocalVariable(name: "sl", scope: !463, file: !3, line: 127, type: !466, align: 64)
!497 = !DILocalVariable(name: "s", scope: !463, file: !3, line: 127, type: !473, align: 64)
!498 = !DILocalVariable(name: "d", scope: !463, file: !3, line: 127, type: !478, align: 64)
!499 = !DILocalVariable(name: "raw", arg: 4, scope: !463, file: !3, line: 127, type: !488)
!500 = !DILocalVariable(name: "m", arg: 5, scope: !463, file: !3, line: 127, type: !489)
!501 = !DILocalVariable(name: "f", arg: 6, scope: !463, file: !3, line: 127, type: !491)
!502 = !DILocalVariable(name: "op", arg: 7, scope: !463, file: !3, line: 127, type: !492)
!503 = !{i64 5285204393774026867}
!504 = !DILocation(line: 127, scope: !463)
!505 = !DILocation(line: 129, scope: !463)
!506 = !DILocation(line: 130, scope: !463)
!507 = distinct !DISubprogram(name: "recursive_fn_type", scope: !2, file: !3, line: 177, type: !508, scopeLine: 177, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16)
!508 = !DISubroutineType(types: !509)
!509 = !{!29}
!510 = !{i64 -4635464101160348947}
!511 = !DILocation(line: 178, scope: !507)
!512 = !DILocation(line: 179, scope: !507)
!513 = distinct !DISubprogram(name: "structs", scope: !2, file: !3, line: 117, type: !514, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !531)
!514 = !DISubroutineType(types: !515)
!515 = !{!29, !356, !516, !520, !521, !296}
!516 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair", scope: !2, file: !5, size: 128, align: 64, flags: DIFlagPublic, elements: !517, templateParams: !16, identifier: "94ca5408626465f7a23119eb31190947")
!517 = !{!518, !519}
!518 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !516, file: !5, baseType: !377, size: 16, align: 16, offset: 64, flags: DIFlagPublic)
!519 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !516, file: !5, baseType: !470, size: 64, align: 64, flags: DIFlagPrivate)
!520 = !DICompositeType(tag: DW_TAG_structure_type, name: "Unit", scope: !2, file: !5, align: 8, flags: DIFlagPublic, elements: !16, identifier: "b08e6297ec0e9e2a1f0a6ab3d7c35d9b")
!521 = !DICompositeType(tag: DW_TAG_structure_type, name: "Gen<u8,tuple$<char,bool> >", scope: !2, file: !5, size: 96, align: 32, flags: DIFlagPublic, elements: !522, templateParams: !529, identifier: "5a83877b5744ceaeffe9ee3edc8fae67")
!522 = !{!523, !524}
!523 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !521, file: !5, baseType: !14, size: 8, align: 8, offset: 64, flags: DIFlagPrivate)
!524 = !DIDerivedType(tag: DW_TAG_member, name: "u", scope: !521, file: !5, baseType: !525, size: 64, align: 32, flags: DIFlagPrivate)
!525 = !DICompositeType(tag: DW_TAG_structure_type, name: "tuple$<char,bool>", file: !5, size: 64, align: 32, elements: !526, templateParams: !16, identifier: "23b612e9e1a9e610ca072c9f53b8f4c4")
!526 = !{!527, !528}
!527 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !525, file: !5, baseType: !383, size: 32, align: 32)
!528 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !525, file: !5, baseType: !132, size: 8, align: 8, offset: 32)
!529 = !{!255, !530}
!530 = !DITemplateTypeParameter(name: "U", type: !525)
!531 = !{!532, !533, !534, !535, !536, !537}
!532 = !DILocalVariable(name: "p", arg: 1, scope: !513, file: !3, line: 117, type: !356)
!533 = !DILocalVariable(name: "q", scope: !513, file: !3, line: 117, type: !516, align: 64)
!534 = !DILocalVariable(name: "_u", scope: !513, file: !3, line: 117, type: !520, align: 8)
!535 = !DILocalVariable(name: "g", arg: 4, scope: !513, file: !3, line: 117, type: !521)
!536 = !DILocalVariable(name: "l", arg: 5, scope: !513, file: !3, line: 117, type: !296)
!537 = !DILocalVariable(arg: 3, scope: !513, file: !3, line: 117, type: !520)
!538 = !{i64 -3801848370686489254}
!539 = !DILocation(line: 117, scope: !513)
!540 = !DILocation(line: 119, scope: !513)
!541 = !DILocation(line: 120, scope: !513)
!542 = distinct !DISubprogram(name: "union_", scope: !2, file: !3, line: 137, type: !543, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !549)
!543 = !DISubroutineType(types: !544)
!544 = !{!29, !545}
!545 = !DICompositeType(tag: DW_TAG_union_type, name: "U", scope: !2, file: !5, size: 32, align: 32, elements: !546, templateParams: !16, identifier: "e8c023c6fa2b313aec2f51fb48fcaef3")
!546 = !{!547, !548}
!547 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !545, file: !5, baseType: !29, size: 32, align: 32)
!548 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !545, file: !5, baseType: !366, size: 32, align: 32)
!549 = !{!550}
!550 = !DILocalVariable(name: "u", arg: 1, scope: !542, file: !3, line: 137, type: !545)
!551 = !{i64 3738193153085972219}
!552 = !DILocation(line: 137, scope: !542)
!553 = !DILocation(line: 138, scope: !542)
!554 = !DILocation(line: 139, scope: !542)
!555 = distinct !DISubprogram(name: "visibility", scope: !2, file: !3, line: 190, type: !556, scopeLine: 190, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !566)
!556 = !DISubroutineType(types: !557)
!557 = !{!14, !558}
!558 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<types::inner::Vis>", baseType: !559, size: 64, align: 64, dwarfAddressSpace: 0)
!559 = !DICompositeType(tag: DW_TAG_structure_type, name: "Vis", scope: !560, file: !5, size: 32, align: 8, flags: DIFlagPublic, elements: !561, templateParams: !16, identifier: "c8763aed17c9ea6b868c91e2dc0d11a2")
!560 = !DINamespace(name: "inner", scope: !2)
!561 = !{!562, !563, !564, !565}
!562 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !559, file: !5, baseType: !14, size: 8, align: 8, flags: DIFlagProtected)
!563 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !559, file: !5, baseType: !14, size: 8, align: 8, offset: 8, flags: DIFlagProtected)
!564 = !DIDerivedType(tag: DW_TAG_member, name: "c", scope: !559, file: !5, baseType: !14, size: 8, align: 8, offset: 16, flags: DIFlagPrivate)
!565 = !DIDerivedType(tag: DW_TAG_member, name: "d", scope: !559, file: !5, baseType: !14, size: 8, align: 8, offset: 24, flags: DIFlagPublic)
!566 = !{!567}
!567 = !DILocalVariable(name: "v", arg: 1, scope: !555, file: !3, line: 190, type: !558)
!568 = !{i64 3148254357277744119}
!569 = !DILocation(line: 190, scope: !555)
!570 = !DILocation(line: 191, scope: !555)
!571 = !DILocation(line: 192, scope: !555)
!572 = distinct !DISubprogram(name: "vtable", scope: !2, file: !3, line: 161, type: !573, scopeLine: 161, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !46, templateParams: !16, retainedNodes: !575)
!573 = !DISubroutineType(types: !574)
!574 = !{!478, !356}
!575 = !{!576}
!576 = !DILocalVariable(name: "p", arg: 1, scope: !572, file: !3, line: 161, type: !356)
!577 = !{i64 3405836996193402751}
!578 = !DILocation(line: 161, scope: !572)
!579 = !DILocation(line: 163, scope: !572)
