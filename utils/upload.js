'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { Endpoint, Headers } = require('../constants');
const { parseProxy } = require('./accessToken');

function generateRandomName(ext = '.txt') {
    return `input_${Math.floor(Math.random() * 9000000) + 1000000}${ext}`;
}

function parseFileName(file) {
    if (typeof file === 'string') {
        const fp = path.resolve(file);
        if (!fs.existsSync(fp)) throw new Error(`${fp} is not a valid file.`);
        return path.basename(fp);
    }
    if (Buffer.isBuffer(file)) return generateRandomName();
    return generateRandomName();
}

async function uploadFile(file, proxy = null, filename = null) {
    let content, fname;

    if (typeof file === 'string') {
        const fp = path.resolve(file);
        if (!fs.existsSync(fp)) throw new Error(`${fp} is not a valid file.`);
        fname = filename || path.basename(fp);
        content = fs.readFileSync(fp);
    } else if (Buffer.isBuffer(file)) {
        content = file;
        fname = filename || generateRandomName();
    } else {
        throw new Error(`Unsupported file type: ${typeof file}`);
    }

    const form = new FormData();
    form.append('file', content, { filename: fname });

    const res = await axios.post(Endpoint.UPLOAD, form, {
        headers: { ...Headers.UPLOAD, ...form.getHeaders() },
        maxRedirects: 5,
        ...(proxy ? { proxy: parseProxy(proxy) } : {}),
    });

    return res.data;
}

module.exports = { uploadFile, parseFileName, generateRandomName };