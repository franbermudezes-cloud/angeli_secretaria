import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
 parseShoppingCommand,parseItemList,addShoppingItems,removeShoppingItems,checkShoppingItems,clearShoppingList,
 toggleShoppingItem,setShoppingItemProduct,setShoppingItemQuantity,describeShoppingItems,shoppingListTotal,
 normalizeShoppingState,makeShoppingList,getActiveList,findListByName,createShoppingList,renameShoppingList,
 deleteShoppingList,setActiveShoppingList,setShoppingListStore,isMercadonaList,SHOPPING_STORE_PRESETS,shoppingStoreLabel,updateListItems,
 addCheckedToCart,toggleCartItem,setCartItemQuantity,removeCartItem,finalizePurchase
} from '../js/shopping.js';

// Regresión real reportada por el usuario: openShoppingListQuickActions abre
// el menú de "cambiar nombre/eliminar lista" con ui.openModal() sin cerrar
// antes #shoppingLibrary (igual que le pasaba al Dietario). Como
// #shoppingLibrary comparte la clase .media-library (z-index:8, por delante
// de .action-modal en z-index:6), el modal quedaba tapado detrás de la
// propia pantalla de la lista y parecía que no había pasado nada hasta
// cerrar la lista.
test('el menú rápido de las listas de la compra queda por delante de #shoppingLibrary', async () => {
 const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
 const shoppingLibraryZ = Number(css.match(/#shoppingLibrary\{[^}]*z-index:(\d+)/)?.[1] ?? css.match(/\.media-library\{[^}]*z-index:(\d+)/)?.[1] ?? -1);
 const actionModalZ = Number(css.match(/\.action-modal\{[^}]*z-index:(\d+)/)?.[1] || -1);
 assert.ok(shoppingLibraryZ >= 0 && actionModalZ >= 0, 'deben existir ambas reglas de z-index');
 assert.ok(shoppingLibraryZ < actionModalZ, `#shoppingLibrary (z-index ${shoppingLibraryZ}) debe quedar por detrás de .action-modal (z-index ${actionModalZ}) para que el menú rápido sea visible y pulsable con la lista abierta`);
});

test('reconoce añadir un solo artículo a la lista de la compra (sin nombrar ninguna lista)',()=>{
 const command=parseShoppingCommand('añade leche a la lista de la compra');
 assert.equal(command.action,'add');
 assert.equal(command.listName,null);
 assert.deepEqual(command.items,[{name:'leche',store:null,quantity:1}]);
});

test('reconoce varios artículos separados por comas y "y", con y sin tienda',()=>{
 const command=parseShoppingCommand('apunta en la lista de la compra la leche de mercadona, pan y huevos de consum');
 assert.equal(command.action,'add');
 assert.deepEqual(command.items,[
  {name:'leche',store:'mercadona',quantity:1},
  {name:'pan',store:null,quantity:1},
  {name:'huevos',store:'consum',quantity:1}
 ]);
});

test('reconoce la cantidad delante del artículo, en dígitos o en palabras',()=>{
 const command=parseShoppingCommand('añade 2 leches y tres yogures a la lista de la compra');
 assert.deepEqual(command.items,[
  {name:'leches',store:null,quantity:2},
  {name:'yogures',store:null,quantity:3}
 ]);
});

test('"una leche" se reconoce como artículo indefinido, no como cantidad rara',()=>{
 const command=parseShoppingCommand('añade una leche a la lista de la compra');
 assert.deepEqual(command.items,[{name:'leche',store:null,quantity:1}]);
});

test('reconoce quitar un artículo de la lista',()=>{
 const command=parseShoppingCommand('quita la leche de la lista de la compra');
 assert.equal(command.action,'remove');
 assert.deepEqual(command.items,[{name:'leche',store:null,quantity:1}]);
});

test('reconoce marcar un artículo como comprado',()=>{
 const command=parseShoppingCommand('ya tengo el pan de la lista de la compra');
 assert.equal(command.action,'check');
 assert.deepEqual(command.items,[{name:'pan',store:null,quantity:1}]);
});

test('reconoce vaciar la lista entera, sin confundirse con quitar un artículo suelto',()=>{
 assert.deepEqual(parseShoppingCommand('vacía la lista de la compra'),{action:'clear',listName:null});
 assert.deepEqual(parseShoppingCommand('limpia la lista del súper'),{action:'clear',listName:null});
 assert.deepEqual(parseShoppingCommand('borra toda la lista de la compra'),{action:'clear',listName:null});
 const removeOne=parseShoppingCommand('borra la leche de la lista de la compra');
 assert.equal(removeOne.action,'remove','"borra la leche de..." es quitar un artículo, no vaciar la lista');
});

test('reconoce una consulta sin artículos como apertura de la lista',()=>{
 assert.deepEqual(parseShoppingCommand('qué tengo en la lista de la compra'),{action:'query',listName:null});
 assert.deepEqual(parseShoppingCommand('lista de la compra'),{action:'query',listName:null});
 assert.deepEqual(parseShoppingCommand('abre la lista de la compra'),{action:'query',listName:null});
});

test('un texto sin mención a ninguna lista no se reconoce (no debe tocar notas ni recordatorios)',()=>{
 assert.equal(parseShoppingCommand('recuérdame llamar a Ana'),null);
 assert.equal(parseShoppingCommand('apunta que compre pan'),null);
});

test('reconoce "busca X en/de mercadona" como búsqueda, sin exigir mencionar ninguna lista',()=>{
 assert.deepEqual(parseShoppingCommand('busca leche en la lista de mercadona'),{action:'search',query:'leche',store:'mercadona',listName:null});
 assert.deepEqual(parseShoppingCommand('busca leche en mercadona'),{action:'search',query:'leche',store:'mercadona',listName:null});
 assert.deepEqual(parseShoppingCommand('busca la cerveza de mercadona'),{action:'search',query:'cerveza',store:'mercadona',listName:null});
 assert.deepEqual(parseShoppingCommand('mira el chorizo en consum'),{action:'search',query:'chorizo',store:'consum',listName:null});
});

test('"añade la leche de mercadona a la lista de la compra" sigue siendo un "add", no una búsqueda',()=>{
 const command=parseShoppingCommand('añade la leche de mercadona a la lista de la compra');
 assert.equal(command.action,'add');
});

test('reconoce "busca X en la lista de la compra" (sin nombrar tienda) como búsqueda en Mercadona',()=>{
 assert.deepEqual(parseShoppingCommand('busca leche en la lista de la compra'),{action:'search',query:'leche',store:'mercadona',listName:null});
 assert.deepEqual(parseShoppingCommand('mira la cerveza en la lista del súper'),{action:'search',query:'cerveza',store:'mercadona',listName:null});
});

test('reconoce el nombre real de una lista del usuario ("a la lista de Fran")',()=>{
 const names=['Fran','Mamá'];
 assert.deepEqual(parseShoppingCommand('añade leche a la lista de Fran',names),{action:'add',items:[{name:'leche',store:null,quantity:1}],listName:'Fran'});
 assert.deepEqual(parseShoppingCommand('busca leche en la lista de Mamá',names),{action:'search',query:'leche',store:'mercadona',listName:'Mamá'});
 assert.deepEqual(parseShoppingCommand('quita el pan de la lista de Fran',names),{action:'remove',items:[{name:'pan',store:null,quantity:1}],listName:'Fran'});
 assert.deepEqual(parseShoppingCommand('vacía la lista de Fran',names),{action:'clear',listName:'Fran'});
 assert.deepEqual(parseShoppingCommand('abre la lista de Mamá',names),{action:'query',listName:'Mamá'});
});

test('sin nombres de listas conocidos, "a la lista de Fran" no se reconoce como ninguna lista con nombre',()=>{
 // Sin la lista "Fran" registrada, "Fran" es simplemente parte del texto:
 // no hay ninguna frase de lista de la compra reconocible en la orden.
 assert.equal(parseShoppingCommand('añade leche a la lista de Fran'),null);
});

test('parseItemList separa por comas y por "y", quitando artículos iniciales',()=>{
 assert.deepEqual(parseItemList('la leche, el pan y unos huevos'),[
  {name:'leche',store:null,quantity:1},{name:'pan',store:null,quantity:1},{name:'huevos',store:null,quantity:1}
 ]);
});

test('addShoppingItems añade artículos nuevos y no duplica uno ya pendiente',()=>{
 let items=addShoppingItems([],[{name:'leche',store:'mercadona',quantity:1},{name:'pan',store:null,quantity:1}]);
 assert.equal(items.length,2);
 assert.equal(items[0].checked,false);
 items=addShoppingItems(items,[{name:'leche',store:null,quantity:1}]);
 assert.equal(items.length,2,'no debe duplicar un artículo ya pendiente con el mismo nombre');
});

test('addShoppingItems suma la cantidad si el artículo ya estaba pendiente',()=>{
 let items=addShoppingItems([],[{name:'leche',store:null,quantity:1}]);
 items=addShoppingItems(items,[{name:'leche',store:null,quantity:2}]);
 assert.equal(items.length,1);
 assert.equal(items[0].quantity,3);
});

test('addShoppingItems reconoce singular y plural como el mismo artículo (no duplica "leche" con "leches")',()=>{
 let items=addShoppingItems([],[{name:'leche',store:null,quantity:1}]);
 items=addShoppingItems(items,[{name:'leches',store:null,quantity:2}]);
 assert.equal(items.length,1,'"leche" y "leches" deben sumarse en la misma fila, real detectado en producción');
 assert.equal(items[0].quantity,3);
 items=addShoppingItems([],[{name:'yogur',store:null,quantity:1}]);
 items=addShoppingItems(items,[{name:'yogures',store:null,quantity:2}]);
 assert.equal(items.length,1,'"yogur" y "yogures" (plural en -es) deben reconocerse igual');
 assert.equal(items[0].quantity,3);
});

test('removeShoppingItems y checkShoppingItems también reconocen singular/plural',()=>{
 let items=addShoppingItems([],[{name:'yogures',store:null,quantity:3}]);
 items=checkShoppingItems(items,[{name:'yogur'}]);
 assert.equal(items[0].checked,true);
 items=removeShoppingItems(items,[{name:'yogur'}]);
 assert.equal(items.length,0);
});

test('setShoppingItemQuantity no baja de 1 ni sube de 99',()=>{
 const items=addShoppingItems([],[{name:'leche',store:null,quantity:1}]);
 assert.equal(setShoppingItemQuantity(items,items[0].id,0)[0].quantity,1);
 assert.equal(setShoppingItemQuantity(items,items[0].id,-5)[0].quantity,1);
 assert.equal(setShoppingItemQuantity(items,items[0].id,500)[0].quantity,99);
 assert.equal(setShoppingItemQuantity(items,items[0].id,4)[0].quantity,4);
});

test('addShoppingItems completa la tienda si el artículo pendiente no tenía una',()=>{
 let items=addShoppingItems([],[{name:'leche',store:null,quantity:1}]);
 items=addShoppingItems(items,[{name:'leche',store:'mercadona',quantity:1}]);
 assert.equal(items.length,1);
 assert.equal(items[0].store,'mercadona');
});

test('addShoppingItems sí añade de nuevo un artículo que ya estaba marcado como comprado',()=>{
 let items=addShoppingItems([],[{name:'leche',store:null,quantity:1}]);
 items=checkShoppingItems(items,[{name:'leche'}]);
 items=addShoppingItems(items,[{name:'leche',store:null,quantity:1}]);
 assert.equal(items.length,2);
});

test('removeShoppingItems y checkShoppingItems localizan por nombre sin distinguir mayúsculas',()=>{
 let items=addShoppingItems([],[{name:'Leche',store:null,quantity:1},{name:'Pan',store:null,quantity:1}]);
 items=checkShoppingItems(items,[{name:'leche'}]);
 assert.equal(items.find(item=>item.name==='Leche').checked,true);
 items=removeShoppingItems(items,[{name:'PAN'}]);
 assert.equal(items.length,1);
});

test('clearShoppingList vacía toda la lista o solo lo ya comprado',()=>{
 let items=addShoppingItems([],[{name:'leche',store:null,quantity:1},{name:'pan',store:null,quantity:1}]);
 items=checkShoppingItems(items,[{name:'leche'}]);
 const onlyChecked=clearShoppingList(items,{onlyChecked:true});
 assert.deepEqual(onlyChecked.map(item=>item.name),['pan']);
 assert.deepEqual(clearShoppingList(items),[]);
});

test('toggleShoppingItem invierte el estado de un artículo por id',()=>{
 const items=addShoppingItems([],[{name:'leche',store:null,quantity:1}]);
 const toggled=toggleShoppingItem(items,items[0].id);
 assert.equal(toggled[0].checked,true);
 assert.equal(toggleShoppingItem(toggled,items[0].id)[0].checked,false);
});

test('setShoppingItemProduct vincula un producto de Mercadona y fija la tienda',()=>{
 const items=addShoppingItems([],[{name:'leche',store:null,quantity:1}]);
 const product={id:'1',name:'Leche entera Hacendado',price:0.95};
 const linked=setShoppingItemProduct(items,items[0].id,product);
 assert.equal(linked[0].store,'mercadona');
 assert.deepEqual(linked[0].product,product);
});

test('describeShoppingItems incluye la cantidad cuando es más de una',()=>{
 assert.equal(describeShoppingItems([{name:'leche',store:null,quantity:1}]),'leche');
 assert.equal(describeShoppingItems([{name:'leche',store:'mercadona',quantity:2}]),'2× leche (mercadona)');
});

test('shoppingListTotal solo suma los artículos con producto vinculado, multiplicado por su cantidad',()=>{
 const items=[
  {name:'leche',quantity:2,product:{price:0.95}},
  {name:'champú',quantity:1,product:null},
  {name:'pan',quantity:3,product:{price:1.2}}
 ];
 assert.equal(Math.round(shoppingListTotal(items)*100)/100,5.5);
});

// ---- Varias listas con nombre (Fran, Mamá…) ----

test('normalizeShoppingState migra el formato antiguo (una sola lista sin nombre) a "Mi lista"',()=>{
 const state=normalizeShoppingState({items:[{id:'i1',name:'leche'}]});
 assert.equal(state.lists.length,1);
 assert.equal(state.lists[0].name,'Mi lista');
 assert.deepEqual(state.lists[0].items,[{id:'i1',name:'leche'}]);
 assert.equal(state.activeListId,state.lists[0].id);
});

test('normalizeShoppingState conserva varias listas ya guardadas y corrige un activeListId inválido',()=>{
 const raw={lists:[{id:'a',name:'Fran',items:[]},{id:'b',name:'Mamá',items:[]}],activeListId:'no-existe'};
 const state=normalizeShoppingState(raw);
 assert.equal(state.lists.length,2);
 assert.equal(state.activeListId,'a','si el activeListId guardado no existe, usa la primera lista');
});

test('normalizeShoppingState sobre un estado vacío crea una lista por defecto',()=>{
 const state=normalizeShoppingState(null);
 assert.equal(state.lists.length,1);
 assert.equal(state.activeListId,state.lists[0].id);
});

test('createShoppingList añade una lista nueva y la deja activa',()=>{
 let state=normalizeShoppingState(null);
 state=createShoppingList(state,'Fran');
 assert.equal(state.lists.length,2);
 assert.equal(getActiveList(state).name,'Fran');
});

test('findListByName busca sin distinguir mayúsculas ni espacios sobrantes',()=>{
 let state=normalizeShoppingState(null);
 state=createShoppingList(state,'Fran');
 assert.equal(findListByName(state,'fran').name,'Fran');
 assert.equal(findListByName(state,'  FRAN  ').name,'Fran');
 assert.equal(findListByName(state,'Nadie'),null);
});

test('renameShoppingList cambia el nombre sin tocar los artículos',()=>{
 let state=createShoppingList(normalizeShoppingState(null),'Fran');
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:1}]));
 state=renameShoppingList(state,listId,'Francisco');
 assert.equal(getActiveList(state).name,'Francisco');
 assert.equal(getActiveList(state).items.length,1);
});

test('deleteShoppingList nunca deja el estado sin ninguna lista',()=>{
 let state=normalizeShoppingState(null);
 const onlyListId=state.lists[0].id;
 state=deleteShoppingList(state,onlyListId);
 assert.equal(state.lists.length,1,'borrar la última lista crea una nueva en blanco, nunca deja el estado vacío');
 assert.notEqual(state.lists[0].id,onlyListId);
});

test('deleteShoppingList cambia la lista activa si se borra la que estaba abierta',()=>{
 let state=createShoppingList(normalizeShoppingState(null),'Fran');
 const franId=getActiveList(state).id;
 const miListaId=state.lists.find(list=>list.id!==franId).id;
 state=deleteShoppingList(state,franId);
 assert.equal(state.lists.length,1);
 assert.equal(state.activeListId,miListaId);
});

test('setActiveShoppingList cambia cuál es la lista activa',()=>{
 let state=createShoppingList(normalizeShoppingState(null),'Fran');
 const miListaId=state.lists.find(list=>list.name==='Mi lista').id;
 state=setActiveShoppingList(state,miListaId);
 assert.equal(getActiveList(state).name,'Mi lista');
});

test('updateListItems solo transforma la lista indicada, deja las demás intactas',()=>{
 let state=createShoppingList(normalizeShoppingState(null),'Fran');
 const [listA,listB]=state.lists;
 state=updateListItems(state,listA.id,items=>addShoppingItems(items,[{name:'leche',quantity:1}]));
 assert.equal(state.lists.find(list=>list.id===listA.id).items.length,1);
 assert.equal(state.lists.find(list=>list.id===listB.id).items.length,0);
});

// Pedido explícito del propietario, calcado de cómo funciona Mercadona: la
// lista habitual no cambia en nada, solo cambia el significado del check de
// siempre — marcar un artículo ya no es "comprado", es "lo quiero esta vez".
// "Añadir al carrito" copia lo marcado al carrito y lo deja sin marcar en la
// lista, pero SIN quitarlo de ahí.
test('addCheckedToCart copia los artículos marcados al carrito y los deja sin marcar en la lista, sin quitarlos',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:2},{name:'café',quantity:1},{name:'pan',quantity:1}]));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'},{name:'café'}],true));
 state=addCheckedToCart(state,listId);
 const list=getActiveList(state);
 assert.equal(list.items.length,3,'ningún artículo se quita de la lista');
 assert.ok(list.items.every(item=>!item.checked),'los marcados vuelven a quedar sin marcar en la lista');
 assert.equal(list.cart.length,2);
 assert.deepEqual(list.cart.map(item=>[item.name,item.quantity,item.checked]).sort(),[['café',1,false],['leche',2,false]]);
});

test('addCheckedToCart sin nada marcado no toca el estado',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:1}]));
 const before=state;
 state=addCheckedToCart(state,listId);
 assert.equal(state,before);
});

test('añadir al carrito dos veces el mismo artículo suma la cantidad en vez de duplicarlo',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:1}]));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'}],true));
 state=addCheckedToCart(state,listId);
 state=updateListItems(state,listId,items=>setShoppingItemQuantity(items,getActiveList(state).items[0].id,3));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'}],true));
 state=addCheckedToCart(state,listId);
 const cart=getActiveList(state).cart;
 assert.equal(cart.length,1);
 assert.equal(cart[0].quantity,4);
});

// Hallazgo de la auditoría completa: fusionar con una línea ya existente del
// carrito solo sumaba la cantidad, sin actualizar el producto vinculado — si
// el artículo de la lista se vinculaba a un producto de Mercadona DESPUÉS de
// la primera vez que se añadía al carrito, esa línea se quedaba sin precio
// ni foto para siempre.
test('añadir al carrito un artículo que se vincula a un producto de Mercadona después de la primera vez actualiza el producto de esa línea',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:1,store:'mercadona'}]));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'}],true));
 state=addCheckedToCart(state,listId);
 assert.equal(getActiveList(state).cart[0].product,null,"la primera vez no había producto vinculado");
 const product={id:'1',name:'Leche entera Hacendado',price:0.95};
 state=updateListItems(state,listId,items=>setShoppingItemProduct(items,getActiveList(state).items[0].id,product));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'}],true));
 state=addCheckedToCart(state,listId);
 const cart=getActiveList(state).cart;
 assert.equal(cart.length,1,"sigue siendo la misma línea, no una duplicada");
 assert.equal(cart[0].quantity,2);
 assert.deepEqual(cart[0].product,product,"la línea del carrito ya refleja el producto vinculado después");
});

test('toggleCartItem y setCartItemQuantity operan sobre el carrito sin tocar la lista',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:1}]));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'}],true));
 state=addCheckedToCart(state,listId);
 const cartItemId=getActiveList(state).cart[0].id;
 state=toggleCartItem(state,listId,cartItemId);
 assert.equal(getActiveList(state).cart[0].checked,true);
 state=setCartItemQuantity(state,listId,cartItemId,5);
 assert.equal(getActiveList(state).cart[0].quantity,5);
 assert.equal(getActiveList(state).items[0].checked,false,'la lista no se ve afectada por cambios en el carrito');
});

test('removeCartItem quita un artículo del carrito sin tocar la lista',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:1}]));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'}],true));
 state=addCheckedToCart(state,listId);
 const cartItemId=getActiveList(state).cart[0].id;
 state=removeCartItem(state,listId,cartItemId);
 assert.equal(getActiveList(state).cart.length,0);
 assert.equal(getActiveList(state).items.length,1,'la lista conserva el artículo');
});

// "lo que haya en el carrito que no se haya comprado seguirá estando ahí":
// solo se archiva lo marcado como comprado; el resto sigue en el carrito.
test('finalizePurchase archiva solo lo marcado como comprado; lo demás sigue en el carrito para la próxima vez',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:2},{name:'café',quantity:1}]));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'},{name:'café'}],true));
 state=addCheckedToCart(state,listId);
 const [lecheId]=getActiveList(state).cart.filter(item=>item.name==='leche').map(item=>item.id);
 state=toggleCartItem(state,listId,lecheId);
 const now=new Date('2026-09-20T12:00:00');
 state=finalizePurchase(state,listId,now);
 const list=getActiveList(state);
 assert.equal(list.cart.length,1);
 assert.equal(list.cart[0].name,'café',"lo no comprado sigue en el carrito");
 assert.equal(list.purchases.length,1);
 assert.equal(list.purchases[0].date,now.toISOString());
 assert.deepEqual(list.purchases[0].items.map(item=>[item.name,item.quantity]),[['leche',2]]);
});

test('finalizePurchase sin nada marcado como comprado no archiva nada',()=>{
 let state=normalizeShoppingState(null);
 const listId=getActiveList(state).id;
 state=updateListItems(state,listId,items=>addShoppingItems(items,[{name:'leche',quantity:1}]));
 state=updateListItems(state,listId,items=>checkShoppingItems(items,[{name:'leche'}],true));
 state=addCheckedToCart(state,listId);
 const before=state;
 state=finalizePurchase(state,listId);
 assert.equal(state,before);
});

test('normalizeShoppingState completa cart/purchases en listas guardadas antes de que existiera el carrito',()=>{
 const legacyMultiList={lists:[{id:'sl-1',name:'Mi lista',items:[]}],activeListId:'sl-1'};
 const state=normalizeShoppingState(legacyMultiList);
 assert.deepEqual(state.lists[0].cart,[]);
 assert.deepEqual(state.lists[0].purchases,[]);
});

// Regresión explícita del propietario: "la lista se queda exactamente como
// estaba... no quites nada de ahí". El carrito se añade como algo aparte;
// el buscador, "Quitar comprados" y "Vaciar lista" de la lista de siempre
// no deben tocarse.
test('el carrito se añade sin tocar nada de la lista de siempre',async()=>{
 const [html,app,ui,css]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../js/app.js',import.meta.url),'utf8'),
  readFile(new URL('../js/ui.js',import.meta.url),'utf8'),
  readFile(new URL('../styles.css',import.meta.url),'utf8')
 ]);
 assert.match(html,/id="shoppingInput"/);
 assert.match(html,/id="shoppingClearChecked"/);
 assert.match(html,/id="shoppingClearAll"/);
 assert.match(html,/id="shoppingAddToCart"/);
 assert.match(html,/id="shoppingCart" hidden/);
 assert.match(html,/id="shoppingPurchases" hidden/);
 assert.match(app,/function shoppingAddCheckedToCart\(\)/);
 assert.match(app,/\$\("shoppingAddToCart"\)\.onclick=shoppingAddCheckedToCart/);
 assert.match(app,/function shoppingFinishPurchase\(\)/);
 assert.match(ui,/function renderShoppingCart\(list\)/);
 assert.match(ui,/function renderShoppingPurchases\(list\)/);
 assert.match(css,/\.shopping-cart-bar-btn/);
});

// Regresión real reportada por el propietario: "Ver carrito" estaba
// escondido detrás del "⋮" — pidió que fuera un acceso directo, junto a
// "Quitar comprados"/"Vaciar lista".
test('"Ver carrito" es un acceso directo junto a Quitar comprados/Vaciar lista, no solo desde el "⋮"',async()=>{
 const [html,app]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../js/app.js',import.meta.url),'utf8')
 ]);
 const filtersRow=html.match(/<div class="library-filters" role="group" aria-label="Acciones de la lista">[\s\S]*?<\/div>/)?.[0]||"";
 assert.match(filtersRow,/id="shoppingClearChecked"/);
 assert.match(filtersRow,/id="shoppingClearAll"/);
 assert.match(filtersRow,/id="shoppingViewCart"/,'"Ver carrito" debe estar en la misma fila que Quitar comprados/Vaciar lista');
 assert.match(app,/\$\("shoppingViewCart"\)\.onclick=\(\)=>openShoppingCart\(shoppingState\.activeListId\)/);
});

// Hallazgo de fricción de la auditoría completa: "Historial de compras"
// seguía escondido detrás del "⋮", a diferencia de "Ver carrito", que ya se
// sacó de ahí en su momento. Mismo tratamiento ahora para el historial.
test('"Historial" es un acceso directo junto a Ver carrito, no solo desde el "⋮"',async()=>{
 const [html,app]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../js/app.js',import.meta.url),'utf8')
 ]);
 const filtersRow=html.match(/<div class="library-filters" role="group" aria-label="Acciones de la lista">[\s\S]*?<\/div>/)?.[0]||"";
 assert.match(filtersRow,/id="shoppingViewPurchases"/,'"Historial" debe estar en la misma fila que Ver carrito');
 assert.match(app,/\$\("shoppingViewPurchases"\)\.onclick=\(\)=>openShoppingPurchases\(shoppingState\.activeListId\)/);
 const quickActionsSource=app.match(/function openShoppingListQuickActions\(listId\)\{[\s\S]*?\n\}/)?.[0]||"";
 assert.ok(quickActionsSource,"openShoppingListQuickActions debe existir");
 assert.doesNotMatch(quickActionsSource,/Historial de compras/,'ya no debe duplicarse dentro del "⋮" ahora que es un acceso directo');
});

// Hallazgo de fricción de la auditoría completa: añadir un artículo a la
// lista siempre abría el modal de confirmación y esperaba a que la búsqueda
// en Mercadona terminara para mostrar los resultados, aunque solo hubiera
// uno — obligando a un toque de más ("Usar este") incluso cuando no hay
// nada que elegir.
test('showShoppingAddConfirm: un único resultado se añade directamente, sin abrir el modal de confirmación',async()=>{
 const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 const source=app.match(/function showShoppingAddConfirm\(addition,listId\)\{[\s\S]*?\n\}\n/)?.[0]||"";
 assert.ok(source,"showShoppingAddConfirm debe existir");
 assert.match(source,/searchMercadonaProduct\(addition\.name,idToken,8\)/,"debe buscar primero, antes de decidir si hace falta el modal");
 assert.match(source,/if\(results\.length===1\)\{finish\(\{name:results\[0\]\.name,store:"mercadona",quantity:addition\.quantity,product:results\[0\]\}\);return\}/,"un único resultado debe añadirse directamente, sin abrir el modal");
 assert.match(source,/openConfirmUI\(\);\s*\n\s*ui\.renderShoppingConfirmResults\(results\);/,"con 0 o varios resultados sí debe abrirse el modal, ya con los resultados listos");
});

// Pedido explícito del propietario: pulsar una compra del historial debe
// enseñar cada artículo con su precio y el total, no solo los nombres.
test('pulsar una compra del historial enseña cada artículo con su precio y el total',async()=>{
 const [html,app,ui]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../js/app.js',import.meta.url),'utf8'),
  readFile(new URL('../js/ui.js',import.meta.url),'utf8')
 ]);
 assert.match(html,/id="shoppingPurchasesList"/);
 assert.match(app,/function openPurchaseDetail\(purchaseId\)/);
 assert.match(app,/\$\("shoppingPurchasesList"\)\.onclick=/);
 assert.match(app,/ui\.showPurchaseDetail\(purchase\)/);
 assert.match(ui,/function purchaseTotal\(purchase\)/);
 assert.match(ui,/function showPurchaseDetail\(purchase\)/);
 assert.match(ui,/data-shopping-purchase-id="\$\{esc\(purchase\.id\)\}"/,'cada tarjeta del historial debe poder identificarse para abrir su ficha al pulsarla');
});

// Hallazgo de la auditoría completa del código: #shoppingLiveBadge,
// #shoppingFallbackAdd y #shoppingSuggestions se ocultan con el atributo
// hidden (ver ui.js: hideShoppingSuggestions, setShoppingFallback), pero sus
// clases (.live-badge, .shopping-fallback-add, .shopping-suggestions) fijan
// su propio "display" — con la misma especificidad que la regla [hidden]
// del navegador, gana la última en el CSS (la de la clase), así que
// ocultarlos con hidden=true no los ocultaba de verdad. Mismo patrón de
// bug ya corregido antes para #shoppingOverview/#shoppingDetail y para
// #dietarioLibrary — aquí se coló en tres elementos añadidos después.
test('el badge "en vivo", el enlace de añadir tal cual y las sugerencias de Mercadona sí se ocultan de verdad con hidden',async()=>{
 const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/#shoppingLiveBadge\[hidden\][^{]*\{display:none\}|#shoppingLiveBadge\[hidden\]\{[^}]*display:none/);
 assert.match(css,/#shoppingFallbackAdd\[hidden\]/);
 assert.match(css,/#shoppingSuggestions\[hidden\]/);
});

// Hallazgo de la auditoría completa del código: pedir "abre la lista de la
// compra" (o el dietario) por voz en pleno modo conversación abría el panel
// de verdad, pero invisible detrás de la pantalla completa oscura del modo
// conversación — #shoppingLibrary/#dietarioLibrary y .conversation-mode
// compartían z-index:4, y en un empate gana quien va después en el DOM
// (.conversation-mode, más abajo en index.html).
test('la lista de la compra y el dietario quedan por delante del modo conversación, no empatados en z-index',async()=>{
 const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
 const shoppingZ=Number(css.match(/#shoppingLibrary\{z-index:(\d+)\}/)?.[1]);
 const dietarioZ=Number(css.match(/#dietarioLibrary\{z-index:(\d+)\}/)?.[1]);
 const conversationZ=Number(css.match(/\.conversation-mode\{[^}]*z-index:(\d+)/)?.[1]);
 const actionModalZ=Number(css.match(/\.action-modal\{[^}]*z-index:(\d+)/)?.[1]);
 assert.ok(shoppingZ>conversationZ,"la lista de la compra debe quedar por delante del modo conversación");
 assert.ok(dietarioZ>conversationZ,"el dietario debe quedar por delante del modo conversación");
 assert.ok(shoppingZ<actionModalZ&&dietarioZ<actionModalZ,"pero siguen por detrás del menú rápido de #actionModal, como antes");
});

// Mejora pedida explícitamente por el propietario, aparte de la auditoría:
// cada lista se asocia a una tienda concreta al crearla, elegida entre las
// que él mismo compra. Mercadona sigue siendo el valor por defecto — hace
// el 80-90% de su compra ahí, y así ninguna lista ya existente cambia de
// comportamiento — pero ahora se puede crear una lista para otra tienda,
// que se queda como una lista de artículos escritos a mano (sin catálogo).
test('una lista nueva se puede asociar a una tienda de una lista de presets, con Mercadona por defecto',()=>{
 let state=normalizeShoppingState(null);
 assert.equal(getActiveList(state).store,'mercadona',"la lista de siempre, sin elegir tienda, sigue siendo Mercadona");
 state=createShoppingList(state,'Fran');
 assert.equal(state.lists.at(-1).store,'mercadona',"crear una lista sin indicar tienda también cae en Mercadona por defecto");
 state=createShoppingList(state,'Bricolaje','leroy-merlin');
 assert.equal(state.lists.at(-1).store,'leroy-merlin');
 assert.ok(SHOPPING_STORE_PRESETS.some(preset=>preset.id==='consum'));
 assert.ok(SHOPPING_STORE_PRESETS.some(preset=>preset.id==='carrefour'));
 assert.ok(SHOPPING_STORE_PRESETS.some(preset=>preset.id==='family-cash'));
 assert.ok(SHOPPING_STORE_PRESETS.some(preset=>preset.id==='plaza-mayor'));
 assert.equal(shoppingStoreLabel('leroy-merlin'),'Leroy Merlin');
});

test('normalizeShoppingState rellena "mercadona" en listas guardadas antes de esta función, sin cambiar su comportamiento',()=>{
 const state=normalizeShoppingState({lists:[{id:'l1',name:'Mi lista',items:[]}],activeListId:'l1'});
 assert.equal(state.lists[0].store,'mercadona');
});

test('isMercadonaList trata una lista sin tienda como Mercadona (compatibilidad) y reconoce el resto',()=>{
 assert.equal(isMercadonaList({store:'mercadona'}),true);
 assert.equal(isMercadonaList({}),true,"una lista antigua sin store todavía se comporta como Mercadona");
 assert.equal(isMercadonaList(null),true);
 assert.equal(isMercadonaList({store:'carrefour'}),false);
});

test('setShoppingListStore cambia la tienda de una lista concreta sin tocar las demás',()=>{
 let state=normalizeShoppingState(null);
 state=createShoppingList(state,'Fran','consum');
 const [defaultId,franId]=state.lists.map(list=>list.id);
 state=setShoppingListStore(state,franId,'carrefour');
 assert.equal(state.lists.find(list=>list.id===franId).store,'carrefour');
 assert.equal(state.lists.find(list=>list.id===defaultId).store,'mercadona',"la otra lista no se ve afectada");
 const before=state;
 state=setShoppingListStore(state,franId,'tienda-inventada');
 assert.equal(state,before,"una tienda que no está en los presets no se acepta");
});

// Hallazgo/mejora: la búsqueda en vivo (con precio y foto) solo tiene
// sentido para Mercadona, que es la única tienda con catálogo real
// (searchMercadonaProduct en ai.js) — "no tenemos ni API ni manera de hacer
// lo mismo que hacemos en Mercadona" para el resto, así que escribir en una
// lista de otra tienda debe ofrecer solo añadir el artículo tal cual.
test('escribir en una lista que no es de Mercadona no dispara la búsqueda en vivo (código fuente)',()=>{
 const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 assert.match(app,/function scheduleShoppingSearch\(\)\{[\s\S]{0,400}isMercadonaList\(getActiveList\(shoppingState\)\)/,"scheduleShoppingSearch debe comprobar la tienda de la lista activa");
 assert.match(app,/if\(!mercadona\)\{hideShoppingSuggestions\(\);return\}/,"si la lista no es de Mercadona, no debe programarse ninguna búsqueda");
 assert.match(app,/shoppingInput"\)\.onkeydown=event=>\{if\(event\.key==="Enter"\)\{event\.preventDefault\(\);const raw=[\s\S]{0,120}isMercadonaList\(getActiveList\(shoppingState\)\)\)\{addShoppingItemAsIs\(raw\);return\}/,"pulsar Enter en una lista de otra tienda debe añadir el artículo directamente, no buscar");
});

// Hallazgo de fricción de la auditoría completa: bajar la cantidad a 0 en la
// lista (o en el carrito) se quedaba clavada en 1 (setShoppingItemQuantity/
// setCartItemQuantity nunca bajan de ahí) — había que buscar la ✕ aparte
// para quitar el artículo, como en cualquier carrito normal.
test('bajar la cantidad de 1 a 0 en la lista quita el artículo directamente, no se queda clavada en 1',()=>{
 const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 const listClickSource=app.match(/function shoppingItemClick\(event\)\{[\s\S]*?\n\}/)?.[0]||"";
 assert.ok(listClickSource,"shoppingItemClick debe existir");
 assert.match(listClickSource,/if\(action==="qty-dec"&&\(item\.quantity\|\|1\)<=1\)\{void persistShoppingState\(updateListItems\(shoppingState,listId,items=>removeShoppingItemById\(items,id\)\)\);return\}/,"bajar de 1 debe quitar el artículo, no quedarse clavado");
 const cartClickSource=app.match(/function shoppingCartItemClick\(event\)\{[\s\S]*?\n\}/)?.[0]||"";
 assert.ok(cartClickSource,"shoppingCartItemClick debe existir");
 assert.match(cartClickSource,/if\(action==="cart-qty-dec"&&\(item\.quantity\|\|1\)<=1\)\{void persistShoppingState\(removeCartItem\(shoppingState,listId,id\)\);return\}/,"lo mismo debe pasar en el carrito");
});

// Hallazgo de fricción de la auditoría completa: crear/renombrar/borrar/
// vaciar una lista de la compra seguía usando prompt()/confirm() del
// navegador — los últimos cuadros feos que quedaban en esta parte de la app.
test('crear, renombrar, borrar y vaciar una lista usan el modal propio de la app, no prompt()/confirm()',()=>{
 const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/prompt\("Nombre de la nueva lista/,"crear una lista ya no debe usar prompt()");
 assert.doesNotMatch(app,/prompt\("Nuevo nombre para la lista/,"renombrar una lista ya no debe usar prompt()");
 assert.doesNotMatch(app,/confirm\('¿Borrar la lista/,"borrar una lista ya no debe usar confirm()");
 assert.doesNotMatch(app,/confirm\('¿Vaciar toda la lista/,"vaciar una lista ya no debe usar confirm()");
 assert.match(app,/ui\.showShoppingNamePrompt\(\{title:"Nueva lista"/);
 assert.match(app,/ui\.showShoppingNamePrompt\(\{title:"Cambiar nombre"/);
 assert.match(app,/ui\.showShoppingDeleteConfirm\(list,\{onConfirm:/);
 assert.match(app,/ui\.showShoppingClearConfirm\(list,\{onConfirm:/);
 const ui=readFileSync(new URL('../js/ui.js',import.meta.url),'utf8');
 assert.match(ui,/function showShoppingNamePrompt\(/);
 assert.match(ui,/function showShoppingDeleteConfirm\(list, \{ onConfirm, onCancel \} = \{\}\)/);
 assert.match(ui,/function showShoppingClearConfirm\(list, \{ onConfirm, onCancel \} = \{\}\)/);
});

// Reportado en la 2ª auditoría (usabilidad): "Quitar comprados" borraba los
// artículos marcados SIN confirmar, y como marcar ahora significa "lo quiero
// esta vez" (no "ya lo compré"), era fácil perder de golpe lo que en realidad
// querías pasar al carrito. Ahora confirma antes de borrar, y la interfaz ya
// no llama "comprado" a lo marcado.
test('quitar los artículos marcados de la lista ahora pide confirmación, y ya no se llaman "comprados"',()=>{
 const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../js/ui.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const clearCheckedSource=app.match(/\$\("shoppingClearChecked"\)\.onclick=\(\)=>\{[\s\S]*?\n\};/)?.[0]||"";
 assert.ok(clearCheckedSource,"el handler de shoppingClearChecked debe existir");
 assert.match(clearCheckedSource,/ui\.showShoppingRemoveMarkedConfirm\(marked,\{onConfirm:/,"debe pedir confirmación antes de borrar los marcados");
 assert.match(clearCheckedSource,/onlyChecked:true/,"solo debe borrar los marcados, no la lista entera");
 assert.match(ui,/function showShoppingRemoveMarkedConfirm\(count, \{ onConfirm, onCancel \} = \{\}\)/,"debe existir el modal de confirmación propio");
 assert.match(ui,/showShoppingRemoveMarkedConfirm,/,"y estar exportado");
 // Relabel: la interfaz de la lista ya no llama "comprado" a lo marcado.
 assert.match(html,/id="shoppingClearChecked">Quitar marcados</,"el botón ya no dice \"Quitar comprados\"");
 assert.match(ui,/'<div class="day">Marcados<\/div>'/,"la cabecera de la sección ya no dice \"Comprado\"");
 assert.doesNotMatch(ui,/aria-label="\$\{item\.checked \? "Marcar como pendiente" : "Marcar como comprado"\}"/,"el check ya no se describe como \"comprado\"");
});
