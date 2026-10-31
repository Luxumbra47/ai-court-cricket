# 验证记录 · 2026-10-31

本轮完成四个阶段：

- **玩法减法**：自动演出 + 暂停/恢复、每幕 3 次交锋 + 1 次回应（共 12 次行动）、私密方针卡与公开卡。
- **场景 P0**：三议题布景、三幕气氛、对手公开反应、程序化环境音、结束仪式。
- **隐藏副目标**：每个议题双方各一个不同副目标，对局中仅本人可见，赛后揭晓，达成 +5 心理分。
- **桌面交易重做**：常驻 12 枚筹码盘、小托盘物件与纸签、交易手摆放/收回、成交交接与封蜡、去掉循环底噪，并新增可公开检查的 `data-*` 状态。

服务端计分主体、底线生成、市场抽取、阶段顺序、语音接口和私密隔离未改。本阶段只改 3D 表现与本地音效；对局舞台仍只有全屏 3D。

## 自动化

- `npm run typecheck`：通过。
- `npm test`：5 个测试文件，60 项通过（新增 `tests/objectives.test.ts` 14 项）。
- `npm run build`：TypeScript、Vite 前端与服务端生产编译通过；主包约 341KB（gzip 约 108KB），3D 懒加载分块约 998KB（gzip 约 268KB）。
- 浏览器与测试中的模型适配器均为免费本地策略或本地注入实现，没有调用付费端点。

测试覆盖：

- 完整三幕每幕 3 次交锋 + 1 次回应，共 12 次；双方无输入自动完成、私密隔离、重复提交、查验资源、承诺与信任、席位认证与恢复、退出中止、HTTP 密钥拒绝、模型非法输出、超时及接管。
- 七类行动的结构化类型、执行结果、明确目标与角色状态映射；发言与结果关联为同一演出单元，重复事件去重。
- 无效报价不生成报价卡；未成立质疑的公开谈判桌渲染明确失败，保留声明与凭证；未验证声明不携带真假字段。
- 单方新报价不覆盖有效协议；公开事件序列化后重建、按行动回看、历史承诺快照与实际违约关联。
- 服务端门闩：双方确认、重复确认、旧确认、断线兜底、陪练豁免、无定时自动放行；自动确认只在客户端发生。
- 私密方针卡：服务端拒绝未知值、拒绝公开阶段携带方针，允许留白或仅方针；本地策略区分守价、试探、施压、成交，并在汇报中说明理解。
- 公开卡：承诺只绑定本方当前报价，违约仍扣信任与心理分；施压成为双方可见的结构化公开事件且不加分；表态保持原公开记录。
- 六个副目标的达成与未达成：声明未被反证 / 被成功反证、`challenge.upheld`、第二幕前首次协议、有效查验、带价格承诺守约 / 违约、成交余量 / 未成交。
- `project` 只投影本人副目标，对局中不含 `achieved/detail`；对端 `RoomView` 不含对方副目标；`Outcome.objectives` 赛后揭晓。
- 达成 +5 心理分、未达成 0 分，仲裁分与主交易收益不变；信任归零判负仍优先。
- 公开 `scenario`、公开事件与 Socket 数据不含副目标、私密汇报或底线；模型提示只含本方副目标并要求不公开复述。

## 真实浏览器

使用已安装的 Playwright CLI，在本地生产构建上运行：

```powershell
playwright-cli -s=immersive open http://localhost:3010
playwright-cli -s=immersive run-code --filename=scripts/immersive-browser-check.js
playwright-cli -s=immersive run-code --filename=scripts/immersive-unsupported-check.js
playwright-cli -s=scene open http://localhost:3010
playwright-cli -s=scene run-code --filename=scripts/immersive-scene-check.js
playwright-cli -s=trade open http://localhost:3010
playwright-cli -s=trade run-code --filename=scripts/trade-table-check.js
```

### 自动演出、暂停与双页同步

`immersive-browser-check.js` 返回 `passed: true`，`actions=12`，`pageerror` 与控制台错误为 0。脚本没有点击任何门闩。

- 双方提交私密方针卡后，自动演出自行产生首个 AI 行动；对端同步收到。
- 点击“暂停演出”后，门闩停在“继续”；对端显示“等待对方继续”。等待 1.6 秒期间两页行动数不变，没有重复确认或重复播放。
- 点击“恢复演出”后继续自动演出，两页行动计数与阶段保持一致。
- 三幕 12 次行动后自动结束，双方状态均为 `finished` 并生成赛后结果。
- 抽屉打开时自动演出暂停，关闭后恢复；抽屉遮罩底边 810，门闩顶边 816，门闩按钮仍可点击。
- 私密备注 `守价暗号` 未出现在对端 Socket.IO 数据或对端 DOM；包厢显示“本幕方针：守价”，代理人汇报包含对“守价”的解读。
- 公开承诺与公开施压分别成为双方可见的公开事件；公开卡未引入新计分。

### 3D 全屏舞台

- 对局只有全屏 3D，未渲染 `.theatre` 2D 舞台，也没有布局切换入口。
- `.negotiation-scene` 为 `position: fixed`，3D 画布与视口一致，`documentElement.scrollHeight` 等于视口高度，无外层滚动条。
- 1440×900：字幕底边 806，门闩顶边 816，按钮底边 881，`elementFromPoint` 命中按钮中心。
- 1920×1080：画布 1920×1080，按钮底边 1061，字幕底边 986。
- 1280×720：画布 1280×720，门闩 y=636，按钮底边 701，字幕底边 626；顶部 HUD、字幕和“继续”均完整可见。

| 窗口 | 画布 | HUD 高 | 门闩顶边 | 按钮底边 | 字幕底边 | 外层滚动 |
|---|---:|---:|---:|---:|---:|---|
| 1440 × 900 | 1440 × 900 | 62 | 816 | 881 | 806 | 无 |
| 1920 × 1080 | 1920 × 1080 | 62 | 996 | 1061 | 986 | 无 |
| 1280 × 720 | 1280 × 720 | 62 | 636 | 701 | 626 | 无 |

### 场景与声音

使用 `scripts/immersive-scene-check.js` 对三个议题分别创建练习局；三个页面均返回 `layout=full`、`canvas=true`、`theatre=false`，浏览器错误为 0：

- `last-battery`：`data-scene=last-battery`，`data-act=1`，可见暴雨窗光、应急灯、电池箱与积水反光。
- `last-ferry`：`data-scene=last-ferry`，`data-act=1`，可见港口雾、船钟、潮汐钟与货箱。
- `silent-archive`：`data-scene=silent-archive`，`data-act=1`，可见档案架、台灯、封存袋与灰尘。
- 顶栏“环境音”按钮可关闭/开启，`aria-pressed` 同步变化，偏好写入 `whisper-ambience-enabled`；三个页面均无 Web Audio 自动播放报错或外部请求。

场景实现核对：

- 第 1/2/3 幕使用 `MOODS` 三档色温、顶光角度、对比度与曝光；结束时画面明显比第 1 幕更暖、更亮。刷新进入当前幕直接呈现，不重播幕间过渡。
- 对手反应只读取公开 `ActionUnit`：有效质疑、质疑未成立、查验、成交、违约、暂缓分别对应前倾、后仰、靠近桌面、点头、收手、靠回椅背。
- 结束仪式：成交时合同纸滑入桌中央并出现金色封蜡；未成交时文件收拢、灯光逐盏熄灭；减少动态效果时直接呈现最终状态。
- 环境音由 Web Audio 程序化生成，朗读期间自动压低；组件卸载、对局结束和页面隐藏时停止。
- 音频经代码、UI 状态和浏览器错误检查验收，未做波形录制；对手反应与结束仪式的逐帧细节以截图和实现核对，未做像素级自动断言。

### 隐藏副目标

本局《最后一块电池》：

- 甲方 `credible-claim` 未达成（声明被成功反证，29 分）。
- 乙方 `refute-claim` 达成（心理分 +5，46 分获胜）。
- A 包厢显示自己的副目标标题、说明与“达成 +5 心理分”，看不到 B 的；B 包厢反之。
- A/B 的 `room:update` 载荷互不含对方副目标；公开事件、公开舞台、3D DOM 与顶栏均不含副目标文本。
- 点击“赛后复盘”后，“隐藏副目标”区块显示双方标题、`达成 · 心理分 +5` / `未达成` 与判定依据。

### 桌面交易重做

`scripts/trade-table-check.js` 返回 `passed: true`（练习局《最后一块电池》，2×）：

- 开局 `.stage-3d` 为 `data-chips=12`、`data-lot=last-battery`、`data-offer=none`、`data-agreement=none`、`data-trade=idle`；1920/1440/1280 画布均与视口一致，无外层滚动。
- 报价 `a:9`：`data-offer=a:9`，`data-trade` 依次为 `place → idle`；换价时 `withdraw → place → idle`。桌面显示 9 枚筹码、纸签“报价 9 枚”，剩余 3 枚留在“桌面筹码”盘内。
- 中途协议 `7`：`data-agreement=7`，协议卡显示“有效协议 · 待执行 / 合同已封存 · 物件尚未交付”与“待执行”封签；备用电池仍在卖方托盘，筹码转旧金并显示“协议 7 枚”。
- 成交 `8`：`data-trade=handoff` 持续约 850ms，结束后 `data-trade=idle`、`data-ceremony=deal`；筹码位于卖方侧、备用电池位于买方侧并显示“备用电池 · 已交付”，合同纸与金色封蜡落在桌面远端，双方名牌变亮。
- 音频审计：13 个 `AudioBufferSource` 与 28 个 `OscillatorNode` 全部调用 stop，`loops=0`；无 mp3/wav/ogg/m4a 等外部请求；朗读压低仍生效。
- 浏览器 pageerror / console error 均为 0。

**未成交结束**（双人房间 `UHCEMX`，双方“锋利”性格、每幕递交“守价”）：结果为 `outcome.price=null`、`data-ceremony=fail`，`data-trade` 从 `return` 回到 `idle`；12 枚筹码回盘、备用电池回到卖方托盘、没有合同/封蜡，灯光渐熄。该分支取决于本地策略的成交意愿，练习局几乎总会成交；这是本轮唯一未能由常规练习局稳定复现的验收项，截图来自上述双人房间实测。

**减少动态效果**：`last-ferry` 与 `silent-archive` 两个练习局在 `whisper-reduce-motion=true` 下全程 `data-trade=idle`，未记录到 `place / withdraw / handoff`；筹码与物件直接出现在最终位置，无手部移动，浏览器错误为 0。

**完整对局与同步回归**：`immersive-browser-check.js` 返回 `passed: true`、`actions=12`。暂停后门闩停在“继续”，对端显示“等待对方继续”，恢复后两页继续自动演出并保持一致；1440/1920/1280 门闩按钮均可点击；私密备注与隐藏副目标未泄漏；浏览器错误为 0。`immersive-scene-check.js` 三个议题均为 `layout=full / canvas=true / theatre=false`，环境音开关与 `whisper-ambience-enabled` 持久化正常；`immersive-unsupported-check.js` 仍只显示不可用提示。

### 不可用回落

`immersive-unsupported-check.js` 返回 `passed: true`：

- 窗口 800×900 只显示“3D 舞台不可用”，3D 画布卸载、无 2D 舞台、无横向溢出；回到 1440×900 后恢复。
- WebGL 不可用与 3D 分块加载失败两种模拟都只显示不可用提示，不渲染 2D 舞台。

## 实际截图

- [全屏 3D · 甲方席位 1440×900](screenshots/immersive-seat-a-1440.png)
- [全屏 3D · 乙方席位 1440×900](screenshots/immersive-seat-b-1440.png)
- [全屏 3D · 1920×1080](screenshots/immersive-1920.png)
- [全屏 3D · 1280×720](screenshots/immersive-1280.png)
- [幕后包厢与方针卡](screenshots/immersive-backstage-1440.png)
- [暂停后停在门闩](screenshots/immersive-paused-1440.png)
- [包厢打开时门闩仍可点击](screenshots/immersive-backstage-gate-1440.png)
- [桌面档案抽屉](screenshots/immersive-archive-1440.png)
- [公开低语与公开卡](screenshots/immersive-public-whisper-1440.png)
- [自动演出结束](screenshots/immersive-final-1440.png)
- [桌面交易开局 1440×900](screenshots/trade-open-1440.png)
- [桌面交易开局 1920×1080](screenshots/trade-open-1920.png)
- [桌面交易开局 1280×720](screenshots/trade-open-1280.png)
- [报价与手部摆放](screenshots/trade-offer-1440.png)
- [报价落位 1440×900](screenshots/trade-settled-1440.png)
- [报价 1920×1080](screenshots/trade-offer-1920.png)
- [报价 1280×720](screenshots/trade-offer-1280.png)
- [换价收回旧筹码](screenshots/trade-change-1440.png)
- [中途协议 · 待执行](screenshots/trade-agreement-1440.png)
- [成交交接与封蜡](screenshots/trade-deal-1440.png)
- [未成交结束](screenshots/trade-fail-1440.png)
- [减少动态效果 · 船票报价](screenshots/trade-reduced-offer-last-ferry-1440.png)
- [船票成交](screenshots/trade-deal-last-ferry-1440.png)
- [档案成交](screenshots/trade-deal-silent-archive-1440.png)
- [练习局零点击自动结束](screenshots/immersive-practice-final-1440.png)
- [电池议题场景](screenshots/scene-last-battery-act1.png)
- [船票议题场景](screenshots/scene-last-ferry-act1.png)
- [档案议题场景](screenshots/scene-silent-archive-act1.png)
- [包厢中的隐藏副目标](screenshots/objective-backstage-1440.png)
- [赛后复盘揭晓双方副目标](screenshots/objective-report-1440.png)
- [800px 窄屏不可用提示](screenshots/immersive-unavailable-800.png)
- [WebGL 不可用提示](screenshots/immersive-nowebgl-1440.png)
- [3D 分块加载失败提示](screenshots/immersive-load-failure-1440.png)

## 范围与限制

- 对局舞台仍只提供全屏 3D 第一视角；窗口宽度小于 900px、WebGL 不可用或 3D 加载失败时显示不可用提示，不提供 2D 兜底。
- 本阶段只改 3D 表现与本地音效，未改服务端规则、计分、阶段、行动数、AI、门闩与私密隔离；自动推进仍只发生在客户端。
- 私密方针、备注与隐藏副目标只进入本方代理人状态；公开卡只产生公开事件。
- 场景仍使用程序化低模和 Web Audio，不引入外部 GLB、音频文件或新依赖。
- 无成交结束在本地策略练习局中难以稳定复现，本轮使用双人“守价 + 锋利”房间验证；该分支仍属于概率性验收。
- 未做音频波形录制与像素级 3D 断言；以 Web Audio 节点审计、公开 `data` 属性与真实截图验收。手部动作是纯表现层，不改变行动数、门闩或玩家点击次数。
- 真实付费端点未调用；房间仍为服务器内存会话，服务重启需要新建对局。
- 分栏 3D、经典 2D、`whisper-layout-mode` 与旧 2D 浏览器脚本已移除，旧 `negotiation-*` 截图仅作为历史留存。
