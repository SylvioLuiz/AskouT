# Colocar o AskouT no ar (askout.com.br)

Montagem escolhida: **Cloudflare** (DNS + site + portal de gestão, grátis) · **Railway** (API + banco Postgres) · **Resend** (e-mail).
Endereços: `askout.com.br` (site) · `api.askout.com.br` (API) · `gestao.askout.com.br` (portal de gestão).

> Nada disto foi executado de verdade ainda: o Dockerfile da API e as configurações abaixo foram escritos sem poder construir a imagem nem falar com essas contas. A instalação das dependências foi testada; o resto, não. Se um passo falhar, mande a mensagem de erro.

## 1. Cloudflare: DNS (uma vez, ~10 min + espera)
1. Crie a conta grátis em cloudflare.com → **Add a domain** → `askout.com.br` → plano **Free**.
2. Ele mostra **dois servidores de nome** (algo como `xxx.ns.cloudflare.com`). 
3. No Hostinger: **Domínios → askout.com.br → DNS / Nameservers → Alterar servidores de nome** → cole os dois. Salve.
4. Volte ao Cloudflare e clique em **Check nameservers**. Pode levar de minutos a 24 h. Daí em diante os registros de DNS são criados no Cloudflare (não mais no Hostinger).

## 2. Railway: API e banco
1. railway.com → **New Project → Deploy from GitHub repo** → `SylvioLuiz/AskouT`.
2. No serviço criado: **Settings → Build → Dockerfile Path** = `apps/api/Dockerfile` (a raiz do repositório é o contexto). **Healthcheck Path** = `/saude`.
3. No mesmo projeto: **New → Database → PostgreSQL**.
4. No serviço da API, **Variables**:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | referência ao banco: `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | texto aleatório (veja abaixo) |
| `CODE_SECRET` | outro texto aleatório, DIFERENTE do anterior |
| `CORS_ORIGINS` | `https://askout.com.br,https://www.askout.com.br,https://gestao.askout.com.br,https://localhost,capacitor://localhost` |
| `PUBLIC_WEB_URL` | `https://askout.com.br` |
| `EMAIL_TRANSPORT` | `resend` |
| `RESEND_API_KEY` | a chave do passo 4 |
| `EMAIL_FROM` | `AskouT <nao-responda@askout.com.br>` |
| `OSM_CONTACT` | `contato@askout.com.br` |

   Para gerar cada segredo (no seu Mac): `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Nunca cole segredos no chat nem no GitHub.
5. **Settings → Networking → Custom Domain** → `api.askout.com.br`. O Railway mostra um destino (CNAME). No Cloudflare (DNS → Add record): tipo **CNAME**, nome `api`, destino o que o Railway mostrou, **Proxy desligado (nuvem cinza)**.
6. Teste: abrir `https://api.askout.com.br/saude` deve mostrar `{"ok":true}`.

## 3. Cloudflare Pages: site e portal de gestão
Crie **dois projetos** (Workers & Pages → Create → Pages → Connect to Git → `AskouT`):

| | Site | Portal de gestão |
|---|---|---|
| Build command | `npm ci && npm run build -w @askout/web` | `npm ci && npm run build -w @askout/admin` |
| Build output directory | `apps/web/dist` | `apps/admin/dist` |
| Variáveis | `VITE_API_URL=https://api.askout.com.br` · `NODE_VERSION=22` | igual |
| Domínio personalizado | `askout.com.br` e `www.askout.com.br` | `gestao.askout.com.br` |

Em cada projeto: **Custom domains → Set up a domain**; como o DNS já está no Cloudflare, o registro é criado sozinho.

## 4. Resend: e-mail
1. resend.com → conta grátis → **Domains → Add Domain** → `askout.com.br`.
2. Ele lista registros (SPF, DKIM e outros). Crie cada um no Cloudflare (DNS → Add record), com **Proxy desligado**. Clique em **Verify**.
3. **API Keys → Create** (permissão de envio) e cole em `RESEND_API_KEY` no Railway.
4. Recomendado: adicione também o registro DMARC que o Resend sugerir.

## 5. Primeiro acesso
1. Abra `https://askout.com.br` e crie a sua conta (o código chega por e-mail).
2. Para virar administrador do portal: no Railway, no serviço da API, abra o terminal e rode `npx tsx apps/api/scripts/make-admin.ts seu@email.com`. Depois entre em `https://gestao.askout.com.br`.

## O que ainda falta depois disso
Ver `GOLIVE.md`: fotos e vídeos ainda ficam dentro do banco (mover para o Cloudflare R2), limite de requisições, política de privacidade, chaves do Google/Apple, compilação do aplicativo nas lojas.
