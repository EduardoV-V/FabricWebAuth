'use strict';

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { p256 } = require('@noble/curves/p256');

const invoke = require('../resources/invoke.js');
const normalizeS = require('../resources/normalization.js')

const channelName = 'mainchannel';
const chaincodeName = 'teste_chaincode';
const mspId = 'org1MSP';

const cryptoPath = path.resolve(__dirname, '..', '..', 'fabric', 'organizations', 'peerOrganizations', 'org1.example.com');
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';
const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

const OUTPUT_DIR = path.join(__dirname, 'tempos');

async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function getFirstDirFileName(dirPath) {
    const files = await fs.readdir(dirPath);
    if (!files.length) throw new Error(`No files in directory: ${dirPath}`);
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

async function ensureOutputDir() {
    try { await fs.mkdir(OUTPUT_DIR, { recursive: true }); } catch (e) {}
}

function convertToCSV(rows) {
    if (rows.length === 0) return '';
    const header = ['iteracao', 'cliente_ms', 'chaincode_ms', 'total_ms'];
    const lines = rows.map(r => `${r.iteracao},${r.cliente_ms},${r.chaincode_ms},${r.total_ms}`);
    return [header.join(','), ...lines].join('\n');
}

async function saveResults(mode, results) {
    await ensureOutputDir();
    const timestamp = Date.now();
    const baseName = `benchmark_${mode}_${timestamp}`;
    const csvPath = path.join(OUTPUT_DIR, `${baseName}.csv`);
    await fs.writeFile(csvPath, convertToCSV(results), 'utf8');
    const jsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`Resultados salvos em:\n  ${csvPath}\n  ${jsonPath}`);
}

function derToRaw(derSignature) {
    const der = Buffer.from(derSignature);
    if (der[0] !== 0x30) throw new Error('Assinatura DER inválida: esperado 0x30');

    let pos = 2;
    const len = der[1];
    if (len & 0x80) {
        const numBytes = len & 0x7f;
        pos += numBytes; // pular os bytes do tamanho longo
    }

    if (der[pos] !== 0x02) throw new Error('Esperado 0x02 para R');
    pos++;
    const rLen = der[pos];
    pos++;
    let r = der.slice(pos, pos + rLen);
    // Remover possível byte 0x00 inicial (indicador de sinal)
    if (r[0] === 0x00 && r.length > 32) {
        r = r.slice(1);
    }
    pos += rLen;

    if (der[pos] !== 0x02) throw new Error('Esperado 0x02 para S');
    pos++;
    const sLen = der[pos];
    pos++;
    let s = der.slice(pos, pos + sLen);
    if (s[0] === 0x00 && s.length > 32) {
        s = s.slice(1);
    }
    pos += sLen;

    // Garantir 32 bytes cada
    if (r.length < 32) r = Buffer.concat([Buffer.alloc(32 - r.length, 0), r]);
    if (s.length < 32) s = Buffer.concat([Buffer.alloc(32 - s.length, 0), s]);

    // Devem ter exatamente 32 bytes cada
    if (r.length !== 32) throw new Error(`R length ${r.length} != 32`);
    if (s.length !== 32) throw new Error(`S length ${s.length} != 32`);

    return Buffer.concat([r, s]); // 64 bytes
}

function signDigest(digest, privateKey) {
    const sign = crypto.createSign('SHA256');
    sign.update(digest);
    sign.end();
    const derSignature = sign.sign(privateKey);
    const rawSignature = derToRaw(derSignature);
    const normalizedDER = normalizeS(rawSignature)
    return normalizedDER;
}

async function loadPrivateKey() {
    const pem = await fs.readFile('private.pem', 'utf8');
    return crypto.createPrivateKey(pem);
}

async function loadPublicKeyPem() {
    return fs.readFile('public.pem', 'utf8');
}

async function loadWalletCertificate(user) {
    const identityPath = path.join(__dirname, 'wallet', `${user}.id`);
    const identityData = JSON.parse(await fs.readFile(identityPath, 'utf8'));
    return identityData.credentials.certificate;
}

async function benchmarkSigned(contract, iterations) {
    const publicKeyPem = await loadPublicKeyPem();
    const privateKey = await loadPrivateKey();

    await contract.submitTransaction('StoreUserPubKey', publicKeyPem);
    console.log('Chave pública armazenada.');

    const results = [];
    for (let i = 0; i < iterations; i++) {
        const iterationStart = performance.now();

        const message = `Teste #${i} - ${Date.now()}`;
        const signatureB64 = crypto.createSign('SHA256').update(message).sign(privateKey, 'base64');
        const storageKey = `chaveDeTeste_${i}`;

        const clienteMs = parseFloat((performance.now() - iterationStart).toFixed(4));

        const resultBytes = await contract.submitTransaction('StoreSigned', storageKey, message, signatureB64);
        let chaincodeMs = 0;
        try {
            const parsed = JSON.parse(utf8Decoder.decode(resultBytes));
            chaincodeMs = parsed.elapsed_ms || 0;
        } catch {}

        const totalMs = parseFloat((clienteMs + chaincodeMs).toFixed(4));
        console.log(`[${i}] cliente=${clienteMs}ms, chaincode=${chaincodeMs}ms, total=${totalMs}ms`);

        const queryResult = await contract.evaluateTransaction('Query', storageKey);
        const match = utf8Decoder.decode(queryResult) === message;
        console.log(`[${i}] Query match: ${match}`);

        results.push({ iteracao: i, cliente_ms: clienteMs, chaincode_ms: chaincodeMs, total_ms: totalMs });

        if (!match) { console.error(`Falha na iteração ${i}`); break; }
        console.log('---');
    }

    await saveResults('signed', results);
}

async function benchmarkUnsigned(contract, iterations) {
    const results = [];
    for (let i = 0; i < iterations; i++) {
        const iterationStart = performance.now();
        const storageKey = `chaveSimples_${i}`;
        const message = `Valor simples #${i} - ${Date.now()}`;

        const clienteMs = parseFloat((performance.now() - iterationStart).toFixed(4));

        const resultBytes = await contract.submitTransaction('Store', storageKey, message);
        let chaincodeMs = 0;
        try {
            const parsed = JSON.parse(utf8Decoder.decode(resultBytes));
            chaincodeMs = parsed.elapsed_ms || 0;
        } catch {}

        const totalMs = parseFloat((clienteMs + chaincodeMs).toFixed(4));
        console.log(`[${i}] cliente=${clienteMs}ms, chaincode=${chaincodeMs}ms, total=${totalMs}ms`);

        const queryResult = await contract.evaluateTransaction('Query', storageKey);
        const match = utf8Decoder.decode(queryResult) === message;
        console.log(`[${i}] Query match: ${match}`);

        results.push({ iteracao: i, cliente_ms: clienteMs, chaincode_ms: chaincodeMs, total_ms: totalMs });

        if (!match) { console.error(`Falha na iteração ${i}`); break; }
        console.log('---');
    }

    await saveResults('unsigned', results);
}

async function benchmarkOffline(iterations, user) {
    const certificate = await loadWalletCertificate(user);
    const privateKey = await loadPrivateKey();

    // Inicializa a sessão usando o módulo invoke
    invoke.initialize(user, chaincodeName, certificate);

    const results = [];
    for (let i = 0; i < iterations; i++) {
        const iterationStart = performance.now();

        const storageKey = `offline_${i}`;
        const message = `Teste offline #${i} - ${Date.now()}`;

        // 1. Proposta
        const proposalDigest = await invoke.createProposal('Store', storageKey, message);
        const proposalSig = signDigest(proposalDigest, privateKey);

        const clienteMs = parseFloat((performance.now() - iterationStart).toFixed(4));

        // 2. Transação (endosso)
        const transactionDigest = await invoke.createTransaction(proposalSig);
        const transactionSig = signDigest(transactionDigest, privateKey);

        // 3. Commit
        const commitDigest = await invoke.createCommit(transactionSig);
        const commitSig = signDigest(commitDigest, privateKey);

        // 4. Finalização e resultado
        const resultJson = await invoke.finalize(commitSig);

        let chaincodeMs = 0;
        if (resultJson && resultJson.elapsed_ms) {
            chaincodeMs = resultJson.elapsed_ms;
        }

        const totalMs = parseFloat((clienteMs + chaincodeMs).toFixed(4));
        console.log(`[${i}] cliente=${clienteMs}ms, chaincode=${chaincodeMs}ms, total=${totalMs}ms`);

        // Query para verificação
        const queryResult = await invoke.contract.evaluateTransaction('Query', storageKey);
        const match = utf8Decoder.decode(queryResult) === message;
        console.log(`[${i}] Query match: ${match}`);

        results.push({ iteracao: i, cliente_ms: clienteMs, chaincode_ms: chaincodeMs, total_ms: totalMs });

        if (!match) { console.error(`Falha na iteração ${i}`); break; }
        console.log('---');
    }

    invoke.close();
    await saveResults('offline', results);
}

async function main() {
    const iterations = parseInt(process.argv[2], 10) || 5;
    const mode = (process.argv[3] || 'signed').toLowerCase();
    const offlineUser = 'teste1';

    console.log(`Modo: ${mode}`);
    console.log(`Iterações: ${iterations}`);

    if (mode === 'offline') {
        console.log(`Usuário da wallet: ${offlineUser}`);
        await benchmarkOffline(iterations, offlineUser);
        return;
    }

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

        if (mode === 'unsigned') {
            await benchmarkUnsigned(contract, iterations);
        } else {
            await benchmarkSigned(contract, iterations);
        }
    } finally {
        gateway.close();
        client.close();
    }
}

main().catch(err => {
    console.error('Falha:', err);
    process.exit(1);
});