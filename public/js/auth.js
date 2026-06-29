/*
 * App Corrida. Modulo compartilhado de autenticacao.
 * Expoe window.AppAuth com o cliente Supabase e os helpers de sessao.
 *
 * Ordem de carregamento esperada em cada pagina:
 *   1. https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2  (global "supabase")
 *   2. /config.js  (define window.__APP_CONFIG__)
 *   3. /js/auth.js (este arquivo)
 *   4. script da pagina (app.js ou admin.js)
 *
 * Sem dependencias extras. Defensivo contra sessao ou perfil nulos.
 */
(function () {
  'use strict';

  var config = window.__APP_CONFIG__ || {};
  var supabaseUrl = config.supabaseUrl;
  var supabaseAnonKey = config.supabaseAnonKey;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      'App Corrida: configuracao ausente. Verifique se /config.js foi carregado antes de auth.js.'
    );
  }

  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    console.error(
      'App Corrida: biblioteca do Supabase nao encontrada. Carregue o CDN do supabase-js antes de auth.js.'
    );
  }

  // Cliente unico do Supabase, reutilizado por todas as paginas.
  var client = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

  // Mensagem em portugues exibida quando o paciente esta desativado.
  var INACTIVE_MESSAGE =
    'Sua conta esta desativada. Entre em contato com a nutricionista para reativar o acesso.';

  /**
   * Faz login com email e senha. Lanca erro em caso de falha.
   */
  async function signIn(email, password) {
    var result = await client.auth.signInWithPassword({
      email: email,
      password: password
    });
    if (result.error) {
      throw result.error;
    }
    return result.data;
  }

  /**
   * Cria uma nova conta de paciente. O nome completo vai como metadata
   * para que o trigger do banco preencha o perfil. Lanca erro em caso de falha.
   */
  async function signUp(fullName, email, password) {
    var result = await client.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: fullName }
      }
    });
    if (result.error) {
      throw result.error;
    }
    return result.data;
  }

  /**
   * Encerra a sessao atual.
   */
  async function signOut() {
    try {
      await client.auth.signOut();
    } catch (err) {
      console.error('App Corrida: erro ao sair.', err);
    }
  }

  /**
   * Retorna a sessao atual ou null.
   */
  async function getSession() {
    try {
      var result = await client.auth.getSession();
      if (result && result.data && result.data.session) {
        return result.data.session;
      }
      return null;
    } catch (err) {
      console.error('App Corrida: erro ao obter a sessao.', err);
      return null;
    }
  }

  /**
   * Retorna a linha de profiles do usuario logado ou null.
   * { id, full_name, email, role, active }
   */
  async function getProfile() {
    var session = await getSession();
    if (!session || !session.user || !session.user.id) {
      return null;
    }
    try {
      var result = await client
        .from('profiles')
        .select('id, full_name, email, role, active')
        .eq('id', session.user.id)
        .maybeSingle();
      if (result.error) {
        console.error('App Corrida: erro ao carregar o perfil.', result.error);
        return null;
      }
      return result.data || null;
    } catch (err) {
      console.error('App Corrida: erro ao carregar o perfil.', err);
      return null;
    }
  }

  function redirectTo(path) {
    window.location.href = path;
  }

  /**
   * Garante que ha sessao e perfil ativo para usar o painel do paciente.
   * - Sem sessao: redireciona para /index.html.
   * - Perfil inativo: sai, alerta em portugues e redireciona para /index.html.
   * - Perfil admin: redireciona para /admin.html.
   * Retorna o perfil em caso de sucesso.
   */
  async function requirePatient() {
    var session = await getSession();
    if (!session) {
      redirectTo('/index.html');
      return null;
    }

    var profile = await getProfile();
    if (!profile) {
      // Sem perfil acessivel (pode estar bloqueado pela RLS). Trata como sem acesso.
      await signOut();
      redirectTo('/index.html');
      return null;
    }

    if (profile.active !== true) {
      await signOut();
      alert(INACTIVE_MESSAGE);
      redirectTo('/index.html');
      return null;
    }

    if (profile.role === 'admin') {
      redirectTo('/admin.html');
      return null;
    }

    return profile;
  }

  /**
   * Garante que ha sessao com perfil de admin ativo para usar o painel.
   * - Sem sessao: redireciona para /index.html.
   * - Perfil inativo: sai, alerta em portugues e redireciona para /index.html.
   * - Paciente (nao admin): redireciona para /dashboard.html.
   * Retorna o perfil em caso de sucesso.
   */
  async function requireAdmin() {
    var session = await getSession();
    if (!session) {
      redirectTo('/index.html');
      return null;
    }

    var profile = await getProfile();
    if (!profile) {
      await signOut();
      redirectTo('/index.html');
      return null;
    }

    if (profile.active !== true) {
      await signOut();
      alert(INACTIVE_MESSAGE);
      redirectTo('/index.html');
      return null;
    }

    if (profile.role !== 'admin') {
      redirectTo('/dashboard.html');
      return null;
    }

    return profile;
  }

  window.AppAuth = {
    client: client,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    getSession: getSession,
    getProfile: getProfile,
    requirePatient: requirePatient,
    requireAdmin: requireAdmin
  };
})();
