'use strict';

const TEMPORARY_CHAT_FLAG_INDEX = 45;

const Endpoint = {
    GOOGLE: 'https://www.google.com',
    INIT: 'https://gemini.google.com/app',
    GENERATE: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    ROTATE_COOKIES: 'https://accounts.google.com/RotateCookies',
    UPLOAD: 'https://content-push.googleapis.com/upload',
    BATCH_EXEC: 'https://gemini.google.com/_/BardChatUi/data/batchexecute',
};

const GRPC = {
    LIST_CHATS: 'MaZiqc',
    READ_CHAT: 'hNvQHb',
    DELETE_CHAT: 'GzXR5e',
    LIST_GEMS: 'CNgdBe',
    CREATE_GEM: 'oMH3Zd',
    UPDATE_GEM: 'kHv0Vd',
    DELETE_GEM: 'UXcSJb',
    BARD_ACTIVITY: 'ESY5D',
};

const Headers = {
    GEMINI: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'Host': 'gemini.google.com',
        'Origin': 'https://gemini.google.com',
        'Referer': 'https://gemini.google.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'X-Same-Domain': '1',
    },
    ROTATE_COOKIES: {
        'Content-Type': 'application/json',
    },
    UPLOAD: {
        'Push-ID': 'feeds/mcudyrk2a4khkz',
    },
};

const Model = {
    UNSPECIFIED: { model_name: 'unspecified', model_header: {}, advanced_only: false },
    G_3_1_PRO: {
        model_name: 'gemini-3.1-pro',
        model_header: {
            'x-goog-ext-525001261-jspb': '[1,null,null,null,"e6fa609c3fa255c0",null,null,0,[4],null,null,2]',
            'x-goog-ext-73010989-jspb': '[0]',
            'x-goog-ext-73010990-jspb': '[0]',
        },
        advanced_only: false,
    },
    G_3_0_FLASH: {
        model_name: 'gemini-3.0-flash',
        model_header: {
            'x-goog-ext-525001261-jspb': '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4],null,null,1]',
            'x-goog-ext-73010989-jspb': '[0]',
            'x-goog-ext-73010990-jspb': '[0]',
        },
        advanced_only: false,
    },
    G_3_0_FLASH_THINKING: {
        model_name: 'gemini-3.0-flash-thinking',
        model_header: {
            'x-goog-ext-525001261-jspb': '[1,null,null,null,"5bf011840784117a",null,null,0,[4],null,null,1]',
            'x-goog-ext-73010989-jspb': '[0]',
            'x-goog-ext-73010990-jspb': '[0]',
        },
        advanced_only: false,
    },
    fromName(name) {
        const legacy = { 'gemini-3.0-pro': 'gemini-3.1-pro' };
        const resolved = legacy[name] || name;
        for (const k of ['UNSPECIFIED', 'G_3_1_PRO', 'G_3_0_FLASH', 'G_3_0_FLASH_THINKING']) {
            if (Model[k].model_name === resolved) return Model[k];
        }
        throw new Error(`Unknown model name: ${name}. Available: ${['UNSPECIFIED', 'G_3_1_PRO', 'G_3_0_FLASH', 'G_3_0_FLASH_THINKING'].map(k => Model[k].model_name).join(', ')}`);
    },
    fromDict(d) {
        if (!d.model_name || !d.model_header || typeof d.model_header !== 'object')
            throw new Error('model_name and model_header (object) required');
        return { model_name: d.model_name, model_header: d.model_header, advanced_only: false };
    },
};

const ErrorCode = {
    TEMPORARY_ERROR_1013: 1013,
    USAGE_LIMIT_EXCEEDED: 1037,
    MODEL_INCONSISTENT: 1050,
    MODEL_HEADER_INVALID: 1052,
    IP_TEMPORARILY_BLOCKED: 1060,
};

module.exports = { TEMPORARY_CHAT_FLAG_INDEX, Endpoint, GRPC, Headers, Model, ErrorCode };