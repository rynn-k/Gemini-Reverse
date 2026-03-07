'use strict';

class RPCData {
    constructor({ rpcid, payload, identifier = 'generic' } = {}) {
        this.rpcid = rpcid;
        this.payload = payload;
        this.identifier = identifier;
    }

    serialize() {
        return [this.rpcid, this.payload, null, this.identifier];
    }

    toString() {
        return `RPCData(rpcid='${this.rpcid}', payload='${this.payload}', identifier='${this.identifier}')`;
    }
}

module.exports = { RPCData };