# 部署脚本
#!/bin/bash

echo "=== 负载均衡测试站点 K8s 部署脚本 ==="

# 检查kubectl是否可用
if ! command -v kubectl &> /dev/null; then
    echo "错误: kubectl 未安装或不在PATH中"
    exit 1
fi

# 检查docker是否可用
if ! command -v docker &> /dev/null; then
    echo "错误: docker 未安装或不在PATH中"
    exit 1
fi

# 设置变量
IMAGE_NAME="load-balancer-test"
IMAGE_TAG="latest"
NAMESPACE="default"

echo "1. 构建Docker镜像（支持多平台）..."
docker buildx build --platform linux/amd64,linux/arm64 -t ${IMAGE_NAME}:${IMAGE_TAG} --load .

if [ $? -ne 0 ]; then
    echo "错误: Docker镜像构建失败"
    exit 1
fi

echo "2. 检查Kubernetes连接..."
kubectl cluster-info &> /dev/null
if [ $? -ne 0 ]; then
    echo "错误: 无法连接到Kubernetes集群"
    exit 1
fi

echo "3. 应用Kubernetes配置..."

# 应用部署配置
echo "  - 应用部署配置..."
kubectl apply -f k8s/deployment.yaml -n ${NAMESPACE}

# 应用服务配置
echo "  - 应用服务配置..."
kubectl apply -f k8s/service.yaml -n ${NAMESPACE}

echo "4. 等待部署完成..."
kubectl rollout status deployment/load-balancer-test-deployment -n ${NAMESPACE}

echo "5. 获取服务信息..."
echo ""
echo "=== 服务状态 ==="
kubectl get pods -l app=load-balancer-test -n ${NAMESPACE}
echo ""
kubectl get services -l app=load-balancer-test -n ${NAMESPACE}

echo ""
echo "=== 访问信息 ==="

# 获取NodePort端口
NODEPORT=$(kubectl get svc load-balancer-test-nodeport -n ${NAMESPACE} -o jsonpath='{.spec.ports[0].nodePort}')
echo "NodePort访问: http://<节点IP>:${NODEPORT}"

# 获取LoadBalancer外部IP（如果可用）
EXTERNAL_IP=$(kubectl get svc load-balancer-test-service -n ${NAMESPACE} -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
if [ ! -z "$EXTERNAL_IP" ]; then
    echo "LoadBalancer访问: http://${EXTERNAL_IP}"
else
    echo "LoadBalancer外部IP: 待分配中..."
fi

echo ""
echo "=== 部署完成 ==="
echo "使用以下命令查看实时日志:"
echo "kubectl logs -f deployment/load-balancer-test-deployment -n ${NAMESPACE}"
echo ""
echo "使用以下命令删除部署:"
echo "kubectl delete -f k8s/ -n ${NAMESPACE}"