-- 032 회수 (CR-101). 병합된 PR의 GitHub 원시 state는 언제나 closed이므로 되돌림은 결정적이다.
-- 옛 투영(파생 없음)이 만들었을 값으로 돌려놓는다. 재색인은 up과 같은 이유로 따로 필요하다.

UPDATE pull_request_snapshot
   SET document = jsonb_set(document, '{state}', '"closed"'::jsonb, true)
 WHERE document->>'merged_at' IS NOT NULL
   AND document->>'state' = 'merged';
