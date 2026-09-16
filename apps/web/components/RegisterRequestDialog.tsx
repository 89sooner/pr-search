'use client';

/**
 * W-009-REQUEST 등록 검토 요청 (API-ING-003 / FR-ING-009 AC-8·9·10, WP-034).
 *
 * ## 받는 것은 `owner/name` 하나다
 *
 * 시퀀스 대상 브랜치·미러 사용 여부·백필은 **등록 시점에 운영자가 정한다**
 * (A-002, WP-040). 여기서 받으면 요청자가 주장한 값이 등록 계약으로 흘러든다.
 *
 * ## 성공 문구가 하지 않은 일을 말하지 않는다
 *
 * 이 요청은 GitHub Enterprise에 묻지 않으므로 "저장소를 확인했습니다"도
 * "접근 권한이 있습니다"도 "곧 등록됩니다"도 말할 수 없다 — 말하면 거짓이고,
 * 확인하는 순간 이 경로가 비공개 저장소의 존재 신탁이 된다 (AC-10, THR-041).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog, Field, TextField } from './ui';
import { ErrorBanner } from './ErrorBanner';
import { serviceMessage } from '../lib/service-message';

/** `/api/v1`을 적으면 프록시가 `/api/v1/v1/...`을 만든다. */
const REGISTRATION_REQUESTS_API = '/api/repository-registration-requests';

export interface RegisterRequestDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 딥링크가 실어 온 저장소. 폼을 미리 채울 뿐 실재를 주장하지 않는다. */
  readonly initialRepository?: string;
  readonly onRecorded?: (repository: string) => void;
}

export function RegisterRequestDialog({
  open,
  onOpenChange,
  initialRepository = '',
  onRecorded,
}: RegisterRequestDialogProps): ReactNode {
  const [repository, setRepository] = useState(initialRepository);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRepository(initialRepository);
      setFailed(null);
    }
  }, [open, initialRepository]);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setFailed(null);
    try {
      const response = await fetch(REGISTRATION_REQUESTS_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repository }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string; code?: string } };
        setFailed(serviceMessage(body.error?.message, "Unable to record request", body.error?.code));
        return;
      }
      /*
       * **반복 요청은 실패가 아니다** (AC-9). 서버가 기존 기록을 그대로
       * 돌려주므로 화면도 성공으로 다룬다 — 사용자가 두 번 눌렀다는 것이
       * 오류는 아니다.
       */
      onRecorded?.(repository);
      onOpenChange(false);
    } catch {
      setFailed("Unable to record request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="sm" data-testid="register-request-dialog">
        <Dialog.Title>Request repository registration review</Dialog.Title>
        <Dialog.Description>
          Record a request for operator review. This does not register the repository, start ingestion, or verify that the repository exists.
        </Dialog.Description>

        {failed === null ? null : (
          <ErrorBanner tone="warning" title="Unable to record request" impact={failed} recoverable />
        )}

        <Field label="Repository" required>
          <TextField
            value={repository}
            placeholder="owner/name"
            onChange={(event) => {
              setRepository(event.target.value);
            }}
            data-testid="register-request-repository"
          />
        </Field>

        <Button
          onClick={() => {
            void submit();
          }}
          disabled={submitting || repository.trim() === ''}
          data-testid="register-request-submit"
        >
          Submit request
        </Button>
        <Dialog.Close asChild>
          <Button variant="secondary">Cancel</Button>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Root>
  );
}
