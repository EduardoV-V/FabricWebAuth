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

# ================== GO ==================
if ! command_exists go; then
    error "Go não encontrado."
    read -p "Deseja instalar Go $MIN_GO_VERSION automaticamente? (s/N): " -r
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        info "Instalando Go..."
        curl -sL "https://go.dev/dl/go${MIN_GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
        sudo tar -C /usr/local -xzf /tmp/go.tar.gz
        export PATH=$PATH:/usr/local/go/bin
        echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
        success "Go instalado em /usr/local/go"
    else
        error "Instalação do Go é necessária. Execute manualmente:"
        echo "  curl -sL https://go.dev/dl/go${MIN_GO_VERSION}.linux-amd64.tar.gz | sudo tar -C /usr/local -xz"
        echo "  export PATH=\$PATH:/usr/local/go/bin"
    fi
else
    GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')
    if ! version_greater_equal "$MIN_GO_VERSION" "$GO_VERSION"; then
        error "Versão do Go ($GO_VERSION) inferior a $MIN_GO_VERSION. Atualize manualmente."
    else
        success "Go $GO_VERSION"
    fi
fi

# ================== DOCKER ==================
if ! command_exists docker; then
    error "Docker não encontrado."
    read -p "Deseja instalar Docker automaticamente? (s/N): " -r
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        info "Instalando Docker..."
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker $USER
        success "Docker instalado. Faça logout e login para aplicar o grupo."
    else
        error "Instalação do Docker é necessária. Siga as instruções em https://docs.docker.com/engine/install/"
    fi
else
    DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)
    if [ -n "$DOCKER_VERSION" ] && version_greater_equal "$MIN_DOCKER_VERSION" "$DOCKER_VERSION"; then
        success "Docker $DOCKER_VERSION"
    else
        error "Docker versão incompatível ou sem permissão. Verifique."
    fi
fi

# ================== DOCKER COMPOSE ==================
COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    COMPOSE_VERSION=$(docker compose version --short)
elif command_exists docker-compose; then
    COMPOSE_CMD="docker-compose"
    COMPOSE_VERSION=$(docker-compose version --short)
else
    error "Docker Compose não encontrado."
    read -p "Deseja instalar o plugin 'docker compose'? (s/N): " -r
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        info "Instalando Docker Compose plugin..."
        sudo apt-get update
        sudo apt-get install -y docker-compose-plugin
        COMPOSE_CMD="docker compose"
        COMPOSE_VERSION=$(docker compose version --short)
        success "Docker Compose instalado."
    else
        error "Docker Compose é necessário. Instale manualmente (https://docs.docker.com/compose/install/)."
    fi
fi

if [ -n "$COMPOSE_VERSION" ] && version_greater_equal "$MIN_COMPOSE_VERSION" "$COMPOSE_VERSION"; then
    success "Docker Compose $COMPOSE_VERSION"
elif [ -n "$COMPOSE_VERSION" ]; then
    error "Docker Compose versão $COMPOSE_VERSION inferior a $MIN_COMPOSE_VERSION."
fi

info "Instalando dependências Go..."

if [ -d "$ROOT_DIR/chaincode" ]; then
    info "Executando go mod vendor em chaincode/"
    ( cd "$ROOT_DIR/chaincode" && go mod vendor ) || error "Falha ao executar go mod vendor em chaincode/"
else
    error "Diretório chaincode não encontrado"
fi

if [ -d "$ROOT_DIR/ccapi" ]; then
    info "Executando go mod vendor em ccapi/"
    ( cd "$ROOT_DIR/ccapi" && go mod vendor ) || error "Falha ao executar go mod vendor em ccapi/"
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

sed "s|{{NETWORK_ROOT}}|$ROOT_DIR|g" "$TEMPLATE_FILE" > "$OUTPUT_FILE"
chmod +x "$OUTPUT_FILE"
sudo mv "$OUTPUT_FILE" /usr/local/bin/fabricManager
success "fabricManager instalado em /usr/local/bin"

echo
success "Instalação concluída com sucesso."