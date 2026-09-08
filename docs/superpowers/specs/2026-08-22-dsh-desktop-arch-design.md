# DSH Desktop · Arch Linux 适配设计

日期: 2026-08-22 · 状态: 待评审
仓库: /home/vconlln/workspace/deepseek-harness-desktop-arch(deepseek-harness-desktop 2.0.2 的复制分支,原仓库保持不动)

## 1. 目标与范围

为 DSH Desktop(薄 Electron 宿主,内嵌上游 DeepSeek Harness Web 界面)补齐 Arch Linux 分发链路。
交付三种产物,覆盖两类安装方式:

1. **.pacman 包**(electron-builder pacman 目标)—— pacman -U 直接安装;
2. **.AppImage**(electron-builder AppImage 目标)—— 其他 Linux 发行版的通用兜底;
3. **AUR PKGBUILD**(deepseek-harness-desktop-bin)—— Arch 社区标准分发渠道,下载 .pacman 产物重打包。

**范围外(明确不做)**: 修改上游子模块;改变 Linux 运行时行为(自更新、目录选择、shell 模式、托盘终端均维持现状);.deb/.rpm;产物签名;GUI 交互测试(无显示环境下以 headless 门禁 + 包结构校验为准)。

## 2. 已验证的现状事实(实现依据)

- dsh-plugin-desktop/package.json 的 build.linux 已存在但只有 dir 目标,icon 已指向 build/app-icon.png。
- src/electron-platform.ts 已有 LinuxPlatformStrategy: updateDownloadPlatform=undefined(无自更新)、canPickDirectory=false(用应用内浏览选择器)、canToggleShellMode=false。
- src/index.ts:158 在 Linux 上拒绝 advanced shell 模式;cordis.patch.yml 已用 disabled: !!js process.platform === 'linux' 关闭 desktop-terminal 行 —— Linux 启动路径本身是干净的。
- scripts/verify-packaged-runtime.ts 的 afterPack 门禁已支持 Linux(win32||linux 分支读取 resources/app.asar),Linux 出包自动复用。
- dsh-plugin-desktop/package.json 无 author 字段;electron-builder 的 pacman 目标需要维护者元数据,必须显式提供 linux.maintainer/linux.vendor。
- 宿主机即 Arch Linux x86_64(Node 26.5.1、corepack 4.17.1),可在本机全链路验证。

## 3. 组件设计

### 3.1 打包脚本 dsh-plugin-desktop/scripts/package-linux.ts

仿 package-win.ts 的可注入边界结构:

- 导出 LinuxPackageOptions(env/platform/arch/nodeVersion/workspaceRoot/desktopRoot/builderCli/verifier/run/log)与 createLinuxPackageOptions();
- assertLinuxPackageHost(): platform === 'linux'、arch === 'x64'、Node ^22.19 || >=24(与仓库 engines 一致),不满足即抛出含当前值的错误;
- withoutLinuxSigningSecrets(): 剔除 CSC_* 等签名变量,与 Windows 版同构;
- packageLinuxArtifacts(): 先跑 check:linux-package 门禁(除非 DSH_PACKAGE_CHECK_ALREADY_RAN=1),再执行
  electron-builder --linux pacman AppImage --x64 --publish never --config.npmRebuild=false,
  最后运行 verify-linux-package.ts。任一命令非零退出即抛错;
- 直接执行时捕获错误、打印、process.exitCode = 1。

### 3.2 验证器 dsh-plugin-desktop/scripts/verify-linux-package.ts

全部校验函数导出为纯函数并注入 runner/路径,测试可无真产物运行:

1. **产物存在与命名**: dist/DSH-Desktop-<version>-x64.pacman 与 DSH-Desktop-<version>-x64.AppImage 存在(命名走 build.linux.artifactName 单一来源,版本从 package.json 读取);
2. **.pacman 内容**(用 bsdtar 模式限定列表,避免全量列表;缺 bsdtar 时报错提示安装 libarchive): 必须包含
   - 由 resources/app.asar 位置推导出的应用目录(实测为 /opt/DSH Desktop/)及同目录启动器 dsh-desktop、
   - resources/app.asar 与 app.asar.unpacked 树(用树内 package.json 单条证明,避免通配展开 2.5 万条目)、
   - usr/share/applications/dsh-desktop.desktop、
   - usr/share/icons/hicolor/*/apps/dsh-desktop.png、
   - .INSTALL 钩子(实测其 post_install 经 update-alternatives/ln -sf 创建 /usr/bin/dsh-desktop 软链,并处理 chrome-sandbox、mime/desktop 数据库与 AppArmor profile);
3. **desktop entry**(解包后解析): Exec 为带引号的真实启动器路径 + %U(实测 `"/opt/DSH Desktop/dsh-desktop" %U`)、Icon=dsh-desktop、Name=DSH Desktop、Categories 含 Development、Terminal=false、StartupWMClass=DSH Desktop;
4. **AppImage 外壳**: 文件以 0x7f 与 ELF 三字节开头、具有执行位;
5. 任何一项失败,汇总所有缺失项一次性抛错(而不是逐条早退)。

### 3.3 electron-builder 配置(dsh-plugin-desktop/package.json build)

替换现有 linux 块:

- target: [ { target: "pacman", arch: ["x64"] }, { target: "AppImage", arch: ["x64"] } ];
- executableName: "dsh-desktop"、icon: "build/app-icon.png";
- artifactName: "DSH-Desktop-<version>-<arch>.<ext>"(electron-builder 宏语法,沿用 win 块写法);
- maintainer: "DeepSeek AI <noreply@deepseek.com>"、vendor: "DeepSeek AI";
- category: "Development"、synopsis 与 description 沿用 package.json 现有 description("DSH Desktop: an Electron shell composed as a DeepSeek Harness Cordis plugin");
- desktop.entry: Name=DSH Desktop、Comment=DeepSeek Harness 桌面端、Categories=Development;Utility;、Terminal=false、StartupWMClass=DSH Desktop。
- 不动 appId(ai.deepseek.dsh.desktop)、afterPack、asarUnpack、electronFuses 等既有配置。

### 3.4 AUR 包 dsh-plugin-desktop/aur/

- PKGBUILD(pkgname deepseek-harness-desktop-bin):
  - pkgver=2.0.2、pkgrel=1、arch=(x86_64)、license=(MIT);
  - _artifact_url 变量指向 GitHub Release(owner 在 PKGBUILD 头部注释说明,提交 AUR 前替换);
  - source 使用 "<name>::<url>" 形式;sha256sums=('SKIP')(初始发布前无产物;aur/README.md 写明发布流程: 出包后 sha256sum 回填、bump pkgver);
  - depends=('gtk3' 'nss' 'alsa-lib' 'libxss')(Electron 运行库;Electron 本体随包内置,不列为依赖);
  - optdepends=('bubblewrap: 沙箱后端,未安装时自动回退 Landlock' 'fuse2: 运行 AppImage 版需要');
  - package(): bsdtar 解包到 pkgdir;无 install 脚本(desktop 数据库与图标缓存由 pacman 默认 hooks 刷新)。
- dsh-desktop.desktop: 与 electron-builder desktop.entry 完全一致(供 PKGBUILD 参考与校验),Exec=dsh-desktop。
- README.md: 安装三途径(pacman -U、AUR helper、AppImage --appimage-extract-and-run)、bwrap/Landlock 说明、发布流程(回填校验和)。

### 3.5 脚本入口与门禁

- dsh-plugin-desktop/package.json 新增 dist:linux(=node scripts/package-linux.ts)与 dist:arch 别名;新增 check:linux-package(market build → yarn run build → typecheck → 下列 vitest 文件 → verify:closure);
- 根 package.json 新增 dist:linux/dist:arch 转发;
- check:linux-package 包含: package.spec.ts package-linux.spec.ts verify-linux-package.spec.ts pkgbuild.spec.ts verify-packaged-runtime.spec.ts electron-platform.spec.ts update-checker.spec.ts update-download.spec.ts workspace-admission.spec.ts window-options.spec.ts。

### 3.6 测试(新增三个 vitest 文件)

- package-linux.spec.ts: host-gate 三类拒绝(非 linux、非 x64、Node 版本不符)、签名环境变量清除、命令序列与失败传播;
- verify-linux-package.spec.ts: 对合成 fixture 树验证 3.2 的每一条规则(缺失项汇总报错、desktop 字段、AppImage 魔数/执行位);
- pkgbuild.spec.ts: PKGBUILD 静态不变量(pkgname/-bin 后缀、pkgver 与桌面版本一致、depends/optdepends 词表、package() 用 bsdtar、desktop 文件与 build 配置字段一致)。

## 4. 数据流(一次 dist:linux 执行)

dist:linux(根) -> market build -> dsh-plugin-desktop build(tsdown + tsc)
  -> typecheck -> check:linux-package 的 vitest 子集 -> verify:closure
  -> electron-builder --linux pacman AppImage --x64
       (afterPack: verify-packaged-runtime 校验 ASAR/物理依赖/诊断 worker 冒烟,每个目标各跑一次)
  -> verify-linux-package(产物存在、.pacman 内容、desktop entry、AppImage 外壳)
  -> dist/ 下两个产物

## 5. 错误处理与失败模式

| 失败 | 处理 |
|---|---|
| 非 Linux / 非 x64 / Node 版本不符 | assertLinuxPackageHost 抛出含当前值的信息,exit 1 |
| 门禁或 builder 非零退出 | 原样传播退出码,脚本 exit 1 |
| 产物缺失/命名不符 | 验证器汇总列出期望与实得 |
| 缺 bsdtar | 报错并提示安装 libarchive |
| AUR 校验和不符 | SKIP 仅限首次发布;发布流程文档强制回填 sha256sums |

## 6. 成功标准(逐条可验证)

1. 原仓库 deepseek-harness-desktop 零改动(git status 干净);
2. 新仓库 corepack yarn check 全绿(含既有 headless 门禁);
3. corepack yarn dist:linux 产出两个命名正确的产物,verify-linux-package 通过;
4. 干装冒烟(无 root): bsdtar 解包 .pacman 到临时根,校验 /opt/DSH Desktop/ 布局、启动器 ELF(实测通过);有显示环境时短暂启动打包产物,确认桌面日志/lifecycle-events/内置 pnpm 运行时落盘(实测通过);若环境可提权,另做 pacman -U --root 真装;
5. 新增三个 vitest 文件全绿;
6. git 上游子模块 diff 为空(上游子模块未动)。

## 7. 遗留问题与后续(不阻塞本次交付)

- 原生目录选择器(Linux 需 zenity/kdialog)与高级 shell 模式是否在 Linux 启用,属于上游产品决策,本次不改;
- 无 GitHub Release 前,PKGBUILD 以 SKIP + 发布流程文档兜底;正式发布时回填校验和。
