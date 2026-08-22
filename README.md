# DSH Desktop · Arch Linux 适配版

DeepSeek Harness 的 **桌面客户端(Arch Linux 版)**:一个带窗口的 AI 编程助手,内置系统托盘、多 Profile 管理、插件市场、内置 pnpm 运行环境,Agent 的文件系统沙箱优先 bubblewrap、自动回退 Landlock。

---

## 🚀 三步上手(选一条路)

### 路 A:你机器上已经有安装包(最快)

如果 `dsh-plugin-desktop/dist/` 里已有产物(本仓库开发机就有),直接装:

```sh
sudo pacman -U dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.pacman
```

装完在应用菜单找到 **DSH Desktop** 打开即可。卸载:

```sh
sudo pacman -R dsh-plugin-desktop
```

### 路 B:从源码打包(任何时候都可行,约 5 分钟)

**前提**:Arch Linux x64、Node.js 22.19 以上、能联网。

```sh
# 1. 拉取代码(会自动带上官方引擎)
git clone --recurse-submodules https://github.com/vconlln/deepseek-harness-arch-desktop.git
cd deepseek-harness-arch-desktop

# 2. 安装依赖(需要几分钟,下载 Electron 等)
corepack enable
corepack yarn install --immutable

# 3. 出包(自动跑检查 → 打包 → 校验产物)
corepack yarn dist:linux
```

完成后安装包就在这里:

```text
dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.pacman     ← pacman 安装包
dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.AppImage   ← 免安装直跑版
```

```sh
sudo pacman -U dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.pacman
```

### 路 C:AppImage 免安装直跑(不想动系统时)

```sh
chmod +x DSH-Desktop-2.0.2-x64.AppImage
./DSH-Desktop-2.0.2-x64.AppImage
```

> AppImage 需要 `fuse2` 包;没装的话改用 `./DSH-Desktop-2.0.2-x64.AppImage --appimage-extract-and-run`。

---

## 📦 让别人也能下载(维护者做一次,做完 AUR 才生效)

**当前 GitHub Releases 还是空的**,所以上面的路 A/C 对"别人"暂时不可用。发布一次即可:

1. 打开仓库页面 → **Releases → Create a new release**;
2. Tag 填 `v2.0.2`,标题随意;
3. 上传 `dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.pacman` 和 `.AppImage`,点发布;
4. 更新 [dsh-plugin-desktop/aur/PKGBUILD](dsh-plugin-desktop/aur/PKGBUILD):把 `_owner` 改成 `vconlln`,用 `sha256sum` 算出校验和替换 `SKIP`,推送到仓库。

做完这些,别人就能:

```sh
# 从 Releases 下载安装包(网页点一下就行)
# 或通过 AUR 助手一键安装
yay -S deepseek-harness-desktop-bin
```

---

## ❓ 常见问题

| 问题 | 解决 |
|---|---|
| Releases 是空的,下载不了 | 用「路 B 从源码打包」,或让维护者按上一节发布一次 |
| `corepack: 未找到命令` | `sudo npm install -g corepack`,然后重新执行 `corepack enable` |
| `pacman -U` 提示权限不足 | 加 `sudo`(安装到系统目录需要 root) |
| 沙箱相关 | Agent 操作文件时优先用 bubblewrap(`sudo pacman -S bubblewrap`),没装会自动退回 Landlock,不影响使用 |
| 打出来的包怎么验证 | 出包命令自带校验器,检查 ASAR、启动器、桌面入口、图标;也可以跑 `corepack yarn check` 全量自检 |

---

## 🗂 目录结构(想改代码时看)

```text
dsh-plugin-desktop/  桌面端主体:窗口/托盘/Profile/插件市场/打包脚本
  scripts/package-linux.ts        出包入口(自动跑门禁 + 打包 + 校验)
  scripts/verify-linux-package.ts 产物校验器
  aur/                            AUR 包文件(PKGBUILD、desktop 参考、说明)
dsh-community-market/  插件市场(随桌面端一起打包)
dsh-community-fabric/  社区互操作规范文档
deepseek-harness/      官方引擎的固定版本(子模块,不要改)
docs/superpowers/specs/ Arch 适配设计文档
```

## 📄 许可证

MIT。原始代码版权归 Anywhere Labs(法律要求保留声明),Arch 适配部分版权归 vconlln。
