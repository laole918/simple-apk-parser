# 修复 v3 签名证书与 apksigner 的差异

## Goal

修正多个 v3 签名者的证书摘要选择，验证 vivo 样本并兼容本机 SDK 的证书输出。

## Requirements

- `signatures[].certificate` for v3 uses the final signer in the v3.0 signing block, matching the certificate summary selected by Android SDK `apksigner` when it verifies v3.0.
- Keep the public return shape and existing v1 and v2 certificate selection.
- The batch validator recognizes the v3.0 certificate summary from Build Tools 37.0.0 as well as the existing `Signer #1` format.

## Acceptance Criteria

- [x] A regression test distinguishes the first and final signers and verifies the v3 selection.
- [x] The Node and browser bundles build and the unit suite passes.
- [x] The Vivo APK `2026032616042718p06.apk` returns the v3 fingerprint `bcc35d4d3606f154f0402ab7634e8490c0b244c2675c3c6238986987024f0c02` through the local file and HTTP range paths.
- [x] The batch validator extracts the same fingerprint from Build Tools 37.0.0 output and reports no mismatch for the sample.
