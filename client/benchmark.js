'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { createObjectCsvWriter } = require('csv-writer');
const { Wallets } = require('fabric-network');

const standaloneClient = require('./resources/standaloneClient');
const normalizeS = require('./resources/normalization');

const {
    initialize,
    createProposal,
    createTransaction,
    createCommit,
    finalize,
    close
} = require('./resources/invoke');

// ================= CONFIG =================

const CHAINCODE = 'teste_chaincode';
const WALLET = './wallet';

const MODE = process.argv[2] || 'unsigned';
const COUNT = Number(process.argv[3]) || 10;
const KEY_BASE = process.argv[4] || 'bench';
const VALUE = process.argv[5] || 'teste';
const USER = process.argv[6] || 'admin';
const PRIVATE_KEY = process.argv[7];

// ================= HELPERS =================

function stats(values) {
    const s = [...values].sort((a, b) => a - b);

    return {
        avg: s.reduce((a, b) => a + b, 0) / s.length,
        min: s[0],
        max: s[s.length - 1],
        p95: s[Math.floor(s.length * 0.95)]
    };
}


function rawSignatureToDER(raw) {
    if (raw.length !== 64) {
        throw new Error(`Assinatura RAW invalida: ${raw.length} bytes`);
    }

    const r = raw.slice(0, 32);
    const s = raw.slice(32, 64);

    function encodeInteger(buf) {
        let start = 0;

        while (start < buf.length - 1 && buf[start] === 0) {
            start++;
        }

        let out = buf.slice(start);

        if (out[0] & 0x80) {
            out = Buffer.concat([
                Buffer.from([0x00]),
                out
            ]);
        }

        return out;
    }

    const rDer = encodeInteger(r);
    const sDer = encodeInteger(s);

    const totalLen =
        2 +
        rDer.length +
        2 +
        sDer.length;

    return Buffer.concat([
        Buffer.from([
            0x30,
            totalLen,
            0x02,
            rDer.length
        ]),
        rDer,
        Buffer.from([
            0x02,
            sDer.length
        ]),
        sDer
    ]);
}

async function signMessageDER(message, pem) {
    const raw = crypto.sign(
        'sha256',
        Buffer.from(message, 'utf8'),
        {
            key: pem,
            dsaEncoding: 'ieee-p1363'
        }
    );

    const der = rawSignatureToDER(raw);

    return der.toString('base64');
}

async function signDigest(digest, pem) {
    const raw = crypto.sign(
        null,
        digest,
        {
            key: pem,
            dsaEncoding: 'ieee-p1363'
        }
    );

    return normalizeS(raw);
}

async function getCertificate() {
    const wallet = await Wallets.newFileSystemWallet(WALLET);

    const identity =
        await wallet.get(USER);

    if (!identity) {
        throw new Error(`Usuario ${USER} nao encontrado`);
    }

    return identity.credentials.certificate;
}

async function run() {

    const rows = [];

    let privatePem = null;
    let certificate = null;

    if (MODE !== 'unsigned') {
        privatePem = fs.readFileSync(PRIVATE_KEY,'utf8');
    }

    if (MODE === 'offline') {
        certificate = await getCertificate();
    }

    for (let i = 0; i < COUNT; i++) {

        const key = `${KEY_BASE}_${i}`;

        const value = `${VALUE}_${Date.now()}`;

        let client = 0;
        let fabric = 0;
        let chain = 0;

        try {
            if (MODE === 'unsigned') {
                let start = performance.now();
                await standaloneClient.initialize();

                const result = await standaloneClient.store(key,value);
                await standaloneClient.disconnect();

                fabric = performance.now() - start;
                chain = result.elapsed_ms || 0;
            }

            else if (MODE === 'signed') {

                let start =
                    performance.now();

                const signature =
                    await signMessageDER(
                        value,
                        privatePem
                    );

                client =
                    performance.now() - start;

                start =
                    performance.now();

                await standaloneClient.initialize();

                const result =
                    await standaloneClient.storeSigned(
                        USER,
                        key,
                        value,
                        signature
                    );

                await standaloneClient.disconnect();

                fabric =
                    performance.now() - start;

                chain =
                    result.elapsed_ms || 0;
            }

            // ================= OFFLINE =================

            else if (MODE === 'offline') {

                let start =
                    performance.now();

                initialize(
                    USER,
                    CHAINCODE,
                    certificate
                );

                fabric +=
                    performance.now() - start;

                start =
                    performance.now();

                const proposal =
                    await createProposal(
                        'Store',
                        key,
                        value
                    );

                fabric +=
                    performance.now() - start;

                start =
                    performance.now();

                let signature =
                    await signDigest(
                        proposal.proposalDigest,
                        privatePem
                    );

                client +=
                    performance.now() - start;

                start =
                    performance.now();

                const transactionDigest =
                    await createTransaction(
                        signature
                    );

                fabric +=
                    performance.now() - start;

                start =
                    performance.now();

                signature =
                    await signDigest(
                        transactionDigest,
                        privatePem
                    );

                client +=
                    performance.now() - start;

                start =
                    performance.now();

                const commitDigest =
                    await createCommit(
                        signature
                    );

                fabric +=
                    performance.now() - start;

                start =
                    performance.now();

                signature =
                    await signDigest(
                        commitDigest,
                        privatePem
                    );

                client +=
                    performance.now() - start;

                start =
                    performance.now();

                const result =
                    await finalize(
                        signature
                    );

                fabric +=
                    performance.now() - start;

                start =
                    performance.now();

                await close();

                fabric +=
                    performance.now() - start;

                chain =
                    result?.elapsed_ms || 0;
            }

            else {
                throw new Error('Modo invalido');
            }

            const overhead =
                Math.max(
                    0,
                    fabric - chain
                );

            const total =
                client + fabric;

            rows.push({
                iteracao: i,
                client_ms: +client.toFixed(3),
                fabric_ms: +fabric.toFixed(3),
                chaincode_ms: +chain.toFixed(3),
                overhead_ms: +overhead.toFixed(3),
                total_ms: +total.toFixed(3)
            });

            console.log(
                `[${i}] client=${client.toFixed(3)}ms ` +
                `fabric=${fabric.toFixed(3)}ms ` +
                `chain=${chain.toFixed(3)}ms ` +
                `overhead=${overhead.toFixed(3)}ms ` +
                `total=${total.toFixed(3)}ms`
            );

        } catch (err) {

            console.error(
                `Falha ${i}`,
                err
            );

            try {
                await standaloneClient.disconnect();
            } catch {}

            try {
                await close();
            } catch {}
        }
    }

    const file =
        `benchmark_${MODE}_${Date.now()}.csv`;

    await createObjectCsvWriter({
        path: file,
        header: [
            { id: 'iteracao', title: 'iteracao' },
            { id: 'client_ms', title: 'client_ms' },
            { id: 'fabric_ms', title: 'fabric_ms' },
            { id: 'chaincode_ms', title: 'chaincode_ms' },
            { id: 'overhead_ms', title: 'overhead_ms' },
            { id: 'total_ms', title: 'total_ms' }
        ]
    }).writeRecords(rows);

    console.log('\n===== RESUMO =====');

    console.table(
        stats(
            rows.map(
                r => r.total_ms
            )
        )
    );

    console.log(`\nCSV salvo: ${file}`);
}

run().catch(console.error);