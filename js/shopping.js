/**
 * Listas de la compra: varias listas con nombre propio (como "Fran"/"Mamá"
 * en la app de Mercadona), cada una con sus artículos. Pedida como función
 * nueva y separada de las notas — necesita marcar artículos uno a uno, no
 * otra entrada de texto en la conversación. Todo lo de aquí es lógica pura
 * (parseo de texto, gestión de listas y artículos); el estado real vive en
 * Firestore (un documento por usuario, igual que los ajustes de notas) y se
 * orquesta desde app.js.
 */

const GENERIC_TRIGGERS = [
  { re: /lista\s+de\s+la\s+compra/i, listName: null },
  { re: /lista\s+de\s+compra/i, listName: null },
  { re: /lista\s+del\s+s[uú]per/i, listName: null }
];
const CLEAR_BEFORE = /\b(?:vac[ií]a|limpia|borra(?:\s+(?:toda|entera))?)\s*$/i;
const CLEAR_AFTER = /^(?:vac[ií]a|limpia|borra(?:\s+(?:toda|entera))?)\b/i;
const REMOVE_VERB = /^(?:quita(?:me)?|borra(?:me)?|elimina(?:me)?|saca(?:me)?)\s+/i;
const CHECK_VERB = /^(?:ya\s+(?:tengo|compr[eé])|he\s+comprado|marca(?:me)?)\s+/i;
const ADD_VERB = /^(?:a[ñn]ade(?:me)?|apunta(?:me)?|pon(?:me)?|agrega(?:me)?|mete(?:me)?)\s+/i;
const QUERY_VERB = /^(?:abre|ense[ñn]ame|mu[eé]strame|qu[eé]\s+(?:tengo|hay)\s+en)\s+/i;
const LEADING_ARTICLE = /^(?:la|el|los|las|un|una|unos|unas)\s+/i;
const STORE_SUFFIX = /^(.*?)\s+(?:de|del)\s+(mercadona|consum)\s*$/i;
// "busca leche en mercadona", "busca leche en la lista de mercadona", "busca
// leche de mercadona": pedido para poder consultar el catálogo sin usar la
// palabra "compra". Deliberadamente independiente del disparador de listas —
// no exige mencionar ninguna lista — pero exige un verbo de búsqueda
// explícito para no confundirse con "añade la leche de mercadona a la lista".
const SEARCH_TRIGGER = /^\s*(?:busca(?:r)?|mira|ens[eé]ñame|dime)\s+(.+?)\s+(?:en|de)\s+(?:la\s+lista\s+de\s+|el\s+cat[aá]logo\s+de\s+)?(mercadona|consum)\b.*$/i;
const QUANTITY_WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const LEADING_QUANTITY = /^(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/i;

const TRAILING_STOPWORDS = new Set(["a", "al", "de", "del", "en", "la", "el", "las", "los", "para", "con"]);
const LEADING_STOPWORDS = new Set(["de", "en", "a", "con"]);

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Encuentra dónde cae la mención a "la lista" en la frase — con el nombre
// real de una de las listas del usuario ("lista de Fran") si existe, o con
// las frases genéricas ("lista de la compra"/"lista del súper") si no. Los
// nombres reales van primero: son más específicos y deben ganar si alguno
// coincidiera por casualidad con una palabra genérica.
function findListTrigger(value, listNames = []) {
  for (const name of listNames) {
    if (!name) continue;
    // No se usa \b tras el nombre: es ASCII-only en JS y falla justo después
    // de una vocal con tilde ("Mamá\b" nunca casa, porque "á" ya cuenta como
    // "no palabra" para \b, así que nunca hay un límite ahí). Se comprueba a
    // mano que no continúe con otra letra/dígito.
    const match = new RegExp("lista\\s+de\\s+" + escapeRegex(name) + "(?![a-zA-ZÀ-ÿ0-9])", "i").exec(value);
    if (match) return { match, listName: name };
  }
  for (const variant of GENERIC_TRIGGERS) {
    const match = variant.re.exec(value);
    if (match) return { match, listName: null };
  }
  return null;
}

// "busca leche en la lista de la compra"/"...en la lista de Fran" (sin
// nombrar una tienda) no coincidía con SEARCH_TRIGGER y caía en el "add"
// genérico, guardando "busca leche" como texto literal del artículo. Si se
// pide buscar mencionando la lista misma (no una tienda), se entiende que es
// en Mercadona — es el único catálogo con búsqueda real por ahora.
function findGenericSearch(value, listNames) {
  const searchVerb = /^\s*(?:busca(?:r)?|mira|ens[eé]ñame|dime)\s+/i.exec(value);
  if (!searchVerb) return null;
  const rest = value.slice(searchVerb[0].length);
  const trigger = findListTrigger(rest, listNames);
  if (!trigger) return null;
  const query = stripTrailingConnector(rest.slice(0, trigger.match.index)).replace(LEADING_ARTICLE, "").trim();
  return query ? { query, listName: trigger.listName } : null;
}

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

// Reconoce órdenes de listas de la compra por voz o texto, siempre de forma
// local y determinista: nunca pasa por la IA, así que un fallo aquí nunca
// puede tocar notas, recordatorios ni eventos. Si no reconoce nada devuelve
// null y la orden sigue su camino normal (nota, recordatorio…).
//
// `listNames` son los nombres reales de las listas que ya existen ("Fran",
// "Mamá"…) para poder reconocer "a la lista de Fran" y no solo la frase
// genérica "a la lista de la compra". Cuando el comando no nombra ninguna
// lista, `listName` sale `null` y el llamador decide (normalmente, la lista
// que se tenía abierta).
export function parseShoppingCommand(text, listNames = []) {
  const value = String(text || "").trim();
  if (!value) return null;

  const searchMatch = SEARCH_TRIGGER.exec(value);
  if (searchMatch) {
    const query = searchMatch[1].trim().replace(LEADING_ARTICLE, "").trim();
    const store = searchMatch[2].toLowerCase();
    if (query) return { action: "search", query, store, listName: null };
  }
  const genericSearch = findGenericSearch(value, listNames);
  if (genericSearch) return { action: "search", query: genericSearch.query, store: "mercadona", listName: genericSearch.listName };

  const trigger = findListTrigger(value, listNames);
  if (!trigger) return null;
  const listName = trigger.listName;
  const before = stripTrailingConnector(value.slice(0, trigger.match.index));
  const after = stripLeadingConnector(value.slice(trigger.match.index + trigger.match[0].length));

  if (CLEAR_BEFORE.test(before) || CLEAR_AFTER.test(after)) {
    return { action: "clear", listName };
  }

  // El verbo siempre abre la frase en el habla natural ("quita...",
  // "ya tengo...", "añade..."), así que se detecta y se quita del principio
  // antes de mirar qué queda a cada lado del nombre de la lista, en vez de
  // adivinar en qué lado quedaron los artículos.
  const action = REMOVE_VERB.test(value) ? "remove" : CHECK_VERB.test(value) ? "check" : "add";
  const withoutVerb = value.replace(REMOVE_VERB, "").replace(CHECK_VERB, "").replace(ADD_VERB, "").replace(QUERY_VERB, "");
  const triggerAgain = findListTrigger(withoutVerb, listNames);
  if (!triggerAgain) return { action: "query", listName };
  const bodyBefore = stripTrailingConnector(withoutVerb.slice(0, triggerAgain.match.index));
  const bodyAfter = stripLeadingConnector(withoutVerb.slice(triggerAgain.match.index + triggerAgain.match[0].length));
  const body = bodyBefore || bodyAfter;
  if (!body) return { action: "query", listName: triggerAgain.listName };
  const items = parseItemList(body);
  return items.length ? { action, items, listName: triggerAgain.listName } : null;
}

const normalizeName = name => String(name || "").toLowerCase().trim();
const makeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Real detectado: decir "leche" y luego "2 leches" creaba una fila aparte en
// vez de sumarse a la que ya existía, porque la comparación era por igualdad
// exacta. El plural en español se forma añadiendo "s" (leche→leches) o "es"
// (yogur→yogures) según cómo acabe la palabra; sin diccionario no se puede
// saber cuál aplica, así que se prueban ambas reducciones como candidatas y
// se consideran el mismo artículo si alguna coincide.
function nameStems(name) {
  const value = normalizeName(name);
  const stems = new Set([value]);
  if (value.length > 2 && value.endsWith("s")) stems.add(value.slice(0, -1));
  if (value.length > 3 && value.endsWith("es")) stems.add(value.slice(0, -2));
  return stems;
}
function sameItemName(a, b) {
  const stemsB = nameStems(b);
  for (const stem of nameStems(a)) if (stemsB.has(stem)) return true;
  return false;
}

export function addShoppingItems(items, additions) {
  let next = [...items];
  for (const addition of additions) {
    const quantity = Number.isInteger(addition.quantity) && addition.quantity > 0 ? addition.quantity : 1;
    const index = next.findIndex(item => !item.checked && sameItemName(item.name, addition.name));
    if (index >= 0) {
      // Ya está pendiente: se suma la cantidad en vez de duplicar la fila
      // ("añade dos leches" después de ya tener una leche pendiente = 3).
      next = next.map((item, i) => i === index ? { ...item, quantity: (item.quantity || 1) + quantity, store: item.store || addition.store || null } : item);
      continue;
    }
    next = [...next, { id: makeId("sh"), name: addition.name, store: addition.store || null, quantity, checked: false, addedAt: new Date().toISOString(), product: addition.product || null }];
  }
  return next;
}

export function removeShoppingItems(items, targets) {
  return items.filter(item => !targets.some(target => sameItemName(item.name, target.name)));
}

export function checkShoppingItems(items, targets, checked = true) {
  return items.map(item => targets.some(target => sameItemName(item.name, target.name)) ? { ...item, checked } : item);
}

export function setShoppingItemQuantity(items, itemId, quantity) {
  const clamped = Math.max(1, Math.min(99, Math.round(quantity) || 1));
  return items.map(item => item.id === itemId ? { ...item, quantity: clamped } : item);
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

export function shoppingListTotal(items) {
  return items.reduce((sum, item) => sum + (item.product?.price != null ? item.product.price * (item.quantity || 1) : 0), 0);
}

// ---- Varias listas con nombre (Fran, Mamá…) ----
// Un documento por usuario en Firestore, con todas las listas dentro, igual
// que ya se hacía con los ajustes de notas/notificaciones — evita depender
// de una colección nueva que firestore.rules no autorice (el fallo real de
// sincronización de la V0.21.80 fue justo por eso).

export function makeShoppingList(name, items = []) {
  return { id: makeId("sl"), name: String(name || "Mi lista").trim() || "Mi lista", items, cart: [], purchases: [] };
}

// Antes de que existieran listas con nombre, el documento guardaba
// directamente {items:[...]}. Se migra sola a una única lista "Mi lista" la
// primera vez que se lee, sin pedir nada ni perder lo que ya hubiera. Una
// lista guardada antes del carrito tampoco lleva "cart"/"purchases" todavía
// — se completan aquí con arrays vacíos, igual que con "lists"/"items".
export function normalizeShoppingState(raw) {
  if (raw && Array.isArray(raw.lists) && raw.lists.length) {
    const lists = raw.lists.map(list => ({
      id: list.id || makeId("sl"),
      name: String(list.name || "Mi lista").trim() || "Mi lista",
      items: Array.isArray(list.items) ? list.items : [],
      cart: Array.isArray(list.cart) ? list.cart : [],
      purchases: Array.isArray(list.purchases) ? list.purchases : []
    }));
    const activeListId = lists.some(list => list.id === raw.activeListId) ? raw.activeListId : lists[0].id;
    return { lists, activeListId };
  }
  const legacyItems = Array.isArray(raw?.items) ? raw.items : [];
  const list = makeShoppingList("Mi lista", legacyItems);
  return { lists: [list], activeListId: list.id };
}

export function getActiveList(state) {
  return state.lists.find(list => list.id === state.activeListId) || state.lists[0] || null;
}

export function findListByName(state, name) {
  if (!name) return null;
  const key = normalizeName(name);
  return state.lists.find(list => normalizeName(list.name) === key) || null;
}

export function createShoppingList(state, name) {
  const list = makeShoppingList(name);
  return { lists: [...state.lists, list], activeListId: list.id };
}

export function renameShoppingList(state, listId, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return state;
  return { ...state, lists: state.lists.map(list => list.id === listId ? { ...list, name: trimmed } : list) };
}

// Siempre deja al menos una lista: borrar la última no vacía la app entera,
// crea una lista en blanco para no dejar el estado sin ningún sitio donde
// guardar el siguiente artículo.
export function deleteShoppingList(state, listId) {
  const remaining = state.lists.filter(list => list.id !== listId);
  if (!remaining.length) return createShoppingList({ lists: [], activeListId: null }, "Mi lista");
  const activeListId = state.activeListId === listId ? remaining[0].id : state.activeListId;
  return { lists: remaining, activeListId };
}

export function setActiveShoppingList(state, listId) {
  return state.lists.some(list => list.id === listId) ? { ...state, activeListId: listId } : state;
}

// Aplica una transformación de artículos (addShoppingItems, toggle…) a una
// lista concreta, dejando las demás intactas — así toda la lógica de
// artículos de arriba se reutiliza tal cual, sin saber nada de que ahora
// puede haber varias listas.
export function updateListItems(state, listId, updater) {
  return { ...state, lists: state.lists.map(list => list.id === listId ? { ...list, items: updater(list.items) } : list) };
}

/**
 * El carrito de la compra: pedido explícito del propietario para que
 * funcione igual que en la app real de Mercadona. La lista habitual
 * ("Mi lista") no cambia en nada — sigue siendo la lista de artículos de
 * siempre, con su mismo buscador y su mismo check de toda la vida. Lo único
 * que cambia es el SIGNIFICADO de ese check: antes de esto, marcarlo quería
 * decir "ya comprado" (y "Quitar comprados" lo borraba de la lista); ahora
 * significa "lo quiero esta vez" — un botón nuevo, "Añadir al carrito",
 * copia los artículos marcados al carrito (con su cantidad) y los deja otra
 * vez sin marcar en la lista, pero SIN quitarlos de ahí. El carrito es la
 * compra concreta de hoy: se van marcando ahí según se echan al carro real,
 * y "Finalizar compra" archiva lo comprado con la fecha en el historial —
 * lo que quede sin marcar en el carrito se queda ahí para la próxima vez.
 */

function mergeIntoCart(cart, addition) {
  const index = cart.findIndex(item => !item.checked && sameItemName(item.name, addition.name) && item.store === addition.store);
  if (index === -1) return [...cart, { id: makeId("ct"), name: addition.name, store: addition.store || null, quantity: addition.quantity || 1, checked: false, product: addition.product || null }];
  const next = [...cart];
  next[index] = { ...next[index], quantity: (next[index].quantity || 1) + (addition.quantity || 1) };
  return next;
}

export function addCheckedToCart(state, listId) {
  const list = state.lists.find(item => item.id === listId);
  if (!list) return state;
  const checked = list.items.filter(item => item.checked);
  if (!checked.length) return state;
  let cart = list.cart || [];
  for (const item of checked) cart = mergeIntoCart(cart, item);
  const items = list.items.map(item => item.checked ? { ...item, checked: false } : item);
  return { ...state, lists: state.lists.map(entry => entry.id === listId ? { ...entry, items, cart } : entry) };
}

export function toggleCartItem(state, listId, cartItemId) {
  return { ...state, lists: state.lists.map(list => list.id === listId ? { ...list, cart: (list.cart || []).map(item => item.id === cartItemId ? { ...item, checked: !item.checked } : item) } : list) };
}

export function setCartItemQuantity(state, listId, cartItemId, quantity) {
  const value = Math.max(1, Math.min(99, Math.round(Number(quantity)) || 1));
  return { ...state, lists: state.lists.map(list => list.id === listId ? { ...list, cart: (list.cart || []).map(item => item.id === cartItemId ? { ...item, quantity: value } : item) } : list) };
}

export function removeCartItem(state, listId, cartItemId) {
  return { ...state, lists: state.lists.map(list => list.id === listId ? { ...list, cart: (list.cart || []).filter(item => item.id !== cartItemId) } : list) };
}

// "lo que haya en el carrito que no se haya comprado seguirá estando ahí":
// solo se archiva lo marcado; lo demás se queda en el carrito tal cual.
export function finalizePurchase(state, listId, now = new Date()) {
  const list = state.lists.find(item => item.id === listId);
  if (!list) return state;
  const bought = (list.cart || []).filter(item => item.checked);
  if (!bought.length) return state;
  const remaining = (list.cart || []).filter(item => !item.checked);
  const purchase = { id: makeId("pu"), date: now.toISOString(), items: bought.map(item => ({ name: item.name, store: item.store, quantity: item.quantity, product: item.product || null })) };
  const purchases = [purchase, ...(list.purchases || [])];
  return { ...state, lists: state.lists.map(entry => entry.id === listId ? { ...entry, cart: remaining, purchases } : entry) };
}
