import assert from "node:assert/strict";
import test from "node:test";
import { parseReelBrief } from "./instagramPublisher.js";

const validRaw = {
  gancho: "Você sabe quanto perde por falta de controle?",
  roteiro: "Cliente, ordem de serviço, peças e informações espalhadas viram retrabalho. Com o NextAssist você organiza tudo em um só lugar.",
  textoTela: ["Ordem de serviço organizada", "Cliente acompanha o status", "Menos retrabalho"],
  cta: "Teste o NextAssist grátis por sete dias.",
  pergunta: "Você já perdeu uma peça por falta de controle?",
  blocos: [
    "E o melhor: seu cliente acompanha o andamento sem ficar perguntando toda hora.",
    "Cliente, ordem de serviço e peças espalhadas viram retrabalho.",
    "Com o NextAssist você organiza tudo em um só lugar.",
    "Você reduz retrabalho e ganha uma experiência mais profissional.",
    "Do atendimento ao fechamento, tudo fica centralizado no NextAssist.",
  ],
};

test("parseReelBrief aceita um roteiro completo com os 5 blocos exigidos pelo Studio multi-cena", () => {
  const brief = parseReelBrief(validRaw);
  assert.equal(brief.gancho, validRaw.gancho);
  assert.deepEqual(brief.blocos, validRaw.blocos);
  assert.equal(brief.textoTela.length, 3);
});

test("parseReelBrief rejeita quando faltam blocos", () => {
  assert.throws(() => parseReelBrief({ ...validRaw, blocos: undefined }), /blocos/);
});

test("parseReelBrief rejeita quando blocos não tem exatamente 5 itens", () => {
  assert.throws(() => parseReelBrief({ ...validRaw, blocos: validRaw.blocos.slice(0, 3) }), /blocos/);
  assert.throws(() => parseReelBrief({ ...validRaw, blocos: [...validRaw.blocos, "extra"] }), /blocos/);
});

test("parseReelBrief filtra blocos em branco antes de contar — string vazia não conta como bloco válido", () => {
  assert.throws(() => parseReelBrief({ ...validRaw, blocos: [...validRaw.blocos.slice(0, 4), "   "] }), /blocos/);
});

test("parseReelBrief mantém as validações existentes (gancho/roteiro/textoTela/cta/pergunta)", () => {
  assert.throws(() => parseReelBrief({ ...validRaw, gancho: "" }), /incompleto/);
  assert.throws(() => parseReelBrief({ ...validRaw, textoTela: ["só uma"] }), /incompleto/);
});
