# 운영자 최초 설정

이 문서의 작업은 앱을 배포하는 개발자가 최초 1회만 진행합니다. 최종 사용자는 아래 값을 보거나 입력하지 않습니다.

## 1. Cloudflare Worker 생성

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create OAUTH_SESSIONS
```

`wrangler.example.jsonc`를 `wrangler.jsonc`로 복사한 뒤 생성된 KV namespace ID, Worker 이름, 씨미 Client ID, Worker 콜백 URL을 입력합니다.

Client Secret은 파일에 쓰지 않고 다음 명령으로 암호화 저장소에 등록합니다.

```bash
npx wrangler secret put CIME_CLIENT_SECRET
npx wrangler deploy
```

## 2. 씨미 애플리케이션 설정

씨미 개발자 센터에서 애플리케이션에 `READ:DONATION` 권한을 부여하고 로그인 리디렉션 URL을 다음 형식으로 설정합니다.

```text
https://<Worker 주소>/auth/callback
```

## 3. 데스크톱 앱에 Worker URL 연결

`src/config/product.ts`의 `AUTH_SERVICE_URL`을 배포된 Worker URL로 변경한 뒤 Windows 설치 파일을 다시 빌드합니다.

## 보안 원칙

- Client Secret을 GitHub Secrets가 아닌 소스 파일, `.env`, Worker 일반 변수에 입력하지 않습니다.
- OAuth 세션은 5분, 일회용 토큰 티켓은 2분 후 자동 삭제됩니다.
- 티켓에 저장되는 토큰은 데스크톱 앱이 생성한 일회용 검증값으로 AES-GCM 암호화됩니다.
