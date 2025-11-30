import cors from "cors";
import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import client from "prom-client";
import { z } from "zod";
import { TaskQueue } from "./queue.js";
import { ensureDataDirs, loadStateIfAny } from "./storage.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(morgan("dev"));

const limiter = rateLimit({
	windowMs: Number(process.env.REQUESTS_RATE_TIME_WINDOW_MS || 60000),
	max: Number(process.env.REQUESTS_RATE_LIMIT || 120),
});
app.use(limiter);

// metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const requestsCounter = new client.Counter({ name: "http_requests_total", help: "total http requests", labelNames: ["route", "method", "code"] });
register.registerMetric(requestsCounter);
app.use((req, res, next) => {
	res.on("finish", () => {
		requestsCounter.labels(req.path, req.method, String(res.statusCode)).inc();
	});
	next();
});

const queue = new TaskQueue();
ensureDataDirs();
loadStateIfAny();
queue.start();

const TaskBody = z.object({
	url: z.string().url(),
	repeat: z.number().int().min(1).max(10000),
	intervalMs: z.number().int().min(100),
	timeoutMs: z.number().int().min(1000).max(120000).optional(),
	userAgent: z.string().min(1).max(512).optional(),
	headers: z.record(z.string()).optional(),
	viewport: z.object({ width: z.number().min(100).max(8192), height: z.number().min(100).max(8192) }).optional(),
	navigationWait: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional(),
	screenshot: z.boolean().optional(),
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/metrics", async (req, res) => {
	res.set("Content-Type", register.contentType);
	res.end(await register.metrics());
});

app.post("/tasks", (req, res) => {
	try {
		const body = TaskBody.parse(req.body);
		const t = queue.createTask(body.url, body.repeat, body.intervalMs, {
			timeoutMs: body.timeoutMs,
			userAgent: body.userAgent,
			headers: body.headers,
			viewport: body.viewport,
			navigationWait: body.navigationWait,
			screenshot: body.screenshot,
		});
		res.status(201).json({ id: t.id, status: t.status });
	} catch (e) {
		res.status(400).json({ error: String(e.message || e) });
	}
});

app.post("/tasks/batch", (req, res) => {
	try {
		const arr = z.array(TaskBody).parse(req.body);
		const created = arr
			.map((b) =>
				queue.createTask(b.url, b.repeat, b.intervalMs, {
					timeoutMs: b.timeoutMs,
					userAgent: b.userAgent,
					headers: b.headers,
					viewport: b.viewport,
					navigationWait: b.navigationWait,
					screenshot: b.screenshot,
				})
			)
			.map((t) => ({ id: t.id, status: t.status }));
		res.status(201).json(created);
	} catch (e) {
		res.status(400).json({ error: String(e.message || e) });
	}
});

app.get("/tasks", (req, res) => {
	const status = req.query.status;
	const list = queue.list(status).map((t) => ({
		id: t.id,
		url: t.url,
		status: t.status,
		createdAt: t.createdAt,
		doneCount: t.doneCount,
		failedCount: t.failedCount,
		repeat: t.repeat,
		intervalMs: t.intervalMs,
		nextRunAt: t.nextRunAt,
	}));
	res.json(list);
});

app.get("/tasks/:id", (req, res) => {
	const t = queue.get(req.params.id);
	if (!t) return res.status(404).json({ error: "not found" });
	res.json(t);
});

app.get("/tasks/:id/runs", (req, res) => {
	const t = queue.get(req.params.id);
	if (!t) return res.status(404).json({ error: "not found" });
	const limit = Number(req.query.limit || 50);
	const offset = Number(req.query.offset || 0);
	res.json(t.runs.slice(offset, offset + limit));
});

app.post("/tasks/:id/pause", (req, res) => {
	try {
		const t = queue.pause(req.params.id);
		res.json({ id: t.id, status: t.status });
	} catch (e) {
		res.status(404).json({ error: "not found" });
	}
});
app.post("/tasks/:id/resume", (req, res) => {
	try {
		const t = queue.resume(req.params.id);
		res.json({ id: t.id, status: t.status });
	} catch (e) {
		res.status(404).json({ error: "not found" });
	}
});
app.post("/tasks/:id/cancel", (req, res) => {
	try {
		const t = queue.cancel(req.params.id);
		res.json({ id: t.id, status: t.status });
	} catch (e) {
		res.status(404).json({ error: "not found" });
	}
});
app.delete("/tasks/:id", (req, res) => {
	queue.remove(req.params.id);
	res.status(204).end();
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
	console.log(`➡️  API rodando em http://localhost:${port}`);
});

app.use(express.static("public"));

app.get("/", (req, res) => {
	res.redirect("/");
});
