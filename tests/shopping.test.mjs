import test from 'node:test';
import assert from 'node:assert/strict';
import {parseShoppingCommand,parseItemList,addShoppingItems,removeShoppingItems,checkShoppingItems,clearShoppingList,toggleShoppingItem,setShoppingItemProduct,setShoppingItemQuantity,describeShoppingItems} from '../js/shopping.js';

test('reconoce añadir un solo artículo a la lista de la compra',()=>{
 const command=parseShoppingCommand('añade leche a la lista de la compra');
 assert.equal(command.action,'add');
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

test('reconoce vaciar la lista entera',()=>{
 assert.deepEqual(parseShoppingCommand('vacía la lista de la compra'),{action:'clear'});
 assert.deepEqual(parseShoppingCommand('limpia la lista del súper'),{action:'clear'});
});

test('reconoce una consulta sin artículos como apertura de la lista',()=>{
 assert.deepEqual(parseShoppingCommand('qué tengo en la lista de la compra'),{action:'query'});
 assert.deepEqual(parseShoppingCommand('lista de la compra'),{action:'query'});
 assert.deepEqual(parseShoppingCommand('abre la lista de la compra'),{action:'query'});
});

test('un texto sin mención a la lista de la compra no se reconoce (no debe tocar notas ni recordatorios)',()=>{
 assert.equal(parseShoppingCommand('recuérdame llamar a Ana'),null);
 assert.equal(parseShoppingCommand('apunta que compre pan'),null);
});

test('reconoce "busca X en/de mercadona" como búsqueda, sin exigir "lista de la compra"',()=>{
 assert.deepEqual(parseShoppingCommand('busca leche en la lista de mercadona'),{action:'search',query:'leche',store:'mercadona'});
 assert.deepEqual(parseShoppingCommand('busca leche en mercadona'),{action:'search',query:'leche',store:'mercadona'});
 assert.deepEqual(parseShoppingCommand('busca la cerveza de mercadona'),{action:'search',query:'cerveza',store:'mercadona'});
 assert.deepEqual(parseShoppingCommand('mira el chorizo en consum'),{action:'search',query:'chorizo',store:'consum'});
});

test('"añade la leche de mercadona a la lista de la compra" sigue siendo un "add", no una búsqueda',()=>{
 const command=parseShoppingCommand('añade la leche de mercadona a la lista de la compra');
 assert.equal(command.action,'add');
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
