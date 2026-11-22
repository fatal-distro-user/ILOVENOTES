# Installation

Download builds from the [GitHub Releases page](https://github.com/fatal-distro-user/ILOVENOTES/releases). Each release is produced by the release workflow (`.github/workflows/release.yml`) when a `v*` tag is pushed, and contains the files below. `<ver>` is the version number, for example `0.1.0`.

All desktop builds are **unsigned**, so your OS will warn you on first launch. The steps below show how to proceed.

## Which file do I pick?

| OS | File | Notes |
| --- | --- | --- |
| Linux (any distro) | `ILOVENOTES-<ver>.AppImage` | Portable, no install |
| Debian / Ubuntu and derivatives | `ilovenotes_<ver>_amd64.deb` | Installs through your package manager (64-bit x86) |
| Windows | `ILOVENOTES Setup <ver>.exe` | NSIS installer |
| macOS | `.dmg` (one per CPU architecture) | Unsigned and not notarized |
| Any browser | `ILOVENOTES-web.zip` | Static PWA build you host yourself |

## Linux: AppImage

```bash
chmod +x ILOVENOTES-<ver>.AppImage
./ILOVENOTES-<ver>.AppImage
```

If it fails to start, try running it with `--no-sandbox`:

```bash
./ILOVENOTES-<ver>.AppImage --no-sandbox
```

## Linux: .deb

```bash
sudo apt install ./ilovenotes_<ver>_amd64.deb
```

The package declares its runtime dependencies (GTK 3, NSS and a few others), and `apt` installs them for you. After installing, launch ILOVENOTES from your application menu (it is listed in the Office category).

## Windows

1. Run `ILOVENOTES Setup <ver>.exe`.
2. Because the installer is unsigned, Windows SmartScreen may show "Windows protected your PC". Choose **More info**, then **Run anyway**.
3. The installer lets you choose the install directory and installs per user (not for all users).

## macOS

1. Open the `.dmg` and drag ILOVENOTES to Applications.
2. The app is unsigned and not notarized, so Gatekeeper blocks the first launch. Either right-click the app and choose **Open**, then confirm, or open **System Settings, Privacy & Security** and choose **Open Anyway** after the first blocked attempt.

The macOS builds are produced on GitHub's `macos-latest` runner with both `--x64` and `--arm64`, so a release should contain one `.dmg` for Intel Macs and one for Apple silicon. electron-builder's default naming normally distinguishes them with an architecture suffix (an `-arm64` name for Apple silicon), but the exact file names are not pinned in this repository, so check the asset list on the release page. If you are unsure which Mac you have, choose Apple menu, About This Mac: "Apple M..." means Apple silicon, "Intel" means Intel.

## Web build (PWA)

`ILOVENOTES-web.zip` is the contents of the Vite `dist/` folder. It is a static site with a service worker.

1. Unzip it to a folder.
2. Serve that folder over HTTP or HTTPS, for example `npx serve .` or any static web host. Opening `index.html` directly from disk will not register the service worker.
3. Open the URL in a Chromium-based browser (or another browser with PWA support). Use the browser's install option to add it as an app.

The build uses a relative base path, so it works from a sub-folder of a host. Data is stored in that browser profile's IndexedDB, scoped to the site origin, so moving the site to a different URL starts with an empty workspace. Use [workspace export and import](import-export.md#workspace-backup) to move data.

## Opening `.ilovenotes` files

The desktop app registers the `.ilovenotes` file type. Double-clicking a workspace backup (or passing it on the command line) imports it as a new workspace. See [Import and export](import-export.md).

## Next steps

Continue with [Getting started](getting-started.md).
