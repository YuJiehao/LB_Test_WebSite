# 负载均衡测试站点

一个专为负载均衡器功能测试设计的Web应用，支持会话保持验证和服务器信息展示。

## 功能特性

- 🖥️ **服务器信息展示**: 实时显示服务器IP地址、当前时间等信息
- 🌐 **网络信息监控**: 显示客户端IP、X-Forwarded-For等负载均衡器相关头部信息
- 🔐 **会话保持测试**: 支持Cookie和JSESSIONID会话保持验证
- 📊 **会话状态监控**: 详细的会话保持状态分析和判断依据
- 🎯 **服务器路由跟踪**: 检测请求是否路由到相同的后端服务器
- 🔌 **长连接业务测试**: WebSocket / SSE / HTTP 长轮询三种长连接模式
- ⚙️ **业务故障注入**: 通过修改 `/health` 响应让 F5 HTTP monitor 探测到业务故障，触发 action on service down

## 项目结构

```
.
├── app.js                 # 主应用文件
├── package.json           # Node.js依赖配置
├── Dockerfile            # Docker构建文件
├── k8s/                  # Kubernetes配置文件
│   ├── deployment.yaml   # 部署配置
│   └── service.yaml      # 服务配置
├── views/                # EJS模板文件
│   ├── index.ejs         # 主页面
│   ├── login.ejs         # 登录页面
│   ├── session-test.ejs  # 会话测试页面
│   ├── long-connection.ejs  # 长连接业务测试页面
│   └── fault-admin.ejs   # 故障注入管理页面
└── public/               # 静态文件目录
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

| 模式 | 响应行为 | F5 monitor 判定 |
|------|---------|----------------|
| `none` | 200 + body 含 `OK` | UP |
| `http_500` | 返回 500 | DOWN (状态码不匹配) |
| `http_503` | 返回 503 | DOWN (状态码不匹配) |
| `slow` | 延迟返回 (默认 60s) | DOWN (连接超时) |
| `wrong_body` | 200 + body 不含 `OK` | DOWN (Receive String 不匹配) |

#### F5 HTTP Monitor 配置参考

```
ltm monitor http <your-monitor-name> {
    defaults-from http
    interval 5
    timeout 16
    send "GET /health HTTP/1.1\r\nHost: <your-virtual-host>\r\nConnection: close\r\n\r\n"
    recv "OK"
    recv-disable none
}
```

#### 使用步骤

1. 在 F5 上为后端 pool 配置上述 HTTP type monitor。
2. 访问 `/admin/fault` 页面，注入任意故障模式（例如 `http_503`）。
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
| `GET /api/fault/stream` | SSE 实时推送状态变化和连接事件 |

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

- 服务器IP地址（识别后端Pod）
- 会话ID（JSESSIONID）
- 客户端IP地址
- X-Forwarded-For头部
- 会话创建时间
- 服务器匹配状态

## 故障排除

### 会话丢失问题
1. 检查JSESSIONID Cookie是否正确设置
2. 验证会话超时配置
3. 检查负载均衡器会话粘性配置

### 服务器路由问题
1. 确认Pod副本数量
2. 检查Service配置
3. 验证负载均衡器配置

### 网络问题
1. 检查X-Forwarded-For头部设置
2. 验证客户端IP获取
3. 确认负载均衡器代理配置

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