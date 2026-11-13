const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Iniciando seed do banco de dados da Barbearia...');

  await prisma.notificacaoLog.deleteMany();
  await prisma.agendamento.deleteMany();
  await prisma.bloqueioAgenda.deleteMany();
  await prisma.servico.deleteMany();
  await prisma.usuario.deleteMany();

  const senhaPadrao = await bcrypt.hash('123456', 10);

  // 1. Administrador / Proprietário (Entrevista Lab 1)
  const admin = await prisma.usuario.create({
    data: {
      nome: 'Carlos Eduardo (Proprietário / Admin)',
      email: 'admin@barbearia.com',
      telefone: '(35) 99900-0001',
      hashSenha: senhaPadrao,
      tipo: 'ADMIN',
      aceiteLGPD: true,
      dataConsentimento: new Date(),
      especialidade: 'Mestre Barbeiro & Visagismo',
      horaInicioTurno: '09:00',
      horaFimTurno: '19:00',
      fotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
      ativo: true,
    },
  });

  // 2. Equipe de Profissionais Barbeiros (RU01, RF02)
  const barbeiro1 = await prisma.usuario.create({
    data: {
      nome: 'Rafael Mendes',
      email: 'rafael@barbearia.com',
      telefone: '(35) 99900-0002',
      hashSenha: senhaPadrao,
      tipo: 'BARBEIRO',
      aceiteLGPD: true,
      dataConsentimento: new Date(),
      especialidade: 'Corte Degradê (Fade) & Navalhado',
      horaInicioTurno: '09:00',
      horaFimTurno: '19:00',
      fotoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
      ativo: true,
    },
  });

  const barbeiro2 = await prisma.usuario.create({
    data: {
      nome: 'Lucas Ferreira',
      email: 'lucas@barbearia.com',
      telefone: '(35) 99900-0003',
      hashSenha: senhaPadrao,
      tipo: 'BARBEIRO',
      aceiteLGPD: true,
      dataConsentimento: new Date(),
      especialidade: 'Barboterapia Clássica & Toalha Quente',
      horaInicioTurno: '09:00',
      horaFimTurno: '18:00',
      fotoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80',
      ativo: true,
    },
  });

  const barbeiro3 = await prisma.usuario.create({
    data: {
      nome: 'Matheus Oliveira',
      email: 'matheus@barbearia.com',
      telefone: '(35) 99900-0004',
      hashSenha: senhaPadrao,
      tipo: 'BARBEIRO',
      aceiteLGPD: true,
      dataConsentimento: new Date(),
      especialidade: 'Selagem Capilar, Química & Estilo Moderno',
      horaInicioTurno: '10:00',
      horaFimTurno: '20:00',
      fotoUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300&auto=format&fit=crop&q=80',
      ativo: true,
    },
  });

  // 3. Cliente Exemplo (CS001, CS002)
  const cliente = await prisma.usuario.create({
    data: {
      nome: 'Gabriel Lazarini',
      email: 'gabriel@cliente.com',
      telefone: '(35) 98888-7777',
      hashSenha: senhaPadrao,
      tipo: 'CLIENTE',
      aceiteLGPD: true,
      dataConsentimento: new Date(),
      ativo: true,
    },
  });

  // 4. Catálogo de Serviços (RU01 - Corte, Barba, Selagem, Combo, etc.)
  const servicos = await Promise.all([
    prisma.servico.create({
      data: {
        nome: 'Corte Masculino Clássico / Degradê',
        preco: 45.0,
        duracaoMinutos: 30,
        categoria: 'Cabelo',
        descricao: 'Corte personalizado na tesoura ou máquina (fade/degradê), acabamento na navalha e lavagem refrescante.',
        fotoUrl: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=600&auto=format&fit=crop&q=80',
      },
    }),
    prisma.servico.create({
      data: {
        nome: 'Barboterapia com Toalha Quente',
        preco: 35.0,
        duracaoMinutos: 30,
        categoria: 'Barba',
        descricao: 'Modelagem completa da barba com ritual de toalha quente, óleos essenciais, navalha e pós-barba hidratante.',
        fotoUrl: 'https://images.unsplash.com/photo-1621607512214-68297480165e?w=600&auto=format&fit=crop&q=80',
      },
    }),
    prisma.servico.create({
      data: {
        nome: 'Combo Corte + Barba Completa',
        preco: 70.0,
        duracaoMinutos: 60,
        categoria: 'Combo',
        descricao: 'O pacote completo da barbearia: corte moderno + ritual de barboterapia com toalha quente e massagem facial.',
        fotoUrl: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&auto=format&fit=crop&q=80',
      },
    }),
    prisma.servico.create({
      data: {
        nome: 'Selagem Capilar Masculina',
        preco: 85.0,
        duracaoMinutos: 60,
        categoria: 'Química',
        descricao: 'Alinhamento térmico dos fios, redução de volume e frizz com brilho natural e alta durabilidade.',
        fotoUrl: 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=600&auto=format&fit=crop&q=80',
      },
    }),
    prisma.servico.create({
      data: {
        nome: 'Acabamento (Pezinho) & Sobrancelha',
        preco: 25.0,
        duracaoMinutos: 30,
        categoria: 'Acabamento',
        descricao: 'Manutenção rápida do contorno do corte e alinhamento de sobrancelha na navalha ou pinça.',
        fotoUrl: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=600&auto=format&fit=crop&q=80',
      },
    }),
    prisma.servico.create({
      data: {
        nome: 'Camuflagem de Fios Brancos (Barba ou Cabelo)',
        preco: 55.0,
        duracaoMinutos: 30,
        categoria: 'Química',
        descricao: 'Pigmentação discreta e natural para cobertura de fios grisalhos sem aspecto artificial.',
        fotoUrl: 'https://images.unsplash.com/photo-1517832607067-4db24a2ae47c?w=600&auto=format&fit=crop&q=80',
      },
    }),
  ]);

  // 5. Bloqueios de Agenda Exemplo (Almoço - RF02)
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(12, 0, 0, 0);
  const amanhaFimAlmoco = new Date(amanha);
  amanhaFimAlmoco.setHours(13, 0, 0, 0);

  await prisma.bloqueioAgenda.createMany({
    data: [
      {
        profissionalId: barbeiro1.id,
        dataHoraInicio: amanha,
        dataHoraFim: amanhaFimAlmoco,
        motivo: 'Horário de Almoço',
      },
      {
        profissionalId: barbeiro2.id,
        dataHoraInicio: amanha,
        dataHoraFim: amanhaFimAlmoco,
        motivo: 'Horário de Almoço',
      },
    ],
  });

  // 6. Agendamentos de Exemplo para o Cliente e Calendário Administrativo
  // Agendamento futuro (> 24h) para testar cancelamento e remarcação (CS002)
  const agendamentoFuturoInicio = new Date(amanha);
  agendamentoFuturoInicio.setHours(14, 0, 0, 0);
  const agendamentoFuturoFim = new Date(agendamentoFuturoInicio);
  agendamentoFuturoFim.setMinutes(agendamentoFuturoFim.getMinutes() + 30);

  const slotKey1 = `${barbeiro1.id}_${agendamentoFuturoInicio.toISOString()}`;
  await prisma.agendamento.create({
    data: {
      clienteId: cliente.id,
      profissionalId: barbeiro1.id,
      servicoId: servicos[0].id,
      dataHoraInicio: agendamentoFuturoInicio,
      dataHoraFim: agendamentoFuturoFim,
      status: 'CONFIRMADO',
      slotAtivoKey: slotKey1,
      observacoes: 'Degradê navalhado médio',
    },
  });

  // Agendamento concluído (Atendido - RNF02.4)
  const hojeCedo = new Date();
  hojeCedo.setHours(9, 0, 0, 0);
  const hojeCedoFim = new Date(hojeCedo);
  hojeCedoFim.setMinutes(hojeCedoFim.getMinutes() + 30);

  await prisma.agendamento.create({
    data: {
      clienteId: cliente.id,
      profissionalId: barbeiro2.id,
      servicoId: servicos[1].id,
      dataHoraInicio: hojeCedo,
      dataHoraFim: hojeCedoFim,
      status: 'CONCLUIDO',
      slotAtivoKey: null,
      observacoes: 'Atendimento finalizado presencialmente (RN03)',
    },
  });

  console.log('✅ Seed concluído com sucesso!');
  console.log('   - Admin: admin@barbearia.com / 123456');
  console.log('   - Barbeiro: rafael@barbearia.com / 123456');
  console.log('   - Cliente: gabriel@cliente.com / 123456');
}

if (require.main === module) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { seed };
