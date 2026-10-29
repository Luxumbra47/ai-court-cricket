> 历史记录：当前版本为 V2.0 玩家指挥回合制。正式玩法和界面以 README、RULES 及 VERIFICATION 的 V2.0 章节为准。

# 科技灰暗法庭：开发交接

交付日期：2026-10-28。面向后续开发配置、庭审与报告页面的工程师。本轮已经实施首页、选案弹层和等待室；全站深色统一是后续目标，其他三个页面当前仍沿用原有浅色主题。

## 1. 先看什么

- [实际首页](screenshots/dark/home.png)、[选案弹层](screenshots/dark/case-pizza.png)、[等待室](screenshots/dark/waiting-ready.png)。这些是本机浏览器截图。
- [手机首页](screenshots/dark/home-mobile.png)、[手机选案](screenshots/dark/case-mobile.png)、[手机等待室](screenshots/dark/waiting-mobile.png)。
- [实际动效录像](screenshots/dark/motion-flow.webm)：浏览器真实渲染帧，按采集时间编码；不是 AI 合成动画。
- [方向预览](design/dark-direction-preview.png) 是先前生成的概念图，仅用于风格校准；里面的案情、角色、菜单和数据不作为游戏需求。

## 2. 本轮实现与文件边界

| 文件 | 职责与改动 |
| --- | --- |
| `src/court-theme.css` | 新增独立深色主题，提供语义变量、三个区域的材质与动效；在原样式之后加载 |
| `src/main.tsx` | 导入新主题样式 |
| `src/App.tsx` | 根据当前路由启用深色；共享页头、页脚、导航和对话框随之切换；成功建房的视觉退场与导航并行 |
| `src/art.ts` | 统一素材路径与案件 ID 映射 |
| `src/components/CourtroomBackdrop.tsx` | 首页分层场景、视差、可见性与减少动态控制、局部扫描 |
| `src/components/CaseSelectionDialog.tsx` | 选案、图片交叉切换、文字揭示、可中断的关闭流程、焦点恢复 |
| `src/pages/HomePage.tsx` | 两段创建流程、同步提交锁、断线时可关闭弹层 |
| `src/components/WaitingSeat.tsx` | 固定角色席位、人物画面、在线与准备状态反馈 |
| `src/pages/RoomPage.tsx` | 按真实玩家状态检测入席、准备和开始条件，清理一次性提示 |

本轮没有修改 `ConfigPage.tsx`、`CourtPage.tsx`、`ReportPage.tsx`，也没有修改 `server/`、`shared/types.ts`、Prisma schema 或模型请求协议。公共 `PlayerCard` 的业务展示继续复用，准备页美术由 `WaitingSeat` 包装。

当前目录没有 Git 元数据，交接请以此清单逐文件合并，并保留朋友正在开发的页面版本。

## 3. 如何接入其他页面

1. 读取 `src/court-theme.css` 的 `.theme-court-dark` 变量定义，使用下面的语义表替换页面内的硬编码浅色。先处理容器、表单、提示和图表，再处理装饰。
2. 保留该页现有业务行为。配置页重点保留草稿、HTTPS 密钥提交、测试连接和锁定恢复；庭审页重点保留暂停跟随、证据权限及定位；报告页重点保留图表真实含义、未知费用及实录回跳。
3. 在适配好的页面上验证正文、辅助文字、表单、禁用态、焦点与弹窗。庭审／报告的图例同时使用文字和形状区分角色，不依赖蓝／琥珀颜色单独传意。
4. 页面适配完成后，扩展 `App.tsx` 的 `darkView` 条件，将该路由加入。当前仅 `home` 与 `room` 启用；选案弹层属于首页。等三页全部完成后再统一默认深色。
5. 重跑相关流程、刷新恢复、前进后退、手机和减少动态验证，保存新截图。验收通过后更新本文件的页面状态表。

| 页面 | 当前主题 | 后续工作 |
| --- | --- | --- |
| 首页、选案弹层、等待室 | 深色，已接入 | 维持本轮视觉与交互约定 |
| AI 配置 | 浅色，保留现有版本 | 接入深色表单、装备选项、错误与恢复提示 |
| 庭审实录 | 浅色，保留现有版本 | 接入深色发言、证据详情、思考状态，保持长文本可读 |
| 赛后报告 | 浅色，保留现有版本 | 接入深色图表、表格和判决信息，检查图例与定位 |

### 颜色与材质

实际颜色以 `src/court-theme.css` 为单一来源。正文使用系统中文无衬线字体，保持 16px 基础字号；明暗层次来自面板差异、细边框与局部光源。

| 变量 | 语义 |
| --- | --- |
| `--court-bg` | 深石墨灰页面背景 |
| `--court-panel` / `--court-raised` | 常规面板／抬升层 |
| `--court-input` / `--court-line` | 输入区域／可见边界 |
| `--court-text` / `--court-muted` | 冷白正文／辅助文字 |
| `--court-blue` | 辩方识别色、链接与局部全息光 |
| `--court-amber` | 控方识别色 |
| `--court-success` | 准备完成等成功状态，与控辩角色色分开 |
| `--primary` / `--primary-hover` | 实色操作按钮背景；按钮文字使用白色 |

兼容原组件的 `--bg`、`--surface`、`--text`、`--muted`、`--border` 等变量在深色作用域内指向上述语义。`html[data-court-theme="dark"]` 负责视口底色和原生控件色彩模式；`.app-shell.theme-court-dark` 负责组件作用域，离开适用路由会恢复原主题。不要只改根背景就把其他页面标记为已适配。

### 接口与状态

- 服务端 Socket.IO 事件及载荷保持原样。创建房间仍为 `room:create`，载荷 `{ nickname, caseId }`；房主换案仍为 `room:case`。
- 首页「选择案件」只打开弹层，最终「确认案件并创建」才发请求。同步 ref 锁防止同一事件循环内重复点击；失败后解除锁并保留选择。真实成功立即交给 `session.acceptJoin`，视觉退场不成为业务前置条件。
- `HomePage.onJoin(joined, created?)` 增加可选的纯视觉标志。创建成功传 `true`，加入房间不传；该参数不发给服务端。
- `CaseSelectionDialog` 的 `busy` 只表示提交锁，`canConfirm` 表示连接允许提交。断线时可以返回，提交期间锁住选择与关闭。
- 案件目录来自公开 `Catalog.cases`。UI 使用 `CaseSummary`，素材映射使用真实案件 ID。前端不要导入服务端完整案件模板来获取案情。
- 玩家固定按 `side` 入席：房主是蓝色 `defense`，加入者是暗琥珀 `prosecution`。在线、配置与准备状态继续以服务器公开视图为准。

### 动效约定

- 首页光束做真实位置移动，人物扫描使用透明素材作为 mask；仅装饰层视差，正文和表单固定。
- 弹层打开、返回、Esc 和关闭均有状态管理。普通关闭等待短暂退场并带超时兜底；业务成功立即导航，另一个不接收点击的图形退场层并行播放。
- 切案保留前一张图片完成交叉过渡，文字按所选 ID 重建短揭示。快速切换最终显示最后选项；图片失败只回退一次，避免无限错误请求。
- 等待室首次快照建立基线，新增玩家／离线转在线、未准备到准备、未就绪到双方就绪分别触发一次。相同广播、刷新、页面重新挂载不重放；取消准备／换案立即撤回准备反馈。
- `prefers-reduced-motion` 使用静态结果；手机首页关闭连续环境运动；页面隐藏、切离首页和打开选案时暂停环境动画。计时器、媒体查询监听和 rAF 随组件卸载清理。
- 动效时长在 CSS 中维护；不要用动画回调发送建房或开庭事件。

## 4. 素材与复现

正式素材在 `public/art/dark/`，网页使用 WebP，原始 PNG 保留供重做。底图、近景和人物是独立图层；近景与人物的 PNG 都验证存在真实透明像素。

| 文件 | 网页版大小 |
| --- | ---: |
| `courtroom-base.webp` | 150,042 bytes |
| `courtroom-foreground.webp` | 44,840 bytes |
| `courtroom-counsels.webp` | 285,030 bytes |
| `case-pizza.webp` | 145,008 bytes |
| `case-diamond.webp` | 172,922 bytes |
| `case-robot.webp` | 142,136 bytes |

素材由内置 imagegen 生成；实际提示词、原始来源及目标文件保存在 [DARK-ART-GENERATION.json](DARK-ART-GENERATION.json)。生成图本身不含真实案件文字，游戏案情与数值继续由 HTML 展示。旧浅色素材保留，不再用于这三个区域。

## 5. 验证与已知边界

实测结果见 [前端验证记录的深色改版章节](FRONTEND-VERIFICATION.md#2026-10-28-科技灰暗改版)。新增 `scripts/verify-ui-dark-theme.js` 检查真实空间运动、弹层退场、交叉切换、状态动画、离线返回、重复确认、主题隔离和实际颜色对比度。

本次发现旧 Vite 进程曾返回旧的组件转换缓存，已重启并对照浏览器实际 DOM 重新验证。如果后续磁盘与页面不一致，先检查所访问端口、开发进程和实际返回的组件内容，再重新启动对应开发服务。`npm start` 使用 `dist/` 与 `dist-server/`，需要先完成构建。

录屏使用 `scripts/record-dark-motion.mjs` 驱动 `record-ui-dark-motion.js`，通过 CDP 采集浏览器 JPEG 帧并按原始时间间隔编码 WebM。此机器的普通 `recordVideo` 和 CLI screencast 导出均报缺失文件，改用该采集方式。执行环境需已有 Playwright 和 FFmpeg，外部位置分别通过 `PLAYWRIGHT_MODULE`、`FFMPEG_PATH` 指定；未增加项目运行依赖。

MySQL 专用测试跳过；未执行真实付费模型、Docker、公网部署、真实手机或屏幕阅读器认证。对比度数据只覆盖记录中的实测文本／表面组合，不代表全站无障碍认证。

## 6. 给后续开发助手的提示词

```text
请先读 docs/DARK-THEME-HANDOFF.md，再接手我指定的配置／庭审／报告页面。
复用 src/court-theme.css 的语义颜色和控辩角色映射，保留该页现有业务与权限。
先完成页面中的硬编码浅色、表单、提示、图表和弹窗适配，再把该路由加入 App.tsx 的 darkView。
按交接文档检查键盘、手机、减少动态和相关完整流程；提供实机截图及实际测试结果。
保留已完成的首页、选案弹层和等待室版本，合并时按文件清单核对双方改动。
```
