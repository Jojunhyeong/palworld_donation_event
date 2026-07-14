# Pal Donation Bridge

치지직 채팅·후원 이벤트를 수신해 Palworld Dedicated Server 이벤트로 연결하는 Windows 데스크톱 애플리케이션입니다.

## 현재 구현 범위

- 치지직 OAuth 인증
- Socket.IO v2 세션 연결
- 일반 채팅과 후원 이벤트 수신
- Electron 데스크톱 UI
- 운영체제 보안 저장소를 이용한 Secret·토큰 암호화
- PalDefender 연결 확인과 스트리머 캐릭터 선택
- 금액별 후원 효과 테스트 모드
- GitHub Actions를 이용한 Windows `Setup.exe` 자동 빌드

> 실제 팟월드 아이템 지급·이동·사망 실행기는 개발 중입니다. 현재 후원 효과는 테스트 모드로만 표시됩니다.

## 개발 실행

```bash
npm install
npm run desktop:dev
```

CLI 수신기는 다음으로 실행합니다.

```bash
npm run dev
```

## 빌드

```bash
npm run build
npm run package
```

Windows 설치 파일은 GitHub Actions의 `Build Windows installer` 워크플로를 수동 실행하면 생성됩니다.

## 보안

- `.env`는 Git에 포함되지 않습니다.
- Client Secret, Access Token, Refresh Token, PalDefender Token을 이슈·로그·커밋에 올리지 마세요.
- PalDefender API는 `127.0.0.1`에서만 접속하도록 설계했습니다.
