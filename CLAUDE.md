# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Open-Toolbox** is a cross-platform desktop application built with Tauri (Rust backend), Vue 3, and TypeScript. It provides a collection of utility tools accessible via a global keyboard shortcut with system tray integration.

## Development Commands

### Setup & Installation
```bash
npm install
cd src-tauri && cargo build
```

### Development
```bash
npm run dev           # Start Vite dev server (runs on http://localhost:1420)
npm run tauri dev     # Launch Tauri dev build (compiles Rust + runs frontend in dev mode)
```

### Building
```bash
npm run build         # Type-check TypeScript and build frontend assets
npm run tauri build   # Build final desktop application
npm run preview       # Preview production build
```

### Type Checking & Validation
```bash
vue-tsc --noEmit      # Check TypeScript types (no emit)
```

## Architecture Overview

### Two-Tier Architecture
- **Frontend**: Vue 3 + TypeScript (runs in Tauri webview)
- **Backend**: Rust (Tauri runtime with plugins for native features)

### Frontend Structure (src/)

**State Management:**
- Pinia store (`src/store/app.ts`) - Centralized app state:
  - Search query and input content
  - Active tool tracking
  - Toast notifications
  - Home shortcuts configuration (persisted to localStorage)
  - Tool search/matching logic

**Routing:**
- Vue Router with 3 main routes:
  - `/` - HomeView (tool discovery/listing)
  - `/tool/:id` - ToolView (individual tool with keep-alive caching)
  - `/settings` - SettingsView (app configuration)

**Tool System (src/tools/):**
- **Tool Interface** (`interface.ts`) - Defines `Tool`, `ToolMetadata`, `ToolMatchResult`
- **Tool Registry** (`registry.ts`) - Registers 27 tools with lazy-loaded Vue components
- **Tool Modules** - Each tool in its own directory with index.ts and component
  - Tools: JSON Viewer, JSON Diff, Timestamp Converter, Text Split/Join/Processor/Dedup/Diff, QR Code Generator, Image Viewer/Base64, Port Killer, Calculator, Mermaid Preview, UUID Generator, Memo, JWT, Pwd Box, Curl Runner, Hash, Regex Lab, Format Convert, TOTP 2FA, Env Setter, Universal Screenshot, OCR, Sticky Manager
  - Each tool defines its own match function for smart search/discovery

**Global Features (App.vue):**
- Alt+Space global shortcut handler (configured in backend, shows app and reads clipboard)
- Toast notification system for user feedback
- Tauri plugin integration

**Internationalization:**
- i18n setup in `src/i18n.ts`
- Chinese translations in `src/locales/zh-CN.json`

### Backend Structure (src-tauri/)

**Rust Dependencies:**
- Tauri 2.x - Core framework
- tauri-plugin-global-shortcut - Global keyboard shortcuts
- tauri-plugin-clipboard-manager - Clipboard access
- tauri-plugin-store - Key-value data persistence
- tauri-plugin-shell - Execute shell commands
- tauri-plugin-opener - Open URLs/files
- tauri-plugin-log - Logging
- tauri-plugin-autostart - Auto-launch on system startup

**Main Backend (src-tauri/src/lib.rs):**
- System tray icon setup with context menu:
  - Pin to top
  - Auto-start on boot
  - Minimize option
  - Shortcut settings
  - Quit
- Window lifecycle management (prevents close, minimizes to tray instead)
- Plugin initialization
- Command handlers (sample: `greet()`)

**Configuration:**
- `tauri.conf.json` - App metadata, window size (1600x800), security policies, bundle settings
- `Cargo.toml` - Rust dependencies and library configuration
- `build.rs` - Tauri build script

## Build System

### Vite Configuration (vite.config.ts)
- Vue 3 plugin enabled
- Dev server: port 1420 (strict, fails if unavailable)
- TypeScript path alias: `@/*` → `src/*`
- File watching ignores `src-tauri/` to prevent conflicts with Rust compilation

### Tauri Build Flow
1. `tauri dev` runs `npm run dev` (frontend dev server)
2. Rust backend compiles alongside, connects to frontend on localhost:1420
3. `tauri build` runs `npm run build` then packages the app
4. Frontend assets output to `dist/` and bundled with Rust binary

## TypeScript Configuration

- **Target**: ES2020
- **Module Resolution**: bundler (native ESM)
- **Strict Mode**: Enabled (strict null checks, etc.)
- **Unused Variable Checking**: Enabled (`noUnusedLocals`, `noUnusedParameters`)
- **Path Alias**: `@/*` resolves to `src/*`

## Styling

- **Tailwind CSS** 3.4.17 - Utility-first CSS framework
- **PostCSS** - CSS processing with Tailwind and autoprefixer plugins
- **Global styles** - `src/style.css`

## Key Dependencies

### Frontend (package.json)
- Vue 3.5.13
- Vue Router 4.6.4
- Pinia 3.0.4 (state management)
- Tauri API 2.9.1 (desktop integration)
- CodeMirror 6.x (code editor for JSON)
- Radix Vue 1.9.17 (accessible UI components)
- Vue i18n 11.2.7 (internationalization)
- Lucide Vue (SVG icons)
- QRCode 1.5.4 (QR code generation)
- JSBarcode 3.12.1 (barcode generation)

## Plugin Integration

### Tauri Plugins Used
1. **global-shortcut** - Register Alt+Space to show app from tray
2. **clipboard-manager** - Read clipboard content on shortcut activation
3. **store** - Persist user settings (home shortcuts configuration)
4. **shell** - Execute system commands
5. **opener** - Open URLs and files
6. **log** - Application logging
7. **autostart** - Auto-launch app on system startup
8. **tray-icon** - System tray icon and menu

## Important Patterns

### Adding a New Tool

1. **Create tool directory**: `src/tools/my-tool/`
2. **Define interface** in `interface.ts` for metadata
3. **Create component**: `src/tools/my-tool/Component.vue` with reactive state
4. **Register** in `registry.ts`:
   ```ts
   {
     metadata: { id: "my-tool", name: "...", icon: "...", ... },
     component: () => import("./my-tool/Component.vue"),
     match: (query, input) => { /* return ToolMatchResult */ }
   }
   ```
5. **Match function** determines if tool appears in search results

### Global Shortcuts

- Configured in Rust backend (`src-tauri/src/lib.rs`)
- Registered via `tauri-plugin-global-shortcut`
- Listener in `App.vue` handles the platform event

### State Persistence

- Use Tauri Store plugin (`tauri-plugin-store`) for persistent data
- Home shortcuts configuration example: stored with app state

## Window Management

- **Initial Size**: 1600x800 (set in `tauri.conf.json`)
- **Behavior**: Closing minimizes to tray (doesn't actually close)
- **Tray Menu**: Provides access to settings and quit option
- **Title**: "open-toolbox"

## Security

- **CSP Policy** in `tauri.conf.json`: Restricts script execution to self, allows images from asset/data URIs
- **Capabilities** system in `src-tauri/capabilities/` (Tauri 2 security model)
- All native features go through Tauri plugin layer (safe IPC)

## Common Development Tasks

### Running a Specific Tool

Tools are lazy-loaded. Click tool from HomeView or navigate to `/tool/tool-id`.

### Testing Changes

1. **Frontend only**: Changes hot-reload when you save (Vite HMR)
2. **Rust backend**: Must restart `tauri dev` (re-runs build)
3. **Both**: Restart `tauri dev`

### Debugging

- **Frontend**: Browser DevTools via Tauri (right-click → Inspect)
- **Rust**: Use standard Rust debugging tools or add logging via `tauri-plugin-log`
- **Logs**: Check console output during `tauri dev`

### Adding Dependencies

**Frontend (Node packages):**
```bash
npm install package-name
```

**Backend (Rust crates):**
```bash
cd src-tauri && cargo add crate-name
```

### Building for Production

```bash
npm run build    # Type check and build assets
npm run tauri build
```

Output: Native executable + installer in `src-tauri/target/release/bundle/`

## Performance Considerations

- **Tool Components**: Kept in memory with keep-alive caching to preserve state
- **Lazy Loading**: Tool components only imported when accessed
- **Clipboard Integration**: Automatic on Alt+Space activation
- **Store Persistence**: Synchronous (may block if large data)

## Localization

- i18n configured with Vue i18n 11.2.7
- Chinese (zh-CN) locale implemented in `src/locales/zh-CN.json`
- Add new languages by:
  1. Creating new locale file: `src/locales/[lang].json`
  2. Registering in `src/i18n.ts`

## File Organization

| Path | Purpose |
|------|---------|
| `src/` | Vue + TypeScript frontend |
| `src/tools/` | Tool modules (pluggable utilities) |
| `src/views/` | Main page components (Home, Tool, Settings) |
| `src/router/` | Vue Router configuration |
| `src/store/` | Pinia state management |
| `src/i18n.ts` | Internationalization setup |
| `src-tauri/src/` | Rust backend code |
| `dist/` | Built frontend assets |
| `public/` | Static assets |

## Relevant Standards

- **TypeScript**: Strict mode enabled, no unused variables
- **Vue**: Composition API with `<script setup>` (recommended)
- **Rust**: Edition 2021, Tauri 2.x conventions
- **CSS**: Tailwind utility classes + custom CSS in `style.css`
