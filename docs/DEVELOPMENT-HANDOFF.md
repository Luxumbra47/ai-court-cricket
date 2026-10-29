# V1.3 开发交接

这是可继续开发的源码仓库。桌面完整包中的node_modules、dist和dist-server被Git忽略，克隆后先安装和构建。不要把API Key、.env、证书私钥或数据库运行目录提交到Git。

## 用 GitHub Desktop 接手

1. 私有仓库所有者先在GitHub的Settings → Collaborators邀请开发者，对方接受邀请。
2. 对方在GitHub Desktop选择File → Clone repository，选择本仓库及本机保存位置。
3. 安装Node.js 24 LTS，在项目目录打开终端，执行下面命令。无需真实API或数据库即可完成双人试玩和测试。

```powershell
npm ci
Copy-Item .env.example .env
npm run db:generate
npm run typecheck
npm test
npm run build
npm run play
```

浏览器打开启动器打印的HTTP地址，选择“预设台词 · 免费试玩”，用两个独立标签会话创建/加入房间，双方准备后开始。首页分别设置案件难度和提示模式；完整对局有十二个机会，确认前不会调用模型。

使用真实模型须运行 `npm run dev:https`，核实并信任自己生成的本机证书后打开 `https://localhost:5173/`。密钥只在游戏配置表单中输入，不放入源码、聊天、提交说明或截图。外网/跨设备按DEPLOYMENT.md设置可信HTTPS域名；朋友电脑上的localhost不代表你的电脑。

## 开发时看哪里

| 范围 | 主要入口 |
| --- | --- |
| 新版固定案件、变体及自动选案 | server/cases-v3.ts |
| 新版回合、数值、资源、事件和复盘 | server/game-v3.ts |
| 新旧规则路由 | server/game.ts；旧引擎server/legacy-v12-game.ts |
| 统一预览与提示信息限制 | server/preview.ts、server/preview-v3.ts |
| 房间、权限、行动锁和幂等回执 | server/app.ts |
| LLM协议、超时、重试和预算 | server/llm.ts、shared/providers.ts |
| 类型、规则与结算文案 | shared/types.ts、shared/rules.ts、shared/presentation.ts |
| 首页、房间、庭审和报告 | src/pages/ |
| 行动确认与预览 | src/components/ActionPanel.tsx、ActionPreview.tsx |
| 测试 | tests/；v13-game和v13-server为本版重点 |
| 持久化 | prisma/schema.prisma、server/store.ts |

保持“玩家选行动 → 服务器锁定规则和骰值 → 模型表达 → 程序结算”。不得让模型选下一招、修改事实或决定胜负。切换选项和查看预览不得消耗资源或调用模型；硬核模式须从服务端移除预测字段。

## 提交与协作

每个改动先在GitHub Desktop创建自己的功能分支。提交前运行 `npm run typecheck`、相关测试和 `npm run build`，再Push origin、创建Pull Request。不要在main上覆盖另一人的工作；先Fetch origin，再更新自己的分支。不要提交node_modules或本机生成的构建目录。

修改v3判定时同步验证预览和严格复盘；旧八次行动必须仍按旧快照回放。十二案事实和关联需要版本化，不能在已开始的对局中改变。服务启动可能中止数据库中的遗留进行中对局，禁止新旧进程并行初始化同一库。

## 已验证与尚未验证

交付基线339项自动化测试通过，6项MySQL测试因未提供隔离库跳过，类型检查和生产构建通过；两个独立浏览器会话完成三档案件整局，216组离线路线严格复盘通过。详情见V1.3-VERIFICATION.md。

MySQL仅允许在专用court_test隔离库上设置TEST_DATABASE_URL后运行 `npm run test:mysql`。真实收费模型、公网部署和实体手机未在本轮验证；结构校验不能保证所有台词语义正确，脚本路线不构成竞技平衡证明。当前为单进程内存房间，服务器重启不能继续原对局。
