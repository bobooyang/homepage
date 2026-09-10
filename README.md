# iPhone Duo 交互样机

React + TypeScript + Three.js 构建的可操作三维样机，使用 Vite 开发与打包。

## 本地运行

使用 Node.js 22.12 及以上的 22.x 版本（仓库提供 `.nvmrc`），或 Node.js 24 / 26。

```sh
nvm use
npm ci
npm run dev
```

打开终端输出的本地地址，通常为 `http://127.0.0.1:5173/`。

```sh
npm test           # 交互状态测试
npm run typecheck  # TypeScript 检查
npm run build      # 类型检查与生产构建，输出 dist/
npm run preview    # 本地预览生产构建
```

## 操作

- 拖动旋转、滚轮缩放、双指平移；五个视角按钮用于恢复固定观察角度。
- 点击「合上」「展开」播放连续折叠动画；再次点击立即从当前角度接管，滑杆可暂停并停在任意角度。
- 点击机身上的电源键切换亮灭屏，音量键以 5% 调整音量，相机控制键提供按压反馈。
- 开合角度小于等于 20° 使用外屏，大于等于 30° 使用内屏，中间范围保留当前屏幕，避免反复切换。
- 开合和切换星白色 / 夜空色时保留亮灭屏、音量和角度状态。

音量仅用于样机状态展示，不控制操作系统音量。顶边远离铰链的按钮设为音量加，靠近铰链的设为音量减，这是样机的交互约定。

## 项目结构

```text
src/App.tsx                      React 界面与控制器生命周期
src/viewer/createDuoViewer.ts     Three.js 场景、拾取、动画与资源释放
src/viewer/interaction-state.ts   开合、屏幕和音量状态逻辑
src/viewer/interaction-state.test.ts
public/models/                   两种配色的交互 GLB
docs/models.json                 模型来源、动画名称与文件校验值
```

React 以状态快照更新界面，三维控制器负责画布及模型，不查询或修改界面控件。组件卸载时释放动画、监听器和 GPU 资源。开发环境启用 React StrictMode。

## 模型与部署

### GitHub Pages

主分支使用 `master`。在 GitHub 仓库 Settings → Pages 中，将 Build and deployment 的 Source 设置为 GitHub Actions。推送到 `master` 后，工作流会安装依赖、运行测试并构建，将 `dist/` 发布到 GitHub Pages。

部署成功后的公开访问地址：<https://bobooyang.github.io/homepage/>。

模型外形来自 Apple 的 iPhone Duo AR 资源，折叠中间姿态与按压动作由本项目制作，用于交互演示，未使用实测机械运动数据。来源链接与 SHA-256 见 [模型清单](docs/models.json)。每个 GLB 包含 `Fold`、`PressPower`、`PressCamera`、`PressVolumeUp`、`PressVolumeDown` 五个可复用动画片段；点击、亮灭屏和音量逻辑由网页实现。

GLB 和贴图随项目本地加载。构建时完整复制 `public/models/` 到 `dist/models/`，部署需上传整个 `dist/` 目录。Vite 使用相对资源路径，可部署在站点根目录或 `/homepage/` 等带末尾斜杠的子目录。运行时需要支持 WebGL 2 的浏览器。
