#!/bin/bash

echo "=== 多架构镜像构建脚本（构建到本地）==="

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

# 单独构建 amd64 镜像
echo "4. 构建 amd64 镜像..."
docker buildx build \
    --platform linux/amd64 \
    -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64 \
    --load \
    .

if [ $? -ne 0 ]; then
    echo "错误: amd64 镜像构建失败"
    exit 1
fi

# 单独构建 arm64 镜像
echo "5. 构建 arm64 镜像..."
docker buildx build \
    --platform linux/arm64 \
    -t ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64 \
    --load \
    .

if [ $? -ne 0 ]; then
    echo "错误: arm64 镜像构建失败"
    exit 1
fi

# 验证构建结果
echo "6. 验证构建结果..."
echo "本地镜像列表："
docker images | grep "${IMAGE_NAME}"

echo ""
echo "=== 构建完成 ==="
echo "已成功构建以下镜像："
echo "  - ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64 (linux/amd64)"
echo "  - ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64 (linux/arm64)"
echo ""
echo "手动推送步骤："
echo "1. 推送各平台镜像："
echo "   docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64"
echo "   docker push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64"
echo ""
echo "2. 创建多平台manifest："
echo "   docker manifest create ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} \\"
echo "     ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-amd64 \\"
echo "     ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}-arm64"
echo ""
echo "3. 推送manifest："
echo "   docker manifest push ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "完成后，Ubuntu x86 机器就能正常拉取镜像了！"