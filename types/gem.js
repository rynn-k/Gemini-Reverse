'use strict';

class Gem {
    constructor({ id, name, description = null, prompt = null, predefined } = {}) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.prompt = prompt;
        this.predefined = predefined;
    }

    toString() {
        return `Gem(id='${this.id}', name='${this.name}', description='${this.description}', prompt='${this.prompt}', predefined=${this.predefined})`;
    }
}

class GemJar {
    constructor(entries = []) {
        this._store = {};
        for (const [id, gem] of entries) this._store[id] = gem;
    }

    set(id, gem) { this._store[id] = gem; }

    get({ id = null, name = null, defaultVal = null } = {}) {
        if (id == null && name == null) throw new Error('At least one of gem id or name must be provided.');
        if (id != null) {
            const gem = this._store[id];
            if (!gem) return defaultVal;
            if (name != null) return gem.name === name ? gem : defaultVal;
            return gem;
        }
        for (const gem of Object.values(this._store)) {
            if (gem.name === name) return gem;
        }
        return defaultVal;
    }

    filter({ predefined = null, name = null } = {}) {
        const result = new GemJar();
        for (const [id, gem] of Object.entries(this._store)) {
            if (predefined != null && gem.predefined !== predefined) continue;
            if (name != null && gem.name !== name) continue;
            result.set(id, gem);
        }
        return result;
    }

    values() { return Object.values(this._store); }
    keys() { return Object.keys(this._store); }
    entries() { return Object.entries(this._store); }

    [Symbol.iterator]() { return this.values()[Symbol.iterator](); }

    toObject() { return { ...this._store }; }
}

module.exports = { Gem, GemJar };