'use strict';

// ==================== IMPORTS ====================
const express        = require('express');
const bodyParser     = require('body-parser');
const cors           = require('cors');
const path           = require('path');
const crypto         = require('crypto');
const jwt            = require('jsonwebtoken');
const multer         = require('multer');
const { KJUR, KEYUTIL } = require('jsrsasign');
const { Wallets }    = require('fabric-network');

// Módulos internos
const normalizeS       = require('./resources/normalization.js');
const register         = require('./resources/register.js');
const standaloneClient = require('./resources/standaloneClient.js');
const {
  initialize,
  createProposal,
  createTransaction,
  createCommit,
  finalize,
  close
} = require('./resources/invoke.js');

// ==================== CONFIGURAÇÕES ====================
const app       = express();
const PORT      = 3000;
const MSP_ID    = 'org1MSP';
const CHAINCODE = 'teste_chaincode';
const WALLET_PATH = path.join(process.cwd(), 'wallet');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json());
app.use('/resources', express.static(path.join(__dirname, 'resources')));
app.use(express.static(path.join(__dirname, 'views')));

// ==================== JWT ====================
const JWT_SECRET = process.env.JWT_SECRET || 'fabric-dev-secret';

function authRequired(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

// ==================== AUTENTICAÇÃO ====================
const nonceStore = {};

app.post('/auth/challenge', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ message: 'Username é obrigatório' });

    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const identity = await wallet.get(username);
    if (!identity) return res.status(404).json({ message: 'Usuário não registrado' });

    const nonce = crypto.randomBytes(32).toString('hex');
    nonceStore[username] = nonce;
    res.json({ nonce });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, nonce, signature } = req.body;
    if (!username || !nonce || !signature) {
      return res.status(400).json({ message: 'username, nonce e signature são obrigatórios' });
    }

    if (!nonceStore[username] || nonceStore[username] !== nonce) {
      return res.status(400).json({ message: 'Nonce inválido ou expirado' });
    }
    delete nonceStore[username];

    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const identity = await wallet.get(username);
    if (!identity) return res.status(404).json({ message: 'Usuário não encontrado' });

    const certPEM = identity.credentials.certificate;
    const cert = KEYUTIL.getKey(certPEM);
    const sig = new KJUR.crypto.Signature({ alg: 'SHA256withECDSA' });
    sig.init(cert);
    sig.updateString(nonce);
    const isValid = sig.verify(b64tohex(signature));

    if (!isValid) return res.status(401).json({ message: 'Assinatura inválida' });

    const token = jwt.sign(
      { sub: username, username },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '10h', algorithm: 'HS256' }
    );
    res.json({ token });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ message: error.message });
  }
});

function b64tohex(b64) {
  return Buffer.from(b64, 'base64').toString('hex');
}

// ==================== REGISTRO DE USUÁRIO ====================
const upload = multer({ storage: multer.memoryStorage() });

app.post('/auth/register', upload.single('csr'), async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ message: 'Username é obrigatório' });
  if (!req.file) return res.status(400).json({ message: 'Arquivo CSR é obrigatório' });

  try {
    const csrPEM = req.file.buffer.toString('utf8');
    await register(username, csrPEM);
    res.json({ message: `Usuário ${username} registrado com sucesso` });
  } catch (err) {
    console.error('Erro no registro:', err);
    res.status(500).json({ message: err.message });
  }
});

// ==================== ROTAS PÚBLICAS ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));

// ==================== HELPER DE TIMING ====================
async function setTimingHelper(enable) {
  await standaloneClient.initialize();
  await standaloneClient.setTiming(enable);
  await standaloneClient.disconnect();
}

// ==================== BENCHMARK TIMING (manual) ====================
app.post('/benchmark/start', authRequired, async (req, res) => {
  try {
    await setTimingHelper(true);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/benchmark/stop', authRequired, async (req, res) => {
  try {
    await setTimingHelper(false);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TRANSACÕES SIMPLES ====================
app.post('/store', authRequired, async (req, res) => {
  const { key, value, signature, mode } = req.body;
  const username = req.user.sub;
  let serverTotalMs,serverEnd = 0;

  if (!key || !value) return res.status(400).json({ error: 'key e value são obrigatórios' });

  try {
    await standaloneClient.initialize();
    const serverStart = performance.now();
    
    let result;
    if (mode === 'signed') {
      if (!signature) return res.status(400).json({ error: 'signature é obrigatória no modo signed' });
      serverEnd = performance.now();
      serverTotalMs = serverEnd - serverStart;
      result = await standaloneClient.storeSigned(username, key, value, signature);
    } else {
      serverEnd = performance.now();
      serverTotalMs = serverEnd - serverStart;
      result = await standaloneClient.store(key, value);
    }
    await standaloneClient.disconnect();

    const chaincodeMs = result?.elapsed_ms || 0;
    // const backendOverheadMs = parseFloat((serverTotalMs - chaincodeMs).toFixed(4));

    res.json({
      ok: true,
      elapsed_ms: chaincodeMs,
      backend_overhead_ms: serverTotalMs
    });
  } catch (err) {
    console.error('Erro em store:', err);
    try { await standaloneClient.disconnect(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/store-pubkey', authRequired, async (req, res) => {
  const { pubKeyPEM } = req.body;
  const username = req.user.sub;
  if (!pubKeyPEM) return res.status(400).json({ error: 'pubKeyPEM é obrigatória' });
  try {
    await standaloneClient.initialize();
    await standaloneClient.storeUserPubKey(username, pubKeyPEM);
    await standaloneClient.disconnect();
    res.json({ ok: true });
  } catch (err) {
    try { await standaloneClient.disconnect(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/query', authRequired, async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'key é obrigatória' });
  try {
    await standaloneClient.initialize();
    const value = await standaloneClient.query(key);
    await standaloneClient.disconnect();
    res.json({ ok: true, value });
  } catch (err) {
    try { await standaloneClient.disconnect(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/verify', authRequired, async (req, res) => {
  const { message, signature } = req.body;
  const username = req.user.sub;
  if (!message || !signature) return res.status(400).json({ error: 'message e signature são obrigatórios' });
  try {
    await standaloneClient.initialize();
    const valid = await standaloneClient.verifySignature(username, message, signature);
    await standaloneClient.disconnect();
    res.json({ ok: true, valid });
  } catch (err) {
    try { await standaloneClient.disconnect(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ==================== TRANSACÕES OFFLINE ====================
const txSessions = new Map();

app.post('/transaction/offline/init', authRequired, async (req, res) => {
  const { fcn, args } = req.body;
  if (!fcn || !args || !Array.isArray(args)) {
    return res.status(400).json({ error: 'fcn e args (array) são obrigatórios' });
  }

  try {
    const stepStart = performance.now();
    const username = req.user.sub;
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    const identity = await wallet.get(username);
    if (!identity) return res.status(404).json({ error: 'Usuário não encontrado na wallet' });

    const certificate = identity.credentials.certificate;
    const elapsed = performance.now() - stepStart;
    initialize(username, CHAINCODE, certificate);
    
    const proposalDigest = await createProposal(fcn, ...args);
    
    const txId = proposalDigest.txId;
    console.log(elapsed)
    txSessions.set(txId, { createdAt: Date.now(), username, elapsed});

    return res.json({
      txId,
      step: 'proposal',
      proposalDigest: proposalDigest.proposalDigest.toString('base64'),
      elapsed
    });
  } catch (err) {
    console.error('Erro no init offline:', err);
    try { close(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/transaction/offline/sign-proposal', authRequired, async (req, res) => {
  const { txId, proposalSig } = req.body;
  if (!txId || !proposalSig) return res.status(400).json({ error: 'txId e proposalSig são obrigatórios' });
  const stepStart = performance.now();
  const session = txSessions.get(txId);
  if (!session || session.username !== req.user.sub) {
    return res.status(400).json({ error: 'Sessão inválida' });
  }

  try {
    const sigDER = normalizeS(Buffer.from(proposalSig));
    session.elapsed += performance.now()-stepStart;
    console.log(session.elapsed)
    const transactionDigest = await createTransaction(sigDER);
    return res.json({
      txId,
      step: 'transaction',
      transactionDigest: transactionDigest.toString('base64'),
    });
  } catch (err) {
    console.error('Erro ao criar transação:', err);
    try { close(); } catch {}
    txSessions.delete(txId);
    res.status(500).json({ error: err.message });
  }
});

app.post('/transaction/offline/sign-transaction', authRequired, async (req, res) => {
  const { txId, transactionSig } = req.body;
  if (!txId || !transactionSig) return res.status(400).json({ error: 'txId e transactionSig são obrigatórios' });
  const stepStart = performance.now();

  const session = txSessions.get(txId);
  if (!session || session.username !== req.user.sub) {
    return res.status(400).json({ error: 'Sessão inválida' });
  }

  try {
    const sigDER = normalizeS(Buffer.from(transactionSig));
    session.elapsed += performance.now()-stepStart;
    console.log(session.elapsed)
    const commitDigest = await createCommit(sigDER);
    return res.json({
      txId,
      step: 'commit',
      commitDigest: commitDigest.toString('base64')
    });
  } catch (err) {
    console.error('Erro ao criar commit:', err);
    try { close(); } catch {}
    txSessions.delete(txId);
    res.status(500).json({ error: err.message });
  }
});

app.post('/transaction/offline/finalize', authRequired, async (req, res) => {
  const { txId, commitSig } = req.body;
  if (!txId || !commitSig) return res.status(400).json({ error: 'txId e commitSig são obrigatórios' });
  const stepStart = performance.now()

  const session = txSessions.get(txId);
  if (!session || session.username !== req.user.sub) {
    return res.status(400).json({ error: 'Sessão inválida' });
  }

  try {
    const sigDER = normalizeS(Buffer.from(commitSig));
    session.elapsed += performance.now()-stepStart
    console.log(session.elapsed)
    const result = await finalize(sigDER);
    txSessions.delete(txId);
    close();

    const serverTotalMs = parseFloat(session.elapsed.toFixed(3))
    let chaincodeMs = 0;
    if (result && result.elapsed_ms) {
      chaincodeMs = result.elapsed_ms;
    } else if (result && result.result && result.result.elapsed_ms) {
      chaincodeMs = result.result.elapsed_ms;
    }

    // const backendOverheadMs = parseFloat((serverTotalMs - chaincodeMs).toFixed(4));

    return res.json({
      ok: true,
      result: result ?? null,
      elapsed_ms: chaincodeMs,
      backend_overhead_ms: serverTotalMs
    });
  } catch (err) {
    console.error('Erro ao finalizar:', err);
    try { close(); } catch {}
    txSessions.delete(txId);
    res.status(500).json({ error: err.message });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ==================== INICIALIZAÇÃO DO SERVIDOR ====================
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});