// state.js
const tasksMap = new Map();

export const state = { tasks: {} };

// ttlMs opcional (em ms). Ex: 10min = 10 * 60 * 1000
export function setTask(id, value, ttlMs) {
	tasksMap.set(id, {
		value,
		expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
	});
	state.tasks[id] = value; // compat
}

export function getTask(id) {
	const entry = tasksMap.get(id);
	if (!entry) return undefined;

	if (entry.expiresAt && entry.expiresAt < Date.now()) {
		tasksMap.delete(id);
		delete state.tasks[id];
		return undefined;
	}
	return entry.value;
}

export function removeTask(id) {
	tasksMap.delete(id);
	delete state.tasks[id];
}

export function listTasks() {
	// limpa expiradas
	for (const [id, entry] of tasksMap.entries()) {
		if (entry.expiresAt && entry.expiresAt < Date.now()) {
			tasksMap.delete(id);
			delete state.tasks[id];
		}
	}
	return state.tasks;
}

// Mantém interface antiga
export function ensureDataDirs() {}
export function saveStateSync() {}
export function loadStateIfAny() {}
