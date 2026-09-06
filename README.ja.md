<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="Open-Toolbox" />

# Open-Toolbox

### 30 個の開発ツールを、ショートカット一発で

オンラインの JSON フォーマッターを探し回るのは終わりです。`Alt+Space` で呼び出して貼り付けるだけ ── 完全オフライン、ネイティブ、12 MB。

[![Release](https://img.shields.io/github/v/release/Planck812/openToolBox?style=flat-square&color=6366f1)](https://github.com/Planck812/openToolBox/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Planck812/openToolBox/total?style=flat-square&color=22c55e)](https://github.com/Planck812/openToolBox/releases)
[![License](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js&logoColor=white)](https://vuejs.org)
[![Stars](https://img.shields.io/github/stars/Planck812/openToolBox?style=flat-square&color=eab308)](https://github.com/Planck812/openToolBox/stargazers)

[English](README.md) · [中文](README.zh-CN.md) · **日本語** · [Deutsch](README.de.md) · [変更履歴](CHANGELOG.md)

### [⬇️  Windows 版をダウンロード](https://github.com/Planck812/openToolBox/releases/latest) · [⬇️  macOS 版をダウンロード](https://github.com/Planck812/openToolBox/releases/latest)

<sub>macOS 版は Apple Silicon 専用かつ未署名です。初回起動時の許可手順は[インストール](#インストール)を参照してください。</sub>

<!-- docs/images/demo.gif にデモ GIF を置き、次の行のコメントを解除してください。
<img src="docs/images/demo.gif" alt="Open-Toolbox デモ" width="720" />
-->

</div>

---

## Open-Toolbox を選ぶ理由

|  | |
|---|---|
| ⚡ **すぐ使える** | どの画面からでも `Alt+Space`。クリップボードを自動で読み取り、入力し終わる前に適切なツールを提案します。 |
| 🔒 **完全オフライン** | JWT・パスワード・API のペイロードは端末内に留まります。アカウント不要、テレメトリなし、通信ゼロ。 |
| 🪶 **ネイティブで軽量** | Electron ではなく Rust + Tauri 2。インストーラー約 12 MB、アイドル時のメモリは一桁 MB。 |
| 🧩 **30 ツールを 1 つのウィンドウに** | テキスト、JSON、暗号、スクリーンショット、OCR、付箋。タブが増え続けることはもうありません。 |
| 🌍 **多言語対応** | English と 简体中文 の UI を同梱し、実行中に切り替えられます。 |

## ツール一覧

<table>
<tr><td valign="top" width="25%">

**📝 テキスト**
- 分割
- 結合
- 重複除去
- テキスト処理
- 差分比較
- 正規表現ラボ
- フォーマット変換

</td><td valign="top" width="25%">

**🔧 データ / 形式**
- JSON ビューア
- JSON 差分
- タイムスタンプ変換
- Base64
- QR コード生成
- 画像ビューア

</td><td valign="top" width="25%">

**⚙️ 開発者向け**
- UUID 生成
- ハッシュ
- JWT デコーダー
- TOTP / 2FA
- Curl ランナー
- AES 暗号化
- 環境変数設定
- ポート強制終了 <sup>Win</sup>
- Mermaid プレビュー
- 電卓

</td><td valign="top" width="25%">

**🚀 生産性**
- スクリーンショット（範囲 / 要素 / スクロール） <sup>Win</sup>
- OCR 文字認識
- 付箋 <sup>Win</sup>
- メモ
- パスワード管理
- タイマーセンター
- 座りすぎ通知

</td></tr>
</table>

<sub><sup>Win</sup> Windows 専用です。理由は[インストール](#インストール)を参照してください。</sub>

## グローバルショートカット

| 動作 | 既定値 | 設定変更 |
|---|---|---|
| メインウィンドウ呼び出し | `Alt+Space` | ✅ 設定画面 |
| ユニバーサルスクリーンショット | `Ctrl+Shift+S` | ✅ 設定画面 · ❌ macOS 非対応 |
| 付箋を貼る | `Ctrl+Shift+T` | ✅ 設定画面 · ❌ macOS 非対応 |

## インストール

**Windows** ── [Releases](https://github.com/Planck812/openToolBox/releases/latest) からインストーラーを取得してください。Windows 10 では [WebView2 ランタイム](https://developer.microsoft.com/microsoft-edge/webview2/) が別途必要な場合があります（Windows 11 は同梱済み）。

**macOS** ── [Releases](https://github.com/Planck812/openToolBox/releases/latest) から `.dmg` をダウンロードし、アプリを「アプリケーション」へドラッグしてください。**Apple Silicon 専用**です。Intel Mac ではソースからのビルドが必要です。

> このアプリは **Apple Developer ID で署名されていない**ため、初回起動時に「開発元を検証できないため開けません」と表示されてブロックされます。許可する方法：
>
> **アプリを右クリック → 「開く」→ もう一度「開く」**。ダブルクリックではこの選択肢が出ないため、必ず右クリックメニューから操作してください。一度許可すれば macOS が記憶し、同じバージョンでは再度尋ねられません。
>
> あるいは **システム設定 → プライバシーとセキュリティ** を開き、下へスクロールしてブロックされたアプリの横の **このまま開く** をクリックします。

macOS に関する補足が 2 点：

- **一部のツールは利用できません**：ユニバーサルスクリーンショット、付箋、ポート強制終了は現時点で Windows 専用です。前者 2 つは macOS 実装に既知の不具合があり、不完全なまま提供するより無効化しています。ポート強制終了は Windows 固有のコマンドに依存しています。
- **パスワード保管庫**はマスターキーを初めて読み取る際にキーチェーンへのアクセスを求めます。**常に許可**を選べば以降は表示されませんが、この許可はアプリのバイナリに紐づくため、新しいバージョンでは再度許可が必要です。

**Linux** ── 現時点ではソースからのビルドが必要です。ビルド済みパッケージは計画中です。

## ソースからビルド

**Node.js ≥ 18**（20 LTS 推奨）と **Rust stable** が必要です。

```bash
npm install
npm run tauri dev      # 開発モード（Rust ビルド + フロントエンド HMR）
npm run tauri build    # 本番ビルド
```

その他のコマンド：

```bash
npm run dev            # フロントエンドのみ、localhost:1420
npm run build          # vue-tsc 型チェック + フロントエンドビルド
npm test               # Vitest ユニットテスト
npm run test:desktop   # WebdriverIO デスクトップ E2E
cargo test --manifest-path src-tauri/Cargo.toml
```

プラットフォーム要件：**Windows** WebView2 ランタイム · **macOS** Xcode Command Line Tools · **Linux** webkit2gtk-4.1、libappindicator、librsvg（[Tauri v2 の前提条件](https://tauri.app/start/prerequisites/)参照）。

> `tauri dev` / `tauri build` は OCR 言語パックを自動取得します。オフラインの場合は事前に `node scripts/fetch-tessdata.mjs` を実行してください。

## アーキテクチャ

- **フロントエンド** ── Vue 3 `<script setup>` + Pinia + Vue Router + vue-i18n（zh-CN / en-US）。ツールは `src/tools/registry.ts` に登録するプラガブルなモジュールで、純粋なロジック（エンジン / モデル）は UI と分離されています。
- **バックエンド** ── Tauri 2（Rust）。ドメイン単位で `ocr/`（Tesseract）、`sticky/`、`env/`（レジストリ操作）、`element_detect/`（UIA 要素選択）、`screenshot_shared/` / `screenshot_universal/`（範囲・ピン留め・スクロール撮影）に分割。
- **補助ウィンドウ** ── スクリーンショットのオーバーレイ、ピン留め画像、付箋はそれぞれ独立した WebView ウィンドウで、最小限の capability のみを持ちます。
- **セキュリティ** ── フロントエンドは `@tauri-apps/*` プラグイン経由でのみネイティブ機能に触れ、コマンド実行は shell を介さず argv 直接呼び出しです。

新しいツールの追加手順、テスト戦略、OCR 言語パックの詳細は [英語版 README](README.md) を参照してください。

## コントリビュート

Issue や PR を歓迎します。[CONTRIBUTING.md](CONTRIBUTING.md) と[行動規範](CODE_OF_CONDUCT.md)をご確認ください。セキュリティ上の問題は [SECURITY.md](SECURITY.md) からご連絡ください。

## ライセンス

[MIT](LICENSE) © Open-Toolbox contributors

<div align="center">

**Open-Toolbox が毎日のひと手間を省けたなら、⭐ が何よりの励みになります。**

</div>
