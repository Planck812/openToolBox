<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="Open-Toolbox" />

# Open-Toolbox

### 30 Entwickler-Tools, einen Tastendruck entfernt

Keine Suche mehr nach irgendeinem Online-JSON-Formatter. `Alt+Space` drücken, einfügen, fertig – komplett offline, native und 12 MB klein.

[![Release](https://img.shields.io/github/v/release/Planck812/openToolBox?style=flat-square&color=6366f1)](https://github.com/Planck812/openToolBox/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Planck812/openToolBox/total?style=flat-square&color=22c55e)](https://github.com/Planck812/openToolBox/releases)
[![License](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js&logoColor=white)](https://vuejs.org)
[![Stars](https://img.shields.io/github/stars/Planck812/openToolBox?style=flat-square&color=eab308)](https://github.com/Planck812/openToolBox/stargazers)

[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · **Deutsch** · [Änderungsprotokoll](CHANGELOG.md)

### [⬇️  Für Windows herunterladen](https://github.com/Planck812/openToolBox/releases/latest)

<!-- Demo-GIF unter docs/images/demo.gif ablegen und die folgende Zeile einkommentieren.
<img src="docs/images/demo.gif" alt="Open-Toolbox Demo" width="720" />
-->

</div>

---

## Warum Open-Toolbox?

|  | |
|---|---|
| ⚡ **Sofort da** | `Alt+Space` aus jedem Fenster. Die Zwischenablage wird automatisch gelesen, und das passende Tool ist vorgeschlagen, bevor du fertig getippt hast. |
| 🔒 **Vollständig offline** | JWTs, Passwörter, API-Payloads – nichts verlässt deinen Rechner. Kein Konto, keine Telemetrie, keine Netzwerkaufrufe. |
| 🪶 **Native und schlank** | Rust + Tauri 2 statt Electron. Installer ca. 12 MB, einstelliger MB-Verbrauch im Leerlauf. |
| 🧩 **30 Tools in einem Fenster** | Text, JSON, Kryptografie, Screenshots, OCR, Klebezettel – ohne Tab-Wildwuchs. |
| 🌍 **Mehrsprachig** | Oberfläche in English und 简体中文, zur Laufzeit umschaltbar. |

## Tools

<table>
<tr><td valign="top" width="25%">

**📝 Text**
- Aufteilen
- Zusammenführen
- Duplikate entfernen
- Textverarbeitung
- Vergleich
- Regex-Labor
- Formatkonvertierung

</td><td valign="top" width="25%">

**🔧 Daten & Formate**
- JSON-Viewer
- JSON-Diff
- Zeitstempel
- Base64
- QR-Code
- Bildbetrachter

</td><td valign="top" width="25%">

**⚙️ Entwicklung**
- UUID
- Hash
- JWT-Decoder
- TOTP / 2FA
- Curl-Runner
- AES-Verschlüsselung
- Umgebungsvariablen
- Port-Killer
- Mermaid-Vorschau
- Rechner

</td><td valign="top" width="25%">

**🚀 Produktivität**
- Screenshot (Bereich / Element / Scrollend)
- OCR
- Klebezettel
- Notizen
- Passworttresor
- Timer-Zentrale
- Sitzpausen-Erinnerung

</td></tr>
</table>

## Globale Tastenkürzel

| Aktion | Standard | Konfigurierbar |
|---|---|---|
| Hauptfenster aufrufen | `Alt+Space` | ✅ Einstellungen |
| Universeller Screenshot | `Ctrl+Shift+S` | ✅ Einstellungen |
| Klebezettel anlegen | `Ctrl+Shift+T` | ✅ Einstellungen |

## Installation

**Windows** – Installer über die [Releases](https://github.com/Planck812/openToolBox/releases/latest) beziehen. Unter Windows 10 wird ggf. die [WebView2-Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) benötigt (in Windows 11 enthalten).

**macOS / Linux** – derzeit nur Build aus dem Quellcode; vorgefertigte Pakete sind geplant.

## Aus dem Quellcode bauen

Voraussetzungen: **Node.js ≥ 18** (20 LTS empfohlen) und **Rust stable**.

```bash
npm install
npm run tauri dev      # Entwicklungsmodus (Rust-Build + Frontend-HMR)
npm run tauri build    # Produktions-Bundle
```

Weitere Befehle:

```bash
npm run dev            # nur Frontend, localhost:1420
npm run build          # vue-tsc Typprüfung + Frontend-Build
npm test               # Vitest Unit-Tests
npm run test:desktop   # WebdriverIO Desktop-E2E
cargo test --manifest-path src-tauri/Cargo.toml
```

Plattformabhängigkeiten: **Windows** WebView2-Runtime · **macOS** Xcode Command Line Tools · **Linux** webkit2gtk-4.1, libappindicator, librsvg (siehe [Tauri-v2-Voraussetzungen](https://tauri.app/start/prerequisites/)).

> `tauri dev` / `tauri build` laden die OCR-Sprachpakete automatisch herunter. Ohne Netzwerk vorab `node scripts/fetch-tessdata.mjs` ausführen.

## Architektur

- **Frontend** – Vue 3 `<script setup>` + Pinia + Vue Router + vue-i18n (zh-CN / en-US). Tools sind einsteckbare Module, registriert in `src/tools/registry.ts`; reine Logik (Engines/Modelle) ist von der UI getrennt.
- **Backend** – Tauri 2 (Rust), nach Domänen aufgeteilt: `ocr/` (Tesseract), `sticky/`, `env/` (Registry-Zugriff), `element_detect/` (UIA-Elementauswahl), `screenshot_shared/` / `screenshot_universal/` (Bereich, Anpinnen, Scroll-Aufnahme).
- **Hilfsfenster** – Screenshot-Overlay, angepinnte Bilder und Klebezettel laufen jeweils als eigenes WebView-Fenster mit minimalem Capability-Satz.
- **Sicherheit** – Das Frontend erreicht native APIs ausschließlich über `@tauri-apps/*`-Plugins; Befehle werden direkt per argv ausgeführt, niemals über eine Shell.

Details zum Hinzufügen neuer Tools, zur Teststrategie und zu den OCR-Sprachpaketen stehen in der [englischen README](README.md).

## Mitwirken

Issues und PRs sind willkommen – siehe [CONTRIBUTING.md](CONTRIBUTING.md) und den [Verhaltenskodex](CODE_OF_CONDUCT.md). Sicherheitsprobleme bitte über [SECURITY.md](SECURITY.md) melden.

## Lizenz

[MIT](LICENSE) © Open-Toolbox contributors

<div align="center">

**Wenn Open-Toolbox dir täglich ein paar Klicks erspart, ist ein ⭐ die beste Anerkennung.**

</div>
