# DSH Desktop · Arch Linux 适配版

DeepSeek Harness 的 Arch Linux 桌面适配。仓库通过 git 子模块固定上游 `deepseek-ai/deepseek-harness` 的提交，并提供两条桌面路径：

| 路径 | 桌面实现来源 | 产物 | 状态 |
| --- | --- | --- | --- |
| **上游 Desktop** | 上游 `apps/desktop` + `apps/desktop-host`（第一方 Electron 壳，自带打包 seed 与内置 Node/pnpm） | `deepseek-harness-<ver>-linux-x64.pacman`<br>`deepseek-harness-<ver>-linux-x86_64.AppImage` | 新增，推荐 |
| Legacy Cordis 壳 | 本仓库 `dsh-plugin-desktop`（自有 Cordis Host/Client 面，托盘、多 Profile、插件市场） | `DSH-Desktop-<ver>-x64.pacman` | 保留，标注 legacy |

两条路径共用同一个上游子模块提交。上游 `apps/desktop` 只注册了 `mac-arm64`、`mac-x64`、`win-x64` 三个发布目标，Arch 构建需要的 `linux-x64` 由本仓库的 `patches/desktop-linux-x64.patch` 提供：构建时临时应用，结束后还原，子模块始终保持干净。

## 要求

- Arch Linux x86_64
- Node.js `^22.19.0` 或 `>=24.0.0`
- git、corepack（Node.js 25 起不再随包分发，缺失时 `npm i -g corepack`）

## 构建

### 上游 Desktop（推荐）

```sh
git clone --recurse-submodules https://github.com/vconlln/deepseek-harness-arch-desktop.git
cd deepseek-harness-arch-desktop
corepack enable
corepack yarn install --immutable
corepack yarn dist:desktop-linux
```

产物：

```text
dist/deepseek-harness-0.1.3-alpha.2-linux-x64.pacman
dist/deepseek-harness-0.1.3-alpha.2-linux-x86_64.AppImage
```

`dist:desktop-linux` 做四件事：校验子模块提交与 `upstream.json` 一致 → 应用 `patches/desktop-linux-x64.patch` → 复制 `assets/app-icon.png` 到 `apps/desktop/build/` → 驱动上游自己的 `package linux-x64` 流水线（`build:official` → 打包 dsh/vendor/landlock tarball → 准备 Node 运行时 → 准备 seed → electron-builder）。结束时会还原补丁并清理图标，子模块恢复干净。

打包依赖 electron-builder 的下载缓存，默认写入 `~/.cache`；该目录不可写时可用 `XDG_CACHE_HOME`、`ELECTRON_CACHE`、`ELECTRON_BUILDER_CACHE` 改写。上游既有的 `download.deepseek.com` 自动更新通道只写进产物元数据，Arch 用户的更新路径是 pacman。

### Legacy Cordis 壳

```sh
corepack yarn dist:arch
```

产物：`dsh-plugin-desktop/dist/DSH-Desktop-2.1.0-x64.pacman`。这条路径依赖 `vendor/dsh-runtime/` 里随仓库提交的运行时 tarball。

## 安装

```sh
# 上游 Desktop
sudo pacman -U dist/deepseek-harness-0.1.3-alpha.2-linux-x64.pacman

# Legacy
sudo pacman -U dsh-plugin-desktop/dist/DSH-Desktop-2.1.0-x64.pacman
```

上游 Desktop：包名 `deepseek-harness`，装在 `/opt/DeepSeek Harness/`，可执行名 `dsh-desktop`，桌面项 `usr/share/applications/deepseek-harness.desktop`。Legacy：包名 `dsh-plugin-desktop`，装在 `/opt/DSH Desktop/`。

不安装直接运行 AppImage：

```sh
./dist/deepseek-harness-0.1.3-alpha.2-linux-x86_64.AppImage --appimage-extract-and-run
```

## 可选依赖

- `bubblewrap`：Agent 文件沙箱后端，未安装时自动回退 Landlock
- `fuse2`：直接运行 AppImage 所需

## 发布

1. 构建后把 `dist/` 里的 `.pacman` 与 `.AppImage` 上传到 GitHub Release，tag 用上游版本（如 `v0.1.3-alpha.2`）；
2. `sha256sum` 计算哈希，替换 `aur/deepseek-harness-desktop/PKGBUILD` 里的 `sha256sums`；
3. AUR 包 `deepseek-harness-desktop` 对应上游 Desktop；`deepseek-harness-desktop-bin` 保留给 legacy 路径。

## 测试

```sh
corepack yarn check
```

全量门禁：双语文档配对、布局校验（含子模块提交与干净度）、构建、类型检查、单元测试、运行时闭包。

## 目录

```text
patches/desktop-linux-x64.patch   给上游 apps/desktop 打开 linux-x64 发布目标
scripts/build-desktop-linux.mjs   上游 Desktop 的 Arch 出包入口
aur/deepseek-harness-desktop/     上游 Desktop 的 AUR PKGBUILD
assets/app-icon.png               打包用图标
deepseek-harness/                 上游固定版本(git 子模块)
vendor/dsh-runtime/               随仓库提交的上游运行时 tarball(legacy 路径使用)

dsh-plugin-desktop/               Legacy:Cordis 插件式桌面壳与打包
dsh-plugin-desktop-beta/          Legacy:beta 通道变体
dsh-community-market/             插件市场(随 legacy 桌面端打包)
dsh-plugin-wallpaper/             自有壁纸插件
dsh-community-fabric/             社区互操作规范
docs/superpowers/specs/           Arch 适配设计文档
```
