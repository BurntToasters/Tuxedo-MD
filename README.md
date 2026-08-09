# Tuxedo MD

A sleek, local-first Markdown editor for Windows, macOS, and Linux.

Tuxedo MD is being built with Tauri 2, Svelte 5, TypeScript, Rust, and CodeMirror 6. The source is licensed under MPL-2.0.

## Development

```bash
npm install
npm run start
```

Useful commands follow the same conventions as IYERIS:

```bash
npm run test:all
npm run build:win:x64
npm run build:mac:universal
npm run build:linux:x64
npm run build:msstore:x64
```

See [rough_idea.md](rough_idea.md) for the product direction, edition model, architecture, and roadmap.

## Editions

Compile-time editions use `TUXEDO_EDITION` / `VITE_TUXEDO_EDITION` (`community` or `full`). Community builds expose no Pro capabilities at the native IPC boundary; Full/Pro enables the complete capability set.

- **Community:** Official free GitHub builds for Windows x64 and universal macOS (`npm run start`, `build:win:*`, `build:mac:universal:*`).
- **Pro:** Feature-complete paid builds for the Mac App Store and Microsoft Store (`npm run start:pro`, `build:msstore:*`, `build:mac:appstore:*`).
- **Full Linux:** Official Linux x64 builds are Full by design (`build:linux:*`) and ship free with Pro capabilities enabled.

All edition source code is public. The paid store builds fund development, store certification, managed updates, and support.

## License

[Mozilla Public License 2.0](LICENSE)
