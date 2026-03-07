'use strict';

class ModelOutput {
    constructor(metadata, candidates, chosen = 0) {
        this.metadata = metadata;
        this.candidates = candidates;
        this.chosen = chosen;
    }

    get text() { return this.candidates[this.chosen].text; }
    get text_delta() { return this.candidates[this.chosen].text_delta || ''; }
    get thoughts() { return this.candidates[this.chosen].thoughts; }
    get thoughts_delta() { return this.candidates[this.chosen].thoughts_delta || ''; }
    get images() { return this.candidates[this.chosen].images; }
    get rcid() { return this.candidates[this.chosen].rcid; }

    toString() { return this.text; }

    repr() {
        return `ModelOutput(metadata=${JSON.stringify(this.metadata)}, chosen=${this.chosen}, candidates=${this.candidates.length})`;
    }
}

module.exports = { ModelOutput };