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

- **技术栈**: Express.js 4.18 + EJS 模板 + express-session
- **端口**: 默认 3000（可通过 PORT 环境变量修改）
- **会话**: 使用 JSESSIONID Cookie，会话超时 30 分钟

### 核心路由

| 路由 | 功能 |
|------|------|
| `GET /` | 首页，显示服务器IP、客户端IP、X-Forwarded-For等 |
| `GET /login` | 登录页面 |
| `POST /login` | 处理登录，保存会话信息（用户名、登录时间、服务器IP） |
| `GET /session-test` | 会话测试页面，验证会话保持和服务器匹配状态 |
| `GET /logout` | 销毁会话并登出 |
| `GET /long-connection` | 长连接业务测试页面（WebSocket / SSE / 长轮询） |
| `GET /admin/fault` | 业务故障注入管理页面（控制 `/health` 响应） |
| `GET /health` | F5 HTTP monitor 探测目标 |
| `WS /ws` | WebSocket 长连接端点 |
| `GET /sse` | Server-Sent Events 端点 |
| `GET /long-poll` | HTTP 长轮询端点 |

### 会话数据存储

登录后会话中保存：
- `isLoggedIn`: 登录状态
- `username`: 用户名
- `loginTime`: 北京时间格式的登录时间
- `serverIP`: 登录时的服务器IP

### 关键函数

- `getServerIP()`: 获取服务器外部 IPv4 地址（跳过内网接口）
- `getBeijingTime()`: 返回北京时间（格式：`YYYY/MM/DD HH:mm:ss`）

### 故障注入模式（in-memory per-Pod）

| 模式 | `/health` 响应 | F5 monitor 判定 |
|------|---------------|----------------|
| `none` | 200 + `HEALTHY\n` | UP |
| `http_500` | 500 | DOWN |
| `http_503` | 503 | DOWN |
| `slow` | 延迟 N 毫秒后 200 | DOWN (timeout) |
| `wrong_body` | 200 + 不含 `HEALTHY` | DOWN (Receive String 不匹配) |
| `reset` | TCP RST（连接重置） | DOWN (连接失败，最可靠) |

状态保存在本 Pod 内存中（`faultState` 对象），Pod 重启后自动恢复为 `none`。
状态变化通过 SSE `/api/fault/stream` 广播给所有订阅的管理页面。

### Kubernetes 配置

- **deployment.yaml**: 3 副本部署，配置了 liveness/readiness 探针，使用阿里云私有镜像仓库
  - 注意：liveness/readiness 使用 `/`（不是 `/health`），这样注入故障时 Pod 不会被 K8s 重启，状态可被 F5 HTTP monitor 准确探测
- **service.yaml**: 包含 LoadBalancer、NodePort 两种服务，以及 Ingress 配置示例

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 应用监听端口 |
| SESSION_SECRET | load-balancer-test-secret | 会话密钥 |

## 测试负载均衡

在 `/session-test` 页面可验证：
- **会话保持**: 检查 `isLoggedIn` 和会话数据是否持久
- **服务器匹配**: 对比 `sessionServerIP` 与 `currentServerIP` 判断请求是否路由到同一 Pod
- **X-Forwarded-For**: 检查负载均衡器转发的真实客户端 IP

## 测试 F5 Action on Service Down

1. 在 F5 上为后端 pool 配置 HTTP type monitor：
   ```
   ltm monitor http <name> {
       interval 5
       timeout 16
       send "GET /health HTTP/1.1\r\nHost: <vhost>\r\nConnection: close\r\n\r\n"
       recv "HEALTHY"
   }
   ```
2. 访问 `/admin/fault`，点击任一故障模式（如 `http_503`）。
3. 等待 1-2 个 monitor interval，F5 将该 member 标为 DOWN，触发 action on service down。
4. 在管理页面切回 `none`，F5 将 member 重新标为 UP。
