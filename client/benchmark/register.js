'use strict';

const { Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const fs = require('fs');
const path = require('path');
const yaml = require("js-yaml");

const mspId = "org1MSP";
const caURL = "https://localhost:7054";
const caName = "ca-org1";

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

let ccp = null;
async function register(user) {
    try {
      
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

        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) {
            console.log('An identity for the enroll user "enroll" does not exist in the wallet');
            console.log('Run the enrollAdmin.js application before retrying');
            return;
        }

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        const secret = await ca.register({
            enrollmentID: user,
            role: 'client'
        }, adminUser);

        const enrollment = await ca.enroll({
            enrollmentID: user,
            enrollmentSecret: secret
        });

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: mspId,
            type: 'X.509',
        };
        await wallet.put(user, x509Identity);
        console.log(`Successfully registered and enrolled enroll user "${user}" and imported it into the wallet`);

    } catch (error) {
        console.error(`Failed to register user "${user}": ${error}`);
        process.exit(1);
    }
}
register('teste1')
module.exports = register;