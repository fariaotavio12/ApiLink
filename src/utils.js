export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export function isBlockedHost(urlStr, blocked) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return blocked.filter(Boolean).some((b) => host.endsWith(b.trim().toLowerCase()));
  } catch {
    return true;
  }
}
