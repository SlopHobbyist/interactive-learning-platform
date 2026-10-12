/* Ory Kratos self-service flows, run as JSON "browser flows" through the app's /kratos/ proxy.

   Every flow has the same shape: create it (GET …/browser), submit it (POST …?flow=id) with the
   flow's CSRF token, and read either a success body or the flow again with messages on it.
   Kratos sets its CSRF and session cookies on our origin, so fetch only needs same-origin
   credentials. See docs/ARCHITECTURE.md (Accounts). */

const BASE = '/kratos';

export class FlowError extends Error {
  constructor(message, { status = 0, id = '', data = null } = {}) {
    super(message);
    this.status = status;
    this.id = id;        // Kratos error id, e.g. session_already_available, self_service_flow_expired
    this.data = data;
  }
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new FlowError('The server could not be reached. Check your connection and try again.');
  }
  let data = null;
  const text = await response.text();
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  return { status: response.status, data };
}

/** A FlowError from a non-flow error body ({ error: { id, message, reason } }). */
function errorFrom(status, data) {
  const err = (data && data.error) || {};
  const message = err.reason || err.message || (data && data.detail) || `The account service answered ${status}.`;
  return new FlowError(message, { status, id: err.id || '', data });
}

/** Start a flow: kind = login | registration | recovery | settings. */
export async function createFlow(kind, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const { status, data } = await request('GET', `/self-service/${kind}/browser${qs ? `?${qs}` : ''}`);
  if (status !== 200) throw errorFrom(status, data);
  return data;
}

export async function getFlow(kind, id) {
  const { status, data } = await request('GET', `/self-service/${kind}/flows?id=${encodeURIComponent(id)}`);
  if (status !== 200) throw errorFrom(status, data);
  return data;
}

function csrfToken(flow) {
  const node = (flow.ui && flow.ui.nodes || []).find((n) => n.attributes && n.attributes.name === 'csrf_token');
  return node ? node.attributes.value : '';
}

/** The value Kratos put on a flow's input (e.g. the identifier on a refresh login). */
export function nodeValue(flow, name) {
  const node = (flow.ui && flow.ui.nodes || []).find((n) => n.attributes && n.attributes.name === name);
  return node ? node.attributes.value : undefined;
}

/**
 * Submit a flow. Resolves to one of:
 *   { ok: true, data }                       success (200 with no error messages)
 *   { ok: false, flow, messages }             the flow came back with errors to show
 *   { ok: false, redirect, data }             Kratos wants the browser elsewhere (422)
 * Throws FlowError for expired flows, CSRF failures and other hard errors.
 */
export async function submitFlow(kind, flow, body) {
  const { status, data } = await request('POST', `/self-service/${kind}?flow=${encodeURIComponent(flow.id)}`, {
    csrf_token: csrfToken(flow),
    ...body,
  });
  if (status === 422 && data && data.redirect_browser_to) {
    return { ok: false, redirect: data.redirect_browser_to, data };
  }
  if (data && data.ui) {
    const messages = flowMessages(data);
    const ok = status === 200 && !messages.errors.length;
    return ok ? { ok: true, data, flow: data } : { ok: false, flow: data, messages };
  }
  if (status === 200) return { ok: true, data };
  throw errorFrom(status, data);
}

/**
 * Collect a flow's messages: { errors: [text], info: [text], fields: { name: [text] } }.
 * Field messages are also listed in `errors`, so a form can show them all in one place.
 */
export function flowMessages(flow) {
  const out = { errors: [], info: [], fields: {} };
  const add = (m, field) => {
    if (m.type === 'error') {
      out.errors.push(m.text);
      if (field) (out.fields[field] ||= []).push(m.text);
    } else {
      out.info.push(m.text);
    }
  };
  for (const m of (flow.ui && flow.ui.messages) || []) add(m);
  for (const n of (flow.ui && flow.ui.nodes) || []) {
    for (const m of n.messages || []) add(m, n.attributes && n.attributes.name);
  }
  return out;
}

/** The settings flow id Kratos hands over after a successful recovery code. */
export function settingsFlowFrom(result) {
  const cont = (result.data && result.data.continue_with) || [];
  const show = cont.find((c) => c.action === 'show_settings_ui');
  if (show && show.flow) return show.flow.id;
  if (result.redirect) {
    try { return new URL(result.redirect, location.origin).searchParams.get('flow'); } catch { /* ignore */ }
  }
  return null;
}

export async function logout() {
  const { status, data } = await request('GET', '/self-service/logout/browser');
  if (status === 401) return; // already signed out
  if (status !== 200) throw errorFrom(status, data);
  const done = await request('GET', `/self-service/logout?token=${encodeURIComponent(data.logout_token)}`);
  if (done.status >= 400) throw errorFrom(done.status, done.data);
}
