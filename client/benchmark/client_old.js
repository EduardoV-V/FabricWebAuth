'use strict';

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const channelName = 'mainchannel';
const chaincodeName = 'teste_chaincode';
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

async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function getFirstDirFileName(dirPath) {
    const files = await fs.readdir(dirPath);
    const file = files[0];
    if (!file) {
        throw new Error(`No files in directory: ${dirPath}`);
    }
    return path.join(dirPath, file);
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

async function main() {
    const publicKeyPem = await fs.readFile('public.pem', 'utf8');
    const privateKeyPem = await fs.readFile('private.pem', 'utf8');
    const privateKey = crypto.createPrivateKey(privateKeyPem);

    const client = await newGrpcConnection();
    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        hash: hash.sha256,
    });

    try {
        const network = gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);

        const message = 'Teste de integridade via assinatura ECDSA';
        const sign = crypto.createSign('SHA256');
        sign.update(message);
        sign.end();
        const signatureBuffer = sign.sign(privateKey);
        const signatureB64 = signatureBuffer.toString('base64');

        const storageKey = 'chaveDeTeste';
        await contract.submitTransaction('StoreSigned', storageKey, message, signatureB64);

        const queryResult = await contract.evaluateTransaction('Query', storageKey);
        const storedValue = utf8Decoder.decode(queryResult);
        console.log('Valor recuperado:', storedValue);
        console.log('Coincide?', storedValue === message);

        const verifyResult = await contract.evaluateTransaction('VerifySignature', message, signatureB64);
        console.log('Assinatura válida?', utf8Decoder.decode(verifyResult) === 'true');
    } finally {
        gateway.close();
        client.close();
    }
}

main().catch(err => {
    console.error('Falha:', err);
    process.exit(1);
});