# 농소스포츠스쿨

농소중학교 아침 운동 QR 출석, XP·레벨, 학급 레이스, 오늘의 미션 앱입니다.

- 학생 앱: https://nongso-sports.bangssam.kr/
- 선생님 화면: https://nongso-sports.bangssam.kr/admin

## 처음 한 번 설정 (Supabase)

1. Supabase 대시보드 → **SQL Editor** → New query → `supabase/schema.sql` 전체를 붙여 넣고 **Run**.
2. **Authentication → URL Configuration** → Site URL 에 `https://nongso-sports.bangssam.kr/admin.html` 입력 후 저장.
3. (선택) **Authentication → Sign In / Providers → Email** 에서 *Confirm email* 을 끄면 선생님 가입이 메일 확인 없이 바로 돼요.
4. `/admin` 에서 **맨 처음 가입한 선생님이 관리교사**가 돼요. 그다음 가입한 선생님은 관리교사가 설정에서 승인해요.
5. 선생님 화면 → 학생 · 명단 → 엑셀에서 학년·반·번호·이름 4칸만 복사해 붙여 넣기.

## 구조

- `index.html`, `js/student.js`: 학생 앱 (학번 + 비밀번호, Supabase 계정 없음, `student_*` 서버 함수만 사용)
- `admin.html`, `js/admin.js`: 선생님 화면 (Supabase 이메일 로그인, `admin_*` 서버 함수)
- `js/config.js`: Supabase 주소와 **공개(publishable) 키**만. secret / service_role 키는 절대 넣지 않아요.
- `supabase/schema.sql`: 표, 접근 규칙(RLS), 서버 함수. 여러 번 실행해도 괜찮아요.

깃허브 `main` 에 올리면 Netlify 가 자동으로 배포해요.

참고: Supabase 무료 프로젝트는 1주일 동안 아무도 쓰지 않으면 잠시 멈춰요. 대시보드에서 Restore 를 누르면 다시 켜져요.
