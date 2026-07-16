/**
 * Log.tsx
 *
 * The unified Log surface per the UI modernization spec: one screen over the
 * shared import pipeline, with a segmented control choosing the intake
 * method instead of separate destinations. Composes the existing Import
 * (capture/paste, review queue, persisted session) and LogStudy (manual
 * entry, now routed through the shared pipeline's commit path) pages rather
 * than rewriting their mature, pipeline-integrated internals — presentation
 * layer only, per the spec's engineering constraints.
 *
 * A persisted review session (e.g. a watcher batch) stays visible via the
 * banner below regardless of which segment is selected, since Import only
 * restores/renders its review queue while mounted.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { Import } from './Import';
import { LogStudy } from './LogStudy';
import { CameraUploadPage } from './CameraUploadPage';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { StatusPill } from '../components/ui/StatusPill';
import { Sheet } from '../components/ui/Sheet';

type Segment = 'capture' | 'manual' | 'camera';

interface LogProps {
  onImported: () => void;
  onReviewReady: () => void;
  onClose: () => void;
}

export function Log({ onImported, onReviewReady, onClose }: LogProps) {
  const { activeProfile, activePractice } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const siteId = activePractice?.id ?? null;
  const [segment, setSegment] = useState<Segment>('capture');

  const pendingSession = useLiveQuery(
    async () => {
      const sessions = await db.activeReviewSessions.where('status').equals('active').reverse().sortBy('updatedAt');
      return sessions.find((session) => session.profileId === profileId && (session.siteId ?? null) === siteId) ?? null;
    },
    [profileId, siteId],
    null,
  );

  return (
    <Sheet open onClose={onClose} title="Capture" className="max-h-[92vh] max-w-4xl overflow-y-auto">
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-[22px] font-semibold leading-tight text-rd-label-primary">Paste, drop, or type an exam…</p>
        <p className="mt-1 text-[13px] text-rd-label-secondary">⌘V paste · browse files · camera</p>
      </div>

      {pendingSession && pendingSession.totalExams > 0 && segment !== 'capture' && (
        <StatusPill tone="caution" onClick={() => setSegment('capture')}>
          {pendingSession.totalExams} {pendingSession.totalExams === 1 ? 'study' : 'studies'} waiting for review — resume
        </StatusPill>
      )}

      <SegmentedControl
        options={[
          { value: 'capture', label: 'Camera / Paste image' },
          { value: 'manual', label: 'Manual' },
        ]}
        value={segment === 'camera' ? 'capture' : segment}
        onChange={setSegment}
      />

      {segment === 'capture' && <Import onReviewReady={onReviewReady} />}
      {segment === 'manual' && (
        <div className="space-y-3">
          <LogStudy onSaved={onImported} />
          <button
            type="button"
            onClick={() => setSegment('camera')}
            className="text-[15px] font-medium text-rd-accent"
          >
            Use camera instead
          </button>
        </div>
      )}
      {segment === 'camera' && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSegment('manual')}
            className="text-[13px] font-medium text-rd-accent"
          >
            ← Back to manual entry
          </button>
          <CameraUploadPage onImported={onImported} />
        </div>
      )}
      <p className="text-[12px] text-rd-label-secondary">Screenshots are processed on this device and minimized after import.</p>
    </div>
    </Sheet>
  );
}
