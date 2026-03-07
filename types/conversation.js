'use strict';

class ConversationTurn {
    constructor({ rid, user_prompt, assistant_response, rcid, thoughts = null, timestamp = null } = {}) {
        this.rid = rid;
        this.user_prompt = this._decodeHtml(user_prompt);
        this.assistant_response = this._decodeHtml(assistant_response);
        this.rcid = rcid;
        this.thoughts = thoughts ? this._decodeHtml(thoughts) : null;
        this.timestamp = timestamp instanceof Date ? timestamp : timestamp ? new Date(timestamp) : null;
    }

    _decodeHtml(str) {
        if (!str) return str;
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, '\'')
            .replace(/&apos;/g, '\'');
    }

    toString() { return this.assistant_response; }

    repr() {
        const preview = this.user_prompt.length > 30 ? this.user_prompt.slice(0, 30) + '...' : this.user_prompt;
        return `ConversationTurn(rid='${this.rid}', prompt='${preview}')`;
    }
}

module.exports = { ConversationTurn };