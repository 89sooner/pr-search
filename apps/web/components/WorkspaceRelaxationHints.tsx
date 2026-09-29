/**
 * CR-131 / DEV-787: filter suggestions under "No matching changes" in the Repository workspace.
 *
 * The count on a button is the server's `would_yield` for that exact removal. Only suggestions this screen can apply
 * exactly are buttons (`lib/workspace-relaxation.ts`); conditions the workspace or the tab sets itself are not shown.
 * When the server could not count every candidate, or checked only the first filters, a short note says so and the
 * empty state stays as it is.
 */

import type { ReactNode } from 'react';
import { Button } from './reader/primitives';
import { planWorkspaceHints, resultCount, type RelaxationHint, type WorkspaceHintContext, type WorkspaceHintPlan } from '../lib/workspace-relaxation';

type ActionPlan = Extract<WorkspaceHintPlan, { kind: 'action' }>;

export function WorkspaceRelaxationHints({
  hints,
  incomplete,
  truncated,
  context,
  onApply,
}: {
  readonly hints: readonly RelaxationHint[] | undefined;
  readonly incomplete: boolean;
  readonly truncated: boolean;
  readonly context: WorkspaceHintContext;
  readonly onApply: (plan: ActionPlan) => void;
}): ReactNode {
  const actions = planWorkspaceHints(Array.isArray(hints) ? hints : [], context).filter((plan): plan is ActionPlan => plan.kind === 'action');
  if (actions.length === 0 && !incomplete && !truncated) return null;
  return (
    <div className="repo-relaxation" data-testid="workspace-relaxation">
      {actions.length > 0 ? (
        <>
          <p className="repo-relaxation-heading">Results if you remove one filter:</p>
          <ul aria-label="Filter suggestions">
            {actions.map((plan) => (
              <li key={plan.hint.remove}>
                <Button variant="secondary" onClick={() => { onApply(plan); }}>
                  {plan.label} · {resultCount(plan.hint.would_yield)}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {incomplete ? (
        <p className="repo-relaxation-note" data-testid="workspace-relaxation-incomplete">
          {actions.length === 0 ? 'Filter suggestions could not be calculated for this search.' : 'Some filter suggestions could not be calculated.'}
        </p>
      ) : null}
      {truncated ? (
        <p className="repo-relaxation-note" data-testid="workspace-relaxation-truncated">
          Only the first filters of this search were checked for suggestions.
        </p>
      ) : null}
    </div>
  );
}
