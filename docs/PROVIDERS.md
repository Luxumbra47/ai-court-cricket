# 国内 LLM 服务商与协议验证

核对日期：2026-10-28。配置页提供 **19 个国内服务商预设**，另保留免费预设台词模式。通用「OpenAI 兼容接口」配置项已移除，后端也拒绝旧的 `openai-compatible` 服务商 ID。协议实现统一封装在 `server/llm.ts`，厂商目录在 `shared/providers.ts`。

“服务商”与“模型”不同：一个服务商可能有许多模型、地区和账户套餐。界面给出示例 ID，并允许手动输入控制台当前开通的完整模型 ID；示例不是永久有效的模型承诺。国内 API 平台和模型清单持续变化，不能承诺一个固定版本永久包含市场上的全部平台与全部模型。目录覆盖本轮已核实的主要国内 API，之后应按相同的官方文档、专属参数和模拟传输检查流程增加，而不是恢复任意代理入口。

## 已实现的服务商

下表中的 Base URL 是前缀，程序只向其追加 `/chat/completions`。均由服务端使用 HTTPS 和本人的密钥调用，不由浏览器直连，不共享双方凭据。

| 服务商 | 默认 Base URL | 凭据与边界 | 官方资料 |
| --- | --- | --- | --- |
| DeepSeek 深度求索 | `https://api.deepseek.com` | API Key；亦允许同一官方站点的 `/v1` 前缀 | [Chat Completions](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/) |
| 通义千问／阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 北京地域 API Key；支持控制台给出的北京业务空间专属域名 | [接口与地域](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[思考模式](https://help.aliyun.com/zh/model-studio/deep-thinking) |
| 豆包／火山引擎方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 方舟 API Key；模型名称或 `ep-` 推理接入点需要从本人控制台复制 | [Chat API](https://www.volcengine.com/docs/82379/1494384) |
| Kimi／月之暗面 | `https://api.moonshot.cn/v1` | 国内 API Key；K2.x 与 K3 的思考参数不同 | [Chat API](https://platform.kimi.com/docs/api/chat) |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | 通用模型 API Key；编码套餐专用 Key 要使用专属 `/api/coding/paas/v4` | [快速开始与鉴权](https://docs.bigmodel.cn/cn/api/introduction) |
| 文心／百度千帆 | `https://qianfan.baidubce.com/v2` | v2 API Key，不能拿旧 access_token 或 AK/SK 直接替代 | [千帆 v2](https://ai.baidu.com/ai-doc/WENXINWORKSHOP/wm9cvs292) |
| 腾讯混元 | `https://api.hunyuan.cloud.tencent.com/v1` | 混元 API Key，区别于云原生签名接口的 SecretId/SecretKey | [官方调用示例](https://cloud.tencent.com/document/product/1729/111007) |
| 讯飞星火 | `https://spark-api-open.xf-yun.com/v1` | HTTP 服务的 **APIPassword**；不同版本模型有各自凭据，不能填 WebSocket 的 APIKey/APISecret | [HTTP 文档](https://www.xfyun.cn/doc/spark/HTTP调用文档.html)、[X 系列](https://www.xfyun.cn/doc/spark/X1http.html) |
| MiniMax 稀宇科技 | `https://api.minimax.cn/v1` | 国内开放平台 API Key；保留旧官方 `https://api.minimaxi.com/v1`，不冒用 Coding Plan 端点 | [对话补全](https://platform.minimax.cn/docs/api-reference/text-chat-openai) |
| 阶跃星辰 StepFun | `https://api.stepfun.com/v1` | 国内开放平台 API Key；手动填写已开通模型 | [开放平台官方示例](https://platform.stepfun.com/) |
| 零一万物 Yi | `https://api.lingyiwanwu.com/v1` | Yi API Key；仅列 `yi-lightning` 示例，具体模型权限由控制台决定 | [官方 API 指南](https://platform.lingyiwanwu.com/docs)、[阿里云官方服务目录交叉确认](https://help.aliyun.com/en/api-gateway/ai-gateway/user-guide/creating-services) |
| 百川智能 | `https://api.baichuan-ai.com/v1` | API Key；部分服务需要单独申请开通 | [API 文档](https://platform.baichuan-ai.com/docs-v2/api) |
| 商汤日日新 SenseNova | `https://token.sensenova.cn/v1` | 新开放平台 API-Key；另允许已验证的旧 ModelStudio `/compatible-mode/v2`，不把 AK/SK 直接当 Key | [官方 API 指南](https://github.com/OpenSenseNova/SenseNova6.8/blob/main/API_CN.md)、[旧兼容端点](https://www.sensecore.cn/help/docs/model-as-a-service/nova/overview/compatible-mode) |
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | API Key；国产模型须使用完整厂商/模型 ID | [对话 API](https://docs.siliconflow.cn/docs/api/chat-completions-post) |
| 魔搭 ModelScope | `https://api-inference.modelscope.cn/v1` | ModelScope 访问令牌；仅限控制台标有 API-Inference 的模型，免费额度和实名要求由平台决定 | [API 推理介绍](https://modelscope.cn/docs/model-service/API-Inference/intro)、[官方社区示例](https://www.modelscope.cn/posts/1010?pid=1009) |
| 书生 InternLM | `https://chat.intern-ai.org.cn/api/v1` | API Token；官方计划于 2027-01-26 关闭旧入口，届时需要迁移 | [Chat API](https://internlm.intern-ai.org.cn/doc/docs/Chat/)、[模型与服务退役计划](https://internlm.intern-ai.org.cn/docEn/docs/Models/) |
| 360 智脑 | `https://api.360.cn/v1` | 360 开放平台 API Key；API 文档页内 `360gpt-pro` 为示例 | [Chat API](https://ai.360.com/docs/413291990e0) |
| 小米 MiMo | `https://api.xiaomimimo.com/v1` | MiMo API Key；官方同时提供 API-Key 与 Bearer 认证，本实现采用 Bearer | [Chat API](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api) |
| 华为云 MaaS | `https://api.modelarts-maas.com/openai/v1` | **MaaS_API_Key**；不混用 IAM Token、旧云原生 v2 路由与鉴权 | [MaaS 标准 API V1](https://support.huaweicloud.com/model-call-maas/model-call-020.html) |

以上为国内厂商命名预设；平台可能同时托管其他地区模型，本项目提供的模型示例只选择国产文本模型。手填 ID 必须以提供商账户中实际开通且支持文本对话的模型为准，不能把语音、图片生成、Embedding 或只支持另一协议的模型当作文本对话模型。

## 参数并非“一套模板套所有厂商”

- 所有请求为非流式对话，角色表现只由提示词影响，不向所有模型强加 `temperature`，避免 Kimi、MiniMax、MiMo 等模型的固定温度或思考模式限制。
- MiniMax、MiMo 使用官方的 `max_completion_tokens`；其他默认使用 `max_tokens`；旧 SenseNova `/compatible-mode/v2` 单独使用 `max_completion_tokens`。本局单次上限仍为 320 Token，不会为了某个思考模型自动扩大预算。
- DeepSeek、千问、方舟、Kimi、智谱、混元、硅基流动、MiMo 在已提供相应能力的协议下使用 `response_format: {type:"json_object"}`。其他接口没有明确统一 JSON 模式证据时只使用严格 JSON 提示词并做后端校验，未擅自发送此扩展。模型自身不支持该功能时，应选择控制台适用模型，而不是宣称任何 ID 都可用。
- 千问的可切换思考模型在非流式时使用 `enable_thinking:false`；方舟与 MiMo 使用其 `thinking.type:disabled`。智谱新 GLM 家族、Kimi K2.5/K2.6 仅在相应模型匹配时发送厂商思考开关。Kimi K3 始终思考，采用其官方 `reasoning_effort:low`；不会向 K3 或强制思考的 K2.7 Code 传入无效的关闭参数。
- InternLM 文档明确暂不支持额外参数，因此不会传入 `response_format`。MiniMax 新对话文档未声明该字段，也不会强行加入。
- HTTP 200 仍可能包含厂商逻辑错误，例如 MiniMax `base_resp.status_code`；本实现会映射为固定、安全的鉴权/额度/限流/不可用提示，不把上游原始说明或密钥返回前端。
- 强制思考模型可能在 320 Token 内只完成部分思考，或在本局超时前无法给出有效 JSON。仍按全局的有限重试和预设台词继续，不把技术故障扣成策略惩罚。推荐先用支持非思考、快速文本输出的模型测试。

## 保存与安全边界

`resolveConfig(input, previous)` 只在服务商及规范化后的完整 Base URL 与当前房间本人已保存配置相同时，复用服务端内存中的 Key。改模型或策略无需重复输入 Key；换服务商、换端点、断线清除 Key 后，必须重新输入。另一名玩家的配置永远不能作为复用来源。

接口地址只允许目录中明确列出的官方前缀。千问额外支持形如 `https://业务空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` 的北京专属域名，正则锚定整个地址，不能借后缀或额外路径跳转到任意网站。其他国内地域和厂商端点只有在官方文档确认并加入目录后才接受。全局 HTTPS、DNS 公网地址校验、解析地址固定、不跟随重定向、请求超时、每日预算、每局次数限制仍然适用。

## 本轮证据与未验证范围

已通过官方公开 API 页面核对路由、认证及主要请求/响应格式，并通过模拟 HTTPS 传输逐项验证 19 个预设的请求路径、本人 Bearer 密钥、输出上限、JSON 模式及 Token 读取。现有私网地址、混合 DNS、重定向、脱敏、超时、取消、重试、预算测试继续执行。

Yi 官方文档在本轮读取超时，接口地址与模型示例由阿里云官方服务目录交叉确认；ModelScope 文档是前端渲染页面，另采用魔搭官方社区示例验证端点。平台登录、每位玩家的开通状态、模型当前余量、服务商真实账单不在公开文档读取或模拟测试的证明范围内。

**未使用真实玩家 Key，也没有执行任何付费模型请求。** 目录与模拟测试证明了实现的路由与协议行为，不等价于每一真实账户的在线连通性。请通过 HTTPS 配置页的「测试连接」验证自己的服务商、Key、模型 ID 和对应地域权限。
