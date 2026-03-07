'use strict';

const { GRPC } = require('../constants');
const { RPCData } = require('../types/grpc');
const { Candidate } = require('../types/candidate');
const { ModelOutput } = require('../types/modeloutput');
const { ConversationTurn } = require('../types/conversation');
const { extractJsonFromResponse, getNestedValue } = require('../utils/parsing');

class ChatMixin {
    async _fetchChatTurns(cid, maxTurns = 10) {
        const response = await this._batchExecute([
            new RPCData({ rpcid: GRPC.READ_CHAT, payload: JSON.stringify([cid, maxTurns, null, 1, [0], [4], null, 1]) }),
        ]);

        const responseJson = extractJsonFromResponse(response.data);

        for (const part of responseJson) {
            const bodyStr = getNestedValue(part, [2]);
            if (!bodyStr) continue;
            const body = JSON.parse(bodyStr);
            const turns = getNestedValue(body, [0]);
            if (!turns || !Array.isArray(turns)) continue;
            return turns;
        }

        console.warn(`_fetchChatTurns(${cid}) found no turns`);
        return null;
    }

    async fetchLatestChatResponse(cid) {
        try {
            const turns = await this._fetchChatTurns(cid, 10);
            if (!turns) return null;

            const convTurn = turns[turns.length - 1];
            if (!convTurn) return null;

            const candidatesList = getNestedValue(convTurn, [3, 0]);
            if (!candidatesList) return null;

            const candidateData = getNestedValue(candidatesList, [0]);
            if (!candidateData) return null;

            const rcid = getNestedValue(candidateData, [0], '');
            const text = getNestedValue(candidateData, [1, 0], '');
            if (!text) return null;

            const turnMeta = getNestedValue(convTurn, [0]);
            const rid = Array.isArray(turnMeta) && turnMeta.length >= 2 && typeof turnMeta[1] === 'string' ? turnMeta[1] : '';
            const metadata = rid ? [cid, rid] : [cid];

            return new ModelOutput(metadata, [new Candidate({ rcid, text })]);
        } catch (e) {
            console.warn(`fetchLatestChatResponse(${cid}) error: ${e.message}`);
            return null;
        }
    }

    async readChat(cid, maxTurns = 100) {
        try {
            const turns = await this._fetchChatTurns(cid, maxTurns);
            if (!turns) return [];

            const result = [];
            for (const turn of turns) {
                if (!Array.isArray(turn) || turn.length < 4) continue;

                const turnMeta = getNestedValue(turn, [0]);
                const rid = Array.isArray(turnMeta) ? (getNestedValue(turnMeta, [1], '') || '') : '';
                const userPrompt = getNestedValue(turn, [2, 0, 0], '');
                const candidateData = getNestedValue(turn, [3, 0, 0]);
                if (!candidateData) continue;

                const rcid = getNestedValue(candidateData, [0], '');
                const text = getNestedValue(candidateData, [1, 0], '');
                if (!text) continue;

                const thoughts = getNestedValue(candidateData, [37, 0, 0]) || null;
                const tsData = getNestedValue(turn, [4]);
                let timestamp = null;
                if (Array.isArray(tsData) && tsData.length && typeof tsData[0] === 'number') {
                    try { timestamp = new Date(tsData[0] * 1000); } catch {}
                }

                result.push(new ConversationTurn({ rid, user_prompt: userPrompt, assistant_response: text, rcid, thoughts, timestamp }));
            }

            result.reverse();
            return result;
        } catch (e) {
            console.warn(`readChat(${cid}) error: ${e.message}`);
            return [];
        }
    }

    async deleteChat(cid) {
        await this._batchExecute([
            new RPCData({ rpcid: GRPC.DELETE_CHAT, payload: JSON.stringify([cid]) }),
        ]);
    }
}

module.exports = { ChatMixin };