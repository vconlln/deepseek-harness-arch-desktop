# dsh-wallpaper(本地维护版)

本仓库自有维护的 Web GUI 壁纸插件,基于社区版 dsh-wallpaper 0.1.3(Apache-2.0,作者 codeMonkey-Pine)派生:

- 扫描本地壁纸库(Steam 创意工坊 431960 + 本地 projects,无 project.json 时按扩展名识别);
- 图片 / 视频 / 网页壁纸原样渲染,场景壁纸降级为静态预览;
- 侧边栏「壁纸设计」面板:不透明度、作用范围、填充、高斯模糊、暗角、帧率、视差、轮播、主题联动;
- Agent 工具 wallpaper_scan / wallpaper_list / wallpaper_set / wallpaper_config。

## 与社区版的差异

- 修复三个工具返回值携带 undefined 字段导致 harness JSON 校验失败的问题(scan/list/config);
- 归属本仓库维护(author: vconlln),不经 npm 分发,通过 profile 的 link: 依赖直接使用本目录。

## 构建

```sh
corepack yarn workspace dsh-wallpaper build
```

产物: lib/index.js(宿主半)、lib/client.js(浏览器半)。

## 接入 desktop profile

```sh
cd ~/.dsh/profiles/desktop
pnpm add link:/home/vconlln/workspace/deepseek-harness-desktop-arch/dsh-plugin-wallpaper
```

重启 DSH Desktop 生效。

## License

Apache-2.0。原始代码版权归其作者,本仓库维护部分版权归 vconlln。
