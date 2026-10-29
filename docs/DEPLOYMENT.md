# HTTPS 与双设备部署

本地预设试玩用 `npm run dev`。两台设备使用真实模型时，应从同一个受信任 HTTPS 域名访问，浏览器与服务器之间的 Socket.IO 也通过同一站点的 WSS/HTTPS 传输。

## 本机开发 HTTPS

```powershell
npm run dev:https
```

访问 `https://localhost:5173`。`.cert/localhost.pem` 和 `.cert/localhost-key.pem` 为开发脚本生成的自签名证书及私钥，证书有效期 30 天，仅匹配 `localhost` 和 `127.0.0.1`。脚本不会自动安装根证书、修改系统信任或为局域网 IP 签发证书。私钥不要复制给朋友或提交 Git。

如果浏览器阻止连接，先检查当前服务和证书确由自己启动、生成。可使用当前用户的证书管理器导入自己生成的证书以便本机开发，结束后可以移除信任。证书到期时，在停止开发服务后移走旧的这两份文件，再运行脚本重新生成；新证书若需要信任，也需重新核实。

Vite 开发服务器用于本机开发，不用来承担公网生产服务。局域网和公网使用实际主机名及适当的受信任证书；不要让朋友忽略不明来源的证书告警。

## 构建后置于 HTTPS 反向代理

1. 准备一个双方设备可访问的域名及其有效证书。生产环境用域名 DNS 和受信任证书；纯局域网可使用自己管理且已在参与设备信任的内部 CA。
2. 在服务器运行 `npm ci`、`npm run db:generate`、`npm run build`。
3. `.env` 配置后端仅监听回环地址，并填入准确的公开来源，例如：

```dotenv
HOST=127.0.0.1
PORT=3001
ALLOWED_ORIGINS=https://court.example.com
TRUST_PROXY=true
STORAGE_MODE=memory
```

`court.example.com` 为占位域名，需替换。来源包含协议、主机以及非默认端口，不带路径。公网需要留存战绩时按 README 使用专门的 MySQL 数据库；不要把已有项目的数据库复用为试玩库。

4. `npm start`，让同一机器的代理转发到 `127.0.0.1:3001`。前端构建文件由 Express 提供，不启动 Vite。
5. 仅向参与者提供 HTTPS 站点地址和房间码。检查两台设备均能连接、准备、完整完成一局预设对战，再自行通过配置页测试真实服务商。

服务端仅在 `TRUST_PROXY=true` 且请求实际来自回环地址时接受代理的 HTTPS 标记。代理应与 Node 进程运行于同一主机，并覆盖 `X-Forwarded-Proto`。不要把 Node 端口直接暴露公网，也不要接受客户端自行声称的 HTTPS 标记。若代理位于另一主机或容器网络，需要调整这一信任模型并独立验证，当前配置不自动支持任意远端代理。

Nginx 配置示例（需按安装环境替换证书路径、域名；不包含自动申请证书的流程）：

```nginx
# 放在 http 块中
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name court.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name court.example.com;
    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 90s;
    }
}
```

这段配置同时转发网页、`/api` 及 `/socket.io`，包括长轮询和 WebSocket 升级。请不要在代理配置或日志格式中记录请求体、Authorization 头、WebSocket 内容或玩家表单值。应用不会将玩家 Key 放在 URL；部署者也应保持这一边界。

## 数据、预算与重启

MySQL 模式仅保存公开玩家资料、案件模板、对局结果、经过过滤的关键事件与调用元数据。Key 不存在数据库列中。数据库密码通过服务端 `.env` 或秘密管理系统提供；`.env` 和 `.cert` 不属于前端构建产物。

`.runtime/daily-budget.json` 仅保存 UTC 日、请求数与预留数值，应在同一部署实例重启后保留。它不是玩家秘密或模型计费凭证。不可写或损坏时新请求会降级，不会默默清零预算。多进程无法通过这一文件安全共享预算或房间，因此第一版只运行一个服务端进程。

服务器重启会丢失当前房间和游客连接；MySQL 初始化会把遗留活动房间与进行中对局标记中止，不产生判决。部署更新前应让活跃对局结束，再停止和替换服务。不要在服务运行期间执行种子初始化。

## 常见问题

| 现象 | 检查项 |
| --- | --- |
| 网页能打开但一直未连接 | 确认 Node 后端运行、`ALLOWED_ORIGINS` 与浏览器地址一致，代理允许 `/socket.io` 轮询和升级。 |
| 提交真实 Key 提示必须 HTTPS | 确认地址栏为 HTTPS、代理覆盖 `X-Forwarded-Proto`、Node 收到的连接来自回环、`TRUST_PROXY=true`；本机开发使用 `dev:https`。 |
| 另一设备访问 localhost 无效 | localhost 指向对方自己的设备。提供可解析到服务器的实际 HTTPS 域名。 |
| Base URL 被拒绝 | 必须是所选国内厂商目录允许的官方地址，且为公网 HTTPS 443；不能填写任意第三方代理。检查是否混用了服务商、原生协议或 Coding Plan 的 Key/端点。 |
| 模型不存在 | 核对当前模型 ID、Chat Completions 协议及 Base URL 前缀。不要把 `/chat/completions` 整条路径填写为 Base URL。 |
| 额度/预算不足后使用预设台词 | 区分服务商账户余额和本服务器每日预算；检查自己的服务商控制台及服务端数值配置。 |
| MySQL 模式启动失败 | 检查专用库权限、`DATABASE_URL` URL 编码、端口、迁移和生成后的 Prisma 客户端；失败时不会静默改用内存模式。 |
| 重连后要求填写 Key | 密钥不长期存储，这是预期行为。重新提交原配置；若服务端已重启则新建房间。 |
| 改装备后是否要重新填 Key | 不需要。装备独立保存；若是断线、换服务商或换接口地址，才需要重新提供本局密钥。 |

公网域名、证书申请、系统服务托管、备份和真实服务商付费调用需要在实际部署环境完成验证，本项目的 Mock 测试不能替代这些检查。
