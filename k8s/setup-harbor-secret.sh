#!/bin/bash
# =============================================================================
# k8s/setup-harbor-secret.sh
# 在 k8s 集群中创建 Harbor 镜像拉取密钥，并配置 k8s 节点信任 Harbor 证书
# =============================================================================

set -euo pipefail

# ---- 配置变量（与 push-to-harbor.sh 保持一致）----
HARBOR_HOST="172.20.20.250"
HARBOR_USER="admin"
HARBOR_PASS="${HARBOR_PASS:-}"          # 优先从环境变量读取
HARBOR_CA_CERT_PATH="/opt/harbor/certs/ca.crt"  # Harbor 服务器上的 CA 证书路径
SECRET_NAME="harbor-regcred"
NAMESPACE="${1:-default}"               # 默认 namespace，可通过第一个参数覆盖

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---- 检查 kubectl ----
check_kubectl() {
    if ! command -v kubectl &>/dev/null; then
        log_error "未找到 kubectl 命令，请先配置 kubectl 并确保可访问集群"
        exit 1
    fi
    if ! kubectl cluster-info &>/dev/null; then
        log_error "无法连接到 k8s 集群，请检查 kubeconfig"
        exit 1
    fi
    log_ok "kubectl 已就绪，集群连接正常"
}

# ---- 获取 Harbor 密码 ----
get_harbor_password() {
    if [ -z "${HARBOR_PASS}" ]; then
        echo -n "请输入 Harbor 密码 (${HARBOR_USER}): "
        read -rs HARBOR_PASS
        echo ""
    fi
    if [ -z "${HARBOR_PASS}" ]; then
        log_error "密码不能为空"
        exit 1
    fi
}

# ---- 确保 namespace 存在 ----
ensure_namespace() {
    if ! kubectl get namespace "${NAMESPACE}" &>/dev/null; then
        log_info "Namespace '${NAMESPACE}' 不存在，正在创建..."
        kubectl create namespace "${NAMESPACE}"
        log_ok "Namespace '${NAMESPACE}' 创建成功"
    else
        log_ok "Namespace '${NAMESPACE}' 已存在"
    fi
}

# ---- 创建 Harbor 拉取 Secret ----
create_pull_secret() {
    log_info "在 namespace '${NAMESPACE}' 中创建 Harbor 拉取密钥 '${SECRET_NAME}'..."

    # 若 secret 已存在则先删除
    if kubectl get secret "${SECRET_NAME}" -n "${NAMESPACE}" &>/dev/null; then
        log_warn "Secret '${SECRET_NAME}' 已存在，将覆盖更新..."
        kubectl delete secret "${SECRET_NAME}" -n "${NAMESPACE}"
    fi

    kubectl create secret docker-registry "${SECRET_NAME}" \
        --docker-server="${HARBOR_HOST}" \
        --docker-username="${HARBOR_USER}" \
        --docker-password="${HARBOR_PASS}" \
        --namespace="${NAMESPACE}"

    log_ok "Secret '${SECRET_NAME}' 创建成功（namespace: ${NAMESPACE}）"
}

# ---- 配置 containerd 信任 Harbor 证书（当前节点）----
# 说明: k8s 1.20+ 使用 containerd 作为运行时，需要单独配置证书信任
configure_containerd_cert() {
    log_info "检查是否需要配置 containerd 证书信任..."

    if ! command -v containerd &>/dev/null; then
        log_warn "当前节点未安装 containerd，跳过证书配置"
        log_warn "请在每个 k8s 工作节点上手动执行以下配置（详见下方说明）"
        return
    fi

    local cert_dir="/etc/containerd/certs.d/${HARBOR_HOST}"
    local hosts_toml="${cert_dir}/hosts.toml"

    if [ "$(id -u)" -ne 0 ]; then
        log_warn "非 root 用户，无法自动配置 containerd 证书，请使用 sudo 执行或手动配置"
        return
    fi

    # 获取 CA 证书（尝试从 Harbor 服务器复制）
    if [ -f "${HARBOR_CA_CERT_PATH}" ]; then
        mkdir -p "${cert_dir}"
        cp "${HARBOR_CA_CERT_PATH}" "${cert_dir}/ca.crt"
        log_ok "CA 证书已复制到 ${cert_dir}/ca.crt"
    else
        log_warn "未找到 CA 证书 ${HARBOR_CA_CERT_PATH}，请手动将 CA 证书放到 ${cert_dir}/ca.crt"
    fi

    # 写入 hosts.toml 配置
    mkdir -p "${cert_dir}"
    cat > "${hosts_toml}" <<EOF
server = "https://${HARBOR_HOST}"

[host."https://${HARBOR_HOST}"]
  capabilities = ["pull", "resolve"]
  ca = "${cert_dir}/ca.crt"
  skip_verify = false
EOF

    log_ok "containerd 证书配置已写入 ${hosts_toml}"
    log_info "重启 containerd 以使配置生效..."
    systemctl restart containerd && log_ok "containerd 重启完成"
}

# ---- 验证 Secret ----
verify_secret() {
    log_info "验证 Secret 创建结果..."
    kubectl get secret "${SECRET_NAME}" -n "${NAMESPACE}" -o jsonpath='{.metadata.name}' | grep -q "${SECRET_NAME}"
    log_ok "Secret 验证通过"
}

# ---- 输出配置说明 ----
print_summary() {
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN} k8s Harbor 密钥配置完成！${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "${BLUE}Secret 名称:${NC}   ${SECRET_NAME}"
    echo -e "${BLUE}Namespace:${NC}     ${NAMESPACE}"
    echo -e "${BLUE}Harbor 地址:${NC}   ${HARBOR_HOST}"
    echo ""
    echo -e "${BLUE}在每个 k8s 工作节点上配置 containerd 信任 Harbor 证书:${NC}"
    echo ""
    echo "  # 1. 将 Harbor CA 证书传到节点（在 Harbor 服务器或管理机上执行）"
    echo "  scp root@${HARBOR_HOST}:${HARBOR_CA_CERT_PATH} /tmp/harbor-ca.crt"
    echo "  scp /tmp/harbor-ca.crt <node-ip>:/tmp/harbor-ca.crt"
    echo ""
    echo "  # 2. 在每个工作节点上执行（containerd 运行时）"
    echo "  sudo mkdir -p /etc/containerd/certs.d/${HARBOR_HOST}"
    echo "  sudo cp /tmp/harbor-ca.crt /etc/containerd/certs.d/${HARBOR_HOST}/ca.crt"
    echo "  sudo tee /etc/containerd/certs.d/${HARBOR_HOST}/hosts.toml <<'EOF'"
    echo "  server = \"https://${HARBOR_HOST}\""
    echo "  [host.\"https://${HARBOR_HOST}\"]"
    echo "    capabilities = [\"pull\", \"resolve\"]"
    echo "    ca = \"/etc/containerd/certs.d/${HARBOR_HOST}/ca.crt\""
    echo "  EOF"
    echo "  sudo systemctl restart containerd"
    echo ""
    echo "  # 3. 若工作节点使用 Docker（旧版 k8s）"
    echo "  sudo mkdir -p /etc/docker/certs.d/${HARBOR_HOST}"
    echo "  sudo cp /tmp/harbor-ca.crt /etc/docker/certs.d/${HARBOR_HOST}/ca.crt"
    echo "  sudo systemctl restart docker"
    echo ""
    echo -e "${BLUE}部署应用到 k8s:${NC}"
    echo "  kubectl apply -f k8s/deployment.yaml"
    echo "  kubectl apply -f k8s/service.yaml"
    echo "  kubectl get pods -n ${NAMESPACE}"
    echo ""
}

main() {
    echo ""
    echo -e "${BLUE}===== k8s Harbor 拉取密钥配置脚本 =====${NC}"
    echo -e "${BLUE}目标 Namespace: ${NAMESPACE}${NC}"
    echo ""

    check_kubectl
    get_harbor_password
    ensure_namespace
    create_pull_secret
    configure_containerd_cert
    verify_secret
    print_summary
}

main "$@"
