'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');


const {
    Endpoint, GRPC, Headers, Model, ErrorCode,
    TEMPORARY_CHAT_FLAG_INDEX, STREAMING_FLAG_INDEX, GEM_FLAG_INDEX,
    CARD_CONTENT_RE, ARTIFACTS_RE, DEFAULT_METADATA, MODEL_HEADER_KEY,
} = require('./constants');
const { APIError, GeminiError, UsageLimitExceeded, ModelInvalid, TemporarilyBlocked } = require('./errors');
const { AvailableModel, RPCData } = require('./types/model');
const { Candidate, ModelOutput } = require('./types/output');
const { WebImage, GeneratedImage, GeneratedVideo, GeneratedMedia } = require('./types/media');
const { DeepResearchPlan, DeepResearchStatus, DeepResearchResult } = require('./types/research');
const { getAccessToken, cookieStr, parseCookies, parseProxy } = require('./utils/auth');
const { uploadFile, parseFileName } = require('./utils/upload');
const { getDeltaByFpLen, getNestedValue, extractJsonFromResponse, StreamingFrameParser } = require('./utils/parser');
const { extractDeepResearchPlan, extractDeepResearchStatusPayload } = require('./utils/research');
const { ChatSession } = require('./chat');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Gemini {
    constructor({
        secure_1psid = null,
        proxy = null,
        timeout = 300000,
        autoClose = false,
        closeDelay = 300000,
        verbose = false,
        watchdogTimeout = 30000,
    } = {}) {
        this.cookies = secure_1psid ? { '__Secure-1PSID': secure_1psid } : {};
        this.proxy = proxy;
        this.verbose = verbose;
        this.timeout = timeout;
        this.autoClose = autoClose;
        this.closeDelay = closeDelay;
        this.watchdogTimeout = watchdogTimeout;

        this._ready = false;
        this._guest = !secure_1psid;
        this.accessToken = null;
        this.buildLabel = null;
        this.sessionId = null;
        this.language = 'en';
        this.pushId = 'feeds/mcudyrk2a4khkz';
        this.closeTask = null;
        this._reqid = Math.floor(Math.random() * 90000) + 10000;
        this._initPromise = null;
    }

    async _ensure() {
        if (this._ready) return;
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            this._ready = true;
            try {
                if (this._guest) {
                    await this._getGuestCookie();
                } else {
                    const [accessToken, buildLabel, sessionId, language, pushId, validCookies] = await getAccessToken(
                        this.cookies, this.proxy, this.verbose,
                    );
                    this.accessToken = accessToken;
                    this.buildLabel = buildLabel;
                    this.sessionId = sessionId;
                    this.language = language || 'en';
                    this.pushId = pushId || 'feeds/mcudyrk2a4khkz';
                    this.cookies = validCookies;
                    this._reqid = Math.floor(Math.random() * 90000) + 10000;

                    if (this.autoClose) this._resetCloseTask();
                }
            } catch (e) {
                this._ready = false;
                this._initPromise = null;
                await this.close();
                throw e;
            }
        })();
        return this._initPromise;
    }

    async init() { return this._ensure(); }

    _resolveModel(model) {
        if (!model || model === Model.UNSPECIFIED) return Model.UNSPECIFIED;
        if (model instanceof AvailableModel) return model;
        if (typeof model === 'string') return Model.fromName(model);
        if (typeof model === 'object' && model.model_name && model.model_header) {
            return Model.fromDict({ model_name: model.model_name, model_header: model.model_header });
        }
        return Model.UNSPECIFIED;
    }

    newChat({ model = Model.UNSPECIFIED, temporary = false, gem = null } = {}) {
        return new ChatSession(this, { model, temporary, gem });
    }

    async chats() {
        if (this._guest) return [];
        await this._ensure();
        return await this._fetchRecentChats();
    }

    async readChat(cid, limit = 10) {
        if (this._guest) throw new APIError('Chat history not available in guest mode.');
        await this._ensure();
        const response = await this._batchExecute([
            new RPCData({ rpcid: GRPC.READ_CHAT, payload: JSON.stringify([cid, limit, null, 1, [1], [4], null, 1]) }),
        ]);
        const responseJson = extractJsonFromResponse(response.data);
        for (const part of responseJson) {
            const bodyStr = getNestedValue(part, [2]);
            if (!bodyStr) continue;
            let body; try { body = JSON.parse(bodyStr); } catch { continue; }
            const turnsData = getNestedValue(body, [0]);
            if (!turnsData) continue;
            const turns = [];
            for (const convTurn of turnsData) {
                const rid = getNestedValue(convTurn, [0, 1], '');
                const candidatesList = getNestedValue(convTurn, [3, 0]);
                if (candidatesList) {
                    for (const cd of candidatesList) {
                        const rcid = getNestedValue(cd, [0]);
                        if (!rcid) continue;
                        const [text, thoughts, webImgs, genImgs, genVids, genMedia] = this._parseCandidate(cd, cid, rid, rcid);
                        turns.push({ role: 'model', text, thoughts, images: [...webImgs, ...genImgs], videos: genVids, media: genMedia });
                    }
                }
                const userText = getNestedValue(convTurn, [2, 0, 0], '');
                if (userText) turns.push({ role: 'user', text: userText });
            }
            return turns;
        }
        return [];
    }

    async deleteChat(cid) {
        if (this._guest) throw new APIError('Chat management not available in guest mode.');
        await this._ensure();
        await this._batchExecute([new RPCData({ rpcid: GRPC.DELETE_CHAT_1, payload: JSON.stringify([cid]) })]);
        await this._batchExecute([new RPCData({ rpcid: GRPC.DELETE_CHAT_2, payload: JSON.stringify([cid, [1, null, 0, 1]]) })]);
    }

    async gems() {
        if (this._guest) throw new APIError('Gems not available in guest mode.');
        await this._ensure();
        const language = this.language || 'en';
        const response = await this._batchExecute([
            new RPCData({ rpcid: GRPC.LIST_GEMS, payload: `[3,['${language}'],0]`, identifier: 'system' }),
            new RPCData({ rpcid: GRPC.LIST_GEMS, payload: `[2,['${language}'],0]`, identifier: 'custom' }),
        ]);
        const responseJson = extractJsonFromResponse(response.data);
        let predefined = [], custom = [];
        for (const part of responseJson) {
            const id = getNestedValue(part, [-1]);
            const bodyStr = getNestedValue(part, [2]);
            if (!bodyStr) continue;
            const body = JSON.parse(bodyStr);
            if (id === 'system') predefined = getNestedValue(body, [2], []);
            else if (id === 'custom') custom = getNestedValue(body, [2], []);
        }
        const out = [];
        const push = (arr, predef) => {
            for (const g of arr) {
                if (g && g[0]) out.push({ id: g[0], name: g[1]?.[0] || '', description: g[1]?.[1] || '', prompt: g[2]?.[0] || null, predefined: predef });
            }
        };
        push(predefined, true);
        push(custom, false);
        return out;
    }

    async addGem({ name, prompt, description = '' } = {}) {
        if (this._guest) throw new APIError('Gems not available in guest mode.');
        await this._ensure();
        if (!name || !prompt) throw new Error('Name and prompt required.');
        const response = await this._batchExecute([
            new RPCData({ rpcid: GRPC.CREATE_GEM, payload: JSON.stringify([[name, description, prompt, null, null, null, null, null, 0, null, 1, null, null, null, []]]) }),
        ]);
        const responseJson = extractJsonFromResponse(response.data);
        const bodyStr = getNestedValue(responseJson, [0, 2]);
        if (!bodyStr) throw new APIError('Failed to create gem.');
        const id = getNestedValue(JSON.parse(bodyStr), [0]);
        if (!id) throw new APIError('Failed to create gem.');
        return { id, name, description, prompt, predefined: false };
    }

    async setGem({ gem, name, prompt, description = '' } = {}) {
        if (this._guest) throw new APIError('Gems not available in guest mode.');
        await this._ensure();
        const id = typeof gem === 'object' ? gem.id : gem;
        if (!id) throw new Error('Gem ID required.');
        await this._batchExecute([
            new RPCData({ rpcid: GRPC.UPDATE_GEM, payload: JSON.stringify([id, [name, description, prompt, null, null, null, null, null, 0, null, 1, null, null, null, [], 0]]) }),
        ]);
        return { id, name, description, prompt, predefined: false };
    }

    async delGem(gem) {
        if (this._guest) throw new APIError('Gems not available in guest mode.');
        await this._ensure();
        const id = typeof gem === 'object' ? gem.id : gem;
        if (!id) throw new Error('Gem ID required.');
        await this._batchExecute([new RPCData({ rpcid: GRPC.DELETE_GEM, payload: JSON.stringify([id]) })]);
    }

    async models() {
        await this._ensure();
        const seen = new Set();
        const result = [];
        const keys = [
            'BASIC_PRO', 'BASIC_FLASH', 'BASIC_LITE', 'BASIC_THINKING',
            'PLUS_PRO', 'PLUS_FLASH', 'PLUS_LITE',
            'ADVANCED_PRO', 'ADVANCED_FLASH', 'ADVANCED_LITE',
        ];
        for (const key of keys) {
            const m = Model[key];
            const modelId = Model.modelId(m);
            if (!modelId || seen.has(modelId)) continue;
            seen.add(modelId);
            result.push(new AvailableModel({
                model_id: modelId, model_name: m.model_name,
                display_name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                description: m.advanced_only ? `${key.split('_')[0]} tier` : 'Free tier',
                capacity: m.advanced_only ? 2 : 1, capacity_field: 12,
                model_number: 1, is_available: true,
            }));
        }
        return result;
    }

    async research(prompt, { wait = true, pollInterval = 10000, timeout = 600000, onStatus = null } = {}) {
        if (this._guest) throw new APIError('Deep research not available in guest mode.');
        const chat = this.newChat({ model: Model.UNSPECIFIED });
        const plan = await this._createDeepResearchPlan(prompt, chat);
        if (!plan) throw new GeminiError('Failed to create deep research plan.');
        await this._startDeepResearch(plan, chat);
        if (!wait) return { plan };
        const result = await this._waitDeepResearch(plan, pollInterval, timeout, onStatus);
        result.plan = plan;
        return result;
    }

    async ask(prompt, { model, gem, temporary, files, extended_thinking } = {}) {
        const chat = this.newChat({ model, gem, temporary });
        return chat.generateContent({ prompt, files, extended_thinking });
    }

    async close(delay = 0) {
        if (delay) await sleep(delay);
        this._ready = false;
        if (this.closeTask) { clearTimeout(this.closeTask); this.closeTask = null; }
    }

    async _generateContent({ prompt, files = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false, deep_research = false, extended_thinking = false }) {
        await this._ensure();
        if (this._guest && files) throw new APIError('File upload not available in guest mode.');
        if (this._guest && deep_research) throw new APIError('Deep research not available in guest mode.');
        let fileData = null;
        if (files && files.length) {
            const uploaded = await Promise.all(files.map(f => uploadFile(f, this.proxy, this.pushId, this.cookies)));
            fileData = uploaded.map((url, i) => [[url], parseFileName(files[i])]);
        }
        const ss = { last_texts: {}, last_thoughts: {} };
        let output = null;
        for await (const out of this._generate({ prompt, fileData, model, gem, chat, temporary, ss, deep_research, extended_thinking })) output = out;
        if (!output) throw new GeminiError('Failed to generate contents.');
        if (chat) { output.metadata = chat.metadata; chat.lastOutput = output; }
        return output;
    }

    async *_generateContentStream({ prompt, files = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false, deep_research = false, extended_thinking = false }) {
        await this._ensure();
        if (this._guest && files) throw new APIError('File upload not available in guest mode.');
        if (this._guest && deep_research) throw new APIError('Deep research not available in guest mode.');
        let fileData = null;
        if (files && files.length) {
            const uploaded = await Promise.all(files.map(f => uploadFile(f, this.proxy, this.pushId, this.cookies)));
            fileData = uploaded.map((url, i) => [[url], parseFileName(files[i])]);
        }
        const ss = { last_texts: {}, last_thoughts: {} };
        let output = null;
        for await (const out of this._generate({ prompt, fileData, model, gem, chat, temporary, ss, deep_research, extended_thinking })) {
            output = out;
            yield out;
        }
        if (output && chat) { output.metadata = chat.metadata; chat.lastOutput = output; }
    }

    async *_generate({ prompt, fileData = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false, ss = null, deep_research = false, extended_thinking = false }, retries = 5) {
        if (!prompt) throw new Error('Prompt cannot be empty.');
        if (this._guest) {
            for await (const out of this._streamGuest({ prompt, chat, ss })) yield out;
            return;
        }
        model = this._resolveModel(model);
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                for await (const out of this._stream({ prompt, fileData, model, gem, chat, temporary, ss, deep_research, extended_thinking })) yield out;
                return;
            } catch (e) {
                if (e instanceof GeminiError || e instanceof ModelInvalid || e instanceof UsageLimitExceeded || e instanceof TemporarilyBlocked) throw e;
                if (attempt >= retries) throw e;
                await sleep(1000 * (attempt + 1));
            }
        }
    }

    async *_stream({ prompt, fileData = null, model = Model.UNSPECIFIED, gem = null, chat = null, temporary = false, ss = null, deep_research = false, extended_thinking = false }) {
        const _reqid = this._reqid;
        this._reqid += 100000;
        const gemId = gem?.id || gem;
        const chatBackup = chat ? { metadata: [...chat.metadata], cid: chat.cid, rid: chat.rid, rcid: chat.rcid } : null;

        const inner = new Array(81).fill(null);
        inner[0] = [prompt, 0, null, fileData, null, null, 0];
        inner[1] = [this.language || 'en'];
        inner[2] = chat ? chat.metadata : [...DEFAULT_METADATA];
        if (deep_research) {
            inner[3] = '!' + crypto.randomBytes(1950).toString('base64url');
            inner[4] = crypto.randomUUID().replace(/-/g, '');
        }
        inner[6] = [1];
        inner[STREAMING_FLAG_INDEX] = 1;
        inner[10] = 1;
        inner[11] = 0;
        inner[17] = [[0]];
        inner[18] = 0;
        if (gemId) inner[GEM_FLAG_INDEX] = gemId;
        inner[27] = 1;
        inner[30] = [4];
        inner[41] = [1];
        if (temporary) inner[TEMPORARY_CHAT_FLAG_INDEX] = 1;
        if (deep_research) inner[49] = 1;
        inner[53] = 0;
        if (deep_research) { inner[54] = [[[[[1]]]]]; inner[55] = [[1]]; }
        inner[61] = [];
        inner[68] = 1;
        inner[80] = extended_thinking ? 2 : 1;

        const uid = uuidv4().toUpperCase();
        inner[59] = uid;

        const modelHeaders = { ...model.model_header };
        if (MODEL_HEADER_KEY in modelHeaders) {
            try {
                const parsed = JSON.parse(modelHeaders[MODEL_HEADER_KEY]);
                const modelNumber = typeof parsed[parsed.length - 1] === 'number' ? parsed[parsed.length - 1] : null;
                if (typeof modelNumber === 'number') inner[79] = modelNumber;
                parsed.push(extended_thinking ? 2 : 1);
                parsed.push(this.sessionId || null);
                modelHeaders[MODEL_HEADER_KEY] = JSON.stringify(parsed);
            } catch {}
        }

        const params = new URLSearchParams({ hl: this.language || 'en', _reqid: String(_reqid), rt: 'c' });
        if (this.buildLabel) params.set('bl', this.buildLabel);
        if (this.sessionId) params.set('f.sid', this.sessionId);

        const body = new URLSearchParams({ at: this.accessToken || '', 'f.req': JSON.stringify([null, JSON.stringify(inner)]) });

        let hasGeneratedText = false;
        const sleepTime = 10000;

        const res = await axios.post(`${Endpoint.GENERATE}?${params}`, body.toString(), {
            headers: {
                ...Headers.GEMINI, ...modelHeaders,
                'x-goog-ext-525005358-jspb': `["${uid}",1]`,
                ...Headers.SAME_DOMAIN, 'Cookie': cookieStr(this.cookies),
            },
            responseType: 'stream',
            timeout: this.timeout,
            validateStatus: null,
            ...(this.proxy ? { proxy: parseProxy(this.proxy) } : {}),
        });

        if (res.status !== 200) { await this.close(); throw new APIError(`Generate failed. Status: ${res.status}`); }
        Object.assign(this.cookies, parseCookies(res.headers));

        const lTxt = ss ? ss.last_texts : {};
        const lThought = ss ? ss.last_thoughts : {};
        let lastProg = Date.now();
        let isThinking = false, isQueueing = false, hasCandidates = false;
        let isCompleted = false, isFinalChunk = false;
        let cid = chat ? chat.cid : '';
        let rid = chat ? chat.rid : '';
        let videoChipUUID = null;
        const frameParser = new StreamingFrameParser();

        const processParts = (parts) => {
            const outs = [];
            for (const part of parts) {
                const ec = getNestedValue(part, [5, 2, 0, 1, 0]);
                if (ec) {
                    switch (ec) {
                        case ErrorCode.USAGE_LIMIT_EXCEEDED: throw new UsageLimitExceeded(`Usage limit exceeded.`);
                        case ErrorCode.MODEL_INCONSISTENT: throw new ModelInvalid('Model inconsistent with conversation history.');
                        case ErrorCode.MODEL_HEADER_INVALID: throw new ModelInvalid(`Model unavailable or request structure outdated.`);
                        case ErrorCode.IP_TEMPORARILY_BLOCKED: throw new TemporarilyBlocked('IP temporarily blocked by Google.');
                        case ErrorCode.TEMPORARY_ERROR_1013: throw new APIError('Temporary error (1013).');
                        case ErrorCode.FEATURE_NOT_AVAILABLE: throw new UsageLimitExceeded('This feature (e.g. video/media generation) is not available for your account plan.');
                        default: throw new APIError(`Unknown API error: ${ec}`);
                    }
                }

                if (JSON.stringify(part).includes('data_analysis_tool')) { isThinking = true; isQueueing = false; }
                const status = getNestedValue(part, [5]);
                if (Array.isArray(status) && status.length && !isThinking) isQueueing = true;

                const innerStr = getNestedValue(part, [2]);
                if (!innerStr) continue;
                let pj; try { pj = JSON.parse(innerStr); } catch { continue; }

                const mData = getNestedValue(pj, [1]);
                if (mData) {
                    const newCid = getNestedValue(mData, [0]);
                    const newRid = getNestedValue(mData, [1]);
                    if (newCid) cid = newCid;
                    if (newRid) rid = newRid;
                    if (chat) chat.metadata = mData;
                }

                const ctx = getNestedValue(pj, [25]);
                if (typeof ctx === 'string') {
                    isFinalChunk = true; isThinking = false; isQueueing = false;
                    if (chat) { const m = [...chat.metadata]; m[9] = ctx; chat.metadata = m; }
                }

                const clist = getNestedValue(pj, [4], []);
                if (!clist || !clist.length) continue;

                const outCands = [];
                for (let i = 0; i < clist.length; i++) {
                    const cd = clist[i];
                    const rcid = getNestedValue(cd, [0]);
                    if (!rcid) continue;
                    if (chat) chat.rcid = rcid;

                    const [text, thoughts, webImgs, genImgs, genVideos, genMedia] = this._parseCandidate(cd, cid, rid, rcid);

                    if (!videoChipUUID) {
                        const entry65 = getNestedValue(cd, [12, 0, '65']);
                        if (Array.isArray(entry65) && entry65.length >= 2) videoChipUUID = entry65[1];
                    }

                    let drPlan = null;
                    if (deep_research) {
                        const planData = extractDeepResearchPlan(cd, text);
                        if (planData) drPlan = new DeepResearchPlan({ ...planData, cid: chat ? chat.cid : null });
                    }

                    const indicator = getNestedValue(cd, [8, 0]);
                    isCompleted = indicator === 2;

                    const lastSentText = lTxt[rcid] || lTxt[`idx_${i}`] || '';
                    const [td, nft] = getDeltaByFpLen(text, lastSentText, isCompleted || indicator == null);
                    let thdelta = '', nfth = '';
                    if (thoughts) {
                        const lastSentThought = lThought[rcid] || lThought[`idx_${i}`] || '';
                        [thdelta, nfth] = getDeltaByFpLen(thoughts, lastSentThought, isCompleted || indicator == null);
                    }

                    if (td || thdelta || webImgs.length || genImgs.length || genVideos.length || genMedia.length || drPlan) hasCandidates = true;

                    lTxt[rcid] = lTxt[`idx_${i}`] = nft;
                    lThought[rcid] = lThought[`idx_${i}`] = nfth;

                    outCands.push(new Candidate({
                        rcid, index: i, text, text_delta: td, thoughts: thoughts || null, thoughts_delta: thdelta,
                        web_images: webImgs, generated_images: genImgs, generated_videos: genVideos,
                        generated_media: genMedia, deep_research_plan: drPlan, done: isCompleted,
                    }));
                }

                if (outCands.length) { isThinking = false; isQueueing = false; outs.push(new ModelOutput(getNestedValue(pj, [1], []), outCands, { model: model?.model_name || '', gem: gemId || null })); }
            }
            return outs;
        };

        const yielded = [];
        let streamError = null;

        const watchdog = setInterval(() => {
            if (!isThinking && !isQueueing && (Date.now() - lastProg) > Math.min(this.timeout, this.watchdogTimeout)) {
                streamError = new APIError('Response stalled (zombie stream).');
                res.data.destroy(streamError);
            }
        }, 1000);

        try {
            for await (const chunk of res.data) {
                const parts = frameParser.feed(chunk.toString('utf8'));
                const outs = processParts(parts);
                if (outs.length || isThinking || isQueueing) lastProg = Date.now();
                for (const o of outs) {
                    yielded.push(o);
                    hasGeneratedText = true;
                    yield o;
                }
            }

            const remaining = frameParser.flush();
            const finalOuts = processParts(remaining);
            for (const o of finalOuts) {
                yielded.push(o);
                hasGeneratedText = true;
                yield o;
            }
        } catch (e) {
            streamError = e;
        } finally {
            clearInterval(watchdog);
        }

        if (streamError) throw streamError;

        const hasMediaOrVideo = yielded.some(o => o.videos?.length > 0 || o.media?.length > 0);
        if (!isCompleted && !isFinalChunk && !hasMediaOrVideo) {
            throw new APIError('Stream interrupted or truncated.');
        }

        if ((!isCompleted || isThinking || isQueueing) && cid && isFinalChunk) {
            const pollStart = Date.now();
            while (true) {
                if ((Date.now() - pollStart) > this.timeout) {
                    await this.close();
                    throw hasGeneratedText ? new GeminiError('Connection lost. Recovery timed out.') : new APIError('Polling timed out.');
                }
                const recovered = await this._readChatInternal(cid);
                if (recovered?.turns?.length > 0 && recovered.turns[0].role === 'model') {
                    const recoveredOut = recovered.turns[0].model_output;
                    if (recoveredOut?.candidates && (recoveredOut.text || recoveredOut.thoughts || recoveredOut.images?.length || recoveredOut.videos?.length || recoveredOut.media?.length)) {
                        const recRcid = recoveredOut.rcid;
                        const prevRcid = chatBackup ? chatBackup.rcid : '';
                        if (recRcid !== prevRcid) {
                            if (chat) { recoveredOut.metadata = chat.metadata; chat.rcid = recRcid; }
                            yield recoveredOut;
                            return;
                        }
                    }
                }
                await sleep(sleepTime);
            }
        }

        if (videoChipUUID && !yielded.some(o => o.videos?.length) && cid) {
            const pollStart = Date.now();
            while ((Date.now() - pollStart) < this.timeout) {
                const recovered = await this._readChatInternal(cid);
                const recoveredOut = recovered?.turns?.find(t => t.role === 'model')?.model_output;
                if (recoveredOut?.videos?.length > 0) {
                    if (chat) { recoveredOut.metadata = chat.metadata; chat.rcid = recoveredOut.rcid; }
                    yield recoveredOut;
                    return;
                }
                await sleep(sleepTime);
            }
        }
    }

    async _getGuestCookie() {
        const res = await axios.post(Endpoint.BATCH_EXEC + '?rpcids=maGuAc&source-path=%2F&hl=en-US&_reqid=1&rt=c',
            'f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&',
            { headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' } }
        );
        const cookies = parseCookies(res.headers);
        if (cookies['__Secure-1PSID']) this.cookies['__Secure-1PSID'] = cookies['__Secure-1PSID'];
        Object.assign(this.cookies, cookies);
        this.accessToken = '';
        this.buildLabel = 'boq_assistant-bard-web-server_20260618.10_p0';
        this.sessionId = '6921068608429233100';
        this.language = 'en-US';
        this._reqid = Math.floor(Math.random() * 90000) + 10000;
    }

    async *_streamGuest({ prompt, chat = null, ss = null }) {
        const _reqid = this._reqid;
        this._reqid += 100000;

        const chatMeta = chat ? [...chat.metadata] : ['', '', '', null, null, null, null, null, null, ''];
        const inner = [
            [prompt, 0, null, null, null, null, 0], [this.language || 'en-US'],
            chatMeta, null, null, null, [1], 1, null, null, 1, 0, null, null, null, null, null, [[0]], 1,
            null, null, null, null, null,
            ['', '', '', null, null, null, null, null, 0, null, 1, null, null, null, []],
            null, null, 1, null, null, null, null, null, null, null,
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
            1, null, null, null, null, [1],
        ];

        const uid = uuidv4().toUpperCase();
        const params = new URLSearchParams({ hl: this.language || 'en-US', _reqid: String(_reqid), rt: 'c' });
        if (this.buildLabel) params.set('bl', this.buildLabel);
        if (this.sessionId) params.set('f.sid', this.sessionId);
        const body = new URLSearchParams({ 'f.req': JSON.stringify([null, JSON.stringify(inner)]) });

        const res = await axios.post(`${Endpoint.GENERATE}?${params}`, body.toString(), {
            headers: {
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'x-goog-ext-525001261-jspb': '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,6],null,null,1,null,null,1]',
                'x-goog-ext-525005358-jspb': `["${uid}",1]`,
                'x-goog-ext-73010989-jspb': '[0]',
                'x-goog-ext-73010990-jspb': '[0,0,0]',
                'x-same-domain': '1',
                'origin': 'https://gemini.google.com',
                'referer': 'https://gemini.google.com/',
                'cookie': cookieStr(this.cookies),
            },
            timeout: this.timeout,
            validateStatus: null,
        });

        if (res.status !== 200) throw new APIError(`Generate failed. Status: ${res.status}`);
        Object.assign(this.cookies, parseCookies(res.headers));

        const lTxt = ss ? ss.last_texts : {};
        const raw = typeof res.data === 'string' ? res.data : res.data.toString();
        const frameParser = new StreamingFrameParser();
        const parts = frameParser.feed(raw);
        parts.push(...frameParser.flush());

        let isCompleted = false;
        let cid = chat ? chat.cid : '';
        let rid = chat ? chat.rid : '';

        for (const part of parts) {
            const ec = getNestedValue(part, [5, 2, 0, 1, 0]);
            if (ec) {
                if (ec === ErrorCode.USAGE_LIMIT_EXCEEDED) throw new UsageLimitExceeded('Usage limit exceeded.');
                if (ec === ErrorCode.IP_TEMPORARILY_BLOCKED) throw new TemporarilyBlocked('IP temporarily blocked.');
                if (ec === 1096 || ec === 1097) throw new APIError('Session continuation not available in guest mode. Use authenticated mode for multi-turn chat.');
                throw new APIError(`Guest API error code: ${ec}.`);
            }

            const innerStr = getNestedValue(part, [2]);
            if (!innerStr) continue;
            let pj; try { pj = JSON.parse(innerStr); } catch { continue; }

            const mData = getNestedValue(pj, [1]);
            if (mData) {
                if (mData[0]) cid = mData[0];
                if (mData[1]) rid = mData[1];
                if (chat) chat.metadata = mData;
            }

            const ctx = getNestedValue(pj, [25]);
            if (typeof ctx === 'string' && chat) {
                const m = [...chat.metadata];
                m[9] = ctx;
                chat.metadata = m;
            }

            const clist = getNestedValue(pj, [4], []);
            if (!clist || !clist.length) continue;

            for (let i = 0; i < clist.length; i++) {
                const cd = clist[i];
                const rcid = getNestedValue(cd, [0]);
                if (!rcid) continue;
                if (chat) chat.rcid = rcid;

                const text = getNestedValue(cd, [1, 0], '');
                const indicator = getNestedValue(cd, [8, 0]);
                isCompleted = indicator === 2;

                const lastSentText = lTxt[rcid] || lTxt[`idx_${i}`] || '';
                const [td, nft] = getDeltaByFpLen(text, lastSentText, isCompleted || indicator == null);
                lTxt[rcid] = lTxt[`idx_${i}`] = nft;

                const cand = new Candidate({ rcid, index: i, text, text_delta: td, done: isCompleted });
                yield new ModelOutput(getNestedValue(pj, [1], []), [cand], { model: 'gemini-3-flash' });
            }
        }
    }

    async _getFullSizeImage(cid, rid, rcid, imageId) {
        try {
            const payload = [[[null, null, null, [null, null, null, null, null, '']], [imageId, 0], null, [19, ''], null, null, null, null, null, ''], [rid, rcid, cid, null, ''], 1, 0, 1];
            const response = await this._batchExecute([new RPCData({ rpcid: GRPC.GET_FULL_SIZE_IMAGE, payload: JSON.stringify(payload) })]);
            const responseData = extractJsonFromResponse(response.data);
            const bodyStr = getNestedValue(responseData, [0, 2], '[]');
            return getNestedValue(JSON.parse(bodyStr), [0]);
        } catch { return null; }
    }

    _parseCandidate(candidateData, cid, rid, rcid) {
        let text = getNestedValue(candidateData, [1, 0], '');
        if (CARD_CONTENT_RE.test(text)) text = getNestedValue(candidateData, [22, 0]) || text;
        ARTIFACTS_RE.lastIndex = 0;
        text = text.replace(ARTIFACTS_RE, '');
        const thoughts = getNestedValue(candidateData, [37, 0, 0]) || '';

        const webImages = [];
        for (const [imgIdx, wi] of (getNestedValue(candidateData, [12, 1], []) || []).entries()) {
            const url = getNestedValue(wi, [0, 0, 0]);
            if (url) webImages.push(new WebImage({ url, title: `[Image ${imgIdx + 1}]`, alt: getNestedValue(wi, [0, 4], ''), proxy: this.proxy, client_ref: this }));
        }

        const generatedImages = [];
        const genImgSources = [
            ...(getNestedValue(candidateData, [12, 7, 0], []) || []),
            ...(getNestedValue(candidateData, [12, 0, '8', 0], []) || []),
        ];
        for (const [imgIdx, gi] of genImgSources.entries()) {
            const url = getNestedValue(gi, [0, 3, 3]);
            if (url) {
                let imageId = getNestedValue(gi, [1, 0]);
                if (!imageId) imageId = `http://googleusercontent.com/image_generation_content/${imgIdx}`;
                generatedImages.push(new GeneratedImage({ url, title: `[Generated Image ${imgIdx}]`, alt: getNestedValue(gi, [0, 3, 2], ''), proxy: this.proxy, client_ref: this, cid, rid, rcid, image_id: imageId }));
            }
        }

        const generatedVideos = [];
        for (const vItem of (getNestedValue(candidateData, [12, 0, '60', 0, 0, 0]) || [])) {
            const urls = getNestedValue(vItem, [7], []);
            if (Array.isArray(urls) && urls.length >= 2)
                generatedVideos.push(new GeneratedVideo({ url: urls[1], thumbnail: urls[0], cid, rid, rcid, client_ref: this, proxy: this.proxy }));
        }

        const generatedMedia = [];
        const mediaData = getNestedValue(candidateData, [12, 86], []);
        if (mediaData) {
            let mp3Url = '', mp3Thumb = '';
            const mp3List = getNestedValue(mediaData, [0, 1, 7], []);
            if (Array.isArray(mp3List) && mp3List.length >= 2) { mp3Thumb = mp3List[0]; mp3Url = mp3List[1]; }
            let mp4Url = '', mp4Thumb = '';
            const mp4List = getNestedValue(mediaData, [1, 1, 7], []);
            if (Array.isArray(mp4List) && mp4List.length >= 2) { mp4Thumb = mp4List[0]; mp4Url = mp4List[1]; }
            if (mp3Url || mp4Url) {
                generatedMedia.push(new GeneratedMedia({ url: mp4Url, thumbnail: mp4Thumb, mp3_url: mp3Url, mp3_thumbnail: mp3Thumb, cid, rid, rcid, client_ref: this, proxy: this.proxy }));
            }
        }

        return [text, thoughts, webImages, generatedImages, generatedVideos, generatedMedia];
    }

    async _createDeepResearchPlan(prompt, chat) {
        const output = await this._collectResearchOutput(chat, prompt);
        const plan = output.deep_research_plan;
        if (!plan) throw new GeminiError(`Gemini did not return a deep research plan. Preview: ${(output.text || '').slice(0, 1200)}`);
        plan.metadata = [...chat.metadata];
        plan.cid = chat.cid || plan.cid;
        if (!plan.confirm_prompt) plan.confirm_prompt = 'Start research';
        if (!plan.response_text) plan.response_text = output.text;
        return plan;
    }

    async _startDeepResearch(plan, chat) {
        const prompt = plan.confirm_prompt || 'Start research';
        const output = await this._collectResearchOutput(chat, prompt);
        return output;
    }

    async _collectResearchOutput(chat, prompt) {
        let recoverableError = null;
        try {
            const output = await this._generateContent({ prompt, chat, deep_research: true });
            if (output.deep_research_plan || (output.text || '').trim()) {
                chat.lastOutput = output;
                return output;
            }
        } catch (e) {
            if (e instanceof UsageLimitExceeded || e instanceof ModelInvalid || e instanceof TemporarilyBlocked) throw e;
            if (e instanceof GeminiError || e instanceof APIError) recoverableError = e;
            else throw e;
        }
        if (chat.cid) {
            const fallback = await this._readChatInternal(chat.cid);
            if (fallback) { chat.lastOutput = fallback; return fallback; }
        }
        if (recoverableError) throw recoverableError;
        throw new GeminiError(`Gemini returned no usable output for deep research.`);
    }

    async _readChatInternal(cid) {
        try {
            const response = await this._batchExecute([
                new RPCData({ rpcid: GRPC.READ_CHAT, payload: JSON.stringify([cid, 5, null, 1, [1], [4], null, 1]) }),
            ]);
            const responseJson = extractJsonFromResponse(response.data);
            for (const part of responseJson) {
                const bodyStr = getNestedValue(part, [2]);
                if (!bodyStr) continue;
                let body; try { body = JSON.parse(bodyStr); } catch { continue; }
                const turnsData = getNestedValue(body, [0]);
                if (!turnsData) continue;
                const turns = [];
                for (const convTurn of turnsData) {
                    const candidatesList = getNestedValue(convTurn, [3, 0]);
                    if (candidatesList) {
                        for (const cd of candidatesList) {
                            const rcid = getNestedValue(cd, [0]);
                            if (!rcid) continue;
                            const [text, thoughts, webImgs, genImgs, genVids, genMedia] = this._parseCandidate(cd, cid, '', rcid);
                            turns.push({ role: 'model', text, model_output: new ModelOutput([cid, ''], [new Candidate({ rcid, index: 0, text, thoughts, web_images: webImgs, generated_images: genImgs, generated_videos: genVids, generated_media: genMedia, done: true })]) });
                        }
                    }
                    const userText = getNestedValue(convTurn, [2, 0, 0], '');
                    if (userText) turns.push({ role: 'user', text: userText });
                }
                return { cid, turns };
            }
            return null;
        } catch { return null; }
    }

    async _waitDeepResearch(plan, pollInterval = 10000, timeout = 600000, onStatus = null) {
        if (!plan.research_id) throw new GeminiError('Cannot poll: plan.research_id is missing.');
        const start = Date.now();
        const statuses = [];
        const chat = this.newChat({ metadata: [...plan.metadata], model: Model.UNSPECIFIED });
        chat.cid = plan.cid;
        while ((Date.now() - start) < timeout) {
            const status = plan.research_id ? await this._getDeepResearchStatus(plan.research_id) : null;
            if (status) {
                statuses.push(status);
                if (onStatus) onStatus(status);
                if (status.done) break;
            }
            await sleep(pollInterval);
        }
        if (!statuses.length || !statuses[statuses.length - 1].done) {
            console.warn(`Deep research [${plan.research_id}] timed out after ${timeout}ms`);
        }
        let finalOutput = null;
        if (chat.cid) {
            const recovered = await this._readChatInternal(chat.cid);
            if (recovered?.turns?.length) {
                const modelTurn = recovered.turns.find(t => t.role === 'model');
                if (modelTurn?.model_output) finalOutput = modelTurn.model_output;
            }
        }
        const done = statuses.length > 0 && statuses[statuses.length - 1].done;
        return new DeepResearchResult({ plan, statuses, final_output: finalOutput, done });
    }

    async _getDeepResearchStatus(researchId) {
        const response = await this._batchExecute([
            new RPCData({ rpcid: GRPC.DEEP_RESEARCH_STATUS, payload: JSON.stringify([researchId]) }),
        ]);
        const responseJson = extractJsonFromResponse(response.data);
        for (const part of responseJson) {
            const bodyStr = getNestedValue(part, [2]);
            if (!bodyStr) continue;
            let body; try { body = JSON.parse(bodyStr); } catch { continue; }
            const parsed = extractDeepResearchStatusPayload(body);
            if (parsed) return new DeepResearchStatus(parsed);
        }
        return null;
    }

    _resetCloseTask() {
        if (this.closeTask) { clearTimeout(this.closeTask); this.closeTask = null; }
        this.closeTask = setTimeout(() => this.close(), this.closeDelay);
    }

    async _fetchRecentChats(recent = 13) {
        const fetchBatch = (payload) => this._batchExecute([
            new RPCData({ rpcid: GRPC.LIST_CHATS, payload: JSON.stringify([recent, null, payload]) }),
        ]);
        const [resp1, resp2] = await Promise.all([fetchBatch([1, null, 1]), fetchBatch([0, null, 1])]);
        const recentChats = [];
        const seenCids = new Set();
        for (const response of [resp1, resp2]) {
            const chatsJson = extractJsonFromResponse(response.data);
            for (const part of chatsJson) {
                const bodyStr = getNestedValue(part, [2]);
                if (!bodyStr) continue;
                let body; try { body = JSON.parse(bodyStr); } catch { continue; }
                const chatList = getNestedValue(body, [2]);
                if (!Array.isArray(chatList)) continue;
                for (const chatData of chatList) {
                    if (!Array.isArray(chatData) || chatData.length < 2) continue;
                    const cid = getNestedValue(chatData, [0], '');
                    const title = getNestedValue(chatData, [1], '');
                    const is_pinned = Boolean(getNestedValue(chatData, [2]));
                    const tsData = getNestedValue(chatData, [5]);
                    let timestamp = 0;
                    if (Array.isArray(tsData) && tsData.length >= 2) {
                        timestamp = Number(tsData[0]) + Number(tsData[1]) / 1e9;
                    }
                    if (cid && !seenCids.has(cid)) {
                        seenCids.add(cid);
                        recentChats.push({ cid, title, pinned: is_pinned, timestamp });
                    }
                }
                break;
            }
        }
        return recentChats;
    }

    async _batchExecute(payloads, retries = 2, closeOnError = true, sourcePath = '/app') {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const _reqid = this._reqid;
                this._reqid += 100000;
                const params = new URLSearchParams({
                    rpcids: payloads.map(p => p.rpcid).join(','),
                    hl: this.language || 'en',
                    _reqid: String(_reqid),
                    rt: 'c',
                    'source-path': sourcePath,
                });
                if (this.buildLabel) params.set('bl', this.buildLabel);
                if (this.sessionId) params.set('f.sid', this.sessionId);
                const body = new URLSearchParams({
                    at: this.accessToken || '',
                    'f.req': JSON.stringify([payloads.map(p => p.serialize())]),
                });
                const res = await axios.post(
                    `${Endpoint.BATCH_EXEC}?${params}`,
                    body.toString(),
                    {
                        headers: {
                            ...Headers.GEMINI, ...Headers.BATCH_EXEC, ...Headers.SAME_DOMAIN,
                            'Cookie': cookieStr(this.cookies),
                        },
                        timeout: this.timeout,
                        ...(this.proxy ? { proxy: parseProxy(this.proxy) } : {}),
                        validateStatus: null,
                    },
                );
                Object.assign(this.cookies, parseCookies(res.headers));
                if (res.status !== 200) {
                    if (closeOnError) await this.close();
                    throw new APIError(`Batch execution failed with status code ${res.status}`);
                }
                return res;
            } catch (e) {
                lastErr = e;
                if (attempt < retries) await sleep(1000 * (attempt + 1));
            }
        }
        throw lastErr;
    }
}

module.exports = { Gemini };
