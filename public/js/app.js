/*
 * App Corrida. Logica do painel do paciente (dashboard).
 *
 * Responsabilidades:
 *  - Garantir sessao de paciente ativo (AppAuth.requirePatient).
 *  - Listar as provas do paciente da tabela races.
 *  - Mostrar contagem regressiva, distancias e status do kit por prova.
 *  - Alternar races.kit_picked_up.
 *  - Fluxo de adicionar prova: extrair dados via /api/extract-race,
 *    revisar em formulario editavel e inserir a linha em races.
 *
 * Seguranca: todo texto vindo da prova e renderizado com textContent ou
 * nos de DOM. Nunca usamos innerHTML com dados do usuario ou extraidos (XSS).
 * Todas as chamadas ao Supabase usam AppAuth.client.
 */
(function () {
  'use strict';

  // ===== Atalhos de DOM =====
  function $(id) {
    return document.getElementById(id);
  }
  function show(el) {
    if (el) el.classList.remove('hidden');
  }
  function hide(el) {
    if (el) el.classList.add('hidden');
  }

  // Estado da pagina.
  var currentProfile = null;

  // Referencias de elementos (preenchidas no init).
  var els = {};

  // ===== Datas =====

  // Interpreta "yyyy-mm-dd" como data local (sem fuso) para evitar deslocamento de dia.
  function parseISODateLocal(iso) {
    if (!iso || typeof iso !== 'string') return null;
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  // "yyyy-mm-dd" -> "DD/MM/YYYY". Retorna '' se invalido.
  function isoToBR(iso) {
    var d = parseISODateLocal(iso);
    if (!d) return '';
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = String(d.getFullYear());
    return dd + '/' + mm + '/' + yyyy;
  }

  // "DD/MM/YYYY" -> "yyyy-mm-dd" (para o input date). Retorna '' se invalido.
  function brToISO(value) {
    if (!value || typeof value !== 'string') return '';
    var v = value.trim();
    // Se ja vier no formato ISO (yyyy-mm-dd), usa direto.
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    var dd = m[1].padStart(2, '0');
    var mm = m[2].padStart(2, '0');
    var yyyy = m[3];
    return yyyy + '-' + mm + '-' + dd;
  }

  // Numero de dias inteiros de hoje ate a data ISO (negativo se ja passou).
  function daysUntil(iso) {
    var target = parseISODateLocal(iso);
    if (!target) return null;
    var diff = target.getTime() - startOfToday().getTime();
    return Math.round(diff / 86400000);
  }

  // ===== Contagem regressiva =====
  // Monta o bloco .countdown apropriado para a data da prova.
  function buildCountdown(iso) {
    var box = document.createElement('div');
    box.className = 'countdown';

    if (!iso) {
      box.classList.add('is-unknown');
      var u = document.createElement('span');
      u.className = 'countdown-label';
      u.textContent = 'Data a confirmar';
      box.appendChild(u);
      return box;
    }

    var days = daysUntil(iso);

    if (days === null) {
      box.classList.add('is-unknown');
      var x = document.createElement('span');
      x.className = 'countdown-label';
      x.textContent = 'Data a confirmar';
      box.appendChild(x);
      return box;
    }

    if (days < 0) {
      box.classList.add('is-past');
      var p = document.createElement('span');
      p.className = 'countdown-label';
      p.textContent = 'Prova realizada';
      box.appendChild(p);
      return box;
    }

    if (days === 0) {
      box.classList.add('is-soon');
      var h = document.createElement('span');
      h.className = 'countdown-label';
      h.textContent = 'E hoje!';
      box.appendChild(h);
      return box;
    }

    if (days <= 7) {
      box.classList.add('is-soon');
    }
    var num = document.createElement('span');
    num.className = 'countdown-number';
    num.textContent = String(days);
    var lab = document.createElement('span');
    lab.className = 'countdown-label';
    lab.textContent = days === 1 ? 'dia restante' : 'dias restantes';
    box.appendChild(num);
    box.appendChild(lab);
    return box;
  }

  // ===== Construcao de um campo rotulado (seguro) =====
  function buildField(label, value) {
    var wrap = document.createElement('div');
    wrap.className = 'card-field';
    var l = document.createElement('div');
    l.className = 'field-label';
    l.textContent = label;
    var v = document.createElement('div');
    v.className = 'field-value';
    if (value) {
      v.textContent = value; // textContent: seguro contra XSS
    } else {
      v.textContent = 'Nao informado';
      v.classList.add('muted');
    }
    wrap.appendChild(l);
    wrap.appendChild(v);
    return wrap;
  }

  // ===== Cartao de uma prova =====
  function buildRaceCard(race) {
    var card = document.createElement('div');
    card.className = 'card';

    // Cabecalho: nome + contagem regressiva.
    var header = document.createElement('div');
    header.className = 'card-header';

    var titleWrap = document.createElement('div');
    var title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = race.name || 'Prova sem nome';
    titleWrap.appendChild(title);

    if (race.location) {
      var loc = document.createElement('p');
      loc.className = 'muted small mb-0';
      loc.textContent = race.location;
      titleWrap.appendChild(loc);
    }

    header.appendChild(titleWrap);
    header.appendChild(buildCountdown(race.race_date));
    card.appendChild(header);

    // Grade de campos.
    var grid = document.createElement('div');
    grid.className = 'card-grid';
    grid.appendChild(buildField('Data', race.race_date ? isoToBR(race.race_date) : ''));
    grid.appendChild(buildField('Distancias', race.distances));
    grid.appendChild(buildField('Local de largada', race.location));
    grid.appendChild(buildField('Retirada do kit', race.kit_pickup_date));
    grid.appendChild(buildField('Local de retirada', race.kit_pickup_location));
    card.appendChild(grid);

    // Resumo do percurso e observacoes (opcionais).
    if (race.route_summary) {
      var rs = document.createElement('div');
      rs.className = 'card-field mt-3';
      var rsl = document.createElement('div');
      rsl.className = 'field-label';
      rsl.textContent = 'Resumo do percurso';
      var rsv = document.createElement('div');
      rsv.className = 'field-value';
      rsv.textContent = race.route_summary;
      rs.appendChild(rsl);
      rs.appendChild(rsv);
      card.appendChild(rs);
    }

    if (race.notes) {
      var nt = document.createElement('div');
      nt.className = 'card-field mt-3';
      var ntl = document.createElement('div');
      ntl.className = 'field-label';
      ntl.textContent = 'Observacoes';
      var ntv = document.createElement('div');
      ntv.className = 'field-value';
      ntv.textContent = race.notes;
      nt.appendChild(ntl);
      nt.appendChild(ntv);
      card.appendChild(nt);
    }

    // Divisor.
    var hr = document.createElement('hr');
    hr.className = 'divider';
    card.appendChild(hr);

    // Rodape: status do kit + acoes.
    var foot = document.createElement('div');
    foot.className = 'row row-between';

    var badge = document.createElement('span');
    updateKitBadge(badge, race.kit_picked_up);

    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-secondary btn-sm';
    toggleBtn.textContent = race.kit_picked_up
      ? 'Marcar kit como pendente'
      : 'Marcar kit como retirado';
    toggleBtn.addEventListener('click', function () {
      toggleKit(race, badge, toggleBtn);
    });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Remover';
    deleteBtn.addEventListener('click', function () {
      deleteRace(race, card, deleteBtn);
    });

    actions.appendChild(toggleBtn);
    actions.appendChild(deleteBtn);

    foot.appendChild(badge);
    foot.appendChild(actions);
    card.appendChild(foot);

    return card;
  }

  function updateKitBadge(badge, picked) {
    badge.className = 'badge ' + (picked ? 'badge-ok' : 'badge-pending');
    badge.textContent = picked ? 'Kit retirado' : 'Kit pendente';
  }

  // ===== Alternar status do kit =====
  async function toggleKit(race, badge, btn) {
    var newValue = !race.kit_picked_up;
    btn.disabled = true;
    try {
      var result = await window.AppAuth.client
        .from('races')
        .update({ kit_picked_up: newValue })
        .eq('id', race.id);
      if (result.error) {
        throw result.error;
      }
      race.kit_picked_up = newValue;
      updateKitBadge(badge, newValue);
      btn.textContent = newValue ? 'Marcar kit como pendente' : 'Marcar kit como retirado';
    } catch (err) {
      console.error('App Corrida: erro ao atualizar o kit.', err);
      alert('Nao foi possivel atualizar o status do kit. Tente novamente.');
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Remover prova =====
  async function deleteRace(race, card, btn) {
    var confirmed = window.confirm(
      'Remover a prova "' + (race.name || 'sem nome') + '"? Esta acao nao pode ser desfeita.'
    );
    if (!confirmed) return;
    btn.disabled = true;
    try {
      var result = await window.AppAuth.client.from('races').delete().eq('id', race.id);
      if (result.error) {
        throw result.error;
      }
      card.parentNode.removeChild(card);
      // Se a lista ficou vazia, mostra o estado vazio.
      if (els.racesList.children.length === 0) {
        hide(els.racesList);
        show(els.emptyState);
      }
    } catch (err) {
      console.error('App Corrida: erro ao remover a prova.', err);
      alert('Nao foi possivel remover a prova. Tente novamente.');
      btn.disabled = false;
    }
  }

  // ===== Carregar a lista de provas =====
  async function loadRaces() {
    hide(els.listError);
    hide(els.emptyState);
    hide(els.racesList);
    show(els.loadingState);
    els.racesList.textContent = '';

    try {
      var result = await window.AppAuth.client
        .from('races')
        .select('*')
        .eq('user_id', currentProfile.id)
        .order('race_date', { ascending: true, nullsFirst: false });

      hide(els.loadingState);

      if (result.error) {
        throw result.error;
      }

      var races = result.data || [];
      if (races.length === 0) {
        show(els.emptyState);
        return;
      }

      for (var i = 0; i < races.length; i++) {
        els.racesList.appendChild(buildRaceCard(races[i]));
      }
      show(els.racesList);
    } catch (err) {
      console.error('App Corrida: erro ao carregar as provas.', err);
      hide(els.loadingState);
      els.listError.textContent =
        'Nao foi possivel carregar suas provas. Atualize a pagina e tente novamente.';
      show(els.listError);
    }
  }

  // ===== Modal: adicionar prova =====
  function openModal() {
    resetModalToExtract();
    els.raceModal.classList.add('is-open');
  }

  function closeModal() {
    els.raceModal.classList.remove('is-open');
  }

  function resetModalToExtract() {
    hide(els.modalError);
    hide(els.reviewWarning);
    els.modalError.textContent = '';
    els.reviewWarning.textContent = '';

    // Limpa campos da etapa 1.
    els.raceNameInput.value = '';
    els.raceUrlInput.value = '';

    // Mostra etapa de extracao.
    show(els.extractStep);
    hide(els.reviewStep);
    els.modalTitle.textContent = 'Adicionar prova';

    // Rodape: etapa 1.
    show(els.cancelBtn);
    show(els.extractBtn);
    hide(els.backBtn);
    hide(els.saveBtn);

    els.extractBtn.disabled = false;
    els.extractBtn.textContent = 'Extrair dados';
  }

  function showReviewStep() {
    hide(els.extractStep);
    show(els.reviewStep);
    els.modalTitle.textContent = 'Revisar prova';

    hide(els.cancelBtn);
    hide(els.extractBtn);
    show(els.backBtn);
    show(els.saveBtn);

    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'Salvar prova';
  }

  function backToExtractStep() {
    hide(els.modalError);
    els.modalError.textContent = '';
    show(els.extractStep);
    hide(els.reviewStep);
    els.modalTitle.textContent = 'Adicionar prova';

    show(els.cancelBtn);
    show(els.extractBtn);
    hide(els.backBtn);
    hide(els.saveBtn);
  }

  // Preenche o formulario de revisao com os dados retornados (via .value: seguro).
  function fillReviewForm(data, fallbackName) {
    data = data || {};
    els.fName.value = data.name || fallbackName || '';
    els.fDate.value = data.race_date ? brToISO(data.race_date) : '';
    els.fLocation.value = data.location || '';
    els.fDistances.value = data.distances || '';
    els.fKitDate.value = data.kit_pickup_date || '';
    els.fKitLocation.value = data.kit_pickup_location || '';
    els.fRoute.value = data.route_summary || '';
    els.fNotes.value = data.notes || '';
  }

  // ===== Extrair dados da prova =====
  async function handleExtract() {
    hide(els.modalError);
    els.modalError.textContent = '';

    var url = els.raceUrlInput.value.trim();
    var name = els.raceNameInput.value.trim();

    if (!url) {
      els.modalError.textContent = 'Informe o link oficial da prova.';
      show(els.modalError);
      return;
    }

    els.extractBtn.disabled = true;
    els.extractBtn.textContent = 'Extraindo...';

    try {
      // Envia o token da sessao para autenticar a chamada no servidor.
      var token = null;
      try {
        var sess = await window.AppAuth.getSession();
        token = sess && sess.access_token ? sess.access_token : null;
      } catch (sessErr) {
        token = null;
      }
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;

      var resp = await fetch('/api/extract-race', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ url: url, name: name || undefined })
      });

      var payload = null;
      try {
        payload = await resp.json();
      } catch (parseErr) {
        payload = null;
      }

      if (!resp.ok) {
        var errMsg =
          payload && payload.error
            ? payload.error
            : 'Nao foi possivel extrair os dados. Tente novamente.';
        els.modalError.textContent = errMsg;
        show(els.modalError);
        els.extractBtn.disabled = false;
        els.extractBtn.textContent = 'Extrair dados';
        return;
      }

      var data = payload && payload.data ? payload.data : {};
      fillReviewForm(data, name);

      // Aviso retornado pelo servidor (quando a extracao foi parcial ou falhou).
      if (payload && payload.warning) {
        els.reviewWarning.textContent = payload.warning;
        show(els.reviewWarning);
      } else {
        hide(els.reviewWarning);
        els.reviewWarning.textContent = '';
      }

      showReviewStep();
    } catch (err) {
      console.error('App Corrida: erro ao chamar a extracao.', err);
      els.modalError.textContent =
        'Falha de conexao ao extrair os dados. Verifique sua internet e tente de novo.';
      show(els.modalError);
      els.extractBtn.disabled = false;
      els.extractBtn.textContent = 'Extrair dados';
    }
  }

  // ===== Salvar a prova (insere em races) =====
  async function handleSave() {
    hide(els.modalError);
    els.modalError.textContent = '';

    var name = els.fName.value.trim();
    if (!name) {
      els.modalError.textContent = 'O nome da prova e obrigatorio.';
      show(els.modalError);
      return;
    }

    // O input date ja entrega "yyyy-mm-dd"; vazio vira null.
    var isoDate = els.fDate.value ? els.fDate.value : null;

    var row = {
      user_id: currentProfile.id,
      name: name,
      url: els.raceUrlInput.value.trim() || null,
      race_date: isoDate,
      location: els.fLocation.value.trim() || null,
      distances: els.fDistances.value.trim() || null,
      kit_pickup_date: els.fKitDate.value.trim() || null,
      kit_pickup_location: els.fKitLocation.value.trim() || null,
      route_summary: els.fRoute.value.trim() || null,
      notes: els.fNotes.value.trim() || null
    };

    els.saveBtn.disabled = true;
    els.saveBtn.textContent = 'Salvando...';

    try {
      var result = await window.AppAuth.client.from('races').insert(row);
      if (result.error) {
        throw result.error;
      }
      closeModal();
      await loadRaces();
    } catch (err) {
      console.error('App Corrida: erro ao salvar a prova.', err);
      els.modalError.textContent =
        'Nao foi possivel salvar a prova. Confira os dados e tente novamente.';
      show(els.modalError);
      els.saveBtn.disabled = false;
      els.saveBtn.textContent = 'Salvar prova';
    }
  }

  // ===== Sair =====
  async function handleSignOut() {
    await window.AppAuth.signOut();
    window.location.href = '/index.html';
  }

  // ===== Inicializacao =====
  async function init() {
    // Mapeia elementos.
    els.userName = $('userName');
    els.signOutBtn = $('signOutBtn');
    els.addRaceBtn = $('addRaceBtn');
    els.emptyAddBtn = $('emptyAddBtn');
    els.listError = $('listError');
    els.loadingState = $('loadingState');
    els.emptyState = $('emptyState');
    els.racesList = $('racesList');

    els.raceModal = $('raceModal');
    els.modalTitle = $('raceModalTitle');
    els.modalCloseBtn = $('modalCloseBtn');
    els.modalError = $('modalError');
    els.extractStep = $('extractStep');
    els.reviewStep = $('reviewStep');
    els.reviewWarning = $('reviewWarning');
    els.raceNameInput = $('raceNameInput');
    els.raceUrlInput = $('raceUrlInput');
    els.fName = $('fName');
    els.fDate = $('fDate');
    els.fLocation = $('fLocation');
    els.fDistances = $('fDistances');
    els.fKitDate = $('fKitDate');
    els.fKitLocation = $('fKitLocation');
    els.fRoute = $('fRoute');
    els.fNotes = $('fNotes');
    els.cancelBtn = $('cancelBtn');
    els.extractBtn = $('extractBtn');
    els.backBtn = $('backBtn');
    els.saveBtn = $('saveBtn');

    // Garante sessao de paciente ativo. Redireciona se necessario.
    var profile = await window.AppAuth.requirePatient();
    if (!profile) {
      return; // requirePatient ja esta redirecionando.
    }
    currentProfile = profile;

    // Nome do paciente na topbar.
    els.userName.textContent = profile.full_name || profile.email || 'Paciente';

    // Eventos.
    els.signOutBtn.addEventListener('click', handleSignOut);
    els.addRaceBtn.addEventListener('click', openModal);
    if (els.emptyAddBtn) els.emptyAddBtn.addEventListener('click', openModal);

    els.modalCloseBtn.addEventListener('click', closeModal);
    els.cancelBtn.addEventListener('click', closeModal);
    els.backBtn.addEventListener('click', backToExtractStep);
    els.extractBtn.addEventListener('click', handleExtract);
    els.saveBtn.addEventListener('click', handleSave);

    // Fecha ao clicar fora do modal.
    els.raceModal.addEventListener('click', function (e) {
      if (e.target === els.raceModal) {
        closeModal();
      }
    });
    // Fecha com a tecla Escape.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els.raceModal.classList.contains('is-open')) {
        closeModal();
      }
    });

    // Carrega as provas.
    await loadRaces();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
