import { openDB, type IDBPDatabase } from 'idb';

export interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'sfx';
  blob: Blob;
  createdAt: number;
}

const DB_NAME = 'story-creator-media';
const DB_VERSION = 1;
const STORE = 'assets';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * `forceType` distinguishes uploads that share the same MIME type but a
 * different purpose - a music track and a short sound effect are both
 * "audio/*" files, so the upload location (Music vs Sound Effects section)
 * decides which one it's saved as.
 */
export async function saveMediaAsset(file: File, forceType?: MediaAsset['type']): Promise<MediaAsset> {
  const db = await getDb();
  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    name: file.name,
    type: forceType ?? (file.type.startsWith('audio/') ? 'audio' : 'video'),
    blob: file,
    createdAt: Date.now(),
  };
  await db.put(STORE, asset);
  return asset;
}

export async function listMediaAssets(type?: MediaAsset['type']): Promise<MediaAsset[]> {
  const db = await getDb();
  const all: MediaAsset[] = await db.getAll(STORE);
  const filtered = type ? all.filter((a) => a.type === type) : all;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function pickRandomMediaAsset(type: MediaAsset['type'] = 'video'): Promise<MediaAsset | null> {
  const all = await listMediaAssets(type);
  if (all.length === 0) return null;
  return all[Math.floor(Math.random() * all.length)];
}

export async function getMediaAsset(id: string): Promise<MediaAsset | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}
