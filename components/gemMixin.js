'use strict';

const { GRPC } = require('../constants');
const { APIError } = require('../exceptions');
const { Gem, GemJar } = require('../types/gem');
const { RPCData } = require('../types/grpc');
const { extractJsonFromResponse, getNestedValue } = require('../utils/parsing');

class GemMixin {
    constructor() {
        this._gems = null;
    }

    get gems() {
        if (!this._gems) throw new Error('Gems not fetched yet. Call fetchGems() first.');
        return this._gems;
    }

    async fetchGems({ includeHidden = false, language = 'en' } = {}) {
        const response = await this._batchExecute([
            new RPCData({ rpcid: GRPC.LIST_GEMS, payload: includeHidden ? `[4,['${language}'],0]` : `[3,['${language}'],0]`, identifier: 'system' }),
            new RPCData({ rpcid: GRPC.LIST_GEMS, payload: `[2,['${language}'],0]`, identifier: 'custom' }),
        ]);

        try {
            const responseJson = extractJsonFromResponse(response.data);
            let predefinedGems = [], customGems = [];

            for (const part of responseJson) {
                const identifier = getNestedValue(part, [-1]);
                const bodyStr = getNestedValue(part, [2]);
                if (!bodyStr) continue;
                const body = JSON.parse(bodyStr);
                if (identifier === 'system') predefinedGems = getNestedValue(body, [2], []);
                else if (identifier === 'custom') customGems = getNestedValue(body, [2], []);
            }

            if (!predefinedGems.length && !customGems.length) throw new Error('Empty gem list.');

            const mkGem = (g, predefined) => new Gem({ id: g[0], name: g[1][0], description: g[1][1], prompt: g[2] ? g[2][0] : null, predefined });
            this._gems = new GemJar([
                ...predefinedGems.map(g => [g[0], mkGem(g, true)]),
                ...customGems.map(g => [g[0], mkGem(g, false)]),
            ]);

            return this._gems;
        } catch (e) {
            await this.close();
            throw new APIError('Failed to fetch gems. Unexpected response data structure.');
        }
    }

    async createGem({ name, prompt, description = '' } = {}) {
        const response = await this._batchExecute([
            new RPCData({ rpcid: GRPC.CREATE_GEM, payload: JSON.stringify([[name, description, prompt, null, null, null, null, null, 0, null, 1, null, null, null, []]]) }),
        ]);

        try {
            const responseJson = extractJsonFromResponse(response.data);
            const bodyStr = getNestedValue(responseJson, [0, 2]);
            if (!bodyStr) throw new Error();
            const id = getNestedValue(JSON.parse(bodyStr), [0]);
            if (!id) throw new Error();
            return new Gem({ id, name, description, prompt, predefined: false });
        } catch {
            await this.close();
            throw new APIError('Failed to create gem. Unexpected response data structure.');
        }
    }

    async updateGem({ gem, name, prompt, description = '' } = {}) {
        const id = gem instanceof Gem ? gem.id : gem;
        await this._batchExecute([
            new RPCData({ rpcid: GRPC.UPDATE_GEM, payload: JSON.stringify([id, [name, description, prompt, null, null, null, null, null, 0, null, 1, null, null, null, [], 0]]) }),
        ]);
        return new Gem({ id, name, description, prompt, predefined: false });
    }

    async deleteGem(gem) {
        const id = gem instanceof Gem ? gem.id : gem;
        await this._batchExecute([
            new RPCData({ rpcid: GRPC.DELETE_GEM, payload: JSON.stringify([id]) }),
        ]);
    }
}

module.exports = { GemMixin };