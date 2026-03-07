'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class Image {
    constructor({ url, title = '[Image]', alt = '', proxy = null } = {}) {
        this.url = url;
        this.title = title;
        this.alt = alt;
        this.proxy = proxy;
    }

    toString() {
        const short = this.url.length <= 20 ? this.url : this.url.slice(0, 8) + '...' + this.url.slice(-12);
        return `Image(title='${this.title}', alt='${this.alt}', url='${short}')`;
    }

    async save({ path: savePath = 'temp', filename = null, cookies = null, verbose = false, skipInvalidFilename = false } = {}) {
        let fname = filename || this.url.split('/').pop().split('?')[0];
        const match = fname.match(/^(.*\.\w+)/);
        if (match) {
            fname = match[1];
        } else {
            if (verbose) console.warn(`Invalid filename: ${fname}`);
            if (skipInvalidFilename) return null;
        }

        const proxyConfig = this.proxy ? (() => { try { const u = new URL(this.proxy); return { protocol: u.protocol.replace(':', ''), host: u.hostname, port: parseInt(u.port) }; } catch { return undefined; } })() : undefined;

        const res = await axios.get(this.url, {
            responseType: 'arraybuffer',
            headers: cookies ? { 'Cookie': Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') } : {},
            maxRedirects: 5,
            ...(proxyConfig ? { proxy: proxyConfig } : {}),
        });

        if (res.status !== 200) throw new Error(`Error downloading image: ${res.status}`);

        const contentType = res.headers['content-type'] || '';
        if (contentType && !contentType.includes('image')) {
            console.warn(`Content type of ${fname} is not image, but ${contentType}.`);
        }

        fs.mkdirSync(savePath, { recursive: true });
        const dest = path.join(savePath, fname);
        fs.writeFileSync(dest, Buffer.from(res.data));
        if (verbose) console.log(`Image saved as ${path.resolve(dest)}`);
        return path.resolve(dest);
    }
}

class WebImage extends Image {
    constructor(opts) { super(opts); }
}

class GeneratedImage extends Image {
    constructor({ cookies, ...opts } = {}) {
        super(opts);
        if (!cookies || Object.keys(cookies).length === 0)
            throw new Error('GeneratedImage requires cookies from GeminiClient.');
        this.cookies = cookies;
    }

    async save({ path: savePath = 'temp', filename = null, cookies = null, verbose = false, skipInvalidFilename = false, fullSize = true } = {}) {
        if (fullSize) this.url += '=s2048';
        const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const fname = filename || `${ts}_${this.url.slice(-10)}.png`;
        return super.save({ path: savePath, filename: fname, cookies: cookies || this.cookies, verbose, skipInvalidFilename });
    }
}

module.exports = { Image, WebImage, GeneratedImage };