'use strict';

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const path       = require('path');
const crypto     = require('crypto');
const multer     = require('multer');
const jwt        = require('jsonwebtoken');
const fsRead     = require('fs');

const upload = multer({ dest: 'uploads/' });

// Modulos da rede Fabric
const { registerWithSupabase } = require('./resources/register.js');
const normalizeS = require('./resources/normalization.js');
const {
  initialize,
  createProposal,
  createTransaction,
  createCommit,
  finalize,
  close
} = require('./resources/invoke.js');

// Modulo standalone (sem autenticacao por chave do usuario)
const standaloneClient = require('./resources/standalone_client.js');

const app  = express();
const PORT = 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json());

app.use('/resources', express.static(path.join(__dirname, 'resources')));
app.use(express.static(path.join(__dirname, 'views')));

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET || 'fabric-dev-secret';

function authRequired(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Token ausente' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }
}

// ---------------------------------------------------------------------------
// Sessoes de transacao em andamento
// ---------------------------------------------------------------------------

const txSessions = new Map();

setInterval(() => {
  const limite = Date.now() - 10 * 60 * 1000;
  for (const [id, session] of txSessions) {
    if (session.createdAt < limite) txSessions.delete(id);
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Paginas
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// ---------------------------------------------------------------------------
// AUTENTICACAO
// ---------------------------------------------------------------------------

app.post('/auth/register', async (req, res) => {
  const { username, csr } = req.body;

  if (!username || !csr) {
    return res.status(400).json({ error: 'username e csr sao obrigatorios' });
  }

  try {
    await register(username, csr);
    res.json({ message: `Usuario ${username} registrado com sucesso` });
  } catch (err) {
    console.error('Erro no registro:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/auth/challenge', (req, res) => {
  const { username } = req.body;

  if (!username) return res.status(400).json({ error: 'username e obrigatorio' });

  const challenge = generateChallenge();
  activeChallenges.set(username, challenge);

  res.json({ nonce: challenge.nonce });
});

app.post('/auth/login', async (req, res) => {
  const { username, signature } = req.body;

  if (!username || !signature) {
    return res.status(400).json({ error: 'username e signature sao obrigatorios' });
  }

  try {
    const sigBuffer = Buffer.from(signature);
    const { token } = await verifySignature(username, sigBuffer);
    res.json({ token });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(401).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// TRANSACOES COM ASSINATURA OFFLINE (fluxo original com chave do usuario)
// ---------------------------------------------------------------------------

async function handleTransaction(req, res) {
  const { action, step, txId, chaincode, fcn, args, signature } = req.body;
  const userId = req.user.sub;

  try {
    if (action === 'init') {
      if (!chaincode || !fcn || !args) {
        return res.status(400).json({ error: 'chaincode, fcn e args sao obrigatorios' });
      }

      const certificate = await getCertificateByUserId(userId);
      initialize(userId, chaincode, certificate);

      const proposalDigest = await createProposal(fcn, ...args);
      const newTxId = crypto.randomUUID();
      txSessions.set(newTxId, { createdAt: Date.now() });

      return res.json({
        txId:           newTxId,
        step:           'proposal',
        proposalDigest: proposalDigest.toString('base64')
      });
    }

    if (!txId || !step || !signature) {
      return res.status(400).json({ error: 'txId, step e signature sao obrigatorios' });
    }

    if (!txSessions.has(txId)) {
      return res.status(400).json({ error: 'Sessao nao encontrada ou expirada' });
    }

    const sigDER = normalizeS(Buffer.from(signature));

    if (step === 'proposal') {
      const transactionDigest = await createTransaction(sigDER);
      return res.json({
        txId,
        step:              'transaction',
        transactionDigest: transactionDigest.toString('base64')
      });
    }

    if (step === 'transaction') {
      const commitDigest = await createCommit(sigDER);
      return res.json({
        txId,
        step:         'commit',
        commitDigest: commitDigest.toString('base64')
      });
    }

    if (step === 'commit') {
      const result = await finalize(sigDER);
      txSessions.delete(txId);
      close();
      return res.json({ txId, step: 'done', ok: true, result: result ?? null });
    }

    return res.status(400).json({ error: `Step desconhecido: ${step}` });

  } catch (err) {
    console.error('Erro na transacao:', err);
    txSessions.delete(txId);
    try { close(); } catch {}
    res.status(500).json({ error: err.message });
  }
}

app.post('/transaction', authRequired, handleTransaction);
app.post('/invoke',      authRequired, handleTransaction);
app.post('/query',       authRequired, handleTransaction);

// ---------------------------------------------------------------------------
// TRANSACOES STANDALONE (fluxo sem chave do usuario, usa credenciais do peer)
//
// Endpoint unico: POST /transaction-standalone
// Body: { chaincode: string, fcn: string, args: string[] }
// Retorna: { ok: true, result: any }
//
// O mapeamento de funcoes do chaincode para metodos do standalone_client
// e feito pelo map abaixo. Para adicionar novas funcoes, basta incluir
// uma entrada: 'NomeFuncaoChaincode' -> (client, args) => client.metodo(...args)
// ---------------------------------------------------------------------------

const STANDALONE_FN_MAP = {
  // sollytch-chain
  // StoreTest args: [testID, jsonStr, predictStr] - standalone_client.storeTest(jsonStr) extrai test_id internamente
  StoreTest:           (c, a) => c.storeTest(a[1]),
  // UpdateTest args: [testID, jsonStr] - standalone_client.updateTest(jsonStr, testID)
  UpdateTest:          (c, a) => c.updateTest(a[1], a[0]),
  // StoreModel args: [modelKey, modelBase64] - standalone_client.storeModel(modelBase64, modelKey)
  StoreModel:          (c, a) => c.storeModel(a[1], a[0]),
  GetTestByID:         (c, a) => c.queryTestByID(a[0]),
  GetTestsByLote:      (c, a) => c.queryTestByLote(a[0]),
  StorePlanilha:       (c, a) => c.storePlanilha(a[0], a[1]),
  GetPlanilhaByHash:   (c, a) => c.queryPlanilhaByHash(a[0]),
  GetPlanilhasByLote:  (c, a) => c.queryPlanilhaByLote(a[0]),
  // sollytch-image
  StoreImage:          (c, a) => c.storeImage(a[1], a[0]),
  GetImageByID:        (c, a) => c.queryImageByHash(a[0]),
  GetImagesByKit:      (c, a) => c.queryImageByKit(a[0]),
};

app.post('/transaction-standalone', async (req, res) => {
  const { chaincode, fcn, args } = req.body;

  if (!chaincode || !fcn || !args) {
    return res.status(400).json({ error: 'chaincode, fcn e args sao obrigatorios' });
  }

  const handler = STANDALONE_FN_MAP[fcn];
  if (!handler) {
    return res.status(400).json({ error: `Funcao nao mapeada para standalone: ${fcn}` });
  }

  try {
    await standaloneClient.initialize();
    const result = await handler(standaloneClient, args);
    await standaloneClient.disconnect();

    res.json({ ok: true, result: result ?? null });
  } catch (err) {
    console.error('Erro no standalone:', err);
    try { await standaloneClient.disconnect(); } catch {}
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});