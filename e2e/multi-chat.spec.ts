import { test, expect, type Page } from "@playwright/test";

// Multi-chat is entirely client-side (localStorage). These smoke tests drive
// the real page + conversation store; /api/chat is mocked so no live keys are
// needed. Seeding is done via addInitScript so the store is populated before
// the page's mount effect reads it.

type Part = { type: "text"; text: string };
type Msg = { id: string; role: "user" | "assistant"; parts: Part[] };

function msg(id: string, role: "user" | "assistant", text: string): Msg {
  return { id, role, parts: [{ type: "text", text }] };
}

interface SeedConvo {
  id: string;
  title: string | null;
  updatedAt: string;
  messages: Msg[];
}

async function seed(page: Page, convos: SeedConvo[]) {
  const index = convos.map((c, i) => ({
    id: c.id,
    title: c.title,
    createdAt: `2020-01-01T00:00:0${i}.000Z`,
    updatedAt: c.updatedAt,
  }));
  const messagesById: Record<string, Msg[]> = {};
  for (const c of convos) messagesById[c.id] = c.messages;

  await page.addInitScript(
    (data: { index: unknown[]; messagesById: Record<string, unknown> }) => {
      localStorage.setItem("idmr-conversations", JSON.stringify(data.index));
      for (const id of Object.keys(data.messagesById)) {
        localStorage.setItem(
          "idmr-messages:" + id,
          JSON.stringify(data.messagesById[id])
        );
      }
    },
    { index, messagesById }
  );
}

// Faithful mock of the AI SDK UI message stream (captured from the real route,
// including the required x-vercel-ai-ui-message-stream header).
async function mockChat(page: Page, reply: string) {
  await page.route("**/api/chat", async (route) => {
    const events = [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", delta: reply },
      { type: "text-end", id: "0" },
      { type: "finish-step" },
      { type: "finish", finishReason: "stop" },
    ];
    const body =
      events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
      "data: [DONE]\n\n";
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
        "cache-control": "no-cache",
      },
      body,
    });
  });
}

const items = (page: Page) => page.getByTestId("conversation-item");
const titles = (page: Page) => page.getByTestId("conversation-title");
const messages = (page: Page) => page.getByTestId("message");

test("fresh load shows the empty state and one new conversation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Ask about IDMR transcripts or the textbook")
  ).toBeVisible();
  await expect(items(page)).toHaveCount(1);
  await expect(titles(page)).toHaveText("New chat");
});

test("seeded conversations load and the most recent is active", async ({
  page,
}) => {
  await seed(page, [
    {
      id: "a",
      title: "Heart question",
      updatedAt: "2020-02-02T00:00:00.000Z",
      messages: [msg("m1", "user", "ALPHA BODY"), msg("m2", "assistant", "ok")],
    },
    {
      id: "b",
      title: "666 teaching",
      updatedAt: "2020-01-01T00:00:00.000Z",
      messages: [msg("m3", "user", "BETA BODY")],
    },
  ]);
  await page.goto("/");
  await expect(items(page)).toHaveCount(2);
  // Most recently updated (a) is active and its messages render.
  await expect(page.getByText("ALPHA BODY")).toBeVisible();
  await expect(messages(page)).toHaveCount(2);
});

test("switching conversations loads the correct messages", async ({ page }) => {
  await seed(page, [
    {
      id: "a",
      title: "Alpha",
      updatedAt: "2020-02-02T00:00:00.000Z",
      messages: [msg("m1", "user", "ALPHA BODY")],
    },
    {
      id: "b",
      title: "Beta",
      updatedAt: "2020-01-01T00:00:00.000Z",
      messages: [msg("m2", "user", "BETA BODY")],
    },
  ]);
  await page.goto("/");
  await expect(page.getByText("ALPHA BODY")).toBeVisible();

  await titles(page).filter({ hasText: "Beta" }).click();
  await expect(page.getByText("BETA BODY")).toBeVisible();
  await expect(page.getByText("ALPHA BODY")).toBeHidden();
});

test("deleting a conversation removes it and keeps the others", async ({
  page,
}) => {
  await seed(page, [
    {
      id: "a",
      title: "KeepMe",
      updatedAt: "2020-02-02T00:00:00.000Z",
      messages: [msg("m1", "user", "x")],
    },
    {
      id: "b",
      title: "DeleteMe",
      updatedAt: "2020-01-01T00:00:00.000Z",
      messages: [msg("m2", "user", "y")],
    },
  ]);
  await page.goto("/");
  const target = items(page).filter({ hasText: "DeleteMe" });
  await target.hover();
  await target.getByRole("button", { name: "Delete conversation" }).click();

  await expect(titles(page).filter({ hasText: "DeleteMe" })).toHaveCount(0);
  await expect(titles(page).filter({ hasText: "KeepMe" })).toBeVisible();
});

test("New chat adds a fresh conversation when the current one has messages", async ({
  page,
}) => {
  await seed(page, [
    {
      id: "a",
      title: "Existing",
      updatedAt: "2020-02-02T00:00:00.000Z",
      messages: [msg("m1", "user", "hello there")],
    },
  ]);
  await page.goto("/");
  await expect(page.getByText("hello there")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(
    page.getByText("Ask about IDMR transcripts or the textbook")
  ).toBeVisible();
  await expect(items(page)).toHaveCount(2);
});

test("legacy single-conversation is imported on first load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "idmr-chat-messages",
      JSON.stringify([
        {
          id: "old1",
          role: "user",
          parts: [{ type: "text", text: "old conversation from before multi chat" }],
        },
        { id: "old2", role: "assistant", parts: [{ type: "text", text: "a reply" }] },
      ])
    );
  });
  await page.goto("/");

  await expect(items(page)).toHaveCount(1);
  await expect(titles(page)).toContainText("old conversation from before");
  await expect(
    messages(page).filter({ hasText: "old conversation from before multi chat" })
  ).toBeVisible();
  await expect(messages(page).filter({ hasText: "a reply" })).toBeVisible();

  // Legacy key is cleared so the import runs only once.
  const legacy = await page.evaluate(() =>
    localStorage.getItem("idmr-chat-messages")
  );
  expect(legacy).toBeNull();
});

test("sending a message titles the conversation and persists across reload", async ({
  page,
}) => {
  await mockChat(page, "Mocked reply.");
  await page.goto("/");

  await page
    .getByPlaceholder("Ask about IDMR teachings...")
    .fill("What is the carnal mind exactly here");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("What is the carnal mind exactly here")).toBeVisible();
  await expect(page.getByText("Mocked reply.")).toBeVisible();
  // Title derives from the first user message (first 6 words + ellipsis).
  await expect(titles(page)).toHaveText("What is the carnal mind exactly…");

  await page.reload();
  await expect(page.getByText("What is the carnal mind exactly here")).toBeVisible();
  await expect(page.getByText("Mocked reply.")).toBeVisible();
});
