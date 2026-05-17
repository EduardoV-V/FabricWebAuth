#!/usr/bin/env bash

ORG_QNTY=3
DEPLOY_CCAAS=false
CCAAS_TLS_ENABLED=""
USE_OLD=false

while [[ $# -ge 1 ]] ; do
    key="$1"
    case $key in
        -n )
            ORG_QNTY=$2
            shift
            ;;
        -ccaas )
            DEPLOY_CCAAS=$2
            shift
            ;;
        -ccaastls )
            CCAAS_TLS_ENABLED="-ccaastls"
            shift
            ;;
        old )
            USE_OLD=true
            ;;
  esac
  shift
done

if [ $ORG_QNTY != 3 -a $ORG_QNTY != 1 ]
then
  echo 'WARNING: The number of organizations allowed is either 3 or 1.'
  echo 'Defaulting to 3 organizations.'
  ORG_QNTY=3
fi

CCCG_PATH="../chaincode/collections.json"

# ./network.sh down -n $ORG_QNTY  

download_binaries(){
  echo "Preparing to download fabric binaries..."
  curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh && chmod +x install-fabric.sh

  echo "Downloading fabric binaries..."
  ./install-fabric.sh --fabric-version 2.5.3 binary

  rm install-fabric.sh
}

# Check PATH
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Binaries to check
fabric_binaries=("fabric-ca-client" "fabric-ca-server" "osnadmin" "configtxgen" "configtxlator" "cryptogen" "discover" "orderer" "peer")

all_binaries_exist() {
  for binary in "${fabric_binaries[@]}"; do
    if ! command_exists "$binary"; then
      return 1
    fi
  done
  return 0
}

if [ "$USE_OLD" = false ]; then
  echo "Modo RESET: recriando rede..."
  rm -rf organizations/peerOrganizations
  rm -rf organizations/ordererOrganizations
  rm -rf organizations/rest-certs
else
  echo "Modo OLD: reutilizando rede existente..."
fi

if all_binaries_exist; then
  echo "All Fabric binaries are available in the system path."
else
  echo "Some or all Fabric binaries are missing from the system path."
  
  FILE=bin
  if [ ! -d "$FILE" ]; then
    echo "Directory $FILE not found"
    download_binaries
  else
    echo "Bin directory already exists"
    cd bin
    numFiles="$(ls -1 | wc -l)"
    if [ "$numFiles" -ne 10 ]; then
      cd ..
      echo "Missing some fabric binaries in bin directory"
      download_binaries
    else
      cd ..
    fi
  fi
fi 

docker network create fabricWebAuth-net 2>/dev/null || true

if [ "$USE_OLD" = true ]; then
  echo "Subindo rede existente (sem createChannel)..."
  ./network.sh up -n $ORG_QNTY $CCAAS_TLS_ENABLED -ca
else
  echo "Subindo rede nova (com createChannel)..."
  ./network.sh up createChannel -n $ORG_QNTY $CCAAS_TLS_ENABLED -ca
fi