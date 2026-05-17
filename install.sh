#!/usr/bin/env bash

set -e

MIN_GO_VERSION="1.21"
MIN_DOCKER_VERSION="20.10.5"
MIN_COMPOSE_VERSION="1.28.5"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

function info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

function success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

function error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

function command_exists() {
    command -v "$1" >/dev/null 2>&1
}

function version_greater_equal() {
    printf '%s\n%s\n' "$1" "$2" | sort -C -V
}

info "Verificando dependências..."

if ! command_exists go; then
    error "Go não encontrado."
    exit 1
fi

GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')

if ! version_greater_equal "$MIN_GO_VERSION" "$GO_VERSION"; then
    error "Versão do Go incompatível."
    echo "Necessário: >= $MIN_GO_VERSION"
    echo "Encontrado: $GO_VERSION"
    exit 1
fi

success "Go $GO_VERSION"

if ! command_exists docker; then
    error "Docker não encontrado."
    exit 1
fi

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}')

if ! version_greater_equal "$MIN_DOCKER_VERSION" "$DOCKER_VERSION"; then
    error "Versão do Docker incompatível."
    echo "Necessário: >= $MIN_DOCKER_VERSION"
    echo "Encontrado: $DOCKER_VERSION"
    exit 1
fi

success "Docker $DOCKER_VERSION"

COMPOSE_CMD=""

if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    COMPOSE_VERSION=$(docker compose version --short)
elif command_exists docker-compose; then
    COMPOSE_CMD="docker-compose"
    COMPOSE_VERSION=$(docker-compose version --short)
else
    error "Docker Compose não encontrado."
    exit 1
fi

if ! version_greater_equal "$MIN_COMPOSE_VERSION" "$COMPOSE_VERSION"; then
    error "Versão do Docker Compose incompatível."
    echo "Necessário: >= $MIN_COMPOSE_VERSION"
    echo "Encontrado: $COMPOSE_VERSION"
    exit 1
fi

success "Docker Compose $COMPOSE_VERSION"

info "Instalando dependências Go..."

if [ -d "$ROOT_DIR/chaincode" ]; then
    info "Executando go mod vendor em chaincode/"
    (
        cd "$ROOT_DIR/chaincode"
        go mod vendor
    )
    success "Dependências do chaincode instaladas"
else
    error "Diretório chaincode não encontrado"
fi

if [ -d "$ROOT_DIR/ccapi" ]; then
    info "Executando go mod vendor em ccapi/"
    (
        cd "$ROOT_DIR/ccapi"
        go mod vendor
    )
    success "Dependências do ccapi instaladas"
else
    error "Diretório ccapi não encontrado"
fi

info "Instalando fabricManager..."

TEMPLATE_FILE="$ROOT_DIR/scripts/fabricWebAuth.sh"
OUTPUT_FILE="/tmp/fabricManager"

if [ ! -f "$TEMPLATE_FILE" ]; then
    error "Template do fabricManager não encontrado"
    exit 1
fi

sed "s|{{NETWORK_ROOT}}|$ROOT_DIR|g" \
    "$TEMPLATE_FILE" > "$OUTPUT_FILE"

chmod +x "$OUTPUT_FILE"

sudo mv "$OUTPUT_FILE" /usr/local/bin/fabricManager

success "fabricManager instalado em /usr/local/bin"

echo
success "Instalação concluída com sucesso."