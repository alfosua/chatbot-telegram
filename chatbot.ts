import "dotenv/config";

import {
  ChatGPTAPIBrowser,
  ChatResponse,
} from "./third-party/chatgpt/build/index.js";
import throttle from "lodash/throttle.js";
import { Bot, Context, session, SessionFlavor } from "grammy";
import type { Message } from "grammy/out/types";

const env = process.env;

const BOT_TOKEN = env["BOT_TOKEN"];
const SESSION_TOKEN = env["SESSION_TOKEN"];
const CF_CLEARANCE = env["CF_CLEARANCE"];
const ACCESS_TOKEN = env["ACCESS_TOKEN"];
const OPENAI_EMAIL = env["OPENAI_EMAIL"]!;
const OPENAI_PASSWORD = env["OPENAI_PASSWORD"]!;

if (!BOT_TOKEN) {
  logWithTime("⛔️ BOT_TOKEN must be set");
  process.exit(1);
}

interface SessionData {
  lastResponse: ChatResponse | undefined;
}

type MyContext = Context & SessionFlavor<SessionData>;

// Start telegram bot
const b = new Bot<MyContext>(BOT_TOKEN);

b.use(
  session({
    type: "single",
    initial: (): SessionData => ({ lastResponse: undefined }),
  })
);

const botInfo = await b.api.getMe();
const botName = botInfo.username ?? "";

if (!botName) {
  logWithTime("⛔️ Bot username not found");
  process.exit(1);
} else {
  logWithTime("🤖 Bot", `@${botName}`, "has started...");
}

// Start ChatGPT API

let chatGPTAPI: ChatGPTAPIBrowser;
try {
  chatGPTAPI = new ChatGPTAPIBrowser({
    email: OPENAI_EMAIL,
    password: OPENAI_PASSWORD,
    isGoogleLogin: true,
  });
  await chatGPTAPI.initSession();
  console.log(`Authenticated: ${await chatGPTAPI.getIsAuthenticated()}`);
} catch (err) {
  logWithTime("⛔️ ChatGPT API error:", err.message);
  process.exit(1);
}
logWithTime("🔮 ChatGPT API has started...");

logWithTime("🔄 ChatGPT Conversation initialized");

let lastResponse: ChatResponse | undefined;

const filtered = b.filter((ctx) => {
  const message = ctx.message;
  // Only respond to messages that start with @botName in a group chat
  if (
    message &&
    (message.chat.type === "group" || message.chat.type === "supergroup") &&
    !message.text?.startsWith(`@${botName}`)
  ) {
    return false;
  }

  return true;
});

filtered.command("reload", async (ctx) => {
  lastResponse = undefined;
  await ctx.reply("🔄 Conversation has been reset, enjoy!");
  logWithTime("🔄 Conversation has been reset, new conversation id");
});

filtered.command("help", (ctx) => {
  return ctx.reply(
    "🤖 This is a chatbot powered by ChatGPT. You can use the following commands:\n\n/reload - Reset the conversation\n/help - Show this message"
  );
});

filtered
  .on("message")
  .filter((ctx) => Boolean(ctx.message.text))
  .use(async function handleMessage(ctx, next) {
    // Parse message and send to ChatGPT if needed
    const msg = ctx.message;
    // Remove @botName from message
    const message = msg.text!.replace(`@${botName}`, "").trim();
    if (message === "") {
      return next();
    }

    logWithTime(`📩 Message from ${msg.chat.id}:`, message);

    // Send a message to the chat acknowledging receipt of their message
    let respMsg = await ctx.reply("🤔", {
      reply_to_message_id: msg.message_id,
    });
    ctx.replyWithChatAction("typing");

    // Send message to ChatGPT
    try {
      lastResponse = await chatGPTAPI.sendMessage(message, {
        conversationId: lastResponse?.conversationId,
        parentMessageId: lastResponse?.messageId,
        onProgress: throttle(
          async (partialResponse: ChatResponse) => {
            respMsg = await editMessage(respMsg, partialResponse.response);
            ctx.replyWithChatAction("typing");
          },
          4000,
          { leading: true, trailing: false }
        ),
      });
      editMessage(respMsg, lastResponse.response);
      logWithTime("📨 Response:", lastResponse);
    } catch (err) {
      logWithTime("⛔️ ChatGPT API error:", err);
      // If the error contains session token has expired, then get a new session token
      if (err.message.includes("session token may have expired")) {
        ctx.reply("🔑 Token has expired, please update the token.");
      } else {
        ctx.reply(
          "🤖 Sorry, I'm having trouble connecting to the server, please try again later."
        );
      }
    }
    async function editMessage(
      msg: Message.TextMessage,
      text: string,
      needParse = true
    ): Promise<Message.TextMessage> {
      if (msg.text === text) {
        return msg;
      }
      try {
        const resp = await ctx.api.editMessageText(
          msg.chat.id,
          msg.message_id,
          text,
          { parse_mode: needParse ? "Markdown" : undefined }
        );
        // type of resp is boolean | Message
        if (typeof resp === "object") {
          // return a Message type instance if resp is a Message type
          return resp;
        } else {
          // return the original message if resp is a boolean type
          return msg;
        }
      } catch (err) {
        logWithTime("⛔️ Edit message error:", err.message);
        return msg;
      }
    }
  });

// deno-lint-ignore no-explicit-any
function logWithTime(...args: any[]) {
  console.log(new Date().toLocaleString(), ...args);
}
