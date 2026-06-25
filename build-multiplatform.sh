#!/bin/bash

echo "=== 多平台构建脚本 ==="

# 检查docker是否可用
if ! command -v docker &> /dev/null; then
    echo "错误: docker 未安装或不在PATH中"
    exit 1
fi

# 设置变量
REGISTRY="172.20.20.250"
IMAGE_NAME="webapps/load-balancer-test"
IMAGE_TAG="latest"
REGISTRY_USER="admin"
# 密码必须从环境变量 REGISTRY_PASSWORD 传入，避免硬编码泄露
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"

# 配置 Docker 信任 Harbor 自签证书（HTTPS 不需要 insecure-registry）
echo "1. 配置 Docker 信任 Harbor 证书..."
DOCKER_CERT_DIR="/etc/docker/certs.d/${REGISTRY}"
HARBOR_CA_CERT="/opt/harbor/certs/ca.crt"

if [ -f "${HARBOR_CA_CERT}" ]; then
    if [ "$(id -u)" -eq 0 ]; then
        mkdir -p "${DOCKER_CERT_DIR}"
        cp "${HARBOR_CA_CERT}" "${DOCKER_CERT_DIR}/ca.crt"
        echo "   证书已配置到 ${DOCKER_CERT_DIR}/ca.crt"
    else
        echo "   非 root 用户，跳过自动证书配置"
        echo "   请手动执行: sudo mkdir -p ${DOCKER_CERT_DIR} && sudo cp <ca.crt> ${DOCKER_CERT_DIR}/ca.crt"
    fi
else
    echo "   未找到 Harbor CA 证书 ${HARBOR_CA_CERT}"
    echo "   若推送时出现 x509 错误，请手动添加证书"
fi

# 登录私有镜像仓库
echo "2. 登录私有镜像仓库..."
echo "${REGISTRY_PASSWORD}" | docker login ${REGISTRY} -u ${REGISTRY_USER} --password-stdin

if [ $? -ne 0 ]; then
    echo "错误: 登录私有镜像仓库失败"
    exit 1
fi

# 检查buildx是否可用，如果不可用则使用普通build
if docker buildx version &> /dev/null; then
    echo "3. 使用buildx进行多平台构建..."

    # 删除旧的构建器实例
    docker buildx rm multiplatform-builder 2>/dev/null || true

    # 创建新的buildx实例
    echo "   创建 buildx 构建器..."
    docker buildx create \
        --name multiplatform-builder \
        --driver docker-container \
        --use \
        --bootstrap

    # 多平台构建并推送
    echo "4. 构建并推送多平台 Docker 镜像..."
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} \
        --push \
        .
else
    echo "3. buildx不可用，使用普通构建..."

    # 普通构建
    echo "4. 构建Docker镜像..."
    docker build -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} .

    if [ $? -ne 0 ]; then
        echo "错误: Docker镜像构建失败"
        exit 1
    fi

    # 推送镜像
    echo "5. 推送镜像到私有仓库..."
    docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}
fi

if [ $? -ne 0 ]; then
    echo "错误: 镜像构建或推送失败"
    exit 1
fi

echo "6. 验证镜像..."
docker pull ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}

echo ""
echo "=== 构建完成 ==="
echo "镜像地址: ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "可以在其他机器上使用以下命令拉取镜像:"
echo "docker pull ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
