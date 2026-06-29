// App Corrida - servidor Express (ESM)
// Serve os arquivos estaticos de ./public, expoe a configuracao publica em /config.js
// e faz o proxy seguro para a API da Anthropic (extracao de dados de provas de corrida).
// A chave ANTHROPIC_API_KEY fica somente no servidor e nunca e enviada ao navegador.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Chaves de dados de prova retornadas ao navegador (sempre as 8 presentes).
const RACE_KEYS = [
  'name',
  'race_date',
  'location',
  'distances',
  'kit_pickup_date',
  'kit_pickup_location',
  'route_summary',
  'notes',
];

// Cria um objeto de prova com todas as chaves nulas (name pode herdar o nome informado).
function emptyRaceData(name) {
  return {
    name: name || null,
    race_date: null,
    location: null,
    distances: null,
    kit_pickup_date: null,
    kit_pickup_location: null,
    route_summary: null,
    notes: null,
  };
}

// Faz o parse robusto do JSON retornado pelo modelo:
// remove cercas de codigo markdown e corta do primeiro "{" ate o ultimo "}".
function parseRaceJson(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  const slice = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// Normaliza o objeto retornado pelo modelo para conter exatamente as 8 chaves.
function normalizeRaceData(parsed, name) {
  const data = emptyRaceData(name);
  if (parsed && typeof parsed === 'object') {
    for (const key of RACE_KEYS) {
      const value = parsed[key];
      if (value !== undefined && value !== null && value !== '') {
        data[key] = value;
      }
    }
  }
  if (!data.name) data.name = name || null;
  return data;
}

// ===== Autenticacao e limite de uso do endpoint de extracao =====

// Cliente Supabase (somente para validar a sessao do usuario). Usa a URL e a
// chave anon publicas; nao expoe nada secreto.
let supabaseAuthClient = null;
function getSupabaseAuthClient() {
  if (supabaseAuthClient) return supabaseAuthClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabaseAuthClient = createClient(url, key);
  return supabaseAuthClient;
}

// Extrai e valida o usuario a partir do cabecalho Authorization: Bearer <token>.
async function getUserFromRequest(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  const sb = getSupabaseAuthClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

// Limite de uso simples em memoria (por usuario): protege a chave da Anthropic
// contra abuso. Janela deslizante.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const rateBuckets = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return false;
}

const app = express();

// Cabecalhos de seguranca (defesa em profundidade).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data:; " +
      "connect-src 'self' https: wss:; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
});

// Log basico de requisicoes no console.
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Corpo JSON com limite sensato.
app.use(express.json({ limit: '1mb' }));

// Entrega a configuracao publica ao navegador (somente valores publicos do Supabase).
// A chave ANTHROPIC_API_KEY nunca e exposta aqui.
app.get('/config.js', (req, res) => {
  const config = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  };
  res.type('application/javascript');
  res.send(`window.__APP_CONFIG__ = ${JSON.stringify(config)};`);
});

// Extrai os dados de uma prova de corrida a partir da URL oficial usando a Claude API.
app.post('/api/extract-race', async (req, res) => {
  const body = req.body || {};
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;

  // Valida a URL: rejeita pedidos sem URL.
  if (!url) {
    return res.status(400).json({ error: 'Informe a URL da prova.' });
  }

  // Valida o formato da URL: apenas http(s).
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'URL invalida.' });
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'URL invalida. Use http ou https.' });
  }

  // Sem a chave da API o servidor nao consegue prosseguir.
  if (!process.env.ANTHROPIC_API_KEY) {
    return res
      .status(500)
      .json({ error: 'Chave da API nao configurada no servidor.' });
  }

  // Exige usuario autenticado (sessao valida do Supabase). Protege a chave da
  // Anthropic contra uso anonimo. O front-end envia Authorization: Bearer <token>.
  if (!getSupabaseAuthClient()) {
    return res
      .status(503)
      .json({ error: 'Autenticacao nao configurada no servidor.' });
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return res
      .status(401)
      .json({ error: 'Sessao invalida. Faca login novamente.' });
  }

  // Limite de uso por usuario.
  if (isRateLimited(user.id)) {
    return res.status(429).json({
      error:
        'Muitas extracoes em pouco tempo. Aguarde alguns minutos e tente de novo.',
    });
  }

  try {
    // O construtor le ANTHROPIC_API_KEY do ambiente automaticamente.
    const client = new Anthropic();

    // A ferramenta web_fetch so acessa URLs presentes na conversa, entao a URL
    // precisa estar no texto da mensagem do usuario.
    const prompt =
      'Use a ferramenta web_fetch para acessar o conteudo do site a seguir e ' +
      'extraia as seguintes informacoes da prova de corrida: nome oficial da ' +
      'prova, data de realizacao (formato DD/MM/YYYY), cidade e local de largada, ' +
      'distancias disponiveis (ex: 5km, 10km, 21km, 42km), data e local de ' +
      'retirada de kit, resumo do percurso, e qualquer informacao relevante para ' +
      'o corredor (cortes de tempo, exigencias, contato). Retorne apenas um JSON ' +
      'valido com as chaves: name, race_date, location, distances, ' +
      'kit_pickup_date, kit_pickup_location, route_summary, notes. Se alguma ' +
      'informacao nao estiver disponivel, use null. Nao escreva nenhum texto fora ' +
      'do JSON. URL: ' +
      url;

    let messages = [{ role: 'user', content: prompt }];
    let response;

    // A ferramenta web_fetch roda no servidor da Anthropic, entao o modelo pode
    // retornar stop_reason 'pause_turn'. Tratamos isso anexando a resposta do
    // assistente as mensagens e reenviando o pedido, ate 5 vezes.
    for (let i = 0; i < 6; i++) {
      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 }],
        messages,
      });
      if (response.stop_reason !== 'pause_turn') break;
      messages = [...messages, { role: 'assistant', content: response.content }];
    }

    // Junta todos os blocos de texto da resposta.
    const text = (response.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const parsed = parseRaceJson(text);

    if (!parsed) {
      return res.json({
        data: emptyRaceData(name),
        warning:
          'Nao foi possivel extrair os dados automaticamente. Revise e preencha os campos manualmente.',
      });
    }

    return res.json({ data: normalizeRaceData(parsed, name) });
  } catch (err) {
    // Nunca vazamos a chave da API nem o stack trace para o cliente.
    const detail = err && err.message ? err.message : 'erro desconhecido';
    console.error('Erro na extracao da prova:', detail);
    return res.json({
      data: emptyRaceData(name),
      warning:
        'Ocorreu um erro ao acessar o site da prova. Confira o link ou preencha os dados manualmente.',
    });
  }
});

// Arquivos estaticos do front-end.
app.use(express.static(PUBLIC_DIR));

// Fallback para rotas desconhecidas: rotas /api respondem 404 em JSON,
// as demais caem na pagina inicial.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Rota nao encontrada.' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) res.status(404).send('Pagina nao encontrada.');
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`App Corrida no ar em http://0.0.0.0:${PORT}`);
});
