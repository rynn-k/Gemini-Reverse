'use strict';

const VOLATILE_RE = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;
const VOLATILE_SET = new Set(' \t\n\r\x0b\x0c!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
const FLICKER_ESC_RE = /\\+[`*_~].*$/;

function getCleanText(s) {
    if (!s) return '';
    if (s.endsWith('\n```')) s = s.slice(0, -4);
    return s.replace(FLICKER_ESC_RE, '');
}

function getFpLen(s) {
    return s.replace(VOLATILE_RE, '').length;
}

function getDeltaByFpLen(newRaw, lastSentClean, isFinal) {
    const newC = isFinal ? newRaw : getCleanText(newRaw);
    if (newC.startsWith(lastSentClean)) return [newC.slice(lastSentClean.length), newC];

    const targetFpLen = getFpLen(lastSentClean);
    let pLow = 0;

    if (targetFpLen > 0) {
        let cur = 0, found = false;
        for (let i = 0; i < newC.length; i++) {
            if (!VOLATILE_SET.has(newC[i])) cur++;
            if (cur === targetFpLen) { pLow = i + 1; found = true; break; }
        }
        if (!found) {
            let n = 0;
            for (let i = 0; i < Math.min(lastSentClean.length, newC.length); i++) {
                if (lastSentClean[i] === newC[i]) n++; else break;
            }
            return [newC.slice(n), newC];
        }
    }

    let lastIdx = -1;
    for (let i = lastSentClean.length - 1; i >= 0; i--) {
        if (!VOLATILE_SET.has(lastSentClean[i])) { lastIdx = i; break; }
    }
    const suffix = lastSentClean.slice(lastIdx + 1);

    let i = 0, j = 0;
    while (i < suffix.length && (pLow + j) < newC.length) {
        const cs = suffix[i], cn = newC[pLow + j];
        if (cs === cn) { i++; j++; }
        else if (cn === '\\' && (pLow + j + 1) < newC.length && newC[pLow + j + 1] === cs) { j += 2; i++; }
        else if (cs === '\\' && (i + 1) < suffix.length && suffix[i + 1] === cn) { i += 2; j++; }
        else break;
    }
    return [newC.slice(pLow + j), newC];
}

function getNestedValue(data, path, defaultVal = null) {
    let cur = data;
    for (const k of path) {
        if (cur == null) return defaultVal;
        if (typeof k === 'number') {
            if (!Array.isArray(cur) || k < -cur.length || k >= cur.length) return defaultVal;
            cur = cur[k < 0 ? cur.length + k : k];
        } else {
            if (typeof cur !== 'object' || !(k in cur)) return defaultVal;
            cur = cur[k];
        }
    }
    return cur != null ? cur : defaultVal;
}

function parseResponseByFrame(content) {
    let pos = 0;
    const frames = [];
    while (pos < content.length) {
        while (pos < content.length && /\s/.test(content[pos])) pos++;
        if (pos >= content.length) break;
        const m = /^(\d+)\n/.exec(content.slice(pos));
        if (!m) break;
        const len = parseInt(m[1]);
        const start = pos + m[1].length;
        let chars = 0, units = 0, idx = start;
        while (units < len && idx < content.length) {
            const cp = content.codePointAt(idx);
            const u = cp > 0xFFFF ? 2 : 1;
            if (units + u > len) break;
            units += u; chars += cp > 0xFFFF ? 2 : 1; idx += cp > 0xFFFF ? 2 : 1;
        }
        if (units < len) break;
        const end = start + chars;
        const chunk = content.slice(start, end).trim();
        pos = end;
        if (!chunk) continue;
        try {
            const parsed = JSON.parse(chunk);
            if (Array.isArray(parsed)) frames.push(...parsed); else frames.push(parsed);
        } catch {}
    }
    return [frames, content.slice(pos)];
}

function extractJsonFromResponse(text) {
    if (typeof text !== 'string') throw new TypeError(`Expected string, got ${typeof text}`);
    let c = text.startsWith(")]}'") ? text.slice(4) : text;
    c = c.trimStart();
    const [r] = parseResponseByFrame(c);
    if (r.length) return r;
    try { const p = JSON.parse(c.trim()); return Array.isArray(p) ? p : [p]; } catch {}
    const lines = [];
    for (const line of c.trim().split('\n')) {
        try {
            const p = JSON.parse(line.trim());
            if (Array.isArray(p)) lines.push(...p); else if (p && typeof p === 'object') lines.push(p);
        } catch {}
    }
    if (lines.length) return lines;
    throw new Error('Could not find valid JSON in response.');
}

module.exports = { getCleanText, getFpLen, getDeltaByFpLen, getNestedValue, parseResponseByFrame, extractJsonFromResponse };