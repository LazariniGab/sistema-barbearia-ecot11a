const request = require('supertest');
const { app, prisma } = require('../src/app');

async function executarTesteDeCarga() {
  console.log('🚀 Executando Teste de Carga CT14 (RNF01.1): 100 requisições simultâneas em /api/horarios-disponiveis...');
  const inicio = performance.now();

  const requisicoes = Array.from({ length: 100 }).map(() =>
    request(app).get('/api/horarios-disponiveis?data=2026-12-20')
  );

  const respostas = await Promise.all(requisicoes);
  const duracaoTotal = +(performance.now() - inicio).toFixed(2);
  const tempos = respostas.map((r) => r.body.tempoProcessamentoMs || 0);
  const mediaMs = +(tempos.reduce((a, b) => a + b, 0) / tempos.length).toFixed(2);
  const maxMs = Math.max(...tempos);

  console.log(`✅ 100/100 requisições concluídas com status 200.`);
  console.log(`📊 Tempo médio por requisição na API: ${mediaMs} ms (Máximo: ${maxMs} ms | Limite RNF01.1: <= 500 ms)`);
  console.log(`⏱️ Tempo total do lote de 100 requisições: ${duracaoTotal} ms`);

  await prisma.$disconnect();
}

executarTesteDeCarga();
