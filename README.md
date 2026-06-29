# App Corrida

Aplicacao web para os pacientes corredores de uma nutricionista esportiva.
O paciente cadastra as provas de corrida que vai disputar e o app extrai os
dados da prova a partir da URL oficial, usando a API da Claude. A nutricionista
acompanha tudo por um painel de administracao.

## O que o app faz

- Paciente se cadastra sozinho na tela de login (nome, email e senha).
- No painel do paciente, ele adiciona uma prova colando a URL oficial. O
  servidor chama a API da Claude, que acessa o site e extrai: nome da prova,
  data, local, distancias, data e local de retirada de kit, resumo do percurso
  e observacoes relevantes.
- Os dados extraidos aparecem em um formulario editavel para revisao antes de
  salvar (o paciente confere e corrige o que precisar).
- Cada prova mostra a contagem regressiva ("dias restantes"). Provas passadas
  aparecem como "Prova realizada" e provas sem data como "Data a confirmar".
- O administrador (a nutricionista) ve todos os pacientes e provas, e pode
  ativar ou desativar pacientes. Paciente desativado nao consegue usar o app.

## Stack

- Frontend em HTML, CSS e JavaScript puro (sem framework, sem etapa de build).
- Backend em Node.js com Express, que serve os arquivos estaticos e atua como
  proxy da API da Claude (a chave da Anthropic fica somente no servidor).
- Supabase para autenticacao e banco de dados (PostgreSQL com Row Level
  Security).
- Deploy no EasyPanel (deteccao automatica de Node pelo Nixpacks, com um
  Dockerfile como alternativa).

## Pre-requisitos

- Node.js 18 ou superior e npm.
- Uma conta no Supabase (plano gratuito ja atende).
- Uma chave de API da Anthropic (Claude).

## Configuracao e execucao local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Criar o projeto no Supabase

1. Acesse o painel do Supabase e crie um novo projeto.
2. Anote a URL do projeto e a chave anon (em Project Settings, na secao API):
   - Project URL vira a variavel `SUPABASE_URL`.
   - chave `anon` `public` vira a variavel `SUPABASE_ANON_KEY`.

### 3. Rodar o schema do banco

1. No painel do Supabase, abra o SQL Editor.
2. Copie todo o conteudo de `supabase/schema.sql` e execute.
3. Isso cria as tabelas `profiles` e `races`, as funcoes de seguranca
   `is_admin()` e `is_active()`, habilita o RLS, cria as politicas e o trigger
   que gera o perfil do paciente a cada novo cadastro. O script e idempotente,
   entao pode ser reexecutado sem problema.

### 4. Preencher o arquivo .env

Copie `.env.example` para `.env` e preencha os valores:

```bash
cp .env.example .env
```

```env
ANTHROPIC_API_KEY=sua-chave-secreta-da-anthropic
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon-publica
PORT=3000
```

- `ANTHROPIC_API_KEY`: chave secreta, usada somente no servidor. Nunca e
  enviada ao navegador.
- `SUPABASE_URL` e `SUPABASE_ANON_KEY`: valores publicos, entregues ao navegador
  pela rota `/config.js`.
- `PORT`: opcional, padrao 3000. O servidor escuta em `0.0.0.0`.

### 5. Iniciar o servidor

```bash
npm start
```

Acesse `http://localhost:3000`.

## Como criar o primeiro administrador

Nao existe tela de criacao de admin. O fluxo e:

1. Cadastre-se normalmente pela tela de login (com o email que sera o do
   administrador). Isso cria um perfil com role `patient`.
2. No SQL Editor do Supabase, rode a consulta abaixo trocando o email:

   ```sql
   update public.profiles set role = 'admin' where email = 'admin@exemplo.com';
   ```

3. Faca login novamente. O usuario agora tem acesso ao painel de administracao
   (`/admin.html`).

A mesma linha tambem aparece comentada no final de `supabase/schema.sql`.

## Como funciona a extracao da prova

1. No painel, o paciente informa a URL oficial da prova (e, opcionalmente, um
   nome).
2. O navegador chama `POST /api/extract-race` com o corpo
   `{ "url": "...", "name": "..." }`.
3. O servidor usa o SDK oficial da Anthropic e o modelo `claude-sonnet-4-6` com
   a ferramenta de busca na web (`web_fetch`). A Claude acessa a pagina da prova
   e devolve um JSON com as chaves: `name`, `race_date`, `location`,
   `distances`, `kit_pickup_date`, `kit_pickup_location`, `route_summary` e
   `notes`.
4. A data (`race_date`) vem no formato `DD/MM/YYYY` (ou `null`). O navegador
   converte para o formato ISO `yyyy-mm-dd` antes de salvar na coluna `date` e
   reconverte para exibir.
5. Se a extracao falhar ou o site bloquear o acesso, o servidor ainda responde
   `200` com os campos desconhecidos em `null` e um aviso (`warning`) em
   portugues. O formulario de revisao abre de qualquer forma, para o paciente
   preencher manualmente.
6. A chave da Anthropic nunca sai do servidor. Se ela nao estiver configurada,
   a rota responde com erro `500`.

A rota `POST /api/extract-race` exige um paciente autenticado: o navegador envia
o token da sessao do Supabase no cabecalho `Authorization: Bearer <token>` e o
servidor valida a sessao antes de chamar a Claude (pedidos sem sessao recebem
`401`). Ha tambem um limite de uso por usuario (janela deslizante) para proteger
a chave da Anthropic contra abuso, e a URL e validada (somente http e https).

## Deploy no EasyPanel

Voce pode publicar de duas formas. As duas precisam das mesmas variaveis de
ambiente.

### Opcao A: Nixpacks (deteccao automatica)

1. No EasyPanel, crie um novo App apontando para este repositorio.
2. O Nixpacks detecta o projeto Node automaticamente, roda `npm install` no
   build e `npm start` ao iniciar (script definido no `package.json`).
3. Configure as variaveis de ambiente (secao abaixo).
4. Exponha a porta da aplicacao.

### Opcao B: Dockerfile

1. No EasyPanel, crie o App apontando para o repositorio e escolha o build por
   Dockerfile.
2. O `Dockerfile` incluido no projeto instala as dependencias e inicia o
   servidor com `npm start`.
3. Configure as variaveis de ambiente e exponha a porta.

### Variaveis de ambiente no EasyPanel

Defina nas configuracoes do App:

- `ANTHROPIC_API_KEY`: chave secreta da Anthropic (somente servidor).
- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_ANON_KEY`: chave anon publica do Supabase.
- `PORT`: porta em que a aplicacao escuta (por exemplo 3000). O servidor faz
  bind em `0.0.0.0`.

### Exposicao da porta

Exponha a porta configurada em `PORT` (padrao 3000) para que o EasyPanel
direcione o trafego ate a aplicacao.

## Sobre as chaves e a seguranca

- A chave anon do Supabase e publica por design. Ela pode aparecer no navegador
  sem problema: o que protege os dados e o Row Level Security (RLS) definido em
  `supabase/schema.sql`, que limita cada paciente a ver e editar apenas as
  proprias provas, e da ao admin a visao completa.
- A chave da Anthropic (`ANTHROPIC_API_KEY`) e secreta e fica apenas no
  servidor. Ela nunca e entregue ao navegador (a rota `/config.js` expoe somente
  a URL e a chave anon do Supabase).
- Pacientes desativados (`active = false`) sao bloqueados pelo RLS e o cliente
  os desconecta com uma mensagem ao tentar entrar.

## Estrutura do projeto

```
.
├── server.js              # servidor Express e proxy da API da Claude
├── package.json
├── package-lock.json      # versoes travadas das dependencias
├── .env.example
├── Dockerfile
├── .dockerignore
├── .gitignore
├── supabase/
│   └── schema.sql         # tabelas, funcoes, RLS, politicas e trigger
├── public/
│   ├── index.html         # login e cadastro
│   ├── dashboard.html     # painel do paciente
│   ├── admin.html         # painel do administrador
│   ├── css/
│   │   └── style.css      # design system compartilhado
│   └── js/
│       ├── auth.js        # cliente Supabase e helpers de autenticacao
│       ├── app.js         # logica do painel do paciente
│       └── admin.js       # logica do painel do administrador
└── README.md
```
