import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import { Card } from '../components/ui/Card';

export function Inbox({ onOpenLegacyReview }: { onOpenLegacyReview: () => void }) {
  const { activeProfile } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const session = useLiveQuery(async () => {
    const sessions = await db.activeReviewSessions.where('status').equals('active').reverse().sortBy('updatedAt');
    return sessions.find((item) => item.profileId === profileId || item.profileId == null) ?? null;
  }, [profileId], null);

  const rows: PipelineReviewRow[] = session ? JSON.parse(session.rowsJson) : [];
  const pending = rows.filter((row) => row.included && row.needsReview);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-[34px] font-bold text-rd-label-primary">Inbox · {pending.length}</h1>
        <p className="text-[13px] text-rd-label-secondary">Everything waiting for your judgment, in one place.</p>
      </div>

      {pending.length === 0 ? (
        <Card className="py-14 text-center">
          <p className="text-[22px] font-semibold text-rd-label-primary">All caught up. Everything counted.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {pending.map((row) => {
            const candidate = row.selectedCandidateIndex == null ? null : row.candidates[row.selectedCandidateIndex];
            return (
              <Card key={row.tempId} className="space-y-1">
                <p className="truncate text-[17px] font-semibold text-rd-label-primary">{row.source.examTitle}</p>
                <p className="text-[15px] text-rd-label-secondary">
                  {candidate ? `${candidate.cptCode} · ${candidate.workRvu?.toFixed(2) ?? '—'} wRVU` : 'No confident match'}
                </p>
                <p className="text-[13px] text-rd-caution">{row.reviewReason ?? 'Needs review'}</p>
              </Card>
            );
          })}
        </div>
      )}

      {session && (
        <button type="button" onClick={onOpenLegacyReview} className="min-h-11 text-[15px] font-medium text-rd-label-primary underline underline-offset-4">
          Open full review
        </button>
      )}
    </div>
  );
}
