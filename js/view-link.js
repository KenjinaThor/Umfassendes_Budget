// Verknüpfung von Sparbeiträgen (Ausgaben) mit Vermögenskonten: jede Buchung erhöht den Kontostand.
import { db } from './store.js';
import { today, dispDate } from './util.js';
import { toast } from './ui.js';

export const kontos = () => db().assets.filter(a => a.type === 'konto');

/** Formularfeld «Einzahlung auf Vermögenskonto» (leer, wenn kein Konto existiert). */
export const assetField = () => (kontos().length ? [{
  name: 'assetId', label: 'Einzahlung auf Vermögenskonto (Sparbeitrag)', type: 'select',
  options: [['', 'Keine Verknüpfung'], ...kontos().map(a => [a.id, `${a.name} (${a.currency})`])],
  hint: 'Der Kontostand im Vermögen erhöht sich mit jeder Buchung.',
}] : []);

/** Legt bei Bedarf das Stand-Datum des Kontos fest: Buchungen bis dahin sind im erfassten Kontostand schon enthalten. */
export function linkAsset(id) {
  const a = db().assets.find(x => x.id === id);
  if (a && !a.balanceDate) {
    a.balanceDate = today();
    toast(`Verknüpft: Buchungen ab ${dispDate(a.balanceDate)} erhöhen den Stand von «${a.name}». Frühere gelten als im Kontostand enthalten.`, 6000);
  }
}
