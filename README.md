# 负载均衡测试站点

一个专为负载均衡器功能测试设计的Web应用，支持会话保持验证和服务器信息展示。

## 功能特性

**核心测试能力**：

- **服务器信息展示**: 实时显示服务器 IP 地址、当前时间、客户端 IP 等
- **网络信息监控**: 显示 X-Forwarded-For 等负载均衡器添加的头部信息
- **会话保持测试**: 支持 Cookie 和 JSESSIONID 会话保持验证
- **会话状态监控**: 详细的会话保持状态分析和判断依据
- **服务器路由跟踪**: 检测请求是否路由到相同的后端服务器
- **长连接业务测试**: WebSocket / SSE / HTTP 长轮询三种长连接模式
- **业务故障注入**: 通过修改 `/health` 响应让 F5 HTTP monitor 探测到业务故障，触发 action on service down

**前端设计**（v1.2 起）：

- **暗色模式**: 自动跟随系统 + nav 右上角手动切换 + localStorage 持久化
- **响应式布局**: 桌面 4 列功能卡 → 平板 2 列 → 手机 1 列
- **无构建步骤**: 原生 CSS + vanilla JS + EJS partials，改完即生效
- **无障碍**: ARIA 导航 landmark、`:focus-visible` 焦点环、`prefers-reduced-motion` 支持
- **图标系统**: 28+ Lucide 路径 inline SVG 统一图标风格
- **Toast 通知**: 替代浏览器原生 alert，4 种类型 + 暗色适配
- **Footer 状态条**: 显示 Node 版本、hostname、uptime 等运行时信息
- **F5 配置复制**: 一键复制 TMSH 配置块到剪贴板

## 项目结构

```
.
├── app.js                      # 主应用: 路由 + 中间件 + WS/SSE 服务器
├── package.json                # Node.js 依赖 + npm scripts
├── Dockerfile                  # 多阶段构建
├── k8s/                        # Kubernetes 部署清单
│   ├── deployment.yaml         # 3 副本 + 探针 + 阿里云私有镜像
│   └── service.yaml            # LoadBalancer + NodePort + Ingress 例子
├── views/                      # EJS 模板
│   ├── index.ejs               # 首页 (hero + 4 功能卡 + 实时数据)
│   ├── login.ejs               # 登录
│   ├── session-test.ejs        # 会话验证
│   ├── long-connection.ejs     # WS / SSE / 长轮询
│   ├── fault-admin.ejs         # 故障注入管理
│   └── partials/               # 共享片段
│       ├── head.ejs            # <head>: meta + CSS + favicon + 主题/通知 JS
│       ├── nav.ejs             # sticky 顶栏: 4 链接 + Pod IP + 时钟 + 主题切换
│       ├── footer.ejs          # 底部信息条 (app 名/版本 + runtime + 资源链接)
│       └── icon.ejs            # inline SVG 图标库 (28+ 图标, Lucide 路径)
└── public/                     # 静态资源
    ├── favicon.svg             # 节点图 mark
    ├── css/
    │   ├── base.css            # tokens + reset + nav + hero + 暗色 + footer
    │   ├── info.css            # info-grid / info-item / info-section
    │   ├── status.css          # status-card / status-banner / badge
    │   ├── layout.css          # card / mode-card / stat-box / log-area / f5-config
    │   └── notice.css          # toast 样式
    └── js/
        ├── clock.js            # 实时时钟
        ├── logger.js           # 日志行 factory
        ├── notice.js           # toast 引擎 + window.alert shim
        └── theme.js            # 暗色模式 (早于 DOMContentLoaded 执行避免 FOUC)
```

## 快速开始

### 本地运行

1. 安装依赖
```bash
npm install
```

2. 启动应用
```bash
npm start
```

3. 访问应用
```
http://localhost:3000
```

### Docker运行

1. 构建镜像
```bash
docker build -t load-balancer-test .
```

2. 运行容器
```bash
docker run -p 3000:3000 load-balancer-test
```

### Kubernetes部署

1. 应用部署配置
```bash
kubectl apply -f k8s/deployment.yaml
```

2. 创建服务
```bash
kubectl apply -f k8s/service.yaml
```

3. 获取服务访问地址
```bash
# 对于NodePort服务
kubectl get svc load-balancer-test-service

# 对于LoadBalancer服务（如果支持）
kubectl get svc load-balancer-test-service -o wide
```

## 使用说明

### 基础功能测试

1. 访问主页查看服务器基础信息
2. 多次刷新页面观察服务器IP变化（如果配置了多副本）
3. 检查X-Forwarded-For等负载均衡器添加的头部信息

### 会话保持测试

1. 点击"登录测试会话保持"进入登录页面
2. 输入任意用户名和密码（仅用于测试）
3. 登录成功后查看会话保持测试结果
4. 多次刷新会话测试页面，观察：
   - JSESSIONID是否保持一致
   - 会话数据是否完整
   - 服务器路由是否按预期工作

### 负载均衡器配置验证

#### 会话粘性（Session Affinity）
- 如果配置了会话粘性，同一会话的请求应始终路由到同一服务器
- 观察"服务器匹配"状态应为"✅ 匹配"

#### 会话共享（Session Sharing）
- 如果配置了会话共享，请求可以路由到不同服务器但会话数据保持
- 观察"会话保持"状态为"✅ 成功"，但服务器可能不匹配

### 长连接业务测试

访问 `/long-connection` 页面，提供三种长连接测试模式：

1. **WebSocket 长连接**: `ws://<host>/ws`，可设置服务器推送间隔（默认 2s），支持双向通信。
2. **SSE (Server-Sent Events)**: `http://<host>/sse`，周期性推送事件，content-type 为 `text/event-stream`。
3. **HTTP 长轮询**: `http://<host>/long-poll?wait=<ms>`，服务器阻塞指定毫秒后响应（最多 120s）。

可验证 F5 的以下特性：
- WebSocket 透传 / OneConnect 复用
- 长连接 idle 超时
- chunked 响应保持

### 业务故障注入（测试 F5 Action on Service Down）

访问 `/admin/fault` 页面，可对本 Pod 注入不同类型的故障，让 F5 的 HTTP monitor 探测到并将 member 标记为 DOWN，从而触发 F5 上配置的 "Action on Service Down"。

#### 故障模式

| 模式 | 响应行为 | F5 monitor 判定 | 推荐度 |
|------|---------|----------------|--------|
| `none` | 200 + body `HEALTHY\n` | UP | - |
| `http_500` | 返回 500 + `ERROR-INJECTED\n` | DOWN (状态码) | |
| `http_503` | 返回 503 + `ERROR-INJECTED\n` | DOWN (状态码) | |
| `slow` | 延迟 `slowDelayMs` 毫秒后 200 | DOWN (连接超时) | |
| `wrong_body` | 200 + body `UNHEALTHY-INJECTED\n` (不含 `HEALTHY`) | DOWN (Receive String 不匹配) | |
| `reset` | 立即销毁 TCP socket (发送 RST) | DOWN (TCP 连接失败) | **推荐** |

#### F5 HTTP Monitor 配置参考

> **重要**: `recv` 字符串必须是 `HEALTHY`（不是 `OK`）。应用 `/health` 在正常模式下返回 `HEALTHY\n`。
> 如果写成 `OK`，F5 monitor 永远不通过，所有 Pod 永远 DOWN。

```
ltm monitor http <your-monitor-name> {
    defaults-from http
    interval 5
    timeout 16
    send "GET /health HTTP/1.1\r\nHost: <your-virtual-host>\r\nConnection: close\r\n\r\n"
    recv "HEALTHY"
    recv-disable none
}
```

> **推荐使用 `reset` 模式测试**: TCP RST 是最彻底的故障信号，不依赖 monitor 超时或字符串匹配，F5 在 TCP 层立即感知。

#### 使用步骤

1. 在 F5 上为后端 pool 配置上述 HTTP type monitor。
2. 访问 `/admin/fault` 页面，注入任意故障模式（**推荐 `reset`**）。
3. 等待 1-2 个 monitor interval，F5 会将本 Pod 标记为 DOWN。
4. 观察 F5 上配置的 "Action on Service Down" 是否正确触发。
5. 在管理页面将模式改回 `none`，验证 F5 将 Pod 重新标为 UP。

故障状态保存在本 Pod 内存中，Pod 重启后自动恢复为 `none`。

#### 关键端点

| 端点 | 说明 |
|------|------|
| `GET /health` | F5 HTTP monitor 探测目标 |
| `GET /admin/fault` | 故障注入管理页面 |
| `GET /api/fault` | 获取当前故障状态 (JSON) |
| `POST /api/fault` | 设置故障模式 (JSON body: `{mode, slowDelayMs?}`) |
| `GET /api/fault/stream` | SSE 实时推送状态变化、连接事件、连接统计 |
| `GET /api/connection-stats` | 获取当前连接计数 (JSON) |

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 3000 | 应用监听端口 |
| SESSION_SECRET | load-balancer-test-secret | 会话密钥 |

## Kubernetes配置说明

### 部署配置 (deployment.yaml)

- **副本数**: 默认3个副本，可根据需要调整
- **资源限制**: 已设置合理的CPU和内存限制
- **健康检查**: 配置了存活性和就绪性探针
- **环境变量**: 支持通过环境变量配置

### 服务配置 (service.yaml)

- **类型**: LoadBalancer（可改为NodePort或ClusterIP）
- **端口映射**: 80 -> 3000
- **会话亲和性**: 可通过sessionAffinity配置

### 会话保持配置示例

#### 启用会话粘性
```yaml
# 在service.yaml中添加
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800  # 3小时
```

#### 使用Ingress配置会话保持
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: load-balancer-test-ingress
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "lb-test-cookie"
    nginx.ingress.kubernetes.io/session-cookie-expires: "3600"
spec:
  rules:
  - host: lb-test.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: load-balancer-test-service
            port:
              number: 80
```

## 测试场景

### 场景1: 基础负载均衡测试
1. 部署多个副本
2. 通过负载均衡器访问应用
3. 多次刷新观察请求分发到不同Pod

### 场景2: 会话粘性测试
1. 配置会话粘性
2. 登录后多次刷新
3. 验证请求始终路由到同一Pod

### 场景3: 会话共享测试
1. 配置外部会话存储（如Redis）
2. 不配置会话粘性
3. 验证会话在不同Pod间共享

### 场景4: 故障转移测试
1. 配置会话粘性
2. 登录后删除当前Pod
3. 观察会话如何处理故障转移

## 监控指标

应用提供以下信息用于监控和调试：

**请求/会话层**：
- 服务器 IP 地址（识别后端 Pod）
- 客户端 IP 地址
- X-Forwarded-For 头部
- 会话 ID（JSESSIONID）
- 会话创建时间
- 服务器匹配状态
- 所有请求 Cookie

**故障注入层**：
- 当前 Pod 故障模式（`/health` 实际响应）
- 故障模式更新时间戳
- 慢响应延迟配置（`slowDelayMs`）
- 实时事件日志（SSE 推送）

**连接层**（实时）：
- 当前 WebSocket 连接数
- 当前 SSE 连接数
- 当前长轮询连接数
- 每条连接的事件日志（open/close + 客户端 IP + elapsed）

**运行时层**（footer 状态条）：
- Node.js 版本
- 操作系统与架构
- Pod 主机名
- 进程启动时长

## 故障排除

### 会话丢失问题
1. 检查 JSESSIONID Cookie 是否正确设置
2. 验证会话超时配置
3. 检查负载均衡器会话粘性配置

### 服务器路由问题
1. 确认 Pod 副本数量
2. 检查 Service 配置
3. 验证负载均衡器配置

### 网络问题
1. 检查 X-Forwarded-For 头部设置
2. 验证 `app.set("trust proxy", true)` 是否保留（必须保留才能让 `req.ip` 拿到真实客户端 IP）
3. 确认负载均衡器代理配置

### F5 monitor 永远 DOWN
1. **检查 `recv` 字符串**: 必须是 `HEALTHY`（不是 `OK`）。应用返回 `HEALTHY\n`。
2. **检查 `send` 字符串**: 必须包含 `Connection: close`，避免 F5 收到不完整的 chunked 响应。
3. **检查 `timeout`**: 必须大于 `slowDelayMs`（默认 16s > 60s 默认延迟，但 `slowDelayMs` 可调）。
4. **检查 F5 health monitor 探测是否经过反向代理**: 经过的话看是否携带正确 Host 头。

### 主题/Toast/UI 不工作
1. 确认 `public/css/notice.css`、`public/js/notice.js`、`public/js/theme.js` 三个资源能正常加载（看 Network 面板 200）
2. 暗色模式偏好存 `localStorage['lb-test-theme']`，手动清除可重置
3. Toast 不显示时，检查浏览器是否禁用了 JS 或扩展屏蔽了 DOM 操作

## 开发与贡献

### 本地开发
```bash
# 安装开发依赖
npm install

# 开发模式运行（自动重启）
npm run dev
```

### 构建和部署
```bash
# 构建Docker镜像
docker build -t your-registry/load-balancer-test:latest .

# 推送镜像
docker push your-registry/load-balancer-test:latest

# 更新Kubernetes部署
kubectl set image deployment/load-balancer-test-deployment app=your-registry/load-balancer-test:latest
```

## 许可证

MIT License