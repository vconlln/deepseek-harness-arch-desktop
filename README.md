# DSH Desktop · Arch Linux 适配版

DeepSeek Harness 的桌面客户端,Arch Linux 适配。Electron 壳内嵌官方 Host,自带系统托盘、多 Profile、插件市场与内置 pnpm 运行时。Agent 文件沙箱优先 bubblewrap,缺失时回退 Landlock。

## 要求

- Arch Linux x86_64
- Node.js >= 22.19
- git

## 构建

```sh
git clone --recurse-submodules https://github.com/vconlln/deepseek-harness-arch-desktop.git
cd deepseek-harness-arch-desktop
corepack enable
corepack yarn install --immutable
corepack yarn dist:linux
```

产物:

```text
dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.pacman
dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.AppImage
```

`dist:linux` 先跑 `check:linux-package` 门禁(构建、类型检查、打包相关测试、运行时闭包校验),再由 electron-builder 出包,最后经 `scripts/verify-linux-package.ts` 校验产物结构。

## 安装

```sh
sudo pacman -U dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.pacman
```

包名 `dsh-plugin-desktop`,卸载:

```sh
sudo pacman -R dsh-plugin-desktop
```

应用装在 `/opt/DSH Desktop/`;包的 post_install 钩子会创建 `/usr/bin/dsh-desktop`。

不安装、直接运行:

```sh
./DSH-Desktop-2.0.2-x64.AppImage --appimage-extract-and-run
```

装有 `fuse2` 时可直接执行,否则用上面的 extract-and-run 方式。

## 可选依赖

- `bubblewrap`:Agent 文件沙箱后端;未安装时自动回退 Landlock
- `fuse2`:直接运行 AppImage 所需

## 发布

GitHub Releases 目前为空。发布一次之后,Releases 下载与 AUR 安装才可用:

1. 仓库页面创建 Release,tag `v2.0.2`,上传上面两个产物;
2. 更新 `dsh-plugin-desktop/aur/PKGBUILD`:`_owner` 改为 `vconlln`,用 `sha256sum` 的结果替换 `sha256sums=('SKIP')`;
3. 之后即可 `yay -S deepseek-harness-desktop-bin`。

## 测试

```sh
corepack yarn check
```

全量门禁:双语文档配对、布局校验、构建、类型检查、单元测试、运行时闭包。

## 目录

```text
dsh-plugin-desktop/   桌面端主体与打包脚本
  scripts/package-linux.ts        出包入口
  scripts/verify-linux-package.ts 产物校验
  aur/                            PKGBUILD 与 desktop 参考
dsh-community-market/  插件市场(随桌面端打包)
dsh-community-fabric/  社区互操作规范
deepseek-harness/      官方上游固定版本(git 子模块)
docs/superpowers/specs/ Arch 适配设计文档
```
