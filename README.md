<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="Open-Toolbox" />

# Open-Toolbox

### 30 developer tools. One keystroke away.

Stop hunting for that random online JSON formatter. Hit `Alt+Space`, paste, done — offline, native, and 12 MB.

[![Release](https://img.shields.io/github/v/release/Planck812/openToolBox?style=flat-square&color=6366f1)](https://github.com/Planck812/openToolBox/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Planck812/openToolBox/total?style=flat-square&color=22c55e)](https://github.com/Planck812/openToolBox/releases)
[![License](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js&logoColor=white)](https://vuejs.org)
[![Stars](https://img.shields.io/github/stars/Planck812/openToolBox?style=flat-square&color=eab308)](https://github.com/Planck812/openToolBox/stargazers)

**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Changelog](CHANGELOG.md)

### [⬇️  Download for Windows](https://github.com/Planck812/openToolBox/releases/latest) · [⬇️  Download for macOS](https://github.com/Planck812/openToolBox/releases/latest)

<sub>macOS builds are Apple Silicon only and unsigned — see [Install](#install) for the one-time Gatekeeper step.</sub>

<!-- Drop a demo GIF at docs/images/demo.gif and uncomment the line below.
<img src="docs/images/demo.gif" alt="Open-Toolbox demo" width="720" />
-->

</div>

---

## Why Open-Toolbox?

|  | |
|---|---|
| ⚡ **Instant** | `Alt+Space` from anywhere. Clipboard is read automatically, and the right tool is already suggested before you finish typing. |
| 🔒 **Fully offline** | JWTs, passwords, API payloads — nothing leaves your machine. No account, no telemetry, no network calls. |
| 🪶 **Native & tiny** | Rust + Tauri 2, not Electron. ~12 MB installer, single-digit MB of RAM at idle. |
| 🧩 **30 tools, one window** | Text, JSON, crypto, screenshots, OCR, sticky notes. No tab sprawl. |
| 🌍 **Multilingual** | Ships with English and 简体中文 UI, switchable at runtime. |

## Tools

<table>
<tr><td valign="top" width="25%">

**📝 Text**
- Split
- Join
- Dedup
- Processor
- Diff
- Regex Lab
- Format Convert

</td><td valign="top" width="25%">

**🔧 Data & Format**
- JSON Viewer
- JSON Diff
- Timestamp
- Base64
- QR Code
- Image Viewer

</td><td valign="top" width="25%">

**⚙️ Developer**
- UUID
- Hash
- JWT Decoder
- TOTP / 2FA
- Curl Runner
- AES Crypto
- Env Variables
- Port Killer <sup>Win</sup>
- Mermaid Preview
- Calculator

</td><td valign="top" width="25%">

**🚀 Productivity**
- Screenshot (region / element / scrolling) <sup>Win</sup>
- OCR
- Sticky Notes <sup>Win</sup>
- Memo
- Password Vault
- Timer Center
- Sedentary Reminder

</td></tr>
</table>

<sub><sup>Win</sup> Windows only — see [Install](#install) for why.</sub>

## Shortcuts

| Action | Default | Configurable |
|---|---|---|
| Summon main window | `Alt+Space` | ✅ Settings |
| Universal screenshot | `Ctrl+Shift+S` | ✅ Settings · ❌ not on macOS |
| Drop a sticky note | `Ctrl+Shift+T` | ✅ Settings · ❌ not on macOS |

## Install

**Windows** — grab the installer from [Releases](https://github.com/Planck812/openToolBox/releases/latest). Windows 10 users may need the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (bundled in Windows 11).

**macOS** — download the `.dmg` from [Releases](https://github.com/Planck812/openToolBox/releases/latest) and drag the app into Applications. **Apple Silicon only**; Intel Macs need a source build.

> The app is **not signed with an Apple Developer ID**, so the first launch is blocked with *"cannot be opened because the developer cannot be verified"*. To get past it once:
>
> **Right-click the app → Open → Open**. Double-clicking will not offer the bypass — you have to use the right-click menu. macOS remembers the choice, so this is a one-time step per version.
>
> Alternatively: **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the blocked-app notice.

Two more macOS notes:

- **Some tools are unavailable**: Universal Screenshot, Sticky Notes and Port Killer are Windows-only for now — the first two have known macOS defects and are disabled rather than shipped broken; Port Killer relies on Windows-specific commands.
- **Password Vault** asks for keychain access the first time it reads its master key. Choose **Always Allow** and it stays quiet — until the next version, since the grant is bound to the app binary.

**Linux** — build from source for now; prebuilt bundles are on the roadmap.

## Build from source

Requires **Node.js ≥ 18** (20 LTS recommended) and **Rust stable**.

```bash
npm install
npm run tauri dev      # dev mode (Rust build + frontend HMR)
npm run tauri build    # production bundle
```

Other commands:

```bash
npm run dev            # frontend only, localhost:1420
npm run build          # vue-tsc type-check + frontend build
npm test               # Vitest unit tests
npm run test:desktop   # WebdriverIO desktop E2E
cargo test --manifest-path src-tauri/Cargo.toml
```

Platform prerequisites: **Windows** WebView2 Runtime · **macOS** Xcode Command Line Tools · **Linux** webkit2gtk-4.1, libappindicator, librsvg (see [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/)).

> `tauri dev` / `tauri build` automatically fetch the OCR language packs. Offline? Run `node scripts/fetch-tessdata.mjs` beforehand.

## Architecture

- **Frontend** — Vue 3 `<script setup>` + Pinia + Vue Router + vue-i18n (zh-CN / en-US). Tools are pluggable modules registered in `src/tools/registry.ts`; pure logic (engines/models) is kept separate from UI.
- **Backend** — Tauri 2 (Rust), split by domain: `ocr/` (Tesseract), `sticky/`, `env/` (registry access), `element_detect/` (UIA element picking), `screenshot_shared/` / `screenshot_universal/` (region, pin, scrolling capture).
- **Helper windows** — screenshot overlay, pinned images and sticky notes each run as their own WebView window with a minimal capability set.
- **Security** — the frontend only touches native APIs through `@tauri-apps/*` plugins; command execution is a direct argv call, never routed through a shell.

## Add a new tool

A tool is a folder under `src/tools/<kebab-case>/` containing `index.ts` (metadata + match logic), pure engine files, and a `*.vue` component.

1. Create `src/tools/my-tool/index.ts` exporting a `Tool`:

   ```ts
   export const myTool: Tool = {
     metadata: {
       id: 'my-tool',
       name: 'tools.my_tool.name',        // i18n key, never a literal
       description: 'tools.my_tool.description',
       icon: /* lucide-vue-next icon */,
       keywords: ['my', 'tool'],
     },
     component: () => import('./MyTool.vue'),
     match: (input) => { /* ToolMatchResult | null */ },
   };
   ```

2. Import it and append to the `tools` array in `src/tools/registry.ts`.
3. Add `tools.my_tool.name` / `.description` to **both** `src/locales/zh-CN.json` and `en-US.json` — the two files must stay structurally identical.
4. Cover engine/model logic with Vitest tests.

See `src/tools/calculator/` and `src/tools/text-split/` for minimal references. Native capabilities (screenshot, global shortcuts, files, commands) go through the typed wrappers in `src/lib/ipc/`.

## OCR language packs

The OCR tool needs Tesseract data (`chi_sim` / `chi_sim_vert` / `eng`, ~47 MB, Apache-2.0). Packs are **not committed** — `scripts/fetch-tessdata.mjs` downloads them idempotently into `src-tauri/tessdata/` and `src-tauri/tessdata_fast/` (both gitignored). Source: [tessdata](https://github.com/tesseract-ocr/tessdata) / [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast).

## Testing

- **Frontend** — Vitest over tool engines (calculator / JWT / hash / TOTP / regex …) and key components (HomeView, settings, shortcuts).
- **Rust** — `cargo test` over history-manifest transactions, pinned images, scroll stitching, OCR preprocessing.
- **Desktop E2E** — WebdriverIO drives the release binary through `app-launch`, `jwt`, `memo`, `text-diff` flows.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Open-Toolbox contributors

<div align="center">

**If Open-Toolbox saves you a few clicks a day, a ⭐ goes a long way.**

</div>
