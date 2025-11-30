import path from "node:path";
import { parentPort } from "node:worker_threads";
import puppeteer from "puppeteer";

if (!parentPort) throw new Error("worker precisa de parentPort");

parentPort.on("message", async (job) => {
	const startedAt = Date.now();
	let browser = null;
	try {
		browser = await puppeteer.launch({ headless: true });
		const page = await browser.newPage();

		if (job.options?.userAgent) await page.setUserAgent(job.options.userAgent);
		if (job.options?.headers) await page.setExtraHTTPHeaders(job.options.headers);
		if (job.options?.viewport) await page.setViewport(job.options.viewport);

		const resp = await page.goto(job.url, {
			timeout: job.options?.timeoutMs ?? 30_000,
			waitUntil: job.options?.navigationWait ?? "networkidle2",
		});

		const title = await page.title();
		const finalUrl = page.url();
		const httpStatus = resp?.status();

		let screenshotPath;
		if (job.options?.screenshot) {
			const fileName = `${job.taskId}-${job.runIndex}-${Date.now()}.png`;
			const filePath = path.join("data", "screenshots", fileName);
			await page.screenshot({ path: filePath, fullPage: true });
			screenshotPath = filePath;
		}

		await browser.close();

		parentPort.postMessage({
			ok: true,
			result: {
				startedAt,
				endedAt: Date.now(),
				status: "ok",
				title,
				finalUrl,
				httpStatus,
				screenshotPath,
			},
		});
	} catch (err) {
		try {
			if (browser) await browser.close();
		} catch {}
		parentPort.postMessage({
			ok: false,
			result: {
				startedAt,
				endedAt: Date.now(),
				status: "error",
				errorSnippet: String(err?.message ?? err),
			},
		});
	}
});
