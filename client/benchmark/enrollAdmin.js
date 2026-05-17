const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');

const mspId = "org1MSP";
const admin = 'admin';
const adminpw = 'adminpw';

async function enroll() {
    try {

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

        const caTLSCACerts = fs.readFileSync(tlsCertPath);

        const ca = new FabricCAServices(
            caURL,
            { trustedRoots: caTLSCACerts, verify: false },
            caName
        );

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        const identity = await wallet.get(admin);
        if (identity) {
            console.log("Admin já existe");
            return;
        }

        const enrollment = await ca.enroll({
            enrollmentID: admin,
            enrollmentSecret: adminpw
        });

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: mspId,
            type: 'X.509',
        };

        await wallet.put(admin, x509Identity);
        console.log("Admin enrolled");

    } catch (error) {
        console.error(error);
    }
}

enroll();