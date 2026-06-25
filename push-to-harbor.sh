#!/bin/bash
# =============================================================================
# push-to-harbor.sh
# 构建 load-balancer-test 镜像并推送到 Harbor 私有镜像仓库
# Harbor 地址: 172.20.20.250
# =============================================================================

set -euo pipefail

# ---- 可配置变量（按需修改）----
HARBOR_HOST="172.20.20.250"
HARBOR_USER="admin"
# 密码必须从环境变量 HARBOR_PASS 传入，避免硬编码泄露。
# 使用方法：export HARBOR_PASS='Harbor12345' && bash push-to-harbor.sh v1.2
HARBOR_PASS="${HARBOR_PASS:-}"
HARBOR_PROJECT="webapps"         # Harbor 项目名，不存在时自动创建
IMAGE_NAME="load-balancer-test"
IMAGE_TAG="${1:-v1.2}"           # 默认 v1.2，可通过第一个参数覆盖
FULL_IMAGE="${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:${IMAGE_TAG}"
LATEST_IMAGE="${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}:latest"

# ---- Harbor CA 证书路径（Harbor 服务器上的位置）----
HARBOR_CA_CERT="/opt/harbor/certs/ca.crt"
DOCKER_CERT_DIR="/etc/docker/certs.d/${HARBOR_HOST}"

# ---- 颜色输出 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---- 前置检查 ----
check_prerequisites() {
    log_info "检查前置条件..."
    if ! command -v docker &>/dev/null; then
        log_error "未找到 docker 命令，请先安装 Docker"
        exit 1
    fi
    if ! docker info &>/dev/null; then
        log_error "Docker daemon 未运行或当前用户无权限，请检查"
        exit 1
    fi
    if [ ! -f "Dockerfile" ]; then
        log_error "未在当前目录找到 Dockerfile，请在项目根目录执行本脚本"
        exit 1
    fi
    log_ok "前置条件检查通过"
}

# ---- 信任 Harbor 自签证书（需要 root 权限）----
trust_harbor_cert() {
    if [ -f "${HARBOR_CA_CERT}" ]; then
        log_info "配置 Docker 信任 Harbor 自签证书..."
        mkdir -p "${DOCKER_CERT_DIR}"
        cp "${HARBOR_CA_CERT}" "${DOCKER_CERT_DIR}/ca.crt"
        log_ok "证书已复制到 ${DOCKER_CERT_DIR}/ca.crt"
    else
        log_warn "未找到 Harbor CA 证书 ${HARBOR_CA_CERT}，跳过证书配置"
        log_warn "若推送时出现 x509 错误，请手动将 Harbor CA 证书添加到:"
        log_warn "  ${DOCKER_CERT_DIR}/ca.crt"
    fi
}

# ---- 通过 Harbor API 创建项目（若不存在）----
create_harbor_project() {
    log_info "检查 Harbor 项目 '${HARBOR_PROJECT}' 是否存在..."
    local http_code
    http_code=$(curl -sk -o /dev/null -w "%{http_code}" \
        -u "${HARBOR_USER}:${HARBOR_PASS}" \
        "https://${HARBOR_HOST}/api/v2.0/projects?name=${HARBOR_PROJECT}")

    if [ "${http_code}" == "200" ]; then
        # 检查返回内容是否包含该项目
        local result
        result=$(curl -sk -u "${HARBOR_USER}:${HARBOR_PASS}" \
            "https://${HARBOR_HOST}/api/v2.0/projects?name=${HARBOR_PROJECT}")
        if echo "${result}" | grep -q "\"name\":\"${HARBOR_PROJECT}\""; then
            log_ok "Harbor 项目 '${HARBOR_PROJECT}' 已存在"
            return 0
        fi
    fi

    log_info "创建 Harbor 项目 '${HARBOR_PROJECT}'..."
    local create_code
    create_code=$(curl -sk -o /dev/null -w "%{http_code}" \
        -X POST \
        -u "${HARBOR_USER}:${HARBOR_PASS}" \
        -H "Content-Type: application/json" \
        -d "{\"project_name\":\"${HARBOR_PROJECT}\",\"public\":false,\"metadata\":{\"public\":\"false\"}}" \
        "https://${HARBOR_HOST}/api/v2.0/projects")

    if [ "${create_code}" == "201" ]; then
        log_ok "Harbor 项目 '${HARBOR_PROJECT}' 创建成功"
    else
        log_warn "创建项目返回状态码 ${create_code}，请登录 Harbor UI 手动确认项目是否存在"
    fi
}

# ---- 登录 Harbor ----
login_harbor() {
    log_info "登录 Harbor (${HARBOR_HOST})..."
    if echo "${HARBOR_PASS}" | docker login "${HARBOR_HOST}" \
        --username "${HARBOR_USER}" \
        --password-stdin; then
        log_ok "Harbor 登录成功"
    else
        log_error "Harbor 登录失败，请检查账户密码和网络连通性"
        exit 1
    fi
}

# ---- 构建镜像 ----
build_image() {
    log_info "构建镜像: ${FULL_IMAGE}"
    log_info "构建平台: linux/amd64 (k8s 节点架构)"
    docker build \
        --platform linux/amd64 \
        --tag "${FULL_IMAGE}" \
        --tag "${LATEST_IMAGE}" \
        --label "build.date=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --label "build.version=${IMAGE_TAG}" \
        --label "build.repo=Project_1/load-balancer-test" \
        .
    log_ok "镜像构建完成: ${FULL_IMAGE}"
}

# ---- 推送镜像 ----
push_image() {
    log_info "推送镜像到 Harbor..."
    docker push "${FULL_IMAGE}"
    docker push "${LATEST_IMAGE}"
    log_ok "镜像推送完成"
    log_ok "  版本标签: ${FULL_IMAGE}"
    log_ok "  latest 标签: ${LATEST_IMAGE}"
}

# ---- 输出后续步骤提示 ----
print_next_steps() {
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN} 镜像已成功推送到 Harbor！${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "${BLUE}镜像地址:${NC} ${FULL_IMAGE}"
    echo ""
    echo -e "${BLUE}后续步骤 (在 k8s 集群中执行):${NC}"
    echo ""
    echo "  1. 在 k8s 节点上信任 Harbor 证书（每个节点执行）:"
    echo "     sudo mkdir -p /etc/docker/certs.d/${HARBOR_HOST}"
    echo "     sudo scp root@${HARBOR_HOST}:${HARBOR_CA_CERT} /etc/docker/certs.d/${HARBOR_HOST}/ca.crt"
    echo ""
    echo "  2. 创建 Harbor 拉取密钥:"
    echo "     kubectl create secret docker-registry harbor-regcred \\"
    echo "       --docker-server=${HARBOR_HOST} \\"
    echo "       --docker-username=${HARBOR_USER} \\"
    echo "       --docker-password='<your-password>' \\"
    echo "       --namespace=default"
    echo ""
    echo "     或者使用项目中的脚本: bash k8s/setup-harbor-secret.sh"
    echo ""
    echo "  3. 部署到 k8s:"
    echo "     kubectl apply -f k8s/deployment.yaml"
    echo "     kubectl apply -f k8s/service.yaml"
    echo ""
    echo -e "${BLUE}Harbor UI:${NC} https://${HARBOR_HOST}"
    echo -e "${BLUE}镜像详情:${NC} https://${HARBOR_HOST}/harbor/projects"
    echo ""
}

# ---- 主流程 ----
main() {
    echo ""
    echo -e "${BLUE}===== Harbor 镜像构建推送脚本 =====${NC}"
    echo -e "${BLUE}项目: ${IMAGE_NAME}  标签: ${IMAGE_TAG}${NC}"
    echo ""

    check_prerequisites

    # 交互式读取密码（若环境变量未提供）
    if [ -z "${HARBOR_PASS}" ]; then
        echo -n "请输入 Harbor 密码 (${HARBOR_USER}): "
        read -rs HARBOR_PASS
        echo ""
    fi
    if [ -z "${HARBOR_PASS}" ]; then
        log_error "未提供 Harbor 密码，请设置环境变量 HARBOR_PASS 或在提示时输入"
        exit 1
    fi

    # 若在 Harbor 服务器本机执行，则自动配置证书信任
    if [ -f "${HARBOR_CA_CERT}" ]; then
        if [ "$(id -u)" -eq 0 ]; then
            trust_harbor_cert
        else
            log_warn "非 root 用户，跳过自动证书配置"
            log_warn "如有需要请手动配置: sudo mkdir -p ${DOCKER_CERT_DIR} && sudo cp <ca.crt> ${DOCKER_CERT_DIR}/ca.crt"
        fi
    fi

    create_harbor_project
    login_harbor
    build_image
    push_image
    print_next_steps
}

main "$@"
