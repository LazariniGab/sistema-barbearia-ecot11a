const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'ecot11a-unifei-barbearia-jwt-secret-2026';

app.use(cors({ exposedHeaders: ['X-Renewed-Token'] }));
app.use(express.json());

// ============================================================================
// 1. SERVIÇO EXTERNO DE NOTIFICAÇÕES (Figura 5 - Modelo de Contexto / RE01)
// ============================================================================
async function dispararNotificacao({ destinatario, telefone, tipo, assunto, mensagem }) {
  try {
    return await prisma.notificacaoLog.create({
      data: {
        destinatario,
        telefone: telefone || '',
        tipo,
        assunto,
        mensagem,
        canal: 'EMAIL_SMS_GATEWAY',
      },
    });
  } catch (err) {
    console.error('Erro ao registrar notificação externa:', err.message);
    return null;
  }
}

// ============================================================================
// 2. MIDDLEWARES DE AUTENTICAÇÃO E RENOVAÇÃO AUTOMÁTICA (RNF02.2 - 60 min)
// ============================================================================
function gerarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tipo: usuario.tipo,
    },
    JWT_SECRET,
    { expiresIn: '60m' } // RNF02.2: Token expira em 60 minutos
  );
}

function autenticarJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de autenticação ausente ou inválido (RNF02.2).' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;

    // RNF02.2: Renovação automática de token na sessão ativa
    const novoToken = gerarToken(payload);
    res.setHeader('X-Renewed-Token', novoToken);
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou token inválido. Faça login novamente.' });
  }
}

function exigirPerfilAdminOuBarbeiro(req, res, next) {
  if (!req.usuario || (req.usuario.tipo !== 'ADMIN' && req.usuario.tipo !== 'BARBEIRO')) {
    return res.status(403).json({ erro: 'Acesso restrito à equipe interna (Administrador/Barbeiro).' });
  }
  next();
}

// ============================================================================
// 3. FUNÇÕES DE DOMÍNIO E REGRAS DE NEGÓCIO (Diagrama de Classes - Figura 2)
// ============================================================================

/**
 * Método validarPrazoCancelamento() da classe Agendamento (RN01)
 * Verifica se há pelo menos 2 horas de antecedência em relação ao início.
 */
function validarPrazoCancelamento(dataHoraInicio, agora = new Date()) {
  const inicioMs = new Date(dataHoraInicio).getTime();
  const agoraMs = new Date(agora).getTime();
  const diferencaHoras = (inicioMs - agoraMs) / (1000 * 60 * 60);
  return diferencaHoras >= 2.0;
}

/**
 * Método verificarSobreposicao() da classe BloqueioAgenda
 * Verifica se dois intervalos [inicioA, fimA) e [inicioB, fimB) se sobrepõem.
 */
function verificarSobreposicao(inicioA, fimA, inicioB, fimB) {
  const a0 = new Date(inicioA).getTime();
  const a1 = new Date(fimA).getTime();
  const b0 = new Date(inicioB).getTime();
  const b1 = new Date(fimB).getTime();
  return a0 < b1 && a1 > b0;
}

// ============================================================================
// 4. ROTAS PÚBLICAS DE CATÁLOGO E DISPONIBILIDADE (RU01, RN02, RNF01.1)
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    sistema: 'Sistema de Agendamento e Gestão para Barbearia - UNIFEI ECOT11A',
    seguranca: { tls: 'TLS 1.3 Ready', hash: 'bcrypt', jwtExpiration: '60m' },
  });
});

// RU01 / RN02: Catálogo público sem necessidade de login
app.get('/api/catalogo', async (req, res) => {
  try {
    const [servicos, profissionais] = await Promise.all([
      prisma.servico.findMany({
        where: { ativo: true },
        orderBy: { preco: 'asc' },
      }),
      prisma.usuario.findMany({
        where: {
          tipo: { in: ['BARBEIRO', 'ADMIN'] },
          ativo: true,
        },
        select: {
          id: true,
          nome: true,
          especialidade: true,
          horaInicioTurno: true,
          horaFimTurno: true,
          fotoUrl: true,
          tipo: true,
        },
        orderBy: { nome: 'asc' },
      }),
    ]);

    res.json({ servicos, profissionais });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar o catálogo público.', detalhes: err.message });
  }
});

// RNF01.1 e CS001 (incluindo Fluxo Alternativo 2A - "Qualquer Profissional")
// Consulta de horários disponíveis otimizada (< 500 ms sob 100 requisições)
app.get('/api/horarios-disponiveis', async (req, res) => {
  const inicioReq = performance.now();
  try {
    const { data, profissionalId, servicoId } = req.query;
    if (!data) {
      return res.status(400).json({ erro: 'O parâmetro data (YYYY-MM-DD) é obrigatório.' });
    }

    const servico = servicoId
      ? await prisma.servico.findUnique({ where: { id: Number(servicoId) } })
      : null;
    const duracaoMinutos = servico ? servico.duracaoMinutos : 30;

    // Filtro de profissionais: específico ou "qualquer" (CS001 - 2A)
    const filtroProfissional =
      profissionalId && profissionalId !== 'qualquer'
        ? { id: Number(profissionalId), ativo: true }
        : { tipo: { in: ['BARBEIRO', 'ADMIN'] }, ativo: true };

    const profissionais = await prisma.usuario.findMany({
      where: filtroProfissional,
      select: {
        id: true,
        nome: true,
        especialidade: true,
        horaInicioTurno: true,
        horaFimTurno: true,
        fotoUrl: true,
      },
    });

    if (profissionais.length === 0) {
      return res.json({ data, slots: [], tempoProcessamentoMs: +(performance.now() - inicioReq).toFixed(2) });
    }

    const inicioDia = new Date(`${data}T00:00:00.000Z`);
    const fimDia = new Date(`${data}T23:59:59.999Z`);
    // Margem ampla para fuso horário local
    const rangeStart = new Date(inicioDia.getTime() - 12 * 3600 * 1000);
    const rangeEnd = new Date(fimDia.getTime() + 12 * 3600 * 1000);

    const profIds = profissionais.map((p) => p.id);

    const [agendamentosAtivos, bloqueios] = await Promise.all([
      prisma.agendamento.findMany({
        where: {
          profissionalId: { in: profIds },
          status: { in: ['CONFIRMADO', 'EM_ATENDIMENTO'] },
          dataHoraInicio: { gte: rangeStart, lte: rangeEnd },
        },
        select: { profissionalId: true, dataHoraInicio: true, dataHoraFim: true },
      }),
      prisma.bloqueioAgenda.findMany({
        where: {
          profissionalId: { in: profIds },
          dataHoraInicio: { lte: rangeEnd },
          dataHoraFim: { gte: rangeStart },
        },
        select: { profissionalId: true, dataHoraInicio: true, dataHoraFim: true, motivo: true },
      }),
    ]);

    // Gera grade de 30 em 30 minutos no horário local do dia solicitado
    const [ano, mes, dia] = data.split('-').map(Number);
    const mapaSlots = new Map();

    for (const prof of profissionais) {
      const [hIni, mIni] = (prof.horaInicioTurno || '09:00').split(':').map(Number);
      const [hFim, mFim] = (prof.horaFimTurno || '19:00').split(':').map(Number);

      const minutosInicioTurno = hIni * 60 + mIni;
      const minutosFimTurno = hFim * 60 + mFim;

      for (let min = minutosInicioTurno; min + duracaoMinutos <= minutosFimTurno; min += 30) {
        const hora = Math.floor(min / 60);
        const minuto = min % 60;
        const horaStr = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;

        const slotInicio = new Date(ano, mes - 1, dia, hora, minuto, 0, 0);
        const slotFim = new Date(slotInicio.getTime() + duracaoMinutos * 60 * 1000);

        // Verifica conflito com agendamentos ativos deste profissional
        const conflitoAgendamento = agendamentosAtivos.some(
          (ag) =>
            ag.profissionalId === prof.id &&
            verificarSobreposicao(slotInicio, slotFim, ag.dataHoraInicio, ag.dataHoraFim)
        );

        // Verifica conflito com bloqueios (almoço/folga) deste profissional
        const conflitoBloqueio = bloqueios.some(
          (bl) =>
            bl.profissionalId === prof.id &&
            verificarSobreposicao(slotInicio, slotFim, bl.dataHoraInicio, bl.dataHoraFim)
        );

        const disponivel = !conflitoAgendamento && !conflitoBloqueio;

        if (!mapaSlots.has(horaStr)) {
          mapaSlots.set(horaStr, {
            horario: horaStr,
            dataHoraInicio: slotInicio.toISOString(),
            dataHoraFim: slotFim.toISOString(),
            disponivel: false,
            profissionaisDisponiveis: [],
          });
        }

        if (disponivel) {
          const item = mapaSlots.get(horaStr);
          item.disponivel = true;
          item.profissionaisDisponiveis.push({
            id: prof.id,
            nome: prof.nome,
            especialidade: prof.especialidade,
          });
        }
      }
    }

    const slots = Array.from(mapaSlots.values()).sort((a, b) => a.horario.localeCompare(b.horario));
    const tempoProcessamentoMs = +(performance.now() - inicioReq).toFixed(2);

    res.json({
      data,
      duracaoMinutos,
      tempoProcessamentoMs,
      slots,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao consultar horários disponíveis.', detalhes: err.message });
  }
});

// ============================================================================
// 5. AUTENTICAÇÃO, LAZY REGISTRATION E LGPD (RN02, RNF01.2, RNF02.2, RE01)
// ============================================================================

// Cadastro de usuário (usado no Lazy Registration - CS001 1A ou tela de cadastro)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { nome, email, telefone, senha, aceiteLGPD } = req.body;

    // RNF01.4: Alertas textuais claros para campos obrigatórios vazios
    if (!nome || !email || !telefone || !senha) {
      return res.status(400).json({
        erro: 'Campos obrigatórios não preenchidos: informe nome completo, e-mail, telefone e senha.',
      });
    }

    // RE01 (LGPD): Cadastro impossível sem consentimento explícito
    if (aceiteLGPD !== true) {
      return res.status(400).json({
        erro: 'Consentimento LGPD obrigatório (Lei nº 13.709/2018): você deve autorizar o uso de e-mail e telefone para notificações da reserva.',
      });
    }

    const emailNormalizado = String(email).trim().toLowerCase();
    const existente = await prisma.usuario.findUnique({ where: { email: emailNormalizado } });
    if (existente) {
      return res.status(409).json({
        erro: 'Já existe uma conta cadastrada com este e-mail. Faça login para continuar.',
      });
    }

    // RNF01.2: Hash seguro com algoritmo bcrypt
    const hashSenha = await bcrypt.hash(String(senha), 10);

    const usuario = await prisma.usuario.create({
      data: {
        nome: String(nome).trim(),
        email: emailNormalizado,
        telefone: String(telefone).trim(),
        hashSenha,
        tipo: 'CLIENTE',
        aceiteLGPD: true,
        dataConsentimento: new Date(),
      },
    });

    const token = gerarToken(usuario);
    res.status(201).json({
      mensagem: 'Cadastro realizado com sucesso sob conformidade LGPD.',
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        telefone: usuario.telefone,
        tipo: usuario.tipo,
        aceiteLGPD: usuario.aceiteLGPD,
        dataConsentimento: usuario.dataConsentimento,
      },
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno no cadastro.', detalhes: err.message });
  }
});

// Login (Usuario.autenticar(email, senha) do Diagrama de Classes)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ erro: 'Informe o e-mail e a senha para autenticar.' });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email: String(email).trim().toLowerCase() },
    });

    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ erro: 'Credenciais inválidas ou usuário não encontrado.' });
    }

    const senhaValida = await bcrypt.compare(String(senha), usuario.hashSenha);
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Credenciais inválidas (senha incorreta).' });
    }

    const token = gerarToken(usuario);
    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        telefone: usuario.telefone,
        tipo: usuario.tipo,
        especialidade: usuario.especialidade,
        aceiteLGPD: usuario.aceiteLGPD,
      },
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao realizar login.', detalhes: err.message });
  }
});

// Renovação explícita ou verificação de sessão (RNF02.2)
app.post('/api/auth/refresh', autenticarJWT, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
  if (!usuario) {
    return res.status(401).json({ erro: 'Usuário não encontrado.' });
  }
  const token = gerarToken(usuario);
  res.json({
    token,
    expiraEmMinutos: 60,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      telefone: usuario.telefone,
      tipo: usuario.tipo,
    },
  });
});

// Perfil do usuário logado (Edição de perfil - Nível Intermediário + Exclusão LGPD - RE01)
app.get('/api/usuarios/me', autenticarJWT, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuario.id },
    select: {
      id: true,
      nome: true,
      email: true,
      telefone: true,
      tipo: true,
      aceiteLGPD: true,
      dataConsentimento: true,
      especialidade: true,
      horaInicioTurno: true,
      horaFimTurno: true,
      criadoEm: true,
    },
  });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json(usuario);
});

app.put('/api/usuarios/me', autenticarJWT, async (req, res) => {
  try {
    const { nome, telefone, senhaNova } = req.body;
    if (!nome || !telefone) {
      return res.status(400).json({ erro: 'Nome e telefone são obrigatórios.' });
    }

    const dadosAtualizacao = {
      nome: String(nome).trim(),
      telefone: String(telefone).trim(),
    };

    if (senhaNova && String(senhaNova).trim().length >= 4) {
      dadosAtualizacao.hashSenha = await bcrypt.hash(String(senhaNova), 10);
    }

    const atualizado = await prisma.usuario.update({
      where: { id: req.usuario.id },
      data: dadosAtualizacao,
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        tipo: true,
        aceiteLGPD: true,
        dataConsentimento: true,
      },
    });

    res.json({ mensagem: 'Perfil atualizado com sucesso.', usuario: atualizado });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar perfil.', detalhes: err.message });
  }
});

// RE01 / CT13: Exclusão definitiva dos dados pessoais sob solicitação do titular (LGPD)
app.delete('/api/usuarios/me', autenticarJWT, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário já removido ou inexistente.' });
    }

    await prisma.$transaction([
      prisma.agendamento.deleteMany({ where: { clienteId: usuario.id } }),
      prisma.usuario.delete({ where: { id: usuario.id } }),
    ]);

    await dispararNotificacao({
      destinatario: 'auditoria-lgpd@barbearia.com',
      telefone: '',
      tipo: 'EXCLUSAO_LGPD',
      assunto: 'Exclusão Definitiva de Dados Pessoais (RE01 - LGPD)',
      mensagem: `Os dados pessoais do titular ID #${usuario.id} foram definitivamente eliminados do banco de dados conforme Art. 18 da Lei nº 13.709/2018.`,
    });

    res.json({
      mensagem: 'Seus dados pessoais e histórico foram excluídos definitivamente do banco de dados (Conformidade LGPD - RE01).',
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir dados pessoais.', detalhes: err.message });
  }
});

// ============================================================================
// 6. AGENDAMENTOS: RESERVA ATÔMICA, CANCELAMENTO E REMARCAÇÃO (CS001, CS002)
// ============================================================================

// Filas de mutex em memória combinadas com transação e restrição UNIQUE no banco
// para garantir atomicidade absoluta sob alta concorrência (RNF02.3 / CT05)
let reservaLock = Promise.resolve();
function executarComLockAtomico(fn) {
  const proximo = reservaLock.then(() => fn());
  reservaLock = proximo.catch(() => {});
  return proximo;
}

// CS001: Criar agendamento (suporta cliente já logado OU Lazy Registration no mesmo passo)
app.post('/api/agendamentos', async (req, res) => {
  try {
    let usuarioAutenticado = null;

    // 1. Verifica se já enviou token JWT
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        usuarioAutenticado = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      } catch (_) {
        usuarioAutenticado = null;
      }
    }

    const {
      servicoId,
      profissionalId,
      dataHoraInicio,
      observacoes,
      // Dados para Lazy Registration / Login na confirmação (RN02 / CS001 Passo 4)
      clienteDados,
    } = req.body;

    if (!servicoId || !profissionalId || !dataHoraInicio) {
      return res.status(400).json({
        erro: 'Selecione o serviço, o profissional e a data/horário desejados (RNF01.4).',
      });
    }

    let tokenGerado = null;
    let clienteFinal = null;

    // 2. Se não está autenticado via JWT, processa o Lazy Registration / Login (RN02)
    if (!usuarioAutenticado) {
      if (!clienteDados || !clienteDados.email) {
        return res.status(401).json({
          erro: 'Identificação necessária para confirmar o agendamento (Lazy Registration - RN02).',
        });
      }

      const emailNorm = String(clienteDados.email).trim().toLowerCase();
      const existente = await prisma.usuario.findUnique({ where: { email: emailNorm } });

      if (existente) {
        // Cliente já possui cadastro -> autentica com senha (CS001 / CT03)
        if (!clienteDados.senha) {
          return res.status(401).json({
            erro: 'E-mail já cadastrado. Informe sua senha para confirmar o agendamento.',
          });
        }
        const ok = await bcrypt.compare(String(clienteDados.senha), existente.hashSenha);
        if (!ok) {
          return res.status(401).json({ erro: 'Senha incorreta para o e-mail informado.' });
        }
        clienteFinal = existente;
      } else {
        // CS001 - 1A (Primeiro acesso): Cadastro rápido + Validação LGPD (RE01 / CT02 / CT04)
        if (!clienteDados.nome || !clienteDados.telefone) {
          return res.status(400).json({
            erro: 'Para primeiro acesso, informe nome completo, telefone e e-mail (RNF01.4).',
          });
        }
        if (clienteDados.aceiteLGPD !== true) {
          return res.status(400).json({
            erro: 'Operação bloqueada: é obrigatório aceitar o termo de consentimento LGPD (RE01) para notificações da reserva.',
          });
        }

        const hashSenha = await bcrypt.hash(String(clienteDados.senha || '123456'), 10);
        clienteFinal = await prisma.usuario.create({
          data: {
            nome: String(clienteDados.nome).trim(),
            email: emailNorm,
            telefone: String(clienteDados.telefone).trim(),
            hashSenha,
            tipo: 'CLIENTE',
            aceiteLGPD: true,
            dataConsentimento: new Date(),
          },
        });
      }
      tokenGerado = gerarToken(clienteFinal);
    } else {
      clienteFinal = await prisma.usuario.findUnique({ where: { id: usuarioAutenticado.id } });
      if (!clienteFinal) {
        return res.status(401).json({ erro: 'Usuário da sessão não encontrado.' });
      }
      tokenGerado = gerarToken(clienteFinal);
    }

    // 3. Executa a transação atômica de reserva (RNF02.3 / CS001 - 1E / CT05)
    const resultado = await executarComLockAtomico(async () => {
      return await prisma.$transaction(async (tx) => {
        const servico = await tx.servico.findUnique({ where: { id: Number(servicoId) } });
        if (!servico) {
          const err = new Error('Serviço selecionado não encontrado.');
          err.status = 404;
          throw err;
        }

        let idProfEscolhido = Number(profissionalId);
        const inicioDt = new Date(dataHoraInicio);
        const fimDt = new Date(inicioDt.getTime() + servico.duracaoMinutos * 60 * 1000);

        // Verifica bloqueios de agenda do profissional
        const bloqueios = await tx.bloqueioAgenda.findMany({
          where: {
            profissionalId: idProfEscolhido,
            dataHoraInicio: { lt: fimDt },
            dataHoraFim: { gt: inicioDt },
          },
        });

        if (bloqueios.length > 0) {
          const err = new Error(
            `Horário indisponível: o profissional possui um bloqueio (${bloqueios[0].motivo}) nesta faixa de horário.`
          );
          err.status = 409;
          throw err;
        }

        // Verifica sobreposição com qualquer agendamento ativo do mesmo profissional
        const agendamentosConflitantes = await tx.agendamento.findMany({
          where: {
            profissionalId: idProfEscolhido,
            status: { in: ['CONFIRMADO', 'EM_ATENDIMENTO'] },
            dataHoraInicio: { lt: fimDt },
            dataHoraFim: { gt: inicioDt },
          },
        });

        if (agendamentosConflitantes.length > 0) {
          const err = new Error(
            'Conflito de horário concorrente (1E): outro cliente acabou de reservar este horário. Por favor, escolha outro horário disponível.'
          );
          err.status = 409;
          throw err;
        }

        const slotAtivoKey = `${idProfEscolhido}_${inicioDt.toISOString()}`;

        const novoAgendamento = await tx.agendamento.create({
          data: {
            clienteId: clienteFinal.id,
            profissionalId: idProfEscolhido,
            servicoId: servico.id,
            dataHoraInicio: inicioDt,
            dataHoraFim: fimDt,
            status: 'CONFIRMADO',
            slotAtivoKey,
            observacoes: observacoes || null,
          },
          include: {
            servico: true,
            profissional: {
              select: { id: true, nome: true, especialidade: true, telefone: true },
            },
            cliente: {
              select: { id: true, nome: true, email: true, telefone: true },
            },
          },
        });

        return novoAgendamento;
      });
    });

    // Dispara notificação externa (RE01 / Figura 5)
    await dispararNotificacao({
      destinatario: resultado.cliente.email,
      telefone: resultado.cliente.telefone,
      tipo: 'CONFIRMACAO',
      assunto: `Comprovante de Agendamento #${resultado.id} - Barbearia`,
      mensagem: `Olá ${resultado.cliente.nome}! Seu agendamento de ${resultado.servico.nome} com ${resultado.profissional.nome} foi confirmado para ${new Date(resultado.dataHoraInicio).toLocaleString('pt-BR')}. Pagamento presencial (RN03).`,
    });

    return res.status(201).json({
      mensagem: 'Reserva confirmada com sucesso! Pagamento presencial no estabelecimento (RN03).',
      comprovante: {
        codigo: `BRB-${String(resultado.id).padStart(5, '0')}`,
        agendamento: resultado,
        pagamento: 'Presencial no estabelecimento (RN03)',
      },
      token: tokenGerado,
      usuario: {
        id: clienteFinal.id,
        nome: clienteFinal.nome,
        email: clienteFinal.email,
        telefone: clienteFinal.telefone,
        tipo: clienteFinal.tipo,
      },
    });
  } catch (err) {
    if (err.status === 409 || err.code === 'P2002') {
      return res.status(409).json({
        erro:
          err.message && err.status === 409
            ? err.message
            : 'Conflito de horário concorrente (1E): outro cliente acabou de reservar este horário. Os horários disponíveis foram atualizados.',
      });
    }
    if (err.status) {
      return res.status(err.status).json({ erro: err.message });
    }
    res.status(500).json({ erro: 'Erro ao processar reserva.', detalhes: err.message });
  }
});

// Listar "Meus Agendamentos" do cliente logado (RU04 / CS002)
app.get('/api/meus-agendamentos', autenticarJWT, async (req, res) => {
  try {
    const agendamentos = await prisma.agendamento.findMany({
      where: { clienteId: req.usuario.id },
      include: {
        servico: true,
        profissional: {
          select: { id: true, nome: true, especialidade: true, fotoUrl: true },
        },
      },
      orderBy: { dataHoraInicio: 'asc' },
    });

    // Calcula se cada agendamento pode ser cancelado/remarcado (>= 2h - RN01)
    const agora = new Date();
    const enriquecidos = agendamentos.map((ag) => ({
      ...ag,
      podeCancelarOuRemarcar:
        ag.status === 'CONFIRMADO' && validarPrazoCancelamento(ag.dataHoraInicio, agora),
    }));

    res.json(enriquecidos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar agendamentos do cliente.', detalhes: err.message });
  }
});

// CS002 (Fluxo Principal + Exceção 1E): Cancelar agendamento (RN01 - mínimo 2h)
app.patch('/api/agendamentos/:id/cancelar', autenticarJWT, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const agendamento = await prisma.agendamento.findUnique({
      where: { id },
      include: { servico: true, profissional: true, cliente: true },
    });

    if (!agendamento) {
      return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }

    const isEquipe = req.usuario.tipo === 'ADMIN' || req.usuario.tipo === 'BARBEIRO';
    if (!isEquipe && agendamento.clienteId !== req.usuario.id) {
      return res.status(403).json({ erro: 'Você não tem permissão para cancelar este agendamento.' });
    }

    // Regra de Negócio RN01 (aplica-se ao cliente; admin pode gerir a agenda)
    if (!isEquipe && !validarPrazoCancelamento(agendamento.dataHoraInicio)) {
      return res.status(422).json({
        erro: 'Cancelamentos com menos de 2h de antecedência devem ser tratados diretamente pelo telefone da barbearia',
        codigoRegra: 'RN01_PRAZO_VIOLADO',
      });
    }

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: {
        status: 'CANCELADO',
        slotAtivoKey: null, // Libera a vaga para novas reservas!
      },
      include: { servico: true, profissional: true, cliente: true },
    });

    await dispararNotificacao({
      destinatario: atualizado.cliente.email,
      telefone: atualizado.cliente.telefone,
      tipo: 'CANCELAMENTO',
      assunto: `Cancelamento do Agendamento #${atualizado.id}`,
      mensagem: `Seu agendamento de ${atualizado.servico.nome} foi cancelado com sucesso e o horário foi liberado na agenda.`,
    });

    res.json({
      mensagem: 'Agendamento cancelado com sucesso e vaga liberada na agenda.',
      agendamento: atualizado,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao cancelar agendamento.', detalhes: err.message });
  }
});

// CS002 (Fluxo Alternativo 1A + Exceção 1E): Remarcar agendamento (RN01 - mínimo 2h)
app.patch('/api/agendamentos/:id/remarcar', autenticarJWT, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { novaDataHoraInicio } = req.body;

    if (!novaDataHoraInicio) {
      return res.status(400).json({ erro: 'Informe a nova data e horário para a remarcação.' });
    }

    const agendamentoAtual = await prisma.agendamento.findUnique({
      where: { id },
      include: { servico: true, profissional: true, cliente: true },
    });

    if (!agendamentoAtual) {
      return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }

    const isEquipe = req.usuario.tipo === 'ADMIN' || req.usuario.tipo === 'BARBEIRO';
    if (!isEquipe && agendamentoAtual.clienteId !== req.usuario.id) {
      return res.status(403).json({ erro: 'Você não tem permissão para remarcar este agendamento.' });
    }

    // Verifica antecedência mínima de 2 horas (RN01)
    if (!isEquipe && !validarPrazoCancelamento(agendamentoAtual.dataHoraInicio)) {
      return res.status(422).json({
        erro: 'Cancelamentos com menos de 2h de antecedência devem ser tratados diretamente pelo telefone da barbearia',
        codigoRegra: 'RN01_PRAZO_VIOLADO',
      });
    }

    const novoInicio = new Date(novaDataHoraInicio);
    const novoFim = new Date(
      novoInicio.getTime() + agendamentoAtual.servico.duracaoMinutos * 60 * 1000
    );

    const atualizado = await executarComLockAtomico(async () => {
      return await prisma.$transaction(async (tx) => {
        // Verifica conflitos no novo horário do mesmo profissional
        const conflitos = await tx.agendamento.findMany({
          where: {
            id: { not: id },
            profissionalId: agendamentoAtual.profissionalId,
            status: { in: ['CONFIRMADO', 'EM_ATENDIMENTO'] },
            dataHoraInicio: { lt: novoFim },
            dataHoraFim: { gt: novoInicio },
          },
        });

        if (conflitos.length > 0) {
          const err = new Error('O novo horário escolhido já está ocupado para este profissional.');
          err.status = 409;
          throw err;
        }

        const bloqueios = await tx.bloqueioAgenda.findMany({
          where: {
            profissionalId: agendamentoAtual.profissionalId,
            dataHoraInicio: { lt: novoFim },
            dataHoraFim: { gt: novoInicio },
          },
        });

        if (bloqueios.length > 0) {
          const err = new Error('O profissional possui um bloqueio no novo horário escolhido.');
          err.status = 409;
          throw err;
        }

        const novoSlotKey = `${agendamentoAtual.profissionalId}_${novoInicio.toISOString()}`;

        return await tx.agendamento.update({
          where: { id },
          data: {
            dataHoraInicio: novoInicio,
            dataHoraFim: novoFim,
            status: 'CONFIRMADO',
            slotAtivoKey: novoSlotKey,
          },
          include: {
            servico: true,
            profissional: { select: { id: true, nome: true, especialidade: true } },
            cliente: { select: { id: true, nome: true, email: true, telefone: true } },
          },
        });
      });
    });

    await dispararNotificacao({
      destinatario: atualizado.cliente.email,
      telefone: atualizado.cliente.telefone,
      tipo: 'REMARCACAO',
      assunto: `Agendamento Remarcado #${atualizado.id}`,
      mensagem: `Seu agendamento de ${atualizado.servico.nome} com ${atualizado.profissional.nome} foi remarcado para ${new Date(atualizado.dataHoraInicio).toLocaleString('pt-BR')}. O horário anterior foi liberado.`,
    });

    res.json({
      mensagem: 'Horário remarcado com sucesso! O horário anterior foi liberado.',
      agendamento: atualizado,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ erro: err.message });
    }
    res.status(500).json({ erro: 'Erro ao remarcar agendamento.', detalhes: err.message });
  }
});

// ============================================================================
// 7. PAINEL ADMINISTRATIVO E GESTÃO DE AGENDA (RU05, RF02, RNF02.1 a RNF02.4)
// ============================================================================

// Calendário Diário / Semanal com cores e status (Confirmado, Bloqueado, Atendido/Concluído)
app.get('/api/admin/calendario', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  const t0 = performance.now();
  try {
    const { dataInicio, dataFim, profissionalId } = req.query;

    const filtroData = {};
    if (dataInicio && dataFim) {
      filtroData.gte = new Date(`${dataInicio}T00:00:00.000Z`);
      filtroData.lte = new Date(`${dataFim}T23:59:59.999Z`);
    }

    const filtroProf = profissionalId ? { profissionalId: Number(profissionalId) } : {};

    const [agendamentos, bloqueios, profissionais] = await Promise.all([
      prisma.agendamento.findMany({
        where: {
          ...filtroProf,
          ...(dataInicio && dataFim ? { dataHoraInicio: filtroData } : {}),
        },
        include: {
          cliente: { select: { id: true, nome: true, email: true, telefone: true } },
          profissional: { select: { id: true, nome: true, especialidade: true } },
          servico: true,
        },
        orderBy: { dataHoraInicio: 'asc' },
      }),
      prisma.bloqueioAgenda.findMany({
        where: {
          ...filtroProf,
          ...(dataInicio && dataFim ? { dataHoraInicio: filtroData } : {}),
        },
        include: {
          profissional: { select: { id: true, nome: true, especialidade: true } },
        },
        orderBy: { dataHoraInicio: 'asc' },
      }),
      prisma.usuario.findMany({
        where: { tipo: { in: ['BARBEIRO', 'ADMIN'] }, ativo: true },
        select: {
          id: true,
          nome: true,
          email: true,
          telefone: true,
          especialidade: true,
          horaInicioTurno: true,
          horaFimTurno: true,
          fotoUrl: true,
        },
      }),
    ]);

    // RNF02.4: Mapeamento explícito de cores e rótulos textuais por status
    const blocosCalendario = [
      ...agendamentos.map((ag) => {
        const statusVisual =
          ag.status === 'CONCLUIDO'
            ? { rotulo: 'Atendido', corHex: '#10b981', badgeClass: 'status-atendido' }
            : ag.status === 'CANCELADO'
            ? { rotulo: 'Cancelado', corHex: '#ef4444', badgeClass: 'status-cancelado' }
            : { rotulo: 'Confirmado', corHex: '#3b82f6', badgeClass: 'status-confirmado' };

        return {
          id: `ag-${ag.id}`,
          agendamentoId: ag.id,
          tipoBloco: 'AGENDAMENTO',
          status: ag.status,
          rotuloStatus: statusVisual.rotulo,
          corHex: statusVisual.corHex,
          badgeClass: statusVisual.badgeClass,
          dataHoraInicio: ag.dataHoraInicio,
          dataHoraFim: ag.dataHoraFim,
          titulo: `${ag.servico.nome} - ${ag.cliente.nome}`,
          cliente: ag.cliente,
          profissional: ag.profissional,
          servico: ag.servico,
          observacoes: ag.observacoes,
        };
      }),
      ...bloqueios.map((bl) => ({
        id: `bl-${bl.id}`,
        bloqueioId: bl.id,
        tipoBloco: 'BLOQUEIO',
        status: 'BLOQUEADO',
        rotuloStatus: 'Bloqueado',
        corHex: '#f59e0b',
        badgeClass: 'status-bloqueado',
        dataHoraInicio: bl.dataHoraInicio,
        dataHoraFim: bl.dataHoraFim,
        titulo: `Bloqueio: ${bl.motivo}`,
        motivo: bl.motivo,
        profissional: bl.profissional,
      })),
    ].sort((a, b) => new Date(a.dataHoraInicio) - new Date(b.dataHoraInicio));

    const tempoRenderMs = +(performance.now() - t0).toFixed(2);

    res.json({
      tempoProcessamentoMs: tempoRenderMs,
      totalBlocos: blocosCalendario.length,
      blocos: blocosCalendario,
      profissionais,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar calendário administrativo.', detalhes: err.message });
  }
});

// Atualizar status de agendamento pelo Barbeiro/Admin (Diagrama de Estados: Confirmado -> EmAtendimento -> Concluido)
app.patch('/api/admin/agendamentos/:id/status', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body; // CONFIRMADO | EM_ATENDIMENTO | CONCLUIDO | CANCELADO
    const permitidos = ['CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'CANCELADO'];
    if (!permitidos.includes(status)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }

    const dados = { status };
    if (status === 'CANCELADO') {
      dados.slotAtivoKey = null;
    }

    const atualizado = await prisma.agendamento.update({
      where: { id },
      data: dados,
      include: { cliente: true, servico: true, profissional: true },
    });

    res.json({ mensagem: `Status atualizado para ${status}.`, agendamento: atualizado });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar status.', detalhes: err.message });
  }
});

// RF02 / CT10: Criar Bloqueio de Agenda (Folga / Almoço)
app.post('/api/admin/bloqueios', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    const { profissionalId, dataHoraInicio, dataHoraFim, motivo } = req.body;
    if (!profissionalId || !dataHoraInicio || !dataHoraFim || !motivo) {
      return res.status(400).json({
        erro: 'Informe profissional, início, fim e motivo do bloqueio (ex.: Almoço, Folga).',
      });
    }

    const inicio = new Date(dataHoraInicio);
    const fim = new Date(dataHoraFim);
    if (fim <= inicio) {
      return res.status(400).json({ erro: 'O horário de término deve ser posterior ao início.' });
    }

    // Verifica se já existe agendamento confirmado naquele intervalo (RNF02.3)
    const agendamentosNoPeriodo = await prisma.agendamento.findMany({
      where: {
        profissionalId: Number(profissionalId),
        status: { in: ['CONFIRMADO', 'EM_ATENDIMENTO'] },
        dataHoraInicio: { lt: fim },
        dataHoraFim: { gt: inicio },
      },
    });

    if (agendamentosNoPeriodo.length > 0) {
      return res.status(409).json({
        erro: 'Não é possível bloquear este horário pois já existe um agendamento confirmado no período.',
      });
    }

    const bloqueio = await prisma.bloqueioAgenda.create({
      data: {
        profissionalId: Number(profissionalId),
        dataHoraInicio: inicio,
        dataHoraFim: fim,
        motivo: String(motivo).trim(),
      },
      include: {
        profissional: { select: { id: true, nome: true } },
      },
    });

    res.status(201).json({
      mensagem: 'Bloqueio de agenda registrado com sucesso.',
      bloqueio,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar bloqueio de agenda.', detalhes: err.message });
  }
});

app.delete('/api/admin/bloqueios/:id', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    await prisma.bloqueioAgenda.delete({ where: { id: Number(req.params.id) } });
    res.json({ mensagem: 'Bloqueio removido com sucesso.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover bloqueio.', detalhes: err.message });
  }
});

// T17 / RF02: CRUD de Profissionais e Horários de Funcionamento
app.post('/api/admin/profissionais', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    const { nome, email, telefone, especialidade, horaInicioTurno, horaFimTurno, fotoUrl, senha } = req.body;
    if (!nome || !email || !telefone || !especialidade) {
      return res.status(400).json({
        erro: 'Nome, e-mail, telefone e especialidade são obrigatórios para cadastrar o profissional.',
      });
    }

    const hashSenha = await bcrypt.hash(String(senha || '123456'), 10);
    const novoProf = await prisma.usuario.create({
      data: {
        nome: String(nome).trim(),
        email: String(email).trim().toLowerCase(),
        telefone: String(telefone).trim(),
        hashSenha,
        tipo: 'BARBEIRO',
        aceiteLGPD: true,
        dataConsentimento: new Date(),
        especialidade: String(especialidade).trim(),
        horaInicioTurno: horaInicioTurno || '09:00',
        horaFimTurno: horaFimTurno || '19:00',
        fotoUrl:
          fotoUrl ||
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
        ativo: true,
      },
    });

    res.status(201).json({
      mensagem: 'Profissional cadastrado com sucesso.',
      profissional: {
        id: novoProf.id,
        nome: novoProf.nome,
        email: novoProf.email,
        telefone: novoProf.telefone,
        especialidade: novoProf.especialidade,
        horaInicioTurno: novoProf.horaInicioTurno,
        horaFimTurno: novoProf.horaFimTurno,
      },
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao cadastrar profissional.', detalhes: err.message });
  }
});

app.put('/api/admin/profissionais/:id', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, especialidade, horaInicioTurno, horaFimTurno, telefone, ativo } = req.body;
    const atualizado = await prisma.usuario.update({
      where: { id },
      data: {
        ...(nome ? { nome } : {}),
        ...(especialidade ? { especialidade } : {}),
        ...(horaInicioTurno ? { horaInicioTurno } : {}),
        ...(horaFimTurno ? { horaFimTurno } : {}),
        ...(telefone ? { telefone } : {}),
        ...(ativo !== undefined ? { ativo: Boolean(ativo) } : {}),
      },
    });
    res.json({ mensagem: 'Horários/dados do profissional atualizados.', profissional: atualizado });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar profissional.', detalhes: err.message });
  }
});

app.delete('/api/admin/profissionais/:id', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.usuario.update({
      where: { id },
      data: { ativo: false },
    });
    res.json({ mensagem: 'Profissional desativado da grade de atendimento.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover profissional.', detalhes: err.message });
  }
});

// CRUD de Serviços no Painel Admin (Nível Intermediário)
app.post('/api/admin/servicos', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    const { nome, preco, duracaoMinutos, descricao, categoria, fotoUrl } = req.body;
    if (!nome || preco === undefined || !duracaoMinutos) {
      return res.status(400).json({ erro: 'Nome, preço e duração estimada são obrigatórios.' });
    }
    const servico = await prisma.servico.create({
      data: {
        nome: String(nome).trim(),
        preco: Number(preco),
        duracaoMinutos: Number(duracaoMinutos),
        descricao: descricao || 'Serviço especializado de barbearia.',
        categoria: categoria || 'Cabelo',
        fotoUrl:
          fotoUrl ||
          'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=600&auto=format&fit=crop&q=80',
      },
    });
    res.status(201).json({ mensagem: 'Serviço adicionado ao catálogo.', servico });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar serviço.', detalhes: err.message });
  }
});

app.delete('/api/admin/servicos/:id', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  try {
    await prisma.servico.update({
      where: { id: Number(req.params.id) },
      data: { ativo: false },
    });
    res.json({ mensagem: 'Serviço removido do catálogo ativo.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover serviço.', detalhes: err.message });
  }
});

// Logs de notificações externas disparadas (T21 / RE01)
app.get('/api/admin/notificacoes', autenticarJWT, exigirPerfilAdminOuBarbeiro, async (req, res) => {
  const logs = await prisma.notificacaoLog.findMany({
    orderBy: { enviadoEm: 'desc' },
    take: 50,
  });
  res.json(logs);
});

module.exports = { app, prisma, validarPrazoCancelamento, verificarSobreposicao };
