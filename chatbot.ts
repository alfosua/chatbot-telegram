import "https://deno.land/std@0.170.0/dotenv/load.ts";

import { ChatGPTAPIBrowser, ChatResponse } from "npm:chatgpt@3.3.1";
import throttle from "npm:lodash-es@4.17.21/throttle.js";
// @deno-types="npm:@types/node-telegram-bot-api@^0.57.6"
import TelegramBot from "npm:node-telegram-bot-api@0.60.0";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const SESSION_TOKEN = Deno.env.get("SESSION_TOKEN");
const CF_CLEARANCE = Deno.env.get("CF_CLEARANCE");
const ACCESS_TOKEN = Deno.env.get("ACCESS_TOKEN");

if (!BOT_TOKEN || !SESSION_TOKEN || !CF_CLEARANCE || !ACCESS_TOKEN) {
  logWithTime(
    "⛔️ BOT_TOKEN and SESSION_TOKEN and CF_CLEARANCE and ACCESS_TOKEN must be set in .env file"
  );
  Deno.exit(1);
}

// Start telegram bot

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const botInfo = await bot.getMe();
const botName = botInfo.username ?? "";

if (!botName) {
  logWithTime("⛔️ Bot username not found");
  Deno.exit(1);
} else {
  logWithTime("🤖 Bot", `@${botName}`, "has started...");
}

// Start ChatGPT API

let chatGPTAPI: ChatGPTAPIBrowser;
try {
  chatGPTAPI = new ChatGPTAPIBrowser({
    email: Deno.env.get("OPENAI_EMAIL")!,
    password: Deno.env.get("OPENAI_PASSWORD")!,
    isGoogleLogin: true,
  });
  await chatGPTAPI.initSession();
  console.log(`Authenticated: ${await chatGPTAPI.getIsAuthenticated()}`);
} catch (err) {
  logWithTime("⛔️ ChatGPT API error:", err.message);
  Deno.exit(1);
}
logWithTime("🔮 ChatGPT API has started...");

logWithTime("🔄 ChatGPT Conversation initialized");

// Handle messages
bot.on("message", async (msg) => {
  await handleMessage(msg);
});

function handleCommand(msg: TelegramBot.Message): boolean {
  // reload command
  if (msg.text === "/reload") {
    lastResponse = undefined;
    bot.sendMessage(msg.chat.id, "🔄 Conversation has been reset, enjoy!");
    logWithTime("🔄 Conversation has been reset, new conversation id");
    return true;
  }
  // help command
  if (msg.text === "/help") {
    bot.sendMessage(
      msg.chat.id,
      "🤖 This is a chatbot powered by ChatGPT. You can use the following commands:\n\n/reload - Reset the conversation\n/help - Show this message"
    );
    return true;
  }
  return false;
}

let lastResponse: ChatResponse | undefined;

// Parse message and send to ChatGPT if needed
async function handleMessage(msg: TelegramBot.Message) {
  const chatId = msg.chat.id;
  if (!msg.text) {
    return;
  }

  // Only respond to messages that start with @botName in a group chat
  if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    if (!msg.text.startsWith(`@${botName}`)) {
      return;
    }
  }

  // Remove @botName from message
  const message = msg.text.replace(`@${botName}`, "").trim();
  if (message === "") {
    return;
  }

  // Handle commands if needed
  if (await handleCommand(msg)) {
    return;
  }

  logWithTime(`📩 Message from ${msg.chat.id}:`, message);

  // Send a message to the chat acknowledging receipt of their message
  let respMsg = await bot.sendMessage(chatId, "🤔", {
    reply_to_message_id: msg.message_id,
  });
  bot.sendChatAction(chatId, "typing");

  // Send message to ChatGPT
  try {
    lastResponse = await chatGPTAPI.sendMessage(message, {
      conversationId: lastResponse?.conversationId,
      parentMessageId: lastResponse?.messageId,
      onProgress: throttle(
        async (partialResponse: string) => {
          respMsg = await editMessage(respMsg, partialResponse);
          bot.sendChatAction(chatId, "typing");
        },
        4000,
        { leading: true, trailing: false }
      ),
    });
    editMessage(respMsg, lastResponse.response);
    logWithTime("📨 Response:", lastResponse);
  } catch (err) {
    logWithTime("⛔️ ChatGPT API error:", err.message);
    // If the error contains session token has expired, then get a new session token
    if (err.message.includes("session token may have expired")) {
      bot.sendMessage(chatId, "🔑 Token has expired, please update the token.");
    } else {
      bot.sendMessage(
        chatId,
        "🤖 Sorry, I'm having trouble connecting to the server, please try again later."
      );
    }
  }
}

// Edit telegram message
async function editMessage(
  msg: TelegramBot.Message,
  text: string,
  needParse = true
): Promise<TelegramBot.Message> {
  if (msg.text === text) {
    return msg;
  }
  try {
    const resp = await bot.editMessageText(text, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      parse_mode: needParse ? "Markdown" : undefined,
    });
    // type of resp is boolean | Message
    if (typeof resp === "object") {
      // return a Message type instance if resp is a Message type
      return resp as TelegramBot.Message;
    } else {
      // return the original message if resp is a boolean type
      return msg;
    }
  } catch (err) {
    logWithTime("⛔️ Edit message error:", err.message);
    return msg;
  }
}

// deno-lint-ignore no-explicit-any
function logWithTime(...args: any[]) {
  console.log(new Date().toLocaleString(), ...args);
}
