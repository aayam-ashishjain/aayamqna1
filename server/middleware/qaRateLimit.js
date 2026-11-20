const WINDOW_MS = 60_000;
const COOLDOWN_MS = 5_000;
const MAX_PER_CLIENT = 3;
const MAX_PER_IP = 20;

const clientHits = new Map();
const ipHits = new Map();

function prune(timestamps, now) {
  return timestamps.filter((ts) => now - ts < WINDOW_MS);
}

function checkQaRateLimit(clientId, ip) {
  const now = Date.now();
  const cKey = String(clientId || 'unknown');
  const iKey = String(ip || 'unknown');

  const cRecent = prune(clientHits.get(cKey) || [], now);
  if (cRecent.length > 0 && now - cRecent[cRecent.length - 1] < COOLDOWN_MS) {
    const retrySec = Math.ceil((COOLDOWN_MS - (now - cRecent[cRecent.length - 1])) / 1000);
    return { allowed: false, retrySec, reason: `Wait ${retrySec}s before submitting another question.` };
  }

  if (cRecent.length >= MAX_PER_CLIENT) {
    const retrySec = Math.ceil((WINDOW_MS - (now - cRecent[0])) / 1000);
    return { allowed: false, retrySec, reason: `Limit reached (${MAX_PER_CLIENT}/min). Try again in ${retrySec}s.` };
  }

  const iRecent = prune(ipHits.get(iKey) || [], now);
  if (iRecent.length >= MAX_PER_IP) {
    const retrySec = Math.ceil((WINDOW_MS - (now - iRecent[0])) / 1000);
    return { allowed: false, retrySec, reason: `Too many submissions from your network. Wait ${retrySec}s.` };
  }

  cRecent.push(now);
  iRecent.push(now);
  clientHits.set(cKey, cRecent);
  ipHits.set(iKey, iRecent);

  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, list] of clientHits) {
    const recent = prune(list, now);
    if (recent.length) clientHits.set(key, recent);
    else clientHits.delete(key);
  }
  for (const [key, list] of ipHits) {
    const recent = prune(list, now);
    if (recent.length) ipHits.set(key, recent);
    else ipHits.delete(key);
  }
}, WINDOW_MS).unref();

module.exports = { checkQaRateLimit };
