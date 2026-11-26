/* ==========================================================================
   이솔 비서실 — config.js
   --------------------------------------------------------------------------
   Supabase를 연결하려면 아래 두 값을 채우고 저장한 뒤 새로고침하세요.
   값이 비어 있으면 자동으로 '로컬 데모 모드'(localStorage)로 동작합니다.

   1) https://supabase.com 에서 새 프로젝트 만들기
   2) 프로젝트 → SQL Editor 에 supabase-schema.sql 내용을 붙여 실행
   3) 프로젝트 → Settings → API 에서
      - Project URL          → SUPABASE_URL
      - anon public API key  → SUPABASE_ANON_KEY
   ========================================================================== */

window.APP_CONFIG = {
  // 화면에 보이는 이름 (바꾸고 싶으면 여기만 수정)
  APP_TITLE: "이솔 비서실",
  OWNER_NAME: "이솔",
  OWNER_LABEL: "이솔님 전용",

  // Supabase (비워두면 로컬 데모 모드)
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
