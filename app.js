/* ==========================================================================
   이솔 비서실 — app.js
   정적 파일만으로 동작하는 프론트엔드.
   · config.js에 Supabase 키가 있으면 로그인(이메일+비밀번호) 후 REST + Realtime 동기화
   · 키가 없으면 localStorage 데모 모드 (로그인 화면 없이 화면 기능은 동일)
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------------- 설정 */

  const CFG = Object.assign(
    {
      APP_TITLE: "이솔 비서실",
      OWNER_NAME: "이솔",
      OWNER_LABEL: "이솔님 전용",
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: ""
    },
    window.APP_CONFIG || {}
  );

  const ROOMS = [
    {
      id: "boardroom",
      icon: "🏛️",
      name: "대회의실",
      desc: "여섯 비서가 모두 모이는 자리",
      members: ["miu", "claude", "muse", "keyring", "chatgpt", "instinct"]
    },
    {
      id: "command",
      icon: "🎯",
      name: "지휘실",
      desc: "지시와 보고 — 실행이 바로 붙는 방",
      members: ["miu", "claude"]
    },
    {
      id: "lounge",
      icon: "🛋️",
      name: "라운지",
      desc: "가볍게 이야기하는 방",
      members: ["miu", "muse", "keyring", "chatgpt", "instinct"]
    }
  ];

  const TASK_COLUMNS = [
    { key: "doing", label: "진행중", empty: "지금 도는 일이 없어요." },
    { key: "todo", label: "대기", empty: "기다리는 일이 없어요." },
    { key: "done", label: "완료", empty: "아직 완료된 일이 없어요." }
  ];

  const STATE_LABEL = { on: "ON", standby: "대기", off: "오프" };

  /* 비서별 아바타 사진과, 사진이 안 뜰 때의 이모지 폴백 */
  const AVATAR_EMOJI = {
    miu: "🐈‍⬛",
    claude: "✦",
    muse: "🎧",
    keyring: "🔑",
    chatgpt: "💬",
    instinct: "⚡"
  };

  const ASSISTANT_SEED = [
    {
      id: "miu",
      name: "피클",
      role: "메인비서",
      avatar: "assets/avatars/miu.jpg",
      accent: "#7B4B24",
      status: "on",
      areas: ["일정·브리핑", "쿠팡·쇼핑", "전화·예약", "기억과 기록"],
      summary: "쿠팡 특가 3선 정리해서 대회의실에 보고",
      sort_order: 1
    },
    {
      id: "claude",
      name: "클로드",
      role: "맥 실무비서 · ai-office",
      avatar: "assets/avatars/claude.jpg",
      accent: "#C96442",
      status: "on",
      areas: ["회계·급여", "문서·계약", "인사"],
      summary: "11월 급여대장 최종 검토 완료 · 발송 대기",
      sort_order: 2
    },
    {
      id: "muse",
      name: "뮤즈",
      role: "서브비서",
      avatar: "assets/avatars/muse.jpg",
      accent: "#7A6BB5",
      status: "on",
      areas: ["블로그·콘텐츠", "리서치", "체험단"],
      summary: "20시 정보 포스팅 초안 작성 중",
      sort_order: 3
    },
    {
      id: "keyring",
      name: "키링",
      role: "서브비서",
      avatar: "assets/avatars/keyring.jpg",
      accent: "#3E8E7E",
      status: "on",
      areas: ["배송·구매", "생활 리마인드", "기록 정리"],
      summary: "이번 주 도착 예정 배송 3건 정리",
      sort_order: 4
    },
    {
      id: "chatgpt",
      name: "챗지피티",
      role: "서브비서",
      avatar: "assets/avatars/chatgpt.jpg",
      accent: "#10A37F",
      status: "on",
      areas: ["자료 조사", "초안 작성", "아이디어"],
      summary: "연말정산 바뀐 항목 조사 중",
      sort_order: 5
    },
    {
      id: "instinct",
      name: "인스팅트",
      role: "서브비서 · 교본 보관",
      avatar: "assets/avatars/instinct-v2.jpg",
      accent: "#B8860B",
      status: "on",
      areas: ["교본·자료 정리", "지식 베이스", "아이디어"],
      summary: "냥리빙 운영 교본 최신본으로 정리 중",
      sort_order: 6
    }
  ];

  const LS_KEY = "yisol-office.v1";
  const TABS = ["meeting", "tasks", "team", "memos"];
  // publishable(sb_publishable_…) 키를 정식으로 인식하는 버전으로 고정
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js";

  /* ---------------------------------------------------------------- 상태 */

  const db = { messages: [], tasks: [], assistants: [], memos: [] };

  const state = {
    tab: "meeting",
    room: "boardroom",
    recipient: "all",
    taskFilter: "all",
    taskAssignee: "all",
    conn: "demo", // demo | connecting | live | error | auth
    auth: "off", // off(데모/인증 미설정) | checking | out | in
    userEmail: "",
    stick: true,
    sending: false,
    memoTarget: null,
    taskTarget: null,
    guideSender: "claude",
    ready: false
  };

  let client = null;
  let channel = null;
  let toastTimer = null;
  let sdkPromise = null;
  let connectAborted = false;

  /* ---------------------------------------------------------------- 유틸 */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function formatBody(text) {
    const safe = esc(text);
    return safe.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>";
    });
  }

  function uid(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return (prefix || "id") + "_" + Date.now().toString(36) + rand;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isoAgo(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
  }

  function isoInDays(days) {
    return new Date(Date.now() + days * 86400000).toISOString();
  }

  function dateInDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    let h = d.getHours();
    const ap = h < 12 ? "오전" : "오후";
    h = h % 12 || 12;
    return ap + " " + h + ":" + pad2(d.getMinutes());
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dayKey(iso) {
    const d = new Date(iso);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmtDayLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const wd = "일월화수목금토"[d.getDay()];
    const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
    const md = d.getMonth() + 1 + "월 " + d.getDate() + "일 (" + wd + ")";
    if (diff === 0) return "오늘 · " + md;
    if (diff === 1) return "어제 · " + md;
    if (diff === -1) return "내일 · " + md;
    return d.getFullYear() + "년 " + md;
  }

  function fmtRelative(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 0) return "곧";
    if (mins < 1) return "방금 전";
    if (mins < 60) return mins + "분 전";
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + "시간 전";
    const days = Math.round(hours / 24);
    if (days === 1) return "어제";
    if (days < 7) return days + "일 전";
    const d = new Date(iso);
    return d.getMonth() + 1 + "/" + d.getDate();
  }

  function fmtDateShort(value) {
    if (!value) return "";
    const raw = String(value);
    const d = new Date(raw.length <= 10 ? raw + "T00:00:00" : raw);
    if (isNaN(d.getTime())) return raw;
    return d.getMonth() + 1 + "/" + d.getDate();
  }

  function fmtDue(value) {
    if (!value) return { text: "", cls: "" };
    const raw = String(value);
    const d = new Date(raw.length <= 10 ? raw + "T00:00:00" : raw);
    if (isNaN(d.getTime())) return { text: raw, cls: "" };
    const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
    if (diff === 0) return { text: "오늘 마감", cls: "is-today" };
    if (diff === 1) return { text: "내일 마감", cls: "" };
    if (diff === -1) return { text: "어제 마감", cls: "is-over" };
    if (diff < 0) return { text: -diff + "일 지남", cls: "is-over" };
    return { text: d.getMonth() + 1 + "/" + d.getDate() + " 마감", cls: "" };
  }

  function roomById(id) {
    return ROOMS.find((r) => r.id === id) || ROOMS[0];
  }

  function assistantById(id) {
    return (
      db.assistants.find((a) => a.id === id) || {
        id: id,
        name: id,
        role: "비서",
        avatar: "🤖",
        accent: "#7B4B24",
        status: "off",
        areas: [],
        summary: ""
      }
    );
  }

  function assistantName(id) {
    if (!id || id === "all") return "전체";
    return assistantById(id).name;
  }

  function isPhotoPath(value) {
    return typeof value === "string" && /^[\w./-]+\.(png|jpe?g|webp|gif|svg)$/i.test(value.trim());
  }

  function avatarFallback(a) {
    if (!a) return "🤖";
    if (AVATAR_EMOJI[a.id]) return AVATAR_EMOJI[a.id];
    return isPhotoPath(a.avatar) ? "🤖" : a.avatar || "🤖";
  }

  // 사진이 있으면 둥근 사진으로, 없거나 로드에 실패하면 이모지로 보여준다.
  function avatarMarkup(a, cls) {
    const photo = isPhotoPath(a.avatar) ? a.avatar.trim() : "";
    const style = ' style="--accent:' + esc(a.accent || "#7B4B24") + '"';
    if (!photo) return '<div class="' + cls + '"' + style + ' aria-hidden="true">' + esc(avatarFallback(a)) + "</div>";
    return (
      '<div class="' + cls + ' has-photo"' + style + ' aria-hidden="true">' +
      '<img src="' + esc(photo) + '" alt="" loading="lazy" decoding="async" ' +
      'onerror="this.parentNode.classList.add(&#39;is-fallback&#39;);this.remove();">' +
      '<span class="avatar-emoji">' + esc(avatarFallback(a)) + "</span></div>"
    );
  }

  // 칩·카드 안에 들어가는 작은 아바타
  function chipAvatar(a) {
    const photo = isPhotoPath(a.avatar) ? a.avatar.trim() : "";
    if (!photo) return '<span class="emoji" aria-hidden="true">' + esc(avatarFallback(a)) + "</span>";
    return (
      '<span class="emoji has-photo" aria-hidden="true">' +
      '<img src="' + esc(photo) + '" alt="" loading="lazy" decoding="async" ' +
      'onerror="this.parentNode.classList.add(&#39;is-fallback&#39;);this.remove();">' +
      '<span class="avatar-emoji">' + esc(avatarFallback(a)) + "</span></span>"
    );
  }

  function sortByTime(list, key) {
    return list.slice().sort((a, b) => new Date(a[key] || 0) - new Date(b[key] || 0));
  }

  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), 2800);
  }

  /* ---------------------------------------------------------------- 데모 시드 */

  function buildSeed() {
    const assistants = ASSISTANT_SEED.map((a, i) =>
      Object.assign({}, a, {
        updated_at: isoAgo(8 + i * 7),
        created_at: isoAgo(60 * 24 * 14)
      })
    );

    const m = (room, sender, minutes, body, extra) =>
      Object.assign(
        {
          id: uid("msg"),
          room: room,
          sender_id: sender,
          sender_name: sender === "user" ? CFG.OWNER_NAME : assistantNameFromSeed(sender),
          role: sender === "user" ? "user" : "assistant",
          kind: "text",
          body: body,
          recipient: "all",
          created_at: isoAgo(minutes)
        },
        extra || {}
      );

    const messages = [
      m("boardroom", "system", 250, "오늘의 대회의실 — 여섯 비서가 모두 들어와 있어요.", { kind: "system", role: "system" }),

      m(
        "boardroom",
        "claude",
        96,
        "11월 급여대장 검토 마쳤습니다.\n퇴사자 정산·4대보험 공제 항목까지 맞춰봤고, 세무사 발송 전 PDF 한 번만 확인해 주세요."
      ),
      m(
        "boardroom",
        "muse",
        84,
        "20시 정보 포스팅 초안 올려뒀어요.\n제목 후보 3개 중 2번으로 잡았습니다 — ‘연말정산 전에 챙겨야 할 카드 혜택’. 태그는 30개 채워뒀어요."
      ),
      m(
        "boardroom",
        "keyring",
        70,
        "이번 주 도착 예정 배송 3건 정리해뒀어요.\n금요일 오전 도착 2건은 문 앞 보관으로 신청돼 있습니다. 하나는 오늘 밤 출고 예정이에요."
      ),
      m(
        "boardroom",
        "chatgpt",
        58,
        "연말정산에서 올해 바뀐 항목만 추려봤어요.\n· 카드 소득공제 한도 조정\n· 월세 세액공제 요건\n정리한 링크는 https://www.nts.go.kr 여기 국세청 자료 기준입니다."
      ),
      m(
        "boardroom",
        "instinct",
        52,
        "냥리빙 운영 교본 최신본으로 정리해 뒀어요.\n" +
          "요일별 루틴·금지 사항·발행 리듬을 한 장으로 묶었고, 이번 주에 바뀐 규칙은 맨 위에 따로 올려놨습니다. 다음엔 비서실 인수인계서까지 합쳐둘게요."
      ),
      m(
        "boardroom",
        "miu",
        40,
        "[쿠팡 특가 3선] 실속 위주로 골랐습니다 (2026-11-26 기준, 마감 임박 포함)\n\n" +
          "1) 거실 수납 바구니 3종 세트\n" +
          "· 쿠팡 골드박스: 12,870원 (정가 27,900원, 53% ↓)\n" +
          "· 타 몰 비교: 네이버 최저 16,900원 → 약 4,030원 저렴\n" +
          "· 특징: 무향·무염색 3겹, 로켓배송 내일 도착\n\n" +
          "2) 욕실 물때 클리너 500ml 2개\n" +
          "· 쿠팡 골드박스: 7,950원 (정가 17,900원, 55% ↓)\n" +
          "· 타 몰 비교: 11번가 8,840원 + 배송비 3,000원 → 쿠팡이 저렴\n" +
          "· 특징: 시트러스 향, 로켓배송 내일 새벽 도착"
      ),
      m(
        "boardroom",
        "user",
        14,
        "건강검진 미수검자 명단은 내일 오전에 정리해줘. 통보 문구도 같이.",
        { recipient: "miu" }
      ),
      m(
        "boardroom",
        "miu",
        12,
        "네, 내일 9시까지 명단과 통보 문구 정리해서 작업실 카드로 올려둘게요 👍"
      ),

      m("command", "system", 240, "지시와 보고만 오가는 방입니다.", { kind: "system", role: "system" }),
      m(
        "command",
        "miu",
        180,
        "오늘 오후 일정 정리했습니다.\n17시까지 인계서류 발송 확인, 18시 급여대장 발송이 남았어요."
      ),
      m("command", "user", 170, "급여대장은 클로드가 최종 검토 중이야.", { recipient: "claude" }),
      m("command", "claude", 158, "검토 끝났습니다. 발송만 남았습니다."),
      m("command", "miu", 150, "제가 18시에 발송하고 결과 여기에 남길게요."),

      m("lounge", "system", 320, "가볍게 이야기하는 방입니다.", { kind: "system", role: "system" }),
      m("lounge", "muse", 300, "라운지 오픈했어요 ☕ 오늘 하루 어땠어요?"),
      m("lounge", "miu", 292, "저는 쿠팡 특가 뒤지는 중이에요. 이솔 님 취향(무난한 색) 위주로 보고 있습니다."),
      m("lounge", "keyring", 280, "저는 배송 알림 정리하다가 하루 다 갔네요 📦"),
      m("lounge", "chatgpt", 270, "저는 연말정산 자료 찾아보는 중이에요. 올해 바뀐 것만 추려둘게요."),
      m("lounge", "instinct", 262, "저는 교본 정리하다가 하루 다 갔어요 ⚡ 다음엔 뭘 한 장으로 묶어둘까요?")
    ];

    const t = (title, detail, status, assignee, dueDays, order) => ({
      id: uid("task"),
      title: title,
      detail: detail,
      status: status,
      assignee: assignee,
      due_date: dueDays === null ? null : dateInDays(dueDays),
      sort_order: order,
      created_at: isoAgo(60 * 24),
      updated_at: isoAgo(30)
    });

    const tasks = [
      t("11월 급여대장 세무사 발송", "검토 완료 · 18시 발송 예정", "doing", "claude", 0, 1),
      t("쿠팡 특가 3선 정리", "실속 위주 3개 · 대회의실 보고 완료", "doing", "miu", 0, 2),
      t("20시 정보 포스팅 임시저장", "제목 3안 중 2번 · 태그 30개", "doing", "muse", 0, 3),
      t("냥리빙 운영 교본 최신본 정리", "요일 루틴·금지 사항을 한 장으로", "doing", "instinct", 0, 4),
      t("건강검진 미수검자 명단·통보 문구", "내일 9시까지 작업실 카드로", "todo", "miu", 1, 5),
      t("평택 스타렉스 인계서류 발송 확인", "발송 확인 후 결과 보고", "todo", "claude", 1, 6),
      t("이번 주 배송 3건 도착 확인", "금요일 오전 문 앞 보관 2건 포함", "todo", "keyring", 2, 7),
      t("연말정산 바뀐 항목 정리", "카드 공제 한도·월세 공제 요건 중심", "todo", "chatgpt", 4, 8),
      t("12월 수영 신규 예약 오픈 알림", "12/1 오전 오픈 · 알림 예약", "todo", "miu", 5, 9),
      t("비서실 인수인계서 교본 합치기", "6인 인수인계서를 교본 1장으로", "todo", "instinct", 6, 10),
      t("근로감독 제출 자료 마무리", "지적 없이 종료", "done", "claude", -3, 11),
      t("연말 데이트룩 포스팅 발행", "룩북 콜라주 썸네일 적용", "done", "muse", -5, 12),
      t("레뷰 신규 체험단 10건 검토", "방문형 3곳 우선", "done", "keyring", -1, 13),
      t("주간 브리핑 템플릿 정리", "아침 브리핑 형식 고정", "done", "miu", -4, 14)
    ];

    const memos = [
      {
        id: uid("memo"),
        title: "비서실 운영 규칙",
        body:
          "· 지시는 회의실에서, 실행은 작업실 카드로.\n" +
          "· 보고는 ‘무엇을 · 언제 · 어디에’ 순서로.\n" +
          "· 돈이 나가거나 사람에게 닿는 일은 이솔 님 확인 후 실행.\n" +
          "· 매일 21시에 내일 일정 정리해서 올리기.",
        pinned: true,
        author: "피클",
        created_at: isoAgo(60 * 24 * 6),
        updated_at: isoAgo(60 * 20)
      },
      {
        id: uid("memo"),
        title: "이번 주 남은 일",
        body:
          "~11/27 인계서류 발송 확인\n" +
          "~11/27 건강검진 미수검자 통보\n" +
          "11/28 레뷰 후기 마감 확인\n" +
          "12/1 수영 신규 예약 오픈\n" +
          "12/5 연말정산 자료 준비",
        pinned: true,
        author: "키링",
        created_at: isoAgo(60 * 30),
        updated_at: isoAgo(75)
      },
      {
        id: uid("memo"),
        title: "블로그 발행 리듬",
        body:
          "08시 패션 / 20시 정보 · 12시간 간격\n" +
          "임시저장까지 대행, 발행은 이솔 님이 직접\n" +
          "태그 30개 · 제목 후보 3개 중 고르기\n" +
          "썸네일은 잡지 룩북 감성 4인 콜라주 고정",
        pinned: false,
        author: "뮤즈",
        created_at: isoAgo(60 * 24 * 3),
        updated_at: isoAgo(60 * 26)
      },
      {
        id: uid("memo"),
        title: "연말정산 체크리스트",
        body:
          "· 카드 소득공제 한도 변경분 확인\n" +
          "· 월세 세액공제 요건 (회사가 집주인에게 직접 이체 → 공제 대상 아님)\n" +
          "· 의료비·교육비 자료 12월 중 취합\n" +
          "· 13월의 월급 미리 계산해보기",
        pinned: false,
        author: "챗지피티",
        created_at: isoAgo(60 * 24 * 2),
        updated_at: isoAgo(60 * 5)
      },
      {
        id: uid("memo"),
        title: "쿠팡·쇼핑 메모",
        body:
          "· 체험단 선정되면 후기 미션은 7일 안에\n" +
          "· 로켓배송 새벽 도착은 전날 밤 12시 전 주문\n" +
          "· 리뷰는 사진 3장 + 2~3문장 개행",
        pinned: false,
        author: "피클",
        created_at: isoAgo(60 * 24 * 9),
        updated_at: isoAgo(60 * 40)
      },
      {
        id: uid("memo"),
        title: "교본 운용 규칙",
        body:
          "· 새로 정한 규칙은 교본에 먼저 적고, 메모에는 요약만 올리기\n" +
          "· 요일별 루틴·금지 사항은 교본 기준으로 확인\n" +
          "· 비서별 인수인계서는 바뀔 때마다 교본에 합쳐두기",
        pinned: false,
        author: "인스팅트",
        created_at: isoAgo(60 * 24 * 5),
        updated_at: isoAgo(60 * 3)
      }
    ];

    return { messages: messages, tasks: tasks, assistants: assistants, memos: memos };
  }

  function assistantNameFromSeed(id) {
    const found = ASSISTANT_SEED.find((a) => a.id === id);
    return found ? found.name : id;
  }

  /* ---------------------------------------------------------------- 저장소 */

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        assistants: Array.isArray(parsed.assistants) ? parsed.assistants : [],
        memos: Array.isArray(parsed.memos) ? parsed.memos : []
      };
    } catch (err) {
      return null;
    }
  }

  function persistLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
    } catch (err) {
      /* 저장 공간이 없거나 시크릿 모드면 조용히 넘어간다 */
    }
  }

  function useLocalData() {
    const saved = loadLocal();
    const fresh = !(saved && saved.assistants.length);
    const data = fresh ? buildSeed() : saved;
    db.messages = data.messages.slice();
    db.tasks = data.tasks.slice();
    db.assistants = data.assistants.slice();
    db.memos = data.memos.slice();

    try {
      const synced = syncSeedAssistants();
      let extra = refreshSeedWording();
      if (!fresh && synced.added.length) extra = announceJoined(synced.added) || extra;
      if (fresh || synced.changed || extra) persistLocal();
    } catch (err) {
      /* 저장된 데이터가 예상과 달라도 화면은 그대로 뜨게 둔다 */
    }
  }

  // 예전에 저장된 데모 데이터에도 새로 합류한 비서가 빠지지 않게 맞춰준다.
  // (이름·역할·아바타 같은 정보는 시드 기준으로 갱신하고, 상태·최근 활동은 저장된 값을 둔다)
  function syncSeedAssistants() {
    let changed = false;
    const added = [];
    ASSISTANT_SEED.forEach((seed) => {
      const row = db.assistants.find((a) => a.id === seed.id);
      if (!row) {
        db.assistants.push(
          Object.assign({}, seed, {
            created_at: isoAgo(60 * 24 * 14),
            updated_at: isoAgo(8 + seed.sort_order * 7)
          })
        );
        added.push(seed);
        changed = true;
        return;
      }
      ["name", "role", "avatar", "accent", "areas", "sort_order"].forEach((key) => {
        if (JSON.stringify(row[key]) !== JSON.stringify(seed[key])) {
          row[key] = seed[key];
          changed = true;
        }
      });
    });
    return { changed: changed, added: added };
  }

  // 예전 시드 문구(‘다섯 비서’)는 인원에 맞게 고쳐 쓴다.
  function refreshSeedWording() {
    let touched = false;
    db.messages.forEach((m) => {
      if (m.kind === "system" && m.body === "오늘의 대회의실 — 다섯 비서가 모두 들어와 있어요.") {
        m.body = "오늘의 대회의실 — 여섯 비서가 모두 들어와 있어요.";
        touched = true;
      }
    });
    return touched;
  }

  // 이미 쓰던 화면이면, 새로 합류한 비서를 대회의실에 한 번 알린다.
  function announceJoined(added) {
    if (!added.length) return false;
    const names = added.map((a) => a.name).join(" · ");
    db.messages.push({
      id: uid("msg"),
      room: "boardroom",
      sender_id: "system",
      sender_name: "비서실",
      role: "system",
      kind: "system",
      body: names + "가 합류했어요 — 이제 " + db.assistants.length + "명이 함께 일합니다.",
      recipient: "all",
      created_at: nowIso()
    });
    return true;
  }

  /* ---------------------------------------------------------------- Supabase */

  function loadSdk() {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      return Promise.resolve(window.supabase);
    }
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => {
        if (window.supabase && window.supabase.createClient) resolve(window.supabase);
        else reject(new Error("Supabase SDK를 불러오지 못했어요."));
      };
      script.onerror = () => reject(new Error("Supabase SDK를 불러오지 못했어요. 네트워크를 확인해 주세요."));
      document.head.appendChild(script);
    });
    return sdkPromise;
  }

  function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message || "시간이 초과됐어요.")), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  /* ---------------------------------------------------------------- 인증 */

  function setAuthError(text) {
    const el = $("#authError");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
  }

  function setAuthBusy(busy, label) {
    const btn = $("#authSubmit");
    if (!btn) return;
    btn.disabled = !!busy;
    btn.textContent = busy ? (label || "여는 중…") : "로그인";
  }

  // 로그인 화면을 띄우고 비서실을 가린다.
  function showAuthGate(message) {
    state.auth = "out";
    state.conn = "auth";
    document.body.classList.add("is-locked");
    const gate = $("#authGate");
    if (gate) gate.hidden = false;
    setAuthBusy(false);
    setAuthError(message || "");
    renderBadge();
    if (!message) {
      const email = $("#authEmail");
      if (email && !email.value) {
        setTimeout(() => { try { email.focus(); } catch (err) {} }, 90);
      }
    }
  }

  function hideAuthGate() {
    state.auth = "in";
    document.body.classList.remove("is-locked");
    const gate = $("#authGate");
    if (gate) gate.hidden = true;
    setAuthError("");
    setAuthBusy(false);
  }

  // 비서실 위에 남는 안내(데이터 로드 실패 등). 로그인을 다시 하지 않아도 재시도할 수 있다.
  function showAppNotice(text) {
    const el = $("#appNotice");
    if (!el) return;
    el.innerHTML =
      '<span class="notice-text">' + esc(text) + "</span>" +
      '<button type="button" class="notice-btn" data-action="retry-load">다시 시도</button>';
    el.hidden = false;
  }

  function clearAppNotice() {
    const el = $("#appNotice");
    if (!el) return;
    el.innerHTML = "";
    el.hidden = true;
  }

  function isAuthError(err) {
    if (!err) return false;
    const code = String(err.code || err.error_code || "");
    const msg = String(err.message || err.error_description || "");
    return (
      err.status === 401 ||
      code === "PGRST301" ||
      code === "invalid_claim" ||
      /jwt expired|invalid claim|no api key|invalid api key/i.test(msg)
    );
  }

  function guardAuthError(err) {
    if (client && isAuthError(err)) {
      leaveOffice();
      showAuthGate("로그인이 만료됐어요. 다시 열어주세요.");
    }
    return err;
  }

  function loginErrorMessage(err) {
    if (!err) return "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
    const code = String(err.code || err.error_code || "");
    const msg = String(err.message || err.error_description || "");
    if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
      return "이메일 또는 비밀번호가 맞지 않아요.";
    }
    if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) {
      return "이메일 인증이 아직 안 된 계정이에요. Supabase → Authentication → Users 에서 Confirm 해주세요.";
    }
    if (code === "over_request_rate_limit" || code === "too_many_requests" || err.status === 429) {
      return "시도가 너무 잦았어요. 1~2분 뒤에 다시 시도해 주세요.";
    }
    if (/failed to fetch|networkerror|load failed|fetch is not defined/i.test(msg) || err.name === "TypeError") {
      return "Supabase에 닿지 못했어요. 네트워크를 확인해 주세요.";
    }
    if (/api key/i.test(msg)) {
      return "config.js의 Supabase 키가 올바르지 않아요.";
    }
    return "로그인하지 못했어요: " + (msg || "알 수 없는 오류");
  }

  function dataErrorMessage(err) {
    const msg = String((err && err.message) || err || "");
    const code = String((err && err.code) || "");
    if (code === "PGRST205" || /could not find the table|schema cache/i.test(msg)) {
      return "비서실 테이블이 아직 없어요. Supabase SQL Editor에서 supabase-schema.sql을 실행한 뒤 다시 열어주세요.";
    }
    if (/permission denied|row-level security/i.test(msg)) {
      return "이 계정에는 비서실 접근 권한이 없어요. supabase-schema.sql의 RLS 정책을 확인해 주세요.";
    }
    if (/failed to fetch|load failed|networkerror/i.test(msg)) {
      return "Supabase에 닿지 못했어요. 네트워크를 확인해 주세요.";
    }
    return "비서실 데이터를 불러오지 못했어요: " + (msg || "알 수 없는 오류");
  }

  async function getClient() {
    if (client) return client;
    const sdk = await loadSdk();
    client = sdk.createClient(CFG.SUPABASE_URL.trim(), CFG.SUPABASE_ANON_KEY.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    // 세션이 끊기면(로그아웃·만료) 비서실을 닫고 로그인 화면으로 돌아간다.
    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && state.auth === "in") {
        leaveOffice();
        showAuthGate();
      }
    });

    return client;
  }

  async function handleSignIn(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (!client) return;

    const emailEl = $("#authEmail");
    const passwordEl = $("#authPassword");
    const email = (emailEl && emailEl.value ? emailEl.value : "").trim();
    const password = passwordEl && passwordEl.value ? passwordEl.value : "";

    if (!email || !password) {
      setAuthError("이메일과 비밀번호를 모두 적어주세요.");
      if (!email && emailEl) emailEl.focus();
      else if (passwordEl) passwordEl.focus();
      return;
    }

    setAuthError("");
    setAuthBusy(true, "여는 중…");

    try {
      const res = await withTimeout(
        client.auth.signInWithPassword({ email: email, password: password }),
        15000,
        "Supabase 응답이 없어요."
      );
      if (res.error) throw res.error;
      if (passwordEl) passwordEl.value = "";
      const user = res.data && res.data.user;
      await enterOffice(user);
    } catch (err) {
      setAuthError(loginErrorMessage(err));
      setAuthBusy(false);
      if (passwordEl) {
        passwordEl.focus();
        try { passwordEl.select(); } catch (e) {}
      }
      console.warn("[이솔 비서실] 로그인 실패:", err);
    }
  }

  async function handleSignOut() {
    try {
      if (client) await client.auth.signOut();
    } catch (err) {
      /* 이미 세션이 없어도 그대로 잠그면 된다 */
    }
    leaveOffice();
    showAuthGate();
    toast("로그아웃했어요.");
  }

  // 비서실을 닫고 화면에 남은 데이터를 지운다(로그아웃·세션 만료).
  function leaveOffice() {
    if (channel && client) {
      try { client.removeChannel(channel); } catch (err) {}
    }
    channel = null;
    db.messages = [];
    db.tasks = [];
    db.assistants = [];
    db.memos = [];
    state.userEmail = "";
    state.auth = "out";
    state.sending = false;
    closeModal();
  }

  /* ---------------------------------------------------------------- Supabase 연결 */

  async function loadRemoteData() {
    const results = await Promise.all([
      client.from("messages").select("*").order("created_at", { ascending: true }),
      client.from("tasks").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      client.from("assistants").select("*").order("sort_order", { ascending: true }),
      client.from("memos").select("*").order("pinned", { ascending: false }).order("updated_at", { ascending: false })
    ]);

    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;

    db.messages = results[0].data || [];
    db.tasks = results[1].data || [];
    db.assistants = results[2].data || [];
    db.memos = results[3].data || [];
  }

  // 로그인한 세션으로 비서실을 연다.
  async function enterOffice(user) {
    hideAuthGate();
    state.userEmail = (user && user.email) || state.userEmail;
    await loadOffice();
  }

  // 테이블을 읽어 화면을 채운다. 실패하면 비서실 위에 안내를 띄우고(로그인은 유지)
  // ‘다시 시도’ 버튼으로 재시도할 수 있게 둔다.
  async function loadOffice() {
    clearAppNotice();
    state.conn = "connecting";
    renderBadge();

    try {
      await withTimeout(loadRemoteData(), 15000, "Supabase 응답이 없어요.");
    } catch (err) {
      if (isAuthError(err)) {
        leaveOffice();
        showAuthGate(loginErrorMessage(err));
        return;
      }
      state.conn = "error";
      renderAll();
      showAppNotice(dataErrorMessage(err));
      console.warn("[이솔 비서실] 데이터 불러오기 실패:", err);
      return;
    }

    if (!db.assistants.length) await seedAssistantsRemote();

    state.conn = "live";
    renderAll();
    subscribeRealtime();
    toast("비서실을 열었어요 · 실시간 동기화 중");
  }

  // 앱 시작: SDK → 저장된 세션 확인 → 있으면 바로 열고, 없으면 로그인 화면.
  async function bootstrapRemote() {
    await getClient();
    if (connectAborted) return;

    const res = await client.auth.getSession();
    const session = res && res.data && res.data.session;
    if (connectAborted) return;

    if (!session) {
      showAuthGate();
      return;
    }

    await enterOffice(session.user);
  }

  async function seedAssistantsRemote() {
    try {
      const rows = ASSISTANT_SEED.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
        accent: a.accent,
        status: a.status,
        areas: a.areas,
        summary: a.summary,
        sort_order: a.sort_order,
        updated_at: nowIso()
      }));
      const res = await client.from("assistants").upsert(rows).select();
      if (!res.error) db.assistants = res.data || rows;
    } catch (err) {
      /* 스키마가 없어도 화면은 시드로 버틴다 */
      db.assistants = ASSISTANT_SEED.slice();
    }
  }

  let pollTimer = null;
  let retryTimer = null;

  function startPollingFallback() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      if (state.auth !== "in" || !client || document.hidden) return;
      try {
        await loadRemoteData();
        renderAll();
      } catch (err) {}
    }, 10000);
  }

  async function subscribeRealtime() {
    if (!client) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try {
      const res = await client.auth.getSession();
      const token = res && res.data && res.data.session && res.data.session.access_token;
      if (token && client.realtime && typeof client.realtime.setAuth === "function") {
        client.realtime.setAuth(token);
      }
    } catch (err) {}

    if (channel) {
      try { client.removeChannel(channel); } catch (err) {}
    }
    channel = client
      .channel("yisol-office")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => onRealtime("messages", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => onRealtime("tasks", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "assistants" }, (p) => onRealtime("assistants", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "memos" }, (p) => onRealtime("memos", p))
      .subscribe((status) => {
        if (state.auth !== "in") return;
        if (status === "SUBSCRIBED") {
          state.conn = "live";
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          state.conn = "live";
          startPollingFallback();
          if (!retryTimer) {
            retryTimer = setTimeout(() => {
              if (state.auth === "in" && !document.hidden) subscribeRealtime();
            }, 5000);
          }
        }
        renderBadge();
      });
  }

  function onRealtime(table, payload) {
    if (!payload) return;
    if (payload.eventType === "DELETE") {
      const oldId = payload.old && payload.old.id;
      if (oldId) db[table] = db[table].filter((row) => row.id !== oldId);
    } else if (payload.new) {
      applyRow(table, payload.new);
    }
    renderTable(table);
  }

  function applyRow(table, row) {
    if (!row || !row.id) return;
    const list = db[table];
    const idx = list.findIndex((item) => item.id === row.id);
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], row);
    else list.push(row);
  }

  function renderTable(table) {
    if (table === "messages") renderChat();
    if (table === "tasks") renderTasks();
    if (table === "assistants") {
      renderTeam();
      renderRoomTabs();
      renderRoomStatus();
      renderRecipients();
    }
    if (table === "memos") renderMemos();
  }

  /* ---------------------------------------------------------------- CRUD */

  async function apiInsert(table, row) {
    if (client) {
      const res = await client.from(table).insert(row).select().single();
      if (res.error) throw guardAuthError(res.error);
      return res.data;
    }
    const saved = Object.assign({}, row);
    if (!saved.id) saved.id = uid(table);
    if (!saved.created_at) saved.created_at = nowIso();
    if (!saved.updated_at) saved.updated_at = nowIso();
    db[table].push(saved);
    persistLocal();
    return saved;
  }

  async function apiUpdate(table, id, patch) {
    if (client) {
      const res = await client.from(table).update(patch).eq("id", id).select().single();
      if (res.error) throw guardAuthError(res.error);
      return res.data;
    }
    const row = db[table].find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: nowIso() });
    persistLocal();
    return row;
  }

  async function apiDelete(table, id) {
    if (client) {
      const res = await client.from(table).delete().eq("id", id);
      if (res.error) throw guardAuthError(res.error);
      return true;
    }
    db[table] = db[table].filter((item) => item.id !== id);
    persistLocal();
    return true;
  }

  /* ---------------------------------------------------------------- 렌더: 공통 */

  function renderBadge() {
    const badge = $("#connBadge");
    const text = $("#connText");
    const signOutBtn = $("#signoutBtn");
    if (signOutBtn) signOutBtn.hidden = state.auth !== "in";
    if (!badge || !text) return;
    badge.classList.remove("is-live", "is-demo", "is-connecting", "is-error", "is-auth");

    let cls = "is-demo";
    let label = "로컬 데모";
    let tip = "로컬 데모 모드 — config.js에 SUPABASE_URL과 SUPABASE_ANON_KEY를 넣으면 실시간 동기화됩니다.";

    if (state.conn === "live") {
      cls = "is-live";
      label = "실시간 연결";
      tip = "Supabase 실시간 동기화 중 — messages · tasks · assistants · memos";
    } else if (state.conn === "connecting") {
      cls = "is-connecting";
      label = "연결 중…";
      tip = "Supabase에 연결하는 중입니다.";
    } else if (state.conn === "auth") {
      cls = "is-auth";
      label = "로그인 필요";
      tip = "이메일과 비밀번호로 로그인하면 비서실이 열립니다.";
    } else if (state.conn === "error") {
      cls = "is-error";
      label = "연결 끊김";
      tip = "Supabase 연결에 실패했어요. config.js의 URL·키와 프로젝트 상태를 확인해 주세요.";
    }

    badge.classList.add(cls);
    text.textContent = label;
    badge.title = tip;
    badge.setAttribute("aria-label", "연결 상태: " + label);
  }

  function renderAll() {
    $("#appTitle").textContent = CFG.APP_TITLE;
    $("#ownerLabel").textContent = CFG.OWNER_LABEL;
    document.title = CFG.APP_TITLE;

    renderBadge();
    renderRoomTabs();
    renderRoomStatus();
    renderRecipients();
    renderChat();
    renderTasks();
    renderTeam();
    renderMemos();
    applyTab(state.tab);
  }

  /* ---------------------------------------------------------------- 렌더: 회의실 */

  function renderRoomTabs() {
    const wrap = $("#roomTabs");
    if (!wrap) return;
    wrap.innerHTML = ROOMS.map((room) => {
      const on = room.members.filter((id) => assistantById(id).status === "on").length;
      const active = room.id === state.room;
      return (
        '<button type="button" class="room-pill' + (active ? " is-active" : "") + '" role="tab" aria-selected="' + active +
        '" data-room="' + room.id + '" title="' + esc(room.desc) + '">' +
        '<span aria-hidden="true">' + room.icon + "</span>" + esc(room.name) +
        '<span class="sr-only"> · ON ' + on + "명</span></button>"
      );
    }).join("");
  }

  function renderRoomStatus() {
    const el = $("#roomStatus");
    if (!el) return;
    const room = roomById(state.room);
    const on = room.members.filter((id) => assistantById(id).status === "on").length;
    el.innerHTML =
      '<span aria-hidden="true">' + room.icon + "</span> " + esc(room.name) +
      ' <span class="sep">·</span> <span class="on">ON ' + on + "명</span>";
  }

  function renderRecipients() {
    const wrap = $("#recipients");
    if (!wrap) return;
    const room = roomById(state.room);
    const ids = ["all"].concat(room.members);
    if (ids.indexOf(state.recipient) === -1) state.recipient = "all";
    wrap.innerHTML = ids
      .map((id) => {
        const active = state.recipient === id;
        const label = id === "all" ? "전체" : assistantName(id);
        const face = id === "all" ? '<span class="emoji" aria-hidden="true">👥</span>' : chipAvatar(assistantById(id));
        return (
          '<button type="button" class="recipient' + (active ? " is-active" : "") + '" data-recipient="' + esc(id) +
          '" aria-pressed="' + active + '">' + face +
          esc(label) + "</button>"
        );
      })
      .join("");
  }

  function messageForAssistant(m) {
    const a = assistantById(m.sender_id);
    return (
      '<article class="msg msg-assistant" data-id="' + esc(m.id) + '">' +
      avatarMarkup(a, "avatar") +
      '<div class="msg-body">' +
      '<div class="msg-head"><span class="msg-name">' + esc(a.name || m.sender_name) + "</span>" +
      '<span class="role-badge">' + esc(a.role || "비서") + "</span>" +
      '<span class="msg-time">' + esc(fmtTime(m.created_at)) + "</span></div>" +
      '<div class="bubble">' + formatBody(m.body) + "</div>" +
      "</div></article>"
    );
  }

  function messageForUser(m) {
    const target =
      m.recipient && m.recipient !== "all"
        ? '<span class="msg-target">→ ' + esc(assistantName(m.recipient)) + "</span>"
        : "";
    return (
      '<article class="msg msg-user" data-id="' + esc(m.id) + '">' +
      '<div class="avatar user" aria-hidden="true">👑</div>' +
      '<div class="msg-body">' +
      '<div class="msg-head"><span class="msg-name">' + esc(m.sender_name || CFG.OWNER_NAME) + "</span>" + target +
      '<span class="msg-time">' + esc(fmtTime(m.created_at)) + "</span></div>" +
      '<div class="bubble">' + formatBody(m.body) + "</div>" +
      "</div></article>"
    );
  }

  function renderChat() {
    const list = $("#chatList");
    if (!list) return;
    const room = roomById(state.room);
    const msgs = sortByTime(db.messages.filter((m) => m.room === state.room), "created_at");

    if (!msgs.length) {
      list.innerHTML =
        '<div class="chat-empty"><strong>' + esc(room.name) + "</strong>이 아직 조용해요.<br>" +
        "아래 입력창에서 첫 메시지를 남겨보세요.</div>";
      return;
    }

    let html = "";
    let lastDay = "";
    msgs.forEach((m) => {
      const key = dayKey(m.created_at);
      if (key !== lastDay) {
        html += '<div class="divider"><span>' + esc(fmtDayLabel(m.created_at)) + "</span></div>";
        lastDay = key;
      }
      if (m.kind === "system" || m.role === "system") {
        html += '<div class="divider"><span>' + esc(m.body) + "</span></div>";
      } else if (m.role === "user") {
        html += messageForUser(m);
      } else {
        html += messageForAssistant(m);
      }
    });

    list.innerHTML = html;
    if (state.stick) scrollToBottom();
  }

  function scrollToBottom() {
    const box = $("#chatScroll");
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------------------------------------------------------- 렌더: 작업실 */

  function renderTasks() {
    const board = $("#board");
    if (!board) return;

    renderTaskFilters();

    const filtering = state.taskFilter !== "all";
    board.style.gridTemplateColumns = filtering ? "minmax(0, 1fr)" : "";
    board.classList.toggle("is-single", filtering);

    const columns = filtering ? TASK_COLUMNS.filter((c) => c.key === state.taskFilter) : TASK_COLUMNS;

    board.innerHTML = columns
      .map((col) => {
        const cards = db.tasks
          .filter((t) => t.status === col.key)
          .filter((t) => state.taskAssignee === "all" || t.assignee === state.taskAssignee)
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || new Date(a.created_at) - new Date(b.created_at));

        return (
          '<section class="column" aria-label="' + col.label + '">' +
          '<div class="column-head"><span>' + col.label + '</span><span class="count">' + cards.length + "</span></div>" +
          (cards.length ? cards.map(taskCard).join("") : '<p class="col-empty">' + esc(col.empty) + "</p>") +
          "</section>"
        );
      })
      .join("");
  }

  function renderTaskFilters() {
    const statusWrap = $("#statusFilter");
    const assigneeWrap = $("#assigneeFilter");
    if (!statusWrap || !assigneeWrap) return;

    const statusChips = [{ key: "all", label: "전체" }].concat(
      TASK_COLUMNS.map((c) => ({ key: c.key, label: c.label }))
    );
    statusWrap.innerHTML = statusChips
      .map((c) => {
        const n = c.key === "all" ? db.tasks.length : db.tasks.filter((t) => t.status === c.key).length;
        return (
          '<button type="button" class="chip' + (state.taskFilter === c.key ? " is-active" : "") +
          '" data-filter="status" data-value="' + c.key + '" aria-pressed="' + (state.taskFilter === c.key) + '">' +
          c.label + '<span class="n">' + n + "</span></button>"
        );
      })
      .join("");

    const assigneeChips = [{ id: "all", name: "전체 담당", face: '<span class="emoji" aria-hidden="true">👥</span>' }].concat(
      db.assistants.map((a) => ({ id: a.id, name: a.name, face: chipAvatar(a) }))
    );
    assigneeWrap.innerHTML = assigneeChips
      .map((a) => {
        const active = state.taskAssignee === a.id;
        const n = a.id === "all" ? db.tasks.length : db.tasks.filter((t) => t.assignee === a.id).length;
        return (
          '<button type="button" class="chip' + (active ? " is-active" : "") + '" data-filter="assignee" data-value="' +
          esc(a.id) + '" aria-pressed="' + active + '">' + a.face + " " +
          esc(a.name) + '<span class="n">' + n + "</span></button>"
        );
      })
      .join("");
  }

  function taskCard(task) {
    const a = assistantById(task.assignee);
    const due =
      task.status === "done"
        ? { text: task.due_date ? "마감 " + fmtDateShort(task.due_date) : "", cls: "" }
        : fmtDue(task.due_date);
    const detail = task.detail
      ? '<p class="task-detail">' + esc(task.detail) + "</p>"
      : "";
    return (
      '<article class="task-card" data-id="' + esc(task.id) + '">' +
      '<div class="task-top">' +
      '<span class="assignee-tag">' + chipAvatar(a) + esc(a.name) + "</span>" +
      (due.text ? '<span class="due ' + due.cls + '">' + esc(due.text) + "</span>" : "") +
      "</div>" +
      '<h3 class="task-title">' + esc(task.title) + "</h3>" + detail +
      '<div class="task-foot">' +
      '<select class="task-status-select is-' + esc(task.status) + '" data-action="task-status" data-id="' + esc(task.id) +
      '" aria-label="상태 변경">' +
      TASK_COLUMNS.map(
        (c) => '<option value="' + c.key + '"' + (task.status === c.key ? " selected" : "") + ">" + c.label + "</option>"
      ).join("") +
      "</select>" +
      '<div class="task-actions">' +
      '<button type="button" class="icon-btn" data-action="task-edit" data-id="' + esc(task.id) + '" aria-label="작업 수정" title="수정">✎</button>' +
      '<button type="button" class="icon-btn danger" data-action="task-delete" data-id="' + esc(task.id) + '" aria-label="작업 삭제" title="삭제">✕</button>' +
      "</div></div></article>"
    );
  }

  /* ---------------------------------------------------------------- 렌더: 비서현황 */

  function renderTeam() {
    const grid = $("#teamGrid");
    if (!grid) return;
    const count = $("#teamCount");
    if (count) count.textContent = "ON " + db.assistants.filter((a) => a.status === "on").length + "명";

    grid.innerHTML = db.assistants
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((a) => {
        const stateButtons = ["on", "standby", "off"]
          .map(
            (s) =>
              '<button type="button" data-action="set-state" data-id="' + esc(a.id) + '" data-state="' + s +
              '" class="' + (a.status === s ? "is-active" : "") + '" aria-pressed="' + (a.status === s) + '">' +
              STATE_LABEL[s] + "</button>"
          )
          .join("");
        return (
          '<article class="team-card" style="--accent:' + esc(a.accent || "#7B4B24") + '" data-id="' + esc(a.id) + '">' +
          '<div class="team-head">' +
          avatarMarkup(a, "avatar lg") +
          '<div class="team-id"><h3>' + esc(a.name) + "</h3><p>" + esc(a.role) + "</p></div>" +
          '<div class="state-switch" role="group" aria-label="' + esc(a.name) + ' 상태 변경">' + stateButtons + "</div>" +
          "</div>" +
          '<div class="areas">' + (a.areas || []).map((x) => '<span class="area">' + esc(x) + "</span>").join("") + "</div>" +
          '<p class="team-summary"><span class="label">최근 활동</span>' + esc(a.summary || "—") + "</p>" +
          '<div class="team-foot"><span>' + esc(fmtRelative(a.updated_at)) + " 업데이트</span>" +
          '<button type="button" class="ghost-btn" data-action="team-message" data-id="' + esc(a.id) + '">메시지</button>' +
          "</div></article>"
        );
      })
      .join("");
  }

  /* ---------------------------------------------------------------- 렌더: 메모 */

  function renderMemos() {
    const grid = $("#memoGrid");
    if (!grid) return;

    const memos = db.memos.slice().sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    });

    if (!memos.length) {
      grid.innerHTML = '<p class="col-empty" style="grid-column:1/-1">메모가 없어요. ‘+ 새 메모’로 첫 메모를 남겨보세요.</p>';
      return;
    }

    grid.innerHTML = memos
      .map(
        (memo) =>
          '<article class="memo-card' + (memo.pinned ? " is-pinned" : "") + '" data-id="' + esc(memo.id) + '">' +
          '<div class="memo-head"><h3>' + esc(memo.title || "제목 없음") + "</h3>" +
          '<button type="button" class="pin-btn' + (memo.pinned ? " is-on" : "") + '" data-action="memo-pin" data-id="' +
          esc(memo.id) + '" aria-label="' + (memo.pinned ? "고정 해제" : "위에 고정") + '" aria-pressed="' + !!memo.pinned + '" title="' +
          (memo.pinned ? "고정 해제" : "위에 고정") + '">📌</button></div>' +
          '<p class="memo-body" data-action="memo-edit" data-id="' + esc(memo.id) + '" title="눌러서 열기">' + esc(memo.body || "") + "</p>" +
          '<div class="memo-foot"><span>' + esc(memo.author || CFG.OWNER_NAME) + " · " +
          esc(fmtRelative(memo.updated_at || memo.created_at)) + "</span>" +
          '<div class="memo-actions">' +
          '<button type="button" class="icon-btn" data-action="memo-edit" data-id="' + esc(memo.id) + '" aria-label="메모 수정" title="수정">✎</button>' +
          '<button type="button" class="icon-btn danger" data-action="memo-delete" data-id="' + esc(memo.id) + '" aria-label="메모 삭제" title="삭제">✕</button>' +
          "</div></div></article>"
      )
      .join("");
  }

  /* ---------------------------------------------------------------- 탭/방 전환 */

  function applyTab(tab) {
    state.tab = TABS.indexOf(tab) === -1 ? "meeting" : tab;
    $$(".tab").forEach((btn) => {
      const active = btn.dataset.tab === state.tab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    $$(".view").forEach((view) => {
      view.classList.toggle("is-active", view.dataset.view === state.tab);
    });
    if (state.tab === "meeting" && state.stick) scrollToBottom();
  }

  function setRoom(roomId) {
    if (!roomById(roomId)) return;
    state.room = roomId;
    const room = roomById(roomId);
    if (state.recipient !== "all" && room.members.indexOf(state.recipient) === -1) state.recipient = "all";
    state.stick = true;
    renderRoomTabs();
    renderRoomStatus();
    renderRecipients();
    renderChat();
  }

  /* ---------------------------------------------------------------- 메시지 보내기 */

  function messageRow(body, recipient) {
    const row = {
      room: state.room,
      sender_id: "user",
      sender_name: CFG.OWNER_NAME,
      role: "user",
      kind: "text",
      body: body,
      recipient: recipient || "all"
    };
    if (!client) {
      row.id = uid("msg");
      row.created_at = nowIso();
    }
    return row;
  }

  async function sendMessage(body, recipient) {
    if (state.sending) return;
    const text = String(body || "").trim();
    if (!text) return;
    state.sending = true;

    try {
      const saved = await apiInsert("messages", messageRow(text, recipient));
      applyRow("messages", saved);
      state.stick = true;
      renderChat();
      if (!client) toast("로컬 데모에 저장했어요 · Supabase를 연결하면 실제 비서에게 전달됩니다.");
    } catch (err) {
      toast("메시지를 보내지 못했어요: " + (err.message || err));
    } finally {
      state.sending = false;
    }
  }

  async function replyAs(assistantId, body) {
    const row = {
      room: state.room,
      sender_id: assistantId,
      sender_name: assistantName(assistantId),
      role: "assistant",
      kind: "text",
      body: body,
      recipient: "all"
    };
    if (!client) {
      row.id = uid("msg");
      row.created_at = nowIso();
    }
    try {
      const saved = await apiInsert("messages", row);
      applyRow("messages", saved);
      state.stick = true;
      renderChat();
    } catch (err) {
      /* 데모 응답 실패는 조용히 넘긴다 */
    }
  }

  async function runConnectionTest() {
    const target = state.recipient;
    const label = target === "all" ? "여섯 비서" : assistantName(target);
    await sendMessage("🔔 연결 테스트 — " + label + "에게 신호 보냅니다.", target);

    if (!client) {
      setTimeout(() => {
        if (target === "all") {
          replyAs("miu", "🟢 여섯 명 모두 신호 받았습니다. 지금은 로컬 데모 모드라 이 화면에서만 보이는 응답이에요.");
        } else {
          replyAs(target, "🟢 " + assistantName(target) + " 연결 확인했습니다. 지시는 작업실 카드로 옮겨둘게요. (로컬 데모)");
        }
      }, 800);
    } else {
      toast("테스트 메시지를 보냈어요. 연결된 비서가 답하면 여기에 나타납니다.");
    }
  }

  /* ---------------------------------------------------------------- 답 옮기기 */

  const RELAY_KEY_LS = "yisol-office.relay.key";
  const RELAY_URL_LS = "yisol-office.relay.url";

  function readStore(key) {
    try { return localStorage.getItem(key) || ""; } catch (err) { return ""; }
  }

  function writeStore(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (err) {
      /* 저장이 막혀 있어도 이번 화면에서는 그대로 쓴다 */
    }
  }

  // 기본 연결 창구 주소 = Supabase 프로젝트 주소 + /functions/v1/office-replay
  function defaultRelayEndpoint() {
    const base = String(CFG.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    return base ? base + "/functions/v1/office-replay" : "";
  }

  function relayEndpoint() {
    return readStore(RELAY_URL_LS) || defaultRelayEndpoint();
  }

  function relayKey() {
    return readStore(RELAY_KEY_LS);
  }

  function relayUrl(params) {
    const base = relayEndpoint();
    if (!base) return "";
    const parts = [];
    const key = relayKey();
    if (key) parts.push("key=" + encodeURIComponent(key));
    Object.keys(params || {}).forEach((name) => {
      parts.push(name + "=" + encodeURIComponent(params[name]));
    });
    return base + (parts.length ? "?" + parts.join("&") : "");
  }

  function relayReadUrl() {
    return relayUrl({ action: "read", room: "boardroom", limit: 15 });
  }

  function sortedAssistants() {
    return db.assistants.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  async function copyText(text) {
    const value = String(text || "");
    if (!value) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (err) {
      /* 클립보드 권한이 없으면 아래 폴백으로 */
    }
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }

  /* 다른 비서 앱에서 받은 답을 그 비서의 말풍선으로 회의실에 옮긴다. */
  function openReplyModal() {
    const assistants = sortedAssistants();
    if (!assistants.length) {
      toast("비서 목록을 아직 불러오지 못했어요. 잠시 뒤 다시 해보세요.");
      return;
    }

    const picked = assistants.some((a) => a.id === state.recipient) ? state.recipient : assistants[0].id;
    const chips = assistants
      .map((a) => {
        const on = a.id === picked;
        return (
          '<button type="button" class="pick' + (on ? " is-active" : "") + '" data-reply-sender="' + esc(a.id) +
          '" aria-pressed="' + on + '">' + chipAvatar(a) + esc(a.name) + "</button>"
        );
      })
      .join("");
    const roomOptions = ROOMS.map(
      (r) => '<option value="' + r.id + '"' + (r.id === state.room ? " selected" : "") + ">" + r.icon + " " + esc(r.name) + "</option>"
    ).join("");

    openModal(
      "<h3>⇄ 답 옮기기</h3>" +
        '<p class="modal-sub">다른 비서 앱에서 받은 답을 그 비서의 이름·얼굴 그대로 회의실에 올려요.</p>' +
        '<form id="replyForm">' +
        '<span class="field-label">보낸 비서</span>' +
        '<div class="assistant-pick" id="replySenders" role="group" aria-label="보낸 비서">' + chips + "</div>" +
        '<label class="field"><span>회의실</span><select name="room">' + roomOptions + "</select></label>" +
        '<label class="field"><span>답글 본문</span><textarea name="body" rows="6" maxlength="8000" required ' +
        'placeholder="비서 앱에서 답을 복사해 그대로 붙여넣으세요"></textarea></label>' +
        '<p class="guide-note">받는 비서는 ‘전체’로 올라가고, 올린 방으로 화면이 옮겨가요.</p>' +
        '<div class="modal-actions"><button type="button" class="btn-ghost" data-action="close-modal">취소</button>' +
        '<button type="submit" class="btn-primary">회의실에 올리기</button></div>' +
        "</form>",
      "is-rose"
    );

    const form = $("#replyForm");
    if (!form) return;
    const area = form.querySelector('[name="body"]');
    if (area) setTimeout(() => { try { area.focus(); } catch (err) {} }, 80);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const active = form.querySelector(".pick.is-active");
      const senderId = active ? active.dataset.replySender : assistants[0].id;
      const roomEl = form.querySelector('[name="room"]');
      const room = roomEl ? roomEl.value : state.room;
      const body = area ? area.value.trim() : "";
      if (!body) {
        toast("답글 본문을 붙여넣어 주세요.");
        if (area) area.focus();
        return;
      }

      const row = {
        room: room,
        sender_id: senderId,
        sender_name: assistantName(senderId),
        role: "assistant",
        kind: "text",
        body: body,
        recipient: "all"
      };
      if (!client) {
        row.id = uid("msg");
        row.created_at = nowIso();
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const saved = await apiInsert("messages", row);
        applyRow("messages", saved);
        closeModal();
        if (state.room !== room) setRoom(room);
        else {
          state.stick = true;
          renderChat();
        }
        toast(assistantName(senderId) + " 답을 " + roomById(room).name + "에 올렸어요.");
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        toast("올리지 못했어요: " + (err.message || err));
      }
    });
  }

  /* ---------------------------------------------------------------- 비서 연결 안내 */

  function buildRelaySnippet(id, name) {
    const base = relayEndpoint();
    if (!base) {
      return "[이솔 비서실 · " + name + " 연결]\n연결 창구 주소가 아직 없어요. 비서실 화면에서 주소를 한 번 넣어주세요.";
    }

    const key = relayKey();
    const read = relayReadUrl();
    const sendExample = relayUrl({ action: "send", room: "boardroom", sender: id, body: "여기에 답 내용" });

    const head =
      "[이솔 비서실 · " + name + " 연결]\n" +
      "아래 주소로 이솔 비서실 「대회의실」의 최근 대화·진행 중 작업·비서 상태를 읽고, " +
      "네 이름(" + name + ")으로 답을 남길 수 있어.\n";
    const readBlock = "\n■ 읽기\n" + read + "\n";
    const tail =
      "\n※ 주소를 열 수 없는 앱이면, 답을 복사해서 비서실 화면 회의실 아래 [⇄ 답 옮기기]에서 '" + name +
      "'을 고르고 붙여넣으면 돼.\n※ 이 문구에는 열쇠가 들어 있어. 다른 사람에게 보내지 마.";

    if (id === "claude") {
      const enc = ' --data-urlencode ';
      return (
        head + readBlock +
        "\n■ 내 답 올리기 (터미널)\n" +
        'curl -s -G "' + base + '"' + enc + '"key=' + key + '"' + enc + '"action=send"' +
        enc + '"room=boardroom"' + enc + '"sender=claude"' + enc + '"body=보고 내용"\n' +
        "\n■ 작업실에 카드 추가 (선택)\n" +
        'curl -s -G "' + base + '"' + enc + '"key=' + key + '"' + enc + '"action=task"' +
        enc + '"title=할 일 제목"' + enc + '"assignee=claude"\n' +
        tail
      );
    }

    if (id === "chatgpt") {
      return (
        head + readBlock +
        "\n■ 내 답 올리기 (URL 열기)\n" + sendExample + "\n" +
        "\n· POST JSON도 돼: {\"key\":\"...\",\"action\":\"send\",\"sender\":\"chatgpt\",\"room\":\"boardroom\",\"body\":\"...\"}\n" +
        "· Actions에 붙이려면 OpenAPI 스펙이 필요해 — 원하면 만들어 줄게." +
        tail
      );
    }

    return (
      head + readBlock +
      "\n■ 내 답 올리기 (URL 열기)\n" + sendExample + "\n" +
      "\n· body 뒤에 네 답을 URL 인코딩해서 넣으면 " + name + " 이름으로 말풍선이 올라가." +
      tail
    );
  }

  function renderRelaySnippet() {
    const pre = $("#relaySnippet");
    if (!pre) return;
    const a = assistantById(state.guideSender);
    pre.textContent = buildRelaySnippet(a.id, a.name);

    const warn = $("#relayWarn");
    if (warn) {
      const hasUrl = !!relayEndpoint();
      const hasKey = !!relayKey();
      warn.hidden = hasUrl && hasKey;
      warn.textContent = !hasUrl && !hasKey
        ? "연결 창구 주소와 열쇠를 넣으면 비서에게 줄 주소가 완성돼요."
        : !hasUrl
          ? "연결 창구 주소가 비어 있어요. Supabase 함수 주소를 넣어 주세요."
          : !hasKey
            ? "열쇠 칸이 비어 있어요. Supabase에 넣은 RELAY_KEY 값을 적어 주세요."
            : "";
    }
  }

  function highlightGuidePick(id) {
    state.guideSender = id;
    $$("#relayPicker .pick").forEach((btn) => {
      const on = btn.dataset.guideAssistant === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    renderRelaySnippet();
  }

  function openRelayGuide() {
    const assistants = sortedAssistants();
    if (assistants.length && !assistants.some((a) => a.id === state.guideSender)) {
      state.guideSender = assistants[0].id;
    }
    const pickChips = assistants
      .map((a) => {
        const on = a.id === state.guideSender;
        return (
          '<button type="button" class="pick' + (on ? " is-active" : "") + '" data-guide-assistant="' + esc(a.id) +
          '" aria-pressed="' + on + '">' + chipAvatar(a) + esc(a.name) + "</button>"
        );
      })
      .join("");

    openModal(
      "<h3>🔗 비서 연결 안내</h3>" +
        '<p class="modal-sub">뮤즈·키링·인스팅트·클로드·챗지피티가 비서실을 읽고 답을 남기는 두 가지 길이에요.</p>' +

        '<div class="guide-step">' +
        '<div class="guide-step-head"><span class="guide-num">1</span>답 옮기기<span class="guide-tag">준비 없이 바로</span></div>' +
        '<p class="guide-text">다른 비서 앱에서 받은 답을 복사해 회의실 아래 <b>⇄ 답 옮기기</b>에 붙여넣으면, 고른 비서의 이름·얼굴로 말풍선이 올라가요. <b>어떤 앱이든 이 방법은 됩니다.</b></p>' +
        "</div>" +

        '<div class="guide-step">' +
        '<div class="guide-step-head"><span class="guide-num">2</span>연결 창구 주소·열쇠</div>' +
        '<p class="guide-text">한 번만 올려두면 비서들이 주소를 열어 회의실을 읽고 직접 답을 남길 수 있어요.</p>' +
        '<label class="field"><span>연결 창구 주소</span><input type="text" id="relayUrlInput" spellcheck="false" autocomplete="off" value="' +
        esc(relayEndpoint()) + '" placeholder="https://<프로젝트>.supabase.co/functions/v1/office-replay"></label>' +
        '<label class="field"><span>열쇠 (RELAY_KEY · 이 브라우저에만 저장)</span><input type="text" id="relayKeyInput" spellcheck="false" autocomplete="off" value="' +
        esc(relayKey()) + '" placeholder="Supabase에 넣은 RELAY_KEY 값"></label>' +
        '<p class="guide-note">아직 창구를 안 올렸다면 — Supabase 대시보드 → <b>Edge Functions</b> → 새 함수 이름 <b>office-relay</b> → 저장소의 <b>supabase/functions/office-relay/index.ts</b> 전체를 붙여넣고 배포 → 시크릿에 <b>RELAY_KEY</b> 추가 → 함수의 <b>JWT 확인(Verify JWT)은 꺼 주세요</b>(열쇠가 대신 문을 지켜요).</p>' +
        "</div>" +

        '<div class="guide-step">' +
        '<div class="guide-step-head"><span class="guide-num">3</span>비서에게 붙여넣을 문구</div>' +
        '<div class="assistant-pick" id="relayPicker" role="group" aria-label="안내할 비서">' + pickChips + "</div>" +
        '<div class="copy-block"><span class="copy-label">붙여넣기용 문구' +
        '<button type="button" class="copy-btn" data-action="copy" data-copy="#relaySnippet">복사</button></span>' +
        '<pre id="relaySnippet"></pre></div>' +
        '<p class="guide-note" id="relayWarn" hidden>열쇠 칸이 비어 있어요. 위에 RELAY_KEY 값을 넣으면 주소가 완성돼요.</p>' +
        "</div>" +

        '<div class="modal-actions"><button type="button" class="btn-primary" data-action="close-modal">닫기</button></div>',
      "is-rose is-wide"
    );

    renderRelaySnippet();

    const urlInput = $("#relayUrlInput");
    const keyInput = $("#relayKeyInput");
    if (urlInput) {
      urlInput.addEventListener("input", () => {
        const value = urlInput.value.trim();
        writeStore(RELAY_URL_LS, value && value !== defaultRelayEndpoint() ? value : "");
        renderRelaySnippet();
      });
    }
    if (keyInput) {
      keyInput.addEventListener("input", () => {
        writeStore(RELAY_KEY_LS, keyInput.value.trim());
        renderRelaySnippet();
      });
    }
  }

  /* ---------------------------------------------------------------- 모달 */

  function openModal(html, extraClass) {
    const root = $("#modalRoot");
    root.innerHTML =
      '<div class="modal-backdrop" data-modal-backdrop><div class="modal' + (extraClass ? " " + extraClass : "") +
      '" role="dialog" aria-modal="true">' + html + "</div></div>";
    const backdrop = root.firstElementChild;
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) closeModal();
    });
    const firstField = root.querySelector("input, textarea, select, button");
    if (firstField) setTimeout(() => firstField.focus(), 30);
  }

  function closeModal() {
    $("#modalRoot").innerHTML = "";
  }

  function confirmModal(title, text, onConfirm) {
    openModal(
      "<h3>" + esc(title) + '</h3><p class="modal-sub">' + esc(text) + "</p>" +
        '<div class="modal-actions"><button type="button" class="btn-ghost" data-action="close-modal">취소</button>' +
        '<button type="button" class="btn-primary danger" id="confirmYes">삭제</button></div>'
    );
    $("#confirmYes").addEventListener("click", () => {
      closeModal();
      onConfirm();
    });
  }

  function openTaskModal(task) {
    const editing = !!task;
    const options = db.assistants
      .map(
        (a) =>
          '<option value="' + esc(a.id) + '"' + (editing && task.assignee === a.id ? " selected" : "") + ">" +
          esc(avatarFallback(a)) + " " + esc(a.name) + "</option>"
      )
      .join("");
    const statusOptions = TASK_COLUMNS.map(
      (c) => '<option value="' + c.key + '"' + (editing && task.status === c.key ? " selected" : !editing && c.key === "todo" ? " selected" : "") + ">" + c.label + "</option>"
    ).join("");

    openModal(
      "<h3>" + (editing ? "작업 수정" : "새 작업") + "</h3>" +
        '<p class="modal-sub">담당 비서와 상태를 정하면 작업실 카드로 쌓입니다.</p>' +
        '<form id="taskForm">' +
        '<label class="field"><span>제목</span><input type="text" name="title" maxlength="120" required value="' +
        esc(editing ? task.title : "") + '" placeholder="예: 12월 수영 신규 예약 알림"></label>' +
        '<label class="field"><span>상세 메모 (선택)</span><textarea name="detail" maxlength="1000" placeholder="무엇을, 언제까지">' +
        esc(editing ? task.detail || "" : "") + "</textarea></label>" +
        '<div class="field-row">' +
        '<label class="field"><span>담당</span><select name="assignee">' + options + "</select></label>" +
        '<label class="field"><span>상태</span><select name="status">' + statusOptions + "</select></label>" +
        "</div>" +
        '<label class="field"><span>마감일 (선택)</span><input type="date" name="due_date" value="' +
        esc(editing && task.due_date ? String(task.due_date).slice(0, 10) : "") + '"></label>' +
        '<div class="modal-actions"><button type="button" class="btn-ghost" data-action="close-modal">취소</button>' +
        '<button type="submit" class="btn-primary">' + (editing ? "저장" : "추가") + "</button></div>" +
        "</form>"
    );

    $("#taskForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = {
        title: form.title.value.trim(),
        detail: form.detail.value.trim(),
        assignee: form.assignee.value,
        status: form.status.value,
        due_date: form.due_date.value || null
      };
      if (!data.title) {
        toast("제목을 적어주세요.");
        return;
      }
      try {
        if (editing) {
          const saved = await apiUpdate("tasks", task.id, data);
          if (saved) applyRow("tasks", saved);
        } else {
          const row = Object.assign({}, data, { sort_order: db.tasks.length + 1 });
          if (!client) {
            row.id = uid("task");
            row.created_at = nowIso();
          }
          const saved = await apiInsert("tasks", row);
          applyRow("tasks", saved);
        }
        closeModal();
        renderTasks();
        toast(editing ? "작업을 수정했어요." : "작업을 추가했어요.");
      } catch (err) {
        toast("저장하지 못했어요: " + (err.message || err));
      }
    });
  }

  function openMemoModal(memo) {
    const editing = !!memo;
    openModal(
      "<h3>" + (editing ? "메모 수정" : "새 메모") + "</h3>" +
        '<p class="modal-sub">여섯 명이 함께 보는 메모장이에요.</p>' +
        '<form id="memoForm">' +
        '<label class="field"><span>제목</span><input type="text" name="title" maxlength="80" required value="' +
        esc(editing ? memo.title : "") + '" placeholder="예: 비서실 운영 규칙"></label>' +
        '<label class="field"><span>내용</span><textarea name="body" maxlength="4000" placeholder="자유롭게 적어두세요">' +
        esc(editing ? memo.body : "") + "</textarea></label>" +
        '<label class="check-row"><input type="checkbox" name="pinned"' + (editing && memo.pinned ? " checked" : "") +
        "> 위에 고정하기</label>" +
        '<div class="modal-actions"><button type="button" class="btn-ghost" data-action="close-modal">취소</button>' +
        '<button type="submit" class="btn-primary">' + (editing ? "저장" : "메모 추가") + "</button></div>" +
        "</form>"
    );

    $("#memoForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const data = {
        title: form.title.value.trim(),
        body: form.body.value,
        pinned: form.pinned.checked
      };
      if (!data.title) {
        toast("제목을 적어주세요.");
        return;
      }
      try {
        if (editing) {
          const saved = await apiUpdate("memos", memo.id, data);
          if (saved) applyRow("memos", saved);
        } else {
          const row = Object.assign({}, data, { author: CFG.OWNER_NAME });
          if (!client) {
            row.id = uid("memo");
            row.created_at = nowIso();
          }
          const saved = await apiInsert("memos", row);
          applyRow("memos", saved);
        }
        closeModal();
        renderMemos();
        toast(editing ? "메모를 저장했어요." : "메모를 추가했어요.");
      } catch (err) {
        toast("저장하지 못했어요: " + (err.message || err));
      }
    });
  }

  /* ---------------------------------------------------------------- 이벤트 */

  function bindEvents() {
    document.addEventListener("click", onClick);

    const authForm = $("#authForm");
    if (authForm) authForm.addEventListener("submit", handleSignIn);

    const signOutBtn = $("#signoutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", handleSignOut);

    const composer = $("#composer");
    if (composer) {
      composer.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = $("#messageInput");
        const text = input.value;
        if (!text.trim()) {
          input.focus();
          return;
        }
        input.value = "";
        autoGrow(input);
        sendMessage(text, state.recipient);
      });
    }

    const input = $("#messageInput");
    if (input) {
      input.addEventListener("input", () => autoGrow(input));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const text = input.value;
          if (!text.trim()) return;
          input.value = "";
          autoGrow(input);
          sendMessage(text, state.recipient);
        }
      });
    }

    const testBtn = $("#testBtn");
    if (testBtn) testBtn.addEventListener("click", runConnectionTest);

    const relayBtn = $("#relayBtn");
    if (relayBtn) relayBtn.addEventListener("click", openReplyModal);

    const relayGuideBtn = $("#relayGuideBtn");
    if (relayGuideBtn) relayGuideBtn.addEventListener("click", openRelayGuide);

    const chatScroll = $("#chatScroll");
    if (chatScroll) {
      chatScroll.addEventListener("scroll", () => {
        state.stick = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 90;
      });
    }

    const badge = $("#connBadge");
    if (badge) badge.addEventListener("click", () => toast(badge.title));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  async function onClick(e) {
    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) {
      applyTab(tabBtn.dataset.tab);
      return;
    }

    const roomBtn = e.target.closest("[data-room]");
    if (roomBtn) {
      setRoom(roomBtn.dataset.room);
      return;
    }

    const recipientBtn = e.target.closest("[data-recipient]");
    if (recipientBtn) {
      state.recipient = recipientBtn.dataset.recipient;
      renderRecipients();
      const input = $("#messageInput");
      if (input) input.focus();
      return;
    }

    const filterBtn = e.target.closest("[data-filter]");
    if (filterBtn) {
      if (filterBtn.dataset.filter === "status") state.taskFilter = filterBtn.dataset.value;
      else state.taskAssignee = filterBtn.dataset.value;
      renderTasks();
      return;
    }

    // ⇄ 답 옮기기 — 보낸 비서 고르기
    const replyPick = e.target.closest("[data-reply-sender]");
    if (replyPick) {
      const wrap = replyPick.parentNode;
      if (wrap) {
        $$(".pick", wrap).forEach((btn) => {
          const on = btn === replyPick;
          btn.classList.toggle("is-active", on);
          btn.setAttribute("aria-pressed", String(on));
        });
      }
      return;
    }

    // 🔗 비서 연결 안내 — 안내할 비서 고르기
    const guidePick = e.target.closest("[data-guide-assistant]");
    if (guidePick) {
      highlightGuidePick(guidePick.dataset.guideAssistant);
      return;
    }

    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    if (action === "close-modal") {
      closeModal();
      return;
    }

    if (action === "relay-guide") {
      openRelayGuide();
      return;
    }

    if (action === "copy") {
      const selector = actionEl.dataset.copy;
      const target = selector ? $(selector) : null;
      if (!target) return;
      const text = target.tagName === "INPUT" ? target.value : target.textContent;
      const copied = await copyText(text);
      toast(copied ? "복사했어요. 비서 앱에 붙여넣으세요." : "복사가 안 됐어요. 문구를 길게 눌러 직접 복사해 주세요.");
      return;
    }

    if (action === "retry-load") {
      await loadOffice();
      return;
    }

    if (action === "new-task") {
      openTaskModal(null);
      return;
    }

    if (action === "new-memo") {
      openMemoModal(null);
      return;
    }

    if (action === "set-state") {
      const next = actionEl.dataset.state;
      const a = assistantById(id);
      try {
        const saved = await apiUpdate("assistants", id, { status: next });
        if (saved) applyRow("assistants", saved);
        else {
          const row = db.assistants.find((x) => x.id === id);
          if (row) row.status = next;
        }
        renderTeam();
        renderRoomTabs();
        renderRoomStatus();
        toast(a.name + " 상태를 ‘" + STATE_LABEL[next] + "’로 바꿨어요.");
      } catch (err) {
        toast("상태를 바꾸지 못했어요: " + (err.message || err));
      }
      return;
    }

    if (action === "team-message") {
      const a = assistantById(id);
      const room = roomById(state.room);
      if (room.members.indexOf(id) === -1) setRoom("boardroom");
      state.recipient = id;
      applyTab("meeting");
      renderRecipients();
      const input = $("#messageInput");
      if (input) {
        input.focus();
        toast(a.name + "에게 보낼 메시지를 적어주세요.");
      }
      return;
    }

    if (action === "task-edit") {
      const task = db.tasks.find((t) => t.id === id);
      if (task) openTaskModal(task);
      return;
    }

    if (action === "task-delete") {
      const task = db.tasks.find((t) => t.id === id);
      if (!task) return;
      confirmModal("작업을 지울까요?", "‘" + task.title + "’ 카드가 사라집니다.", async () => {
        try {
          await apiDelete("tasks", id);
          db.tasks = db.tasks.filter((t) => t.id !== id);
          renderTasks();
          toast("작업을 지웠어요.");
        } catch (err) {
          toast("지우지 못했어요: " + (err.message || err));
        }
      });
      return;
    }

    if (action === "memo-edit") {
      const memo = db.memos.find((m) => m.id === id);
      if (memo) openMemoModal(memo);
      return;
    }

    if (action === "memo-pin") {
      const memo = db.memos.find((m) => m.id === id);
      if (!memo) return;
      try {
        const saved = await apiUpdate("memos", id, { pinned: !memo.pinned });
        if (saved) applyRow("memos", saved);
        else memo.pinned = !memo.pinned;
        renderMemos();
        toast(memo.pinned ? "위에 고정했어요." : "고정을 풀었어요.");
      } catch (err) {
        toast("고정 상태를 바꾸지 못했어요: " + (err.message || err));
      }
      return;
    }

    if (action === "memo-delete") {
      const memo = db.memos.find((m) => m.id === id);
      if (!memo) return;
      confirmModal("메모를 지울까요?", "‘" + (memo.title || "제목 없음") + "’ 메모가 사라집니다.", async () => {
        try {
          await apiDelete("memos", id);
          db.memos = db.memos.filter((m) => m.id !== id);
          renderMemos();
          toast("메모를 지웠어요.");
        } catch (err) {
          toast("지우지 못했어요: " + (err.message || err));
        }
      });
    }
  }

  function bindChange() {
    document.addEventListener("change", async (e) => {
      const select = e.target.closest('[data-action="task-status"]');
      if (!select) return;
      const id = select.dataset.id;
      const next = select.value;
      const task = db.tasks.find((t) => t.id === id);
      if (!task) return;
      try {
        const saved = await apiUpdate("tasks", id, { status: next });
        if (saved) applyRow("tasks", saved);
        else task.status = next;
        renderTasks();
        toast("‘" + task.title + "’ → " + (TASK_COLUMNS.find((c) => c.key === next) || {}).label);
      } catch (err) {
        toast("상태를 바꾸지 못했어요: " + (err.message || err));
        renderTasks();
      }
    });
  }

  /* ---------------------------------------------------------------- 시작 */

  async function init() {
    const hasRemote =
      typeof CFG.SUPABASE_URL === "string" &&
      /^https?:\/\//.test(CFG.SUPABASE_URL.trim()) &&
      typeof CFG.SUPABASE_ANON_KEY === "string" &&
      CFG.SUPABASE_ANON_KEY.trim().length > 20;

    bindEvents();
    bindChange();

    // Supabase를 안 쓰는 로컬 데모 모드: 로그인 없이 바로 연다.
    if (!hasRemote) {
      useLocalData();
      state.ready = true;
      state.conn = "demo";
      state.auth = "off";
      renderAll();
      return;
    }

    // Supabase 모드: 로그인 전에는 비서실을 가리고(로컬 샘플 데이터도 보이지 않게)
    // 로그인 화면만 보여준다.
    state.conn = "connecting";
    state.auth = "checking";
    document.body.classList.add("is-locked");
    const gate = $("#authGate");
    if (gate) gate.hidden = false;
    setAuthBusy(true, "연결 확인 중…");
    renderAll();

    try {
      await withTimeout(bootstrapRemote(), 15000, "Supabase 응답이 없어요.");
    } catch (err) {
      connectAborted = true;
      state.conn = "error";
      showAuthGate(loginErrorMessage(err));
      console.warn("[이솔 비서실] Supabase 연결 실패:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
