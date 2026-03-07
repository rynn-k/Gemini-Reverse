'use strict';

const { WebImage, GeneratedImage } = require('./image');

class Candidate {
    constructor({ rcid, text, text_delta = null, thoughts = null, thoughts_delta = null, web_images = [], generated_images = [] } = {}) {
        this.rcid = rcid;
        this.text = this._decodeHtml(text);
        this.text_delta = text_delta;
        this.thoughts = thoughts ? this._decodeHtml(thoughts) : null;
        this.thoughts_delta = thoughts_delta;
        this.web_images = web_images;
        this.generated_images = generated_images;
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

    get images() {
        return [...this.web_images, ...this.generated_images];
    }

    toString() { return this.text; }

    repr() {
        const preview = this.text.length <= 20 ? this.text : this.text.slice(0, 20) + '...';
        return `Candidate(rcid='${this.rcid}', text='${preview}', images=${this.images.length})`;
    }
}

module.exports = { Candidate };