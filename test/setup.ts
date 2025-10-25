import 'fake-indexeddb/auto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

// @ts-ignore
global.indexedDB = indexedDB;
// @ts-ignore
global.IDBKeyRange = IDBKeyRange;
