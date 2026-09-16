'use client';

/**
 * C-001 사용자 메뉴 (CR-092 / DEV-700, FR-AUTH-001 AC-5).
 *
 * 사내 `0.1.0-pilot.7`에는 로그아웃할 방법이 화면에 없었다 — `POST /auth/logout`을 직접 불러야 했고, 주소창으로
 * 열면 405였다. 상단의 로그인 이름을 메뉴로 만들고 그 안에 「로그아웃」을 둔다.
 *
 * ## 로그아웃은 폼 제출이다
 *
 * `fetch`로 부르고 화면을 옮기면 **스크립트가 두 일을 이어야** 한다 — 요청이 실패했는데 옮기거나, 옮겼는데 쿠키가
 * 남는 순서 문제가 생긴다. 폼을 제출하면 브라우저가 한 요청으로 세션 종료와 이동을 받는다(라우트가 303으로 완료
 * 화면을 가리킨다). 메뉴 내용은 포털로 문서 끝에 그려지므로 폼 안에 넣을 수 없어, 항목이 선택되면 이 폼을 제출한다.
 * `GET`으로 열리는 링크로 만들지 않는다 — 다른 사이트가 `<img>` 하나로 사용자를 로그아웃시킬 수 있다.
 */

import { useRef, type ReactNode } from 'react';
import { DropdownMenu } from './ui';
import { LOGOUT_PATH } from '../lib/auth-paths';

export interface UserMenuProps {
  readonly login: string;
  readonly email: string | null;
}

export function UserMenu({ login, email }: UserMenuProps): ReactNode {
  const logout = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={logout} method="post" action={LOGOUT_PATH} hidden data-testid="logout-form" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="prs-user" data-testid="user-summary" aria-label={`User menu: ${login}`}>
          <span className="prs-avatar" aria-hidden="true">{login.slice(0, 2).toUpperCase()}</span>
          <span>{login}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" sideOffset={6} className="prs-user-menu">
          <DropdownMenu.Label className="prs-user-menu__identity">
            <strong>{login}</strong>
            {email === null ? null : <span>{email}</span>}
          </DropdownMenu.Label>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            data-testid="logout"
            onSelect={() => {
              logout.current?.requestSubmit();
            }}
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </>
  );
}
