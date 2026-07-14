# Tuxedo MD — rough product and implementation idea

Last revised: July 14, 2026

This is the durable working brief for Tuxedo MD. It records the product decisions, technical direction, business model, release lanes, and the next implementation phases so the project can continue even if the original planning conversation is unavailable.

## Product thesis

Tuxedo MD should be a fast, beautiful, local-first Markdown editor that feels at home on Windows, macOS, and Linux. The default experience stays calm and understandable; workspace and publishing features can become powerful without turning the editor into an IDE.

The visual direction is dark, glass-like, slightly translucent, and carefully animated. Glass is a treatment rather than the whole identity: text contrast, accessibility, reduced-transparency support, and reliable editor behavior take priority over spectacle.

The app should not require an account. The initial product has no cloud sync, telemetry, hosted AI, or proprietary file format. Markdown files and ordinary folders remain the source of truth.

## Recommended stack

Use **Tauri 2 + Svelte 5 + TypeScript + Rust**, with **CodeMirror 6** as the editing engine.

Why this fits:

- Tauri produces native desktop bundles while retaining the CSS control needed for a high-fidelity glass interface.
- Rust provides a small, auditable boundary for filesystem operations, workspace indexing, exports, and future native integrations.
- Svelte keeps the UI layer compact and is well suited to a reactive multi-pane editor.
- CodeMirror 6 is mature, extensible, accessible, and better suited to a source-first Markdown editor than a custom `contenteditable` implementation.
- This reuses the developer's established Tauri release knowledge and can closely follow IYERIS command names and environment conventions.

Flutter remains a good native-like option, especially given Dacx experience, but it would require more custom work for a desktop-grade Markdown editing surface and platform glass behavior. Fully separate Swift/WinUI/Linux implementations would maximize platform fidelity but multiply feature and maintenance work. Electron would simplify the web layer but carries a larger runtime footprint without a decisive advantage here.

## Current architecture

The repository starts with one source tree and compile-time editions:

- `community`: official GitHub builds for Windows x64 and macOS universal.
- `full`: Tuxedo MD Pro in the Mac App Store and Microsoft Store, plus the official full Linux x64 build.

`TUXEDO_EDITION` controls the Rust build and `VITE_TUXEDO_EDITION` controls the frontend. Store restrictions must be implemented as real feature gates, not just hidden buttons. Files written by Pro should remain readable Markdown in Community and other editors.

The first vertical slice already establishes:

- Multi-document tabs.
- CodeMirror source editing.
- Source, split, and preview layouts.
- Sanitized GitHub-flavored Markdown preview.
- Native file open, Save, and Save As.
- Flushed same-directory temporary writes through Rust, with cleanup on failure.
- Folder scanning and a Markdown workspace sidebar.
- Community/Pro build labels and separate store configuration overlays.

## Feature shape

### Community

- Excellent Markdown source editor and live preview.
- Open/save ordinary local files.
- Tabs, find/replace, keyboard shortcuts, autosave/recovery, and recent files.
- One-folder workspace browser and filename filtering.
- Core light/dark themes and accessible appearance settings.
- Standard Markdown and GFM rendering.
- No account, network dependency, telemetry, or artificial document lock-in.

### Pro / Full

- Workspace-wide search, outline, backlinks, wiki links, tags, and graph/navigation intelligence.
- Theme studio, custom CSS, and shareable theme packages.
- Mermaid diagrams, math, citations, and richer preview plugins.
- Export workflows such as styled HTML, PDF, and print presets.
- Advanced workspace management, saved searches, templates, and publishing helpers.
- Future productivity features should remain local-first whenever possible.

The line should be “advanced workflow and customization,” not basic editing safety. Community users must always be able to create, edit, save, and recover their Markdown.

## Business and source model

Keep the project public under **MPL-2.0**. MPL's file-level copyleft is a useful middle ground: changes to covered files remain available while separate integrations can use different terms. This is not legal advice; review the final distribution and trademark posture with counsel before launch.

Recommended launch model:

- GitHub: source plus signed Community builds for Windows x64 and macOS universal.
- Linux x64: the official Full build at no charge, because mainstream paid-store infrastructure is fragmented and Linux goodwill is valuable.
- Mac App Store / Microsoft Store: **Tuxedo MD Pro**, paid upfront at a launch price around **US$2.99**.
- Avoid subscriptions for the initial local editor. Revisit pricing after real usage data and a clear Pro feature set exist.

This is effectively open-core by build configuration, but all code remains visible. The paid value is the convenient trusted store build, full feature enablement, and direct support—not secrecy. The name and logo should be governed separately by a trademark policy so forks cannot imply they are official releases.

Do not maintain two divergent codebases. Keep one repository, feature registry, test suite, and release process. The UI should clearly disclose the edition in About and wherever a Pro-only action appears.

## Release lanes and IYERIS parity

The `package.json` command vocabulary intentionally mirrors IYERIS where it applies:

- Local: `npm run start`, `dev`, `build`, `tauri:dev`, `tauri:build`.
- Quality: `test`, `test:all`, `typecheck`, `lint`, `format`, `licenses`.
- Version/tooling: `sync-version`, `vi`, `wc`, `dist:*`, Rust target commands.
- Platform: `build:win:x64`, `build:mac:universal`, `build:linux:x64`.
- Stores: `build:msstore`, `build:mac:appstore`.
- Release: `release:prepare`, `release:draft`, `release:win`, `release:mac`, `release:linux`, GPG signing, and final asset upload.

The environment names likewise follow IYERIS: `GH_TOKEN`, GPG variables, Tauri updater signing variables, Apple signing/notarization variables, and the optional GitHub repository override. See `.env.example`; `.env` must never be committed.

Important current distribution details:

- Direct macOS builds require code signing and notarization. Mac App Store builds additionally require sandbox entitlements, an App Store provisioning profile, App/Team identifiers in final entitlements, a signed installer package, and validation in a sandboxed build.
- The current Tauri Microsoft Store guide recommends a signed offline NSIS/MSI installer registered as an EXE/MSI product. `build:msstore` follows that route. The old custom MSIX script is retained only as `build:msstore:legacy-msix` in case Partner Center requirements demand it.
- Windows Store silent-install parameters should be `/S` for NSIS or `/quiet` for MSI.
- Universal macOS output must include x86_64 and arm64 Rust targets.
- Linux x64 initially produces AppImage, Debian, and RPM artifacts. AppImage should be the recommended portable download.

Never publish directly from an unreviewed automated step. The release commands create or reuse a draft, sign and upload assets, then leave the draft for manual verification.

## Security and reliability rules

- Preview HTML is sanitized by default. Raw HTML, external resources, and plugin execution require explicit threat review.
- Native commands accept only the minimum data required and return structured errors.
- Saves use a same-directory temporary file, flush, and rename to reduce corruption risk. Add true replace-file semantics on Windows before production release.
- Add crash recovery before calling the editor production-ready.
- Do not execute workspace content or follow directory symlinks during indexing.
- Bound document size, file count, recursion, and expensive render extensions.
- Preserve undo history and cursor position when switching layouts or updating settings.
- Add tests for file conflicts, external changes, encoding/BOM/newlines, large files, unsafe links, and malicious Markdown.
- Signing keys and store credentials remain in environment/CI secrets only.

## Milestones

### Phase 1 — editor foundation

- Finish tab lifecycle prompts and external-change detection.
- Autosave preferences plus crash/session recovery.
- Find/replace, editor commands, Markdown shortcuts, outline, and scroll sync.
- Settings persistence, theme tokens, reduced transparency, light theme, and high contrast.
- Drag/drop and OS file-open event handling.
- Recent files/workspaces and safe window-state persistence.

### Phase 2 — workspace quality

- Proper nested file tree, create/rename/delete with confirmations.
- Fast indexed content search and command palette.
- Links, images, relative resource resolution, outline navigation, and broken-link diagnostics.
- Backlinks/wiki links/tags behind the Full feature registry.
- Performance tests using large real-world vaults.

### Phase 3 — Pro value

- Theme studio and portable theme format.
- Mermaid and math in isolated/sanitized render paths.
- Export pipeline with deterministic HTML/PDF/print output.
- Templates and workspace intelligence.
- An honest in-app comparison and upgrade path that never blocks basic file access.

### Phase 4 — release hardening

- Replace provisional identifiers with the reserved Partner Center and App Store Connect identities.
- Finalize Apple Team/App identifiers and provisioning without committing profiles.
- Produce the signed Mac App Store `.pkg`, validate with Transporter/notary tooling as appropriate, and test sandbox bookmarks across relaunches.
- Test Store offline installer and silent installation on a clean Windows x64 VM.
- Add CI per OS, artifact checksums, updater signing, SBOM/license notices, privacy policy, support page, and trademark policy.
- Accessibility audit and real-device visual QA across Windows 11, Intel/Apple Silicon macOS, and representative Linux desktops.

## Research references

- [Tauri 2 distribution overview](https://v2.tauri.app/distribute/)
- [Tauri Microsoft Store guide](https://v2.tauri.app/distribute/microsoft-store/)
- [Tauri macOS application bundle and entitlements](https://v2.tauri.app/distribute/macos-application-bundle/)
- [CodeMirror 6 documentation](https://codemirror.net/docs/)
- [Mozilla MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)

These links and store requirements should be rechecked immediately before release because platform rules and Tauri packaging guidance change over time.
