# Cloudflare Pages + D1 部署说明

目标结构：

- 前端：`https://bop-game.pages.dev`
- 后端：同站点 Pages Functions，地址是 `https://bop-game.pages.dev/api/v1`
- 数据库：Cloudflare D1

线上检查地址：

- `https://bop-game.pages.dev/healthz`
- `https://bop-game.pages.dev/readyz`

## 1. 创建 D1

Cloudflare Dashboard：

1. `Storage & Databases`
2. `D1 SQL Database`
3. 创建数据库，名字建议 `bop-game`

## 2. 给 Pages 绑定数据库

进入：

1. `Workers & Pages`
2. 选你的 `bop-game`
3. `Settings` -> `Bindings`
4. 添加一个 `D1 database binding`

绑定名必须是：

```text
DB
```

可选变量：

- `PUBLIC_WS_URL`
  - 以后如果你接了真实网关，再填 `wss://.../ws`
  - 现在不填也可以，后端会默认回当前 Pages 域名下的 `/ws`

## 3. 执行数据库初始化

初始化 SQL 已经放在：

- [cloudflare/d1/migrations/0001_initial.sql](/d:/all/bop/cloudflare/d1/migrations/0001_initial.sql)

现在这版代码会在第一次访问 `/readyz` 或任意 `/api/v1/*` 接口时自动创建基础表结构。  
只要 `DB` 绑定已经接好，通常不需要再手动跑 migration。

如果你本机能跑 `wrangler`，也可以直接执行：

```bash
npx wrangler d1 migrations apply bop-game --remote
```

如果这台机器还是有 `spawn EPERM`，也可以去 Cloudflare 的 D1 SQL 控制台里手动执行这份 SQL。

## 4. Pages 环境变量

建议保留：

```text
VITE_APP_ENV=production
VITE_USE_BACKEND_MATCHING=true
```

`VITE_API_BASE_URL` 和 `VITE_WS_BASE_URL` 建议删掉或留空。  
现在前端生产配置已经支持自动走当前 Pages 域名：

- `/api/v1`
- `/ws`

样板在：

- [.env.production.example](/d:/all/bop/.env.production.example)

## 5. 自动部署

如果 `bop-game.pages.dev` 已经连着 GitHub 仓库：

1. 推送到生产分支
2. Pages 会自动把 `dist/` 和 `functions/` 一起部署

部署完成后，先看：

1. `healthz`
2. `readyz`

第一次访问时可能会触发表结构自动初始化；随后 `readyz` 返回 `ready: true`，就说明 Pages Functions 和 D1 已经接起来了。  
如果仍然返回 `503`，就看响应里提示的是 `DB` 绑定缺失，还是自动建表本身失败。

## 6. 现在已经迁过去的接口

- 注册 / 登录 / 刷新 / 登出
- 用户资料同步
- 本地资料首登迁移
- 设置页开发者工具箱总览
- 私人房间创建 / 加入 / 准备 / 离开
- 匹配开始 / 取消 / 轮询
- 局后奖励写回

## 7. 当前边界

这次是把“账号和平台链路”迁到了 Cloudflare。  
`game-server` 目前仍然是 WebSocket 网关脚手架，不是完整的实时多人战斗服，所以真正的 `/ws` 对战链路后面还要继续补。
