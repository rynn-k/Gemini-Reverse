'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Endpoint, Headers } = require('../constants');
const { AuthError } = require('../exceptions');

function cookieStr(c) {
    return Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseCookies(headers, base = {}) {
    const out = { ...base };
    const raw = headers['set-cookie'] || headers['Set-Cookie'];
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const s of arr) {
        const p = s.split(';')[0].trim();
        const eq = p.indexOf('=');
        if (eq !== -1) out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
    }
    return out;
}

function parseProxy(str) {
    if (!str) return undefined;
    try { const u = new URL(str); return { protocol: u.protocol.replace(':', ''), host: u.hostname, port: parseInt(u.port) }; }
    catch { return undefined; }
}

function cacheDir() {
    return process.env.GEMINI_COOKIE_PATH
        ? path.resolve(process.env.GEMINI_COOKIE_PATH)
        : path.join(__dirname, 'temp');
}

async function sendInitRequest(cookies, proxy = null) {
    const res = await axios.get(Endpoint.INIT, {
        headers: { ...Headers.GEMINI, 'Cookie': cookieStr(cookies) },
        maxRedirects: 5,
        ...(proxy ? { proxy: parseProxy(proxy) } : {}),
    });
    const t = res.data;
    const snlm0e = (t.match(/"SNlM0e":\s*"(.*?)"/) || [])[1] || null;
    const cfb2h = (t.match(/"cfb2h":\s*"(.*?)"/) || [])[1] || null;
    const fdrfje = (t.match(/"FdrFJe":\s*"(.*?)"/) || [])[1] || null;
    if (!snlm0e && !cfb2h && !fdrfje) throw new AuthError('Cookies invalid.');
    return [snlm0e, cfb2h, fdrfje, parseCookies(res.headers, cookies)];
}

async function getAccessToken(baseCookies, proxy = null, verbose = false) {
    let extraCookies = {};
    try {
        const r = await axios.get(Endpoint.GOOGLE, { maxRedirects: 5, ...(proxy ? { proxy: parseProxy(proxy) } : {}) });
        if (r.status === 200) extraCookies = parseCookies(r.headers);
    } catch {}

    const tasks = [];
    const jar = (base, extra = {}) => ({ ...extraCookies, ...base, ...extra });
    const dir = cacheDir();

    if (baseCookies['__Secure-1PSID'])
        tasks.push(sendInitRequest(jar(baseCookies), proxy));

    const psid = baseCookies['__Secure-1PSID'];
    if (psid) {
        const f = path.join(dir, `.cached_1psidts_${psid}.txt`);
        if (fs.existsSync(f)) {
            const cached = fs.readFileSync(f, 'utf8');
            if (cached) tasks.push(sendInitRequest(jar(baseCookies, { '__Secure-1PSIDTS': cached }), proxy));
            else if (verbose) console.debug('Skipping cached cookies. Cache file is empty.');
        } else if (verbose) {
            console.debug('Skipping cached cookies. Cache file not found.');
        }
    } else if (fs.existsSync(dir)) {
        let validCaches = 0;
        for (const file of fs.readdirSync(dir).filter(f => f.startsWith('.cached_1psidts_'))) {
            const cached = fs.readFileSync(path.join(dir, file), 'utf8');
            if (cached) {
                tasks.push(sendInitRequest(jar({}, { '__Secure-1PSID': file.slice(16), '__Secure-1PSIDTS': cached }), proxy));
                validCaches++;
            }
        }
        if (validCaches === 0 && verbose) console.debug('Skipping cached cookies. No valid caches found.');
    }

    if (!tasks.length)
        throw new AuthError('No valid cookies available. Please pass __Secure-1PSID and optionally __Secure-1PSIDTS.');

    let lastErr;
    for (let i = 0; i < tasks.length; i++) {
        try {
            const result = await tasks[i];
            if (verbose) console.debug(`Init attempt (${i + 1}/${tasks.length}) succeeded.`);
            return result;
        } catch (e) {
            lastErr = e;
            if (verbose) console.debug(`Init attempt (${i + 1}/${tasks.length}) failed: ${e.message}`);
        }
    }

    throw new AuthError(`Failed to initialize client. (Failed attempts: ${tasks.length})`);
}

module.exports = { getAccessToken, sendInitRequest, cookieStr, parseCookies, parseProxy, cacheDir };