# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

负载均衡测试站点 - 一个用于测试负载均衡器和会话保持功能的 Express.js Web 应用。

## 常用命令

```bash
# 安装依赖
npm install

# 生产环境运行
npm start

# 开发模式（自动重启）
npm run dev

# Docker 构建和运行
docker build -t load-balancer-test .
docker run -p 3000:3000 load-balancer-test

# Kubernetes 部署
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

## 架构

- **后端**: Express.js 4.18 + EJS 模板 + express-session
- **端口**: 默认 3000（可通过 PORT 环境变量修改）
- **会话**: 使用 JSESSIONID Cookie，会话超时 30 分钟
- **前端**: 原生 CSS (4 个文件 + 1 个 toast 样式) + vanilla JS (5 个文件) + inline SVG 图标库
- **无前端构建步骤**: 改 EJS/CSS/JS 后 `node app.js` 直接生效，不需要 webpack/vite

### 目录结构

```
.
├── app.js                      # 主应用: 路由 + 中间件 + WS/SSE 服务器
├── package.json                # 依赖 + npm scripts
├── Dockerfile                  # 多阶段构建
├── k8s/                        # 部署清单 (deployment.yaml + service.yaml)
├── views/                      # EJS 模板
│   ├── index.ejs               # 首页 (hero + 4 cards + live stats)
│   ├── login.ejs               # 登录
│   ├── session-test.ejs        # 会话验证
│   ├── long-connection.ejs     # WS/SSE/长轮询
│   ├── fault-admin.ejs         # 故障注入管理
│   └── partials/               # 共享片段
│       ├── head.ejs            # <head>: meta + CSS + favicon + 主题/通知 JS
│       ├── nav.ejs             # sticky 顶栏: 4 链接 + IP + 时钟 + 主题切换
│       ├── footer.ejs          # 底部: app 名/版本 + runtime + 资源链接
│       └── icon.ejs            # inline SVG 图标 (Lucide 路径库, 28+ 图标)
└── public/                     # 静态资源
    ├── favicon.svg             # 节点图 mark (替代 emoji favicon)
    ├── css/
    │   ├── base.css            # tokens + reset + nav + hero + feature-grid + 暗色 + footer
    │   ├── info.css            # info-grid / info-item / info-section
    │   ├── status.css          # status-card / status-banner / badge
    │   ├── layout.css          # card / mode-card / stat-box / log-area / f5-config
    │   └── notice.css          # toast 样式
    └── js/
        ├── clock.js            # 实时时钟
        ├── logger.js           # 日志行 factory
        ├── notice.js           # toast 引擎 + window.alert shim
        └── theme.js            # 暗色模式管理 (早于 DOMContentLoaded 执行)
```

### 核心路由

**页面路由**：

| 路由 | 功能 |
|------|------|
| `GET /` | 首页：hero + 4 功能卡片 + 本 Pod 实时连接数据 (SSE 订阅) |
| `GET /login` | 登录页 (任意用户名密码, 仅用于生成会话) |
| `POST /login` | 处理登录，保存会话 (用户名、登录时间、登录时 serverIP) |
| `GET /session-test` | 会话验证：JSESSIONID 一致性、服务器路由匹配、Cookie 详情 |
| `GET /logout` | 销毁会话 |
| `GET /long-connection` | WS / SSE / 长轮询 三种长连接业务测试 |
| `GET /admin/fault` | 故障注入管理 + 实时事件日志 + F5 配置参考 |

**API 路由**：

| 路由 | 功能 |
|------|------|
| `GET /health` | F5 HTTP monitor 探测目标 (返回 `HEALTHY\n` 或故障模式对应响应) |
| `GET /api/fault` | 获取当前故障状态 (JSON) |
| `POST /api/fault` | 设置故障模式 (`{mode}` 或 `{slowDelayMs}`) |
| `GET /api/fault/stream` | **SSE** 实时推送 `fault_state` / `conn_event` / `conn_stats` |
| `GET /api/connection-stats` | 获取当前连接计数 (JSON) |
| `WS /ws?interval=<ms>` | WebSocket 长连接端点 |
| `GET /sse?interval=<ms>` | Server-Sent Events 端点 |
| `GET /long-poll?wait=<ms>` | HTTP 长轮询端点 (max 120s) |

### 会话数据存储

登录后会话中保存：
- `isLoggedIn`: 登录状态
- `username`: 用户名
- `loginTime`: 北京时间格式的登录时间
- `serverIP`: 登录时的服务器IP

### 关键函数

- `getServerIP()`: 获取服务器外部 IPv4 地址（跳过内网接口）
- `getBeijingTime()`: 返回北京时间（格式：`YYYY/MM/DD HH:mm:ss`）
- `formatUptime(seconds)` (在 app.js 中): 把秒数格式化为 `Xh Ym` / `Xm Ys` / `Ys`

### 全局中间件

- **`app.use(res.locals.appInfo)`**: 把运行时元信息 (name/version/node/hostname/uptime/platform) 注入到所有 EJS 模板。footer.ejs 用此渲染底部信息条。
- **`res.locals.repoUrl`**: 注入 GitHub 仓库 URL，footer 渲染 Source 链接。
- **`:trust proxy = true`**: 信任所有反向代理的 `X-Forwarded-For` (让 `req.ip` 拿到真实客户端 IP 而不是 LB 的 IP)。
- **/health 必须在 session/cookie 中间件之前注册**: 避免 F5 monitor 探测产生会话和 Set-Cookie。

### 故障注入模式（in-memory per-Pod）

| 模式 | `/health` 响应 | F5 monitor 判定 |
|------|---------------|----------------|
| `none` | 200 + `HEALTHY\n` | UP |
| `http_500` | 500 + `ERROR-INJECTED\n` | DOWN (状态码) |
| `http_503` | 503 + `ERROR-INJECTED\n` | DOWN (状态码) |
| `slow` | 延迟 `slowDelayMs` 毫秒后 200 | DOWN (timeout, 默认 16s) |
| `wrong_body` | 200 + `UNHEALTHY-INJECTED\n` (不含 `HEALTHY`) | DOWN (Receive String 不匹配) |
| `reset` | TCP RST（连接重置） | DOWN (TCP 连接失败, **最可靠**) |

状态保存在本 Pod 内存中（`faultState` 对象），Pod 重启后自动恢复为 `none`。
状态变化通过 SSE `/api/fault/stream` 广播给所有订阅的管理页面。

### 前端设计系统

**设计 token** (改 `public/css/base.css` 顶部 `:root` 即可整体换主题)：

| 类别 | token |
|---|---|
| 主色 | `--color-primary` (浅 `#007bff` / 暗 `#38bdf8`) + 6 个状态色 |
| 文本 | `--color-text` / `--color-text-strong` / `--color-text-muted` |
| 背景 | `--color-bg` / `--color-bg-card` / `--color-bg-card-alt` / `--color-bg-muted` |
| 圆角 | `--radius-input: 6px` / `--radius-card: 10px` / `--radius-btn: 8px` / `--radius-pill: 999px` |
| 间距 | `--space-1`..`--space-8` (4px ~ 32px 节奏系统) |
| 阴影 | `--shadow-card` / `--shadow-focus` |
| 字体 | `--font-sans` (system stack) / `--font-mono` (JetBrains Mono 备选) |

**暗色模式**:
- 自动跟随 `prefers-color-scheme: dark` (用户首次访问时)
- nav 右上角 `#theme-toggle` 按钮手动切换
- 用户偏好存 `localStorage['lb-test-theme']`, 后续访问保留
- 日志区 (`.log-area`) 始终保持终端暗色, 不随主题切换
- 通过 `[data-theme="dark"]` CSS 变量覆盖实现, 不需要 JS 切换 class

**Toast 通知** (`public/js/notice.js`):
- API: `notice.toast(msg, type, duration?)` (type ∈ success/error/warn/info, duration 默认 4s, error 默认 6s)
- 自动 shim `window.alert` 转发到 toast (通过关键字 `失败|错误|fail|err` 识别 error 类型)
- 位置: 右下角, 堆叠, 最多约 5 个
- 4 类型左边框颜色不同, 暗色模式自动适配

**Icon 系统** (`views/partials/icon.ejs`):
- 28+ Lucide 路径 inline SVG (server, clock, globe, antenna, key, check, x, alert-triangle, log-in/out, refresh-cw, plug, settings, bar-chart-3, file-text, rocket, send, home, activity, zap, user, shield, cookie, list, heart-pulse, arrow-right, power, terminal, moon, sun, wrench)
- 用法: `<%- include('partials/icon', { name: 'server', size: 16 }) %>`
- 颜色: `currentColor` 继承父元素 text 色
- **约定: 不在 UI 文本中使用 emoji, 统一用 icon partial**

**Footer 元信息条** (`views/partials/footer.ejs`):
- 自动从 `res.locals.appInfo` 渲染, 无需每个页面传参
- 内容: app 名+版本 / Node 版本 / OS / hostname / uptime / Source 链接 / /health 链接
- 移动端 (≤700px) 自动纵向堆叠

### Kubernetes 配置

- **deployment.yaml**: 3 副本部署，配置了 liveness/readiness 探针，使用阿里云私有镜像仓库
  - 注意：liveness/readiness 使用 `/`（不是 `/health`），这样注入故障时 Pod 不会被 K8s 重启，状态可被 F5 HTTP monitor 准确探测
- **service.yaml**: 包含 LoadBalancer、NodePort 两种服务，以及 Ingress 配置示例

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 应用监听端口 |
| SESSION_SECRET | load-balancer-test-secret | 会话密钥 |

## 开发约定

- **不在 UI 文本中使用 emoji**，全部用 `partials/icon` 的 inline SVG
- **所有跨页面复用片段** (head/nav/footer/icon) 必须抽到 `partials/`，不要在 5 个 EJS 重复
- **新增长连接类型或新页面** 时, 先确认 SSE channel (`/api/fault/stream`) 是否能复用, 不要新增独立推送
- **修改 design token** (颜色/圆角/间距) 只动 `base.css` 顶部 `:root` 块, 不要在子 CSS 文件里硬编码
- **JS 错误通知** 统一用 `notice.toast(msg, 'error')`, 不要用 `alert()`

## 测试负载均衡

在 `/session-test` 页面可验证：
- **会话保持**: 检查 `isLoggedIn` 和会话数据是否持久
- **服务器匹配**: 对比 `sessionServerIP` 与 `currentServerIP` 判断请求是否路由到同一 Pod
- **X-Forwarded-For**: 检查负载均衡器转发的真实客户端 IP

## 测试 F5 Action on Service Down

1. 在 F5 上为后端 pool 配置 HTTP type monitor（**注意 recv 是 `HEALTHY` 不是 `OK`**）：
   ```
   ltm monitor http <name> {
       defaults-from http
       interval 5
       timeout 16
       send "GET /health HTTP/1.1\r\nHost: <vhost>\r\nConnection: close\r\n\r\n"
       recv "HEALTHY"
       recv-disable none
   }
   ```
2. 访问 `/admin/fault`，点击任一故障模式（推荐 `reset`，最可靠）。
3. 等待 1-2 个 monitor interval，F5 将该 member 标为 DOWN，触发 action on service down。
4. 在管理页面切回 `none`，F5 将 member 重新标为 UP。
