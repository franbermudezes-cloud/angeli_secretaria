import test from 'node:test';
import assert from 'node:assert/strict';
import {
 parseShoppingCommand,parseItemList,addShoppingItems,removeShoppingItems,checkShoppingItems,clearShoppingList,
 toggleShoppingItem,setShoppingItemProduct,setShoppingItemQuantity,describeShoppingItems,shoppingListTotal,
 normalizeShoppingState,makeShoppingList,getActiveList,findListByName,createShoppingList,renameShoppingList,
 deleteShoppingList,setActiveShoppingList,updateListItems
} from '../js/shopping.js';

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
