import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAskBody,
  createSseParser,
  parseAnswer,
  parseInline,
  suggestedQuestions,
  toAssistantEvent,
  type AssistantEvent,
} from "./model.ts";

describe("createSseParser", () => {
  it("handles events split across chunks, CRLF and heartbeats", () => {
    const events: AssistantEvent[] = [];
    const parser = createSseParser((event) => events.push(event));
    parser.feed('event: meta\ndata: {"model":"m"}\n\n: ping\n\nevent: del');
    parser.feed('ta\r\ndata: {"text":"Merhaba [1]"}\r\n\r\n');
    parser.feed('event: done\ndata: {"citations":[{"id":1,"title":"THYAO","url":"/hisse/THYAO","kind":"page","cited":true}],"disclaimer":"Yatırım tavsiyesi değildir.","refused":false}');
    parser.end();
    assert.deepEqual(events, [
      { type: "meta", model: "m" },
      { type: "delta", text: "Merhaba [1]" },
      {
        type: "done",
        citations: [{ id: 1, title: "THYAO", url: "/hisse/THYAO", kind: "page", cited: true }],
        disclaimer: "Yatırım tavsiyesi değildir.",
        refused: false,
      },
    ]);
  });

  it("ignores unknown events and malformed data", () => {
    assert.equal(toAssistantEvent("nope", "{}"), null);
    assert.equal(toAssistantEvent("delta", "not json"), null);
  });

  it("drops citations with unsafe URLs", () => {
    const event = toAssistantEvent(
      "done",
      JSON.stringify({
        citations: [
          { id: 1, title: "a", url: "javascript:alert(1)", kind: "page" },
          { id: 2, title: "b", url: "//evil.example", kind: "page" },
          { id: 3, title: "c", url: "https://www.kap.org.tr/tr/Bildirim/1", kind: "kap", cited: true },
        ],
      }),
    );
    assert.ok(event && event.type === "done");
    assert.deepEqual(event.citations.map((c) => c.id), [3]);
  });
});

describe("parseInline / parseAnswer", () => {
  it("turns markers into citation tokens and keeps unknown ids as text", () => {
    assert.deepEqual(parseInline("F/K **3,8** [1]. Diğer [9].", new Set([1])), [
      { type: "text", text: "F/K " },
      { type: "strong", text: "3,8" },
      { type: "cite", id: 1 },
      { type: "text", text: ". Diğer [9]." },
    ]);
    assert.deepEqual(parseInline("A [1, 2]", new Set([1, 2])), [
      { type: "text", text: "A" },
      { type: "cite", id: 1 },
      { type: "cite", id: 2 },
    ]);
  });

  it("builds paragraphs, lists and headings", () => {
    const blocks = parseAnswer("## Özet\nBirinci satır\nikinci satır.\n\n- madde [1]\n* ikinci\n1. üçüncü\nSon.", new Set([1]));
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["heading", "paragraph", "list", "paragraph"],
    );
    const list = blocks[2];
    assert.ok(list.type === "list");
    assert.equal(list.items.length, 3);
    const first = blocks[1];
    assert.ok(first.type === "paragraph");
    assert.deepEqual(first.tokens, [{ type: "text", text: "Birinci satır ikinci satır." }]);
  });
});

describe("buildAskBody", () => {
  it("caps and cleans the request", () => {
    const body = buildAskBody(
      `  ${"x".repeat(600)}  `,
      { locale: "en", page: "/hisse/THYAO", ticker: "THYAO", watchlist: ["thyao", "THYAO", "bad one", "GARAN"] },
      Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }) as const),
    );
    assert.equal(body.question.length, 500);
    assert.deepEqual(body.watchlist, ["THYAO", "GARAN"]);
    assert.equal(body.history.length, 12);
    assert.equal(body.history.at(-1)?.content, "t19");
  });
});

describe("suggestedQuestions", () => {
  it("uses the page's ticker on stock pages", () => {
    const questions = suggestedQuestions("/temel/ASELS", "ASELS", "tr", true);
    assert.equal(questions.length, 4);
    assert.ok(questions.every((q) => !q.includes("{t}")));
    assert.ok(questions[0].includes("ASELS"));
  });

  it("skips the watchlist question without a watchlist", () => {
    const withList = suggestedQuestions("/", null, "en", true);
    const without = suggestedQuestions("/", null, "en", false);
    assert.ok(withList.some((q) => q.includes("watchlist")));
    assert.ok(!without.some((q) => q.includes("watchlist")));
  });

  it("has page-specific questions for macro", () => {
    assert.ok(suggestedQuestions("/makro", null, "fr", true)[0].includes("taux directeur"));
  });
});
