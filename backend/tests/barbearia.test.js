const request = require('supertest');
const { app, prisma, validarPrazoCancelamento, verificarSobreposicao } = require('../src/app');
const { seed } = require('../prisma/seed');

describe('Plano de Testes Oficial - Sistema de Barbearia (Seção 10 / CT01 a CT14)', () => {
  let servicoPadrao;
  let barbeiroPadrao;
  let tokenAdmin;
  let tokenClienteExistente;

  beforeAll(async () => {
    await seed();
    servicoPadrao = await prisma.servico.findFirst();
    barbeiroPadrao = await prisma.usuario.findFirst({ where: { tipo: 'BARBEIRO' } });

    const loginAdmin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@barbearia.com', senha: '123456' });
    tokenAdmin = loginAdmin.body.token;

    const loginCli = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gabriel@cliente.com', senha: '123456' });
    tokenClienteExistente = loginCli.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Testes de Unidade das funções de domínio do Diagrama de Classes
  describe('Testes de Unidade (Diagrama de Classes: Agendamento & BloqueioAgenda)', () => {
    test('validarPrazoCancelamento() deve aprovar >= 2h e bloquear < 2h (RN01)', () => {
      const agora = new Date('2026-11-20T10:00:00.000Z');
      const maisDe2h = new Date('2026-11-20T12:30:00.000Z');
      const menosDe2h = new Date('2026-11-20T11:30:00.000Z');

      expect(validarPrazoCancelamento(maisDe2h, agora)).toBe(true);
      expect(validarPrazoCancelamento(menosDe2h, agora)).toBe(false);
    });

    test('verificarSobreposicao() deve detectar colisão de intervalos', () => {
      expect(
        verificarSobreposicao(
          '2026-11-20T14:00:00Z',
          '2026-11-20T14:30:00Z',
          '2026-11-20T14:15:00Z',
          '2026-11-20T14:45:00Z'
        )
      ).toBe(true);

      expect(
        verificarSobreposicao(
          '2026-11-20T14:00:00Z',
          '2026-11-20T14:30:00Z',
          '2026-11-20T14:30:00Z',
          '2026-11-20T15:00:00Z'
        )
      ).toBe(false);
    });
  });

  // CT01: Consultar catálogo sem login (RU01, RN02)
  test('CT01 - Consultar catálogo sem login exibe serviços, preços, fotos, duração e profissionais', async () => {
    const res = await request(app).get('/api/catalogo');
    expect(res.status).toBe(200);
    expect(res.body.servicos.length).toBeGreaterThan(0);
    expect(res.body.profissionais.length).toBeGreaterThan(0);
    expect(res.body.servicos[0]).toHaveProperty('preco');
    expect(res.body.servicos[0]).toHaveProperty('duracaoMinutos');
  });

  // CT04: Cadastro sem aceitar a LGPD (RE01, RNF01.4)
  test('CT04 - Cadastro rápido na confirmação sem aceitar a LGPD é bloqueado com alerta textual', async () => {
    const res = await request(app)
      .post('/api/agendamentos')
      .send({
        servicoId: servicoPadrao.id,
        profissionalId: barbeiroPadrao.id,
        dataHoraInicio: '2026-12-10T10:00:00.000Z',
        clienteDados: {
          nome: 'Cliente Sem LGPD',
          email: 'semlgpd@teste.com',
          telefone: '(35) 99111-2222',
          senha: '123456',
          aceiteLGPD: false,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/LGPD/i);
  });

  // CT02: Agendar como cliente novo via Lazy Registration (CS001, 1A)
  test('CT02 - Agendar como cliente novo (Lazy Registration + consentimento LGPD) cria reserva e devolve comprovante', async () => {
    const res = await request(app)
      .post('/api/agendamentos')
      .send({
        servicoId: servicoPadrao.id,
        profissionalId: barbeiroPadrao.id,
        dataHoraInicio: '2026-12-10T10:00:00.000Z',
        clienteDados: {
          nome: 'Cliente Novo Lazy',
          email: 'clientenovo@teste.com',
          telefone: '(35) 99111-3333',
          senha: '123456',
          aceiteLGPD: true,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.comprovante).toBeDefined();
    expect(res.body.comprovante.codigo).toMatch(/^BRB-/);
    expect(res.body.token).toBeDefined();
  });

  // CT03: Agendar como cliente existente (CS001)
  test('CT03 - Agendar como cliente existente autenticado confirma reserva sem novo cadastro', async () => {
    const res = await request(app)
      .post('/api/agendamentos')
      .set('Authorization', `Bearer ${tokenClienteExistente}`)
      .send({
        servicoId: servicoPadrao.id,
        profissionalId: barbeiroPadrao.id,
        dataHoraInicio: '2026-12-10T11:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.comprovante.agendamento.status).toBe('CONFIRMADO');
  });

  // CT05: Dois clientes reservam o mesmo horário simultaneamente (RNF02.3, 1E)
  test('CT05 - Concorrência: N requisições simultâneas para o mesmo profissional e horário resultam em exatamente 1 reserva', async () => {
    const horarioDisputado = '2026-12-12T15:00:00.000Z';

    // Dispara 5 requisições concorrentes ao mesmo tempo para a mesma vaga
    const promessas = Array.from({ length: 5 }).map((_, i) =>
      request(app)
        .post('/api/agendamentos')
        .set('Authorization', `Bearer ${tokenClienteExistente}`)
        .send({
          servicoId: servicoPadrao.id,
          profissionalId: barbeiroPadrao.id,
          dataHoraInicio: horarioDisputado,
          observacoes: `Tentativa concorrente #${i + 1}`,
        })
    );

    const respostas = await Promise.all(promessas);
    const criadas = respostas.filter((r) => r.status === 201);
    const bloqueadas = respostas.filter((r) => r.status === 409);

    expect(criadas.length).toBe(1);
    expect(bloqueadas.length).toBe(4);
  });

  // CT07 & CT09: Remarcar e Cancelar com 2h ou mais de antecedência (RN01, CS002)
  test('CT09 & CT07 - Remarcar e cancelar agendamento com antecedência >= 2h libera a vaga', async () => {
    const dataFutura = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const novaDataFutura = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

    const criacao = await request(app)
      .post('/api/agendamentos')
      .set('Authorization', `Bearer ${tokenClienteExistente}`)
      .send({
        servicoId: servicoPadrao.id,
        profissionalId: barbeiroPadrao.id,
        dataHoraInicio: dataFutura,
      });

    const agId = criacao.body.comprovante.agendamento.id;

    // CT09: Remarcar com antecedência válida
    const remarcacao = await request(app)
      .patch(`/api/agendamentos/${agId}/remarcar`)
      .set('Authorization', `Bearer ${tokenClienteExistente}`)
      .send({ novaDataHoraInicio: novaDataFutura });

    expect(remarcacao.status).toBe(200);

    // CT07: Cancelar com antecedência >= 2h
    const cancelamento = await request(app)
      .patch(`/api/agendamentos/${agId}/cancelar`)
      .set('Authorization', `Bearer ${tokenClienteExistente}`);

    expect(cancelamento.status).toBe(200);
    expect(cancelamento.body.agendamento.status).toBe('CANCELADO');
  });

  // CT08: Cancelar com menos de 2h de antecedência (RN01, 1E)
  test('CT08 - Cancelar com menos de 2h bloqueia a ação e exibe mensagem orientando contato telefônico', async () => {
    // Cria agendamento para daqui a 45 minutos (< 2 horas)
    const daqui45Min = new Date(Date.now() + 45 * 60 * 1000).toISOString();

    const criacao = await request(app)
      .post('/api/agendamentos')
      .set('Authorization', `Bearer ${tokenClienteExistente}`)
      .send({
        servicoId: servicoPadrao.id,
        profissionalId: barbeiroPadrao.id,
        dataHoraInicio: daqui45Min,
      });

    const agId = criacao.body.comprovante.agendamento.id;

    const tentativa = await request(app)
      .patch(`/api/agendamentos/${agId}/cancelar`)
      .set('Authorization', `Bearer ${tokenClienteExistente}`);

    expect(tentativa.status).toBe(422);
    expect(tentativa.body.erro).toBe(
      'Cancelamentos com menos de 2h de antecedência devem ser tratados diretamente pelo telefone da barbearia'
    );
  });

  // CT10: Bloquear horário de profissional (RF02)
  test('CT10 - Bloquear horário de profissional no painel admin retira o horário da grade do cliente', async () => {
    const resBloq = await request(app)
      .post('/api/admin/bloqueios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        profissionalId: barbeiroPadrao.id,
        dataHoraInicio: '2026-12-15T12:00:00.000Z',
        dataHoraFim: '2026-12-15T13:00:00.000Z',
        motivo: 'Almoço Equipe',
      });

    expect(resBloq.status).toBe(201);

    // Tentativa de agendar exatamente no horário bloqueado deve retornar 409
    const tentativaReserva = await request(app)
      .post('/api/agendamentos')
      .set('Authorization', `Bearer ${tokenClienteExistente}`)
      .send({
        servicoId: servicoPadrao.id,
        profissionalId: barbeiroPadrao.id,
        dataHoraInicio: '2026-12-15T12:00:00.000Z',
      });

    expect(tentativaReserva.status).toBe(409);
  });

  // CT11: Acessar painel admin sem token ou com token inválido (RNF02.2)
  test('CT11 - Acessar painel admin sem token/expirado retorna 401 Acesso Negado', async () => {
    const resSemToken = await request(app).get('/api/admin/calendario');
    expect(resSemToken.status).toBe(401);

    const resTokenInvalido = await request(app)
      .get('/api/admin/calendario')
      .set('Authorization', 'Bearer token.invalido.expirado');
    expect(resTokenInvalido.status).toBe(401);
  });

  // CT12: Calendário administrativo com cores e rótulos por status em até 1 s (RNF02.1, RNF02.4)
  test('CT12 - Calendário administrativo retorna blocos com cores e rótulos por status em menos de 1000 ms', async () => {
    const res = await request(app)
      .get('/api/admin/calendario')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.tempoProcessamentoMs).toBeLessThanOrEqual(1000);
    expect(res.body.blocos.length).toBeGreaterThan(0);
    expect(res.body.blocos[0]).toHaveProperty('corHex');
    expect(res.body.blocos[0]).toHaveProperty('rotuloStatus');
    expect(res.headers['x-renewed-token']).toBeDefined();
  });

  // CT13: Solicitar exclusão definitiva de dados pessoais (RE01 - LGPD)
  test('CT13 - Solicitar exclusão de dados pessoais remove definitivamente o titular do banco (LGPD)', async () => {
    const cad = await request(app)
      .post('/api/auth/register')
      .send({
        nome: 'Titular LGPD Exclusao',
        email: 'excluir.lgpd@teste.com',
        telefone: '(35) 99000-9999',
        senha: '123456',
        aceiteLGPD: true,
      });

    expect(cad.status).toBe(201);
    const tokenTitular = cad.body.token;
    const idTitular = cad.body.usuario.id;

    const del = await request(app)
      .delete('/api/usuarios/me')
      .set('Authorization', `Bearer ${tokenTitular}`);

    expect(del.status).toBe(200);

    const buscaNoBanco = await prisma.usuario.findUnique({ where: { id: idTitular } });
    expect(buscaNoBanco).toBeNull();
  });

  // CT14: Carga de 100 requisições simultâneas na consulta de horários em até 500 ms (RNF01.1)
  test('CT14 - Teste de carga: 100 requisições simultâneas na consulta de horários com resposta média <= 500 ms', async () => {
    const promessas = Array.from({ length: 100 }).map(() =>
      request(app).get('/api/horarios-disponiveis?data=2026-12-20')
    );

    const respostas = await Promise.all(promessas);
    const todasOk = respostas.every((r) => r.status === 200);
    const temposInternos = respostas.map((r) => r.body.tempoProcessamentoMs);
    const maiorTempoInterno = Math.max(...temposInternos);

    expect(todasOk).toBe(true);
    expect(maiorTempoInterno).toBeLessThanOrEqual(500);
  });
});
