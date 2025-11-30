import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

export const state = { tasks: {} };

export function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const shots = path.join(DATA_DIR, 'screenshots');
  if (!fs.existsSync(shots)) fs.mkdirSync(shots, { recursive: true });
}

export function saveStateSync() {
  ensureDataDirs();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadStateIfAny() {
  ensureDataDirs();
  if (fs.existsSync(STATE_FILE)) {
    try {
      const json = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      Object.assign(state.tasks, json.tasks || {});
    } catch (e) {
      console.warn('Falha lendo state.json:', e);
    }
  }
}
