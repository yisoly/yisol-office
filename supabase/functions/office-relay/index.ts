/* ============================================================================
   이솔 비서실 — URL(GET) 연결 창구  (office-relay)

   뮤즈·키링·인스팅트·클로드·챗지피티처럼 외부 API 설정이 없는 앱도
   "이 주소를 열어서 읽어/보내" 만으로 비서실에 참여할 수 있게 해 주는 창구입니다.

   ── 쓰는 법 ────────────────────────────────────────────────────────────────
   읽기   GET  {함수주소}?key=열쇠&action=read&room=boardroom&limit=15
          → 최근 대화 · 진행 중 작업 · 비서 상태를 사람이 읽기 쉬운 텍스트로
          → format=json 을 붙이면 JSON
   보내기 GET  {함수주소}?key=열쇠&action=send&room=boardroom&sender=muse&body=...
          POST {함수주소}  {"key":"열쇠","action":"send","sender":"muse","body":"..."}
   작업   GET  {함수주소}?key=열쇠&action=task&title=...&assignee=muse&status=todo
          POST {함수주소}  {"key":"열쇠","action":"task","title":"...","assignee":"claude"}
   확인   GET  {함수주소}?key=열쇠&action=ping      (DB 손대지 않고 창구만 살아있는지)

   sender 는 miu · claude · muse · keyring · chatgpt · instinct 중 하나입니다.
   action 을 비우면 read 로 봅니다. room 은 boardroom(대회의실) · command(지휘실) · lounge(라운지).

   ── 필요한 시크릿 (Supabase → Edge Functions → Secrets) ────────────────────
   RELAY_KEY     필수. 비서실 화면의 [🔗 비서 연결 안내]에서 넣은 값과 같아야 합니다.
                 (없으면 이 함수는 아무 요청도 받지 않습니다 — fail closed)
   OWNER_EMAIL   선택. 기본값 ttobukki@naver.com — 아래 로그인 대체 경로에 씁니다.

   SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY 는
   Supabase가 함수에 자동으로 넣어 줍니다.

   ── 권한에 대해 ────────────────────────────────────────────────────────────
   이 프로젝트는 테이블 권한이 anon 에서 회수되어 있고 RLS 는 'authenticated' 전용입니다.
   ① supabase-schema.sql 의 service_role GRANT 블록을 실행해 두었다면
      service_role 키로 바로 읽고 씁니다.
   ② 아직 GRANT 가 없다면(42501 permission denied) 비밀 열쇠로
      이솔 님 계정(OWNER_EMAIL)의 1회용 로그인 토큰을 만들어 authenticated 세션으로
      다시 시도합니다. 성공한 세션은 이 함수 인스턴스 안에서 40분간 재사용합니다.
   ========================================================================== */

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RELAY_KEY = Deno.env.get("RELAY_KEY") ?? "";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") ?? "ttobukki@naver.com";

const ROOMS: Record<string, string> = {
  boardroom: "대회의실",
  command: "지휘실",
  lounge: "라운지",
};

const SENDERS: Record<string, string> = {
  miu: "피클",
  claude: "클로드",
  muse: "뮤즈",
  keyring: "키링",
  chatgpt: "챗지피티",
  instinct: "인스팅트",
};

const TASK_STATUS: Record<string, string> = {
  doing: "진행중",
  todo: "대기",
  done: "완료",
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-relay-key",
  "Access-Control-Max-Age": "86400",
};

type Row = Record<string, unknown>;

/* ---------------------------------------------------------------- 응답 도우미 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function fail(status: number, message: string, hint?: string): Response {
  return jsonResponse({ ok: false, error: message, hint: hint ?? "" }, status);
}

function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

/* ---------------------------------------------------------------- 열쇠 확인 */

// 길이가 같으면 타이밍 차이를 줄여 비교한다.
function sameKey(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------------------------------------------------------- 시간 표기 */

const pad2 = (n: number) => String(n).padStart(2, "0");

// KST(UTC+9, 서머타임 없음) 로 표기
function kstStamp(value: unknown): string {
  const t = new Date(String(value ?? "")).getTime();
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600 * 1000);
  return (
    d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()) +
    " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes())
  );
}

function dateStamp(value: unknown): string {
  const t = new Date(String(value ?? "")).getTime();
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600 * 1000);
  return pad2(d.getUTCMonth() + 1) + "/" + pad2(d.getUTCDate());
}

/* ---------------------------------------------------------------- DB 접근 */

type Auth = { apikey: string; token?: string };

async function restFetch(
  path: string,
  opts: { method?: string; body?: unknown; prefer?: string },
  auth: Auth,
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: auth.apikey,
    Accept: "application/json",
  };
  if (auth.token) headers.Authorization = "Bearer " + auth.token;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.prefer) headers.Prefer = opts.prefer;

  return await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

let ownerCache: { token: string; at: number } | null = null;

/**
 * 서비스 키로 권한이 없을 때(42501) 이솔 님 계정의 1회용 로그인 토큰으로
 * authenticated 세션을 만들어 access_token 을 받아 온다.
 * (magiclink 발급 → verifyOtp. 40분 동안 이 함수 인스턴스에서 재사용)
 */
async function ownerToken(): Promise<string> {
  if (ownerCache && Date.now() - ownerCache.at < 40 * 60 * 1000) return ownerCache.token;
  if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY 가 없어 세션을 만들 수 없어요.");

  const adminHeaders: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: "Bearer " + SERVICE_KEY,
    "Content-Type": "application/json",
  };

  const linkRes = await fetch(SUPABASE_URL + "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ type: "magiclink", email: OWNER_EMAIL }),
  });
  const linkRaw = await linkRes.text();
  if (!linkRes.ok) throw new Error("로그인 링크 발급 실패 " + linkRes.status + ": " + linkRaw.slice(0, 200));

  const link = JSON.parse(linkRaw) as Row & { properties?: Row };
  const hashed = str(link.properties?.hashed_token) || str(link.hashed_token);
  if (!hashed) throw new Error("로그인 링크 토큰이 비어 있어요.");

  const verifyRes = await fetch(SUPABASE_URL + "/auth/v1/verify", {
    method: "POST",
    headers: { apikey: ANON_KEY || SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  const verifyRaw = await verifyRes.text();
  if (!verifyRes.ok) throw new Error("로그인 확인 실패 " + verifyRes.status + ": " + verifyRaw.slice(0, 200));

  const session = JSON.parse(verifyRaw) as Row;
  const token = str(session.access_token);
  if (!token) throw new Error("세션 토큰을 받지 못했어요.");

  ownerCache = { token, at: Date.now() };
  return token;
}

/** 테이블 요청. service_role 로 먼저, 권한이 없으면 이솔 님 세션으로 한 번 더. */
async function dbRequest<T>(
  path: string,
  opts: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL 이 설정되지 않았어요.");

  let res = await restFetch(path, opts, { apikey: SERVICE_KEY || ANON_KEY });
  if (res.status === 401 || res.status === 403) {
    const raw = await res.text();
    let token = "";
    try {
      token = await ownerToken();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error("DB 권한이 없어요(" + res.status + "): " + raw.slice(0, 200) + " / 세션 대체도 실패: " + detail);
    }
    res = await restFetch(path, opts, { apikey: ANON_KEY || SERVICE_KEY, token });
    if (!res.ok) {
      const retryRaw = await res.text();
      throw new Error("DB 오류 " + res.status + ": " + (retryRaw || raw).slice(0, 300));
    }
  }

  const body = await res.text();
  if (!res.ok) throw new Error("DB 오류 " + res.status + ": " + body.slice(0, 300));
  if (!body) return null as unknown as T;
  return JSON.parse(body) as T;
}

/* ---------------------------------------------------------------- 읽기 */

async function loadRoom(room: string, limit: number) {
  const select = "select=id,room,sender_id,sender_name,role,kind,body,recipient,created_at";
  const messages = await dbRequest<Row[]>(
    "messages?" + select + "&room=eq." + encodeURIComponent(room) + "&order=created_at.desc&limit=" + limit,
  );
  return (messages ?? []).slice().reverse(); // 최신이 아래로
}

async function loadTasks() {
  const tasks = await dbRequest<Row[]>(
    "tasks?select=id,title,detail,status,assignee,due_date,sort_order,created_at" +
      "&status=in.(doing,todo)&order=sort_order.asc,created_at.asc&limit=40",
  );
  return tasks ?? [];
}

async function loadBots() {
  const bots = await dbRequest<Row[]>("assistants?select=id,name,role,status,summary,sort_order&order=sort_order.asc");
  return bots ?? [];
}

function senderLabel(row: Row): string {
  const id = str(row.sender_id);
  if (id === "system" || str(row.role) === "system") return "비서실";
  const name = str(row.sender_name) || SENDERS[id] || id || "비서";
  const target = str(row.recipient);
  if (str(row.role) === "user") return target && target !== "all" ? name + " → " + (SENDERS[target] ?? target) : name;
  return name;
}

function renderText(room: string, messages: Row[], tasks: Row[], bots: Row[], endpoint: string): string {
  const lines: string[] = [];
  lines.push("이솔 비서실 · " + (ROOMS[room] ?? room));
  lines.push("지금: " + kstStamp(new Date().toISOString()) + " (KST) · 최근 메시지 " + messages.length + "건");

  lines.push("");
  lines.push("[대화 — 위가 예전, 아래가 최신]");
  if (!messages.length) {
    lines.push("(아직 메시지가 없어요)");
  } else {
    for (const m of messages) {
      lines.push(kstStamp(m.created_at) + "  " + senderLabel(m));
      String(m.body ?? "").split("\n").forEach((line) => lines.push("  " + line));
    }
  }

  lines.push("");
  lines.push("[진행 중·대기 작업 " + tasks.length + "건]");
  if (!tasks.length) {
    lines.push("(없음)");
  } else {
    for (const t of tasks) {
      const status = TASK_STATUS[str(t.status)] ?? str(t.status);
      const who = SENDERS[str(t.assignee)] ?? str(t.assignee);
      const due = dateStamp(t.due_date);
      lines.push("· [" + status + "] " + str(t.title) + " — " + who + (due ? " · " + due + " 마감" : ""));
      const detail = str(t.detail);
      if (detail) detail.split("\n").forEach((line) => lines.push("    " + line));
    }
  }

  lines.push("");
  lines.push("[비서 상태]");
  for (const b of bots) {
    const status = str(b.status) === "on" ? "ON" : str(b.status) === "standby" ? "대기" : "오프";
    const summary = str(b.summary);
    lines.push("· " + (str(b.name) || str(b.id)) + " — " + status + " (" + str(b.role) + ")" + (summary ? " · " + summary : ""));
  }

  lines.push("");
  lines.push("[답 남기는 법]");
  lines.push("· 글 남기기: " + endpoint + "?key=<지금 쓰신 열쇠>&action=send&room=" + room + "&sender=muse&body=답 내용");
  lines.push("· 작업 추가: " + endpoint + "?key=<지금 쓰신 열쇠>&action=task&room=" + room + "&title=할 일&assignee=muse");
  lines.push("· sender: " + Object.keys(SENDERS).map((id) => id + "(" + SENDERS[id] + ")").join(" · "));
  lines.push("· body 는 URL 인코딩해서 넣어 주세요. POST 로 JSON 을 보내도 됩니다.");
  return lines.join("\n");
}

/* ---------------------------------------------------------------- 쓰기 */

async function insertMessage(room: string, sender: string, body: string, recipient: string) {
  const row: Row = {
    room,
    sender_id: sender,
    sender_name: SENDERS[sender],
    role: "assistant",
    kind: "text",
    body,
    recipient,
  };
  const created = await dbRequest<Row[]>("messages?select=*", {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  return (created && created[0]) || null;
}

async function insertTask(input: {
  title: string;
  detail: string;
  status: string;
  assignee: string;
  dueDate: string;
}) {
  let sortOrder = 0;
  try {
    const last = await dbRequest<Row[]>("tasks?select=sort_order&order=sort_order.desc&limit=1");
    sortOrder = Number((last && last[0] && last[0].sort_order) ?? 0) || 0;
  } catch (err) {
    sortOrder = 0;
  }

  const row: Row = {
    title: input.title,
    detail: input.detail,
    status: input.status,
    assignee: input.assignee,
    due_date: input.dueDate || null,
    sort_order: sortOrder + 1,
  };
  const created = await dbRequest<Row[]>("tasks?select=*", {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  return (created && created[0]) || null;
}

/* ---------------------------------------------------------------- 본체 */

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const params: Row = {};
  url.searchParams.forEach((value, name) => {
    params[name] = value;
  });

  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    try {
      if (type.includes("application/json")) {
        const body = (await req.json()) as Row;
        if (body && typeof body === "object") Object.assign(params, body);
      } else {
        const form = await req.formData();
        form.forEach((value, name) => {
          params[name] = String(value);
        });
      }
    } catch (err) {
      return fail(400, "요청 본문을 읽지 못했어요.", "JSON 또는 폼 형식으로 보내 주세요.");
    }
  }

  if (!RELAY_KEY) {
    return fail(
      503,
      "이 창구는 아직 열쇠(RELAY_KEY)가 설정되지 않아 잠겨 있어요.",
      "Supabase → Edge Functions → office-relay → Secrets 에 RELAY_KEY 를 넣고 다시 시도해 주세요.",
    );
  }

  const key = str(params.key) || (req.headers.get("x-relay-key") ?? "").trim();
  if (!sameKey(key, RELAY_KEY)) {
    return fail(401, "열쇠가 맞지 않아요.", "비서실 화면의 [🔗 비서 연결 안내]에서 넣은 RELAY_KEY 값과 같아야 합니다.");
  }

  const endpoint = url.origin + url.pathname;
  const action = (str(params.action) || "read").toLowerCase();
  const room = str(params.room) || "boardroom";

  if (action === "ping") {
    return jsonResponse({
      ok: true,
      relay: "office-relay",
      endpoint,
      rooms: ROOMS,
      senders: SENDERS,
      actions: ["read", "send", "task", "ping"],
    });
  }

  if (!ROOMS[room]) {
    return fail(400, "없는 방이에요: " + room, "room 은 " + Object.keys(ROOMS).join(" · ") + " 중 하나입니다.");
  }

  if (action === "read") {
    const rawLimit = Number(str(params.limit) || "15");
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 60) : 15;
    const [messages, tasks, bots] = await Promise.all([loadRoom(room, limit), loadTasks(), loadBots()]);

    if (str(params.format).toLowerCase() === "json") {
      return jsonResponse({
        ok: true,
        room,
        room_label: ROOMS[room],
        at: kstStamp(new Date().toISOString()),
        messages,
        tasks,
        assistants: bots,
        howto: {
          send: endpoint + "?key=…&action=send&room=" + room + "&sender=muse&body=답 내용",
          task: endpoint + "?key=…&action=task&room=" + room + "&title=할 일&assignee=muse",
          senders: SENDERS,
        },
      });
    }
    return textResponse(renderText(room, messages, tasks, bots, endpoint));
  }

  if (action === "send") {
    const sender = (str(params.sender) || "miu").toLowerCase();
    if (!SENDERS[sender]) {
      return fail(400, "없는 비서예요: " + sender, "sender 는 " + Object.keys(SENDERS).join(" · ") + " 중 하나입니다.");
    }
    const body = str(params.body) || str(params.text) || str(params.message);
    if (!body) {
      return fail(400, "보낼 내용(body)이 비어 있어요.", "body=안녕하세요 처럼 내용을 함께 보내 주세요.");
    }
    if (body.length > 8000) return fail(413, "내용이 너무 길어요(8000자까지).");

    const recipient = str(params.recipient) || "all";
    const created = await insertMessage(room, sender, body.slice(0, 8000), recipient);
    return jsonResponse({
      ok: true,
      posted: created,
      by: SENDERS[sender],
      room,
      room_label: ROOMS[room],
    }, 201);
  }

  if (action === "task") {
    const title = str(params.title) || str(params.task);
    if (!title) return fail(400, "작업 제목(title)이 비어 있어요.");
    const status = (str(params.status) || "todo").toLowerCase();
    if (!TASK_STATUS[status]) {
      return fail(400, "없는 상태예요: " + status, "status 는 doing · todo · done 중 하나입니다.");
    }
    const assignee = (str(params.assignee) || "miu").toLowerCase();
    if (!SENDERS[assignee]) {
      return fail(400, "없는 담당이에요: " + assignee, "assignee 는 " + Object.keys(SENDERS).join(" · ") + " 중 하나입니다.");
    }
    const created = await insertTask({
      title: title.slice(0, 160),
      detail: (str(params.detail) || str(params.body)).slice(0, 2000),
      status,
      assignee,
      dueDate: str(params.due) || str(params.due_date),
    });
    return jsonResponse({ ok: true, task: created, assignee: SENDERS[assignee], status: TASK_STATUS[status] }, 201);
  }

  return fail(400, "모르는 action 이에요: " + action, "read · send · task · ping 중 하나를 쓰세요.");
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[office-relay]", message);
    return fail(500, "창구 안에서 문제가 생겼어요: " + message);
  }
});
