#!/bin/bash

echo "=== 构建镜像脚本（仅构建和打标签）==="

# 检查docker是否可用
if ! command -v docker &> /dev/null; then
    echo "错误: docker 未安装或不在PATH中"
    exit 1
fi

# 设置变量
REGISTRY="192.168.2.60:5000"
IMAGE_NAME="loadblance/webserver"
IMAGE_TAG="latest"

# 确保不使用buildx
echo "1. 禁用buildx，使用传统构建..."
export DOCKER_BUILDKIT=0

# 构建镜像
echo "2. 构建Docker镜像..."
docker build --no-cache -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} .

if [ $? -ne 0 ]; then
    echo "错误: Docker镜像构建失败"
    exit 1
fi

# 显示构建结果
echo ""
echo "=== 构建完成 ==="
echo "镜像标签: ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
echo "构建平台: $(uname -m)"
echo ""
echo "镜像已准备就绪，你可以手动推送:"
echo "docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "或者先登录后推送:"
echo "docker login ${REGISTRY}"
echo "docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"