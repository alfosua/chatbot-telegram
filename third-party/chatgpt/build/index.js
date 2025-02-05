// src/chatgpt-api.ts
import ExpiryMap from "expiry-map";
import pTimeout from "p-timeout";
import { v4 as uuidv4 } from "uuid";

// src/types.ts
var ChatGPTError = class extends Error {
};

// src/abstract-chatgpt-api.ts
var AChatGPTAPI = class {
  async resetSession() {
    await this.closeSession();
    return this.initSession();
  }
};

// src/fetch.ts
var fetch2 = globalThis.fetch;
if (typeof fetch2 !== "function") {
  throw new Error(
    "Invalid environment: global fetch not defined; `chatgpt` requires Node.js >= 18 at the moment due to Cloudflare protections"
  );
}

// src/fetch-sse.ts
import { createParser } from "eventsource-parser";

// src/stream-async-iterable.ts
async function* streamAsyncIterable(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// src/fetch-sse.ts
async function fetchSSE(url2, options) {
  const { onMessage, ...fetchOptions } = options;
  const res = await fetch2(url2, fetchOptions);
  if (!res.ok) {
    const msg = `ChatGPTAPI error ${res.status || res.statusText}`;
    const error = new ChatGPTError(msg);
    error.statusCode = res.status;
    error.statusText = res.statusText;
    error.response = res;
    throw error;
  }
  const parser = createParser((event) => {
    if (event.type === "event") {
      onMessage(event.data);
    }
  });
  if (!res.body.getReader) {
    const body = res.body;
    if (!body.on || !body.read) {
      throw new ChatGPTError('unsupported "fetch" implementation');
    }
    body.on("readable", () => {
      let chunk;
      while (null !== (chunk = body.read())) {
        parser.feed(chunk.toString());
      }
    });
  } else {
    for await (const chunk of streamAsyncIterable(res.body)) {
      const str = new TextDecoder().decode(chunk);
      parser.feed(str);
    }
  }
}

// src/utils.ts
import { remark } from "remark";
import stripMarkdown from "strip-markdown";
function markdownToText(markdown) {
  return remark().use(stripMarkdown).processSync(markdown ?? "").toString();
}
async function minimizePage(page) {
  const session = await page.target().createCDPSession();
  const goods = await session.send("Browser.getWindowForTarget");
  const { windowId } = goods;
  await session.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "minimized" }
  });
}
async function maximizePage(page) {
  const session = await page.target().createCDPSession();
  const goods = await session.send("Browser.getWindowForTarget");
  const { windowId } = goods;
  await session.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "normal" }
  });
}
function isRelevantRequest(url2) {
  let pathname;
  try {
    const parsedUrl = new URL(url2);
    pathname = parsedUrl.pathname;
    url2 = parsedUrl.toString();
  } catch (_) {
    return false;
  }
  if (!url2.startsWith("https://chat.openai.com")) {
    return false;
  }
  if (!pathname.startsWith("/backend-api/") && !pathname.startsWith("/api/auth/session")) {
    return false;
  }
  if (pathname.endsWith("backend-api/moderations")) {
    return false;
  }
  return true;
}
async function browserPostEventStream(url2, accessToken, body, timeoutMs) {
  var _a, _b, _c, _d;
  globalThis.__name = () => void 0;
  class TimeoutError2 extends Error {
    constructor(message) {
      super(message);
      this.name = "TimeoutError";
    }
  }
  class AbortError extends Error {
    constructor(message) {
      super();
      this.name = "AbortError";
      this.message = message;
    }
  }
  const BOM = [239, 187, 191];
  let conversationId = body == null ? void 0 : body.conversation_id;
  let messageId = (_b = (_a = body == null ? void 0 : body.messages) == null ? void 0 : _a[0]) == null ? void 0 : _b.id;
  let response = "";
  try {
    console.log("browserPostEventStream", url2, accessToken, body);
    let abortController = null;
    if (timeoutMs) {
      abortController = new AbortController();
    }
    const res = await fetch(url2, {
      method: "POST",
      body: JSON.stringify(body),
      signal: abortController == null ? void 0 : abortController.signal,
      headers: {
        accept: "text/event-stream",
        "x-openai-assistant-app-id": "",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      }
    });
    console.log("browserPostEventStream response", res);
    if (!res.ok) {
      return {
        error: {
          message: `ChatGPTAPI error ${res.status || res.statusText}`,
          statusCode: res.status,
          statusText: res.statusText
        },
        conversationId,
        messageId
      };
    }
    const responseP = new Promise(
      async (resolve, reject) => {
        function onMessage(data) {
          var _a2, _b2, _c2, _d2;
          if (data === "[DONE]") {
            return resolve({
              response,
              conversationId,
              messageId
            });
          }
          try {
            const convoResponseEvent = JSON.parse(data);
            if (convoResponseEvent.conversation_id) {
              conversationId = convoResponseEvent.conversation_id;
            }
            if ((_a2 = convoResponseEvent.message) == null ? void 0 : _a2.id) {
              messageId = convoResponseEvent.message.id;
            }
            const partialResponse = (_d2 = (_c2 = (_b2 = convoResponseEvent.message) == null ? void 0 : _b2.content) == null ? void 0 : _c2.parts) == null ? void 0 : _d2[0];
            if (partialResponse) {
              response = partialResponse;
            }
          } catch (err) {
            console.warn("fetchSSE onMessage unexpected error", err);
            reject(err);
          }
        }
        const parser = createParser2((event) => {
          if (event.type === "event") {
            onMessage(event.data);
          }
        });
        for await (const chunk of streamAsyncIterable2(res.body)) {
          const str = new TextDecoder().decode(chunk);
          parser.feed(str);
        }
      }
    );
    if (timeoutMs) {
      if (abortController) {
        ;
        responseP.cancel = () => {
          abortController.abort();
        };
      }
      return await pTimeout2(responseP, {
        milliseconds: timeoutMs,
        message: "ChatGPT timed out waiting for response"
      });
    } else {
      return await responseP;
    }
  } catch (err) {
    const errMessageL = err.toString().toLowerCase();
    if (response && (errMessageL === "error: typeerror: terminated" || errMessageL === "typeerror: terminated")) {
      return {
        response,
        conversationId,
        messageId
      };
    }
    return {
      error: {
        message: err.toString(),
        statusCode: err.statusCode || err.status || ((_c = err.response) == null ? void 0 : _c.statusCode),
        statusText: err.statusText || ((_d = err.response) == null ? void 0 : _d.statusText)
      },
      conversationId,
      messageId
    };
  }
  async function* streamAsyncIterable2(stream) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  function createParser2(onParse) {
    let isFirstChunk;
    let buffer;
    let startingPosition;
    let startingFieldLength;
    let eventId;
    let eventName;
    let data;
    reset();
    return { feed, reset };
    function reset() {
      isFirstChunk = true;
      buffer = "";
      startingPosition = 0;
      startingFieldLength = -1;
      eventId = void 0;
      eventName = void 0;
      data = "";
    }
    function feed(chunk) {
      buffer = buffer ? buffer + chunk : chunk;
      if (isFirstChunk && hasBom(buffer)) {
        buffer = buffer.slice(BOM.length);
      }
      isFirstChunk = false;
      const length = buffer.length;
      let position = 0;
      let discardTrailingNewline = false;
      while (position < length) {
        if (discardTrailingNewline) {
          if (buffer[position] === "\n") {
            ++position;
          }
          discardTrailingNewline = false;
        }
        let lineLength = -1;
        let fieldLength = startingFieldLength;
        let character;
        for (let index = startingPosition; lineLength < 0 && index < length; ++index) {
          character = buffer[index];
          if (character === ":" && fieldLength < 0) {
            fieldLength = index - position;
          } else if (character === "\r") {
            discardTrailingNewline = true;
            lineLength = index - position;
          } else if (character === "\n") {
            lineLength = index - position;
          }
        }
        if (lineLength < 0) {
          startingPosition = length - position;
          startingFieldLength = fieldLength;
          break;
        } else {
          startingPosition = 0;
          startingFieldLength = -1;
        }
        parseEventStreamLine(buffer, position, fieldLength, lineLength);
        position += lineLength + 1;
      }
      if (position === length) {
        buffer = "";
      } else if (position > 0) {
        buffer = buffer.slice(position);
      }
    }
    function parseEventStreamLine(lineBuffer, index, fieldLength, lineLength) {
      if (lineLength === 0) {
        if (data.length > 0) {
          onParse({
            type: "event",
            id: eventId,
            event: eventName || void 0,
            data: data.slice(0, -1)
          });
          data = "";
          eventId = void 0;
        }
        eventName = void 0;
        return;
      }
      const noValue = fieldLength < 0;
      const field = lineBuffer.slice(
        index,
        index + (noValue ? lineLength : fieldLength)
      );
      let step = 0;
      if (noValue) {
        step = lineLength;
      } else if (lineBuffer[index + fieldLength + 1] === " ") {
        step = fieldLength + 2;
      } else {
        step = fieldLength + 1;
      }
      const position = index + step;
      const valueLength = lineLength - step;
      const value = lineBuffer.slice(position, position + valueLength).toString();
      if (field === "data") {
        data += value ? `${value}
` : "\n";
      } else if (field === "event") {
        eventName = value;
      } else if (field === "id" && !value.includes("\0")) {
        eventId = value;
      } else if (field === "retry") {
        const retry = parseInt(value, 10);
        if (!Number.isNaN(retry)) {
          onParse({ type: "reconnect-interval", value: retry });
        }
      }
    }
  }
  function hasBom(buffer) {
    return BOM.every(
      (charCode, index) => buffer.charCodeAt(index) === charCode
    );
  }
  function getDOMException(errorMessage) {
    return globalThis.DOMException === void 0 ? new AbortError(errorMessage) : new DOMException(errorMessage);
  }
  function getAbortedReason(signal) {
    const reason = signal.reason === void 0 ? getDOMException("This operation was aborted.") : signal.reason;
    return reason instanceof Error ? reason : getDOMException(reason);
  }
  function pTimeout2(promise, options) {
    const {
      milliseconds,
      fallback,
      message,
      customTimers = { setTimeout, clearTimeout }
    } = options;
    let timer;
    const cancelablePromise = new Promise((resolve, reject) => {
      if (typeof milliseconds !== "number" || Math.sign(milliseconds) !== 1) {
        throw new TypeError(
          `Expected \`milliseconds\` to be a positive number, got \`${milliseconds}\``
        );
      }
      if (milliseconds === Number.POSITIVE_INFINITY) {
        resolve(promise);
        return;
      }
      if (options.signal) {
        const { signal } = options;
        if (signal.aborted) {
          reject(getAbortedReason(signal));
        }
        signal.addEventListener("abort", () => {
          reject(getAbortedReason(signal));
        });
      }
      timer = customTimers.setTimeout.call(
        void 0,
        () => {
          if (fallback) {
            try {
              resolve(fallback());
            } catch (error) {
              reject(error);
            }
            return;
          }
          const errorMessage = typeof message === "string" ? message : `Promise timed out after ${milliseconds} milliseconds`;
          const timeoutError = message instanceof Error ? message : new TimeoutError2(errorMessage);
          if (typeof promise.cancel === "function") {
            ;
            promise.cancel();
          }
          reject(timeoutError);
        },
        milliseconds
      );
      (async () => {
        try {
          resolve(await promise);
        } catch (error) {
          reject(error);
        } finally {
          customTimers.clearTimeout.call(void 0, timer);
        }
      })();
    });
    cancelablePromise.clear = () => {
      customTimers.clearTimeout.call(void 0, timer);
      timer = void 0;
    };
    return cancelablePromise;
  }
}

// src/chatgpt-api.ts
var KEY_ACCESS_TOKEN = "accessToken";
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";
var ChatGPTAPI = class extends AChatGPTAPI {
  constructor(opts) {
    super();
    this._user = null;
    const {
      sessionToken,
      clearanceToken,
      markdown = true,
      apiBaseUrl = "https://chat.openai.com/api",
      backendApiBaseUrl = "https://chat.openai.com/backend-api",
      userAgent = USER_AGENT,
      accessTokenTTL = 60 * 6e4,
      accessToken,
      headers,
      debug = false
    } = opts;
    this._sessionToken = sessionToken;
    this._clearanceToken = clearanceToken;
    this._markdown = !!markdown;
    this._debug = !!debug;
    this._apiBaseUrl = apiBaseUrl;
    this._backendApiBaseUrl = backendApiBaseUrl;
    this._userAgent = userAgent;
    this._headers = {
      "user-agent": this._userAgent,
      "x-openai-assistant-app-id": "",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      origin: "https://chat.openai.com",
      referer: "https://chat.openai.com/chat",
      "sec-ch-ua": '"Not?A_Brand";v="8", "Chromium";v="108", "Google Chrome";v="108"',
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...headers
    };
    this._accessTokenCache = new ExpiryMap(accessTokenTTL);
    if (accessToken) {
      this._accessTokenCache.set(KEY_ACCESS_TOKEN, accessToken);
    }
    if (!this._sessionToken) {
      const error = new ChatGPTError("ChatGPT invalid session token");
      error.statusCode = 401;
      throw error;
    }
    if (!this._clearanceToken) {
      const error = new ChatGPTError("ChatGPT invalid clearance token");
      error.statusCode = 401;
      throw error;
    }
  }
  get user() {
    return this._user;
  }
  get sessionToken() {
    return this._sessionToken;
  }
  get clearanceToken() {
    return this._clearanceToken;
  }
  get userAgent() {
    return this._userAgent;
  }
  async initSession() {
    await this.refreshSession();
  }
  async sendMessage(message, opts = {}) {
    const {
      conversationId,
      parentMessageId = uuidv4(),
      messageId = uuidv4(),
      action = "next",
      timeoutMs,
      onProgress
    } = opts;
    let { abortSignal } = opts;
    let abortController = null;
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }
    const accessToken = await this.refreshSession();
    const body = {
      action,
      messages: [
        {
          id: messageId,
          role: "user",
          content: {
            content_type: "text",
            parts: [message]
          }
        }
      ],
      model: "text-davinci-002-render",
      parent_message_id: parentMessageId
    };
    if (conversationId) {
      body.conversation_id = conversationId;
    }
    const result = {
      conversationId,
      messageId,
      response: ""
    };
    const responseP = new Promise((resolve, reject) => {
      const url2 = `${this._backendApiBaseUrl}/conversation`;
      const headers = {
        ...this._headers,
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Cookie: `cf_clearance=${this._clearanceToken}`
      };
      if (this._debug) {
        console.log("POST", url2, { body, headers });
      }
      fetchSSE(url2, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abortSignal,
        onMessage: (data) => {
          var _a, _b, _c;
          if (data === "[DONE]") {
            return resolve(result);
          }
          try {
            const convoResponseEvent = JSON.parse(data);
            if (convoResponseEvent.conversation_id) {
              result.conversationId = convoResponseEvent.conversation_id;
            }
            if ((_a = convoResponseEvent.message) == null ? void 0 : _a.id) {
              result.messageId = convoResponseEvent.message.id;
            }
            const message2 = convoResponseEvent.message;
            if (message2) {
              let text = (_c = (_b = message2 == null ? void 0 : message2.content) == null ? void 0 : _b.parts) == null ? void 0 : _c[0];
              if (text) {
                if (!this._markdown) {
                  text = markdownToText(text);
                }
                result.response = text;
                if (onProgress) {
                  onProgress(result);
                }
              }
            }
          } catch (err) {
            console.warn("fetchSSE onMessage unexpected error", err);
            reject(err);
          }
        }
      }).catch((err) => {
        const errMessageL = err.toString().toLowerCase();
        if (result.response && (errMessageL === "error: typeerror: terminated" || errMessageL === "typeerror: terminated")) {
          return resolve(result);
        } else {
          return reject(err);
        }
      });
    });
    if (timeoutMs) {
      if (abortController) {
        ;
        responseP.cancel = () => {
          abortController.abort();
        };
      }
      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: "ChatGPT timed out waiting for response"
      });
    } else {
      return responseP;
    }
  }
  async sendModeration(input) {
    const accessToken = await this.refreshSession();
    const url2 = `${this._backendApiBaseUrl}/moderations`;
    const headers = {
      ...this._headers,
      Authorization: `Bearer ${accessToken}`,
      Accept: "*/*",
      "Content-Type": "application/json",
      Cookie: `cf_clearance=${this._clearanceToken}`
    };
    const body = {
      input,
      model: "text-moderation-playground"
    };
    if (this._debug) {
      console.log("POST", url2, headers, body);
    }
    const res = await fetch2(url2, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }).then((r) => {
      if (!r.ok) {
        const error = new ChatGPTError(`${r.status} ${r.statusText}`);
        error.response = r;
        error.statusCode = r.status;
        error.statusText = r.statusText;
        throw error;
      }
      return r.json();
    });
    return res;
  }
  async getIsAuthenticated() {
    try {
      void await this.refreshSession();
      return true;
    } catch (err) {
      return false;
    }
  }
  async refreshSession() {
    const cachedAccessToken = this._accessTokenCache.get(KEY_ACCESS_TOKEN);
    if (cachedAccessToken) {
      return cachedAccessToken;
    }
    let response;
    try {
      const url2 = `${this._apiBaseUrl}/auth/session`;
      const headers = {
        ...this._headers,
        cookie: `cf_clearance=${this._clearanceToken}; __Secure-next-auth.session-token=${this._sessionToken}`,
        accept: "*/*"
      };
      if (this._debug) {
        console.log("GET", url2, headers);
      }
      const res = await fetch2(url2, {
        headers
      }).then((r) => {
        response = r;
        if (!r.ok) {
          const error = new ChatGPTError(`${r.status} ${r.statusText}`);
          error.response = r;
          error.statusCode = r.status;
          error.statusText = r.statusText;
          throw error;
        }
        return r.json();
      });
      const accessToken = res == null ? void 0 : res.accessToken;
      if (!accessToken) {
        const error = new ChatGPTError("Unauthorized");
        error.response = response;
        error.statusCode = response == null ? void 0 : response.status;
        error.statusText = response == null ? void 0 : response.statusText;
        throw error;
      }
      const appError = res == null ? void 0 : res.error;
      if (appError) {
        if (appError === "RefreshAccessTokenError") {
          const error = new ChatGPTError("session token may have expired");
          error.response = response;
          error.statusCode = response == null ? void 0 : response.status;
          error.statusText = response == null ? void 0 : response.statusText;
          throw error;
        } else {
          const error = new ChatGPTError(appError);
          error.response = response;
          error.statusCode = response == null ? void 0 : response.status;
          error.statusText = response == null ? void 0 : response.statusText;
          throw error;
        }
      }
      if (res.user) {
        this._user = res.user;
      }
      this._accessTokenCache.set(KEY_ACCESS_TOKEN, accessToken);
      return accessToken;
    } catch (err) {
      if (this._debug) {
        console.error(err);
      }
      const error = new ChatGPTError(
        `ChatGPT failed to refresh auth token. ${err.toString()}`
      );
      error.response = response;
      error.statusCode = response == null ? void 0 : response.status;
      error.statusText = response == null ? void 0 : response.statusText;
      error.originalError = err;
      throw error;
    }
  }
  async closeSession() {
    this._accessTokenCache.delete(KEY_ACCESS_TOKEN);
  }
};

// src/chatgpt-api-browser.ts
import delay2 from "delay";
import { v4 as uuidv42 } from "uuid";

// src/openai-auth.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";
import delay from "delay";
import { TimeoutError } from "p-timeout";
import puppeteer from "puppeteer-extra";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import random from "random";
puppeteer.use(StealthPlugin());
var hasRecaptchaPlugin = false;
var hasNopechaExtension = false;
var __dirname2 = url.fileURLToPath(new URL(".", import.meta.url));
async function getOpenAIAuth({
  email,
  password,
  browser,
  page,
  timeoutMs = 2 * 60 * 1e3,
  isGoogleLogin = false,
  isMicrosoftLogin = false,
  captchaToken = process.env.CAPTCHA_TOKEN,
  nopechaKey = process.env.NOPECHA_KEY,
  executablePath,
  proxyServer = process.env.PROXY_SERVER
}) {
  var _a, _b, _c, _d;
  const origBrowser = browser;
  const origPage = page;
  try {
    if (!browser) {
      browser = await getBrowser({
        captchaToken,
        nopechaKey,
        executablePath,
        proxyServer
      });
    }
    const userAgent = await browser.userAgent();
    if (!page) {
      page = (await browser.pages())[0] || await browser.newPage();
      page.setDefaultTimeout(timeoutMs);
    }
    await page.goto("https://chat.openai.com/auth/login", {
      waitUntil: "networkidle2"
    });
    await checkForChatGPTAtCapacity(page, { timeoutMs });
    if (hasRecaptchaPlugin) {
      const captchas = await page.findRecaptchas();
      if ((_a = captchas == null ? void 0 : captchas.filtered) == null ? void 0 : _a.length) {
        console.log("solving captchas using 2captcha...");
        const res = await page.solveRecaptchas();
        console.log("captcha result", res);
      }
    }
    if (email 
      //&& password
      ) {
      await waitForConditionOrAtCapacity(
        page,
        () => page.waitForSelector("#__next .btn-primary", { timeout: timeoutMs })
      );
      await delay(500);
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "networkidle2",
          timeout: timeoutMs
        }),
        page.click("#__next .btn-primary")
      ]);
      await checkForChatGPTAtCapacity(page, { timeoutMs });
      let submitP;
      if (isGoogleLogin) {
        await page.click('button[data-provider="google"]');
        await page.waitForSelector('input[type="email"]');
        await page.type('input[type="email"]', email, { delay: 10 });
        await Promise.all([
          page.waitForNavigation(),
          await page.keyboard.press("Enter")
        ]);
        await page.waitForSelector('input[type="password"]', { visible: true });
        await page.type('input[type="password"]', password, { delay: 10 });
        submitP = () => page.keyboard.press("Enter");
      } else if (isMicrosoftLogin) {
        await page.click('button[data-provider="windowslive"]');
        await page.waitForSelector('input[type="email"]');
        await page.type('input[type="email"]', email, { delay: 10 });
        await Promise.all([
          page.waitForNavigation(),
          await page.keyboard.press("Enter")
        ]);
        await delay(1500);
        await page.waitForSelector('input[type="password"]', { visible: true });
        await page.type('input[type="password"]', password, { delay: 10 });
        submitP = () => page.keyboard.press("Enter");
        await Promise.all([
          page.waitForNavigation(),
          await page.keyboard.press("Enter")
        ]);
        await delay(1e3);
      } else {
        await page.waitForSelector("#username");
        await page.type("#username", email, { delay: 20 });
        await delay(100);
        if (hasNopechaExtension) {
          await waitForRecaptcha(page, { timeoutMs });
        } else if (hasRecaptchaPlugin) {
          console.log("solving captchas using 2captcha...");
          const res = await page.solveRecaptchas();
          if ((_b = res.captchas) == null ? void 0 : _b.length) {
            console.log("captchas result", res);
          } else {
            console.log("no captchas found");
          }
        }
        await delay(1200);
        const frame = page.mainFrame();
        const submit = await page.waitForSelector('button[type="submit"]', {
          timeout: timeoutMs
        });
        frame.focus('button[type="submit"]');
        await submit.focus();
        await submit.click();
        await page.waitForSelector("#password", { timeout: timeoutMs });
        await page.type("#password", password, { delay: 10 });
        submitP = () => page.click('button[type="submit"]');
      }
      await Promise.all([
        waitForConditionOrAtCapacity(
          page,
          () => page.waitForNavigation({
            waitUntil: "networkidle2",
            timeout: timeoutMs
          })
        ),
        submitP()
      ]);
    } else {
      await delay(2e3);
      await checkForChatGPTAtCapacity(page, { timeoutMs });
    }
    const pageCookies = await page.cookies();
    const cookies = pageCookies.reduce(
      (map, cookie) => ({ ...map, [cookie.name]: cookie }),
      {}
    );
    const authInfo = {
      userAgent,
      clearanceToken: (_c = cookies["cf_clearance"]) == null ? void 0 : _c.value,
      sessionToken: (_d = cookies["__Secure-next-auth.session-token"]) == null ? void 0 : _d.value,
      cookies
    };
    return authInfo;
  } catch (err) {
    throw err;
  } finally {
    if (origBrowser) {
      if (page && page !== origPage) {
        await page.close();
      }
    } else if (browser) {
      await browser.close();
    }
    page = null;
    browser = null;
  }
}
async function getBrowser(opts = {}) {
  const {
    captchaToken = process.env.CAPTCHA_TOKEN,
    nopechaKey = process.env.NOPECHA_KEY,
    executablePath = defaultChromeExecutablePath(),
    proxyServer = process.env.PROXY_SERVER,
    ...launchOptions
  } = opts;
  if (captchaToken && !hasRecaptchaPlugin) {
    hasRecaptchaPlugin = true;
    puppeteer.use(
      RecaptchaPlugin({
        provider: {
          id: "2captcha",
          token: captchaToken
        },
        visualFeedback: true
      })
    );
  }
  const puppeteerArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-infobars",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--ignore-certificate-errors",
    "--no-first-run",
    "--no-service-autorun",
    "--password-store=basic",
    "--system-developer-mode",
    "--mute-audio",
    "--disable-default-apps",
    "--no-zygote",
    "--disable-accelerated-2d-canvas",
    "--disable-web-security",
    "--disable-gpu"
  ];
  if (nopechaKey) {
    const nopechaPath = path.join(
      __dirname2,
      "..",
      "third-party",
      "nopecha-chrome-extension"
    );
    puppeteerArgs.push(`--disable-extensions-except=${nopechaPath}`);
    puppeteerArgs.push(`--load-extension=${nopechaPath}`);
    hasNopechaExtension = true;
  }
  if (proxyServer) {
    puppeteerArgs.push(`--proxy-server=${proxyServer}`);
  }
  const browser = await puppeteer.launch({
    headless: false,
    args: puppeteerArgs,
    ignoreDefaultArgs: [
      "--disable-extensions",
      "--enable-automation",
      "--disable-component-extensions-with-background-pages"
    ],
    ignoreHTTPSErrors: true,
    executablePath,
    ...launchOptions
  });
  if (process.env.PROXY_VALIDATE_IP) {
    const page = (await browser.pages())[0] || await browser.newPage();
    let ip;
    try {
      ;
      ({ ip } = await page.evaluate(() => {
        return fetch("https://ifconfig.co", {
          headers: {
            Accept: "application/json"
          }
        }).then((res) => res.json());
      }));
    } catch (err) {
      throw new Error(`Proxy IP validation failed: ${err.message}`);
    }
    if (ip !== process.env.PROXY_VALIDATE_IP) {
      throw new Error(
        `Proxy IP mismatch: ${ip} !== ${process.env.PROXY_VALIDATE_IP}`
      );
    }
  }
  if (hasNopechaExtension) {
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.goto(`https://nopecha.com/setup#${nopechaKey}`);
    await delay(1e3);
    try {
      const page3 = await browser.newPage();
      await page.close();
      const targets = browser.targets();
      const extensionIds = (await Promise.all(
        targets.map(async (target) => {
          if (target.type() !== "service_worker") {
            return;
          }
          const url2 = new URL(target.url());
          return url2.hostname;
        })
      )).filter(Boolean);
      const extensionId = extensionIds[0];
      if (extensionId) {
        const extensionUrl = `chrome-extension://${extensionId}/popup.html`;
        await page3.goto(extensionUrl, { waitUntil: "networkidle2" });
        await delay(500);
        const editKey = await page3.waitForSelector("#edit_key .clickable");
        await editKey.click();
        const settingsInput = await page3.waitForSelector("input.settings_text");
        await settingsInput.evaluate((el) => {
          el.value = "";
        });
        await settingsInput.type(nopechaKey);
        await settingsInput.evaluate((el, value) => {
          el.value = value;
        }, nopechaKey);
        await settingsInput.press("Enter");
        await delay(500);
        await editKey.click();
        await delay(2e3);
        console.log("initialized nopecha extension with key", nopechaKey);
      } else {
        console.error(
          "error initializing nopecha extension; couldn't determine extension ID"
        );
      }
    } catch (err) {
      console.error("error initializing nopecha extension", err);
    }
  }
  return browser;
}
var defaultChromeExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  switch (os.platform()) {
    case "win32":
      return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    case "darwin":
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    default: {
      const chromeExists = fs.existsSync("/usr/bin/google-chrome");
      return chromeExists ? "/usr/bin/google-chrome" : "/usr/bin/google-chrome-stable";
    }
  }
};
async function checkForChatGPTAtCapacity(page, opts = {}) {
  const {
    timeoutMs = 2 * 60 * 1e3,
    pollingIntervalMs = 3e3,
    retries = 10
  } = opts;
  let isAtCapacity = false;
  let numTries = 0;
  do {
    try {
      await solveSimpleCaptchas(page);
      const res = await page.$x("//div[contains(., 'ChatGPT is at capacity')]");
      isAtCapacity = !!(res == null ? void 0 : res.length);
      if (isAtCapacity) {
        if (++numTries >= retries) {
          break;
        }
        await page.reload({
          waitUntil: "networkidle2",
          timeout: timeoutMs
        });
        await delay(pollingIntervalMs);
      }
    } catch (err) {
      ++numTries;
      break;
    }
  } while (isAtCapacity);
  if (isAtCapacity) {
    const error = new ChatGPTError("ChatGPT is at capacity");
    error.statusCode = 503;
    throw error;
  }
}
async function waitForConditionOrAtCapacity(page, condition, opts = {}) {
  const { pollingIntervalMs = 500 } = opts;
  return new Promise((resolve, reject) => {
    let resolved = false;
    async function waitForCapacityText() {
      if (resolved) {
        return;
      }
      try {
        await checkForChatGPTAtCapacity(page);
        if (!resolved) {
          setTimeout(waitForCapacityText, pollingIntervalMs);
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          return reject(err);
        }
      }
    }
    condition().then(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }).catch((err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    setTimeout(waitForCapacityText, pollingIntervalMs);
  });
}
async function solveSimpleCaptchas(page) {
  try {
    const verifyYouAreHuman = await page.$("text=Verify you are human");
    if (verifyYouAreHuman) {
      await delay(2e3);
      await verifyYouAreHuman.click({
        delay: random.int(5, 25)
      });
      await delay(1e3);
    }
    const cloudflareButton = await page.$(".hcaptcha-box");
    if (cloudflareButton) {
      await delay(2e3);
      await cloudflareButton.click({
        delay: random.int(5, 25)
      });
      await delay(1e3);
    }
  } catch (err) {
  }
}
async function waitForRecaptcha(page, opts = {}) {
  var _a;
  await solveSimpleCaptchas(page);
  if (!hasNopechaExtension) {
    return;
  }
  const { pollingIntervalMs = 100, timeoutMs } = opts;
  const captcha = await page.$("textarea#g-recaptcha-response");
  const startTime = Date.now();
  if (captcha) {
    console.log("waiting to solve recaptcha...");
    do {
      const value = (_a = await captcha.evaluate((el) => el.value)) == null ? void 0 : _a.trim();
      if (value == null ? void 0 : value.length) {
        break;
      }
      if (timeoutMs) {
        const now = Date.now();
        if (now - startTime >= timeoutMs) {
          throw new TimeoutError("Timed out waiting to solve Recaptcha");
        }
      }
      await delay(pollingIntervalMs);
    } while (true);
  }
}

// src/chatgpt-api-browser.ts
var CHAT_PAGE_URL = "https://chat.openai.com/chat";
var ChatGPTAPIBrowser = class extends AChatGPTAPI {
  constructor(opts) {
    super();
    this._onRequest = (request) => {
      const url2 = request.url();
      if (!isRelevantRequest(url2)) {
        return;
      }
      const method = request.method();
      let body;
      if (method === "POST") {
        body = request.postData();
        try {
          body = JSON.parse(body);
        } catch (_) {
        }
      }
      if (this._debug) {
        console.log("\nrequest", {
          url: url2,
          method,
          headers: request.headers(),
          body
        });
      }
    };
    this._onResponse = async (response) => {
      const request = response.request();
      const url2 = response.url();
      if (!isRelevantRequest(url2)) {
        return;
      }
      const status = response.status();
      let body;
      try {
        body = await response.json();
      } catch (_) {
      }
      if (this._debug) {
        console.log("\nresponse", {
          url: url2,
          ok: response.ok(),
          status,
          statusText: response.statusText(),
          headers: response.headers(),
          body,
          request: {
            method: request.method(),
            headers: request.headers(),
            body: request.postData()
          }
        });
      }
      if (url2.endsWith("/conversation")) {
        if (status === 403) {
          await this.refreshSession();
        }
      } else if (url2.endsWith("api/auth/session")) {
        if (status === 401) {
          await this.resetSession();
        } else if (status === 403) {
          await this.refreshSession();
        } else {
          const session = body;
          if (session == null ? void 0 : session.accessToken) {
            this._accessToken = session.accessToken;
          }
        }
      }
    };
    const {
      email,
      password,
      markdown = true,
      debug = false,
      isGoogleLogin = false,
      isMicrosoftLogin = false,
      minimize = true,
      captchaToken,
      executablePath,
      proxyServer
    } = opts;
    this._email = email;
    this._password = password;
    this._markdown = !!markdown;
    this._debug = !!debug;
    this._isGoogleLogin = !!isGoogleLogin;
    this._isMicrosoftLogin = !!isMicrosoftLogin;
    this._minimize = !!minimize;
    this._captchaToken = captchaToken;
    this._executablePath = executablePath;
    this._proxyServer = proxyServer;
    if (!this._email) {
      const error = new ChatGPTError("ChatGPT invalid email");
      error.statusCode = 401;
      throw error;
    }
    // if (!this._password) {
    //   const error = new ChatGPTError("ChatGPT invalid password");
    //   error.statusCode = 401;
    //   throw error;
    // }
  }
  async initSession() {
    if (this._browser) {
      await this.closeSession();
    }
    try {
      this._browser = await getBrowser({
        captchaToken: this._captchaToken,
        executablePath: this._executablePath,
        proxyServer: this._proxyServer
      });
      this._page = (await this._browser.pages())[0] || await this._browser.newPage();
      this._page.evaluateOnNewDocument(() => {
        window.localStorage.setItem("oai/apps/hasSeenOnboarding/chat", "true");
        window.localStorage.setItem(
          "oai/apps/hasSeenReleaseAnnouncement/2022-12-15",
          "true"
        );
      });
      await maximizePage(this._page);
      this._page.on("request", this._onRequest.bind(this));
      this._page.on("response", this._onResponse.bind(this));
      await getOpenAIAuth({
        email: this._email,
        password: this._password,
        browser: this._browser,
        page: this._page,
        isGoogleLogin: this._isGoogleLogin,
        isMicrosoftLogin: this._isMicrosoftLogin
      });
    } catch (err) {
      if (this._browser) {
        await this._browser.close();
      }
      this._browser = null;
      this._page = null;
      throw err;
    }
    if (!this.isChatPage || this._isGoogleLogin || this._isMicrosoftLogin) {
      await this._page.goto(CHAT_PAGE_URL, {
        waitUntil: "networkidle2"
      });
    }
    do {
      const modalSelector = '[data-headlessui-state="open"]';
      try {
        if (!await this._page.$(modalSelector)) {
          break;
        }
        await this._page.click(`${modalSelector} button:last-child`);
      } catch (err) {
        break;
      }
      await delay2(300);
    } while (true);
    if (!await this.getIsAuthenticated()) {
      throw new ChatGPTError("Failed to authenticate session");
    }
    if (this._minimize) {
      return minimizePage(this._page);
    }
  }
  async resetSession() {
    console.log(
      `ChatGPT "${this._email}" session expired; re-authenticating...`
    );
    try {
      await this.closeSession();
      await this.initSession();
      console.log(`ChatGPT "${this._email}" re-authenticated successfully`);
    } catch (err) {
      console.error(
        `ChatGPT "${this._email}" error re-authenticating`,
        err.toString()
      );
    }
  }
  async refreshSession() {
    console.log(`ChatGPT "${this._email}" session expired (403); refreshing...`);
    try {
      if (!this._minimize) {
        await maximizePage(this._page);
      }
      await this._page.reload({
        waitUntil: "networkidle2",
        timeout: 2 * 60 * 1e3
      });
      if (this._minimize && this.isChatPage) {
        await minimizePage(this._page);
      }
      console.log(`ChatGPT "${this._email}" refreshed session successfully`);
    } catch (err) {
      console.error(
        `ChatGPT "${this._email}" error refreshing session`,
        err.toString()
      );
    }
  }
  async getIsAuthenticated() {
    try {
      if (!this._accessToken) {
        return false;
      }
      const inputBox = await this._getInputBox();
      return !!inputBox;
    } catch (err) {
      return false;
    }
  }
  async sendMessage(message, opts = {}) {
    var _a, _b;
    const {
      conversationId,
      parentMessageId = uuidv42(),
      messageId = uuidv42(),
      action = "next",
      timeoutMs
    } = opts;
    const url2 = `https://chat.openai.com/backend-api/conversation`;
    const body = {
      action,
      messages: [
        {
          id: messageId,
          role: "user",
          content: {
            content_type: "text",
            parts: [message]
          }
        }
      ],
      model: "text-davinci-002-render",
      parent_message_id: parentMessageId
    };
    if (conversationId) {
      body.conversation_id = conversationId;
    }
    let result;
    let numTries = 0;
    do {
      if (!await this.getIsAuthenticated()) {
        console.log(`chatgpt re-authenticating ${this._email}`);
        try {
          await this.resetSession();
        } catch (err) {
          console.warn(
            `chatgpt error re-authenticating ${this._email}`,
            err.toString()
          );
        }
        if (!await this.getIsAuthenticated()) {
          const error = new ChatGPTError("Not signed in");
          error.statusCode = 401;
          throw error;
        }
      }
      try {
        result = await this._page.evaluate(
          browserPostEventStream,
          url2,
          this._accessToken,
          body,
          timeoutMs
        );
      } catch (err) {
        if (++numTries >= 2) {
          const error = new ChatGPTError(err.toString());
          error.statusCode = (_a = err.response) == null ? void 0 : _a.statusCode;
          error.statusText = (_b = err.response) == null ? void 0 : _b.statusText;
          throw error;
        }
        console.warn("chatgpt sendMessage error; retrying...", err.toString());
        await delay2(5e3);
      }
    } while (!result);
    if ("error" in result) {
      const error = new ChatGPTError(result.error.message);
      error.statusCode = result.error.statusCode;
      error.statusText = result.error.statusText;
      if (error.statusCode === 403) {
        await this.refreshSession();
      }
      throw error;
    } else {
      if (!this._markdown) {
        result.response = markdownToText(result.response);
      }
      return result;
    }
  }
  async resetThread() {
    try {
      await this._page.click("nav > a:nth-child(1)");
    } catch (err) {
    }
  }
  async closeSession() {
    await this._browser.close();
    this._page = null;
    this._browser = null;
    this._accessToken = null;
  }
  async _getInputBox() {
    try {
      return await this._page.$("textarea");
    } catch (err) {
      return null;
    }
  }
  get isChatPage() {
    var _a;
    try {
      const url2 = (_a = this._page) == null ? void 0 : _a.url().replace(/\/$/, "");
      return url2 === CHAT_PAGE_URL;
    } catch (err) {
      return false;
    }
  }
};
export {
  AChatGPTAPI,
  ChatGPTAPI,
  ChatGPTAPIBrowser,
  ChatGPTError,
  browserPostEventStream,
  defaultChromeExecutablePath,
  getBrowser,
  getOpenAIAuth,
  isRelevantRequest,
  markdownToText,
  maximizePage,
  minimizePage
};
//# sourceMappingURL=index.js.map