# 案件一致性、证据与庭审体验优化

本轮保留游客首页、双人房间、回合锁定、19家服务商配置和HTTPS密钥保护。首页布局没有重做。

## 数据核查结论

当前钻石案 ID 为 diamond-002，名称为《被偷走的虚拟钻石》，本来就是游戏资产转移案。转移记录、共用电脑登录、排行榜、自动演练、接收账户权限、演练许可、标签错误共七项材料均属于该案。不是实体珠宝失窃案混入数字资产证据。

服务器 room.caseId → getCase → createGame / getVisibleEvidence / getPublicEvidence → 私有 room:update；前端直接使用当前视图。准备阶段切换案件重置准备状态，正式开庭后不能切案。庭审本地选中证据也在案件或房间变化时清空。没有合并其他模板、写死测试材料或让模型补全事实的路径。

## 使用变化

- 三案21条证据统一用通俗名称、事实和含义说明；原始技术记录按需展开。内部ID仅用于协议与存储。
- EvidenceView.state 分开记录 disclosure、submitted、challenged、reviewed、targetable。“曾被质疑”不暗示质疑成功，具体结果看实录。
- 公开材料仍可首次出示；每份材料全局仅正式出示一次。道具检查只公开被选材料，不自动标成已出示。
- 律师表达和法庭结算分开。结算说明由规则引擎根据实际材料/结果产生，模型只生成台词。
- 玩家先选行动，再选必要材料/对方发言和战术；选好行动会收起选项，允许更换。仅点击确认会调用表达器。
- 对局采用屏内工作区；实录、证据、行动内容分别滚动。确认区保留在底部，窄屏使用三个标签切换。
- 首次短引导可关闭，浏览器只记住引导是否已读，不保存证据或密钥。

## 修改位置

server/cases.ts、game.ts、llm.ts、app.ts；shared/types.ts；CourtPage、ActionPanel、PlayerCard、ReportPage、frontend、App 与 turn.css。legacy-turn-game.ts 只用于旧快照回放。测试新增 evidence-experience，并扩展 server/llm 测试。

新案件快照 version=3、experienceVersion=1；证据ID、阵营、数值和双证关系保持。无需数据库迁移；旧快照按旧规则只读回放。

## 启动和验收

双击根目录“启动游戏.cmd”，按窗口打印的实际端口打开。HTTP仅用于免费预设，真实API继续使用 npm run dev:https。依赖/源码启动参见README。

193项自动化通过，6项MySQL跳过；类型与生产构建通过。双浏览器完整钻石案与390×844窄布局实际交互通过。没有付费调用、实体手机或公网部署验收。详见 VERIFICATION.md 与 screenshots/evidence-ui/。
