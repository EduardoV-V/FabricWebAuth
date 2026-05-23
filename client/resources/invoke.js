// Importa bibliotecas necessarias
const grpc = require('@grpc/grpc-js'); // Cliente gRPC para comunicacao com peers
const { connect, hash } = require('@hyperledger/fabric-gateway'); // Gateway Fabric para operacoes de contrato
const fs = require('fs'); // Para ler arquivos do sistema
const path = require('path'); // Para manipular caminhos de arquivos

// Variaveis globais para manter objetos da sessao atual
let CC_NAME; // Nome do chaincode ativo
const CHANNEL = "mainchannel"; // Nome do canal Hyperledger Fabric
const MSPID = "org1MSP"; // ID do MSP da organizacao
let client, gateway, network, contract;
let proposalBytes, transactionBytes, signedTransaction, commitBytes;

// Encoder para converter strings para bytes UTF-8 (obrigatorio no SDK)
const utf8Encoder = new TextEncoder();

/**
 * Inicializa a comunicacao com o peer e o gateway usando a identidade de um usuario.
 *
 * @param {string} userId - ID do usuario (do Supabase).
 * @param {string} chaincode - Nome do chaincode (contrato inteligente) a ser utilizado.
 * @param {string} certificate - Certificado do usuario (do Supabase).
 */
function initialize(userId, chaincode, certificate) {
	console.log("Inicializando conexao gateway com chaincode");

	CC_NAME = chaincode;

	// Usa certificado do Supabase diretamente
	const certBuffer = utf8Encoder.encode(certificate);

	// Lê TLS do peer
	const tlsCertPath = path.resolve(
		__dirname,
		"..",
		"..",
		"fabric",
		"organizations",
		"peerOrganizations",
		"org1.example.com",
		"peers",
		"peer0.org1.example.com",
		"tls",
		"ca.crt"
	);

	const tlsRootCert = fs.readFileSync(tlsCertPath);

	// Conexao gRPC
	client = new grpc.Client(
		'localhost:7051',
		grpc.credentials.createSsl(tlsRootCert),
		{
			'grpc.ssl_target_name_override': 'peer0.org1.example.com',
		}
	);

	// Gateway
	gateway = connect({
		identity: { mspId: MSPID, credentials: certBuffer },
		hash: hash.none,
		client
	});

	// Network + Contract
	network = gateway.getNetwork(CHANNEL);
	contract = network.getContract(CC_NAME);

	console.log("Conexao finalizada com sucesso");
}

/**
 * Cria uma proposta de transacao para invocar uma funcao do chaincode.
 */
async function createProposal(fcn, ...args) {
	const unsignedProposal = contract.newProposal(fcn, {
		arguments: args,
	});

	proposalBytes = unsignedProposal.getBytes();

	const proposalDigest = Buffer.from(unsignedProposal.getDigest());

	console.log("Proposta criada. Digest:\n", proposalDigest);
	console.log("=================================================================================");

	return {proposalDigest: proposalDigest, txId: unsignedProposal.getTransactionId()};
}

/**
 * Cria uma transacao a partir da proposta, usando a assinatura da proposta.
 */
async function createTransaction(proposalSig) {
	const signedProposal = gateway.newSignedProposal(
		proposalBytes,
		proposalSig
	);

	const unsignedTransaction = await signedProposal.endorse();

	transactionBytes = unsignedTransaction.getBytes();

	const transactionDigest = Buffer.from(unsignedTransaction.getDigest());

	console.log("Transacao criada. Digest:\n", transactionDigest);
	console.log("=================================================================================");

	return transactionDigest;
}

/**
 * Cria o commit da transacao, usando a assinatura da transacao.
 */
async function createCommit(transactionSig) {
	signedTransaction = gateway.newSignedTransaction(
		transactionBytes,
		transactionSig
	);

	const unsignedCommit = await signedTransaction.submit();

	commitBytes = unsignedCommit.getBytes();

	const commitDigest = Buffer.from(unsignedCommit.getDigest());

	console.log("Commit criado. Digest:\n", commitDigest);
	console.log("=================================================================================");

	return commitDigest;
}

/**
 * Finaliza o fluxo assinando o commit e obtem o status de confirmacao na blockchain.
 */
async function finalize(commitSig) {
	const signedCommit = gateway.newSignedCommit(commitBytes, commitSig);

	const status = await signedCommit.getStatus();

	const result = signedTransaction.getResult();

	console.log('Transacao finalizada. Status:\n', status);
	console.log("=================================================================================");

	let resultJson;

	if (result && result.length > 0) {
		const jsonStr = Buffer.from(result).toString('utf-8');

		try {
			resultJson = JSON.parse(jsonStr);
			return resultJson;
		} catch (error) {
			console.error("Erro ao converter para JSON:", error);
		}
	}
}

/**
 * Encerra a conexao com o gateway e o cliente gRPC.
 */
async function close() {
	console.log('======== Fechando conexao gateway ========');
	gateway.close();
	client.close();
}

// Exporta funcoes para uso externo
module.exports = {
	initialize,
	createProposal,
	createTransaction,
	createCommit,
	finalize,
	close
};