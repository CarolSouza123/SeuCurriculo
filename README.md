# Seu Currículo

Gerador de currículo profissional com Pix, IA do Gemini e PDF por e-mail.

## Arquivos

- `index.html` — site (formulário, prévia com desfoque, modal Pix e download após pagamento)
- `Codigo.gs` — backend no Google Apps Script (planilha, Pix no Mercado Pago, webhook, Gemini, PDF no Drive e envio por e-mail)

> Atenção: o `Codigo.gs` não vai para o GitHub Pages nem para a Cloudflare. Ele é colado no Apps Script da planilha. Ele está neste repositório só como cópia organizada do código.

## Como colocar no ar

### 1. Planilha e Apps Script

1. Crie uma Planilha Google nova.
2. Renomeie a aba `Página1` para `Pedidos`.
3. Coloque estes cabeçalhos na linha 1:
   - A1: `ID_Pagamento`
   - B1: `Data`
   - C1: `Status`
   - D1: `Email`
   - E1: `Dados_Brutos`
   - F1: `Link_PDF`
   - G1: `Texto_Recrutador`
4. Na planilha, abra **Extensões > Apps Script**.
5. Apague o conteúdo e cole o código de `Codigo.gs`.
6. Preencha no topo do código, só lá dentro do Apps Script (nunca no GitHub):
   - `GEMINI_API_KEY`
   - `MP_ACCESS_TOKEN`
   - `ID_PASTA_DRIVE`
7. Clique em **Implantar > Nova implantação > App da Web**.
   - Executar como: Eu
   - Quem pode acessar: Qualquer pessoa
8. Copie a URL do App da Web gerada.

### 2. Site

1. No `index.html`, troque `COLE_SUA_URL_DO_WEB_APP_AQUI` pela URL do App da Web.
2. Publique o `index.html` (GitHub Pages ou Cloudflare Pages).

### 3. Mercado Pago

1. Crie uma aplicação no Mercado Pago Developers.
2. Copie o Access Token de produção para o `Codigo.gs` no Apps Script.
3. Na aba Webhooks da aplicação, cadastre a URL do App da Web e marque o evento **Pagamentos (payments)**.

### 4. Gemini

Pegue a chave grátis no Google AI Studio (aistudio.google.com) e cole no `Codigo.gs` no Apps Script.

## Preço

O valor cobrado está em `VALOR_COBRANCA` no `Codigo.gs`: R$ 19,90.

## Segurança

Nunca suba chaves reais para o GitHub. As chaves ficam só dentro do Apps Script.
