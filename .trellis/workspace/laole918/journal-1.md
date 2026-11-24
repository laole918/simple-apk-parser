# Journal - laole918 (Part 1)

> AI development session journal
> Started: 2026-11-24

---



## Session 1: Bootstrap Trellis development guidelines
<!-- trellis-session: v=2 fp=03897bc5e48126dc -->

**Date**: 2026-11-24
**Task**: Bootstrap Trellis development guidelines
**Branch**: `main`

### Summary

Documented the shared APK parser, platform runtimes, browser demo, and validation workflow. Archived the initial bootstrap task.

### Git Commits

| Hash | Message |
|------|---------|
| `79bd2dc` | Add Trellis development guidelines |

### Testing

- [OK] Vitest reported 17 passing tests. The ZIP64 fixture was absent, so its assertion did not run.
- [OK] All four Rollup build targets and Markdown link checks passed.

### Status

[OK] **Completed**


## Session 2: 修复 v3 证书摘要与 apksigner 的差异
<!-- trellis-session: v=2 fp=f26a9f3a4ca16892 -->

**Date**: 2026-11-24
**Task**: 修复 v3 证书摘要与 apksigner 的差异
**Branch**: `main`

### Summary

v3.0 摘要改取签名块的最后一位签名者。批量校验兼容新版 SDK 的 v3.0 证书输出。Vivo 样本经本地文件和 HTTP Range 验证，与 Build Tools 34.0.0 和 37.0.0 一致。18 项测试通过，Node 和浏览器构建通过，本地 demo 已由用户验收并停止。

### Git Commits

| Hash | Message |
|------|---------|
| `5effb22` | Fix v3 certificate selection to match apksigner |

### Status

[OK] **Completed**
