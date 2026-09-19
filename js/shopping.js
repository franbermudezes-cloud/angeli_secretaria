/**
 * Lista de la compra: pedida como función nueva y separada de las notas —
 * necesita marcar artículos uno a uno, no otra entrada de texto en la
 * conversación. Todo lo de aquí es lógica pura (parseo de texto, gestión de
 * la lista); el estado real vive en Firestore (un documento por usuario,
 * igual que los ajustes de notas/notificaciones) y se orquesta desde app.js.
 */

const TRIGGER = /\b(?:lista\s+de\s+la\s+compra|lista\s+de\s+compra|lista\s+del\s+s[uú]per)\b/i;
const CLEAR = /\b(?:vac[ií]a|limpia|borra(?:\s+(?:toda|entera))?)\s+(?:la\s+)?(?:lista\s+de\s+la\s+compra|lista\s+de\s+compra|lista\s+del\s+s[uú]per)\b/i;
const QUERY_ONLY = /^\s*(?:qu[eé]\s+(?:tengo|hay)\s+en\s+la\s+lista\s+de\s+la\s+compra|abre\s+la\s+lista\s+de\s+la\s+compra|ense[ñn]ame\s+la\s+lista\s+de\s+la\s+compra|lista\s+de\s+la\s+compra|lista\s+del\s+s[uú]per)\s*\??\s*$/i;
const REMOVE_VERB = /^(?:quita(?:me)?|borra(?:me)?|elimina(?:me)?|saca(?:me)?)\s+/i;
const CHECK_VERB = /^(?:ya\s+(?:tengo|compr[eé])|he\s+comprado|marca(?:me)?)\s+/i;
const ADD_VERB = /^(?:a[ñn]ade(?:me)?|apunta(?:me)?|pon(?:me)?|agrega(?:me)?|mete(?:me)?)\s+/i;
const LEADING_ARTICLE = /^(?:la|el|los|las|un|una|unos|unas)\s+/i;
const STORE_SUFFIX = /^(.*?)\s+(?:de|del)\s+(mercadona|consum)\s*$/i;
const QUANTITY_WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const LEADING_QUANTITY = /^(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/i;

const TRAILING_STOPWORDS = new Set(["a", "al", "de", "del", "en", "la", "el", "las", "los", "para", "con"]);
const LEADING_STOPWORDS = new Set(["de", "en", "a", "con"]);

// "apunta EN LA lista..." / "quita LA leche DE LA lista..." dejan colgando
// una preposición o artículo suelto entre el artículo y la frase disparadora.
// Es más fiable ir quitando palabras-vacías token a token que intentar
// enumerar cada combinación posible de preposiciones en español.
function stripTrailingConnector(text) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  while (tokens.length && TRAILING_STOPWORDS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  return tokens.join(" ");
}
function stripLeadingConnector(text) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  while (tokens.length && LEADING_STOPWORDS.has(tokens[0].toLowerCase())) tokens.shift();
  return tokens.join(" ");
}

// "2 leches", "quiero dos barras de pan": un número (en dígitos o en
// palabras) delante del artículo indica cuántas unidades hacen falta.
// Solapa a propósito con el artículo indefinido ("una leche" = 1 leche de
// cualquier forma), así que se comprueba primero y se retira antes de
// tratar el resto como artículo.
function extractQuantity(text) {
  const match = LEADING_QUANTITY.exec(text);
  if (!match) return { quantity: 1, rest: text };
  const raw = match[1].toLowerCase();
  const quantity = /^\d+$/.test(raw) ? Number(raw) : QUANTITY_WORDS[raw];
  return Number.isInteger(quantity) && quantity > 0 ? { quantity, rest: text.slice(match[0].length) } : { quantity: 1, rest: text };
}

function parseItemSegment(segment) {
  const { quantity, rest } = extractQuantity(segment.trim());
  const match = STORE_SUFFIX.exec(rest.trim());
  const rawName = match ? match[1] : rest;
  const store = match ? match[2].toLowerCase() : null;
  const name = rawName.trim().replace(LEADING_ARTICLE, "").trim();
  return { name, store, quantity };
}

export function parseItemList(body) {
  return String(body || "")
    .split(/\s*,\s*|\s+y\s+/i)
    .map(part => part.trim())
    .filter(Boolean)
    .map(parseItemSegment)
    .filter(item => item.name);
}

// Reconoce órdenes de la lista de la compra por voz o texto, siempre de
// forma local y determinista: nunca pasa por la IA, así que un fallo aquí
// nunca puede tocar notas, recordatorios ni eventos. Si no reconoce nada
// devuelve null y la orden sigue su camino normal (nota, recordatorio…).
export function parseShoppingCommand(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  if (CLEAR.test(value)) return { action: "clear" };
  if (QUERY_ONLY.test(value)) return { action: "query" };
  if (!TRIGGER.test(value)) return null;
  // El verbo siempre abre la frase en el habla natural ("quita...",
  // "ya tengo...", "añade..."), así que se detecta y se quita del principio
  // antes de buscar dónde cae la frase disparadora, en vez de adivinar en
  // qué lado (antes o después) quedaron los artículos.
  const action = REMOVE_VERB.test(value) ? "remove" : CHECK_VERB.test(value) ? "check" : "add";
  const withoutVerb = value.replace(REMOVE_VERB, "").replace(CHECK_VERB, "").replace(ADD_VERB, "");
  const match = TRIGGER.exec(withoutVerb);
  if (!match) return null;
  const before = stripTrailingConnector(withoutVerb.slice(0, match.index));
  const after = stripLeadingConnector(withoutVerb.slice(match.index + match[0].length));
  const body = before || after;
  if (!body) return { action: "query" };
  const items = parseItemList(body);
  return items.length ? { action, items } : null;
}

const normalizeName = name => String(name || "").toLowerCase().trim();
const makeShoppingId = () => `sh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function addShoppingItems(items, additions) {
  let next = [...items];
  for (const addition of additions) {
    const key = normalizeName(addition.name);
    const quantity = Number.isInteger(addition.quantity) && addition.quantity > 0 ? addition.quantity : 1;
    const index = next.findIndex(item => !item.checked && normalizeName(item.name) === key);
    if (index >= 0) {
      // Ya está pendiente: se suma la cantidad en vez de duplicar la fila
      // ("añade dos leches" después de ya tener una leche pendiente = 3).
      next = next.map((item, i) => i === index ? { ...item, quantity: (item.quantity || 1) + quantity, store: item.store || addition.store || null } : item);
      continue;
    }
    next = [...next, { id: makeShoppingId(), name: addition.name, store: addition.store || null, quantity, checked: false, addedAt: new Date().toISOString(), product: null }];
  }
  return next;
}

export function removeShoppingItems(items, targets) {
  const keys = new Set(targets.map(item => normalizeName(item.name)));
  return items.filter(item => !keys.has(normalizeName(item.name)));
}

export function checkShoppingItems(items, targets, checked = true) {
  const keys = new Set(targets.map(item => normalizeName(item.name)));
  return items.map(item => keys.has(normalizeName(item.name)) ? { ...item, checked } : item);
}

export function clearShoppingList(items, { onlyChecked = false } = {}) {
  return onlyChecked ? items.filter(item => !item.checked) : [];
}

export function toggleShoppingItem(items, itemId) {
  return items.map(item => item.id === itemId ? { ...item, checked: !item.checked } : item);
}

export function removeShoppingItemById(items, itemId) {
  return items.filter(item => item.id !== itemId);
}

export function setShoppingItemProduct(items, itemId, product) {
  return items.map(item => item.id === itemId ? { ...item, product, store: product ? "mercadona" : item.store } : item);
}

export function setShoppingItemStore(items, itemId, store) {
  return items.map(item => item.id === itemId ? { ...item, store, product: store === "mercadona" ? item.product : null } : item);
}

export function describeShoppingItems(items) {
  return items.map(item => {
    const label = item.quantity > 1 ? `${item.quantity}× ${item.name}` : item.name;
    return item.store ? `${label} (${item.store})` : label;
  }).join(", ");
}
