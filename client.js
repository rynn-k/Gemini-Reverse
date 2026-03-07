'use strict';

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { Endpoint, GRPC, Headers, Model, ErrorCode, TEMPORARY_CHAT_FLAG_INDEX } = require('./constants');
const { APIError, GeminiError, TimeoutError, UsageLimitExceeded, ModelInvalid, TemporarilyBlocked } = require('./exceptions');
const { ChatMixin } = require('./components/chatMixin');
const { GemMixin } = require('./components/gemMixin');
const { Candidate } = require('./types/candidate');
const { ModelOutput } = require('./types/modeloutput');
const { WebImage, GeneratedImage } = require('./types/image');
const { RPCData } = require('./types/grpc');
const { getAccessToken, cookieStr, parseCookies, parseProxy } = require('./utils/accessToken');
const { rotate1psidts } = require('./utils/rotate');
const { uploadFile, parseFileName } = require('./utils/upload');
const { getDeltaByFpLen, getNestedValue, parseResponseByFrame, extractJsonFromResponse } = require('./utils/parsing');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function applyMixins(Base, ...mixins) {
    for (const mixin of mixins) {
        for (const key of Object.getOwnPropertyNames(mixin.prototype)) {
            if (key === 'constructor') continue;
            Object.defineProperty(Base.prototype, key, Object.getOwnPropertyDescriptor(mixin.prototype, key));
        }
    }
}

class GeminiClient {
    constructor({ secure_1psid = null, secure_1psidts = null, proxy = null, cookies = {} } = {}) {
        this.cookies = { ...cookies };
        this.proxy = proxy;
        this._running = false;
        this.accessToken = null;
        this.buildLabel = null;
        this.sessionId = null;
        this.timeout = 300000;
        this.autoClose = false;
        this.closeDelay = 300000;
        this.closeTask = null;
        this.autoRefresh = true;
        this.refreshInterval = 540000;
        this.refreshTask = null;
        this.verbose = true;
        this.watchdogTimeout = 30000;
        this._reqid = Math.floor(Math.random() * 90000) + 10000;
        this._gems = null;

        if (secure_1psid) {
            this.cookies['__Secure-1PSID'] = secure_1psid;
            if (secure_1psidts) this.cookies['__Secure-1PSIDTS'] = secure_1psidts;
        }
    }

    async init({ timeout = 300000, autoClose = false, closeDelay = 300000, autoRefresh = true, refreshInterval = 540000, verbose = true, watchdogTimeout = 30000 } = {}) {
        if (this._running) return;
        try {
            this.verbose = verbose;
            this.watchdogTimeout = watchdogTimeout;

            const [accessToken, buildLabel, sessionId, validCookies] = await getAccessToken(this.cookies, this.proxy, this.verbose);
            this.accessToken = accessToken;
            this.buildLabel = buildLabel;
            this.sessionId = sessionId;
            this.cookies = validCookies;
            this._running = true;
            this.timeout = timeout;
            this.autoClose = autoClose;
            this.closeDelay = closeDelay;

            if (autoClose) this._resetCloseTask();
            this.autoRefresh = autoRefresh;
            this.refreshInterval = refreshInterval;
            if (this.refreshTask) { clearInterval(this.refreshTask); this.refreshTask = null; }
            if (autoRefresh) this._startAutoRefresh();
            if (this.verbose) console.log('Gemini client initialized successfully.');
        } catch (e) { await this.close(); throw e; }
    }

    async close(delay = 0) {
        if (delay) await sleep(delay);
        this._running = false;
        if (this.closeTask) { clearTimeout(this.closeTask); this.closeTask = null; }
        if (this.refreshTask) { clearInterval(this.refreshTask); this.refreshTask = null; }
    }

    _resetCloseTask() {
        if (this.closeTask) { clearTimeout(this.closeTask); this.closeTask = null; }
        this.closeTask = setTimeout(() => this.close(), this.closeDelay);
    }

    _startAutoRefresh() {
        const interval = Math.max(this.refreshInterval, 60000);
        this.refreshTask = setInterval(async () => {
            if (!this._running) return;
            try {
                const [new1psidts, rotatedCookies] = await rotate1psidts(this.cookies, this.proxy);
                if (rotatedCookies) Object.assign(this.cookies, rotatedCookies);
                if (!new1psidts) console.warn('Rotation response did not contain a new __Secure-1PSIDTS.');
            } catch (e) {
                console.warn(`Unexpected error while refreshing cookies: ${e.message}`);
            }
        }, interval);
    }

    async _batchExecute(payloads, retries = 2) {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const _reqid = this._reqid;
                this._reqid += 100000;

                const params = new URLSearchParams({
                    rpcids: payloads.map(p => p.rpcid).join(','),
                    _reqid: String(_reqid), rt: 'c', 'source-path': '/app',
                });
                if (this.buildLabel) params.set('bl', this.buildLabel);
                if (this.sessionId) params.set('f.sid', this.sessionId);

                const body = new URLSearchParams({
                    at: this.accessToken || '',
                    'f.req': JSON.stringify([payloads.map(p => p.serialize())]),
                });

                const res = await axios.post(`${Endpoint.BATCH_EXEC}?${params}`, body.toString(), {
                    headers: { ...Headers.GEMINI, 'Cookie': cookieStr(this.cookies) },
                    timeout: this.timeout,
                    ...(this.proxy ? { proxy: parseProxy(this.proxy) } : {}),
                    validateStatus: null,
                });

                Object.assign(this.cookies, parseCookies(res.headers));
                if (res.status !== 200) { await this.close(); throw new APIError(`Batch execution failed with status code ${res.status}`); }
                return res;
            } catch (e) { lastErr = e; if (attempt < retries) await sleep(1000 * (attempt + 1)); }
        }
        throw lastErr;
    }

    async generateContent({ prompt, files = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false } = {}) {
        if (this.autoClose) this._resetCloseTask();
        if (!(chat instanceof ChatSession && chat.cid))
            this._reqid = Math.floor(Math.random() * 90000) + 10000;

        let fileData = null;
        if (files && files.length) {
            await this._batchExecute([new RPCData({ rpcid: GRPC.BARD_ACTIVITY, payload: '[[["bard_activity_enabled"]]]' })]);
            const uploaded = await Promise.all(files.map(f => uploadFile(f, this.proxy)));
            fileData = uploaded.map((url, i) => [[url], parseFileName(files[i])]);
        }

        try {
            await this._batchExecute([new RPCData({ rpcid: GRPC.BARD_ACTIVITY, payload: '[[["bard_activity_enabled"]]]' })]);
            const ss = { last_texts: {}, last_thoughts: {}, last_progress_time: Date.now() };
            let output = null;
            for await (const out of this._generate({ prompt, fileData, model, gem, chat, temporary, ss })) output = out;
            if (!output) throw new GeminiError('Failed to generate contents. No output data found in response.');
            if (chat instanceof ChatSession) { output.metadata = chat.metadata; chat.lastOutput = output; }
            return output;
        } finally {}
    }

    async* generateContentStream({ prompt, files = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false } = {}) {
        if (this.autoClose) this._resetCloseTask();
        if (!(chat instanceof ChatSession && chat.cid))
            this._reqid = Math.floor(Math.random() * 90000) + 10000;

        let fileData = null;
        if (files && files.length) {
            await this._batchExecute([new RPCData({ rpcid: GRPC.BARD_ACTIVITY, payload: '[[["bard_activity_enabled"]]]' })]);
            const uploaded = await Promise.all(files.map(f => uploadFile(f, this.proxy)));
            fileData = uploaded.map((url, i) => [[url], parseFileName(files[i])]);
        }

        await this._batchExecute([new RPCData({ rpcid: GRPC.BARD_ACTIVITY, payload: '[[["bard_activity_enabled"]]]' })]);
        const ss = { last_texts: {}, last_thoughts: {}, last_progress_time: Date.now() };
        let output = null;
        for await (const out of this._generate({ prompt, fileData, model, gem, chat, temporary, ss })) {
            output = out; yield out;
        }
        if (output && chat instanceof ChatSession) { output.metadata = chat.metadata; chat.lastOutput = output; }
    }

    async* _generate({ prompt, fileData = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false, ss = null }, retries = 5) {
        if (!prompt) throw new Error('Prompt cannot be empty.');
        if (typeof model === 'string') model = Model.fromName(model);
        else if (model && typeof model === 'object' && !model.model_name) model = Model.fromDict(model);

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                for await (const out of this._stream({ prompt, fileData, model, gem, chat, temporary, ss })) yield out;
                return;
            } catch (e) {
                if (e instanceof GeminiError || e instanceof ModelInvalid || e instanceof UsageLimitExceeded || e instanceof TemporarilyBlocked) throw e;
                if (attempt >= retries) throw e;
                await sleep(1000 * (attempt + 1));
            }
        }
    }

    async* _stream({ prompt, fileData = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false, ss = null }) {
        const _reqid = this._reqid;
        this._reqid += 100000;
        const gemId = gem && typeof gem === 'object' ? gem.id : gem;

        const inner = new Array(69).fill(null);
        inner[0] = [prompt, 0, null, fileData, null, null, 0];
        inner[2] = chat ? chat.metadata : ['', '', '', null, null, null, null, null, null, ''];
        inner[7] = 1;
        if (gemId) inner[19] = gemId;
        if (temporary) inner[TEMPORARY_CHAT_FLAG_INDEX] = 1;
        inner[1] = ['en']; inner[6] = [0]; inner[10] = 1; inner[11] = 0;
        inner[17] = [[0]]; inner[18] = 0; inner[27] = 1; inner[30] = [4];
        inner[41] = [1]; inner[53] = 0; inner[61] = []; inner[68] = 1;
        const uid = uuidv4();
        inner[59] = uid;

        const params = new URLSearchParams({ _reqid: String(_reqid), rt: 'c' });
        if (this.buildLabel) params.set('bl', this.buildLabel);
        if (this.sessionId) params.set('f.sid', this.sessionId);

        const body = new URLSearchParams({ at: this.accessToken || '', 'f.req': JSON.stringify([null, JSON.stringify(inner)]) });

        if (ss) {
            if (!('original_cid' in ss)) ss.original_cid = chat ? chat.cid : null;
            if (!('original_rcid' in ss)) ss.original_rcid = chat instanceof ChatSession ? chat.rcid : null;
            if (!('had_response_data' in ss)) ss.had_response_data = false;

            if (chat && chat.cid && (!ss.original_cid || ss.had_response_data)) {
                const delays = [30000, 45000, 60000, 90000];
                let allStale = true;
                for (let i = 0; i < delays.length; i++) {
                    console.warn(`Stream failed for cid=${chat.cid}. READ_CHAT attempt ${i + 1}/${delays.length}: waiting ${delays[i] / 1000}s...`);
                    await sleep(delays[i]);
                    try {
                        const recovered = await this.fetchLatestChatResponse(chat.cid);
                        if (recovered) {
                            if (ss.original_cid && recovered.rcid && recovered.rcid === ss.original_rcid) continue;
                            if (chat instanceof ChatSession) chat.metadata = recovered.metadata;
                            yield recovered; return;
                        }
                        allStale = false;
                    } catch (e) { allStale = false; console.warn(`READ_CHAT attempt ${i + 1} failed: ${e.message}`); }
                }
                if (allStale) {
                    if (chat instanceof ChatSession) { chat.rid = ''; chat.rcid = ''; }
                    ss.had_response_data = false;
                    throw new APIError(`Stream failed for cid=${chat.cid}. All READ_CHAT stale. Retrying.`);
                }
                throw new GeminiError(`Stream failed for cid=${chat.cid}. Recovery returned no data.`);
            }
        }

        const res = await axios.post(`${Endpoint.GENERATE}?${params}`, body.toString(), {
            headers: { ...Headers.GEMINI, ...model.model_header, 'x-goog-ext-525005358-jspb': `["${uid}",1]`, 'Cookie': cookieStr(this.cookies) },
            responseType: 'stream', timeout: this.timeout, validateStatus: null,
            ...(this.proxy ? { proxy: parseProxy(this.proxy) } : {}),
        });

        if (res.status !== 200) { await this.close(); throw new APIError(`Failed to generate contents. Status: ${res.status}`); }
        Object.assign(this.cookies, parseCookies(res.headers));

        const lTxt = ss ? ss.last_texts : {}, lThought = ss ? ss.last_thoughts : {};
        let lastProg = Date.now();
        let isThinking = false, isQueueing = false, hasCandidates = false, isCompleted = false, isFinalChunk = false;
        let buf = '';

        const processParts = parts => {
            const outs = [];
            for (const part of parts) {
                const ec = getNestedValue(part, [5, 2, 0, 1, 0]);
                if (ec) {
                    switch (ec) {
                        case ErrorCode.USAGE_LIMIT_EXCEEDED: throw new UsageLimitExceeded(`Usage limit exceeded for model '${model.model_name}'.`);
                        case ErrorCode.MODEL_INCONSISTENT: throw new ModelInvalid('Model inconsistent with conversation history.');
                        case ErrorCode.MODEL_HEADER_INVALID: throw new ModelInvalid(`Model '${model.model_name}' unavailable or request structure outdated.`);
                        case ErrorCode.IP_TEMPORARILY_BLOCKED: throw new TemporarilyBlocked('IP temporarily blocked by Google.');
                        case ErrorCode.TEMPORARY_ERROR_1013: throw new APIError('Temporary error (1013). Retrying...');
                        default: throw new APIError(`Unknown API error code: ${ec}.`);
                    }
                }

                if (JSON.stringify(part).includes('data_analysis_tool')) isThinking = true;
                const status = getNestedValue(part, [5]);
                if (Array.isArray(status) && status.length) isQueueing = true;

                const innerStr = getNestedValue(part, [2]);
                if (!innerStr) continue;
                let pj; try { pj = JSON.parse(innerStr); } catch { continue; }

                const mData = getNestedValue(pj, [1]);
                if (mData && chat instanceof ChatSession) { chat.metadata = mData; if (ss) ss.had_response_data = true; }

                const ctx = getNestedValue(pj, [25]);
                if (typeof ctx === 'string') {
                    isCompleted = true; isThinking = false; isQueueing = false;
                    if (chat instanceof ChatSession) { const m = [...chat.metadata]; m[9] = ctx; chat.metadata = m; }
                }

                const clist = getNestedValue(pj, [4], []);
                if (!clist || !clist.length) continue;

                const outCands = [];
                for (let i = 0; i < clist.length; i++) {
                    const cd = clist[i];
                    const rcid = getNestedValue(cd, [0]); if (!rcid) continue;
                    if (chat instanceof ChatSession) chat.rcid = rcid;

                    let txt = getNestedValue(cd, [1, 0], '');
                    if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(txt))
                        txt = getNestedValue(cd, [22, 0]) || txt;
                    txt = txt.replace(/http:\/\/googleusercontent\.com\/\w+\/\d+\n*/g, '');

                    const thoughts = getNestedValue(cd, [37, 0, 0]) || '';
                    const webImgs = [], genImgs = [];

                    for (const wi of (getNestedValue(cd, [12, 1], []) || [])) {
                        const url = getNestedValue(wi, [0, 0, 0]);
                        if (url) webImgs.push(new WebImage({ url, title: getNestedValue(wi, [7, 0], ''), alt: getNestedValue(wi, [0, 4], ''), proxy: this.proxy }));
                    }
                    for (const gi of (getNestedValue(cd, [12, 7, 0], []) || [])) {
                        const url = getNestedValue(gi, [0, 3, 3]);
                        if (url) {
                            const imgNum = getNestedValue(gi, [3, 6]);
                            genImgs.push(new GeneratedImage({ url, title: imgNum ? `[Generated Image ${imgNum}]` : '[Generated Image]', alt: getNestedValue(gi, [3, 5, 0], ''), proxy: this.proxy, cookies: this.cookies }));
                        }
                    }

                    isFinalChunk = Array.isArray(getNestedValue(cd, [2])) || getNestedValue(cd, [8, 0], 1) === 2;

                    const [td, nft] = getDeltaByFpLen(txt, lTxt[rcid] || lTxt[`idx_${i}`] || '', isFinalChunk);
                    let thdelta = '', nfth = '';
                    if (thoughts) [thdelta, nfth] = getDeltaByFpLen(thoughts, lThought[rcid] || lThought[`idx_${i}`] || '', isFinalChunk);

                    if (td || thdelta || webImgs.length || genImgs.length) hasCandidates = true;
                    lTxt[rcid] = lTxt[`idx_${i}`] = nft;
                    lThought[rcid] = lThought[`idx_${i}`] = nfth;

                    outCands.push(new Candidate({ rcid, text: txt, text_delta: td, thoughts: thoughts || null, thoughts_delta: thdelta, web_images: webImgs, generated_images: genImgs }));
                }

                if (outCands.length) { isThinking = false; isQueueing = false; outs.push(new ModelOutput(getNestedValue(pj, [1], []), outCands)); }
            }
            return outs;
        };

        const yielded = [];
        await new Promise((resolve, reject) => {
            res.data.on('data', chunk => {
                try {
                    buf += chunk.toString('utf8');
                    if (buf.startsWith(")]}'")) buf = buf.slice(4).trimStart();
                    const [parts, rem] = parseResponseByFrame(buf);
                    buf = rem;
                    const outs = processParts(parts);
                    for (const o of outs) yielded.push(o);
                    if (outs.length || isThinking || isQueueing) { lastProg = Date.now(); if (ss) ss.last_progress_time = lastProg; }
                    else if (Date.now() - lastProg > Math.min(this.timeout, this.watchdogTimeout))
                        reject(new APIError('Response stalled (zombie stream).'));
                } catch (e) { reject(e); }
            });
            res.data.on('end', () => {
                try {
                    if (buf) { const [p] = parseResponseByFrame(buf); for (const o of processParts(p)) yielded.push(o); }
                    if (!(isCompleted || isFinalChunk) || isThinking || isQueueing) reject(new APIError('Stream interrupted or truncated.'));
                    else resolve();
                } catch (e) { reject(e); }
            });
            res.data.on('error', e => reject(new APIError(`Stream error: ${e.message}`)));
        });

        for (const o of yielded) yield o;
    }

    startChat(opts = {}) { return new ChatSession({ geminiclient: this, ...opts }); }
}

applyMixins(GeminiClient, ChatMixin, GemMixin);

class ChatSession {
    constructor({ geminiclient, metadata = null, cid = null, rid = null, rcid = null, model = null, gem = null } = {}) {
        this._metadata = ['', '', '', null, null, null, null, null, null, ''];
        this.geminiclient = geminiclient;
        this.lastOutput = null;
        this.model = ChatSession._resolveModel(model);
        this.gem = gem;
        if (metadata) this.metadata = metadata;
        if (cid) this.cid = cid;
        if (rid) this.rid = rid;
        if (rcid) this.rcid = rcid;
    }

    get metadata() { return this._metadata; }
    set metadata(v) {
        if (!Array.isArray(v)) return;
        for (let i = 0; i < v.length && i < 10; i++) if (v[i] != null) this._metadata[i] = v[i];
    }
    get cid() { return this._metadata[0]; } set cid(v) { this._metadata[0] = v; }
    get rid() { return this._metadata[1]; } set rid(v) { this._metadata[1] = v; }
    get rcid() { return this._metadata[2]; } set rcid(v) { this._metadata[2] = v; }

    async sendMessage({ prompt, files = null, temporary = false } = {}) {
        return this.geminiclient.generateContent({ prompt, files, model: this.model, gem: this.gem, chat: this, temporary });
    }

    async* sendMessageStream({ prompt, files = null, temporary = false } = {}) {
        for await (const out of this.geminiclient.generateContentStream({ prompt, files, model: this.model, gem: this.gem, chat: this, temporary })) yield out;
    }

    chooseCandidate(index) {
        if (!this.lastOutput) throw new Error('No previous output data found in this chat session.');
        if (index >= this.lastOutput.candidates.length) throw new Error(`Index ${index} exceeds number of candidates.`);
        this.lastOutput.chosen = index;
        this.rcid = this.lastOutput.rcid;
        return this.lastOutput;
    }

    static _resolveModel(model) {
        if (!model) return Model.UNSPECIFIED;
        if (typeof model === 'string') return Model.fromName(model);
        if (typeof model === 'object' && !model.model_name) return Model.fromDict(model);
        return model;
    }

    toString() { return `ChatSession(cid='${this.cid}', rid='${this.rid}', rcid='${this.rcid}')`; }
}

module.exports = { GeminiClient, ChatSession };