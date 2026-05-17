'use strict';

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

// ========== CONFIGURAÇÕES DA REDE ==========
const channelName = 'mainchannel';
const chaincodeName = 'teste_chaincode';   // chaincode atual
const mspId = 'org1MSP';

const cryptoPath = path.resolve(__dirname, '..', '..', 'fabric', 'organizations', 'peerOrganizations', 'org1.example.com');

const keyDirectoryPath = path.resolve(
    cryptoPath,
    'users',
    'User1@org1.example.com',
    'msp',
    'keystore'
);

const certDirectoryPath = path.resolve(
    cryptoPath,
    'users',
    'User1@org1.example.com',
    'msp',
    'signcerts'
);

const tlsCertPath = path.resolve(
    cryptoPath,
    'peers',
    'peer0.org1.example.com',
    'tls',
    'ca.crt'
);

const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

const utf8Decoder = new TextDecoder();

let client, gateway, network, contract;

// ========== FUNÇÕES AUXILIARES DE CONEXÃO ==========
async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function getFirstDirFileName(dirPath) {
    const files = await fs.readdir(dirPath);
    if (!files.length) throw new Error(`Nenhum arquivo em: ${dirPath}`);
    return path.join(dirPath, files[0]);
}

async function newIdentity() {
    const certPath = await getFirstDirFileName(certDirectoryPath);
    const credentials = await fs.readFile(certPath);
    return { mspId, credentials };
}

async function newSigner() {
    const keyPath = await getFirstDirFileName(keyDirectoryPath);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

// ========== INICIALIZAÇÃO / ENCERRAMENTO ==========
async function initialize() {
    client = await newGrpcConnection();
    gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        hash: hash.sha256,
    });

    network = gateway.getNetwork(channelName);
    contract = network.getContract(chaincodeName);
    console.log('Conexão com o chaincode estabelecida.');
}

async function disconnect() {
    try {
        gateway.close();
        client.close();
        console.log('Conexão encerrada.');
    } catch (err) {
        console.error('Erro ao desconectar:', err);
    }
}

// ========== FUNÇÕES DO CHAINCODE ==========
async function store(key, value) {
    const resultBytes = await contract.submitTransaction('Store', key, value);
    const jsonStr = utf8Decoder.decode(resultBytes);
    return JSON.parse(jsonStr);
}

async function storeSigned(username, key, value, signatureB64) {
    const resultBytes = await contract.submitTransaction('StoreSigned', username, key, value, signatureB64);
    const jsonStr = utf8Decoder.decode(resultBytes);
    return JSON.parse(jsonStr);
}

async function query(key) {
    const resultBytes = await contract.evaluateTransaction('Query', key);
    return utf8Decoder.decode(resultBytes);
}

async function storeUserPubKey(username, pubKeyPEM) {
    await contract.submitTransaction('StoreUserPubKey', username, pubKeyPEM);
}

async function verifySignature(username, message, signatureB64) {
    const resultBytes = await contract.evaluateTransaction('VerifySignature', username, message, signatureB64);
    return utf8Decoder.decode(resultBytes) === 'true';
}

async function setTiming(enable) {
    await contract.submitTransaction('SetTiming', enable ? 'true' : 'false');
}

module.exports = {
    initialize,
    disconnect,
    store,
    storeSigned,
    query,
    storeUserPubKey,
    verifySignature,
    setTiming
};