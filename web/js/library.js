/* The learner's subject library: the subjects they added from the catalog (/subjects).
   Kept in the store under `library` (the app paints the sidebar from it); null = not loaded. */

import { get, put, del } from './api.js';
import { store } from './store.js';

export async function loadLibrary() {
  try {
    return store.set('library', await get('/api/me/subjects', { silent: true }));
  } catch (err) {
    store.set('library', null);
    throw err;
  }
}

export function inLibrary(id) {
  return (store.get('library') || []).some((s) => s.id === id);
}

export async function addSubject(id) {
  return store.set('library', await put(`/api/me/subjects/${encodeURIComponent(id)}`));
}

export async function removeSubject(id) {
  return store.set('library', await del(`/api/me/subjects/${encodeURIComponent(id)}`));
}

/** Add or remove; returns whether the subject is in the library afterwards. */
export async function toggleSubject(id) {
  if (inLibrary(id)) {
    await removeSubject(id);
    return false;
  }
  await addSubject(id);
  return true;
}
