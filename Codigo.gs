// ================= CONFIGURAÇÕES =================
const GEMINI_API_KEY = "COLE_SUA_CHAVE_API_GEMINI_AQUI";
const MP_ACCESS_TOKEN = "COLE_SEU_ACCESS_TOKEN_MERCADO_PAGO_AQUI";
const ID_PASTA_DRIVE = "COLE_O_ID_DA_PASTA_DO_DRIVE_AQUI"; // Onde os PDFs ficarão salvos
const VALOR_COBRANCA = 19.90;
// =================================================

// 1. RECEBE REQUISIÇÕES POST (Do seu site para gerar Pix OU do Mercado Pago avisando pagamento)
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // CASO A: Veio do seu site pedindo para criar o Pix
    if (body.acao === "criar_pix") {
      return criarCobrancaPix(body.dados);
    }

    // CASO B: Veio do Webhook do Mercado Pago avisando atualização de pagamento
    if (body.type === "payment" || (body.data && body.data.id)) {
      const paymentId = body.data ? body.data.id : body.id;
      processarWebhookMercadoPago(paymentId);
      return ContentService.createTextOutput(JSON.stringify({ status: "ok" })).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (erro) {
    return ContentService.createTextOutput(JSON.stringify({ erro: erro.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 2. RECEBE REQUISIÇÕES GET (O site checando se o Pix já foi pago)
function doGet(e) {
  const paymentId = e.parameter.id;
  if (!paymentId) return respostaJSON({ status: "erro" });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Pedidos");
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === String(paymentId)) {
      return respostaJSON({
        status: dados[i][2], // "PENDENTE" ou "PAGO"
        pdfUrl: dados[i][5],
        textoRecrutador: dados[i][6]
      });
    }
  }
  return respostaJSON({ status: "NAO_ENCONTRADO" });
}

// 3. CRIA O PIX NO MERCADO PAGO E SALVA NA PLANILHA
function criarCobrancaPix(dadosCliente) {
  const url = "https://api.mercadopago.com/v1/payments";
  const payload = {
    transaction_amount: VALOR_COBRANCA,
    description: "Curriculo Profissional Otimizado + Mensagem RH",
    payment_method_id: "pix",
    payer: {
      email: dadosCliente.email,
      first_name: dadosCliente.nome.split(" ")[0]
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + MP_ACCESS_TOKEN,
      "X-Idempotency-Key": Utilities.getUuid()
    },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(url, options);
  const resJson = JSON.parse(response.getContentText());

  const paymentId = String(resJson.id);
  const qrCodeBase64 = resJson.point_of_interaction.transaction_data.qr_code_base64;
  const pixCopiaCola = resJson.point_of_interaction.transaction_data.qr_code;

  // Salva na planilha como PENDENTE
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Pedidos");
  sheet.appendRow([
    paymentId,
    new Date(),
    "PENDENTE",
    dadosCliente.email,
    JSON.stringify(dadosCliente),
    "",
    ""
  ]);

  return respostaJSON({
    sucesso: true,
    paymentId: paymentId,
    qrCodeBase64: qrCodeBase64,
    pixCopiaCola: pixCopiaCola
  });
}

// 4. VERIFICA O PAGAMENTO NO MERCADO PAGO E DISPARA A IA + PDF
function processarWebhookMercadoPago(paymentId) {
  const url = "https://api.mercadopago.com/v1/payments/" + paymentId;
  const options = {
    method: "get",
    headers: { "Authorization": "Bearer " + MP_ACCESS_TOKEN }
  };

  const res = JSON.parse(UrlFetchApp.fetch(url, options).getContentText());

  if (res.status === "approved") {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Pedidos");
    const linhas = sheet.getDataRange().getValues();

    for (let i = 1; i < linhas.length; i++) {
      // Só processa se ainda estiver PENDENTE (evita duplicidade se o webhook bater 2 vezes)
      if (String(linhas[i][0]) === String(paymentId) && linhas[i][2] === "PENDENTE") {
        const dadosBrutos = JSON.parse(linhas[i][4]);

        // Chama o Gemini para melhorar o currículo
        const dadosMelhorados = chamarGemini(dadosBrutos);

        // Gera o HTML blindado e converte em PDF
        const htmlFinal = montarHtmlCurriculo(dadosBrutos, dadosMelhorados);
        const blobPdf = Utilities.newBlob(htmlFinal, "text/html", "Curriculo_" + dadosBrutos.nome + ".html").getAs("application/pdf");
        blobPdf.setName("Curriculo_" + dadosBrutos.nome.replace(/\s+/g, "_") + ".pdf");

        // Salva no Google Drive e libera link público de visualização
        const pasta = DriveApp.getFolderById(ID_PASTA_DRIVE);
        const arquivo = pasta.createFile(blobPdf);
        arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        const linkDownload = "https://drive.google.com/uc?export=download&id=" + arquivo.getId();

        // Atualiza a planilha
        sheet.getRange(i + 1, 3).setValue("PAGO");
        sheet.getRange(i + 1, 6).setValue(linkDownload);
        sheet.getRange(i + 1, 7).setValue(dadosMelhorados.mensagem_recrutador);

        // Envia cópia por e-mail
        MailApp.sendEmail({
          to: dadosBrutos.email,
          subject: "Seu Currículo Profissional está pronto! 📄",
          body: "Olá, " + dadosBrutos.nome + "!\n\nSegue em anexo o seu currículo estruturado para passar nos filtros de RH.\n\n--- MENSAGEM PRONTA PARA ENVIAR NO WHATSAPP DO RECRUTADOR ---\n\n" + dadosMelhorados.mensagem_recrutador + "\n\nBoa sorte na entrevista!",
          attachments: [blobPdf]
        });

        break;
      }
    }
  }
}

// 5. CHAMA A API DO GEMINI E EXIGE RETORNO EM JSON PURO
function chamarGemini(dados) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;

  const prompt = `
Você é um especialista sênior em Recrutamento e Seleção e otimização de currículos para sistemas ATS.
Receba os dados brutos de um candidato e reescreva tudo de forma profissional, persuasiva, corrigindo erros de português e usando verbos de ação e palavras-chave fortes para a vaga pretendida.

Dados do candidato:
- Cargo desejado: ${dados.cargo}
- Resumo bruto: ${dados.resumo}
- Experiências brutas: ${dados.experiencias}
- Formação bruta: ${dados.formacao}
- Habilidades brutas: ${dados.habilidades}

Retorne ESTRITAMENTE um objeto JSON válido (sem blocos de markdown, sem crases) com a seguinte estrutura exata:
{
  "resumo_profissional": "Parágrafo de 3 a 4 linhas direto e forte focado no cargo desejado.",
  "experiencias": [
    {
      "cargo": "Nome do cargo corrigido",
      "empresa": "Nome da empresa",
      "periodo": "Período informado",
      "atividades": ["Ponto forte 1 com verbo de ação", "Ponto forte 2 com resultado/responsabilidade"]
    }
  ],
  "formacao": [
    {
      "curso": "Nome do curso",
      "instituicao": "Instituição",
      "status": "Ano ou status (ex: Concluído em 2023)"
    }
  ],
  "habilidades": ["Habilidade 1", "Habilidade 2", "Habilidade 3", "Habilidade 4", "Habilidade 5"],
  "mensagem_recrutador": "Uma mensagem curta, educada e persuasiva para o candidato copiar e colar no WhatsApp ou e-mail ao enviar o currículo."
}
`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json"
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  const res = JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
  const textoJson = res.candidates[0].content.parts[0].text;
  return JSON.parse(textoJson);
}

// 6. TEMPLATE HTML BLINDADO PARA CONVERSÃO EM PDF NO GOOGLE
function montarHtmlCurriculo(bruto, ia) {
  let htmlExp = "";
  ia.experiencias.forEach(exp => {
    let listaAtividades = exp.atividades.map(a => `<li style="margin-bottom: 4px;">${a}</li>`).join("");
    htmlExp += `
      <div style="margin-bottom: 14px;">
        <div style="font-weight: bold; font-size: 13px; color: #111827;">${exp.cargo} — <span style="font-weight: normal; color: #374151;">${exp.empresa}</span></div>
        <div style="font-size: 11px; color: #6B7280; margin-bottom: 4px;">${exp.periodo}</div>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #374151; line-height: 1.4;">
          ${listaAtividades}
        </ul>
      </div>
    `;
  });

  let htmlForm = "";
  ia.formacao.forEach(f => {
    htmlForm += `
      <div style="margin-bottom: 8px; font-size: 12px;">
        <strong style="color: #111827;">${f.curso}</strong> — ${f.instituicao} <span style="color: #6B7280;">(${f.status})</span>
      </div>
    `;
  });

  let htmlHab = ia.habilidades.map(h => `<span style="display: inline-block; background-color: #F3F4F6; color: #1F2937; padding: 4px 10px; border-radius: 4px; font-size: 11px; margin-right: 6px; margin-bottom: 6px;">${h}</span>`).join("");

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      @page { margin: 18mm 18mm 18mm 18mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #1F2937; margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <!-- CABEÇALHO -->
    <div style="border-bottom: 2px solid #1E3A8A; padding-bottom: 12px; margin-bottom: 18px;">
      <h1 style="margin: 0 0 4px 0; font-size: 24px; color: #111827; text-transform: uppercase; letter-spacing: 0.5px;">${bruto.nome}</h1>
      <div style="font-size: 14px; font-weight: bold; color: #1E3A8A; margin-bottom: 8px;">${bruto.cargo}</div>
      <div style="font-size: 11px; color: #4B5563;">
        ${bruto.cidade} &nbsp;|&nbsp; Tel/WhatsApp: ${bruto.telefone} &nbsp;|&nbsp; E-mail: ${bruto.email}
      </div>
    </div>

    <!-- RESUMO -->
    <div style="margin-bottom: 18px;">
      <div style="font-size: 12px; font-weight: bold; color: #1E3A8A; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; margin-bottom: 8px;">Resumo Profissional</div>
      <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #374151;">${ia.resumo_profissional}</p>
    </div>

    <!-- EXPERIÊNCIA -->
    <div style="margin-bottom: 18px;">
      <div style="font-size: 12px; font-weight: bold; color: #1E3A8A; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; margin-bottom: 10px;">Experiência Profissional</div>
      ${htmlExp}
    </div>

    <!-- FORMAÇÃO -->
    <div style="margin-bottom: 18px;">
      <div style="font-size: 12px; font-weight: bold; color: #1E3A8A; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; margin-bottom: 8px;">Formação Acadêmica</div>
      ${htmlForm}
    </div>

    <!-- HABILIDADES -->
    <div>
      <div style="font-size: 12px; font-weight: bold; color: #1E3A8A; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; margin-bottom: 8px;">Competências e Habilidades</div>
      <div>${htmlHab}</div>
    </div>
  </body>
  </html>
  `;
}

function respostaJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
