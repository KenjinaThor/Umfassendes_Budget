// Nachbearbeitung einer .xlsx-Datei: Dropdown-Listen (Datenüberprüfung) in Tabellenblätter einfügen.
// SheetJS (Community) kann das nicht selbst; deshalb wird das ZIP minimal umgebaut. Bei jedem Fehler bleibt die Datei unverändert.
const td = new TextDecoder(), te = new TextEncoder();

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('kein ZIP');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP defekt');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), start = off + 30 + lnl + lel;
    entries.push({ name, method, crc, csize, usize, raw: buf.subarray(start, start + csize) });
    p += 46 + nl + el + cl;
  }
  return entries;
}

function writeZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  const u16 = n => Uint8Array.of(n & 255, (n >> 8) & 255), u32 = n => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const cat = parts => { const len = parts.reduce((a, b) => a + b.length, 0), out = new Uint8Array(len); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; } return out; };
  for (const e of entries) {
    const name = te.encode(e.name);
    const local = cat([u32(0x04034b50), u16(20), u16(0x0800), u16(e.method), u16(0), u16(0x21), u32(e.crc), u32(e.raw.length), u32(e.usize), u16(name.length), u16(0), name, e.raw]);
    central.push(cat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(e.method), u16(0), u16(0x21), u32(e.crc), u32(e.raw.length), u32(e.usize), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    chunks.push(local); offset += local.length;
  }
  const cd = cat(central);
  return cat([...chunks, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** specs: { Blattname: [{ sqref:'B2:B2000', type:'list'|'decimal', formula1, strict:boolean, title, error }] } */
export async function addValidations(bytes, specs) {
  try {
    if (typeof DecompressionStream === 'undefined') return bytes;
    const entries = readZip(bytes);
    const get = async name => { const e = entries.find(x => x.name === name); return e ? td.decode(e.method === 8 ? await inflateRaw(e.raw) : e.raw) : null; };
    const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
    if (!wb || !rels) return bytes;
    const ridOf = {};
    for (const m of wb.matchAll(/<sheet\b[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) ridOf[m[1].replace(/&amp;/g, '&')] = m[2];
    const targetOf = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) targetOf[m[1]] = m[2];
    for (const [sheet, list] of Object.entries(specs)) {
      const target = targetOf[ridOf[sheet]];
      if (!target) continue;
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      const e = entries.find(x => x.name === path);
      if (!e) continue;
      let xml = td.decode(e.method === 8 ? await inflateRaw(e.raw) : e.raw);
      const dv = `<dataValidations count="${list.length}">${list.map(s => `<dataValidation type="${s.type}"${s.type === 'decimal' ? ' operator="greaterThanOrEqual"' : ''} errorStyle="${s.strict ? 'stop' : 'warning'}" allowBlank="1" showInputMessage="0" showErrorMessage="1" errorTitle="${esc(s.title || 'Ungültiger Wert')}" error="${esc(s.error || 'Bitte einen Wert aus der Liste wählen.')}" sqref="${s.sqref}"><formula1>${esc(s.formula1)}</formula1></dataValidation>`).join('')}</dataValidations>`;
      xml = xml.includes('<pageMargins') ? xml.replace('<pageMargins', `${dv}<pageMargins`) : xml.replace('</worksheet>', `${dv}</worksheet>`);
      const raw = te.encode(xml);
      Object.assign(e, { method: 0, raw, crc: crc32(raw), usize: raw.length });
    }
    return writeZip(entries);
  } catch { return bytes; }
}
