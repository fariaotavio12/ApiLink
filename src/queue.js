// src/queue.js
import { customAlphabet } from "nanoid";
import { saveStateSync, state } from "./storage.js";
import { isBlockedHost } from "./utils.js";
import { WorkerPool } from "./workerPool.js";

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const AUTO_SAVE_MS = Number(process.env.STATE_AUTO_SAVE_MS || 5000);
const BLOCKED = (process.env.BLOCKED_HOSTS || "").split(",");
const MAX_RETRIES_PER_RUN = Number(process.env.MAX_RETRIES_PER_RUN || 2);
const BASE_DELAY_MS = Number(process.env.BASE_DELAY_MS || 1000);

export class TaskQueue {
	pool = new WorkerPool(CONCURRENCY);
	timer = null;
	saveTimer = null;

	start() {
		if (!this.timer) this.timer = setInterval(() => this.tick(), 200);
		if (!this.saveTimer) this.saveTimer = setInterval(() => saveStateSync(), AUTO_SAVE_MS);
	}
	stop() {
		if (this.timer) clearInterval(this.timer);
		if (this.saveTimer) clearInterval(this.saveTimer);
	}

	createTask(url, repeat, intervalMs, options) {
		if (isBlockedHost(url, BLOCKED)) throw new Error("Host bloqueado ou URL inválida");
		if (!/^https?:\/\//i.test(url)) throw new Error("URL deve começar com http(s)://");
		if (!(repeat >= 1 && repeat <= 10000)) throw new Error("repeat fora do limite (1..10000)");
		if (!(intervalMs >= 100)) throw new Error("intervalMs mínimo é 100ms");

		const id = `t_${nano()}`;
		const t = {
			id,
			url,
			repeat,
			intervalMs,
			options: options || {},
			createdAt: Date.now(),
			status: "queued",
			doneCount: 0,
			failedCount: 0,
			inFlight: 0, // <- NOVO
			nextRunAt: Date.now(),
			runs: [],
		};
		state.tasks[id] = t;
		return t;
	}

	list(status) {
		const tasks = Object.values(state.tasks);
		return status ? tasks.filter((t) => t.status === status) : tasks;
	}

	get(id) {
		return state.tasks[id];
	}
	pause(id) {
		const t = this._get(id);
		if (t.status === "running" || t.status === "queued") t.status = "paused";
		return t;
	}
	resume(id) {
		const t = this._get(id);
		if (t.status === "paused") {
			t.status = "running";
			t.nextRunAt = Date.now();
		}
		return t;
	}
	cancel(id) {
		const t = this._get(id);
		t.status = "canceled";
		return t;
	}
	remove(id) {
		delete state.tasks[id];
	}

	_get(id) {
		const t = this.get(id);
		if (!t) throw new Error("Task não encontrada");
		return t;
	}

	async _runWithRetries(task, runIndex, payload) {
		let attempt = 0;
		while (attempt <= MAX_RETRIES_PER_RUN) {
			try {
				const r = await this.pool.run(payload);
				return { ok: true, r, attempt };
			} catch (e) {
				if (attempt >= MAX_RETRIES_PER_RUN) {
					return { ok: false, e, attempt };
				}
				const delay = BASE_DELAY_MS * Math.pow(2, attempt);
				await new Promise((res) => setTimeout(res, delay));
			}
			attempt++;
		}
	}

	async tick() {
		const now = Date.now();
		for (const t of Object.values(state.tasks)) {
			if (t.status === "queued") t.status = "running";

			// Finaliza cedo se já atingiu o repeat considerando os jobs em voo
			const totalInclInflight = (t.doneCount || 0) + (t.failedCount || 0) + (t.inFlight || 0);
			if (totalInclInflight >= t.repeat) {
				if (t.status === "running") {
					t.status = t.failedCount ? "failed" : "done";
					t.nextRunAt = undefined;
				}
				continue;
			}

			if (t.status !== "running") continue;
			if ((t.inFlight || 0) > 0) continue; // <- NÃO agenda se já tem execução em andamento
			if ((t.nextRunAt ?? now) > now) continue;

			const runIndex = totalInclInflight + 1;
			t.inFlight = (t.inFlight || 0) + 1; // <- marca em voo antes de disparar
			t.nextRunAt = now + t.intervalMs;

			const payload = { taskId: t.id, runIndex, url: t.url, options: t.options };
			this._runWithRetries(t, runIndex, payload).then((res) => {
				if (res.ok) this.onRunOk(t, runIndex, res.r, res.attempt);
				else this.onRunErr(t, runIndex, res.e, res.attempt);
			});
		}
	}

	onRunOk(t, runIndex, r, attempts) {
		t.inFlight = Math.max(0, (t.inFlight || 1) - 1); // <- decrementa em voo
		t.runs.push({
			n: runIndex,
			startedAt: r.startedAt,
			endedAt: r.endedAt,
			status: "ok",
			title: r.title,
			finalUrl: r.finalUrl,
			httpStatus: r.httpStatus,
			screenshotPath: r.screenshotPath,
			attempts: attempts + 1,
		});
		t.doneCount++;

		// Se atingiu repeat, fecha a tarefa
		if (t.doneCount + t.failedCount >= t.repeat) {
			t.status = t.failedCount ? "failed" : "done";
			t.nextRunAt = undefined;
		}
	}

	onRunErr(t, runIndex, e, attempts) {
		t.inFlight = Math.max(0, (t.inFlight || 1) - 1); // <- decrementa em voo
		t.runs.push({
			n: runIndex,
			startedAt: e?.startedAt ?? Date.now(),
			endedAt: e?.endedAt ?? Date.now(),
			status: "error",
			errorSnippet: String(e?.errorSnippet ?? e),
			attempts: attempts + 1,
		});
		t.failedCount++;

		if (t.doneCount + t.failedCount >= t.repeat) {
			t.status = t.failedCount ? "failed" : "done";
			t.nextRunAt = undefined;
		}
	}
}
