export interface ModelHeader {
    'x-goog-ext-525001261-jspb'?: string;
    'x-goog-ext-73010989-jspb'?: string;
    'x-goog-ext-73010990-jspb'?: string;
    [key: string]: string | undefined;
}

export interface ModelDef {
    model_name: string;
    model_header: ModelHeader;
    advanced_only: boolean;
}

export interface ModelDict {
    model_name: string;
    model_header: ModelHeader;
}

export type ModelInput = string | ModelDef | ModelDict | null;

export declare const Model: {
    readonly UNSPECIFIED: ModelDef;
    readonly G_3_1_PRO: ModelDef;
    readonly G_3_0_FLASH: ModelDef;
    readonly G_3_0_FLASH_THINKING: ModelDef;
    fromName(name: string): ModelDef;
    fromDict(d: ModelDict): ModelDef;
};

export declare const GRPC: {
    readonly LIST_CHATS: string;
    readonly READ_CHAT: string;
    readonly DELETE_CHAT: string;
    readonly LIST_GEMS: string;
    readonly CREATE_GEM: string;
    readonly UPDATE_GEM: string;
    readonly DELETE_GEM: string;
    readonly BARD_ACTIVITY: string;
};

export declare const Endpoint: {
    readonly GOOGLE: string;
    readonly INIT: string;
    readonly GENERATE: string;
    readonly ROTATE_COOKIES: string;
    readonly UPLOAD: string;
    readonly BATCH_EXEC: string;
};

export declare const Headers: {
    readonly GEMINI: Record<string, string>;
    readonly ROTATE_COOKIES: Record<string, string>;
    readonly UPLOAD: Record<string, string>;
};

export declare const ErrorCode: {
    readonly TEMPORARY_ERROR_1013: 1013;
    readonly USAGE_LIMIT_EXCEEDED: 1037;
    readonly MODEL_INCONSISTENT: 1050;
    readonly MODEL_HEADER_INVALID: 1052;
    readonly IP_TEMPORARILY_BLOCKED: 1060;
};

export declare const TEMPORARY_CHAT_FLAG_INDEX: number;

export declare class AuthError extends Error { name: 'AuthError'; }
export declare class APIError extends Error { name: 'APIError'; }
export declare class ImageGenerationError extends APIError { name: 'ImageGenerationError'; }
export declare class GeminiError extends Error { name: 'GeminiError'; }
export declare class TimeoutError extends GeminiError { name: 'TimeoutError'; }
export declare class UsageLimitExceeded extends GeminiError { name: 'UsageLimitExceeded'; }
export declare class ModelInvalid extends GeminiError { name: 'ModelInvalid'; }
export declare class TemporarilyBlocked extends GeminiError { name: 'TemporarilyBlocked'; }

export interface ImageSaveOptions {
    path?: string;
    filename?: string;
    cookies?: Record<string, string> | null;
    verbose?: boolean;
    skipInvalidFilename?: boolean;
}

export declare class Image {
    url: string;
    title: string;
    alt: string;
    proxy: string | null;
    constructor(opts: { url: string; title?: string; alt?: string; proxy?: string | null });
    save(opts?: ImageSaveOptions): Promise<string | null>;
    toString(): string;
}

export declare class WebImage extends Image {}

export interface GeneratedImageSaveOptions extends ImageSaveOptions {
    fullSize?: boolean;
}

export declare class GeneratedImage extends Image {
    cookies: Record<string, string>;
    constructor(opts: { url: string; title?: string; alt?: string; proxy?: string | null; cookies: Record<string, string> });
    save(opts?: GeneratedImageSaveOptions): Promise<string | null>;
}

export declare class Candidate {
    rcid: string;
    text: string;
    text_delta: string | null;
    thoughts: string | null;
    thoughts_delta: string | null;
    web_images: WebImage[];
    generated_images: GeneratedImage[];
    constructor(opts: {
        rcid: string;
        text: string;
        text_delta?: string | null;
        thoughts?: string | null;
        thoughts_delta?: string | null;
        web_images?: WebImage[];
        generated_images?: GeneratedImage[];
    });
    get images(): (WebImage | GeneratedImage)[];
    toString(): string;
    repr(): string;
}

export declare class ModelOutput {
    metadata: string[];
    candidates: Candidate[];
    chosen: number;
    constructor(metadata: string[], candidates: Candidate[], chosen?: number);
    get text(): string;
    get text_delta(): string;
    get thoughts(): string | null;
    get thoughts_delta(): string;
    get images(): (WebImage | GeneratedImage)[];
    get rcid(): string;
    toString(): string;
    repr(): string;
}

export declare class ConversationTurn {
    rid: string;
    user_prompt: string;
    assistant_response: string;
    rcid: string;
    thoughts: string | null;
    timestamp: Date | null;
    constructor(opts: {
        rid: string;
        user_prompt: string;
        assistant_response: string;
        rcid: string;
        thoughts?: string | null;
        timestamp?: Date | string | null;
    });
    toString(): string;
    repr(): string;
}

export declare class Gem {
    id: string;
    name: string;
    description: string | null;
    prompt: string | null;
    predefined: boolean;
    constructor(opts: { id: string; name: string; description?: string | null; prompt?: string | null; predefined: boolean });
    toString(): string;
}

export interface GemGetOptions {
    id?: string | null;
    name?: string | null;
    defaultVal?: Gem | null;
}

export interface GemFilterOptions {
    predefined?: boolean | null;
    name?: string | null;
}

export declare class GemJar {
    constructor(entries?: [string, Gem][]);
    set(id: string, gem: Gem): void;
    get(opts: GemGetOptions): Gem | null;
    filter(opts?: GemFilterOptions): GemJar;
    values(): Gem[];
    keys(): string[];
    entries(): [string, Gem][];
    [Symbol.iterator](): Iterator<Gem>;
    toObject(): Record<string, Gem>;
}

export declare class RPCData {
    rpcid: string;
    payload: string;
    identifier: string;
    constructor(opts: { rpcid: string; payload: string; identifier?: string });
    serialize(): [string, string, null, string];
    toString(): string;
}

export interface GeminiClientOptions {
    secure_1psid?: string | null;
    secure_1psidts?: string | null;
    proxy?: string | null;
    cookies?: Record<string, string>;
}

export interface InitOptions {
    timeout?: number;
    autoClose?: boolean;
    closeDelay?: number;
    autoRefresh?: boolean;
    refreshInterval?: number;
    verbose?: boolean;
    watchdogTimeout?: number;
}

export interface GenerateOptions {
    prompt: string;
    files?: (string | Buffer)[] | null;
    model?: ModelInput;
    gem?: Gem | string | null;
    chat?: ChatSession | null;
    temporary?: boolean;
}

export interface StartChatOptions {
    metadata?: string[] | null;
    cid?: string | null;
    rid?: string | null;
    rcid?: string | null;
    model?: ModelInput;
    gem?: Gem | string | null;
}

export interface FetchGemsOptions {
    includeHidden?: boolean;
    language?: string;
}

export interface CreateGemOptions {
    name: string;
    prompt: string;
    description?: string;
}

export interface UpdateGemOptions {
    gem: Gem | string;
    name: string;
    prompt: string;
    description?: string;
}

export declare class GeminiClient {
    cookies: Record<string, string>;
    proxy: string | null;
    accessToken: string | null;
    buildLabel: string | null;
    sessionId: string | null;
    timeout: number;
    autoClose: boolean;
    closeDelay: number;
    autoRefresh: boolean;
    refreshInterval: number;
    verbose: boolean;
    watchdogTimeout: number;

    constructor(opts?: GeminiClientOptions);

    init(opts?: InitOptions): Promise<void>;
    close(delay?: number): Promise<void>;

    generateContent(opts: GenerateOptions): Promise<ModelOutput>;
    generateContentStream(opts: GenerateOptions): AsyncGenerator<ModelOutput>;

    startChat(opts?: StartChatOptions): ChatSession;

    fetchLatestChatResponse(cid: string): Promise<ModelOutput | null>;
    readChat(cid: string, maxTurns?: number): Promise<ConversationTurn[]>;
    deleteChat(cid: string): Promise<void>;

    get gems(): GemJar;
    fetchGems(opts?: FetchGemsOptions): Promise<GemJar>;
    createGem(opts: CreateGemOptions): Promise<Gem>;
    updateGem(opts: UpdateGemOptions): Promise<Gem>;
    deleteGem(gem: Gem | string): Promise<void>;
}

export interface ChatSessionOptions {
    geminiclient: GeminiClient;
    metadata?: string[] | null;
    cid?: string | null;
    rid?: string | null;
    rcid?: string | null;
    model?: ModelInput;
    gem?: Gem | string | null;
}

export interface SendMessageOptions {
    prompt: string;
    files?: (string | Buffer)[] | null;
    temporary?: boolean;
}

export declare class ChatSession {
    geminiclient: GeminiClient;
    lastOutput: ModelOutput | null;
    model: ModelDef;
    gem: Gem | string | null;

    constructor(opts: ChatSessionOptions);

    get metadata(): string[];
    set metadata(v: string[]);
    get cid(): string;
    set cid(v: string);
    get rid(): string;
    set rid(v: string);
    get rcid(): string;
    set rcid(v: string);

    sendMessage(opts: SendMessageOptions): Promise<ModelOutput>;
    sendMessageStream(opts: SendMessageOptions): AsyncGenerator<ModelOutput>;
    chooseCandidate(index: number): ModelOutput;

    toString(): string;
}