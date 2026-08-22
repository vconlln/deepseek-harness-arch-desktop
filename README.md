# DSH Desktop · Arch Linux 适配

DSH Desktop 的 **Arch Linux 发行版**。它是 DeepSeek Harness 的 Electron 桌面壳:Electron 主进程内嵌启动官方 DSH Host,通过 loopback HTTP/WebSocket 提供原生窗口、系统托盘、profile 管理与内置 pnpm 运行时。

本仓库是 [deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 2.0.2 的 Arch 适配分支:保留上游全部桌面代码,**新增 Linux/Arch 打包链路**,上游 DeepSeek Harness 以 git 子模块固定版本(见 [upstream.json](upstream.json)),永不修改。

## 在 Arch Linux 上安装

### 方式一:pacman 包(推荐)

从 [Releases](../../releases) 下载 `.pacman` 产物后:

```sh
sudo pacman -U DSH-Desktop-<version>-x64.pacman
```

安装位置:应用本体在包内自带 Electron 运行时,启动器为 `/usr/bin/dsh-desktop`,桌面入口 `dsh-desktop.desktop` 由 pacman hooks 自动注册。

### 方式二:AUR

```sh
yay -S deepseek-harness-desktop-bin
# 或手工构建
git clone https://aur.archlinux.org/deepseek-harness-desktop-bin.git
cd deepseek-harness-desktop-bin && makepkg -si
```

PKGBUILD 位于 [dsh-plugin-desktop/aur/PKGBUILD](dsh-plugin-desktop/aur/PKGBUILD)。

### 方式三:AppImage(其他发行版兜底)

```sh
chmod +x DSH-Desktop-<version>-x64.AppImage
./DSH-Desktop-<version>-x64.AppImage
```

Arch 上运行 AppImage 需要 `fuse2` 包;或使用 `--appimage-extract-and-run` 免 FUSE 运行。

## 依赖与沙箱

- 必装依赖:pacman 包已声明 `gtk3`、`nss`、`alsa-lib`、`libxss`(Electron 运行库)。
- 沙箱:Agent 的文件系统沙箱由上游 `dsh-sandbox-local` 提供——优先 bubblewrap(`extra/bubblewrap`,可选依赖),未安装时自动回退 Landlock;两者都不可用时按上游策略降级。
- 自更新:Linux 版不内置自更新,升级走 pacman/AUR。

## 从源码构建

```sh
git clone --recurse-submodules <本仓库>
cd deepseek-harness-desktop-arch
corepack enable
corepack yarn install --immutable
corepack yarn check          # headless 全门禁(构建 + 类型 + 单测 + 闭包校验)
corepack yarn dist:linux     # 产出 dist/ 下 .pacman 与 .AppImage
```

环境要求:Arch Linux x64、Node.js ^22.19 或 >=24、corepack(Yarn 4.18.0)。`dist:linux` 会先跑 `check:linux-package` 门禁,再经 electron-builder 出包,最后由 [verify-linux-package.ts](dsh-plugin-desktop/scripts/verify-linux-package.ts) 校验产物(ASAR/desktop entry/图标/AppImage 外壳)。

## 目录结构

```text
dsh-plugin-desktop/    Electron 壳:Cordis Host/Client 面、profile、pnpm 运行时、打包与发布脚本
  scripts/package-linux.ts        Linux 出包入口(host-gate + 门禁 + electron-builder)
  scripts/verify-linux-package.ts 产物验证器(.pacman 内容 / desktop entry / AppImage)
  aur/                            AUR 包:PKGBUILD、desktop 参考文件、发布说明
dsh-community-market/  社区插件市场壳(与上游一致)
dsh-community-fabric/  社区互操作 RFC 脚手架(与上游一致)
docs/superpowers/specs/ Arch 适配设计文档
deepseek-harness/      上游 DeepSeek Harness 固定子模块(只读)
```

## 验证

```sh
corepack yarn check            # headless 全门禁
corepack yarn dist:linux       # 出包 + 产物验证
# 干装冒烟(无 root):解包 .pacman 校验布局;有 root 时:
# sudo pacman -U --root <临时根> DSH-Desktop-<version>-x64.pacman
```

## 与上游的关系

上游桌面代码仅作为基线导入,本分支不改动其运行时代码(自更新、目录选择、shell 模式、托盘终端等 Linux 行为与上游一致);上游 `deepseek-harness` 子模块版本由 [upstream.json](upstream.json) 固定。

## 许可证

[MIT](LICENSE);第三方依赖声明见 [dsh-plugin-desktop/THIRD_PARTY_NOTICES.md](dsh-plugin-desktop/THIRD_PARTY_NOTICES.md)。
