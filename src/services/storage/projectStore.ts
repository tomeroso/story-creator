import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_CAPTION_STYLE, type StoryProject } from '../../types/story';

const DB_NAME = 'story-creator';
const DB_VERSION = 1;
const STORE = 'projects';

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

export async function saveProject(project: StoryProject): Promise<void> {
  const db = await getDb();
  await db.put(STORE, { ...project, updatedAt: Date.now() });
}

export async function loadProject(id: string): Promise<StoryProject | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function listProjects(): Promise<StoryProject[]> {
  const db = await getDb();
  const all = await db.getAll(STORE);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export const DEFAULT_PROJECT_NAME = 'Untitled story';

export function createEmptyProject(name = DEFAULT_PROJECT_NAME): StoryProject {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    rawText: '',
    cleanedText: '',
    preserveOriginalWording: false,
    segments: [],
    voiceId: 'af_heart',
    voiceSpeed: 1,
    backgroundPlaybackRate: 1,
    backgroundFlip: false,
    renderQuality: 'final',
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
  };
}
