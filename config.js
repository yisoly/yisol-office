/* ==========================================================================
   이솔 비서실 — config.js
   --------------------------------------------------------------------------
   Supabase 프로젝트가 연결되어 있습니다. 값이 비어 있으면 자동으로
   '로컬 데모 모드'(localStorage)로 동작합니다.

   · SUPABASE_URL        : 프로젝트 URL
   · SUPABASE_ANON_KEY   : publishable(anon) 키 — 공개되어도 되는 키입니다.
                           데이터는 이 키가 아니라 Supabase의 RLS(로그인 전용)가 지킵니다.

   처음 한 번만 하면 되는 일
   1) Supabase → SQL Editor 에 supabase-schema.sql 전체를 붙여 Run
   2) Supabase → Authentication → Users → Add user 에서 본인 이메일 + 비밀번호로 계정 1개
      (Auto Confirm User 체크)
   3) Supabase → Authentication → Sign In / Providers → Email 에서
      "Allow new users to sign up" 끄기 (한 사람 전용)
   ========================================================================== */

window.APP_CONFIG = {
  // 화면에 보이는 이름 (바꾸고 싶으면 여기만 수정)
  APP_TITLE: "이솔 비서실",
  OWNER_NAME: "이솔",
  OWNER_LABEL: "이솔님 전용",

  // Supabase (비워두면 로컬 데모 모드 · 로그인 화면 없이 바로 열립니다)
  SUPABASE_URL: "https://yzeovdjceqjundyyyfwo.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_uyncVs4aB1mcDbc9MuZlLw_QUvadc3P"
};
