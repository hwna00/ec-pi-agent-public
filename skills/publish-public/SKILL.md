---
name: publish-public
description: ec-pi-agent의 커밋된 파일을 공개 저장소로 배포하거나 배포 대상을 검사할 때 사용한다.
---

# 공개 저장소 배포

프로젝트 폴더의 PowerShell에서 배포 대상을 검사한다.

```powershell
npm --prefix .\.pi run publish:public:check
```

검사가 끝나고 공개 배포 요청이 있으면 실행한다.

```powershell
npm --prefix .\.pi run publish:public
```

- 대상 저장소·폴더·브랜치는 `.pi\public-export.json`에서 읽는다.
- 제외 항목은 공개 저장소의 `.gitignore`에서 관리한다.
- 커밋된 파일만 배포한다. 배포할 Private 커밋은 먼저 원격에 push되어 있어야 한다.
- 검사 실패 시 원인을 보고한다. 제외 규칙이나 보호 검사를 임의로 우회하지 않는다.
