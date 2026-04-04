# BOP 页面入口与接口文档

## 1. 项目结构结论

当前前端不是传统的“多页面网站”，而是一个单页应用：

- 真实页面入口主要只有 `/`
- 大厅、登录、注册、忘记密码、设置、匹配中、模式分厅、对局内，很多都是同一个地址里的不同界面状态
- 唯一已经内建的直达参数，是 `?mode=...&view=...`

这意味着：

- 你后面改 UI，最好先在本地预览，不要每次先传云端
- 需要“直观看每个界面”，最合适的是用我给你做的 [`/ui-preview.html`](./public/ui-preview.html)

## 2. 推荐预览方式

### 本地预览

先启动本地环境：

```powershell
npm run local:start
```

然后打开：

- 主应用: `http://127.0.0.1:4180/`
- 预览导航页: `http://127.0.0.1:4180/ui-preview.html`
- API 健康检查: `http://127.0.0.1:8788/healthz`
- API 根入口: `http://127.0.0.1:8788/api/v1`

### 云端预览

当前阿里云入口：

- 主应用: `http://8.163.55.135/`
- 预览导航页: `http://8.163.55.135/ui-preview.html`
- API 健康检查: `http://8.163.55.135/healthz`
- API 根入口: `http://8.163.55.135/api/v1`

## 3. 前端页面入口

### 3.1 根入口

- 页面: 登录 / 注册 / 大厅主页
- 本地: `http://127.0.0.1:4180/`
- 云端: `http://8.163.55.135/`
- 说明:
  - 未登录时默认显示登录界面
  - 已登录时默认显示大厅主页

### 3.2 注册界面

- 入口地址: 还是 `/`
- 打开方式:
  - 根页面点击“注册”
  - 或用 `ui-preview.html` 里的“注册页”
- 说明:
  - 注册界面现在包含账号、昵称、邮箱、发送邮箱验证码、邮箱验证码、密码、确认密码

### 3.3 忘记密码弹窗

- 入口地址: 还是 `/`
- 打开方式:
  - 先到登录页
  - 点击登录框下方的“忘记密码”
  - 或用 `ui-preview.html` 里的“忘记密码弹窗”
- 说明:
  - 这是弹窗，不是单独新页面
  - 通过邮箱验证码找回密码

### 3.4 大厅主页

- 入口地址: 还是 `/`
- 条件: 必须已登录
- 打开方式:
  - 登录成功后自动进入
  - 或用 `ui-preview.html` 先登录后回到首页

### 3.5 模式分厅直达

支持的 `mode`：

- `ranked`
- `peak`
- `classic`
- `battleRoyale`

支持的 `view`：

- `hall`: 直达模式分厅
- `play`: 直达该模式玩法

#### 分厅地址

- 排位分厅:
  - 本地: `http://127.0.0.1:4180/?mode=ranked&view=hall`
  - 云端: `http://8.163.55.135/?mode=ranked&view=hall`
- 巅峰分厅:
  - 本地: `http://127.0.0.1:4180/?mode=peak&view=hall`
  - 云端: `http://8.163.55.135/?mode=peak&view=hall`
- 经典分厅:
  - 本地: `http://127.0.0.1:4180/?mode=classic&view=hall`
  - 云端: `http://8.163.55.135/?mode=classic&view=hall`
- 大逃杀分厅:
  - 本地: `http://127.0.0.1:4180/?mode=battleRoyale&view=hall`
  - 云端: `http://8.163.55.135/?mode=battleRoyale&view=hall`

说明:

- 这些地址只有在已登录状态下才会真正进分厅
- 未登录时会回到登录界面

### 3.6 对局玩法直达

- 排位玩法:
  - 本地: `http://127.0.0.1:4180/?mode=ranked&view=play`
  - 云端: `http://8.163.55.135/?mode=ranked&view=play`
- 巅峰玩法:
  - 本地: `http://127.0.0.1:4180/?mode=peak&view=play`
  - 云端: `http://8.163.55.135/?mode=peak&view=play`
- 经典玩法:
  - 本地: `http://127.0.0.1:4180/?mode=classic&view=play`
  - 云端: `http://8.163.55.135/?mode=classic&view=play`
- 大逃杀玩法:
  - 本地: `http://127.0.0.1:4180/?mode=battleRoyale&view=play`
  - 云端: `http://8.163.55.135/?mode=battleRoyale&view=play`

说明:

- 同样需要先有登录态
- 更适合你用来快速看玩法内 HUD、结算层、UI 遮罩

### 3.7 设置层

- 没有单独 URL
- 它是大厅或分厅里的弹层状态
- 建议用 `ui-preview.html` 里的“设置弹层”按钮进入

### 3.8 匹配中界面

- 没有单独 URL
- 它是大厅/分厅内部状态
- 建议通过分厅点击开始，或者用浏览器控制台调试函数切进去

## 4. 浏览器调试入口

前端在 `window` 上暴露了一组调试函数，定义位置在 [main.ts](D:/all/bop/src/main.ts)。

常用的几个：

- `debug_set_mode('classic')`
  - 打开某个模式分厅
- `debug_open_mode_hall('ranked', 'rules')`
  - 打开指定分厅和指定 tab
- `debug_backend_login_demo()`
  - 尝试用 demo 账号登录
- `debug_backend_logout()`
  - 退出登录
- `debug_finish_match('win')`
  - 强制预览胜利结算
- `debug_finish_match('lose')`
  - 强制预览失败结算
- `debug_finish_match('record')`
  - 强制预览破纪录结算
- `render_game_to_text()`
  - 输出当前页面状态 JSON

模式分厅 tab 支持：

- `rules`
- `rewards`
- `records`
- `guide`

示例：

```js
debug_open_mode_hall('classic', 'records')
```

## 5. 后端接口总入口

后端 V1 根入口定义在 [v1.ts](D:/all/bop/api-server/src/routes/v1.ts)。

### 基础接口

- `GET /healthz`
- `GET /api/v1`
- `GET /api/v1/platform/config`

## 6. 前端当前实际用到的核心接口

### 6.1 认证与账号

前端调用封装位置在 [authService.ts](D:/all/bop/src/network/authService.ts)。

- `POST /api/v1/auth/register`
  - 注册
  - 当前要求: `account + password + email + emailCode`
- `POST /api/v1/auth/login`
  - 密码登录 / 平台登录 / 短信登录
- `POST /api/v1/auth/refresh`
  - 刷新 token
- `POST /api/v1/auth/logout`
  - 退出登录
- `POST /api/v1/auth/email/send`
  - 发送邮箱验证码
- `POST /api/v1/auth/password/request-reset`
  - 请求找回密码验证码
- `POST /api/v1/auth/password/confirm-reset`
  - 提交验证码并重置密码
- `POST /api/v1/auth/bind/email`
  - 绑定邮箱
- `POST /api/v1/auth/bind/mobile`
  - 绑定手机

### 6.2 用户资料

- `GET /api/v1/user/me`
  - 拉当前用户资料、进度、UID
- `PATCH /api/v1/user/profile`
  - 更新昵称、头像

### 6.3 平台能力

前端调用封装位置在 [platformService.ts](D:/all/bop/src/network/platformService.ts)。

- `GET /api/v1/platform/config`
  - 拉当前云端能力开关
- `POST /api/v1/platform/commerce/checkout`
  - 商城下单
- `POST /api/v1/platform/storage/avatar/upload`
  - 上传头像
- `POST /api/v1/platform/ai/search`
  - AI 知识检索

### 6.4 大厅与社交

大厅数据聚合在 [lobbyService.ts](D:/all/bop/src/network/lobbyService.ts)。

- `GET /api/v1/social/overview`
  - 好友、申请、拉黑总览
- `GET /api/v1/social/search/:gameId`
  - 按 UID 搜索用户
- `POST /api/v1/social/friend-requests`
  - 发好友申请
- `POST /api/v1/social/friend-requests/:requestId/accept`
  - 同意好友申请
- `POST /api/v1/social/friend-requests/:requestId/reject`
  - 拒绝好友申请
- `DELETE /api/v1/social/friends/:gameId`
  - 删除好友
- `POST /api/v1/social/blocks`
  - 拉黑用户
- `DELETE /api/v1/social/blocks/:gameId`
  - 取消拉黑

### 6.5 排位与大厅卡面统计

- `GET /api/v1/ranking/overview`
  - 当前赛季、队列、段位、胜率

### 6.6 匹配

前端调用封装位置在 [matchmakingService.ts](D:/all/bop/src/network/matchmakingService.ts)。

- `POST /api/v1/matchmaking/start`
- `POST /api/v1/matchmaking/cancel`
- `GET /api/v1/matchmaking/status/:ticketId`
- `GET /api/v1/matchmaking/active`

### 6.7 私人房与联机房间

前端调用封装位置在 [roomService.ts](D:/all/bop/src/network/roomService.ts)。

- `POST /api/v1/room/create`
- `POST /api/v1/room/join`
- `POST /api/v1/room/leave`
- `POST /api/v1/room/ready`
- `GET /api/v1/room/:roomId`
- `GET /api/v1/room/invite/:inviteCode`
- `POST /api/v1/room/start-match`
- `POST /api/v1/room/session/sync`

### 6.8 对局结算进度

前端调用封装位置在 [progressionService.ts](D:/all/bop/src/network/progressionService.ts)。

- `POST /api/v1/progression/matches/complete`

## 7. 最适合你的工具

### 看页面最直观

推荐你直接用：

- 浏览器打开 `ui-preview.html`
- 浏览器开发者工具
- 本地运行 `npm run local:start`

这是你后面改 UI 最省时间的方式。

### 看接口最直观

推荐你用：

- Apifox
- Postman

原因：

- 可以把 `http://127.0.0.1:8788/api/v1` 当作本地接口环境
- 可以把 `http://8.163.55.135/api/v1` 当作线上接口环境
- 可以直接保存登录、注册、邮箱验证码、房间、社交这些请求

## 8. 最推荐的工作流

你后面细化每一层页面时，建议固定这样做：

1. 本地启动 `npm run local:start`
2. 打开 `http://127.0.0.1:4180/ui-preview.html`
3. 在预览页里切到你要改的界面
4. 改完代码直接刷新预览页核对
5. 满意后再部署到云端

这样你就不用每次改一点点 UI 都先上传服务器。
