![Banner](https://nc-cdn.oss-accelerate.aliyuncs.com/nx/a772a980daeb.png)

# Gemini-Reverse

An unofficial Node.js client for [gemini.google.com](https://gemini.google.com), inspired by [Gemini-API](https://github.com/HanaokaYuzu/Gemini-API) — a Python reverse engineering project by [@HanaokaYuzu](https://github.com/HanaokaYuzu).

This package ports the core concepts and functionality of the original Python library to Node.js, with full CommonJS and TypeScript support.

---

## Features

- Send messages and receive responses from Gemini
- Streaming support with text deltas
- Multi-turn chat sessions with conversation history
- File and image upload support
- Gem (system prompt) management — create, update, delete, fetch
- Auto cookie refresh to keep sessions alive
- TypeScript type declarations included
- Proxy support

---

## Installation

```bash
npm install gemini-reverse
```

---

## Authentication

This package uses browser cookies to authenticate with Gemini. You need to obtain your `__Secure-1PSID` cookie from your browser after logging in to [gemini.google.com](https://gemini.google.com).

**Steps:**
1. Open [gemini.google.com](https://gemini.google.com) in your browser and log in
2. Open DevTools → Application → Cookies → `https://gemini.google.com`
3. Copy the value of `__Secure-1PSID` (and optionally `__Secure-1PSIDTS`)

> `__Secure-1PSIDTS` is optional — the client will attempt to refresh and cache it automatically after the first successful init.

---

## Quick Start

```js
const { GeminiClient } = require('gemini-reverse');

const client = new GeminiClient({
    secure_1psid: 'YOUR_SECURE_1PSID',
});

await client.init();

const chat = client.startChat();
const response = await chat.sendMessage({ prompt: 'Hello, Gemini!' });

console.log(response.text);
```

---

## Usage

### Initialize Client

```js
const client = new GeminiClient({
    secure_1psid: 'YOUR_SECURE_1PSID',
    secure_1psidts: 'YOUR_SECURE_1PSIDTS', // optional
    proxy: 'http://host:port',              // optional
});

await client.init({
    timeout: 300000,        // request timeout in ms, default 300000
    autoClose: false,       // auto close client after inactivity
    closeDelay: 300000,     // inactivity delay before closing in ms
    autoRefresh: true,      // auto refresh cookies in background
    refreshInterval: 540000 // cookie refresh interval in ms
});
```

### Generate Content (single turn)

```js
const response = await client.generateContent({ prompt: 'What is the capital of France?' });
console.log(response.text);
```

### Streaming

```js
for await (const chunk of client.generateContentStream({ prompt: 'Tell me a long story.' })) {
    process.stdout.write(chunk.text_delta);
}
```

### Chat Session

```js
const chat = client.startChat({ model: 'gemini-3.1-pro' });

const res1 = await chat.sendMessage({ prompt: 'My name is Alice.' });
console.log(res1.text);

const res2 = await chat.sendMessage({ prompt: 'What is my name?' });
console.log(res2.text); // remembers context
```

### Streaming in Chat

```js
const chat = client.startChat({ model: 'gemini-3.0-flash' });

for await (const chunk of chat.sendMessageStream({ prompt: 'Explain quantum computing.' })) {
    process.stdout.write(chunk.text_delta);
}
```

### Temporary Chat (no history saved)

```js
const chat = client.startChat();
const response = await chat.sendMessage({ prompt: 'This will not appear in history.', temporary: true });
```

### Send with Files

```js
const chat = client.startChat();
const response = await chat.sendMessage({
    prompt: 'Describe this image.',
    files: ['./photo.jpg'],
});
console.log(response.text);
```

### Multiple Candidates

```js
const chat = client.startChat();
const response = await chat.sendMessage({ prompt: 'Give me a poem.' });

// list all candidates
response.candidates.forEach((c, i) => console.log(`[${i}] ${c.text}`));

// choose a specific candidate to continue the conversation
chat.chooseCandidate(1);
```

### Models

```js
// use model name string
const chat = client.startChat({ model: 'gemini-3.1-pro' });

// or use the Model constant
const { Model } = require('gemini-api');
const chat = client.startChat({ model: Model.G_3_0_FLASH });

// or use a custom model dict
const chat = client.startChat({
    model: {
        model_name: 'my-model',
        model_header: { 'x-goog-ext-525001261-jspb': '...' },
    },
});
```

**Available models:**

| String | Constant |
|---|---|
| `gemini-3.1-pro` | `Model.G_3_1_PRO` |
| `gemini-3.0-flash` | `Model.G_3_0_FLASH` |
| `gemini-3.0-flash-thinking` | `Model.G_3_0_FLASH_THINKING` |
| `unspecified` (default) | `Model.UNSPECIFIED` |

### Images

Responses may include web images or AI-generated images.

```js
const response = await chat.sendMessage({ prompt: 'Send me an image of a cat.' });

for (const img of response.images) {
    console.log(img.url, img.title, img.alt);
    await img.save({ path: './downloads', verbose: true });
}
```

### Read Chat History

```js
const turns = await client.readChat('c_YOUR_CHAT_ID');

for (const turn of turns) {
    console.log('User:', turn.user_prompt);
    console.log('Gemini:', turn.assistant_response);
}
```

### Delete Chat

```js
await client.deleteChat('c_YOUR_CHAT_ID');
```

### Gems

```js
// fetch all gems
const gems = await client.fetchGems();

// get by name
const gem = gems.get({ name: 'Coding partner' });

// filter user-created gems
const myGems = gems.filter({ predefined: false });

// use a gem in chat
const chat = client.startChat({ gem: gem });

// create a gem
const newGem = await client.createGem({
    name: 'My Assistant',
    prompt: 'You are a helpful assistant that speaks formally.',
    description: 'Formal assistant gem',
});

// update a gem
await client.updateGem({
    gem: newGem,
    name: 'My Assistant v2',
    prompt: 'You are a helpful assistant that speaks casually.',
});

// delete a gem
await client.deleteGem(newGem);
```

### Close Client

```js
await client.close();
```

---

## TypeScript

This package includes full TypeScript declarations out of the box.

```ts
import { GeminiClient, ChatSession, ModelOutput, ConversationTurn, Gem, Model } from 'gemini-reverse';

const client = new GeminiClient({ secure_1psid: '...' });
await client.init();

const chat: ChatSession = client.startChat({ model: 'gemini-3.1-pro' });
const response: ModelOutput = await chat.sendMessage({ prompt: 'Hello!' });

console.log(response.text);
```

---

## Project Structure

```
gemini-api/
├── index.js          # entry point
├── index.d.ts        # TypeScript declarations
├── client.js         # GeminiClient + ChatSession
├── constants.js      # Endpoint, GRPC, Headers, Model, ErrorCode
├── exceptions.js     # custom error classes
├── types/
│   ├── candidate.js
│   ├── conversation.js
│   ├── gem.js
│   ├── grpc.js
│   ├── image.js
│   └── modeloutput.js
├── utils/
│   ├── accessToken.js
│   ├── parsing.js
│   ├── rotate.js
│   └── upload.js
└── components/
    ├── chatMixin.js
    └── gemMixin.js
```

---

## Error Handling

```js
const {
    AuthError,
    APIError,
    GeminiError,
    TimeoutError,
    UsageLimitExceeded,
    ModelInvalid,
    TemporarilyBlocked,
} = require('gemini-reverse');

try {
    const response = await chat.sendMessage({ prompt: 'Hello!' });
} catch (e) {
    if (e instanceof AuthError) {
        console.error('Cookie expired or invalid.');
    } else if (e instanceof UsageLimitExceeded) {
        console.error('Usage limit reached. Try again later or switch models.');
    } else if (e instanceof TemporarilyBlocked) {
        console.error('IP temporarily blocked. Try using a proxy.');
    } else if (e instanceof TimeoutError) {
        console.error('Request timed out.');
    } else if (e instanceof ModelInvalid) {
        console.error('Invalid or unavailable model.');
    } else if (e instanceof APIError) {
        console.error('API error:', e.message);
    }
}
```

---

## Credits

Inspired by [Gemini-API](https://github.com/HanaokaYuzu/Gemini-API) by [@HanaokaYuzu](https://github.com/HanaokaYuzu) — an unofficial Python client for Gemini through reverse engineering.

---

## Disclaimer

This is an unofficial package and is not affiliated with or endorsed by Google. Use at your own risk. Cookie-based authentication may break if Google changes its internal API.

---

## License

MIT
