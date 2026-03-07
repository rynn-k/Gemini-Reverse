'use strict';

const { getAccessToken, sendInitRequest, cookieStr, parseCookies, parseProxy, cacheDir } = require('./accessToken');
const { getDeltaByFpLen, getCleanText, getFpLen, getNestedValue, parseResponseByFrame, extractJsonFromResponse } = require('./parsing');
const { rotate1psidts } = require('./rotate');
const { uploadFile, parseFileName, generateRandomName } = require('./upload');

module.exports = {
    getAccessToken,
    sendInitRequest,
    cookieStr,
    parseCookies,
    parseProxy,
    cacheDir,
    getDeltaByFpLen,
    getCleanText,
    getFpLen,
    getNestedValue,
    parseResponseByFrame,
    extractJsonFromResponse,
    rotate1psidts,
    uploadFile,
    parseFileName,
    generateRandomName,
};