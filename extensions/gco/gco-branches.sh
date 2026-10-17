#!/usr/bin/env bash
# Pi /gco에서 호출하는 브랜치 조회·이동 스크립트.
set -Eeuo pipefail

# Windows 기본 경로. 환경변수가 있으면 그 경로를 사용한다.
SOURCE_DIR="${GCO_SOURCE_DIR:-D:/ecxsolution/ecount.nextv56/ecount.solution}"
ARTIFACT_DIR="${GCO_ARTIFACT_DIR:-D:/ecountv5}"

# 지정한 저장소에서 Git 명령을 실행한다.
git_repo() {
  local repo="$1"
  shift
  git -c safe.directory='*' -C "$repo" "$@"
}

# 이미 대상 브랜치면 유지한다. 로컬 브랜치가 없으면 원격에서 만든다.
switch_branch() {
  local repo="$1"

  if [ "$(git_repo "$repo" symbolic-ref --short HEAD)" = "$branch" ]; then
    return
  fi

  if git_repo "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    git_repo "$repo" switch "$branch"
  else
    git_repo "$repo" switch -c "$branch" --track "$remote/$branch"
  fi
}

# 실패한 단계와 아직 복원하지 못한 stash를 알리고 종료한다.
fail() {
  local status="${1:-$?}"
  printf '실패 단계: %s\n마지막 완료 단계: %s\n' "$current_step" "$last_step" >&2

  if [ -n "$stash_oid" ]; then
    printf '복원하지 못한 소스 stash를 유지합니다: %s\n' "$stash_oid" >&2
  fi

  exit "$status"
}

# 다음 단계에 도달했다면 이전 단계는 완료된 상태다.
begin_step() {
  last_step="$current_step"
  current_step="$1"
  printf '>> %s\n' "$current_step"
}

# list: 두 저장소의 로컬 원격 브랜치를 합치고 중복을 제거한다.
if [ "${1:-}" = list ]; then
  for repo in "$SOURCE_DIR" "$ARTIFACT_DIR"; do
    git_repo "$repo" for-each-ref --format='%(refname:lstrip=2)' refs/remotes/origin refs/remotes/ecount
  done | sed '/\/HEAD$/d' | sort -u
  exit 0
fi

# 선택창을 띄우기 전에 소스의 미커밋 변경만 읽는다.
if [ "${1:-}" = source-status ]; then
  git_repo "$SOURCE_DIR" status --porcelain --untracked-files=all
  exit 0
fi

# checkout: 양쪽에 사용할 원격과 브랜치를 확인한다.
remote="${2:-}"
branch="${3:-}"
change_action="${4:-}"
if [ "${1:-}" != checkout ] || [[ "$remote" != origin && "$remote" != ecount ]] || [ -z "$branch" ] ||
   [[ "$change_action" != clean && "$change_action" != discard && "$change_action" != stash && "$change_action" != reapply ]]; then
  echo 'Usage: gco-branches.sh list | source-status | checkout <origin|ecount> <branch> <clean|discard|stash|reapply>' >&2
  exit 2
fi

current_step="시작"
last_step="시작"
stash_oid=""

update_source() {
  begin_step '소스 원격 브랜치 확인'
  git_repo "$SOURCE_DIR" ls-remote --exit-code --heads "$remote" "refs/heads/$branch" > /dev/null

  # 진행 중인 충돌이나 rebase는 선택한 삭제 작업으로 지우지 않는다.
  begin_step '소스 작업 상태 확인'
  if [ -n "$(git_repo "$SOURCE_DIR" diff --name-only --diff-filter=U)" ] ||
     [ -d "$(git_repo "$SOURCE_DIR" rev-parse --path-format=absolute --git-path rebase-merge)" ] ||
     [ -d "$(git_repo "$SOURCE_DIR" rev-parse --path-format=absolute --git-path rebase-apply)" ]; then
    echo '소스의 기존 충돌 또는 rebase를 먼저 처리해야 합니다.' >&2
    fail 1
  fi

  local changes
  changes="$(git_repo "$SOURCE_DIR" status --porcelain --untracked-files=all)"
  if [ -n "$changes" ]; then
    case "$change_action" in
      clean)
        echo '소스 변경사항이 생겼습니다. /gco를 다시 실행하여 처리 방법을 선택하세요.' >&2
        fail 1
        ;;
      discard)
        begin_step '소스 미커밋 변경 제거'
        git_repo "$SOURCE_DIR" reset --hard HEAD
        git_repo "$SOURCE_DIR" clean -fd
        ;;
      stash|reapply)
        begin_step '소스 변경사항 stash'
        git_repo "$SOURCE_DIR" stash push -u -m "gco:$remote/$branch"
        stash_oid="$(git_repo "$SOURCE_DIR" rev-parse refs/stash)"
        ;;
    esac
  fi

  begin_step '소스 fetch'
  git_repo "$SOURCE_DIR" fetch "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch"

  begin_step '소스 브랜치 이동'
  switch_branch "$SOURCE_DIR"

  begin_step '소스 rebase'
  git_repo "$SOURCE_DIR" rebase "$remote/$branch"

  if [ -n "$stash_oid" ] && [ "$change_action" = reapply ]; then
    begin_step '소스 stash 복원'
    if [ "$(git_repo "$SOURCE_DIR" rev-parse refs/stash)" != "$stash_oid" ]; then
      echo '소스 stash가 변경되어 자동 복원을 중단합니다.' >&2
      fail 1
    fi
    git_repo "$SOURCE_DIR" stash pop --index 'stash@{0}'
    stash_oid=""
  elif [ -n "$stash_oid" ]; then
    printf '소스 변경사항을 stash에 보관했습니다: %s\n' "$stash_oid"
  fi

  begin_step '소스 대상 브랜치 확인'
  test "$(git_repo "$SOURCE_DIR" symbolic-ref --short HEAD)" = "$branch"
}

update_artifact() {
  begin_step '산출물 원격 브랜치 확인'
  git_repo "$ARTIFACT_DIR" ls-remote --exit-code --heads "$remote" "refs/heads/$branch" > /dev/null

  # 산출물 변경사항과 새 파일을 지운다. ignore 파일은 유지한다.
  begin_step '산출물 reset'
  git_repo "$ARTIFACT_DIR" reset --hard HEAD

  begin_step '산출물 clean'
  git_repo "$ARTIFACT_DIR" clean -fd

  if [ "$(git_repo "$ARTIFACT_DIR" symbolic-ref --short HEAD)" != "$branch" ]; then
    begin_step '산출물 fetch'
    git_repo "$ARTIFACT_DIR" fetch "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch"
  fi

  begin_step '산출물 브랜치 이동'
  switch_branch "$ARTIFACT_DIR"

  begin_step '산출물 pull'
  git_repo "$ARTIFACT_DIR" pull "$remote" "$branch"

  begin_step '산출물 대상 브랜치 확인'
  test "$(git_repo "$ARTIFACT_DIR" symbolic-ref --short HEAD)" = "$branch"
}

# 각 저장소는 별도 실행 범위에서 실패 시 중단한다. 소스 실패도 산출물을 막지 않는다.
set +e
( set -e; trap fail ERR; update_source )
source_status=$?
( set -e; trap fail ERR; update_artifact )
artifact_status=$?
set -e

if [ "$source_status" -eq 0 ]; then echo '소스 결과: 완료'; else echo '소스 결과: 실패'; fi
if [ "$artifact_status" -eq 0 ]; then echo '산출물 결과: 완료'; else echo '산출물 결과: 실패'; fi
if [ "$source_status" -ne 0 ] || [ "$artifact_status" -ne 0 ]; then exit 1; fi
printf '완료: %s/%s\n' "$remote" "$branch"
