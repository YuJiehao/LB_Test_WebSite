#!/bin/bash

echo "=== 多架构镜像构建脚本（仅构建和打标签）==="

# 检查docker是否可用
if ! command -v docker &> /dev/null; then
    echo "错误: docker 未安装或不在PATH中"
    exit 1
fi

# 设置变量
REGISTRY="192.168.2.60:5000"
IMAGE_NAME="loadblance/webserver"
IMAGE_TAG="latest"

# 启用BuildKit
echo "1. 启用BuildKit..."
export DOCKER_BUILDKIT=1

# 检查buildx是否可用
if ! docker buildx version &> /dev/null; then
    echo "错误: docker buildx 不可用"
    exit 1
fi

# 删除旧的构建器实例
echo "2. 清理旧的构建器..."
docker buildx rm multiplatform-builder 2>/dev/null || true

# 创建新的buildx实例
echo "3. 创建多平台构建器..."
docker buildx create --name multiplatform-builder --driver docker-container --use --bootstrap

if [ $? -ne 0 ]; then
    echo "错误: 创建构建器失败"
    exit 1
fi

# 构建多平台镜像到本地
echo "4. 构建多平台镜像（linux/amd64, linux/arm64）..."
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} \
    --output type=image,push=false \
    .

if [ $? -ne 0 ]; then
    echo "错误: 多平台镜像构建失败"
    echo "尝试单独构建各平台..."
    
    # 单独构建 amd64
    echo "5. 构建 amd64 镜像..."
    docker buildx build \
        --platform linux/amd64 \
        -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64 \
        --load \
        .
    
    if [ $? -eq 0 ]; then
        echo "   amd64 镜像构建成功"
        echo "   可以推送: docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64"
    fi
    
    # 单独构建 arm64
    echo "6. 构建 arm64 镜像..."
    docker buildx build \
        --platform linux/arm64 \
        -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64 \
        --load \
        .
    
    if [ $? -eq 0 ]; then
        echo "   arm64 镜像构建成功"
        echo "   可以推送: docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64"
    fi
    
    echo ""
    echo "=== 单独构建完成 ==="
    echo "请分别推送各平台镜像，然后创建manifest:"
    echo "docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64"
    echo "docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64"
    echo ""
    echo "创建多平台manifest:"
    echo "docker manifest create ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} \\"
    echo "  ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64 \\"
    echo "  ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64"
    echo ""
    echo "推送manifest:"
    echo "docker manifest push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
else
    echo ""
    echo "=== 多平台构建成功 ==="
    echo "镜像标签: ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
    echo "支持平台: linux/amd64, linux/arm64"
    echo ""
    echo "镜像已准备就绪，你可以手动推送:"
    echo "docker buildx build \\"
    echo "  --platform linux/amd64,linux/arm64 \\"
    echo "  -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} \\"
    echo "  --push \\"
    echo "  ."
fi