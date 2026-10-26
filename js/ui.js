import { $, esc } from './util.js';

let toastTimer;
export function toast(msg, ms = 3800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function openDialog(html, { wide = false } = {}) {
  const d = $('#dlg');
  d.className = wide ? 'wide' : '';
  d.innerHTML = html;
  d.showModal();
  return d;
}
export const closeDialog = () => $('#dlg').close();

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const d = openDialog(`<form method="dialog" class="form"><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="actions"><button value="cancel" class="btn ghost">Abbrechen</button>
      <button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(okLabel)}</button></div></form>`);
    d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true });
  });
}

function fieldHtml(f, v) {
  const val = v ?? f.value ?? '';
  const only = f.only ? ` data-only="${f.only.join(' ')}"` : '';
  const req = f.required ? ' required' : '';
  let input;
  if (f.type === 'select') {
    input = `<select name="${f.name}"${req}>${f.options.map(([k, l]) => `<option value="${esc(k)}"${k === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else {
    const list = f.list ? ` list="dl-${f.name}"` : '';
    input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}"${req}${list}${f.step ? ` step="${f.step}"` : ''} autocomplete="off">`;
    if (f.list) input += `<datalist id="dl-${f.name}">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
  }
  return `<label class="field"${only}><span>${esc(f.label)}</span>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
}

/** Formular-Dialog. Felder mit `only: [typ,…]` erscheinen nur, wenn das Feld «type» passt. Gibt Werte oder null zurück. */
export function formDialog({ title, fields, values = {}, submit = 'Speichern', extra = '' }) {
  return new Promise(res => {
    const d = openDialog(`<form method="dialog" class="form"><h2>${esc(title)}</h2>
      <div class="grid2">${fields.map(f => fieldHtml(f, values[f.name])).join('')}</div>${extra}
      <div class="actions"><button value="cancel" class="btn ghost" formnovalidate>Abbrechen</button>
      <button value="ok" class="btn primary">${esc(submit)}</button></div></form>`);
    const form = d.querySelector('form');
    const typeSel = form.elements.type;
    const apply = () => {
      for (const el of form.querySelectorAll('[data-only]')) {
        const show = !typeSel || el.dataset.only.split(' ').includes(typeSel.value);
        el.hidden = !show;
        el.querySelectorAll('input,select').forEach(i => { i.disabled = !show; });
      }
    };
    typeSel?.addEventListener('change', apply);
    apply();
    form.addEventListener('submit', e => {
      if (e.submitter?.value === 'ok') res(Object.fromEntries(new FormData(form)));
    });
    d.addEventListener('close', () => res(null), { once: true });
  });
}
