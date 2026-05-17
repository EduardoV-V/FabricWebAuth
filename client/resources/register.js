'use strict';

const { Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const admin = 'admin';
const mspId = "org1MSP";
const caURL = "https://localhost:7054";
const caName = "ca-org1";

function validateCSR(csrPEM, user) {
    try {
        fs.writeFileSync('/tmp/csr.pem', csrPEM);

        execSync('openssl req -in /tmp/csr.pem -noout -verify');

        const subjectOutput = execSync('openssl req -in /tmp/csr.pem -noout -subject').toString();

        fs.unlinkSync('/tmp/csr.pem');

        let commonName = null;
        let organization = null;

        const cnMatch = subjectOutput.match(/CN\s*=\s*([^,\/\n]+)/);
        const oMatch = subjectOutput.match(/O\s*=\s*([^,\/\n]+)/);

        if (cnMatch) commonName = cnMatch[1].trim();
        if (oMatch) organization = oMatch[1].trim();

        if (commonName !== user) {
            console.error(`CN do CSR (${commonName}) nao corresponde ao username (${user})`);
            return false;
        }

        if (!organization) {
            console.error(`CSR invalido: campo O (Organization) e obrigatorio`);
            return false;
        }

        return true;

    } catch (error) {
        console.error(`Erro ao validar CSR: ${error.message}`);
        try { fs.unlinkSync('/tmp/csr.pem'); } catch {}
        return false;
    }
}

async function register(user, csrPEM) {
    try {

        if (!validateCSR(csrPEM, user)) {
            console.error(`CSR invalido. Registro abortado.`);
            return;
        }

        const tlsCertPath = path.resolve(
            __dirname,
            "..",
            "..",
            "fabric",
            "organizations",
            "fabric-ca",
            "org1",
            "tls-cert.pem"
        );

        const caTLSCACerts = fs.readFileSync(tlsCertPath);

        const ca = new FabricCAServices(
            caURL,
            { trustedRoots: caTLSCACerts, verify: false },
            caName
        );

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        console.log(`Wallet path: ${walletPath}`);

        const userIdentity = await wallet.get(user);
        if (userIdentity) {
            console.log(`An identity for the user ${user} already exists in the wallet`);
            return;
        }

        const adminIdentity = await wallet.get(admin);
        if (!adminIdentity) {
            console.log(`An admin identity for the enroll user ${admin} does not exist in the wallet`);
            console.log('Run the enrollAdmin.js application before retrying');
            return;
        }

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, admin);

        let secret;

        try {
            secret = await ca.register({
                enrollmentID: user,
                role: 'client',
            }, adminUser);
        } catch (err) {
            if (err.message.includes('already registered')) {
                console.log(`Usuario ${user} ja registrado`);
            } else {
                throw err;
            }
        }

        let enrollment;

        try {
            enrollment = await ca.enroll({
                enrollmentID: user,
                enrollmentSecret: secret,
                csr: csrPEM
            });
        } catch (err) {
            console.error(`Erro no enroll: ${err.message}`);

            if (secret) {
                try {
                    await ca.revoke({
                        enrollmentID: user,
                        reason: 'remove'
                    }, adminUser);
                    console.log(`Registro revertido`);
                } catch {}
            }

            return;
        }

        if (!enrollment || !enrollment.certificate) {
            console.error(`Enroll falhou: certificado nao gerado`);
            return;
        }

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
            },
            mspId: mspId,
            type: 'X.509',
        };

        await wallet.put(user, x509Identity);
        console.log(`Successfully registered and enrolled user "${user}"`);

    } catch (error) {
        console.error(`Failed: ${error}`);
    }
}

module.exports = register;