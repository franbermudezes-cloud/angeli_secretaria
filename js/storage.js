export const NOTES_KEY="angeli_secretaria_notes_v5";
export const MEDIA_DB="angeli_secretaria_media";
export const MEDIA_STORES={images:"images",files:"files"};

export function readNotes(){try{return JSON.parse(localStorage.getItem(NOTES_KEY)||"[]")}catch(e){return[]}}
export function writeNotes(notes){localStorage.setItem(NOTES_KEY,JSON.stringify(notes))}
export function clearNotes(){localStorage.removeItem(NOTES_KEY)}
export function openMediaDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open(MEDIA_DB,1);request.onupgradeneeded=()=>{const db=request.result;Object.values(MEDIA_STORES).forEach(store=>{if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:"id"})})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
export async function putMedia(store,record){const db=await openMediaDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
export async function getMedia(store,id){const db=await openMediaDB();return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
export async function deleteMedia(store,id){const db=await openMediaDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
export function deleteMediaDB(){return new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(MEDIA_DB);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error("La base de datos está en uso"))})}
export async function migrateLegacyImages(notes){let changed=false;for(const note of notes){if(!note.images?.some(image=>typeof image==="string"&&image.startsWith("data:")))continue;const migrated=[];let complete=true;for(const image of note.images){if(!image.startsWith?.("data:")){migrated.push(image);continue}try{const blob=await fetch(image).then(response=>response.blob());const id=crypto.randomUUID();await putMedia(MEDIA_STORES.images,{id,blob,type:blob.type,size:blob.size});migrated.push(id)}catch(e){complete=false;break}}if(complete){note.images=migrated;changed=true}}return changed}
