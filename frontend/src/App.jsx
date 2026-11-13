import React, { useState, useEffect, useCallback } from 'react';

const DRAFT_KEY = 'barbearia_rascunho_agendamento_v1';
const AUTH_KEY = 'barbearia_auth_session_v1';
const DRAFT_TTL_MS = 10 * 60 * 1000; // RNF01.3: 10 minutos em sessionStorage

function obterDataAmanhaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export default function App() {
  // Navegação de abas
  const [abaAtiva, setAbaAtiva] = useState('catalogo'); // catalogo | meus-agendamentos | admin | perfil | login

  // Estado de Autenticação (JWT 60 min + renovação automática RNF02.2)
  const [sessao, setSessao] = useState(() => {
    try {
      const salvo = localStorage.getItem(AUTH_KEY);
      return salvo ? JSON.parse(salvo) : null;
    } catch {
      return null;
    }
  });

  // Dados públicos (RU01 / RN02)
  const [servicos, setServicos] = useState([]);
  const [profissionais, setProfissionais] = useState([]);
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(true);

  // Estado da seleção / Rascunho do Agendamento (mantido em sessionStorage por 10 min - RNF01.3)
  const [rascunho, setRascunho] = useState(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.salvoEm <= DRAFT_TTL_MS) {
          return parsed;
        }
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // ignora erro de leitura
    }
    return {
      servicoId: null,
      profissionalId: 'qualquer',
      data: obterDataAmanhaISO(),
      slotEscolhido: null,
      profissionalEfetivoId: null,
      observacoes: '',
      salvoEm: Date.now(),
    };
  });

  const [rascunhoRestauradoAviso, setRascunhoRestauradoAviso] = useState(false);

  // Horários disponíveis da API (RNF01.1)
  const [slotsDisponiveis, setSlotsDisponiveis] = useState([]);
  const [tempoConsultaMs, setTempoConsultaMs] = useState(null);
  const [carregandoSlots, setCarregandoSlots] = useState(false);

  // Modal de Lazy Registration / Identificação na Confirmação (RN02 / CS001 Passo 4)
  const [modalConfirmacaoAberto, setModalConfirmacaoAberto] = useState(false);
  const [modoIdentificacao, setModoIdentificacao] = useState('cadastro'); // cadastro | login
  const [formLazy, setFormLazy] = useState({
    nome: '',
    email: '',
    telefone: '',
    senha: '',
    aceiteLGPD: false,
  });

  // Comprovante de Agendamento (T11 / CS001 Passo 5)
  const [comprovanteRecente, setComprovanteRecente] = useState(null);

  // Alertas globais de acessibilidade / feedback (RNF01.4)
  const [alerta, setAlerta] = useState(null); // { tipo: 'error'|'success'|'info'|'warning', texto: '' }

  // Meus Agendamentos e Remarcação (CS002 / RN01)
  const [meusAgendamentos, setMeusAgendamentos] = useState([]);
  const [agendamentoRemarcando, setAgendamentoRemarcando] = useState(null);
  const [novaDataRemarcacao, setNovaDataRemarcacao] = useState(obterDataAmanhaISO());
  const [slotsRemarcacao, setSlotsRemarcacao] = useState([]);
  const [novoSlotRemarcacao, setNovoSlotRemarcacao] = useState(null);

  // Painel Administrativo (RU05, RF02, RNF02.1 a RNF02.4)
  const [calendarioAdmin, setCalendarioAdmin] = useState({
    blocos: [],
    profissionais: [],
    tempoProcessamentoMs: 0,
  });
  const [filtroAdminProfissional, setFiltroAdminProfissional] = useState('');
  const [notificacoesLog, setNotificacoesLog] = useState([]);
  const [formBloqueio, setFormBloqueio] = useState({
    profissionalId: '',
    data: obterDataAmanhaISO(),
    horaInicio: '12:00',
    horaFim: '13:00',
    motivo: 'Horário de Almoço',
  });
  const [formNovoProfissional, setFormNovoProfissional] = useState({
    nome: '',
    email: '',
    telefone: '',
    especialidade: '',
    horaInicioTurno: '09:00',
    horaFimTurno: '19:00',
  });
  const [formNovoServico, setFormNovoServico] = useState({
    nome: '',
    preco: '',
    duracaoMinutos: 30,
    descricao: '',
  });

  // Login standalone e Edição de Perfil
  const [formLogin, setFormLogin] = useState({ email: '', senha: '' });
  const [formPerfil, setFormPerfil] = useState({ nome: '', telefone: '', senhaNova: '' });

  // Helper de requisição com renovação automática de token (RNF02.2)
  const apiFetch = useCallback(
    async (url, options = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      };
      if (sessao?.token) {
        headers.Authorization = `Bearer ${sessao.token}`;
      }

      const resp = await fetch(url, { ...options, headers });

      // RNF02.2: Renovação transparente do JWT se o cabeçalho X-Renewed-Token vier na resposta
      const tokenRenovado = resp.headers.get('X-Renewed-Token');
      if (tokenRenovado && sessao) {
        const novaSessao = { ...sessao, token: tokenRenovado };
        setSessao(novaSessao);
        localStorage.setItem(AUTH_KEY, JSON.stringify(novaSessao));
      }

      const data = await resp.json().catch(() => ({}));
      return { ok: resp.ok, status: resp.status, data };
    },
    [sessao]
  );

  // Salva rascunho em sessionStorage por até 10 min (RNF01.3)
  useEffect(() => {
    try {
      const payload = { ...rascunho, salvoEm: Date.now() };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // ignora erro de quota
    }
  }, [rascunho]);

  // Verifica na montagem se havia um rascunho salvo em sessionStorage (RNF01.3 / 2E)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.servicoId && Date.now() - parsed.salvoEm <= DRAFT_TTL_MS) {
          setRascunhoRestauradoAviso(true);
        }
      }
    } catch {
      // ignora
    }
  }, []);

  // Carrega Catálogo Público (RU01)
  const carregarCatalogo = useCallback(async () => {
    setCarregandoCatalogo(true);
    const { ok, data } = await apiFetch('/api/catalogo');
    if (ok) {
      setServicos(data.servicos || []);
      setProfissionais(data.profissionais || []);
      if (!rascunho.servicoId && data.servicos?.length > 0) {
        setRascunho((prev) => ({ ...prev, servicoId: data.servicos[0].id }));
      }
    }
    setCarregandoCatalogo(false);
  }, [apiFetch, rascunho.servicoId]);

  useEffect(() => {
    carregarCatalogo();
  }, [carregarCatalogo]);

  // Carrega horários disponíveis sempre que serviço, profissional ou data mudam (RNF01.1)
  const carregarHorarios = useCallback(async () => {
    if (!rascunho.servicoId || !rascunho.data) return;
    setCarregandoSlots(true);
    const qs = new URLSearchParams({
      data: rascunho.data,
      servicoId: String(rascunho.servicoId),
      profissionalId: String(rascunho.profissionalId || 'qualquer'),
    });
    const { ok, data } = await apiFetch(`/api/horarios-disponiveis?${qs.toString()}`);
    if (ok) {
      setSlotsDisponiveis(data.slots || []);
      setTempoConsultaMs(data.tempoProcessamentoMs);
    }
    setCarregandoSlots(false);
  }, [apiFetch, rascunho.data, rascunho.profissionalId, rascunho.servicoId]);

  useEffect(() => {
    carregarHorarios();
  }, [carregarHorarios]);

  // Carrega Meus Agendamentos quando na aba correspondente
  const carregarMeusAgendamentos = useCallback(async () => {
    if (!sessao?.token) return;
    const { ok, data } = await apiFetch('/api/meus-agendamentos');
    if (ok) {
      setMeusAgendamentos(Array.isArray(data) ? data : []);
    }
  }, [apiFetch, sessao?.token]);

  // Carrega Calendário e Notificações Admin quando na aba admin
  const carregarPainelAdmin = useCallback(async () => {
    if (!sessao?.token) return;
    const qs = filtroAdminProfissional ? `?profissionalId=${filtroAdminProfissional}` : '';
    const [calResp, notifResp] = await Promise.all([
      apiFetch(`/api/admin/calendario${qs}`),
      apiFetch('/api/admin/notificacoes'),
    ]);
    if (calResp.ok) {
      setCalendarioAdmin(calResp.data);
      if (!formBloqueio.profissionalId && calResp.data.profissionais?.length > 0) {
        setFormBloqueio((prev) => ({
          ...prev,
          profissionalId: calResp.data.profissionais[0].id,
        }));
      }
    } else if (calResp.status === 401 || calResp.status === 403) {
      setAlerta({
        tipo: 'error',
        texto: calResp.data.erro || 'Acesso negado ao painel administrativo (RNF02.2).',
      });
    }
    if (notifResp.ok) {
      setNotificacoesLog(notifResp.data || []);
    }
  }, [apiFetch, filtroAdminProfissional, formBloqueio.profissionalId, sessao?.token]);

  useEffect(() => {
    if (abaAtiva === 'meus-agendamentos') {
      carregarMeusAgendamentos();
    } else if (abaAtiva === 'admin') {
      carregarPainelAdmin();
    } else if (abaAtiva === 'perfil' && sessao?.usuario) {
      setFormPerfil({
        nome: sessao.usuario.nome || '',
        telefone: sessao.usuario.telefone || '',
        senhaNova: '',
      });
    }
  }, [abaAtiva, carregarMeusAgendamentos, carregarPainelAdmin, sessao]);

  const salvarSessao = (token, usuario) => {
    const obj = { token, usuario };
    setSessao(obj);
    localStorage.setItem(AUTH_KEY, JSON.stringify(obj));
  };

  const encerrarSessao = () => {
    setSessao(null);
    localStorage.removeItem(AUTH_KEY);
    setAbaAtiva('catalogo');
    setAlerta({ tipo: 'info', texto: 'Sessão encerrada com segurança.' });
  };

  // Passo 3 -> 4 do CS001: Clicar em "Confirmar Agendamento"
  const iniciarConfirmacaoAgendamento = () => {
    setAlerta(null);
    if (!rascunho.servicoId || !rascunho.slotEscolhido) {
      setAlerta({
        tipo: 'error',
        texto: 'Alerta de preenchimento (RNF01.4): selecione um serviço, uma data e um horário disponível antes de confirmar.',
      });
      return;
    }

    // Se já está autenticado, confirma diretamente; se não, abre modal de Lazy Registration (RN02)
    if (sessao?.token) {
      submeterReservaFinal(null);
    } else {
      setModalConfirmacaoAberto(true);
    }
  };

  // Passo 5 do CS001: Submete pedido de reserva atômica ao Backend
  const submeterReservaFinal = async (dadosClienteLazy) => {
    setAlerta(null);

    // Validação explícita no cliente para RNF01.4 e RE01
    if (!sessao?.token && dadosClienteLazy) {
      if (modoIdentificacao === 'cadastro') {
        if (!dadosClienteLazy.nome.trim() || !dadosClienteLazy.email.trim() || !dadosClienteLazy.telefone.trim()) {
          setAlerta({
            tipo: 'error',
            texto: 'Campos obrigatórios vazios (RNF01.4): preencha Nome Completo, E-mail e Telefone para concluir.',
          });
          return;
        }
        if (!dadosClienteLazy.aceiteLGPD) {
          setAlerta({
            tipo: 'error',
            texto: 'Conformidade Legal (RE01 - LGPD): é obrigatório marcar o consentimento explícito para uso de telefone e e-mail nas notificações da reserva.',
          });
          return;
        }
      } else {
        if (!dadosClienteLazy.email.trim() || !dadosClienteLazy.senha.trim()) {
          setAlerta({
            tipo: 'error',
            texto: 'Informe seu e-mail e senha cadastrados para autenticar e confirmar a reserva.',
          });
          return;
        }
      }
    }

    const profEfetivo =
      rascunho.profissionalId !== 'qualquer'
        ? Number(rascunho.profissionalId)
        : rascunho.profissionalEfetivoId;

    const payload = {
      servicoId: Number(rascunho.servicoId),
      profissionalId: Number(profEfetivo),
      dataHoraInicio: rascunho.slotEscolhido.dataHoraInicio,
      observacoes: rascunho.observacoes,
      ...(dadosClienteLazy ? { clienteDados: dadosClienteLazy } : {}),
    };

    const { ok, status, data } = await apiFetch('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (ok) {
      if (data.token && data.usuario) {
        salvarSessao(data.token, data.usuario);
      }
      setModalConfirmacaoAberto(false);
      setComprovanteRecente(data.comprovante);
      setRascunho((prev) => ({ ...prev, slotEscolhido: null, observacoes: '' }));
      sessionStorage.removeItem(DRAFT_KEY);
      setRascunhoRestauradoAviso(false);
      await carregarHorarios();
      setAlerta({
        tipo: 'success',
        texto: data.mensagem || 'Reserva confirmada com sucesso!',
      });
    } else {
      // Se houve conflito concorrente (1E / status 409), recarrega os horários imediatamente!
      if (status === 409) {
        await carregarHorarios();
        setRascunho((prev) => ({ ...prev, slotEscolhido: null }));
      }
      setAlerta({
        tipo: 'error',
        texto: data.erro || 'Não foi possível concluir o agendamento.',
      });
    }
  };

  // CS002: Cancelar Agendamento (RN01 - antecedência mínima de 2h)
  const cancelarAgendamentoCliente = async (id) => {
    setAlerta(null);
    const { ok, data } = await apiFetch(`/api/agendamentos/${id}/cancelar`, {
      method: 'PATCH',
    });
    if (ok) {
      setAlerta({ tipo: 'success', texto: data.mensagem });
      carregarMeusAgendamentos();
      carregarHorarios();
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  // CS002 (1A): Abrir modal de Remarcação para o mesmo profissional e serviço
  const abrirModalRemarcacao = async (agendamento) => {
    setAlerta(null);
    setAgendamentoRemarcando(agendamento);
    setNovoSlotRemarcacao(null);
    const dataInicial = obterDataAmanhaISO();
    setNovaDataRemarcacao(dataInicial);
    await buscarSlotsRemarcacao(agendamento, dataInicial);
  };

  const buscarSlotsRemarcacao = async (agendamento, dataEscolhida) => {
    const qs = new URLSearchParams({
      data: dataEscolhida,
      servicoId: String(agendamento.servicoId),
      profissionalId: String(agendamento.profissionalId),
    });
    const { ok, data } = await apiFetch(`/api/horarios-disponiveis?${qs.toString()}`);
    if (ok) {
      setSlotsRemarcacao(data.slots || []);
    }
  };

  const confirmarRemarcacao = async () => {
    if (!agendamentoRemarcando || !novoSlotRemarcacao) {
      setAlerta({ tipo: 'error', texto: 'Selecione um novo horário disponível para remarcar.' });
      return;
    }
    const { ok, data } = await apiFetch(`/api/agendamentos/${agendamentoRemarcando.id}/remarcar`, {
      method: 'PATCH',
      body: JSON.stringify({ novaDataHoraInicio: novoSlotRemarcacao.dataHoraInicio }),
    });
    if (ok) {
      setAlerta({ tipo: 'success', texto: data.mensagem });
      setAgendamentoRemarcando(null);
      carregarMeusAgendamentos();
      carregarHorarios();
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  // Admin: Criar Bloqueio de Agenda (RF02 / CT10)
  const criarBloqueioAdmin = async (e) => {
    e.preventDefault();
    setAlerta(null);
    const [ano, mes, dia] = formBloqueio.data.split('-').map(Number);
    const [hI, mI] = formBloqueio.horaInicio.split(':').map(Number);
    const [hF, mF] = formBloqueio.horaFim.split(':').map(Number);

    const inicio = new Date(ano, mes - 1, dia, hI, mI, 0);
    const fim = new Date(ano, mes - 1, dia, hF, mF, 0);

    const { ok, data } = await apiFetch('/api/admin/bloqueios', {
      method: 'POST',
      body: JSON.stringify({
        profissionalId: Number(formBloqueio.profissionalId),
        dataHoraInicio: inicio.toISOString(),
        dataHoraFim: fim.toISOString(),
        motivo: formBloqueio.motivo,
      }),
    });

    if (ok) {
      setAlerta({ tipo: 'success', texto: data.mensagem });
      carregarPainelAdmin();
      carregarHorarios();
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  const removerBloqueioAdmin = async (bloqueioId) => {
    const { ok, data } = await apiFetch(`/api/admin/bloqueios/${bloqueioId}`, {
      method: 'DELETE',
    });
    if (ok) {
      setAlerta({ tipo: 'info', texto: data.mensagem });
      carregarPainelAdmin();
      carregarHorarios();
    }
  };

  const alterarStatusAgendamentoAdmin = async (agendamentoId, novoStatus) => {
    const { ok, data } = await apiFetch(`/api/admin/agendamentos/${agendamentoId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: novoStatus }),
    });
    if (ok) {
      setAlerta({ tipo: 'success', texto: data.mensagem });
      carregarPainelAdmin();
      carregarHorarios();
    }
  };

  const cadastrarProfissionalAdmin = async (e) => {
    e.preventDefault();
    setAlerta(null);
    const { ok, data } = await apiFetch('/api/admin/profissionais', {
      method: 'POST',
      body: JSON.stringify(formNovoProfissional),
    });
    if (ok) {
      setAlerta({ tipo: 'success', texto: data.mensagem });
      setFormNovoProfissional({
        nome: '',
        email: '',
        telefone: '',
        especialidade: '',
        horaInicioTurno: '09:00',
        horaFimTurno: '19:00',
      });
      carregarCatalogo();
      carregarPainelAdmin();
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  const removerProfissionalAdmin = async (id) => {
    const { ok, data } = await apiFetch(`/api/admin/profissionais/${id}`, {
      method: 'DELETE',
    });
    if (ok) {
      setAlerta({ tipo: 'info', texto: data.mensagem });
      carregarCatalogo();
      carregarPainelAdmin();
    }
  };

  const cadastrarServicoAdmin = async (e) => {
    e.preventDefault();
    setAlerta(null);
    const { ok, data } = await apiFetch('/api/admin/servicos', {
      method: 'POST',
      body: JSON.stringify(formNovoServico),
    });
    if (ok) {
      setAlerta({ tipo: 'success', texto: data.mensagem });
      setFormNovoServico({ nome: '', preco: '', duracaoMinutos: 30, descricao: '' });
      carregarCatalogo();
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  // Login Direto (Cliente ou Equipe Administrativa)
  const realizarLoginDireto = async (e) => {
    e.preventDefault();
    setAlerta(null);
    const { ok, data } = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(formLogin),
    });
    if (ok) {
      salvarSessao(data.token, data.usuario);
      setAlerta({ tipo: 'success', texto: `Bem-vindo(a), ${data.usuario.nome}!` });
      if (data.usuario.tipo === 'ADMIN' || data.usuario.tipo === 'BARBEIRO') {
        setAbaAtiva('admin');
      } else {
        setAbaAtiva('catalogo');
      }
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  const loginRapidoDemo = async (emailDemo) => {
    setAlerta(null);
    const { ok, data } = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: emailDemo, senha: '123456' }),
    });
    if (ok) {
      salvarSessao(data.token, data.usuario);
      setAlerta({
        tipo: 'success',
        texto: `Sessão autenticada como ${data.usuario.nome} (${data.usuario.tipo}).`,
      });
      if (data.usuario.tipo === 'ADMIN' || data.usuario.tipo === 'BARBEIRO') {
        setAbaAtiva('admin');
      } else {
        setAbaAtiva('meus-agendamentos');
      }
    }
  };

  // Perfil e Exclusão Definitiva LGPD (RE01 / CT13)
  const salvarPerfilUsuario = async (e) => {
    e.preventDefault();
    const { ok, data } = await apiFetch('/api/usuarios/me', {
      method: 'PUT',
      body: JSON.stringify(formPerfil),
    });
    if (ok) {
      salvarSessao(sessao.token, { ...sessao.usuario, ...data.usuario });
      setAlerta({ tipo: 'success', texto: data.mensagem });
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  const solicitarExclusaoLGPD = async () => {
    const confirmou = window.confirm(
      'ATENÇÃO (Lei nº 13.709/2018 - LGPD): Deseja excluir definitivamente todos os seus dados pessoais e histórico de agendamentos do banco de dados?'
    );
    if (!confirmou) return;

    const { ok, data } = await apiFetch('/api/usuarios/me', { method: 'DELETE' });
    if (ok) {
      setSessao(null);
      localStorage.removeItem(AUTH_KEY);
      setAbaAtiva('catalogo');
      setAlerta({ tipo: 'warning', texto: data.mensagem });
    } else {
      setAlerta({ tipo: 'error', texto: data.erro });
    }
  };

  const servicoSelecionadoObj = servicos.find((s) => s.id === Number(rascunho.servicoId));

  return (
    <div>
      {/* Barra de Navegação Superior */}
      <header className="navbar">
        <div className="navbar-container">
          <div className="brand" onClick={() => setAbaAtiva('catalogo')} style={{ cursor: 'pointer' }}>
            <span className="brand-badge">BARBER PRO</span>
            <span>Agendamento & Gestão</span>
          </div>

          <nav className="nav-links" aria-label="Navegação Principal">
            <button
              type="button"
              className={`nav-btn ${abaAtiva === 'catalogo' ? 'active' : ''}`}
              onClick={() => setAbaAtiva('catalogo')}
            >
              💈 Catálogo & Agendar
            </button>

            {sessao && (
              <button
                type="button"
                className={`nav-btn ${abaAtiva === 'meus-agendamentos' ? 'active' : ''}`}
                onClick={() => setAbaAtiva('meus-agendamentos')}
              >
                📅 Meus Agendamentos
              </button>
            )}

            {sessao && (sessao.usuario.tipo === 'ADMIN' || sessao.usuario.tipo === 'BARBEIRO') && (
              <button
                type="button"
                className={`nav-btn ${abaAtiva === 'admin' ? 'active' : ''}`}
                onClick={() => setAbaAtiva('admin')}
              >
                ⚙️ Painel Administrativo
              </button>
            )}

            {sessao ? (
              <>
                <button
                  type="button"
                  className={`nav-btn ${abaAtiva === 'perfil' ? 'active' : ''}`}
                  onClick={() => setAbaAtiva('perfil')}
                >
                  🔒 Perfil & LGPD
                </button>
                <div className="user-pill">
                  <span>
                    <strong>{sessao.usuario.nome.split(' ')[0]}</strong> ({sessao.usuario.tipo})
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
                    onClick={encerrarSessao}
                  >
                    Sair
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className={`nav-btn ${abaAtiva === 'login' ? 'active' : ''}`}
                onClick={() => setAbaAtiva('login')}
              >
                🔑 Entrar / Equipe
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="main-container">
        {/* Alertas de Acessibilidade e Regras de Negócio (RNF01.4) */}
        {alerta && (
          <div className={`alert alert-${alerta.tipo}`} role="alert">
            <div style={{ flex: 1 }}>{alerta.texto}</div>
            <button
              type="button"
              onClick={() => setAlerta(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Aviso de recuperação automática via sessionStorage (RNF01.3 / 2E) */}
        {rascunhoRestauradoAviso && abaAtiva === 'catalogo' && (
          <div className="alert alert-info" role="status">
            <div>
              <strong>Rascunho preservado (RNF01.3 - sessionStorage):</strong> Sua escolha de serviço e
              horário foi mantida em cache local por até 10 minutos para evitar perda de sessão.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
              onClick={() => setRascunhoRestauradoAviso(false)}
            >
              OK
            </button>
          </div>
        )}

        {/* ===================================================================
            ABA 1: CATÁLOGO PÚBLICO E AGENDAMENTO AUTÔNOMO (RU01, RU02, RU03)
           =================================================================== */}
        {abaAtiva === 'catalogo' && (
          <div>
            <section className="hero-banner">
              <div>
                <h1 className="hero-title">Agende seu horário sem filas e sem esperar no WhatsApp</h1>
                <p className="hero-subtitle">
                  Consulte nosso catálogo de serviços, preços e barbeiros livremente sem precisar de
                  login (RN02). Você só se identifica na etapa final de confirmação e o pagamento é
                  feito presencialmente na barbearia (RN03).
                </p>
                <div className="hero-badges">
                  <span className="tag-badge">✓ Sem Login Inicial (Lazy Registration)</span>
                  <span className="tag-badge">✓ Reserva Atômica Anti-Duplicidade</span>
                  <span className="tag-badge">✓ Pagamento Presencial (RN03)</span>
                  <span className="tag-badge">✓ Cancelamento até 2h antes (RN01)</span>
                </div>
              </div>
              {!sessao && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Acesso rápido para avaliação do professor:
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => loginRapidoDemo('gabriel@cliente.com')}
                  >
                    👤 Testar como Cliente (Gabriel)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => loginRapidoDemo('admin@barbearia.com')}
                  >
                    🛠️ Testar Painel Admin (Carlos)
                  </button>
                </div>
              )}
            </section>

            {/* Comprovante de Agendamento Recém-Confirmado (T11 / CS001 Passo 5) */}
            {comprovanteRecente && (
              <div className="panel-box" style={{ borderColor: '#10b981', borderWidth: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h2 style={{ color: '#6ee7b7', fontSize: '1.25rem' }}>
                    ✅ Comprovante de Reserva #{comprovanteRecente.codigo}
                  </h2>
                  <span className="status-badge status-confirmado">CONFIRMADO</span>
                </div>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>Cliente:</strong> {comprovanteRecente.agendamento.cliente.nome} (
                  {comprovanteRecente.agendamento.cliente.email})
                </p>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>Serviço:</strong> {comprovanteRecente.agendamento.servico.nome} — R${' '}
                  {comprovanteRecente.agendamento.servico.preco.toFixed(2)} (
                  {comprovanteRecente.agendamento.servico.duracaoMinutos} min)
                </p>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>Profissional:</strong> {comprovanteRecente.agendamento.profissional.nome}
                </p>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>Data e Horário:</strong>{' '}
                  {new Date(comprovanteRecente.agendamento.dataHoraInicio).toLocaleString('pt-BR')}
                </p>
                <p style={{ color: '#fbbf24', fontWeight: 600, marginTop: '0.5rem' }}>
                  💳 Forma de Pagamento: {comprovanteRecente.pagamento}
                </p>
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setAbaAtiva('meus-agendamentos')}
                  >
                    Ver em Meus Agendamentos
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setComprovanteRecente(null)}
                  >
                    Fechar Comprovante
                  </button>
                </div>
              </div>
            )}

            {/* PASSO 1: Catálogo de Serviços (RU01) */}
            <h2 className="section-title">1. Escolha o Serviço (Catálogo Público)</h2>
            {carregandoCatalogo ? (
              <p>Carregando catálogo...</p>
            ) : (
              <div className="grid-cards">
                {servicos.map((serv) => {
                  const selecionado = Number(rascunho.servicoId) === serv.id;
                  return (
                    <div
                      key={serv.id}
                      className={`card ${selecionado ? 'selected' : ''}`}
                      onClick={() =>
                        setRascunho((prev) => ({
                          ...prev,
                          servicoId: serv.id,
                          slotEscolhido: null,
                        }))
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <img src={serv.fotoUrl} alt={serv.nome} className="card-img" />
                      <div className="card-body">
                        <div>
                          <div className="card-title">{serv.nome}</div>
                          <p className="card-desc">{serv.descricao}</p>
                        </div>
                        <div className="card-meta">
                          <span className="price-tag">R$ {serv.preco.toFixed(2)}</span>
                          <span className="duration-tag">⏱ {serv.duracaoMinutos} min</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* PASSO 2: Escolha do Profissional (incluindo 2A - "Qualquer Profissional") */}
            <h2 className="section-title">2. Escolha o Profissional Barbeiro</h2>
            <div className="grid-cards">
              <div
                className={`card ${rascunho.profissionalId === 'qualquer' ? 'selected' : ''}`}
                onClick={() =>
                  setRascunho((prev) => ({
                    ...prev,
                    profissionalId: 'qualquer',
                    slotEscolhido: null,
                  }))
                }
                style={{ cursor: 'pointer' }}
              >
                <div className="card-body">
                  <div>
                    <div className="card-title">⚡ Qualquer Profissional Disponível</div>
                    <p className="card-desc">
                      Exibe a grade consolidada de horários livres de toda a equipe da barbearia
                      (Fluxo Alternativo 2A do CS001).
                    </p>
                  </div>
                  <div className="card-meta">
                    <span className="tag-badge">Maior disponibilidade</span>
                  </div>
                </div>
              </div>

              {profissionais.map((prof) => {
                const selecionado = Number(rascunho.profissionalId) === prof.id;
                return (
                  <div
                    key={prof.id}
                    className={`card ${selecionado ? 'selected' : ''}`}
                    onClick={() =>
                      setRascunho((prev) => ({
                        ...prev,
                        profissionalId: prof.id,
                        slotEscolhido: null,
                      }))
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="card-body">
                      <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <img
                          src={prof.fotoUrl}
                          alt={prof.nome}
                          style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }}
                        />
                        <div>
                          <div className="card-title" style={{ marginBottom: '0.15rem' }}>
                            {prof.nome}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            {prof.especialidade}
                          </div>
                        </div>
                      </div>
                      <div className="card-meta">
                        <span className="duration-tag">
                          Turno: {prof.horaInicioTurno} às {prof.horaFimTurno}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PASSO 3: Seleção de Data e Horário (RNF01.1 e RNF01.4) */}
            <div className="panel-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>
                  3. Selecione a Data e o Horário Disponível
                </h2>
                {tempoConsultaMs !== null && (
                  <span className="duration-tag" title="Métrica RNF01.1: limite de 500 ms">
                    ⚡ API respondeu em {tempoConsultaMs} ms (Meta RNF01.1: ≤ 500 ms)
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0, minWidth: '220px' }}>
                  <label className="form-label" htmlFor="input-data-agendamento">
                    Data do Atendimento:
                  </label>
                  <input
                    id="input-data-agendamento"
                    type="date"
                    className="form-input"
                    value={rascunho.data}
                    onChange={(e) =>
                      setRascunho((prev) => ({
                        ...prev,
                        data: e.target.value,
                        slotEscolhido: null,
                      }))
                    }
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '260px' }}>
                  <label className="form-label" htmlFor="input-obs-agendamento">
                    Observações para o barbeiro (opcional):
                  </label>
                  <input
                    id="input-obs-agendamento"
                    type="text"
                    className="form-input"
                    placeholder="Ex.: Degradê navalhado médio, barba desenhada..."
                    value={rascunho.observacoes}
                    onChange={(e) => setRascunho((prev) => ({ ...prev, observacoes: e.target.value }))}
                  />
                </div>
              </div>

              {carregandoSlots ? (
                <p style={{ marginTop: '1rem' }}>Consultando grade de horários...</p>
              ) : (
                <div className="slots-grid" role="listbox" aria-label="Horários disponíveis">
                  {slotsDisponiveis.map((slot) => {
                    const isSelected = rascunho.slotEscolhido?.horario === slot.horario;
                    return (
                      <button
                        key={slot.horario}
                        type="button"
                        disabled={!slot.disponivel}
                        className={`slot-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() =>
                          setRascunho((prev) => ({
                            ...prev,
                            slotEscolhido: slot,
                            profissionalEfetivoId:
                              prev.profissionalId !== 'qualquer'
                                ? Number(prev.profissionalId)
                                : slot.profissionaisDisponiveis[0]?.id,
                          }))
                        }
                      >
                        <div>{slot.horario}</div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 500, marginTop: '2px' }}>
                          {slot.disponivel
                            ? `${slot.profissionaisDisponiveis.length} vaga(s)`
                            : 'Ocupado'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Resumo da Seleção e Botão de Confirmação */}
              <div
                style={{
                  marginTop: '1.75rem',
                  paddingTop: '1.25rem',
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                    <strong>Resumo do Rascunho:</strong>{' '}
                    {servicoSelecionadoObj
                      ? `${servicoSelecionadoObj.nome} (R$ ${servicoSelecionadoObj.preco.toFixed(2)})`
                      : 'Nenhum serviço'}{' '}
                    • Data: <strong>{rascunho.data}</strong> • Horário:{' '}
                    <strong>{rascunho.slotEscolhido ? rascunho.slotEscolhido.horario : 'Não selecionado'}</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Pagamento realizado presencialmente na barbearia após o atendimento (RN03).
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '1rem', padding: '0.85rem 1.75rem' }}
                  onClick={iniciarConfirmacaoAgendamento}
                >
                  ✓ Confirmar Agendamento
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            ABA 2: MEUS AGENDAMENTOS - CANCELAR / REMARCAR (RU04, CS002, RN01)
           =================================================================== */}
        {abaAtiva === 'meus-agendamentos' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h1 className="section-title" style={{ marginBottom: '0.25rem' }}>
                  📅 Meus Agendamentos (CS002)
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                  Regra de Negócio RN01: Cancelamentos e remarcações são permitidos com pelo menos{' '}
                  <strong>2 horas de antecedência</strong> em relação ao horário agendado.
                </p>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setAbaAtiva('catalogo')}>
                + Novo Agendamento
              </button>
            </div>

            {meusAgendamentos.length === 0 ? (
              <div className="panel-box">
                <p>Você ainda não possui agendamentos registrados.</p>
              </div>
            ) : (
              meusAgendamentos.map((ag) => (
                <div
                  key={ag.id}
                  className="calendar-block"
                  style={{
                    borderLeftColor:
                      ag.status === 'CONFIRMADO'
                        ? '#3b82f6'
                        : ag.status === 'CONCLUIDO'
                        ? '#10b981'
                        : '#ef4444',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                      <span
                        className={`status-badge ${
                          ag.status === 'CONFIRMADO'
                            ? 'status-confirmado'
                            : ag.status === 'CONCLUIDO'
                            ? 'status-atendido'
                            : 'status-cancelado'
                        }`}
                      >
                        {ag.status === 'CONCLUIDO' ? 'ATENDIDO' : ag.status}
                      </span>
                      <strong>{ag.servico?.nome}</strong>
                      <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                        R$ {ag.servico?.preco?.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
                      Profissional: <strong>{ag.profissional?.nome}</strong> • Início:{' '}
                      <strong>{new Date(ag.dataHoraInicio).toLocaleString('pt-BR')}</strong>
                    </div>
                    {ag.observacoes && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Obs: {ag.observacoes}
                      </div>
                    )}
                  </div>

                  {ag.status === 'CONFIRMADO' && (
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => abrirModalRemarcacao(ag)}
                      >
                        🔄 Remarcar Horário
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => cancelarAgendamentoCliente(ag.id)}
                      >
                        ✕ Cancelar Horário
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ===================================================================
            ABA 3: PAINEL ADMINISTRATIVO E CALENDÁRIO (RU05, RF02, RNF02.1-02.4)
           =================================================================== */}
        {abaAtiva === 'admin' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <h1 className="section-title" style={{ marginBottom: '0.2rem' }}>
                  ⚙️ Painel Administrativo & Gestão de Agenda (RF02)
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Calendário visual com distinção por código de cores e rótulos textuais (RNF02.4),
                  bloqueio de horários de almoço/folga e gestão de profissionais.
                </p>
              </div>
              <span className="duration-tag">
                ⚡ Renderização da API: {calendarioAdmin.tempoProcessamentoMs} ms (Meta RNF02.1: ≤ 1000 ms)
              </span>
            </div>

            {/* Legenda de Cores e Rótulos Textuais (RNF02.4) */}
            <div className="panel-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.9rem' }}>Legenda de Status (RNF02.4):</strong>
                <span className="status-badge status-confirmado">● Confirmado (Azul)</span>
                <span className="status-badge status-bloqueado">■ Bloqueado / Folga (Âmbar)</span>
                <span className="status-badge status-atendido">✓ Atendido / Concluído (Verde)</span>
                <span className="status-badge status-cancelado">✕ Cancelado (Vermelho)</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="filtro-prof-admin" style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  Filtrar Barbeiro:
                </label>
                <select
                  id="filtro-prof-admin"
                  className="form-select"
                  style={{ width: 'auto' }}
                  value={filtroAdminProfissional}
                  onChange={(e) => setFiltroAdminProfissional(e.target.value)}
                >
                  <option value="">Toda a Equipe</option>
                  {calendarioAdmin.profissionais?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Calendário Diário/Semanal da Equipe */}
            <div className="panel-box">
              <h2 className="section-title">📆 Calendário de Atendimentos e Bloqueios ({calendarioAdmin.blocos?.length || 0} registros)</h2>
              {calendarioAdmin.blocos?.length === 0 ? (
                <p>Nenhum agendamento ou bloqueio encontrado.</p>
              ) : (
                calendarioAdmin.blocos?.map((bloco) => (
                  <div
                    key={bloco.id}
                    className="calendar-block"
                    style={{ borderLeftColor: bloco.corHex }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                        <span className={`status-badge ${bloco.badgeClass}`}>
                          {bloco.rotuloStatus}
                        </span>
                        <strong>{bloco.titulo}</strong>
                      </div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Profissional: <strong>{bloco.profissional?.nome}</strong> • Horário:{' '}
                        <strong>
                          {new Date(bloco.dataHoraInicio).toLocaleString('pt-BR')} até{' '}
                          {new Date(bloco.dataHoraFim).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </strong>
                      </div>
                      {bloco.cliente && (
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                          Contato do Cliente: {bloco.cliente.email} | {bloco.cliente.telefone}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {bloco.tipoBloco === 'AGENDAMENTO' && bloco.status === 'CONFIRMADO' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-success"
                            onClick={() => alterarStatusAgendamentoAdmin(bloco.agendamentoId, 'CONCLUIDO')}
                          >
                            ✓ Marcar Atendido
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => alterarStatusAgendamentoAdmin(bloco.agendamentoId, 'CANCELADO')}
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                      {bloco.tipoBloco === 'BLOQUEIO' && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => removerBloqueioAdmin(bloco.bloqueioId)}
                        >
                          Remover Bloqueio
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Grid de Formulários Administrativos: Bloqueio de Agenda + Cadastro de Profissional */}
            <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
              {/* Formulário 1: Bloquear Folga / Almoço (T18 / RF02) */}
              <form className="panel-box" onSubmit={criarBloqueioAdmin} style={{ marginBottom: 0 }}>
                <h3 className="section-title">🛑 Bloquear Horário (Almoço / Folga)</h3>
                <div className="form-group">
                  <label className="form-label">Profissional:</label>
                  <select
                    className="form-select"
                    value={formBloqueio.profissionalId}
                    onChange={(e) => setFormBloqueio({ ...formBloqueio, profissionalId: e.target.value })}
                    required
                  >
                    {calendarioAdmin.profissionais?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Data do Bloqueio:</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formBloqueio.data}
                    onChange={(e) => setFormBloqueio({ ...formBloqueio, data: e.target.value })}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Início:</label>
                    <input
                      type="time"
                      className="form-input"
                      value={formBloqueio.horaInicio}
                      onChange={(e) => setFormBloqueio({ ...formBloqueio, horaInicio: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Término:</label>
                    <input
                      type="time"
                      className="form-input"
                      value={formBloqueio.horaFim}
                      onChange={(e) => setFormBloqueio({ ...formBloqueio, horaFim: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Motivo:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formBloqueio.motivo}
                    onChange={(e) => setFormBloqueio({ ...formBloqueio, motivo: e.target.value })}
                    placeholder="Ex.: Horário de Almoço, Folga Excepcional"
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Registrar Bloqueio na Agenda
                </button>
              </form>

              {/* Formulário 2: Cadastrar Profissional e Turno de Funcionamento (T17 / RF02) */}
              <form className="panel-box" onSubmit={cadastrarProfissionalAdmin} style={{ marginBottom: 0 }}>
                <h3 className="section-title">✂️ Cadastrar Profissional & Turno</h3>
                <div className="form-group">
                  <label className="form-label">Nome Completo:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formNovoProfissional.nome}
                    onChange={(e) => setFormNovoProfissional({ ...formNovoProfissional, nome: e.target.value })}
                    placeholder="Ex.: Diego Martins"
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">E-mail:</label>
                    <input
                      type="email"
                      className="form-input"
                      value={formNovoProfissional.email}
                      onChange={(e) => setFormNovoProfissional({ ...formNovoProfissional, email: e.target.value })}
                      placeholder="diego@barbearia.com"
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Telefone:</label>
                    <input
                      type="text"
                      className="form-input"
                      value={formNovoProfissional.telefone}
                      onChange={(e) => setFormNovoProfissional({ ...formNovoProfissional, telefone: e.target.value })}
                      placeholder="(35) 99999-0000"
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Especialidade:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formNovoProfissional.especialidade}
                    onChange={(e) =>
                      setFormNovoProfissional({ ...formNovoProfissional, especialidade: e.target.value })
                    }
                    placeholder="Ex.: Corte Clássico & Barboterapia"
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Início do Turno:</label>
                    <input
                      type="time"
                      className="form-input"
                      value={formNovoProfissional.horaInicioTurno}
                      onChange={(e) =>
                        setFormNovoProfissional({ ...formNovoProfissional, horaInicioTurno: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Fim do Turno:</label>
                    <input
                      type="time"
                      className="form-input"
                      value={formNovoProfissional.horaFimTurno}
                      onChange={(e) =>
                        setFormNovoProfissional({ ...formNovoProfissional, horaFimTurno: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Adicionar Profissional à Equipe
                </button>
              </form>
            </div>

            {/* Gestão da Equipe Ativa + Novo Serviço */}
            <div className="grid-cards" style={{ marginTop: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
              <div className="panel-box" style={{ marginBottom: 0 }}>
                <h3 className="section-title">👥 Profissionais Ativos e Horários</h3>
                {calendarioAdmin.profissionais?.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.65rem 0',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <strong>{p.nome}</strong>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {p.especialidade} • Turno: {p.horaInicioTurno} às {p.horaFimTurno}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                      onClick={() => removerProfissionalAdmin(p.id)}
                    >
                      Desativar
                    </button>
                  </div>
                ))}
              </div>

              <form className="panel-box" onSubmit={cadastrarServicoAdmin} style={{ marginBottom: 0 }}>
                <h3 className="section-title">💈 Adicionar Serviço ao Catálogo</h3>
                <div className="form-group">
                  <label className="form-label">Nome do Serviço:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formNovoServico.nome}
                    onChange={(e) => setFormNovoServico({ ...formNovoServico, nome: e.target.value })}
                    placeholder="Ex.: Hidratação Facial"
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Preço (R$):</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      value={formNovoServico.preco}
                      onChange={(e) => setFormNovoServico({ ...formNovoServico, preco: e.target.value })}
                      placeholder="40.00"
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Duração (min):</label>
                    <select
                      className="form-select"
                      value={formNovoServico.duracaoMinutos}
                      onChange={(e) =>
                        setFormNovoServico({ ...formNovoServico, duracaoMinutos: Number(e.target.value) })
                      }
                    >
                      <option value={30}>30 minutos</option>
                      <option value={60}>60 minutos</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Descrição:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formNovoServico.descricao}
                    onChange={(e) => setFormNovoServico({ ...formNovoServico, descricao: e.target.value })}
                    placeholder="Descrição exibida no catálogo público"
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Salvar Serviço
                </button>
              </form>
            </div>

            {/* Log do Serviço Externo de Notificações (T21 / RE01) */}
            <div className="panel-box" style={{ marginTop: '1.5rem' }}>
              <h3 className="section-title">📨 Log de Disparos do Serviço Externo de Notificações (RE01)</h3>
              {notificacoesLog.length === 0 ? (
                <p>Nenhuma notificação disparada ainda.</p>
              ) : (
                notificacoesLog.slice(0, 8).map((n) => (
                  <div
                    key={n.id}
                    style={{
                      padding: '0.6rem 0',
                      borderBottom: '1px solid var(--border-color)',
                      fontSize: '0.86rem',
                    }}
                  >
                    <span className="tag-badge" style={{ marginRight: '0.5rem' }}>
                      {n.tipo}
                    </span>
                    <strong>{n.assunto}</strong> → {n.destinatario} ({new Date(n.enviadoEm).toLocaleTimeString('pt-BR')})
                    <div style={{ color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{n.mensagem}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            ABA 4: PERFIL DO USUÁRIO & PRIVACIDADE LGPD (RE01 / CT13)
           =================================================================== */}
        {abaAtiva === 'perfil' && sessao && (
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <div className="panel-box">
              <h1 className="section-title">👤 Meu Perfil & Privacidade (LGPD - RE01)</h1>
              <form onSubmit={salvarPerfilUsuario}>
                <div className="form-group">
                  <label className="form-label">E-mail (Identificador Único):</label>
                  <input type="email" className="form-input" value={sessao.usuario.email} disabled />
                </div>
                <div className="form-group">
                  <label className="form-label">Nome Completo:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formPerfil.nome}
                    onChange={(e) => setFormPerfil({ ...formPerfil, nome: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Telefone (para notificações de reserva):</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formPerfil.telefone}
                    onChange={(e) => setFormPerfil({ ...formPerfil, telefone: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Nova Senha (deixe em branco para manter a atual):</label>
                  <input
                    type="password"
                    className="form-input"
                    value={formPerfil.senhaNova}
                    onChange={(e) => setFormPerfil({ ...formPerfil, senhaNova: e.target.value })}
                    placeholder="Mínimo 6 caracteres (hash bcrypt - RNF01.2)"
                  />
                </div>
                <button type="submit" className="btn btn-primary">
                  Salvar Alterações de Perfil
                </button>
              </form>
            </div>

            <div className="panel-box" style={{ borderColor: '#ef4444' }}>
              <h2 className="section-title" style={{ color: '#fca5a5' }}>
                🛡️ Direito ao Esquecimento / Exclusão Definitiva (Lei nº 13.709/2018 - RE01)
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Em conformidade com a LGPD (RE01 / Caso de Teste CT13), seus dados de telefone e
                e-mail são utilizados exclusivamente para notificações de agendamento. Você pode
                solicitar a exclusão definitiva da sua conta e de todos os seus dados pessoais do
                banco de dados a qualquer momento.
              </p>
              <button type="button" className="btn btn-danger" onClick={solicitarExclusaoLGPD}>
                🗑️ Excluir Definitivamente Meus Dados Pessoais (LGPD)
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================
            ABA 5: TELA DE LOGIN / ACESSO DA EQUIPE INTERNA
           =================================================================== */}
        {abaAtiva === 'login' && (
          <div style={{ maxWidth: '480px', margin: '1rem auto' }}>
            <div className="panel-box">
              <h1 className="section-title">🔑 Autenticação de Usuário / Equipe</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.2rem' }}>
                Clientes podem agendar diretamente pelo Catálogo sem login prévio (Lazy
                Registration). Se você já tem conta ou faz parte da equipe interna, entre abaixo:
              </p>
              <form onSubmit={realizarLoginDireto}>
                <div className="form-group">
                  <label className="form-label" htmlFor="login-email">
                    E-mail:
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    className="form-input"
                    value={formLogin.email}
                    onChange={(e) => setFormLogin({ ...formLogin, email: e.target.value })}
                    placeholder="seu@email.com"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="login-senha">
                    Senha:
                  </label>
                  <input
                    id="login-senha"
                    type="password"
                    className="form-input"
                    value={formLogin.senha}
                    onChange={(e) => setFormLogin({ ...formLogin, senha: e.target.value })}
                    placeholder="••••••"
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Entrar no Sistema
                </button>
              </form>

              <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                  Credenciais pré-cadastradas (Seed) para testes rápidos:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => loginRapidoDemo('admin@barbearia.com')}
                  >
                    🛠️ Entrar como Administrador (admin@barbearia.com)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => loginRapidoDemo('rafael@barbearia.com')}
                  >
                    ✂️ Entrar como Barbeiro (rafael@barbearia.com)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => loginRapidoDemo('gabriel@cliente.com')}
                  >
                    👤 Entrar como Cliente (gabriel@cliente.com)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* =====================================================================
          MODAL 1: LAZY REGISTRATION & CONSENTIMENTO LGPD NA CONFIRMAÇÃO (CS001)
         ===================================================================== */}
      {modalConfirmacaoAberto && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-box">
            <h2 className="section-title">Finalizar Reserva (Lazy Registration - RN02)</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Sua escolha de horário (<strong>{rascunho.data} às {rascunho.slotEscolhido?.horario}</strong>) está
              preservada! Identifique-se abaixo para confirmar a reserva.
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <button
                type="button"
                className={`btn ${modoIdentificacao === 'cadastro' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setModoIdentificacao('cadastro')}
              >
                Primeiro Acesso (Cadastro Rápido)
              </button>
              <button
                type="button"
                className={`btn ${modoIdentificacao === 'login' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setModoIdentificacao('login')}
              >
                Já tenho conta
              </button>
            </div>

            {modoIdentificacao === 'cadastro' ? (
              <div>
                <div className="form-group">
                  <label className="form-label">Nome Completo *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Seu nome completo"
                    value={formLazy.nome}
                    onChange={(e) => setFormLazy({ ...formLazy, nome: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">E-mail *</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="cliente@email.com"
                    value={formLazy.email}
                    onChange={(e) => setFormLazy({ ...formLazy, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Telefone / WhatsApp *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="(35) 99999-9999"
                    value={formLazy.telefone}
                    onChange={(e) => setFormLazy({ ...formLazy, telefone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Crie uma Senha (para consultar/cancelar depois)</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Mínimo 6 caracteres"
                    value={formLazy.senha}
                    onChange={(e) => setFormLazy({ ...formLazy, senha: e.target.value })}
                  />
                </div>

                {/* RE01 (LGPD): Consentimento Explícito Obrigatório */}
                <label className="checkbox-group" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formLazy.aceiteLGPD}
                    onChange={(e) => setFormLazy({ ...formLazy, aceiteLGPD: e.target.checked })}
                  />
                  <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                    <strong>Termo de Consentimento LGPD (Lei nº 13.709/2018 - RE01):</strong> Autorizo
                    explicitamente o uso do meu telefone e e-mail estritamente para envio de
                    notificações sobre esta reserva, ciente de que posso excluir meus dados a
                    qualquer momento.
                  </span>
                </label>
              </div>
            ) : (
              <div>
                <div className="form-group">
                  <label className="form-label">E-mail Cadastrado *</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="gabriel@cliente.com"
                    value={formLazy.email}
                    onChange={(e) => setFormLazy({ ...formLazy, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Senha *</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Sua senha"
                    value={formLazy.senha}
                    onChange={(e) => setFormLazy({ ...formLazy, senha: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setModalConfirmacaoAberto(false)}
              >
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => submeterReservaFinal(formLazy)}
              >
                Confirmar e Reservar Vaga
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: REMARCAÇÃO DE HORÁRIO (CS002 - Fluxo Alternativo 1A)
         ===================================================================== */}
      {agendamentoRemarcando && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-box">
            <h2 className="section-title">🔄 Remarcar Horário (CS002 - 1A)</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Mantendo o serviço <strong>{agendamentoRemarcando.servico?.nome}</strong> com o
              profissional <strong>{agendamentoRemarcando.profissional?.nome}</strong>.
            </p>

            <div className="form-group">
              <label className="form-label">Nova Data:</label>
              <input
                type="date"
                className="form-input"
                value={novaDataRemarcacao}
                onChange={(e) => {
                  setNovaDataRemarcacao(e.target.value);
                  setNovoSlotRemarcacao(null);
                  buscarSlotsRemarcacao(agendamentoRemarcando, e.target.value);
                }}
              />
            </div>

            <div className="slots-grid">
              {slotsRemarcacao.map((slot) => (
                <button
                  key={slot.horario}
                  type="button"
                  disabled={!slot.disponivel}
                  className={`slot-btn ${novoSlotRemarcacao?.horario === slot.horario ? 'selected' : ''}`}
                  onClick={() => setNovoSlotRemarcacao(slot)}
                >
                  {slot.horario}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAgendamentoRemarcando(null)}
              >
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmarRemarcacao}>
                Confirmar Novo Horário
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
