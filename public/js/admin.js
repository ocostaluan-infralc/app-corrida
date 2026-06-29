/*
 * App Corrida. Logica do painel da nutricionista (admin).
 *
 * Carrega a visao geral de todos os pacientes (profiles role 'patient') e
 * suas provas (races). Permite ativar ou desativar o acesso de cada paciente.
 *
 * Seguranca: todo texto vindo do banco (nome, email, nome da prova, local) e
 * renderizado com textContent / nos do DOM. Nunca usamos innerHTML com dados
 * para evitar XSS. innerHTML so e usado para limpar containers ("").
 *
 * Depende de window.AppAuth (auth.js), ja carregado antes deste arquivo.
 */
(function () {
  'use strict';

  var client = window.AppAuth.client;

  // Referencias aos elementos da pagina.
  var els = {};

  // Estado em memoria. Permite refletir a troca de status sem recarregar a pagina.
  var state = {
    patients: [],
    racesByUser: {}
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheEls();

    // Garante sessao + perfil admin ativo. Caso contrario, requireAdmin redireciona.
    var profile = await window.AppAuth.requireAdmin();
    if (!profile) {
      return;
    }

    if (els.adminName) {
      els.adminName.textContent =
        profile.full_name || profile.email || 'Administradora';
    }

    if (els.signout) {
      els.signout.addEventListener('click', onSignOut);
    }

    await loadData();
  }

  function cacheEls() {
    els.adminName = document.getElementById('admin-name');
    els.signout = document.getElementById('signout-btn');
    els.alert = document.getElementById('alert-area');
    els.stats = document.getElementById('stats');
    els.loading = document.getElementById('loading');
    els.patients = document.getElementById('patients');
    els.empty = document.getElementById('empty');
  }

  async function onSignOut() {
    els.signout.disabled = true;
    await window.AppAuth.signOut();
    window.location.href = '/index.html';
  }

  /* ===== Carregamento dos dados ===== */

  async function loadData() {
    showLoading(true);
    clearAlert();

    try {
      // A RLS de admin permite ler todos os perfis e todas as provas.
      var profilesRes = await client
        .from('profiles')
        .select('id, full_name, email, role, active')
        .eq('role', 'patient')
        .order('full_name', { ascending: true });

      if (profilesRes.error) {
        throw profilesRes.error;
      }

      var racesRes = await client
        .from('races')
        .select('id, user_id, name, race_date, location')
        .order('race_date', { ascending: true });

      if (racesRes.error) {
        throw racesRes.error;
      }

      state.patients = profilesRes.data || [];
      state.racesByUser = groupByUser(racesRes.data || []);

      showLoading(false);
      render();
    } catch (err) {
      console.error('App Corrida: erro ao carregar o painel.', err);
      showLoading(false);
      showError(
        'Nao foi possivel carregar os pacientes. Verifique sua conexao e tente novamente.'
      );
    }
  }

  function groupByUser(races) {
    var map = {};
    for (var i = 0; i < races.length; i++) {
      var race = races[i];
      if (!map[race.user_id]) {
        map[race.user_id] = [];
      }
      map[race.user_id].push(race);
    }
    return map;
  }

  /* ===== Render ===== */

  function render() {
    renderStats();
    renderPatients();
  }

  function renderStats() {
    var total = state.patients.length;
    var active = 0;
    for (var i = 0; i < state.patients.length; i++) {
      if (state.patients[i].active === true) {
        active++;
      }
    }
    var inactive = total - active;

    var totalRaces = 0;
    var keys = Object.keys(state.racesByUser);
    for (var k = 0; k < keys.length; k++) {
      totalRaces += state.racesByUser[keys[k]].length;
    }

    els.stats.innerHTML = '';

    if (total === 0) {
      els.stats.classList.add('hidden');
      return;
    }
    els.stats.classList.remove('hidden');

    els.stats.appendChild(
      statBadge(total + ' ' + plural(total, 'paciente', 'pacientes'))
    );
    els.stats.appendChild(
      statBadge(active + ' ' + plural(active, 'ativo', 'ativos'), 'badge-ok')
    );
    if (inactive > 0) {
      els.stats.appendChild(
        statBadge(
          inactive + ' ' + plural(inactive, 'inativo', 'inativos'),
          'badge-muted'
        )
      );
    }
    els.stats.appendChild(
      statBadge(
        totalRaces +
          ' ' +
          plural(totalRaces, 'prova cadastrada', 'provas cadastradas'),
        'badge-admin'
      )
    );
  }

  function statBadge(text, variant) {
    var span = document.createElement('span');
    span.className = 'badge' + (variant ? ' ' + variant : '');
    span.textContent = text;
    return span;
  }

  function renderPatients() {
    els.patients.innerHTML = '';

    if (state.patients.length === 0) {
      els.empty.classList.remove('hidden');
      return;
    }
    els.empty.classList.add('hidden');

    for (var i = 0; i < state.patients.length; i++) {
      els.patients.appendChild(buildPatientCard(state.patients[i]));
    }
  }

  function buildPatientCard(patient) {
    var isActive = patient.active === true;

    var card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('data-patient-id', patient.id);

    /* Cabecalho: nome e email a esquerda; status e acao a direita. */
    var header = document.createElement('div');
    header.className = 'card-header';

    var info = document.createElement('div');

    var name = document.createElement('h3');
    name.className = 'card-title mb-0';
    name.textContent = patient.full_name || 'Sem nome';
    info.appendChild(name);

    var email = document.createElement('div');
    email.className = 'muted small';
    email.textContent = patient.email || 'Sem email';
    info.appendChild(email);

    header.appendChild(info);

    var actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.style.alignItems = 'center';

    actions.appendChild(statusBadge(isActive));

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-sm ' + (isActive ? 'btn-danger' : 'btn-primary');
    toggle.textContent = isActive ? 'Desativar' : 'Ativar';
    toggle.addEventListener('click', function () {
      onToggle(patient, toggle);
    });
    actions.appendChild(toggle);

    header.appendChild(actions);
    card.appendChild(header);

    /* Aviso quando o paciente esta inativo: deixa claro que ele nao entra no app. */
    if (!isActive) {
      var warn = document.createElement('div');
      warn.className = 'alert alert-warning';
      warn.textContent =
        'Paciente desativado. Ele nao consegue entrar no app nem ver suas provas ate ser reativado.';
      card.appendChild(warn);
    }

    /* Provas do paciente. */
    var races = state.racesByUser[patient.id] || [];

    var racesHeader = document.createElement('div');
    racesHeader.className = 'strong mt-4';
    racesHeader.textContent =
      'Provas (' + races.length + ')';
    card.appendChild(racesHeader);

    if (races.length === 0) {
      var none = document.createElement('p');
      none.className = 'muted small mt-3 mb-0';
      none.textContent = 'Nenhuma prova cadastrada ainda.';
      card.appendChild(none);
    } else {
      var list = document.createElement('div');
      list.className = 'stack mt-3';
      for (var j = 0; j < races.length; j++) {
        list.appendChild(buildRaceRow(races[j]));
      }
      card.appendChild(list);
    }

    return card;
  }

  function buildRaceRow(race) {
    var row = document.createElement('div');
    row.className = 'row row-between';

    var left = document.createElement('div');

    var rname = document.createElement('div');
    rname.className = 'strong';
    rname.textContent = race.name || 'Prova sem nome';
    left.appendChild(rname);

    var meta = document.createElement('div');
    meta.className = 'muted small';
    var metaText = formatDateBR(race.race_date);
    if (race.location) {
      metaText += ', ' + race.location;
    }
    meta.textContent = metaText;
    left.appendChild(meta);

    row.appendChild(left);
    row.appendChild(buildCountdown(race.race_date));

    return row;
  }

  /* ===== Acao: ativar / desativar paciente ===== */

  async function onToggle(patient, button) {
    // Se estava inativo, a acao ativa. Se estava ativo, a acao desativa.
    var makeActive = patient.active !== true;
    var label = patient.full_name || patient.email || 'este paciente';

    if (!makeActive) {
      var ok = window.confirm(
        'Desativar ' +
          label +
          '? Enquanto estiver desativado, ele nao conseguira entrar no app.'
      );
      if (!ok) {
        return;
      }
    }

    button.disabled = true;
    var originalText = button.textContent;
    button.textContent = makeActive ? 'Ativando...' : 'Desativando...';
    clearAlert();

    try {
      // A RLS de profiles UPDATE exige is_admin(); o admin ativo tem permissao.
      var res = await client
        .from('profiles')
        .update({ active: makeActive })
        .eq('id', patient.id)
        .select('id, full_name, email, role, active')
        .maybeSingle();

      if (res.error) {
        throw res.error;
      }

      // Atualiza o estado em memoria e re-renderiza, sem recarregar a pagina.
      patient.active = res.data ? res.data.active === true : makeActive;

      render();

      var displayName = patient.full_name || patient.email || 'Paciente';
      showSuccess(
        displayName + (patient.active ? ' foi ativado.' : ' foi desativado.')
      );
    } catch (err) {
      console.error(
        'App Corrida: erro ao atualizar o status do paciente.',
        err
      );
      // render() nao foi chamado: o botao original ainda existe, entao restauramos.
      button.disabled = false;
      button.textContent = originalText;
      showError(
        'Nao foi possivel atualizar o status do paciente. Tente novamente.'
      );
    }
  }

  /* ===== Badges e contagem regressiva ===== */

  function statusBadge(isActive) {
    var badge = document.createElement('span');
    badge.className = 'badge ' + (isActive ? 'badge-ok' : 'badge-muted');
    badge.textContent = isActive ? 'Ativo' : 'Inativo';
    return badge;
  }

  function buildCountdown(iso) {
    var badge = document.createElement('span');
    badge.className = 'badge';

    var days = daysUntil(iso);

    if (days === null) {
      badge.classList.add('badge-muted');
      badge.textContent = 'Data a confirmar';
    } else if (days < 0) {
      badge.classList.add('badge-muted');
      badge.textContent = 'Prova realizada';
    } else if (days === 0) {
      badge.classList.add('badge-pending');
      badge.textContent = 'Hoje';
    } else if (days <= 7) {
      badge.classList.add('badge-pending');
      badge.textContent =
        days === 1 ? 'Falta 1 dia' : 'Faltam ' + days + ' dias';
    } else {
      badge.classList.add('badge-ok');
      badge.textContent = 'Faltam ' + days + ' dias';
    }

    return badge;
  }

  /* ===== Datas ===== */

  // Converte "yyyy-mm-dd" (coluna DATE) em Date local a meia-noite. null se invalido.
  function parseISODate(iso) {
    if (!iso || typeof iso !== 'string') {
      return null;
    }
    var parts = iso.split('-');
    if (parts.length !== 3) {
      return null;
    }
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (!y || !m || !d) {
      return null;
    }
    return new Date(y, m - 1, d);
  }

  // Exibe a data como DD/MM/YYYY. Se nao houver data, "Data a confirmar".
  function formatDateBR(iso) {
    var dt = parseISODate(iso);
    if (!dt) {
      return 'Data a confirmar';
    }
    return pad2(dt.getDate()) + '/' + pad2(dt.getMonth() + 1) + '/' + dt.getFullYear();
  }

  // Dias restantes ate a prova, relativo a hoje. null se a data for invalida.
  function daysUntil(iso) {
    var dt = parseISODate(iso);
    if (!dt) {
      return null;
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diff = dt.getTime() - today.getTime();
    return Math.round(diff / 86400000);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /* ===== Utilitarios de UI ===== */

  function plural(n, singular, plural2) {
    return n === 1 ? singular : plural2;
  }

  function showLoading(on) {
    if (!els.loading) {
      return;
    }
    if (on) {
      els.loading.classList.remove('hidden');
    } else {
      els.loading.classList.add('hidden');
    }
  }

  function showError(msg) {
    renderAlert('alert-error', msg);
  }

  function showSuccess(msg) {
    renderAlert('alert-success', msg);
  }

  function renderAlert(variant, msg) {
    els.alert.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'alert ' + variant;
    div.textContent = msg;
    els.alert.appendChild(div);
  }

  function clearAlert() {
    els.alert.innerHTML = '';
  }
})();
