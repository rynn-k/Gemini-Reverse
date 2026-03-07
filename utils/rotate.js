'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Endpoint, Headers } = require('../constants');
const { AuthError } = require('../exceptions');
const { cookieStr, parseCookies, parseProxy, cacheDir } = require('./accessToken');

async function rotate1psidts(cookies, proxy = null) {
    const dir = cacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const psid = cookies['__Secure-1PSID'];
    if (!psid) return [null, null];

    const cachePath = path.join(dir, `.cached_1psidts_${psid}.txt`);

    if (fs.existsSync(cachePath) && Date.now() - fs.statSync(cachePath).mtimeMs <= 60000) {
        return [fs.readFileSync(cachePath, 'utf8'), null];
    }

    const res = await axios.post(Endpoint.ROTATE_COOKIES, '[000,"-0000000000000000000"]', {
        headers: { ...Headers.ROTATE_COOKIES, 'Cookie': cookieStr(cookies) },
        ...(proxy ? { proxy: parseProxy(proxy) } : {}),
        validateStatus: null,
    });

    if (res.status === 401) throw new AuthError('Unauthorized while rotating cookies.');
    if (res.status >= 400) throw new Error(`HTTP ${res.status} while rotating cookies.`);

    const newCookies = parseCookies(res.headers);
    const new1psidts = newCookies['__Secure-1PSIDTS'] || null;

    if (new1psidts) {
        fs.writeFileSync(cachePath, new1psidts, { mode: 0o600 });
        return [new1psidts, newCookies];
    }

    return [null, newCookies];
}

module.exports = { rotate1psidts };