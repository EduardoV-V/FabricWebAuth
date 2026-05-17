#!/usr/bin/env bash

set -e

NETWORK_ROOT="{{NETWORK_ROOT}}"

FABRIC_DIR="$NETWORK_ROOT/fabric"

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

function ensure_dir() {
    if [ ! -d "$1" ]; then
        error "Diretório não encontrado: $1"
        exit 1
    fi
}

function abs_path() {
    local path="$1"

    if [ -d "$path" ]; then
        (
            cd "$path"
            pwd
        )
    else
        error "Diretório inválido: $path"
        exit 1
    fi
}

function run_in_root() {
    (
        cd "$NETWORK_ROOT"
        "$@"
    )
}

function run_in_fabric() {
    (
        cd "$FABRIC_DIR"
        "$@"
    )
}

ensure_dir "$NETWORK_ROOT"
ensure_dir "$FABRIC_DIR"

function network_up_clean() {
    info "Levantando rede limpa..."
    run_in_root ./startDev.sh -ccaas
    success "Rede levantada"
}

function network_down_clean() {
    info "Derrubando rede e apagando certificados..."
    run_in_fabric ./network.sh downclr
    success "Rede removida completamente"
}

function network_restart_clean() {
    network_down_clean
    sleep 5
    network_up_clean
}

function network_up_old() {
    info "Levantando rede existente..."
    run_in_root ./startDev.sh -old -ccaas
    success "Rede levantada"
}

function network_down_keep() {
    info "Derrubando rede mantendo certificados..."
    run_in_fabric ./network.sh down
    success "Rede derrubada"
}

function network_restart_light() {
    network_down_keep
    sleep 5
    network_up_old
}

function install_chaincode() {
    
    local cc_name="$1"
    local cc_path="$2"

    if [ -z "$cc_path" ]; then
        error "Uso: fabricManager installcc <nome_chaincode> <diretorio_chaincode>"
        exit 1
    fi

    local abs_cc_path
    abs_cc_path=$(abs_path "$cc_path")

    local cc_name
    cc_name=$(basename "$abs_cc_path")

    info "Instalando chaincode..."
    info "Nome: $cc_name"
    info "Path: $abs_cc_path"

    run_in_fabric ./network.sh deployCCAAS \
        -ccn "$cc_name" \
        -ccp "$abs_cc_path"

    success "Chaincode instalado"
}

function upgrade_chaincode() {

    local cc_name="$1"
    local cc_path="$2"
    local cc_version="$3"
    local cc_sequence="$4"

    if [ -z "$cc_path" ] || [ -z "$cc_version" ] || [ -z "$cc_sequence" ]; then
        error "Uso: fabricManager upgradecc <nome_chaincode> <diretorio_chaincode> <versao> <sequencia>"
        exit 1
    fi

    local abs_cc_path
    abs_cc_path=$(abs_path "$cc_path")

    local cc_name
    cc_name=$(basename "$abs_cc_path")

    info "Atualizando chaincode..."
    info "Nome: $cc_name"
    info "Versão: $cc_version"
    info "Sequência: $cc_sequence"

    run_in_fabric ./network.sh deployCCAAS \
        -ccn "$cc_name" \
        -ccs "$cc_sequence" \
        -ccv "$cc_version" \
        -ccp "$abs_cc_path"

    success "Chaincode atualizado"
}

function help_menu() {

    echo
    echo "FabricWebAuth manager"
    echo
    echo "Uso:"
    echo "  fabricManager <comando>"
    echo
    echo "Comandos:"
    echo
    echo "  upclean"
    echo "      Levanta a rede do zero"
    echo
    echo "  downclean"
    echo "      Derruba a rede e remove certificados"
    echo
    echo "  restartclean"
    echo "      Reinício completo da rede"
    echo
    echo "  up"
    echo "      Levanta rede previamente criada"
    echo
    echo "  down"
    echo "      Derruba rede mantendo certificados"
    echo
    echo "  restart"
    echo "      Reinício leve da rede"
    echo
    echo "  installcc <nome_chaincode> <path_chaincode>"
    echo "      Instala um novo chaincode"
    echo
    echo "  upgradecc <nome_chaincode> <path_chaincode> <versao> <sequencia>"
    echo "      Atualiza um chaincode existente"
    echo
    echo "  help"
    echo "      Exibe menu de ajuda"
    echo
}

COMMAND="$1"

case "$COMMAND" in

    upclean)
        network_up_clean
        ;;

    downclean)
        network_down_clean
        ;;

    restartclean)
        network_restart_clean
        ;;

    up)
        network_up_old
        ;;

    down)
        network_down_keep
        ;;

    restart)
        network_restart_light
        ;;

    installcc)
        install_chaincode "$2" "$3"
        ;;

    upgradecc)
        upgrade_chaincode "$2" "$3" "$4" "$5"
        ;;

    help|"")
        help_menu
        ;;

    *)
        error "Comando inválido: $COMMAND"
        echo
        help_menu
        exit 1
        ;;

esac