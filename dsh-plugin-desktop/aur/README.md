# deepseek-harness-desktop-bin(AUR)

DSH Desktop 的 Arch Linux 二进制包。它直接解包上游 `.pacman` 发布产物,Electron 运行时随包内置。

## 安装

```sh
# 通过 AUR helper
yay -S deepseek-harness-desktop-bin

# 或手工构建
makepkg -si
```

安装后应用位于 `/opt/DSH Desktop/`,`post_install` 钩子会创建 `/usr/bin/dsh-desktop` 软链;桌面入口由 pacman hooks 自动注册。

## 依赖

- 必装: `gtk3`、`nss`、`alsa-lib`、`libxss`(Electron 运行库);
- 可选: `bubblewrap`(Agent 文件系统沙箱后端,未安装时自动回退 Landlock)、`fuse2`(AppImage 版需要)。

## 维护与发布

1. 在 deepseek-harness-desktop-arch 仓库出包: `corepack yarn dist:linux`;
2. 上传 `dist/DSH-Desktop-<version>-x64.pacman` 到 GitHub Release(标签 `v<version>`);
3. 更新 `pkgver` 与 `sha256sums`(用 `sha256sum` 计算后回填,替换 `SKIP`);
4. 推送到 AUR,用户侧 `yay -Syu` 即完成升级(Linux 版不自更新)。

`dsh-desktop.desktop` 是桌面入口的参考文件,与 electron-builder 的 `build.linux.desktop.entry` 保持一致,供 AUR 侧校验。
